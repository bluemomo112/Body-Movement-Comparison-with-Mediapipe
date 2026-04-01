import Link from "next/link";

export default function ComparePage() {
  return (
    <div className="min-h-screen p-8">
      <header className="mb-8">
        <Link href="/" className="text-zinc-400 hover:text-white">
          ← 返回首页
        </Link>
        <h1 className="text-3xl font-bold mt-4">比较模式</h1>
        <p className="text-zinc-400 mt-2">上传两个视频进行动作对比</p>
      </header>

      <main className="max-w-6xl mx-auto">
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-8 text-center">
          <p className="text-zinc-400">功能开发中...</p>
        </div>
      </main>
    </div>
  );
}
