const TAU = Math.PI * 2;
const INK = '#111423';
const PALETTES = [
  ['#ff8158', '#a83754', '#ffd574'], ['#b5ef57', '#428e68', '#e2ff9a'],
  ['#69e9e8', '#5375b0', '#c9f9ee'], ['#ff82b8', '#a34794', '#ffd0da'],
  ['#b0a1ff', '#6554a0', '#e4d2ff'], ['#ffe373', '#b2804d', '#fff5b6'],
  ['#b5fd8a', '#57976c', '#e1ffc7'],
];
const signedPower = (value, power) => Math.sign(value) * Math.abs(value) ** power;

// Unbranched paths: every mark belongs to the tube, with no face or appendages.
// Different paths give the seven voices their own way of crossing the dance bay.
function course(angle, index) {
  const s = Math.sin(angle), c = Math.cos(angle);
  switch (index) {
    case 0: return [signedPower(c, .6), signedPower(s, .6)];
    case 1: { const r = .77 + .22 * Math.cos(angle * 3); return [c * r, s * r]; }
    case 2: return [s, Math.sin(angle * 2)];
    case 3: return [c * (.8 + .2 * Math.sin(angle * 3)), s];
    case 4: return [signedPower(s, .5), signedPower(c, .5)];
    case 5: return [s, .75 * c + .25 * Math.cos(angle * 3)];
    default: return [.8 * s + .2 * Math.sin(angle * 5), c];
  }
}

/** A traveling wave runs down each tapered worm as it slithers around its bay.
 * Travel, coiling and body bands all follow the audible phrase, never a timer. */
export function drawWormSkin(brush, pose, index) {
  const { line } = brush;
  const [body, shade, highlight] = PALETTES[index];
  const phase = pose.moving ? pose.phase * TAU : 0;
  const attack = pose.moving ? pose.expression : 0;
  const turn = phase + index * .8;
  const travelX = pose.moving ? Math.sin(phase + index) * 3 : 0;
  const travelY = pose.moving ? Math.cos(phase * 2 + index) * 3 : 0;
  const span = [3.9, 5.1, 4.7, 4.2, 3.7, 4.4, 4.8][index];
  const girth = [3.8, 5, 3.2, 4.4, 3.5, 3.3, 3.1][index];
  const points = [];
  for (let n = 0; n <= 64; n++) {
    const t = n / 64, angle = turn - t * span;
    const [cx, cy] = course(angle, index);
    const before = course(angle - .025, index), after = course(angle + .025, index);
    const dx = (after[0] - before[0]) * 11, dy = (after[1] - before[1]) * 13.5;
    const length = Math.hypot(dx, dy) || 1;
    const normal = [-dy / length, dx / length];
    const wave = Math.sin(t * TAU * (2 + index * .12) - phase * 2) * (1 + attack * .35);
    const taper = Math.sin(Math.PI * (.12 + t * .84)) ** .65;
    const width = 1.2 + girth * taper * (1 - t * .45);
    points.push({
      x: cx * 11 + travelX + normal[0] * wave,
      y: -21 + cy * 13.5 + travelY + normal[1] * wave,
      normal, width,
    });
  }
  // Layer the whole outline first so bends overlap as one continuous body.
  for (const [extra, color] of [[2, INK], [0, shade], [-1, body]]) {
    for (let n = points.length - 1; n > 0; n--) {
      const a = points[n - 1], b = points[n];
      line([a.x, a.y], [b.x, b.y], Math.max(1, a.width + extra), color);
    }
  }
  // Repeated inset body rings travel with the flesh; they never protrude as legs.
  for (let n = 2; n < points.length - 2; n += 4) {
    const p = points[n], radius = Math.max(.5, (p.width - 1.8) * .5);
    line([p.x - p.normal[0] * radius, p.y - p.normal[1] * radius],
      [p.x + p.normal[0] * radius, p.y + p.normal[1] * radius], 1, n % 8 === 2 ? highlight : shade);
  }
}
