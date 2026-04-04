import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

let ffmpegInstance: FFmpeg | null = null;

export async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;

  const ffmpeg = new FFmpeg();
  const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";

  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
  });

  ffmpegInstance = ffmpeg;
  return ffmpeg;
}

export async function cropVideo(
  videoFile: File,
  x: number,
  y: number,
  width: number,
  height: number,
  onProgress?: (progress: number) => void
): Promise<Blob> {
  const ffmpeg = await getFFmpeg();

  ffmpeg.on("progress", ({ progress }) => {
    onProgress?.(Math.round(progress * 100));
  });

  await ffmpeg.writeFile("input.mp4", await fetchFile(videoFile));

  await ffmpeg.exec([
    "-i",
    "input.mp4",
    "-vf",
    `crop=${width}:${height}:${x}:${y}`,
    "-c:a",
    "copy",
    "output.mp4",
  ]);

  const data = await ffmpeg.readFile("output.mp4");
  const copy = data instanceof Uint8Array ? new Uint8Array(data) : new TextEncoder().encode(data as string);
  return new Blob([copy], { type: "video/mp4" });
}
