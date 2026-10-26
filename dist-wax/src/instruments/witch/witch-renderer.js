import { drawWitchCat, hitTestWitchCat } from './witch-cat.js';
import { drawWitchVisitors, hitTestWitchVisitors } from './witch-visitors.js';
import { WITCH_INGREDIENTS, WITCH_SHELF, WITCH_TREE_OBJECTS, WITCH_CUPBOARD_TOP, WITCH_VOICES } from './witch-model.js';
import { getWitchBlechFlyby, WITCH_GHOST_SCARE_DURATION } from './witch-scene-model.js';
import { traceLSystem, branchingSnapshotAtPhase, L_SYSTEM_PRESETS } from '../l-system/l-system.js';
// Deformable Canvas scene with miniature instrument cutouts. Gesture geometry
// and drawing use this same viewbox.
const TAU = Math.PI * 2;
const clamp = (n, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));
const paths = new Map();
const INK = '#14131c';
const SKIN = '#b5db9d';
const LIME = '#cefa8b';
const PINK = '#f29bce';
const INGREDIENTS=WITCH_INGREDIENTS;
// The same generation colors used by L-system Delay and its Rust renderer.
const TREE_COLORS=['#fff3d6','#55d9ff','#5fe8c4','#7db4ff','#c79bff','#ff826f','#e8c46b'];
const treeIconIds=new Set(WITCH_TREE_OBJECTS.map(item=>item.id));
const topIconIds=new Set(WITCH_CUPBOARD_TOP.map(item=>item.id));
const miniatureSize=id=>topIconIds.has(id)?.8:(id==='blech'?1.5:1)*(treeIconIds.has(id)?1.35:1);

export const WITCH_LAYOUT = Object.freeze({
  width: 1000, height: 720,
  cauldron: Object.freeze({ x: 600, y: 520, rx: 188, ry: 62 }),
  die: Object.freeze({ x: 344, y: 657, r: 38 }),
  moon: Object.freeze({ x: 720, y: 164, r: 78 }),
  hand: Object.freeze({ x: 388, y: 450, r: 47 }),
  mushrooms: Object.freeze([{x:844,y:610,r:52.5,scale:1.29}]),
  ghosts: Object.freeze([
    Object.freeze({id:'creaturazoid',x:300,y:115,r:45,size:115,color:'#a7ccc7'}),
    Object.freeze({id:'monstroid',x:590,y:80,r:44,size:116,color:'#a5bcd3'}),
    Object.freeze({id:'hiccup',x:640,y:188,r:68,size:174,color:'#d58d94'}),
  ]),
  bats:Object.freeze([]),spirits:Object.freeze([]),
  shelves:Object.freeze([{x:34,y:148,w:239,h:488,rows:[218,299,380,461,542,623]}]),
  objects:Object.freeze(INGREDIENTS.map((entry,index)=>{
    const shelfIndex=WITCH_SHELF.findIndex(item=>item.id===entry.id);
    const treeIndex=WITCH_TREE_OBJECTS.findIndex(item=>item.id===entry.id);
    const topIndex=WITCH_CUPBOARD_TOP.findIndex(item=>item.id===entry.id);
    return Object.freeze({...entry,
      x:entry.location==='web'?910:topIndex>=0?58+48*topIndex:shelfIndex>=0?[77,154,231][shelfIndex%3]:[768,900,842][treeIndex],
      y:entry.location==='web'?140:topIndex>=0?147-27*miniatureSize(entry.id):shelfIndex>=0?191+Math.floor(shelfIndex/3)*81:[300,370,465][treeIndex],
      r:entry.location==='web'?56:28*miniatureSize(entry.id),color:['#a1def0','#dda5c2','#d9ab58','#a7cc69','#af9ed8','#c99b65'][index%6],
    });
  })),
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

function background(c,state) {
  const gradient=c.createLinearGradient(0,0,0,720);
  gradient.addColorStop(0,'#090c18');gradient.addColorStop(.55,'#152136');gradient.addColorStop(1,'#17102a');
  c.fillStyle=gradient;c.fillRect(0,0,1000,720);
  glow(c,730,250,370,'#343c6a1a');fabricCloth(c,state);moon(c,state,false);
  const grounded=1-clamp(state.flightLift);
  if(grounded<=0)return;
  c.save();c.globalAlpha*=grounded;
  glow(c,310,260,300,'#a43aa51f');glow(c,740,420,300,'#1db6ae1b');
  path(c,'M0,662 Q128,618 251,636 Q390,657 499,642 Q656,621 782,638 Q908,620 1000,664 L1000,720 L0,720 Z','#111822');
  c.restore();
}

// The original smooth cone and brim, sampled only for picking. Drawing keeps
// the original curves; both paths share the same rooted stretch/shear.
function sampleHatOutline(start,segments) {
  const points=[start];let from=start;
  for(const segment of segments) {
    const quadratic=segment.length===4,to=segment.slice(-2);
    for(let i=1;i<=16;i++) {
      const t=i/16,u=1-t;
      points.push(quadratic
        ? [u*u*from[0]+2*u*t*segment[0]+t*t*to[0],u*u*from[1]+2*u*t*segment[1]+t*t*to[1]]
        : [u*u*u*from[0]+3*u*u*t*segment[0]+3*u*t*t*segment[2]+t*t*t*to[0],
          u*u*u*from[1]+3*u*u*t*segment[1]+3*u*t*t*segment[3]+t*t*t*to[1]]);
    }
    from=to;
  }
  return points;
}
const INTACT_HAT_OUTLINES=[
  sampleHatOutline([-66,-33],[[-47,-99,-31,-165],[-22,-213,12,-237,47,-223],[74,-211,87,-194,115,-203],
    [101,-178,72,-169,50,-164],[39,-107,64,-39]]),
  sampleHatOutline([-69,-40],[[-108,-34,-139,-16,-143,-6],[-137,6,-88,6,-40,-1],[43,13,118,0],
    [148,-4,143,-21,120,-24],[85,-25,61,-38],[-2,-17,-69,-40]]),
];
function intactHatDeformation(state={}) {
  return {shear:-clamp(state.hatPullX??0,-185,185)/168,
    stretch:1-(clamp(state.hatPullY??0,-145,125)-(clamp(state.hat??.5)-.5)*28)/168};
}
function intactHatPoint([x,y],state) {
  const {shear,stretch}=intactHatDeformation(state);
  return {x:x+shear*(y+20),y:-20+(y+20)*stretch};
}

function intactHat(c, state) {
  const {shear,stretch}=intactHatDeformation(state);
  c.save();c.transform(1,0,shear,stretch,shear*20,(stretch-1)*20);
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


// Torn panels share one rooted deformation: the brim holds while every loose
// scrap follows a two-dimensional tug. No intact cone, buckle or moon badge.
const HAT_PANELS = [
  {color:'#30272f',points:[[-68,-39],[-78,-83],[-108,-116],[-79,-109],[-99,-151],[-69,-137],[-72,-178],[-45,-153],[-34,-118],[-23,-48]]},
  {color:'#45323d',points:[[-30,-45],[-42,-111],[-44,-167],[-24,-152],[-7,-188],[3,-144],[28,-174],[16,-119],[38,-103],[28,-48]]},
  {color:'#342932',points:[[33,-48],[38,-108],[54,-161],[68,-134],[95,-153],[77,-111],[103,-123],[71,-79],[78,-41]]},
  {color:'#4a363c',points:[[-70,-62],[-45,-52],[-28,-61],[-6,-50],[16,-61],[38,-49],[68,-60],[75,-34],[44,-29],[19,-37],[-4,-28],[-29,-35],[-58,-29],[-71,-39]]},
  {color:'#302831',points:[[-72,-38],[-108,-24],[-137,-7],[-115,-8],[-126,12],[-95,4],[-88,16],[-65,3],[-40,12],[-27,1],[0,10],[24,3],[48,13],[61,3],[83,17],[87,4],[110,12],[103,-1],[137,-8],[116,-18],[83,-21],[64,-37],[28,-24],[-7,-29],[-34,-22]]},
];
function hatPoint(point,state={}) {
  const [x,y]=point,free=clamp((-y-20)/168),value=clamp(state.hat??.5);
  const time=state.reducedMotion?0:(state.handTime??state.motionTime??0);
  const flutter=Math.sin(time*2.3+x*.07)*(2+clamp(state.flightLift)*6)*free;
  const dx=clamp(state.hatPullX??0,-185,185),dy=clamp(state.hatPullY??0,-145,125);
  return {x:x+dx*free**1.3+Math.sin(y*.035)*dx*.14*free+flutter,
    y:y+dy*free**1.2-(value-.5)*28*free+Math.sin(x*.045)*Math.abs(dx)*.12*free};
}
export function getWitchHat(state={}) {
  const clicks=state.hatClicks??0,visible=clicks<3,busted=clicks>=2;
  const transform=headTransform(state),project=p=>headPoint(busted?hatPoint(p,state):intactHatPoint(p,state),transform);
  return {transform,visible,stage:visible?(busted?'busted':'intact'):'gone',
    target:{...project([-12,-102]),r:visible?38*transform.scale:0},
    panels:visible?(busted?HAT_PANELS.map(panel=>panel.points):INTACT_HAT_OUTLINES).map(points=>points.map(project)):[]};
}

/** A detached hat keeps its release position even if the witch changes course.
 * The performance clock freezes its single tumble with the rest of the scene. */
export function getWitchHatDrop(state={}) {
  const drop=state.hatDrop;
  if(!drop||(state.hatClicks??0)<3)return null;
  const age=(state.performanceTime??state.time??0)-drop.startedAt,duration=1.45;
  if(age<0||age>=duration)return null;
  const t=clamp(age/duration),travel=t*t*(3-2*t),pot=WITCH_LAYOUT.cauldron;
  const center=headPoint({x:-12,y:-80},drop.transform);
  return {x:center.x+(pot.x-center.x)*travel,
    y:center.y+(pot.y+20-center.y)*t*t-Math.sin(Math.PI*t)*75,
    scale:drop.transform.scale*(1-.84*travel),rotation:drop.transform.rotation+t*t*4.4,
    opacity:clamp((1-t)/.16),progress:t};
}
function fallingHat(c,state) {
  const pose=getWitchHatDrop(state);if(!pose)return;
  c.save();c.globalAlpha*=pose.opacity;c.translate(pose.x,pose.y);c.rotate(pose.rotation);c.scale(pose.scale,pose.scale);c.translate(12,80);
  hat(c,{...state,...state.hatDrop,hatClicks:2});c.restore();
}
function hat(c,state) {
  if((state.hatClicks??0)>=3)return;
  if((state.hatClicks??0)<2){intactHat(c,state);return;}
  const draw=(points,fill,stroke=INK,width=2.4)=>{
    const warped=points.map(p=>hatPoint(p,state));
    c.beginPath();warped.forEach((p,i)=>i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y));c.closePath();
    c.fillStyle=fill;c.fill();c.strokeStyle=stroke;c.lineWidth=width;c.stroke();
  };
  for(const panel of HAT_PANELS)draw(panel.points,panel.color);
  for(const points of [[[-72,-176],[-66,-149],[-85,-141]],[[4,-145],[0,-123],[18,-121]],[[57,-156],[53,-132],[71,-125]],[[-112,-6],[-92,-3],[-87,9]],[[86,3],[98,5],[103,-1]]]) {
    line(c,points.map(p=>{const q=hatPoint(p,state);return [q.x,q.y];}),'#a16e55',1.4);
  }
  // Charred holes, dangling seams and a few dull embers in the shredded felt.
  for(const hole of [[[-56,-104],[-62,-122],[-49,-114],[-45,-99]],[[-15,-78],[-24,-99],[-9,-91],[-5,-75]],[[49,-80],[59,-100],[61,-77],[53,-67]]])draw(hole,'#0a0e17','#795347',1.5);
  for(const [x,y] of [[-72,-168],[-95,-145],[-26,-154],[25,-166],[92,-148],[-119,7],[-91,12],[76,10],[109,8]]) {
    const points=[[x,y],[x-6,y+10],[x+3,y+18],[x-5,y+28]].map(p=>{const q=hatPoint(p,state);return [q.x,q.y];});
    line(c,points,'#8e7970',.85);
  }
  for(let i=0;i<11;i++) {
    const x=-56+i*10,y=-45+Math.sin(i*2)*5,a=hatPoint([x-2,y-4],state),b=hatPoint([x+2,y+3],state);
    line(c,[[a.x,a.y],[b.x,b.y]],i%4?'#99877a':'#b27855',1);
  }
}

// Hair is a small bundle of fixed-budget strands in head coordinates.
// The sound amount retains its old resting shape. A separate two-dimensional
// pull moves every tip directly, leaving the scalp fixed; the interior locks
// wind around that pull instead of constraining the hand to one diagonal.
function witchHairLocal(state = {}) {
  const amount=clamp(state.hair),lift=clamp(state.flightLift);
  const time=state.reducedMotion?0:(state.handTime??state.motionTime??0);
  const phase=state.reducedMotion?0:(state.flightPhase??time*.72);
  const pull={x:-85,y:48},pullDistance=Math.hypot(pull.x,pull.y);
  const drag={x:clamp(Number.isFinite(state.hairPullX)?state.hairPullX:0,-300,300),
    y:clamp(Number.isFinite(state.hairPullY)?state.hairPullY:0,-240,240)};
  const dragLength=Math.hypot(drag.x,drag.y),pullAmount=clamp(dragLength/300);
  const tangent=dragLength?{x:drag.x/dragLength,y:drag.y/dragLength}:{x:0,y:0};
  const twist=(drag.x/300-drag.y/240)*Math.PI;
  const strands=[];
  for(let i=0;i<23;i++) {
    const root={x:-88+i*3.1,y:-24+Math.sin(i*.7)*4},points=[];
    for(let j=0;j<=20;j++) {
      const u=j/20,free=u*u,envelope=Math.sin(u*Math.PI);
      const snake=Math.sin(u*(6+amount*5+lift*7)-time*(1.5+lift*2.4)+i*.48);
      const fray=Math.sin(u*29-time*2.7+i*1.9)*amount*5;
      const curl=envelope*(snake*(7+amount*18+lift*32)+fray);
      const sweep=lift*(110+Math.sin(phase*1.4)*23)*u**1.5;
      // Extra knots vanish at both ends: even the wildest flight pull keeps
      // exact tip tracking and cannot unroot a strand from the witch's head.
      const loose=envelope*u*pullAmount;
      const coil=loose*((22+lift*56)*Math.sin(u*(11+pullAmount*10+lift*8)-time*(1.8+lift*3)+i*.79+twist)
        +(i-11)*1.35*Math.sin(u*8+twist));
      const fold=loose*(9+lift*24)*Math.sin(u*(20+lift*10)+time*(1.3+lift*2.1)+i*.57-twist);
      points.push({x:root.x-13*free+pull.x*amount*free-sweep+curl+drag.x*free-tangent.y*coil+tangent.x*fold,
        y:root.y+(168+(i%3)*9)*u+pull.y*amount*free-lift*(50+Math.cos(phase*1.4)*21)*free+curl*.63+drag.y*free+tangent.x*coil+tangent.y*fold});
    }
    strands.push({points,width:i%3===0?3.1:4.4,index:i});
  }
  const middle=strands[10],root=middle.points[0],tip=middle.points.at(-1);
  // These are actual visible locks, excluding the section hidden by her face.
  const targets=[];
  for(const index of [2,6,10])for(const sample of [9,13,17,20])
    targets.push({...strands[index].points[sample],r:11});
  return {root,tip,axis:{x:pull.x/pullDistance,y:pull.y/pullDistance},pullDistance,drag,pullAmount,strands,targets};
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
/** Render/pick geometry before mushroom warping. Transform converts free X/Y
 * dragging into head coordinates; axis/range retain the sound/hush projection. */
export function getWitchHair(state = {}) {
  const local=witchHairLocal(state),transform=headTransform(state);
  const cos=Math.cos(transform.rotation),sin=Math.sin(transform.rotation);
  return {root:headPoint(local.root,transform),tip:headPoint(local.tip,transform),
    axis:{x:cos*local.axis.x-sin*local.axis.y,y:sin*local.axis.x+cos*local.axis.y},
    pullDistance:local.pullDistance*transform.scale,scale:transform.scale,transform,pull:local.drag,
    targets:local.targets.map(point=>({...headPoint(point,transform),r:point.r*transform.scale})),
    strands:local.strands.map(strand=>({...strand,width:strand.width*transform.scale,
      points:strand.points.map(point=>headPoint(point,transform))}))};
}
function drawWitchHair(c,state) {
  const {strands,pullAmount}=witchHairLocal(state),amount=clamp(state.hair),lift=clamp(state.flightLift);
  const colors=['#bcc5ac','#81758e','#6c7286','#92b9ae','#bb9cb9'];
  for(const strand of strands) {
    const points=strand.points.map(point=>[point.x,point.y]);
    line(c,points,INK,strand.width+3.5);
    line(c,points,colors[strand.index%colors.length],strand.width);
    // Fine split ends become tangled and electrically wiry when pulled.
    if(amount>.01||lift>.01||pullAmount>.01) {
      const end=strand.points[17],tip=strand.points.at(-1),curl=(amount*12+lift*18+pullAmount*(16+lift*25))*(strand.index%2?1:-1);
      curve(c,[end.x,end.y,tip.x+curl,tip.y-18,tip.x-curl*1.5,tip.y+16,tip.x-8-amount*8,tip.y+7],colors[(strand.index+2)%colors.length],.8+amount*.5);
    }
  }
}

function witchHead(c, state, x, y, scale = 1, tilt = 0) {
  const vocal = true;
  const mouth = vocal ? clamp(state.mouth) : 0;
  const nose=(clamp(state.nose??.5)-.5)*80;
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
  const shock=clamp(state.eyeShock),dart=shock*(state.reducedMotion?0:Math.sin(Math.floor((state.handTime??state.motionTime??0)*7)*2.4)*5);
  ellipse(c,22+dart,26,7+shock*2,8,shock?'#ff852e':'#b69065');ellipse(c,24+dart,26,2.5,6,'#242323');
  ellipse(c,26+dart,23,1.7,1.7,'#f8e9c7');
  if(shock>.01) {curve(c,[-10,22,-19,13,-20,4,-28,-1],'#ee8b405e',1.2);curve(c,[33,32,47,45,57,43,66,50],'#ea784d70',1.2);}
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

function cauldronFire(c,state,front=false) {
  const time=state.reducedMotion?0:(state.time||0),heat=clamp(state.energy);
  if(!front) {
    c.save();c.translate(600,682);c.scale(1,.24);
    glow(c,0,0,190,'#ed5b214e');c.restore();
    // Charred split wood and a broken bed of coals, low enough to stay visible.
    path(c,'M454,682 L482,677 L735,694 L727,702 L470,692 Z','#302027','#121218',2);
    path(c,'M480,697 L491,689 L728,676 L743,685 L720,692 Z','#3b2826','#17151a',2);
    for(let i=0;i<19;i++) {
      const x=470+i*14,y=687+Math.sin(i*2.7)*6;
      path(c,`M${x-6},${y} l5,-4 8,2 2,5 -9,2 Z`,i%3?'#a53b24':'#f28031');
      line(c,[[x-3,y+1],[x+6,y-1]],i%2?'#f7ae4d':'#572721',1);
    }
  }
  const outer=c.createLinearGradient(0,605,0,693);
  outer.addColorStop(0,'#ff531b');outer.addColorStop(.55,'#fa6d1e');outer.addColorStop(1,'#b93016');
  const core=c.createLinearGradient(0,635,0,693);
  core.addColorStop(0,'#fff4c1');core.addColorStop(.6,'#ffdd6d');core.addColorStop(1,'#ff9b31');
  const tongue=(x,y,w,h,bend,fill)=>{
    c.beginPath();c.moveTo(x-w,y);
    c.bezierCurveTo(x-w*1.2,y-h*.27,x+bend-w*.6,y-h*.64,x+bend,y-h);
    c.bezierCurveTo(x+bend+w*.35,y-h*.68,x+w*.45,y-h*.52,x+w*.25,y-h*.23);
    c.bezierCurveTo(x+w*.8,y-h*.38,x+w*1.25,y-h*.16,x+w,y);
    c.bezierCurveTo(x+w*.4,y+3,x-w*.6,y+4,x-w,y);c.fillStyle=fill;c.fill();
  };
  for(let i=0;i<(front?9:11);i++) {
    const pulse=.5+.3*Math.sin(time*(7+i*.19)+i*2.3)+.2*Math.sin(time*13.7-i*1.8);
    const x=(front?490:477)+i*(front?27:24),base=686+Math.sin(i*2.1)*4;
    const height=(front?23:49)+pulse*(front?25:32)+heat*7;
    const width=(front?9:12)+pulse*3,bend=Math.sin(time*5.2+i*2.6)*(5+pulse*7);
    tongue(x,base,width,height,bend,outer);
    tongue(x+width*.08,base,width*.48,height*.64,bend*.65,core);
  }
  if(front)for(let i=0;i<9;i++) {
    const age=(time*(.35+i*.021)+i*.137)%1;
    const x=469+i*32+Math.sin(time*2.4+i)*age*8,y=684-age*(37+i%3*13);
    c.save();c.globalAlpha*=Math.sin(age*Math.PI)*.8;
    ellipse(c,x,y,1.1,2.1,'#ffcb74');c.restore();
  }
}

function cauldron(c, state) {
  const { x, y, rx, ry } = WITCH_LAYOUT.cauldron;
  const time = state.time || 0, phase = state.phase || 0, energy = clamp(state.energy), radius = clamp(state.radius);
  glow(c, x, y + 44, 230, `rgba(151,204,114,${.12 + energy * .08})`);
  ellipse(c, x, 667, 192, 21, '#090f1680');
  cauldronFire(c,state);
  // Three little iron feet, each picking up the firelight.
  for (const fx of [480, 600, 720]) {
    path(c, `M${fx - 12},631 L${fx - 20},673 Q${fx - 8},680 ${fx + 4},671 L${fx + 11},636 Z`, '#22292d', '#0e141d', 2.4);
    line(c, [[fx - 10,650],[fx - 14,667]], '#7c7150', 2);
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
  curve(c,[465,640,510,671,688,674,735,640],'#f6a24c85',2.4);
  cauldronFire(c,state,true);
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

function spellDie(c,state) {
  const {x,y,r}=WITCH_LAYOUT.die,roll=state.reducedMotion?0:clamp(state.diceRoll);
  const hop=Math.sin(roll*Math.PI)*12;
  ellipse(c,x,y+r+4,32-hop*.45,7-hop*.15,'#080d19a8');
  c.save();c.translate(x,y-hop);c.rotate(-.12+Math.sin(roll*TAU*2)*roll*.32);
  c.scale(r/39,r/39);
  // An icosahedron's ten facing triangles, with an engraved central face.
  const points=[[0,-39],[34,-20],[34,20],[0,39],[-34,20],[-34,-20],[0,-22],[23,15],[-23,15]];
  const faces=[[[0,1,6],'#a48c8d'],[[1,2,7],'#545272'],[[2,3,7],'#253c48'],
    [[3,4,8],'#32444c'],[[4,5,8],'#518677'],[[5,0,6],'#8fb8a0'],
    [[5,6,8],'#548572'],[[1,7,6],'#74628f'],[[3,8,7],'#4b354f'],[[6,7,8],'#314959']];
  for(const [vertices,color] of faces) {
    c.beginPath();vertices.forEach((index,i)=>i?c.lineTo(...points[index]):c.moveTo(...points[index]));c.closePath();
    c.fillStyle=color;c.fill();c.strokeStyle='#151a2b';c.lineWidth=1.2;c.stroke();
  }
  line(c,[points[4],points[5],points[0],points[1]],'#b7ccaf',1.35);
  line(c,[points[8],points[6],points[7]],'#a6b99d',1);
  c.textAlign='center';c.textBaseline='middle';c.font='bold 19px Georgia, serif';
  c.fillStyle='#0c1c28';c.fillText('20',.7,4.7);c.fillStyle='#e5dca7';c.fillText('20',0,4);
  c.font='9px Georgia, serif';c.fillStyle='#d9c6ab';
  c.save();c.translate(-23,-10);c.rotate(-Math.PI/3);c.fillText('7',0,0);c.restore();
  c.save();c.translate(23,-9);c.rotate(Math.PI/3);c.fillText('13',0,0);c.restore();
  c.save();c.translate(0,27);c.rotate(Math.PI);c.fillText('4',0,0);c.restore();
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
}

/** The broom follows a continuous, untuned rollercoaster path above the pot.
 * Pointer position steers its centre; altitude changes the height of the coils. */
export function broomTransform(state = {}) {
  const lift=clamp(state.flightLift),time=state.reducedMotion?0:(state.motionTime??state.time??0);
  const phase=state.reducedMotion?0:(state.flightPhase??time*.72),altitude=clamp(state.altitude??.5),steer=clamp(state.flightX??.5);
  const curl=.3+.7*clamp(state.trailTwist??.5),loop=phase*1.8+Math.sin(phase*.23)*.35;
  // A long sweep carries smaller returning loops; twisting the hair deepens
  // those loops while retaining space for the complete flying anatomy.
  const targetX=582+(steer-.5)*120+Math.sin(phase*.27)*(165-50*curl)+Math.sin(loop)*50*curl;
  const tallHat=clamp((state.hat??.5)-.5,0,.5)*2;
  const targetY=350+tallHat*16+(0.5-altitude)*36+Math.sin(phase*.41)*(47-32*curl)+Math.cos(loop)*32*curl;
  return {x:455+(targetX-455)*lift,y:476+(targetY-476)*lift,
    rotation:(-.08+.085*Math.cos(loop)+.035*Math.sin(phase*.41))*lift,scale:.8+((.54-tallHat*.04)*1.3-.8)*lift,phase};
}
function broomPoint(point,state) {
  const t=broomTransform(state),cos=Math.cos(t.rotation),sin=Math.sin(t.rotation);
  return {x:t.x+(cos*point.x-sin*point.y)*t.scale,y:t.y+(sin*point.x+cos*point.y)*t.scale};
}
/** Delay strands continue the real hair tips. Their resting shape is a curled
 * travelling worm, from a small hank of hair to loops filling the whole sky. */
const TRAIL_LOCKS=[10,17];
function trailStyle(index,order,state) {
  return {index,color:'#fff7ea',stripe:'#dc2f3f',stripeLength:17-clamp(state.trailFeedback??.55)*11,width:order?3.5:4.8};
}
export function getWitchRestTrails(state={}) {
  const phase=state.reducedMotion?0:(state.flightPhase??state.motionTime??0);
  const pull=clamp(state.trailPull??.5),twist=clamp(state.trailTwist??.5),hair=getWitchHair(state);
  const feedback=clamp(state.trailFeedback??.55),space=clamp(state.trailSpace??.5);
  const samples=256,join=Math.round(samples*.85);
  return TRAIL_LOCKS.map((index,strandIndex)=>{
    const lock=hair.strands[index],anchor=lock.points.at(-1),prior=lock.points.at(-2),points=[];
    const reach=.20+.80*space,width=952*reach,height=636*reach;
    const cx=clamp((anchor.x-width*.37)*(1-space)+500*space,24+width/2,976-width/2);
    const cy=clamp((anchor.y-height*.38)*(1-space)+356*space,38+height/2,674-height/2);
    const bounds={left:cx-width/2,right:cx+width/2,top:cy-height/2,bottom:cy+height/2};
    const raw=[{x:0,y:0}],direction=strandIndex?-1:1;
    const orientation=(strandIndex?1.27:-.85)+phase*(.19+.31*pull)+(twist-.5)*Math.PI*1.5;
    // Integrating changing curvature produces loops that wind, fold and whip
    // instead of replaying one wide route with slightly displaced waypoints.
    for(let i=1;i<=join;i++) {
      const u=(i-.5)/join;
      const bend=(.25+pull*1.45)*Math.sin(u*TAU*(.65+twist*2.7)+phase*(.47+twist*.72)+strandIndex*1.8);
      const kink=(.1+twist*1.5)*Math.sin(u*TAU*(1.7+pull*2.3)-phase*(.8+pull*1.4)+strandIndex*2.3);
      const flick=pull*.65*Math.sin(u*TAU*(3.7+feedback*3.6)+phase*(1.7+twist*.6)+strandIndex*.7);
      const angle=orientation+direction*(u*TAU*(.3+feedback*4.4)+bend+kink+flick),last=raw.at(-1);
      raw.push({x:last.x+Math.cos(angle),y:last.y+Math.sin(angle)});
    }
    const xs=raw.map(p=>p.x),ys=raw.map(p=>p.y),left=Math.min(...xs),top=Math.min(...ys);
    const rx=Math.max(.001,Math.max(...xs)-left),ry=Math.max(.001,Math.max(...ys)-top);
    for(const p of raw)points.push({x:bounds.left+(p.x-left)/rx*width,y:bounds.top+(p.y-top)/ry*height});
    const end=points[join],next=points[join-1],length=Math.max(1,Math.hypot(anchor.x-prior.x,anchor.y-prior.y));
    const tx=(anchor.x-prior.x)/length,ty=(anchor.y-prior.y)/length;
    const availableX=Math.abs(tx)<1e-6?Infinity:(tx>0?bounds.right-anchor.x:bounds.left-anchor.x)/tx;
    const availableY=Math.abs(ty)<1e-6?Infinity:(ty>0?bounds.bottom-anchor.y:bounds.top-anchor.y)/ty;
    const joinLength=Math.max(0,Math.min(45,width*.15,height*.22,availableX*.85,availableY*.85));
    const a={x:anchor.x+tx*joinLength,y:anchor.y+ty*joinLength};
    const b={x:clamp(end.x+(end.x-next.x)*4,bounds.left,bounds.right),y:clamp(end.y+(end.y-next.y)*4,bounds.top,bounds.bottom)};
    // The sky coil remains bounded, but a pulled hair tip can reach beyond
    // the frame. Let only its short joining curve travel with that real tip.
    const joinBounds={left:Math.min(24,anchor.x),right:Math.max(976,anchor.x),
      top:Math.min(38,anchor.y),bottom:Math.max(674,anchor.y)};
    for(let i=join;i<=samples;i++) {
      const t=(samples-i)/(samples-join),v=1-t;
      points[i]={x:clamp(v*v*v*anchor.x+3*v*v*t*a.x+3*v*t*t*b.x+t*t*t*end.x,joinBounds.left,joinBounds.right),
        y:clamp(v*v*v*anchor.y+3*v*v*t*a.y+3*v*t*t*b.y+t*t*t*end.y,joinBounds.top,joinBounds.bottom)};
    }
    return {...trailStyle(index,strandIndex,state),points};
  });
}
/** The rope controller supplies the same simulated points for drawing and
 * picking. Captured nodes may leave the view; the controller owns that bound. */
export function getWitchTrails(state={}) {
  if(!Array.isArray(state.trailStrands))return getWitchRestTrails(state);
  const hair=getWitchHair(state);let rest;
  return TRAIL_LOCKS.map((index,order)=>{
    const strand=state.trailStrands.find(entry=>entry.index===index);
    if(!strand||!Array.isArray(strand.points)||strand.points.length<2||strand.points.length>513||
      strand.points.some(p=>!Number.isFinite(p?.x)||!Number.isFinite(p?.y)))return (rest??=getWitchRestTrails(state))[order];
    const points=strand.points.map(p=>({x:p.x,y:p.y}));points[points.length-1]={...hair.strands[index].points.at(-1)};
    return {...trailStyle(index,order,state),points};
  });
}
export function getWitchTrail(state={}) {return getWitchTrails(state)[0].points;}

const treeShapes=new Map(),neutralTrees=new Map(),treeTraces=new WeakMap();
const TREE_CACHE_LIMIT=48;
/** The upright tree is the actual L-system turtle trace, bounded and cached. */
export function getWitchTree(state={}) {
  const shape=Math.round(clamp(state.treeShape,0,5));
  const spread=clamp(state.treeSpread??.5),curl=clamp(state.treeCurl??.5),isNeutral=spread===.5&&curl===.5;
  if(isNeutral&&neutralTrees.has(shape))return neutralTrees.get(shape);
  const key=`${shape}:${spread}:${curl}`;
  if(treeShapes.has(key)) {
    const cached=treeShapes.get(key);treeShapes.delete(key);treeShapes.set(key,cached);return cached;
  }
  const neutral=isNeutral?null:getWitchTree({treeShape:shape});
  const source=L_SYSTEM_PRESETS[[0,1,2,0,1,2][shape]];
  const baseAngle=[31,25,29,41,36,18][shape],baseAsymmetry=shape%2?.15:-.08;
  const angle=isNeutral?baseAngle:baseAngle*(.76+.48*spread),turnAsymmetry=baseAsymmetry+(curl-.5)*.36;
  const trace=traceLSystem({...source,iterations:[5,3,3,6,3,3][shape],angle,turnAsymmetry,maxSymbols:6000});
  const b=trace.bounds,wide=Math.max(.01,b.maxY-b.minY),tall=Math.max(.01,b.maxX-b.minX);
  // Keep the original neutral projection byte-for-byte. Deformation uses its
  // scale and rooted trunk instead of renormalizing every crown to 270 pixels.
  const root=neutral?neutral.root:{x:710+(0-b.minY)/wide*270,y:692-(0-b.minX)/tall*672};
  const scaleX=neutral?neutral.projection.scaleX*(.84+.32*spread):270/wide;
  // A naturally off-center trunk can have almost no room on one side. Fit
  // that side independently so one curling twig cannot collapse the crown.
  const leftScale=b.minY<0?Math.min(scaleX,(root.x-710)/-b.minY):scaleX;
  const rightScale=b.maxY>0?Math.min(scaleX,(980-root.x)/b.maxY):scaleX;
  const scaleY=neutral?672/Math.max(.01,b.maxX):672/tall;
  const project=neutral?p=>({x:clamp(root.x+p.y*(p.y<0?leftScale:rightScale),710,980),y:clamp(692-p.x*scaleY,20,692)}):
    p=>({x:710+(p.y-b.minY)/wide*270,y:692-(p.x-b.minX)/tall*672});
  const segments=trace.segments.map(segment=>({a:project(segment.start),b:project(segment.end),depth:segment.forkDepth/Math.max(1,trace.maxForkDepth),generation:segment.generation}));
  const supports=segments.flatMap(({a,b},segmentIndex)=>[.25,.5,.75,1].map(t=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,segmentIndex,t})));
  const hints={blech:{x:790,y:365},syrinx:{x:930,y:475},eyeball:{x:815,y:255}},objects={};
  const anchors={};
  // Reserve a high branch for Creaturazoid before placing its larger neighbors.
  [...WITCH_TREE_OBJECTS].sort((a,b)=>(b.id==='eyeball')-(a.id==='eyeball')).forEach(item=>{
    const hint=hints[item.id],size=miniatureSize(item.id),offset=27*size,r=28*size;
    const available=p=>p.x>735&&p.x+r<980&&p.y>(item.id==='eyeball'?195:280)&&p.y<(item.id==='eyeball'?420:625)&&
      (p.y+r<500||p.x-r>810)&&
      Math.hypot(p.x-910,p.y-140)>r+65&&Object.entries(objects).every(([id,q])=>Math.hypot(p.x-q.x,p.y-q.y)>r+28*miniatureSize(id)+20);
    const anchor=neutral?.anchors[item.id],branch=anchor&&segments[anchor.segmentIndex];
    const perched=branch?{x:branch.a.x+(branch.b.x-branch.a.x)*anchor.t,y:branch.a.y+(branch.b.y-branch.a.y)*anchor.t-offset,...anchor}:null;
    const candidates=supports.map(p=>({...p,y:p.y-offset})).filter(available),target=perched||hint;
    const point=perched&&available(perched)?perched:candidates.reduce((best,p)=>Math.hypot(p.x-target.x,p.y-target.y)<Math.hypot(best.x-target.x,best.y-target.y)?p:best,candidates[0]||{x:root.x,y:root.y-offset,segmentIndex:0,t:0});
    objects[item.id]={x:point.x,y:point.y};anchors[item.id]={segmentIndex:point.segmentIndex,t:point.t};
  });
  const candidates=segments.flatMap(({a,b})=>Array.from({length:16},(_,i)=>({x:a.x+(b.x-a.x)*i/16,y:a.y+(b.y-a.y)*i/16}))).filter(p=>p.x>820&&p.y>410&&p.y<610&&
    WITCH_LAYOUT.mushrooms.every(m=>Math.hypot(p.x-m.x,p.y-m.y)>m.r+10)&&
    Object.entries(objects).every(([id,q])=>Math.hypot(p.x-q.x,p.y-q.y)>28*miniatureSize(id)+20));
  const target=candidates.reduce((best,p)=>Math.hypot(p.x-855,p.y-550)<Math.hypot(best.x-855,best.y-550)?p:best,candidates[0]||root);
  const result={shape,root,target,segments,objects,anchors,controls:{spread,curl,angle,turnAsymmetry},projection:{scaleX,scaleY}};
  treeTraces.set(result,trace);
  if(isNeutral)neutralTrees.set(shape,result);
  else {if(treeShapes.size>=TREE_CACHE_LIMIT)treeShapes.delete(treeShapes.keys().next().value);treeShapes.set(key,result);}
  return result;
}
/** Follow the excerpt's audio playhead along the native branching frontier. */
export function getWitchTreePulse(state={}) {
  if(!(state.treeEnvelope>0)||state.treeProgress>=1)return [];
  const tree=getWitchTree(state),trace=treeTraces.get(tree);
  return branchingSnapshotAtPhase(trace,clamp(state.treeProgress)).heads.map(head=>{
    const {a,b}=tree.segments[head.index],t=head.progress,tail=Math.max(0,t-.65);
    return {index:head.index,generation:head.generation,x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,
      from:{x:a.x+(b.x-a.x)*tail,y:a.y+(b.y-a.y)*tail}};
  });
}
function livingTree(c,state) {
  const tree=getWitchTree(state);
  for(const segment of tree.segments) {
    const points=[[segment.a.x,segment.a.y],[segment.b.x,segment.b.y]],width=1.1+(1-segment.depth)*4.5;
    line(c,points,'#10141e',width+2);
    line(c,points,TREE_COLORS[segment.generation%TREE_COLORS.length]+'d9',width);
  }
  c.save();c.globalAlpha*=clamp(state.treeEnvelope);
  for(const head of getWitchTreePulse(state)) {
    line(c,[[head.from.x,head.from.y],[head.x,head.y]],TREE_COLORS[head.generation%TREE_COLORS.length],5);
    c.fillStyle='#f4ffe7';c.beginPath();c.arc(head.x,head.y,3.2,0,TAU);c.fill();
  }
  c.restore();
}
let cornerWeb;
export function getWitchWeb() {
  if(cornerWeb)return cornerWeb;
  const corners=[{x:700,y:12},{x:994,y:12},{x:994,y:386}],center={x:910,y:140};
  const spokes=Array.from({length:21},(_,index)=>{
    const angle=index*TAU/21,dx=Math.cos(angle),dy=Math.sin(angle);
    let length=Infinity;
    for(let edge=0;edge<3;edge++) {
      const a=corners[edge],b=corners[(edge+1)%3],ex=b.x-a.x,ey=b.y-a.y,cross=dx*ey-dy*ex;
      if(Math.abs(cross)<1e-8)continue;
      const x=a.x-center.x,y=a.y-center.y,t=(x*ey-y*ex)/cross,u=(x*dy-y*dx)/cross;
      if(t>0&&u>=0&&u<=1)length=Math.min(length,t);
    }
    return {x:center.x+dx*length,y:center.y+dy*length};
  });
  const along=(p,u)=>({x:center.x+(p.x-center.x)*u,y:center.y+(p.y-center.y)*u});
  const strands=[[...corners,corners[0]],...spokes.map(p=>[center,p])];
  // Bow the catching threads inward between radial supports, like stretched silk.
  for(let ring=1;ring<=14;ring++) {
    const u=ring/15,points=[];
    for(let index=0;index<spokes.length;index++) {
      const a=along(spokes[index],u),b=along(spokes[(index+1)%spokes.length],u);
      const mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2},control={x:mid.x+(center.x-mid.x)*.065,y:mid.y+(center.y-mid.y)*.065};
      for(let step=0;step<4;step++) {
        const t=step/4,v=1-t;
        points.push({x:v*v*a.x+2*v*t*control.x+t*t*b.x,y:v*v*a.y+2*v*t*control.y+t*t*b.y});
      }
    }
    strands.push([...points,points[0]]);
  }
  const targets=Array.from({length:7},(_,index)=>along(spokes[index*3+1],.84));
  cornerWeb={corners,center,strands,targets,bounds:{left:700,right:994,top:12,bottom:386}};
  return cornerWeb;
}
function spiderWeb(c,state) {
  const web=getWitchWeb(state);
  for(const [index,strand] of web.strands.entries()) {
    line(c,strand.map(p=>[p.x,p.y]),index<22?'#c5dce0a0':'#adc7d47a',index===0?1.1:.75);
  }
  if(state.spiderCaptured)return;
  c.save();c.translate(web.center.x,web.center.y);
  const pulse=clamp(state.spiderPulse),wiggle=state.reducedMotion?0:Math.sin((state.handTime??state.motionTime??0)*13)*pulse*.035;
  c.rotate(wiggle);
  if(state.spiderSurface)c.drawImage(state.spiderSurface,-56,-56,112,112);
  else {c.scale(1.6,1.6);drawInstrumentMiniature(c,'web-spider');}
  c.restore();
}

export function getWitchTargets(state = {}) {
  const transform=headTransform(state);
  const point=(x,y,r)=>({...headPoint({x,y},transform),r:r*transform.scale});
  const trails=getWitchTrails(state),candidates=trails.flatMap(strand=>{
    const stride=Math.max(1,Math.floor(strand.points.length/40));
    return strand.points.filter((p,i)=>i%stride===0);
  }).sort((a,b)=>Math.hypot(a.x-145,a.y-270)-Math.hypot(b.x-145,b.y-270));
  const ladle=getWitchLadle(state);
  const targets={nose:point(87+(clamp(state.nose??.5)-.5)*80,57,20),mouth:point(46,97+clamp(state.mouth)*5,23),eyes:point(22,26,19),spoon:{x:ladle.gx,y:ladle.gy,r:27},
    die:{...WITCH_LAYOUT.die},
    hat:getWitchHat(state).target,
    fabric:witchFabricTarget(state),
    tree:{...getWitchTree(state).target,r:35},web:{...getWitchWeb().targets[4],r:30},spider:{...getWitchWeb().center,r:38},
    broom:{...(clamp(state.flightLift)>.5?broomPoint({x:-200,y:126},state):parkedBroomPoint({x:0,y:123})),r:32},
    trail:{...candidates[0],r:28}};
  if(clamp(state.flightLift)>.05) {
    // A tight coil can move anywhere beside her hair. Pick an actually exposed
    // sample, using the same occlusion tests as input without recursing here.
    const exposed=candidates.find(p=>{
      const visible=warpWitchPoint(p,state);
      return hitTestWitch(visible.x,visible.y,state,{targets,trails})?.type==='trail';
    });
    if(exposed)targets.trail={...exposed,r:28};
  }
  return targets;
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
  const targetX=index===1?ladle.gx:((388+(492-388)*reach)*(1-lift)+flying.x*lift);
  const targetY=index===1?ladle.gy:((450+(613-450)*reach)*(1-lift)+flying.y*lift);
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
export function getWitchSpellArm(state={}) {
  const hand=handTransform(state),lift=clamp(state.flightLift),reach=clamp(state.handReach);
  const flying=broomPoint({x:-8,y:19},state),shoulder={x:365*(1-lift)+flying.x*lift,y:410*(1-lift)+flying.y*lift};
  const axis={x:Math.sin(hand.rotation),y:-Math.cos(hand.rotation)};
  const length=(74+reach*52)*(1-lift)+broomTransform(state).scale*116*lift;
  const elbow={x:hand.wrist.x-axis.x*length,y:hand.wrist.y-axis.y*length};
  return {shoulder,elbow,wrist:hand.wrist,axis,cuff:(12+reach*39)*(1-lift*.72)*(1+.3*lift),width:19*(1-lift)+broomTransform(state).scale*22*lift};
}
function reachingHand(c,state) {
  if(!state.handSurface)return;
  const hand=handTransform(state),{shoulder:s,elbow:e,wrist:w,cuff,width}=getWitchSpellArm(state);
  const nx=Math.cos(hand.rotation),ny=Math.sin(hand.rotation),ew=width*1.25;
  c.save();const fill=c.createLinearGradient(s.x,s.y,w.x,w.y);
  fill.addColorStop(0,'#542a5c');fill.addColorStop(.6,'#484064');fill.addColorStop(1,'#275a65');
  // Overlapping, consistently wound sleeve sections fill as one solid shape.
  // Filling after the outline hides internal edges at the rounded elbow.
  const upperLength=Math.max(1,Math.hypot(e.x-s.x,e.y-s.y));
  c.beginPath();
  const addSection=(a,b,x,y,aw,bw)=>{
    c.moveTo(a.x+x*aw,a.y+y*aw);c.lineTo(a.x-x*aw,a.y-y*aw);
    c.lineTo(b.x-x*bw,b.y-y*bw);c.lineTo(b.x+x*bw,b.y+y*bw);c.closePath();
  };
  addSection(s,e,-(e.y-s.y)/upperLength,(e.x-s.x)/upperLength,width,ew);
  addSection(e,w,nx,ny,ew,cuff);
  c.moveTo(e.x+ew,e.y);c.arc(e.x,e.y,ew,0,TAU);c.closePath();
  c.strokeStyle=INK;c.lineWidth=3;c.stroke();c.fillStyle=fill;c.fill();
  line(c,[[w.x-cuff*nx,w.y-cuff*ny],[w.x+cuff*nx,w.y+cuff*ny]],'#ddac87',2);
  drawHandModel(c,state,0);
  if(clamp(state.handReach)>.5)for(const tip of getFingerTips(state)) {
    const level=clamp(state.fingerLevels?.[tip.index]),cue=1-clamp(state.flightLift)*.61;
    const color=['#ffc17e','#e5ef82','#75f0cb','#86c9ff','#ee9ee9'][tip.index];
    ellipse(c,tip.x,tip.y,(13+level*9)*cue,(13+level*9)*cue,null,`${color}55`,state.selectedFinger===tip.index?2:1);
    if(level>.01)glow(c,tip.x,tip.y,(26+level*14)*cue,`${color}1a`);
  }
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
  const hidden=home.id==='hiccup'&&state.ghostScareHidden===true;
  // A faint remnant remains reachable between phrases. Pulses breathe within
  // the silhouette; only the explicit Hiccup scare leaves the background.
  return {...home,index,x:home.x+Math.sin(phase*.17+index*2.1)*12,
    y:home.y+Math.sin(phase*.23+index*1.7)*9,
    presence,pulse,phase,hidden,alpha:hidden?0:.025+presence*(.17+pulse*.025),
    rotation:Math.sin(phase*.13+index)*.055,scale:1};
}

/** Explicit scream age -> a solid portrait rushing from a captured stage
 * origin into the complete CSS-pixel viewport, including its letterbox. This
 * geometry never advances time or adds a hit surface over the instrument.
 * Reduced motion shows the same brief full portrait without zoom or travel. */
export function getWitchGhostScare(state = {}, width = 1000, height = 720) {
  const scare=state.ghostScare,age=scare?.age;
  if(scare?.id!=='hiccup'||!Number.isFinite(age)||age<0||age>=WITCH_GHOST_SCARE_DURATION)return null;
  const w=Number.isFinite(width)&&width>0?width:1000,h=Number.isFinite(height)&&height>0?height:720;
  const home=WITCH_LAYOUT.ghosts[2],stageScale=Math.min(w/1000,h/720);
  const origin=warpWitchPoint({x:clamp(scare.origin?.x??home.x,0,1000),y:clamp(scare.origin?.y??home.y,0,720)},state);
  const start={x:(w-1000*stageScale)/2+origin.x*stageScale,y:(h-720*stageScale)/2+origin.y*stageScale};
  const progress=clamp((age-.12)/.43),rush=state.reducedMotion?1:progress*progress;
  const fade=clamp((age-.92)/(WITCH_GHOST_SCARE_DURATION-.92));
  const size=home.size*stageScale+(Math.max(w,h)*1.28-home.size*stageScale)*rush;
  return {id:'hiccup',age,progress,x:start.x+(w/2-start.x)*rush,y:start.y+(h/2-start.y)*rush,
    width:size,height:size,alpha:1-fade*fade*(3-2*fade)};
}

const ghostSources=Object.freeze({
  creaturazoid:new URL('../../../assets/instruments/creaturazoid.webp',import.meta.url).href,
  monstroid:new URL('../../../assets/instruments/colony-syrinx.webp',import.meta.url).href,
  hiccup:new URL('../../../assets/witch/hiccup-head-bloody.webp',import.meta.url).href,
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
function ghostPortrait(c,ghost,solid=false) {
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
  // Keep the decoded original for the foreground rush: the spectral cache is
  // downsampled, tinted and faded along its lower half for background use only.
  if(solid)return portrait.image;
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
      // Keep Zombie Zoid's native blood-red skin readable through the mist.
      for(let channel=0;channel<3;channel++)rgba[p+channel]=ghost.id==='hiccup'
        ? Math.min(255,rgba[p+channel]*1.15+18)
        : gray*.6+tint[channel]*.4;
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
    const ghost=getWitchGhostPosition(index,state);
    if(ghost.hidden)continue;
    const portrait=ghostPortrait(c,ghost);
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

function foregroundGhostScare(c,width,height,state) {
  const scare=getWitchGhostScare(state,width,height);
  if(!scare)return;
  const portrait=ghostPortrait(c,WITCH_LAYOUT.ghosts[2],true);
  if(!portrait)return;
  c.save();c.globalAlpha*=scare.alpha;
  c.drawImage(portrait,scare.x-scare.width/2,scare.y-scare.height/2,scare.width,scare.height);
  c.restore();
}

function parkedBroomPoint(point) {
  const angle=-1.05,scale=.64;
  return {x:206+(Math.cos(angle)*point.x-Math.sin(angle)*point.y)*scale,
    y:434+(Math.sin(angle)*point.x+Math.cos(angle)*point.y)*scale};
}
function parkedBroom(c,state) {
  c.save();c.translate(206,434);c.rotate(-1.05);c.scale(.64,.64);broomShape(c,state);c.restore();
}
function broomShape(c,state) {
  const time=state.reducedMotion?0:(state.motionTime??0),wind=clamp(state.flightLift);
  path(c,'M-190,109 Q-250,85 -310,93 L-315,147 Q-251,153 -183,135 Z','#5f5140','#1e2022',2.3);
  for(let i=0;i<44;i++) {
    const spread=i/43,tipY=91+spread*59,tipX=-312+Math.sin(i*2.7)*10;
    const bend=wind*Math.sin(time*3+i*.7)*8;
    curve(c,[-184,116+spread*18,-230,100+spread*43,-273,tipY+bend,tipX,tipY+bend],['#b9a273','#887854','#d1b782','#584d37'][i%4],i%5===0?1.2:.65);
  }
  for(let i=0;i<5;i++)line(c,[[-203+i*2,106+i*.5],[-197+i*2,141]],i%2?'#ad9061':'#4b3829',1.9);
  curve(c,[-207,126,-104,110,44,132,166,94],'#201c1a',11);
  curve(c,[-207,126,-104,110,44,132,166,94],'#85694a',7.3);
  curve(c,[-207,124,-104,108,44,130,166,92],'#c4a276',1.1);
  for(let i=0;i<8;i++)curve(c,[-190+i*43,125-i*.2,-177+i*43,121-i*.4,-163+i*43,127-i*.6,-154+i*43,121-i*.8],i%2?'#40372c':'#d7b486',.55);
  ellipse(c,-25,119,6,2,null,'#4c3b29',1.1,-.2);
}

const FLYING_ROBE='M-67,-32 Q-103,-8 -102,45 Q-151,74 -181,85 L-156,111 Q-122,98 -117,119 Q-79,96 -66,111 Q-14,94 25,109 Q48,96 29,76 L-6,47 L-3,-5 Z';
const FLYING_ROBE_OUTLINE=[[-67,-32],[-98,-6],[-102,45],[-143,71],[-181,85],[-156,111],[-133,104],[-117,119],[-84,102],[-66,111],[-20,100],[25,109],[38,95],[29,76],[-6,47],[-3,-5]];
const FLYING_LEGS=[
  {path:'M-48,73 Q-78,91 -88,120 L-135,171 Q-147,184 -162,171 L-122,112 Q-105,80 -79,71 Z',fill:'#292a38',
    outline:[[-48,73],[-75,93],[-88,120],[-135,171],[-149,180],[-162,171],[-122,112],[-102,83],[-79,71]]},
  {path:'M-145,163 Q-157,179 -173,175 Q-189,190 -207,177 Q-200,201 -174,198 L-145,183 Z',fill:'#1a1e2c',
    outline:[[-145,163],[-157,179],[-173,175],[-189,186],[-207,177],[-200,193],[-183,200],[-174,198],[-145,183]]},
  {path:'M-12,78 Q-40,94 -44,129 L-100,182 Q-114,195 -134,178 L-80,120 Q-77,85 -49,73 Z',fill:'#41404d',
    outline:[[-12,78],[-37,96],[-44,129],[-100,182],[-116,191],[-134,178],[-80,120],[-74,92],[-49,73]]},
  {path:'M-116,171 Q-128,189 -143,184 Q-165,207 -187,188 Q-178,217 -151,214 L-117,193 Z',fill:'#252634',
    outline:[[-116,171],[-128,189],[-143,184],[-164,199],[-187,188],[-178,207],[-159,216],[-151,214],[-117,193]]},
];
function broomWitch(c, state) {
  const time = state.motionTime ?? state.time ?? 0;
  const pulse = clamp(state.flightPulse);
  const spark = state.event?.kind === 'spark' ? clamp(1-(state.event.age || 0)/1.2) : 0;
  const lift = clamp(state.flightLift ?? 1);
  const transform=broomTransform(state);
  c.save(); c.globalAlpha *= lift; c.translate(transform.x,transform.y); c.rotate(transform.rotation); c.scale(transform.scale,transform.scale);
  broomShape(c,state);
  // Two longer trailing legs remain joined beneath the robe, with distinct
  // boots so their silhouette reads clearly against the open flying scene.
  for(const leg of FLYING_LEGS)path(c,leg.path,leg.fill,INK,2.5);
  line(c,[[-156,176],[-166,184],[-158,190]],'#8b887e',1.6);
  line(c,[[-129,186],[-142,195],[-132,202]],'#c3ac87',1.8);
  path(c,FLYING_ROBE,'#3b2b47',INK,3);
  path(c, 'M-87,14 Q-107,77 -159,88 L-143,97 Q-120,80 -109,96 Q-68,75 -54,95 L-30,65 Z', '#58405b');
  curve(c,[-67,5,-40,50,-69,75,-81,90],'#80637b',1.3);
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
    c.save();c.globalAlpha=clamp(state.flightLift)*(.7+clamp(state.flightPulse)*.18);
    for(const strand of getWitchTrails(state)) {
      const points=strand.points.map(point=>[point.x,point.y]);
      line(c,points,INK,strand.width+3);line(c,points,strand.color,strand.width);
      c.setLineDash([strand.stripeLength,strand.stripeLength]);
      c.lineDashOffset=state.reducedMotion?0:-(state.flightPhase??0)*5;
      line(c,points,strand.stripe,strand.width);c.setLineDash([]);
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
}

export function getWitchObjectPosition(object, state = {}) {
  const id=typeof object==='string'?object:object?.id;
  const home=WITCH_LAYOUT.objects.find(entry=>entry.id===id)||WITCH_LAYOUT.objects[0];
  const live=typeof object==='object'?object:state.objects?.find(entry=>entry.id===id)||home;
  const branch=home.location==='tree'?getWitchTree(state).objects[id]:null;
  const x=live.dropped||live.dragging?(Number.isFinite(live.x)?live.x:home.x):(branch?.x??home.x);
  const y=live.dropped||live.dragging?(Number.isFinite(live.y)?live.y:home.y):(branch?.y??home.y);
  if(live.dropped) {
    const age=Math.max(0,live.dropAge||0),hold=home.phraseDuration||0,fall=clamp((age-hold)/(home.flightDuration||1.5));
    const travel=fall*fall*(3-2*fall),singing=age<hold;
    return {...home,...live,x:x+(600-x)*travel+(singing?Math.sin(age*11)*3:0),
      y:y+(544-y)*travel-Math.sin(fall*Math.PI)*118+(singing?Math.sin(age*7)*2:0),
      alpha:1-clamp((fall-.76)/.24),rotation:singing?Math.sin(age*8)*.05:fall*2.4,scale:1-fall*.55,r:home.r};
  }
  return {...home,...live,x,y,alpha:1,rotation:0,scale:1,r:home.r};
}

// Reuse the instruments' existing portraits as tiny visual tastes;
// no extra WebGL scene, model, or instrument controller is instantiated here.
const miniatureSources=Object.freeze(Object.fromEntries([...INGREDIENTS,{id:"web-spider",imageHref:"assets/instruments/spider-synth.webp"}].map(entry=>[
  entry.id,new URL('../../../'+entry.imageHref,import.meta.url).href,
])));
const miniatureImages=new WeakMap();
function drawInstrumentMiniature(c,id,size=miniatureSize(id)) {
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
    const ink=surface.getContext('2d');
    ink.drawImage(portrait.image,0,0,160,160);
    const pixels=ink.getImageData(0,0,160,160);removePortraitBackdrop(pixels);ink.putImageData(pixels,0,0);
    let left=160,top=160,right=-1,bottom=-1;
    for(let y=0;y<160;y++)for(let x=0;x<160;x++)if(pixels.data[(y*160+x)*4+3]>8) {
      left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);
    }
    portrait.bounds=right<left?{x:0,y:0,w:160,h:160}:{x:left,y:top,w:right-left+1,h:bottom-top+1};
    portrait.surface=surface;
  }
  const b=portrait.bounds,scale=Math.min(56/b.w,54/b.h)*size,width=b.w*scale,height=b.h*scale;
  // Rest the visible cutout, not its transparent image rectangle, on the board.
  // The web portrait remains centered beneath the live spider surface.
  const bottom=id==='web-spider'?height/2:27*size;
  c.drawImage(portrait.surface,b.x,b.y,b.w,b.h,-width/2,bottom-height,width,height);
  return true;
}



function instrumentShelves(c) {
  for(const shelf of WITCH_LAYOUT.shelves) {
    const {x,y,w,h}=shelf;
    path(c,`M${x},${y+13} L${x+10},${y} L${x+w-8},${y+5} L${x+w},${y+h} L${x-3},${y+h+4} Z`,'#080d15','#332a3c',3);
    for(const side of [x,x+w-9]) {
      path(c,`M${side},${y+8} L${side+8},${y+3} L${side+10},${y+h+9} L${side-2},${y+h+9} Z`,'#272333','#51404b',1.1);
      line(c,[[side+3,y+18],[side+5,y+h-14]],'#7260513d',1);
    }
    path(c,`M${x-2},${y-1} L${x+w+2},${y-1} L${x+w+4},${y+10} L${x-4},${y+11} Z`,'#362b3a','#89725b',.9);
    line(c,[[x+7,y+2],[x+w-6,y+2]],'#c39b726b',1.2);
    for(const row of shelf.rows) {
      path(c,`M${x+5},${row} L${x+w-4},${row-2} L${x+w-5},${row+10} L${x+4},${row+13} Z`,'#332837','#89725b',.8);
      line(c,[[x+10,row+3],[x+w-12,row+1]],'#b38f695c',1.1);
      for(let i=0;i<3;i++)line(c,[[x+18+i*(w-30)/3,row+8],[x+32+i*(w-30)/3,row+7]],'#0a0e17',1);
    }
  }
}
/** Fabric Filter's taut green-column / pink-row mesh fills the flying sky.
 * A local grab displaces the cloth while the four outer edges stay anchored.
 * The controller supplies the damped release, so a resting mesh stays still. */
function witchFabricPoint(u,v,state={}) {
  const gx=clamp(state.fabricGrabX??.16,.015,.985),gy=clamp(state.fabricGrabY??.14,.015,.985);
  const pullX=clamp(state.fabricPullX??0,-340,340),pullY=clamp(state.fabricPullY??0,-240,240);
  const magnitude=Math.hypot(pullX,pullY),radius=145+magnitude*.22;
  const x=u*1000,y=v*720,dx=x-gx*1000,dy=y-gy*720;
  const edge=(a,b)=>Math.min(1,a/.085,(1-a)/.085)*Math.min(1,b/.085,(1-b)/.085);
  const influence=Math.exp(-(dx*dx+dy*dy)/(radius*radius*2))*Math.min(1,edge(u,v)/Math.max(.025,edge(gx,gy)));
  const pinch=clamp(magnitude/220)*.19*influence;
  return {x:x+pullX*influence-dx*pinch,y:y+pullY*influence-dy*pinch};
}
function witchFabricTarget(state={}) {
  // An idle diagnostic/keyboard target stays in exposed sky even when the
  // last grab was released behind her body or across a delay strand.
  if(!state.fabricHeld)return {x:80,y:24,r:18};
  return {...witchFabricPoint(clamp(state.fabricGrabX??.16,.015,.985),clamp(state.fabricGrabY??.14,.015,.985),state),r:18};
}
export function getWitchFabric(state={}) {
  const strands=[],point=(u,v)=>witchFabricPoint(u,v,state);
  for(let column=0;column<=32;column++)strands.push({color:'#68f7a49e',points:Array.from({length:41},(_,i)=>point(column/32,i/40))});
  for(let row=0;row<=24;row++)strands.push({color:'#ff5cada8',points:Array.from({length:41},(_,i)=>point(i/40,row/24))});
  return {strands,target:witchFabricTarget(state),bounds:{left:0,right:1000,top:0,bottom:720}};
}
function fabricCloth(c,state) {
  const lift=clamp(state.flightLift);if(lift<=0)return;
  const fabric=getWitchFabric(state);
  c.save();c.globalAlpha*=lift*.72;
  for(const strand of fabric.strands)line(c,strand.points.map(p=>[p.x,p.y]),strand.color,.9);
  c.restore();
}
function ingredientObjects(c,state,foreground=false) {
  for(const home of WITCH_LAYOUT.objects) {
    const color=home.color;
    const object=getWitchObjectPosition(state.objects?.find(entry=>entry.id===home.id)||home,state);
    if(home.location==='web'&&!object.dropped&&!object.dragging)continue;
    if(Boolean(object.dropped||object.dragging)!==foreground)continue;
    if(object.dropped) {
      const age=Math.max(0,object.dropAge||0),envelope=Math.max(0,1-age/3.6);
      if(envelope>0) {
        c.save();c.globalAlpha*=envelope;
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
    c.save();c.translate(object.x,object.y);c.rotate(object.rotation);c.scale(object.scale,object.scale);c.globalAlpha*=object.alpha;
    if(home.location==='web'&&state.spiderSurface)c.drawImage(state.spiderSurface,-56,-56,112,112);
    else drawInstrumentMiniature(c,home.location==='web'?'web-spider':home.id,home.location==='web'?1.6:miniatureSize(home.id));
    c.restore();
  }
}
function hauntedMist(c,state) {
  const time=state.reducedMotion?0:(state.time||0),groundAlpha=c.globalAlpha;
  c.save();
  for(let i=0;i<4;i++) {
    const shift=Math.sin(time*.11+i*1.8)*80,y=605+i*22;
    c.globalAlpha=groundAlpha*(.035+.025*Math.sin(time*.23+i)**2);
    path(c,`M-80,${y+28} C${100+shift},${y-20} ${260+shift},${y+35} 410,${y-6} S760,${y-35} 1080,${y+8} L1080,${y+27} C800,${y-12} 624,${y+45} 370,${y+25} S93,${y+8} -80,${y+45} Z`,['#87bcbb','#b796bb','#87b4d7','#d2b68e'][i]);
  }
  c.restore();
}

// One bounded offscreen world lets mushroom ripples bend all of the artwork,
// including the actual skinned hand. Input uses the exact inverse below.
const worlds = new WeakMap();
function visualMode(state) {return Math.round(clamp(state.visualMode??state.trip,0,7));}
export function witchWarpX(y,state={}) {
  const mode=visualMode(state),shock=clamp(state.eyeShock);
  const time=state.reducedMotion?0:(state.warpTime??state.handTime??state.motionTime??0);
  let offset=0;
  if(mode>0&&mode<4)offset=(7+mode*4)*Math.sin(y*.024+time*1.8)+mode*2.5*Math.sin(y*.063-time*2.3);
  if(mode===4)offset=Math.sin(y*.017+time*5)*9+Math.sin(Math.floor(y/18)*2.3+time*8)*7;
  if(mode===5)offset=Math.sin(Math.floor(y/5)*12.73+Math.floor(time*14)*3.31)*16;
  if(mode===6)offset=Math.sin(Math.floor(y/24)*2.1+Math.floor(time*5)*.73)*18;
  if(mode===7)offset=((Math.floor(y/16)+Math.floor(time*11))%3-1)*17+Math.sin(y*.041+time*8)*7;
  if(mode>=4)offset*=.5;
  return offset+shock*((Math.floor(y/12)+Math.floor(time*9))%3-1)*12;
}
export function warpWitchPoint(point,state={},inverse=false) {
  if(!visualMode(state)&&!state.eyeShock)return {...point};
  // Match the center sample of the four-pixel strip actually painted below.
  const wave=witchWarpX(Math.floor(point.y/4)*4+2,state);
  return {...point,x:inverse?(point.x-wave+25)/1.05:point.x*1.05-25+wave};
}
function drawWorld(c,state) {
  c.clearRect(0,0,1000,720);c.lineCap='round';c.lineJoin='round';background(c,state);
  const ground=1-clamp(state.flightLift);
  if(ground<1)for(const flyby of getWitchBlechFlyby(state.flybyTime)) {
    c.save();c.globalAlpha*=(1-ground)*flyby.opacity;
    c.translate(flyby.x,flyby.y);c.rotate(flyby.angle);c.scale(flyby.scale,flyby.scale);
    drawInstrumentMiniature(c,'blech',2.1);c.restore();
  }
  if(ground>0) {
    c.save();c.globalAlpha*=ground;
    backgroundGhosts(c,state);instrumentShelves(c);livingTree(c,state);spiderWeb(c,state);
    c.restore();
  }
  flightScene(c,state);
  const mushroom=WITCH_LAYOUT.mushrooms[0];mushrooms(c,mushroom.x,mushroom.y,mushroom.scale);
  if(ground>0) {
    c.save();c.globalAlpha*=ground;
    ingredientObjects(c,state,false);parkedBroom(c,state);c.restore();
  }
  brewScene(c,state);
  if(state.flightLift>.001)broomWitch(c,state);
  reachingHand(c,state);
  ingredientObjects(c,state,true);
  fallingHat(c,state);
  if(ground>0) {
    c.save();c.globalAlpha*=ground;hauntedMist(c,state);drawWitchCat(c,state);drawWitchVisitors(c,state);c.restore();
  }
  spellDie(c,state);
}
/** Face, hat and hair only, with a transparent background for the catalogue. */
export function renderWitchFaceIcon(ctx,size=512) {
  ctx.clearRect(0,0,size,size);ctx.save();ctx.lineCap='round';ctx.lineJoin='round';
  witchHead(ctx,{hair:.58,nose:.72,hat:.5,mouth:.48,radius:.66,reducedMotion:true},size*.55,size*.48,size/510,-.025);ctx.restore();
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
  const mode=visualMode(state),palette=Math.round(clamp(state.palette,0,7));
  const hues=[0,38,82,132,178,218,268,315],from=hues[Math.round(clamp(state.paletteFrom??palette,0,7))],to=hues[Math.round(clamp(state.paletteTo??palette,0,7))];
  const blend=clamp(state.paletteMix??1),delta=((to-from+540)%360)-180;
  const hue=(from+delta*blend+[0,100,215,290,32,185,267,324][mode]+360)%360;
  const deform=mode>0||clamp(state.eyeShock)>0;
  world.color.filter=`hue-rotate(${hue}deg) saturate(${mode?1.6:1.25})`;world.color.drawImage(world.surface,0,0);
  if(mode===6) {
    if(!world.pixel){world.pixel=world.surface.cloneNode();world.pixel.width=250;world.pixel.height=180;world.pixelInk=world.pixel.getContext('2d');}
    world.pixelInk.drawImage(world.colored,0,0,250,180);world.color.imageSmoothingEnabled=false;world.color.filter='none';world.color.drawImage(world.pixel,0,0,1000,720);world.color.imageSmoothingEnabled=true;
  }
  if(deform)for(let y=0;y<720;y+=4)ctx.drawImage(world.colored,0,y,1000,4,witchWarpX(y+2,state)-25,y,1050,4);
  else ctx.drawImage(palette||blend<1?world.colored:world.surface,0,0);
  if(mode===4||mode===5) {
    const time=state.reducedMotion?0:(state.warpTime??state.handTime??0),frame=Math.floor(time*(mode===5?14:6));
    ctx.save();ctx.globalAlpha=mode===5?.08:.045;
    for(let i=0;i<120;i++) {
      const x=(i*173+frame*47)%1000,y=(i*89+frame*17)%720;
      ctx.fillStyle=i%3?'#96b6c5':'#110c1a';ctx.fillRect(x,y,mode===5?3:38,mode===5?2:1);
    }
    ctx.restore();
  }
  ctx.restore();
  // The original bloody face stays above hands, die, distortion and palette
  // filters, while the same canvas keeps every underlying gesture available.
  foregroundGhostScare(ctx,w,h,state);
}

function insideOutline(x,y,outline,padding=0) {
  let inside=false;
  for(let i=0,j=outline.length-1;i<outline.length;j=i++) {
    const [ax,ay]=outline[i],[bx,by]=outline[j];
    if((ay>y)!==(by>y)&&x<(bx-ax)*(y-ay)/(by-ay)+ax)inside=!inside;
    if(padding) {
      const dx=bx-ax,dy=by-ay,u=clamp(((x-ax)*dx+(y-ay)*dy)/Math.max(.01,dx*dx+dy*dy));
      if(Math.hypot(x-ax-dx*u,y-ay-dy*u)<padding)return true;
    }
  }
  return inside;
}
function unprojectWitchPoint(x,y,t) {
  const dx=(x-t.x)/t.scale,dy=(y-t.y)/t.scale,cos=Math.cos(t.rotation),sin=Math.sin(t.rotation);
  return {x:dx*cos+dy*sin,y:-dx*sin+dy*cos};
}
/** Solid foreground anatomy must not expose the fabric behind its silhouette.
 * Control hits run first; untouched clothes and boots still steer the flight. */
function witchBodyOccludes(x,y,state) {
  const lift=clamp(state.flightLift);
  const head=unprojectWitchPoint(x,y,headTransform(state));
  if(insideOutline(head.x,head.y,[[-35,-30],[-10,-50],[33,-34],[43,2],[60,33],[61,65],[60,87],[68,105],[50,120],[37,139],[18,145],[-8,113],[-37,84],[-45,18]],4)||
    insideOutline(head.x,head.y,[[-28,88],[11,91],[31,153],[-9,166],[-42,126]],3))return true;
  if(lift>.01) {
    const p=unprojectWitchPoint(x,y,broomTransform(state));
    if(insideOutline(p.x,p.y,FLYING_ROBE_OUTLINE,4)||FLYING_LEGS.some(leg=>insideOutline(p.x,p.y,leg.outline,4)))return true;
  }
  if(lift<.85&&insideOutline(x,y,[[398,360],[360,372],[328,413],[310,460],[285,531],[272,605],[321,619],[379,617],[445,599],[481,461],[478,420],[454,382],[427,361]],4))return true;
  const {shoulder,elbow,width}=getWitchSpellArm(state);
  const dx=elbow.x-shoulder.x,dy=elbow.y-shoulder.y,u=clamp(((x-shoulder.x)*dx+(y-shoulder.y)*dy)/Math.max(.01,dx*dx+dy*dy));
  if(Math.hypot(x-shoulder.x-dx*u,y-shoulder.y-dy*u)<width*(1+u*.25)+3)return true;
  // The ladle sleeve is a curved, broad ribbon behind her face.
  const hand=handTransform(state,1),flyShoulder=broomPoint({x:-2,y:2},state);
  const start={x:437*(1-lift)+flyShoulder.x*lift,y:408*(1-lift)+flyShoulder.y*lift};
  const middle={x:(start.x+hand.wrist.x)/2,y:(start.y+hand.wrist.y)/2+34*(1-lift)+15.6*lift};
  for(let i=0;i<=16;i++) {
    const t=i/16,v=1-t,cx=v*v*start.x+2*v*t*middle.x+t*t*hand.wrist.x,cy=v*v*start.y+2*v*t*middle.y+t*t*hand.wrist.y;
    if(Math.hypot(x-cx,y-cy)<(19*(1-lift)+11.7*lift)*(1-t)+42*hand.scale*t+3)return true;
  }
  for(let index=0;index<2;index++) {
    const t=handTransform(state,index),tips=getFingerTips(state,index);
    if(!tips.length)continue;
    if(Math.hypot(x-t.palm.x,y-t.palm.y)<Math.max(11,t.scale*48))return true;
    for(const tip of tips) {
      const dx=tip.x-t.palm.x,dy=tip.y-t.palm.y,u=clamp(((x-t.palm.x)*dx+(y-t.palm.y)*dy)/Math.max(.01,dx*dx+dy*dy));
      if(Math.hypot(x-t.palm.x-dx*u,y-t.palm.y-dy*u)<Math.max(5,t.scale*17))return true;
    }
  }
  return false;
}

/** Input remains attached to the visible world through extension and ripples. */
export function hitTestWitch(x, y, state = {}, prepared = null) {
  if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||y<0||x>1000||y>720) return null;
  const point=warpWitchPoint({x,y},state,true); x=point.x;y=point.y;
  // The die stays in front of the walking visitors and the flight noodles.
  const die=WITCH_LAYOUT.die;
  if(Math.hypot(x-die.x,y-die.y)<die.r+7)return {type:'dice'};
  const grounded=clamp(state.flightLift)<.85;
  const visitor=grounded?hitTestWitchVisitors(x,y,state):null;
  if(visitor)return visitor;
  if(grounded&&hitTestWitchCat(x,y,state))return {type:'cat'};
  const minRadius=Math.max(46,state.hitRadius||0);
  let nearestObject=null,objectDistance=Infinity,objectRadius=0;
  for(const [index,home] of (grounded?WITCH_LAYOUT.objects:[]).entries()) {
    if(home.location==='web')continue;
    const object=getWitchObjectPosition(state.objects?.find(entry=>entry.id===home.id)||home,state);
    const distance=Math.hypot(x-object.x,y-object.y);
    if(!object.dropped&&distance<Math.max(home.r+8,minRadius)&&distance<objectDistance) {
      nearestObject={type:'object',id:home.id,kind:home.kind,index};objectDistance=distance;objectRadius=home.r+8;
    }
  }
  const targets=prepared?.targets||getWitchTargets(state),ladle=getWitchLadle(state);
  if(state.handReach>.65) {
    let nearest=null,distance=minRadius;
    for(const tip of getFingerTips(state)) {
      const d=Math.hypot(x-tip.x,y-tip.y);
      if(d<distance) {nearest={type:'finger',index:tip.index};distance=d;}
    }
    if(nearest) {
      // In flight the two hands sit close together. A fingertip's enlarged
      // touch halo must not cover the center of the other hand's real palm.
      const gripDistance=Math.hypot(x-ladle.gx,y-ladle.gy);
      if(gripDistance<Math.max(27,minRadius*.75)&&distance>Math.max(10,gripDistance))return {type:'spoon'};
      return nearest;
    }
    const t=handTransform(state), local=transformHandPoint({x,y},state,0,true);
    const hit=state.pickHand?.(local.x,local.y,minRadius/t.scale);
    if(hit) return hit;
  }
  if(nearestObject&&objectDistance<objectRadius)return nearestObject;
  const faceHits=['nose','mouth','eyes','spoon'].map(type=>({type,distance:type==='spoon'?Math.hypot(x-ladle.gx,y-ladle.gy):Math.hypot(x-targets[type].x,y-targets[type].y),radius:type==='spoon'?Math.max(27,minRadius*.75):Math.max(targets[type].r,Math.min(27,minRadius*.38))})).filter(hit=>hit.distance<hit.radius).sort((a,b)=>a.distance/a.radius-b.distance/b.radius);
  if(faceHits.length)return {type:faceHits[0].type};
  // The left hand's long fingers share its spoon gesture. The foreground
  // spell-casting fingers above retain their own independent controls.
  const spoonHand=handTransform(state,1);
  for(const tip of getFingerTips(state,1)) {
    const dx=tip.x-spoonHand.palm.x,dy=tip.y-spoonHand.palm.y;
    const along=clamp(((x-spoonHand.palm.x)*dx+(y-spoonHand.palm.y)*dy)/Math.max(.01,dx*dx+dy*dy));
    if(Math.hypot(x-spoonHand.palm.x-dx*along,y-spoonHand.palm.y-dy*along)<Math.max(8,spoonHand.scale*17,minRadius*.2))return {type:'spoon'};
  }
  if((state.hatClicks??0)<3&&Math.hypot(x-targets.hat.x,y-targets.hat.y)<targets.hat.r)return {type:'hat'};
  for(const panel of getWitchHat(state).panels) {
    let inside=false;
    for(let i=0,j=panel.length-1;i<panel.length;j=i++) {
      const a=panel[i],b=panel[j];
      if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)inside=!inside;
    }
    if(inside)return {type:'hat'};
  }
  // Foreground silk and the spider remain playable over the moon and branches.
  if(grounded) {
    if(!state.spiderCaptured&&Math.hypot(x-targets.spider.x,y-targets.spider.y)<Math.max(targets.spider.r,minRadius*.55))return {type:'spider'};
    const web=getWitchWeb(),{left,right,top,bottom}=web.bounds;
    if(x>left-12&&x<right+12&&y>top-12&&y<bottom+12) {
      for(const strand of web.strands)for(let i=1;i<strand.length;i++) {
        const a=strand[i-1],b=strand[i],dx=b.x-a.x,dy=b.y-a.y,u=clamp(((x-a.x)*dx+(y-a.y)*dy)/Math.max(.01,dx*dx+dy*dy));
        if(Math.hypot(x-a.x-dx*u,y-a.y-dy*u)<12) {
          const angle=(Math.atan2(y-web.center.y,x-web.center.x)+TAU)%TAU;
          return {type:'web',index:Math.min(6,Math.floor(angle/TAU*7))};
        }
      }
    }
  }
  const moon=WITCH_LAYOUT.moon;
  if(Math.hypot(x-moon.x,y-moon.y)<Math.max(moon.r+12,minRadius)) return {type:'moon'};
  for(const m of WITCH_LAYOUT.mushrooms)for(const [mx,my,size] of [[0,0,1],[34,12,.67],[-23,15,.48]]) {
    const scale=m.scale*size,cx=m.x+mx*m.scale,cy=m.y+my*m.scale,halo=Math.min(12,minRadius*.18);
    // Match the enlarged caps and stems, leaving the exposed pot edge playable.
    if(((x-cx)/(26*scale+halo))**2+((y-cy+10*scale)/(19*scale+halo))**2<1||
      Math.abs(x-cx)<8*scale+halo&&y>cy&&y<cy+31*scale+halo)return {type:'mushrooms'};
  }
  const handPoint=transformHandPoint({x:590,y:415},state);
  if(Math.hypot(x-handPoint.x,y-handPoint.y)<Math.max(38,minRadius)) return {type:'hand'};
  if(state.handSurface) {
    // Follow the visible tapered forearm, including its solid rounded elbow.
    const {elbow,wrist,axis,cuff,width}=getWitchSpellArm(state);
    const dx=x-elbow.x,dy=y-elbow.y,length=Math.hypot(wrist.x-elbow.x,wrist.y-elbow.y);
    const along=(dx*axis.x+dy*axis.y)/length,halfWidth=width*1.25;
    if(Math.hypot(dx,dy)<halfWidth+2||along>=0&&along<=1&&
      Math.abs(-dx*axis.y+dy*axis.x)<halfWidth+(cuff-halfWidth)*along+2)return {type:'sleeve'};
  }
  // Visible locks sit in front of the background ghosts and scenery.
  // Hands, utensil, face, hat and shelf icons retain priority.
  const hair=getWitchHair(state),hairRadius=Math.min(28,Math.max(12*hair.scale,minRadius*.32));
  for(const strand of hair.strands.slice(0,12))for(let i=7;i<strand.points.length;i++) {
    const a=strand.points[i-1],b=strand.points[i],dx=b.x-a.x,dy=b.y-a.y;
    const along=clamp(((x-a.x)*dx+(y-a.y)*dy)/Math.max(.01,dx*dx+dy*dy));
    if(Math.hypot(x-a.x-dx*along,y-a.y-dy*along)<hairRadius)return {type:'hair'};
  }
  {
    const flying=clamp(state.flightLift)>.5,project=p=>flying?broomPoint(p,state):parkedBroomPoint(p);
    const a=project({x:-295,y:120}),b=project({x:162,y:96}),dx=b.x-a.x,dy=b.y-a.y;
    const along=clamp(((x-a.x)*dx+(y-a.y)*dy)/(dx*dx+dy*dy));
    if(Math.hypot(x-a.x-dx*along,y-a.y-dy*along)<Math.max(18,minRadius*.45))return {type:'broom'};
  }
  // The potion and mushrooms sit in front of the dense sky noodles, leaving
  // their full gesture surfaces available throughout flight.
  const pot=WITCH_LAYOUT.cauldron;
  if(((x-pot.x)/(pot.rx+30))**2+((y-pot.y)/(pot.ry+33))**2<1) return {type:'stir'};
  if(insideOutline(x,y,[[412,520],[416,570],[439,615],[477,643],[530,658],[595,662],[674,656],[734,632],[769,590],[788,540],[788,520]],4))return {type:'stir'};
  if(insideOutline(x,y,[[454,679],[475,650],[722,650],[743,685],[732,704],[469,700]],4))return {type:'stir'};
  if(clamp(state.flightLift)>.05&&witchBodyOccludes(x,y,state))return {type:'flight'};
  if(clamp(state.flightLift)>.05) {
    for(const {points:trail} of prepared?.trails||getWitchTrails(state))for(let i=1;i<trail.length;i++) {
      const a=trail[i-1],b=trail[i],dx=b.x-a.x,dy=b.y-a.y,along=clamp(((x-a.x)*dx+(y-a.y)*dy)/Math.max(.01,dx*dx+dy*dy));
      if(Math.hypot(x-a.x-dx*along,y-a.y-dy*along)<Math.max(12,minRadius*.35))return {type:'trail'};
    }
  }
  if(!grounded)return {type:'fabric'};
  for(const segment of getWitchTree(state).segments) {
    const {a,b}=segment,dx=b.x-a.x,dy=b.y-a.y,u=clamp(((x-a.x)*dx+(y-a.y)*dy)/Math.max(.01,dx*dx+dy*dy));
    if(Math.hypot(x-a.x-dx*u,y-a.y-dy*u)<12)return {type:'tree'};
  }
  let ghostHit=null,ghostDistance=Infinity;
  for(let index=0;index<WITCH_LAYOUT.ghosts.length;index++) {
    const ghost=getWitchGhostPosition(index,state),distance=Math.hypot(x-ghost.x,y-ghost.y);
    if(ghost.hidden)continue;
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
  // The mesh fills the sky, including the open space between its threads.
  // It stays behind every visible control and the cupboard during takeoff.
  if(clamp(state.flightLift)>.05) {
    if(WITCH_LAYOUT.shelves.some(s=>x>s.x-4&&x<s.x+s.w+4&&y>s.y-2&&y<s.y+s.h+12))return null;
    return {type:'fabric'};
  }
  if(state.scene==='flight') return {type:'flight'};
  if(Math.hypot(x-ladle.hx,y-ladle.hy)<Math.max(35,minRadius*.8)) return {type:'spoon'};
  return null;
}
