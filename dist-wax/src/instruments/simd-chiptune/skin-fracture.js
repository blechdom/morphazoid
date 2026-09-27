// Seven cut-paper musical machines. The audible dancer pose is the only source
// of motion; gaps between plates are part of each sculpture's silhouette.
const PAPER = "#fff0c4", VERMILION = "#ff583d", COBALT = "#5272ff";
const ACID = "#dce744", INK = "#21192b", CLAY = "#b85142";
const clamp = (value, low, high) => Math.max(low, Math.min(high, Number(value) || 0));

function offset(brush, x = 0, y = 0) {
  return {
    rect: (gx, gy, w, h, color) => brush.rect(gx + x, gy + y, w, h, color),
    line: (a, b, width, color) => brush.line([a[0] + x, a[1] + y], [b[0] + x, b[1] + y], width, color),
    facet: (points, color) => brush.facet(points.map(([gx, gy]) => [gx + x, gy + y]), color),
  };
}

function eye(brush, x, y, width, blink, pupil = 0) {
  const { rect, facet } = brush;
  facet([[x - 1, y + 1], [x + width - 1, y - 1], [x + width + 1, y + 2], [x, y + 4]], INK);
  if (blink) rect(x, y + 1, width, 1, PAPER);
  else {
    facet([[x, y + 1], [x + width - 1, y], [x + width, y + 2], [x + 1, y + 3]], PAPER);
    rect(x + Math.floor(width / 2) + pupil, y, 1, 3, INK);
  }
}

function percussionMobile(brush, m) {
  const { rect, line, facet } = brush;
  // Three hanging resonators replace the torso; the asymmetrical gantry walks.
  line([-9, -14], [-12, -2 - m.left], 2, PAPER);
  line([7, -15], [10, -5 - m.right], 2, COBALT);
  facet([[-15, -2 - m.left], [-8, -3 - m.left], [-5, 2 - m.left], [-16, 2 - m.left]], COBALT);
  facet([[9, -5 - m.right], [14, -3 - m.right], [17, 1 - m.right], [8, 1 - m.right]], ACID);
  const b = offset(brush, m.sway, m.bob);
  b.facet([[-15, -25], [10, -31], [14, -27], [-11, -20]], PAPER);
  b.facet([[-14, -25], [10, -31], [9, -28], [-9, -22]], VERMILION);
  for (let n = 0; n < 3; n++) {
    const x = -12 + n * 9;
    const y = -18 - (n % 2) * 4 - (n === m.step % 3 ? m.hit : 0) + (n === 1 ? m.pluck : 0);
    b.line([x + 2, -25 - n], [x + 2, y], 1, PAPER);
    b.facet([[x - 3, y], [x + 4, y - 2], [x + 6, y + 5], [x - 1, y + 8]], INK);
    b.facet([[x - 2, y + 1], [x + 3, y - 1], [x + 5, y + 4], [x, y + 7]], n === 1 ? COBALT : VERMILION);
    b.facet([[x - 2, y + 1], [x + 3, y - 1], [x + 5, y + 1], [x, y + 3]], PAPER);
    b.rect(x + 1, y + 3, 1, 3, ACID);
  }
  // The face is a flying red cheek, one paper eye and a separate comb jaw.
  b.facet([[-10, -40], [-1, -42], [1, -35], [-7, -31], [-13, -34]], VERMILION);
  b.facet([[-5, -41], [-1, -42], [1, -35], [-4, -36]], CLAY);
  eye(b, -10, -37, 7, m.blink, m.look);
  b.facet([[1, -35], [8, -38], [12, -33], [4, -31]], ACID);
  b.rect(5, -35, 2, 2, INK);
  b.facet([[-4, -28], [4, -30], [7, -26], [-1, -24]], COBALT);
  for (let n = 0; n < 4; n++) b.rect(-2 + n * 2, -28 + n % 2, 1, 2, PAPER);
  line([-16, -28 + m.armL], [-11, -36 + m.armL], 2, ACID);
  facet([[-18, -37 + m.armL], [-12, -38 + m.armL], [-10, -34 + m.armL], [-16, -32 + m.armL]], COBALT);
  line([12, -22 + m.armR], [16, -31 + m.armR], 2, PAPER);
  rect(13, -34 + m.armR, 5, 3, VERMILION);
}

function bassMonolith(brush, m) {
  const { line, facet } = brush;
  // A hole big enough to see through, carried by one enormous step and a pin.
  line([-8, -12], [-12, -3 - m.left], 2, VERMILION);
  facet([[-14, -6 - m.left], [-5, -4 - m.left], [-3, 2 - m.left], [-17, 2 - m.left]], PAPER);
  line([9, -13], [12, -3 - m.right], 2, ACID);
  facet([[11, -3 - m.right], [17, -1 - m.right], [16, 2 - m.right], [9, 2 - m.right]], VERMILION);
  const b = offset(brush, m.sway, m.bob - Math.sign(m.pluck));
  b.facet([[-14, -31], [-4, -34], [-7, -13], [-15, -10]], COBALT);
  b.facet([[-14, -31], [-9, -30], [-10, -15], [-15, -10]], PAPER);
  b.facet([[-4, -34], [13, -29], [14, -22], [5, -25]], VERMILION);
  b.facet([[10, -26], [15, -24], [12, -8], [5, -12]], ACID);
  b.facet([[-11, -14], [7, -17], [12, -8], [-8, -7]], COBALT);
  b.facet([[-11, -14], [7, -17], [6, -14], [-8, -10]], PAPER);
  // The crooked bass strings cross open space, never a filled body rectangle.
  for (let n = 0; n < 3; n++) {
    const bend = [-4 + n * 3 + m.pluck, -22], color = n === 1 ? PAPER : CLAY;
    b.line([-3 + n * 3, -29], bend, 1, color);
    b.line(bend, [-5 + n * 3 + m.hit, -15], 1, color);
  }
  b.facet([[-4, -40], [10, -41], [13, -34], [4, -32], [-6, -35]], PAPER);
  b.facet([[6, -40], [10, -41], [13, -34], [6, -35]], ACID);
  eye(b, -3, -37, 9, m.blink, m.look);
  b.facet([[-16, -38], [-9, -40], [-7, -34], [-14, -32]], VERMILION);
  b.rect(-13, -37, 2, 3, INK);
  const jaw = offset(b, m.pluck, 0);
  jaw.facet([[-3, -24 - m.hit], [6, -23 - m.hit], [4, -18 - m.hit], [-2, -19 - m.hit]], VERMILION);
  jaw.rect(-1, -22 - m.hit, 6, 1, INK);
  jaw.rect(0, -22 - m.hit, 1, 2, PAPER);
  jaw.rect(3, -22 - m.hit, 1, 2, PAPER);
  b.facet([[12, -35], [16, -40], [17, -30]], COBALT);
}

function stairHarp(brush, m) {
  const { line, facet } = brush;
  // A diagonal staircase, plucked strings and a mobile of mismatched eye flags.
  line([-6, -11], [-11, -3 - m.left], 2, PAPER);
  facet([[-14, -2 - m.left], [-8, -6 - m.left], [-5, 1 - m.left]], VERMILION);
  line([7, -13], [10, -3 - m.right], 2, COBALT);
  facet([[9, -5 - m.right], [16, -1 - m.right], [7, 2 - m.right]], ACID);
  const b = offset(brush, m.sway, m.bob);
  b.facet([[-13, -14], [-5, -14], [-5, -21], [1, -21], [1, -28], [7, -28], [7, -34], [12, -34], [12, -25], [6, -25], [6, -18], [0, -18], [0, -10], [-13, -10]], VERMILION);
  b.facet([[-13, -14], [-5, -14], [-5, -21], [-1, -21], [-1, -11], [-13, -8]], PAPER);
  b.facet([[7, -34], [12, -34], [12, -25], [6, -25]], COBALT);
  b.line([-10, -29], [8, -13], 2, ACID);
  for (let n = 0; n < 5; n++) {
    const x = -10 + n * 4;
    b.line([x, -29 + n * 2], [x + m.hit + m.pluck, -17 + n], 1, n % 2 ? PAPER : COBALT);
  }
  b.facet([[-15, -34], [-7, -38], [-3, -31], [-11, -28]], COBALT);
  eye(b, -13, -33, 6, m.blink, m.look);
  b.line([-7, -38], [-5, -41], 1, PAPER);
  b.facet([[-5, -42], [2, -40], [-1, -36]], ACID);
  b.rect(-3, -40, 2, 2, INK);
  b.facet([[5, -40], [14, -42], [16, -36], [9, -35]], PAPER);
  b.rect(10, -39, 2, m.blink ? 1 : 3, INK);
  const mask = offset(b, m.pluck, 0);
  mask.facet([[-4, -29 - m.armL], [3, -30 - m.armL], [5, -25 - m.armL], [-1, -24 - m.armL]], ACID);
  mask.rect(-1, -28 - m.armL, 1, 2, INK);
  mask.rect(1, -28 - m.armL, 1, 2, INK);
  b.facet([[12, -17 + m.armR], [16, -21 + m.armR], [17, -14 + m.armR]], VERMILION);
}

function brokenGramophone(brush, m) {
  const { rect, facet } = brush;
  // A flared, sideways mouth on a winding pipe, balanced on a slab and a fin.
  facet([[-13, -8 - m.left], [-4, -5 - m.left], [-1, 2 - m.left], [-16, 2 - m.left]], COBALT);
  rect(-13, -2 - m.left, 10, 2, PAPER);
  facet([[5, -9 - m.right], [13, -2 - m.right], [7, 2 - m.right]], VERMILION);
  const b = offset(brush, m.sway, m.bob);
  b.facet([[-7, -26], [-1, -26], [-1, -19], [7, -19], [7, -12], [-7, -7], [-10, -12], [1, -15], [1, -16], [-7, -16]], PAPER);
  b.facet([[-7, -26], [-4, -26], [-4, -18], [3, -18], [3, -16], [-7, -16]], ACID);
  b.facet([[-10, -12], [1, -15], [1, -12], [-7, -7]], VERMILION);
  const mouth = offset(b, 0, -m.hit + m.pluck);
  mouth.facet([[-6, -30], [14, -39], [17, -20], [-4, -24]], VERMILION);
  mouth.facet([[-6, -30], [14, -39], [10, -33], [-3, -27]], PAPER);
  mouth.facet([[11, -34], [14, -37], [16, -23], [11, -25]], INK);
  mouth.facet([[12, -32], [14, -34], [15, -26], [12, -27]], COBALT);
  mouth.facet([[-3, -27], [11, -25], [17, -20], [1, -22]], CLAY);
  for (let n = 0; n < 4; n++) mouth.rect(1 + n * 3, -25 + Math.floor(n / 2), 2, 2, PAPER);
  // An eye floats above the horn; its other viewpoint is a detached side fan.
  b.facet([[-9, -42], [2, -40], [1, -35], [-8, -36]], ACID);
  eye(b, -7, -39, 7, m.blink, m.look);
  b.facet([[-16, -35 + m.armL], [-11, -38 + m.armL], [-10, -28 + m.armL], [-17, -26 + m.armL]], COBALT);
  b.rect(-15, -33 + m.armL, 3, 1, PAPER);
  b.rect(-15, -30 + m.armL, 3, 1, PAPER);
  b.facet([[-12, -22 + m.armR], [-8, -23 + m.armR], [-7, -19 + m.armR], [-14, -17 + m.armR]], VERMILION);
  b.rect(-11, -21 + m.armR, 1, 2, PAPER);
}

function splitMaskTower(brush, m) {
  const { line, facet } = brush;
  // Three separated facial viewpoints hover beside a zigzag climbing spine.
  line([-5, -10], [-10, -4 - m.left], 2, ACID);
  facet([[-14, -3 - m.left], [-7, -5 - m.left], [-5, 1 - m.left], [-12, 2 - m.left]], VERMILION);
  line([6, -13], [10, -4 - m.right], 2, PAPER);
  facet([[10, -5 - m.right], [16, -1 - m.right], [8, 2 - m.right]], COBALT);
  const b = offset(brush, m.sway, m.bob);
  b.facet([[-9, -34], [-5, -36], [-5, -28], [1, -25], [-2, -17], [7, -15], [4, -9], [-6, -8], [-6, -12], [1, -12], [-7, -16], [-4, -23], [-11, -27]], PAPER);
  b.facet([[-9, -34], [-5, -36], [-5, -28], [1, -25], [-1, -21], [-7, -25], [-11, -27]], COBALT);
  b.facet([[-13, -40], [-5, -42], [3, -37], [-2, -32], [-12, -34]], VERMILION);
  b.facet([[-5, -42], [3, -37], [-2, -32], [-5, -36]], CLAY);
  eye(b, -11, -37, 7, m.blink, m.look);
  const middle = offset(b, m.hit, -m.armR + m.pluck);
  middle.facet([[5, -34], [14, -36], [17, -29], [10, -25], [4, -27]], ACID);
  middle.facet([[11, -34], [14, -36], [17, -29], [12, -29]], PAPER);
  eye(middle, 7, -31, 7, m.blink, -m.look);
  middle.facet([[6, -28], [1, -24], [10, -25]], VERMILION);
  const jaw = offset(b, -m.hit, 0);
  jaw.facet([[-14, -23], [-5, -25], [-2, -19], [-9, -15], [-15, -18]], COBALT);
  jaw.facet([[-11, -21], [-4, -22], [-5, -18], [-10, -17]], INK);
  for (let n = 0; n < 3; n++) jaw.rect(-10 + n * 2, -21, 1, 2, PAPER);
  b.facet([[7, -22], [14, -23], [14, -18], [10, -17]], VERMILION);
  b.rect(9, -21, 1, 2, PAPER);
  b.rect(12, -22, 1, 2, PAPER);
  b.facet([[5, -39], [7, -42], [11, -40]], COBALT);
}

function accordionScissor(brush, m) {
  const { line, facet } = brush;
  // A sideways concertina cuts across the bay, above crossing scissor struts.
  line([-12, -20], [11, -4 - m.right], 2, PAPER);
  line([12, -22], [-10, -3 - m.left], 2, VERMILION);
  facet([[-14, -3 - m.left], [-6, -5 - m.left], [-3, 1 - m.left], [-15, 2 - m.left]], ACID);
  facet([[9, -6 - m.right], [15, -2 - m.right], [17, 2 - m.right], [9, 1 - m.right]], COBALT);
  const b = offset(brush, m.sway, m.bob);
  b.rect(-2, -13, 4, 4, COBALT);
  b.rect(-1, -12, 2, 2, PAPER);
  const squeeze = m.hit + m.pluck;
  for (let n = 0; n < 5; n++) {
    const x = -12 + n * 5, y = -29 + (n % 2) * 3 + (n - 2) * squeeze;
    b.facet([[x, y], [x + 3, y - 4], [x + 7, y + 6], [x + 3, y + 11]], n % 2 ? PAPER : VERMILION);
    b.facet([[x + 3, y - 4], [x + 7, y + 6], [x + 5, y + 8], [x + 1, y + 1]], n % 2 ? COBALT : CLAY);
    b.rect(x + 3, y + 2, 1, 3, INK);
  }
  b.facet([[-16, -30], [-10, -34], [-7, -21], [-13, -18]], COBALT);
  for (let n = 0; n < 4; n++) b.rect(-14 + n % 2, -29 + n * 2, 3, 1, PAPER);
  b.facet([[12, -31], [16, -33], [17, -21], [13, -19]], ACID);
  // The high eye and low, displaced lip never rejoin a conventional head.
  b.facet([[-12, -40], [-3, -42], [4, -37], [-2, -32], [-10, -34]], PAPER);
  b.facet([[-3, -42], [4, -37], [-2, -32], [-4, -35]], ACID);
  eye(b, -10, -37, 8, m.blink, m.look);
  b.facet([[7, -38 - m.armR], [15, -39 - m.armR], [12, -35 - m.armR]], VERMILION);
  b.facet([[-5, -17 + m.armL], [6, -19 + m.armL], [5, -15 + m.armL], [-2, -13 + m.armL]], VERMILION);
  b.rect(-2, -17 + m.armL, 6, 1, INK);
  b.rect(0, -17 + m.armL, 1, 2, PAPER);
}

function shrapnelComet(brush, m) {
  const { line, facet } = brush;
  // An open, broken crescent of speaker shards, with a sawn-off comet tail.
  line([-8, -12], [-13, -3 - m.left], 2, COBALT);
  line([2, -10], [9, -4 - m.right], 2, PAPER);
  facet([[-17, -2 - m.left], [-10, -4 - m.left], [-6, 2 - m.left]], VERMILION);
  facet([[7, -5 - m.right], [15, -1 - m.right], [10, 2 - m.right], [5, 0 - m.right]], ACID);
  const b = offset(brush, m.sway, m.bob);
  b.facet([[-11, -35], [-4, -39], [8, -36], [2, -31], [-6, -32]], PAPER);
  b.facet([[-11, -35], [-6, -32], [-6, -24], [-14, -20], [-16, -29]], COBALT);
  b.facet([[-15, -18], [-7, -22], [-4, -15], [4, -15], [0, -9], [-11, -11]], VERMILION);
  b.facet([[-15, -18], [-7, -22], [-6, -18], [-11, -15]], ACID);
  b.facet([[4, -31], [13, -35], [16, -29], [10, -24]], VERMILION);
  b.facet([[8, -23], [16, -24], [13, -17], [4, -20]], PAPER);
  b.facet([[3, -14], [10, -17], [14, -12], [7, -8]], COBALT);
  // One face inside the hole, another eye expelled above it.
  const face = offset(b, m.hit + m.pluck, m.jitter);
  face.facet([[-4, -29], [3, -32], [6, -25], [0, -22], [-4, -24]], ACID);
  eye(face, -3, -28, 6, m.blink, m.look);
  face.facet([[-4, -21], [3, -22], [1, -18], [-2, -18]], PAPER);
  face.rect(-2, -21, 1, 2, INK);
  face.rect(1, -21, 1, 2, INK);
  b.facet([[7, -42], [14, -40], [12, -36], [6, -37]], COBALT);
  b.rect(9, -40, 2, m.blink ? 1 : 3, PAPER);
  for (let n = 0; n < 3; n++) b.rect(-13 + n, -29 + n * 3, 3, 1, PAPER);
  b.facet([[-17, -40 + m.armL], [-11, -42 + m.armL], [-13, -37 + m.armL]], VERMILION);
  b.facet([[14, -16 + m.armR], [17, -20 + m.armR], [17, -12 + m.armR]], ACID);
  b.facet([[-7, -8], [-2, -10], [1, -5], [-5, -3]], PAPER);
}

const SCULPTURES = [percussionMobile, bassMonolith, stairHarp, brokenGramophone,
  splitMaskTower, accordionScissor, shrapnelComet];

export function drawFractureSkin(brush, pose, index) {
  const moving = Boolean(pose.moving);
  const foot = side => moving ? Math.round(clamp(-pose.legs[side].foot[1], 0, 5)) : 0;
  const arm = side => moving ? Math.round(clamp((pose.arms[side].wrist[1] - pose.shoulderY) * .2, -1, 1)) : 0;
  const motion = {
    sway: moving ? Math.round(clamp(pose.sway * .5, -1, 1)) : 0,
    bob: moving ? Math.round(clamp((pose.hipY + 13) * .35, -1, 1)) : 0,
    left: foot(0), right: foot(1), armL: arm(0), armR: arm(1),
    hit: moving ? Math.round(clamp(pose.expression, 0, 1)) : 0,
    // Phrase travel keeps the instruments articulating when body taps quantize
    // to the same pixels. The supplied phase follows the audible performer.
    pluck: moving ? Math.round(Math.sin(clamp(pose.phase, 0, 1) * Math.PI * 2) * 2) : 0,
    jitter: moving ? Math.round(clamp(pose.jiggle, -1, 1)) : 0,
    step: moving ? pose.frame : 0,
    blink: moving && pose.blink,
    look: moving && pose.frame % 4 >= 2 ? 1 : 0,
  };
  SCULPTURES[Math.max(0, Math.min(6, Math.floor(Number(index) || 0)))](brush, motion);
}
