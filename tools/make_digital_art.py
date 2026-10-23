"""Pieces made for the digital version from the designer's art (run after tools/extract_sources.py):

  extracted/images/icons/horse.png               the red horse of the Action cards, as a white silhouette
                                                  (Moore's token on the map)
  extracted/images/cards/backs/action_*_digital.png   backs for the Action cards: the printed ones are
                                                  white placeholders. British dark red with Moore, French
                                                  navy with Soult (the 2026 commander art), gold frame.

Then python -I tools/build_assets.py makes the WebP copies.

Usage: python -I tools/make_digital_art.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
IMG = ROOT / "extracted" / "images"
FONTS = Path("C:/Windows/Fonts")
GOLD = (217, 169, 78)
GOLD_DARK = (120, 86, 30)

SIDES = {
    # colours of the background (top, bottom), the commander and the part of his card that shows him
    "british": {"top": (122, 30, 22), "bottom": (48, 10, 8), "card": "moore", "crop": (1300, 72, 1680, 500), "word": "BRITÁNICA"},
    "french": {"top": (36, 70, 128), "bottom": (12, 26, 54), "card": "soult", "crop": (1235, 40, 1635, 490), "word": "FRANCESA"},
}
W, H = 661, 1027  # the Action cards


def font(name, size):
    try:
        return ImageFont.truetype(str(FONTS / name), size)
    except OSError:
        return ImageFont.load_default(size)


def horse_icon():
    """The red horse of paget-2 (top-left corner), turned into a white silhouette on transparency."""
    card = Image.open(IMG / "cards" / "actions" / "paget-2.png").convert("RGB")
    area = card.crop((40, 30, 180, 125))
    alpha = Image.new("L", area.size, 0)
    src, dst = area.load(), alpha.load()
    for y in range(area.height):
        for x in range(area.width):
            r, g, b = src[x, y]
            redness = r - max(g, b)  # the icon is pure red on a pale pink sky
            dst[x, y] = max(0, min(255, (redness - 60) * 3))
    alpha = alpha.crop(alpha.getbbox())
    icon = Image.new("RGBA", alpha.size, (255, 255, 255, 0))
    icon.putalpha(alpha)
    big = icon.resize((icon.width * 3, icon.height * 3), Image.LANCZOS)
    out = IMG / "icons" / "horse.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    big.save(out)
    return out


def gradient(top, bottom):
    img = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(img)
    for y in range(H):
        t = y / (H - 1)
        d.line([(0, y), (W, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(top, bottom)))
    return img


def back(side, spec):
    img = gradient(spec["top"], spec["bottom"]).convert("RGBA")
    d = ImageDraw.Draw(img)
    # fine diagonal hatching, like engraved paper
    hatch = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    hd = ImageDraw.Draw(hatch)
    for x in range(-H, W, 14):
        hd.line([(x, 0), (x + H, H)], fill=(255, 255, 255, 10), width=2)
    img = Image.alpha_composite(img, hatch)
    d = ImageDraw.Draw(img)
    # double gold frame with corner squares
    for inset, width in ((22, 6), (38, 2)):
        d.rounded_rectangle([inset, inset, W - inset, H - inset], radius=18, outline=GOLD, width=width)
    for cx, cy in ((38, 38), (W - 38, 38), (38, H - 38), (W - 38, H - 38)):
        d.rectangle([cx - 9, cy - 9, cx + 9, cy + 9], fill=GOLD)
        d.rectangle([cx - 4, cy - 4, cx + 4, cy + 4], fill=spec["bottom"])
    # the commander in an oval medallion
    portrait = Image.open(IMG / "cards" / "units" / f"{spec['card']}.png").convert("RGBA").crop(spec["crop"])
    mw, mh = 400, 450
    portrait = portrait.resize((mw, mh), Image.LANCZOS)
    mask = Image.new("L", (mw, mh), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, mw - 1, mh - 1], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(1.2))
    mx, my = (W - mw) // 2, 200
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).ellipse([mx - 4, my + 10, mx + mw + 4, my + mh + 18], fill=(0, 0, 0, 150))
    img = Image.alpha_composite(img, shadow.filter(ImageFilter.GaussianBlur(10)))
    img.paste(portrait, (mx, my), mask)
    d = ImageDraw.Draw(img)
    d.ellipse([mx - 8, my - 8, mx + mw + 8, my + mh + 8], outline=GOLD, width=7)
    d.ellipse([mx - 16, my - 16, mx + mw + 16, my + mh + 16], outline=GOLD_DARK, width=2)
    # titles
    def centred(text, y, size, fill=GOLD, name="georgiab.ttf", spacing=0):
        f = font(name, size)
        if spacing:
            widths = [d.textlength(ch, font=f) for ch in text]
            x = (W - sum(widths) - spacing * (len(text) - 1)) / 2
            for ch, w in zip(text, widths):
                d.text((x + 2, y + 2), ch, font=f, fill=(0, 0, 0))
                d.text((x, y), ch, font=f, fill=fill)
                x += w + spacing
            return
        w = d.textlength(text, font=f)
        d.text(((W - w) / 2 + 2, y + 2), text, font=f, fill=(0, 0, 0))
        d.text(((W - w) / 2, y), text, font=f, fill=fill)
    centred("ELVIÑA", 72, 64, spacing=6)
    centred("1809", 140, 38, spacing=10)
    d.line([(150, 700), (W - 150, 700)], fill=GOLD, width=2)
    centred("ACCIÓN", 730, 52, spacing=8)
    centred(spec["word"], 800, 52, spacing=8)
    d.line([(150, 880), (W - 150, 880)], fill=GOLD, width=2)
    out = IMG / "cards" / "backs" / f"action_{side}_digital.png"
    img.convert("RGB").save(out)
    return out


def main():
    print(horse_icon().relative_to(ROOT))
    for side, spec in SIDES.items():
        print(back(side, spec).relative_to(ROOT))


if __name__ == "__main__":
    main()
