#!/usr/bin/env python3
"""Original vector/logo study: spatial nodes and depth-separated directed edges."""
from pathlib import Path
from io import BytesIO
import math
import cairo
import gi
from PIL import Image

gi.require_version("Rsvg", "2.0")
from gi.repository import Rsvg
root = Path(__file__).resolve().parent.parent
colors = ["#b5a4f4", "#70dbca", "#f3bd80", "#89b7ee"]
points = []
for i in range(12):
    y = 0.86 * (1 - 2 * (i + 0.5) / 12)
    r = math.sqrt(max(0, 0.86**2 - y*y))
    a = i * 2.3999632297 + 0.2
    x, z = r * math.cos(a), r * math.sin(a)
    angle = 0.4
    x, z = x*math.cos(angle)+z*math.sin(angle), -x*math.sin(angle)+z*math.cos(angle)
    factor = 3.4 / (3.4-z)
    points.append((256+x*211*factor, 256-y*211*factor, z))
edges = [(i, (i+1) % 12) for i in range(12)] + [(0,4),(1,5),(3,8),(4,10),(7,11)]
parts = []
for a,b in sorted(edges, key=lambda e:points[e[0]][2]+points[e[1]][2]):
    x,y,z = points[a]; xx,yy,zz = points[b]
    color = "#ed927e" if b < a else "#65cfe0"
    parts.append(f'<path d="M{x:.2f} {y:.2f}L{xx:.2f} {yy:.2f}" fill="none" stroke="{color}" stroke-width="5.5" opacity="{.55+(z+zz+2)/8:.2f}"/>')
    angle = math.atan2(yy-y,xx-x); px=x+(xx-x)*.64; py=y+(yy-y)*.64
    parts.append(f'<path d="M{px-10*math.cos(angle-.5):.2f} {py-10*math.sin(angle-.5):.2f}L{px:.2f} {py:.2f}L{px-10*math.cos(angle+.5):.2f} {py-10*math.sin(angle+.5):.2f}" fill="none" stroke="{color}" stroke-width="4"/>')
for i,(x,y,z) in sorted(enumerate(points),key=lambda item:item[1][2]):
    radius=12+(z+1)*4
    parts.append(f'<circle cx="{x:.2f}" cy="{y:.2f}" r="{radius:.2f}" fill="#0d1622" stroke="{colors[i%4]}" stroke-width="6"/><circle cx="{x:.2f}" cy="{y:.2f}" r="4" fill="#f8f2dc"/>')
svg=f'<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><title>3D Graph</title><desc>A spatial constellation of connected graph nodes.</desc>{"".join(parts)}</svg>\n'
art=root/"artwork/graph-3d.svg"; art.write_text(svg)
surface=cairo.ImageSurface(cairo.FORMAT_ARGB32,1024,1024)
rect=Rsvg.Rectangle(); rect.x=rect.y=0; rect.width=rect.height=1024
Rsvg.Handle.new_from_data(svg.encode()).render_document(cairo.Context(surface),rect)
buffer=BytesIO();surface.write_to_png(buffer);buffer.seek(0)
image=Image.open(buffer).convert("RGBA").resize((512,512),Image.Resampling.LANCZOS)
image.save(root/"assets/instruments/graph-3d.webp","WEBP",lossless=True,method=6)
print("Rendered original 3D Graph SVG/WebP icon.")
