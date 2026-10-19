import assert from "node:assert/strict";
import test from "node:test";
import { traceLSystem, L_SYSTEM_PRESETS } from "../src/instruments/l-system/l-system.js";
import { lSystemDrumTraversalStepSize } from "../src/instruments/l-system-drum-machine/l-system-drum-machine.js";
import { DEFAULT_CORNER_STATE, lSystemsCornersForHead, lSystemsCornerPoints, lSystemsCornerPulse, lSystemsCornerGain } from "../src/instruments/l-systems/corners.js";
import { lSystemsPlaybackAtPhase, lSystemsPlaybackHeads } from "../src/instruments/l-systems/ensemble.js";
import { LSystemEventClock, lSystemNoteVoice } from "../src/instruments/l-systems/discrete-audio.js";
import { createDefaultState } from "../src/instruments/l-systems/state.js";
import { lSystemsTrace } from "../src/instruments/l-systems/branch-parameters.js";
import { L_SYSTEMS_FULL_PRESETS, L_SYSTEMS_MIC_PRESETS, validateLSystemsPreset, randomizeLSystemsPreset } from "../src/instruments/l-systems/full-presets.js";
const trace = axiom => ({...traceLSystem({axiom,angle:90}),iteration:1});
const head = (t,index,progress) => ({sourceTrace:t,index,segment:t.segments[index],progress});
const settings={...DEFAULT_CORNER_STATE,emphasis:1};

test("corners are actual connected vector bends, not every segment or cumulative winding",()=>{
  const t=trace("FF+FF");
  assert.deepEqual(lSystemsCornerPoints(t).map(p=>p.segmentIndex),[1]);
  assert.equal(lSystemsCornersForHead(head(t,1,.5)).start.angle,0);
  assert.equal(lSystemsCornersForHead(head(t,2,.5)).start.angle,90);
  assert.equal(lSystemsCornerPoints(t,100).length,0);
  // A reverse draw command makes a real 180-degree bend even if the turtle heading never changed.
  assert.equal(lSystemsCornersForHead(head(trace("FB"),1,0)).start.angle,180);
  const fullTurn=trace("F++++F");
  assert.equal(lSystemsCornerPoints(fullTurn,1).length,0);
});

test("forks share one corner marker and straight arms still accent the actual branch junction",()=>{
  const t=trace("F[+F]F");
  assert.equal(lSystemsCornerPoints(t).length,1);
  for(const index of [1,2]) {
    const c=lSystemsCornersForHead(head(t,index,0));
    assert.equal(c.start.fork,true);assert.equal(c.start.angle,90);
    assert.equal(lSystemsCornerGain(head(t,index,0),settings),1);
  }
  const heads=lSystemsPlaybackHeads(lSystemsPlaybackAtPhase([t],.75));
  assert.equal(heads.length,2,"accents do not inject extra readers");
});

test("pen-up gaps and coincident unconnected strokes do not create fictional corners",()=>{
  const t={...traceLSystem({axiom:"Ff+F",moveSymbols:"f",angle:90}),iteration:1};
  assert.equal(lSystemsCornerPoints(t).length,0);
  assert.equal(lSystemsCornersForHead(head(t,1,0)).start.endpoint,true);
});

test("accent, minimum angle and width have distinct geometric effects with no gain boost",()=>{
  const t=trace("F+F+F"), middle=head(t,1,.5), near=head(t,1,.1), corner=head(t,1,0);
  assert.equal(lSystemsCornerGain(middle,{...settings,emphasis:0}),1);
  assert.equal(lSystemsCornerGain(middle,settings),.25);
  assert.equal(lSystemsCornerGain(corner,settings),1);
  assert.equal(lSystemsCornerGain(corner,{...settings,minimumAngle:100}),.25);
  assert.ok(lSystemsCornerGain(near,{...settings,width:.4}) > lSystemsCornerGain(near,{...settings,width:.05}));
  for(let i=0;i<=100;i++) {
    const h=head(t,1,i/100),g=lSystemsCornerGain(h,settings);
    assert.ok(g>=.25&&g<=1);
    assert.ok(Math.abs(g-lSystemsCornerGain(head(t,1,1-i/100),settings))<1e-10,"same accent in either travel direction");
  }
  assert.equal(lSystemsCornerPulse(corner,settings),1);
  assert.equal(lSystemsCornerGain({progress:0},settings),1,"legacy events without geometry stay neutral");
});

function clock(t,settings={}) {
  const s={traces:[t],position:0,direction:1,rate:.5,behavior:"loop",structureMode:"final",subdivisions:4,mappingMode:"branch-depth-turn",playingMode:"notes",hitPlacement:"corners",cornerThreshold:12,now:0,...settings};
  return new LSystemEventClock({...s,maxPhaseStep:lSystemDrumTraversalStepSize(s.traces,s.subdivisions,s.structureMode)});
}
for(const direction of [1,-1]) for(const subdivisions of [1,2,4,8,16]) test(`corner hits ${direction}/${subdivisions}: no straight-edge retriggers, root and reverse onsets retained`,()=>{
  const t=trace("FF+FF"), events=[];
  const c=clock(t,{direction,subdivisions,position:direction>0?0:1-1e-9});
  for(let now=0;now<1.9;now+=.025) events.push(...c.read(now));
  assert.deepEqual(events.map(e=>e.event.segmentIndex),direction>0?[0,2]:[3,1]);
  assert.ok(events.every(e=>e.event.subdivisionIndex===(direction>0?0:subdivisions-1)));
  assert.equal(events[0].startAt,.012);
});

test("corner selection shares Notes/Triggers frontiers and live threshold edits preserve clock and budget",()=>{
  const t=trace("FF+FF-F"), n=clock(t), d=clock(t,{playingMode:"triggers"}),budget=n.budget;
  for(let i=0;i<100;i++) {
    const config={cornerThreshold:i<50?5:100,hitPlacement:i<75?"corners":"all"};
    n.configure(config);d.configure(config);n.read(i*.025);d.read(i*.025);
    assert.deepEqual(n.activeEventKeys,d.activeEventKeys);
    assert.deepEqual(n.positionAt(i*.025),d.positionAt(i*.025));
    assert.equal(n.budget,budget);
  }
});

test("pitched note levels use the geometric accent without changing pitch or ADSR",()=>{
  const t=trace("F+F+F"),s=createDefaultState();s.corners={...settings};
  const event={key:"test",depth:1,powerShare:.5,corners:lSystemsCornersForHead(head(t,1,0)),progress:0};
  const corner=lSystemNoteVoice(event,1,s),edge=lSystemNoteVoice({...event,progress:.5},1,s);
  assert.equal(corner.frequency,edge.frequency);
  assert.ok(Math.abs(corner.gain/edge.gain-4)<1e-10);
});

test("marker budgets stay bounded and repeated requests reuse cached geometry",()=>{
  const t=trace("F+".repeat(1000));
  const points=lSystemsCornerPoints(t,10,32);
  assert.equal(points.length,32);assert.equal(lSystemsCornerPoints(t,10,32),points);
  assert.ok(lSystemsCornerPoints(t,10,99999).length<=192);
});

test("factory and Random corner blocks round-trip, stay varied and never corner-gate a straight novice score",()=>{
  let seed=10;const rng=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/2**32);
  const scenes=[...L_SYSTEMS_FULL_PRESETS.map(p=>p.snapshot),...Array.from({length:150},()=>randomizeLSystemsPreset(L_SYSTEMS_FULL_PRESETS[0].snapshot,rng))];
  for(const p of scenes) {
    validateLSystemsPreset(p);
    if(p.corners.placement!=="corners") continue;
    const state=Object.assign(createDefaultState(),p.shared,{corners:p.corners}),g=L_SYSTEM_PRESETS.find(g=>g.id===state.presetId);
    assert.ok(lSystemsCornerPoints(lSystemsTrace(g,state.iterations,state),p.corners.minimumAngle).length>0);
  }
  for(const mode of ["notes","triggers"]) assert.ok(L_SYSTEMS_FULL_PRESETS.filter(p=>p.snapshot.mode===mode&&p.snapshot.corners.placement==="corners").length>=5);
  assert.ok(L_SYSTEMS_MIC_PRESETS.every(p=>!Object.hasOwn(p.snapshot,"corners")));
  const legacy=structuredClone(scenes[0]);delete legacy.corners;validateLSystemsPreset(legacy);
  for(const invalid of [{emphasis:Infinity},{minimumAngle:-1},{width:0},{placement:"unknown"}]) {
    const p=structuredClone(scenes[0]);Object.assign(p.corners,invalid);assert.throws(()=>validateLSystemsPreset(p));
  }
});

test("corner-only hits ignore the hidden inter-edge contrast and width settings",()=>{
  const t=trace("F+F+F"),h={...head(t,1,.02),corners:lSystemsCornersForHead(head(t,1,.02))};
  for(const emphasis of [0,.5,1]) for(const width of [.04,.2,.5]) {
    assert.equal(lSystemsCornerGain(h,{...settings,placement:"corners",emphasis,width},true),1);
  }
});
