#!/usr/bin/env python3
"""An original, procedural glass-marble/paint icon. Requires Pillow."""

from math import asin, cos, hypot, pi, sin, sqrt
from pathlib import Path
from random import Random

from PIL import Image, ImageChops, ImageDraw, ImageFilter

SIZE = 1024
CX, CY, RADIUS = 504, 501, 310
PIGMENTS = (
    (255, 101, 182), (74, 219, 234), (255, 195, 101), (185, 151, 255),
    (255, 135, 87), (241, 126, 213), (193, 240, 139), (108, 167, 255),
)
OUTPUT = Path(__file__).resolve().parent.parent / "assets/instruments/globule-damacy.webp"
rng = Random(1846)

image = Image.new("RGB", (SIZE, SIZE))
pixels = image.load()
for y in range(SIZE):
    for x in range(SIZE):
        light = max(0, 1 - hypot((x - 504) / 675, (y - 485) / 620))
        fibers = 3.5 * sin(x * .12 + y * .039) * sin(y * .087 - x * .017)
        pixels[x, y] = (
            int(20 + 36 * light + fibers),
            int(10 + 23 * light + fibers),
            int(34 + 36 * light + fibers),
        )

draw = ImageDraw.Draw(image)
for thread in range(800):
    x, y = rng.randrange(SIZE), rng.randrange(SIZE)
    dx, dy = rng.uniform(-13, 13), rng.uniform(-2, 2)
    draw.line((x, y, x + dx, y + dy),
              fill=(94 + thread % 23, 54 + thread % 19, 112 + thread % 14), width=1)
# Detached flecks of paint on the recording table, rather than ruled loop lanes.
for fragment in range(170):
    color = PIGMENTS[rng.randrange(len(PIGMENTS))]
    x, y = rng.randrange(45, 975), rng.randrange(665, 970)
    size = rng.uniform(1, 6)
    draw.ellipse((x - size, y - size, x + size, y + size), fill=color)
    if fragment % 4 == 0:
        draw.line((x, y, x + rng.uniform(-14, 14), y + rng.uniform(6, 24)),
                  fill=color, width=2)

draw.ellipse((190, 797, 828, 919), fill=(11, 5, 24))
draw.ellipse((252, 830, 752, 890), fill=(29, 15, 39))

# A milky, partly translucent-looking glass body with original colored swirls
# and tiny imperfections; it does not claim to be a photographed antique.
for y in range(CY - RADIUS, CY + RADIUS + 1):
    ny = (CY - y) / RADIUS
    for x in range(CX - RADIUS, CX + RADIUS + 1):
        nx = (x - CX) / RADIUS
        if nx * nx + ny * ny >= 1:
            continue
        nz = sqrt(1 - nx * nx - ny * ny)
        light = max(.19, .44 + .46 * nz - .21 * nx + .15 * ny)
        gleam = max(0, -.38 * nx + .42 * ny + .71 * nz) ** 23
        twist = 9 * sin(nx * 16 + ny * 14 + 5 * sin(ny * 8 + nz * 3))
        glass = (219 + twist, 169 + twist, 216 + twist)
        pixels[x, y] = tuple(
            max(0, min(255, int(component * light + (99, 68, 112)[channel] * gleam)))
            for channel, component in enumerate(glass)
        )

inside = Image.new("L", (SIZE, SIZE), 0)
ImageDraw.Draw(inside).ellipse((CX - RADIUS, CY - RADIUS,
                               CX + RADIUS, CY + RADIUS), fill=255)
overlay = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
spots = ImageDraw.Draw(overlay)
glass_colors = [(81, 50, 109), (227, 110, 172), (248, 215, 169),
                (93, 156, 172), (170, 105, 188)]

# Broken lampworked-looking veins wind across many meridians, not stripes.
for thread in range(16):
    points = []
    for step in range(85):
        t = step / 84
        lon = (thread - 7.5) * .11 + t * (.65 + (thread % 3) * .16)
        lon += .09 * sin(t * 17 + thread)
        lat = .95 * sin((t * .9 + thread * .18) * 2 * pi)
        lat += .22 * sin(t * 13 - thread * 2)
        if cos(lon) * cos(lat) < .02:
            if len(points) > 2:
                spots.line(points, fill=(*glass_colors[thread % 5], 116), width=16)
                spots.line(points, fill=(255, 226, 232, 95), width=3)
            points = []
        else:
            points.append((CX + RADIUS * cos(lat) * sin(lon),
                           CY - RADIUS * sin(lat)))
    if len(points) > 2:
        spots.line(points, fill=(*glass_colors[thread % 5], 116), width=16)
        spots.line(points, fill=(255, 226, 232, 95), width=3)

for inclusion in range(190):
    lon = rng.uniform(-1.48, 1.48)
    lat = asin(rng.uniform(-1, 1))
    x = CX + RADIUS * cos(lat) * sin(lon)
    y = CY - RADIUS * sin(lat)
    size = rng.uniform(1, 4)
    spots.ellipse((x - size, y - size, x + size, y + size),
                  fill=(38, 25, 53, rng.randrange(34, 78)))
    spots.point((x - 1, y - 1), fill=(255, 230, 246, 110))

# Random contact normals cover the entire hemisphere, including explicit
# north/south polar regions. Clip the splashes to the glass silhouette.
for grain in range(270):
    color = PIGMENTS[rng.randrange(len(PIGMENTS))]
    lat = asin(rng.uniform(-.998, .998))
    lon = rng.uniform(-1.48, 1.48)
    if grain in (0, 1):
        lat, lon = ((1.5, -.17) if grain == 0 else (-1.5, .15))
    x = CX + RADIUS * cos(lat) * sin(lon)
    y = CY - RADIUS * sin(lat)
    rx = rng.uniform(8, 24) * max(.25, cos(lon))
    ry = rng.uniform(7, 22)
    skew = rng.uniform(-.6, .6)
    points = []
    for vertex in range(14):
        theta = vertex * 2 * pi / 14
        ragged = rng.uniform(.78, 1.13)
        dx = cos(theta) * rx * ragged
        dy = sin(theta) * ry * ragged
        points.append((x + dx + skew * dy, y + dy))
    spots.polygon(points, fill=(*color, rng.randrange(139, 229)))
    spots.line((points[8], points[10]), fill=(255, 224, 249, 96), width=2)

overlay.putalpha(ImageChops.multiply(overlay.getchannel("A"), inside))
image = Image.alpha_composite(image.convert("RGBA"), overlay)

reflection = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
glaze = ImageDraw.Draw(reflection)
glaze.ellipse((CX - 244, CY - 263, CX + 18, CY - 13),
              fill=(255, 240, 254, 92))
reflection = reflection.filter(ImageFilter.GaussianBlur(64))
reflection.putalpha(ImageChops.multiply(reflection.getchannel("A"), inside))
image = Image.alpha_composite(image, reflection)

draw = ImageDraw.Draw(image)
# The stationary pickup is a lacquered, ribbed drinking straw. The marble
# turns beneath its front-facing tip; this matches the instrument's geometry.
start = (CX + RADIUS * 1.54, CY - RADIUS * .77)
shoulder = (CX + RADIUS * .92, start[1])
c1 = (CX + RADIUS * .68, shoulder[1])
c2 = (CX + RADIUS * .61, CY - RADIUS * .50)
elbow = (CX + RADIUS * .47, CY - RADIUS * .39)


def bend_at(t):
    s = 1 - t
    return tuple(s ** 3 * shoulder[axis] + 3 * s ** 2 * t * c1[axis]
                 + 3 * s * t ** 2 * c2[axis] + t ** 3 * elbow[axis]
                 for axis in (0, 1))


bend = [bend_at(step / 48) for step in range(49)]
straw = [start, shoulder, *bend[1:], (CX, CY)]
draw.line(straw, fill=(41, 23, 48, 255), width=38, joint="curve")
draw.line(straw, fill=(255, 105, 188, 255), width=27, joint="curve")
draw.line([start, shoulder], fill=(93, 226, 232, 255), width=24)
draw.line(straw, fill=(255, 237, 248, 170), width=3, joint="curve")
for rib in range(1, 12):
    t = rib / 12
    x, y = bend_at(t)
    s = 1 - t
    dx = 3 * s ** 2 * (c1[0] - shoulder[0]) \
        + 6 * s * t * (c2[0] - c1[0]) + 3 * t ** 2 * (elbow[0] - c2[0])
    dy = 3 * s ** 2 * (c1[1] - shoulder[1]) \
        + 6 * s * t * (c2[1] - c1[1]) + 3 * t ** 2 * (elbow[1] - c2[1])
    length = hypot(dx, dy)
    nx, ny = -dy / length, dx / length
    half = RADIUS * .036
    draw.line((x - nx * half, y - ny * half, x + nx * half, y + ny * half),
              fill=(77, 23, 74, 255), width=4)
    draw.line((x - nx * half + dx / length * 3,
               y - ny * half + dy / length * 3,
               x + nx * half + dx / length * 3,
               y + ny * half + dy / length * 3),
              fill=(255, 226, 249, 220), width=2)

draw.ellipse((start[0] - 6, start[1] - 12, start[0] + 6, start[1] + 12),
             fill=(41, 31, 56, 255), outline=(151, 243, 238, 255), width=3)
draw.ellipse((CX - 9, CY - 10, CX + 9, CY + 10),
             fill=(70, 35, 65, 255), outline=(255, 209, 236, 255), width=3)
draw.ellipse((CX - 4, CY - 4, CX + 4, CY + 4), fill=(255, 245, 235, 255))

image.convert("RGB").resize((512, 512), Image.Resampling.LANCZOS).save(
    OUTPUT, "WEBP", quality=92
)
print(f"Wrote {OUTPUT}")
