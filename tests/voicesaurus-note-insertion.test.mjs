import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultScene, validateScene } from '../src/instruments/voicesaurus/native-model.js';
import { insertSingingNoteAt, singingNoteDescriptors, editableNote, validateMusicalPhrase } from '../src/instruments/voicesaurus/native-singing-model.js';
import { sinsyScoreToMusicXml } from '../src/families/speech/sinsy-score.js';

const clone=value=>structuredClone(value);
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-10,`${actual} != ${expected}`);
const hz=midi=>440*2**((midi-69)/12);
const withoutDuration=note=>({...clone(note),values:Object.fromEntries(Object.entries(note.values).filter(([key])=>key!=='duration'))});
const withoutBeats=note=>Object.fromEntries(Object.entries(note).filter(([key])=>key!=='beats'));
const ticks=note=>Math.round(note.beats*480);
const totalBeats=scene=>singingNoteDescriptors(scene).reduce((sum,note)=>sum+note.beats,0);

function musical(engine='singer',durations=[1,.5,.25],tempo=120){
 const scene=defaultScene(engine),base=clone(editableNote(scene));
 scene.input.phrase={tempo,pitchPortamento:.23,vowelPortamento:.47,
  notes:durations.map((duration,index)=>({...clone(base),rest:false,values:{...clone(base.values),duration,release:.05,pitch:[-333.123456,0,987.654321][index%3],amplitude:.2+.1*index}})),
 };
 validateMusicalPhrase(engine,scene.input.phrase);return scene;
}

function sinsy(notes=[{midi:60,lyric:'あ',beats:481/480,staccato:true,breath:true},{midi:67,lyric:'し',beats:1}]){
 const scene=defaultScene('sinsy');scene.input={tempo:120,notes:clone(notes)};sinsyScoreToMusicXml(scene.input);return scene;
}

function rejectsUnchanged(scene,action,pattern){
 const before=clone(scene);assert.throws(action,pattern);assert.deepEqual(scene,before);
}

for(const engine of ['singer','stk-voicform','csound-fof','csound-vosim'])test(`${engine}: insert at beat zero clones the selected native sound and leaves legacy values untouched`,()=>{
 const scene=defaultScene(engine),before=clone(scene),midi=64.125;
 const index=insertSingingNoteAt(scene,0,midi,{beats:.375});
 assert.equal(index,0);assert.equal(scene.input.phrase.notes.length,2);
 assert.deepEqual(scene.values,before.values);
 assert.deepEqual(scene.input.phrase.notes[1],{rest:false,input:before.input,values:before.values});
 const expected={rest:false,input:before.input,values:{...before.values,pitch:hz(midi),duration:.1875}};
 assert.deepEqual(scene.input.phrase.notes[0],expected);
 if(engine.startsWith('csound-'))assert.deepEqual(scene.input.phrase.notes[0].input,{});
 assert.notEqual(scene.input.phrase.notes[0].input,scene.input.phrase.notes[1].input);
 assert.notEqual(scene.input.phrase.notes[0].values,scene.input.phrase.notes[1].values);
 validateScene(scene);
});

test('inserting on an existing boundary does not split or retime either neighbor',()=>{
 const scene=musical('singer',[.1,.2,.3],100),before=clone(scene),beat=singingNoteDescriptors(scene)[1].startBeats;
 const index=insertSingingNoteAt(scene,beat,72,{index:2,beats:.5});
 assert.equal(index,1);assert.equal(scene.input.phrase.notes.length,4);
 const notes=scene.input.phrase.notes;
 assert.deepEqual([notes[0],notes[2],notes[3]],before.input.phrase.notes);
 near(singingNoteDescriptors(scene)[index].startBeats,beat);
 near(notes[index].values.duration,.3);
 near(totalBeats(scene),totalBeats(before)+.5);
});

test('interior insertion splits only its containing slot and retains the selected later sound',()=>{
 const scene=musical(),before=clone(scene),index=insertSingingNoteAt(scene,1,69,{index:2,beats:.5}),notes=scene.input.phrase.notes;
 assert.equal(index,1);assert.equal(notes.length,5);
 near(notes[0].values.duration,.5);near(notes[2].values.duration,.5);
 assert.deepEqual(withoutDuration(notes[0]),withoutDuration(before.input.phrase.notes[0]));
 assert.deepEqual(withoutDuration(notes[2]),withoutDuration(before.input.phrase.notes[0]));
 assert.deepEqual(notes[1],{...before.input.phrase.notes[2],values:{...before.input.phrase.notes[2].values,pitch:440,duration:.25}});
 assert.deepEqual(notes.slice(3),before.input.phrase.notes.slice(1));
 assert.equal(scene.input.phrase.pitchPortamento,.23);assert.equal(scene.input.phrase.vowelPortamento,.47);
 near(singingNoteDescriptors(scene)[index].startBeats,1);near(totalBeats(scene),totalBeats(before)+.5);
 notes[0].values.amplitude=99;notes[1].values.amplitude=88;
 assert.equal(notes[2].values.amplitude,before.input.phrase.notes[0].values.amplitude);
 assert.equal(notes[4].values.amplitude,before.input.phrase.notes[2].values.amplitude);
});

test('inserting into a rest preserves both silent fragments and makes only the new note sound',()=>{
 const scene=musical();scene.input.phrase.notes[0].rest=true;
 const before=clone(scene),index=insertSingingNoteAt(scene,.5,60,{index:0,beats:.25}),notes=scene.input.phrase.notes;
 assert.equal(index,1);assert.deepEqual(notes.map(note=>note.rest),[true,false,true,false,false]);
 assert.deepEqual(withoutDuration(notes[0]),withoutDuration(before.input.phrase.notes[0]));
 assert.deepEqual(withoutDuration(notes[2]),withoutDuration(before.input.phrase.notes[0]));
 near(notes[0].values.duration+notes[2].values.duration,before.input.phrase.notes[0].values.duration);
 assert.equal(notes[0].values.pitch,-333.123456);assert.equal(notes[2].values.pitch,-333.123456);
 near(notes[index].values.pitch,hz(60));near(totalBeats(scene),totalBeats(before)+.25);
});

test('past-end insertion creates the requested silent gap and keeps existing notes unchanged',()=>{
 const scene=musical(),before=clone(scene),index=insertSingingNoteAt(scene,7,72,{index:1,beats:.75}),notes=scene.input.phrase.notes;
 assert.equal(index,4);assert.equal(notes.length,5);
 assert.deepEqual(notes.slice(0,3),before.input.phrase.notes);
 const gap=notes[3];assert.equal(gap.rest,true);near(gap.values.duration,1.75);
 assert.deepEqual(gap.input,before.input.phrase.notes[1].input);
 assert.deepEqual(withoutDuration({...gap,rest:false}),withoutDuration(before.input.phrase.notes[1]));
 assert.equal(notes[index].rest,false);near(singingNoteDescriptors(scene)[index].startBeats,7);
 near(totalBeats(scene),7.75);near(notes[index].values.duration,.375);
 notes[index].values.amplitude=77;assert.equal(gap.values.amplitude,before.input.phrase.notes[1].values.amplitude);
});

test('inserting at the phrase end appends one note without manufacturing a rest',()=>{
 const scene=musical(),before=clone(scene),beat=totalBeats(scene);
 const index=insertSingingNoteAt(scene,beat,69,{index:2});
 assert.equal(index,3);assert.equal(scene.input.phrase.notes.length,4);
 assert.deepEqual(scene.input.phrase.notes.slice(0,3),before.input.phrase.notes);
 assert.equal(scene.input.phrase.notes[index].rest,false);
 near(singingNoteDescriptors(scene)[index].startBeats,beat);near(totalBeats(scene),beat+1);
});

test('Sinsy exact-boundary insertion preserves every original note including odd tick lengths',()=>{
 const scene=sinsy(),before=clone(scene),index=insertSingingNoteAt(scene,481/480,72,{index:1,beats:.25});
 assert.equal(index,1);assert.equal(scene.input.notes.length,3);
 assert.deepEqual([scene.input.notes[0],scene.input.notes[2]],before.input.notes);
 assert.deepEqual(scene.input.notes[1],{...before.input.notes[1],midi:72,beats:.25,rest:false});
 assert.equal(scene.input.notes.reduce((sum,note)=>sum+ticks(note),0),961+120);
 assert.deepEqual(scene.values,before.values);assert.equal(scene.input.tempo,120);
});

test('Sinsy interior insertion conserves original native ticks, lyrics, articulations and independent fragments',()=>{
 const scene=sinsy(),before=clone(scene),index=insertSingingNoteAt(scene,.5,76,{index:1,beats:.25}),notes=scene.input.notes;
 assert.equal(index,1);assert.deepEqual(notes.map(ticks),[240,120,241,480]);
 assert.deepEqual(withoutBeats(notes[0]),withoutBeats(before.input.notes[0]));
 assert.deepEqual(withoutBeats(notes[2]),withoutBeats(before.input.notes[0]));
 assert.deepEqual(notes[3],before.input.notes[1]);assert.equal(notes[1].lyric,'し');
 assert.equal(notes[1].midi,76);assert.equal(notes[1].rest,false);
 notes[0].lyric='え';notes[1].lyric='う';assert.equal(notes[2].lyric,'あ');assert.equal(notes[3].lyric,'し');
});

test('Sinsy null-pitch rest fragments retain their exact input while the inserted note is pitched',()=>{
 const scene=sinsy([{midi:null,rest:true,beats:1,lyric:'ら',staccato:true,breath:true},{midi:65,beats:1,lyric:'し'}]);
 const before=clone(scene),index=insertSingingNoteAt(scene,.25,64,{index:0,beats:.25}),notes=scene.input.notes;
 assert.equal(index,1);assert.deepEqual(notes.map(ticks),[120,120,360,480]);
 for(const fragment of [notes[0],notes[2]])assert.deepEqual(withoutBeats(fragment),withoutBeats(before.input.notes[0]));
 assert.equal(notes[1].rest,false);assert.equal(notes[1].midi,64);assert.equal(notes[1].lyric,'ら');
 assert.deepEqual(notes[3],before.input.notes[1]);
});

test('Sinsy insertion can start a sounding note from a valid rest without a lyric',()=>{
 const scene=sinsy([{midi:null,rest:true,beats:1},{midi:65,beats:1,lyric:'あ'}]),before=clone(scene);
 const index=insertSingingNoteAt(scene,1,69,{index:0,beats:.5});
 assert.equal(index,1);assert.deepEqual([scene.input.notes[0],scene.input.notes[2]],before.input.notes);
 assert.equal(scene.input.notes[index].rest,false);assert.equal(scene.input.notes[index].midi,69);
 assert.equal(typeof scene.input.notes[index].lyric,'string');assert.ok(scene.input.notes[index].lyric.length>0);
 sinsyScoreToMusicXml(scene.input);
});

test('Sinsy past-end insertion represents the gap in native ticks without losing the selected articulation',()=>{
 const scene=sinsy(),before=clone(scene),index=insertSingingNoteAt(scene,4,72,{index:0,beats:.25});
 assert.equal(index,3);assert.deepEqual(scene.input.notes.slice(0,2),before.input.notes);
 assert.equal(scene.input.notes[2].rest,true);assert.equal(ticks(scene.input.notes[2]),1920-961);
 assert.equal(scene.input.notes[3].midi,72);assert.equal(scene.input.notes[3].rest,false);
 assert.equal(scene.input.notes[3].staccato,true);assert.equal(scene.input.notes[3].breath,true);
 assert.equal(scene.input.notes.reduce((sum,note)=>sum+ticks(note),0),2040);
});

test('Sinsy insertion rounds to its native tick clock and rejects sub-tick notes atomically',()=>{
 const scene=sinsy([{midi:60,lyric:'あ',beats:1}]);
 const index=insertSingingNoteAt(scene,.6/480,64,{beats:.6/480});
 assert.equal(index,1);assert.deepEqual(scene.input.notes.map(ticks),[1,1,479]);
 assert.ok(scene.input.notes.every(note=>ticks(note)>0));
 rejectsUnchanged(scene,()=>insertSingingNoteAt(scene,.5,64,{beats:.4/480}),/tick/);
});

for(const engine of ['singer','sinsy'])test(`${engine}: note budgets count split fragments and gaps before committing`,()=>{
 const make=count=>engine==='sinsy'
  ?sinsy(Array.from({length:count},()=>({midi:60,lyric:'あ',beats:.5})))
  :musical(engine,Array(count).fill(.25));
 const boundary=make(61);assert.equal(insertSingingNoteAt(boundary,.5,64,{beats:.25}),1);
 assert.equal(singingNoteDescriptors(boundary).length,62);
 const interiorAllowed=make(60);assert.equal(insertSingingNoteAt(interiorAllowed,.25,64,{beats:.25}),1);
 assert.equal(singingNoteDescriptors(interiorAllowed).length,62);
 const interiorFull=make(61);rejectsUnchanged(interiorFull,()=>insertSingingNoteAt(interiorFull,.25,64,{beats:.25}),/62/);
 const gapFull=make(61);rejectsUnchanged(gapFull,()=>insertSingingNoteAt(gapFull,32,64,{beats:.25}),/62/);
});

test('insertion rejects invalid gesture input and native representations without changing the scene',()=>{
 const scene=defaultScene('singer');
 for(const [beat,midi,options]of [[-1,60,{}],[NaN,60,{}],[Infinity,60,{}],[0,NaN,{}],[0,60,{beats:0}],[0,60,{beats:-1}],[0,60,{beats:Infinity}],[0,60,{index:1}],[0,1e6,{}]]){
  rejectsUnchanged(scene,()=>insertSingingNoteAt(scene,beat,midi,options));
 }
 const score=sinsy();rejectsUnchanged(score,()=>insertSingingNoteAt(score,.5,60.125),/integer octave/);
 rejectsUnchanged(score,()=>insertSingingNoteAt(score,1e8,60),/score-tick|tick representation/);
 const speaking=defaultScene('espeak');rejectsUnchanged(speaking,()=>insertSingingNoteAt(speaking,0,60),/timeline/);
});

test('render duration failures leave the original musical scene and native parameters intact',()=>{
 const scene=musical('csound-fof',[119]);
 rejectsUnchanged(scene,()=>insertSingingNoteAt(scene,240,69,{beats:1}),/120-second/);
 rejectsUnchanged(scene,()=>insertSingingNoteAt(scene,0,69,{beats:4}),/120-second/);
 const invalidTempo=musical();invalidTempo.input.phrase.tempo=0;
 rejectsUnchanged(invalidTempo,()=>insertSingingNoteAt(invalidTempo,0,69),/positive tempo/);
});
