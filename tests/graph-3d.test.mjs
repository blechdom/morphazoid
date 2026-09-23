import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  Graph3DModel, Graph3DTraversal, GRAPH_3D_DEFAULTS, GRAPH_3D_SCENES, GRAPH_3D_LIMITS,
  graph3DEdgeParameters, graph3DVoice, signedBend3D, projectGraphPoint, dragGraphPoint,
  DEFAULT_VIEW, magnitude, sanitize3DSettings,
  GRAPH_3D_SOURCES, graph3DSource,
} from "../src/instruments/graph-3d/graph-3d.js";
import { generateGraph, edgeAudioParameters } from "../src/instruments/graph-delay/graph-delay.js";
import { instrumentById } from "../src/site/instrument-catalog.js";
import { instrumentMidiCapabilityForId } from "../src/site/instrument-midi-capabilities.js";

test("continuous defaults and 30 distinct presets cover voices, mappings, shapes and timing", () => {
  assert.equal(GRAPH_3D_DEFAULTS.rootMidiNote, 68);
  assert.equal(GRAPH_3D_DEFAULTS.tuning, "free");
  assert.equal(GRAPH_3D_DEFAULTS.motion, false);
  const scenes = Object.values(GRAPH_3D_SCENES);
  assert.equal(scenes.length, 30);
  assert.equal(new Set(scenes.map((s) => JSON.stringify(s))).size, 30);
  for (const scene of scenes) {
    assert.deepEqual(sanitize3DSettings(scene), scene, "preset has no clamped or missing settings");
    assert.equal(scene.tuning, "free");
  }
  for (const [key, count] of [["layout", 4], ["topology", 7], ["soundMode", 5], ["timeSource", 7], ["mapping", 8], ["timbreSource", 6], ["shadeSource", 7], ["panSource", 6]]) {
    assert.ok(new Set(scenes.map((s) => s[key])).size >= count, `${key} coverage`);
  }
  assert.ok(Math.max(...scenes.map((s) => s.baseDelay)) / Math.min(...scenes.map((s) => s.baseDelay)) >= 10);
});

test("every manual world edit holds against forces until explicitly unpinned", () => {
  const model = new Graph3DModel({ motion: true, depth: 1, twist: 0 });
  model.setWorldPoint(0, { x: 0.4, y: -0.2, z: 0.1 });
  const edited = { ...model.nodes[0] };
  assert.equal(edited.pinned, true);
  for (let i = 0; i < 1200; i++) model.step(1 / 120);
  assert.deepEqual(model.nodes[0], edited);
  model.arrange();
  assert.deepEqual(model.nodes[0], edited);
  model.nodes[0].pinned = false;
  model.step(0.1);
  assert.notEqual(model.nodes[0].x, edited.x);
});

test("axis assignments affect only their chosen dimensions and Off removes modulation", () => {
  const model = new Graph3DModel({ topology: "chain", nodeCount: 3, depth: 1, twist: 0 });
  Object.assign(model.nodes[0], { x: 0, y: 0, z: 0 });
  Object.assign(model.nodes[1], { x: 0.2, y: 0.3, z: 0.4 });
  const event = { nodeId: 1, amplitude: 1, feedbackCount: 0, strain: 0.3, length: 0.5 };
  for (const [source, axis] of [["x", "x"], ["height", "y"], ["depth", "z"]]) {
    const graph = model.graph();
    const settings = { ...model.settings, timeSource: source, mapping: source, timbreSource: source, shadeSource: source, panSource: source, modulationIndex: 0, strain: 0.8 };
    const voice = graph3DVoice(event, graph, settings), time = graph3DEdgeParameters(graph, settings)[0].delaySeconds;
    graph.nodes[1][axis] += 0.2;
    const moved = graph3DVoice(event, graph, settings);
    assert.ok(moved.frequency > voice.frequency);
    assert.ok(moved.modulationIndex > voice.modulationIndex);
    assert.ok(moved.brightness > voice.brightness);
    assert.ok(moved.pan > voice.pan);
    assert.ok(graph3DEdgeParameters(graph, settings)[0].delaySeconds > time);
    const other = ["x", "y", "z"].find((k) => k !== axis);
    const held = graph3DEdgeParameters(graph, settings)[0].delaySeconds;
    graph.nodes[1][other] += 0.15;
    assert.deepEqual(graph3DVoice(event, graph, settings), moved);
    assert.equal(graph3DEdgeParameters(graph, settings)[0].delaySeconds, held);
    // A tiny move must not snap to semitone steps.
    graph.nodes[1][axis] += 0.0001;
    const tiny = graph3DVoice(event, graph, settings);
    assert.ok(tiny.frequency > moved.frequency && tiny.frequency / moved.frequency < 1.001);
  }
  const off = { ...model.settings, mapping: "none", timeSource: "none", timbreSource: "none", shadeSource: "none", panSource: "none" };
  const fixed = graph3DVoice(event, model.graph(), off);
  assert.equal(fixed.pan, 0); assert.equal(fixed.brightness, 0.95);
  assert.equal(fixed.modulationIndex, off.modulationIndex);
  assert.ok(Math.abs(fixed.frequency - 440 * 2 ** ((68 - 69) / 12)) < 1e-9);
  assert.ok(graph3DEdgeParameters(model.graph(), off).every((e) => e.delaySeconds === off.baseDelay / 1000));
  for (const source of Object.keys(GRAPH_3D_SOURCES)) {
    for (const point of [{ x: -20, y: 10, z: 7 }, { x: 0, y: 0, z: 0 }]) {
      const signal = graph3DSource(source, point, { strain: 300, length: 80 });
      assert.ok(Number.isFinite(signal) && Math.abs(signal) <= 1);
    }
  }
});

test("incoming distance/stretch reach the voice; old patches acquire default source assignments", () => {
  const model = new Graph3DModel({ topology: "chain", nodeCount: 3, mapping: "distance" }), q = new Graph3DTraversal();
  q.inject(model.graph(), 0.02);
  q.process(0, 0.03, model.graph(), model.settings, () => {});
  const edge = graph3DEdgeParameters(model.graph(), model.settings)[0], event = q.queue[0];
  assert.equal(event.length, edge.length);
  assert.equal(event.strain, edge.strain);
  const base = graph3DVoice(event, model.graph(), model.settings);
  assert.ok(graph3DVoice({ ...event, length: event.length + 0.2 }, model.graph(), model.settings).frequency > base.frequency);
  const saved = model.snapshot();
  for (const key of ["timeSource", "timbreSource", "shadeSource", "panSource"]) delete saved.settings[key];
  model.restore(saved);
  assert.equal(model.settings.timeSource, "distance");
  assert.equal(model.settings.timbreSource, "strain");
  assert.equal(model.settings.shadeSource, "depth");
  assert.equal(model.settings.panSource, "x");
});

test("3D Graph preserves canonical graph connectivity, gains and deterministic layouts", () => {
  for (const settings of Object.values(GRAPH_3D_SCENES)) {
    const a = new Graph3DModel(settings), b = new Graph3DModel(settings);
    assert.deepEqual(a.snapshot(), b.snapshot());
    const base = generateGraph({ type: settings.topology, nodeCount: settings.nodeCount, maxNodes: 24, density: settings.density, seed: settings.seed });
    assert.deepEqual(a.edges.map(({ from, to }) => [from,to]), base.edges.map(({ from, to }) => [from,to]));
    const params = graph3DEdgeParameters(a.graph(), settings), original = edgeAudioParameters(a.graph(), { ...settings, nodePass: 0.96 });
    assert.deepEqual(params.map(({ gain }) => gain), original.map(({ gain }) => gain));
    assert.ok(a.graph().nodes.some((n) => Math.abs(n.z) > 0.1));
    assert.ok(params.every((e) => e.delaySeconds >= 0.025 && e.delaySeconds <= 2));
  }
});

test("XYZ distance changes edge time even when XY projection is identical", () => {
  const a = new Graph3DModel({ topology: "chain", nodeCount: 3, depth: 1, twist: 0 });
  Object.assign(a.nodes[0],{x:0,y:0,z:0}); Object.assign(a.nodes[1],{x:.3,y:0,z:0});
  const short = graph3DEdgeParameters(a.graph(), a.settings)[0];
  a.nodes[1].z = .8;
  const longer = graph3DEdgeParameters(a.graph(), a.settings)[0];
  assert.ok(longer.delaySeconds > short.delaySeconds);
  assert.ok(Math.abs(longer.length - Math.hypot(.3,.8)) < 1e-10);
  const same = graph3DEdgeParameters(a.graph(), { ...a.settings, distanceRatio: 1 });
  assert.ok(same.every((edge) => edge.delaySeconds === a.settings.baseDelay/1000));
});

test("camera projection and screen-plane/depth dragging round-trip without changing musical state", () => {
  const model = new Graph3DModel(), graph = model.graph(), settings = model.settings;
  const event = { nodeId: 0, amplitude: 1, cumulativeSemitones: 0, feedbackCount: 0, strain: .8 };
  const before = graph3DVoice(event, graph, settings), edges = graph3DEdgeParameters(graph, settings), saved = model.snapshot();
  for (const camera of [DEFAULT_VIEW, { yaw: 80, pitch: -36, zoom: 1.5 }, {yaw:-120,pitch:48,zoom:.7}]) {
    const p = graph.nodes[0], from = projectGraphPoint(p,camera,1000,700);
    const unchanged = dragGraphPoint(p,0,0,camera,1000,700);
    assert.ok(magnitude({ x: p.x-unchanged.x,y:p.y-unchanged.y,z:p.z-unchanged.z })<1e-10);
    const moved = dragGraphPoint(p,25,-18,camera,1000,700), to = projectGraphPoint(moved,camera,1000,700);
    assert.ok(Math.abs(to.x-from.x-25)<1e-8); assert.ok(Math.abs(to.y-from.y+18)<1e-8);
    assert.notDeepEqual(dragGraphPoint(p,0,25,camera,1000,700,true),p);
  }
  assert.deepEqual(model.snapshot(), saved); assert.deepEqual(graph3DVoice(event,graph,settings),before);
  assert.deepEqual(graph3DEdgeParameters(graph,settings),edges);
});

test("world geometry edits preserve topology and invert depth/twist within bounds", () => {
  const model = new Graph3DModel({depth:.85,twist:.4}), ids=model.edges.map((e)=>e.id);
  model.setWorldPoint(0,{x:.12,y:.2,z:-.24});
  const point=model.graph().nodes[0];
  assert.ok(Math.abs(point.x-.12)<1e-9 && Math.abs(point.y-.2)<1e-9 && Math.abs(point.z+.24)<1e-9);
  model.set({depth:1.2,twist:-.6}); assert.deepEqual(model.edges.map((e)=>e.id),ids);
  model.setWorldPoint(0,{x:Infinity,y:NaN,z:1e9});
  assert.ok(model.graph().nodes.every((p)=>["x","y","z"].every((k)=>Number.isFinite(p[k]))));
});

test("organizing forces are deterministic, effective, bounded and respect pins", () => {
  const a=new Graph3DModel({motion:true}), b=new Graph3DModel({motion:true});
  a.nodes[0].pinned=b.nodes[0].pinned=true; const pinned={...a.nodes[0]}, initial=a.snapshot();
  for(let i=0;i<600;i++){a.step(1/120);b.step(1/120);}
  assert.deepEqual(a.snapshot(),b.snapshot()); assert.deepEqual(a.nodes[0],pinned);
  assert.notDeepEqual(a.snapshot(),initial);
  assert.ok(a.nodes.every((n)=>["x","y","z"].every((k)=>Number.isFinite(n[k])&&Math.abs(n[k])<=.92)));
  const inner=new Graph3DModel({motion:true,gravity:1,shell:0,repel:0});
  const outer=new Graph3DModel({motion:true,gravity:0,shell:1,repel:.8});
  for(let i=0;i<600;i++){inner.step(1/120);outer.step(1/120);}
  assert.ok(outer.nodes.reduce((sum,n)=>sum+magnitude(n),0)>inner.nodes.reduce((sum,n)=>sum+magnitude(n),0));
  const stopped=new Graph3DModel({motion:false}); const copy=stopped.snapshot();stopped.step(100);assert.deepEqual(stopped.snapshot(),copy);
});

test("musical mappings distinguish depth, radius, bends and strain without camera inputs", () => {
  const model=new Graph3DModel({tuning:"free",depth:1,twist:0,soundMode:"fm"}), g=model.graph();
  const event={nodeId:0,amplitude:.8,feedbackCount:0,cumulativeSemitones:0,strain:0};
  const base=graph3DVoice(event,g,{...model.settings,mapping:"depth"});g.nodes[0].z+=.5;
  assert.ok(graph3DVoice(event,g,{...model.settings,mapping:"depth"}).frequency>base.frequency);
  assert.ok(graph3DVoice({...event,strain:1.5},g,model.settings).modulationIndex>graph3DVoice(event,g,model.settings).modulationIndex);
  assert.ok(graph3DVoice({...event,feedbackCount:3},g,model.settings).brightness<graph3DVoice(event,g,model.settings).brightness);
  assert.ok(signedBend3D({x:1,y:0,z:0},{x:0,y:0,z:1})<0);
  assert.ok(signedBend3D({x:1,y:0,z:0},{x:0,y:0,z:-1})>0);
  assert.equal(signedBend3D({x:0,y:0,z:0},{x:1,y:0,z:0}),0);
});

function trace(settings) {
  const model=new Graph3DModel(settings), q=new Graph3DTraversal(), events=[];
  q.inject(model.graph(),.02,0,1,48);
  for(let t=0;t<18;t+=.02)q.process(t,t+.12,model.graph(),model.settings,(e,v)=>events.push({...e,frequency:v.frequency}));
  return {events,q,model};
}
test("acyclic traversals finish, cyclic traversals decay and event budgets stay bounded", () => {
  const chain=trace({topology:"chain",nodeCount:24});
  assert.equal(chain.events.length,24);assert.equal(chain.q.queue.length,0);
  const ring=trace({topology:"ring",nodeCount:4,feedback:.65,baseDelay:40});
  const returns=ring.events.filter((e)=>e.nodeId===0);
  assert.ok(returns.length>2);
  assert.ok(returns[1].amplitude<returns[0].amplitude);
  for(const s of Object.values(GRAPH_3D_SCENES)){
    const {q,events}=trace(s);assert.equal(q.queue.length,0);assert.equal(q.runs.size,0);
    assert.ok(events.length<=GRAPH_3D_LIMITS.arrivalsPerRun);
    assert.ok(events.every((e)=>Number.isFinite(e.time)&&Number.isFinite(e.frequency)&&e.amplitude<=1));
  }
});
test("in-flight timing stays fixed; the next hop sees live geometry; disabled routes stop", () => {
  const m=new Graph3DModel({topology:"chain",nodeCount:3,baseDelay:100}),q=new Graph3DTraversal();
  q.inject(m.graph(),.02);q.process(0,.03,m.graph(),m.settings,()=>{});
  const hop=q.queue[0], arrival=hop.time, origin={...hop.toPoint};
  m.setWorldPoint(1,{x:.2,y:.1,z:.8});
  assert.equal(hop.time,arrival);assert.deepEqual(hop.toPoint,origin);
  const expected=graph3DEdgeParameters(m.graph(),m.settings)[1].delaySeconds;
  q.process(arrival-.01,arrival+.001,m.graph(),m.settings,()=>{});
  assert.ok(Math.abs(q.queue[0].time-arrival-expected)<1e-8);
  m.toggleEdge(1);let emitted=0;
  q.process(q.queue[0].time-.01,q.queue[0].time+.001,m.graph(),m.settings,()=>emitted++);
  assert.equal(emitted,0);
});
test("stale attacks are dropped and explicit queue/return limits survive hostile injection", () => {
  const m=new Graph3DModel({topology:"mesh",nodeCount:24,density:.65}),q=new Graph3DTraversal();
  for(let i=0;i<100;i++)q.inject(m.graph(),.02);
  assert.ok(q.runs.size<=12);
  q.process(3,3.12,m.graph(),m.settings,()=>assert.fail("stale attack fired"));
  assert.equal(q.queue.length,0);
  q.inject(m.graph(),4);q.shift(2);assert.equal(q.queue[0].time,6);
  q.clear();assert.equal(q.queue.length,0);assert.equal(q.runs.size,0);
});
test("saved patches round-trip transactionally; camera and Audio are not persistent state", () => {
  const a=new Graph3DModel({depth:1.2,twist:.7,motion:true});a.nodes[1].pinned=true;a.toggleEdge(0);
  const saved=a.snapshot(), b=new Graph3DModel();b.restore(saved);assert.deepEqual(b.snapshot(),saved);
  const before=b.snapshot();assert.throws(()=>b.restore({...saved,nodes:[{x:NaN}]}));assert.deepEqual(b.snapshot(),before);
  assert.ok(!("camera" in saved)&&!("audio" in saved)&&!("playing" in saved));
  const safe=sanitize3DSettings({depth:NaN,nodeCount:Infinity,feedback:100});assert.equal(safe.feedback,.88);
});
test("new page integrates without rewriting Graph Synth and owns explicit controls", async () => {
  const entry=instrumentById("graph-3d"), midi=instrumentMidiCapabilityForId("graph-3d");
  assert.equal(entry.label,"3D Graph");assert.equal(entry.status,"Work in Progress");
  assert.equal(midi.noteMode,"pitched");assert.equal(midi.audioInput,false);assert.equal(midi.midiOutput,false);
  const html=await readFile(new URL("../graph-3d.html",import.meta.url),"utf8");
  for(const key of ["data-primary-transport","data-reset-in-place",'id="nodeZ"','id="motion"','id="viewReset"','id="stage"'])assert.ok(html.includes(key));
  const icon=await readFile(new URL("../assets/instruments/graph-3d.webp",import.meta.url));
  assert.equal(icon.subarray(8,12).toString(),"WEBP");assert.ok(icon.length>1000);
});
