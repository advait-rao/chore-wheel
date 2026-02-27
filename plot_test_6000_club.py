#!/usr/bin/env python3
import csv
from html import escape
from pathlib import Path


INPUT_CSV = Path("/Users/advait/Code/chore-wheel/test_cricket_records.csv")
OUTPUT_SVG = Path("/Users/advait/Code/chore-wheel/test_6000_run_club_strike_rate_vs_debut_year.svg")


def to_int(text: str) -> int:
    return int(text.replace(",", "").replace("+", "").strip())


def to_float(text: str):
    cleaned = text.strip()
    if cleaned in {"", "-"}:
        return None
    return float(cleaned)


def linear_fit(xs, ys):
    n = len(xs)
    if n < 2:
        return None
    x_mean = sum(xs) / n
    y_mean = sum(ys) / n
    denom = sum((x - x_mean) ** 2 for x in xs)
    if denom == 0:
        return None
    slope = sum((x - x_mean) * (y - y_mean) for x, y in zip(xs, ys)) / denom
    intercept = y_mean - slope * x_mean
    return slope, intercept


rows = []
with INPUT_CSV.open(newline="", encoding="utf-8") as f:
    reader = csv.DictReader(f)
    for row in reader:
        runs = to_int(row["Runs"])
        sr = to_float(row["Strike Rate"])
        debut_year = int(row["Span"].split("-")[0])
        if runs >= 6000 and sr is not None:
            rows.append(
                {
                    "player": row["Player"],
                    "debut_year": debut_year,
                    "strike_rate": sr,
                    "pre_1990": debut_year < 1990,
                }
            )

modern = [r for r in rows if not r["pre_1990"]]
legacy = [r for r in rows if r["pre_1990"]]

width, height = 1180, 760
left, right, top, bottom = 90, 40, 70, 115
plot_w, plot_h = width - left - right, height - top - bottom

years = [r["debut_year"] for r in rows]
srs = [r["strike_rate"] for r in rows]
xmin, xmax = min(years) - 1, max(years) + 1
ymin = int(min(srs) // 5 * 5) - 2
ymax = int(max(srs) // 5 * 5) + 5


def x_to_px(x):
    return left + (x - xmin) / (xmax - xmin) * plot_w


def y_to_px(y):
    return top + (ymax - y) / (ymax - ymin) * plot_h


svg = []
add = svg.append
add(f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">')
add('<rect x="0" y="0" width="100%" height="100%" fill="#ffffff"/>')

for y in range(ymin, ymax + 1, 5):
    py = y_to_px(y)
    add(f'<line x1="{left}" y1="{py:.1f}" x2="{width-right}" y2="{py:.1f}" stroke="#e8edf3" stroke-width="1"/>')
    add(f'<text x="{left-12}" y="{py+4:.1f}" text-anchor="end" font-size="12" fill="#4b5563" font-family="Arial">{y}</text>')

for year in range((xmin // 5) * 5, xmax + 1, 5):
    if year < xmin or year > xmax:
        continue
    px = x_to_px(year)
    add(f'<line x1="{px:.1f}" y1="{top}" x2="{px:.1f}" y2="{height-bottom}" stroke="#f1f5f9" stroke-width="1"/>')
    add(
        f'<text x="{px:.1f}" y="{height-bottom+24}" text-anchor="middle" font-size="12" fill="#4b5563" font-family="Arial">{year}</text>'
    )

add(f'<line x1="{left}" y1="{height-bottom}" x2="{width-right}" y2="{height-bottom}" stroke="#334155" stroke-width="1.5"/>')
add(f'<line x1="{left}" y1="{top}" x2="{left}" y2="{height-bottom}" stroke="#334155" stroke-width="1.5"/>')

for r in modern:
    px = x_to_px(r["debut_year"])
    py = y_to_px(r["strike_rate"])
    add(f'<circle cx="{px:.1f}" cy="{py:.1f}" r="5.5" fill="#1f77b4" fill-opacity="0.78"/>')

for r in legacy:
    px = x_to_px(r["debut_year"])
    py = y_to_px(r["strike_rate"])
    add(
        f'<circle cx="{px:.1f}" cy="{py:.1f}" r="6" fill="none" stroke="#d95f02" stroke-width="1.8"/>'
    )

# Label each player; use simple offset + occupancy checks to reduce overlap.
label_offsets = [(8, -8), (8, 11), (-8, -8), (-8, 11), (14, 2), (-14, 2), (10, -14), (10, 16)]
occupied = set()
for idx, r in enumerate(sorted(rows, key=lambda x: (x["debut_year"], x["strike_rate"]))):
    px = x_to_px(r["debut_year"])
    py = y_to_px(r["strike_rate"])
    name = escape(r["player"])
    chosen = label_offsets[idx % len(label_offsets)]

    for dx, dy in label_offsets:
        lx = px + dx
        ly = py + dy
        cell = (int(lx // 16), int(ly // 12))
        if cell not in occupied:
            chosen = (dx, dy)
            occupied.add(cell)
            break

    dx, dy = chosen
    lx = px + dx
    ly = py + dy
    anchor = "start" if dx >= 0 else "end"
    add(
        f'<line x1="{px:.1f}" y1="{py:.1f}" x2="{lx:.1f}" y2="{ly:.1f}" '
        'stroke="#94a3b8" stroke-width="0.8" opacity="0.7"/>'
    )
    add(
        f'<text x="{lx:.1f}" y="{ly:.1f}" text-anchor="{anchor}" font-size="9.5" '
        'font-family="Arial" fill="#ffffff" stroke="#ffffff" stroke-width="2.5" paint-order="stroke">'
        f"{name}</text>"
    )
    add(
        f'<text x="{lx:.1f}" y="{ly:.1f}" text-anchor="{anchor}" font-size="9.5" '
        'font-family="Arial" fill="#111827">'
        f"{name}</text>"
    )

fit = linear_fit([r["debut_year"] for r in modern], [r["strike_rate"] for r in modern])
if fit is not None:
    slope, intercept = fit
    x1, x2 = min(r["debut_year"] for r in modern), max(r["debut_year"] for r in modern)
    y1, y2 = slope * x1 + intercept, slope * x2 + intercept
    add(
        f'<line x1="{x_to_px(x1):.1f}" y1="{y_to_px(y1):.1f}" '
        f'x2="{x_to_px(x2):.1f}" y2="{y_to_px(y2):.1f}" '
        'stroke="#1f77b4" stroke-width="2" stroke-dasharray="7 5" opacity="0.75"/>'
    )

add(
    '<text x="90" y="34" font-size="24" font-family="Arial" font-weight="700" fill="#111827">'
    "Test 6000+ Run Club: Strike Rate vs Debut Year</text>"
)
add(
    '<text x="90" y="55" font-size="13" font-family="Arial" fill="#475569">'
    "Pre-1990 players shown separately because ball-by-ball strike-rate coverage is incomplete in older records.</text>"
)

add(f'<text x="{left + plot_w/2:.1f}" y="{height-35}" text-anchor="middle" font-size="14" font-family="Arial" fill="#111827">Debut Year</text>')
add(
    f'<text x="24" y="{top + plot_h/2:.1f}" text-anchor="middle" font-size="14" font-family="Arial" fill="#111827" '
    'transform="rotate(-90 24 {mid})">'.replace("{mid}", f"{top + plot_h/2:.1f}")
    + "Career Strike Rate</text>"
)

legend_x = width - right - 365
legend_y = top + 8
add(f'<rect x="{legend_x}" y="{legend_y}" width="338" height="64" rx="8" fill="#f8fafc" stroke="#e2e8f0"/>')
add(f'<circle cx="{legend_x+18}" cy="{legend_y+22}" r="5.5" fill="#1f77b4" fill-opacity="0.78"/>')
add(
    f'<text x="{legend_x+34}" y="{legend_y+26}" font-size="12.5" font-family="Arial" fill="#1f2937">'
    "Debut in/after 1990</text>"
)
add(f'<circle cx="{legend_x+18}" cy="{legend_y+46}" r="6" fill="none" stroke="#d95f02" stroke-width="1.8"/>')
add(
    f'<text x="{legend_x+34}" y="{legend_y+50}" font-size="12.5" font-family="Arial" fill="#1f2937">'
    "Debut before 1990 (SR may be incomplete)</text>"
)

add(
    f'<text x="{width/2:.1f}" y="{height-10}" text-anchor="middle" font-size="11.5" font-family="Arial" fill="#6b7280">'
    "Source: TestCricket_Records.csv snapshot (March 2024, ESPN Statsguru-derived table).</text>"
)

add("</svg>")
OUTPUT_SVG.write_text("\n".join(svg), encoding="utf-8")
print(f"Saved: {OUTPUT_SVG}")
print(f"Players plotted: {len(rows)} (Modern: {len(modern)}, Pre-1990: {len(legacy)})")
