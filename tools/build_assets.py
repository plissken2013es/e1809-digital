"""Build the game's image copies: extracted/images/**/*.png -> assets/**/*.webp.

The PNG crops come from tools/extract_sources.py at full resolution (and tools/make_digital_art.py); the game only needs
smaller WebP copies. The JSON in src/data/ already points at these paths.

Usage: python -I tools/build_assets.py [--quality 82]
"""
import argparse
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "extracted" / "images"
DST = ROOT / "assets"

# longest side, in pixels, per top-level folder of extracted/images/cards and the rest
MAX_SIDE = {"actions": 480, "tactics": 560, "units": 1100, "backs": 560, "board": 3600, "cover.png": 1000, "icons": 256}


def max_side(rel):
    parts = rel.parts
    return MAX_SIDE[parts[1] if parts[0] == "cards" else parts[0]]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quality", type=int, default=82)
    args = ap.parse_args()

    total = 0
    for png in sorted(SRC.rglob("*.png")):
        rel = png.relative_to(SRC)
        out = (DST / rel).with_suffix(".webp")
        img = Image.open(png)
        img = img.convert("RGBA" if img.mode in ("RGBA", "LA") else "RGB")  # icons keep their transparency
        img.thumbnail((max_side(rel), max_side(rel)), Image.LANCZOS)
        out.parent.mkdir(parents=True, exist_ok=True)
        img.save(out, "WEBP", quality=args.quality, method=6)
        total += out.stat().st_size
    print(f"{len(list(DST.rglob('*.webp')))} images, {total / 1e6:.1f} MB in {DST.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
