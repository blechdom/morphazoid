const TAU = Math.PI * 2;
const INK = '#121325', IVORY = '#fff3c9';
const PALETTES = [
  ['#ff8158', '#54edcf', '#ffd574'], ['#b5ef57', '#64bfee', '#f6ffac'],
  ['#69e9e8', '#d39cff', '#fff3c9'], ['#ff82b8', '#9dfcdd', '#fff497'],
  ['#b0a1ff', '#f7b269', '#daffaf'], ['#ffe373', '#80e6ed', '#ff8eb6'],
  ['#b5fd8a', '#fc8aea', '#c4d5ff'],
];

/** Hollow ribbon creatures: the note's dance phase coils the body, while the
 * original phrase's sway, limb taps and expression move its eyes and feelers. */
export function drawWormSkin(brush, pose, index) {
  const { rect, line } = brush;
  const [main, secondary, glow] = PALETTES[index];
  const phase = pose.phase * TAU;
  const sway = pose.sway * .65;
  const pulse = pose.moving ? Math.sin(phase * 2 + index) : 0;
  const cy = -22 + (pose.hipY + 13) * .35;
  const curve = (count, point) => Array.from({ length: count + 1 }, (_, i) => point(i / count));
  const ribbon = (points, color, width = 2) => {
    for (let i = 1; i < points.length; i++) line(points[i - 1], points[i], width + 2, INK);
    for (let i = 1; i < points.length; i++) line(points[i - 1], points[i], width, color);
    for (let i = 2; i < points.length; i += 5) rect(Math.round(points[i][0]), Math.round(points[i][1]), 1, 1, glow);
  };
  const loop = (x, y, rx, ry, angle, color, width = 2) => {
    ribbon(curve(32, t => {
      const a = t * TAU + angle;
      return [x + Math.cos(a) * rx, y + Math.sin(a) * ry];
    }), color, width);
  };
  const eye = (x, y, radius = 3, color = main, look = 0) => {
    x = Math.round(x); y = Math.round(y);
    rect(x - radius + 1, y - radius - 1, radius * 2 - 1, radius * 2 + 3, INK);
    rect(x - radius - 1, y - radius + 1, radius * 2 + 3, radius * 2 - 1, INK);
    rect(x - radius, y - radius + 1, radius * 2 + 1, radius * 2 - 1, color);
    rect(x - radius + 1, y - radius, radius * 2 - 1, radius * 2 + 1, color);
    if (pose.blink) { rect(x - radius + 1, y, radius * 2 - 1, 1, INK); return; }
    rect(x - radius + 1, y - radius + 1, radius * 2 - 1, radius * 2 - 1, IVORY);
    rect(x - 1 + Math.round(look), y - 1, 2, 3, INK);
    rect(x - 1 + Math.round(look), y - 1, 1, 1, '#ffffff');
  };

  if (index === 0) {
    // Percussion: three crossed worm hoops with beating eye-mallets.
    for (let i = 0; i < 3; i++) {
      const a = i * Math.PI / 3 + phase * .35;
      ribbon(curve(32, t => {
        const u = Math.cos(t * TAU) * 13, v = Math.sin(t * TAU) * 4;
        return [sway + u * Math.cos(a) - v * Math.sin(a), cy + u * Math.sin(a) + v * Math.cos(a)];
      }), i % 2 ? secondary : main);
    }
    for (const [i, arm] of pose.arms.entries()) {
      const x = (i ? 10 : -10) + arm.wrist[0] * .16, y = -37 + (arm.wrist[1] + 25) * .14;
      ribbon([[sway, cy], [x * .75, -30], [x, y]], secondary, 1);
      eye(x, y, 2, glow, i ? 1 : -1);
    }
    eye(sway, cy, 3, main, pulse);
  } else if (index === 1) {
    // Bass: a thick, asymmetric double-coil slug with one enormous slit eye.
    ribbon(curve(58, t => {
      const a = t * TAU * 1.75 + phase * .25;
      const radius = 13.5 - t * 8;
      return [sway + Math.cos(a) * radius, cy + 2 + Math.sin(a) * radius * (.85 + pulse * .08)];
    }), main, 3);
    loop(sway - 4, -32, 6.5, 5, phase, secondary, 2);
    eye(sway + 4, -35 + pulse, 4, main, pose.sway * .4);
    for (let i = 0; i < 4; i++) {
      const x = -10 + i * 6;
      line([x, -9], [x + Math.sin(phase + i) * (pose.moving ? 2 : 0), -3], 2, secondary);
      rect(x - 1, -3, 3, 2, glow);
    }
  } else if (index === 2) {
    // Arpeggio: two climbing helices; hollow rung-space replaces a torso.
    for (let side = 0; side < 2; side++) {
      ribbon(curve(44, t => [sway + Math.sin(t * TAU * 1.6 + phase + side * Math.PI) * (7 + t * 5), -37 + t * 33]), side ? secondary : main);
    }
    for (let i = 0; i < 6; i++) {
      const y = -34 + i * 5, x = Math.sin(i * 1.1 + phase) * 8;
      rect(x - 1, y, 3, 2, glow);
    }
    eye(sway, -37, 3, main, pulse);
    ribbon([[sway, -39], [sway + 5, -41], [sway + 9, -38]], secondary, 1);
  } else if (index === 3) {
    // Lead: a wide, open figure-eight that folds and opens with the phrase.
    ribbon(curve(60, t => {
      const a = t * TAU;
      return [sway + Math.sin(a) * (12 + pulse), cy + Math.sin(a * 2 + phase * .4) * 11];
    }), main, 3);
    ribbon(curve(44, t => [sway + Math.cos(t * TAU) * 7, cy + Math.sin(t * TAU) * 14]), secondary, 1);
    eye(sway - 5, -36, 3, main, pulse);
    eye(sway + 5, -34, 2, secondary, -pulse);
    rect(sway - 2, cy - 2, 5, 4 + (pose.moving ? Math.round(pose.expression * 2) : 0), IVORY);
    rect(sway - 1, cy - 1, 3, 3, INK);
  } else if (index === 4) {
    // Upper A: a jellyfish observatory suspended on spiral ribbon tendrils.
    loop(sway, -30, 10 + pulse, 7, phase, main, 2);
    loop(sway, -30, 5, 11, phase, secondary, 1);
    for (let i = 0; i < 4; i++) ribbon(curve(20, t => [sway - 9 + i * 6 + Math.sin(t * TAU + phase + i) * 2.5, -24 + t * 21]), i % 2 ? main : secondary, 1);
    eye(sway, -30, 3, glow, pose.sway * .4);
    for (const side of [-1, 1]) {
      line([sway + side * 6, -35], [sway + side * 12, -38 + pulse], 1, secondary);
      eye(sway + side * 12, -38 + pulse, 2, secondary, side);
    }
  } else if (index === 5) {
    // Upper B: nested angular portals unspool into a two-headed ribbon.
    for (let i = 0; i < 3; i++) {
      const r = 14 - i * 4, offset = (i % 2 ? -1 : 1) * pose.sway;
      ribbon([[offset - r, cy - r * .8], [offset + r, cy - r * .8], [offset + r, cy + r * .8],
        [offset - r, cy + r * .8], [offset - r, cy - r * .8 + 4]], i % 2 ? secondary : main, 1);
    }
    ribbon(curve(30, t => [Math.sin(t * TAU + phase) * 7, -38 + t * 35]), secondary, 2);
    eye(-8 + sway, -36, 3, main, pulse);
    eye(8 - sway, -7, 3, secondary, -pulse);
  } else {
    // Noise: a shredded signal-eel, with barbed whiskers and an open coil gut.
    const spine = curve(24, t => [Math.sin(t * TAU * 2 + phase) * (4 + t * 5), -36 + t * 31]);
    for (let i = 2; i < spine.length - 2; i += 3) {
      const [x, y] = spine[i], side = i % 2 ? -1 : 1;
      ribbon([[x, y], [side * 13, y - 2], [side * 15, y + 1]], secondary, 1);
      rect(side * 15 - 1, y + 1, 2, 2, glow);
    }
    ribbon(spine, main, 2);
    loop(0, cy + 3, 11, 7, phase, secondary, 1);
    eye(spine[0][0], -36, 4, main, pulse);
    for (let i = 0; i < 3; i++) rect(-2 + i * 2, -39 - (i === 1 ? 3 : 1), 1, 2, glow);
  }
}
