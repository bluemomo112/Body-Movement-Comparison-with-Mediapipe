#!/usr/bin/env python3
"""下载 MobileNet-SSD 模型文件"""
import os
import urllib.request

MODEL_DIR = "models"
PROTOTXT_URL = "https://raw.githubusercontent.com/chuanqi305/MobileNet-SSD/master/deploy.prototxt"
CAFFEMODEL_URL = "https://github.com/chuanqi305/MobileNet-SSD/raw/master/mobilenet_iter_73000.caffemodel"

PROTOTXT_PATH = os.path.join(MODEL_DIR, "deploy.prototxt")
CAFFEMODEL_PATH = os.path.join(MODEL_DIR, "mobilenet_ssd.caffemodel")

def download_file(url, dest):
    """下载文件"""
    print(f"下载 {url} -> {dest}")
    urllib.request.urlretrieve(url, dest)
    print(f"✓ 完成")

def main():
    os.makedirs(MODEL_DIR, exist_ok=True)

    if not os.path.exists(PROTOTXT_PATH):
        download_file(PROTOTXT_URL, PROTOTXT_PATH)
    else:
        print(f"✓ {PROTOTXT_PATH} 已存在")

    if not os.path.exists(CAFFEMODEL_PATH):
        download_file(CAFFEMODEL_URL, CAFFEMODEL_PATH)
    else:
        print(f"✓ {CAFFEMODEL_PATH} 已存在")

    print("\n模型文件准备完成！")

if __name__ == "__main__":
    main()
