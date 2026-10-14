"""
跨帧人物追踪：YOLO 检测 + BoT-SORT(ReID) 关联 + 离线轨迹缝合
输出固定数量的角色，每个角色 ID 全程不变
"""
import os
import json
import collections

import numpy as np

MODEL_PATH = os.path.join('models', 'yolo11m.pt')
TRACKER_CFG = os.path.join('models', 'botsort_dance.yaml')

_model = None


def _get_model():
    global _model
    if _model is None:
        from ultralytics import YOLO
        _model = YOLO(MODEL_PATH)
    return _model


def _device():
    import torch
    if torch.backends.mps.is_available():
        return 'mps'
    if torch.cuda.is_available():
        return 0
    return 'cpu'


def _center(box):
    return (box[0] + box[2]) / 2, (box[1] + box[3]) / 2


def _stitch(tracks, frame_w):
    """把断开的轨迹片段缝合到 N 个主角色上（N = 每帧人数的众数）"""
    n_frames = 1 + max(f for t in tracks.values() for f in t)
    per_frame = collections.Counter()
    for t in tracks.values():
        per_frame.update(t.keys())
    counts = collections.Counter(per_frame[f] for f in range(n_frames) if per_frame[f] > 0)
    n_roles = counts.most_common(1)[0][0]

    order = sorted(tracks, key=lambda t: -len(tracks[t]))
    roles = {t: dict(tracks[t]) for t in order[:n_roles]}
    print(f"[tracker] _stitch: n_roles={n_roles}, main_ids={order[:n_roles]}, "
          f"other_ids={order[n_roles:]}")

    max_dist = frame_w * 0.25
    for t in sorted(order[n_roles:], key=lambda t: min(tracks[t])):
        seg = tracks[t]
        seg_start, seg_end = min(seg), max(seg)
        best, best_dist = None, float('inf')
        for rid, rb in roles.items():
            # 时间上大量重叠说明是不同的人
            if len(seg.keys() & rb.keys()) > 0.1 * len(seg):
                continue
            prev = [f for f in rb if f < seg_start]
            nxt = [f for f in rb if f > seg_end]
            if prev:
                ref, cur = rb[max(prev)], seg[seg_start]
            elif nxt:
                ref, cur = rb[min(nxt)], seg[seg_end]
            else:
                continue
            (rx, ry), (cx, cy) = _center(ref), _center(cur)
            d = np.hypot(rx - cx, ry - cy)
            if d < best_dist:
                best, best_dist = rid, d
        if best is not None and best_dist < max_dist:
            print(f"[tracker] _stitch: id {t} ({len(seg)} frames, {seg_start}-{seg_end}) "
                  f"-> {best}, dist={best_dist:.0f}")
            for f, b in seg.items():
                roles[best].setdefault(f, b)
        else:
            print(f"[tracker] _stitch: drop id {t} ({len(seg)} frames), best_dist={best_dist:.0f}")
    return roles


def track_video(input_path, on_progress=None):
    """
    追踪视频中所有人物。结果缓存到 <video>.tracks.json
    返回 {fps, width, height, frame_count, roles: [{id, boxes: [[frame,x1,y1,x2,y2],...]}]}
    角色 id 从 1 开始，按首次出现时从左到右编号
    """
    import cv2

    cache_path = input_path + '.tracks.json'
    if os.path.exists(cache_path):
        print(f"[tracker] track_video: cache hit {cache_path}")
        with open(cache_path, encoding='utf-8') as f:
            return json.load(f)

    cap = cv2.VideoCapture(input_path)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frame_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    frame_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    cap.release()
    print(f"[tracker] track_video: input={input_path}, size={frame_w}x{frame_h}, "
          f"fps={fps}, total={total}")

    tracks = collections.defaultdict(dict)  # track_id -> {frame: (x1,y1,x2,y2)}
    frame_idx = -1
    results = _get_model().track(
        input_path, classes=[0], conf=0.3, tracker=TRACKER_CFG,
        persist=True, stream=True, verbose=False, device=_device(),
    )
    for frame_idx, r in enumerate(results):
        if r.boxes.id is not None:
            for tid, b in zip(r.boxes.id.int().tolist(), r.boxes.xyxy.cpu().numpy()):
                tracks[tid][frame_idx] = tuple(float(v) for v in b)
        if on_progress and frame_idx % 10 == 0:
            on_progress(min(99, int(frame_idx / total * 100)))
    frame_count = frame_idx + 1
    print(f"[tracker] track_video: frames={frame_count}, raw_track_ids={len(tracks)}")

    result = {'fps': fps, 'width': frame_w, 'height': frame_h,
              'frame_count': frame_count, 'roles': []}
    if tracks:
        roles = _stitch(tracks, frame_w)
        # 按首次出现位置从左到右编号
        def first_x(rid):
            rb = roles[rid]
            return _center(rb[min(rb)])[0]
        for new_id, rid in enumerate(sorted(roles, key=first_x), start=1):
            rb = roles[rid]
            boxes = [[f] + [round(v, 1) for v in rb[f]] for f in sorted(rb)]
            result['roles'].append({'id': new_id, 'boxes': boxes})
            print(f"[tracker] track_video: role {new_id} <- id {rid}, "
                  f"coverage={len(rb)}/{frame_count}")

    with open(cache_path, 'w', encoding='utf-8') as f:
        json.dump(result, f)
    return result


def dense_boxes(role, frame_count):
    """把角色的稀疏框插值成每帧一个框，缺失段线性插值，首尾保持最近值"""
    arr = np.array(role['boxes'], dtype=float)
    frames = np.arange(frame_count)
    return np.stack([np.interp(frames, arr[:, 0], arr[:, i]) for i in range(1, 5)], axis=1)
