"""
Dance Trainer - 舞蹈动作对比工具
左侧：教练视频（支持暂停、慢放、跳帧）
右侧：实时摄像头（支持录制片段）
按键说明见启动时打印的帮助信息
"""

import cv2
import mediapipe as mp
import numpy as np
import argparse
import sys
import os
import time

# ── MediaPipe 初始化 ─────────────────────────────────────────────────────────
mp_pose    = mp.solutions.pose
mp_drawing = mp.solutions.drawing_utils
mp_styles  = mp.solutions.drawing_styles


def draw_pose(frame, results):
    """在 frame 上绘制骨骼关键点，跳过面部关键点（0-10）"""
    if not results.pose_landmarks:
        return
    h, w = frame.shape[:2]
    landmarks = results.pose_landmarks.landmark

    # 只画身体连接线（排除面部）
    for conn in mp_pose.POSE_CONNECTIONS:
        a, b = conn
        if a <= 10 or b <= 10:
            continue
        la, lb = landmarks[a], landmarks[b]
        if la.visibility < 0.5 or lb.visibility < 0.5:
            continue
        x1, y1 = int(la.x * w), int(la.y * h)
        x2, y2 = int(lb.x * w), int(lb.y * h)
        cv2.line(frame, (x1, y1), (x2, y2), (255, 255, 255), 2)

    # 关键点圆点
    for idx, lm in enumerate(landmarks):
        if idx <= 10 or lm.visibility < 0.5:
            continue
        cx, cy = int(lm.x * w), int(lm.y * h)
        cv2.circle(frame, (cx, cy), 5, (0, 200, 255), -1)


def cosine_similarity_error(lm1, lm2):
    """计算两组姿态关键点的余弦误差（0~100%）"""
    if lm1 is None or lm2 is None:
        return None
    p1 = np.array([(lm.x, lm.y, lm.z) for lm in lm1.landmark]).flatten()
    p2 = np.array([(lm.x, lm.y, lm2.landmark[i].z)
                   for i, lm in enumerate(lm2.landmark)]).flatten()
    denom = np.linalg.norm(p1) * np.linalg.norm(p2)
    if denom == 0:
        return None
    return (1 - np.dot(p1, p2) / denom) * 100


def put_text(frame, text, pos, color=(255, 255, 255), scale=0.6, thickness=1):
    cv2.putText(frame, text, pos, cv2.FONT_HERSHEY_SIMPLEX,
                scale, (0, 0, 0), thickness + 2)  # 黑色描边
    cv2.putText(frame, text, pos, cv2.FONT_HERSHEY_SIMPLEX,
                scale, color, thickness)


def draw_hud(frame, lines, start_y=30, line_h=28):
    """在帧左上角绘制多行文字 HUD"""
    for i, (text, color) in enumerate(lines):
        put_text(frame, text, (10, start_y + i * line_h), color)


def overlay_label(frame, label, color):
    """在帧底部中间绘制大标签（CORRECT / WRONG）"""
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
    parser = argparse.ArgumentParser(description="Dance Trainer")
    parser.add_argument("--video", "-v", default="dance_videos/benchmark_dance.mp4",
                        help="教练视频路径")
    parser.add_argument("--camera", "-c", default="0",
                        help="摄像头设备编号（默认 0）或视频文件路径")
    parser.add_argument("--width", "-W", type=int, default=640,
                        help="每侧画面宽度（px），默认 640")
    parser.add_argument("--height", "-H", type=int, default=480,
                        help="每侧画面高度（px），默认 480")
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
    W, H         = args.width, args.height

    print("\n" + "=" * 58)
    print("  🎯 Dance Trainer  |  舞蹈动作对比工具")
    print("=" * 58)
    print(f"  教练视频 : {args.video}")
    print(f"  总帧数   : {total_frames}  |  FPS: {coach_fps:.1f}")
    print(f"  画面尺寸 : {W}x{H} (每侧)")
    print("-" * 58)
    print("  键盘控制：")
    print("    Space   暂停 / 继续")
    print("    ,  /  . 后退 / 前进 30 帧")
    print("    [  /  ] 速度减慢 / 加快")
    print("    r       开始 / 停止录制用户画面")
    print("    s       保存当前帧截图")
    print("    o       显示 / 隐藏姿态骨骼")
    print("    q / ESC 退出")
    print("=" * 58 + "\n")

    # ── 状态变量 ─────────────────────────────────────────────────────────────
    paused        = False
    speed         = 1.0        # 播放速度倍率
    show_skeleton = True
    recording     = False
    writer        = None
    frame_idx     = 0

    correct_count = 0
    total_count   = 0

    prev_time     = time.time()

    with mp_pose.Pose(
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5
    ) as pose:

        while True:
            # ── 读取摄像头帧（始终读取保持缓冲区新鲜） ───────────────────────
            ret_cam, cam_frame = cam_cap.read()
            if not ret_cam:
                # 摄像头断流或演示视频结尾，循环
                cam_cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                ret_cam, cam_frame = cam_cap.read()

            # ── 读取教练视频帧 ────────────────────────────────────────────────
            if not paused:
                ret_coach, coach_frame = coach_cap.read()
                if not ret_coach:
                    # 视频结尾，循环播放
                    coach_cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    correct_count = total_count = 0
                    ret_coach, coach_frame = coach_cap.read()
                frame_idx = int(coach_cap.get(cv2.CAP_PROP_POS_FRAMES))
            else:
                # 暂停时保持最后一帧（重新 seek 到当前位置读一帧）
                coach_cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx - 1)
                ret_coach, coach_frame = coach_cap.read()

            if not ret_coach or coach_frame is None:
                continue

            # ── 缩放到统一尺寸 ────────────────────────────────────────────────
            coach_frame = cv2.resize(coach_frame, (W, H))
            cam_frame   = cv2.resize(cam_frame,   (W, H))

            # ── 姿态检测 ──────────────────────────────────────────────────────
            coach_rgb = cv2.cvtColor(coach_frame, cv2.COLOR_BGR2RGB)
            cam_rgb   = cv2.cvtColor(cam_frame,   cv2.COLOR_BGR2RGB)

            coach_rgb.flags.writeable = False
            cam_rgb.flags.writeable   = False
            r_coach = pose.process(coach_rgb)
            r_cam   = pose.process(cam_rgb)
            coach_rgb.flags.writeable = True
            cam_rgb.flags.writeable   = True

            # ── 绘制骨骼 ──────────────────────────────────────────────────────
            if show_skeleton:
                draw_pose(coach_frame, r_coach)
                draw_pose(cam_frame,   r_cam)

            # ── 计算相似度误差 ────────────────────────────────────────────────
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
            if error is not None:
                err_color = (100, 255, 100) if error < 30 else (60, 60, 255)
                cam_hud.append((f"误差: {error:.1f}%  累计准确: {accuracy:.1f}%",
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

            # ── 进度条（教练帧底部） ──────────────────────────────────────────
            bar_y  = H - 6
            bar_w  = int(W * frame_idx / total_frames) if total_frames > 0 else 0
            cv2.rectangle(coach_frame, (0, bar_y - 4), (W, bar_y + 4),
                          (50, 50, 50), -1)
            cv2.rectangle(coach_frame, (0, bar_y - 4), (bar_w, bar_y + 4),
                          (100, 220, 100), -1)

            # ── 拼合左右帧 ────────────────────────────────────────────────────
            divider     = make_divider(H)
            combined    = np.hstack([coach_frame, divider, cam_frame])

            # ── 显示 ──────────────────────────────────────────────────────────
            cv2.imshow("Dance Trainer  |  q=退出  Space=暂停  r=录制", combined)

            # ── 录制 ──────────────────────────────────────────────────────────
            if recording and writer is not None:
                writer.write(cam_frame)

            # ── 按键处理 ──────────────────────────────────────────────────────
            # 根据播放速度计算等待时间（最低 1ms，暂停时 50ms）
            wait_ms = max(1, int((1000 / coach_fps) / speed)) if not paused else 50
            key = cv2.waitKey(wait_ms) & 0xFF

            if key in (ord('q'), 27):          # q / ESC → 退出
                break

            elif key == ord(' '):              # Space → 暂停 / 继续
                paused = not paused

            elif key == ord(','):              # , → 后退 30 帧
                new_pos = max(0, frame_idx - 30)
                coach_cap.set(cv2.CAP_PROP_POS_FRAMES, new_pos)
                frame_idx = new_pos
                paused = True

            elif key == ord('.'):              # . → 前进 30 帧
                new_pos = min(total_frames - 1, frame_idx + 30)
                coach_cap.set(cv2.CAP_PROP_POS_FRAMES, new_pos)
                frame_idx = new_pos
                paused = True

            elif key == ord('['):              # [ → 减速
                speed = max(0.25, round(speed - 0.25, 2))
                print(f"  速度 → {speed:.2f}x")

            elif key == ord(']'):              # ] → 加速
                speed = min(4.0, round(speed + 0.25, 2))
                print(f"  速度 → {speed:.2f}x")

            elif key == ord('o'):              # o → 切换骨骼显示
                show_skeleton = not show_skeleton
                print(f"  骨骼显示: {'开' if show_skeleton else '关'}")

            elif key == ord('r'):              # r → 开始 / 停止录制
                if not recording:
                    ts    = time.strftime("%Y%m%d_%H%M%S")
                    fname = f"recording_{ts}.mp4"
                    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
                    writer = cv2.VideoWriter(fname, fourcc, coach_fps, (W, H))
                    recording = True
                    print(f"  ● 开始录制 → {fname}")
                else:
                    recording = False
                    writer.release()
                    writer = None
                    print("  ■ 录制已保存")

            elif key == ord('s'):              # s → 截图
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
    print("\n[已退出] 感谢使用 Dance Trainer 👋\n")


if __name__ == "__main__":
    main()
