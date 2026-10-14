"use client";

import { RefObject, useEffect, useRef, useState } from "react";

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

interface CoachControlsProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  bindKey: string; // video 元素或视频源变化（切换模式/裁剪）时重新绑定事件
}

const fmt = (t: number) => {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
};

/** 教练视频播放条：播放/暂停、进度、速度、循环、打点分段循环 */
export default function CoachControls({ videoRef, bindKey }: CoachControlsProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState(true);
  const [marks, setMarks] = useState<number[]>([]); // 已排序的打点时间（秒）
  const [activeSeg, setActiveSeg] = useState<number | null>(null);

  // 打点把视频切成 marks.length + 1 段
  const bounds = [0, ...marks, duration];
  const segments = bounds.slice(0, -1).map((start, i) => ({ start, end: bounds[i + 1] }));
  const range = activeSeg !== null ? segments[activeSeg] : { start: 0, end: duration };

  // rAF 中读取最新的范围和循环设置
  const stateRef = useRef({ range, loop });
  stateRef.current = { range, loop };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = video.defaultPlaybackRate = speed;
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onMeta = () => setDuration(video.duration);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("loadedmetadata", onMeta);
    if (video.readyState >= 1) setDuration(video.duration);

    let raf = 0;
    const tick = () => {
      const { range, loop } = stateRef.current;
      // 到达范围末尾（或整段播放结束）时回到起点或停止
      const playing = !video.paused || video.ended;
      if (playing && range.end > 0 && (video.currentTime >= range.end - 0.03 || video.ended)) {
        if (loop) {
          video.currentTime = range.start;
          if (video.paused) video.play().catch(() => {});
        } else {
          video.pause();
        }
      }
      setTime(video.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("loadedmetadata", onMeta);
    };
  }, [videoRef, bindKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const video = () => videoRef.current;

  const togglePlay = () => {
    const v = video();
    if (!v) return;
    if (v.paused) {
      // 不在当前范围内时从范围起点开始
      if (v.currentTime < range.start || v.currentTime >= range.end - 0.05) v.currentTime = range.start;
      v.play().catch(() => {});
    } else {
      v.pause();
    }
  };

  const changeSpeed = (s: number) => {
    setSpeed(s);
    const v = video();
    if (v) v.playbackRate = v.defaultPlaybackRate = s;
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const v = video();
    if (!v || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const t = ((e.clientX - rect.left) / rect.width) * duration;
    // 跳出当前段时取消分段循环
    if (activeSeg !== null && (t < range.start || t >= range.end)) setActiveSeg(null);
    v.currentTime = t;
  };

  const addMark = () => {
    const t = video()?.currentTime ?? 0;
    if (t <= 0.1 || t >= duration - 0.1 || marks.some((m) => Math.abs(m - t) < 0.2)) return;
    setMarks([...marks, t].sort((a, b) => a - b));
    setActiveSeg(null);
  };

  const removeMark = (i: number) => {
    setMarks(marks.filter((_, j) => j !== i));
    setActiveSeg(null);
  };

  const selectSeg = (i: number) => {
    if (activeSeg === i) {
      setActiveSeg(null);
      return;
    }
    setActiveSeg(i);
    const v = video();
    if (v) {
      v.currentTime = segments[i].start;
      v.play().catch(() => {});
    }
  };

  const pct = (t: number) => (duration ? (t / duration) * 100 : 0);

  return (
    <div className="bg-zinc-900 rounded-lg p-3 mt-2 space-y-3">
      {/* 进度条 + 打点 */}
      <div className="relative h-6 cursor-pointer" onClick={seek}>
        <div className="absolute top-2.5 left-0 right-0 h-1 bg-zinc-700 rounded" />
        {activeSeg !== null && (
          <div
            className="absolute top-1.5 h-3 bg-blue-500/40 rounded"
            style={{ left: `${pct(range.start)}%`, width: `${pct(range.end - range.start)}%` }}
          />
        )}
        <div className="absolute top-2.5 left-0 h-1 bg-white rounded" style={{ width: `${pct(time)}%` }} />
        {marks.map((m, i) => (
          <div
            key={m}
            title="点击删除此打点"
            onClick={(e) => {
              e.stopPropagation();
              removeMark(i);
            }}
            className="absolute top-0 w-1 h-6 -ml-0.5 bg-yellow-400 rounded hover:bg-red-500"
            style={{ left: `${pct(m)}%` }}
          />
        ))}
        <div
          className="absolute top-1 w-3 h-4 -ml-1.5 bg-white rounded-sm pointer-events-none"
          style={{ left: `${pct(time)}%` }}
        />
      </div>

      {/* 控制按钮 */}
      <div className="flex items-center gap-2 flex-wrap text-sm">
        <button onClick={togglePlay} className="px-3 py-1.5 bg-white text-black rounded hover:bg-zinc-200">
          {isPlaying ? "暂停" : "播放"}
        </button>
        <span className="text-zinc-400 tabular-nums w-24">
          {fmt(time)} / {fmt(duration)}
        </span>
        <select
          value={speed}
          onChange={(e) => changeSpeed(Number(e.target.value))}
          className="bg-zinc-800 px-2 py-1.5 rounded"
        >
          {SPEEDS.map((s) => (
            <option key={s} value={s}>{s}x</option>
          ))}
        </select>
        <button
          onClick={() => setLoop(!loop)}
          className={`px-3 py-1.5 rounded ${loop ? "bg-blue-600" : "bg-zinc-800"}`}
        >
          循环 {loop ? "ON" : "OFF"}
        </button>
        <button onClick={addMark} className="px-3 py-1.5 rounded bg-yellow-500 text-black hover:bg-yellow-400">
          + 打点
        </button>
        {marks.length > 0 && (
          <button onClick={() => { setMarks([]); setActiveSeg(null); }} className="px-3 py-1.5 rounded bg-zinc-800 text-zinc-400">
            清空打点
          </button>
        )}
      </div>

      {/* 分段列表 */}
      {marks.length > 0 && (
        <div className="flex gap-2 flex-wrap text-xs">
          {segments.map((s, i) => (
            <button
              key={i}
              onClick={() => selectSeg(i)}
              className={`px-2 py-1 rounded border ${activeSeg === i ? "bg-blue-600 border-blue-600" : "border-zinc-700 hover:border-zinc-500"}`}
            >
              第{i + 1}段 {fmt(s.start)}-{fmt(s.end)}
            </button>
          ))}
          <span className="text-zinc-500 self-center">点击分段仅播放该段，再点一次取消</span>
        </div>
      )}
    </div>
  );
}
