import { createQuadrupedState, deriveQuadrupedPose } from '../quadruped/quadruped.js';
import { deriveQuadrupedVisualRig } from '../quadruped/quadruped-visual-skins.js';
import { WITCH_VISITORS, getWitchVisitors } from './witch-visitors-model.js';
export { WITCH_VISITORS, getWitchVisitors } from './witch-visitors-model.js';

// Reuse the real Mouse and Lizard body/limb rigs and authored gaits. These
// small coats have no separate instrument, audio graph, assets, or lifecycle.
const SCORES=new Map(WITCH_VISITORS.map(visitor=>[visitor.id,createQuadrupedState(visitor.id,visitor.behaviorId)]));
const LOCAL_WIDTH=500,LOCAL_HEIGHT=260,LOCAL_GROUND=240,TAU=Math.PI*2;
const COATS=Object.freeze({
  mouse:Object.freeze({body:'#352b3c',head:'#514052',edge:'#9d8198',ear:'#9a657b',eye:'#e8cba3',tail:'#8f7185'}),
  lizard:Object.freeze({body:'#133f3b',head:'#254d3c',edge:'#98af7a',ear:'#688b5d',eye:'#f0b95d',tail:'#678e79'}),
});
const clamp=value=>Math.max(0,Math.min(1,value));
const definition=id=>WITCH_VISITORS.find(visitor=>visitor.id===id);
function visitorRig(frame) {
  const score=SCORES.get(frame.id),pose=deriveQuadrupedPose(score,frame.position);
  return deriveQuadrupedVisualRig(pose,LOCAL_WIDTH,LOCAL_HEIGHT,LOCAL_GROUND,score);
}
function path(context,points,close=false) {
  context.beginPath();
  points.forEach((point,index)=>index?context.lineTo(point.x,point.y):context.moveTo(point.x,point.y));
  if(close)context.closePath();
}
function shape(context,points,fill,stroke,width=1) {
  path(context,points,true);context.fillStyle=fill;context.fill();
  context.strokeStyle=stroke;context.lineWidth=width;context.stroke();
}
function stroke(context,points,color,width=1) {
  path(context,points);context.strokeStyle=color;context.lineWidth=width;context.stroke();
}
function leg(context,rig,limb,coat,id) {
  context.save();context.globalAlpha*=limb.far?.55:1;
  stroke(context,limb.points,coat.edge,rig.scale*rig.morphology.legWidth+1.6);
  stroke(context,limb.points,coat.body,Math.max(1,rig.scale*rig.morphology.legWidth));
  const foot=limb.points.at(-1);
  for(let toe=0;toe<(id==='lizard'?3:2);toe++) {
    const spread=toe-(id==='lizard'?1:.5);
    stroke(context,[foot,{x:foot.x+4+Math.abs(spread),y:foot.y+spread*2}],coat.edge,.8);
  }
  context.restore();
}
function coat(context,rig,frame) {
  const ink=COATS[frame.id],mouse=frame.id==='mouse';
  if(!frame.diving) {
    context.fillStyle='#00000050';context.beginPath();
    context.ellipse(rig.center.x,LOCAL_GROUND+1,rig.scale*.95,3,0,0,TAU);context.fill();
  }
  for(const limb of rig.legs)if(limb.far)leg(context,rig,limb,ink,frame.id);
  stroke(context,rig.tail,ink.edge,mouse?2.6:4.6);
  stroke(context,rig.tail,ink.body,mouse?1.3:2.8);
  shape(context,rig.body,ink.body,ink.edge,1.1);
  stroke(context,rig.neck,ink.body,rig.scale*(mouse?.12:.1));
  for(const limb of rig.legs)if(!limb.far)leg(context,rig,limb,ink,frame.id);
  for(const feature of rig.features)shape(context,feature.points,ink.ear,ink.edge,.8);
  shape(context,rig.upperSkull,ink.head,ink.edge,.9);
  shape(context,rig.mouth.jaw,ink.body,ink.edge,.7);
  if(mouse) {
    for(const side of [-1,1])for(let index=0;index<2;index++) {
      stroke(context,[rig.headPoint(.57,.12+side*.06),rig.headPoint(1.03+index*.12,side*(.15+index*.16))],ink.edge,.55);
    }
    const nose=rig.headPoint(.88,.18);context.fillStyle=ink.ear;
    context.beginPath();context.ellipse(nose.x,nose.y,1.4,1,0,0,TAU);context.fill();
  } else {
    // Scales follow the articulated body rather than a separate drifting skin.
    for(let index=0;index<11;index++) {
      const point=rig.bodyPoint(-.63+index*.12,(index%2?1:-1)*.055);
      stroke(context,[{x:point.x-1.5,y:point.y},{x:point.x,y:point.y-1.6},{x:point.x+1.5,y:point.y}],ink.edge,.65);
    }
    const flick=Math.max(0,Math.sin(frame.position*.13))**12;
    if(flick>.1)stroke(context,[rig.headPoint(.75,.1),rig.headPoint(.75+flick*.65,.13)],'#c58b9f',.8);
  }
  const eye=rig.headPoint(mouse?.21:.29,mouse?-.14:-.17);
  context.fillStyle=ink.eye;context.beginPath();context.ellipse(eye.x,eye.y,1.7,1.2,0,0,TAU);context.fill();
  context.fillStyle='#080c10';context.beginPath();context.ellipse(eye.x+.3,eye.y,.45,1,0,0,TAU);context.fill();
}
function scenePoint(point,frame) {
  const scale=definition(frame.id).scale*frame.scale;
  const x=(point.x-LOCAL_WIDTH/2)*frame.direction*scale,y=(point.y-LOCAL_GROUND)*scale;
  const cos=Math.cos(frame.rotation),sin=Math.sin(frame.rotation);
  return {x:frame.x+x*cos-y*sin,y:frame.y+x*sin+y*cos};
}
function ellipseTarget(points,frame) {
  const projected=points.map(point=>scenePoint(point,frame));
  const xs=projected.map(point=>point.x),ys=projected.map(point=>point.y);
  const lowX=Math.min(...xs),highX=Math.max(...xs),lowY=Math.min(...ys),highY=Math.max(...ys);
  return {x:(lowX+highX)/2,y:(lowY+highY)/2,rx:(highX-lowX)/2,ry:(highY-lowY)/2};
}
export function getWitchVisitorTargets(state = {}) {
  return Object.fromEntries(getWitchVisitors(state).filter(frame=>frame.visible&&!frame.captured).map(frame=>{
    const rig=visitorRig(frame);
    return [frame.id,{body:ellipseTarget(rig.body,frame),head:ellipseTarget([...rig.skull,...rig.features.flatMap(feature=>feature.points)],frame)}];
  }));
}
export function hitTestWitchVisitors(x,y,state = {}) {
  for(const frame of getWitchVisitors(state).toReversed()) {
    if(!frame.visible||frame.captured)continue;
    const rig=visitorRig(frame),pad=Math.min(18,Math.max(9,(state.hitRadius||46)*.2));
    for(const points of [rig.body,[...rig.skull,...rig.features.flatMap(feature=>feature.points)]]) {
      const target=ellipseTarget(points,frame);
      if(((x-target.x)/(target.rx+pad))**2+((y-target.y)/(target.ry+pad))**2<=1)return {type:'animal',id:frame.id};
    }
    for(const chain of [rig.tail,rig.neck,...rig.legs.map(limb=>limb.points)])for(let index=1;index<chain.length;index++) {
      const a=scenePoint(chain[index-1],frame),b=scenePoint(chain[index],frame),dx=b.x-a.x,dy=b.y-a.y;
      const along=clamp(((x-a.x)*dx+(y-a.y)*dy)/Math.max(.01,dx*dx+dy*dy));
      if(Math.hypot(x-a.x-dx*along,y-a.y-dy*along)<pad)return {type:'animal',id:frame.id};
    }
  }
  return null;
}

/** Draw alongside the cat in the foreground, inside the ground/forest fade. */
export function drawWitchVisitors(context,state = {}) {
  const frames=getWitchVisitors(state);
  for(const frame of frames) {
    if(!frame.visible)continue;
    const scale=definition(frame.id).scale*frame.scale;
    context.save();context.globalAlpha*=frame.alpha;
    context.translate(frame.x,frame.y);context.rotate(frame.rotation);context.scale(frame.direction*scale,scale);
    context.translate(-LOCAL_WIDTH/2,-LOCAL_GROUND);context.lineJoin='round';context.lineCap='round';
    coat(context,visitorRig(frame),frame);context.restore();
  }
  return frames;
}
