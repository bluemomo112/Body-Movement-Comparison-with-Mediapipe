"use client";

import { useState, useRef, useCallback } from "react";
import Link from "next/link";
import WebcamPlayer from "@/components/WebcamPlayer";
import PoseOverlay from "@/components/PoseOverlay";
import PersonSelector from "@/components/PersonSelector";
import {
  uploadVideo,
  detectPersons,
  cropPerson,
  watchCropProgress,
  PersonBbox,
} from "@/lib/api";
import { BoundingBox } from "@/lib/videoUtils";

function bboxToBoundingBox(bbox: [number, number, number, number]): BoundingBox {
  return { x: bbox[0], y: bbox[1], width: bbox[2], height: bbox[3] };
}

interface CoachState {
  blobUrl: string | null;
  filename: string | null;
  croppedUrl: string | null;
  isCropped: boolean;
}

export default function FollowPage() {
  const [coach, setCoach] = useState<CoachState>({
    blobUrl: null, filename: null, croppedUrl: null, isCropped: false,
  });
  const [mode, setMode] = useState<"side" | "fusion">("side");
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [isMirrored, setIsMirrored] = useState(false);
  const [poseEnabled, setPoseEnabled] = useState(false);

  const [cropLoading, setCropLoading] = useState(false);
  const [cropProgress, setCropProgress] = useState(0);
  const [personPopup, setPersonPopup] = useState<PersonBbox[] | null>(null);

  const coachRef = useRef<HTMLVideoElement>(null);

  const handleCoachSelect = useCallback(async (file: File) => {
    const blobUrl = URL.createObjectURL(file);
    setCoach({ blobUrl, filename: null, croppedUrl: null, isCropped: false });
    try {
      const result = await uploadVideo(file);
      setCoach((prev) => ({ ...prev, filename: result.filename }));
    } catch (e) {
      console.warn("Upload failed:", e);
    }
  }, []);

  const handleCropClick = useCallback(async () => {
    if (!coach.filename) return;
    try {
      const result = await detectPersons(coach.filename);
      if (result.persons.length === 1) {
        startCrop(result.persons[0].bbox);
      } else {
        setPersonPopup(result.persons);
      }
    } catch (e) {
      alert("检测人物失败：" + (e as Error).message);
    }
  }, [coach.filename]); // eslint-disable-line react-hooks/exhaustive-deps

  async function startCrop(bbox: [number, number, number, number]) {
    if (!coach.filename) return;
    setCropLoading(true);
    setCropProgress(0);
    try {
      const cropResult = await cropPerson(coach.filename, bbox);
      if (cropResult.cached && cropResult.url) {
        setCoach((prev) => ({ ...prev, croppedUrl: cropResult.url!, isCropped: true }));
        return;
      }
      const finalUrl = await watchCropProgress(cropResult.task_id, (evt) => {
        setCropProgress(evt.progress);
      });
      setCoach((prev) => ({ ...prev, croppedUrl: finalUrl, isCropped: true }));
    } catch (e) {
      alert("裁剪失败：" + (e as Error).message);
    } finally {
      setCropLoading(false);
    }
  }

  const handlePlayPause = () => {
    if (!coachRef.current) return;
    if (isPlaying) {
      coachRef.current.pause();
    } else {
      coachRef.current.play().catch(() => {});
    }
    setIsPlaying(!isPlaying);
  };

  const coachSrc = coach.isCropped ? coach.croppedUrl : coach.blobUrl;

  return (
    <div className="min-h-screen p-8">
      <header className="mb-8">
        <Link href="/" className="text-zinc-400 hover:text-white">
          ← 返回首页
        </Link>
        <h1 className="text-3xl font-bold mt-4">跟跳模式</h1>
      </header>

      <main className="max-w-6xl mx-auto space-y-6">
        {!coachSrc ? (
          <label className="flex flex-col items-center justify-center border-2 border-dashed border-zinc-700 rounded-lg h-48 cursor-pointer hover:border-zinc-500">
            <span className="text-zinc-400">点击上传教练视频</span>
            <input
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleCoachSelect(f);
              }}
            />
          </label>
        ) : (
          <>
            {/* Toolbar */}
            <div className="flex gap-2 flex-wrap items-center bg-zinc-900 p-4 rounded-lg">
              <button
                onClick={() => setMode("side")}
                className={`px-4 py-2 rounded ${mode === "side" ? "bg-white text-black" : "bg-zinc-800"}`}
              >
                并排
              </button>
              <button
                onClick={() => setMode("fusion")}
                className={`px-4 py-2 rounded ${mode === "fusion" ? "bg-white text-black" : "bg-zinc-800"}`}
              >
                融合
              </button>

              <div className="w-px h-6 bg-zinc-700" />

              <button
                onClick={handlePlayPause}
                className="px-4 py-2 bg-white text-black rounded hover:bg-zinc-200"
              >
                {isPlaying ? "暂停" : "播放"}
              </button>
              <select
                value={speed}
                onChange={(e) => {
                  const s = Number(e.target.value);
                  setSpeed(s);
                  if (coachRef.current) coachRef.current.playbackRate = s;
                }}
                className="bg-zinc-800 px-2 py-1 rounded text-sm"
              >
                {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2].map((s) => (
                  <option key={s} value={s}>{s}x</option>
                ))}
              </select>
              <button
                onClick={() => setIsMirrored(!isMirrored)}
                className={`px-4 py-2 rounded text-sm ${isMirrored ? "bg-blue-600" : "bg-zinc-800"}`}
              >
                镜像
              </button>
              <button
                onClick={() => setPoseEnabled(!poseEnabled)}
                className={`px-4 py-2 rounded text-sm ${poseEnabled ? "bg-green-600" : "bg-zinc-800"}`}
              >
                骨骼点 {poseEnabled ? "ON" : "OFF"}
              </button>

              <div className="w-px h-6 bg-zinc-700" />

              {!coach.isCropped ? (
                <button
                  onClick={handleCropClick}
                  disabled={cropLoading || !coach.filename}
                  className="px-4 py-2 rounded text-sm bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50"
                >
                  ✂ 裁剪人物
                </button>
              ) : (
                <button
                  onClick={() => setCoach((prev) => ({ ...prev, isCropped: false }))}
                  className="px-4 py-2 rounded text-sm bg-green-700 hover:bg-green-600"
                >
                  ✓ 已裁剪 (恢复)
                </button>
              )}
            </div>

            {/* Crop progress */}
            {cropLoading && (
              <div className="bg-zinc-900 p-4 rounded-lg">
                <div className="flex justify-between mb-2">
                  <span className="text-sm">正在裁剪...</span>
                  <span className="text-sm">{cropProgress}%</span>
                </div>
                <div className="h-2 bg-zinc-800 rounded">
                  <div
                    className="h-full bg-green-500 rounded transition-all"
                    style={{ width: `${cropProgress}%` }}
                  />
                </div>
              </div>
            )}

            {/* Video area */}
            {mode === "side" ? (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-zinc-400 mb-2">教练</p>
                  <div className="relative">
                    <video
                      ref={coachRef}
                      src={coachSrc ?? undefined}
                      className="w-full rounded-lg"
                      style={{ transform: isMirrored ? "scaleX(-1)" : "none" }}
                    />
                    <PoseOverlay videoRef={coachRef} color="#00ff88" enabled={poseEnabled} />
                  </div>
                </div>
                <div>
                  <p className="text-sm text-zinc-400 mb-2">你</p>
                  <WebcamPlayer isMirrored={isMirrored} poseEnabled={poseEnabled} />
                </div>
              </div>
            ) : (
              <div className="relative">
                <video
                  ref={coachRef}
                  src={coachSrc ?? undefined}
                  className="w-full rounded-lg"
                  style={{ transform: isMirrored ? "scaleX(-1)" : "none" }}
                />
                <PoseOverlay videoRef={coachRef} color="#00ff88" enabled={poseEnabled} />
                <div className="absolute top-0 left-0 w-full opacity-50">
                  <WebcamPlayer isMirrored={isMirrored} poseEnabled={poseEnabled} />
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {personPopup && (
        <PersonSelector
          persons={personPopup.map((p) => ({
            bbox: bboxToBoundingBox(p.bbox),
            thumbnail: p.thumbnail,
          }))}
          onSelect={(i) => {
            const persons = personPopup;
            setPersonPopup(null);
            startCrop(persons[i].bbox);
          }}
          onCancel={() => setPersonPopup(null)}
        />
      )}
    </div>
  );
}
