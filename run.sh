#!/bin/bash
cd "$(dirname "$0")"
source venv/bin/activate
echo ""
echo "用法："
echo "  1) 使用摄像头（默认）："
echo "     python dance_trainer.py --video <教练视频路径>"
echo ""
echo "  2) 指定第三方摄像头（编号1,2...）："
echo "     python dance_trainer.py --video <教练视频路径> --camera 1"
echo ""
echo "  3) 调整画面尺寸："
echo "     python dance_trainer.py --video <教练视频路径> --width 720 --height 540"
echo ""

# 默认启动（摄像头0 + 示例教练视频）
python dance_trainer.py "$@"
