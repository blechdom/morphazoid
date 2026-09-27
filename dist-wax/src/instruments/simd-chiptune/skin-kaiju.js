// Seven predatory silhouettes on the shared half-unit raster. Every lurch,
// stomp and jaw strike follows the musical pose; resting poses ignore all taps.
const INK = '#15151f', VOID = '#080c13', BONE = '#aab4a5';
const BLOOD = '#852a48', SCAR = '#ab3d50', TEAL = '#286973', EDGE = '#39848a';
const PLUM = '#5f3969', ASH = '#50515e', IRON = '#747785', FIRE = '#ff643c';
const VENOM = '#b5d46c';
const clamp = (value, low, high) => Math.max(low, Math.min(high, Number(value) || 0));
const TAU = Math.PI * 2;

export function drawKaijuSkin(brush, pose, index) {
  const moving = pose.moving === true, role = Math.max(0, Math.min(6, Math.trunc(index)));
  const phase = moving ? clamp(pose.phase, 0, 1) : 0;
  const beat = phase * TAU, swing = moving ? Math.sin(beat * 2 + role * .37) : 0;
  const crush = moving ? Math.sin(beat * 4 + role * .37) : 0;
  const attack = moving ? clamp(pose.expression, 0, 1) : 0;
  const sway = moving ? clamp(swing * 2.6 + clamp(pose.sway, -2, 2) * .3, -2.6, 2.6) : 0;
  const rise = moving ? Math.max(0, swing) * 3 + clamp(-pose.hipY - 13, 0, 3) * .5 : 0;
  const drop = moving ? Math.max(0, -swing) * 1.5 - rise : 0;
  const scaleX = moving ? .8 + crush * .035 : .9;
  const scaleY = moving ? .9 - crush * .1 : 1;
  const lean = moving ? Math.sin(beat * 2 + .45) : 0;
  const jaw = moving ? Math.round(Math.max(0, Math.sin(beat * 4 + role * .6)) * 4 + attack) : 0;
  const eyeTurn = moving ? Math.round(clamp(pose.sway + swing, -1, 1)) : 0;
  const kick = side => moving ? Math.round(Math.max(0, Math.sin(beat * 2 + side * Math.PI)) * 4
    + clamp(-pose.legs?.[side]?.foot?.[1], 0, 5) * .35) : 0;
  const flap = side => moving ? Math.round(Math.sin(beat * 2 + side * Math.PI) * 3
    + clamp(pose.arms?.[side]?.wrist?.[1] - pose.shoulderY, -8, 8) * .2) : 0;

  // Shear complete raster rows around the belly. Authored margins accommodate
  // the full transform: no clipping, cropping or off-stage recovery is needed.
  const rect = (x, y, width, height, color) => {
    for (let row = 0; row < Math.ceil(height); row++) {
      const localY = y + row, top = Math.round(localY * scaleY + drop);
      const bottom = Math.round(Math.min(y + height, localY + 1) * scaleY + drop);
      const shift = sway + lean * (localY + 20) / 20;
      const left = Math.round(x * scaleX + shift), right = Math.round((x + width) * scaleX + shift);
      if (right > left && bottom > top) brush.rect(left, top, right - left, bottom - top, color);
    }
  };
  const oval = (x, y, rx, ry, color) => {
    rx = Math.max(1, Math.round(rx)); ry = Math.max(1, Math.round(ry));
    for (let row = -ry; row < ry; row++) {
      const half = Math.max(1, Math.round(rx * Math.sqrt(1 - ((row + .5) / ry) ** 2)));
      rect(x - half, y + row, half * 2, 1, color);
    }
  };
  const plate = (x, y, rx, ry, color) => {
    oval(x, y, rx, ry, INK); oval(x, y, rx - 1, ry - 1, color);
  };
  const polygon = (points, color) => {
    const top = Math.floor(Math.min(...points.map(point => point[1]))), bottom = Math.ceil(Math.max(...points.map(point => point[1])));
    for (let y = top; y < bottom; y++) {
      const cuts = [], scan = y + .5;
      for (let n = 0; n < points.length; n++) {
        const a = points[n], b = points[(n + 1) % points.length];
        if ((a[1] <= scan && b[1] > scan) || (b[1] <= scan && a[1] > scan)) cuts.push(a[0] + (scan - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
      }
      cuts.sort((a, b) => a - b);
      for (let n = 0; n + 1 < cuts.length; n += 2) {
        const left = Math.round(cuts[n]), right = Math.round(cuts[n + 1]);
        if (right > left) rect(left, y, right - left, 1, color);
      }
    }
  };
  const thorn = (x, y, height, bend = 0, color = BONE) => {
    polygon([[x - 3, y], [x + 3, y], [x + bend, y - height]], INK);
    polygon([[x - 1, y - 1], [x + 2, y - 1], [x + bend, y - height + 1]], color);
  };
  const tendon = (points, width, color) => {
    for (const [size, ink] of [[width + 2, INK], [width, color]]) for (let n = 1; n < points.length; n++) {
      const a = points[n - 1], b = points[n], length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const dx = (b[1] - a[1]) / length * size / 2, dy = -(b[0] - a[0]) / length * size / 2;
      polygon([[a[0] - dx, a[1] - dy], [b[0] - dx, b[1] - dy], [b[0] + dx, b[1] + dy], [a[0] + dx, a[1] + dy]], ink);
    }
  };
  const eye = (x, y, side = 1, color = FIRE, width = 5) => {
    polygon([[x - width, y - 3], [x + width, y - 2], [x + width - 1, y + 2], [x - width, y + 1]], VOID);
    polygon([[x - width + 1, y - side], [x + width - 1, y + side], [x + width - 2, y + side + 1], [x - width + 1, y - side + 1]], color);
    rect(x + eyeTurn, y - 1, 1, 3, VOID);
    rect(x - width + 1, y - 3, width + 1, 1, ASH);
  };
  const maw = (x, y, rx, height) => {
    const top = y - height / 2, bottom = y + height / 2;
    polygon([[x - rx, top + 2], [x - rx + 2, top], [x + rx - 2, top], [x + rx, top + 2], [x + rx - 1, bottom], [x - rx + 1, bottom]], SCAR);
    polygon([[x - rx + 1, top + 2], [x + rx - 1, top + 2], [x + rx - 2, bottom - 1], [x - rx + 2, bottom - 1]], VOID);
    for (let n = -rx + 2; n < rx - 1; n += 3) {
      const fang = (n + rx) % 2 ? 3 : 4;
      polygon([[x + n, top + 1], [x + n + 2, top + 1], [x + n + 1, top + 1 + fang]], BONE);
      polygon([[x + n, bottom - 1], [x + n + 2, bottom - 1], [x + n + 1, bottom - 3]], IRON);
    }
    rect(x - 1, bottom - 3, 3, 1, BLOOD);
  };
  const claw = (x, side, color = ASH, width = 4) => {
    const lift = kick(side);
    plate(x, -2 - lift, width, 3, color);
    for (let n = -width + 1; n < width; n += 2) polygon([[x + n, -2 - lift], [x + n + 2, -2 - lift], [x + n, 2 - lift]], BONE);
  };
  const scar = (x, y, color = SCAR) => {
    rect(x, y, 1, 4, color); rect(x - 1, y + 1, 3, 1, color); rect(x - 1, y + 3, 3, 1, color);
  };

  switch (role) {
    case 0: { // Rattle: horned carapace, six legs and hammering scythe claws.
      for (const side of [-1, 1]) {
        const armY = -18 + flap(side > 0 ? 1 : 0);
        tendon([[side * 9, -19], [side * 15, -12], [side * 16, armY]], 4, BLOOD);
        polygon([[side * 13, armY + 3], [side * 18, armY], [side * 15, armY - 8], [side * 14, armY - 2]], BONE);
        thorn(side * 8, -29, 9, side * 3);
      }
      for (let n = 0; n < 6; n++) claw(-12 + n * 5, n % 2, BLOOD, 3);
      plate(0, -18, 13, 14, BLOOD); oval(0, -21, 11, 10, PLUM);
      polygon([[-11, -26], [0, -33], [11, -26], [7, -22], [-7, -22]], ASH);
      eye(-6, -25, 1); eye(6, -25, -1);
      rect(-1, -32, 2, 4, FIRE); rect(0, -31, 1, 2, VOID);
      maw(0, -14, 10, 7 + jaw);
      thorn(-11, -13, 6, -5, SCAR); thorn(11, -13, 6, 5, SCAR);
      break;
    }
    case 1: { // Thump: heavy pit-toad, low brow and an almost body-wide bite.
      thorn(-8, -28, 10, -4); thorn(8, -28, 9, 5);
      for (const side of [-1, 1]) {
        plate(side * 13, -12 + flap(side > 0 ? 1 : 0), 5, 7, ASH);
        thorn(side * 15, -13, 5, side * 3, IRON);
      }
      for (let n = 0; n < 4; n++) claw(-10 + n * 7, n % 2, TEAL, 4);
      plate(0, -18, 14, 14, TEAL); oval(0, -19, 12, 10, ASH);
      polygon([[-14, -28], [-5, -32], [0, -28], [5, -32], [14, -28], [11, -23], [-11, -23]], TEAL);
      eye(-7, -26, 1, VENOM); eye(7, -26, -1, VENOM);
      maw(0, -14, 12, 11 + jaw);
      polygon([[-10, -20], [-7, -20], [-8, -11]], BONE);
      polygon([[7, -20], [10, -20], [8, -11]], BONE);
      scar(-12, -21, EDGE); scar(11, -22, EDGE);
      break;
    }
    case 2: { // Orbit: armored abyssal bell dragging six barbed tendrils.
      for (let n = 0; n < 6; n++) {
        const x = -10 + n * 4, lash = moving ? Math.round(Math.sin(beat * 2 + n) * 3) : 0;
        const endY = -2 - kick(n % 2);
        tendon([[x * .65, -19], [x + lash, -10], [x - lash, endY]], 3, n % 2 ? BLOOD : TEAL);
        polygon([[x - lash - 2, endY], [x - lash + 2, endY], [x - lash + 2, endY - 5]], BONE);
      }
      thorn(-7, -29, 9, -5, IRON); thorn(7, -29, 9, 5, IRON);
      plate(0, -26, 12, 12, PLUM);
      polygon([[-11, -29], [-5, -37], [0, -33], [5, -37], [11, -29], [7, -24], [-7, -24]], ASH);
      eye(0, -29, 0, VENOM, 7); rect(-1, -30, 2, 3, VENOM); rect(0, -30, 1, 3, VOID);
      maw(0, -20, 8, 6 + jaw);
      scar(-9, -26); scar(8, -26);
      break;
    }
    case 3: { // Nova: a ragged bloodwing with exposed ribs and hooked talons.
      for (const side of [-1, 1]) {
        const wing = flap(side > 0 ? 1 : 0);
        polygon([[side * 6, -29], [side * 17, -33 + wing], [side * 18, -17 + wing], [side * 14, -22 + wing], [side * 12, -8 + wing], [side * 8, -15], [side * 5, -9]], INK);
        polygon([[side * 7, -26], [side * 16, -30 + wing], [side * 16, -20 + wing], [side * 12, -23 + wing], [side * 11, -12 + wing], [side * 7, -18]], BLOOD);
        tendon([[side * 6, -26], [side * 13, -25 + wing], [side * 16, -30 + wing]], 1, SCAR);
        thorn(side * 5, -29, 9, side * 3);
      }
      claw(-4, 0, PLUM); claw(4, 1, PLUM);
      plate(0, -20, 8, 14, PLUM);
      eye(-4, -27, 1, FIRE, 4); eye(4, -27, -1, FIRE, 4);
      maw(0, -18, 6, 8 + jaw);
      polygon([[-4, -23], [-2, -23], [-3, -13]], BONE);
      polygon([[2, -23], [4, -23], [3, -13]], BONE);
      for (let n = 0; n < 3; n++) rect(-4, -10 + n * 2, 8, 1, IRON);
      break;
    }
    case 4: { // Circuit: two fighting heads fused onto a scarred crawling trunk.
      const thrash = moving ? Math.round(Math.sin(beat * 2) * 3) : 0;
      for (let n = 0; n < 4; n++) claw(-8 + n * 5, n % 2, ASH, 3);
      plate(0, -11, 11, 11, ASH); plate(-6, -20, 7, 10, BLOOD); plate(6, -18, 7, 10, TEAL);
      thorn(-10, -29 + thrash, 6, -3); thorn(10, -26 - thrash, 7, 3);
      plate(-7, -27 + thrash, 9, 8, BLOOD); plate(7, -23 - thrash, 9, 8, TEAL);
      eye(-7, -29 + thrash, 1, FIRE); eye(7, -25 - thrash, -1, VENOM);
      maw(-7, -22 + thrash, 7, 6 + jaw); maw(7, -18 - thrash, 7, 7 + jaw);
      scar(-3, -13, SCAR); scar(3, -9, EDGE);
      rect(-1, -10, 2, 6, VOID);
      break;
    }
    case 5: { // Dash: a spined siege-snail with armored eyestalks and a saw jaw.
      for (let n = 0; n < 4; n++) claw(-10 + n * 7, n % 2, TEAL, 3);
      for (const [x, y, bend] of [[-13, -20, -4], [-11, -29, -4], [-4, -31, 0], [3, -28, 4]]) thorn(x, y, 7, bend, IRON);
      plate(-4, -19, 12, 14, ASH); oval(-5, -20, 9, 11, BLOOD);
      polygon([[-12, -24], [-5, -29], [3, -24], [3, -15], [-5, -10], [-12, -16]], PLUM);
      polygon([[-9, -22], [-4, -25], [0, -21], [-1, -15], [-7, -15]], INK);
      scar(-6, -23, SCAR); scar(-11, -16, IRON);
      plate(6, -8, 11, 6, TEAL); plate(10, -15, 7, 8, TEAL);
      const left = Math.round(flap(0) * .5), right = Math.round(flap(1) * .5);
      tendon([[6, -19], [2 + left, -31]], 4, ASH); tendon([[11, -18], [11 + right, -28]], 4, ASH);
      thorn(2 + left, -29, 8, -2); thorn(11 + right, -26, 8, 2);
      eye(2 + left, -31, 1, FIRE, 4); eye(11 + right, -28, -1, VENOM, 4);
      maw(10, -12, 6, 6 + jaw);
      break;
    }
    default: { // Static: a spined maw surrounded by three watchful slit eyes.
      for (let n = 0; n < 10; n++) {
        const angle = n * TAU / 10, x = Math.cos(angle), y = Math.sin(angle);
        polygon([[x * 11 - y * 3, -19 + y * 11 + x * 3], [x * 11 + y * 3, -19 + y * 11 - x * 3], [x * 18, -19 + y * 18]], IRON);
      }
      for (const x of [-8, 0, 8]) {
        tendon([[x, -29], [x, -34]], 3, PLUM); eye(x, -34, x < 0 ? 1 : -1, FIRE, 3);
      }
      for (let n = 0; n < 4; n++) claw(-9 + n * 6, n % 2, PLUM, 3);
      plate(0, -18, 14, 14, BLOOD); oval(0, -18, 12, 12, PLUM);
      maw(0, -18, 11, 15 + jaw);
      scar(-12, -24, SCAR); scar(10, -25, SCAR);
    }
  }
}
