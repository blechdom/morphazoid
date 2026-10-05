import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {singingSceneFromText,singingSceneFromPronunciations,englishSingingSyllables} from '../src/instruments/voicesaurus/singing-text.js';
import {defaultScene,validateScene} from '../src/instruments/voicesaurus/native-model.js';
import {parseSpellingPronunciations} from '../src/instruments/spelling-synthesizer/spelling-pronunciation.js';
const dictionary=parseSpellingPronunciations(await fs.readFile(new URL('../vendor/cmudict/cmudict-en-us.dict',import.meta.url),'utf8'),['hello','world','sing','my','cat','voice']);
const convert=(scene,text)=>singingSceneFromText(scene,text,{pronunciations:dictionary});
const close=(a,b)=>assert(Math.abs(a-b)<1e-9,`${a} !== ${b}`);
function melody(engine){const scene=defaultScene(engine);scene.values.amplitude=.37;const note=(pitch,duration,rest=false)=>({rest,input:{...scene.input},values:{...scene.values,pitch,duration}});scene.input.phrase={tempo:120,pitchPortamento:.13,vowelPortamento:.17,notes:[note(172,.6),note(172,.2,true),note(344,.8)]};return scene;}

test('CMU word phones are syllabified with diphthongs intact and misses identified',()=>{
 const result=englishSingingSyllables('Hello, world!',dictionary);
 assert.deepEqual(result.groups.map(group=>group.phones),[['HH','AH'],['L','OW'],['W','ER','L','D']]);assert.deepEqual(result.fallbackWords,[]);
 const fallback=englishSingingSyllables('zzzyqp',dictionary);assert.deepEqual(fallback.fallbackWords,['zzzyqp']);assert(fallback.groups.length>0);
});

for(const engine of ['singer','stk-voicform','csound-fof','csound-vosim'])test(`${engine}: text maps to editable native notes while preserving melody slots, rests and sound controls`,async()=>{
 const scene=melody(engine),before=structuredClone(scene),result=await convert(scene,'hello');assert.deepEqual(scene,before);validateScene(result.scene);
 assert.equal(result.scene.input.singingText,'hello');assert.equal(result.scene.input.phrase.pitchPortamento,.13);assert.equal(result.scene.input.phrase.vowelPortamento,.17);
 const notes=result.scene.input.phrase.notes,first=notes.filter(n=>!n.rest&&n.textSyllable===0),second=notes.filter(n=>!n.rest&&n.textSyllable===1);
 close(first.reduce((sum,n)=>sum+n.values.duration,0),.6);close(second.reduce((sum,n)=>sum+n.values.duration,0),.8);
 assert(first.every(n=>n.values.pitch===172));assert(second.every(n=>n.values.pitch===344));assert(notes.filter(n=>n.rest).length===1);assert.equal(notes.find(n=>n.rest).values.duration,.2);
 assert(notes.every(n=>n.values.amplitude===.37));assert.equal(result.reusedNotes,2);assert.equal(result.addedSyllables,0);
 if(engine.startsWith('csound-')){assert(result.warnings.some(w=>w.includes('omitted HH, L')));assert(second.length===2);assert(second.every(n=>n.textPhone==='OW'));assert.notEqual(second[0].values.formant1,second[1].values.formant1);}
 else {assert(first.some(n=>n.textPhone==='HH'&&!n.textVowel));const glide=second.find(n=>n.textPhone==='OW');assert.notEqual(glide.values.destination,'hold');assert(glide.values.changeTime>0&&glide.values.changeTime<glide.values.duration);}
});

for(const engine of ['singer','stk-voicform','csound-fof','csound-vosim'])test(`${engine}: applying text again retains original syllable pitch and total timing`,async()=>{
 const first=await convert(melody(engine),'hello'),second=await convert(first.scene,'hello');
 const a=first.scene.input.phrase.notes,b=second.scene.input.phrase.notes;assert.equal(a.length,b.length);
 for(let i=0;i<a.length;i++){close(a[i].values.duration,b[i].values.duration);assert.equal(a[i].values.pitch,b[i].values.pitch);assert.equal(a[i].rest,b[i].rest);}
});

test('additional syllables append at one beat without repeating old notes or rewriting the input',async()=>{
 const scene=defaultScene('singer'),before=structuredClone(scene);scene.values.pitch=177;
 const result=await convert(scene,'hello world');assert.equal(result.addedSyllables,2);assert.equal(result.reusedNotes,1);
 const groupDurations=[0,1,2].map(group=>result.notes.filter(n=>n.textSyllable===group).reduce((sum,n)=>sum+n.values.duration,0));
 close(groupDurations[0],before.values.duration);close(groupDurations[1],.5);close(groupDurations[2],.5);assert(result.notes.every(n=>n.values.pitch===177));
});

test('empty, unsupported and over-budget conversion failures are atomic',async()=>{
 const scene=defaultScene('singer'),before=structuredClone(scene);
 for(const text of ['', '  ', 'hello 123', '世界', 'cat '.repeat(30)])await assert.rejects(convert(scene,text));
 assert.deepEqual(scene,before);await assert.rejects(convert(defaultScene('espeak'),'hello'),/singing engine/);
 await assert.rejects(singingSceneFromText(defaultScene('csound-fof'),'hmm',{pronunciations:new Map([['hmm',['HH','M']]])}),/no vowels/);
});

test('dictionary loading reuses existing parser, reports failures and retries successfully',async()=>{
 let calls=0;const fetcher=async()=>{calls++;if(calls===1)throw Error('offline');return {ok:true,text:async()=> 'hello HH AH L OW\n'};};
 const scene=defaultScene('singer'),first=await singingSceneFromText(scene,'hello',{fetcher}),second=await singingSceneFromText(scene,'hello',{fetcher});
 assert(first.warnings.some(w=>w.includes('Dictionary unavailable')));assert(first.warnings.some(w=>w.includes('Rule pronunciation')));
 assert(!second.warnings.some(w=>w.includes('pronunciation')));await singingSceneFromText(scene,'hello',{fetcher});assert.equal(calls,2);
});

test('direct and approximate consonant tables stay explicit and do not overwrite pitch controls',async()=>{
 const scene=defaultScene('stk-voicform'),result=await convert(scene,'cat');
 assert(result.warnings.some(w=>w.includes('K, T')));
 for(const note of result.notes.filter(n=>['K','T'].includes(n.textPhone))){assert.equal(note.values.voiced,0);assert.equal(note.values.noise,.7);assert.equal(note.values.pitch,scene.values.pitch);}
 const singer=await convert(defaultScene('singer'),'cat');assert(singer.notes.some(n=>n.input.phone==='kk+'));assert(singer.notes.some(n=>n.input.phone==='tt+'));
});

for(const engine of ['singer','stk-voicform','csound-fof','csound-vosim'])test(`${engine}: short lyrics keep every melody boundary as vowel-only melisma`,async()=>{
 const scene=melody(engine);scene.input.phrase.notes.push({rest:false,input:{...scene.input.phrase.notes[2].input},values:{...scene.input.phrase.notes[2].values,pitch:344,duration:.4}});
 const result=await convert(scene,'my');assert.equal(result.melismaNotes,2);
 const output=result.scene.input.phrase.notes,held=output.filter(note=>note.textMelisma);
 assert.equal(held.length,2);assert(held.every(note=>note.textPhone==='IY'));assert.deepEqual(held.map(note=>note.values.pitch),[344,344]);assert.deepEqual(held.map(note=>note.values.duration),[.8,.4]);
 assert.notEqual(held[0].textSlot,held[1].textSlot);assert(output.some(note=>note.rest&&note.values.duration===.2));
 const second=await convert(result.scene,'my');assert.equal(second.notes.length,result.notes.length);
 for(let i=0;i<output.length;i++){close(second.notes[i].values.duration,output[i].values.duration);assert.equal(second.notes[i].values.pitch,output[i].values.pitch);assert.equal(second.notes[i].rest,output[i].rest);}
});

test('FOF text changes vowel centers and gains while keeping authored grain and bandwidth settings',async()=>{
 const scene=defaultScene('csound-fof');
 const authored={bandwidth1:123,bandwidth2:234,bandwidth3:345,grainRise:.007,grainDuration:.061,grainDecay:.009,octave:1.3};
 Object.assign(scene.values,authored);
 const result=await convert(scene,'my voice');
 for(const note of result.notes)for(const [key,value]of Object.entries(authored))assert.equal(note.values[key],value,key);
 assert(result.notes.some(note=>note.values.formant1!==scene.values.formant1));
});

function scoreMelody(){
 const scene=defaultScene('sinsy');scene.values.alpha=.63;scene.values.semitones=-2;scene.input.tempo=120;
 scene.input.notes=[{midi:60,beats:.5,lyric:'ら',staccato:true},{midi:null,rest:true,beats:.25},{midi:67,beats:1,lyric:'り',breath:true},{midi:67,beats:.75,lyric:'る'}];
 return scene;
}

test('Sinsy kana and romaji replace native lyrics while preserving pitch, rhythm, rests and articulation',async()=>{
 const scene=scoreMelody(),before=structuredClone(scene);
 const a=await convert(scene,'さくら'),b=await convert(scene,'sakura');
 assert.deepEqual(scene,before);assert.deepEqual(a.notes,b.notes);validateScene(a.scene);
 assert.deepEqual(a.scene.values,scene.values);assert.equal(a.scene.input.tempo,120);assert.equal(a.scene.input.singingText,'さくら');
 assert.deepEqual(a.notes.map(note=>note.lyric),['さ',undefined,'く','ら']);
 assert.deepEqual(a.notes.map(note=>note.beats),scene.input.notes.map(note=>note.beats));
 assert.deepEqual(a.notes.map(note=>note.midi),scene.input.notes.map(note=>note.midi));
 assert.equal(a.notes[0].staccato,true);assert.equal(a.notes[2].breath,true);assert.deepEqual(a.notes[1],scene.input.notes[1]);
 assert.equal(a.reusedNotes,3);assert.equal(a.addedSyllables,0);assert.equal(a.melismaNotes,0);assert.deepEqual(a.warnings,[]);
});

test('Sinsy short lyrics preserve repeated-pitch melody slots as valid vowel-only melisma',async()=>{
 const scene=scoreMelody(),result=await convert(scene,'kya');
 assert.deepEqual(result.notes.map(note=>note.lyric),['きゃ',undefined,'あ','あ']);assert.equal(result.melismaNotes,2);
 assert.deepEqual(result.notes.map(note=>note.beats),scene.input.notes.map(note=>note.beats));
 assert.notEqual(result.notes[2].textSlot,result.notes[3].textSlot);
 const again=await convert(result.scene,'kya');assert.deepEqual(again.scene,result.scene);
 const nasal=await convert(scene,'n');assert.deepEqual(nasal.notes.map(note=>note.lyric),['ん',undefined,'ん','ん']);
 const terminalNasal=await convert(scene,'kan');assert.deepEqual(terminalNasal.notes.map(note=>note.lyric),['か',undefined,'ん','ん']);
});

test('Sinsy native long-vowel marks remain in notes and surplus morae append one beat',async()=>{
 const scene=scoreMelody();scene.input.notes=scene.input.notes.slice(0,1);
 const result=await convert(scene,'Tōkyō');
 assert.deepEqual(result.notes.map(note=>note.lyric),['と','ー','きょ','ー']);assert.deepEqual(result.notes.map(note=>note.beats),[.5,1,1,1]);
 assert(result.notes.every(note=>note.midi===60));assert.equal(result.addedSyllables,3);assert.equal(result.reusedNotes,1);
});

test('Sinsy long-vowel notes re-enter after rests with explicit native vowel lyrics',async()=>{
 const result=await convert(scoreMelody(),'kō');
 assert.deepEqual(result.notes.map(note=>note.lyric),['こ',undefined,'お','お']);
 assert.equal(result.syllables[1].lyric,'ー');assert.equal(result.notes[1].rest,true);
 const nasal=await convert(scoreMelody(),'nー');assert.deepEqual(nasal.notes.map(note=>note.lyric),['ん',undefined,'ん','ん']);
});

test('Sinsy rejects unreadable and over-budget input atomically',async()=>{
 const scene=scoreMelody(),before=structuredClone(scene);
 for(const text of ['世界','123','ー','あ'.repeat(63)])await assert.rejects(convert(scene,text));
 assert.deepEqual(scene,before);
 const long=scoreMelody();long.input.notes[0].beats=101;const longBefore=structuredClone(long);
 await assert.rejects(convert(long,'さくら'),/50 seconds/);assert.deepEqual(long,longBefore);
});

test('musical text conversion checks native per-note render limits before committing',async()=>{
 const scene=defaultScene('singer');scene.values.duration=40;const before=structuredClone(scene);
 await assert.rejects(convert(scene,'my'),/30 seconds/);assert.deepEqual(scene,before);
});

const singingEngines=['singer','stk-voicform','csound-fof','csound-vosim','sample-bank','sinsy'];
for(const engine of singingEngines)test(`${engine}: synchronous and asynchronous pronunciation conversion produce identical complete editable scenes`,async()=>{
 const scene=engine==='sinsy'?scoreMelody():engine==='sample-bank'?defaultScene(engine):melody(engine);
 const before=structuredClone(scene),dictionaryBefore=structuredClone(dictionary),text=engine==='sinsy'?'さくら':'hello world';
 const sync=singingSceneFromPronunciations(scene,text,{pronunciations:dictionary});
 assert.equal(typeof sync.then,'undefined');validateScene(sync.scene);
 const asyncResult=await singingSceneFromText(scene,text,{pronunciations:dictionary,fetcher:()=>{throw Error('Supplied pronunciations must not fetch.');}});
 assert.deepEqual(sync,asyncResult);assert.deepEqual(scene,before);assert.deepEqual(dictionary,dictionaryBefore);
 assert.equal(sync.scene.input.singingText,text);assert(sync.notes.length>0);
});

for(const engine of singingEngines)test(`${engine}: synchronous fallback and async dictionary failure retain warning order and native lyric behavior`,async()=>{
 const scene=defaultScene(engine),text=engine==='sinsy'?'pa pi pu pe po':'hello world';
 let calls=0;const fetcher=()=>{calls++;throw Error('offline');};
 const sync=singingSceneFromPronunciations(scene,text),asyncResult=await singingSceneFromText(scene,text,{fetcher});
 assert.equal(calls,engine==='sinsy'?0:1);
 assert.deepEqual(asyncResult,{...sync,warnings:engine==='sinsy'?sync.warnings:['Dictionary unavailable; pronunciation uses letter rules.',...sync.warnings]});
 if(engine!=='sinsy')assert.match(sync.warnings[0],/^Rule pronunciation:/);
});

for(const engine of singingEngines)test(`${engine}: synchronous failures match async validation and never partially alter the scene`,async()=>{
 const scene=defaultScene(engine),before=structuredClone(scene);
 for(const text of ['', '  ', 'hello 123', 'a'.repeat(1001), engine==='sinsy'?'あ'.repeat(63):'hello '.repeat(70)]){
  let failure;
  assert.throws(()=>singingSceneFromPronunciations(scene,text,{pronunciations:dictionary}),error=>{failure=error;return true;});
  await assert.rejects(singingSceneFromText(scene,text,{pronunciations:dictionary}),error=>error.constructor===failure.constructor&&error.message===failure.message);
  assert.deepEqual(scene,before);
 }
 if(engine!=='sinsy'){
  assert.throws(()=>singingSceneFromPronunciations(scene,'hello',{pronunciations:{}}),/word-to-ARPAbet Map/);
  await assert.rejects(singingSceneFromText(scene,'hello',{pronunciations:{}}),/word-to-ARPAbet Map/);
 }
});

test('both APIs reject non-singing inputs before dictionary access',async()=>{
 const scene=defaultScene('espeak');let calls=0;
 assert.throws(()=>singingSceneFromPronunciations(scene,'hello'),/singing engine/);
 await assert.rejects(singingSceneFromText(scene,'hello',{fetcher:()=>{calls++;throw Error('Must not fetch.');}}),/singing engine/);
 for(const text of ['',null,'a'.repeat(1001)])await assert.rejects(singingSceneFromText(defaultScene('singer'),text,{fetcher:()=>{calls++;throw Error('Must not fetch.');}}));
 assert.equal(calls,0);
});

test('async dictionary loading preserves the pre-load scene snapshot',async()=>{
 const scene=melody('singer'),expected=singingSceneFromPronunciations(scene,'hello',{pronunciations:dictionary});
 let finish;const loading=new Promise(resolve=>{finish=resolve;});
 const pending=singingSceneFromText(scene,'hello',{fetcher:async()=>{await loading;return {ok:true,text:async()=>'hello HH AH L OW\n'};}});
 scene.values.pitch=999;scene.input.phrase.notes[0].values.pitch=999;scene.input.phrase.notes[2].rest=true;
 finish();assert.deepEqual(await pending,expected);
});
