import Link from "next/link";

export default function Home() {
  const modes = [
    {
      title: "视频分割",
      description: "从多人视频中提取单人直拍",
      href: "/split",
      icon: "✂️",
    },
    {
      title: "跟跳模式",
      description: "上传教练视频，使用摄像头实时跟跳",
      href: "/follow",
      icon: "🎥",
    },
    {
      title: "比较模式",
      description: "上传两个视频进行动作对比",
      href: "/compare",
      icon: "⚖️",
    },
  ];

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8">
      <h1 className="text-4xl font-bold mb-4">Movement Compare</h1>
      <p className="text-zinc-400 mb-12">视频动作对比工具</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-6xl w-full">
        {modes.map((mode) => (
          <Link
            key={mode.href}
            href={mode.href}
            className="bg-zinc-900 border border-zinc-800 rounded-lg p-8 hover:border-zinc-600 transition-colors"
          >
            <div className="text-5xl mb-4">{mode.icon}</div>
            <h2 className="text-2xl font-semibold mb-2">{mode.title}</h2>
            <p className="text-zinc-400">{mode.description}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
