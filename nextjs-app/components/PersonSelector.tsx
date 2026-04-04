"use client";

import { BoundingBox } from "@/lib/videoUtils";

interface PersonSelectorProps {
  persons: Array<{ bbox: BoundingBox; thumbnail: string }>;
  onSelect: (index: number) => void;
  onCancel: () => void;
}

export default function PersonSelector({
  persons,
  onSelect,
  onCancel,
}: PersonSelectorProps) {
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
      <div className="bg-zinc-900 rounded-lg p-6 max-w-4xl w-full max-h-[80vh] overflow-auto">
        <h2 className="text-xl font-bold mb-4">选择要裁剪的人物</h2>
        <div className="grid grid-cols-3 gap-4 mb-6">
          {persons.map((person, i) => (
            <div
              key={i}
              onClick={() => onSelect(i)}
              className="cursor-pointer border-2 border-zinc-700 hover:border-white rounded-lg overflow-hidden"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={person.thumbnail} alt={`人物 ${i + 1}`} className="w-full" />
              <p className="text-center py-2 text-sm">人物 {i + 1}</p>
            </div>
          ))}
        </div>
        <button
          onClick={onCancel}
          className="w-full py-2 bg-zinc-800 rounded hover:bg-zinc-700"
        >
          取消
        </button>
      </div>
    </div>
  );
}
