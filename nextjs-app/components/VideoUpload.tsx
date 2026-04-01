"use client";

import { useRef, ChangeEvent } from "react";

interface VideoUploadProps {
  onVideoSelect: (file: File) => void;
  label: string;
}

export default function VideoUpload({ onVideoSelect, label }: VideoUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith("video/")) {
      onVideoSelect(file);
    }
  };

  return (
    <div className="w-full">
      <label className="block text-sm font-medium mb-2">{label}</label>
      <div
        onClick={() => inputRef.current?.click()}
        className="border-2 border-dashed border-zinc-700 rounded-lg p-8 text-center cursor-pointer hover:border-zinc-500 transition-colors"
      >
        <p className="text-zinc-400">点击上传视频</p>
        <p className="text-xs text-zinc-500 mt-2">支持 MP4, MOV, AVI, WebM</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        onChange={handleFileChange}
        className="hidden"
      />
    </div>
  );
}
