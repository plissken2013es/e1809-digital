"""Extract the game's images and the Tactic card texts from the designer's material.

Sources (all under __ProyectoTipoFreemansFarm/, the most recent version of each):
  render/versión Tabletopia/*.jpg       card sheets without bleed (3x3 cards, 2x2 unit cards), backs
  __reordenado para IA/A2_color_mapa_C1809.pdf     illustrated board (2026-02)
  __reordenado para IA/A4_color_comandantes.pdf    Moore and Soult cards, new art (2026-02)
  __reordenado para IA/A4_color_cartas_tacticas_*.pdf   Tactic cards with a real text layer
  PortadaReglas.jpg                     rulebook cover

Output:
  extracted/images/**.png       full-resolution crops (tools/build_assets.py makes the WebP copies)
  extracted/tactics_raw.json    name, cost, text and timing of the 36 Tactic cards, read from the PDFs;
                                src/data/tactics.json (hand-curated) must keep the same texts (tests/data.test.js)

Usage: python -I tools/extract_sources.py
"""
import json
import re
import unicodedata
from pathlib import Path

import fitz
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "__ProyectoTipoFreemansFarm"
TT = SRC / "render" / "versión Tabletopia"
NEW = SRC / "__reordenado para IA"
OUT = ROOT / "extracted" / "images"

# Action card sheets, row by row (3x3); None = empty cell. Ids are <unit>-<n> in sheet order.
ACTION_SHEETS = {
    "cartas_accion_inglesas_1.jpg": ["paget-1", "paget-2", "hill-1", "hill-2", "hill-3", "bentinck-1", "bentinck-2", "bentinck-3", "bentinck-4"],
    "cartas_accion_inglesas_2.jpg": [None, "reserva-1", "reserva-2", None, None, "manningham_leith-1", "manningham_leith-2", "manningham_leith-3", "manningham_leith-4"],
    "cartas_accion_francesas_1.jpg": ["artilleria-1", "artilleria-2", "delaborde-1", "delaborde-2", "delaborde-3", "merle-1", "merle-2", "merle-3", "merle-4"],
    "cartas_accion_francesas_2.jpg": [None, "la_houssaye-1", "la_houssaye-2", None, None, "mermet-1", "mermet-2", "mermet-3", "mermet-4"],
}
# Unit card sheets, row by row (2x2)
UNIT_SHEETS = {
    "tarjetas_inglesas.jpg": ["hill", "bentinck", "paget", "manningham_leith"],
    "tarjetas_inglesas_bis.jpg": ["reserva", None, None, None],
    "tarjetas_francesas.jpg": ["mermet", "delaborde", "merle", "la_houssaye"],
    "tarjetas_francesas_bis.jpg": ["artilleria", None, None, None],
}
BACKS = {"back_accion_inglesa.jpg": "action_british", "back_accion_francesa.jpg": "action_french",
         "back_tacticas.jpg": "tactics", "tarjetas_inglesas_back.jpg": "unit_british",
         "tarjetas_francesas_back.jpg": "unit_french"}


def slug(name):
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "_", s).strip("_")


def grid(img, cols, rows):
    w, h = img.width / cols, img.height / rows
    for i in range(cols * rows):
        r, c = divmod(i, cols)
        yield i, img.crop((round(c * w), round(r * h), round((c + 1) * w), round((r + 1) * h)))


def save(img, rel):
    path = OUT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    img.convert("RGB").save(path)


def page_image(pdf):
    """The single full-page raster image of a PDF page."""
    doc = fitz.open(pdf)
    xref = doc[0].get_image_info(xrefs=True)[0]["xref"]
    pix = fitz.Pixmap(doc, xref)
    if pix.n - pix.alpha > 3:
        pix = fitz.Pixmap(fitz.csRGB, pix)
    return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)


def content_bands(img, axis, threshold=245, min_len=50):
    """Runs of rows (axis=1) or columns (axis=0) that are not blank white."""
    g = img.convert("L")
    w, h = g.size
    px = g.load()
    n = h if axis == 1 else w
    step = 4
    ink = []
    for i in range(n):
        line = [px[j, i] if axis == 1 else px[i, j] for j in range(0, w if axis == 1 else h, step)]
        ink.append(sum(1 for v in line if v < threshold) > len(line) * 0.05)
    bands, start = [], None
    for i, v in enumerate(ink + [False]):
        if v and start is None:
            start = i
        elif not v and start is not None:
            if i - start >= min_len:
                bands.append((start, i))
            start = None
    return bands


def extract_cards():
    for sheet, ids in ACTION_SHEETS.items():
        for i, crop in grid(Image.open(TT / sheet), 3, 3):
            if ids[i]:
                save(crop, f"cards/actions/{ids[i]}.png")
    for sheet, ids in UNIT_SHEETS.items():
        for i, crop in grid(Image.open(TT / sheet), 2, 2):
            if ids[i]:
                save(crop, f"cards/units/{ids[i]}.png")
    for src, name in BACKS.items():
        save(Image.open(TT / src), f"cards/backs/{name}.png")

    # Commanders: two cards stacked on an A4 page
    page = page_image(NEW / "A4_color_comandantes.pdf")
    for (y0, y1), name in zip(content_bands(page, 1), ["moore", "soult"]):
        band = page.crop((0, y0, page.width, y1))
        (x0, x1), = content_bands(band, 0)
        save(band.crop((x0, 0, x1, band.height)), f"cards/units/{name}.png")

    save(page_image(NEW / "A2_color_mapa_C1809.pdf"), "board/map.png")
    save(Image.open(SRC / "PortadaReglas.jpg"), "cover.png")


def tactic_cells(pdf):
    """Text lines of each 3x3 cell of a Tactic sheet PDF: {(row, col): [(y, x, size, bold, text)]}."""
    page = fitz.open(pdf)[0]
    W, H = page.rect.width, page.rect.height
    # Cards sit on a 3x3 grid between the cut marks (53 pt margins, 159 x 246.5 pt cells)
    x_cuts = [53 + 158.7 * i for i in range(4)]
    y_cuts = [53 + 246.4 * i for i in range(4)]
    cells, seen = {}, set()
    for b in page.get_text("dict")["blocks"]:
        for line in b.get("lines", []):
            text = "".join(s["text"] for s in line["spans"]).strip()
            x0, y0, x1, y1 = line["bbox"]
            key = (round(x0), round(y0), text)
            if not text or key in seen:  # one line is duplicated in the PDF
                continue
            seen.add(key)
            cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
            col = next(i for i in range(3) if x_cuts[i] <= cx < x_cuts[i + 1])
            row = next(i for i in range(3) if y_cuts[i] <= cy < y_cuts[i + 1])
            span = line["spans"][0]
            cells.setdefault((row, col), []).append((y0, x0, span["size"], "Bold" in span["font"], text))
    assert W > 590 and H > 840
    return cells


def parse_tactic(lines):
    lines.sort()
    cost_line = next(l for l in lines if l[2] > 20)
    name = " ".join(l[4] for l in lines if l[2] < 20 and l[0] < cost_line[0] + 6)
    rest = [l for l in lines if l[2] < 20 and l[0] >= cost_line[0] + 6]
    permanent = any(l[4] == "~PERMANENTE~" for l in rest)
    rest = [l for l in rest if l[4] != "~PERMANENTE~"]
    # The timing is the last block, separated from the effect text by a gap wider than one line
    split = len(rest)
    for i in range(len(rest) - 1, 0, -1):
        if rest[i][0] - rest[i - 1][0] > 16:
            split = i
            break
    join = lambda ls: re.sub(r"\s+", " ", " ".join(l[4] for l in ls)).strip()
    return {"name": name, "cost": int(cost_line[4]), "permanent": permanent,
            "text": join(rest[:split]), "timing": join(rest[split:])}


def extract_tactics():
    out = []
    for n in range(1, 5):
        cells = tactic_cells(NEW / f"A4_color_cartas_tacticas_{n}.pdf")
        img = Image.open(TT / f"cartas_tacticas_{n}.jpg")
        crops = dict(grid(img, 3, 3))
        for (row, col) in sorted(cells):
            card = parse_tactic(cells[(row, col)])
            card["id"] = slug(card["name"])
            save(crops[row * 3 + col], f"cards/tactics/{card['id']}.png")
            out.append({"id": card["id"], "sheet": n, "cell": [row, col], **card})
    path = ROOT / "extracted" / "tactics_raw.json"
    path.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return out


def main():
    extract_cards()
    tactics = extract_tactics()
    print(f"{len(list(OUT.rglob('*.png')))} images in {OUT.relative_to(ROOT)}, {len(tactics)} tactic cards")


if __name__ == "__main__":
    main()
