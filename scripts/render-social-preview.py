#!/usr/bin/env python3
"""Rasterize the existing site logo, not an author photo, for link unfurlers.

Requires the existing local SVG/Pillow toolchain, not an image-generation API.
The committed PNGs are copied at build time, so CI does not require Python
image libraries or fonts.
"""
from io import BytesIO
from pathlib import Path

import cairo
import gi
from PIL import Image, ImageDraw, ImageFont

gi.require_version("Rsvg", "2.0")
from gi.repository import Rsvg

ROOT = Path(__file__).resolve().parent.parent
DESTINATION = ROOT / "assets/social"
DESTINATION.mkdir(exist_ok=True)
surface = cairo.ImageSurface(cairo.FORMAT_ARGB32, 1024, 1024)
viewport = Rsvg.Rectangle()
viewport.x, viewport.y, viewport.width, viewport.height = 72, 120, 880, 784
handle = Rsvg.Handle.new_from_file(str(ROOT / "favicon.svg"))
assert handle.render_document(cairo.Context(surface), viewport)
buffer = BytesIO()
surface.write_to_png(buffer)
buffer.seek(0)
mark = Image.open(buffer).convert("RGBA")
mark.resize((512, 512), Image.Resampling.LANCZOS).save(
    DESTINATION / "morphazoid-mark-20260917.png", optimize=True)

card = Image.new("RGB", (1200, 630), "#080c13")
draw = ImageDraw.Draw(card)
logo = mark.resize((500, 500), Image.Resampling.LANCZOS)
card.paste(logo, (40, 58), logo)
fonts = Path("/usr/share/fonts/truetype/dejavu")
title = ImageFont.truetype(str(fonts / "DejaVuSans.ttf"), 68)
body = ImageFont.truetype(str(fonts / "DejaVuSans.ttf"), 28)
small = ImageFont.truetype(str(fonts / "DejaVuSans.ttf"), 20)
draw.text((553, 213), "Morphazoid", font=title, fill="#f3f1e7")
draw.text((557, 321), "Geometric instruments.", font=body, fill="#aebdd0")
draw.text((557, 365), "Sound experiments.", font=body, fill="#aebdd0")
draw.line((557, 171, 647, 171), fill="#00e5ff", width=5)
draw.text((557, 462), "morphazoid.com", font=small, fill="#8ee3be")
card.save(DESTINATION / "morphazoid-card-20260917.png", optimize=True)
print("Rendered a 1200×630 logo share card and a 512×512 transparent brand mark.")
