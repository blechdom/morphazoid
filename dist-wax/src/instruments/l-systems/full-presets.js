import { DEFAULT_CORNER_STATE, lSystemsCornerPoints } from "./corners.js";
import { createDefaultState } from "./state.js";
import { lSystemsTrace } from "./branch-parameters.js";
import { lSystemsPresetSpeed } from "./ensemble.js";
import { L_SYSTEM_PRESETS } from "../l-system/l-system.js";
import { MICMIC_FULL_PRESETS } from "../../families/branch-presets/full-presets.js";
import { L_SYSTEM_DRUM_MAPPING_MODES } from "../l-system-drum-machine/l-system-drum-machine.js";
import { GRAPH_DRUM_PERCUSSION_STYLES as L_SYSTEM_DRUM_STYLES } from "../../families/graph/graph-drum-audio.js";
import { amplitudeEnvelopePreset, sanitizeAmplitudeEnvelope } from "../../audio.js";
import { clonePresetData, presetRandom } from "../../site/preset-random.js";
import { presetStateKey } from "../../site/header-presets.js";

export const SYNTH_CHOICES = Object.freeze(["sine", "triangle", "square", "saw", "fm", "pm", "shepard"]);
export const STRUCTURES = Object.freeze(["final", "sequence", "accumulate", "together", "canon"]);
const sharedKeys = ["presetId", "geometryModel", "iterations", "angle", "turnAsymmetry", "lengthScale", "speed", "direction", "traversalBehavior", "structureMode", "branchDecay", "childTimeRatio", "mutation", "pruningBias"];
const mainSharedKeys = [...sharedKeys, "readerMode"];
const select = (source, keys) => Object.fromEntries(keys.map(key => [key, source[key]]));
const grammars = new Map(L_SYSTEM_PRESETS.map(g => [g.id, g]));
const choose = (value, choices, name) => { if (!choices.includes(value)) throw new TypeError(`Invalid ${name}`); };
const range = (value, low, high, name) => { if (!Number.isFinite(value) || value < low || value > high) throw new TypeError(`Invalid ${name}`); };
const exactKeys = (value, keys, name) => { if (!value || Object.keys(value).length !== keys.length || keys.some(k => !Object.hasOwn(value, k))) throw new TypeError(`Incomplete ${name}`); };
const defaults = createDefaultState();
const pathIterations = { coral: 3, plant: 4, dragon: 6, levy: 6, hilbert: 3, gosper: 2, koch: 2, sierpinski: 3, terdragon: 3, cantor: 3 };
// Deliberately separate tempo bands: no more blanket quarter-speed multiplier.
// Density may reduce factory geometry, never silently stretch a fast scene into
// a minute-long traversal. These are scene-generation choices, not manual limits.
const paceBands = [
  { min: .08, max: .12, activity: 18 },
  { min: .18, max: .32, activity: 36 },
  { min: .4, max: .65, activity: 64 },
];
function paceMainState(state, preferredSpeed) {
  const band = paceBands.findLast(b => preferredSpeed >= b.min) ?? paceBands[0];
  const grammar = grammars.get(state.presetId);
  const traces = Array.from({ length: Math.max(1, state.iterations) }, (_, i) => lSystemsTrace(grammar, state.iterations ? i + 1 : 0, state));
  const speed = () => lSystemsPresetSpeed(traces, state, preferredSpeed, band.activity);
  while (speed() < band.min && state.mode !== "continuous" && state.drums.subdivisions > 1) state.drums.subdivisions--;
  while (speed() < band.min && state.iterations > 1) { state.iterations--; traces.pop(); }
  state.speed = speed();
}
function factoryCorners(state,index) {
  Object.assign(state.corners,{emphasis:[.45,.75,.25,.9][index%4],minimumAngle:[8,12,25,40][index%4],width:[.12,.2,.32,.45][index%4],placement:[1,3,6,9,13].includes(index)?"corners":"all"});
  // Straight/Cantor scores should not become one lonely factory hit per cycle.
  const trace=lSystemsTrace(grammars.get(state.presetId),state.iterations,state);
  if (!lSystemsCornerPoints(trace,state.corners.minimumAngle).length) state.corners.placement="all";
}
function factoryTraversal(state, index) {
  // Most scenes trace the final image root-to-tip. Keep a few explicit layered
  // scenes and region scans, rather than imposing them on every tree and path.
  state.readerMode = [4, 7, 9, 15].includes(index) ? "regions" : "end-to-end";
  if (![2, 5, 10, 15].includes(index)) state.structureMode = "final";
  if (state.structureMode === "final" && state.readerMode === "end-to-end") {
    state.direction = 1; state.traversalBehavior = "loop";
  }
}
export function captureLSystemsPreset(state, envelope, microphone = state.mode === "mic") {
  const common = { version: 1, mode: state.mode, shared: select(state, microphone ? sharedKeys : mainSharedKeys) };
  return clonePresetData(microphone ? { ...common, mic: state.mic, micLevel: state.mix.mic }
    : { ...common, synth: state.synth, drums: state.drums, corners: state.corners ?? DEFAULT_CORNER_STATE, envelope, levels: select(state.mix, ["continuous", "notes", "triggers"]) });
}
export function validateLSystemsPreset(snapshot, microphone = snapshot?.mode === "mic") {
  presetStateKey(snapshot);
  exactKeys(snapshot, microphone ? ["version", "mode", "shared", "mic", "micLevel"] : ["version", "mode", "shared", "synth", "drums", "envelope", "levels", ...(Object.hasOwn(snapshot,"corners") ? ["corners"] : [])], "scene");
  if (snapshot.version !== 1) throw new TypeError("Unknown scene version");
  choose(snapshot.mode, microphone ? ["mic"] : ["continuous", "notes", "triggers"], "playing mode");
  const p = snapshot.shared; exactKeys(p, microphone || !Object.hasOwn(p, "readerMode") ? sharedKeys : mainSharedKeys, "shared controls");
  if (!microphone) choose(p.readerMode ?? "end-to-end", ["end-to-end", "regions"], "readers");
  if (!grammars.has(p.presetId)) throw new TypeError("Invalid grammar");
  choose(p.geometryModel, ["rewrite", "generations"], "growth model");
  range(p.iterations, 0, p.geometryModel === "generations" ? 13 : grammars.get(p.presetId).maxIterations, "iterations");
  if (!Number.isInteger(p.iterations) || (p.geometryModel === "generations" && p.iterations < 1)) throw new TypeError("Invalid iterations");
  for (const [key, low, high] of [["angle",0,180],["turnAsymmetry",-.8,.8],["lengthScale",.2,1.2],["speed",0,3],["branchDecay",0,1],["childTimeRatio",.2,2],["mutation",0,1],["pruningBias",-1,1]]) range(p[key],low,high,key);
  choose(p.direction,[-1,1],"direction"); choose(p.traversalBehavior,["loop","ping-pong"],"motion"); choose(p.structureMode,STRUCTURES,"structure");
  if (microphone) {
    exactKeys(snapshot.mic,Object.keys(defaults.mic),"mic controls"); choose(snapshot.mic.pitchSource,["angle","height","depth","progress"],"mic pitch source"); range(snapshot.micLevel,0,1.5,"mic level");
    for (const [key, low, high] of [["inputTrim",0,1.5],["feedback",0,.82],["interval",.25,4],["timeRatio",.2,2],["pitchRange",0,4],["spread",0,1],["wet",0,1],["dry",0,.5],["intervalMs",1,3000],["pitchScale",0,4]]) range(snapshot.mic[key],low,high,key);
  } else {
    exactKeys(snapshot.synth,Object.keys(defaults.synth),"synth controls"); exactKeys(snapshot.drums,Object.keys(defaults.drums),"trigger controls"); exactKeys(snapshot.levels,["continuous","notes","triggers"],"levels");
    if (Object.hasOwn(snapshot,"corners")) {
      const c=snapshot.corners;exactKeys(c,Object.keys(DEFAULT_CORNER_STATE),"corner controls");
      range(c.emphasis,0,1,"corner accent");range(c.minimumAngle,0,180,"minimum corner angle");range(c.width,.04,.5,"corner width");
      choose(c.placement,["all","corners"],"hit placement");
    }
    const s=snapshot.synth, d=snapshot.drums, e=snapshot.envelope;
    choose(s.soundMode,SYNTH_CHOICES,"voice"); choose(s.pitchSource,["angle","height","depth","progress"],"pitch source"); choose(s.articulation,["density","fixed"],"articulation");
    for (const [key,lo,hi] of [["baseFrequency",55,880],["pitchRange",0,6],["depthAmount",0,1],["modulationIndex",0,12],["modulationRatio",.125,16],["stereoSpread",0,1],["cutoff",80,20000],["resonance",.1,8],["noteDuration",.04,4]]) range(s[key],lo,hi,key);
    for (const key of Object.keys(snapshot.levels)) range(snapshot.levels[key],0,1.5,key);
    choose(d.mappingMode,L_SYSTEM_DRUM_MAPPING_MODES.map(m=>m.id),"trigger mapping"); choose(d.percussionStyle,L_SYSTEM_DRUM_STYLES.map(m=>m.id),"trigger bank");
    for (const [key,lo,hi] of [["subdivisions",1,16],["pitchDepth",0,36],["anglePitchDepth",0,36],["angleRange",15,180],["characterDepth",0,1]]) range(d[key],lo,hi,key);
    if (!Number.isInteger(d.subdivisions)) throw new TypeError("Non-integer subdivisions");
    exactKeys(e,["enabled","swell","preset","level","points"],"envelope");
    if (typeof e.enabled !== "boolean" || typeof e.swell !== "boolean" || (!e.enabled && e.swell)) throw new TypeError("Invalid amplitude switches");
    choose(e.preset,["pluck","note","sustain","pad","custom"],"envelope shape"); range(e.level,0,1,"envelope level");
    if (presetStateKey(e.points)!==presetStateKey(sanitizeAmplitudeEnvelope(e.points))) throw new TypeError("Invalid amplitude curve");
  }
  return snapshot;
}
const envelope = preset => ({ enabled:true, swell:false, preset, level:.8, points:amplitudeEnvelopePreset(preset) });
function continuousEnvelope(preset) {
  const value = envelope(preset), release = value.points.at(-1).x;
  // Factory continuous contours span each branch segment. The controller
  // repeats them at every new segment, like the standalone L-System Synth.
  value.preset = "custom";
  value.points = value.points.map((point, index) => ({
    x: point.x / release,
    y: index === 2 || index === 3 ? Math.max(.4, point.y) : point.y,
  }));
  return value;
}

// Authored combinations, not a cartesian product of names and oscillator settings.
const toneDesigns = [
  ["Velvet canopy","pythagorean","triangle","final",.22,196,1.8,6,"pad",1800,1.5],
  ["Glass orchard","coral","fm","final",.28,220,1.3,3,"pluck",4800,2.01],
  ["Copper choir","plant","saw","together",.10,146,1.4,4,"pad",1300,1.5],
  ["Hollow birch","pythagorean","square","final",.24,165,1.5,5,"sustain",1700,1.5],
  ["Moon ribbon","dragon","sine","final",.48,294,1.1,8,"sustain",8500,1.5],
  ["Phase pearls","hilbert","pm","sequence",.55,247,1.2,3,"note",3900,1.01],
  ["Endless fern","plant","shepard","final",.20,196,1.2,3,"pad",4300,1.5],
  ["Amber arches","levy","fm","final",.28,174,1.5,7,"sustain",2300,.5],
  ["Frost lattice","sierpinski","triangle","final",.42,330,.9,4,"note",5800,1.5],
  ["Soft circuit","koch","square","final",.60,220,.8,3,"pluck",2400,1.5],
  ["Woven reeds","gosper","saw","sequence",.26,196,1.3,3,"sustain",1800,1.5],
  ["Quiet islands","cantor","sine","final",.10,262,1.1,3,"pad",7000,1.5],
  ["Water bells","coral","pm","final",.54,294,1.1,3,"pluck",5600,2.7],
  ["Orbit garden","terdragon","shepard","final",.26,220,1.4,4,"sustain",4400,1.5],
  ["Warm alloy","pythagorean","fm","final",.24,185,1.4,5,"note",2800,1.414],
  ["Paper harmonics","hilbert","triangle","accumulate",.30,247,1.2,3,"sustain",3400,1.5],
];
const noteNames=["Canopy droplets","Orchard chimes","Copper marimba","Birch pulses","Moon steps","Phase marbles","Fern staircase","Amber tines","Frost music box","Circuit staccato","Reed mosaic","Island signals","Water plucks","Orbit ladder","Alloy kalimba","Paper pizzicato"];
function tonePreset(design,index,mode) {
  const [name,grammar,sound,structure,speed,hz,span,iterations,shape,cutoff,ratio]=design;
  const g=grammars.get(grammar), state=createDefaultState();
  Object.assign(state,{mode,presetId:grammar,iterations:Math.min(iterations,pathIterations[grammar]??iterations),angle:g.angle,lengthScale:g.lengthScale,structureMode:structure,speed,branchDecay:mode==="continuous"?1:.78+(index%4)*.05,childTimeRatio:[1,.85,1.12,.72][index%4],turnAsymmetry:index%4===2?.16:0,traversalBehavior:index%3===1?"ping-pong":"loop",direction:index%5===4?-1:1});
  Object.assign(state.synth,{soundMode:sound,baseFrequency:hz,pitchRange:span,modulationIndex:sound==="fm"?1.4+(index%3)*.4:2.2,modulationRatio:ratio,cutoff,resonance:.45+(index%4)*.22,depthAmount:.35+(index%5)*.1,pitchSource:["angle","height","progress","depth"][index%4],articulation:mode==="notes"?"fixed":"density",noteDuration:[.65,.9,1.15,.75][index%4],stereoSpread:.6+(index%4)*.12});
  state.drums.subdivisions=[2,3,2,4,2,3,4,2][index%8];
  factoryTraversal(state,index);
  paceMainState(state,speed);
  factoryCorners(state,index);
  return {id:`${mode}-${index+1}`,label:`${mode==="notes"?"Notes":"Continuous"} · ${mode==="notes"?noteNames[index]:name}`,description:`${g.name}; ${sound}${["fm","pm"].includes(sound)?` with ${ratio}× modulation`:""}, shaped tone, ${state.structureMode} growth and ${state.readerMode} traversal; ${state.corners.placement === "corners" ? "corner/fork hits" : "accented subdivisions"}.`,snapshot:validateLSystemsPreset(captureLSystemsPreset(state,mode==="continuous"?continuousEnvelope(shape):envelope(["pluck","note","pad","sustain"][index%4])))};
}
const drumDesigns=[
  ["Woodland clock","pythagorean","karplus-strong",4,.24],["Rattle canopy","plant","rattlesnake",3,.28],["Soft silicon","hilbert","circuit",5,.60],["Metal rain","coral","resonant-metal",6,.30],
  ["Tine garden","pythagorean","karplus-tines",4,.30],["Folded kit","dragon","drum-bank",3,.65],["Coral chatter","coral","rattlesnake",5,.26],["Hollow grid","koch","circuit",7,.50],
  ["Branch gong","plant","resonant-metal",2,.10],["Birch strings","pythagorean","karplus-strong",6,.22],["Island taps","cantor","drum-bank",4,.32],["Tine spirals","gosper","karplus-tines",5,.28],
  ["Three-way shaker","terdragon","rattlesnake",3,.55],["Soft triangles","sierpinski","circuit",8,.24],["Willow bells","levy","resonant-metal",4,.11],["Clockwork seeds","hilbert","drum-bank",6,.60],
];
const drumPresets=drumDesigns.map(([name,grammar,style,subdivisions,speed],index)=>{
  const state=createDefaultState(),g=grammars.get(grammar);
  Object.assign(state,{mode:"triggers",presetId:grammar,iterations:Math.min(g.iterations,pathIterations[grammar]??4),angle:g.angle,lengthScale:g.lengthScale,speed,structureMode:STRUCTURES[index%5],branchDecay:.82,childTimeRatio:[1,.85,1.15][index%3],pruningBias:[0,-.5,.5][index%3]});
  Object.assign(state.drums,{percussionStyle:style,subdivisions,mappingMode:L_SYSTEM_DRUM_MAPPING_MODES[index%L_SYSTEM_DRUM_MAPPING_MODES.length].id,pitchDepth:5+index%5*2,anglePitchDepth:4+index%4*3,angleRange:90,characterDepth:.3+index%4*.12}); state.mix.triggers=.76;
  state.drums.subdivisions=Math.min(4,subdivisions);
  factoryTraversal(state,index);
  paceMainState(state,speed);
  factoryCorners(state,index);
  return {id:`triggers-${index+1}`,label:`Triggers · ${name}`,description:`${g.name}; ${style}, ${state.drums.subdivisions} subdivisions and ${state.structureMode} structure; ${state.corners.placement === "corners" ? "corner/fork hits" : "accented subdivisions"}.`,snapshot:validateLSystemsPreset(captureLSystemsPreset(state,envelope("note")))};
});
export const L_SYSTEMS_FULL_PRESETS=Object.freeze([...toneDesigns.map((d,i)=>tonePreset(d,i,"continuous")),...toneDesigns.map((d,i)=>tonePreset(d,i,"notes")),...drumPresets]);
export const L_SYSTEMS_MIC_PRESETS=Object.freeze(MICMIC_FULL_PRESETS.map(source=>{
  const p=source.snapshot.parameters,state=createDefaultState();
  Object.assign(state,{mode:"mic",geometryModel:"generations",presetId:p.lSystemType,iterations:p.generations,angle:p.generationAngle,turnAsymmetry:p.generationAsymmetry,branchDecay:p.depth,childTimeRatio:p.timeRatio,mutation:p.mutation,pruningBias:p.pruningBias,structureMode:"final"});
  Object.assign(state.mic,{inputTrim:p.inputTrim,intervalMs:p.interval,pitchScale:p.generationPitchScale,spread:p.spread,wet:p.wet,dry:p.dry});
  return {id:`mic-${source.id}`,label:`Mic · ${source.label}`,description:source.description,snapshot:validateLSystemsPreset(captureLSystemsPreset(state,null,true))};
}));
export function randomizeLSystemsPreset(current,random=Math.random) {
  const rng=presetRandom(random), next=clonePresetData(current),mic=next.mode==="mic",p=next.shared;
  const g=rng.pick(L_SYSTEM_PRESETS);p.presetId=g.id;p.geometryModel=rng.pick(["rewrite","generations"]);
  Object.assign(p,{iterations:rng.integer(2,p.geometryModel==="generations"?8:Math.min(g.maxIterations,g.id==="cantor"?3:6)),angle:g.angle*rng.between(.65,1.15),lengthScale:rng.between(.55,1),turnAsymmetry:rng.between(-.35,.35),speed:rng.between(.15,.85),direction:rng.pick([-1,1]),traversalBehavior:rng.pick(["loop","ping-pong"]),structureMode:rng.pick(STRUCTURES),branchDecay:rng.between(.65,.96),childTimeRatio:rng.between(.65,1.2),mutation:rng.between(0,.24),pruningBias:rng.between(-1,1)});
  if(mic){Object.assign(next.mic,{pitchSource:rng.pick(["angle","height","depth","progress"]),feedback:rng.between(.1,.6),interval:rng.between(.4,2.5),timeRatio:rng.between(.5,1.3),pitchRange:rng.between(.1,1.6),spread:rng.between(.3,1),wet:rng.between(.4,.85),dry:rng.between(0,.18),intervalMs:rng.between(65,1800),pitchScale:rng.between(.1,1.5)});}
  else{
    next.mode=rng.pick(["continuous","notes","triggers"]);
    p.readerMode=rng.pick(["end-to-end","regions"]);
    if (rng.unit() < .75) Object.assign(p,{readerMode:"end-to-end",structureMode:"final",direction:1,traversalBehavior:"loop"});
    p.iterations=Math.min(p.iterations,pathIterations[g.id]??(p.geometryModel==="generations"?6:5));
    Object.assign(next.synth,{soundMode:rng.pick(SYNTH_CHOICES),baseFrequency:rng.between(146,392),pitchRange:rng.between(.5,2.2),pitchSource:rng.pick(["angle","height","depth","progress"]),depthAmount:rng.between(.25,.9),modulationIndex:rng.between(.4,2.5),modulationRatio:rng.pick([.5,1,1.01,1.5,2,2.01,2.7,3]),cutoff:rng.between(1200,7000),resonance:rng.between(.3,1.6),stereoSpread:rng.between(.35,1),articulation:rng.pick(["density","fixed"]),noteDuration:rng.between(.45,1.25)});
    Object.assign(next.drums,{subdivisions:rng.integer(1,4),mappingMode:rng.pick(L_SYSTEM_DRUM_MAPPING_MODES).id,percussionStyle:rng.pick(L_SYSTEM_DRUM_STYLES).id,pitchDepth:rng.between(2,18),anglePitchDepth:rng.between(2,16),angleRange:rng.between(45,150),characterDepth:rng.between(.2,.8)});
    for(const key of Object.keys(next.levels)) next.levels[key]=rng.between(.6,1);
    const enabled=rng.unit()>.1;next.envelope={enabled,swell:enabled&&rng.unit()>.5,preset:"custom",level:rng.between(.5,.9),points:[{x:0,y:0},{x:rng.between(.04,.16),y:rng.between(.7,1)},{x:rng.between(.25,.4),y:rng.between(.3,.8)},{x:rng.between(.55,.8),y:rng.between(.2,.7)},{x:1,y:0}]};
  }
  if (!mic) {
    const state=Object.assign(createDefaultState(),p,{mode:next.mode,synth:next.synth,drums:next.drums});
    const draw=rng.unit(), band=paceBands[draw < .1 ? 0 : draw < .65 ? 1 : 2];
    paceMainState(state,rng.between(band.min,band.max));
    Object.assign(p,{speed:state.speed,iterations:state.iterations});
    next.corners={emphasis:rng.between(.25,.95),minimumAngle:rng.between(3,40),width:rng.between(.08,.45),placement:rng.unit()<.4?"corners":"all"};
    const trace=lSystemsTrace(g,state.iterations,state);
    if (!lSystemsCornerPoints(trace,next.corners.minimumAngle).length) next.corners.placement="all";
  }
  return validateLSystemsPreset(next,mic);
}
