"use client";

import { RefObject, useEffect, useRef } from "react";
import DragBox from "@/components/DragBox";

export type MaskMode = "cutout" | "silhouette";

interface MaskOverlayProps {
  src: string;
  syncRef: RefObject<HTMLVideoElement | null>; // 跟随的教练视频
  mode: MaskMode; // cutout: 只有蒙版处透出画面，其余压暗；silhouette: 半透明白色剪影
  strength: number; // 0-1。cutout: 背景压暗程度（1 为全黑）；silhouette: 剪影不透明度
  isMirrored?: boolean;
}

/**
 * 教练蒙版叠加层，与教练视频同步时间/速度/播放状态。
 * 拖动蒙版移动位置，右下角手柄或滚轮等比缩放，双击恢复默认位置。
 */
export default function MaskOverlay({ src, syncRef, mode, strength, isMirrored }: MaskOverlayProps) {
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

  const cutout = mode === "cutout";
  const bgLevel = Math.round((1 - strength) * 255); // cutout 背景灰度，multiply 后即压暗比例

  return (
    // cutout：灰底 + 白色蒙版（lighten 把蒙版黑色抬到底色）整体 multiply 叠到摄像头上，
    // 白处原样透出，其余按底色压暗
    <div
      className="absolute inset-0 overflow-hidden rounded-lg pointer-events-none"
      style={cutout ? { background: `rgb(${bgLevel},${bgLevel},${bgLevel})`, mixBlendMode: "multiply" } : undefined}
    >
      <DragBox enabled title="拖动移动，右下角或滚轮等比缩放，双击恢复">
        <video
          ref={maskRef}
          src={src}
          muted
          playsInline
          className="block w-full"
          style={{
            transform: isMirrored ? "scaleX(-1)" : "none",
            ...(cutout ? { mixBlendMode: "lighten" } : { mixBlendMode: "screen", opacity: strength }),
          }}
        />
      </DragBox>
    </div>
  );
}
