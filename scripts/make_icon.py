"""クラベルのアプリアイコン（1024x1024 の原画）を描く。

左右2枚の書類を見比べ、違う行（左: 赤 / 右: 緑）を示す、青い角丸の台座のデザイン。
使い方:
    python3 scripts/make_icon.py            # src-tauri/icons/source.png を出力
    npx tauri icon src-tauri/icons/source.png   # 各サイズ (.icns / .ico / .png) を生成
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

SIZE = 1024
SS = 4  # スーパーサンプリング（縁をなめらかにするため、4倍で描いて縮小する）
OUT = Path(__file__).resolve().parent.parent / "src-tauri" / "icons" / "source.png"


def s(v: float) -> int:
    return round(v * SS)


def gradient(width: int, height: int, top: tuple, bottom: tuple) -> Image.Image:
    img = Image.new("RGB", (width, height))
    px = img.load()
    for y in range(height):
        t = y / (height - 1)
        row = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        for x in range(width):
            px[x, y] = row
    return img


def rounded_mask(box: tuple, radius: float) -> Image.Image:
    mask = Image.new("L", (SIZE * SS, SIZE * SS), 0)
    ImageDraw.Draw(mask).rounded_rectangle([s(v) for v in box], radius=s(radius), fill=255)
    return mask


def main() -> None:
    canvas = Image.new("RGBA", (SIZE * SS, SIZE * SS), (0, 0, 0, 0))

    # 台座: macOS のアイコングリッドに合わせ、余白 100px・一辺 824px の角丸
    body = (100, 100, 924, 924)
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    shadow.paste((10, 20, 70, 110), mask=rounded_mask((body[0], body[1] + 14, body[2], body[3] + 14), 186))
    canvas = Image.alpha_composite(canvas, shadow.filter(ImageFilter.GaussianBlur(s(18))))
    base = gradient(SIZE * SS, SIZE * SS, (92, 150, 255), (44, 62, 214)).convert("RGBA")
    canvas.paste(base, mask=rounded_mask(body, 186))

    draw = ImageDraw.Draw(canvas)

    # 左右の書類
    cards = [(176, 232, 488, 792), (536, 232, 848, 792)]
    for box in cards:
        # 書類の影
        sh = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
        ImageDraw.Draw(sh).rounded_rectangle(
            [s(box[0]), s(box[1] + 10), s(box[2]), s(box[3] + 10)], radius=s(34), fill=(15, 25, 100, 90)
        )
        canvas = Image.alpha_composite(canvas, sh.filter(ImageFilter.GaussianBlur(s(10))))
        draw = ImageDraw.Draw(canvas)
        draw.rounded_rectangle([s(v) for v in box], radius=s(34), fill=(255, 255, 255, 255))

    # 各書類の行。3行目だけが左右で違う（左: 赤 / 右: 緑）
    grey = (196, 208, 236, 255)
    red, green = (255, 99, 92, 255), (46, 204, 140, 255)
    rows = [(0.0, 0.78), (1.0, 0.56), (2.0, None), (3.0, 0.7), (4.0, 0.46)]
    top, pitch, height = 300, 92, 44
    for ci, box in enumerate(cards):
        x0, x1 = box[0] + 40, box[2] - 40
        for index, frac in rows:
            y0 = top + index * pitch
            if frac is None:
                color = red if ci == 0 else green
                # 違う行は、帯の背景を薄く塗って目立たせる
                tint = (255, 226, 224, 255) if ci == 0 else (212, 247, 232, 255)
                draw.rounded_rectangle([s(box[0] + 16), s(y0 - 14), s(box[2] - 16), s(y0 + height + 14)], radius=s(18), fill=tint)
                draw.rounded_rectangle([s(x0), s(y0), s(x1 - 10), s(y0 + height)], radius=s(22), fill=color)
            else:
                draw.rounded_rectangle([s(x0), s(y0), s(x0 + (x1 - x0) * frac), s(y0 + height)], radius=s(22), fill=grey)

    # 中央: 左右を見比べる印（⇄）
    cx, cy = 512, 512
    white = (255, 255, 255, 255)
    ring = (44, 62, 214, 255)
    draw.ellipse([s(cx - 62), s(cy - 62), s(cx + 62), s(cy + 62)], fill=ring)
    draw.ellipse([s(cx - 62), s(cy - 62), s(cx + 62), s(cy + 62)], outline=white, width=s(10))
    for direction in (-1, 1):
        y = cy + direction * 16
        a, b = (cx - 30, cx + 30) if direction == -1 else (cx + 30, cx - 30)
        draw.line([s(a), s(y), s(b), s(y)], fill=white, width=s(10))
        tip = b
        sign = 1 if b > a else -1
        draw.polygon(
            [(s(tip + sign * 12), s(y)), (s(tip - sign * 4), s(y - 15)), (s(tip - sign * 4), s(y + 15))], fill=white
        )

    out = canvas.resize((SIZE, SIZE), Image.LANCZOS)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    out.save(OUT)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
