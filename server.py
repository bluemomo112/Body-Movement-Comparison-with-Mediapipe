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


# ── 分割相关 ──────────────────────────────────────────────────────────────────

def _output_filename(filename, bg_color):
    """生成分割输出文件名"""
    name, _ = os.path.splitext(filename)
    suffix = 'white' if bg_color == 'white' else 'black'
    return f"{name}_seg_{suffix}.mp4"


def _postprocess_mask(mask_bin, kernel_size=5, blur_size=11):
    """形态学后处理 + 边缘模糊，提升 mask 质量"""
    import cv2
    import numpy as np
    # 闭操作填补空洞
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_size, kernel_size))
    mask_clean = cv2.morphologyEx(mask_bin, cv2.MORPH_CLOSE, kernel, iterations=2)
    # 开操作去除噪点
    mask_clean = cv2.morphologyEx(mask_clean, cv2.MORPH_OPEN, kernel, iterations=1)
    # 高斯模糊平滑边缘
    mask_blur = cv2.GaussianBlur(
        mask_clean.astype(np.float32), (blur_size, blur_size), 0
    )
    return mask_blur[:, :, np.newaxis]


def _seg_frame_rembg(frame_rgb, session):
    """用 rembg 分割单帧，返回 0/1 二值 mask"""
    import numpy as np
    from rembg import remove
    # rembg 返回 RGBA，alpha 通道即为 mask
    rgba = remove(frame_rgb, session=session, only_mask=False,
                  bgcolor=None, alpha_matting=False)
    alpha = rgba[:, :, 3].astype(np.float32) / 255.0
    mask_bin = (alpha > 0.5).astype(np.uint8)
    return mask_bin


def _seg_frame_mediapipe(frame_rgb, pose, segmenter, w, h):
    """MediaPipe fallback 分割，返回 0/1 二值 mask"""
    import cv2
    import numpy as np
    pose_result = pose.process(frame_rgb)
    seg_result = segmenter.process(frame_rgb)
    mask = seg_result.segmentation_mask  # float32 0~1

    # 用 pose bounding box 限制 mask，只保留主要人物
    if pose_result.pose_landmarks:
        lms = pose_result.pose_landmarks.landmark
        xs = [lm.x for lm in lms]
        ys = [lm.y for lm in lms]
        pad = 0.15
        x_min = max(0, int((min(xs) - pad) * w))
        x_max = min(w, int((max(xs) + pad) * w))
        y_min = max(0, int((min(ys) - pad) * h))
        y_max = min(h, int((max(ys) + pad) * h))
        region = np.zeros((h, w), dtype=np.float32)
        region[y_min:y_max, x_min:x_max] = 1.0
        mask = mask * region

    mask_bin = (mask > 0.3).astype(np.uint8)
    return mask_bin


def _run_segmentation(task_id, input_path, output_path, bg_color_tuple):
    """后台线程：逐帧分割并写出新视频（rembg 优先，MediaPipe fallback）"""
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

    # Write to a temp file first, then re-encode to H.264 for browser compat
    tmp_path = output_path + '.tmp.mp4'

    try:
        update(0, 'processing')

        # 尝试加载 rembg
        use_rembg = False
        rembg_session = None
        try:
            from rembg import new_session
            rembg_session = new_session(model_name="u2net")
            use_rembg = True
            print("[seg] 使用 rembg (U2-Net) 高精度分割")
        except Exception as e:
            print(f"[seg] rembg 不可用 ({e})，回退到 MediaPipe")

        cap = cv2.VideoCapture(input_path)
        if not cap.isOpened():
            update(0, 'error', error='无法打开视频文件')
            return

        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        writer = cv2.VideoWriter(tmp_path, fourcc, fps, (w, h))

        bg = np.full((h, w, 3), bg_color_tuple, dtype=np.uint8)

        # MediaPipe fallback context
        import mediapipe as mp
        mp_pose = mp.solutions.pose
        mp_seg = mp.solutions.selfie_segmentation

        with mp_pose.Pose(
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
            model_complexity=1,
        ) as pose, mp_seg.SelfieSegmentation(model_selection=0) as segmenter:

            frame_idx = 0
            while True:
                ret, frame = cap.read()
                if not ret:
                    break

                frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

                if use_rembg:
                    mask_bin = _seg_frame_rembg(frame_rgb, rembg_session)
                else:
                    mask_bin = _seg_frame_mediapipe(frame_rgb, pose, segmenter, w, h)

                # 后处理：形态学 + 边缘模糊
                mask_blur = _postprocess_mask(mask_bin)

                # 合成：人物保留，背景替换
                out_rgb = (frame_rgb * mask_blur + bg * (1 - mask_blur)).astype(np.uint8)
                out_bgr = cv2.cvtColor(out_rgb, cv2.COLOR_RGB2BGR)
                writer.write(out_bgr)

                frame_idx += 1
                # Reserve 0-95% for frame processing, 95-100% for ffmpeg
                progress = int(frame_idx / total * 95)
                update(progress, 'processing')

        cap.release()
        writer.release()

        # Re-encode to H.264 for browser compatibility
        update(96, 'processing')
        try:
            subprocess.run([
                'ffmpeg', '-y', '-i', tmp_path,
                '-c:v', 'libx264', '-preset', 'fast',
                '-crf', '23', '-pix_fmt', 'yuv420p',
                '-movflags', '+faststart',
                '-c:a', 'aac', '-b:a', '128k', output_path,
            ], check=True, capture_output=True)
        finally:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)

        # 生成可访问 URL
        rel = output_path.replace(os.sep, '/')
        if not rel.startswith('/'):
            rel = '/' + rel
        update(100, 'done', output=rel)

    except Exception as e:
        # Clean up temp file on error
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        with _tasks_lock:
            _tasks[task_id] = {
                'progress': 0,
                'status': 'error',
                'output': None,
                'error': str(e),
            }


@app.route('/segment', methods=['POST'])
def segment():
    data = request.get_json(force=True)
    filename = data.get('filename', '')
    bg = data.get('bg_color', 'white')  # 'white' | 'black'

    if not filename or not allowed_file(filename):
        return jsonify({'error': 'Invalid filename'}), 400

    input_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    if not os.path.exists(input_path):
        return jsonify({'error': 'File not found'}), 404

    out_name = _output_filename(filename, bg)
    output_path = os.path.join(app.config['UPLOAD_FOLDER'], out_name)

    # 缓存命中：直接返回已有结果
    if os.path.exists(output_path):
        rel = ('/' + output_path.replace(os.sep, '/')).replace('//', '/')
        return jsonify({'task_id': None, 'cached': True, 'url': rel})

    task_id = str(uuid.uuid4())
    bg_tuple = (255, 255, 255) if bg == 'white' else (0, 0, 0)

    with _tasks_lock:
        _tasks[task_id] = {'progress': 0, 'status': 'processing', 'output': None, 'error': None}

    t = threading.Thread(
        target=_run_segmentation,
        args=(task_id, input_path, output_path, bg_tuple),
        daemon=True,
    )
    t.start()

    return jsonify({'task_id': task_id, 'cached': False})


@app.route('/segment/progress/<task_id>')
def segment_progress(task_id):
    """SSE 端点：推送分割进度"""
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


if __name__ == '__main__':
    print("\n  Dance Trainer Web")
    print("  http://localhost:5050\n")
    app.run(host='0.0.0.0', port=5050, debug=True, threaded=True)
