import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultScene,validateScene,presets} from '../src/instruments/voicesaurus/native-model.js';
import {duplicateSingingNote,editableNote,setNoteSyllable} from '../src/instruments/voicesaurus/native-singing-model.js';
import {setGlobalVoiceParameter,setNoteVoiceParameter,setNoteVoiceInheritance,noteVoiceOverrideKeys,inheritGlobalVoice} from '../src/instruments/voicesaurus/voice-settings.js';
import {singingSceneFromText} from '../src/instruments/voicesaurus/singing-text.js';

test('globals reach inherited notes while an explicit equal-value note override remains independent',()=>{
 const scene=defaultScene('singer');duplicateSingingNote(scene,0);
 setNoteVoiceParameter(scene,1,'vibrato',scene.values.vibrato);
 setGlobalVoiceParameter(scene,'vibrato',.18);
 assert.equal(scene.values.vibrato,.18);assert.equal(editableNote(scene,0).values.vibrato,.18);assert.equal(editableNote(scene,1).values.vibrato,.01);
 setNoteVoiceInheritance(scene,1,'vibrato',true);
 assert.equal(editableNote(scene,1).values.vibrato,.18);
 setGlobalVoiceParameter(scene,'vibrato',.03);
 assert.equal(editableNote(scene,1).values.vibrato,.03);assert.deepEqual(validateScene(scene),scene);
});

test('local sound editing materializes one note without changing the global voice or geometry',()=>{
 const scene=defaultScene('singer'),root=structuredClone(scene.values);
 setNoteVoiceParameter(scene,0,'radius1',4.5);
 assert.deepEqual(scene.values,root);assert.equal(scene.input.phrase.notes.length,1);
 assert.equal(editableNote(scene,0).values.radius1,4.5);assert.equal(editableNote(scene,0).values.customShape,true);
 assert.deepEqual(noteVoiceOverrideKeys(scene,0),['radius1','customShape']);
 assert.equal(editableNote(scene,0).values.pitch,root.pitch);assert.equal(editableNote(scene,0).values.duration,root.duration);
 inheritGlobalVoice(scene,0);assert.deepEqual(editableNote(scene,0).values,root);assert.deepEqual(noteVoiceOverrideKeys(scene,0),[]);
});

test('legacy preset differences survive global edits without pinning unrelated voice controls',()=>{
 const scene=structuredClone(presets.find(preset=>preset.id==='singer-native-ahh').snapshot);
 const original=structuredClone(scene.input.phrase.notes);
 setGlobalVoiceParameter(scene,'vibrato',.27);
 scene.input.phrase.notes.forEach((note,index)=>{assert.equal(note.values.vibrato,.27);assert.equal(note.input.phone,original[index].input.phone);assert.equal(note.values.radius1,original[index].values.radius1);});
});

test('local native coefficient flags stay local and duplicate notes retain independent pins',()=>{
 const scene=defaultScene('stk-voicform');duplicateSingingNote(scene,0);
 setNoteVoiceParameter(scene,1,'formant1',8000);
 assert.equal(scene.values.customFormants,false);assert.equal(editableNote(scene,0).values.customFormants,false);assert.equal(editableNote(scene,1).values.customFormants,true);
 duplicateSingingNote(scene,1);setNoteVoiceParameter(scene,2,'formant1',4321);
 assert.equal(editableNote(scene,1).values.formant1,8000);
 const copy=validateScene(JSON.parse(JSON.stringify(scene)));assert.deepEqual(copy,scene);
 assert.throws(()=>setNoteVoiceParameter(scene,1,'pitch',440),/timeline/);
 copy.input.phrase.notes[0].voiceOverrides=['duration'];assert.throws(()=>validateScene(copy),/overrides/);
});

test('text articulation retains local sound overrides and stays independent of later global vowels',async()=>{
 const scene=defaultScene('singer');setNoteVoiceParameter(scene,0,'vibrato',.17);
 const result=await singingSceneFromText(scene,'my',{pronunciations:new Map([['my',['M','AY']]])});
 const before=structuredClone(result.notes);
 setGlobalVoiceParameter(result.scene,'vibrato',.31);setGlobalVoiceParameter(result.scene,'radius1',2);
 result.scene.input.phrase.notes.forEach((note,index)=>{assert.equal(note.values.vibrato,.17);assert.equal(note.values.radius1,before[index].values.radius1);});
 setNoteSyllable(result.scene,0,'eee');assert.ok(noteVoiceOverrideKeys(result.scene,0).includes('radius1'));
});

test('speech pitch remains a global native parameter and Sinsy rejects fictitious note overrides',()=>{
 const speech=defaultScene('espeak');setGlobalVoiceParameter(speech,'pitch',75);assert.equal(speech.values.pitch,75);
 const score=defaultScene('sinsy'),notes=structuredClone(score.input.notes);setGlobalVoiceParameter(score,'alpha',.64);
 assert.deepEqual(score.input.notes,notes);assert.throws(()=>setNoteVoiceParameter(score,0,'alpha',.4),/whole-score/);
});

test('reapplying lyrics retains the representative vowel’s explicit sound overrides',async()=>{
 const options={pronunciations:new Map([['my',['M','AY']]])};
 const first=await singingSceneFromText(defaultScene('singer'),'my',options);
 setNoteVoiceParameter(first.scene,1,'vibrato',.17);
 const next=await singingSceneFromText(first.scene,'my',options);
 setGlobalVoiceParameter(next.scene,'vibrato',.31);
 for(const note of next.scene.input.phrase.notes){assert.equal(note.values.vibrato,.17);assert.ok(note.voiceOverrides.includes('vibrato'));}
});
