"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import VideoUpload from "@/components/VideoUpload";
import WebcamPlayer from "@/components/WebcamPlayer";
import PlaybackControls from "@/components/PlaybackControls";

export default function FollowPage() {
  const [coachVideo, setCoachVideo] = useState<string | null>(null);
  const [mode, setMode] = useState<"side" | "fusion">("side");
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [isMirrored, setIsMirrored] = useState(false);

  const coachRef = useRef<HTMLVideoElement>(null);

  const handleCoachSelect = (file: File) => {
    setCoachVideo(URL.createObjectURL(file));
  };

  const handlePlayPause = () => {
    if (!coachRef.current) return;
    if (isPlaying) {
      coachRef.current.pause();
    } else {
      coachRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  return (
    <div className="min-h-screen p-8">
      <header className="mb-8">
        <Link href="/" className="text-zinc-400 hover:text-white">
          ← 返回首页
        </Link>
        <h1 className="text-3xl font-bold mt-4">跟跳模式</h1>
      </header>

      <main className="max-w-6xl mx-auto space-y-6">
        {!coachVideo ? (
          <VideoUpload onVideoSelect={handleCoachSelect} label="上传教练视频" />
        ) : (
          <>
            <div className="flex gap-2">
              <button
                onClick={() => setMode("side")}
                className={`px-4 py-2 rounded ${
                  mode === "side" ? "bg-white text-black" : "bg-zinc-800"
                }`}
              >
                并排
              </button>
              <button
                onClick={() => setMode("fusion")}
                className={`px-4 py-2 rounded ${
                  mode === "fusion" ? "bg-white text-black" : "bg-zinc-800"
                }`}
              >
                融合
              </button>
            </div>

            <PlaybackControls
              isPlaying={isPlaying}
              onPlayPause={handlePlayPause}
              speed={speed}
              onSpeedChange={(s) => {
                setSpeed(s);
                if (coachRef.current) coachRef.current.playbackRate = s;
              }}
              onMirror={() => setIsMirrored(!isMirrored)}
              isMirrored={isMirrored}
            />

            {mode === "side" ? (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-zinc-400 mb-2">教练</p>
                  <video
                    ref={coachRef}
                    src={coachVideo}
                    className="w-full rounded-lg"
                    style={{ transform: isMirrored ? "scaleX(-1)" : "none" }}
                  />
                </div>
                <div>
                  <p className="text-sm text-zinc-400 mb-2">你</p>
                  <WebcamPlayer isMirrored={isMirrored} />
                </div>
              </div>
            ) : (
              <div className="relative">
                <video
                  ref={coachRef}
                  src={coachVideo}
                  className="w-full rounded-lg"
                  style={{ transform: isMirrored ? "scaleX(-1)" : "none" }}
                />
                <div className="absolute top-0 left-0 w-full opacity-50">
                  <WebcamPlayer isMirrored={isMirrored} />
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
