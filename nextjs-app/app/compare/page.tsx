"use client";

import { useState, useRef, useEffect, useCallback, RefObject } from "react";
import Link from "next/link";
import PoseOverlay from "@/components/PoseOverlay";
import PersonSelector from "@/components/PersonSelector";
import {
  uploadVideo,
  detectPersons,
  cropPerson,
  watchCropProgress,
  smartAlign,
  PersonBbox,
} from "@/lib/api";
import { BoundingBox } from "@/lib/videoUtils";

function bboxToBoundingBox(bbox: [number, number, number, number]): BoundingBox {
  return { x: bbox[0], y: bbox[1], width: bbox[2], height: bbox[3] };
}

/* ── helpers ── */
function fmtTime(s: number) {
  if (!s || isNaN(s)) return "0:00.00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.floor((s % 1) * 100);
  return `${m}:${String(sec).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

/* ── per-role video panel ── */
interface VideoState {
  blobUrl: string | null;
  filename: string | null;
  croppedUrl: string | null;
  isCropped: boolean;
}

const initVideoState = (): VideoState => ({
  blobUrl: null,
  filename: null,
  croppedUrl: null,
  isCropped: false,
});

/* ── progress bar hook ── */
function useProgressBar(videoRef: RefObject<HTMLVideoElement | null>) {
  const [progress, setProgress] = useState(0);
  const [timeDisplay, setTimeDisplay] = useState("0:00.00 / 0:00.00");

  useEffect(() => {
    let raf: number;
    function tick() {
      const v = videoRef.current;
      if (v && v.duration) {
        setProgress((v.currentTime / v.duration) * 100);
        setTimeDisplay(`${fmtTime(v.currentTime)} / ${fmtTime(v.duration)}`);
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [videoRef]);

  return { progress, timeDisplay };
}

/* ── seek on click ── */
function seekVideo(
  e: React.MouseEvent<HTMLDivElement>,
  videoRef: RefObject<HTMLVideoElement | null>
) {
  const bar = e.currentTarget;
  const pct = Math.max(0, Math.min(1, e.nativeEvent.offsetX / bar.offsetWidth));
  const v = videoRef.current;
  if (v && v.duration) v.currentTime = pct * v.duration;
}

/* ════════════════════════════════════════════
   VideoPanel — shows one video with controls
   ════════════════════════════════════════════ */
interface VideoPanelProps {
  label: string;
  vState: VideoState;
  videoRef: RefObject<HTMLVideoElement | null>;
  isMirrored: boolean;
  isMuted: boolean;
  poseEnabled: boolean;
  trim: { start: number; end: number };
  speed: number;
  onFileSelect: (file: File) => void;
  onMirrorToggle: () => void;
  onMuteToggle: () => void;
  onTrimChange: (start: number, end: number) => void;
  onCropClick: () => void;
  onRevertCrop: () => void;
  cropLoading: boolean;
  cropProgress: number;
}

function VideoPanel({
  label,
  vState,
  videoRef,
  isMirrored,
  isMuted,
  poseEnabled,
  trim,
  speed,
  onFileSelect,
  onMirrorToggle,
  onMuteToggle,
  onTrimChange,
  onCropClick,
  onRevertCrop,
  cropLoading,
  cropProgress,
}: VideoPanelProps) {
  const { progress, timeDisplay } = useProgressBar(videoRef);
  const src = vState.isCropped ? vState.croppedUrl : vState.blobUrl;

  /* enforce trim bounds */
  useEffect(() => {
    let raf: number;
    function tick() {
      const v = videoRef.current;
      if (v && v.duration && !v.srcObject) {
        const startT = trim.start * v.duration;
        const endT = trim.end * v.duration;
        if (v.currentTime >= endT - 0.05) v.currentTime = startT;
        if (v.currentTime < startT - 0.1) v.currentTime = startT;
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [videoRef, trim]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = speed;
  }, [speed, videoRef]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = isMuted;
  }, [isMuted, videoRef]);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-zinc-400">{label}</p>

      {!src ? (
        <label className="flex flex-col items-center justify-center border-2 border-dashed border-zinc-700 rounded-lg h-48 cursor-pointer hover:border-zinc-500">
          <span className="text-zinc-400">点击上传视频</span>
          <input
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFileSelect(f);
            }}
          />
        </label>
      ) : (
        <>
          {/* Video + overlay */}
          <div className="relative">
            <video
              ref={videoRef}
              src={src}
              className="w-full rounded-lg"
              style={{ transform: isMirrored ? "scaleX(-1)" : "none" }}
              muted={isMuted}
            />
            <PoseOverlay videoRef={videoRef} color={label === "教练" ? "#00ff88" : "#ff6b6b"} enabled={poseEnabled} />

            {/* Crop progress overlay */}
            {cropLoading && (
              <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center rounded-lg">
                <p className="text-sm mb-2">正在裁剪... {cropProgress}%</p>
                <div className="w-2/3 h-2 bg-zinc-700 rounded">
                  <div
                    className="h-full bg-green-500 rounded transition-all"
                    style={{ width: `${cropProgress}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Progress bar */}
          <div
            className="relative h-6 bg-zinc-800 rounded cursor-pointer"
            onClick={(e) => seekVideo(e, videoRef)}
          >
            <div
              className="absolute top-0 left-0 h-full bg-zinc-600 rounded"
              style={{ width: `${progress}%` }}
            />
            <span className="absolute inset-0 flex items-center justify-center text-xs text-zinc-300">
              {timeDisplay}
            </span>
          </div>

          {/* Trim sliders */}
          <div className="space-y-1">
            <div className="flex gap-2 items-center text-xs text-zinc-400">
              <span>片段起点</span>
              <input
                type="range"
                min={0}
                max={999}
                value={Math.round(trim.start * 1000)}
                onChange={(e) => {
                  const s = parseInt(e.target.value) / 1000;
                  if (s < trim.end) onTrimChange(s, trim.end);
                }}
                className="flex-1"
              />
              <span className="w-16 text-right">{(trim.start * 100).toFixed(1)}%</span>
            </div>
            <div className="flex gap-2 items-center text-xs text-zinc-400">
              <span>片段终点</span>
              <input
                type="range"
                min={1}
                max={1000}
                value={Math.round(trim.end * 1000)}
                onChange={(e) => {
                  const end = parseInt(e.target.value) / 1000;
                  if (end > trim.start) onTrimChange(trim.start, end);
                }}
                className="flex-1"
              />
              <span className="w-16 text-right">{(trim.end * 100).toFixed(1)}%</span>
            </div>
          </div>

          {/* Per-role buttons */}
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={onMirrorToggle}
              className={`px-3 py-1 rounded text-xs ${isMirrored ? "bg-blue-600" : "bg-zinc-800"}`}
            >
              镜像
            </button>
            <button
              onClick={onMuteToggle}
              className={`px-3 py-1 rounded text-xs ${isMuted ? "bg-zinc-800" : "bg-yellow-700"}`}
            >
              {isMuted ? "🔇" : "🔊"}
            </button>
            {!vState.isCropped ? (
              <button
                onClick={onCropClick}
                disabled={cropLoading || !vState.filename}
                className="px-3 py-1 rounded text-xs bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50"
              >
                ✂ 裁剪
              </button>
            ) : (
              <button
                onClick={onRevertCrop}
                className="px-3 py-1 rounded text-xs bg-green-700 hover:bg-green-600"
              >
                ✓ 已裁剪 (恢复)
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════
   Main Compare Page
   ════════════════════════════════════════════ */
export default function ComparePage() {
  const [mode, setMode] = useState<"side" | "fusion">("side");
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [poseEnabled, setPoseEnabled] = useState(false);

  /* per-role state */
  const [coachVS, setCoachVS] = useState<VideoState>(initVideoState());
  const [userVS, setUserVS] = useState<VideoState>(initVideoState());
  const [coachMirrored, setCoachMirrored] = useState(false);
  const [userMirrored, setUserMirrored] = useState(false);
  const [coachMuted, setCoachMuted] = useState(false);
  const [userMuted, setUserMuted] = useState(true);
  const [coachTrim, setCoachTrim] = useState({ start: 0, end: 1 });
  const [userTrim, setUserTrim] = useState({ start: 0, end: 1 });

  /* crop state */
  const [cropLoading, setCropLoading] = useState<{ coach: boolean; user: boolean }>({ coach: false, user: false });
  const [cropProgress, setCropProgress] = useState<{ coach: number; user: number }>({ coach: 0, user: 0 });

  /* person selector popup */
  const [personPopup, setPersonPopup] = useState<{
    role: "coach" | "user";
    persons: PersonBbox[];
  } | null>(null);

  /* align */
  const [alignLoading, setAlignLoading] = useState(false);

  const coachRef = useRef<HTMLVideoElement>(null);
  const userRef = useRef<HTMLVideoElement>(null);

  /* fusion opacity */
  const [fusionOpacity, setFusionOpacity] = useState(0.5);

  /* ── file upload ── */
  const handleFileSelect = useCallback(
    async (role: "coach" | "user", file: File) => {
      const blobUrl = URL.createObjectURL(file);
      const setter = role === "coach" ? setCoachVS : setUserVS;
      setter({ blobUrl, filename: null, croppedUrl: null, isCropped: false });

      try {
        const result = await uploadVideo(file);
        setter((prev) => ({ ...prev, filename: result.filename }));
      } catch (e) {
        console.warn("Upload failed:", e);
      }
    },
    []
  );

  /* ── crop ── */
  const handleCropClick = useCallback(
    async (role: "coach" | "user") => {
      const vs = role === "coach" ? coachVS : userVS;
      if (!vs.filename) return;

      try {
        const result = await detectPersons(vs.filename);
        if (result.persons.length === 1) {
          startCrop(role, result.persons[0].bbox);
        } else {
          setPersonPopup({ role, persons: result.persons });
        }
      } catch (e) {
        alert("检测人物失败：" + (e as Error).message);
      }
    },
    [coachVS, userVS] // eslint-disable-line react-hooks/exhaustive-deps
  );

  async function startCrop(
    role: "coach" | "user",
    bbox: [number, number, number, number]
  ) {
    const vs = role === "coach" ? coachVS : userVS;
    if (!vs.filename) return;

    setCropLoading((p) => ({ ...p, [role]: true }));
    setCropProgress((p) => ({ ...p, [role]: 0 }));

    try {
      const cropResult = await cropPerson(vs.filename, bbox);
      if (cropResult.cached && cropResult.url) {
        applyCrop(role, cropResult.url);
        return;
      }

      const finalUrl = await watchCropProgress(cropResult.task_id, (evt) => {
        setCropProgress((p) => ({ ...p, [role]: evt.progress }));
      });
      applyCrop(role, finalUrl);
    } catch (e) {
      alert("裁剪失败：" + (e as Error).message);
    } finally {
      setCropLoading((p) => ({ ...p, [role]: false }));
    }
  }

  function applyCrop(role: "coach" | "user", url: string) {
    const setter = role === "coach" ? setCoachVS : setUserVS;
    setter((prev) => ({ ...prev, croppedUrl: url, isCropped: true }));
  }

  function revertCrop(role: "coach" | "user") {
    const setter = role === "coach" ? setCoachVS : setUserVS;
    setter((prev) => ({ ...prev, isCropped: false }));
  }

  /* ── smart align ── */
  const handleSmartAlign = useCallback(async () => {
    if (!coachVS.filename || !userVS.filename) {
      alert("请先上传教练和用户视频");
      return;
    }
    setAlignLoading(true);
    try {
      const { offset } = await smartAlign(coachVS.filename, userVS.filename);
      const absOffset = Math.abs(offset);
      const targetRole = offset > 0 ? "user" : "coach";
      const direction = offset > 0 ? "向后" : "向前";
      if (
        confirm(
          `检测到${targetRole === "user" ? "用户" : "教练"}视频应${direction}偏移 ${absOffset.toFixed(2)} 秒，是否应用？`
        )
      ) {
        const ref = targetRole === "coach" ? coachRef : userRef;
        const setTrim = targetRole === "coach" ? setCoachTrim : setUserTrim;
        const v = ref.current;
        if (v && v.duration) {
          const newStart = Math.max(0, Math.min(1, absOffset / v.duration));
          setTrim((prev) => ({ ...prev, start: newStart }));
        }
      }
    } catch (e) {
      alert("对齐失败：" + (e as Error).message);
    } finally {
      setAlignLoading(false);
    }
  }, [coachVS.filename, userVS.filename]);

  /* ── play / pause ── */
  const handlePlayPause = useCallback(() => {
    const cv = coachRef.current;
    const uv = userRef.current;
    if (isPlaying) {
      cv?.pause();
      uv?.pause();
    } else {
      cv?.play().catch(() => {});
      uv?.play().catch(() => {});
    }
    setIsPlaying((p) => !p);
  }, [isPlaying]);

  /* space key */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        handlePlayPause();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handlePlayPause]);

  /* speed sync */
  useEffect(() => {
    if (coachRef.current) coachRef.current.playbackRate = speed;
    if (userRef.current) userRef.current.playbackRate = speed;
  }, [speed]);

  const bothLoaded = !!(coachVS.blobUrl && userVS.blobUrl);

  return (
    <div className="min-h-screen p-8">
      <header className="mb-8">
        <Link href="/" className="text-zinc-400 hover:text-white">
          ← 返回首页
        </Link>
        <h1 className="text-3xl font-bold mt-4">比较模式</h1>
      </header>

      <main className="max-w-6xl mx-auto space-y-6">
        {/* Global toolbar — shown once both videos are loaded */}
        {bothLoaded && (
          <div className="flex gap-2 flex-wrap items-center bg-zinc-900 p-4 rounded-lg">
            {/* Mode */}
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

            {/* Play / speed / restart */}
            <button
              onClick={handlePlayPause}
              className="px-4 py-2 bg-white text-black rounded hover:bg-zinc-200"
            >
              {isPlaying ? "暂停" : "播放"}
            </button>
            <select
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              className="bg-zinc-800 px-2 py-1 rounded text-sm"
            >
              {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2].map((s) => (
                <option key={s} value={s}>
                  {s}x
                </option>
              ))}
            </select>
            <button
              onClick={() => {
                [coachRef, userRef].forEach((r) => {
                  if (r.current) r.current.currentTime = 0;
                });
              }}
              className="px-3 py-1 rounded text-sm bg-zinc-800"
            >
              重置
            </button>

            <div className="w-px h-6 bg-zinc-700" />

            {/* Pose */}
            <button
              onClick={() => setPoseEnabled((p) => !p)}
              className={`px-4 py-2 rounded text-sm ${poseEnabled ? "bg-green-600" : "bg-zinc-800"}`}
            >
              骨骼点 {poseEnabled ? "ON" : "OFF"}
            </button>

            {/* Smart align */}
            <button
              onClick={handleSmartAlign}
              disabled={alignLoading || !coachVS.filename || !userVS.filename}
              className="px-4 py-2 rounded text-sm bg-purple-700 hover:bg-purple-600 disabled:opacity-50"
            >
              {alignLoading ? "分析中..." : "智能对齐"}
            </button>

            {/* Fusion opacity */}
            {mode === "fusion" && (
              <>
                <div className="w-px h-6 bg-zinc-700" />
                <span className="text-xs text-zinc-400">叠透明度</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(fusionOpacity * 100)}
                  onChange={(e) => setFusionOpacity(parseInt(e.target.value) / 100)}
                  className="w-24"
                />
              </>
            )}
          </div>
        )}

        {/* Video area */}
        {mode === "side" || !bothLoaded ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <VideoPanel
              label="教练"
              vState={coachVS}
              videoRef={coachRef}
              isMirrored={coachMirrored}
              isMuted={coachMuted}
              poseEnabled={poseEnabled}
              trim={coachTrim}
              speed={speed}
              onFileSelect={(f) => handleFileSelect("coach", f)}
              onMirrorToggle={() => setCoachMirrored((p) => !p)}
              onMuteToggle={() => setCoachMuted((p) => !p)}
              onTrimChange={(s, e) => setCoachTrim({ start: s, end: e })}
              onCropClick={() => handleCropClick("coach")}
              onRevertCrop={() => revertCrop("coach")}
              cropLoading={cropLoading.coach}
              cropProgress={cropProgress.coach}
            />
            <VideoPanel
              label="用户"
              vState={userVS}
              videoRef={userRef}
              isMirrored={userMirrored}
              isMuted={userMuted}
              poseEnabled={poseEnabled}
              trim={userTrim}
              speed={speed}
              onFileSelect={(f) => handleFileSelect("user", f)}
              onMirrorToggle={() => setUserMirrored((p) => !p)}
              onMuteToggle={() => setUserMuted((p) => !p)}
              onTrimChange={(s, e) => setUserTrim({ start: s, end: e })}
              onCropClick={() => handleCropClick("user")}
              onRevertCrop={() => revertCrop("user")}
              cropLoading={cropLoading.user}
              cropProgress={cropProgress.user}
            />
          </div>
        ) : (
          /* Fusion mode */
          <div className="relative overflow-hidden rounded-lg bg-black" style={{ minHeight: 360 }}>
            {/* Coach as base */}
            <video
              ref={coachRef}
              src={coachVS.isCropped ? coachVS.croppedUrl ?? undefined : coachVS.blobUrl ?? undefined}
              className="w-full rounded-lg"
              style={{ transform: coachMirrored ? "scaleX(-1)" : "none" }}
              muted={coachMuted}
            />
            <PoseOverlay videoRef={coachRef} color="#00ff88" enabled={poseEnabled} />

            {/* User overlaid */}
            <video
              ref={userRef}
              src={userVS.isCropped ? userVS.croppedUrl ?? undefined : userVS.blobUrl ?? undefined}
              className="absolute top-0 left-0 w-full rounded-lg"
              style={{
                opacity: fusionOpacity,
                transform: userMirrored ? "scaleX(-1)" : "none",
              }}
              muted={userMuted}
            />
            <div
              className="absolute top-0 left-0 w-full h-full"
              style={{ opacity: fusionOpacity, pointerEvents: "none" }}
            >
              <PoseOverlay videoRef={userRef} color="#ff6b6b" enabled={poseEnabled} />
            </div>
          </div>
        )}
      </main>

      {/* Person selector popup */}
      {personPopup && (
        <PersonSelector
          persons={personPopup.persons.map((p) => ({
            bbox: bboxToBoundingBox(p.bbox),
            thumbnail: p.thumbnail,
          }))}
          onSelect={(i) => {
            const { role, persons } = personPopup;
            setPersonPopup(null);
            startCrop(role, persons[i].bbox);
          }}
          onCancel={() => setPersonPopup(null)}
        />
      )}
    </div>
  );
}
