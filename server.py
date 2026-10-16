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
_cancelled = set()  # 已请求取消的 task_id，由进度回调检查并中断
_mask_jobs = {}  # output_path -> task_id，避免同一蒙版重复生成


class TaskCancelled(Exception):
    pass


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


def _crop_output_filename(filename, role_id):
    """生成裁剪输出文件名，避免不同角色互相覆盖缓存"""
    name, _ = os.path.splitext(filename)
    return f"{name}_role{int(role_id)}.mp4"

def _run_crop_person(task_id, input_path, output_path, role_id):
    """后台线程：按追踪结果裁剪选中的角色"""
    import cv2
    import numpy as np
    import subprocess
    from person_tracker import track_video, dense_boxes

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

        cap = cv2.VideoCapture(input_path)
        if not cap.isOpened():
            update(0, 'error', error='无法打开视频文件')
            return

        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        frame_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 0
        frame_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 0
        cap.release()

        # 追踪结果（detect_persons 已生成缓存时直接读取）
        tracks = track_video(input_path, on_progress=lambda p: update(int(p * 0.45), 'processing'))
        role = next((r for r in tracks['roles'] if r['id'] == role_id), None)
        if role is None:
            update(0, 'error', error=f'角色 {role_id} 不存在')
            return

        # 初始化日志
        log_file = open(log_path, 'w', encoding='utf-8')
        log_file.write(f"=== 裁剪任务日志 ===\n")
        log_file.write(f"输入视频: {input_path}\n")
        log_file.write(f"视频尺寸: {frame_w}x{frame_h}, FPS: {fps}, 总帧数: {total}\n")
        log_file.write(f"角色: {role_id}, 追踪覆盖帧数: {len(role['boxes'])}/{tracks['frame_count']}\n\n")
        print(f"[crop] _run_crop_person: role_id={role_id}, "
              f"coverage={len(role['boxes'])}/{tracks['frame_count']}")

        # 缺失帧插值，扩边后平滑
        bboxes = [_expand_and_clip_bbox(b, frame_w, frame_h)
                  for b in dense_boxes(role, tracks['frame_count'])]
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

            x1, y1, x2, y2 = bboxes[min(frame_idx, len(bboxes) - 1)]
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


_track_jobs = {}  # input_path -> task_id，避免同一视频重复追踪


def _run_track(task_id, input_path):
    """后台线程：追踪整段视频并写缓存"""
    from person_tracker import track_video

    def update(progress, status, output=None, error=None):
        with _tasks_lock:
            _tasks[task_id] = {'progress': progress, 'status': status,
                               'output': output, 'error': error}

    try:
        track_video(input_path, on_progress=lambda p: update(p, 'processing'))
        update(100, 'done', output='tracked')
    except Exception as e:
        print(f"[detect] _run_track: error={e}")
        update(0, 'error', error=str(e))
    finally:
        with _tasks_lock:
            _track_jobs.pop(input_path, None)


def _persons_from_tracks(input_path, tracks):
    """为每个角色生成缩略图：取同时出现角色最多的第一帧"""
    import cv2
    import base64
    from person_tracker import dense_boxes

    present = {}
    for r in tracks['roles']:
        for b in r['boxes']:
            present[b[0]] = present.get(b[0], 0) + 1
    thumb_frame = max(sorted(present), key=lambda f: present[f]) if present else 0

    cap = cv2.VideoCapture(input_path)
    cap.set(cv2.CAP_PROP_POS_FRAMES, thumb_frame)
    ret, frame = cap.read()
    cap.release()
    if not ret:
        return []

    persons = []
    for r in tracks['roles']:
        box = dense_boxes(r, tracks['frame_count'])[thumb_frame]
        x1, y1, x2, y2 = _expand_and_clip_bbox(box, frame.shape[1], frame.shape[0])
        _, buffer = cv2.imencode('.jpg', frame[y1:y2, x1:x2])
        persons.append({
            'id': r['id'],
            'bbox': [x1, y1, x2, y2],
            'thumbnail': 'data:image/jpeg;base64,' + base64.b64encode(buffer).decode('utf-8'),
        })
    print(f"[detect] _persons_from_tracks: thumb_frame={thumb_frame}, persons={len(persons)}")
    return persons


@app.route('/detect_persons', methods=['POST'])
def detect_persons():
    """
    追踪视频中所有角色。未缓存时返回 {task_id}，前端等任务完成后再请求一次；
    已缓存时返回 {persons, tracks}
    """
    data = request.get_json(force=True)
    filename = data.get('filename', '')

    if not filename or not allowed_file(filename):
        return jsonify({'error': 'Invalid filename'}), 400

    input_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    if not os.path.exists(input_path):
        return jsonify({'error': 'File not found'}), 404

    if not os.path.exists(input_path + '.tracks.json'):
        with _tasks_lock:
            task_id = _track_jobs.get(input_path)
            if task_id is None:
                task_id = str(uuid.uuid4())
                _track_jobs[input_path] = task_id
                _tasks[task_id] = {'progress': 0, 'status': 'processing', 'output': None, 'error': None}
                threading.Thread(target=_run_track, args=(task_id, input_path), daemon=True).start()
        print(f"[detect] detect_persons: filename={filename}, tracking task_id={task_id}")
        return jsonify({'task_id': task_id})

    from person_tracker import track_video
    tracks = track_video(input_path)
    if not tracks['roles']:
        return jsonify({'error': 'No person detected'}), 404

    persons = _persons_from_tracks(input_path, tracks)
    return jsonify({'persons': persons, 'tracks': tracks})


@app.route('/crop_person', methods=['POST'])
def crop_person():
    """裁剪视频中选中的角色"""
    data = request.get_json(force=True)
    filename = data.get('filename', '')
    role_id = data.get('role_id')

    if not filename or not allowed_file(filename):
        return jsonify({'error': 'Invalid filename'}), 400
    if not isinstance(role_id, int):
        return jsonify({'error': 'Invalid role_id'}), 400

    input_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    if not os.path.exists(input_path):
        return jsonify({'error': 'File not found'}), 404

    # 生成输出文件名
    out_name = _crop_output_filename(filename, role_id)
    output_path = os.path.join(app.config['UPLOAD_FOLDER'], out_name)

    # 缓存检查
    if os.path.exists(output_path):
        rel = ('/' + output_path.replace(os.sep, '/')).replace('//', '/')
        return jsonify({'task_id': None, 'cached': True, 'url': rel})

    task_id = str(uuid.uuid4())
    with _tasks_lock:
        _tasks[task_id] = {'progress': 0, 'status': 'processing', 'output': None, 'error': None}

    print(f"[crop] crop_person: filename={filename}, role_id={role_id}, task_id={task_id}")
    t = threading.Thread(
        target=_run_crop_person,
        args=(task_id, input_path, output_path, role_id),
        daemon=True,
    )
    t.start()

    return jsonify({'task_id': task_id, 'cached': False})


def _run_mask(task_id, input_path, output_path, role_id):
    """后台线程：生成角色蒙版视频（role_id=0 表示全部角色）"""
    import subprocess
    from person_tracker import track_video, render_mask

    def update(progress, status, output=None, error=None):
        with _tasks_lock:
            if status == 'processing' and task_id in _cancelled:
                raise TaskCancelled()
            _tasks[task_id] = {'progress': progress, 'status': status,
                               'output': output, 'error': error}

    tmp_path = output_path + '.tmp.mp4'
    try:
        tracks = track_video(input_path, on_progress=lambda p: update(int(p * 0.3), 'processing'))
        role_ids = [r['id'] for r in tracks['roles']] if role_id == 0 else [role_id]
        if not any(r['id'] in role_ids for r in tracks['roles']):
            update(0, 'error', error=f'角色 {role_id} 不存在')
            return
        render_mask(input_path, tmp_path, tracks, role_ids,
                    on_progress=lambda p: update(30 + int(p * 0.65), 'processing'))
        update(96, 'processing')
        subprocess.run([
            'ffmpeg', '-y', '-i', tmp_path, '-c:v', 'libx264', '-preset', 'fast',
            '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output_path,
        ], check=True, capture_output=True)
        rel = '/' + output_path.replace(os.sep, '/')
        print(f"[mask] _run_mask: done output={rel}")
        update(100, 'done', output=rel)
    except TaskCancelled:
        print(f"[mask] _run_mask: cancelled task_id={task_id}")
        with _tasks_lock:
            _tasks[task_id] = {'progress': 0, 'status': 'error', 'output': None, 'error': '已取消'}
    except Exception as e:
        print(f"[mask] _run_mask: error={e}")
        update(0, 'error', error=str(e))
    finally:
        with _tasks_lock:
            _mask_jobs.pop(output_path, None)
            _cancelled.discard(task_id)
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


@app.route('/mask_person', methods=['POST'])
def mask_person():
    """生成黑底白人蒙版视频。role_id=0 表示全部角色"""
    data = request.get_json(force=True)
    filename = data.get('filename', '')
    role_id = data.get('role_id')

    if not filename or not allowed_file(filename):
        return jsonify({'error': 'Invalid filename'}), 400
    if not isinstance(role_id, int) or role_id < 0:
        return jsonify({'error': 'Invalid role_id'}), 400

    input_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    if not os.path.exists(input_path):
        return jsonify({'error': 'File not found'}), 404

    name, _ = os.path.splitext(filename)
    tag = 'all' if role_id == 0 else f'role{role_id}'
    output_path = os.path.join(app.config['UPLOAD_FOLDER'], f"{name}_mask_{tag}.mp4")

    if os.path.exists(output_path):
        return jsonify({'task_id': None, 'cached': True, 'url': '/' + output_path.replace(os.sep, '/')})

    with _tasks_lock:
        if output_path in _mask_jobs:
            return jsonify({'task_id': _mask_jobs[output_path], 'cached': False})
        task_id = str(uuid.uuid4())
        _mask_jobs[output_path] = task_id
        _tasks[task_id] = {'progress': 0, 'status': 'processing', 'output': None, 'error': None}
    print(f"[mask] mask_person: filename={filename}, role_id={role_id}, task_id={task_id}")
    threading.Thread(target=_run_mask, args=(task_id, input_path, output_path, role_id),
                     daemon=True).start()
    return jsonify({'task_id': task_id, 'cached': False})


@app.route('/cancel/<task_id>', methods=['POST'])
def cancel_task(task_id):
    """请求取消蒙版任务，线程在下一次进度回调时中断"""
    with _tasks_lock:
        state = _tasks.get(task_id)
        if state is None or state['status'] != 'processing':
            return jsonify({'cancelled': False})
        _cancelled.add(task_id)
    print(f"[mask] cancel_task: task_id={task_id}")
    return jsonify({'cancelled': True})


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
