import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultScene,presets,validateScene} from '../src/instruments/voicesaurus/native-model.js';
import {addSingingNote,setNoteRest,setNoteBeats,auditionScene} from '../src/instruments/voicesaurus/native-singing-model.js';
import {sampleBankRequest} from '../src/instruments/voicesaurus/sample-bank-model.js';
import {singingSceneFromText} from '../src/instruments/voicesaurus/singing-text.js';
import {applyFocusedNoteSound,focusedNoteSoundPresets} from '../src/instruments/voicesaurus/native-timeline.js';

test('sample-bank notes preserve rest slots, exact Hz and per-note controls in their scheduler request',()=>{
 const scene=defaultScene('sample-bank');addSingingNote(scene);addSingingNote(scene,1);setNoteRest(scene,1,true);setNoteBeats(scene,2,2);
 const notes=scene.input.phrase.notes;notes[2].values.pitch=333.333;notes[2].values.vibratoCents=61;
 const request=sampleBankRequest(validateScene(scene));
 assert.equal(request.notes.length,2);assert.equal(request.notes[1].start,2.2);assert.equal(request.scoreBeats,4.2);
 assert.equal(request.notes[1].vibratoCents,61);assert.ok(Math.abs(440*2**((request.notes[1].midi-69)/12)-333.333)<1e-9);
 scene.input.source='local';notes[2].input.alias='あ';notes[2].input.phones=[];
 const audition=auditionScene(scene,2);assert.equal(audition.input.source,'local');assert.equal(audition.input.alias,'あ');assert.deepEqual(audition.input.phones,[]);assert.equal(audition.input.phrase,undefined);
});

test('sample-bank text stays one ARPAbet syllable per melody slot and preserves its source',async()=>{
 const source=structuredClone(presets.find(p=>p.id==='sample-bank-air').snapshot),before=structuredClone(source);
 const result=await singingSceneFromText(source,'Daisy',{pronunciations:new Map([['daisy',['D','EY','Z','IY']]])});
 assert.deepEqual(source,before);assert.equal(result.scene.input.source,'open');assert.equal(result.scene.input.openBankId,'air');
 const notes=result.scene.input.phrase.notes;assert.equal(notes.length,3);assert.deepEqual(notes[0].input.phones,['D','EY']);assert.deepEqual(notes[1].input.phones,['Z','IY']);assert.deepEqual(notes[2].input.phones,['IY']);
 notes.forEach((note,i)=>{assert.equal(note.values.pitch,source.input.phrase.notes[i].values.pitch);assert.equal(note.values.duration,source.input.phrase.notes[i].values.duration);});
});

test('focused sample sound presets preserve the selected bank, exact alias, note position and pitch',()=>{
 const scene=structuredClone(presets.find(p=>p.id==='sample-bank-air').snapshot),before=structuredClone(scene);
 scene.input.phrase.notes[1].input.alias='v a';
 const sound=focusedNoteSoundPresets('sample-bank').find(p=>p.id==='sample-bank-wide');assert.ok(sound);
 applyFocusedNoteSound(scene,1,sound);
 assert.equal(scene.input.openBankId,'air');assert.equal(scene.input.phrase.notes[1].input.alias,'v a');
 assert.equal(scene.input.phrase.notes[1].values.vibratoCents,90);assert.equal(scene.input.phrase.notes[1].values.pitch,before.input.phrase.notes[1].values.pitch);assert.equal(scene.input.phrase.notes[1].values.duration,before.input.phrase.notes[1].values.duration);
 assert.deepEqual(scene.input.phrase.notes[0],before.input.phrase.notes[0]);
});
