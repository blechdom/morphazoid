#!/usr/bin/env python3
"""Original vector marks for the wave-physics instruments.

One primitive list per instrument is rendered twice: to an editable SVG in
artwork/wave-lab/, and to the lossless 512x512 WebP catalogue icon. Raster
rendering uses PIL directly because this checkout has no cairo/gi binding.
"""
from pathlib import Path
import math
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent.parent
art = root / "artwork/wave-lab"
art.mkdir(parents=True, exist_ok=True)
SIZE = 512
SS = 2  # supersample factor


def hexrgb(c):
    c = c.lstrip("#")
    return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))


def build_crab_loom():
    out = []
    for which, colour in ((0, "#9fdcff"), (1, "#ffbe8c")):
        pts = []
        for i in range(241):
            t = i / 240
            a = t * math.tau - math.pi / 2
            sign = 1 if which == 0 else -1
            r = 168 + sign * 36 * math.cos(t * math.pi)
            pts.append((256 + math.cos(a) * r, 256 + math.sin(a) * r))
        out.append(("poly", pts, colour, 10))
    out.append(("line", (256, 52), (256, 142), "#ffd479", 10))
    out.append(("dot", (256, 97), 16, "#ffd479"))
    return out


def build_freeze_point():
    out = []
    for gy in range(7):
        for gx in range(7):
            x, y = 78 + gx * 51, 78 + gy * 51
            d = math.hypot(gx - 4.6, gy - 2.4)
            lit = max(0.0, 1 - d / 1.9)
            if lit > 0.05:
                v = int(70 + lit * 150)
                out.append(("rect", (x, y, x + 38, y + 38), f"#{v:02x}{min(255, v + 45):02x}ff", 3, True))
            else:
                out.append(("rect", (x, y, x + 38, y + 38), "#2c4a63", 3, False))
    return out


def build_scatter_ghost():
    out = []
    for r, colour in ((196, "#4b3d73"), (150, "#6a54a6"), (104, "#9679d6")):
        out.append(("ring", (300, 256), r, colour, 8))
    for i, (x, y) in enumerate(
        [(120, 150), (176, 330), (238, 108), (300, 400), (368, 200), (416, 322), (196, 236), (352, 288)]
    ):
        out.append(("dot", (x, y), 16 if i % 2 else 12, "#c9a7ff"))
    out.append(("dot", (300, 256), 27, "#ffd479"))
    return out


def build_exceptional():
    out = [
        ("line", (64, 256), (448, 256), "#3d5a70", 7),
        ("line", (256, 84), (256, 428), "#3d5a70", 7),
    ]
    pinks = ["#5c2d45", "#84405f", "#ad557c", "#d66a9b", "#ffa8c8"]
    blues = ["#22394d", "#2f5471", "#446f95", "#688fb9", "#8fd3ff"]
    for i in range(5):
        off = 150 * (1 - i / 4) ** 0.5
        out.append(("dot", (256 - off, 256), 10 + i * 3, pinks[i]))
        out.append(("dot", (256 + off, 256), 10 + i * 3, blues[i]))
    out.append(("dash", (256, 256), 34, "#ffffff", 5))
    return out


MARKS = {
    "crab-loom": build_crab_loom(),
    "freeze-point": build_freeze_point(),
    "scatter-ghost": build_scatter_ghost(),
    "exceptional": build_exceptional(),
}


def to_svg(name, prims):
    body = []
    for p in prims:
        kind = p[0]
        if kind == "poly":
            _, pts, c, w = p
            d = "M" + "L".join(f"{x:.1f} {y:.1f}" for x, y in pts)
            body.append(f'<path d="{d}" fill="none" stroke="{c}" stroke-width="{w}" stroke-linejoin="round"/>')
        elif kind == "line":
            _, a, b, c, w = p
            body.append(f'<path d="M{a[0]} {a[1]}L{b[0]} {b[1]}" stroke="{c}" stroke-width="{w}" stroke-linecap="round" fill="none"/>')
        elif kind == "dot":
            _, (x, y), r, c = p
            body.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r}" fill="{c}"/>')
        elif kind == "ring":
            _, (x, y), r, c, w = p
            body.append(f'<circle cx="{x}" cy="{y}" r="{r}" fill="none" stroke="{c}" stroke-width="{w}"/>')
        elif kind == "rect":
            _, (x0, y0, x1, y1), c, w, filled = p
            fill = c if filled else "none"
            body.append(f'<rect x="{x0}" y="{y0}" width="{x1-x0}" height="{y1-y0}" rx="3" fill="{fill}" stroke="{c}" stroke-width="{w}"/>')
        elif kind == "dash":
            _, (x, y), r, c, w = p
            body.append(f'<circle cx="{x}" cy="{y}" r="{r}" fill="none" stroke="{c}" stroke-width="{w}" stroke-dasharray="12 12"/>')
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">'
        f'<title>{name}</title><rect width="512" height="512" fill="#080e16"/>'
        + "".join(body) + "</svg>\n"
    )


def to_raster(prims):
    img = Image.new("RGBA", (SIZE * SS, SIZE * SS), hexrgb("#080e16") + (255,))
    d = ImageDraw.Draw(img)
    s = SS
    for p in prims:
        kind = p[0]
        if kind == "poly":
            _, pts, c, w = p
            d.line([(x * s, y * s) for x, y in pts], fill=hexrgb(c), width=w * s, joint="curve")
        elif kind == "line":
            _, a, b, c, w = p
            d.line([(a[0] * s, a[1] * s), (b[0] * s, b[1] * s)], fill=hexrgb(c), width=w * s)
        elif kind == "dot":
            _, (x, y), r, c = p
            d.ellipse([(x - r) * s, (y - r) * s, (x + r) * s, (y + r) * s], fill=hexrgb(c))
        elif kind == "ring":
            _, (x, y), r, c, w = p
            d.ellipse([(x - r) * s, (y - r) * s, (x + r) * s, (y + r) * s], outline=hexrgb(c), width=w * s)
        elif kind == "rect":
            _, (x0, y0, x1, y1), c, w, filled = p
            box = [x0 * s, y0 * s, x1 * s, y1 * s]
            d.rounded_rectangle(box, radius=3 * s, fill=hexrgb(c) if filled else None, outline=hexrgb(c), width=w * s)
        elif kind == "dash":
            _, (x, y), r, c, w = p
            for k in range(16):
                if k % 2:
                    continue
                a0, a1 = k * 22.5, (k + 1) * 22.5
                d.arc([(x - r) * s, (y - r) * s, (x + r) * s, (y + r) * s], a0, a1, fill=hexrgb(c), width=w * s)
    return img.resize((SIZE, SIZE), Image.Resampling.LANCZOS)


def build_head_shed():
    out = []
    pts = [(256 + math.cos(i / 240 * math.tau - math.pi / 2) * 170,
            256 + math.sin(i / 240 * math.tau - math.pi / 2) * 170) for i in range(241)]
    out.append(("poly", pts, "#2f6f8f", 9))
    for frac, colour, r in ((0.0, "#7ee0a8", 20), (0.37, "#7ee0a8", 16), (0.72, "#ff7a7a", 20), (0.88, "#8fb4ff", 14)):
        a = frac * math.tau - math.pi / 2
        out.append(("dot", (256 + math.cos(a) * 170, 256 + math.sin(a) * 170), r, colour))
    return out


def build_splice_ring():
    out = []
    cols = ["#e0674f", "#5fb47a", "#4f8fd0", "#c07fd0"]
    for k in range(4):
        pts = []
        for i in range(61):
            t = (k + i / 60 * 0.92) / 4
            a = t * math.tau - math.pi / 2
            pts.append((256 + math.cos(a) * 172, 256 + math.sin(a) * 172))
        out.append(("poly", pts, cols[k], 16))
    for k in range(4):
        a = (k / 4) * math.tau - math.pi / 2
        out.append(("dot", (256 + math.cos(a) * 172, 256 + math.sin(a) * 172), 13, "#eef4ff"))
    out.append(("line", (256, 84), (256 + math.cos(0.5 * math.tau - math.pi / 2) * 172,
                                    256 + math.sin(0.5 * math.tau - math.pi / 2) * 172), "#ff96dc", 7))
    return out


def build_onset_atlas():
    out = []
    for i, (x, w, c) in enumerate([(70, 66, "#ffd479"), (152, 52, "#ffd479"), (228, 84, "#8fd3ff"), (330, 58, "#ffd479")]):
        out.append(("rect", (x, 118, x + w, 168), c, 4, True))
    for k, (x, y) in enumerate([(176, 300), (336, 300), (256, 410)]):
        out.append(("dot", (x, y), 40, ["#ffd479", "#8fd3ff", "#ffd479"][k]))
    out.append(("line", (200, 312), (312, 312), "#c8b489", 8))
    out.append(("line", (196, 336), (238, 380), "#c8b489", 8))
    out.append(("line", (316, 336), (274, 380), "#c8b489", 8))
    return out


def build_synaptic():
    out = []
    nodes = [(256 + math.cos(i / 7 * math.tau - math.pi / 2) * 160,
              256 + math.sin(i / 7 * math.tau - math.pi / 2) * 160) for i in range(7)]
    for i in range(7):
        a, b = nodes[i], nodes[(i + 1) % 7]
        out.append(("line", a, b, "#4a63a8", 7))
    for i in range(7):
        a, b = nodes[i], nodes[(i + 3) % 7]
        out.append(("line", a, b, "#9bb7ff", 13))
    for i, n in enumerate(nodes):
        out.append(("dot", n, 25 if i in (0, 3) else 18, "#cfe0ff" if i in (0, 3) else "#7f97d8"))
    return out


MARKS["head-shed"] = build_head_shed()
MARKS["splice-ring"] = build_splice_ring()
MARKS["onset-atlas"] = build_onset_atlas()
MARKS["synaptic-resonance"] = build_synaptic()


for name, prims in MARKS.items():
    (art / f"{name}.svg").write_text(to_svg(name, prims))
    to_raster(prims).save(root / f"assets/instruments/{name}.webp", "WEBP", lossless=True, method=6)
    print("wrote", name)
