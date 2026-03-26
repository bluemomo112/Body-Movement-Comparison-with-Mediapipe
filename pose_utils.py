"""
共享姿态检测工具模块
提供骨骼绘制、相似度计算、HUD 绘制等通用功能
"""

import cv2
import numpy as np
import mediapipe as mp

mp_pose = mp.solutions.pose
POSE_CONNECTIONS = mp_pose.POSE_CONNECTIONS


def draw_pose(frame, results):
    """在 frame 上绘制骨骼关键点，跳过面部关键点（0-10）"""
    if not results or not results.pose_landmarks:
        return
    h, w = frame.shape[:2]
    landmarks = results.pose_landmarks.landmark

    for conn in POSE_CONNECTIONS:
        a, b = conn
        if a <= 10 or b <= 10:
            continue
        la, lb = landmarks[a], landmarks[b]
        if la.visibility < 0.5 or lb.visibility < 0.5:
            continue
        x1, y1 = int(la.x * w), int(la.y * h)
        x2, y2 = int(lb.x * w), int(lb.y * h)
        cv2.line(frame, (x1, y1), (x2, y2), (255, 255, 255), 2)

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
    p2 = np.array([(lm.x, lm.y, lm.z) for lm in lm2.landmark]).flatten()
    denom = np.linalg.norm(p1) * np.linalg.norm(p2)
    if denom == 0:
        return None
    return (1 - np.dot(p1, p2) / denom) * 100


def put_text(frame, text, pos, color=(255, 255, 255), scale=0.6, thickness=1):
    """带黑色描边的文字绘制"""
    cv2.putText(frame, text, pos, cv2.FONT_HERSHEY_SIMPLEX,
                scale, (0, 0, 0), thickness + 2)
    cv2.putText(frame, text, pos, cv2.FONT_HERSHEY_SIMPLEX,
                scale, color, thickness)
