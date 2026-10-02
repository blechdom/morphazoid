import test from 'node:test';
import assert from 'node:assert/strict';
import {createSampleBankRenderer,validateSampleBankRequest} from '../src/families/speech/sample-bank-renderer.js';
const note={id:'one',start:0,duration:1,midi:60,lyric:'ah',phones:['AH'],alias:''};

test('sample-bank input is detached and preserves exact note and source controls',()=>{
 const input={source:'open',openBankId:'air',notes:[{...note,style:'velvet',vibratoCents:61,vibratoRate:6.5,glideMs:120,rootMidi:49}]};
 const before=structuredClone(input),result=validateSampleBankRequest(input);
 assert.deepEqual(input,before);assert.deepEqual(result.notes,input.notes);assert.notEqual(result.notes[0],input.notes[0]);
 assert.equal(result.bpm,108);assert.equal(result.openBankId,'air');
});

test('sample-bank validation rejects unsupported formats, missing local resources and unschedulable values',()=>{
 for(const overrides of [
  {source:'vocaloid'}, {source:'local'}, {source:'open',openBankId:'missing'},
  {bpm:0},{glideMs:-1},{vibratoRate:0},{rootMidi:Infinity},{style:'unknown'},
  {notes:[]},{notes:[note,{...note}]},{notes:[{...note,duration:0}]},
  {notes:[{...note,phones:['unknown']}]},{notes:[{...note,midi:NaN}]},
  {notes:[{...note,vibratoCents:101}]},{notes:[{...note,start:1000}]},
 ])assert.throws(()=>validateSampleBankRequest({notes:[note],...overrides}));
});

test('a cancelled render creates no audio context or sample fetch',async()=>{
 let contexts=0,fetches=0;
 const renderer=createSampleBankRenderer({runtime:{OfflineAudioContext:class {constructor(){contexts++;}},fetch(){fetches++;throw Error('not expected');}}});
 const controller=new AbortController();controller.abort();
 await assert.rejects(renderer.render({notes:[note]},{signal:controller.signal}),{name:'AbortError'});
 assert.equal(contexts,0);assert.equal(fetches,0);renderer.close();
});

test('renderer has no live AudioContext dependency and reports missing offline support',async()=>{
 const renderer=createSampleBankRenderer({runtime:{AudioContext:class {constructor(){throw Error('must never arm');}}}});
 await assert.rejects(renderer.render({notes:[note]}),/OfflineAudioContext/);renderer.close();
});

test('closing cancels queued jobs without creating contexts',async()=>{
 let contexts=0;const renderer=createSampleBankRenderer({runtime:{OfflineAudioContext:class {constructor(){contexts++;}}}});
 const first=renderer.render({notes:[note]}),second=renderer.render({notes:[note]});renderer.close();
 await assert.rejects(first,{name:'AbortError'});await assert.rejects(second,{name:'AbortError'});assert.equal(contexts,0);
});

test('all-rest scores preserve duration and produce silence without loading or arming audio',async()=>{
 const renderer=createSampleBankRenderer({runtime:{}});
 const result=await renderer.render({notes:[],bpm:120,scoreBeats:3.25,source:'local'});
 assert.equal(result.scoreDuration,1.625);assert.equal(result.samples.length,78000);assert(result.samples.every(value=>value===0));
 assert.equal(result.scoreOffsetSeconds,0);assert.equal(result.fallbackNotes,0);renderer.close();
});

test('trailing score rests survive validation independently of final sounded note',()=>{
 assert.equal(validateSampleBankRequest({notes:[note],scoreBeats:8}).scoreBeats,8);
 assert.equal(validateSampleBankRequest({notes:[note],scoreBeats:.5}).scoreBeats,1);
});

test('a local exact alias can render with no English phoneme mapping',()=>{
 const bank={entries:[],files:new Map()},result=validateSampleBankRequest({source:'local',bank,notes:[{...note,lyric:'あ',alias:'あ',phones:[]}]});
 assert.deepEqual(result.notes[0].phones,[]);assert.equal(result.bank,bank);
});
