"use client";

import { useRef, useEffect, useState } from "react";
import PoseOverlay from "@/components/PoseOverlay";

interface WebcamPlayerProps {
  onStream?: (stream: MediaStream) => void;
  isMirrored?: boolean;
  poseEnabled?: boolean;
}

export default function WebcamPlayer({ onStream, isMirrored, poseEnabled = false }: WebcamPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>("");
  const [stream, setStream] = useState<MediaStream | null>(null);

  useEffect(() => {
    navigator.mediaDevices.enumerateDevices().then((deviceList) => {
      const cameras = deviceList.filter((d) => d.kind === "videoinput");
      setDevices(cameras);
      if (cameras.length > 0) {
        setSelectedDevice(cameras[0].deviceId);
      }
    });
  }, []);

  useEffect(() => {
    if (!selectedDevice) return;

    const startCamera = async () => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }

      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: selectedDevice },
      });

      if (videoRef.current) {
        videoRef.current.srcObject = newStream;
      }
      setStream(newStream);
      onStream?.(newStream);
    };

    startCamera();

    return () => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [selectedDevice]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-2">
      {devices.length > 1 && (
        <select
          value={selectedDevice}
          onChange={(e) => setSelectedDevice(e.target.value)}
          className="w-full bg-zinc-800 px-3 py-2 rounded text-sm"
        >
          {devices.map((device, i) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || `摄像头 ${i + 1}`}
            </option>
          ))}
        </select>
      )}
      <div className="relative">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full rounded-lg"
          style={{ transform: isMirrored ? "scaleX(-1)" : "none" }}
        />
        <PoseOverlay videoRef={videoRef} color="#ff6b6b" enabled={poseEnabled} />
      </div>
    </div>
  );
}
