"use client";

import { ReactNode, useRef, useState } from "react";

interface ResizableProps {
  children: ReactNode;
  defaultWidth: string; // 初始宽度（CSS），拖动后改为 px
  minWidth?: number;
}

/** 右下角手柄拖动改变宽度；内部视频 w-full 自动等比缩放 */
export default function Resizable({ children, defaultWidth, minWidth = 200 }: ResizableProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);

  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = ref.current;
    if (!el) return;
    const startX = e.clientX;
    const startW = el.getBoundingClientRect().width;
    const maxW = el.parentElement?.getBoundingClientRect().width ?? Infinity;
    const onMove = (ev: PointerEvent) => {
      setWidth(Math.min(maxW, Math.max(minWidth, startW + ev.clientX - startX)));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div ref={ref} className="relative shrink-0" style={{ width: width ?? defaultWidth }}>
      {children}
      <div
        onPointerDown={startResize}
        onDoubleClick={() => setWidth(null)}
        title="拖动等比缩放，双击恢复"
        className="absolute -bottom-1 -right-1 w-4 h-4 cursor-nwse-resize rounded-sm bg-zinc-500 hover:bg-white z-10"
      />
    </div>
  );
}
