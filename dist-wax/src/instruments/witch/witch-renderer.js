import { drawWitchCat, hitTestWitchCat } from './witch-cat.js';
import { WITCH_SHELF, WITCH_VOICES } from './witch-model.js';
// Deformable Canvas scene with miniature instrument cutouts. Gesture geometry
// and drawing use this same viewbox.
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
  ghosts: Object.freeze([
    Object.freeze({id:'creaturazoid',x:286,y:305,r:45,size:115,color:'#a7ccc7'}),
    Object.freeze({id:'monstroid',x:798,y:370,r:44,size:116,color:'#a5bcd3'}),
    Object.freeze({id:'hiccup',x:620,y:180,r:43,size:102,color:'#c0b2ce'}),
  ]),
  bats: Object.freeze([{ x: 705, y: 287, r: 34 }, { x: 285, y: 145, r: 30 }, { x: 955, y: 260, r: 28 }]),
  spirits:Object.freeze([Object.freeze({kind:'spark',x:590,y:66,r:25}),Object.freeze({kind:'gust',x:795,y:425,r:28})]),
  shelves:Object.freeze([{x:35,y:150,w:235,h:485,rows:[232,334,436,538,616]},{x:818,y:344,w:135,h:307,rows:[426,529,632]}]),
  objects: Object.freeze(WITCH_SHELF.map((entry,index)=>Object.freeze({...entry,
    x:entry.id==='puggler'?80:index<12?[80,154,228][index%3]:[850,916][(index-12)%2],
    y:entry.id==='puggler'?580:index<12?[196,298,400,502][Math.floor(index/3)]:[390,493,596][Math.floor((index-12)/2)],
    r:29,color:['#a1def0','#dda5c2','#d9ab58','#a7cc69','#af9ed8','#c99b65'][index%6],
  }))),
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

// Hair is a small bundle of fixed-budget strands in head coordinates. The
// pull vector adds exactly the same displacement to every free tip; roots stay
// tucked beneath the brim while the playing clock drives the frayed curls.
function witchHairLocal(state = {}) {
  const amount=clamp(state.hair),lift=clamp(state.flightLift);
  const time=state.reducedMotion?0:(state.handTime??state.motionTime??0);
  const phase=state.reducedMotion?0:(state.flightPhase??time*.72);
  const pull={x:-85,y:48},pullDistance=Math.hypot(pull.x,pull.y);
  const strands=[];
  for(let i=0;i<15;i++) {
    const root={x:-73+i*3.3,y:-24+Math.sin(i*.7)*4},points=[];
    for(let j=0;j<=20;j++) {
      const u=j/20,free=u*u,envelope=Math.sin(u*Math.PI);
      const snake=Math.sin(u*(6+amount*5+lift*7)-time*(1.5+lift*2.4)+i*.48);
      const fray=Math.sin(u*29-time*2.7+i*1.9)*amount*5;
      const curl=envelope*(snake*(3+amount*10+lift*25)+fray);
      const sweep=lift*(110+Math.sin(phase*1.4)*23)*u**1.5;
      points.push({x:root.x-13*free+pull.x*amount*free-sweep+curl,
        y:root.y+(168+(i%3)*9)*u+pull.y*amount*free-lift*(50+Math.cos(phase*1.4)*21)*free+curl*.63});
    }
    strands.push({points,width:i%3===0?2.6:3.8,index:i});
  }
  const middle=strands[7],root=middle.points[0],tip=middle.points.at(-1);
  // These are actual visible locks, excluding the section hidden by her face.
  const targets=[];
  for(const index of [1,4,7])for(const sample of [9,13,17,20])
    targets.push({...strands[index].points[sample],r:11});
  return {root,tip,axis:{x:pull.x/pullDistance,y:pull.y/pullDistance},pullDistance,strands,targets};
}
function headTransform(state = {}, flying = clamp(state.flightLift)>.5) {
  if(flying) {
    const flight=broomTransform(state);
    return {...broomPoint({x:-53,y:-149},state),scale:flight.scale,rotation:flight.rotation-.1};
  }
  const time=state.reducedMotion?0:(state.handTime??state.motionTime??state.time??0),energy=clamp(state.energy);
  return {x:439,y:254+Math.sin(time*1.9)*(1+energy*1.4),scale:1,rotation:.025+Math.sin(time*.8)*.008};
}
function headPoint(point,transform) {
  const cos=Math.cos(transform.rotation),sin=Math.sin(transform.rotation);
  return {...point,x:transform.x+(cos*point.x-sin*point.y)*transform.scale,
    y:transform.y+(sin*point.x+cos*point.y)*transform.scale};
}
/** Render/pick geometry before mushroom warping, using the visible head's
 * transform. The axis and full pull range let pointer motion stay head-relative. */
export function getWitchHair(state = {}) {
  const local=witchHairLocal(state),transform=headTransform(state);
  const cos=Math.cos(transform.rotation),sin=Math.sin(transform.rotation);
  return {root:headPoint(local.root,transform),tip:headPoint(local.tip,transform),
    axis:{x:cos*local.axis.x-sin*local.axis.y,y:sin*local.axis.x+cos*local.axis.y},
    pullDistance:local.pullDistance*transform.scale,scale:transform.scale,
    targets:local.targets.map(point=>({...headPoint(point,transform),r:point.r*transform.scale})),
    strands:local.strands.map(strand=>({...strand,width:strand.width*transform.scale,
      points:strand.points.map(point=>headPoint(point,transform))}))};
}
function drawWitchHair(c,state) {
  const {strands}=witchHairLocal(state),amount=clamp(state.hair),lift=clamp(state.flightLift);
  const colors=['#bcc5ac','#81758e','#6c7286','#92b9ae','#bb9cb9'];
  for(const strand of strands) {
    const points=strand.points.map(point=>[point.x,point.y]);
    line(c,points,INK,strand.width+3.5);
    line(c,points,colors[strand.index%colors.length],strand.width);
    // Fine split ends become tangled and electrically wiry when pulled.
    if(amount>.01||lift>.01) {
      const end=strand.points[17],tip=strand.points.at(-1),curl=(amount*12+lift*18)*(strand.index%2?1:-1);
      curve(c,[end.x,end.y,tip.x+curl,tip.y-18,tip.x-curl*1.5,tip.y+16,tip.x-8-amount*8,tip.y+7],colors[(strand.index+2)%colors.length],.8+amount*.5);
    }
  }
}

function witchHead(c, state, x, y, scale = 1, tilt = 0) {
  const vocal = true;
  const mouth = vocal ? clamp(state.mouth) : 0;
  const nose=(clamp(state.nose??.5)-.5)*40;
  c.save(); c.translate(x, y); c.rotate(tilt); c.scale(scale, scale);
  drawWitchHair(c,state);
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
  const radius=28+clamp(state.radius)*109,lift=clamp(state.flightLift);
  const lx=600+Math.cos(angle)*radius,ly=520+Math.sin(angle)*radius*.27;
  // The bowl always stirs the same potion. Her grip follows her wrist into
  // flight, with a small stir-driven motion rather than abandoning the spoon.
  const ground={x:632+Math.cos(angle)*radius*.26,y:ly-(104+140*clamp(state.spoonHeight??.5))};
  const flying=broomPoint({x:112+Math.cos(angle)*radius*.08,y:75+(0.5-clamp(state.spoonHeight??.5))*35+Math.sin(angle)*radius*.045},state);
  const gx=ground.x*(1-lift)+flying.x*lift,gy=ground.y*(1-lift)+flying.y*lift;
  const length=Math.max(1,Math.hypot(gx-lx,gy-ly));
  return {lx,ly,gx,gy,hx:gx+8,hy:gy+24,tx:gx+(gx-lx)/length*22,ty:gy+(gy-ly)/length*22};
}

function ladleArm(c,state) {
  const t=handTransform(state,1),{x:wx,y:wy}=t.wrist,lift=clamp(state.flightLift);
  const shoulder=broomPoint({x:-2,y:2},state);
  const sx=437*(1-lift)+shoulder.x*lift,sy=408*(1-lift)+shoulder.y*lift;
  const growth=1+.3*lift,width=19*(1-lift)+9*1.3*lift,cuff=42*t.scale;
  const ux=Math.cos(t.rotation)*cuff,uy=Math.sin(t.rotation)*cuff;
  const bend=34*(1-lift)+12*1.3*lift,mx=(sx+wx)/2,my=(sy+wy)/2+bend;
  // This sleeve paints before either face. The palm and utensil can then sit
  // above the rim while the arm passes naturally behind her jaw and hair.
  path(c,`M${sx-width},${sy} Q${mx-width},${my+22*growth} ${wx-ux},${wy-uy} L${wx+ux},${wy+uy} Q${mx+width},${my-18*growth} ${sx+width},${sy-13*growth} Z`,'#48324b',INK,3);
  curve(c,[sx,sy,mx,my+14*growth,wx-ux*.5,wy-uy*.5,wx,wy],'#79566f',1.4);
  line(c,[[wx-ux,wy-uy],[wx+ux,wy+uy]],'#b29c88',1.5);
}

function brewScene(c, state) {
  const time = state.time || 0, energy = clamp(state.energy);
  glow(c, 556, 418, 200, '#bbdb8b12');
  c.save(); c.globalAlpha *= 1 - clamp(state.flightLift);
  robe(c, time, energy);
  c.restore();
  ladleArm(c,state);
  c.save();c.globalAlpha*=1-clamp(state.flightLift);
  const head=headTransform(state,false);
  witchHead(c,state,head.x,head.y,head.scale,head.rotation);
  // Far hand is poised over the rising vapor.
  path(c, 'M391,411 Q358,407 341,438 L381,483 Q411,462 421,443 Z', '#4b3650', INK, 3);
  line(c, [[365,436],[386,464]], '#80637a', 1.1);
  if (!state.handSurface) smallHand(c, 388, 450, .68, .77, .45 + Math.sin(time * 1.7) * energy * .12);
  c.restore();
  smoke(c, state);
  cauldron(c, state);
  const {lx,ly,hx,hy,gx,gy,tx,ty}=getWitchLadle(state);
  // A continuous shaft runs through the model's projected palm.
  line(c, [[lx + 2,ly],[tx,ty]], '#1e2524', 11);
  line(c, [[lx + 2,ly],[tx,ty]], '#9a8664', 6.5);
  line(c, [[lx,ly - 2],[tx-2,ty-2]], '#d8bf87', 1.4);
  ellipse(c, lx, ly + 2, 18, 7, '#385d50', '#c4d995', 1.4, -.1);
  ellipse(c, lx - 3, ly, 12, 3.5, '#b6d797');
  for(let i=0;i<WITCH_VOICES.length;i++) {
    const py=ly-80-i*140/Math.max(1,WITCH_VOICES.length-1);
    const active=Math.min(WITCH_VOICES.length-1,Math.floor(clamp(state.spoonHeight??.5)*WITCH_VOICES.length))===i;
    ellipse(c,hx+22,py,active?3.4:1.6,active?3.4:1.6,['#cfb8ee','#78ccdc','#addc94','#dfaa7d','#e6a4c9','#f2bf83','#bb9de7'][i%7]);
    if(active)glow(c,hx+22,py,12,'#d7ddae27');
  }
  if (state.handSurfaces?.[1]) drawHandModel(c,state,1);
  else {
    const t=handTransform(state,1);
    smallHand(c,t.wrist.x,t.wrist.y,t.rotation,t.scale*2.6,.9);
  }
  // The short exposed grip crosses the palm; fingers stay free to cast spells.
  const gripLength=Math.max(1,Math.hypot(tx-gx,ty-gy));
  const dx=(tx-gx)/gripLength,dy=(ty-gy)/gripLength;
  line(c,[[gx-dx*7,gy-dy*7],[tx,ty]],'#513e36',7);
  line(c,[[gx-dx*7,gy-dy*7],[tx,ty]],'#b3996c',4.5);
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
  // A little apothecary bottle sits beside the wooden instrument shelves.
  path(c, 'M222,589 L234,589 L234,608 Q249,612 247,641 L211,641 Q209,611 222,608 Z', '#394c45', '#101b20', 2);
  ellipse(c,229,620,15,5,'#8eaa7670'); line(c,[[224,596],[224,611]],'#b6c39b80',2);
  path(c, 'M218,583 L238,583 L238,592 L218,592 Z', '#8c7661', '#28282b', 1.3);
  ellipse(c,229,628,7,9,'#b0b59790'); line(c,[[227,624],[232,632]],'#485c4c',1);
  if (clamp(state.glass) > .01) {
    for (let i = 0; i < 4; i++) star(c, 550 + i * 32, 488 + Math.sin(time * 2 + i) * 9, 3 + clamp(state.glass) * 3, '#cdf6f1', .6);
  }
}

/** The broom follows a continuous, untuned rollercoaster path above the pot.
 * Pointer position steers its centre; altitude changes the height of the coils. */
export function broomTransform(state = {}) {
  const lift=clamp(state.flightLift),time=state.reducedMotion?0:(state.motionTime??state.time??0);
  const phase=state.reducedMotion?0:(state.flightPhase??time*.72),altitude=clamp(state.altitude??.5),steer=clamp(state.flightX??.5);
  const targetX=590+(steer-.5)*120+Math.sin(phase*.7)*165;
  const tallHat=clamp((state.hat??.5)-.5,0,.5)*2;
  // The complete flying rig grows 30%; its unchanged rollercoaster curve sits
  // lower so the tallest hat stays inside the frame at the uppermost crest.
  // A small left offset also leaves room for the enlarged, mushroom-warped tip.
  const targetY=350+tallHat*16+(0.5-altitude)*36+Math.sin(phase*1.4)*34+Math.sin(phase*.7)*13;
  return {x:455+(targetX-455)*lift,y:476+(targetY-476)*lift,
    rotation:(-.08+Math.cos(phase*1.4)*.12)*lift,scale:.8+((.54-tallHat*.04)*1.3-.8)*lift,phase};
}
function broomPoint(point,state) {
  const t=broomTransform(state),cos=Math.cos(t.rotation),sin=Math.sin(t.rotation);
  return {x:t.x+(cos*point.x-sin*point.y)*t.scale,y:t.y+(sin*point.x+cos*point.y)*t.scale};
}
/** One continuous string trails the broom; the same points receive pulls. */
export function getWitchTrail(state = {}) {
  const time=state.motionTime??state.time??0,pull=clamp(state.trailPull??.5),twist=clamp(state.trailTwist??.5);
  const points=[];
  for(let i=0;i<=64;i++) {
    const tail=1-i/64,age=tail*6.4;
    const past={...state,motionTime:time-age,flightPhase:state.flightPhase===undefined?undefined:state.flightPhase-age*(1+clamp(state.speed??.4)*5)/1.4};
    const p=broomPoint({x:-265,y:126},past),wave=tail*(7+twist*23);
    points.push({x:p.x+Math.sin(wave)*tail*(12+pull*31),y:p.y+Math.sin(wave*.83)*tail*(8+pull*57)});
  }
  return points;
}

export function getWitchTargets(state = {}) {
  const transform=headTransform(state);
  const point=(x,y,r)=>({...headPoint({x,y},transform),r:r*transform.scale});
  const shape=hatShape(state),hx=-10,hy=-111*shape.stretch;
  return {nose:point(87+(clamp(state.nose??.5)-.5)*40,57,20),
    hat:point(Math.cos(shape.tilt)*hx-Math.sin(shape.tilt)*hy,Math.sin(shape.tilt)*hx+Math.cos(shape.tilt)*hy,66*Math.max(1,shape.stretch)),
    tone:{x:695,y:235-clamp(state.tone??.5)*130,r:32},
    fabric:{x:830+clamp(state.fabricX??.5)*70,y:320-clamp(state.fabricY??.5)*60,r:32},
    broom:{...parkedBroomPoint({x:60,y:108}),r:32},
    trail:{...getWitchTrail(state)[22],r:28}};
}

// Each model has its own projected pose. Display and picking share this affine
// transform, including the clockwise reach and the mirrored ladle hand.
export function handTransform(state = {}, index = 0) {
  const wrist = state.handWrists?.[index] || state.handWrist || {x:590,y:590};
  const palm=state.handPalms?.[index]||{x:wrist.x,y:wrist.y-80};
  const reach = index === 0 ? clamp(state.handReach) : 0;
  const lift=clamp(state.flightLift),flight=broomTransform(state);
  const groundScale=index===0?.19+.81*reach:.23*1.25*1.25;
  const scale=groundScale*(1-lift)+flight.scale*(index===0?.48:.28*1.25*1.25)*lift;
  const rotation=index===0?reach*55*Math.PI/180+flight.rotation*lift:-.38+Math.PI/2+flight.rotation*lift;
  const mirror = index === 0 ? 1 : -1;
  const ladle=getWitchLadle(state),flying=broomPoint({x:38,y:165},state);
  const anchor=index===1?palm:wrist;
  const targetX=index===1?ladle.gx:((388+(435-388)*reach)*(1-lift)+flying.x*lift);
  const targetY=index===1?ladle.gy:((450+(635-450)*reach)*(1-lift)+flying.y*lift);
  const a = Math.cos(rotation)*scale*mirror, b = Math.sin(rotation)*scale*mirror;
  const c = -Math.sin(rotation)*scale, d = Math.cos(rotation)*scale;
  const x=targetX-a*anchor.x-c*anchor.y,y=targetY-b*anchor.x-d*anchor.y;
  return {scale,rotation,mirror,a,b,c,d,x,y,
    wrist:{x:a*wrist.x+c*wrist.y+x,y:b*wrist.x+d*wrist.y+y},
    palm:{x:a*palm.x+c*palm.y+x,y:b*palm.x+d*palm.y+y}};
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
  const lift=clamp(state.flightLift),growth=1+.3*lift,reach=clamp(state.handReach)*(1-lift),cuff=(12+clamp(state.handReach)*39)*(1-lift*.72)*growth;
  const ux=Math.cos(t.rotation)*cuff,uy=Math.sin(t.rotation)*cuff;
  const flying=broomPoint({x:-8,y:19},state);
  const sx=365*(1-lift)+flying.x*lift,sy=410*(1-lift)+flying.y*lift;
  c.save();
  // The cuff rotates with the model so the stretched arm meets its actual wrist.
  const sleeve=c.createLinearGradient(sx,sy,wx,wy);
  sleeve.addColorStop(0,'#59305f');sleeve.addColorStop(.55,'#49375e');sleeve.addColorStop(1,'#275a65');
  path(c, `M${sx},${sy} Q${sx-25*growth},${sy+59*(1-lift)+18*1.3*lift+reach*105} ${wx-ux},${wy-uy} Q${wx-10*growth},${wy+26*growth} ${wx+ux},${wy+uy} Q${sx+55*(1-lift)+16*1.3*lift},${sy-3*growth+reach*28} ${sx+38*(1-lift)+14*1.3*lift},${sy-growth} Z`, sleeve, INK, 3);
  curve(c,[sx+14*growth,sy+12*growth,sx-9*growth,sy+73*growth+reach*95,wx-30*growth,wy+25*growth,wx-14*growth,wy+7*growth],'#bc78ae',1.5);
  line(c,[[wx-ux,wy-uy],[wx+ux,wy+uy]],'#ddac87',2);
  drawHandModel(c,state,0);
  if (clamp(state.handReach) > .5) {
    const cue=(1-lift*.7)*growth;
    const colors=['#ffc17e','#e5ef82','#75f0cb','#86c9ff','#ee9ee9'];
    for (const tip of getFingerTips(state)) {
      const level=clamp(state.fingerLevels?.[tip.index]);
      c.save(); c.globalAlpha *= .7+reach*.3;
      ellipse(c,tip.x,tip.y,(17+level*13)*cue,(17+level*13)*cue,null,colors[tip.index],state.selectedFinger===tip.index?2:1);
      if(level>.01) { glow(c,tip.x,tip.y,(38+level*18)*cue,`${colors[tip.index]}55`); star(c,tip.x+23*cue,tip.y-13*cue,level*6*cue,colors[tip.index]); }
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
/** Background performers share audio-clock phase, positions and picking. */
export function getWitchGhostPosition(ghost, state = {}) {
  const id=typeof ghost==='string'?ghost:ghost?.id;
  const index=typeof ghost==='number'?Math.round(clamp(ghost,0,2)):
    Math.max(0,WITCH_LAYOUT.ghosts.findIndex(entry=>entry.id===id));
  const home=WITCH_LAYOUT.ghosts[index];
  const phase=state.reducedMotion?0:(Number.isFinite(state.ghostPhase)?state.ghostPhase:0);
  const presence=clamp(state.ghostPresence?.[index]??.35),pulse=clamp(state.ghostPulses?.[index]);
  // A faint remnant remains reachable between phrases. Pulses breathe within
  // the silhouette; neither picking nor playing brings a ghost to the front.
  return {...home,index,x:home.x+Math.sin(phase*.17+index*2.1)*12,
    y:home.y+Math.sin(phase*.23+index*1.7)*9,
    presence,pulse,phase,alpha:.025+presence*(.17+pulse*.025),
    rotation:Math.sin(phase*.13+index)*.055,scale:1};
}

const ghostSources=Object.freeze({
  creaturazoid:new URL('../../../assets/instruments/creaturazoid.webp',import.meta.url).href,
  monstroid:new URL('../../../assets/instruments/colony-syrinx.webp',import.meta.url).href,
  hiccup:new URL('../../../assets/instruments/hiccup-head.webp',import.meta.url).href,
});
const ghostImages=new WeakMap();
function removePortraitBackdrop(pixels) {
  const {data:rgba,width,height}=pixels;
  // Remove only near-black pixels connected to the border. Dark eyes and
  // other enclosed anatomy stay intact; already transparent icons are safe.
  const seen=new Uint8Array(width*height),queue=new Uint32Array(width*height);
  let start=0,end=0;
  const add=index=>{
    if(seen[index])return;seen[index]=1;
    const p=index*4;
    if(Math.max(rgba[p],rgba[p+1],rgba[p+2])<=36||rgba[p+3]===0)queue[end++]=index;
  };
  for(let x=0;x<width;x++) {add(x);add((height-1)*width+x);}
  for(let y=0;y<height;y++) {add(y*width);add(y*width+width-1);}
  while(start<end) {
    const index=queue[start++],p=index*4,x=index%width,y=Math.floor(index/width);
    const edge=clamp((Math.max(rgba[p],rgba[p+1],rgba[p+2])-3)/33);
    rgba[p+3]*=edge*edge*(3-2*edge);
    if(x>0)add(index-1);if(x<width-1)add(index+1);
    if(y>0)add(index-width);if(y<height-1)add(index+width);
  }
}
function ghostPortrait(c,ghost) {
  const doc=c.canvas?.ownerDocument;
  if(!doc)return null;
  let portraits=ghostImages.get(doc);
  if(!portraits) {portraits=new Map();ghostImages.set(doc,portraits);}
  let portrait=portraits.get(ghost.id);
  if(!portrait) {
    const image=doc.createElement('img');image.decoding='async';image.src=ghostSources[ghost.id];
    portrait={image,surface:null};portraits.set(ghost.id,portrait);
  }
  if(!portrait.image.complete||!portrait.image.naturalWidth)return null;
  if(!portrait.surface) {
    // Three small, cached spectral portraits: retain each actual instrument's
    // anatomy and internal detail without three live renderers or frame filters.
    const surface=doc.createElement('canvas');surface.width=surface.height=160;
    const ink=surface.getContext('2d');
    ink.drawImage(portrait.image,0,0,160,160);
    const pixels=ink.getImageData(0,0,160,160),rgba=pixels.data;
    if(ghost.id!=='hiccup')removePortraitBackdrop(pixels);
    const tint=[1,3,5].map(offset=>parseInt(ghost.color.slice(offset,offset+2),16));
    for(let p=0;p<rgba.length;p+=4) {
      const gray=Math.min(255,(rgba[p]*.2126+rgba[p+1]*.7152+rgba[p+2]*.0722)*1.36+25.5);
      for(let channel=0;channel<3;channel++)rgba[p+channel]=gray*.6+tint[channel]*.4;
      const y=Math.floor(p/4/160)/159;
      rgba[p+3]*=1-clamp((y-.52)/.48)*.93;
    }
    ink.putImageData(pixels,0,0);
    portrait.surface=surface;
  }
  return portrait.surface;
}
function backgroundGhosts(c,state) {
  for(let index=0;index<WITCH_LAYOUT.ghosts.length;index++) {
    const ghost=getWitchGhostPosition(index,state),portrait=ghostPortrait(c,ghost);
    c.save();c.translate(ghost.x,ghost.y);c.rotate(ghost.rotation);
    c.globalAlpha*=ghost.alpha;
    if(portrait) {
      const height=ghost.size*(1+ghost.pulse*.012);
      c.drawImage(portrait,-ghost.size/2,-height/2,ghost.size,height);
    }
    // Low wisps preserve the distant depth and a small beat trace, even while
    // a portrait loads. No face or sheet-mask is substituted for a character.
    for(let i=0;i<3;i++) {
      const side=(i-1)*18,drift=Math.sin(ghost.phase*.17+i+index)*8;
      curve(c,[side,ghost.size*.24,side-18+drift,ghost.size*.48,side+12,ghost.size*.56,side-9+drift,ghost.size*.7],ghost.color,.7+ghost.pulse*.8);
    }
    c.restore();
  }
}

function parkedBroomPoint(point) {
  const angle=-.23,scale=.48;
  return {x:190+(Math.cos(angle)*point.x-Math.sin(angle)*point.y)*scale,
    y:540+(Math.sin(angle)*point.x+Math.cos(angle)*point.y)*scale};
}
function parkedBroom(c,state) {
  const alpha=1-clamp(state.flightLift);
  if(alpha<=0)return;
  c.save();c.globalAlpha*=alpha;c.translate(190,540);c.rotate(-.23);c.scale(.48,.48);
  broomShape(c,state);c.restore();
}
function broomShape(c,state) {
  const time=state.motionTime??state.time??0,pulse=clamp(state.flightPulse);
  const spark=state.event?.kind==='spark'?clamp(1-(state.event.age||0)/1.2):0;
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
  line(c,coil,'#e0c8a3',1.3);line(c,shadowCoil,'#92e0c6',1);
  if (pulse > .01) {
    c.save(); c.globalAlpha = pulse;
    curve(c,[-219,127,-110,109,54,133,161,94],'#e7ebbb',1.5+pulse*1.5);
    c.restore();
  }
}

function broomWitch(c, state) {
  const time = state.motionTime ?? state.time ?? 0;
  const pulse = clamp(state.flightPulse);
  const spark = state.event?.kind === 'spark' ? clamp(1-(state.event.age || 0)/1.2) : 0;
  const lift = clamp(state.flightLift ?? 1);
  const transform=broomTransform(state);
  c.save(); c.globalAlpha *= lift; c.translate(transform.x,transform.y); c.rotate(transform.rotation); c.scale(transform.scale,transform.scale);
  broomShape(c,state);
  path(c, 'M-67,-32 Q-103,-8 -102,45 Q-151,74 -181,85 L-156,111 Q-122,98 -117,119 Q-79,96 -66,111 Q-14,94 25,109 Q48,96 29,76 L-6,47 L-3,-5 Z', '#3b2b47', INK, 3);
  path(c, 'M-87,14 Q-107,77 -159,88 L-143,97 Q-120,80 -109,96 Q-68,75 -54,95 L-30,65 Z', '#58405b');
  curve(c,[-67,5,-40,50,-69,75,-81,90],'#80637b',1.3);
  path(c, 'M-15,85 Q28,99 19,139 L45,178 Q34,191 15,181 L-9,143 Q-24,126 -40,105 Z', '#34303d', INK, 2.5);
  path(c, 'M14,168 Q34,176 42,171 Q54,196 75,181 Q74,204 45,202 L20,187 Z', '#22232e', INK, 2.3);
  line(c,[[28,179],[38,183],[31,190]],'#b89e7f',1.6);
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
  if(state.flightLift>.01) {
    const points=getWitchTrail(state).map(point=>[point.x,point.y]);
    c.save();c.globalAlpha=clamp(state.flightLift)*(.46+clamp(state.flightPulse)*.18);
    line(c,points,'#2b213b',9);line(c,points,'#b56a9f',5.2);line(c,points,'#97ddc2',1.7);
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

/** Shelf and automatic drop positions are shared by drawing and picking. */
export function getWitchObjectPosition(object, state = {}) {
  const id=typeof object==='string'?object:object?.id;
  const home=WITCH_LAYOUT.objects.find(entry=>entry.id===id)||WITCH_LAYOUT.objects[0];
  const live=typeof object==='object'?object:state.objects?.find(entry=>entry.id===id)||home;
  const x=Number.isFinite(live.x)?live.x:home.x,y=Number.isFinite(live.y)?live.y:home.y;
  if(live.dropped) {
    const age=Math.max(0,live.dropAge||0),fall=clamp(age/.85),travel=fall*fall*(3-2*fall);
    return {...home,...live,x:x+(600-x)*travel,y:y+(544-y)*travel-Math.sin(fall*Math.PI)*110,
      alpha:1-clamp((fall-.7)/.3),rotation:fall*2.4,scale:1-fall*.55,r:home.r};
  }
  return {...home,...live,x,y,alpha:1,rotation:0,scale:1,r:home.r};
}

// Reuse the instruments' existing portraits as tiny visual tastes;
// no extra WebGL scene, model, or instrument controller is instantiated here.
const miniatureSources=Object.freeze(Object.fromEntries(WITCH_SHELF.map(entry=>[
  entry.id,new URL('../../../'+entry.imageHref,import.meta.url).href,
])));
const miniatureImages=new WeakMap();
function drawInstrumentMiniature(c,id) {
  const source=miniatureSources[id],doc=c.canvas?.ownerDocument;
  if(!source||!doc)return false;
  let images=miniatureImages.get(doc);
  if(!images) { images=new Map();miniatureImages.set(doc,images); }
  let portrait=images.get(id);
  if(!portrait) {
    const image=doc.createElement('img');image.decoding='async';image.src=source;
    portrait={image,surface:null};images.set(id,portrait);
  }
  if(!portrait.image.complete||!portrait.image.naturalWidth)return false;
  if(!portrait.surface) {
    const surface=doc.createElement('canvas');surface.width=surface.height=160;
    const ink=surface.getContext('2d');ink.drawImage(portrait.image,0,0,160,160);
    const pixels=ink.getImageData(0,0,160,160);removePortraitBackdrop(pixels);ink.putImageData(pixels,0,0);
    portrait.surface=surface;
  }
  const size=id==='spider'?64:60;
  c.drawImage(portrait.surface,-size/2,-size/2,size,size);
  return true;
}

function toneFirefly(c,state) {
  const tone=clamp(state.tone??.5),target=getWitchTargets(state).tone;
  const time=state.reducedMotion?0:(state.time||0),flutter=Math.sin(time*18)*3;
  // A fading ember trail exposes the direction of its brightness gesture.
  for(let i=0;i<7;i++) {
    const y=235-i*130/6;
    ellipse(c,695+Math.sin(i*1.9)*6,y,1.1,1.1,i/6<tone?'#dceeb277':'#a8a1c72c');
  }
  c.save();c.translate(target.x,target.y);
  glow(c,0,0,43+tone*24,tone>.5?'#cffbc044':'#eab06a30');
  for(const side of [-1,1]) {
    path(c,`M${side*3},-3 Q${side*37},${-30-flutter} ${side*26},-5 Q${side*20},9 ${side*3},5 Z`,'#9ea7ce58','#c6b5e8a3',1);
    curve(c,[side*4,-2,side*14,-10,side*18,-13,side*27,-13-flutter],'#cdd5b59c',.8);
    line(c,[[side*3,-8],[side*9,-18],[side*14,-19]],'#ccbd95',1);
  }
  ellipse(c,0,5,5+tone*2,10+tone*3,tone>.5?'#e5f5a5':'#ce924a','#f0e2b0',1.2);
  ellipse(c,0,-7,5,5,'#5d6b67','#ccbd95',1);
  line(c,[[-4,5],[4,5]],'#536b62',1);line(c,[[-4,10],[4,10]],'#536b62',1);
  c.restore();
}

function instrumentShelves(c) {
  for(const shelf of WITCH_LAYOUT.shelves) {
    const {x,y,w,h}=shelf;
    path(c,`M${x},${y+13} L${x+10},${y} L${x+w-8},${y+5} L${x+w},${y+h} L${x-3},${y+h+4} Z`,'#080d15','#332a3c',3);
    for(const side of [x,x+w-9]) {
      path(c,`M${side},${y+8} L${side+8},${y+3} L${side+10},${y+h+9} L${side-2},${y+h+9} Z`,'#272333','#51404b',1.1);
      line(c,[[side+3,y+18],[side+5,y+h-14]],'#7260513d',1);
    }
    for(const row of shelf.rows) {
      path(c,`M${x+5},${row} L${x+w-4},${row-2} L${x+w-5},${row+10} L${x+4},${row+13} Z`,'#332837','#89725b',.8);
      line(c,[[x+10,row+3],[x+w-12,row+1]],'#b38f695c',1.1);
      for(let i=0;i<3;i++)line(c,[[x+18+i*(w-30)/3,row+8],[x+32+i*(w-30)/3,row+7]],'#0a0e17',1);
    }
  }
}
function fabricCloth(c,state) {
  const p=getWitchTargets(state).fabric,time=state.reducedMotion?0:(state.handTime??state.motionTime??0);
  const point=(u,v)=>({x:p.x+(u-.5)*62+Math.sin(v*5+time*2.3)*(3+v*5),
    y:p.y+(v-.5)*47+Math.sin(u*5+time*2.3+v*2)*5});
  c.save();
  for(let row=0;row<5;row++)for(let column=0;column<6;column++) {
    const corners=[[column/6,row/5],[(column+1)/6,row/5],[(column+1)/6,(row+1)/5],[column/6,(row+1)/5]].map(([u,v])=>point(u,v));
    c.beginPath();corners.forEach((q,i)=>i?c.lineTo(q.x,q.y):c.moveTo(q.x,q.y));c.closePath();
    c.fillStyle=(row+column)%2?'#806091b8':'#365f79b8';c.fill();c.strokeStyle='#c4a6c14d';c.lineWidth=.8;c.stroke();
  }
  for(let i=0;i<8;i++) {
    const q=point(i/7,1);line(c,[[q.x,q.y],[q.x+Math.sin(time+i)*3,q.y+5+(i%3)]],'#ad8ba8',.8);
  }
  c.restore();
}
function ingredientObjects(c,state,foreground=false) {
  for(const home of WITCH_LAYOUT.objects) {
    const color=home.color;
    const object=getWitchObjectPosition(state.objects?.find(entry=>entry.id===home.id)||home,state);
    if(Boolean(object.dropped||object.dragging)!==foreground)continue;
    if(object.dropped) {
      const age=Math.max(0,object.dropAge||0),envelope=Math.max(0,1-age/3.6);
      if(envelope>0) {
        c.save();c.globalAlpha=envelope;
        glow(c,600,511,155,`${color}33`);
        ellipse(c,600,520,47+age*25,12+age*7,null,`${color}ad`,2);
        for(let i=0;i<4;i++) {
          const a=age*2.4+i*TAU/4;
          curve(c,[600+Math.cos(a)*40,510,590+Math.cos(a)*80,465-age*16,620+Math.sin(a)*72,446-age*19,600+Math.cos(a+.7)*90,414-age*22],`${color}77`,1.2);
        }
        c.restore();
      }
    }
    if(object.alpha<=0)continue;
    c.save();c.translate(object.x,object.y);c.rotate(object.rotation);c.scale(object.scale,object.scale);c.globalAlpha=object.alpha;
    drawInstrumentMiniature(c,home.id);
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
  backgroundGhosts(c,state);
  instrumentShelves(c);ingredientObjects(c,state,false);
  parkedBroom(c,state);
  brewScene(c,state);
  flightScene(c,state);
  reachingHand(c,state);
  toneFirefly(c,state);
  ingredientObjects(c,state,true);
  fabricCloth(c,state);
  hauntedMist(c,state);
  drawWitchCat(c,state);
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
  const trip=Math.round(clamp(state.trip,0,3)),palette=Math.round(clamp(state.palette,0,7));
  if(trip||palette) {
    // Base preset color and mushroom color add without changing each other's
    // state. Only mushrooms bend coordinates; a palette change is purely color.
    const hue=([0,38,82,132,178,218,268,315][palette]+[0,100,215,290][trip])%360;
    world.color.filter=`hue-rotate(${hue}deg) saturate(${trip?2.15:1.25})`;
    world.color.drawImage(world.surface,0,0);
    if(trip)for(let y=0;y<720;y+=4) ctx.drawImage(world.colored,0,y,1000,4,witchWarpX(y+2,state)-25,y,1050,4);
    else ctx.drawImage(world.colored,0,0);
  } else ctx.drawImage(world.surface,0,0);
  ctx.restore();
}

/** Input remains attached to the visible world through extension and ripples. */
export function hitTestWitch(x, y, state = {}) {
  if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||y<0||x>1000||y>720) return null;
  const point=warpWitchPoint({x,y},state,true); x=point.x;y=point.y;
  if(hitTestWitchCat(x,y,state))return {type:'cat'};
  const minRadius=Math.max(46,state.hitRadius||0);
  let nearestObject=null,objectDistance=Infinity,objectRadius=0;
  for(const [index,home] of WITCH_LAYOUT.objects.entries()) {
    const object=getWitchObjectPosition(state.objects?.find(entry=>entry.id===home.id)||home,state);
    const distance=Math.hypot(x-object.x,y-object.y);
    if(!object.dropped&&distance<Math.max(home.r+8,minRadius)&&distance<objectDistance) {
      nearestObject={type:'object',id:home.id,kind:home.kind,index};objectDistance=distance;objectRadius=home.r+8;
    }
  }
  const targets=getWitchTargets(state);
  if(Math.hypot(x-targets.fabric.x,y-targets.fabric.y)<Math.max(targets.fabric.r,minRadius*.6))return {type:'fabric'};
  if(Math.hypot(x-targets.tone.x,y-targets.tone.y)<Math.max(targets.tone.r,Math.min(50,minRadius*.7)))return {type:'tone'};
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
  if(nearestObject&&objectDistance<objectRadius)return nearestObject;
  const ladle=getWitchLadle(state);
  if(Math.hypot(x-(ladle.hx-8),y-(ladle.hy-24))<Math.max(27,minRadius*.75))return {type:'spoon'};
  if(Math.hypot(x-targets.nose.x,y-targets.nose.y)<Math.max(targets.nose.r,minRadius*.65))return {type:'nose'};
  if(Math.hypot(x-targets.hat.x,y-targets.hat.y)<Math.max(targets.hat.r,minRadius*.7))return {type:'hat'};
  const moon=WITCH_LAYOUT.moon;
  if(Math.hypot(x-moon.x,y-moon.y)<Math.max(moon.r+12,minRadius)) return {type:'moon'};
  for(const m of WITCH_LAYOUT.mushrooms) if(Math.hypot(x-m.x,y-m.y)<Math.max(m.r,minRadius)) return {type:'mushrooms'};
  const handPoint=transformHandPoint({x:590,y:415},state);
  if(Math.hypot(x-handPoint.x,y-handPoint.y)<Math.max(38,minRadius)) return {type:'hand'};
  if(clamp(state.flightLift)<.35) {
    const a=parkedBroomPoint({x:-295,y:120}),b=parkedBroomPoint({x:162,y:96}),dx=b.x-a.x,dy=b.y-a.y;
    const along=clamp(((x-a.x)*dx+(y-a.y)*dy)/(dx*dx+dy*dy));
    if(Math.hypot(x-a.x-dx*along,y-a.y-dy*along)<Math.max(18,minRadius*.45))return {type:'broom'};
  }
  // Visible locks sit in front of the background ghosts, bats and spirits.
  // Hands, utensil, face, hat and shelf icons retain priority.
  const hair=getWitchHair(state),hairRadius=Math.min(28,Math.max(12*hair.scale,minRadius*.32));
  for(const strand of hair.strands.slice(0,8))for(let i=7;i<strand.points.length;i++) {
    const a=strand.points[i-1],b=strand.points[i],dx=b.x-a.x,dy=b.y-a.y;
    const along=clamp(((x-a.x)*dx+(y-a.y)*dy)/Math.max(.01,dx*dx+dy*dy));
    if(Math.hypot(x-a.x-dx*along,y-a.y-dy*along)<hairRadius)return {type:'hair'};
  }
  // The string paints over the potion; its exact path remains pullable there.
  if(clamp(state.flightLift)>.05) {
    const trail=getWitchTrail(state);
    for(let i=1;i<trail.length;i++) {
      const a=trail[i-1],b=trail[i],dx=b.x-a.x,dy=b.y-a.y,along=clamp(((x-a.x)*dx+(y-a.y)*dy)/Math.max(.01,dx*dx+dy*dy));
      if(Math.hypot(x-a.x-dx*along,y-a.y-dy*along)<Math.max(12,minRadius*.35))return {type:'trail'};
    }
  }
  const pot=WITCH_LAYOUT.cauldron;
  if(((x-pot.x)/(pot.rx+30))**2+((y-pot.y)/(pot.ry+33))**2<1) return {type:'stir'};
  let ghostHit=null,ghostDistance=Infinity;
  for(let index=0;index<WITCH_LAYOUT.ghosts.length;index++) {
    const ghost=getWitchGhostPosition(index,state),distance=Math.hypot(x-ghost.x,y-ghost.y);
    if(distance<Math.max(ghost.r,minRadius)&&distance<ghostDistance) {
      ghostHit={type:'ghost',index};ghostDistance=distance;
    }
  }
  if(ghostHit)return ghostHit;
  for(const [index,bat] of WITCH_LAYOUT.bats.entries()) {
    if(Math.hypot(x-bat.x,y-bat.y)<Math.max(bat.r,minRadius))return {type:'bat',index};
  }
  for(const spirit of WITCH_LAYOUT.spirits) if(Math.hypot(x-spirit.x,y-spirit.y)<Math.max(spirit.r,minRadius*.7))return {type:spirit.kind};
  if(nearestObject)return nearestObject;
  if(state.scene==='flight') return {type:'flight'};
  if(Math.hypot(x-ladle.hx,y-ladle.hy)<Math.max(35,minRadius*.8)) return {type:'spoon'};
  return null;
}
