#!/usr/bin/env python3
"""Render Wobblini's original eight-platter vector artwork into its catalogue icon."""
from pathlib import Path
import math
import subprocess
import tempfile

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
COLORS = ["#c8f36b", "#7be3c5", "#f9a66b", "#bba3ff"]
parts = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">',
    '<title>Wobblini: eight decks and a shared waveform</title>',
    '<rect width="512" height="512" rx="36" fill="#111619"/>',
]
for row in range(2):
    for col in range(4):
        x, y = 82 + col * 116, 124 + row * 240
        color = COLORS[col]
        # Audio from each visibly distinct platter converges into the wobble bus.
        end_y = 225 if row == 0 else 287
        parts.append(f'<path d="M{x} {y + (48 if row == 0 else -48)} Q{x} {end_y} 256 {end_y}" stroke="{color}" stroke-width="3" opacity=".33" fill="none"/>')
        parts.append(f'<circle cx="{x}" cy="{y}" r="49" fill="#080e12" stroke="{color}" stroke-width="4"/>')
        for radius, opacity in [(41, .2), (33, .28), (25, .5)]:
            parts.append(f'<circle cx="{x}" cy="{y}" r="{radius}" stroke="{color}" stroke-width="1.5" fill="none" opacity="{opacity}"/>')
        angle = (col * .85 + row * 1.8) - .6
        xx, yy = x + 44 * math.cos(angle), y + 44 * math.sin(angle)
        parts.append(f'<path d="M{x} {y}L{xx:.2f} {yy:.2f}" stroke="{color}" stroke-width="3" stroke-linecap="round"/>')
        parts.append(f'<circle cx="{x}" cy="{y}" r="14" fill="{color}"/>')
        parts.append(f'<circle cx="{x}" cy="{y}" r="4" fill="#111619"/>')
        parts.append(f'<circle cx="{xx:.2f}" cy="{yy:.2f}" r="5.5" fill="{color}"/>')
points = []
for i in range(361):
    x = 76 + i
    phase = i / 360 * math.tau * 3
    y = 256 + math.sin(phase) * (10 + 17 * math.sin(i / 360 * math.pi) ** 2)
    points.append(f'{x:.2f},{y:.2f}')
parts.append(f'<polyline points="{" ".join(points)}" fill="none" stroke="#c8f36b" stroke-width="6" stroke-linecap="round"/>')
parts.append('<path d="M116 452H396" stroke="#4f6066" stroke-width="7" stroke-linecap="round"/>')
parts.append('<rect x="239" y="438" width="34" height="28" rx="5" fill="#edf3e8"/>')
parts.append('<path d="M256 443V461" stroke="#111619" stroke-width="3"/>')
parts.append('</svg>')
svg = "\n".join(parts) + "\n"
art = ROOT / "artwork/wobblini.svg"
art.parent.mkdir(exist_ok=True)
art.write_text(svg)
with tempfile.TemporaryDirectory(prefix="wobblini-icon-") as directory:
    png = Path(directory) / "icon.png"
    subprocess.run([
        "convert", "-background", "#111619", "-density", "192", str(art),
        "-resize", "1024x1024", str(png),
    ], check=True, capture_output=True)
    icon = Image.open(png).convert("RGB").resize((512, 512), Image.Resampling.LANCZOS)
    icon.save(ROOT / "assets/instruments/wobblini.webp", "WEBP", lossless=True, method=6)
