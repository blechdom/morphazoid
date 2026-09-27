// Seven solid candy monsters, drawn on the shared half-unit pixel grid.
// Musical pose in; raster rectangles out. No independent clock or animation state.
const INK = '#38213f', PUPIL = '#20152f', CREAM = '#fff9e8';
const PINK = '#ff8bc7', ROSE = '#cf518f', MINT = '#83efd4', JADE = '#35aaac';
const LILAC = '#bba5ff', VIOLET = '#7960bc', LEMON = '#ffe879', GOLD = '#d9a84f';
const clamp = (value, low, high) => Math.max(low, Math.min(high, Number(value) || 0));
const TAU = Math.PI * 2;

export function drawKaijuSkin(brush, pose, index) {
  const moving = pose.moving === true;
  const phase = moving ? clamp(pose.phase, 0, 1) : 0;
  const pulse = moving ? Math.sin(phase * TAU) : 0;
  const sway = moving ? Math.round(clamp(pose.sway * .65, -1, 1)) : 0;
  const bob = moving ? Math.round(clamp((pose.hipY + 13) * .4, -2, 1)) : 0;
  const expression = moving ? clamp(pose.expression, 0, 1) : 0;
  const jaw = moving ? Math.round(expression * 2 + Math.abs(pulse)) : 0;
  const look = moving ? Math.round(clamp(pose.sway + pulse, -1, 1)) : 0;
  const blink = moving && pose.blink;
  const kick = side => moving ? Math.round(clamp(-pose.legs?.[side]?.foot?.[1] * .4, 0, 3)) : 0;
  const flap = side => moving ? Math.round(clamp((pose.arms?.[side]?.wrist?.[1] - pose.shoulderY) * .2, -2, 2)) : 0;

  // Clip at the agreed skin envelope; each authored silhouette also keeps a
  // spare pixel for its music-driven squish and accessory motion.
  const rect = (x, y, width, height, color) => {
    const left = Math.max(-19, Math.round(x + sway));
    const top = Math.max(-43, Math.round(y + bob));
    const right = Math.min(19, Math.round(x + sway + width));
    const bottom = Math.min(3, Math.round(y + bob + height));
    if (right > left && bottom > top) brush.rect(left, top, right - left, bottom - top, color);
  };
  const oval = (x, y, rx, ry, color) => {
    rx = Math.max(1, Math.round(rx)); ry = Math.max(1, Math.round(ry));
    for (let row = -ry; row < ry; row++) {
      const half = Math.max(1, Math.round(rx * Math.sqrt(1 - ((row + .5) / ry) ** 2)));
      rect(x - half, y + row, half * 2, 1, color);
    }
  };
  const blob = (x, y, rx, ry, color) => {
    oval(x, y, rx, ry, INK); oval(x, y, rx - 1, ry - 1, color);
  };
  const line = (a, b, width, color) => {
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]))));
    for (let step = 0; step <= steps; step++) {
      rect(a[0] + (b[0] - a[0]) * step / steps - width / 2,
        a[1] + (b[1] - a[1]) * step / steps - width / 2, width, width, color);
    }
  };
  const noodle = (points, width, color) => {
    for (const [size, ink] of [[width + 2, INK], [width, color]]) {
      for (let point = 1; point < points.length; point++) line(points[point - 1], points[point], size, ink);
    }
  };
  const eye = (x, y, rx, ry, iris = LILAC, lid = PINK) => {
    blob(x, y, rx, ry, blink ? lid : CREAM);
    if (blink) { rect(x - rx + 1, y, rx * 2 - 2, 1, INK); return; }
    const pupilX = x + look;
    oval(pupilX, y + 1, Math.max(2, rx - 3), Math.max(2, ry - 2), iris);
    oval(pupilX, y + 1, Math.max(1, rx - 4), Math.max(2, ry - 3), PUPIL);
    rect(pupilX - 1, y - 2, 2, 2, CREAM);
    rect(pupilX + 1, y + 2, 1, 1, CREAM);
  };
  const mouth = (x, y, rx, ry, teeth = CREAM) => {
    oval(x, y, rx, ry, teeth); oval(x, y, rx - 1, ry - 1, INK);
    for (let tooth = -rx + 3; tooth < rx - 2; tooth += 4) rect(x + tooth, y - ry + 1, 2, 3, teeth);
    oval(x + 1, y + ry - 2, Math.max(2, rx - 3), 2, ROSE);
    rect(x, y + ry - 3, 1, 2, PINK);
  };
  const foot = (x, side, color = LILAC, width = 4) => {
    const lift = kick(side);
    blob(x, -2 - lift, width, 3, color);
    rect(x - width + 2, -1 - lift, 2, 1, CREAM);
  };
  const freckles = (points, color) => {
    for (const [x, y] of points) rect(x, y, 2, 1, color);
  };

  switch (Math.max(0, Math.min(6, Math.trunc(index)))) {
    case 0: { // Rattle: a strawberry drum-crab with three enormous eyes.
      for (const side of [-1, 1]) {
        const y = -17 + flap(side > 0 ? 1 : 0);
        noodle([[side * 9, -18], [side * 14, y + 4], [side * 15, y]], 3, LEMON);
        blob(side * 15, y - 2, 3, 5, LEMON);
        rect(side * 15 - 1, y - 4, 2, 2, CREAM);
      }
      for (let n = 0; n < 4; n++) foot(-9 + n * 6, n % 2, MINT, 4);
      blob(0, -18, 13, 14 - Math.round(expression), PINK);
      oval(0, -11, 10, 6, ROSE);
      for (const side of [-1, 1]) {
        blob(side * 7, -35, 3, 6, LEMON);
        rect(side * 7 - 2, -38, 4, 2, PINK); rect(side * 7 - 2, -34, 4, 2, PINK);
      }
      eye(-7, -27, 6, 7, MINT); eye(7, -27, 6, 7, MINT);
      eye(0, -34, 4, 5, LILAC);
      mouth(0, -14, 8, 5 + jaw, LEMON);
      freckles([[-11, -18], [-10, -16], [9, -18], [10, -16]], CREAM);
      break;
    }
    case 1: { // Thump: a broad mint toad whose whole belly is its grin.
      blob(-9, -31, 5, 9, LILAC); blob(9, -32, 4, 6, LILAC);
      rect(-11, -37, 4, 2, PINK); rect(-11, -33, 4, 2, PINK);
      for (const side of [-1, 1]) {
        blob(side * 14, -11 + flap(side > 0 ? 1 : 0), 4, 7, MINT);
        rect(side * 14 - 1, -11, 2, 4, JADE);
      }
      for (let n = 0; n < 4; n++) foot(-10 + n * 7, n % 2, LILAC, 4);
      blob(0, -18, 14, 14 - Math.round(expression), MINT);
      oval(0, -13, 12, 8, JADE);
      eye(-7, -29, 7, 8, PINK, MINT); eye(7, -28, 7, 7, PINK, MINT);
      mouth(0, -14, 11, 7 + Math.min(1, jaw));
      rect(-9, -15, 3, 5, CREAM); rect(6, -15, 3, 5, CREAM);
      freckles([[-12, -22], [-10, -20], [10, -21]], LEMON);
      break;
    }
    case 2: { // Orbit: a lemon cyclops bell with six gummy tentacles.
      for (let n = 0; n < 6; n++) {
        const x = -10 + n * 4, wiggle = moving ? Math.round(Math.sin(phase * TAU + n) * 2) : 0;
        const y = -2 - kick(n % 2);
        noodle([[x * .7, -18], [x + wiggle, -10], [x - wiggle, y]], 3, n % 2 ? PINK : MINT);
        blob(x - wiggle, y, 3, 2, n % 2 ? PINK : MINT);
      }
      blob(-12, -30 + flap(0), 5, 6, LILAC); blob(12, -30 + flap(1), 5, 6, LILAC);
      blob(-6, -37, 4, 4, PINK); blob(6, -37, 4, 4, PINK);
      blob(0, -27, 11, 13, LEMON);
      oval(0, -18, 9, 4, GOLD);
      eye(0, -29, 9, 9, PINK, LEMON);
      mouth(0, -16, 5, 3 + Math.min(1, jaw));
      freckles([[-9, -23], [-8, -21], [7, -22]], CREAM);
      break;
    }
    case 3: { // Nova: a plush vampire moth, all scalloped wings and ears.
      for (const side of [-1, 1]) {
        const wing = flap(side > 0 ? 1 : 0);
        blob(side * 12, -27 + wing, 6, 8, MINT);
        blob(side * 13, -18 + wing, 5, 6, MINT);
        blob(side * 10, -12 + wing, 5, 5, MINT);
        oval(side * 12, -25 + wing, 3, 4, JADE);
        oval(side * 13, -16 + wing, 2, 3, LEMON);
        blob(side * 5, -33, 4, 8, LILAC);
        oval(side * 5, -34, 2, 5, PINK);
      }
      foot(-4, 0, PINK); foot(4, 1, PINK);
      blob(0, -21, 9, 14, LILAC);
      oval(0, -12, 6, 6, VIOLET);
      eye(-4, -27, 5, 6, LEMON, LILAC); eye(4, -27, 5, 6, LEMON, LILAC);
      mouth(0, -17, 6, 5 + Math.min(1, jaw), PINK);
      rect(-4, -20, 2, 6, CREAM); rect(2, -20, 2, 6, CREAM);
      rect(-1, -9, 2, 2, LEMON); rect(-1, -6, 2, 1, LEMON);
      break;
    }
    case 4: { // Circuit: conjoined bonbons arguing through mismatched mouths.
      const tilt = moving ? Math.round(pulse * 2) : 0;
      for (let n = 0; n < 4; n++) foot(-8 + n * 5, n % 2, n % 2 ? MINT : PINK, 3);
      blob(0, -12, 11, 11, LEMON);
      blob(-7, -22, 8, 10, PINK); blob(7, -19, 8, 10, MINT);
      blob(-12, -33 + tilt, 3, 6, LILAC); blob(12, -31 - tilt, 3, 6, LILAC);
      blob(-7, -29 + tilt, 9, 10, PINK); blob(7, -25 - tilt, 9, 10, MINT);
      eye(-7, -31 + tilt, 7, 7, LEMON); eye(7, -27 - tilt, 7, 7, LILAC, MINT);
      mouth(-7, -22 + tilt, 5, 3 + Math.min(1, jaw));
      mouth(7, -18 - tilt, 5, 3 + Math.min(1, jaw));
      rect(-7, -20 + tilt, 2, 4, ROSE); rect(7, -17 - tilt, 2, 4, PINK);
      oval(0, -9, 3, 3, PINK); rect(-1, -10, 2, 2, CREAM);
      freckles([[-7, -7], [5, -6], [-2, -4]], GOLD);
      break;
    }
    case 5: { // Dash: a bubblegum-shell bunny snail with stalked sugar eyes.
      blob(-13, -9, 5, 4, MINT);
      for (let n = 0; n < 4; n++) foot(-10 + n * 7, n % 2, LEMON, 3);
      blob(-4, -19, 12, 15, PINK);
      oval(-5, -20, 9, 11, ROSE); oval(-5, -20, 7, 9, LEMON);
      oval(-5, -20, 5, 6, PINK); oval(-5, -20, 3, 4, CREAM);
      rect(-7, -22, 4, 4, ROSE); rect(-6, -21, 2, 2, LEMON);
      blob(6, -8, 11, 6, MINT); blob(10, -15, 7, 9, MINT);
      const left = flap(0), right = flap(1);
      noodle([[7, -18], [3, -28], [3 + left, -34]], 4, MINT);
      noodle([[11, -18], [12, -25], [11 + right, -31]], 4, MINT);
      eye(3 + left, -34, 6, 7, LILAC, MINT); eye(11 + right, -31, 5, 6, PINK, MINT);
      mouth(10, -12, 5, 3 + Math.min(1, jaw));
      rect(12, -9, 3, 3, ROSE);
      freckles([[-12, -14], [-10, -11], [0, -8]], CREAM);
      break;
    }
    default: { // Static: a sugar-dust puffball with too many teeth and eyes.
      for (let n = 0; n < 10; n++) {
        const angle = n * TAU / 10;
        blob(Math.round(Math.cos(angle) * 12), -19 + Math.round(Math.sin(angle) * 12), 5, 5, n % 2 ? LILAC : MINT);
      }
      for (const [x, y] of [[-9, -34], [0, -36], [9, -34]]) {
        noodle([[x, -29], [x + Math.round(pulse), y]], 2, LEMON);
        eye(x + Math.round(pulse), y, 4, 5, PINK, MINT);
      }
      for (let n = 0; n < 4; n++) foot(-9 + n * 6, n % 2, LILAC, 3);
      blob(0, -18, 14, 14, MINT);
      oval(0, -12, 12, 8, JADE);
      mouth(0, -18, 11, 10 + Math.min(1, jaw));
      for (let n = -7; n <= 7; n += 4) rect(n, -12, 3, 3, CREAM);
      oval(2, -10, 5, 3, PINK); rect(2, -11, 1, 3, ROSE);
      freckles([[-13, -23], [11, -23], [-11, -9], [10, -8]], LEMON);
    }
  }
}
