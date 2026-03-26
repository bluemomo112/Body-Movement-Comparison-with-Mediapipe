"""
Dance Trainer v2 - 舞蹈动作对比工具（性能优化版）

改进：
1. 左侧教练视频不做姿态检测（大幅提升性能）
2. 支持 ROI 框选（多人场景下选择跟踪目标）
3. 左右视频独立尺寸控制
"""

import cv2
import mediapipe as mp
import numpy as np
import argparse
import sys
import os
import time

from pose_utils import draw_pose, cosine_similarity_error, put_text

# ── 全局变量：ROI 框选 ────────────────────────────────────────────────────
roi_selecting = False
roi_start = None
roi_end = None
roi_rect = None  # (x, y, w, h)

def mouse_callback(event, x, y, flags, param):
    """鼠标回调：拖拽框选 ROI"""
    global roi_selecting, roi_start, roi_end, roi_rect

    if event == cv2.EVENT_LBUTTONDOWN:
        roi_selecting = True
        roi_start = (x, y)
        roi_end = (x, y)

    elif event == cv2.EVENT_MOUSEMOVE and roi_selecting:
        roi_end = (x, y)

    elif event == cv2.EVENT_LBUTTONUP:
        roi_selecting = False
        roi_end = (x, y)
        # 计算矩形
        x1, y1 = roi_start
        x2, y2 = roi_end
        x_min, x_max = min(x1, x2), max(x1, x2)
        y_min, y_max = min(y1, y2), max(y1, y2)
        if x_max - x_min > 20 and y_max - y_min > 20:
            roi_rect = (x_min, y_min, x_max - x_min, y_max - y_min)
            print(f"  ✓ ROI 已设置: {roi_rect}")


# ── MediaPipe 初始化 ─────────────────────────────────────────────────────────
mp_pose    = mp.solutions.pose
mp_drawing = mp.solutions.drawing_utils


def draw_hud(frame, lines, start_y=30, line_h=28):
    """在帧左上角绘制多行文字 HUD"""
    for i, (text, color) in enumerate(lines):
        put_text(frame, text, (10, start_y + i * line_h), color)


def overlay_label(frame, label, color):
    """在帧底部中间绘制大标签"""
    h, w = frame.shape[:2]
    (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 1.1, 2)
    x = (w - tw) // 2
    y = h - 20
    cv2.putText(frame, label, (x, y), cv2.FONT_HERSHEY_SIMPLEX,
                1.1, (0, 0, 0), 4)
    cv2.putText(frame, label, (x, y), cv2.FONT_HERSHEY_SIMPLEX,
                1.1, color, 2)


def make_divider(h, color=(80, 80, 80)):
    """生成一条竖线作为左右分隔"""
    div = np.full((h, 4, 3), color, dtype=np.uint8)
    return div


def main():
    parser = argparse.ArgumentParser(description="Dance Trainer v2")
    parser.add_argument("--video", "-v", default="dance_videos/00.mp4",
                        help="教练视频路径")
    parser.add_argument("--camera", "-c", default="0",
                        help="摄像头设备编号或视频文件路径")

    # 独立尺寸控制
    parser.add_argument("--coach-width", type=int, default=640,
                        help="教练视频宽度（px）")
    parser.add_argument("--coach-height", type=int, default=480,
                        help="教练视频高度（px）")
    parser.add_argument("--user-width", type=int, default=640,
                        help="用户视频宽度（px）")
    parser.add_argument("--user-height", type=int, default=480,
                        help="用户视频高度（px）")

    # 性能选项
    parser.add_argument("--detect-coach", action="store_true",
                        help="是否对教练视频也做姿态检测（默认关闭以提升性能）")

    args = parser.parse_args()

    # ── 打开视频和摄像头 ─────────────────────────────────────────────────────
    if not os.path.exists(args.video):
        print(f"[错误] 找不到教练视频: {args.video}")
        sys.exit(1)

    coach_cap = cv2.VideoCapture(args.video)
    if not coach_cap.isOpened():
        print(f"[错误] 无法打开视频: {args.video}")
        sys.exit(1)

    cam_src = int(args.camera) if args.camera.isdigit() else args.camera
    cam_cap = cv2.VideoCapture(cam_src)
    if not cam_cap.isOpened():
        print("[警告] 无法打开摄像头，将用右侧示例视频演示")
        cam_cap = cv2.VideoCapture("dance_videos/right_dance.mp4")

    total_frames = int(coach_cap.get(cv2.CAP_PROP_FRAME_COUNT))
    coach_fps    = coach_cap.get(cv2.CAP_PROP_FPS) or 30.0
    CW, CH = args.coach_width, args.coach_height
    UW, UH = args.user_width, args.user_height

    print("\n" + "=" * 70)
    print("  🎯 Dance Trainer v2  |  舞蹈动作对比工具（性能优化版）")
    print("=" * 70)
    print(f"  教练视频 : {args.video}")
    print(f"  总帧数   : {total_frames}  |  FPS: {coach_fps:.1f}")
    print(f"  教练尺寸 : {CW}x{CH}  |  用户尺寸: {UW}x{UH}")
    print(f"  教练检测 : {'开启' if args.detect_coach else '关闭（性能优化）'}")
    print("-" * 70)
    print("  键盘控制：")
    print("    Space   暂停 / 继续")
    print("    ,  /  . 后退 / 前进 30 帧")
    print("    [  /  ] 速度减慢 / 加快")
    print("    r       开始 / 停止录制用户画面")
    print("    s       保存当前帧截图")
    print("    o       显示 / 隐藏姿态骨骼")
    print("    x       清除 ROI 框选")
    print("    q / ESC 退出")
    print()
    print("  鼠标操作：")
    print("    在用户画面上拖拽鼠标 → 框选跟踪区域（ROI）")
    print("=" * 70 + "\n")

    # ── 状态变量 ─────────────────────────────────────────────────────────────
    paused        = False
    speed         = 1.0
    show_skeleton = True
    recording     = False
    writer        = None
    frame_idx     = 0

    correct_count = 0
    total_count   = 0
    prev_time     = time.time()

    # 创建窗口并绑定鼠标回调
    window_name = "Dance Trainer v2  |  q=退出  Space=暂停  r=录制  鼠标拖拽=框选ROI"
    cv2.namedWindow(window_name)
    cv2.setMouseCallback(window_name, mouse_callback)

    with mp_pose.Pose(
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5
    ) as pose:

        while True:
            # ── 读取摄像头帧 ──────────────────────────────────────────────────
            ret_cam, cam_frame = cam_cap.read()
            if not ret_cam:
                cam_cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                ret_cam, cam_frame = cam_cap.read()

            # ── 读取教练视频帧 ────────────────────────────────────────────────
            if not paused:
                ret_coach, coach_frame = coach_cap.read()
                if not ret_coach:
                    coach_cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    correct_count = total_count = 0
                    ret_coach, coach_frame = coach_cap.read()
                frame_idx = int(coach_cap.get(cv2.CAP_PROP_POS_FRAMES))
            else:
                coach_cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx - 1)
                ret_coach, coach_frame = coach_cap.read()

            if not ret_coach or coach_frame is None:
                continue

            # ── 缩放到指定尺寸 ────────────────────────────────────────────────
            coach_frame = cv2.resize(coach_frame, (CW, CH))
            cam_frame   = cv2.resize(cam_frame,   (UW, UH))

            # ── ROI 裁剪（如果设置了） ────────────────────────────────────────
            if roi_rect is not None:
                x, y, w, h = roi_rect
                # 确保 ROI 在画面内
                x = max(0, min(x, UW - 1))
                y = max(0, min(y, UH - 1))
                w = min(w, UW - x)
                h = min(h, UH - y)
                cam_roi = cam_frame[y:y+h, x:x+w]
                if cam_roi.size > 0:
                    cam_roi_resized = cv2.resize(cam_roi, (UW, UH))
                    cam_frame_for_pose = cam_roi_resized
                else:
                    cam_frame_for_pose = cam_frame
            else:
                cam_frame_for_pose = cam_frame

            # ── 姿态检测 ──────────────────────────────────────────────────────
            r_coach = None
            if args.detect_coach:
                coach_rgb = cv2.cvtColor(coach_frame, cv2.COLOR_BGR2RGB)
                coach_rgb.flags.writeable = False
                r_coach = pose.process(coach_rgb)
                coach_rgb.flags.writeable = True

            cam_rgb = cv2.cvtColor(cam_frame_for_pose, cv2.COLOR_BGR2RGB)
            cam_rgb.flags.writeable = False
            r_cam = pose.process(cam_rgb)
            cam_rgb.flags.writeable = True

            # ── 绘制骨骼 ──────────────────────────────────────────────────────
            if show_skeleton:
                if args.detect_coach and r_coach:
                    draw_pose(coach_frame, r_coach)
                if r_cam:
                    draw_pose(cam_frame, r_cam)

            # ── 计算相似度误差 ────────────────────────────────────────────────
            error = None
            if args.detect_coach and r_coach and r_cam:
                error = cosine_similarity_error(r_coach.pose_landmarks,
                                                r_cam.pose_landmarks)
                if error is not None and not paused:
                    total_count += 1
                    if error < 30:
                        correct_count += 1

            accuracy = (correct_count / total_count * 100) if total_count > 0 else 0

            # ── 计算显示 FPS ──────────────────────────────────────────────────
            now = time.time()
            fps_display = 1.0 / max(now - prev_time, 1e-6)
            prev_time   = now

            # ── 教练帧 HUD ────────────────────────────────────────────────────
            progress_pct = frame_idx / total_frames * 100 if total_frames > 0 else 0
            coach_hud = [
                (f"[教练]  {frame_idx}/{total_frames}  ({progress_pct:.0f}%)",
                 (200, 200, 200)),
                (f"速度: {speed:.1f}x  {'⏸ 暂停' if paused else '▶ 播放'}",
                 (255, 220, 60) if paused else (100, 255, 100)),
            ]
            draw_hud(coach_frame, coach_hud)

            # ── 用户帧 HUD ────────────────────────────────────────────────────
            cam_hud = [
                (f"[用户]  FPS: {fps_display:.1f}", (200, 200, 200)),
            ]
            if roi_rect:
                cam_hud.append((f"ROI: {roi_rect}", (100, 255, 255)))
            if error is not None:
                err_color = (100, 255, 100) if error < 30 else (60, 60, 255)
                cam_hud.append((f"误差: {error:.1f}%  累计: {accuracy:.1f}%",
                                err_color))
            if recording:
                cam_hud.append(("● 录制中", (0, 0, 255)))
            draw_hud(cam_frame, cam_hud)

            # 底部结果标签
            if error is not None:
                if error < 30:
                    overlay_label(cam_frame, "CORRECT", (0, 220, 0))
                else:
                    overlay_label(cam_frame, "WRONG",   (0, 0, 220))

            # ── 绘制 ROI 框选矩形 ─────────────────────────────────────────────
            if roi_selecting and roi_start and roi_end:
                cv2.rectangle(cam_frame, roi_start, roi_end, (0, 255, 255), 2)
            elif roi_rect:
                x, y, w, h = roi_rect
                cv2.rectangle(cam_frame, (x, y), (x+w, y+h), (0, 255, 0), 2)

            # ── 进度条（教练帧底部） ──────────────────────────────────────────
            bar_y  = CH - 6
            bar_w  = int(CW * frame_idx / total_frames) if total_frames > 0 else 0
            cv2.rectangle(coach_frame, (0, bar_y - 4), (CW, bar_y + 4),
                          (50, 50, 50), -1)
            cv2.rectangle(coach_frame, (0, bar_y - 4), (bar_w, bar_y + 4),
                          (100, 220, 100), -1)

            # ── 拼合左右帧（高度对齐） ────────────────────────────────────────
            max_h = max(CH, UH)
            # 如果高度不同，填充到相同高度
            if CH < max_h:
                pad = np.zeros((max_h - CH, CW, 3), dtype=np.uint8)
                coach_frame = np.vstack([coach_frame, pad])
            if UH < max_h:
                pad = np.zeros((max_h - UH, UW, 3), dtype=np.uint8)
                cam_frame = np.vstack([cam_frame, pad])

            divider  = make_divider(max_h)
            combined = np.hstack([coach_frame, divider, cam_frame])

            # ── 显示 ──────────────────────────────────────────────────────────
            cv2.imshow(window_name, combined)

            # ── 录制 ──────────────────────────────────────────────────────────
            if recording and writer is not None:
                writer.write(cam_frame[:UH, :UW])  # 只录制原始尺寸

            # ── 按键处理 ──────────────────────────────────────────────────────
            wait_ms = max(1, int((1000 / coach_fps) / speed)) if not paused else 50
            key = cv2.waitKey(wait_ms) & 0xFF

            if key in (ord('q'), 27):
                break

            elif key == ord(' '):
                paused = not paused

            elif key == ord(','):
                new_pos = max(0, frame_idx - 30)
                coach_cap.set(cv2.CAP_PROP_POS_FRAMES, new_pos)
                frame_idx = new_pos
                paused = True

            elif key == ord('.'):
                new_pos = min(total_frames - 1, frame_idx + 30)
                coach_cap.set(cv2.CAP_PROP_POS_FRAMES, new_pos)
                frame_idx = new_pos
                paused = True

            elif key == ord('['):
                speed = max(0.25, round(speed - 0.25, 2))
                print(f"  速度 → {speed:.2f}x")

            elif key == ord(']'):
                speed = min(4.0, round(speed + 0.25, 2))
                print(f"  速度 → {speed:.2f}x")

            elif key == ord('o'):
                show_skeleton = not show_skeleton
                print(f"  骨骼显示: {'开' if show_skeleton else '关'}")

            elif key == ord('x'):
                roi_rect = None
                print("  ROI 已清除")

            elif key == ord('r'):
                if not recording:
                    ts    = time.strftime("%Y%m%d_%H%M%S")
                    fname = f"recording_{ts}.mp4"
                    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
                    writer = cv2.VideoWriter(fname, fourcc, coach_fps, (UW, UH))
                    recording = True
                    print(f"  ● 开始录制 → {fname}")
                else:
                    recording = False
                    writer.release()
                    writer = None
                    print("  ■ 录制已保存")

            elif key == ord('s'):
                ts    = time.strftime("%Y%m%d_%H%M%S")
                fname = f"screenshot_{ts}.png"
                cv2.imwrite(fname, combined)
                print(f"  📷 截图已保存 → {fname}")

    # ── 清理 ──────────────────────────────────────────────────────────────────
    if recording and writer is not None:
        writer.release()
    coach_cap.release()
    cam_cap.release()
    cv2.destroyAllWindows()
    print("\n[已退出] 感谢使用 Dance Trainer v2 👋\n")


if __name__ == "__main__":
    main()
