// Frontal articulatory illustration, not a physical face or a lip-reading model.
// It follows the same resolved phones as the engines, including digraphs/readback.
const clamp = (value, low, high) => Math.min(high, Math.max(low, Number(value) || 0));
export const REST_MOUTH = Object.freeze({ open: 0.025, width: 1, round: 0, tongue: 0, teeth: 0 });
const POSES = Object.freeze({
  a: [0.72, 1.06, 0.05], e: [0.42, 1.16, 0], i: [0.3, 1.13, 0],
  iy: [0.22, 1.22, 0], o: [0.85, 0.95, 0.2], u: [0.55, 1, 0.12],
  ao: [0.62, 0.9, 0.7], uw: [0.3, 0.86, 1], w: [0.21, 0.85, 1],
  p: [0.015, 1, 0.12], b: [0.015, 1, 0.12], m: [0.015, 1, 0.06],
  f: [0.12, 1.1, 0, 0, 1], v: [0.12, 1.1, 0, 0, 1],
  th: [0.22, 1.06, 0, 0.9, 0.5], dh: [0.22, 1.06, 0, 0.9, 0.5],
  l: [0.36, 1.08, 0, 0.8], t: [0.27, 1.09, 0, 0.6],
  d: [0.27, 1.09, 0, 0.6], n: [0.27, 1.09, 0, 0.6],
  s: [0.14, 1.15, 0, 0.15, 0.7], z: [0.14, 1.15, 0, 0.15, 0.7],
  sh: [0.25, 0.96, 0.5], c: [0.3, 0.98, 0.4], j: [0.3, 0.98, 0.4],
  r: [0.29, 0.97, 0.4, 0.3], y: [0.25, 1.18, 0, 0.3],
  k: [0.44, 1.03, 0, 0.18], g: [0.44, 1.03, 0, 0.18],
  ng: [0.34, 1.02, 0, 0.2], q: [0.44, 1.03, 0, 0.18],
  x: [0.2, 1.12, 0, 0.15, 0.5], h: [0.6, 1.04, 0.05],
});

export function spellingMouthPose(event) {
  if (!event) return { ...REST_MOUTH };
  const phone = String(event.articulation || event.performance?.phoneme || '').toLowerCase();
  const [open, width, round, tongue = 0, teeth = 0] = POSES[phone]
    ?? [clamp(event.performance?.articulationAperture, 0.08, 0.8), 1, 0];
  return { open, width, round, tongue, teeth };
}

export function blendMouthPose(first, second, amount) {
  const t = clamp(amount, 0, 1);
  return Object.fromEntries(Object.keys(REST_MOUTH).map(key =>
    [key, first[key] + (second[key] - first[key]) * t]));
}

export function spellingMouthPaths(pose = REST_MOUTH) {
  const open = clamp(pose.open, 0.015, 1);
  const round = clamp(pose.round, 0, 1);
  const width = (300 - round * 100) * clamp(pose.width, 0.65, 1.3);
  const height = 8 + open * 155;
  const point = (x, y) => `${(500 + x).toFixed(2)},${(245 + y).toFixed(2)}`;
  const path = (points, closed = false) => points.map(([x,y], i) => `${i ? 'L' : 'M'}${point(x,y)}`).join('') + (closed ? 'Z' : '');
  const lip = (angle, ring) => {
    const x = Math.cos(angle), y = Math.sin(angle);
    const bulge = Math.sin(ring * Math.PI) * 0.12;
    const cupid = y < 0 ? 1 - 0.14 * Math.exp(-x*x*50) + 0.07 * Math.exp(-(((Math.abs(x)-0.23)*9)**2)) : 1;
    return [x * (width + ring * 58) * (1 + bulge), y * (height + ring * 57) * cupid * (1 + bulge)];
  };
  const angles = Array.from({length:65}, (_, i) => i / 64 * Math.PI * 2);
  const rings = Array.from({length:8}, (_, i) => i / 7);
  const outline = path(angles.map(angle => lip(angle, 0)), true);
  let lips = rings.map(ring => path(angles.map(angle => lip(angle, ring)), true)).join('');
  for (let i=0; i<64; i+=2) lips += path(rings.map(ring => lip(angles[i], ring)));
  let cavity = '';
  for (let depth=1; depth<=5; depth++) {
    const scale = 1 - depth * .12;
    cavity += path(angles.map(angle => [Math.cos(angle)*width*scale, Math.sin(angle)*height*scale-depth*5]), true);
  }
  let teeth = '';
  const toothWidth = width * 1.64 / 12;
  for (const side of [-1,1]) for(let i=0;i<12;i++) {
    const x = (i-6) * toothWidth;
    const y = side * (height * Math.sqrt(Math.max(0, 1-(x/width)**2)) - 4);
    const length = 19 + clamp(pose.teeth,0,1)*13;
    teeth += path([[x,y],[x+toothWidth-3,y],[x+toothWidth-4,y-side*length],[x+2,y-side*length]], true);
  }
  let tongue = '';
  const tongueTop = height*.75 - clamp(pose.tongue,0,1)*(height+27);
  for(let row=0;row<6;row++) {
    const y = tongueTop + row * (height-tongueTop)/5;
    const w = width * (.34 + row*.065);
    tongue += path(Array.from({length:21}, (_,i) => {
      const x = (i/10-1)*w;
      return [x, y+12*(x/w)**2];
    }));
  }
  for(let column=-5;column<=5;column++) tongue += path(Array.from({length:6}, (_,row) => {
    const y=tongueTop+row*(height-tongueTop)/5;
    return [column/5*width*(.34+row*.065),y+12*(column/5)**2];
  }));
  return { outline, lips, cavity, teeth, tongue };
}
