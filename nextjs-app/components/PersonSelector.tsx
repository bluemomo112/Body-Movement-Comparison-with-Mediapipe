"use client";

import { useEffect, useMemo, useRef } from "react";
import { PersonBbox, TrackData } from "@/lib/api";

const COLORS = ["#4287f5", "#50c878", "#f57842", "#c850c8", "#f0dc3c", "#3cd2f0"];

const roleColor = (id: number) => COLORS[(id - 1) % COLORS.length];

interface PersonSelectorProps {
  persons: PersonBbox[];
  tracks: TrackData;
  videoSrc: string;
  title?: string;
  allowAll?: boolean; // 显示「全部角色」选项，选中时 onSelect(0)
  onSelect: (roleId: number) => void;
  onCancel: () => void;
}

export default function PersonSelector({
  persons,
  tracks,
  videoSrc,
  title = "选择要裁剪的角色",
  allowAll = false,
  onSelect,
  onCancel,
}: PersonSelectorProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // frame -> [{id, x1, y1, x2, y2}]
  const boxesByFrame = useMemo(() => {
    const map = new Map<number, { id: number; box: number[] }[]>();
    for (const role of tracks.roles) {
      for (const [f, ...box] of role.boxes) {
        if (!map.has(f)) map.set(f, []);
        map.get(f)!.push({ id: role.id, box });
      }
    }
    return map;
  }, [tracks]);

  const currentBoxes = () => {
    const video = videoRef.current;
    if (!video) return [];
    return boxesByFrame.get(Math.round(video.currentTime * tracks.fps)) ?? [];
  };

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas) {
        canvas.width = video.clientWidth;
        canvas.height = video.clientHeight;
        const scale = video.clientWidth / tracks.width;
        const ctx = canvas.getContext("2d")!;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.lineWidth = 3;
        ctx.font = "bold 16px sans-serif";
        for (const { id, box } of currentBoxes()) {
          const [x1, y1, x2, y2] = box.map((v) => v * scale);
          ctx.strokeStyle = ctx.fillStyle = roleColor(id);
          ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
          ctx.fillText(`角色${id}`, x1 + 4, Math.max(18, y1 - 6));
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [boxesByFrame, tracks]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const video = videoRef.current;
    if (!video) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const scale = tracks.width / video.clientWidth;
    const x = (e.clientX - rect.left) * scale;
    const y = (e.clientY - rect.top) * scale;
    const hit = currentBoxes().find(
      ({ box: [x1, y1, x2, y2] }) => x >= x1 && x <= x2 && y >= y1 && y <= y2
    );
    if (hit) onSelect(hit.id);
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
      <div className="bg-zinc-900 rounded-lg p-6 max-w-4xl w-full max-h-[90vh] overflow-auto">
        <h2 className="text-xl font-bold mb-1">{title}</h2>
        <p className="text-sm text-zinc-400 mb-4">播放视频确认每个角色全程追踪正确，点击框或下方卡片选择</p>
        <div className="relative mb-4" onClickCapture={handleClick}>
          <video
            ref={videoRef}
            src={videoSrc}
            controls
            muted
            autoPlay
            loop
            className="w-full rounded-lg"
          />
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full pointer-events-none"
          />
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-6">
          {persons.map((person) => (
            <div
              key={person.id}
              onClick={() => onSelect(person.id)}
              className="cursor-pointer border-2 rounded-lg overflow-hidden hover:opacity-80"
              style={{ borderColor: roleColor(person.id) }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={person.thumbnail} alt={`角色 ${person.id}`} className="w-full" />
              <p className="text-center py-1 text-sm" style={{ color: roleColor(person.id) }}>
                角色 {person.id}
              </p>
            </div>
          ))}
          {allowAll && (
            <div
              onClick={() => onSelect(0)}
              className="cursor-pointer border-2 border-white rounded-lg flex items-center justify-center hover:opacity-80 min-h-24"
            >
              <p className="text-center text-sm">全部角色</p>
            </div>
          )}
        </div>
        <button
          onClick={onCancel}
          className="w-full py-2 bg-zinc-800 rounded hover:bg-zinc-700"
        >
          取消
        </button>
      </div>
    </div>
  );
}
