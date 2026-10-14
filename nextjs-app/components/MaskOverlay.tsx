"use client";

import { RefObject, useEffect, useRef } from "react";

interface MaskOverlayProps {
  src: string;
  syncRef: RefObject<HTMLVideoElement | null>; // 跟随的教练视频
  isMirrored?: boolean;
  opacity?: number;
}

/** 教练蒙版视频叠加层：screen 混合让黑色透明，与教练视频同步时间/速度/播放状态 */
export default function MaskOverlay({ src, syncRef, isMirrored, opacity = 0.5 }: MaskOverlayProps) {
  const maskRef = useRef<HTMLVideoElement>(null);

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

  return (
    <video
      ref={maskRef}
      src={src}
      muted
      playsInline
      className="absolute inset-0 w-full h-full object-contain pointer-events-none rounded-lg"
      style={{
        mixBlendMode: "screen",
        opacity,
        transform: isMirrored ? "scaleX(-1)" : "none",
      }}
    />
  );
}
