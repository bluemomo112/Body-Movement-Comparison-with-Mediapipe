"use client";

import { useState, useRef, useCallback } from "react";
import Link from "next/link";
import WebcamPlayer from "@/components/WebcamPlayer";
import PoseOverlay from "@/components/PoseOverlay";
import PersonSelector from "@/components/PersonSelector";
import CoachControls from "@/components/CoachControls";
import MaskOverlay, { MaskMode } from "@/components/MaskOverlay";
import Resizable from "@/components/Resizable";
import DragBox from "@/components/DragBox";
import {
  uploadVideo,
  detectPersons,
  cropPerson,
  maskPerson,
  watchCropProgress,
  DetectPersonsResult,
} from "@/lib/api";

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
  const [isMirrored, setIsMirrored] = useState(false);
  const [poseEnabled, setPoseEnabled] = useState(false);

  const [cropLoading, setCropLoading] = useState(false);
  const [cropProgress, setCropProgress] = useState(0);
  const [taskLabel, setTaskLabel] = useState("正在裁剪...");
  const [personPopup, setPersonPopup] = useState<DetectPersonsResult | null>(null);
  const [popupPurpose, setPopupPurpose] = useState<"crop" | "mask">("crop");

  // 教练蒙版（全画幅黑底白人），叠加在摄像头画面上对照
  const [maskUrl, setMaskUrl] = useState<string | null>(null);
  const [maskMode, setMaskMode] = useState<MaskMode | "off">("off");
  const [maskStrength, setMaskStrength] = useState(0.8);

  const coachRef = useRef<HTMLVideoElement>(null);
  const [coachAspect, setCoachAspect] = useState(16 / 9); // 舞台比例 = 教练视频比例

  const handleCoachSelect = useCallback(async (file: File) => {
    const blobUrl = URL.createObjectURL(file);
    setCoach({ blobUrl, filename: null, croppedUrl: null, isCropped: false });
    setMaskUrl(null);
    setMaskMode("off");
    try {
      const result = await uploadVideo(file);
      setCoach((prev) => ({ ...prev, filename: result.filename }));
    } catch (e) {
      console.warn("Upload failed:", e);
    }
  }, []);

  const handleDetect = useCallback(async (purpose: "crop" | "mask") => {
    if (!coach.filename) return;
    setTaskLabel("正在追踪人物...");
    setCropLoading(true);
    setCropProgress(0);
    try {
      const result = await detectPersons(coach.filename, setCropProgress);
      setCropLoading(false);
      if (result.persons.length === 1) {
        if (purpose === "crop") startCrop(result.persons[0].id);
        else startMask(result.persons[0].id);
      } else {
        setPopupPurpose(purpose);
        setPersonPopup(result);
      }
    } catch (e) {
      setCropLoading(false);
      alert("检测人物失败：" + (e as Error).message);
    }
  }, [coach.filename]); // eslint-disable-line react-hooks/exhaustive-deps

  async function startCrop(roleId: number) {
    if (!coach.filename) return;
    setTaskLabel("正在裁剪...");
    setCropLoading(true);
    setCropProgress(0);
    try {
      const cropResult = await cropPerson(coach.filename, roleId);
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

  async function startMask(roleId: number) {
    if (!coach.filename) return;
    setTaskLabel("正在生成蒙版...");
    setCropLoading(true);
    setCropProgress(0);
    try {
      const result = await maskPerson(coach.filename, roleId);
      const url = result.cached && result.url
        ? result.url
        : await watchCropProgress(result.task_id, (evt) => setCropProgress(evt.progress));
      setMaskUrl(url);
      setMaskMode("cutout");
    } catch (e) {
      alert("生成蒙版失败：" + (e as Error).message);
    } finally {
      setCropLoading(false);
    }
  }

  const coachSrc = coach.isCropped ? coach.croppedUrl : coach.blobUrl;
  const maskOverlay = maskUrl && maskMode !== "off" ? (
    <MaskOverlay src={maskUrl} syncRef={coachRef} mode={maskMode} strength={maskStrength} isMirrored={isMirrored} />
  ) : undefined;

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
                  onClick={() => handleDetect("crop")}
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

              <button
                onClick={() => handleDetect("mask")}
                disabled={cropLoading || !coach.filename}
                className="px-4 py-2 rounded text-sm bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50"
              >
                ◐ {maskUrl ? "重新生成蒙版" : "生成蒙版"}
              </button>
              {maskUrl && (
                <>
                  <button
                    onClick={() =>
                      setMaskMode(maskMode === "cutout" ? "silhouette" : maskMode === "silhouette" ? "off" : "cutout")
                    }
                    className={`px-4 py-2 rounded text-sm ${maskMode !== "off" ? "bg-purple-600" : "bg-zinc-800"}`}
                  >
                    蒙版：{{ cutout: "遮背景", silhouette: "剪影", off: "关" }[maskMode]}
                  </button>
                  {maskMode !== "off" && (
                    <label className="flex items-center gap-2 text-sm text-zinc-400">
                      {maskMode === "cutout" ? "背景遮挡" : "剪影浓度"}
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={maskStrength}
                        onChange={(e) => setMaskStrength(Number(e.target.value))}
                        className="w-24 accent-purple-500"
                      />
                      <span className="tabular-nums w-9">{Math.round(maskStrength * 100)}%</span>
                    </label>
                  )}
                  <a
                    href={maskUrl}
                    download
                    className="px-4 py-2 rounded text-sm bg-zinc-800 hover:bg-zinc-700"
                  >
                    下载蒙版
                  </a>
                </>
              )}
            </div>

            {/* Crop progress */}
            {cropLoading && (
              <div className="bg-zinc-900 p-4 rounded-lg">
                <div className="flex justify-between mb-2">
                  <span className="text-sm">{taskLabel}</span>
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

            {/* Video area：教练视频与控件条始终在同一位置，切换模式不重建（保留进度和打点）；
                每个画面右下角可拖动等比缩放。融合模式下教练和摄像头是舞台上的独立图层，可分别移动/缩放 */}
            <div className={mode === "side" ? "flex flex-wrap gap-4 items-start" : ""}>
              <Resizable defaultWidth={mode === "side" ? "calc(50% - 8px)" : "100%"}>
                {mode === "side" && <p className="text-sm text-zinc-400 mb-2">教练</p>}
                <div className="relative overflow-hidden rounded-lg bg-black" style={{ aspectRatio: coachAspect }}>
                  <DragBox enabled={mode === "fusion"} defaultPlacement={{ x: 0, y: 0, w: 100 }} title="教练：拖动移动，右下角或滚轮等比缩放，双击恢复">
                    <div className="relative">
                      <video
                        ref={coachRef}
                        src={coachSrc ?? undefined}
                        onLoadedMetadata={(e) =>
                          setCoachAspect(e.currentTarget.videoWidth / e.currentTarget.videoHeight)
                        }
                        className="block w-full rounded-lg"
                        style={{ transform: isMirrored ? "scaleX(-1)" : "none" }}
                      />
                      <PoseOverlay videoRef={coachRef} color="#00ff88" enabled={poseEnabled} />
                    </div>
                  </DragBox>
                  {mode === "fusion" && (
                    // 默认按 4:3 摄像头铺满舞台高度并居中，双击图层恢复
                    <DragBox enabled defaultPlacement={{ x: 12.5, y: 0, w: 75 }} className="opacity-50" title="你：拖动移动，右下角或滚轮等比缩放，双击恢复">
                      <WebcamPlayer isMirrored={isMirrored} poseEnabled={poseEnabled} overlay={maskOverlay} />
                    </DragBox>
                  )}
                </div>
                <CoachControls videoRef={coachRef} bindKey={coachSrc} />
              </Resizable>
              {mode === "side" && (
                <Resizable defaultWidth="calc(50% - 8px)">
                  <p className="text-sm text-zinc-400 mb-2">你</p>
                  <WebcamPlayer isMirrored={isMirrored} poseEnabled={poseEnabled} overlay={maskOverlay} />
                </Resizable>
              )}
            </div>
          </>
        )}
      </main>

      {personPopup && coach.blobUrl && (
        <PersonSelector
          persons={personPopup.persons}
          tracks={personPopup.tracks}
          videoSrc={coach.blobUrl}
          title={popupPurpose === "crop" ? "选择要裁剪的角色" : "选择要生成蒙版的角色"}
          allowAll={popupPurpose === "mask"}
          onSelect={(roleId) => {
            setPersonPopup(null);
            if (popupPurpose === "crop") startCrop(roleId);
            else startMask(roleId);
          }}
          onCancel={() => setPersonPopup(null)}
        />
      )}
    </div>
  );
}
