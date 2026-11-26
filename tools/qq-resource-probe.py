#!/usr/bin/env python3
"""把本机 QQ（QQNT）截图模块的资源包拆成可读的 XML / PNG。

用法：
    python tools/qq-resource-probe.py "C:\\Program Files\\Tencent\\QQNT" -o ./qq-dump

Windows 默认安装目录会被自动探测。只读操作，不修改 QQ 任何文件。
拆出来的 XML 就是 ScreenCaptureWnd / OCRWnd / TranslateWnd / NailToDesktopWnd 的界面定义，
中文文案在 Default.rdb 的 StringBundle 里。
"""

from __future__ import annotations

import argparse
import os
import re
import sys

MAGIC = b"531E98204F8542F0"
CTRL = set(range(0, 9)) | {11, 12} | set(range(14, 32))

DEFAULT_ROOTS = [
    r"C:\Program Files\Tencent\QQNT",
    r"C:\Program Files (x86)\Tencent\QQNT",
    r"D:\Tencent\QQNT",
]


def find_app_root(qqnt: str) -> str:
    versions = os.path.join(qqnt, "versions")
    if not os.path.isdir(versions):
        raise SystemExit(f"没有找到版本目录：{versions}")
    dirs = [d for d in os.listdir(versions) if os.path.isdir(os.path.join(versions, d))]
    if not dirs:
        raise SystemExit("版本目录为空")
    dirs.sort(key=lambda d: os.path.getmtime(os.path.join(versions, d)), reverse=True)
    app = os.path.join(versions, dirs[0], "resources", "app")
    if not os.path.isdir(app):
        raise SystemExit(f"版本 {dirs[0]} 下没有 resources/app")
    print(f"[i] 使用版本 {dirs[0]}")
    return app


def carve_xml(data: bytes, tag: str, outdir: str) -> list[tuple[str, int]]:
    found = []
    n = 0
    for m in re.finditer(rb"<\?xml", data):
        start = m.start()
        i = start
        while i < len(data) and data[i] not in CTRL:
            i += 1
        chunk = data[start:i]
        if len(chunk) < 64:
            continue
        n += 1
        name = f"{tag}_xml{n:03d}.xml"
        path = os.path.join(outdir, name)
        with open(path, "w", encoding="utf-8", errors="ignore") as fh:
            fh.write(chunk.decode("utf-8", "ignore"))
        found.append((name, len(chunk)))
    return found


def carve_png(data: bytes, tag: str, outdir: str) -> int:
    n = 0
    pos = 0
    while True:
        i = data.find(b"\x89PNG\r\n\x1a\n", pos)
        if i == -1:
            break
        j = data.find(b"IEND", i)
        if j == -1:
            break
        end = j + 8
        n += 1
        with open(os.path.join(outdir, f"{tag}_png{n:03d}.png"), "wb") as fh:
            fh.write(data[i:end])
        pos = end
    return n


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("qqnt", nargs="?", help="QQNT 安装目录，留空则自动探测")
    parser.add_argument("-o", "--out", default="./qq-dump", help="输出目录")
    args = parser.parse_args()

    root = args.qqnt
    if not root:
        for cand in DEFAULT_ROOTS:
            if os.path.isdir(cand):
                root = cand
                break
    if not root:
        raise SystemExit("没有找到 QQNT，请把安装目录作为第一个参数传入")

    app = find_app_root(root)
    shot_dir = os.path.join(app, "QQScreenShot")
    if not os.path.isdir(shot_dir):
        raise SystemExit(f"没有找到 QQScreenShot 模块：{shot_dir}")

    os.makedirs(args.out, exist_ok=True)
    packs = [
        ("QQScreenShot", os.path.join(shot_dir, "QQScreenShot.rdb")),
        ("Default", os.path.join(shot_dir, "Default.rdb")),
        ("Config", os.path.join(shot_dir, "Config.rdb")),
    ]

    total_xml = total_png = 0
    hits = []
    for tag, path in packs:
        if not os.path.exists(path):
            print(f"[!] 缺少 {path}")
            continue
        data = open(path, "rb").read()
        if data[:16] != MAGIC:
            print(f"[!] {os.path.basename(path)} 头标识不是 {MAGIC.decode()}，格式可能变了")
        xmls = carve_xml(data, tag, args.out)
        pngs = carve_png(data, tag, args.out)
        total_xml += len(xmls)
        total_png += pngs
        print(f"[+] {os.path.basename(path):<20} xml={len(xmls):>3} png={pngs:>4}")
        for name, size in xmls:
            if size > 40000:
                hits.append((name, size))

    print(f"\n合计 xml={total_xml} png={total_png} → {os.path.abspath(args.out)}")
    if hits:
        print("\n大体积界面 XML（截图窗口通常在其中）：")
        for name, size in hits:
            path = os.path.join(args.out, name)
            head = open(path, encoding="utf-8", errors="ignore").read(400)
            root_tag = re.search(r'name="(\w+)"', head)
            print(f"  {name:<28} {size:>7d} B  {root_tag.group(0) if root_tag else ''}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
