import test from 'node:test';
import assert from 'node:assert/strict';
import {NATIVE_METHODS,defaultsFor,presetsForVoiceMode,validateScene} from '../src/instruments/voicesaurus/native-model.js';
import {FACTORY_ADJUSTMENTS} from '../src/instruments/voicesaurus/factory-adjustments.js';
import {auditionScene,singingNoteDescriptors} from '../src/instruments/voicesaurus/native-singing-model.js';
import {planNativePhrase} from '../src/instruments/voicesaurus/native-phrase.js';
import {applyFocusedNoteSound,focusedNoteSoundPresets} from '../src/instruments/voicesaurus/native-timeline.js';

test('every Singing factory preset recalls a complete, editable phrase',()=>{
 for(const {id,snapshot} of presetsForVoiceMode('singing')){
  assert.deepEqual(validateScene(snapshot),snapshot,id);
  const notes=singingNoteDescriptors(snapshot),sounding=notes.filter(note=>!note.rest);
  assert.ok(sounding.length>=3,`${id} needs a phrase`);
  assert.ok(notes.every(note=>note.seconds>0),id);
  const seconds=notes.reduce((total,note)=>total+note.seconds,0);
  assert.ok(seconds>=1.5&&seconds<=12,`${id}: ${seconds}s`);
  for(let index=1;index<notes.length;index++)assert.ok(Math.abs(notes[index].startSeconds-notes[index-1].startSeconds-notes[index-1].seconds)<1e-9,id);
  if(snapshot.engine!=='sinsy'){
   assert.ok(new Set(sounding.map(note=>note.pitch)).size>=3,`${id} needs melodic movement`);
   const audition=auditionScene(snapshot,1);
   assert.equal(audition.input.phrase,undefined,id);
   assert.deepEqual(audition.values,notes[1].values,id);
   audition.values.pitch=123;assert.notEqual(notes[1].values.pitch,123,id);
  }
 }
});

test('phrase presets preserve their calibrated root sound for focused note recall',()=>{
 for(const {id,snapshot} of presetsForVoiceMode('singing')){
  const spec=NATIVE_METHODS[snapshot.engine],raw=spec.presets.find(preset=>preset.id===id),adjustment=FACTORY_ADJUSTMENTS[id]??{};
  const input={...spec.defaultInput,...raw.input,...adjustment.input};
  assert.deepEqual(snapshot.values,{...defaultsFor(snapshot.engine,input),...raw.values,...adjustment.values},id);
  assert.equal(snapshot.input.phone,input.phone,id);
 }
 for(const engine of ['singer','stk-voicform','csound-fof','csound-vosim']){
  const bank=focusedNoteSoundPresets(engine),scene=structuredClone(bank[0].snapshot),before=structuredClone(scene);
  applyFocusedNoteSound(scene,1,bank.at(-1));
  const a=scene.input.phrase.notes,b=before.input.phrase.notes;
  assert.equal(a.length,b.length);assert.notDeepEqual(a[1],b[1]);
  for(let index=0;index<a.length;index++){
   assert.equal(a[index].values.pitch,b[index].values.pitch);assert.equal(a[index].values.duration,b[index].values.duration);
   if(index!==1)assert.deepEqual(a[index],b[index]);
  }
 }
});

test('phrase demos retain slow native trajectories and voiced answers to consonants',()=>{
 const bank=presetsForVoiceMode('singing');
 for(const id of ['singer-slow-tongue','stk-voicform-slow-glide']){
  const {snapshot}=bank.find(preset=>preset.id===id);
  for(const note of planNativePhrase(snapshot.engine,snapshot.input.phrase).notes)assert.ok(note.renderValues.duration>note.values.changeTime+.1,id);
 }
 for(const id of ['singer-whisper','singer-noise-tract','stk-voicform-sh']){
  const notes=bank.find(preset=>preset.id===id).snapshot.input.phrase.notes;
  assert.equal(notes[0].values.voiced,0,id);
  assert.ok(notes.filter(note=>note.values.voiced>0).length>=3,id);
 }
});
