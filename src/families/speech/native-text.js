import {validateNativeTextValues} from './native-text-controls.js';
export {NATIVE_TEXT_ENGINES,nativeTextDefaults,validateNativeTextValues} from './native-text-controls.js';
const MAX_SECONDS=120,MAX_CHARACTERS=1000,MAX_EVENTS=24000;
const escapeXml=text=>text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function validateText(text){
 if(typeof text!=='string'||!text.trim()||text.length>MAX_CHARACTERS||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text))throw new RangeError('Enter 1–1000 characters of text.');
 return text;
}
function validateOutput(result){
 const {samples,sampleRate}=result;
 if(!(samples instanceof Float32Array)||!Number.isInteger(sampleRate)||sampleRate<1||!samples.length||samples.length>sampleRate*MAX_SECONDS||samples.length>0x1000000)throw new Error('The native engine returned invalid or overlong audio.');
 for(const x of samples)if(!Number.isFinite(x)||Math.abs(x)>1)throw new Error('The native engine returned invalid PCM.');
 if(result.events){
  if(!Array.isArray(result.events)||result.events.length>MAX_EVENTS)throw new Error('The native engine returned too many events.');
  for(const event of result.events)if(!Number.isFinite(event.start)||event.start<0||event.start>samples.length/sampleRate+.1||event.end!=null&&(!Number.isFinite(event.end)||event.end<event.start||event.end>samples.length/sampleRate+.1))throw new Error('The native engine returned invalid timing.');
 }
 return result;
}
async function renderEspeak(engine,text,p){
 for(const key of ['rate','pitch','range','volume','capitals','wordGap','intonation'])if(!Number.isSafeInteger(Math.round(p[key]))||Math.round(p[key])< -2147483648||Math.round(p[key])>2147483647)throw new TypeError('eSpeak '+key+' must fit its native signed 32-bit parameter type.');
 const {default:create}=await import('../../../vendor/espeak-ng/espeak-ng.js');
 const module=await create({locateFile:name=>new URL('../../../vendor/espeak-ng/'+name,import.meta.url).href,print:()=>{},printErr:()=>{}});
 const voice=new module.eSpeakNGWorker();
 try{
  // This bundled build selects Great Britain by its voice-file name `en`;
  // `en-gb` is the language metadata, not an accepted set_voice file ID.
  const voiceName=(p.language==='en-gb'?'en':p.language)+(p.variant==='default'?'':'+'+p.variant);
  if(voice.set_voice(voiceName)!==0)throw new Error('The selected eSpeak voice is unavailable.');
  voice.set_rate(Math.round(p.rate));voice.set_pitch(Math.round(p.pitch));voice.set_range(Math.round(p.range));voice.set_volume(Math.round(p.volume));
  if(typeof module._espeak_SetParameter!=='function')throw new Error('The eSpeak native-parameter build is required.');
  // The public API stores PUNCTUATION/CAPITALS even when this upstream revision
  // reports EINVAL for them; GetParameter verifies the effective value. Native
  // SSML processing reads these saved parameters at phrase entry.
  const parameters=[[5,{none:0,all:1,some:2}[p.punctuation]],[6,Math.round(p.capitals)],[7,Math.round(p.wordGap)],[9,p.intonation|(p.emphasizeAllCaps?256:0)|(p.emphasizePenultimate?512:0)]];
  for(const [key,value]of parameters){module._espeak_SetParameter(key,value,0);if(module._espeak_GetParameter(key,1)!==value)throw new Error('eSpeak parameter '+key+' was not accepted.');}
  const punctuation=new Uint32Array([...p.punctuationSet].map(c=>c.codePointAt(0)).concat(0));
  const punctPtr=module._malloc(punctuation.byteLength);
  try{module.HEAPU8.set(new Uint8Array(punctuation.buffer),punctPtr);if(module._espeak_SetPunctuationList(punctPtr)!==0)throw new Error('eSpeak punctuation list failed.');}finally{module._free(punctPtr);}
  const chunks=[],rawEvents=[];let count=0,overLimit=false;
  let input=escapeXml(text);
  if(p.interpretation==='characters')input='<say-as interpret-as="characters">'+input+'</say-as>';
  // eSpeak's SSML emphasis sets an absolute 75/100/120 engine amplitude,
  // overriding SetParameter(VOLUME). A nested native percentage prosody tag
  // applies the performer's gain to that emphasis level before PCM generation.
  // This preserves the original emphasis stress/timing and avoids post-render
  // scaling that could not undo clipping inside the native synthesizer.
  if(p.emphasis!=='none')input='<emphasis level="'+p.emphasis+'"><prosody volume="'+Math.round(p.volume)+'%">'+input+'</prosody></emphasis>';
  voice.synthesize(input,(pcm,events)=>{
   count+=pcm.length;
   if(count>voice.samplerate*MAX_SECONDS||rawEvents.length+events.length>MAX_EVENTS){overLimit=true;return true;}
   chunks.push(Float32Array.from(pcm,x=>x/32768));rawEvents.push(...events);return false;
  });
  if(overLimit)throw new Error('eSpeak exceeded the two-minute render limit.');
  const samples=new Float32Array(count);let offset=0;for(const chunk of chunks){samples.set(chunk,offset);offset+=chunk.length;}
  const events=rawEvents.filter(e=>['phoneme','word','sentence','end'].includes(e.type)).map(e=>({type:e.type,...(e.type==='phoneme'?{phone:e.id}:{}),start:e.audio_position/1000,...(e.text_position>0?{textPosition:e.text_position,wordLength:e.word_length}:{}),native:e}));
  return {samples,sampleRate:voice.samplerate,events};
 }finally{module.destroy?.(voice);}
}
/** Full native sentence synthesis. No letter atlas, segmentation, AudioContext,
 * playback, browser SpeechSynthesis, or remote text service is used here. The
 * caller owns a disposable worker; terminate it on completion/cancel/timeout. */
export async function renderNativeText(engine,text,values={}){
 text=validateText(text);const p=validateNativeTextValues(engine,values);let result;
 if(engine==='espeak'||engine==='espeak-klatt')result=await renderEspeak(engine,text,p);
 else if(engine.startsWith('flite-')){
  const {synthesizeFlite}=await import('./flite-runtime.js');
  const response=await fetch(new URL('../../../vendor/flite/flite.wasm',import.meta.url));if(!response.ok)throw new Error('Flite could not be loaded.');
  const module=await WebAssembly.compile(await response.arrayBuffer());
  const r=synthesizeFlite(module,{text,voice:engine.slice(6),rate:p.rate,pitch:p.pitch,pitchRange:p.pitchRange});
  // KAL's native segment report does not line up with its diphone PCM clock.
  // Keep its original audio; only the Clustergen models supply display timings.
  result={samples:r.samples,sampleRate:r.sampleRate,...(!['flite-kal','flite-kal16'].includes(engine)?{events:r.events}:{})};
 }else if(engine==='gnuspeech'){
  const {createGnuspeech,synthesizeGnuspeech}=await import('./gnuspeech-runtime.js');
  const voice=await createGnuspeech();
  const {region1,region2,region3,region4,region5,region6,region7,region8,...options}=p;
  const r=synthesizeGnuspeech(voice,{text,...options,regions:[region1,region2,region3,region4,region5,region6,region7,region8]});
  // Its available posture onsets belong only to the final internal chunk;
  // omit them rather than presenting false whole-sentence phone timings.
  result={samples:r.samples,sampleRate:r.sampleRate};
 }else if(engine==='pico'){
  const {createPico,synthesizePico}=await import('./pico-runtime.js');
  const voice=await createPico({language:p.language});
  try{result=synthesizePico(voice,{text,pitch:p.pitch,speed:p.speed,volume:p.volume});}finally{voice.dispose();}
 }else if(engine==='hts'){
  const {createHts,synthesizeHts}=await import('./hts-runtime.js');
  const module=await createHts();try{result=synthesizeHts(module,{text,...p});}finally{module._hts_close();}
 }else throw new RangeError('No native text frontend for '+engine);
 return validateOutput(result);
}
