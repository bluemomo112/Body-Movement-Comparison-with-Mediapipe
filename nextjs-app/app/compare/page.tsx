"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import VideoUpload from "@/components/VideoUpload";
import PlaybackControls from "@/components/PlaybackControls";

export default function ComparePage() {
  const [coachVideo, setCoachVideo] = useState<string | null>(null);
  const [userVideo, setUserVideo] = useState<string | null>(null);
  const [mode, setMode] = useState<"side" | "fusion">("side");
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [isMirrored, setIsMirrored] = useState(false);

  const coachRef = useRef<HTMLVideoElement>(null);
  const userRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const handleCoachSelect = (file: File) => {
    const url = URL.createObjectURL(file);
    setCoachVideo(url);
  };

  const handleUserSelect = (file: File) => {
    const url = URL.createObjectURL(file);
    setUserVideo(url);
  };

  const handlePlayPause = () => {
    if (!coachRef.current || !userRef.current) return;

    if (isPlaying) {
      coachRef.current.pause();
      userRef.current.pause();
    } else {
      coachRef.current.play();
      userRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  useEffect(() => {
    if (coachRef.current) coachRef.current.playbackRate = speed;
    if (userRef.current) userRef.current.playbackRate = speed;
  }, [speed]);

  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        handlePlayPause();
      }
    };
    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, [isPlaying]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-screen p-8">
      <header className="mb-8">
        <Link href="/" className="text-zinc-400 hover:text-white">
          ← 返回首页
        </Link>
        <h1 className="text-3xl font-bold mt-4">比较模式</h1>
      </header>

      <main className="max-w-6xl mx-auto space-y-6">
        {!coachVideo || !userVideo ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <VideoUpload onVideoSelect={handleCoachSelect} label="教练视频" />
            <VideoUpload onVideoSelect={handleUserSelect} label="用户视频" />
          </div>
        ) : (
          <>
            <div className="flex gap-4 items-center">
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
            </div>

            <PlaybackControls
              isPlaying={isPlaying}
              onPlayPause={handlePlayPause}
              speed={speed}
              onSpeedChange={setSpeed}
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
                  <p className="text-sm text-zinc-400 mb-2">用户</p>
                  <video
                    ref={userRef}
                    src={userVideo}
                    className="w-full rounded-lg"
                    style={{ transform: isMirrored ? "scaleX(-1)" : "none" }}
                  />
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
                <video
                  ref={userRef}
                  src={userVideo}
                  className="absolute top-0 left-0 w-full rounded-lg opacity-50"
                  style={{ transform: isMirrored ? "scaleX(-1)" : "none" }}
                />
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
