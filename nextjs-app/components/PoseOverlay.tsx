"use client";

import { useEffect, useRef, useCallback } from "react";
import { getPoseLandmarker, POSE_CONNECTIONS } from "@/lib/poseDetection";

interface PoseOverlayProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  color?: string;
  enabled: boolean;
}

export default function PoseOverlay({
  videoRef,
  color = "#00ff88",
  enabled,
}: PoseOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(-1);

  const draw = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !enabled) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Sync canvas size to video display size
    const { videoWidth, videoHeight } = video;
    if (!videoWidth || !videoHeight) {
      rafRef.current = requestAnimationFrame(draw);
      return;
    }

    if (canvas.width !== videoWidth) canvas.width = videoWidth;
    if (canvas.height !== videoHeight) canvas.height = videoHeight;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const currentTime = video.currentTime;
    if (currentTime === lastTimeRef.current || video.paused) {
      rafRef.current = requestAnimationFrame(draw);
      return;
    }
    lastTimeRef.current = currentTime;

    try {
      const landmarker = await getPoseLandmarker();
      const result = landmarker.detectForVideo(video, performance.now());

      for (const landmarks of result.landmarks) {
        // Draw connections
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        for (const [a, b] of POSE_CONNECTIONS) {
          const lmA = landmarks[a];
          const lmB = landmarks[b];
          if (!lmA || !lmB) continue;
          ctx.beginPath();
          ctx.moveTo(lmA.x * canvas.width, lmA.y * canvas.height);
          ctx.lineTo(lmB.x * canvas.width, lmB.y * canvas.height);
          ctx.stroke();
        }

        // Draw keypoints
        ctx.fillStyle = color;
        for (const lm of landmarks) {
          ctx.beginPath();
          ctx.arc(lm.x * canvas.width, lm.y * canvas.height, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } catch {
      // Landmarker may not be ready yet; skip frame
    }

    rafRef.current = requestAnimationFrame(draw);
  }, [videoRef, color, enabled]);

  useEffect(() => {
    if (!enabled) {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
      }
      cancelAnimationFrame(rafRef.current);
      return;
    }

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [enabled, draw]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute top-0 left-0 w-full h-full pointer-events-none"
      style={{ zIndex: 10 }}
    />
  );
}
