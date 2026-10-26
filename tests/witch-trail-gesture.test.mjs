import test from 'node:test';
import assert from 'node:assert/strict';
import {createWitchTrailGesture,beginWitchTrailGesture,moveWitchTrailGesture,
  releaseWitchTrailGesture,advanceWitchTrailGesture,witchTrailSpaceAtPoint,witchHairDelayControls} from '../src/instruments/witch/witch-trail-gesture.js';

const paths=()=>[10,17].map((index,s)=>({index,points:Array.from({length:257},(_,i)=>({x:100+i*3,y:190+s*170+Math.sin(i/14)*22}))}));
const grabbed=state=>{
  const g=state.grab,p=state.strands.find(s=>s.index===g.index).points;
  return {x:p[g.segment].x*(1-g.fraction)+p[g.segment+1].x*g.fraction,
    y:p[g.segment].y*(1-g.fraction)+p[g.segment+1].y*g.fraction};
};
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-7,`${actual} != ${expected}`);

test('a segment pickup preserves its pointer offset and follows captured motion without detaching the hair',()=>{
  const rest=paths(),s=createWitchTrailGesture(),p={x:rest[0].points[70].x+1.2,y:rest[0].points[70].y+7};
  beginWitchTrailGesture(s,rest,p,100);
  assert.deepEqual(s.strands.map(({index,points})=>({index,points})),rest,'pickup does not snap the existing rope');
  const offset={...s.grab.offset};moveWitchTrailGesture(s,{x:p.x+110,y:p.y-90},132);
  near(grabbed(s).x,p.x+110+offset.x);near(grabbed(s).y,p.y-90+offset.y);
  advanceWitchTrailGesture(s,rest,.08);
  near(grabbed(s).x,p.x+110+offset.x);near(grabbed(s).y,p.y-90+offset.y);
  for(const strand of s.strands)assert.deepEqual(strand.points.at(-1),rest.find(r=>r.index===strand.index).points.at(-1));
  assert.equal(witchTrailSpaceAtPoint({x:100,y:0},{x:0,y:0}),0);
  assert.equal(witchTrailSpaceAtPoint({x:425,y:0},{x:0,y:0}),.5);
  assert.equal(witchTrailSpaceAtPoint({x:750,y:0},{x:0,y:0}),1);
});

test('a flick pulls neighboring rope sections and continues as a damped whip after release',()=>{
  const rest=paths(),s=createWitchTrailGesture(),p={...rest[0].points[100]};
  beginWitchTrailGesture(s,rest,p,0);moveWitchTrailGesture(s,{x:p.x+35,y:p.y+120},32);
  const segment=s.grab.segment;advanceWitchTrailGesture(s,rest,.08);
  assert.ok(Math.abs(s.strands[0].points[segment-1].y-rest[0].points[segment-1].y)>1,'motion travels into neighboring sections');
  const before=grabbed(s);releaseWitchTrailGesture(s);advanceWitchTrailGesture(s,rest,.04);
  assert.ok(Math.hypot(grabbed(s).x-before.x,grabbed(s).y-before.y)>1,'release retains momentum');
  assert.equal(s.held,false);assert.equal(s.active,true);
  for(let i=0;i<180;i++)advanceWitchTrailGesture(s,rest,.04);
  assert.equal(s.active,false);assert.deepEqual(s.strands,[],'settled physics stops using the frame budget');
});

test('quiet freezes the whole rope while cancel removes both a capture and its release tail',()=>{
  const rest=paths(),s=createWitchTrailGesture();beginWitchTrailGesture(s,rest,rest[1].points[90],0);
  moveWitchTrailGesture(s,{x:550,y:120},40);advanceWitchTrailGesture(s,rest,.04);releaseWitchTrailGesture(s);
  const frozen=structuredClone(s),movedRest=paths();movedRest[1].points.at(-1).x+=50;
  for(const dt of [0,-1,NaN,Infinity])advanceWitchTrailGesture(s,movedRest,dt);
  assert.deepEqual(s,frozen);
  releaseWitchTrailGesture(s,{cancel:true});assert.equal(s.held,false);assert.equal(s.active,false);assert.equal(s.grab,null);assert.deepEqual(s.strands,[]);
  moveWitchTrailGesture(s,{x:300,y:300},50);advanceWitchTrailGesture(s,rest,.08);assert.equal(s.active,false);
});

test('extreme captured drags stay finite with bounded nodes and bounded time steps',()=>{
  const dense=Array.from({length:8},(_,index)=>({index,points:Array.from({length:2000},(_,i)=>({x:i/2,y:200+index*20}))}));
  const s=createWitchTrailGesture();beginWitchTrailGesture(s,dense,{x:300,y:205},0);
  assert.equal(s.strands.length,2);assert.ok(s.strands.every(strand=>strand.points.length===257));
  for(let i=0;i<12;i++) {
    moveWitchTrailGesture(s,{x:i%2?1e9:-1e9,y:i%2?-1e9:1e9},i+1);advanceWitchTrailGesture(s,dense,.08);
    for(const strand of s.strands)for(const p of strand.points)assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y)&&Math.abs(p.x)<5000&&Math.abs(p.y)<5000);
  }
  releaseWitchTrailGesture(s);advanceWitchTrailGesture(s,dense,1e9);
  assert.ok(s.releaseAge<=1/12+.00001,'a suspended page does not schedule an unbounded catch-up');
});

test('flying hair pulls and circles reach distinct bounded delay controls',()=>{
  const start={trailPull:.5,trailTwist:.5,trailFeedback:.35,trailSpace:.2};
  assert.deepEqual(witchHairDelayControls(start,{x:0,y:0}),start);
  const back=witchHairDelayControls(start,{x:-170,y:95}),forward=witchHairDelayControls(start,{x:100,y:-80});
  assert.ok(back.trailPull>.95&&back.trailTwist<.1&&back.trailSpace>.6&&back.trailFeedback>.5);
  assert.ok(forward.trailPull<.1&&forward.trailTwist>.8);
  assert.ok(witchHairDelayControls(start,{x:-170,y:95},Math.PI).trailFeedback>back.trailFeedback+.3);
  for(const delta of [{x:1e9,y:-1e9},{x:NaN,y:Infinity}])for(const value of Object.values(witchHairDelayControls(start,delta,-1e9)))assert.ok(Number.isFinite(value)&&value>=0&&value<=1);
});
