"use client";

import { useState, useRef, useCallback } from "react";
import Link from "next/link";
import PoseOverlay from "@/components/PoseOverlay";
import PersonSelector from "@/components/PersonSelector";
import {
  uploadVideo,
  detectPersons,
  cropPerson,
  watchCropProgress,
  DetectPersonsResult,
} from "@/lib/api";

export default function SplitPage() {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [croppedUrl, setCroppedUrl] = useState<string | null>(null);

  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [personPopup, setPersonPopup] = useState<DetectPersonsResult | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);

  const handleVideoSelect = useCallback(async (file: File) => {
    setBlobUrl(URL.createObjectURL(file));
    setCroppedUrl(null);
    setFilename(null);
    try {
      const result = await uploadVideo(file);
      setFilename(result.filename);
    } catch (e) {
      console.warn("Upload failed:", e);
    }
  }, []);

  const handleDetect = useCallback(async () => {
    if (!filename) return;
    setIsProcessing(true);
    setProgress(0);
    try {
      const result = await detectPersons(filename, setProgress);
      setIsProcessing(false);
      if (result.persons.length === 0) {
        alert("未检测到人物");
        return;
      }
      if (result.persons.length === 1) {
        startCrop(result.persons[0].id);
      } else {
        setPersonPopup(result);
      }
    } catch (e) {
      setIsProcessing(false);
      alert("检测人物失败：" + (e as Error).message);
    }
  }, [filename]); // eslint-disable-line react-hooks/exhaustive-deps

  async function startCrop(roleId: number) {
    if (!filename) return;
    setIsProcessing(true);
    setProgress(0);
    try {
      const cropResult = await cropPerson(filename, roleId);
      if (cropResult.cached && cropResult.url) {
        setCroppedUrl(cropResult.url);
        return;
      }
      const finalUrl = await watchCropProgress(cropResult.task_id, (evt) => {
        setProgress(evt.progress);
      });
      setCroppedUrl(finalUrl);
    } catch (e) {
      alert("裁剪失败：" + (e as Error).message);
    } finally {
      setIsProcessing(false);
    }
  }

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
        {!blobUrl ? (
          <label className="flex flex-col items-center justify-center border-2 border-dashed border-zinc-700 rounded-lg h-48 cursor-pointer hover:border-zinc-500">
            <span className="text-zinc-400">点击上传视频</span>
            <input
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleVideoSelect(f);
              }}
            />
          </label>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-6">
              <div>
                <p className="text-sm text-zinc-400 mb-2">原始视频</p>
                <div className="relative">
                  <video
                    ref={videoRef}
                    src={blobUrl}
                    controls
                    className="w-full rounded-lg"
                  />
                  <PoseOverlay videoRef={videoRef} color="#00ff88" enabled={false} />
                </div>
              </div>
              {croppedUrl && (
                <div>
                  <p className="text-sm text-zinc-400 mb-2">裁剪结果</p>
                  <video src={croppedUrl} controls className="w-full rounded-lg" />
                </div>
              )}
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
                onClick={handleDetect}
                disabled={isProcessing || !filename}
                className="px-6 py-2 bg-white text-black rounded hover:bg-zinc-200 disabled:opacity-50"
              >
                {isProcessing ? "处理中..." : "检测并裁剪人物"}
              </button>
              {croppedUrl && (
                <button
                  onClick={handleDownload}
                  className="px-6 py-2 bg-zinc-800 rounded hover:bg-zinc-700"
                >
                  下载视频
                </button>
              )}
              <button
                onClick={() => {
                  setBlobUrl(null);
                  setFilename(null);
                  setCroppedUrl(null);
                }}
                className="px-6 py-2 bg-zinc-800 rounded hover:bg-zinc-700 text-zinc-400"
              >
                重新上传
              </button>
            </div>
          </>
        )}
      </main>

      {personPopup && blobUrl && (
        <PersonSelector
          persons={personPopup.persons}
          tracks={personPopup.tracks}
          videoSrc={blobUrl}
          onSelect={(roleId) => {
            setPersonPopup(null);
            startCrop(roleId);
          }}
          onCancel={() => setPersonPopup(null)}
        />
      )}
    </div>
  );
}
