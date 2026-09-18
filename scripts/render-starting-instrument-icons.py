#!/usr/bin/env python3
"""Original, editable vector marks for the five starting instruments."""
from pathlib import Path
from io import BytesIO
import math
import cairo
import gi
from PIL import Image
gi.require_version("Rsvg", "2.0")
from gi.repository import Rsvg

root = Path(__file__).resolve().parent.parent
art = root / "artwork/starting-instruments"
art.mkdir(exist_ok=True)
colors = ["#f4bb7e", "#a4ddba", "#c5a5ee", "#7dd8e7", "#eb9cb5", "#bdcb77"]
def circle(x,y,r,c,fill="none",w=8):
    return f'<circle cx="{x}" cy="{y}" r="{r}" fill="{fill}" stroke="{c}" stroke-width="{w}"/>'
def line(x,y,xx,yy,c,w=8):
    return f'<path d="M{x} {y}L{xx} {yy}" stroke="{c}" stroke-width="{w}" stroke-linecap="round" fill="none"/>'

marks={}
parts=[]
for i,r in enumerate([78,134,190]):
    parts.append(circle(256,256,r,colors[i],w=6))
    a=[.7,3.8,5.1][i]
    parts.append(circle(256+r*math.cos(a),256+r*math.sin(a),19,colors[i],colors[i],2))
parts.append(circle(256,256,26,"#f19ba8","#f19ba8",2))
marks["tempo-tantrum"]="".join(parts)
parts=[]
for i,x in enumerate([146,366]):
    parts.append(circle(x,256,108,colors[i],"#101922",9))
    parts.append(circle(x,256,47,colors[i],w=5))
parts.append('<path d="M143 148C207 38 319 38 367 148 M368 364C292 470 205 470 143 364" stroke="#c5a5ee" stroke-width="12" fill="none"/>')
for i in range(6):
    a=1.2+i*.22
    parts.append(circle(146+108*math.cos(a),256+108*math.sin(a),9+i,"#f5ecd2","#f5ecd2",2))
marks["tape-worm"]="".join(parts)
parts=[]
for i,(x,y) in enumerate([(130,212),(382,212),(256,370)]):
    parts.append(circle(x,y,93,colors[i],"#13212b",8))
    parts.append(circle(x,y,50,colors[i],w=5))
    a=i*.9
    parts.append(circle(x+93*math.cos(a),y+93*math.sin(a),14,colors[i],colors[i],2))
marks["loop-soup"]="".join(parts)
positions=[(256+181*math.cos(i*math.tau/6-math.pi/2),256+181*math.sin(i*math.tau/6-math.pi/2)) for i in range(6)]
parts=[]
for i,j in [(0,2),(2,5),(5,1),(1,4),(4,3),(3,0)]:
    parts.append(line(*positions[i],*positions[j],colors[i],10))
for i,(x,y) in enumerate(positions):
    parts.append(circle(x,y,27,colors[i],"#13212b",8))
    parts.append(circle(x,y,7,colors[i],colors[i],1))
marks["habit-habitat"]="".join(parts)
parts=[]
for i in range(3):
    x=105+i*151; y=130-i%2*52
    parts.append(f'<rect x="{x-54}" y="{y}" width="108" height="{310-y+80}" rx="48" fill="#17202e" stroke="{colors[i]}" stroke-width="9"/>')
    parts.append(circle(x,y,17,colors[i],"#f5ecd2",3))
    for j in range(5):
        parts.append(f'<path d="M{x-37} {y+60+j*38}Q{x} {y+40+j*38} {x+37} {y+60+j*38}" fill="none" stroke="{colors[i]}" stroke-width="6"/>')
marks["hollowphonic"]="".join(parts)
for name,body in marks.items():
    svg=f'<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><title>{name}</title>{body}</svg>'
    (art/f"{name}.svg").write_text(svg+"\n")
    handle=Rsvg.Handle.new_from_data(svg.encode())
    surface=cairo.ImageSurface(cairo.FORMAT_ARGB32,1024,1024)
    rect=Rsvg.Rectangle();rect.x=rect.y=0;rect.width=rect.height=1024
    handle.render_document(cairo.Context(surface),rect)
    buf=BytesIO();surface.write_to_png(buf);buf.seek(0)
    image=Image.open(buf).convert("RGBA").resize((512,512),Image.Resampling.LANCZOS)
    image.save(root/f"assets/instruments/{name}.webp","WEBP",lossless=True,method=6)
    print(name)
