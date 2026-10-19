// Original, deformable Canvas artwork. All gesture geometry is in this viewbox.
const TAU = Math.PI * 2;
const clamp = (n, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));
const paths = new Map();
const INK = '#14131c';
const SKIN = '#b6c99a';
const LIME = '#d5f29b';
const PINK = '#de9cbd';

export const WITCH_LAYOUT = Object.freeze({
  width: 1000, height: 720,
  cauldron: Object.freeze({ x: 600, y: 520, rx: 188, ry: 62 }),
  moon: Object.freeze({ x: 800, y: 164, r: 78 }),
  hand: Object.freeze({ x: 388, y: 450, r: 47 }),
  mushrooms: Object.freeze([{ x: 162, y: 639, r: 48 }, { x: 846, y: 655, r: 42 }]),
  ghosts: Object.freeze([{ x: 160, y: 280, r: 45 }, { x: 854, y: 414, r: 44 }]),
  bats: Object.freeze([{ x: 705, y: 287, r: 34 }, { x: 285, y: 145, r: 30 }, { x: 868, y: 310, r: 28 }]),
});

function path(c, d, fill, stroke = null, width = 1.5) {
  let p = paths.get(d);
  if (!p) {
    p = new Path2D(d);
    // Dynamic sleeve/wing paths must not accumulate over a long performance.
    if (paths.size >= 320) paths.delete(paths.keys().next().value);
    paths.set(d, p);
  }
  if (fill) { c.fillStyle = fill; c.fill(p); }
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = width; c.stroke(p); }
}
function ellipse(c, x, y, rx, ry, fill, stroke, width = 1, rotation = 0) {
  c.beginPath(); c.ellipse(x, y, Math.max(.01, rx), Math.max(.01, ry), rotation, 0, TAU);
  if (fill) { c.fillStyle = fill; c.fill(); }
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = width; c.stroke(); }
}
function line(c, points, color, width = 1) {
  c.beginPath(); points.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y));
  c.strokeStyle = color; c.lineWidth = width; c.stroke();
}
function curve(c, p, color, width = 1) {
  c.beginPath(); c.moveTo(p[0], p[1]); c.bezierCurveTo(...p.slice(2));
  c.strokeStyle = color; c.lineWidth = width; c.stroke();
}
function glow(c, x, y, r, color) {
  const gradient = c.createRadialGradient(x, y, 0, x, y, r);
  gradient.addColorStop(0, color); gradient.addColorStop(1, 'transparent');
  c.fillStyle = gradient; c.fillRect(x - r, y - r, r * 2, r * 2);
}
function star(c, x, y, r, color, alpha = 1) {
  c.save(); c.globalAlpha *= alpha;
  path(c, `M${x - r},${y} Q${x},${y} ${x},${y - r * 1.5} Q${x},${y} ${x + r},${y} Q${x},${y} ${x},${y + r * 1.5} Q${x},${y} ${x - r},${y}`, color);
  c.restore();
}
function moon(c, state, flight) {
  const { x, y, r } = WITCH_LAYOUT.moon;
  const active = ['moon','moan'].includes(state.event?.kind) ? Math.max(0, 1 - (state.event.age || 0) / 2) : 0;
  glow(c, x, y, 156 + active * 20, `rgba(209,219,172,${.09 + active * .16})`);
  ellipse(c, x, y, r, r, '#d4d7b1', '#e8e4c6', 1.2);
  c.save(); c.beginPath(); c.arc(x, y, r - 1, 0, TAU); c.clip();
  for (const [dx, dy, rx, ry, a] of [[-32,-25,23,17,.11],[28,12,19,29,.1],[-15,39,21,12,.1],[38,-41,13,9,.09],[-48,26,12,16,.08],[4,-43,9,13,.08],[6,6,20,15,.06]]) {
    ellipse(c, x + dx, y + dy, rx, ry, `rgba(104,120,105,${a})`);
    ellipse(c, x + dx + 2, y + dy + 2, rx - 3, ry - 3, null, '#ecedca29', .8);
  }
  // A struck moon rings out like a large, luminous metal disc.
  if (active > .01) {
    c.save(); c.globalAlpha = active * .8;
    for (let i = 0; i < 3; i++) {
      const wave = ((state.event.age || 0) * 41 + i * 27) % r;
      ellipse(c, x, y, wave + 1, wave + 1, null, '#fbf7d6', 1.3 + active);
    }
    c.restore();
  }
  c.restore();
  if (flight) {
    c.save(); c.setLineDash([1, 9]); ellipse(c, x, y, r + 13, r + 13, null, '#e0dfbc57', 1.3); c.restore();
  }
}

function branch(c, x, y, scale, flip = 1, shade = '#1e1f2b') {
  c.save(); c.translate(x, y); c.scale(scale * flip, scale);
  path(c, 'M0,420 C20,322 16,229 45,139 C61,88 48,31 67,-16 L78,-27 C56,71 86,100 61,164 C39,222 53,302 31,420 Z', shade);
  path(c, 'M37,225 C-4,181 7,143 -18,114 L-49,98 L-62,72 L-40,91 L-15,94 C16,121 15,168 44,181 Z M54,149 C99,125 108,83 138,75 L154,49 L150,82 C111,99 112,149 52,179 Z M58,98 C33,64 30,45 10,34 L-2,3 L15,24 C42,31 39,65 64,77 Z M96,128 C136,130 158,116 176,94 L183,72 L187,94 C168,126 143,144 93,148 Z', shade);
  curve(c, [21,400,43,292,20,255,59,161], '#66657a13', 2);
  c.restore();
}
function background(c, state) {
  const flight = false; // The forest and cauldron remain the same place throughout.
  const gradient = c.createLinearGradient(0, 0, 0, 720);
  gradient.addColorStop(0, '#151522'); gradient.addColorStop(.65, '#232134'); gradient.addColorStop(1, flight ? '#323242' : '#141a20');
  c.fillStyle = gradient; c.fillRect(0, 0, 1000, 720);
  glow(c, 450, 440, 420, '#775b9215');
  for (let i = 0; i < 78; i++) {
    const x = (i * 173.71 + 37) % 990;
    const y = (i * 89.37 + 21) % 475;
    const twinkle = .28 + .24 * Math.sin((state.time || 0) * .55 + i * 2.1);
    if (i % 11 === 0) star(c, x, y, 3, '#dbd8ba', .5 + twinkle);
    else ellipse(c, x, y, i % 3 === 0 ? 1.2 : .65, i % 3 === 0 ? 1.2 : .65, `rgba(216,214,195,${twinkle})`);
  }
  moon(c, state, flight);
  if (flight) {
    for (let layer = 0; layer < 3; layer++) {
      const base = 606 + layer * 35;
      c.beginPath(); c.moveTo(0, 720); c.lineTo(0, base);
      for (let i = 0; i <= 30; i++) {
        const x = i * 37 - ((state.motionTime ?? state.time ?? 0) * (4 + layer * 8)) % 37;
        const y = base + Math.sin(i * .84 + layer) * 22;
        c.lineTo(x, y); c.lineTo(x + 12, y - 36 - (i % 4) * 14); c.lineTo(x + 22, y);
      }
      c.lineTo(1000, 720); c.closePath(); c.fillStyle = ['#242b37', '#1b2330', '#121b24'][layer]; c.fill();
    }
  } else {
    branch(c, 24, 70, 1.6, 1, '#191b27'); branch(c, 970, 56, 1.6, -1, '#191b27');
    branch(c, 145, 330, .85, 1, '#202330'); branch(c, 900, 340, .9, -1, '#202330');
    path(c, 'M0,661 Q128,598 251,628 Q390,657 499,633 Q656,601 782,628 Q908,610 1000,664 L1000,720 L0,720 Z', '#141c22');
    for (let i = 0; i < 19; i++) {
      const x = 25 + i * 54;
      line(c, [[x, 684 + (i % 3) * 8], [x - 5, 666 + (i % 4) * 7]], '#3b41414d', 1);
    }
  }
  c.save(); c.globalAlpha = .13;
  // Fixed grain-like flecks give the flat paths a drawn surface at any size.
  for (let i = 0; i < 160; i++) {
    const x = (i * 137.42) % 1000, y = (i * 313.73) % 720;
    line(c, [[x, y], [x + 1.4, y + .3]], '#a4a0b6', .6);
  }
  c.restore();
}

function hat(c, time, energy) {
  const flutter = Math.sin(time * 1.7) * (1 + energy * 1.7);
  c.save(); c.rotate(flutter * .004);
  path(c, 'M-66,-33 Q-47,-99 -31,-165 C-22,-213 12,-237 47,-223 C74,-211 87,-194 115,-203 C101,-178 72,-169 50,-164 Q39,-107 64,-39 Z', '#30263e', INK, 3);
  path(c, 'M-58,-48 C-43,-122 -29,-182 1,-206 C-16,-156 -15,-104 4,-48 Z', '#44324f');
  path(c, 'M5,-209 C39,-226 63,-188 94,-194 C78,-184 59,-180 42,-184', null, '#72617c', 1.2);
  curve(c, [-35,-139,-25,-116,-12,-102,5,-99], '#584362', 1.5);
  curve(c, [-18,-187,-5,-169,18,-170,37,-163], '#51415d', 1.2);
  path(c, 'M-60,-63 Q-12,-43 55,-64 L64,-35 Q-2,-13 -67,-32 Z', '#675068', INK, 2);
  path(c, 'M18,-60 L44,-63 L47,-38 L21,-34 Z M25,-54 L27,-41 L40,-43 L38,-55 Z', '#c4a77b', '#302d34', 1.5);
  line(c, [[31,-47],[46,-49]], '#d6ba8b', 2);
  path(c, 'M-69,-40 C-108,-34 -139,-16 -143,-6 C-137,6 -88,6 -40,-1 Q43,13 118,0 C148,-4 143,-21 120,-24 Q85,-25 61,-38 Q-2,-17 -69,-40 Z', '#352a43', INK, 3.5);
  curve(c, [-127,-5,-70,-20,61,20,130,-10], '#7e627c', 1.6);
  curve(c, [-109,-13,-52,-25,-7,-11,30,-9], '#57425f', 2);
  // Small stitched moon in the hat crown.
  path(c, 'M-14,-141 C-34,-142 -34,-117 -16,-111 C-29,-109 -40,-125 -32,-138 Q-24,-147 -14,-141 Z', '#ad9ca4');
  for (let i = 0; i < 6; i++) line(c, [[-49 + i * 4,-72 + i * 2],[-53 + i * 4,-66 + i * 2]], '#bfa2aa70', .8);
  c.restore();
}

function witchHead(c, state, x, y, scale = 1, tilt = 0) {
  const vocal = state.scene === 'brew' || (state.scene === 'flight' && state.launchEnvelope > 0);
  const time = state.time || 0, energy = clamp(state.energy), mouth = vocal ? clamp(state.mouth) : 0;
  c.save(); c.translate(x, y); c.rotate(tilt); c.scale(scale, scale);
  // Hair is behind the face, with separate wiry strands rather than a flat mass.
  path(c, 'M-42,-38 C-76,-34 -89,-4 -83,40 C-99,84 -68,110 -81,155 Q-57,148 -57,124 Q-40,150 -30,163 Q-42,110 -24,82 Q-4,42 1,-8 Z', '#827b7f', INK, 2.5);
  for (let i = 0; i < 13; i++) {
    const x0 = -72 + i * 4.4;
    const wave = Math.sin(time * 1.1 + i) * (2 + clamp(state.hair) * 6);
    curve(c, [x0,-23,x0 - 20 + wave,46,x0 + 12 + wave,85,x0 - 4 + Math.sin(i) * 10,140 + (i % 3) * 10], i % 3 === 0 ? '#c0b3ac' : '#5b5867', i % 3 === 0 ? 1.4 : 2.1);
  }
  path(c, 'M-28,88 L11,91 L31,153 L-9,166 L-42,126 Z', '#92aa80', INK, 2.5);
  curve(c, [-19,112,-15,133,1,140,8,147], '#5e7863', 1.6);
  path(c, 'M-35,-30 C-23,-55 12,-57 33,-34 Q48,-19 43,2 C58,12 56,24 60,33 L91,55 C108,71 86,80 67,68 L61,65 Q53,80 60,87 C76,102 67,115 50,120 L37,139 C18,152 -9,135 -8,113 Q-29,107 -37,84 C-46,69 -51,34 -45,18 Q-52,-11 -35,-30 Z', SKIN, INK, 3);
  path(c, 'M-38,36 Q-31,54 -24,75 Q-18,84 -7,88 L1,111 Q-10,128 18,140 Q-10,139 -13,117 Q-34,107 -40,82 Z', '#8ea881');
  path(c, 'M41,7 Q50,16 49,31 L79,60 Q90,68 98,65 Q94,77 76,69 L61,61 Q47,51 40,39 Z', '#c9d5a5');
  curve(c, [42,36,47,45,43,58,39,65], '#60765d', 1.4);
  ellipse(c, 73, 65, 4.1, 2.1, '#526953', null, 1, .35);
  ellipse(c, 87, 57, 2.2, 2.5, '#68765c');
  line(c, [[89,55],[93,51]], '#454b43', .8);
  // Eye and brow always remain visible under the brim.
  path(c, 'M-10,24 Q14,10 36,29 Q15,40 -10,24 Z', '#e4cfad', '#64725f', 1.5);
  ellipse(c, 22, 26, 7, 8, '#b69065'); ellipse(c, 24, 26, 2.5, 6, '#242323');
  ellipse(c, 26, 23, 1.7, 1.7, '#f8e9c7');
  curve(c, [-13,20,4,11,22,17,38,25], '#2c3830', 3.2);
  curve(c, [-17,9,0,-1,18,4,37,11], '#5d6753', 5);
  for (let i = 0; i < 4; i++) line(c, [[-17 + i * 9,8 + i],[ -20 + i * 10,4 + i]], '#bec2a0', .9);
  curve(c, [-7,39,5,48,24,47,33,38], '#78876a', 1.2);
  curve(c, [-14,47,2,55,13,53,21,51], '#899578', .9);
  path(c, 'M10,57 Q33,47 40,65 Q26,76 12,72 Z', '#9caf87');
  // Only the cauldron and the brief takeoff exclamation articulate her mouth.
  c.save(); c.translate(46, 97 + mouth * 5); c.rotate(.18);
  if (vocal) {
    ellipse(c, 0, 0, 14 + clamp(state.radius) * 7, 3 + mouth * 17, '#352633', '#64775c', 2.2);
    if (mouth > .12) {
      ellipse(c, 2, 5 + mouth * 6, 8 + mouth * 5, 2.5 + mouth * 3, '#c18c93');
      path(c, 'M-10,-5 L-4,-6 L-4,1 L-9,2 Z M4,-6 L10,-4 L8,3 L4,1 Z', '#e1d6ad');
    }
    curve(c, [-18,-2,-10,-9,7,-7,19,-3], '#6c7460', 1.1);
  } else {
    curve(c, [-17,-2,-6,7,9,6,17,-2], '#576d57', 2);
    curve(c, [-9,8,-2,10,6,9,10,7], '#a1b58c', 1);
  }
  c.restore();
  curve(c, [27,117 + mouth * 4,37,125 + mouth * 9,52,125 + mouth * 7,59,116 + mouth * 5], '#6b7e62', 1.6);
  curve(c, [-9,78,7,75,15,85,18,99], '#73876a', 1.1);
  ellipse(c, -36, 53, 11, 21, '#b6c397', '#6f8167', 1.2, -.22);
  curve(c, [-40,40,-28,36,-28,58,-37,65], '#6a8065', 1.4);
  ellipse(c, -36, 77, 7, 10, null, '#c5a477', 2);
  ellipse(c, -36, 87, 3, 4, '#e0bb8a');
  hat(c, time, energy);
  c.restore();
}

function robe(c, time, energy) {
  path(c, 'M398,360 C357,363 325,403 310,460 Q279,514 272,605 Q354,635 445,599 L481,461 Q487,415 454,382 L427,361 Z', '#34273e', INK, 3.5);
  path(c, 'M359,394 C354,443 340,491 325,542 Q312,583 319,611 L278,603 Q287,518 310,459 Q329,410 359,394 Z', '#453149');
  path(c, 'M424,389 Q451,429 434,482 L415,609 L452,595 Q455,533 478,463 Q489,411 448,379 Z', '#261f32');
  curve(c, [358,425,338,485,366,524,343,589], '#655067', 1.6);
  curve(c, [404,422,403,480,380,525,391,592], '#76617a', 1.1);
  curve(c, [421,474,403,522,416,568,407,595], '#44364f', 3);
  path(c, 'M393,355 L432,375 L454,397 L427,409 L401,382 L378,402 L362,387 Z', '#5b455c', INK, 2);
  line(c, [[400,382],[415,425],[410,471]], '#ac8d81', 1.1);
  ellipse(c, 415, 425, 11, 14, '#2b2737', '#b9a078', 1.5);
  ellipse(c, 415, 425, 6, 9, '#98b29b', '#d6d7ae', .7);
  const sway = Math.sin(time * 1.7) * energy * 5;
  path(c, `M280,586 Q251,596 247,622 L282,628 Q286,644 302,643 Q309,631 325,629 L352,624 Q328,605 310,597 Z`, '#27232e', INK, 2);
  curve(c, [255,621,267,613,284,612,299,617], '#755b65', 1.1);
  path(c, `M382,596 Q372,619 387,634 L444,638 Q478,632 ${474 + sway},614 Q454,631 437,614 L425,592 Z`, '#24212d', INK, 2);
  line(c, [[404,607],[419,614],[411,624]], '#ac9272', 1.5);
  // Frayed hem makes the silhouette feel cut by hand.
  for (let i = 0; i < 9; i++) line(c, [[281 + i * 18,605 + Math.sin(i) * 5],[279 + i * 18,615 + Math.sin(i) * 5]], '#554355', 1);
}

function smallHand(c, x, y, rotation, scale, curl = .5) {
  c.save(); c.translate(x, y); c.rotate(rotation); c.scale(scale, scale);
  path(c, 'M-15,16 Q-22,-7 -12,-20 Q-1,-30 17,-14 L18,13 L7,29 L-9,29 Z', SKIN, INK, 2);
  for (let i = 0; i < 4; i++) {
    const sx = -11 + i * 8, ey = -55 - (i === 1 ? 13 : 0) + curl * 28;
    const pts = [[sx,-14],[sx - 6,-34],[sx + curl * 14,ey],[sx + 7 + curl * 17,ey + 13]];
    line(c, pts, '#29372d', 9); line(c, pts, '#aabd91', 6);
    line(c, [[pts[2][0],pts[2][1] + 1],[pts[3][0],pts[3][1] - 1]], '#3b3441', 3);
    line(c, [[sx - 8,-32],[sx - 2,-32]], '#6b8366', .9);
  }
  curve(c, [13,10,34,0,35,-14,30,-25], '#334234', 10);
  curve(c, [13,10,34,0,35,-14,30,-25], SKIN, 7);
  line(c, [[28,-22],[27,-30]], '#302d37', 3);
  curve(c, [-8,8,1,10,5,-4,8,-12], '#738b6b', 1);
  c.restore();
}

function smoke(c, state) {
  const t = state.time || 0, energy = clamp(state.energy);
  c.save();
  for (let i = 0; i < 7; i++) {
    const age = (t * (.13 + energy * .13) + i / 7) % 1;
    const x = 560 + Math.sin(age * 4 + i * 2) * (38 + age * 45);
    const y = 491 - age * (185 + energy * 80);
    const a = Math.sin(age * Math.PI) * (.09 + energy * .07);
    c.globalAlpha = a;
    curve(c, [x - 20,y + 30,x - 66,y - 10,x + 64,y - 35,x + 20,y - 77], '#c0e8ac', 14 + age * 25);
    curve(c, [x - 18,y + 30,x - 60,y - 10,x + 60,y - 35,x + 20,y - 77], '#d5e7b1', 1.3);
  }
  c.restore();
}

function cauldron(c, state) {
  const { x, y, rx, ry } = WITCH_LAYOUT.cauldron;
  const time = state.time || 0, phase = state.phase || 0, energy = clamp(state.energy), radius = clamp(state.radius);
  glow(c, x, y + 44, 230, `rgba(151,204,114,${.12 + energy * .08})`);
  ellipse(c, x, 667, 192, 21, '#090f1680');
  // Three little iron feet, each picking up the firelight.
  for (const fx of [480, 600, 720]) {
    path(c, `M${fx - 12},631 L${fx - 20},673 Q${fx - 8},680 ${fx + 4},671 L${fx + 11},636 Z`, '#22292d', '#0e141d', 2.4);
    line(c, [[fx - 10,650],[fx - 14,667]], '#7c7150', 2);
  }
  // Warm embers below the cold potion.
  for (let i = 0; i < 9; i++) {
    const ex = 497 + i * 26, flick = Math.sin(time * 7 + i * 3) * 4;
    ellipse(c, ex, 666 + (i % 3) * 4, 12, 4, i % 2 ? '#9c7752' : '#b58b56');
    path(c, `M${ex - 5},665 Q${ex - 11},655 ${ex + flick},646 Q${ex - 2},657 ${ex + 7},659 Z`, '#bf94505e');
  }
  // The handles sit behind the vessel.
  ellipse(c, x - rx - 3, y + 35, 27, 29, null, '#080e17', 11);
  ellipse(c, x - rx - 3, y + 35, 27, 29, null, '#5c6260', 5);
  ellipse(c, x + rx + 3, y + 35, 27, 29, null, '#080e17', 11);
  ellipse(c, x + rx + 3, y + 35, 27, 29, null, '#5c6260', 5);
  const iron = c.createLinearGradient(x - rx, y, x + rx, y + 100);
  iron.addColorStop(0, '#303a3e'); iron.addColorStop(.36, '#253037'); iron.addColorStop(.76, '#161e29'); iron.addColorStop(1, '#30363e');
  path(c, 'M412,520 C409,604 452,659 595,662 C741,666 788,606 788,520 Z', iron, '#0a111a', 4);
  path(c, 'M430,550 Q435,619 500,636 Q465,604 468,560 Z', '#66756320');
  curve(c, [450,575,455,609,475,623,501,630], '#a3ab823a', 1.5);
  curve(c, [718,627,746,612,757,580,760,554], '#47535b', 2);
  ellipse(c, x, y, rx + 4, ry + 5, '#141f27', '#617167', 3);
  const potion = c.createRadialGradient(x - 20, y - 8, 8, x, y, rx);
  potion.addColorStop(0, '#d1e8a3'); potion.addColorStop(.27, '#8ab681'); potion.addColorStop(.72, '#527b69'); potion.addColorStop(1, '#274a49');
  ellipse(c, x, y, rx - 9, ry - 7, potion, '#b2d79a', 1.5);
  c.save(); c.beginPath(); c.ellipse(x, y, rx - 11, ry - 9, 0, 0, TAU); c.clip();
  for (let j = 0; j < 7; j++) {
    c.beginPath();
    for (let k = 0; k <= 90; k++) {
      const a = k / 90 * TAU * 1.15 + phase + j * .9;
      const r = 11 + k / 90 * (130 + radius * 26) + j * 1.3;
      const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r * .28;
      if (!k) c.moveTo(px, py); else c.lineTo(px, py);
    }
    c.strokeStyle = j % 2 ? '#d8efaf70' : '#244f4d78'; c.lineWidth = j % 2 ? 1.3 : 2.5; c.stroke();
  }
  ellipse(c, x, y + 1, 13 + energy * 15, 4 + energy * 5, '#345c54', '#b9d89390', .8);
  for (let i = 0; i < 14; i++) {
    const a = i * 2.39 + phase * .2, r = 53 + (i * 29 % 106);
    const bx = x + Math.cos(a) * r, by = y + Math.sin(a) * r * .24;
    const br = 2 + ((time * (4 + energy * 4) + i * 11) % 7);
    ellipse(c, bx, by, br, br * .5, '#a9cf8b55', '#d7eab27a', .7);
  }
  c.restore();
  // Runic engraving is authored linework, not a text or instruction overlay.
  c.save(); c.globalAlpha = .55;
  for (let i = 0; i < 5; i++) {
    c.save(); c.translate(527 + i * 36, 605 + Math.sin(i * .8) * 6);
    ellipse(c, 0, 0, 9, 9, null, '#b3bf8e', .8);
    line(c, [[-4,5],[0,-7],[4,5]], '#b3bf8e', 1);
    line(c, [[-5,1],[5,1]], '#b3bf8e', 1); c.restore();
  }
  c.restore();
  // A small hanging talisman makes the vessel a personal object.
  line(c, [[760,567],[769,599],[760,617]], '#8a806b', 1.2);
  ellipse(c, 759, 621, 7, 9, '#948f73', '#292c2b', 1.3);
  ellipse(c, 756, 619, 1.6, 2.2, '#353a33'); ellipse(c, 762, 619, 1.6, 2.2, '#353a33');
}

function mushrooms(c, x, y, scale = 1) {
  c.save(); c.translate(x, y); c.scale(scale, scale);
  for (const [mx, my, s] of [[0,0,1],[34,12,.67],[-23,15,.48]]) {
    c.save(); c.translate(mx,my); c.scale(s,s);
    path(c, 'M-4,0 Q-8,17 -3,30 L7,30 Q4,13 7,0 Z', '#aaa68e', '#282c2b', 1.5);
    path(c, 'M-23,2 C-21,-24 15,-32 26,-2 Q9,10 -23,2 Z', '#a48091', '#2b2732', 2);
    curve(c, [-22,1,-8,-3,9,8,24,-2], '#d4bcac', 1.2);
    ellipse(c,-6,-11,3,2,'#d3b9b0'); ellipse(c,9,-14,3.8,2.5,'#d3b9b0'); ellipse(c,16,-5,2,2,'#d3b9b0');
    c.restore();
  }
  c.restore();
}

function brewScene(c, state) {
  const time = state.time || 0, energy = clamp(state.energy);
  glow(c, 556, 418, 200, '#bbdb8b12');
  c.save(); c.globalAlpha *= 1 - clamp(state.flightLift);
  robe(c, time, energy);
  witchHead(c, state, 439, 254 + Math.sin(time * 1.9) * (1 + energy * 1.4), 1, .025 + Math.sin(time * .8) * .008);
  // Far hand is poised over the rising vapor.
  path(c, 'M391,411 Q358,407 341,438 L381,483 Q411,462 421,443 Z', '#4b3650', INK, 3);
  line(c, [[365,436],[386,464]], '#80637a', 1.1);
  if (!state.handSurface) smallHand(c, 388, 450, .68, .77, .45 + Math.sin(time * 1.7) * energy * .12);
  c.restore();
  smoke(c, state);
  cauldron(c, state);
  const a = Number.isFinite(state.ladleAngle) ? state.ladleAngle : state.phase || 0;
  const r = 28 + clamp(state.radius) * 109;
  const lx = 600 + Math.cos(a) * r, ly = 520 + Math.sin(a) * r * .27;
  // The moving bowl, the handle, and the wrist all share the stir point.
  const hx = lx - 40, hy = ly - 119;
  line(c, [[lx + 2,ly],[hx - 8,hy - 24]], '#1e2524', 11);
  line(c, [[lx + 2,ly],[hx - 8,hy - 24]], '#9a8664', 6.5);
  line(c, [[lx,ly - 2],[hx - 10,hy - 22]], '#d8bf87', 1.4);
  ellipse(c, lx, ly + 2, 18, 7, '#385d50', '#c4d995', 1.4, -.1);
  ellipse(c, lx - 3, ly, 12, 3.5, '#b6d797');
  c.save(); c.globalAlpha *= 1 - clamp(state.flightLift);
  path(c, `M437,395 Q459,387 ${hx - 24},${hy - 14} L${hx - 9},${hy + 21} Q465,457 427,438 Z`, '#48324b', INK, 3);
  curve(c, [443,411,472,433,hx - 33,hy + 3,hx - 14,hy + 8], '#79566f', 1.4);
  smallHand(c, hx, hy, -.35, .7, .95);
  c.restore();
  // Little highlights make the gesture target easy to find without a label.
  c.save(); c.globalAlpha = .25 + energy * .35;
  ellipse(c, lx, ly + 2, 25, 11, null, LIME, 1); c.restore();
  for (let i = 0; i < 9; i++) {
    const age = ((time * .17) + i * .139) % 1;
    const px = 475 + (i * 47 % 250) + Math.sin(time + i) * 6;
    const py = 499 - age * (65 + energy * 90);
    ellipse(c, px, py, 1.2 + (i % 2), 1.2 + (i % 2), `rgba(216,238,164,${(1 - age) * (.2 + energy * .5)})`);
  }
  mushrooms(c, 162, 639, 1.1); mushrooms(c, 846, 655, .76);
  // Two apothecary bottles remain props; actual ingredient controls live in HTML.
  path(c, 'M222,589 L234,589 L234,608 Q249,612 247,641 L211,641 Q209,611 222,608 Z', '#394c45', '#101b20', 2);
  ellipse(c,229,620,15,5,'#8eaa7670'); line(c,[[224,596],[224,611]],'#b6c39b80',2);
  path(c, 'M218,583 L238,583 L238,592 L218,592 Z', '#8c7661', '#28282b', 1.3);
  ellipse(c,229,628,7,9,'#b0b59790'); line(c,[[227,624],[232,632]],'#485c4c',1);
  if (clamp(state.glass) > .01) {
    for (let i = 0; i < 4; i++) star(c, 550 + i * 32, 488 + Math.sin(time * 2 + i) * 9, 3 + clamp(state.glass) * 3, '#cdf6f1', .6);
  }
  const ingredient = state.event;
  if ((ingredient?.kind === 'glass' || ingredient?.kind === 'hair') && ingredient.age < 1.1) {
    const fall = clamp((ingredient.age || 0) / .75);
    c.save(); c.translate(665 - fall * 26, 332 + fall * fall * 183);
    c.globalAlpha = Math.min(1, (1.1 - (ingredient.age || 0)) * 3);
    if (ingredient.kind === 'glass') {
      c.rotate(fall * 2.1);
      path(c, 'M-15,-19 L19,-6 L-1,21 Z', '#c0eceb47', '#c1e9dc', 1.4);
      path(c, 'M-15,-19 L-1,21 L1,-8 Z', '#bce2d851');
      line(c,[[-10,-12],[10,-5]],'#f4f4d5',1.1);
    } else {
      for (let i = 0; i < 7; i++) curve(c,[-17+i*5,-19,-31+i*6,5,29-i*4,-10,-11+i*3,27],'#bdb2b0',1.2);
    }
    c.restore();
  }
}

// The same projected rig drives display and picking; there is no second hand.
export function handTransform(state = {}) {
  const reach = clamp(state.handReach);
  const wrist = state.handWrist || {x:590,y:590};
  const scale = .14 + .86 * reach;
  return { scale, x: (388 - wrist.x * .14) * (1 - reach), y: (450 - wrist.y * .14) * (1 - reach) };
}
export function getFingerTips(state = {}) {
  const t = handTransform(state);
  return (state.handTips || []).map(p => ({...p,x:p.x*t.scale+t.x,y:p.y*t.scale+t.y}));
}
function reachingHand(c, state) {
  if (!state.handSurface || state.flightLift > .995) return;
  const t = handTransform(state), wrist = state.handWrist || {x:590,y:590};
  const wx = wrist.x*t.scale+t.x, wy = wrist.y*t.scale+t.y;
  const reach = clamp(state.handReach), cuff = 10 + reach*42;
  c.save(); c.globalAlpha *= 1-clamp(state.flightLift);
  // A widening sleeve connects her shoulder to the model's actual wrist.
  path(c, `M365,410 Q${375+reach*40},${469+reach*105} ${wx-cuff},${wy+9} Q${wx},${wy+25} ${wx+cuff},${wy+9} Q${420+reach*25},${407+reach*28} 403,409 Z`, '#503650', INK, 3);
  curve(c,[379,422,410,483+reach*95,wx-30,wy+25,wx-14,wy+7],'#90728a',1.5);
  c.save(); c.translate(t.x,t.y); c.scale(t.scale,t.scale); c.drawImage(state.handSurface,0,0,1000,720); c.restore();
  if (reach > .5) {
    const colors=['#caaf98','#c6ce9d','#9fc6ac','#a7bfd3','#c6a8c9'];
    for (const tip of getFingerTips(state)) {
      const level=clamp(state.fingerLevels?.[tip.index]);
      c.save(); c.globalAlpha *= reach;
      ellipse(c,tip.x,tip.y,17+level*13,17+level*13,null,colors[tip.index],state.selectedFinger===tip.index?2:1);
      if(level>.01) { glow(c,tip.x,tip.y,38+level*18,`${colors[tip.index]}55`); star(c,tip.x+23,tip.y-13,level*6,colors[tip.index]); }
      c.restore();
    }
  } else {
    c.save(); c.globalAlpha *= .45;
    ellipse(c,388,433,32,39,null,LIME,1); c.restore();
  }
  c.restore();
}

function bat(c, x, y, scale, time, index, active = false) {
  const flap = Math.sin(time * 8 + index * 2) * 15;
  c.save(); c.translate(x, y); c.scale(scale, scale); c.rotate(Math.sin(time * 1.1 + index) * .14);
  if (active) {
    glow(c, 0, 0, 55, '#c79ac943');
    ellipse(c,0,4,47,20,null,'#ddbdd569',1.7);
  }
  for (const direction of [-1,1]) {
    c.save(); c.scale(direction,1);
    path(c, `M2,0 Q22,${-36 - flap} 48,${-13 - flap} Q31,${-7 - flap * .4} 31,11 Q19,1 15,17 Q10,5 2,10 Z`, '#554563', '#a190ac', 1.1);
    curve(c,[4,3,19,-14-flap*.3,33,-16-flap*.5,47,-13-flap],'#94809e',.75);
    line(c,[[5,4],[31,11]],'#99859e',.6);
    c.restore();
  }
  ellipse(c,0,5,7,13,'#292c38','#9e8da5',1);
  path(c,'M-6,-2 L-9,-15 L-1,-9 L6,-14 L6,1 Z','#393044','#a190ac',1);
  ellipse(c,-3,-3,1.3,1.5,'#e6c891'); ellipse(c,3,-3,1.3,1.5,'#e6c891');
  c.restore();
}
function ghost(c, x, y, scale, time, index, active = false) {
  const bob = Math.sin(time * 1.4 + index * 2) * 8;
  c.save(); c.translate(x, y + bob); c.scale(scale,scale); c.rotate(Math.sin(time + index) * .07);
  glow(c,0,5,73,active ? '#b4d7cc33' : '#c1d9cf15');
  const silk = c.createLinearGradient(-26,-37,29,69);
  silk.addColorStop(0,'#c5d3c2c7'); silk.addColorStop(.5,'#adbdc48f'); silk.addColorStop(1,'#899fb433');
  path(c, 'M-33,26 C-37,-8 -23,-40 0,-40 C28,-42 38,-15 34,17 Q37,43 52,57 Q29,57 19,43 Q17,64 -1,68 Q-3,52 -12,46 Q-23,66 -44,57 Q-28,40 -33,26 Z', silk, '#c9d3c17a', 1.2);
  curve(c,[-25,-11,-31,21,-19,36,-25,47],'#e1e5cf69',1.2);
  curve(c,[21,4,18,24,26,32,30,44],'#d1d9cc4d',1);
  ellipse(c,-12,-7,4.5,9,'#384451b3',null,1,-.16);
  ellipse(c,12,-7,4.5,9,'#384451b3',null,1,.16);
  curve(c,[-7,17,-4,21,4,21,7,17],'#384451a3',1.7);
  if (active) {
    for (let i = 0; i < 3; i++) ellipse(c,0,17+i*12,44+i*9,9+i*3,null,'#c7e4d182',1.2);
  }
  c.restore();
}

function broomWitch(c, state) {
  const time = state.motionTime ?? state.time ?? 0;
  const pulse = clamp(state.flightPulse);
  const spark = state.event?.kind === 'spark' ? clamp(1-(state.event.age || 0)/1.2) : 0;
  const lift = clamp(state.flightLift ?? 1);
  const x = 455 + (470 + clamp(state.flightX ?? .5) * 370 - 455 + Math.sin(time*.7)*20) * lift;
  // The entire hat-to-boot silhouette stays inside the view at both extremes.
  const y = 476 + (430 - clamp(state.altitude ?? .5) * 130 - 476) * lift;
  c.save(); c.globalAlpha *= lift; c.translate(x,y + Math.sin(time * 1.8) * 5); c.rotate(-.08 + (clamp(state.altitude ?? .5) - .5) * .16); c.scale(.8-.1*lift,.8-.1*lift);
  // The broom is the rhythm source: its reeds light on each actual attack.
  const shimmer = Math.max(pulse,spark);
  if (shimmer > .01) {
    c.save(); c.globalAlpha = shimmer;
    glow(c,-248,123,99,'#d5dea54a');
    for (let i = 0; i < 8; i++) {
      const sx = -307-i*17, sy = 126 + Math.sin(time*4+i*1.7)*(9+i*2);
      star(c,sx,sy,1.5+shimmer*2.5,'#e7dfad',1-i/9);
    }
    c.restore();
  }
  // Long rushes stream behind the witch; loose ends flutter independently.
  path(c, 'M-182,116 C-232,77 -282,87 -313,99 Q-284,105 -306,117 Q-275,123 -300,138 Q-261,131 -267,155 Q-226,140 -181,136 Z', '#7f725b', '#26272a', 2.5);
  for (let i = 0; i < 18; i++) {
    const by = 92 + i * 3.5;
    curve(c,[-182,119+i*.9,-220,106+i*1.7,-255,by+Math.sin(time*4+i)*(4+pulse*5),-296+(i%4)*8,by],i%3===0 && pulse>.12 ? '#e5dda4' : '#baa27b',i%3===0?1.5+pulse:.7);
  }
  line(c,[[-201,109],[-194,140]],'#503c42',9); line(c,[[-201,109],[-194,140]],'#c9ad81',2.4);
  curve(c,[-219,129,-110,111,54,135,162,96],'#201e25',12);
  curve(c,[-219,129,-110,111,54,135,162,96],'#a68762',7);
  curve(c,[-219,127,-110,109,54,133,161,94],'#d3b18a',1.3);
  if (pulse > .01) {
    c.save(); c.globalAlpha = pulse;
    curve(c,[-219,127,-110,109,54,133,161,94],'#e7ebbb',1.5+pulse*1.5);
    c.restore();
  }
  path(c, 'M-67,-32 Q-103,-8 -102,45 Q-151,74 -181,85 L-156,111 Q-122,98 -117,119 Q-79,96 -66,111 Q-14,94 25,109 Q48,96 29,76 L-6,47 L-3,-5 Z', '#3b2b47', INK, 3);
  path(c, 'M-87,14 Q-107,77 -159,88 L-143,97 Q-120,80 -109,96 Q-68,75 -54,95 L-30,65 Z', '#58405b');
  curve(c,[-67,5,-40,50,-69,75,-81,90],'#80637b',1.3);
  path(c, 'M-15,85 Q28,99 19,139 L45,178 Q34,191 15,181 L-9,143 Q-24,126 -40,105 Z', '#34303d', INK, 2.5);
  path(c, 'M14,168 Q34,176 42,171 Q54,196 75,181 Q74,204 45,202 L20,187 Z', '#22232e', INK, 2.3);
  line(c,[[28,179],[38,183],[31,190]],'#b89e7f',1.6);
  path(c, 'M-2,2 Q20,9 40,42 L92,69 L83,94 Q44,87 12,64 L-18,39 Z', '#4e3753', INK, 2.5);
  smallHand(c,89,83,-.4,.64,.9);
  witchHead(c,state,-53,-149,1,-.1);
  c.restore();
}

function flightScene(c, state) {
  const time = state.motionTime ?? state.time ?? 0;
  // Thin, drifting cloud banks preserve the open sky as a generous flight pad.
  c.save(); c.globalAlpha = .1;
  for (let i = 0; i < 4; i++) {
    const x = ((i * 317 - time * (11 + i * 3)) % 1250 + 1250) % 1250 - 180;
    ellipse(c,x,243 + i * 96,170,14 + i * 4,'#b5acc2');
  }
  c.restore();
  if (state.event?.kind === 'gust' && (state.event.age || 0) < 1.6) {
    const age = state.event.age || 0;
    c.save(); c.globalAlpha = Math.sin(Math.min(1,age/1.6)*Math.PI)*.65;
    for (let i = 0; i < 4; i++) {
      const x = 150+age*210+i*23, y = 292+i*35;
      curve(c,[x,y,x+93,y-26,x+146,y+23,x+235,y-6],'#bbd5c3',1.5);
    }
    c.restore();
  }
  for (let i = 0; i < WITCH_LAYOUT.ghosts.length; i++) {
    const g = WITCH_LAYOUT.ghosts[i];
    ghost(c,g.x,g.y, i ? .88 : .9,time,i,state.event?.kind === 'ghost' && (state.event.age || 0) < 1.3);
  }
  if (state.flightLift > .001) broomWitch(c,state);
  for (let i = 0; i < WITCH_LAYOUT.bats.length; i++) {
    const b = WITCH_LAYOUT.bats[i];
    bat(c,b.x,b.y,.6 + i * .05,time,i,state.event?.kind === 'bat' && (state.event.age || 0) < 1);
  }
  // Distant silhouettes make the three playable bats read as part of a flock.
  for (let i = 0; i < 4; i++) bat(c,615 + i * 42,94 + Math.sin(i * 2) * 24,.19 + i * .025,time + i,i);
}

// One bounded offscreen world lets mushroom ripples bend all of the artwork,
// including the actual skinned hand. Input uses the exact inverse below.
const worlds = new WeakMap();
export function witchWarpX(y, state = {}) {
  const trip = Math.round(clamp(state.trip,0,3));
  if (!trip) return 0;
  const time = state.warpTime ?? state.time ?? 0;
  return (7 + trip*4) * Math.sin(y*.024+time*1.8) + trip*2.5*Math.sin(y*.063-time*2.3);
}
export function warpWitchPoint(point, state = {}, inverse = false) {
  if(!state.trip) return {...point};
  const wave=witchWarpX(point.y,state);
  return {...point,x:inverse?(point.x-wave+25)/1.05:point.x*1.05-25+wave};
}
function drawWorld(c, state) {
  c.clearRect(0,0,1000,720); c.lineCap='round'; c.lineJoin='round';
  background(c,state);
  brewScene(c,state);
  flightScene(c,state);
  reachingHand(c,state);
  if (state.trip) {
    const t=state.warpTime??state.time??0;
    for(const m of WITCH_LAYOUT.mushrooms) {
      glow(c,m.x,m.y-12,70,'#e8b2ee30');
      for(let i=0;i<3;i++) ellipse(c,m.x,m.y-10,32+i*12+Math.sin(t*2+i)*6,12+i*7,null,'#e5b8df77',1.3);
    }
  }
}
/** Draw using CSS-pixel dimensions; the caller owns backing-store/DPR setup. */
export function renderWitch(ctx, width, height, state = {}) {
  const w=Math.max(1,width),h=Math.max(1,height),scale=Math.min(w/1000,h/720);
  let world=worlds.get(ctx);
  if(!world) {
    const surface=ctx.canvas.ownerDocument.createElement('canvas'); surface.width=1000;surface.height=720;
    const colored=surface.cloneNode();
    world={surface,ctx:surface.getContext('2d',{alpha:false}),colored,color:colored.getContext('2d',{alpha:false})}; worlds.set(ctx,world);
  }
  drawWorld(world.ctx,state);
  ctx.save(); ctx.clearRect(0,0,w,h);ctx.fillStyle='#14151f';ctx.fillRect(0,0,w,h);
  ctx.translate((w-1000*scale)/2,(h-720*scale)/2);ctx.scale(scale,scale);
  ctx.beginPath();ctx.rect(0,0,1000,720);ctx.clip();
  const trip=Math.round(clamp(state.trip,0,3));
  if(trip) {
    // Color once, then warp cheap raster slices: filtering every slice would
    // create hundreds of offscreen filter surfaces on software/mobile GPUs.
    world.color.filter=`hue-rotate(${[0,100,215,290][trip]}deg) saturate(2.15)`;
    world.color.drawImage(world.surface,0,0);
    // Four-pixel strips keep the raster pass bounded even on a large display.
    for(let y=0;y<720;y+=4) ctx.drawImage(world.colored,0,y,1000,4,witchWarpX(y+2,state)-25,y,1050,4);
  } else ctx.drawImage(world.surface,0,0);
  ctx.restore();
}

/** Input remains attached to the visible world through extension and ripples. */
export function hitTestWitch(x, y, state = {}) {
  if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||y<0||x>1000||y>720) return null;
  const point=warpWitchPoint({x,y},state,true); x=point.x;y=point.y;
  const minRadius=Math.max(46,state.hitRadius||0);
  const moon=WITCH_LAYOUT.moon;
  if(Math.hypot(x-moon.x,y-moon.y)<Math.max(moon.r+12,minRadius)) return {type:'moon'};
  for(const m of WITCH_LAYOUT.mushrooms) if(Math.hypot(x-m.x,y-m.y)<Math.max(m.r,minRadius)) return {type:'mushrooms'};
  if(state.scene==='fingers' && state.handReach>.65) {
    let nearest=null,distance=minRadius;
    for(const tip of getFingerTips(state)) {
      const d=Math.hypot(x-tip.x,y-tip.y);
      if(d<distance) {nearest={type:'finger',index:tip.index};distance=d;}
    }
    if(nearest) return nearest;
    const t=handTransform(state);
    const hit=state.pickHand?.((x-t.x)/t.scale,(y-t.y)/t.scale,minRadius/t.scale);
    if(hit) return hit;
  }
  if(state.scene!=='flight' && Math.hypot(x-388,y-433)<Math.max(47,minRadius)) return {type:'hand'};
  const pot=WITCH_LAYOUT.cauldron;
  if(((x-pot.x)/(pot.rx+30))**2+((y-pot.y)/(pot.ry+33))**2<1) return {type:'stir'};
  if(state.scene==='flight') {
    for(const type of ['ghost','bat']) {
      for(const [index,g] of WITCH_LAYOUT[type==='ghost'?'ghosts':'bats'].entries()) {
        if(Math.hypot(x-g.x,y-g.y)<Math.max(g.r,minRadius)) return {type,index};
      }
    }
    return {type:'flight'};
  }
  const a=Number.isFinite(state.ladleAngle)?state.ladleAngle:state.phase||0,r=28+clamp(state.radius)*109;
  const hx=600+Math.cos(a)*r-40,hy=520+Math.sin(a)*r*.27-119;
  if(Math.hypot(x-hx,y-hy)<Math.max(48,minRadius)) return {type:'stir'};
  return null;
}
