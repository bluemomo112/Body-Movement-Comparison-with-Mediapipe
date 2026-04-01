"use client";

interface PlaybackControlsProps {
  isPlaying: boolean;
  onPlayPause: () => void;
  speed: number;
  onSpeedChange: (speed: number);
  onMirror: () => void;
  isMirrored: boolean;
}

export default function PlaybackControls({
  isPlaying,
  onPlayPause,
  speed,
  onSpeedChange,
  onMirror,
  isMirrored,
}: PlaybackControlsProps) {
  const speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

  return (
    <div className="flex items-center gap-4 bg-zinc-900 p-4 rounded-lg">
      <button
        onClick={onPlayPause}
        className="px-4 py-2 bg-white text-black rounded hover:bg-zinc-200"
      >
        {isPlaying ? "暂停" : "播放"}
      </button>

      <div className="flex items-center gap-2">
        <span className="text-sm text-zinc-400">速度:</span>
        <select
          value={speed}
          onChange={(e) => onSpeedChange(Number(e.target.value))}
          className="bg-zinc-800 px-2 py-1 rounded text-sm"
        >
          {speeds.map((s) => (
            <option key={s} value={s}>
              {s}x
            </option>
          ))}
        </select>
      </div>

      <button
        onClick={onMirror}
        className={`px-3 py-1 rounded text-sm ${
          isMirrored ? "bg-blue-600" : "bg-zinc-800"
        }`}
      >
        镜像
      </button>
    </div>
  );
}
