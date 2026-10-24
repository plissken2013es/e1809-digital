"""Builds rules.html: the v1.6c rulebook as a web page (index, the game's images) plus an appendix with
the clarifications confirmed for the digital version (the rows marked ✔ in docs/01 §14).

The text comes from the PDF (all of it in one font size): headings are the lines «N.N. TITLE» in capitals,
lists the lines with a marker (● ○ ➔ ❖, «1.», «a.») and their indentation; the rest is joined into
paragraphs. Run it again when the rulebook or the decisions change.

Usage: python -I tools/build_rules_page.py
"""
import html
import re
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parent.parent
PDF = ROOT / "__ProyectoTipoFreemansFarm" / "Reglas Elviña 1809_v1.6b.pdf"
DOC = ROOT / "docs" / "01-reglas-y-mecanicas.md"
OUT = ROOT / "rules.html"

MARKERS = "●○➔❖■▪"
HEADING = re.compile(r"^(\d+(?:\.\d+)*)\.\s+(.+)$")

# Images of the game placed after a section heading: (section, src, caption, css class)
FIGURES = {
    "3.1": [("assets/board/map.webp", "El tablero ilustrado (versión de 2026).", "wide")],
    "3.2": [("assets/cards/units/hill.webp", "Tarjeta de Unidad: órdenes, dados, modificadores y pista de moral.", "half"),
            ("assets/cards/units/moore.webp", "Tarjeta de Sir John Moore con la Senda del Sacrificio.", "half")],
    "3.3": [("assets/cards/actions/paget-2.webp", "Carta de Acción: la Unidad, los cubos de Inercia y el caballo de Moore.", "card")],
    "3.4": [("assets/cards/tactics/reagrupacion.webp", "Carta de Táctica: coste, efecto y momento de juego.", "card")],
}


def lines_of(pdf):
    """Lines of text in reading order: (x, y, html) with bold and italics kept."""
    out = []
    for page in fitz.open(pdf):
        for block in page.get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                y = line["bbox"][1]
                if y < 50:  # page header
                    continue
                text = ""
                for s in line["spans"]:
                    t = s["text"].replace("​", "")
                    if not t:
                        continue
                    e = html.escape(t)
                    if t.strip() and "Bold" in s["font"]:
                        e = f"<strong>{e}</strong>"
                    elif t.strip() and "Italic" in s["font"]:
                        e = f"<em>{e}</em>"
                    text += e
                out.append((round(line["bbox"][0]), round(line["bbox"][2]), text))
    return out


def plain(t):
    return re.sub(r"<[^>]+>", "", html.unescape(t)).strip()


def parse(lines):
    """Blocks: ('h', level, number, title) · ('p', html) · ('li', level, html)."""
    blocks = []
    cur = None  # the block being filled: ['p', html, x, right] or ['li', level, html, contx]
    skip_title = 2
    for x, right, t in lines:
        p = plain(t)
        if skip_title and p.startswith(("ELVIÑA 1809 - Reglas", "v1.6c")):
            skip_title -= 1
            continue
        if not p:
            cur = None
            continue
        m = HEADING.match(p)
        if m and x <= 80 and not re.search(r"[a-záéíóúñ]", m.group(2)):
            blocks.append(["h", m.group(1).count(".") + 1, m.group(1), m.group(2).rstrip(".")])
            cur = None
            continue
        marker = p[0] in MARKERS
        numbered = re.match(r"^(\d+|[a-z])\.\s", p) and x > 80
        summary_item = x == 104  # the list of components has no markers
        if marker or numbered or summary_item:
            level = 1 if x < 115 else 2
            body = re.sub(r"^\s*(<strong>)?[" + MARKERS + r"]\s*", r"\1", t).strip()
            cur = ["li", level, body, x + 14]
            blocks.append(cur)
            continue
        if cur and cur[0] == "li" and x >= cur[3]:  # an item going on
            cur[2] += " " + t.strip()
            continue
        # paragraph text: a new paragraph after a short line that ended a sentence
        if cur and cur[0] == "p":
            prev = plain(cur[1])
            short = cur[3] < cur[4] - 40
            if not (prev.endswith((".", ":", "»", "”", ")")) and short):
                cur[1] += " " + t.strip()
                cur[3] = right
                cur[4] = max(cur[4], right)
                continue
        cur = ["p", t.strip(), x, right, max(right, 520 if x < 100 else right)]
        blocks.append(cur)
    return blocks


# Words that keep their capital in the headings (the rulebook writes them so in the text)
PROPER = ["Sir John Moore", "Jean de Dieu Soult", "Moore", "Soult", "Elviña", "Palavea", "Acción", "Táctica",
          "Tácticas", "Inercia de Combate", "Moral", "Cohesión", "División"]


def heading_case(title):
    """«CARTAS DE ACCIÓN» → «Cartas de Acción»; after a full stop, a capital again."""
    t = title.lower()
    t = re.sub(r"(^|\.\s+)(\w)", lambda m: m.group(1) + m.group(2).upper(), t)
    for w in PROPER:
        t = re.sub(r"(?<!\w)" + re.escape(w) + r"(?!\w)", w, t, flags=re.IGNORECASE)
    return t


def slug(num):
    return "s" + num.replace(".", "-")


def render(blocks):
    """HTML body and index."""
    body, toc = [], []
    open_lists = []  # levels of the open <ul>

    def close_lists(to=0):
        while len(open_lists) > to:
            body.append("</li></ul>" if open_lists.pop() else "</ul>")

    for b in blocks:
        if b[0] != "li":
            close_lists()
        if b[0] == "h":
            _, level, num, title = b
            tag = {1: "h2", 2: "h3"}.get(level, "h4")
            title = heading_case(title) if title.isupper() else title
            body.append(f'<{tag} id="{slug(num)}">{num}. {title}</{tag}>')
            if level <= 2:
                toc.append((level, num, title))
            for src, caption, cls in FIGURES.get(num, []):
                body.append(f'<figure class="{cls}"><img src="{src}" alt="" loading="lazy"><figcaption>{caption}</figcaption></figure>')
        elif b[0] == "p":
            if plain(b[1]).rstrip(":") == "BIBLIOGRAFÍA":
                body.append('<h3 id="bibliografia">Bibliografía</h3>')
            else:
                body.append(f"<p>{b[1]}</p>")
        else:
            level, text = b[1], b[2]
            if len(open_lists) < level:
                while len(open_lists) < level:
                    body.append("<ul>")
                    open_lists.append(False)
            else:
                close_lists(level)
                body.append("</li>")
            num = re.match(r"^(<strong>)?(\d+|[a-z])\.\s", text)
            body.append(f'<li class="num">{text}' if num else f"<li>{text}")
            open_lists[-1] = True
    close_lists()
    html_body = "\n".join(body).replace("</li></li>", "</li>")
    return html_body, toc


def md_inline(t):
    t = html.escape(t)
    t = re.sub(r"`([^`]+)`", r"<code>\1</code>", t)
    t = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", t)
    t = re.sub(r"\*([^*]+)\*", r"<em>\1</em>", t)
    t = re.sub(r"\[(D-\d+)\]", r"\1", t)
    return t


def decisions():
    """Confirmed decisions (✔) of docs/01 §14: (id, question, decision)."""
    out = []
    for line in DOC.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^\| (D-\d+) \| (.+?) \| (.+) \|$", line)
        if m and "✔" in m.group(3):
            out.append((m.group(1), md_inline(m.group(2)), md_inline(m.group(3).replace("✔", "").strip())))
    return out


PAGE = """<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Elviña 1809 — Reglamento</title>
<meta name="description" content="Reglamento de Elviña 1809 (v1.6c) con las aclaraciones de la versión digital.">
<link rel="icon" type="image/png" sizes="32x32" href="assets/icons/favicon-32.png">
<link rel="apple-touch-icon" href="assets/icons/favicon-180.png">
<style>
:root {{ --paper: #f6f0e2; --ink: #2a2622; --muted: #6d655b; --line: #d9ccb2; --accent: #7a1d14; --blue: #1f3d6b; color-scheme: light; }}
* {{ box-sizing: border-box; }}
img {{ max-width: 100%; height: auto; }}
html {{ scroll-behavior: smooth; scroll-padding-top: 16px; }}
body {{ margin: 0; background: #e9e0cc; color: var(--ink); font: 17px/1.6 Georgia, "Times New Roman", serif; }}
.page {{ display: grid; grid-template-columns: 270px minmax(0, 1fr); max-width: 1200px; margin: 0 auto; gap: 28px; padding: 24px 16px; }}
nav {{ position: sticky; top: 16px; align-self: start; max-height: calc(100vh - 32px); overflow: auto; font: 14px/1.45 "Segoe UI", system-ui, sans-serif; padding: 14px; background: var(--paper); border: 1px solid var(--line); border-radius: 8px; }}
nav a {{ display: block; color: var(--ink); text-decoration: none; padding: 2px 4px; border-radius: 4px; }}
nav a:hover {{ background: #eadfc6; }}
nav a.l2 {{ padding-left: 16px; color: var(--muted); }}
nav b {{ display: block; margin-bottom: 6px; font: 700 12px/1 "Segoe UI", sans-serif; letter-spacing: .12em; text-transform: uppercase; color: var(--accent); }}
main {{ background: var(--paper); border: 1px solid var(--line); border-radius: 8px; padding: 34px 44px; box-shadow: 0 6px 30px #0002; }}
header.title {{ display: grid; grid-template-columns: 150px 1fr; gap: 24px; align-items: center; margin-bottom: 18px; }}
header.title img {{ border-radius: 6px; box-shadow: 0 4px 14px #0004; }}
h1 {{ font-size: 44px; line-height: 1.05; margin: 0 0 6px; }}
.kicker {{ font: 700 12px/1 "Segoe UI", sans-serif; letter-spacing: .14em; text-transform: uppercase; color: var(--accent); margin: 0 0 10px; }}
h2 {{ margin: 38px 0 10px; padding-bottom: 6px; border-bottom: 2px solid var(--accent); color: var(--accent); font-size: 26px; }}
h3 {{ margin: 26px 0 8px; font-size: 20px; color: var(--blue); }}
h4 {{ margin: 20px 0 6px; font-size: 17px; }}
p {{ margin: 0 0 12px; }}
ul {{ margin: 0 0 12px; padding-left: 26px; }}
li {{ margin: 3px 0; }}
li.num {{ list-style: none; margin-left: -18px; }}
figure {{ margin: 12px 0 18px; }}
figure img {{ display: block; max-width: 100%; border-radius: 6px; box-shadow: 0 3px 12px #0003; }}
figure.half {{ display: inline-block; width: calc(50% - 8px); vertical-align: top; margin-right: 12px; }}
figure.card {{ max-width: 200px; }}
figcaption {{ font: 13px/1.4 "Segoe UI", sans-serif; color: var(--muted); margin-top: 6px; }}
.note {{ font: 14px/1.5 "Segoe UI", sans-serif; background: #efe4cb; border-left: 4px solid var(--accent); padding: 10px 14px; border-radius: 4px; margin: 0 0 18px; }}
table {{ width: 100%; border-collapse: collapse; font: 14px/1.45 "Segoe UI", sans-serif; margin: 6px 0 20px; }}
th, td {{ text-align: left; vertical-align: top; padding: 7px 9px; border-bottom: 1px solid var(--line); overflow-wrap: anywhere; }}
th {{ background: #ece1c7; }}
td:first-child {{ white-space: nowrap; font-weight: 700; color: var(--accent); }}
code {{ font: 13px "Cascadia Mono", Consolas, monospace; background: #ece1c7; padding: 1px 4px; border-radius: 3px; }}
footer {{ margin-top: 30px; font: 13px "Segoe UI", sans-serif; color: var(--muted); }}
@media (max-width: 860px) {{
  .page {{ grid-template-columns: 1fr; }}
  nav {{ position: static; max-height: none; }}
  main {{ padding: 22px 18px; }}
  header.title {{ grid-template-columns: 90px 1fr; }}
  h1 {{ font-size: 32px; }}
  figure.half {{ width: 100%; margin-right: 0; }}
}}
</style>
</head>
<body>
<div class="page">
<nav aria-label="Índice">
<b>Índice</b>
{toc}
<a href="#digital">Aclaraciones de la versión digital</a>
</nav>
<main>
<header class="title">
<img src="assets/cover.webp" alt="Portada de Elviña 1809">
<div>
<p class="kicker">Reglas e historia · v1.6c</p>
<h1>Elviña 1809</h1>
<p>Texto del reglamento del diseñador. Las aclaraciones confirmadas para la versión digital están al final.</p>
</div>
</header>
{body}
<h2 id="digital">Aclaraciones de la versión digital</h2>
<p class="note">Casos que el reglamento no resuelve del todo, decididos con el diseñador para el prototipo y aplicados en la partida digital. La lista completa, con las propuestas pendientes y las opciones de reglas, está en <code>docs/01-reglas-y-mecanicas.md</code>.</p>
<table>
<thead><tr><th>Id</th><th>Duda</th><th>Cómo se juega</th></tr></thead>
<tbody>
{decisions}
</tbody>
</table>
<footer>Generado por <code>tools/build_rules_page.py</code> a partir de <code>Reglas Elviña 1809_v1.6b.pdf</code> y de <code>docs/01-reglas-y-mecanicas.md</code>.</footer>
</main>
</div>
</body>
</html>
"""


def main():
    body, toc = render(parse(lines_of(PDF)))
    toc_html = "\n".join(f'<a class="l{level}" href="#{slug(num)}">{num}. {title}</a>' for level, num, title in toc)
    rows = "\n".join(f"<tr><td>{i}</td><td>{q}</td><td>{d}</td></tr>" for i, q, d in decisions())
    OUT.write_text(PAGE.format(toc=toc_html, body=body, decisions=rows), encoding="utf-8")
    print(f"{OUT.relative_to(ROOT)}: {len(body) // 1000} kB of text, {len(toc)} index entries, {rows.count('<tr>')} clarifications")


if __name__ == "__main__":
    main()
