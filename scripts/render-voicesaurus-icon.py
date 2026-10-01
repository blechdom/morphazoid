#!/usr/bin/env python3
"""Render Voicesaurus's original seven spectral voices; no external artwork."""
from pathlib import Path
from math import sin, pi, sqrt
from PIL import Image, ImageDraw
root = Path(__file__).resolve().parent.parent
size = 1024
im = Image.new('RGB', (size, size), '#080b10')
draw = ImageDraw.Draw(im)
colors = ['#cfb0ff', '#91e9d6', '#d8ff57', '#f7a4dd', '#79dcff', '#ffcb69', '#ff9c62']
paths = []
for row, color in enumerate(colors):
    points=[]
    for i in range(401):
        t=i/400; x=80+864*t; center=220+row*97
        window=sin(pi*t)**.8
        amplitude=36*window
        y=center-amplitude*(sin(t*pi*(8+row*2))+.28*sin(t*pi*(22+row*4)))
        points.append((x,y))
    draw.line(points, fill=color, width=6)
    paths.append('<path d="'+' '.join(('M' if i==0 else 'L')+f'{x:.1f},{y:.1f}' for i,(x,y) in enumerate(points))+'" fill="none" stroke="'+color+'" stroke-width="6"/>')
svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><title>Voicesaurus — seven spectral voices</title><rect width="1024" height="1024" fill="#080b10"/>'+''.join(paths)+'</svg>\n'
(root/'artwork/voicesaurus.svg').write_text(svg)
im.resize((512,512),Image.Resampling.LANCZOS).save(root/'assets/instruments/voicesaurus.webp','WEBP',lossless=True,method=6)
