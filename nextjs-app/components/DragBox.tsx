"use client";

import { ReactNode, useEffect, useRef, useState } from "react";

// 位置和宽度：x、w 为父容器宽度的百分比，y 为父容器高度的百分比
export interface Placement {
  x: number;
  y: number;
  w: number;
}

interface DragBoxProps {
  children: ReactNode;
  enabled: boolean; // 关闭时固定在默认位置，保留已调整的位置供下次开启
  defaultPlacement?: Placement; // 不传则宽度铺满、垂直居中
  className?: string;
  title?: string;
}

/** 绝对定位图层：拖动移动，右下角手柄或滚轮等比缩放，双击恢复默认 */
export default function DragBox({ children, enabled, defaultPlacement, className = "", title }: DragBoxProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const active = enabled && placement ? placement : null;

  // 当前实际位置（未调整过时从布局测量，避免依赖首次渲染时的尺寸）
  const measure = (): Placement | null => {
    const el = ref.current;
    const parent = el?.parentElement?.getBoundingClientRect();
    if (!el || !parent?.width || !parent.height) return null;
    const r = el.getBoundingClientRect();
    return {
      x: ((r.left - parent.left) / parent.width) * 100,
      y: ((r.top - parent.top) / parent.height) * 100,
      w: (r.width / parent.width) * 100,
    };
  };

  const drag = (e: React.PointerEvent, kind: "move" | "resize") => {
    if (!enabled) return;
    // 图层内的表单控件（如摄像头选择）正常交互，不触发拖动
    if ((e.target as HTMLElement).closest("select, input, button")) return;
    e.preventDefault();
    e.stopPropagation();
    const parent = ref.current?.parentElement?.getBoundingClientRect();
    const p = placement ?? measure();
    if (!parent || !p) return;
    const start = { cx: e.clientX, cy: e.clientY, ...p };
    const onMove = (ev: PointerEvent) => {
      const dx = ((ev.clientX - start.cx) / parent.width) * 100;
      const dy = ((ev.clientY - start.cy) / parent.height) * 100;
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

  // 滚轮缩放（以光标为中心）。需要非 passive 监听才能阻止页面滚动
  const wheelRef = useRef<(e: WheelEvent) => void>(() => {});
  wheelRef.current = (e: WheelEvent) => {
    if (!enabled) return;
    const parent = ref.current?.parentElement?.getBoundingClientRect();
    const p = placement ?? measure();
    if (!parent || !p) return;
    e.preventDefault();
    e.stopPropagation(); // 内层图层（蒙版）缩放时不带动外层
    const f = Math.exp(-e.deltaY * 0.0015);
    const w = Math.max(10, p.w * f);
    const k = w / p.w;
    const cx = ((e.clientX - parent.left) / parent.width) * 100;
    const cy = ((e.clientY - parent.top) / parent.height) * 100;
    setPlacement({ x: cx - (cx - p.x) * k, y: cy - (cy - p.y) * k, w });
  };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => wheelRef.current(e);
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const p = active ?? defaultPlacement;
  // 默认居中用 inset-y-0 + my-auto，不用 transform，避免创建层叠上下文影响内部 mix-blend-mode
  const posClass = p ? "" : "left-0 w-full inset-y-0 my-auto h-fit";
  const posStyle = p ? { left: `${p.x}%`, top: `${p.y}%`, width: `${p.w}%` } : undefined;

  return (
    <div
      ref={ref}
      title={enabled ? title : undefined}
      className={`group absolute ${posClass} ${enabled ? "cursor-move pointer-events-auto" : ""} ${className}`}
      style={posStyle}
      onPointerDown={(e) => drag(e, "move")}
      onDoubleClick={(e) => {
        if (!enabled) return;
        e.stopPropagation(); // 内层图层复位时不带动外层
        setPlacement(null);
      }}
    >
      {children}
      {enabled && (
        <>
          <div className="absolute inset-0 border border-dashed border-sky-400 opacity-0 group-hover:opacity-100 pointer-events-none rounded-lg" />
          <div
            onPointerDown={(e) => drag(e, "resize")}
            className="absolute -bottom-1 -right-1 w-4 h-4 cursor-nwse-resize rounded-sm bg-sky-500 opacity-0 group-hover:opacity-100"
          />
        </>
      )}
    </div>
  );
}
