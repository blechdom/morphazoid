// Original, deformable Canvas artwork. All gesture geometry is in this viewbox.
const TAU = Math.PI * 2;
const clamp = (n, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));
const paths = new Map();
const INK = '#14131c';
const SKIN = '#b5db9d';
const LIME = '#cefa8b';
const PINK = '#f29bce';

export const WITCH_LAYOUT = Object.freeze({
  width: 1000, height: 720,
  cauldron: Object.freeze({ x: 600, y: 520, rx: 188, ry: 62 }),
  moon: Object.freeze({ x: 800, y: 164, r: 78 }),
  hand: Object.freeze({ x: 388, y: 450, r: 47 }),
  mushrooms: Object.freeze([{ x: 162, y: 639, r: 48 }, { x: 846, y: 655, r: 42 }]),
  ghosts: Object.freeze([{ x: 160, y: 280, r: 45 }, { x: 854, y: 414, r: 44 }]),
  bats: Object.freeze([{ x: 705, y: 287, r: 34 }, { x: 285, y: 145, r: 30 }, { x: 868, y: 310, r: 28 }]),
  spirits:Object.freeze([Object.freeze({kind:'spark',x:666,y:88,r:25}),Object.freeze({kind:'gust',x:84,y:365,r:30})]),
  objects: Object.freeze([
    Object.freeze({id:'gesticules',kind:'drop-gesticules',name:'Gesticules',x:122,y:500,r:32}),
    Object.freeze({id:'marimba',kind:'drop-marimba',name:'Linear Drums',x:272,y:555,r:34}),
    Object.freeze({id:'choir',kind:'drop-choir',name:'Throatazoid',x:888,y:525,r:34}),
  ]),
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
  // Broken limbs and hooked thorns keep the trees skeletal against the sky.
  for(const [tx,ty,side] of [[31,312,-1],[38,263,1],[42,207,-1],[59,151,1],[65,74,-1],[110,113,1]]) {
    path(c,`M${tx},${ty+7} L${tx+side*22},${ty-16} L${tx+side*9},${ty+1} Z`,shade);
    line(c,[[tx,ty],[tx+side*20,ty-20],[tx+side*18,ty-31]],'#76617d40',.8);
  }
  path(c,'M31,261 Q45,235 48,266 L44,295 Q38,285 31,299 Z','#0b101b');
  path(c,'M30,244 L35,239 L35,249 Z M44,237 L51,231 L49,243 Z','#b8bb5e51');
  c.restore();
}
function background(c, state) {
  const flight = false; // The forest and cauldron remain the same place throughout.
  const gradient = c.createLinearGradient(0, 0, 0, 720);
  gradient.addColorStop(0, '#100e22'); gradient.addColorStop(.38, '#39213d'); gradient.addColorStop(.72, '#12373d'); gradient.addColorStop(1, '#0b131d');
  c.fillStyle = gradient; c.fillRect(0, 0, 1000, 720);
  glow(c, 310, 210, 330, '#a43aa52b');
  glow(c, 740, 320, 340, '#1db6ae24');
  glow(c, 110, 510, 220, '#506fe628');
  for (let i = 0; i < 42; i++) {
    const x = (i * 173.71 + 37) % 990;
    const y = (i * 89.37 + 21) % 475;
    const twinkle = .28 + .24 * Math.sin((state.time || 0) * .55 + i * 2.1);
    const starlight = ['#eed391','#9ce6de','#d5a7fa','#f3a9c5'][i%4];
    c.save(); c.globalAlpha *= twinkle; ellipse(c, x, y, i % 3 === 0 ? 1.2 : .65, i % 3 === 0 ? 1.2 : .65, starlight); c.restore();
  }
  moon(c, state, flight);
  // Wind-torn veils cross the moon instead of a cheerful star field.
  for(let i=0;i<3;i++) {
    const drift=Math.sin((state.time||0)*.08+i*2)*35,y=104+i*67;
    path(c,`M${490+drift},${y} Q${665+drift},${y-17} 938,${y+8} Q814,${y+11} ${647+drift},${y+4} Z`,'#16132768');
  }
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
    branch(c, 24, 70, 1.6, 1, '#211b34'); branch(c, 970, 56, 1.6, -1, '#122b35');
    branch(c, 145, 330, .85, 1, '#302440'); branch(c, 900, 340, .9, -1, '#203b46');
    path(c, 'M0,661 Q128,598 251,628 Q390,657 499,633 Q656,601 782,628 Q908,610 1000,664 L1000,720 L0,720 Z', '#141c22');
    for(const [x,y,s] of [[64,622,.7],[934,604,.8],[780,606,.46]]) {
      c.save();c.translate(x,y);c.rotate((x%7-3)*.035);c.scale(s,s);
      path(c,'M-22,29 L-19,-20 Q-7,-39 10,-23 L20,26 Z','#27323a','#0b151d',2);
      line(c,[[-8,-10],[8,-10]],'#897c945b',2);line(c,[[0,-21],[0,10]],'#897c945b',2);c.restore();
    }
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

function hatShape(state) {
  const value=clamp(state.hat??.5),flutter=Math.sin((state.time||0)*1.7)*(1+clamp(state.energy)*1.7);
  return {flutter,tilt:(value-.5)*.18+flutter*.004,stretch:.88+value*.24};
}
function hat(c, state) {
  const {flutter,tilt,stretch}=hatShape(state);
  c.save(); c.rotate(tilt);c.scale(1,stretch);
  path(c, 'M-66,-33 L-56,-76 L-61,-84 L-49,-94 Q-42,-135 -31,-165 C-22,-213 12,-237 47,-223 C70,-214 78,-181 109,-193 L98,-177 L79,-179 L71,-167 L57,-170 Q44,-132 50,-102 L42,-93 L55,-84 L64,-39 Z', '#30263e', INK, 3);
  path(c, 'M-58,-48 C-43,-122 -29,-182 1,-206 C-16,-156 -15,-104 4,-48 Z', '#44324f');
  path(c, 'M5,-209 C39,-226 63,-188 94,-194 C78,-184 59,-180 42,-184', null, '#72617c', 1.2);
  curve(c, [-35,-139,-25,-116,-12,-102,5,-99], '#584362', 1.5);
  curve(c, [-18,-187,-5,-169,18,-170,37,-163], '#51415d', 1.2);
  path(c, 'M-60,-63 Q-12,-43 55,-64 L64,-35 Q-2,-13 -67,-32 Z', '#675068', INK, 2);
  path(c, 'M18,-60 L44,-63 L47,-38 L21,-34 Z M25,-54 L27,-41 L40,-43 L38,-55 Z', '#c4a77b', '#302d34', 1.5);
  line(c, [[31,-47],[46,-49]], '#d6ba8b', 2);
  path(c, 'M-69,-40 C-108,-34 -139,-16 -143,-6 L-125,-3 L-127,8 L-105,2 L-93,11 L-77,2 L-64,8 L-40,-1 Q23,12 62,6 L74,14 L84,4 L99,9 L103,1 L118,0 C148,-4 143,-21 120,-24 Q85,-25 61,-38 Q-2,-17 -69,-40 Z', '#352a43', INK, 3.5);
  curve(c, [-127,-5,-70,-20,61,20,130,-10], '#7e627c', 1.6);
  curve(c, [-109,-13,-52,-25,-7,-11,30,-9], '#57425f', 2);
  // Small stitched moon in the hat crown.
  path(c, 'M-14,-141 C-34,-142 -34,-117 -16,-111 C-29,-109 -40,-125 -32,-138 Q-24,-147 -14,-141 Z', '#ad9ca4');
  for (let i = 0; i < 6; i++) line(c, [[-49 + i * 4,-72 + i * 2],[-53 + i * 4,-66 + i * 2]], '#bfa2aa70', .8);
  path(c,'M-22,-185 L-1,-191 L4,-162 L-18,-157 Z','#675459','#b89a805c',1);
  for(let i=0;i<5;i++)line(c,[[-24+i*6,-181-i*.5],[-20+i*6,-175-i*.5]],'#b9a280',.9);
  path(c,'M19,-128 L27,-141 L34,-131 L31,-119 L21,-115 Z','#111522','#766077',1);
  line(c,[[22,-127],[30,-130]],'#617381',.8);
  for(const [x,y] of [[-130,3],[-105,4],[-76,4],[75,10],[98,5],[98,-180]]) {
    curve(c,[x,y,x-6,y+8,x+5,y+12,x-2,y+20+flutter],'#92768a',.8);
  }
  c.restore();
}

function witchHead(c, state, x, y, scale = 1, tilt = 0) {
  const vocal = true;
  const time = state.time || 0, energy = clamp(state.energy), mouth = vocal ? clamp(state.mouth) : 0;
  const nose=(clamp(state.nose??.5)-.5)*40;
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
  path(c, `M-35,-30 C-23,-55 12,-57 33,-34 Q48,-19 43,2 C58,12 56,24 60,33 L${91+nose},55 C${108+nose},71 ${86+nose},80 ${67+nose*.3},68 L61,65 Q53,80 60,87 C76,102 67,115 50,120 L37,139 C18,152 -9,135 -8,113 Q-29,107 -37,84 C-46,69 -51,34 -45,18 Q-52,-11 -35,-30 Z`, SKIN, INK, 3);
  path(c, 'M-38,36 Q-31,54 -24,75 Q-18,84 -7,88 L1,111 Q-10,128 18,140 Q-10,139 -13,117 Q-34,107 -40,82 Z', '#8ea881');
  path(c, `M41,7 Q50,16 49,31 L${79+nose*.8},60 Q${90+nose},68 ${98+nose},65 Q${94+nose},77 ${76+nose*.6},69 L61,61 Q47,51 40,39 Z`, '#c9d5a5');
  curve(c, [42,36,47,45,43,58,39,65], '#60765d', 1.4);
  ellipse(c, 73+nose*.5, 65, 4.1, 2.1, '#526953', null, 1, .35);
  ellipse(c, 87+nose, 57, 2.2, 2.5, '#68765c');
  line(c, [[89+nose,55],[93+nose,51]], '#454b43', .8);
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
  // The quiet brewing underneath her hand still moves her mouth.
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
  hat(c, state);
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
    curve(c, [x - 20,y + 30,x - 66,y - 10,x + 64,y - 35,x + 20,y - 77], ['#9ce9b1','#b48cfa','#66dfd8'][i%3], 14 + age * 25);
    curve(c, [x - 18,y + 30,x - 60,y - 10,x + 60,y - 35,x + 20,y - 77], ['#e4e7a5','#f09dcc','#7befe1'][i%3], 1.3);
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
  iron.addColorStop(0, '#256976'); iron.addColorStop(.28, '#334a62'); iron.addColorStop(.6, '#382d53'); iron.addColorStop(.84, '#642e58'); iron.addColorStop(1, '#2c5660');
  path(c, 'M412,520 C409,604 452,659 595,662 C741,666 788,606 788,520 Z', iron, '#0a111a', 4);
  path(c, 'M430,550 Q435,619 500,636 Q465,604 468,560 Z', '#66756320');
  curve(c, [450,575,455,609,475,623,501,630], '#a3ab823a', 1.5);
  curve(c, [718,627,746,612,757,580,760,554], '#47535b', 2);
  ellipse(c, x, y, rx + 4, ry + 5, '#152f36', '#8aa9b5', 3);
  const potion = c.createRadialGradient(x - 20, y - 8, 8, x, y, rx);
  potion.addColorStop(0, '#eff5a3'); potion.addColorStop(.27, '#a5d66d'); potion.addColorStop(.58, '#39b69e'); potion.addColorStop(.84, '#45878e'); potion.addColorStop(1, '#5e3e86');
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
    c.strokeStyle = ['#e5f5aa99','#db9fe57a','#23565f9e','#70eee399'][j%4]; c.lineWidth = j % 2 ? 1.3 : 2.5; c.stroke();
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
    const rune = ['#a1e7d5','#e9bb89','#da9fe7','#a9c6ff','#cfec9c'][i];
    ellipse(c, 0, 0, 9, 9, null, rune, .8);
    line(c, [[-4,5],[0,-7],[4,5]], rune, 1);
    line(c, [[-5,1],[5,1]], rune, 1); c.restore();
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
    path(c, 'M-23,2 C-21,-24 15,-32 26,-2 Q9,10 -23,2 Z', mx===0?'#bc5c9f':mx>0?'#7a79bf':'#cf896d', '#2b2732', 2);
    curve(c, [-22,1,-8,-3,9,8,24,-2], '#d4bcac', 1.2);
    ellipse(c,-6,-11,3,2,'#d3b9b0'); ellipse(c,9,-14,3.8,2.5,'#d3b9b0'); ellipse(c,16,-5,2,2,'#d3b9b0');
    c.restore();
  }
  c.restore();
}

export function getWitchLadle(state = {}) {
  const angle=Number.isFinite(state.ladleAngle)?state.ladleAngle:state.phase||0;
  const radius=28+clamp(state.radius)*109;
  const lx=600+Math.cos(angle)*radius,ly=520+Math.sin(angle)*radius*.27;
  // Keep the handle to the right of her face while its bowl circles the pot.
  return {lx,ly,hx:640+Math.cos(angle)*radius*.26,hy:ly-(80+140*clamp(state.spoonHeight??.5))};
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
  const {lx,ly,hx,hy}=getWitchLadle(state);
  // The moving bowl, the handle, and the wrist all share the stir point.
  line(c, [[lx + 2,ly],[hx - 8,hy - 24]], '#1e2524', 11);
  line(c, [[lx + 2,ly],[hx - 8,hy - 24]], '#9a8664', 6.5);
  line(c, [[lx,ly - 2],[hx - 10,hy - 22]], '#d8bf87', 1.4);
  ellipse(c, lx, ly + 2, 18, 7, '#385d50', '#c4d995', 1.4, -.1);
  ellipse(c, lx - 3, ly, 12, 3.5, '#b6d797');
  for(let i=0;i<5;i++) {
    const py=ly-80-i*35,active=Math.min(4,Math.floor(clamp(state.spoonHeight??.5)*5))===i;
    ellipse(c,hx+22,py,active?3.4:1.6,active?3.4:1.6,['#cfb8ee','#78ccdc','#addc94','#dfaa7d','#e6a4c9'][i]);
    if(active)glow(c,hx+22,py,12,'#d7ddae27');
  }
  c.save(); c.globalAlpha *= 1 - clamp(state.flightLift);
  path(c, `M437,395 Q459,387 ${hx - 24},${hy - 14} L${hx - 9},${hy + 21} Q465,457 427,438 Z`, '#48324b', INK, 3);
  curve(c, [443,411,472,433,hx - 33,hy + 3,hx - 14,hy + 8], '#79566f', 1.4);
  if (state.handSurfaces?.[1]) drawHandModel(c,state,1);
  else smallHand(c, hx, hy, -.35, .7, .95);
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

/** The broom follows a continuous, untuned rollercoaster path above the pot.
 * Pointer position steers its centre; altitude changes the height of the coils. */
export function broomTransform(state = {}) {
  const lift=clamp(state.flightLift),time=state.reducedMotion?0:(state.motionTime??state.time??0);
  const phase=state.reducedMotion?0:(state.flightPhase??time*.72),altitude=clamp(state.altitude??.5),steer=clamp(state.flightX??.5);
  const targetX=600+(steer-.5)*120+Math.sin(phase*.7)*165;
  const tallHat=clamp((state.hat??.5)-.5,0,.5)*2;
  const targetY=286+tallHat*16+(0.5-altitude)*36+Math.sin(phase*1.4)*34+Math.sin(phase*.7)*13;
  return {x:455+(targetX-455)*lift,y:476+(targetY-476)*lift,
    rotation:(-.08+Math.cos(phase*1.4)*.12)*lift,scale:.8-(.26+tallHat*.04)*lift,phase};
}
function broomPoint(point,state) {
  const t=broomTransform(state),cos=Math.cos(t.rotation),sin=Math.sin(t.rotation);
  return {x:t.x+(cos*point.x-sin*point.y)*t.scale,y:t.y+(sin*point.x+cos*point.y)*t.scale};
}
export function getWitchTargets(state = {}) {
  const time=state.time||0,lift=clamp(state.flightLift),energy=clamp(state.energy);
  let origin,scale,rotation;
  if(lift>.5) {
    const flight=broomTransform(state);origin=broomPoint({x:-53,y:-149},state);scale=flight.scale;rotation=flight.rotation-.1;
  } else { origin={x:439,y:254+Math.sin(time*1.9)*(1+energy*1.4)};scale=1;rotation=.025+Math.sin(time*.8)*.008; }
  const point=(x,y,r)=>({x:origin.x+(Math.cos(rotation)*x-Math.sin(rotation)*y)*scale,
    y:origin.y+(Math.sin(rotation)*x+Math.cos(rotation)*y)*scale,r:r*scale});
  const shape=hatShape(state),hx=-10,hy=-111*shape.stretch;
  return {nose:point(87+(clamp(state.nose??.5)-.5)*40,57,20),
    hat:point(Math.cos(shape.tilt)*hx-Math.sin(shape.tilt)*hy,Math.sin(shape.tilt)*hx+Math.cos(shape.tilt)*hy,66*Math.max(1,shape.stretch))};
}

// Each model has its own projected pose. Display and picking share this affine
// transform, including the clockwise reach and the mirrored ladle hand.
export function handTransform(state = {}, index = 0) {
  const wrist = state.handWrists?.[index] || state.handWrist || {x:590,y:590};
  const reach = index === 0 ? clamp(state.handReach) : 0;
  const lift=clamp(state.flightLift),flight=broomTransform(state);
  const baseScale=(index===0?.19:.23)*(1-lift)+flight.scale*.28*lift;
  const scale = baseScale+(1-baseScale)*reach;
  const rotation = index===0 ? flight.rotation*lift*(1-reach)+reach*55*Math.PI/180 : -.38+flight.rotation*lift;
  const mirror = index === 0 ? 1 : -1;
  const ladle=getWitchLadle(state);
  const flying=broomPoint(index===0?{x:32,y:59}:{x:91,y:85},state);
  const groundX=index===0?388:ladle.hx,groundY=index===0?450:ladle.hy;
  const wx = (groundX*(1-lift)+flying.x*lift)*(1-reach)+435*reach;
  const wy = (groundY*(1-lift)+flying.y*lift)*(1-reach)+635*reach;
  const a = Math.cos(rotation)*scale*mirror, b = Math.sin(rotation)*scale*mirror;
  const c = -Math.sin(rotation)*scale, d = Math.cos(rotation)*scale;
  return {scale,rotation,mirror,a,b,c,d,x:wx-a*wrist.x-c*wrist.y,y:wy-b*wrist.x-d*wrist.y,wrist:{x:wx,y:wy}};
}
export function transformHandPoint(point, state = {}, index = 0, inverse = false) {
  const t = handTransform(state,index);
  if (inverse) {
    const x=point.x-t.x, y=point.y-t.y, det=t.a*t.d-t.b*t.c;
    return {...point,x:(t.d*x-t.c*y)/det,y:(t.a*y-t.b*x)/det};
  }
  return {...point,x:t.a*point.x+t.c*point.y+t.x,y:t.b*point.x+t.d*point.y+t.y};
}
export function getFingerTips(state = {}, index = 0) {
  return (state.handsTips?.[index] || (index===0?state.handTips:[]) || []).map(p => transformHandPoint(p,state,index));
}
function drawHandModel(c,state,index) {
  const surface=state.handSurfaces?.[index] || (index===0?state.handSurface:null);
  if (!surface) return;
  const t=handTransform(state,index);
  const mist=state.reducedMotion?1:.88+.12*Math.sin((state.time||0)*.63+index*2.2);
  c.save(); c.globalAlpha*=mist;c.transform(t.a,t.b,t.c,t.d,t.x,t.y); c.drawImage(surface,0,0,1000,720); c.restore();
}
function reachingHand(c, state) {
  if (!state.handSurface) return;
  const t = handTransform(state), {x:wx,y:wy} = t.wrist;
  const reach = clamp(state.handReach), cuff = 12 + reach*39;
  const ux=Math.cos(t.rotation)*cuff,uy=Math.sin(t.rotation)*cuff;
  const lift=clamp(state.flightLift),flying=broomPoint({x:-8,y:19},state);
  const sx=365*(1-lift)+flying.x*lift,sy=410*(1-lift)+flying.y*lift;
  c.save();
  // The cuff rotates with the model so the stretched arm meets its actual wrist.
  const sleeve=c.createLinearGradient(sx,sy,wx,wy);
  sleeve.addColorStop(0,'#59305f');sleeve.addColorStop(.55,'#49375e');sleeve.addColorStop(1,'#275a65');
  path(c, `M${sx},${sy} Q${sx-25},${sy+59+reach*105} ${wx-ux},${wy-uy} Q${wx-10},${wy+26} ${wx+ux},${wy+uy} Q${sx+55},${sy-3+reach*28} ${sx+38},${sy-1} Z`, sleeve, INK, 3);
  curve(c,[sx+14,sy+12,sx-9,sy+73+reach*95,wx-30,wy+25,wx-14,wy+7],'#bc78ae',1.5);
  line(c,[[wx-ux,wy-uy],[wx+ux,wy+uy]],'#ddac87',2);
  drawHandModel(c,state,0);
  if (reach > .5) {
    const colors=['#ffc17e','#e5ef82','#75f0cb','#86c9ff','#ee9ee9'];
    for (const tip of getFingerTips(state)) {
      const level=clamp(state.fingerLevels?.[tip.index]);
      c.save(); c.globalAlpha *= reach;
      ellipse(c,tip.x,tip.y,17+level*13,17+level*13,null,colors[tip.index],state.selectedFinger===tip.index?2:1);
      if(level>.01) { glow(c,tip.x,tip.y,38+level*18,`${colors[tip.index]}55`); star(c,tip.x+23,tip.y-13,level*6,colors[tip.index]); }
      c.restore();
    }
  } else {
    c.save(); c.globalAlpha *= .45;
    const p=transformHandPoint({x:590,y:415},state);
    ellipse(c,p.x,p.y,29,37,null,LIME,1); c.restore();
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
    path(c, `M2,0 L18,${-28-flap} L31,${-43-flap} L52,${-16-flap} L41,${-17-flap*.6} L35,8 L28,1 L19,21 L13,7 L2,13 Z`, '#32223e', '#a67c99', 1.1);
    curve(c,[4,3,19,-14-flap*.3,33,-16-flap*.5,47,-13-flap],'#94809e',.75);
    line(c,[[5,4],[31,11]],'#99859e',.6);
    c.restore();
  }
  path(c,'M-6,-2 L-9,12 L0,25 L7,12 L6,-2 Z','#181b27','#86718b',1);
  path(c,'M-6,-2 L-10,-21 L-1,-10 L7,-19 L6,1 Z','#272130','#a190ac',1);
  line(c,[[-5,-4],[-1,-2]],'#e49d79',1.3);line(c,[[1,-2],[5,-4]],'#e49d79',1.3);
  path(c,'M-4,5 L-2,11 L0,6 L3,10 L4,4 Z','#d7ceac');
  c.restore();
}
function ghost(c, x, y, scale, time, index, active = false) {
  const bob = Math.sin(time * 1.4 + index * 2) * 8;
  c.save(); c.translate(x, y + bob); c.scale(scale,scale); c.rotate(Math.sin(time + index) * .07);
  glow(c,0,5,73,active ? '#b4d7cc33' : '#c1d9cf15');
  const silk = c.createLinearGradient(-26,-37,29,69);
  silk.addColorStop(0,'#bac6c8a9'); silk.addColorStop(.5,'#978db576'); silk.addColorStop(1,'#628d9d08');
  c.globalAlpha*=.72+.28*Math.sin(time*.38+index*1.7)**2;
  path(c, 'M-32,25 C-37,-13 -21,-52 -2,-48 C21,-51 33,-18 29,12 L40,44 L25,39 L43,83 L17,59 L13,91 L-2,67 L-13,96 L-17,57 L-42,78 L-30,45 L-48,48 Z', silk, '#c9d3c159', 1.2);
  curve(c,[-25,-11,-31,21,-19,36,-25,47],'#e1e5cf69',1.2);
  curve(c,[21,4,18,24,26,32,30,44],'#d1d9cc4d',1);
  path(c,'M-23,-17 Q-11,-26 -4,-9 L-8,4 L-19,2 Z M5,-10 Q17,-29 24,-18 L19,3 L9,6 Z','#101827d9');
  ellipse(c,1,24,8,18,'#151529d9','#c4b7d54a',.8,-.1);
  path(c,'M-3,5 L1,-3 L5,6 Z','#283044a8');
  for(const [dx,dy] of [[-17,5],[16,5],[-5,43],[8,44]])curve(c,[dx,dy,dx-7,dy+17,dx+7,dy+22,dx-4,dy+34],'#26233866',1.2);
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
  const transform=broomTransform(state);
  c.save(); c.globalAlpha *= lift; c.translate(transform.x,transform.y); c.rotate(transform.rotation); c.scale(transform.scale,transform.scale);
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
  // A crooked double helix wraps the broom itself, wide enough to read while
  // she is small in the sky. Bone, berry and verdigris twists pulse with flight.
  const coil=[],shadowCoil=[];
  for(let i=0;i<=72;i++) {
    const u=i/72,a=u*TAU*3.5,round=Math.sin(Math.PI*u);
    coil.push([-215+u*375+Math.sin(a)*19*round,126-u*25+Math.cos(a)*16*round]);
    shadowCoil.push([-215+u*375-Math.sin(a)*19*round,126-u*25-Math.cos(a)*16*round]);
  }
  line(c,shadowCoil,'#211c2b',10);line(c,shadowCoil,'#5e9f9b',6.7);
  line(c,coil,'#251c29',10);line(c,coil,'#c682a4',7);
  c.save();c.setLineDash([11,14]);c.lineDashOffset=-time*9;
  line(c,coil,'#e0c8a3',4);c.lineDashOffset=-time*9+12;line(c,shadowCoil,'#92e0c6',2.1);c.restore();
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
  if(!state.handSurfaces?.[1])smallHand(c,89,83,-.4,.64,.9);
  witchHead(c,state,-53,-149,1,-.1);
  c.restore();
  if(state.handSurfaces?.[1]) { c.save();c.globalAlpha*=lift;drawHandModel(c,state,1);c.restore(); }
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
  if(state.flightLift>.01) {
    c.save();c.globalAlpha=clamp(state.flightLift)*(.42+clamp(state.flightPulse)*.25);
    const points=[];
    for(let i=0;i<=44;i++) {
      const age=(44-i)*.12;
      const past={...state,motionTime:time-age,flightPhase:state.flightPhase===undefined?undefined:state.flightPhase-age*(1+clamp(state.speed??.4)*5)/1.4};
      const p=broomPoint({x:-235,y:130},past),twist=(44-i)*.47;
      points.push([p.x+Math.sin(twist)*14,p.y+Math.cos(twist)*21]);
    }
    line(c,points,'#a34383',7);c.setLineDash([9,13]);c.lineDashOffset=-time*21;line(c,points,'#8ee6cc',3);c.setLineDash([]);
    for(let i=8;i<points.length;i+=11) {
      const [x,y]=points[i];
      curve(c,[x-15,y+13,x-49,y-47,x+52,y-48,x+12,y+15],'#d0a4f1a9',1.7);
    }
    c.restore();
  }
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
  for(const spirit of WITCH_LAYOUT.spirits) {
    c.save();c.translate(spirit.x,spirit.y);c.globalAlpha=.58+.22*Math.sin(time*.5+spirit.x)**2;
    if(spirit.kind==='spark') {
      c.rotate(Math.sin(time*.21)*.15);glow(c,0,0,34,'#d59d982a');
      path(c,'M0,-29 L5,-6 L22,-13 L10,2 L27,15 L5,10 L-4,31 L-8,8 L-28,12 L-13,-1 L-23,-17 L-5,-7 Z',null,'#d6b98f',1.2);
      ellipse(c,0,0,5,5,'#a66c77','#e9c7ad',1);
    } else {
      path(c,'M0,-16 L-5,0 L-31,-12 L-19,8 L-31,15 L-6,13 L0,26 L5,13 L29,15 L17,7 L31,-12 L5,0 Z','#617c8e55','#8eabad',1);
      for(let i=0;i<3;i++)curve(c,[-39,12+i*7,-14,32+i*5,14,-14+i*4,42,6+i*8],'#b6b4c879',1.1);
      line(c,[[0,-16],[0,22]],'#d9c9aa',1.2);
    }
    c.restore();
  }
}

/** The same hover/drop coordinates are used for drawing, pickup and dragging. */
export function getWitchObjectPosition(object, state = {}) {
  const id=typeof object==='string'?object:object?.id;
  const home=WITCH_LAYOUT.objects.find(entry=>entry.id===id)||WITCH_LAYOUT.objects[0];
  const live=typeof object==='object'?object:state.objects?.find(entry=>entry.id===id)||home;
  const index=WITCH_LAYOUT.objects.indexOf(home),time=state.reducedMotion?0:(state.time||0);
  const x=Number.isFinite(live.x)?live.x:home.x,y=Number.isFinite(live.y)?live.y:home.y;
  if(live.dropped) {
    const age=Math.max(0,live.dropAge||0),fall=clamp(age/.65);
    return {...home,...live,x:x+(600-x)*fall,y:y+(544-y)*fall,alpha:1-clamp(age/.8),rotation:age*2.4,r:home.r};
  }
  return {...home,...live,x:x+(live.dragging?0:Math.sin(time*.49+index*2.3)*9),
    y:y+(live.dragging?0:Math.sin(time*.81+index*2.1)*12),
    alpha:live.dragging?1:.68+.3*Math.sin(time*.37+index)**2,
    rotation:live.dragging?0:Math.sin(time*.43+index)*.13,r:home.r};
}
function ingredientObjects(c,state) {
  const colors=['#79e0c8','#e8b075','#e698c8'];
  for(const [index,home] of WITCH_LAYOUT.objects.entries()) {
    const object=getWitchObjectPosition(state.objects?.find(entry=>entry.id===home.id)||home,state);
    if(object.dropped) {
      const age=Math.max(0,object.dropAge||0),envelope=Math.max(0,1-age/3.6);
      if(envelope>0) {
        c.save();c.globalAlpha=envelope;
        glow(c,600,511,155,`${colors[index]}33`);
        ellipse(c,600,520,47+age*25,12+age*7,null,`${colors[index]}ad`,2);
        for(let i=0;i<4;i++) {
          const a=age*2.4+i*TAU/4;
          curve(c,[600+Math.cos(a)*40,510,590+Math.cos(a)*80,465-age*16,620+Math.sin(a)*72,446-age*19,600+Math.cos(a+.7)*90,414-age*22],`${colors[index]}77`,1.2);
        }
        c.restore();
      }
    }
    if(object.alpha<=0)continue;
    c.save();c.translate(object.x,object.y);c.rotate(object.rotation);c.globalAlpha=object.alpha;
    // The objects appear through torn mist rather than enclosed cartoon badges.
    glow(c,0,8,55,`${colors[index]}19`);
    for(let i=0;i<3;i++)curve(c,[-43,15+i*6,-12,34+i*5,31,-12+i*4,44,7+i*8],`${colors[index]}30`,1.3+i*.7);
    if(home.id==='gesticules') {
      path(c,'M-17,24 L-21,2 L-30,-13 L-26,-22 L-14,-7 L-16,-40 L-10,-47 L-5,-10 L0,-49 L6,-52 L7,-10 L15,-41 L21,-44 L17,-5 L26,-28 L32,-29 L27,11 L15,31 Z','#397f79','#a1e6cb',1.3);
      path(c,'M-16,23 Q-10,6 15,2 L21,14 L14,31 Z','#8b5d9b99');
      line(c,[[-11,-43],[-13,-51]],'#e9b1a1',1.7);line(c,[[3,-48],[4,-57]],'#dce99b',1.7);line(c,[[19,-40],[24,-48]],'#a1c8f0',1.7);
    } else if(home.id==='marimba') {
      line(c,[[-34,23],[30,23]],'#514134',5);
      for(let i=0;i<5;i++) {
        c.save();c.translate(-27+i*13,0);c.rotate(-.05);
        const length=46-i*5;
        path(c,`M-5,${-length/2} L5,${-length/2} L5,${length/2} L-5,${length/2} Z`,['#bc744f','#d7a160','#af9466','#819c79','#778eac'][i],'#211f28',1.4);
        ellipse(c,0,-length/2+6,1.2,1.2,'#34262d');c.restore();
      }
      line(c,[[-19,35],[17,-28]],'#d6bea1',3);ellipse(c,20,-32,6,6,'#a8688e','#d9a9bd',1);
    } else {
      path(c,'M-22,-28 Q-6,-44 13,-26 L14,-10 L29,-1 L17,7 L26,14 L10,25 L7,39 L-13,34 L-15,12 Q-29,-4 -22,-28 Z','#8c6488','#d5abb5',1.4);
      path(c,'M-9,-5 Q6,-15 18,5 L3,12 Q-5,9 -3,27 L-11,27 Q-18,7 -9,-5 Z','#2a2338','#e6bb94',1.4);
      ellipse(c,5,-19,2.6,3.5,'#302238');
      for(let i=0;i<4;i++)curve(c,[27+i*4,-8,36+i*4,-1,36+i*4,6,27+i*4,12],`${colors[index]}aa`,1);
    }
    if(object.dragging) {c.font='11px monospace';c.textAlign='center';c.fillStyle='#eee3da';c.fillText(home.name,0,58);}
    c.restore();
  }
}
function hauntedMist(c,state) {
  const time=state.reducedMotion?0:(state.time||0);
  c.save();
  for(let i=0;i<4;i++) {
    const shift=Math.sin(time*.11+i*1.8)*80,y=605+i*22;
    c.globalAlpha=.035+.025*Math.sin(time*.23+i)**2;
    path(c,`M-80,${y+28} C${100+shift},${y-20} ${260+shift},${y+35} 410,${y-6} S760,${y-35} 1080,${y+8} L1080,${y+27} C800,${y-12} 624,${y+45} 370,${y+25} S93,${y+8} -80,${y+45} Z`,['#87bcbb','#b796bb','#87b4d7','#d2b68e'][i]);
  }
  c.restore();
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
  ingredientObjects(c,state);
  hauntedMist(c,state);
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
  if(state.handReach>.65) {
    let nearest=null,distance=minRadius;
    for(const tip of getFingerTips(state)) {
      const d=Math.hypot(x-tip.x,y-tip.y);
      if(d<distance) {nearest={type:'finger',index:tip.index};distance=d;}
    }
    if(nearest) return nearest;
    const t=handTransform(state), local=transformHandPoint({x,y},state,0,true);
    const hit=state.pickHand?.(local.x,local.y,minRadius/t.scale);
    if(hit) return hit;
  }
  for(const [index,home] of WITCH_LAYOUT.objects.entries()) {
    const object=getWitchObjectPosition(state.objects?.find(entry=>entry.id===home.id)||home,state);
    if(!object.dropped && Math.hypot(x-object.x,y-object.y)<Math.max(home.r,minRadius)) return {type:'object',id:home.id,kind:home.kind,index};
  }
  const ladle=getWitchLadle(state);
  if(Math.hypot(x-(ladle.hx-8),y-(ladle.hy-24))<Math.max(27,minRadius*.75))return {type:'spoon'};
  const targets=getWitchTargets(state);
  if(Math.hypot(x-targets.nose.x,y-targets.nose.y)<Math.max(targets.nose.r,minRadius*.65))return {type:'nose'};
  if(Math.hypot(x-targets.hat.x,y-targets.hat.y)<Math.max(targets.hat.r,minRadius*.7))return {type:'hat'};
  const moon=WITCH_LAYOUT.moon;
  if(Math.hypot(x-moon.x,y-moon.y)<Math.max(moon.r+12,minRadius)) return {type:'moon'};
  for(const m of WITCH_LAYOUT.mushrooms) if(Math.hypot(x-m.x,y-m.y)<Math.max(m.r,minRadius)) return {type:'mushrooms'};
  const handPoint=transformHandPoint({x:590,y:415},state);
  if(Math.hypot(x-handPoint.x,y-handPoint.y)<Math.max(38,minRadius)) return {type:'hand'};

  const pot=WITCH_LAYOUT.cauldron;
  if(((x-pot.x)/(pot.rx+30))**2+((y-pot.y)/(pot.ry+33))**2<1) return {type:'stir'};
  for(const type of ['ghost','bat']) {
    for(const [index,g] of WITCH_LAYOUT[type==='ghost'?'ghosts':'bats'].entries()) {
      if(Math.hypot(x-g.x,y-g.y)<Math.max(g.r,minRadius)) return {type,index};
    }
  }
  for(const spirit of WITCH_LAYOUT.spirits) if(Math.hypot(x-spirit.x,y-spirit.y)<Math.max(spirit.r,minRadius*.7))return {type:spirit.kind};
  if(state.scene==='flight') return {type:'flight'};
  if(Math.hypot(x-ladle.hx,y-ladle.hy)<Math.max(35,minRadius*.8)) return {type:'spoon'};
  return null;
}
