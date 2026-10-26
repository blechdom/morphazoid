import { createQuadrupedState, deriveQuadrupedPose } from '../quadruped/quadruped.js';
import { deriveQuadrupedVisualRig, drawQuadrupedConstellationRig } from '../quadruped/quadruped-visual-skins.js';
import { createWitchCatClock, WITCH_CAT_GAITS, WITCH_CAT_PERIOD, WITCH_CAT_DURATION, witchCatUnicornFrame } from './witch-cat-model.js';
import { applyWitchAnimalCapture, witchAnimalGroundVisibility } from './witch-visitors-model.js';

// Reuse Quadruped's authored cat-prowl score, feline morphology, articulated
// feet, spine and head. This is a small coat/presentation adapter, with no
// instrument controller, audio graph, extra renderer, timer or asset lifecycle.
const CAT_SCORES = new Map(WITCH_CAT_GAITS.map(gait => [gait, createQuadrupedState('cat', gait)]));
const UNICORN_SCORE = createQuadrupedState('unicorn', 'gallop');
const LOCAL_WIDTH = 500, LOCAL_HEIGHT = 260, LOCAL_GROUND = 240;
export const WITCH_CAT_SCALE = 1.5;
const GROUND = 700, MARGIN = 130 * WITCH_CAT_SCALE;
const TAU = Math.PI * 2;
const clamp = value => Math.max(0, Math.min(1, value));

/** Read the owner's Play-only clock. The first visit starts at 30 seconds;
 * freezing that clock freezes both travel and paws, including mid-crossing. */
export function getWitchCatFrame(state = {}) {
  // Once Audio exists, this is the exact worklet snapshot. Before arming,
  // the owner advances the same model from its silent primary-Play clock.
  const source = state.catFrame;
  const clock = source ? createWitchCatClock(source.time, state, source)
    : createWitchCatClock(state.performanceTime, state);
  const { time, visit, active, speed } = clock;
  const elapsed = time - visit * WITCH_CAT_PERIOD;
  const progress = active ? clock.progress : 0;
  const direction = visit % 2 === 1 ? 1 : -1;
  const frame = applyWitchAnimalCapture({
    active, visit, progress, direction, elapsed: active ? elapsed : 0,
    visitStartedAt:visit*WITCH_CAT_PERIOD,visitEndsAt:visit*WITCH_CAT_PERIOD+WITCH_CAT_DURATION/.5,clockTime:time,
    x: direction > 0 ? -MARGIN + progress * (1000 + MARGIN * 2) : 1000 + MARGIN - progress * (1000 + MARGIN * 2),
    y: GROUND,
    position: clock.position,
    alpha: active ? clamp(elapsed / .25) * clamp((1 - progress) * WITCH_CAT_DURATION / speed / .25) : 0,
    source: 'quadruped', id:'cat', animalId: 'cat', behaviorId: clock.gait,
  },state);
  const capture = state.capturedAnimals?.cat;
  if (frame.captured && capture.unicorn === true) {
    const escape = witchCatUnicornFrame(time - capture.startedAt, frame.direction);
    if (escape) {
      Object.assign(frame, escape);
      frame.visible = frame.active && frame.alpha > .01 && witchAnimalGroundVisibility(state) > .01;
    }
  }
  return frame;
}

function path(context, points, close = false, smooth = false) {
  context.beginPath();
  if (!points.length) return;
  if (smooth) {
    const first = points[0], last = points.at(-1);
    context.moveTo((first.x + last.x) / 2, (first.y + last.y) / 2);
    points.forEach((point, index) => {
      const next = points[(index + 1) % points.length];
      context.quadraticCurveTo(point.x, point.y, (point.x + next.x) / 2, (point.y + next.y) / 2);
    });
  } else points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
  if (close) context.closePath();
}

function coat(context, points, fill, smooth = false, outline = '#626274') {
  path(context, points, true, smooth);
  context.fillStyle = fill; context.fill();
  context.strokeStyle = outline; context.lineWidth = .85; context.stroke();
}

function drawLeg(context, rig, leg, palette = null) {
  context.save(); context.globalAlpha *= leg.far ? .66 : 1;
  path(context, leg.points);
  context.lineWidth = rig.scale * rig.morphology.legWidth + 1.8;
  context.strokeStyle = palette ? palette[1] : '#515366'; context.stroke();
  context.lineWidth -= 1.35; context.strokeStyle = palette ? (leg.far ? palette[1] : palette[0]) : leg.far ? '#08080d' : '#14141c'; context.stroke();
  const foot = leg.points.at(-1);
  context.fillStyle = palette ? (leg.far ? palette[1] : palette[3]) : leg.far ? '#07070c' : '#191a22';
  context.beginPath(); context.ellipse(foot.x + 1.6, foot.y, rig.scale * rig.morphology.footWidth * .7, 2.35, 0, 0, TAU); context.fill();
  context.restore();
}

function drawCoat(context, rig, frame) {
  const { scale, center, morphology } = rig;
  if(!frame.diving) {
    context.fillStyle = '#00000054'; context.beginPath();
    context.ellipse(center.x - scale * .12, LOCAL_GROUND + 2, scale * .91, 5, 0, 0, TAU); context.fill();
  }
  for (const leg of rig.legs) if (leg.far) drawLeg(context, rig, leg);
  path(context, rig.tail); context.strokeStyle = '#606175'; context.lineWidth = 4.5; context.stroke();
  context.strokeStyle = '#11121b'; context.lineWidth = 2.9; context.stroke();
  const fur = context.createLinearGradient(0, center.y - scale * .35, 0, center.y + scale * .35);
  fur.addColorStop(0, '#272630'); fur.addColorStop(.45, '#11121b'); fur.addColorStop(1, '#020308');
  coat(context, rig.body, fur, true);
  // Short, fixed-count marks follow the actual feline spine rather than a
  // separate generic cat silhouette or a costly particle-fur system.
  context.save(); path(context, rig.body, true, true); context.clip();
  context.strokeStyle = '#82788630'; context.lineWidth = .75;
  for (let index = 0; index < 18; index++) {
    const x = ((index * .618033) % 1 - .5) * rig.bodyWidth;
    const y = ((index * .381966) % 1 - .5) * rig.bodyHeight;
    const a = rig.bodyPoint(x, y), b = rig.bodyPoint(x - .06, y + .02);
    path(context, [a,b]); context.stroke();
  }
  context.restore();
  path(context, rig.neck); context.strokeStyle = '#10111a'; context.lineWidth = scale * .16; context.stroke();
  for (const feature of rig.features) coat(context, feature.points, '#15141e');
  for (const leg of rig.legs) if (!leg.far) drawLeg(context, rig, leg);
  coat(context, rig.upperSkull, '#171722', true);
  coat(context, rig.mouth.jaw, '#0c0d14', true);
  if (rig.mouth.strength > .01) {
    path(context, rig.mouth.opening, true);
    context.fillStyle = '#df7b9b'; context.fill();
    context.strokeStyle = '#f4bdc3'; context.lineWidth = .7; context.stroke();
  }
  const muzzle = rig.headPoint(.36, .18);
  context.fillStyle = '#393340'; context.beginPath();
  context.ellipse(muzzle.x, muzzle.y, scale * morphology.headScale * .19, scale * morphology.headScale * .13, 0, 0, TAU); context.fill();
  context.strokeStyle = '#9286a4aa'; context.lineWidth = .65;
  for (const side of [-1,1]) for (let index = 0; index < 3; index++) {
    path(context, [rig.headPoint(.35, side * (.12 + index * .06)), rig.headPoint(.78 + rig.mouth.strength * .16, side * (.14 + index * .1 + rig.mouth.strength * .12))]); context.stroke();
  }
  // The source instrument's constellation skin remains a quiet seam in the
  // black coat, preserving its recognizable articulated, laser-line anatomy.
  context.save(); context.globalAlpha *= .12;
  drawQuadrupedConstellationRig(context, rig); context.restore();
}

function drawLaserEye(context, rig, frame) {
  const eye = rig.headPoint(.14, -.18), length = 38 + Math.sin(frame.position * .18) * 7 + rig.mouth.strength * 28;
  const end = {x: eye.x + length, y: eye.y + 4};
  const beam = context.createLinearGradient(eye.x, eye.y, end.x, end.y);
  beam.addColorStop(0, '#c9ffbfb0'); beam.addColorStop(.3, '#91e8bb50'); beam.addColorStop(1, '#91e8bb00');
  path(context, [eye,end]); context.strokeStyle = beam; context.lineWidth = 1.05; context.stroke();
  context.shadowColor = '#9bff9b'; context.shadowBlur = 5;
  context.fillStyle = '#d8ffad'; context.beginPath(); context.ellipse(eye.x, eye.y, 2.7, 1.65, -.12, 0, TAU); context.fill();
  context.shadowBlur = 0; context.fillStyle = '#06120b';
  context.beginPath(); context.ellipse(eye.x + .35, eye.y, .45, 1.4, 0, 0, TAU); context.fill();
}

function drawUnicorn(context, rig, frame) {
  const { scale, center, animal } = rig;
  const [pearl, lilac, cyan, pink, gold] = animal.palette;
  if (frame.runProgress > 0) {
    context.fillStyle = '#35203f55'; context.beginPath();
    context.ellipse(center.x, LOCAL_GROUND + 2, scale * .85, 5, 0, 0, TAU); context.fill();
  }
  for (const leg of rig.legs) if (leg.far) drawLeg(context, rig, leg, animal.palette);
  // Coat the native equid tail and articulated anatomy rather than swapping
  // in a generic horse sprite. All five colors belong to Quadruped's unicorn.
  for (const [color, width] of [[lilac, 13], [pink, 8], [cyan, 3]]) {
    path(context, rig.tail); context.strokeStyle = color; context.lineWidth = width; context.stroke();
  }
  const coatFill = context.createLinearGradient(0, center.y - scale * .4, 0, center.y + scale * .4);
  coatFill.addColorStop(0, pearl); coatFill.addColorStop(.6, pearl); coatFill.addColorStop(1, lilac);
  coat(context, rig.body, coatFill, true, lilac);
  path(context, rig.neck); context.strokeStyle = lilac; context.lineWidth = scale * .32; context.stroke();
  context.strokeStyle = pearl; context.lineWidth = scale * .27; context.stroke();
  for (let index = 0; index < 4; index++) {
    const root = rig.headPoint(-.25 - index * .045, -.34);
    const end = rig.bodyPoint(.26 - index * .045, -.2);
    const flow = Math.sin(frame.unicornAge * 9 + index * .8) * scale * .045;
    context.beginPath(); context.moveTo(root.x, root.y);
    context.quadraticCurveTo(root.x - scale * (.22 + index * .035), root.y + scale * .28 + flow, end.x, end.y + flow);
    context.strokeStyle = index % 2 ? cyan : pink; context.lineWidth = 3.5; context.stroke();
  }
  for (const leg of rig.legs) if (!leg.far) drawLeg(context, rig, leg, animal.palette);
  coat(context, rig.upperSkull, pearl, true, lilac);
  coat(context, rig.mouth.jaw, pearl, true, lilac);
  for (const feature of rig.features) coat(context, feature.points, feature.kind === 'horn' ? gold : pearl, false, lilac);
  const eye = rig.headPoint(.14, -.18), nostril = rig.headPoint(.68, .18);
  context.fillStyle = '#39264b'; context.beginPath();
  context.ellipse(eye.x, eye.y, 2, 1.8, 0, 0, TAU); context.fill();
  context.beginPath(); context.ellipse(nostril.x, nostril.y, 1.3, .9, 0, 0, TAU); context.fill();
  context.fillStyle = cyan; context.beginPath();
  context.ellipse(eye.x + .45, eye.y - .45, .7, .7, 0, 0, TAU); context.fill();
  drawUnicornSparkles(context, rig, frame);
}

function drawUnicornSparkles(context, rig, frame) {
  // Eighteen clock-derived glyphs have no particle queue, wall clock, or
  // randomness. A stopped performance freezes the sparkle trail too.
  for (let index = 0; index < 18; index++) {
    const phase = (frame.unicornAge * (1.1 + index % 3 * .13) + index * .618033) % 1;
    const strength = Math.sin(phase * Math.PI);
    const point = index < 5
      ? rig.headPoint(-.6 + index * .33, -1.2 - phase * .6)
      : rig.bodyPoint(-.85 - phase * .8 + index % 4 * .24, -.65 + index % 5 * .24 - phase * .28);
    const radius = 1.6 + strength * (index % 3 + 2);
    context.save(); context.globalAlpha *= strength * .85;
    context.strokeStyle = rig.animal.palette[1 + index % 4]; context.lineWidth = 1.15;
    path(context, [{x:point.x-radius,y:point.y}, {x:point.x+radius,y:point.y}]); context.stroke();
    path(context, [{x:point.x,y:point.y-radius}, {x:point.x,y:point.y+radius}]); context.stroke();
    context.restore();
  }
}

function catRig(state, frame) {
  const unicorn = frame.animalId === 'unicorn';
  const score = unicorn ? UNICORN_SCORE : CAT_SCORES.get(frame.behaviorId);
  const meow = Number.isFinite(state.catMeow) ? clamp(state.catMeow) : 0;
  const pose = { ...deriveQuadrupedPose(score, frame.position) };
  if (!unicorn) pose.headPerformance = { strength: meow, headToss: meow * .3 };
  return deriveQuadrupedVisualRig(pose, LOCAL_WIDTH, LOCAL_HEIGHT, LOCAL_GROUND, score);
}

function scenePoint(point, frame) {
  const x=(point.x-LOCAL_WIDTH/2)*frame.direction*WITCH_CAT_SCALE*frame.scale,y=(point.y-LOCAL_GROUND)*WITCH_CAT_SCALE*frame.scale;
  const cos=Math.cos(frame.rotation),sin=Math.sin(frame.rotation);
  return {x:frame.x+x*cos-y*sin,y:frame.y+x*sin+y*cos};
}

function hitEllipse(points, frame) {
  const xs=points.map(point=>point.x),ys=points.map(point=>point.y);
  const lowX=Math.min(...xs),highX=Math.max(...xs),lowY=Math.min(...ys),highY=Math.max(...ys);
  return {...scenePoint({x:(lowX+highX)/2,y:(lowY+highY)/2},frame),rx:(highX-lowX)*WITCH_CAT_SCALE/2,ry:(highY-lowY)*WITCH_CAT_SCALE/2};
}

export function getWitchCatTargets(state = {}) {
  const frame=getWitchCatFrame(state);
  if(!frame.visible||frame.captured)return null;
  const rig=catRig(state,frame);
  return {body:hitEllipse(rig.body,frame),head:hitEllipse([...rig.skull,...rig.mouth.jaw,...rig.features.flatMap(feature=>feature.points)],frame)};
}

/** The foreground cat gets input only on its moving anatomy. */
export function hitTestWitchCat(x,y,state = {}) {
  const frame=getWitchCatFrame(state);
  if(!frame.visible||frame.captured)return false;
  const rig=catRig(state,frame),pad=Math.min(18,Math.max(8,(state.hitRadius||46)*.18));
  for(const points of [rig.body,[...rig.skull,...rig.mouth.jaw,...rig.features.flatMap(feature=>feature.points)]]) {
    const target=hitEllipse(points,frame);
    if(((x-target.x)/(target.rx+pad))**2+((y-target.y)/(target.ry+pad))**2<=1)return true;
  }
  for(const chain of [rig.tail,rig.neck,...rig.legs.map(leg=>leg.points)])for(let i=1;i<chain.length;i++) {
    const a=scenePoint(chain[i-1],frame),b=scenePoint(chain[i],frame),dx=b.x-a.x,dy=b.y-a.y;
    const along=clamp(((x-a.x)*dx+(y-a.y)*dy)/Math.max(.01,dx*dx+dy*dy));
    if(Math.hypot(x-a.x-dx*along,y-a.y-dy*along)<pad)return true;
  }
  return false;
}

/** Paint after the scene in its canonical 1000×720 coordinates. */
export function drawWitchCat(context, state = {}) {
  const frame = getWitchCatFrame(state);
  if (!frame.visible) return frame;
  const rig = catRig(state,frame);
  context.save(); context.globalAlpha *= frame.alpha;
  context.translate(frame.x, frame.y); context.rotate(frame.rotation);
  context.scale(frame.direction * WITCH_CAT_SCALE * frame.scale, WITCH_CAT_SCALE * frame.scale);
  context.translate(-LOCAL_WIDTH / 2, -LOCAL_GROUND);
  context.lineJoin = 'round'; context.lineCap = 'round';
  if (frame.animalId === 'unicorn') drawUnicorn(context, rig, frame);
  else { drawCoat(context, rig, frame); drawLaserEye(context, rig, frame); }
  context.restore();
  return frame;
}
