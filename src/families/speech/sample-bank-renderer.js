import {VocalzoidAudio,VOCALZOID_MAX_DECODED_BANK_BYTES} from '../../instruments/vocalzoid/vocalzoid-audio.js';
import {VOCALZOID_OPEN_BANKS} from '../../instruments/vocalzoid/vocalzoid-open-banks.js';
import {normalizeUtauPath,resolveUtauEntry,vocalzoidRenderPlan,vocalzoidStyle} from '../../instruments/vocalzoid/vocalzoid.js';
import {SPELLING_DIPHONE_ATLAS_URL} from '../../instruments/spelling-synthesizer/spelling-diphone-atlas.js';
import {spellingPhoneDefinition} from '../../instruments/spelling-synthesizer/spelling-pronunciation.js';

export const SAMPLE_BANK_RENDER_BUDGET=Object.freeze({notes:62,seconds:120,frames:12_000_000});
const aborted=()=>Object.assign(new Error('Sample-bank rendering cancelled.'),{name:'AbortError'});
const checkAbort=signal=>{if(signal?.aborted)throw aborted();};
const finite=(value,label)=>{if(!Number.isFinite(value))throw new TypeError(`${label} must be finite.`);return value;};
const ranged=(value,min,max,label)=>{finite(value,label);if(value<min||value>max)throw new RangeError(`${label} must be between ${min} and ${max}.`);return value;};
const unique=values=>[...new Set(values)];

/** Validate the existing sample renderer's musical domain without silently
 * clamping a caller's values. File objects stay outside serializable scenes.
 */
export function validateSampleBankRequest(request={}) {
 const result={bpm:108,source:'kal',openBankId:'',style:'raw',vibratoCents:22,vibratoRate:5.2,glideMs:65,...request};
 ranged(result.bpm,40,220,'Sample-bank tempo');
 ranged(result.vibratoCents,0,100,'Vibrato depth');
 ranged(result.vibratoRate,2,9,'Vibrato rate');
 ranged(result.glideMs,0,260,'Pitch glide');
 if(!['kal','open','local'].includes(result.source))throw new TypeError('Choose KAL16, an open demo bank, or a local UTAU bank.');
 if(!['raw','glass','velvet'].includes(result.style))throw new TypeError('Choose an existing sample voice style.');
 if(result.source==='open'&&!VOCALZOID_OPEN_BANKS[result.openBankId])throw new TypeError('Choose an existing open demo bank.');
 if(result.source==='local'&&result.notes?.length&&(!result.bank||!(result.bank.files instanceof Map)||!Array.isArray(result.bank.entries)))throw new TypeError('Import a local UTAU folder before rendering this source.');
 if(result.rootMidi!==undefined)ranged(result.rootMidi,24,96,'Fallback source pitch');
 if(result.scoreBeats!==undefined){finite(result.scoreBeats,'Score beats');if(result.scoreBeats<=0)throw new RangeError('Score beats must be positive.');}
 if(!Array.isArray(result.notes)||result.notes.length>SAMPLE_BANK_RENDER_BUDGET.notes||!result.notes.length&&!result.scoreBeats)throw new RangeError(`A sample-bank phrase supports up to ${SAMPLE_BANK_RENDER_BUDGET.notes} notes; an all-rest phrase needs its scoreBeats duration.`);
 const ids=new Set();
 result.notes=result.notes.map((source,index)=>{
  if(!source||typeof source!=='object')throw new TypeError(`Note ${index+1} is invalid.`);
  const note=structuredClone(source);note.id=String(note.id??`bank-${index+1}`);
  if(ids.has(note.id))throw new TypeError('Sample-bank note IDs must be unique.');ids.add(note.id);
  finite(note.start,'Note start');finite(note.duration,'Note duration');finite(note.midi,'Note MIDI pitch');
  if(note.start<0||note.duration<=0)throw new RangeError('Sample-bank notes need nonnegative starts and positive durations.');
  ranged(note.midi,0,127,'Sample-bank MIDI pitch');
  if(typeof note.lyric!=='string'||note.alias!==undefined&&typeof note.alias!=='string')throw new TypeError('Sample-bank lyrics and aliases must be text.');
  if(!Array.isArray(note.phones)||!note.phones.length&&result.source!=='local'||note.phones.some(phone=>typeof phone!=='string'||!spellingPhoneDefinition(phone)))throw new TypeError('Use valid ARPAbet phones, or an empty phone list with a local-bank alias.');
  for(const [key,min,max,label]of [['vibratoCents',0,100,'Vibrato depth'],['vibratoRate',2,9,'Vibrato rate'],['glideMs',0,260,'Pitch glide'],['rootMidi',24,96,'Fallback source pitch']])if(note[key]!==undefined)ranged(note[key],min,max,label);
  if(note.style!==undefined&&!['raw','glass','velvet'].includes(note.style))throw new TypeError('Choose an existing per-note sample voice style.');
  return note;
 }).sort((a,b)=>a.start-b.start);
 result.scoreBeats=Math.max(result.scoreBeats??0,...result.notes.map(note=>note.start+note.duration));
 if(result.scoreBeats*60/result.bpm>SAMPLE_BANK_RENDER_BUDGET.seconds)throw new RangeError('Sample-bank phrases are limited to two minutes.');
 return result;
}

function sourcePitch(bank,entry,fallback=bank.rootMidi) {
 const path=normalizeUtauPath(entry.path||entry.filename),direct=bank.sourceMidiByPath?.get(path);
 if(Number.isFinite(direct))return direct;
 for(const [candidate,midi]of bank.sourceMidiByPath??[])if(candidate.endsWith('/'+path)&&Number.isFinite(midi))return midi;
 return Math.min(96,Math.max(24,fallback));
}

function setupOfflineGraph(sampler,context,destination) {
 const input=context.createGain(),highpass=context.createBiquadFilter(),presence=context.createBiquadFilter(),lowpass=context.createBiquadFilter(),compressor=destination??context.createDynamicsCompressor();
 highpass.type='highpass';presence.type='peaking';presence.Q.value=.72;lowpass.type='lowpass';lowpass.Q.value=.35;
 if(!destination){compressor.threshold.value=-16;compressor.knee.value=10;compressor.ratio.value=7;compressor.attack.value=.004;compressor.release.value=.14;compressor.connect(context.destination);}
 input.connect(highpass).connect(presence).connect(lowpass).connect(compressor);
 Object.assign(sampler,{context,input,highpass,presence,lowpass,compressor});
 // Each offline path starts in its authored style; no live parameter change
 // occurs here, so introducing a filter sweep from Web Audio defaults is wrong.
 highpass.frequency.value=sampler.style.highpass;presence.frequency.value=sampler.style.presenceFrequency;
 presence.gain.value=sampler.style.presenceGain;lowpass.frequency.value=sampler.style.lowpass;input.gain.value=sampler.style.drive;
}

// A recipe can schedule an onset before discovering that its sustain cannot
// play. Remove that partial recipe before scheduling a complete fallback note.
function rollbackPartial(sampler,before) {
 for(const active of [...sampler.active])if(!before.has(active)){
  active.source.onended=null;try{active.source.stop(0);}catch{}
  try{active.source.disconnect();}catch{}try{active.gain.disconnect();}catch{}
  sampler.active.delete(active);
 }
}

/** Offline PCM adapter for the existing waveform/OTO sampler. This does not
 * port UTAU/OpenUtau/Vocaloid engines. It never creates/resumes a live context,
 * arms Audio, or connects a device output. The caller owns playback and meters.
 * Calls run serially to keep local decode/render memory bounded. Cancellation
 * drops stale results; OfflineAudioContext cannot stop a render in progress.
 */
export function createSampleBankRenderer({runtime=globalThis,sampleRate=48000}={}) {
 ranged(sampleRate,8000,96000,'Offline sample rate');
 const assetBuffers=new Map(),controllers=new Set();let localBanks=new WeakMap(),tail=Promise.resolve(),disposed=false;
 const fetcher=runtime.fetch?.bind(runtime)??globalThis.fetch?.bind(globalThis);
 const Offline=runtime.OfflineAudioContext??runtime.webkitOfflineAudioContext;
 const loadAsset=(context,url,signal)=>{
  const key=String(url);
  if(!assetBuffers.has(key)){
   const pending=Promise.resolve().then(async()=>{
    if(typeof fetcher!=='function')throw new Error('Voice samples need browser fetch support.');
    const response=await fetcher(url,{signal});if(!response||response.ok===false)throw new Error('A bundled sample voice could not load.');
    return context.decodeAudioData(await response.arrayBuffer());
   }).catch(error=>{assetBuffers.delete(key);throw error;});
   assetBuffers.set(key,pending);
  }
  return assetBuffers.get(key);
 };
 const run=async(request,signal)=>{
  checkAbort(signal);if(disposed)throw new Error('The sample-bank renderer is closed.');
  const q=validateSampleBankRequest(request);
  if(!q.notes.length){
   const duration=q.scoreBeats*60/q.bpm,frames=Math.ceil(duration*sampleRate);
   if(frames>SAMPLE_BANK_RENDER_BUDGET.frames)throw new RangeError('The rest phrase exceeds the PCM rendering budget.');
   return {samples:new Float32Array(frames),sampleRate,duration:frames/sampleRate,scoreBeats:q.scoreBeats,scoreDuration:duration,scoreOffsetSeconds:0,customNotes:0,openNotes:0,fallbackNotes:0,fallbackNoteIds:[],sourceName:q.bank?.name??VOCALZOID_OPEN_BANKS[q.openBankId]?.name??vocalzoidStyle(q.style).name,requestedSource:q.source,outputGain:1,warnings:[]};
  }
  if(typeof Offline!=='function')throw new Error('Sample-bank singing needs OfflineAudioContext support.');
  const sequence=q.notes,beatSeconds=60/q.bpm,plan=vocalzoidRenderPlan(sequence,q.bpm),warnings=[];
  const scoreDuration=q.scoreBeats*beatSeconds;
  // Reserve the original maximum pickup and final source release before
  // decoding. Crop only the unused tail after the actual pickup is known.
  const soundDuration=Math.max(scoreDuration,...plan.map(event=>event.start+event.duration),...sequence.map(note=>note.start*beatSeconds+Math.max(.14,note.duration*beatSeconds)));
  const maximumDuration=soundDuration+.525,frames=Math.ceil(maximumDuration*sampleRate);
  if(maximumDuration>SAMPLE_BANK_RENDER_BUDGET.seconds||frames>SAMPLE_BANK_RENDER_BUDGET.frames)throw new RangeError('The sample-bank phrase exceeds the PCM rendering budget.');
  const context=new Offline(1,frames,sampleRate),sampler=new VocalzoidAudio({runtime,style:q.style});
  setupOfflineGraph(sampler,context);const samplers=new Map([[q.style,sampler]]);
  let resolved=[],openBuffer=null;
  const finish=()=>{for(const voice of samplers.values())voice.stop({immediate:true});};
  try{
   sampler.atlas=await loadAsset(context,SPELLING_DIPHONE_ATLAS_URL,signal);checkAbort(signal);
   if(q.source==='local'){
    let bank=localBanks.get(q.bank);
    if(!bank){bank=sampler.setBank(q.bank);localBanks.set(q.bank,bank);}else sampler.bank=bank;
    bank.rootMidi=q.rootMidi??q.bank.rootMidi??60;
    let previousPhone='-';const buffers=new Map();
    for(const note of sequence){
     const entry=resolveUtauEntry(bank.entries,note,previousPhone);previousPhone=note.phones.at(-1)??previousPhone;resolved.push({entry,buffer:null});
    }
    // Reuse original decoder and its 256 MB guard, serially as before.
    for(const entry of new Set(resolved.map(item=>item.entry).filter(Boolean))){
     checkAbort(signal);
     try{buffers.set(entry,await sampler.decodeBankEntry(entry));}catch(error){warnings.push(`Sample ${entry.filename||entry.path}: ${error.message}`);buffers.set(entry,null);}
    }
    checkAbort(signal);resolved=resolved.map(({entry})=>({entry,buffer:buffers.get(entry)??null}));
    if(bank.decodedBytes>VOCALZOID_MAX_DECODED_BANK_BYTES)throw new RangeError('Decoded voicebank audio exceeds the memory budget.');
   }else if(q.source==='open'){
    sampler.setOpenBank(q.openBankId);
    try{openBuffer=await loadAsset(context,sampler.openBank.url,signal);}catch(error){warnings.push(`${sampler.openBank.name}: ${error.message}`);}
    checkAbort(signal);
   }
   const fallbackPitch=q.rootMidi??q.bank?.rootMidi??60;
   const maximumPreutter=q.source==='local'?Math.max(0,...resolved.map(({entry},i)=>entry?Math.min(.45,Math.max(0,entry.preutterance/1000/Math.max(.001,2**((sequence[i].midi-sourcePitch(sampler.bank,entry,sequence[i].rootMidi??fallbackPitch))/12)))):0)):0;
   const builtInPickup=Math.max(0,-Math.min(0,...plan.map(event=>event.start)));
   // Preserve enough pre-roll for every possible open recipe's onset.
   const openPickup=q.source==='open'?Math.min(.45,Math.max(0,...sequence.map(note=>Math.min(note.duration*beatSeconds*.32,.45)-note.start*beatSeconds))):0;
   const baseTime=.055+Math.min(.45,Math.max(maximumPreutter,builtInPickup,openPickup));
   const voiceFor=note=>{
    const style=note.style??q.style;
    if(!samplers.has(style)){
     const voice=new VocalzoidAudio({runtime,style});setupOfflineGraph(voice,context,sampler.compressor);
     Object.assign(voice,{atlas:sampler.atlas,bank:sampler.bank,openBank:sampler.openBank});samplers.set(style,voice);
    }
    return samplers.get(style);
   };
   const optionsFor=note=>({vibratoCents:note.vibratoCents??q.vibratoCents,vibratoRate:note.vibratoRate??q.vibratoRate,glideSeconds:(note.glideMs??q.glideMs)/1000});
   const fallbacks=new Set(),unmatched=[],unusable=[];let previousMidi=sequence[0].midi;
   for(const [index,note]of sequence.entries()){
    checkAbort(signal);
    const voice=voiceFor(note),options=optionsFor(note);
    if(voice.bank)voice.bank.rootMidi=note.rootMidi??fallbackPitch;
    if(q.source!=='kal'){
     const before=new Set(voice.active);
     const good=q.source==='local'?voice.scheduleUtau(note,resolved[index].entry,resolved[index].buffer,baseTime,beatSeconds,options,previousMidi):voice.scheduleOpenNote(note,openBuffer,baseTime,beatSeconds,options,previousMidi);
     if(!good){rollbackPartial(voice,before);fallbacks.add(note.id);(q.source==='local'&&!resolved[index].entry?unmatched:unusable).push(note.id);}
    }
    previousMidi=note.midi;
   }
   const previousById=new Map();previousMidi=sequence[0].midi;
   for(const note of sequence){previousById.set(note.id,previousMidi);previousMidi=note.midi;}
   const notesById=new Map(sequence.map(note=>[note.id,note]));
   for(const event of plan)if(q.source==='kal'||fallbacks.has(event.noteId)){
    const note=notesById.get(event.noteId),voice=voiceFor(note);
    if(!voice.scheduleBuiltIn(event,baseTime,optionsFor(note),previousById.get(event.noteId)))throw new Error(`KAL16 could not render ${event.phone}.`);
   }
   if(unmatched.length)warnings.push(`${unmatched.length} notes had no matching local alias and use KAL16.`);
   if(unusable.length)warnings.push(`${unusable.length} notes lacked a usable sample/recipe and use KAL16.`);
   for(const note of sequence)if(fallbacks.has(note.id)&&!note.phones.length)warnings.push(`Note ${note.lyric||note.id} has no fallback phones; KAL16 uses AH.`);
   checkAbort(signal);const rendered=await context.startRendering();checkAbort(signal);
   const samples=rendered.getChannelData(0).slice(0,Math.min(frames,Math.ceil((baseTime+soundDuration+.02)*sampleRate)));
   let peak=0;for(const value of samples){if(!Number.isFinite(value))throw new Error('The sample bank produced invalid PCM.');peak=Math.max(peak,Math.abs(value));}
   // Preserve source dynamics; only attenuate an over-range mix. The shared
   // Voicesaurus output owns the performer's volume and final playback trim.
   const outputGain=peak>.95?.95/peak:1;if(outputGain<1)for(let i=0;i<samples.length;i++)samples[i]*=outputGain;
   const customNotes=q.source==='local'?sequence.length-fallbacks.size:0,openNotes=q.source==='open'?sequence.length-fallbacks.size:0;
   return {samples,sampleRate,duration:samples.length/sampleRate,scoreBeats:q.scoreBeats,scoreDuration,scoreOffsetSeconds:baseTime,customNotes,openNotes,fallbackNotes:q.source==='kal'?sequence.length:fallbacks.size,fallbackNoteIds:q.source==='kal'?sequence.map(note=>note.id):[...fallbacks],sourceName:customNotes?sampler.bank.name:openNotes?sampler.openBank.name:vocalzoidStyle(q.style).name,requestedSource:q.source,outputGain,warnings:unique(warnings)};
  }finally{finish();}
 };
 return {
  render(request,{signal}={}){
   // Copy note/control input at call time; keep the session-only bank identity
   // for its file and decoded-audio cache. Later UI edits cannot change a job.
   const snapshot={...request,notes:structuredClone(request?.notes)},controller=new AbortController();
   const relay=()=>controller.abort();if(signal?.aborted)relay();else signal?.addEventListener('abort',relay,{once:true});controllers.add(controller);
   const job=tail.then(()=>run(snapshot,controller.signal)).finally(()=>{controllers.delete(controller);signal?.removeEventListener('abort',relay);});tail=job.catch(()=>{});return job;
  },
  clearAssets(){assetBuffers.clear();},
  close(){disposed=true;for(const controller of controllers)controller.abort();assetBuffers.clear();localBanks=new WeakMap();},
 };
}
