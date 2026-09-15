import math
import os
import gi
gi.require_version('Rsvg', '2.0')
from gi.repository import Rsvg
import cairo
from PIL import Image

def render_svg_to_webp(svg_str, output_path, quality=98):
    handle = Rsvg.Handle.new_from_data(svg_str.encode('utf-8'))
    surface = cairo.ImageSurface(cairo.FORMAT_ARGB32, 512, 512)
    ctx = cairo.Context(surface)
    # Clear surface to guaranteed transparent alpha
    ctx.set_operator(cairo.OPERATOR_CLEAR)
    ctx.paint()
    ctx.set_operator(cairo.OPERATOR_OVER)
    handle.render_cairo(ctx)
    buf = surface.get_data()
    img = Image.frombuffer('RGBA', (512, 512), buf, 'raw', 'BGRA', 0, 1)
    img.save(output_path, 'WEBP', quality=quality)
    print(f"Rendered: {output_path}")

# ==========================================
# 1. SHAPES (Transparent, Bold)
# ==========================================
def make_shapes():
    cx, cy = 256, 256
    hex_r = 205
    hex_pts = []
    for i in range(6):
        a = -math.pi/2 + i * (math.pi / 3)
        hex_pts.append((cx + hex_r * math.cos(a), cy + hex_r * math.sin(a)))
    hex_str = " ".join(f"{x:.1f},{y:.1f}" for x, y in hex_pts)

    tri_r = 168
    tri_pts = []
    for i in range(3):
        a = -math.pi/2 + i * (2 * math.pi / 3) + math.pi/6
        tri_pts.append((cx + tri_r * math.cos(a), cy + tri_r * math.sin(a)))
    tri_str = " ".join(f"{x:.1f},{y:.1f}" for x, y in tri_pts)

    core_r = 85
    core_pts = []
    for i in range(5):
        a = -math.pi/2 + i * (2 * math.pi / 5)
        core_pts.append((cx + core_r * math.cos(a), cy + core_r * math.sin(a)))
    core_str = " ".join(f"{x:.1f},{y:.1f}" for x, y in core_pts)

    ticks = []
    for i in range(6):
        p1 = hex_pts[i]
        p2 = hex_pts[(i+1)%6]
        dx = p2[0] - p1[0]
        dy = p2[1] - p1[1]
        length = math.hypot(dx, dy)
        nx = -dy / length * 15
        ny = dx / length * 15
        for div in (0.333, 0.666):
            tx = p1[0] + dx * div
            ty = p1[1] + dy * div
            ticks.append(f'<line x1="{tx:.1f}" y1="{ty:.1f}" x2="{tx+nx:.1f}" y2="{ty+ny:.1f}" stroke="#ffcc00" stroke-width="5.5" stroke-linecap="round"/>')

    verts = []
    for x, y in hex_pts:
        verts.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="11" fill="#040a08" stroke="#00ffb2" stroke-width="5"/>')
        verts.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="4.5" fill="#ffffff"/>')

    y_slice1 = cy - 65
    y_slice2 = cy + 80
    ray_angle = math.radians(-32)
    rx = cx + hex_r * math.cos(ray_angle)
    ry = cy + hex_r * math.sin(ray_angle)

    arc_r = 125
    sx = cx + arc_r * math.cos(-math.pi/2)
    sy = cy + arc_r * math.sin(-math.pi/2)
    ex = cx + arc_r * math.cos(ray_angle)
    ey = cy + arc_r * math.sin(ray_angle)

    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <filter id="glow-sh" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="10" result="b1"/>
      <feMerge><feMergeNode in="b1"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <polygon points="{hex_str}" fill="#00ffb2" fill-opacity="0.14" stroke="#00ffb2" stroke-width="8.5" stroke-linejoin="round"/>
  <polygon points="{tri_str}" fill="#00e5ff" fill-opacity="0.18" stroke="#00e5ff" stroke-width="6.5" stroke-dasharray="16,10" stroke-linejoin="round"/>
  <polygon points="{core_str}" fill="#ffcc00" fill-opacity="0.3" stroke="#ffcc00" stroke-width="6" stroke-linejoin="round"/>

  <line x1="75" y1="{y_slice1}" x2="437" y2="{y_slice1}" stroke="#ff2a85" stroke-width="6" stroke-linecap="round"/>
  <circle cx="147" cy="{y_slice1}" r="8" fill="#ff2a85"/>
  <circle cx="365" cy="{y_slice1}" r="8" fill="#ff2a85"/>

  <line x1="102" y1="{y_slice2}" x2="410" y2="{y_slice2}" stroke="#ff2a85" stroke-width="6" stroke-dasharray="12,8" stroke-linecap="round"/>
  <circle cx="121" cy="{y_slice2}" r="8" fill="#ff2a85"/>
  <circle cx="391" cy="{y_slice2}" r="8" fill="#ff2a85"/>

  {"".join(ticks)}
  {"".join(verts)}

  <path d="M {sx:.1f} {sy:.1f} A {arc_r} {arc_r} 0 0 1 {ex:.1f} {ey:.1f}" fill="none" stroke="#ff2a85" stroke-width="5.5" stroke-linecap="round"/>
  <line x1="{cx}" y1="{cy}" x2="{rx:.1f}" y2="{ry:.1f}" stroke="#ffffff" stroke-width="7" stroke-linecap="round"/>

  <circle cx="{rx:.1f}" cy="{ry:.1f}" r="22" fill="#00ffb2" fill-opacity="0.45" filter="url(#glow-sh)"/>
  <circle cx="{rx:.1f}" cy="{ry:.1f}" r="14" fill="#ffffff" stroke="#00ffb2" stroke-width="5"/>
  <circle cx="{rx:.1f}" cy="{ry:.1f}" r="5" fill="#040a08"/>

  <circle cx="{cx}" cy="{cy}" r="11" fill="#00ffb2" stroke="#040a08" stroke-width="3.5"/>
  <circle cx="{cx}" cy="{cy}" r="4.5" fill="#ffffff"/>
</svg>'''

# ==========================================
# 2. L-SYSTEMS (Rotated 90 deg, Horizontal)
# ==========================================
def make_lsystems():
    branches = []
    terminal_nodes = []
    junction_nodes = []

    def grow(x, y, length, angle, depth, max_depth):
        nx = x + length * math.cos(angle)
        ny = y + length * math.sin(angle)
        branches.append((x, y, nx, ny, depth))
        
        if depth >= max_depth:
            terminal_nodes.append((nx, ny, depth))
            return
            
        junction_nodes.append((nx, ny, depth))

        if depth == 0:
            grow(nx, ny, length * 0.82, angle - math.radians(38), depth + 1, max_depth)
            grow(nx, ny, length * 0.74, angle, depth + 1, max_depth)
            grow(nx, ny, length * 0.82, angle + math.radians(38), depth + 1, max_depth)
        elif depth == 1:
            grow(nx, ny, length * 0.78, angle - math.radians(30), depth + 1, max_depth)
            grow(nx, ny, length * 0.78, angle + math.radians(30), depth + 1, max_depth)
            grow(nx, ny, length * 0.68, angle + math.radians(5), depth + 1, max_depth)
        elif depth == 2:
            grow(nx, ny, length * 0.76, angle - math.radians(26), depth + 1, max_depth)
            grow(nx, ny, length * 0.76, angle + math.radians(26), depth + 1, max_depth)
        elif depth == 3:
            grow(nx, ny, length * 0.76, angle - math.radians(22), depth + 1, max_depth)
            grow(nx, ny, length * 0.76, angle + math.radians(22), depth + 1, max_depth)

    root_x, root_y = 68, 256
    grow(root_x, root_y, 108, 0, 0, 4)

    palette = {
        0: ("#00ffb2", 13.0),
        1: ("#00e5ff", 9.0),
        2: ("#b85dff", 6.0),
        3: ("#ff2a85", 4.5),
        4: ("#ffcc00", 3.2),
    }

    branch_svg = []
    for x1, y1, x2, y2, d in branches:
        col, sw = palette.get(d, ("#ffcc00", 2.8))
        branch_svg.append(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="{col}" stroke-width="{sw}" stroke-linecap="round"/>')

    buds_svg = []
    for x, y, d in terminal_nodes:
        buds_svg.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="7.5" fill="#ffcc00" stroke="#ffffff" stroke-width="2"/>')

    fork_x, fork_y = root_x + 108, 256

    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <filter id="glow-ls" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="12" result="b1"/>
      <feMerge><feMergeNode in="b1"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <line x1="{root_x}" y1="145" x2="{root_x}" y2="367" stroke="#00ffb2" stroke-width="8" stroke-linecap="round"/>
  <circle cx="{root_x}" cy="{root_y}" r="13" fill="#00ffb2" stroke="#040a08" stroke-width="3.5"/>
  <circle cx="{root_x}" cy="{root_y}" r="4.5" fill="#ffffff"/>

  <path d="M {fork_x+32} 200 Q {fork_x+48} 256 {fork_x+32} 312" fill="none" stroke="#ffcc00" stroke-width="3.5" stroke-dasharray="6,6"/>

  <g stroke-linejoin="round">
    {"".join(branch_svg)}
  </g>

  <circle cx="{fork_x}" cy="{fork_y}" r="10" fill="#00e5ff" stroke="#040a08" stroke-width="3"/>
  <circle cx="{fork_x}" cy="{fork_y}" r="3.5" fill="#ffffff"/>

  <g filter="url(#glow-ls)">
    {"".join(buds_svg)}
  </g>
</svg>'''

# ==========================================
# 3. GRAPH SYNTH (Transparent, Bold)
# ==========================================
def make_graph_synth():
    nodes = [
        {"id": 0, "x": 135, "y": 125, "r": 34, "col": "#00e5ff"},
        {"id": 1, "x": 377, "y": 125, "r": 34, "col": "#b85dff"},
        {"id": 2, "x": 256, "y": 245, "r": 46, "col": "#00ffb2", "active": True},
        {"id": 3, "x": 95, "y": 345, "r": 32, "col": "#ffcc00"},
        {"id": 4, "x": 417, "y": 345, "r": 32, "col": "#ff2a85"},
        {"id": 5, "x": 256, "y": 440, "r": 38, "col": "#00ffb2"},
    ]

    edges = [
        (0, 1, 0.18, "#b85dff", 0.48),
        (0, 2, 0.0, "#00e5ff", 0.65),
        (1, 2, 0.0, "#b85dff", 0.35),
        (2, 3, -0.08, "#ffcc00", 0.52),
        (2, 4, 0.08, "#ff2a85", 0.58),
        (3, 5, -0.06, "#ffcc00", 0.78),
        (4, 5, 0.06, "#ff2a85", 0.72),
        (4, 1, 0.52, "#ff2a85", 0.55),
    ]

    edge_svg = []
    packet_svg = []

    for src_id, dst_id, curve, col, t in edges:
        n1 = nodes[src_id]
        n2 = nodes[dst_id]
        x1, y1 = n1["x"], n1["y"]
        x2, y2 = n2["x"], n2["y"]
        
        mx, my = (x1 + x2) / 2, (y1 + y2) / 2
        dx, dy = x2 - x1, y2 - y1
        dist = math.hypot(dx, dy)
        nx, ny = -dy / dist, dx / dist
        cx = mx + nx * curve * dist
        cy = my + ny * curve * dist
        
        if abs(curve) < 0.01:
            path_str = f"M {x1} {y1} L {x2} {y2}"
            px = x1 + dx * t
            py = y1 + dy * t
            angle = math.atan2(dy, dx)
        else:
            path_str = f"M {x1} {y1} Q {cx:.1f} {cy:.1f} {x2} {y2}"
            px = (1-t)**2 * x1 + 2*(1-t)*t * cx + t**2 * x2
            py = (1-t)**2 * y1 + 2*(1-t)*t * cy + t**2 * y2
            tx_d = 2*(1-t)*(cx - x1) + 2*t*(x2 - cx)
            ty_d = 2*(1-t)*(cy - y1) + 2*t*(y2 - cy)
            angle = math.atan2(ty_d, tx_d)

        edge_svg.append(f'<path d="{path_str}" fill="none" stroke="{col}" stroke-width="6.5" stroke-linecap="round"/>')
        
        alen = 16
        awid = 9
        tip_x = px + alen * math.cos(angle)
        tip_y = py + alen * math.sin(angle)
        b1_x = px - awid * math.sin(angle)
        b1_y = py + awid * math.cos(angle)
        b2_x = px + awid * math.sin(angle)
        b2_y = py - awid * math.cos(angle)
        edge_svg.append(f'<polygon points="{tip_x:.1f},{tip_y:.1f} {b1_x:.1f},{b1_y:.1f} {b2_x:.1f},{b2_y:.1f}" fill="{col}"/>')

        packet_svg.append(f'<circle cx="{px:.1f}" cy="{py:.1f}" r="8.5" fill="#ffffff" stroke="{col}" stroke-width="3"/>')

    node_svg = []
    for n in nodes:
        x, y, r = n["x"], n["y"], n["r"]
        col = n["col"]
        active = n.get("active", False)
        
        if active:
            sine_pts = []
            for sx_i in range(-24, 25):
                sy_i = math.sin(sx_i / 24 * math.pi * 1.5) * 11
                sine_pts.append(f"{x + sx_i:.1f},{y + sy_i:.1f}")
            sine_str = " ".join(sine_pts)

            node_svg.append(f'''
            <circle cx="{x}" cy="{y}" r="{r+14}" fill="none" stroke="{col}" stroke-width="3" stroke-dasharray="6,6"/>
            <circle cx="{x}" cy="{y}" r="{r}" fill="#040e0b" stroke="{col}" stroke-width="6"/>
            <circle cx="{x}" cy="{y}" r="{r-9}" fill="{col}" fill-opacity="0.25"/>
            <polyline points="{sine_str}" fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round"/>
            ''')
        else:
            node_svg.append(f'''
            <circle cx="{x}" cy="{y}" r="{r}" fill="#040a08" stroke="{col}" stroke-width="6"/>
            <circle cx="{x}" cy="{y}" r="{r-10}" fill="{col}" fill-opacity="0.35"/>
            <circle cx="{x}" cy="{y}" r="6" fill="{col}"/>
            ''')

    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <filter id="glow-gs" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="12" result="b1"/>
      <feMerge><feMergeNode in="b1"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <g>{ "".join(edge_svg) }</g>
  <g filter="url(#glow-gs)">{ "".join(packet_svg) }</g>
  <g>{ "".join(node_svg) }</g>
</svg>'''

# ==========================================
# 4. QUADRUPED (Transparent, Bold)
# ==========================================
def make_quadruped():
    cx, cy = 256, 256
    step_r = 215
    steps_svg = []
    
    active_steps = {
        0: ("#ffcc00", "LF"),
        4: ("#00e5ff", "RH"),
        8: ("#ff2a85", "RF"),
        12: ("#00ffb2", "LH"),
    }

    for i in range(16):
        a = -math.pi/2 + i * (2 * math.pi / 16)
        sx = cx + step_r * math.cos(a)
        sy = cy + step_r * math.sin(a)
        
        if i in active_steps:
            col, lbl = active_steps[i]
            steps_svg.append(f'''
            <circle cx="{sx:.1f}" cy="{sy:.1f}" r="17" fill="{col}" fill-opacity="0.3" stroke="{col}" stroke-width="4.5"/>
            <circle cx="{sx:.1f}" cy="{sy:.1f}" r="9" fill="{col}"/>
            <circle cx="{sx:.1f}" cy="{sy:.1f}" r="3.5" fill="#ffffff"/>
            ''')
        else:
            steps_svg.append(f'''
            <circle cx="{sx:.1f}" cy="{sy:.1f}" r="7.5" fill="#040a08" stroke="#00ffb2" stroke-width="2.5" stroke-opacity="0.5"/>
            <circle cx="{sx:.1f}" cy="{sy:.1f}" r="2.5" fill="#00ffb2" opacity="0.8"/>
            ''')

    ground_y = 370

    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <filter id="glow-qp2" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="12" result="b1"/>
      <feMerge><feMergeNode in="b1"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <circle cx="{cx}" cy="{cy}" r="{step_r}" fill="none" stroke="#00e5ff" stroke-width="3.5" stroke-dasharray="6,8" stroke-opacity="0.45"/>
  <line x1="75" y1="{ground_y}" x2="437" y2="{ground_y}" stroke="#00ffb2" stroke-width="6" stroke-dasharray="12,8" stroke-linecap="round"/>

  <!-- Background Legs -->
  <g stroke-linecap="round" stroke-linejoin="round" opacity="0.7">
    <polyline points="175,205 120,250 100,310 78,368" fill="none" stroke="#00e5ff" stroke-width="8"/>
    <circle cx="120" cy="250" r="8" fill="#040a08" stroke="#00e5ff" stroke-width="3.5"/>
    <circle cx="100" cy="310" r="8" fill="#040a08" stroke="#00e5ff" stroke-width="3.5"/>
    <circle cx="78" cy="368" r="10" fill="#00e5ff"/>
  </g>

  <g stroke-linecap="round" stroke-linejoin="round" opacity="0.7">
    <polyline points="335,190 370,235 405,280 428,330" fill="none" stroke="#ff2a85" stroke-width="8"/>
    <circle cx="370" cy="235" r="8" fill="#040a08" stroke="#ff2a85" stroke-width="3.5"/>
    <circle cx="405" cy="280" r="8" fill="#040a08" stroke="#ff2a85" stroke-width="3.5"/>
    <circle cx="428" cy="330" r="10" fill="#ff2a85"/>
  </g>

  <!-- Torso -->
  <polygon points="150,225 175,188 335,178 360,208 330,235 175,240" fill="#00ffb2" fill-opacity="0.3" stroke="#00ffb2" stroke-width="7" stroke-linejoin="round"/>
  <line x1="220" y1="185" x2="255" y2="238" stroke="#00e5ff" stroke-width="4"/>
  <line x1="290" y1="181" x2="255" y2="238" stroke="#00e5ff" stroke-width="4"/>
  <line x1="290" y1="181" x2="330" y2="235" stroke="#00e5ff" stroke-width="4"/>
  <line x1="175" y1="188" x2="335" y2="178" stroke="#ffffff" stroke-width="4" stroke-linecap="round"/>

  <!-- Neck & Sensor Head -->
  <polyline points="335,178 380,135 422,135" fill="none" stroke="#00ffb2" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
  <polygon points="410,120 450,135 410,150" fill="#ffcc00" stroke="#00ffb2" stroke-width="4" stroke-linejoin="round"/>
  <circle cx="422" cy="135" r="6" fill="#ffffff" filter="url(#glow-qp2)"/>

  <path d="M 150 225 C 120 215, 110 170, 95 165" fill="none" stroke="#00e5ff" stroke-width="5" stroke-linecap="round"/>
  <circle cx="95" cy="165" r="7" fill="#ffcc00"/>

  <!-- Foreground Legs -->
  <g stroke-linecap="round" stroke-linejoin="round">
    <polyline points="175,205 152,260 185,320 210,368" fill="none" stroke="#00ffb2" stroke-width="10"/>
    <circle cx="152" cy="260" r="11" fill="#040a08" stroke="#00ffb2" stroke-width="4.5"/>
    <circle cx="152" cy="260" r="4" fill="#00ffb2"/>
    <circle cx="185" cy="320" r="10" fill="#040a08" stroke="#00ffb2" stroke-width="4.5"/>
    <circle cx="210" cy="368" r="14" fill="#00ffb2" filter="url(#glow-qp2)"/>
    <circle cx="210" cy="368" r="5.5" fill="#ffffff"/>
  </g>

  <g stroke-linecap="round" stroke-linejoin="round">
    <polyline points="335,190 350,250 332,315 315,368" fill="none" stroke="#ffcc00" stroke-width="10"/>
    <circle cx="350" cy="250" r="11" fill="#040a08" stroke="#ffcc00" stroke-width="4.5"/>
    <circle cx="350" cy="250" r="4" fill="#ffcc00"/>
    <circle cx="332" cy="315" r="10" fill="#040a08" stroke="#ffcc00" stroke-width="4.5"/>
    <circle cx="315" cy="368" r="15" fill="#ffcc00" filter="url(#glow-qp2)"/>
    <circle cx="315" cy="368" r="6" fill="#ffffff"/>
  </g>

  <circle cx="175" cy="205" r="16" fill="#040a08" stroke="#00ffb2" stroke-width="5"/>
  <circle cx="175" cy="205" r="7" fill="#00ffb2"/>

  <circle cx="335" cy="190" r="16" fill="#040a08" stroke="#00ffb2" stroke-width="5"/>
  <circle cx="335" cy="190" r="7" fill="#ffcc00"/>

  <g>{ "".join(steps_svg) }</g>
</svg>'''

# ==========================================
# 5. SPIRAL (Log-Polar Harmonic Sound Graph)
# ==========================================
def make_spiral():
    cx, cy = 256, 256
    theta_max = 3.8 * math.pi
    steps = 140
    pts1, pts2 = [], []
    a_param, b_param = 18, 0.21
    
    for i in range(steps):
        th = (i / steps) * theta_max
        r = a_param * math.exp(b_param * th)
        if r > 225: break
        pts1.append(f"{cx + r * math.cos(th):.1f},{cy + r * math.sin(th):.1f}")
        pts2.append(f"{cx + r * math.cos(th + math.pi):.1f},{cy + r * math.sin(th + math.pi):.1f}")

    path1 = "M " + " L ".join(pts1)
    path2 = "M " + " L ".join(pts2)

    ray_angle = math.radians(-35)
    rx = cx + 225 * math.cos(ray_angle)
    ry = cy + 225 * math.sin(ray_angle)

    strike_nodes = []
    for k in [0, 1, 2]:
        th = ray_angle + 2 * k * math.pi
        if th < 0: th += 2 * math.pi
        r = a_param * math.exp(b_param * th)
        if 25 < r <= 220:
            strike_nodes.append((cx + r * math.cos(ray_angle), cy + r * math.sin(ray_angle), "#00ffb2"))
            
    for k in [0, 1]:
        th = ray_angle + math.pi + 2 * k * math.pi
        if th < 0: th += 2 * math.pi
        r = a_param * math.exp(b_param * th)
        if 25 < r <= 220:
            strike_nodes.append((cx + r * math.cos(ray_angle), cy + r * math.sin(ray_angle), "#00e5ff"))

    strikes_svg = []
    for x, y, col in strike_nodes:
        strikes_svg.append(f'''
        <circle cx="{x:.1f}" cy="{y:.1f}" r="14" fill="{col}" fill-opacity="0.35" filter="url(#glow-sp)"/>
        <circle cx="{x:.1f}" cy="{y:.1f}" r="8" fill="#ffffff" stroke="{col}" stroke-width="3"/>
        <circle cx="{x:.1f}" cy="{y:.1f}" r="3" fill="#040a08"/>
        ''')

    ticks = []
    for deg in range(0, 360, 15):
        rad = math.radians(deg)
        x1, y1 = cx + 226 * math.cos(rad), cy + 226 * math.sin(rad)
        x2, y2 = cx + 236 * math.cos(rad), cy + 236 * math.sin(rad)
        sw = 4 if deg % 45 == 0 else 2
        col = "#ffcc00" if deg % 90 == 0 else "#00e5ff"
        ticks.append(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="{col}" stroke-width="{sw}" stroke-linecap="round"/>')

    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <filter id="glow-sp" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="12" result="b1"/>
      <feMerge><feMergeNode in="b1"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <circle cx="{cx}" cy="{cy}" r="230" fill="none" stroke="#00e5ff" stroke-width="2.5" stroke-dasharray="6,8" stroke-opacity="0.4"/>
  <circle cx="{cx}" cy="{cy}" r="150" fill="none" stroke="#ff2a85" stroke-width="2" stroke-dasharray="4,6" stroke-opacity="0.3"/>
  <circle cx="{cx}" cy="{cy}" r="75" fill="none" stroke="#ffcc00" stroke-width="2" stroke-dasharray="4,6" stroke-opacity="0.4"/>
  <g>{"".join(ticks)}</g>

  <path d="{path2}" fill="none" stroke="#00e5ff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="{path1}" fill="none" stroke="#00ffb2" stroke-width="9.5" stroke-linecap="round" stroke-linejoin="round"/>

  <line x1="{cx}" y1="{cy}" x2="{rx:.1f}" y2="{ry:.1f}" stroke="#ffffff" stroke-width="6" stroke-linecap="round"/>
  <g>{"".join(strikes_svg)}</g>

  <circle cx="{cx}" cy="{cy}" r="18" fill="#ffcc00" fill-opacity="0.3" filter="url(#glow-sp)"/>
  <circle cx="{cx}" cy="{cy}" r="12" fill="#040a08" stroke="#ffcc00" stroke-width="4"/>
  <circle cx="{cx}" cy="{cy}" r="4.5" fill="#ffffff"/>
</svg>'''

# ==========================================
# 6. LATTICE (2D/3D Isohedral Nodal Mesh)
# ==========================================
def make_lattice():
    cx, cy = 256, 256
    d = 62
    h = d * math.sin(math.pi / 3)
    nodes = []
    
    for row in range(-3, 4):
        y = cy + row * h
        x_offset = (d / 2) if (row % 2 != 0) else 0
        col_count = 5 if abs(row) == 3 else (6 if abs(row) == 2 else 7)
        for col in range(-col_count//2, col_count//2 + 1):
            x = cx + col * d + x_offset
            if math.hypot(x - cx, y - cy) <= 215:
                nodes.append((x, y))

    lines_svg = []
    for i in range(len(nodes)):
        x1, y1 = nodes[i]
        for j in range(i + 1, len(nodes)):
            x2, y2 = nodes[j]
            if abs(math.hypot(x2 - x1, y2 - y1) - d) < 4:
                lines_svg.append(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="#00e5ff" stroke-width="4.5" stroke-opacity="0.55" stroke-linecap="round"/>')

    scan_p1, scan_p2 = (70, 390), (440, 120)
    dx = scan_p2[0] - scan_p1[0]
    dy = scan_p2[1] - scan_p1[1]
    line_len = math.hypot(dx, dy)
    
    active_strikes = []
    regular_nodes_svg = []
    
    for x, y in nodes:
        dist_to_scan = abs(dy * x - dx * y + scan_p2[0] * scan_p1[1] - scan_p2[1] * scan_p1[0]) / line_len
        if dist_to_scan < 22:
            active_strikes.append((x, y))
        else:
            regular_nodes_svg.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="7" fill="#040a08" stroke="#00ffb2" stroke-width="3"/><circle cx="{x:.1f}" cy="{y:.1f}" r="2.5" fill="#00ffb2"/>')

    strikes_svg = []
    for x, y in active_strikes:
        strikes_svg.append(f'''
        <circle cx="{x:.1f}" cy="{y:.1f}" r="18" fill="#ffcc00" fill-opacity="0.35" filter="url(#glow-lat)"/>
        <circle cx="{x:.1f}" cy="{y:.1f}" r="10" fill="#ffffff" stroke="#ffcc00" stroke-width="4"/>
        <circle cx="{x:.1f}" cy="{y:.1f}" r="3.5" fill="#040a08"/>
        ''')

    impulse_x, impulse_y = active_strikes[len(active_strikes)//2]

    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <filter id="glow-lat" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="12" result="b1"/>
      <feMerge><feMergeNode in="b1"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <circle cx="{impulse_x:.1f}" cy="{impulse_y:.1f}" r="65" fill="none" stroke="#ff2a85" stroke-width="3" stroke-dasharray="6,6" stroke-opacity="0.6"/>
  <circle cx="{impulse_x:.1f}" cy="{impulse_y:.1f}" r="125" fill="none" stroke="#ff2a85" stroke-width="2.5" stroke-dasharray="8,8" stroke-opacity="0.4"/>
  <circle cx="{impulse_x:.1f}" cy="{impulse_y:.1f}" r="185" fill="none" stroke="#ff2a85" stroke-width="2" stroke-dasharray="10,10" stroke-opacity="0.25"/>

  <g>{ "".join(lines_svg) }</g>

  <line x1="{scan_p1[0]}" y1="{scan_p1[1]}" x2="{scan_p2[0]}" y2="{scan_p2[1]}" stroke="#ffffff" stroke-width="6.5" stroke-linecap="round"/>
  <line x1="{scan_p1[0]}" y1="{scan_p1[1]}" x2="{scan_p2[0]}" y2="{scan_p2[1]}" stroke="#ffcc00" stroke-width="12" stroke-opacity="0.3" stroke-linecap="round"/>

  <g>{ "".join(regular_nodes_svg) }</g>
  <g>{ "".join(strikes_svg) }</g>
</svg>'''

# ==========================================
# 7. SOLID (3D Polyhedra Slicing Plane)
# ==========================================
def make_solid():
    cx, cy = 256, 256
    scale = 165
    top = (cx, cy - scale * 1.15)
    bottom = (cx, cy + scale * 1.15)
    eq_front = (cx, cy + scale * 0.45)
    eq_right = (cx + scale * 1.1, cy - scale * 0.05)
    eq_back = (cx, cy - scale * 0.45)
    eq_left = (cx - scale * 1.1, cy - scale * 0.05)

    plane_w, plane_h = 210, 75
    plane_pts = [
        (cx - plane_w, cy + 10),
        (cx - 30, cy - plane_h + 10),
        (cx + plane_w, cy + 10),
        (cx + 30, cy + plane_h + 10),
    ]
    plane_str = " ".join(f"{x:.1f},{y:.1f}" for x, y in plane_pts)

    inter_pts = [
        (cx - scale * 0.58, cy + 2),
        (cx - scale * 0.22, cy - scale * 0.22),
        (cx + scale * 0.35, cy - scale * 0.24),
        (cx + scale * 0.62, cy + 3),
        (cx + scale * 0.25, cy + scale * 0.26),
        (cx - scale * 0.32, cy + scale * 0.27),
    ]
    inter_str = " ".join(f"{x:.1f},{y:.1f}" for x, y in inter_pts)

    inter_nodes_svg = []
    for x, y in inter_pts:
        inter_nodes_svg.append(f'''
        <circle cx="{x:.1f}" cy="{y:.1f}" r="15" fill="#ffcc00" fill-opacity="0.35" filter="url(#glow-sol)"/>
        <circle cx="{x:.1f}" cy="{y:.1f}" r="8.5" fill="#ffffff" stroke="#ffcc00" stroke-width="3.5"/>
        <circle cx="{x:.1f}" cy="{y:.1f}" r="3" fill="#040a08"/>
        ''')

    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <filter id="glow-sol" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="12" result="b1"/>
      <feMerge><feMergeNode in="b1"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <line x1="{top[0]}" y1="{top[1]}" x2="{eq_back[0]}" y2="{eq_back[1]}" stroke="#00e5ff" stroke-width="4.5" stroke-dasharray="8,6" stroke-opacity="0.5"/>
  <line x1="{bottom[0]}" y1="{bottom[1]}" x2="{eq_back[0]}" y2="{eq_back[1]}" stroke="#00e5ff" stroke-width="4.5" stroke-dasharray="8,6" stroke-opacity="0.5"/>
  <line x1="{eq_left[0]}" y1="{eq_left[1]}" x2="{eq_back[0]}" y2="{eq_back[1]}" stroke="#00e5ff" stroke-width="4.5" stroke-dasharray="8,6" stroke-opacity="0.5"/>
  <line x1="{eq_right[0]}" y1="{eq_right[1]}" x2="{eq_back[0]}" y2="{eq_back[1]}" stroke="#00e5ff" stroke-width="4.5" stroke-dasharray="8,6" stroke-opacity="0.5"/>
  <circle cx="{eq_back[0]}" cy="{eq_back[1]}" r="8" fill="#040a08" stroke="#00e5ff" stroke-width="3" stroke-opacity="0.6"/>

  <polygon points="{plane_str}" fill="#ff2a85" fill-opacity="0.22" stroke="#ff2a85" stroke-width="5" stroke-linejoin="round"/>
  <polygon points="{inter_str}" fill="#ffcc00" fill-opacity="0.3" stroke="#ffffff" stroke-width="6" stroke-linejoin="round"/>

  <line x1="{top[0]}" y1="{top[1]}" x2="{eq_left[0]}" y2="{eq_left[1]}" stroke="#00ffb2" stroke-width="8.5" stroke-linecap="round"/>
  <line x1="{top[0]}" y1="{top[1]}" x2="{eq_front[0]}" y2="{eq_front[1]}" stroke="#00ffb2" stroke-width="9.5" stroke-linecap="round"/>
  <line x1="{top[0]}" y1="{top[1]}" x2="{eq_right[0]}" y2="{eq_right[1]}" stroke="#00ffb2" stroke-width="8.5" stroke-linecap="round"/>

  <line x1="{eq_left[0]}" y1="{eq_left[1]}" x2="{eq_front[0]}" y2="{eq_front[1]}" stroke="#00ffb2" stroke-width="8.5" stroke-linecap="round"/>
  <line x1="{eq_front[0]}" y1="{eq_front[1]}" x2="{eq_right[0]}" y2="{eq_right[1]}" stroke="#00ffb2" stroke-width="8.5" stroke-linecap="round"/>

  <line x1="{bottom[0]}" y1="{bottom[1]}" x2="{eq_left[0]}" y2="{eq_left[1]}" stroke="#00ffb2" stroke-width="8.5" stroke-linecap="round"/>
  <line x1="{bottom[0]}" y1="{bottom[1]}" x2="{eq_front[0]}" y2="{eq_front[1]}" stroke="#00ffb2" stroke-width="9.5" stroke-linecap="round"/>
  <line x1="{bottom[0]}" y1="{bottom[1]}" x2="{eq_right[0]}" y2="{eq_right[1]}" stroke="#00ffb2" stroke-width="8.5" stroke-linecap="round"/>

  <g>{ "".join(inter_nodes_svg) }</g>

  <circle cx="{top[0]}" cy="{top[1]}" r="12" fill="#040a08" stroke="#00ffb2" stroke-width="4"/><circle cx="{top[0]}" cy="{top[1]}" r="4" fill="#ffffff"/>
  <circle cx="{bottom[0]}" cy="{bottom[1]}" r="12" fill="#040a08" stroke="#00ffb2" stroke-width="4"/><circle cx="{bottom[0]}" cy="{bottom[1]}" r="4" fill="#ffffff"/>
  <circle cx="{eq_left[0]}" cy="{eq_left[1]}" r="11" fill="#040a08" stroke="#00ffb2" stroke-width="4"/><circle cx="{eq_left[0]}" cy="{eq_left[1]}" r="4" fill="#ffffff"/>
  <circle cx="{eq_right[0]}" cy="{eq_right[1]}" r="11" fill="#040a08" stroke="#00ffb2" stroke-width="4"/><circle cx="{eq_right[0]}" cy="{eq_right[1]}" r="4" fill="#ffffff"/>
  <circle cx="{eq_front[0]}" cy="{eq_front[1]}" r="13" fill="#040a08" stroke="#00ffb2" stroke-width="4.5"/><circle cx="{eq_front[0]}" cy="{eq_front[1]}" r="5" fill="#ffffff"/>
</svg>'''

# ==========================================
# 8. HYPER (4D Tesseract Projection)
# ==========================================
def make_hyper():
    cx, cy = 256, 256
    dx_c, dy_c = 65, -48
    fcx = cx - dx_c * 0.45
    fcy = cy - dy_c * 0.45
    w_out = 115
    
    out_front = [
        (fcx - w_out, fcy - w_out),
        (fcx + w_out, fcy - w_out),
        (fcx + w_out, fcy + w_out),
        (fcx - w_out, fcy + w_out),
    ]
    out_back = [(x + dx_c, y + dy_c) for x, y in out_front]

    scale_in = 0.46
    in_front = [(cx + (x - cx) * scale_in, cy + (y - cy) * scale_in) for x, y in out_front]
    in_back = [(cx + (x - cx) * scale_in, cy + (y - cy) * scale_in) for x, y in out_back]

    hyper_edges = []
    for i in range(4):
        hyper_edges.append((out_front[i], in_front[i]))
        hyper_edges.append((out_back[i], in_back[i]))

    hyper_svg = [f'<line x1="{p1[0]:.1f}" y1="{p1[1]:.1f}" x2="{p2[0]:.1f}" y2="{p2[1]:.1f}" stroke="#b85dff" stroke-width="6.5" stroke-linecap="round"/>' for p1, p2 in hyper_edges]
    slice_line = ((fcx - w_out - 25, fcy + w_out * 0.3), (fcx + w_out + dx_c + 25, fcy - w_out + dy_c * 0.7))

    out_svg = []
    for i in range(4):
        p1, p2 = out_front[i], out_front[(i+1)%4]
        out_svg.append(f'<line x1="{p1[0]:.1f}" y1="{p1[1]:.1f}" x2="{p2[0]:.1f}" y2="{p2[1]:.1f}" stroke="#00ffb2" stroke-width="8.5" stroke-linecap="round"/>')
    for i in range(4):
        p1, p2 = out_back[i], out_back[(i+1)%4]
        out_svg.append(f'<line x1="{p1[0]:.1f}" y1="{p1[1]:.1f}" x2="{p2[0]:.1f}" y2="{p2[1]:.1f}" stroke="#00ffb2" stroke-width="5.5" stroke-opacity="0.6" stroke-linecap="round"/>')
    for i in range(4):
        p1, p2 = out_front[i], out_back[i]
        out_svg.append(f'<line x1="{p1[0]:.1f}" y1="{p1[1]:.1f}" x2="{p2[0]:.1f}" y2="{p2[1]:.1f}" stroke="#00ffb2" stroke-width="7" stroke-linecap="round"/>')

    in_svg = []
    for i in range(4):
        p1, p2 = in_front[i], in_front[(i+1)%4]
        in_svg.append(f'<line x1="{p1[0]:.1f}" y1="{p1[1]:.1f}" x2="{p2[0]:.1f}" y2="{p2[1]:.1f}" stroke="#00e5ff" stroke-width="6.5" stroke-linecap="round"/>')
    for i in range(4):
        p1, p2 = in_back[i], in_back[(i+1)%4]
        in_svg.append(f'<line x1="{p1[0]:.1f}" y1="{p1[1]:.1f}" x2="{p2[0]:.1f}" y2="{p2[1]:.1f}" stroke="#00e5ff" stroke-width="4.5" stroke-opacity="0.6" stroke-linecap="round"/>')
    for i in range(4):
        p1, p2 = in_front[i], in_back[i]
        in_svg.append(f'<line x1="{p1[0]:.1f}" y1="{p1[1]:.1f}" x2="{p2[0]:.1f}" y2="{p2[1]:.1f}" stroke="#00e5ff" stroke-width="5.5" stroke-linecap="round"/>')

    verts_svg = []
    for x, y in out_front + out_back:
        verts_svg.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="9" fill="#040a08" stroke="#00ffb2" stroke-width="3.5"/><circle cx="{x:.1f}" cy="{y:.1f}" r="3" fill="#ffffff"/>')
    for x, y in in_front + in_back:
        verts_svg.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="7" fill="#040a08" stroke="#00e5ff" stroke-width="3"/><circle cx="{x:.1f}" cy="{y:.1f}" r="2.5" fill="#ffcc00"/>')

    slice_nodes = [
        (in_front[1][0]*0.55 + out_front[1][0]*0.45, in_front[1][1]*0.55 + out_front[1][1]*0.45),
        (in_front[2][0]*0.45 + out_front[2][0]*0.55, in_front[2][1]*0.45 + out_front[2][1]*0.55),
        (in_back[0][0]*0.5 + out_back[0][0]*0.5, in_back[0][1]*0.5 + out_back[0][1]*0.5),
    ]
    sn_svg = []
    for x, y in slice_nodes:
        sn_svg.append(f'''
        <circle cx="{x:.1f}" cy="{y:.1f}" r="16" fill="#ffcc00" fill-opacity="0.4" filter="url(#glow-hyp)"/>
        <circle cx="{x:.1f}" cy="{y:.1f}" r="9" fill="#ffffff" stroke="#ffcc00" stroke-width="4"/>
        <circle cx="{x:.1f}" cy="{y:.1f}" r="3" fill="#040a08"/>
        ''')

    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <filter id="glow-hyp" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="12" result="b1"/>
      <feMerge><feMergeNode in="b1"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <line x1="{slice_line[0][0]:.1f}" y1="{slice_line[0][1]:.1f}" x2="{slice_line[1][0]:.1f}" y2="{slice_line[1][1]:.1f}" stroke="#ff2a85" stroke-width="5.5" stroke-dasharray="12,8" stroke-linecap="round"/>
  <g>{ "".join(hyper_svg) }</g>
  <g>{ "".join(out_svg) }</g>
  <g>{ "".join(in_svg) }</g>
  <g>{ "".join(verts_svg) }</g>
  <g>{ "".join(sn_svg) }</g>
</svg>'''

# ==========================================
# 9. JAW HARP (Acoustic Cantilever Reed Physical Model)
# ==========================================
def make_jawharp():
    frame_path = (
        "M 415 190 "
        "L 245 200 "
        "C 195 200, 160 145, 120 170 "
        "C 70 205, 70 307, 120 342 "
        "C 160 367, 195 312, 245 312 "
        "L 415 322"
    )

    formants = []
    for r in [65, 110, 155]:
        formants.append(f'<path d="M 405 {256 - r} A {r} {r} 0 0 1 405 {256 + r}" fill="none" stroke="#ff2a85" stroke-width="4.5" stroke-dasharray="8,8" stroke-opacity="0.6"/>')

    reed_wave_top = []
    reed_wave_bot = []
    for x_i in range(88, 425, 8):
        t = (x_i - 88) / 337.0
        amp = t**1.8 * 24
        w = math.sin(t * math.pi * 3) * amp
        reed_wave_top.append(f"{x_i:.1f},{256 - abs(w):.1f}")
        reed_wave_bot.append(f"{x_i:.1f},{256 + abs(w):.1f}")

    wave_top_str = "M " + " L ".join(reed_wave_top)
    wave_bot_str = "M " + " L ".join(reed_wave_bot)

    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <filter id="glow-jh" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="12" result="b1"/>
      <feMerge><feMergeNode in="b1"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <g>{ "".join(formants) }</g>

  <path d="{frame_path}" fill="none" stroke="#00ffb2" stroke-width="26" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="{frame_path}" fill="none" stroke="#040a08" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="{frame_path}" fill="none" stroke="#00ffb2" stroke-width="3" stroke-linecap="round" stroke-dasharray="6,8"/>

  <circle cx="415" cy="190" r="14" fill="#040a08" stroke="#00ffb2" stroke-width="4"/>
  <circle cx="415" cy="190" r="5.5" fill="#00ffb2"/>
  <circle cx="415" cy="322" r="14" fill="#040a08" stroke="#00ffb2" stroke-width="4"/>
  <circle cx="415" cy="322" r="5.5" fill="#00ffb2"/>

  <circle cx="75" cy="256" r="18" fill="#040a08" stroke="#00ffb2" stroke-width="5"/>
  <circle cx="75" cy="256" r="8" fill="#00ffb2"/>

  <path d="{wave_top_str}" fill="none" stroke="#00e5ff" stroke-width="3.5" stroke-dasharray="6,4" stroke-opacity="0.75"/>
  <path d="{wave_bot_str}" fill="none" stroke="#00e5ff" stroke-width="3.5" stroke-dasharray="6,4" stroke-opacity="0.75"/>

  <line x1="75" y1="256" x2="430" y2="256" stroke="#ffffff" stroke-width="7.5" stroke-linecap="round"/>
  <line x1="75" y1="256" x2="430" y2="256" stroke="#00e5ff" stroke-width="15" stroke-opacity="0.25" stroke-linecap="round"/>

  <polyline points="430,256 430,185 455,185" fill="none" stroke="#ffcc00" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
  
  <circle cx="455" cy="185" r="17" fill="#ffcc00" fill-opacity="0.4" filter="url(#glow-jh)"/>
  <circle cx="455" cy="185" r="9.5" fill="#ffffff" stroke="#ffcc00" stroke-width="3.5"/>
  <circle cx="455" cy="185" r="3" fill="#040a08"/>

  <rect x="85" y="244" width="24" height="24" rx="5" fill="#ffcc00" stroke="#040a08" stroke-width="3"/>
</svg>'''

icons = [
    ("shapes", make_shapes),
    ("l-systems", make_lsystems),
    ("graph-synth", make_graph_synth),
    ("quadruped", make_quadruped),
    ("spiral", make_spiral),
    ("lattice", make_lattice),
    ("solid", make_solid),
    ("hyper", make_hyper),
    ("jaw-harp", make_jawharp),
]

dir_path = os.path.dirname(__file__)

for name, fn in icons:
    svg_str = fn()
    svg_file = os.path.join(dir_path, f"{name}.svg")
    webp_file = os.path.join(dir_path, f"{name}.webp")
    with open(svg_file, "w") as f:
        f.write(svg_str)
    render_svg_to_webp(svg_str, webp_file)

print(f"Successfully generated all {len(icons)} icons in artwork/vector-instrument-icons/!")
