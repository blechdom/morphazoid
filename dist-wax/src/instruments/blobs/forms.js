// Authored closed outlines for the preset bank. These stay ordinary editable
// pen/pencil/line points: there is no hidden procedural shape after recall.
export const FORM_IDS = Object.freeze([
  'crescent', 'drop', 'heart', 'bean', 'peanut', 'cloud', 'clover', 'leaf',
  'flame', 'ribbon', 'spiral', 'lightning', 'stairs', 'burst', 'gear', 'comb',
  'amoeba', 'horseshoe', 'wing', 'handdrawn', 'meander', 'fan', 'hook',
  'oval', 'eye', 'diamond', 'hourglass', 'beetle', 'moth', 'tick', 'crawler', 'squid',
]);

const TAU = Math.PI * 2;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const number = (value, fallback) => Number.isFinite(value) ? value : fallback;
const point = ([x, y]) => ({ x, y, hx: 0, hy: 0, inHx: 0, inHy: 0 });

function polygon(coordinates, tool = 'line', tension = .14) {
  const points = coordinates.map(point);
  if (tool === 'pen') for (let i = 0; i < points.length; i++) {
    const previous = points[(i + points.length - 1) % points.length];
    const next = points[(i + 1) % points.length];
    const p = points[i];
    p.hx = (next.x - previous.x) * tension;
    p.hy = (next.y - previous.y) * tension;
    p.inHx = -p.hx;
    p.inHy = -p.hy;
  }
  return { tool, points };
}

// Each segment stores its two absolute controls and endpoint. Closing segments
// join the first anchor rather than adding a duplicate point at the seam.
function cubic(start, segments) {
  const points = [point(start)];
  for (const [c1x, c1y, c2x, c2y, x, y] of segments) {
    const previous = points.at(-1);
    previous.hx = c1x - previous.x;
    previous.hy = c1y - previous.y;
    const next = x === start[0] && y === start[1] ? points[0] : point([x, y]);
    next.inHx = c2x - x;
    next.inHy = c2y - y;
    if (next !== points[0]) points.push(next);
  }
  return { tool: 'pen', points };
}

function ribbon(centers, radius, smooth = true) {
  const sides = [-1, 1].map(side => centers.map(([x, y], i) => {
    const previous = centers[Math.max(0, i - 1)], next = centers[Math.min(centers.length - 1, i + 1)];
    const dx = next[0] - previous[0], dy = next[1] - previous[1];
    const length = Math.hypot(dx, dy) || 1;
    return [x - side * dy / length * radius, y + side * dx / length * radius];
  }));
  return polygon([...sides[0], ...sides[1].reverse()], smooth ? 'pen' : 'line', .1);
}

// Draw down one side, then return along its reflection. The center anchors
// occur only once, so these remain one closed, directly editable outline.
function bilateral(side, tool = 'line', tension = .06) {
  return polygon([...side, ...side.slice(1, -1).reverse().map(([x, y]) => [-x, y])], tool, tension);
}

function localForm(kind, v, detail) {
  switch (kind) {
    case 'oval': {
      const k = .276142374915397;
      return cubic([0, -.5], [
        [k, -.5, .5, -k, .5, 0], [ .5, k, k, .5, 0, .5],
        [-k, .5, -.5, k, -.5, 0], [-.5, -k, -k, -.5, 0, -.5],
      ]);
    }
    case 'eye': {
      const shoulder = (.5 + .14 + v * .14) / 2;
      return cubic([-.5, 0], [
        [-shoulder, -.25, -shoulder / 2, -.375, 0, -.375],
        [shoulder / 2, -.375, shoulder, -.25, .5, 0],
        [shoulder, .25, shoulder / 2, .375, 0, .375],
        [-shoulder / 2, .375, -shoulder, .25, -.5, 0],
      ]);
    }
    case 'diamond': return polygon([[0, -.5], [.5, 0], [0, .5], [-.5, 0]]);
    case 'hourglass': {
      const waist = .07 + .09 * v;
      return cubic([-.42, -.5], [
        [-.2, -.5, .2, -.5, .42, -.5],
        [.63, -.46, waist, -.15, waist, 0],
        [waist, .15, .63, .46, .42, .5],
        [.2, .5, -.2, .5, -.42, .5],
        [-.63, .46, -waist, .15, -waist, 0],
        [-waist, -.15, -.63, -.46, -.42, -.5],
      ]);
    }
    // These are stylized marker-drawn creatures. Limbs and antennae are
    // cut into the same outline as the body, so every reader stays connected.
    case 'beetle': return bilateral([
      [0, -.36], [.08, -.38], [.2, -.58 - .06 * v], [.25, -.55],
      [.17, -.3], [.23, -.21], [.47, -.3], [.5, -.24], [.27, -.08],
      [.51, -.02], [.51, .04], [.28, .08], [.45, .3], [.39, .34],
      [.22, .23], [.18, .44], [0, .51],
    ], 'pen', .04);
    case 'moth': return bilateral([
      [0, -.34], [.07, -.34], [.16, -.58], [.21, -.56], [.15, -.25],
      [.47, -.46], [.58, -.38], [.51, -.06], [.27, .12],
      [.49, .31], [.42, .51], [.15, .27 + .1 * v], [.08, .46], [0, .36],
    ], 'pen', .065);
    case 'tick': return bilateral([
      [0, -.4], [.18, -.37], [.29, -.57], [.35, -.53], [.29, -.23],
      [.52, -.3], [.55, -.23], [.32, -.08], [.58, .07], [.55, .15],
      [.31, .08], [.5, .4], [.43, .44], [.25, .24], [.29, .52],
      [.21, .54], [.13 + .03 * v, .34], [0, .38],
    ]);
    case 'crawler': return polygon([
      [-.53, -.11], [-.42, -.29], [-.23, -.23], [-.11, -.45], [-.04, -.42],
      [-.1, -.15], [.1, -.13], [.23, -.36], [.3, -.33], [.24, -.1],
      [.42, -.1], [.57, -.3], [.63, -.24], [.56, -.02], [.49, .15],
      [.27, .18], [.3, .4], [.22, .43], [.14, .21], [-.03, .24],
      [-.09, .45], [-.16, .42], [-.16, .21], [-.33, .17],
      [-.47, .31 + v * .04], [-.54, .27], [-.45, .06], [-.57, .02],
    ], 'pen', .045);
    case 'squid': return bilateral([
      [0, -.6], [.15, -.47], [.29, -.24], [.39, -.11], [.22, -.08],
      [.27, .14], [.52, .32], [.5, .43], [.19, .25], [.24, .53],
      [.16, .59], [.08, .25], [0, .43 + .07 * v],
    ], 'pen', .035);
    case 'crescent': return cubic([.36, -.48], [
      [-.28, -.67, -.62, -.25, -.48, .14],
      [-.4, .52, .03, .66, .4, .32],
      [.02, .47, -.19 - v * .12, .12, -.06, -.12],
      [.01, -.24, .23, -.35, .36, -.48],
    ]);
    case 'drop': return cubic([-.18 + v * .36, -.58], [
      [.08, -.15, .53, .02, .46, .3],
      [.42, .57, -.01, .68, -.29, .46],
      [-.65, .18, -.18, -.15, -.18 + v * .36, -.58],
    ]);
    case 'heart': return cubic([0, -.18 - v * .11], [
      [.28, -.69, .63, -.3, .43, .03],
      [.31, .24, .13, .32, 0, .58],
      [-.16, .32, -.49, .14, -.5, -.15],
      [-.52, -.52, -.16, -.65, 0, -.18 - v * .11],
    ]);
    case 'bean': return cubic([.19, -.48], [
      [.57, -.35, .57, .17, .27, .43],
      [-.02, .68, -.48, .48, -.48, .14],
      [-.45, -.13, -.05 + .18 * v, .21, -.12 + .18 * v, -.04],
      [-.26, -.27, -.14, -.55, .19, -.48],
    ]);
    case 'peanut': return cubic([-.48, -.22], [
      [-.39, -.66, -.03, -.34, 0, -.12 + .06 * v],
      [.22, -.37, .52, -.49, .54, -.1],
      [.64, .45, .18, .54, .02, .16 - .06 * v],
      [-.2, .45, -.62, .31, -.48, -.22],
    ]);
    case 'cloud': return cubic([-.48, .19], [
      [-.77, -.04, -.37, -.43, -.21, -.19],
      [-.19, -.64, .3, -.64 + v * .12, .31, -.25],
      [.65, -.36, .72, .12, .46, .21],
      [.42, .48, .03, .4, -.05, .3],
      [-.25, .54, -.55, .4, -.48, .19],
    ]);
    case 'clover': {
      const points = [];
      for (let i = 0; i < 12; i++) {
        const angle = TAU * i / 12 - Math.PI / 2;
        const radius = i % 3 === 0 ? .19 + v * .06 : .51;
        points.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
      }
      return polygon(points, 'pen', .16);
    }
    case 'leaf': return cubic([-.49, .5], [
      [-.46, -.15, -.09, -.52, .46, -.48],
      [.48, -.2, .44 + v * .1, .18, .14, .33],
      [-.02, .41, -.29, .42, -.49, .5],
    ]);
    case 'flame': return cubic([.12 + .25 * v, -.62], [
      [.04 + .1 * v, -.29, .24, -.21, .31, -.04],
      [.42, .2, .6, .01, .48, -.15],
      [.79, .17, .29, .7, -.06, .52],
      [-.64, .53, -.61, .06, -.25, -.3],
      [-.31, .07, -.02, .16, -.01, -.1],
      [.04, -.34, -.01, -.45, .12 + .25 * v, -.62],
    ]);
    case 'ribbon': return ribbon(Array.from({ length: 12 }, (_, i) => {
      const t = i / 11;
      return [Math.sin(t * TAU) * (.32 + v * .08), t - .5];
    }), .06 + .025 * v);
    case 'spiral': return ribbon(Array.from({ length: 16 }, (_, i) => {
      const t = i / 15, angle = -.4 + t * TAU * (1.12 + v * .28), radius = .08 + t * .48;
      return [Math.cos(angle) * radius, Math.sin(angle) * radius];
    }), .031 + v * .008);
    case 'lightning': return polygon([
      [.02 + .13 * v, -.56], [-.45, .08], [-.09, .05], [-.23, .58],
      [.49, -.18], [.11, -.08], [.31, -.56],
    ]);
    case 'stairs': {
      const steps = detail, points = [[-.5, .38]];
      for (let i = 0; i < steps; i++) {
        const x = -.5 + (i + 1) / steps, y = .38 - i * .8 / steps;
        points.push([x, y], [x, y - .8 / steps]);
      }
      return polygon([...points, ...points.map(([x, y]) => [x + .055 + v * .03, y + .065 + v * .03]).reverse()]);
    }
    case 'burst': return polygon(Array.from({ length: detail * 2 }, (_, i) => {
      const angle = TAU * i / (detail * 2) - Math.PI / 2;
      const radius = i % 2 ? .13 + v * .14 : .45 + .08 * Math.sin(i * 2.7);
      return [Math.cos(angle) * radius, Math.sin(angle) * radius];
    }));
    case 'gear': return polygon(Array.from({ length: detail * 4 }, (_, i) => {
      const angle = TAU * (i + .15) / (detail * 4), radius = i % 4 < 2 ? .5 : .3 + v * .08;
      return [Math.cos(angle) * radius, Math.sin(angle) * radius];
    }));
    case 'comb': {
      const points = [[-.5, .42], [-.5, -.5]];
      for (let i = 0; i < detail; i++) {
        const x = -.5 + i / detail, gap = .42 / detail;
        if (i) points.push([x, -.5]);
        points.push([x + gap, -.5], [x + gap, .12 + v * .1], [x + 1 / detail, .12 + v * .1]);
      }
      points.push([.5, .42]);
      return polygon(points);
    }
    case 'amoeba': return polygon(Array.from({ length: 15 }, (_, i) => {
      const angle = TAU * i / 15;
      const radius = .36 + .13 * Math.sin(angle * 3 + v * 3) + .07 * Math.cos(angle * 5 - .6);
      return [Math.cos(angle) * radius, Math.sin(angle) * radius];
    }), 'pen', .16);
    case 'horseshoe': return cubic([-.45, -.43], [
      [-.75, .5, -.08, .68, .32, .43],
      [.62, .25, .63, -.22, .43, -.49],
      [.4, -.55, .24, -.49, .23, -.38],
      [.49, .13, .03, .36, -.18, .1],
      [-.31, -.02, -.27, -.29, -.21, -.43 + v * .09],
      [-.18, -.51, -.4, -.55, -.45, -.43],
    ]);
    case 'wing': return cubic([-.47, .4], [
      [-.58, -.25, -.13, -.58, .5, -.5],
      [.38, -.39, .35, -.23, .03, -.12],
      [.28, -.07, .46, -.1, .35, .03],
      [.21, .16, .13, .11, -.09, .12],
      [.14, .18, .19, .35, .02, .37],
      [-.13, .4 + v * .13, -.23, .24, -.47, .4],
    ]);
    case 'handdrawn': return polygon(Array.from({ length: 32 }, (_, i) => {
      const angle = TAU * i / 32, radius = .38 + .09 * Math.sin(angle * 2 + v * 4)
        + .07 * Math.sin(angle * 3 - .8) + .028 * Math.cos(angle * 11 + v);
      return [Math.cos(angle) * radius, Math.sin(angle) * radius + .07 * Math.cos(angle * 2)];
    }), 'pencil');
    case 'meander': return ribbon([
      [-.48, -.42], [.35, -.42], [.45, -.26], [.34, -.1], [-.3, -.1],
      [-.43, .08], [-.31, .26], [.27, .26], [.43, .43], [.29, .58],
    ], .07 + v * .025, false);
    case 'fan': {
      const points = [[-.05, .48]];
      for (let i = 0; i <= 12; i++) {
        const angle = Math.PI + i * Math.PI / 12, radius = i % 2 ? .45 : .53 + .04 * v;
        points.push([Math.cos(angle) * radius, Math.sin(angle) * radius + .15]);
      }
      return polygon(points, 'pen', .08);
    }
    case 'hook': return cubic([-.45, -.48], [
      [-.09, -.69, .57, -.41, .5, .01],
      [.49, .39, -.14, .57, -.36, .26],
      [-.56, .06, -.36, -.13, -.17, -.1],
      [-.36, .04, -.16, .25, .04, .12],
      [.38, -.09, .03, -.42, -.45, -.23 + v * .06],
      [-.52, -.25, -.52, -.42, -.45, -.48],
    ]);
    default: return localForm('amoeba', v, detail);
  }
}

function controlBounds(points) {
  const x = [], y = [];
  for (const p of points) {
    x.push(p.x, p.x + p.hx, p.x + p.inHx);
    y.push(p.y, p.y + p.hy, p.y + p.inHy);
  }
  return { minX: Math.min(...x), maxX: Math.max(...x), minY: Math.min(...y), maxY: Math.max(...y) };
}

/** Rotation is in radians; variant is 0–1 and detail is 3–8. Width and height
 * bound the unrotated control hull. Rotation preserves its proportions and
 * only shrinks uniformly when needed to fit the stage around the given center. */
export function createBlobForm(kind, options = {}) {
  const v = clamp(number(options.variant, .5), 0, 1);
  const detail = Math.round(clamp(number(options.detail, 5), 3, 8));
  const shape = localForm(kind, v, detail);
  const width = clamp(number(options.width, .65), .1, .94);
  const height = clamp(number(options.height, .65), .1, .94);
  const x = clamp(number(options.x, .5), .08, .92);
  const y = clamp(number(options.y, .5), .08, .92);
  const rotation = number(options.rotation, 0), c = Math.cos(rotation), s = Math.sin(rotation);
  const bounds = controlBounds(shape.points);
  const midX = (bounds.minX + bounds.maxX) / 2, midY = (bounds.minY + bounds.maxY) / 2;
  const scaleX = width / (bounds.maxX - bounds.minX), scaleY = height / (bounds.maxY - bounds.minY);
  const rotate = (px, py) => ({ x: px * c - py * s, y: px * s + py * c });
  const rotated = shape.points.map(p => {
    const position = rotate((p.x - midX) * scaleX, (p.y - midY) * scaleY);
    const out = rotate(p.hx * scaleX, p.hy * scaleY), incoming = rotate(p.inHx * scaleX, p.inHy * scaleY);
    return { ...position, hx: out.x, hy: out.y, inHx: incoming.x, inHy: incoming.y };
  });
  const rotatedBounds = controlBounds(rotated);
  const fit = Math.min(1, (x - .03) / Math.max(1e-9, -rotatedBounds.minX),
    (.97 - x) / Math.max(1e-9, rotatedBounds.maxX),
    (y - .03) / Math.max(1e-9, -rotatedBounds.minY),
    (.97 - y) / Math.max(1e-9, rotatedBounds.maxY));
  // Browser scene persistence uses JSON, which canonicalizes negative zero.
  const scaledHandle = value => value * fit || 0;
  return { tool: shape.tool, points: rotated.map(p => ({ x: x + p.x * fit, y: y + p.y * fit,
    hx: scaledHandle(p.hx), hy: scaledHandle(p.hy), inHx: scaledHandle(p.inHx), inHy: scaledHandle(p.inHy) })) };
}
