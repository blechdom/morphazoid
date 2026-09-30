#!/usr/bin/env python3
"""Render an original Möbius ribbon icon from the instrument's native surface.

Run: python3 scripts/render-moebius-icon.py
Optional authoring dependencies: Node, Pycairo, PyGObject/Rsvg and Pillow (as in
render-spelling-icon.py). No third-party artwork or runtime dependency is added.
"""
from io import BytesIO
from pathlib import Path
import json
import math
import subprocess

import cairo
import gi
from PIL import Image

gi.require_version("Rsvg", "2.0")
from gi.repository import Rsvg

ROOT = Path(__file__).resolve().parent.parent
U_SEGMENTS = 192
V_SEGMENTS = 8
ROTATION = (35, 0, -12)

# Sample the actual half-twisted surface, including its reflected seam, rather
# than drawing an infinity sign or joining two unrelated ribbon faces.
grid = json.loads(subprocess.check_output([
    "node", "--input-type=module", "-e",
    "import {surfacePoint} from './src/families/nonorientable/nonorientable-surface.js';"
    f"console.log(JSON.stringify(Array.from({{length:{U_SEGMENTS + 1}}},(_,i)=>"
    f"Array.from({{length:{V_SEGMENTS + 1}}},(_,j)=>"
    f"surfacePoint('moebius',i/{U_SEGMENTS},-1+2*j/{V_SEGMENTS},"
    "{radius:.78,width:.26,fold:1.3,halfTwists:1})))));",
], cwd=ROOT, text=True))


def rotate(point):
    x, y, z = (point[axis] for axis in ("x", "y", "z"))
    for axis in (1, 0, 2):
        degrees = ROTATION[axis]
        c, s = math.cos(math.radians(degrees)), math.sin(math.radians(degrees))
        if axis == 0:
            y, z = y * c - z * s, y * s + z * c
        elif axis == 1:
            x, z = x * c + z * s, -x * s + z * c
        else:
            x, y = x * c - y * s, x * s + y * c
    return (x, y, z)


points = [[rotate(point) for point in row] for row in grid]
min_x, max_x = min(p[0] for row in points for p in row), max(p[0] for row in points for p in row)
min_y, max_y = min(p[1] for row in points for p in row), max(p[1] for row in points for p in row)
scale = 438 / max(max_x - min_x, max_y - min_y)
center_x, center_y = (min_x + max_x) / 2, (min_y + max_y) / 2


def project(point):
    return (256 + (point[0] - center_x) * scale, 256 - (point[1] - center_y) * scale)


def path(vertices, close=False):
    return "M" + "L".join(f"{x:.2f},{y:.2f}" for x, y in map(project, vertices)) + ("Z" if close else "")


def ribbon_color(u, v, brightness=1):
    # The color also joins continuously at (u=1,v) == (u=0,-v).
    blend = (1 + v * math.cos(math.pi * u)) / 2
    mint, pink = (99, 243, 208), (255, 112, 200)
    return "#" + "".join(f"{round((a + (b - a) * blend) * brightness):02x}" for a, b in zip(mint, pink))


layers = []
for i in range(U_SEGMENTS):
    for j in range(V_SEGMENTS):
        a, b = points[i][j], points[i + 1][j]
        c, d = points[i + 1][j + 1], points[i][j + 1]
        depth = sum(p[2] for p in (a, b, c, d)) / 4
        u, v = (i + .5) / U_SEGMENTS, -1 + 2 * (j + .5) / V_SEGMENTS
        ab, ad = [b[k] - a[k] for k in range(3)], [d[k] - a[k] for k in range(3)]
        normal = (ab[1]*ad[2]-ab[2]*ad[1], ab[2]*ad[0]-ab[0]*ad[2], ab[0]*ad[1]-ab[1]*ad[0])
        length = math.sqrt(sum(n*n for n in normal))
        light = abs(sum(n*l for n, l in zip(normal, (-.3, .5, .81)))) / max(length, 1e-9)
        fill = ribbon_color(u, v, .20 + .34 * light)
        layers.append((depth, f'<path d="{path((a,b,c,d), True)}" fill="{fill}" stroke="{fill}" stroke-width=".65"/>'))

        # Longitudinal wires and 24 transverse stations expose the half twist.
        # A small depth bias keeps adjacent filled quads from nicking strokes.
        for edge_j in [j] + ([V_SEGMENTS] if j == V_SEGMENTS - 1 else []):
            edge = edge_j in (0, V_SEGMENTS)
            if not edge and edge_j % 2:
                continue
            p, q = points[i][edge_j], points[i + 1][edge_j]
            color = ribbon_color(u, -1 + 2 * edge_j / V_SEGMENTS)
            wire = f'<path d="{path((p,q))}" fill="none" stroke="{color}" stroke-width="{4.8 if edge else .8}" opacity="{1 if edge else .5}"/>'
            layers.append(((p[2] + q[2]) / 2 + .1, wire))
        if i % 8 == 0:
            color = ribbon_color(i / U_SEGMENTS, v)
            wire = f'<path d="{path((a,d))}" fill="none" stroke="{color}" stroke-width=".95" opacity=".65"/>'
            layers.append(((a[2] + d[2]) / 2 + .1, wire))

# A single luminous scan station recalls the instrument's moving playhead.
station = 8
for j in range(V_SEGMENTS):
    p, q = points[station][j], points[station][j + 1]
    scan = f'<path d="{path((p,q))}" fill="none" stroke="#fff1a8" stroke-width="3.8"/>'
    layers.append(((p[2] + q[2]) / 2 + .11, scan))
p = points[station][V_SEGMENTS // 2]
x, y = project(p)
layers.append((p[2] + .12, f'<circle cx="{x:.2f}" cy="{y:.2f}" r="11" fill="#fff1a8" opacity=".2"/><circle cx="{x:.2f}" cy="{y:.2f}" r="5.5" fill="#fff9dc"/>'))

svg = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
<title>Möbius — one half-twisted ribbon with a luminous playhead</title>
<desc>Original artwork sampled from Morphazoid's native Möbius surface. Mint and pink wires follow the continuous ribbon and its single boundary.</desc>
<g stroke-linejoin="round" stroke-linecap="round">
''' + "\n".join(markup for _, markup in sorted(layers, key=lambda layer: layer[0])) + '\n</g>\n</svg>\n'
(ROOT / "artwork/moebius.svg").write_text(svg)
surface = cairo.ImageSurface(cairo.FORMAT_ARGB32, 1024, 1024)
rect = Rsvg.Rectangle()
rect.x = rect.y = 0
rect.width = rect.height = 1024
Rsvg.Handle.new_from_data(svg.encode()).render_document(cairo.Context(surface), rect)
buffer = BytesIO()
surface.write_to_png(buffer)
buffer.seek(0)
Image.open(buffer).convert("RGBA").resize((512, 512), Image.Resampling.LANCZOS).save(
    ROOT / "assets/instruments/moebius.webp", "WEBP", lossless=True, method=6,
)
print("Rendered Möbius's native ribbon icon.")
