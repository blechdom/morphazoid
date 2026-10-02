import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {singingSceneFromText} from '../src/instruments/voicesaurus/singing-text.js';
import {defaultScene} from '../src/instruments/voicesaurus/native-model.js';
import {parseSpellingPronunciations,SPELLING_PRONUNCIATION_PHONE_CATALOG} from '../src/instruments/spelling-synthesizer/spelling-pronunciation.js';
import {createNativePhraseRenderer} from '../src/instruments/voicesaurus/native-phrase.js';
import {createNativeMusicalRenderer} from '../src/families/speech/native-musical-notes.js';
import {renderNativeCsound} from '../src/instruments/voicesaurus/csound-native.js';
import {createSinsy,synthesizeSinsy} from '../src/families/speech/sinsy-runtime.js';
import {sinsyScoreToMusicXml} from '../src/families/speech/sinsy-score.js';

function finiteAudible(samples){
 let square=0,peak=0;assert(samples.length>0);
 for(const sample of samples){assert(Number.isFinite(sample));square+=sample*sample;peak=Math.max(peak,Math.abs(sample));}
 const rms=Math.sqrt(square/samples.length);assert(rms>.001,`RMS ${rms}`);assert(peak<=1,`peak ${peak}`);
 return {rms,peak};
}

test('English text renders through four shipped native WASM engines, including the complete ARPAbet inventory',async t=>{
 const musical=await createNativeMusicalRenderer();
 const module=await WebAssembly.compile(await fs.readFile(new URL('../vendor/csound/csound.wasm',import.meta.url)));
 const render=createNativePhraseRenderer({musicalFactory:async()=>musical,csoundRenderer:(engine,input,values,transition)=>renderNativeCsound(engine,input,values,transition,async()=>module)});
 const dictionary=parseSpellingPronunciations(await fs.readFile(new URL('../vendor/cmudict/cmudict-en-us.dict',import.meta.url),'utf8'),['hello','world','my','voice','sings']);
 const allPhones=new Map([['full',SPELLING_PRONUNCIATION_PHONE_CATALOG.map(phone=>phone.id)]]);
 for(const engine of ['singer','stk-voicform','csound-fof','csound-vosim'])for(const text of ['hello world','my voice sings','full']){
  const scene=defaultScene(engine);scene.values.pitch=180;scene.values.duration=.5;
  const result=await singingSceneFromText(scene,text,{pronunciations:text==='full'?allPhones:dictionary});
  const pcm=await render(engine,result.scene.input.phrase);
  t.diagnostic(JSON.stringify({engine,text,notes:result.notes.length,seconds:pcm.duration,...finiteAudible(pcm.samples)}));
 }
});

test('Sinsy text conversion produces identical native PCM for equivalent kana/romaji, including melisma',async t=>{
 const warnings=[];
 const module=await createSinsy({locateFile:name=>fileURLToPath(new URL('../vendor/sinsy/'+name,import.meta.url)),wasmBinary:await fs.readFile(new URL('../vendor/sinsy/sinsy.wasm',import.meta.url)),printErr:message=>warnings.push(message)});
 try{
  for(const [kana,romaji]of [['さくら','sakura'],['とーきょー','Tōkyō'],['きゃ','kya']]){
   const scene=defaultScene('sinsy');scene.input.tempo=160;
   scene.input.notes=[{midi:60,beats:.5,lyric:'ら'},{midi:null,rest:true,beats:.25},{midi:64,beats:.5,lyric:'り'},{midi:64,beats:.5,lyric:'る'},{midi:67,beats:.75,lyric:'れ'}];
   const first=await singingSceneFromText(scene,kana),second=await singingSceneFromText(scene,romaji);
   assert.deepEqual(first.notes,second.notes);
   const a=synthesizeSinsy(module,sinsyScoreToMusicXml(first.scene.input),first.scene.values);
   const b=synthesizeSinsy(module,sinsyScoreToMusicXml(second.scene.input),second.scene.values);
   assert.equal(a.sampleRate,48000);assert.deepEqual(a.samples,b.samples);
   t.diagnostic(JSON.stringify({engine:'sinsy',text:romaji,notes:first.notes.length,melisma:first.melismaNotes,seconds:a.samples.length/a.sampleRate,...finiteAudible(a.samples)}));
  }
  assert.deepEqual(warnings,[]);
 }finally{module._sinsy_close();}
});
