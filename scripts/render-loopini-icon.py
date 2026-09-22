#!/usr/bin/env python3
"""Original Loopini icon: six friendly recording rings, matching its native UI."""
from pathlib import Path
from io import BytesIO
import math
import cairo
import gi
from PIL import Image

gi.require_version("Rsvg", "2.0")
from gi.repository import Rsvg
root = Path(__file__).resolve().parent.parent
colors = ["#ffaf8e", "#8cdac7", "#c2b1f1", "#f1ce7e", "#88c9ef", "#f0accc"]
shapes = []
for i, color in enumerate(colors):
    x, y = 94 + (i % 3) * 162, 165 + (i // 3) * 182
    shapes.append(f'<circle cx="{x}" cy="{y}" r="70" fill="#101b28" stroke="{color}" stroke-width="9"/>')
    shapes.append(f'<circle cx="{x-17}" cy="{y-8}" r="6" fill="{color}"/><circle cx="{x+17}" cy="{y-8}" r="6" fill="{color}"/>')
    shapes.append(f'<path d="M{x-22} {y+15}Q{x} {y+38} {x+22} {y+15}" fill="none" stroke="{color}" stroke-width="7" stroke-linecap="round"/>')
    angle = -1.25 + i * .65
    shapes.append(f'<circle cx="{x+70*math.cos(angle):.2f}" cy="{y+70*math.sin(angle):.2f}" r="10" fill="{color}"/>')
svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><title>Loopini</title>' + "".join(shapes) + '</svg>\n'
(root / "artwork/loopini.svg").write_text(svg)
surface = cairo.ImageSurface(cairo.FORMAT_ARGB32, 1024, 1024)
rect = Rsvg.Rectangle(); rect.x = rect.y = 0; rect.width = rect.height = 1024
Rsvg.Handle.new_from_data(svg.encode()).render_document(cairo.Context(surface), rect)
buffer = BytesIO(); surface.write_to_png(buffer); buffer.seek(0)
Image.open(buffer).convert("RGBA").resize((512, 512), Image.Resampling.LANCZOS).save(root / "assets/instruments/loopini.webp", "WEBP", lossless=True, method=6)
print("Rendered original Loopini icon.")
