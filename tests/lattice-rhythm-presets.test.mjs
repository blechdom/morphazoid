import test from 'node:test';
import assert from 'node:assert/strict';
import {LATTICE_FULL_PRESETS,LATTICE_RHYTHM_PRESETS,LATTICE_ORIGINAL_PRESETS,validateLatticePreset} from '../src/instruments/lattice/full-presets.js';
import {tilingInfo,prototileIsNonOverlapping,buildLattice,createScanLine,contactsForLine,latticeOffsetForPhase,centeredContactWindow} from '../src/instruments/lattice/lattice.js';
import {presetStateKey} from '../src/site/header-presets.js';
const median=a=>[...a].sort((x,y)=>x-y)[Math.floor(a.length/2)];
test('24 right-angle scenes lead the bank; every original ID and object remains below them',()=>{
 assert.equal(LATTICE_FULL_PRESETS.length,36);assert.equal(LATTICE_RHYTHM_PRESETS.length,24);
 assert.deepEqual(LATTICE_FULL_PRESETS.slice(24),LATTICE_ORIGINAL_PRESETS);
 assert.deepEqual(LATTICE_ORIGINAL_PRESETS.map(s=>s.id),[20,1,7,10,21,27,30,31,43,44,74,77].map(t=>`ih-${t}`));
 assert.equal(LATTICE_FULL_PRESETS.filter(s=>s.snapshot.parameters.angle===90).length,25);
 assert.equal(new Set(LATTICE_FULL_PRESETS.map(s=>s.id)).size,36);
 assert.equal(new Set(LATTICE_FULL_PRESETS.map(s=>presetStateKey(s.snapshot))).size,36);
});
test('every new form is deformed and strongly curved but legal; sound, envelopes and transport boundaries validate',()=>{
 for(const {label,snapshot} of LATTICE_RHYTHM_PRESETS){
  validateLatticePreset(snapshot);const p=snapshot.parameters,info=tilingInfo(p.tilingType);
  assert.equal(p.angle,90,label);assert.ok(p.patternDirectionAngle<45,'Keep motion crossing the vertical line');
  assert.ok(Math.max(...p.parameters.map((v,i)=>Math.abs(v-info.defaultParameters[i])))>.03,label);
  assert.ok(Math.max(...p.edgeCurves.map(Math.abs))>.2,label);
  assert.ok(p.edgeCurves.filter(v=>Math.abs(v)>.12).length>=2,label);
  assert.ok(prototileIsNonOverlapping({type:p.tilingType,parameters:p.parameters,edgeCurves:p.edgeCurves}),label);
  assert.equal(snapshot.envelope.points.length,5);assert.equal(snapshot.envelope.points.at(-1).y,0);
  for(const key of ['audio','playing','position','continuousPosition'])assert.equal(key in p,false);
 }
 assert.equal(new Set(LATTICE_RHYTHM_PRESETS.map(s=>s.snapshot.parameters.tilingType)).size,12);
 assert.equal(new Set(LATTICE_RHYTHM_PRESETS.map(s=>s.snapshot.parameters.soundMode)).size,5);
 assert.ok(median(LATTICE_RHYTHM_PRESETS.map(s=>s.snapshot.parameters.speed))>2*median(LATTICE_ORIGINAL_PRESETS.map(s=>s.snapshot.parameters.speed)));
 assert.ok(new Set(LATTICE_RHYTHM_PRESETS.map(s=>presetStateKey(s.snapshot.envelope))).size>=6);
});
test('each sculpted scene produces repeated changing contact entries along a real 90-degree scan',()=>{
 const bounds={minX:-1.5,maxX:1.5,minY:-1,maxY:1};const scan=createScanLine(bounds,.5,90);
 for(const {label,snapshot:{parameters:p}} of LATTICE_RHYTHM_PRESETS){
  const model=buildLattice({type:p.tilingType,parameters:p.parameters,edgeCurves:p.edgeCurves,scale:.46-.32*p.density,alignPeriodToDegrees:180+p.patternDirectionAngle,bounds});
  const bins=[];let previous=new Set();
  for(let i=0;i<120;i++){
   const contacts=centeredContactWindow(contactsForLine(model,scan,undefined,latticeOffsetForPhase(model,i/120)),p.voiceCap);
   if(i && contacts.some(c=>!previous.has(c.voiceKey)))bins.push(i);
   previous=new Set(contacts.map(c=>c.voiceKey));
  }
  assert.ok(bins.length>=6,`${label}: ${bins.length} nonempty attack bins per cycle`);
  assert.ok(bins.length<110,`${label}: leave rhythmic gaps rather than an every-frame cloud`);
 }
});
