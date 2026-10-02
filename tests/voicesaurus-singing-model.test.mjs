import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultScene, presets } from '../src/instruments/voicesaurus/native-model.js';
import { nativeMusicalDefaults } from '../src/families/speech/native-musical-controls.js';
import {
  isSingingEngine, tempoForScene, singingNoteCount, editableNote, singingNoteDescriptors,
  setNotePitch, setNoteBeats, setNoteSyllable, setNoteRest, setNoteArticulation,
  setSingingTempo, addSingingNote, duplicateSingingNote, removeSingingNote,
  splitSingingNote, moveSingingNote, validateMusicalPhrase, auditionScene,
} from '../src/instruments/voicesaurus/native-singing-model.js';

const copy = value => structuredClone(value);
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-10, `${a} != ${b}`);

test('only native musical and Sinsy routes have a timeline', () => {
  for (const engine of ['singer','stk-voicform','csound-fof','csound-vosim','sinsy']) assert.equal(isSingingEngine(engine),true);
  for (const engine of ['espeak','mea8000','vizsn','flite-kal16']) assert.equal(isSingingEngine(engine),false);
});

test('opening every singing factory preset leaves every native value unchanged', () => {
  let count=0;
  for (const {snapshot} of presets) {
    if (!isSingingEngine(snapshot)) continue;
    const scene=copy(snapshot),before=copy(scene);
    tempoForScene(scene);singingNoteCount(scene);singingNoteDescriptors(scene);
    for(let index=0;index<singingNoteCount(scene);index++)editableNote(scene,index);
    assert.deepEqual(scene,before);
    count++;
  }
  assert.ok(count>=50,`checked ${count} singing presets`);
});

test('legacy editable input and values are actual scene references', () => {
  const scene=defaultScene('singer'),note=editableNote(scene);
  assert.equal(note.values,scene.values);assert.equal(note.input,scene.input);
  note.values.tractScale=9.125;note.input.phone='ooo';
  assert.equal(scene.values.tractScale,9.125);assert.equal(scene.input.phone,'ooo');
  assert.equal(scene.input.phrase,undefined);
});

test('pitch and duration retain legacy geometry while a shape edit becomes local to its note', () => {
  const scene=defaultScene('singer');
  setNotePitch(scene,0,-331.25);setNoteBeats(scene,0,1.625);setNoteSyllable(scene,0,'eee');
  assert.equal(scene.values.pitch,-331.25);assert.equal(scene.values.duration,.8125);
  assert.equal(scene.input.phone,'ahh');assert.equal(editableNote(scene,0).input.phone,'eee');
  assert.equal(editableNote(scene,0).values.pitch,-331.25);assert.equal(editableNote(scene,0).values.duration,.8125);
});

test('raw zero and negative native pitch survives display and audition', () => {
  const scene=defaultScene('stk-voicform');
  setNotePitch(scene,0,-440);
  let note=singingNoteDescriptors(scene)[0];
  assert.equal(note.pitch,-440);assert.equal(note.pitchHz,-440);assert.equal(note.displayMidi,69);
  assert.equal(auditionScene(scene).values.pitch,-440);
  setNotePitch(scene,0,0);note=singingNoteDescriptors(scene)[0];
  assert.equal(note.pitch,0);assert.equal(note.midi,null);assert.equal(note.displayMidi,60);
  assert.equal(scene.values.pitch,0);
});

test('tempo editing preserves authored beat lengths and all other native controls', () => {
  const scene=defaultScene('singer');scene.values.attack=8;scene.values.release=3;scene.values.changeTime=15;scene.values.pitch=-220;
  const sourceValues=copy(scene.values),before=singingNoteDescriptors(scene)[0];
  setSingingTempo(scene,240);
  const note=editableNote(scene),after=singingNoteDescriptors(scene)[0];
  assert.equal(note.values.duration,sourceValues.duration/2);near(after.beats,before.beats);
  assert.equal(note.values.attack,8);assert.equal(note.values.release,3);assert.equal(note.values.changeTime,15);assert.equal(note.values.pitch,-220);
  assert.deepEqual(scene.values,sourceValues);
  assert.equal(scene.input.phrase.tempo,240);
});

test('tempo changes scale every musical note and rest, preserving release and attack', () => {
  const scene=defaultScene('csound-fof');duplicateSingingNote(scene,0);
  const second=editableNote(scene,1);second.values.duration=.125;second.values.release=4;second.values.attack=3;
  setNoteRest(scene,1,true);
  const before=singingNoteDescriptors(scene).map(n=>n.beats);
  setSingingTempo(scene,75);
  singingNoteDescriptors(scene).forEach((note,i)=>near(note.beats,before[i]));
  assert.equal(editableNote(scene,1).values.release,4);assert.equal(editableNote(scene,1).values.attack,3);
});

test('Sinsy tempo remains native and does not change score pitches, beats or articulations', () => {
  const scene=defaultScene('sinsy'),before=copy(scene.input.notes);
  setSingingTempo(scene,0);assert.equal(scene.input.tempo,0);assert.deepEqual(scene.input.notes,before);
  assert.equal(singingNoteDescriptors(scene)[0].seconds,null);
  setSingingTempo(scene,999);assert.deepEqual(scene.input.notes,before);
});

test('native shape selection restores original coefficients while preserving authored performance', () => {
  for (const engine of ['singer','stk-voicform']) {
    const scene=defaultScene(engine);duplicateSingingNote(scene);
    const note=editableNote(scene,1);note.values.pitch=-330;note.values.duration=3.25;note.values.radius1=10;note.values.vibrato=7;
    const shape=engine==='singer'?'eee':'ooo',original=nativeMusicalDefaults(engine,{phone:shape});
    setNoteSyllable(scene,1,shape);
    assert.equal(note.input.phone,shape);assert.equal(note.values.radius1,original.radius1);
    assert.equal(note.values.pitch,-330);assert.equal(note.values.duration,3.25);assert.equal(note.values.vibrato,7);
    assert.notEqual(editableNote(scene,0).input.phone,shape);
  }
});

test('Sinsy syllables preserve unrestricted custom text and original score fields', () => {
  const scene=defaultScene('sinsy'),note=scene.input.notes[0],before=copy(note);
  const custom='かんじ / arbitrary native dictionary input 〜';
  setNoteSyllable(scene,0,custom);assert.equal(note.lyric,custom);
  assert.deepEqual({...note,lyric:before.lyric},before);
  setNoteArticulation(scene,0,'staccato',true);setNoteArticulation(scene,0,'breath',true);
  assert.equal(note.staccato,true);assert.equal(note.breath,true);
});

test('Csound never receives invented syllable or phoneme input', () => {
  const scene=defaultScene('csound-vosim'),before=copy(scene);
  assert.throws(()=>setNoteSyllable(scene,0,'AH'),/no native syllable/);assert.deepEqual(scene,before);
  duplicateSingingNote(scene);assert.deepEqual(editableNote(scene,1).input,{});
});

test('adding clones selected sound at one beat, duplicating preserves complete note', () => {
  const scene=defaultScene('singer');scene.values.pitch=777;scene.values.radius1=4;
  assert.equal(addSingingNote(scene,0),1);
  let note=editableNote(scene,1);assert.equal(note.values.duration,.5);assert.equal(note.values.pitch,777);assert.equal(note.values.radius1,4);
  assert.equal(duplicateSingingNote(scene,1),2);
  const duplicated=editableNote(scene,2);assert.deepEqual(duplicated,note);assert.notEqual(duplicated.values,note.values);
  duplicated.values.radius1=19;assert.equal(note.values.radius1,4);
});

test('musical split preserves duration and full native controls on two independent notes', () => {
  const scene=defaultScene('stk-voicform');scene.values.duration=.333333333333;scene.values.release=3;scene.values.pitch=-12;
  const before=copy(scene.values);
  assert.equal(splitSingingNote(scene),1);
  const left=editableNote(scene,0),right=editableNote(scene,1);
  near(left.values.duration+right.values.duration,before.duration);
  assert.equal(left.values.release,3);assert.equal(right.values.release,3);assert.equal(right.values.pitch,-12);
  assert.notEqual(left.values,right.values);
});

test('Sinsy split preserves the native 480-tick total including odd tick counts', () => {
  const scene=defaultScene('sinsy');scene.input.notes=[{midi:72,beats:481/480,lyric:'し',staccato:true}];
  assert.equal(splitSingingNote(scene),1);
  assert.equal(scene.input.notes.reduce((sum,n)=>sum+Math.round(n.beats*480),0),481);
  assert.ok(scene.input.notes.every(n=>n.lyric==='し'&&n.staccato));
});

test('reorder and remove keep the selected native sound attached to its note', () => {
  const scene=defaultScene('singer');duplicateSingingNote(scene);duplicateSingingNote(scene,1);
  [100,200,300].forEach((pitch,i)=>setNotePitch(scene,i,pitch));
  assert.equal(moveSingingNote(scene,0,2),2);
  assert.deepEqual(singingNoteDescriptors(scene).map(n=>n.pitch),[200,300,100]);
  assert.equal(removeSingingNote(scene,2),1);assert.equal(removeSingingNote(scene,0),0);
  const before=copy(scene);assert.equal(removeSingingNote(scene,0),0);assert.deepEqual(scene,before);
});

test('rest changes retain synthesis parameters and native timing', () => {
  const scene=defaultScene('singer'),before=copy(scene.values);
  setNoteRest(scene,0,false);assert.equal(scene.input.phrase,undefined);
  setNoteRest(scene,0,true);assert.equal(editableNote(scene).rest,true);assert.deepEqual(editableNote(scene).values,before);
  setNoteRest(scene,0,false);assert.deepEqual(editableNote(scene).values,before);
});

test('audition returns detached single native note without mutating authored phrase', () => {
  const scene=defaultScene('singer');duplicateSingingNote(scene);setNotePitch(scene,1,-660);
  const before=copy(scene),audition=auditionScene(scene,1);
  assert.equal(audition.values.pitch,-660);assert.equal(audition.input.phrase,undefined);
  audition.values.pitch=10;audition.input.phone='ooo';assert.deepEqual(scene,before);
  const score=defaultScene('sinsy'),original=copy(score),one=auditionScene(score,1);
  assert.equal(one.input.notes.length,1);assert.deepEqual(one.input.notes[0],original.input.notes[1]);assert.deepEqual(score,original);
});

test('phrase validation forwards finite native extremes without adapter range caps', () => {
  for (const engine of ['singer','stk-voicform','csound-fof','csound-vosim']) {
    const scene=defaultScene(engine);duplicateSingingNote(scene);
    const note=editableNote(scene,1);note.values.pitch=-1e8;note.values.amplitude=1e6;note.values.attack=-77;note.values.release=-2;
    const before=copy(scene.input.phrase);assert.equal(validateMusicalPhrase(engine,scene.input.phrase),scene.input.phrase);assert.deepEqual(scene.input.phrase,before);
  }
});

test('phrase validation rejects partial controls, unknown shapes and nonfinite requests', () => {
  const scene=defaultScene('singer');duplicateSingingNote(scene);let phrase=copy(scene.input.phrase);
  delete phrase.notes[0].values.radius1;assert.throws(()=>validateMusicalPhrase('singer',phrase),/all native/);
  phrase=copy(scene.input.phrase);phrase.notes[0].input.phone='invented';assert.throws(()=>validateMusicalPhrase('singer',phrase),/original native/);
  phrase=copy(scene.input.phrase);phrase.notes[0].values.pitch=Infinity;assert.throws(()=>validateMusicalPhrase('singer',phrase),/Invalid note/);
});

test('note count and final tail stay bounded while interior releases fit their slots', () => {
  const scene=defaultScene('csound-vosim');duplicateSingingNote(scene);const note=copy(editableNote(scene));
  assert.throws(()=>validateMusicalPhrase(scene.engine,{tempo:120,notes:Array.from({length:63},()=>copy(note))}),/1–62/);
  const tail=copy(note);tail.values.duration=1;tail.values.release=120;
  assert.throws(()=>validateMusicalPhrase(scene.engine,{tempo:120,notes:[tail]}),/120-second/);
  const costly=copy(note);costly.values.duration=.01;costly.values.release=30;
  const bounded={tempo:120,notes:Array.from({length:62},()=>copy(costly))};
  assert.equal(validateMusicalPhrase(scene.engine,bounded),bounded);
  const longRelease=copy(note);longRelease.values.duration=.2;longRelease.values.release=80;
  assert.doesNotThrow(()=>validateMusicalPhrase(scene.engine,{tempo:120,notes:[longRelease,copy(note)]}));
});

test('failed structural and tempo budget edits leave the source unchanged', () => {
  const scene=defaultScene('csound-fof');scene.values.duration=70;scene.values.release=1;const before=copy(scene);
  assert.throws(()=>duplicateSingingNote(scene),/120-second/);assert.deepEqual(scene,before);
  assert.throws(()=>setSingingTempo(scene,.001),/120-second/);assert.deepEqual(scene,before);
});

test('sequential descriptor starts follow native duration; releases never shift later notes', () => {
  const scene=defaultScene('singer');scene.values.duration=1;scene.values.release=10;duplicateSingingNote(scene);
  setNoteBeats(scene,1,.5);const descriptors=singingNoteDescriptors(scene);
  assert.equal(descriptors[1].startSeconds,1);assert.equal(descriptors[1].seconds,.25);assert.equal(descriptors[1].startBeats,2);
});
