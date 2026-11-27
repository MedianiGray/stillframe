"""生成 OCR 段落还原率的基准图。

为什么自己画图而不是随手截屏：验收要「可复现」。真值文本由这份脚本写死，
图也由它生成，任何人在任何机器上跑一遍都得到同一组输入——
测出来的百分比才有意义，用一张来源不明的截图测，数字只是那一刻的巧合。

三页基础版面 + 一页双栏 + 两个变体（小字号、深色），共六张：
把「排版干净」的上限和「字小 / 深底」的下限都摆出来，别只报好看的那个。
"""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
OUT = HERE / "pages"
INPUT = OUT / "input"
PPM = OUT / "ppm"

CJK_FONT = "C:/Windows/Fonts/msyh.ttc"
MONO_FONT = "C:/Windows/Fonts/consola.ttf"

WIDTH = 1000
MARGIN = 64
BODY_SIZE = 21
BODY_LINE = 38          # 正文行距（约 1.8 倍字号）
PARA_GAP = 34           # 段间距
TITLE_SIZE = 30

PAGES = [
    {
        "file": "page1-zh.png",
        "title": "校园网络维护记录",
        "blocks": [
            "今天上午把实训室的交换机机柜重新整理了一遍。三台接入交换机原本叠在一起，"
            "背板散热孔被线缆挡住，夏天容易过热。现在按上层交换机、下层配线架的顺序重排，"
            "每台之间留一指宽的间隙，标签也全部换成了新打印的。",
            "整理时发现二号机柜的跳线有六根插错了端口，对应的是一间教室的网络。"
            "这间教室上周反映过时断时续，原因就在这里：线插到了百兆口上，"
            "上课高峰时带宽不够，视频一播就卡。",
            "处理完以后用测线仪逐段核对，八芯全部连通，衰减在正常范围内。"
            "顺手把机柜里的备用跳线捆成一束挂在侧板，下次换线不用再翻箱倒柜。",
        ],
    },
    {
        "file": "page2-mixed.png",
        "title": "Weekly lab notes / 本周实训记录",
        "blocks": [
            "This week we finished configuring the IIS web server on Windows Server 2019. "
            "三个站点各自绑定不同的端口，其中两个用主机头区分，测试时都能正常打开。",
            "The FTP service needed passive mode enabled, otherwise the client could log in "
            "but could not list files. 这个问题在实训手册里没有写，排查了将近一小时才定位到。",
            "最后把配置步骤整理成一份清单，贴在机房墙上。下一步准备把同样的站点搬到"
            " Linux 环境里，用 nginx 再走一遍，对比两边的差别。",
        ],
    },
    {
        "file": "page3-list-code.png",
        "title": "巡检清单与命令片段",
        "blocks": [
            "每日巡检需要确认的项目如下，缺一项就要在记录本上写清楚原因：",
            "- 机柜温度与风扇转速是否正常\n- 交换机指示灯有无异常闪烁\n- 备用电源电量是否在八成以上",
            "端口统计可以用下面这条命令，按速率排序后一眼看出谁在占带宽：",
            "show interface | sort by rate desc | head 20",
            "发现异常端口后先记录位置，再联系对应教室的老师确认使用情况，不要直接拔线。",
        ],
    },
]


def load_font(path: str, size: int) -> ImageFont.FreeTypeFont:
    # .ttc 是集合字体，索引 0 是常规字重
    return ImageFont.truetype(path, size=size, index=0)


def tokenize(text: str) -> list[str]:
    out: list[str] = []
    word = ""
    for ch in text:
        if ch.isascii() and (ch.isalnum() or ch in "-_./:"):
            word += ch
            continue
        if word:
            out.append(word)
            word = ""
        out.append(ch)
    if word:
        out.append(word)
    return out


def wrap(draw: ImageDraw.ImageDraw, text: str, font, width: int) -> list[str]:
    """按像素宽度折行。中文按字符断，英文尽量不把单词劈开。"""
    lines: list[str] = []
    for raw in text.split("\n"):
        current = ""
        for token in tokenize(raw):
            if draw.textlength(current + token, font=font) <= width:
                current += token
            else:
                if current:
                    lines.append(current)
                current = token.lstrip()
        if current:
            lines.append(current)
    return lines


def draw_flow(draw, blocks, x0, x1, y, body, mono, line_h_default=BODY_LINE):
    """从 y 起逐段画，返回结束的 y。返回每段的行数，供算总高。"""
    heights = []
    for kind, text in blocks:
        font = mono if kind == "code" else body
        lines = wrap(draw, text, font, x1 - x0)
        line_h = 30 if kind == "code" else line_h_default
        heights.append((kind, lines, line_h))
    for kind, lines, line_h in heights:
        if kind == "code":
            block_h = len(lines) * line_h + 16
            draw.rectangle([x0 - 12, y - 8, x1 + 12, y + block_h - 8], fill=(242, 243, 245))
            for line in lines:
                draw.text((x0, y), line, font=mono, fill=(30, 32, 38))
                y += line_h
        else:
            for line in lines:
                draw.text((x0, y), line, font=body, fill=(28, 28, 32))
                y += line_h
        y += PARA_GAP
    return y


def render(page: dict) -> Path:
    body = load_font(CJK_FONT, BODY_SIZE)
    mono = load_font(MONO_FONT, 19)
    title_font = load_font(CJK_FONT, TITLE_SIZE)

    blocks = []
    for index, text in enumerate(page["blocks"]):
        kind = "code" if text.startswith("show ") else "body"
        blocks.append((kind, text))

    # 先量高度：用一张探针图画一遍，拿到每段行数，再建正式画布。
    probe = Image.new("RGB", (WIDTH, 4000), "white")
    probe_draw = ImageDraw.Draw(probe)
    inner = WIDTH - MARGIN * 2
    total = MARGIN + TITLE_SIZE + 40
    for kind, text in blocks:
        font = mono if kind == "code" else body
        line_h = 30 if kind == "code" else BODY_LINE
        total += len(wrap(probe_draw, text, font, inner)) * line_h + PARA_GAP
    height = total + MARGIN

    image = Image.new("RGB", (WIDTH, height), "white")
    draw = ImageDraw.Draw(image)
    draw.text((MARGIN, MARGIN), page["title"], font=title_font, fill=(20, 20, 24))
    draw_flow(draw, blocks, MARGIN, WIDTH - MARGIN, MARGIN + TITLE_SIZE + 40, body, mono)

    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / page["file"]
    image.save(path)
    return path


TWO_COLUMN = {
    "file": "page4-two-column.png",
    "title": "机柜改造说明",
    # 栏间留窄（50px）：tesseract 会把左右两栏同一水平带的文字拼成一条 line，
    # 这是引擎版面分析的边界，段级无法挽回，留着它当「下限样本」。
    "left_x1": 610,
    "right_x0": 660,
    "left": [
        ("body", "机柜重新整理以后，把每一根跳线的走向都记在了图纸上。图纸贴在机柜侧板内侧，"
                 "写清楚了端口号、所在教室和对应的交换机位置，换线的时候照着看就行。"),
        ("body", "下一步要给每间教室的墙面端口编号，编号规则和机柜保持一致，"
                 "这样报修时只要说一个号，不用描述位置。"),
    ],
    "right": [
        ("body", "- 上行端口 24 个\n- 下行端口 48 个\n- 空余槽位 2 个"),
    ],
}

# 同一版面，栏间留宽（140px）：这一页用来验证「分列聚段」这条逻辑真的能用上。
TWO_COLUMN_WIDE = {
    **TWO_COLUMN,
    "file": "page5-two-column-wide.png",
    "title": "机柜改造说明（宽栏距）",
    "left_x1": 580,
    "right_x0": 720,
}


def render_two_column(spec: dict) -> tuple[Path, list[str]]:
    body = load_font(CJK_FONT, BODY_SIZE)
    title_font = load_font(CJK_FONT, TITLE_SIZE)

    left_x0, left_x1 = MARGIN, spec["left_x1"]
    right_x0, right_x1 = spec["right_x0"], WIDTH - MARGIN
    top = MARGIN + TITLE_SIZE + 40

    image = Image.new("RGB", (WIDTH, 760), "white")
    draw = ImageDraw.Draw(image)
    draw.text((MARGIN, MARGIN), spec["title"], font=title_font, fill=(20, 20, 24))
    draw_flow(draw, spec["left"], left_x0, left_x1, top, body, body)
    draw_flow(draw, spec["right"], right_x0, right_x1, top, body, body)

    path = OUT / spec["file"]
    image.save(path)
    truth = [text for _, text in spec["left"]] + [text for _, text in spec["right"]]
    return path, truth


def pipeline_input(image: Image.Image) -> Image.Image:
    """复现网页端 `toOcrBlob` 的缩放策略：长边 >2400 缩到 2400，<1200 放大 2 倍。"""
    longest = max(image.width, image.height)
    if longest > 2400:
        scale = 2400 / longest
    elif longest < 1200:
        scale = 2.0
    else:
        scale = 1.0
    if abs(scale - 1.0) < 0.01:
        return image
    size = (max(1, round(image.width * scale)), max(1, round(image.height * scale)))
    return image.resize(size, Image.LANCZOS)


def main() -> None:
    truth: dict[str, object] = {}
    sources: dict[str, Path] = {}

    for page in PAGES:
        path = render(page)
        # 标题也单独算一段：图上有它，导出 Markdown 时它该是一级标题，不列进真值就成了漏段
        truth[page["file"]] = {"title": page["title"], "paragraphs": [page["title"]] + page["blocks"]}
        sources[page["file"]] = path
        print(f"{path.name}: {path.stat().st_size} bytes")

    for spec in (TWO_COLUMN, TWO_COLUMN_WIDE):
        path, paragraphs = render_two_column(spec)
        truth[spec["file"]] = {
            "title": spec["title"],
            "paragraphs": [spec["title"]] + paragraphs,
        }
        sources[spec["file"]] = path
        print(f"{path.name}: {path.stat().st_size} bytes")

    # 变体一：13px 字（0.62 倍），模拟窗口被缩过、或者看的是 1366 宽笔记本上的小字
    small = "page1-zh-small.png"
    base = Image.open(sources["page1-zh.png"])
    scaled = base.resize((round(base.width * 0.62), round(base.height * 0.62)), Image.LANCZOS)
    scaled.save(OUT / small)
    truth[small] = {"title": "校园网络维护记录（小字号）", "paragraphs": truth["page1-zh.png"]["paragraphs"]}
    sources[small] = OUT / small
    print(f"{small}: {sources[small].stat().st_size} bytes")

    # 变体二：深色主题（像素反相），模拟 IDE / 深色网页
    dark = "page2-mixed-dark.png"
    inverted = Image.open(sources["page2-mixed.png"]).convert("RGB")
    from PIL import ImageOps

    ImageOps.invert(inverted).save(OUT / dark)
    truth[dark] = {"title": "Weekly lab notes（深色）", "paragraphs": truth["page2-mixed.png"]["paragraphs"]}
    sources[dark] = OUT / dark
    print(f"{dark}: {sources[dark].stat().st_size} bytes")

    # 管线输入版：网页端会先缩放再喂给 tesseract，基准也照同一条路走，否则测的不是线上行为
    INPUT.mkdir(parents=True, exist_ok=True)
    PPM.mkdir(parents=True, exist_ok=True)
    for name, path in sources.items():
        processed = pipeline_input(Image.open(path).convert("RGB"))
        out = INPUT / name
        processed.save(out)
        # 另外存一份 PPM：基准脚本要用像素自己找栏，PNG 在 Node 里没有解码器，
        # PPM 是未压缩的裸 RGB，几行代码就能读（这些文件是派生物，不入库）
        processed.save(PPM / name.replace(".png", ".ppm"))
        print(f"input/{name}: {processed.width}x{processed.height}")

    (OUT / "truth.json").write_text(
        json.dumps(truth, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"truth.json 写好：{len(truth)} 页")


if __name__ == "__main__":
    main()
