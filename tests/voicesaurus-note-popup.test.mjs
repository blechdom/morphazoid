import test from 'node:test';
import assert from 'node:assert/strict';
import {noteEditorBounds,focusedNoteSoundPresets,applyFocusedNoteSound} from '../src/instruments/voicesaurus/native-timeline.js';
import {defaultScene} from '../src/instruments/voicesaurus/native-model.js';
import {duplicateSingingNote,editableNote} from '../src/instruments/voicesaurus/native-singing-model.js';

test('focused sound presets remain specific to the native voice',()=>{
  for(const engine of ['singer','stk-voicform','csound-fof','csound-vosim','sinsy']){
    const choices=focusedNoteSoundPresets(engine);
    assert.ok(choices.length>=4,engine);
    assert.ok(choices.every(preset=>preset.snapshot.engine===engine));
  }
});

test('changing a selected musical sound preserves the melody, rest, metadata, and neighboring sound',()=>{
  for(const engine of ['singer','stk-voicform','csound-fof','csound-vosim']){
    const scene=defaultScene(engine);duplicateSingingNote(scene,0);
    const note=editableNote(scene,1);note.values.pitch=-333.125;note.values.duration=.738;note.rest=true;note.textWord='retained';
    if('pitchSweep' in note.values){note.values.pitchSweep=true;note.values.destinationPitch=987;}
    const neighbor=structuredClone(editableNote(scene,0));
    const preset=focusedNoteSoundPresets(engine).at(-1),saved=structuredClone(preset);
    applyFocusedNoteSound(scene,1,preset);
    assert.equal(note.values.pitch,-333.125);assert.equal(note.values.duration,.738);assert.equal(note.rest,true);assert.equal(note.textWord,'retained');
    if('pitchSweep' in note.values){assert.equal(note.values.pitchSweep,true);assert.equal(note.values.destinationPitch,987);}
    assert.deepEqual(editableNote(scene,0),neighbor);
    const soundKey=Object.keys(preset.snapshot.values).find(key=>key.startsWith('formant')||key.startsWith('radius'));
    assert.equal(note.values[soundKey],preset.snapshot.values[soundKey]);
    note.values[soundKey]=12345;assert.deepEqual(preset,saved);
  }
});

test('legacy single-note sound application creates an independent note override',()=>{
  const scene=defaultScene('singer');scene.values.pitch=123;scene.values.duration=.3;
  applyFocusedNoteSound(scene,0,focusedNoteSoundPresets('singer').at(-1));
  assert.equal(scene.input.phrase.notes.length,1);assert.equal(scene.values.pitch,123);assert.equal(scene.values.duration,.3);
  assert.equal(editableNote(scene,0).values.pitch,123);assert.ok(editableNote(scene,0).voiceOverrides.length>0);
});

test('Sinsy global voice sound preserves score notes, pitch shift, and vocoder timing',()=>{
  const scene=defaultScene('sinsy');scene.values.semitones=7;scene.values.speed=2;
  const input=structuredClone(scene.input),preset=focusedNoteSoundPresets('sinsy').at(-1);
  applyFocusedNoteSound(scene,2,preset);
  assert.deepEqual(scene.input,input);assert.equal(scene.values.semitones,7);assert.equal(scene.values.speed,2);
  assert.equal(scene.values.alpha,preset.snapshot.values.alpha);
});

test('cross-engine sound application fails before changing state',()=>{
  const scene=defaultScene('singer'),before=structuredClone(scene);
  assert.throws(()=>applyFocusedNoteSound(scene,0,focusedNoteSoundPresets('sinsy')[0]),/this voice engine/);
  assert.deepEqual(scene,before);
});

test('popup uses the nearest horizontal space without covering a selected note',()=>{
  const viewport={width:1440,height:900},size={width:560,height:320};
  const right=noteEditorBounds({left:100,right:220,top:250,bottom:270},viewport,size);
  assert.equal(right.left,226);assert.equal(right.top,250);
  const left=noteEditorBounds({left:1100,right:1240,top:250,bottom:270},viewport,size);
  assert.equal(left.left,534);assert.equal(left.top,250);
});

test('portrait and landscape popups stay visible above or below the note',()=>{
  for(const [viewport,anchor]of [
    [{width:390,height:844},{left:160,right:280,top:420,bottom:440}],
    [{width:844,height:390},{left:350,right:470,top:190,bottom:210}],
    [{width:390,height:420,offsetTop:300,offsetLeft:30},{left:190,right:300,top:510,bottom:530}],
  ]){
    const bounds=noteEditorBounds(anchor,viewport,{width:560,height:440}),height=Math.min(440,bounds.maxHeight);
    assert.ok(bounds.left>=8+(viewport.offsetLeft??0));assert.ok(bounds.left+bounds.width<=viewport.width+(viewport.offsetLeft??0)-8);
    assert.ok(bounds.top>=8+(viewport.offsetTop??0));assert.ok(bounds.top+height<=viewport.height+(viewport.offsetTop??0)-8);
    assert.ok(bounds.top>=anchor.bottom+6||bounds.top+height<=anchor.top-6,'popup leaves the selected note visible');
  }
});

test('wide notes and viewport-edge anchors still fit the viewport',()=>{
  const viewport={width:390,height:844};
  for(const anchor of [{left:-500,right:1000,top:50,bottom:70},{left:10,right:370,top:790,bottom:810}]){
    const bounds=noteEditorBounds(anchor,viewport,{height:340});
    assert.equal(bounds.width,374);assert.equal(bounds.left,8);assert.ok(bounds.top>=8);
    assert.ok(bounds.top+Math.min(340,bounds.maxHeight)<=836);
  }
});
