"use client";

import { RefObject, useEffect, useRef, useState } from "react";

export type MaskMode = "cutout" | "silhouette";

interface MaskOverlayProps {
  src: string;
  syncRef: RefObject<HTMLVideoElement | null>; // 跟随的教练视频
  mode: MaskMode; // cutout: 只有蒙版处透出画面，其余压暗；silhouette: 半透明白色剪影
  strength: number; // 0-1。cutout: 背景压暗程度（1 为全黑）；silhouette: 剪影不透明度
  isMirrored?: boolean;
}

// 蒙版在容器中的位置和宽度（均为容器宽高的百分比）
interface Placement {
  x: number;
  y: number;
  w: number;
}

/**
 * 教练蒙版叠加层，与教练视频同步时间/速度/播放状态。
 * 拖动蒙版移动位置，拖右下角等比缩放，双击恢复默认位置。
 */
export default function MaskOverlay({ src, syncRef, mode, strength, isMirrored }: MaskOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const maskRef = useRef<HTMLVideoElement>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [, setMetaLoaded] = useState(0); // 元数据加载后重新计算默认位置

  useEffect(() => {
    let raf = 0;
    const sync = () => {
      const coach = syncRef.current;
      const mask = maskRef.current;
      if (coach && mask && mask.readyState >= 1) {
        if (mask.playbackRate !== coach.playbackRate) mask.playbackRate = coach.playbackRate;
        // 播放中允许小误差，暂停时精确对齐当前帧
        const tolerance = coach.paused ? 0.02 : 0.15;
        if (Math.abs(mask.currentTime - coach.currentTime) > tolerance) mask.currentTime = coach.currentTime;
        if (coach.paused && !mask.paused) mask.pause();
        if (!coach.paused && mask.paused) mask.play().catch(() => {});
      }
      raf = requestAnimationFrame(sync);
    };
    raf = requestAnimationFrame(sync);
    return () => cancelAnimationFrame(raf);
  }, [syncRef, src]);

  // 默认：宽度铺满、垂直居中（等同 object-contain）
  const defaultPlacement = (): Placement => {
    const c = containerRef.current?.getBoundingClientRect();
    const v = maskRef.current;
    if (!c || !v || !v.videoWidth || !c.height) return { x: 0, y: 0, w: 100 };
    const hPct = ((c.width * v.videoHeight) / v.videoWidth / c.height) * 100;
    if (hPct > 100) {
      const w = (100 / hPct) * 100;
      return { x: (100 - w) / 2, y: 0, w };
    }
    return { x: 0, y: (100 - hPct) / 2, w: 100 };
  };
  const p = placement ?? defaultPlacement();

  const drag = (e: React.PointerEvent, kind: "move" | "resize") => {
    e.preventDefault();
    e.stopPropagation();
    const c = containerRef.current?.getBoundingClientRect();
    if (!c) return;
    const start = { cx: e.clientX, cy: e.clientY, ...p };
    const onMove = (ev: PointerEvent) => {
      const dx = ((ev.clientX - start.cx) / c.width) * 100;
      const dy = ((ev.clientY - start.cy) / c.height) * 100;
      setPlacement(
        kind === "move"
          ? { x: start.x + dx, y: start.y + dy, w: start.w }
          : { x: start.x, y: start.y, w: Math.max(10, start.w + dx) }
      );
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const cutout = mode === "cutout";
  const bgLevel = Math.round((1 - strength) * 255); // cutout 背景灰度，multiply 后即压暗比例

  return (
    // cutout：灰底 + 白色蒙版（lighten 把蒙版黑色抬到底色）整体 multiply 叠到摄像头上，
    // 白处原样透出，其余按底色压暗
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden rounded-lg pointer-events-none"
      style={cutout ? { background: `rgb(${bgLevel},${bgLevel},${bgLevel})`, mixBlendMode: "multiply" } : undefined}
    >
      <div
        className="group absolute pointer-events-auto cursor-move"
        style={{ left: `${p.x}%`, top: `${p.y}%`, width: `${p.w}%` }}
        onPointerDown={(e) => drag(e, "move")}
        onDoubleClick={() => setPlacement(null)}
        title="拖动移动，右下角等比缩放，双击恢复"
      >
        <video
          ref={maskRef}
          src={src}
          muted
          playsInline
          onLoadedMetadata={() => setMetaLoaded((n) => n + 1)}
          className="block w-full"
          style={{
            transform: isMirrored ? "scaleX(-1)" : "none",
            ...(cutout ? { mixBlendMode: "lighten" } : { mixBlendMode: "screen", opacity: strength }),
          }}
        />
        <div className="absolute inset-0 border border-dashed border-purple-400 opacity-0 group-hover:opacity-100" />
        <div
          onPointerDown={(e) => drag(e, "resize")}
          className="absolute -bottom-1 -right-1 w-4 h-4 cursor-nwse-resize rounded-sm bg-purple-500 opacity-0 group-hover:opacity-100"
        />
      </div>
    </div>
  );
}
