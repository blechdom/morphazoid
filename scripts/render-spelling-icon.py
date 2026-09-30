#!/usr/bin/env python3
"""Render Spelling's original wireframe mouth + letter icon from its native model.

Uses the same optional authoring tools as render-loopini-icon.py (Node, Cairo,
GObject/Rsvg and Pillow). No runtime dependency or external artwork is added.
"""
from pathlib import Path
from io import BytesIO
import json
import subprocess
import cairo
import gi
from PIL import Image

gi.require_version("Rsvg", "2.0")
from gi.repository import Rsvg

root = Path(__file__).resolve().parent.parent
paths = json.loads(subprocess.check_output([
    "node", "--input-type=module", "-e",
    "import {spellingMouthPaths} from './src/instruments/spelling-synthesizer/spelling-mouth.js';"
    "console.log(JSON.stringify(spellingMouthPaths({open:.72,width:1.08,round:.08,tongue:.14,teeth:.25})));",
], cwd=root, text=True))
svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="512" height="512">
<title>Spelling Synthesizer — wireframe mouth speaking A</title>
<defs>
  <radialGradient id="air"><stop stop-color="#194854" stop-opacity=".65"/><stop offset="1" stop-color="#071014" stop-opacity="0"/></radialGradient>
  <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="9"/></filter>
  <linearGradient id="wire" x2="0" y2="1"><stop stop-color="#b6fbff"/><stop offset=".5" stop-color="#64dfff"/><stop offset="1" stop-color="#62bccc"/></linearGradient>
</defs>
<ellipse cx="500" cy="570" rx="470" ry="380" fill="url(#air)"/>
<g transform="translate(-25 150) scale(1.05 1.55)" stroke-linejoin="round" stroke-linecap="round">
  <path d="{paths['lips']}" fill="none" stroke="#5bdbfa" stroke-width="5" opacity=".3" filter="url(#glow)"/>
  <path d="{paths['outline']}" fill="#03090e" stroke="#a6f4ff" stroke-width="3"/>
  <path d="{paths['cavity']}" fill="none" stroke="#548493" stroke-width="1.5" opacity=".35"/>
  <path d="{paths['teeth']}" fill="#1c2c35" stroke="#bddce4" stroke-width="2" opacity=".6"/>
  <path d="{paths['tongue']}" fill="none" stroke="#f489cc" stroke-width="2.5" opacity=".85"/>
  <path d="{paths['lips']}" fill="none" stroke="url(#wire)" stroke-width="2.3"/>
</g>
<!-- A is drawn, not font-dependent. It is the letter leaving the mouth. -->
<path d="M423 338L500 124L577 338M447 274H553" fill="none" stroke="#f5c3e8" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M489 386L489 414M515 371L515 399" fill="none" stroke="#f5c3e8" stroke-opacity=".6" stroke-width="6" stroke-linecap="round"/>
</svg>\n'''
(root / "artwork/spelling-synthesizer.svg").write_text(svg)
surface = cairo.ImageSurface(cairo.FORMAT_ARGB32, 1024, 1024)
rect = Rsvg.Rectangle()
rect.x = rect.y = 0
rect.width = rect.height = 1024
Rsvg.Handle.new_from_data(svg.encode()).render_document(cairo.Context(surface), rect)
buffer = BytesIO()
surface.write_to_png(buffer)
buffer.seek(0)
Image.open(buffer).convert("RGBA").resize((512, 512), Image.Resampling.LANCZOS).save(
    root / "assets/instruments/spelling-synthesizer.webp", "WEBP", lossless=True, method=6,
)
print("Rendered Spelling Synthesizer's native mouth icon.")
