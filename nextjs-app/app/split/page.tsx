"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import VideoUpload from "@/components/VideoUpload";
import { cropVideo } from "@/lib/ffmpeg";

export default function SplitPage() {
  const [video, setVideo] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [croppedUrl, setCroppedUrl] = useState<string | null>(null);
  const [cropParams, setCropParams] = useState({ x: 0, y: 0, w: 640, h: 480 });

  const videoRef = useRef<HTMLVideoElement>(null);

  const handleVideoSelect = (file: File) => {
    setVideo(file);
    setVideoUrl(URL.createObjectURL(file));
  };

  const handleCrop = async () => {
    if (!video) return;

    setIsProcessing(true);
    setProgress(0);

    try {
      const blob = await cropVideo(
        video,
        cropParams.x,
        cropParams.y,
        cropParams.w,
        cropParams.h,
        setProgress
      );
      setCroppedUrl(URL.createObjectURL(blob));
    } catch (error) {
      console.error("裁剪失败:", error);
      alert("裁剪失败，请重试");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownload = () => {
    if (!croppedUrl) return;
    const a = document.createElement("a");
    a.href = croppedUrl;
    a.download = "cropped.mp4";
    a.click();
  };

  return (
    <div className="min-h-screen p-8">
      <header className="mb-8">
        <Link href="/" className="text-zinc-400 hover:text-white">
          ← 返回首页
        </Link>
        <h1 className="text-3xl font-bold mt-4">视频分割</h1>
        <p className="text-zinc-400 mt-2">从多人视频中提取单人直拍</p>
      </header>

      <main className="max-w-4xl mx-auto space-y-6">
        {!videoUrl ? (
          <VideoUpload onVideoSelect={handleVideoSelect} label="上传视频" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-6">
              <div>
                <p className="text-sm text-zinc-400 mb-2">原始视频</p>
                <video
                  ref={videoRef}
                  src={videoUrl}
                  controls
                  className="w-full rounded-lg"
                  onLoadedMetadata={(e) => {
                    const v = e.currentTarget;
                    setCropParams({
                      x: 0,
                      y: 0,
                      w: v.videoWidth,
                      h: v.videoHeight,
                    });
                  }}
                />
              </div>

              {croppedUrl && (
                <div>
                  <p className="text-sm text-zinc-400 mb-2">裁剪结果</p>
                  <video src={croppedUrl} controls className="w-full rounded-lg" />
                </div>
              )}
            </div>

            <div className="bg-zinc-900 p-6 rounded-lg space-y-4">
              <h3 className="font-medium">裁剪参数</h3>
              <div className="grid grid-cols-4 gap-4">
                {(["x", "y", "w", "h"] as const).map((key) => (
                  <div key={key}>
                    <label className="text-xs text-zinc-400 block mb-1">
                      {key === "x" ? "左边距 X" : key === "y" ? "上边距 Y" : key === "w" ? "宽度 W" : "高度 H"}
                    </label>
                    <input
                      type="number"
                      value={cropParams[key]}
                      onChange={(e) =>
                        setCropParams((p) => ({ ...p, [key]: Number(e.target.value) }))
                      }
                      className="w-full bg-zinc-800 px-3 py-2 rounded text-sm"
                    />
                  </div>
                ))}
              </div>
            </div>

            {isProcessing && (
              <div className="bg-zinc-900 p-4 rounded-lg">
                <div className="flex justify-between mb-2">
                  <span className="text-sm">处理中...</span>
                  <span className="text-sm">{progress}%</span>
                </div>
                <div className="h-2 bg-zinc-800 rounded">
                  <div
                    className="h-full bg-blue-500 rounded transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            )}

            <div className="flex gap-4">
              <button
                onClick={handleCrop}
                disabled={isProcessing}
                className="px-6 py-2 bg-white text-black rounded hover:bg-zinc-200 disabled:opacity-50"
              >
                {isProcessing ? "处理中..." : "开始裁剪"}
              </button>
              {croppedUrl && (
                <button
                  onClick={handleDownload}
                  className="px-6 py-2 bg-zinc-800 rounded hover:bg-zinc-700"
                >
                  下载视频
                </button>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
