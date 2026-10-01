import { renderNativeText } from '../../families/speech/native-text.js';
import { renderNativeRetro } from '../../families/speech/native-retro.js';
import { createNativeMusicalRenderer } from '../../families/speech/native-musical-notes.js';
import { renderNativeCsound } from './csound-native.js';
import { renderSinsyScore } from '../../families/speech/sinsy-runtime.js';
import { sinsyScoreToMusicXml } from '../../families/speech/sinsy-score.js';
import { renderNativePhrase, sinsyScoreTimings, NATIVE_PHRASE_ENGINES } from './native-phrase.js';

let started=false;
self.onmessage=async({data})=>{
  if(started)return;started=true;
  try {
    const {engine,input,values,text}=data;
    let result;
    if(engine==='sinsy')result={...await renderSinsyScore(sinsyScoreToMusicXml(input),values),...sinsyScoreTimings(input)};
    else if(NATIVE_PHRASE_ENGINES.includes(engine)&&Object.hasOwn(input??{},'phrase'))result=await renderNativePhrase(engine,input.phrase);
    else if(['singer','stk-voicform'].includes(engine))result=(await createNativeMusicalRenderer())(engine,input,values);
    else if(engine.startsWith('csound-'))result=await renderNativeCsound(engine,input,values);
    else if(['vizsn','mea8000'].includes(engine))result=await renderNativeRetro(engine,engine==='mea8000'?{durationMs:values.durationMs}:input,engine==='mea8000'?Object.fromEntries(Object.entries(values).filter(([key])=>key!=='durationMs')):values);
    else result=await renderNativeText(engine,text,values);
    self.postMessage({type:'ready',...result},[result.samples.buffer]);
  }catch(error){self.postMessage({type:'error',message:error.message||String(error)});}
};
