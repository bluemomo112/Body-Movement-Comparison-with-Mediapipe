"""
Dance Trainer Web - Flask 后端
负责：serve 页面 + 处理视频上传 + 离线人物分割
"""
import os
import uuid
import threading
import time
import json
from flask import Flask, render_template, request, jsonify, Response

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = os.path.join('static', 'uploads')
app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024  # 500MB

os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

ALLOWED_EXTENSIONS = {'mp4', 'mov', 'avi', 'mkv', 'webm'}

# 任务状态存储 {task_id: {progress, status, output, error}}
_tasks = {}
_tasks_lock = threading.Lock()


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/upload', methods=['POST'])
def upload():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    f = request.files['file']
    if f.filename == '':
        return jsonify({'error': 'No selected file'}), 400
    if not allowed_file(f.filename):
        return jsonify({'error': 'File type not allowed'}), 400

    filename = f.filename
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    f.save(filepath)
    url = '/' + filepath.replace(os.sep, '/')
    return jsonify({'url': url, 'filename': filename})


# ── 人物检测相关 ──────────────────────────────────────────────────────────────

def _load_person_detector():
    """加载 MobileNet-SSD 人物检测模型"""
    import cv2
    prototxt = "models/deploy.prototxt"
    caffemodel = "models/mobilenet_ssd.caffemodel"
    net = cv2.dnn.readNetFromCaffe(prototxt, caffemodel)
    return net


def _compute_iou(bbox1, bbox2):
    """计算两个 bbox 的交并比 (IOU)"""
    x1_1, y1_1, x2_1, y2_1 = bbox1
    x1_2, y1_2, x2_2, y2_2 = bbox2

    # 计算交集
    x1_i = max(x1_1, x1_2)
    y1_i = max(y1_1, y1_2)
    x2_i = min(x2_1, x2_2)
    y2_i = min(y2_1, y2_2)

    if x2_i < x1_i or y2_i < y1_i:
        return 0.0

    inter_area = (x2_i - x1_i) * (y2_i - y1_i)

    # 计算并集
    area1 = (x2_1 - x1_1) * (y2_1 - y1_1)
    area2 = (x2_2 - x1_2) * (y2_2 - y1_2)
    union_area = area1 + area2 - inter_area

    if union_area == 0:
        return 0.0

    return inter_area / union_area

def _detect_persons_in_frame(frame, net, conf_threshold=0.5):
    """检测帧中的所有人物，返回 bbox 列表 [(x1,y1,x2,y2), ...]"""
    import cv2
    h, w = frame.shape[:2]
    blob = cv2.dnn.blobFromImage(frame, 0.007843, (300, 300), 127.5)
    net.setInput(blob)
    detections = net.forward()

    persons = []
    for i in range(detections.shape[2]):
        confidence = detections[0, 0, i, 2]
        class_id = int(detections[0, 0, i, 1])
        # class_id 15 = person in MobileNet-SSD VOC labels
        if class_id == 15 and confidence > conf_threshold:
            box = detections[0, 0, i, 3:7] * [w, h, w, h]
            x1, y1, x2, y2 = box.astype(int)
            persons.append((x1, y1, x2, y2))
    return persons


def _expand_and_clip_bbox(bbox, frame_w, frame_h, pad_ratio=0.12):
    """扩展并裁剪 bbox，避免越界和过紧"""
    x1, y1, x2, y2 = [int(v) for v in bbox]
    if x1 > x2:
        x1, x2 = x2, x1
    if y1 > y2:
        y1, y2 = y2, y1

    box_w = max(2, x2 - x1)
    box_h = max(2, y2 - y1)
    pad_x = max(8, int(box_w * pad_ratio))
    pad_y = max(8, int(box_h * pad_ratio))

    x1 = max(0, x1 - pad_x)
    y1 = max(0, y1 - pad_y)
    x2 = min(frame_w, x2 + pad_x)
    y2 = min(frame_h, y2 + pad_y)

    if x2 <= x1:
        x2 = min(frame_w, x1 + 2)
    if y2 <= y1:
        y2 = min(frame_h, y1 + 2)

    return (x1, y1, x2, y2)


def _crop_output_filename(filename, bbox):
    """生成裁剪输出文件名，避免不同人物互相覆盖缓存"""
    name, _ = os.path.splitext(filename)
    tag = '_'.join(str(int(v)) for v in bbox)
    return f"{name}_crop_{tag}.mp4"

def _run_crop_person(task_id, input_path, output_path, target_bbox):
    """后台线程：逐帧追踪并裁剪选中的人"""
    import cv2
    import numpy as np
    import subprocess

    def update(progress, status, output=None, error=None):
        with _tasks_lock:
            _tasks[task_id] = {
                'progress': progress,
                'status': status,
                'output': output,
                'error': error,
            }

    tmp_path = output_path + '.tmp.mp4'
    log_path = output_path + '.log'

    try:
        update(0, 'processing')

        # 加载检测器
        net = _load_person_detector()

        cap = cv2.VideoCapture(input_path)
        if not cap.isOpened():
            update(0, 'error', error='无法打开视频文件')
            return

        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        frame_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 0
        frame_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 0
        target_bbox = _expand_and_clip_bbox(target_bbox, frame_w, frame_h)

        # 初始化日志
        log_file = open(log_path, 'w', encoding='utf-8')
        log_file.write(f"=== 裁剪任务日志 ===\n")
        log_file.write(f"输入视频: {input_path}\n")
        log_file.write(f"视频尺寸: {frame_w}x{frame_h}, FPS: {fps}, 总帧数: {total}\n")
        log_file.write(f"初始目标bbox: {target_bbox}\n\n")

        # 第一遍：收集所有帧的 bbox
        bboxes = []
        frame_idx = 0
        tx1, ty1, tx2, ty2 = target_bbox
        initial_bbox = target_bbox  # 保存初始bbox作为参考

        detection_stats = {'detected': 0, 'fallback': 0, 'no_detection': 0}

        while True:
            ret, frame = cap.read()
            if not ret:
                break

            persons = _detect_persons_in_frame(frame, net)

            # 用 IOU 找到最匹配目标 bbox 的人
            best_bbox = None
            max_iou = 0.0
            for bbox in persons:
                iou = _compute_iou(target_bbox, bbox)
                if iou > max_iou:
                    max_iou = iou
                    best_bbox = bbox

            # 只有 IOU > 0.3 才认为是同一个人
            if best_bbox and max_iou > 0.3:
                best_bbox = _expand_and_clip_bbox(best_bbox, frame_w, frame_h)
                bboxes.append(best_bbox)
                target_bbox = best_bbox  # 更新目标用于下一帧
                detection_stats['detected'] += 1

                # 每100帧记录一次
                if frame_idx % 100 == 0:
                    log_file.write(f"帧{frame_idx}: 检测到 {len(persons)} 个人, IOU={max_iou:.3f}, bbox={best_bbox}\n")
            else:
                # IOU 太低或未检测到，使用上一帧的 bbox（但不再扩展）
                fallback_bbox = bboxes[-1] if bboxes else initial_bbox
                bboxes.append(fallback_bbox)  # 直接使用，不再调用 _expand_and_clip_bbox

                if len(persons) == 0:
                    detection_stats['no_detection'] += 1
                else:
                    detection_stats['fallback'] += 1

                if frame_idx % 100 == 0:
                    log_file.write(f"帧{frame_idx}: 使用fallback, 检测到{len(persons)}个人, max_iou={max_iou:.3f}\n")

            frame_idx += 1
            progress = int(frame_idx / total * 45)
            update(progress, 'processing')

        cap.release()

        log_file.write(f"\n检测统计: 成功={detection_stats['detected']}, fallback={detection_stats['fallback']}, 无检测={detection_stats['no_detection']}\n")

        # 平滑 bbox
        bboxes = _smooth_bbox(bboxes)

        # 计算统一的裁剪尺寸（使用95百分位数，避免异常大的bbox影响）
        widths = [x2 - x1 for x1, y1, x2, y2 in bboxes]
        heights = [y2 - y1 for x1, y1, x2, y2 in bboxes]
        max_w = int(np.percentile(widths, 95))
        max_h = int(np.percentile(heights, 95))
        crop_w = int(max_w * 1.2)  # 留20%边距
        crop_h = int(max_h * 1.2)

        log_file.write(f"\n裁剪尺寸计算:\n")
        log_file.write(f"  宽度范围: {min(widths)}-{max(widths)}, 95%={max_w}\n")
        log_file.write(f"  高度范围: {min(heights)}-{max(heights)}, 95%={max_h}\n")
        log_file.write(f"  最终裁剪尺寸: {crop_w}x{crop_h}\n\n")

        # 第二遍：裁剪并写入
        cap = cv2.VideoCapture(input_path)
        frame_idx = 0
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        writer = cv2.VideoWriter(tmp_path, fourcc, fps, (crop_w, crop_h))

        while True:
            ret, frame = cap.read()
            if not ret:
                break

            x1, y1, x2, y2 = bboxes[frame_idx]
            cx, cy = (x1 + x2) // 2, (y1 + y2) // 2

            # 以人物中心为基准，裁剪固定大小区域
            crop_x1 = max(0, cx - crop_w // 2)
            crop_y1 = max(0, cy - crop_h // 2)
            crop_x2 = min(frame_w, crop_x1 + crop_w)
            crop_y2 = min(frame_h, crop_y1 + crop_h)

            # 调整确保尺寸一致
            if crop_x2 - crop_x1 < crop_w:
                crop_x1 = max(0, crop_x2 - crop_w)
            if crop_y2 - crop_y1 < crop_h:
                crop_y1 = max(0, crop_y2 - crop_h)

            cropped = frame[crop_y1:crop_y2, crop_x1:crop_x2]

            if cropped.shape[:2] != (crop_h, crop_w):
                cropped = cv2.resize(cropped, (crop_w, crop_h))

            writer.write(cropped)

            frame_idx += 1
            progress = 45 + int(frame_idx / total * 45)
            update(progress, 'processing')

        cap.release()
        writer.release()

        # 重新编码并保留音频
        update(92, 'processing')
        subprocess.run([
            'ffmpeg', '-y', '-i', tmp_path, '-i', input_path,
            '-map', '0:v', '-map', '1:a?',
            '-c:v', 'libx264', '-preset', 'fast',
            '-crf', '23', '-pix_fmt', 'yuv420p',
            '-movflags', '+faststart',
            '-c:a', 'aac', '-b:a', '128k', output_path,
        ], check=True, capture_output=True)

        if os.path.exists(tmp_path):
            os.remove(tmp_path)

        rel = output_path.replace(os.sep, '/')
        if not rel.startswith('/'):
            rel = '/' + rel
        update(100, 'done', output=rel)

    except Exception as e:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        update(0, 'error', error=str(e))


def _smooth_bbox(bboxes, window_size=5):
    """平滑 bbox 序列，避免抖动"""
    import numpy as np
    if len(bboxes) < window_size:
        return bboxes
    smoothed = []
    for i in range(len(bboxes)):
        start = max(0, i - window_size // 2)
        end = min(len(bboxes), i + window_size // 2 + 1)
        window = bboxes[start:end]
        avg = np.mean(window, axis=0).astype(int)
        smoothed.append(tuple(avg))
    return smoothed


@app.route('/detect_persons', methods=['POST'])
def detect_persons():
    """检测视频多帧中的所有人物（避免首帧漏检）"""
    import cv2
    import base64

    data = request.get_json(force=True)
    filename = data.get('filename', '')

    if not filename or not allowed_file(filename):
        return jsonify({'error': 'Invalid filename'}), 400

    input_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    if not os.path.exists(input_path):
        return jsonify({'error': 'File not found'}), 404

    cap = cv2.VideoCapture(input_path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    # 采样策略：前3秒，每10帧采样一次
    max_sample_frames = min(int(fps * 3), total_frames)
    sample_interval = 10

    net = _load_person_detector()
    all_persons = []  # 收集所有检测到的 bbox

    frame_idx = 0
    while frame_idx < max_sample_frames:
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
        ret, frame = cap.read()
        if not ret:
            break

        persons = _detect_persons_in_frame(frame, net)
        all_persons.extend(persons)
        frame_idx += sample_interval

    cap.release()

    if not all_persons:
        return jsonify({'error': 'No person detected'}), 404

    # 去重：合并IoU > 0.5 的 bbox
    def iou(box1, box2):
        x1 = max(box1[0], box2[0])
        y1 = max(box1[1], box2[1])
        x2 = min(box1[2], box2[2])
        y2 = min(box1[3], box2[3])
        inter = max(0, x2 - x1) * max(0, y2 - y1)
        area1 = (box1[2] - box1[0]) * (box1[3] - box1[1])
        area2 = (box2[2] - box2[0]) * (box2[3] - box2[1])
        return inter / (area1 + area2 - inter + 1e-6)

    unique_persons = []
    for bbox in all_persons:
        merged = False
        for i, existing in enumerate(unique_persons):
            if iou(bbox, existing) > 0.5:
                # 合并：取平均
                unique_persons[i] = [
                    (bbox[0] + existing[0]) / 2,
                    (bbox[1] + existing[1]) / 2,
                    (bbox[2] + existing[2]) / 2,
                    (bbox[3] + existing[3]) / 2
                ]
                merged = True
                break
        if not merged:
            unique_persons.append(bbox)

    # 读取首帧生成缩略图
    cap = cv2.VideoCapture(input_path)
    ret, first_frame = cap.read()
    cap.release()

    if not ret:
        return jsonify({'error': 'Cannot read video for thumbnails'}), 400

    results = []
    for idx, (x1, y1, x2, y2) in enumerate(unique_persons):
        x1, y1, x2, y2 = _expand_and_clip_bbox((int(x1), int(y1), int(x2), int(y2)),
                                                first_frame.shape[1], first_frame.shape[0])
        crop = first_frame[y1:y2, x1:x2]
        if crop.size == 0:
            continue
        _, buffer = cv2.imencode('.jpg', crop)
        thumb_b64 = base64.b64encode(buffer).decode('utf-8')
        results.append({
            'id': idx,
            'bbox': [int(x1), int(y1), int(x2), int(y2)],
            'thumbnail': f'data:image/jpeg;base64,{thumb_b64}'
        })

    if not results:
        return jsonify({'error': 'No valid person crop'}), 404

    return jsonify({'persons': results})

@app.route('/crop_person', methods=['POST'])
def crop_person():
    """裁剪视频中选中的人物"""
    import cv2

    data = request.get_json(force=True)
    filename = data.get('filename', '')
    bbox = data.get('bbox', [])  # [x1, y1, x2, y2]

    if not filename or not allowed_file(filename):
        return jsonify({'error': 'Invalid filename'}), 400
    if len(bbox) != 4:
        return jsonify({'error': 'Invalid bbox'}), 400

    input_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    if not os.path.exists(input_path):
        return jsonify({'error': 'File not found'}), 404

    cap = cv2.VideoCapture(input_path)
    frame_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 0
    frame_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 0
    cap.release()
    if frame_w <= 0 or frame_h <= 0:
        return jsonify({'error': 'Cannot read video size'}), 400

    clipped_bbox = _expand_and_clip_bbox(tuple(bbox), frame_w, frame_h)

    # 生成输出文件名
    out_name = _crop_output_filename(filename, clipped_bbox)
    output_path = os.path.join(app.config['UPLOAD_FOLDER'], out_name)

    # 缓存检查
    if os.path.exists(output_path):
        rel = ('/' + output_path.replace(os.sep, '/')).replace('//', '/')
        return jsonify({'task_id': None, 'cached': True, 'url': rel})

    task_id = str(uuid.uuid4())
    with _tasks_lock:
        _tasks[task_id] = {'progress': 0, 'status': 'processing', 'output': None, 'error': None}

    t = threading.Thread(
        target=_run_crop_person,
        args=(task_id, input_path, output_path, clipped_bbox),
        daemon=True,
    )
    t.start()

    return jsonify({'task_id': task_id, 'cached': False})


@app.route('/crop_person/progress/<task_id>')
def segment_progress(task_id):
    """SSE 端点：推送裁剪进度"""
    def generate():
        while True:
            with _tasks_lock:
                state = _tasks.get(task_id)

            if state is None:
                yield f"data: {json.dumps({'status': 'error', 'error': 'Task not found'})}\n\n"
                break

            yield f"data: {json.dumps(state)}\n\n"

            if state['status'] in ('done', 'error'):
                break

            time.sleep(0.5)

    return Response(generate(), mimetype='text/event-stream',
                    headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})


def _extract_audio_and_align(video1_path, video2_path):
    """提取两个视频的音频并计算时间偏移"""
    import subprocess
    import tempfile
    import numpy as np
    from scipy.io import wavfile
    from scipy.signal import correlate

    try:
        # 提取音频为单声道 WAV
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp1, \
             tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp2:
            wav1, wav2 = tmp1.name, tmp2.name

        for video_path, wav_path in [(video1_path, wav1), (video2_path, wav2)]:
            subprocess.run([
                'ffmpeg', '-y', '-i', video_path,
                '-vn', '-ac', '1', '-ar', '16000', '-f', 'wav', wav_path
            ], check=True, capture_output=True, stderr=subprocess.DEVNULL)

        # 读取音频
        sr1, audio1 = wavfile.read(wav1)
        sr2, audio2 = wavfile.read(wav2)

        if sr1 != sr2:
            return {'error': 'Sample rates do not match'}

        # 归一化
        audio1 = audio1.astype(np.float32) / np.max(np.abs(audio1))
        audio2 = audio2.astype(np.float32) / np.max(np.abs(audio2))

        # 交叉相关
        correlation = correlate(audio1, audio2, mode='full')
        lag = np.argmax(correlation) - len(audio2) + 1
        offset_seconds = lag / sr1

        # 清理临时文件
        os.remove(wav1)
        os.remove(wav2)

        return {'offset': float(offset_seconds)}

    except Exception as e:
        return {'error': str(e)}


@app.route('/align', methods=['POST'])
def align():
    """音频对齐接口"""
    data = request.get_json(force=True)
    coach_file = data.get('coach_filename', '')
    user_file = data.get('user_filename', '')

    if not coach_file or not user_file:
        return jsonify({'error': 'Missing filenames'}), 400

    coach_path = os.path.join(app.config['UPLOAD_FOLDER'], coach_file)
    user_path = os.path.join(app.config['UPLOAD_FOLDER'], user_file)

    if not os.path.exists(coach_path) or not os.path.exists(user_path):
        return jsonify({'error': 'File not found'}), 404

    result = _extract_audio_and_align(coach_path, user_path)

    if 'error' in result:
        return jsonify(result), 500

    return jsonify(result)


if __name__ == '__main__':
    import os
    cert = 'localhost+1.pem'
    key  = 'localhost+1-key.pem'
    if os.path.exists(cert) and os.path.exists(key):
        print("\n  Dance Trainer Web  [HTTPS]")
        print("  https://localhost:5050\n")
        app.run(host='0.0.0.0', port=5050, debug=True, threaded=True,
                ssl_context=(cert, key))
    else:
        print("\n  Dance Trainer Web  [HTTP]")
        print("  http://localhost:5050\n")
        print("  提示：将 localhost+1.pem / localhost+1-key.pem 放在项目根目录可启用 HTTPS")
        app.run(host='0.0.0.0', port=5050, debug=True, threaded=True)
