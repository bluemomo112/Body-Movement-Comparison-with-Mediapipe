export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function extractFrameFromVideo(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement
): ImageData | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.drawImage(video, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

export function calculateIOU(box1: BoundingBox, box2: BoundingBox): number {
  const x1 = Math.max(box1.x, box2.x);
  const y1 = Math.max(box1.y, box2.y);
  const x2 = Math.min(box1.x + box1.width, box2.x + box2.width);
  const y2 = Math.min(box1.y + box1.height, box2.y + box2.height);

  if (x2 < x1 || y2 < y1) return 0;

  const intersection = (x2 - x1) * (y2 - y1);
  const area1 = box1.width * box1.height;
  const area2 = box2.width * box2.height;
  const union = area1 + area2 - intersection;

  return intersection / union;
}
