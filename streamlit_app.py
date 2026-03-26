import streamlit as st
import mediapipe as mp
import cv2
import numpy as np
import tempfile

from pose_utils import cosine_similarity_error

# Initialize MediaPipe pose detection
mp_pose = mp.solutions.pose
mp_drawing = mp.solutions.drawing_utils
pose = mp_pose.Pose(static_image_mode=False)

# Initialize MediaPipe selfie segmentation
mp_selfie_seg = mp.solutions.selfie_segmentation
segmenter = mp_selfie_seg.SelfieSegmentation(model_selection=1)


def apply_person_segmentation(frame_rgb, pose_landmarks, bg_color=(255, 255, 255)):
    """
    用 selfie_segmentation 分割人物，背景替换为 bg_color。
    如果有 pose_landmarks，则用关键点 bounding box 限定区域，
    确保只保留被 Pose 检测到的那一个人。
    """
    seg_result = segmenter.process(frame_rgb)
    mask = seg_result.segmentation_mask  # float32, 0~1

    h, w = frame_rgb.shape[:2]

    # 如果有 pose landmarks，用 bounding box 限制 mask 范围
    if pose_landmarks:
        xs = [lm.x for lm in pose_landmarks.landmark]
        ys = [lm.y for lm in pose_landmarks.landmark]
        pad = 0.08  # 边缘留一点余量
        x_min = max(0, int((min(xs) - pad) * w))
        x_max = min(w, int((max(xs) + pad) * w))
        y_min = max(0, int((min(ys) - pad) * h))
        y_max = min(h, int((max(ys) + pad) * h))

        # 在 bounding box 外部将 mask 置 0
        region_mask = np.zeros((h, w), dtype=np.float32)
        region_mask[y_min:y_max, x_min:x_max] = 1.0
        mask = mask * region_mask

    # 二值化 mask（阈值 0.5）并做轻微模糊使边缘平滑
    mask_bin = (mask > 0.5).astype(np.uint8)
    mask_blur = cv2.GaussianBlur(mask_bin.astype(np.float32), (7, 7), 0)

    bg = np.full_like(frame_rgb, bg_color, dtype=np.uint8)
    alpha = mask_blur[:, :, np.newaxis]
    result = (frame_rgb * alpha + bg * (1 - alpha)).astype(np.uint8)
    return result

# Streamlit layout
st.title("AI Dance Trainer")

with st.sidebar:
    st.header("Video Upload")
    benchmark_video_file = st.file_uploader("Upload a benchmark video", type=["mp4", "mov", "avi", "mkv"], key="benchmark")
    uploaded_video = st.file_uploader("Upload your video", type=["mp4", "mov", "avi", "mkv"], key="user_video")

    st.header("Person Segmentation")
    seg_benchmark = st.checkbox("基准视频人物分割", value=False)
    seg_user = st.checkbox("用户视频人物分割", value=False)
    bg_color = (255, 255, 255)
    if seg_benchmark or seg_user:
        bg_choice = st.radio("背景颜色", ["白色", "黑色"], horizontal=True)
        bg_color = (255, 255, 255) if bg_choice == "白色" else (0, 0, 0)

if 'playing' not in st.session_state:
    st.session_state.playing = False

if not st.session_state.playing:
    if st.button('Start'):
        st.session_state.playing = True
else:
    if st.button('Clear'):
        st.session_state.playing = False

@st.cache_data
def save_uploaded_file(uploaded_file):
    if uploaded_file is not None:
        with tempfile.NamedTemporaryFile(delete=False, suffix='.' + uploaded_file.name.split('.')[-1]) as tmp_file:
            tmp_file.write(uploaded_file.getvalue())
            return tmp_file.name
    return None

if st.session_state.playing and benchmark_video_file and uploaded_video:
    temp_file_path_benchmark = save_uploaded_file(benchmark_video_file)
    temp_file_path_user = save_uploaded_file(uploaded_video)
    cap_benchmark = cv2.VideoCapture(temp_file_path_benchmark)
    cap_user = cv2.VideoCapture(temp_file_path_user)

    if not cap_benchmark.isOpened() or not cap_user.isOpened():
        st.error("Failed to open video streams. Please check the video files.")
        st.session_state.playing = False
    else:
        col1, col2, col3 = st.columns([1, 1, 1])
        benchmark_video_placeholder = col1.empty()
        user_video_placeholder = col2.empty()
        stats_placeholder = col3.empty()

        correct_steps = 0
        total_frames = 0
        frame_skip_rate = 1  # Process every n'th frame

        while st.session_state.playing:
            for _ in range(frame_skip_rate):
                cap_benchmark.read()
                cap_user.read()

            ret_benchmark, frame_benchmark = cap_benchmark.read()
            ret_user, frame_user = cap_user.read()

            if not ret_benchmark or not ret_user:
                break

            total_frames += 1

            image_benchmark = cv2.cvtColor(frame_benchmark, cv2.COLOR_BGR2RGB)
            image_user = cv2.cvtColor(frame_user, cv2.COLOR_BGR2RGB)

            results_user = pose.process(image_user)
            results_benchmark = pose.process(image_benchmark)

            # Apply person segmentation if enabled
            if seg_benchmark:
                image_benchmark = apply_person_segmentation(
                    image_benchmark,
                    results_benchmark.pose_landmarks,
                    bg_color
                )
            if seg_user:
                image_user = apply_person_segmentation(
                    image_user,
                    results_user.pose_landmarks,
                    bg_color
                )

            if results_user.pose_landmarks:
                mp_drawing.draw_landmarks(image_user, results_user.pose_landmarks, mp_pose.POSE_CONNECTIONS)

            benchmark_video_placeholder.image(image_benchmark, channels="RGB", use_column_width=True)
            user_video_placeholder.image(image_user, channels="BGR", use_column_width=True)

            error = cosine_similarity_error(results_user.pose_landmarks, results_benchmark.pose_landmarks)
            if error is None:
                error = 100
            correct_step = error < 30
            correct_steps += correct_step

            stats = f"""
                Frame Error: {error:.2f}%\n
                Step: {'CORRECT STEP' if correct_step else 'WRONG STEP'}\n
                Cumulative Accuracy: {(correct_steps / total_frames) * 100:.2f}%
            """
            stats_placeholder.markdown(stats)

        cap_benchmark.release()
        cap_user.release()
