import { createNativeMusicalRenderer } from '../../families/speech/native-musical-notes.js';
import { NATIVE_MUSICAL_ENGINES } from '../../families/speech/native-musical-controls.js';
import { CSOUND_NATIVE, renderNativeCsound } from './csound-native.js';

export const NATIVE_PHRASE_ENGINES=Object.freeze(['singer','stk-voicform','csound-fof','csound-vosim']);
export const NATIVE_PHRASE_BUDGET=Object.freeze({notes:62,seconds:120,renderedFrames:12000000});
const nativeRate=engine=>engine.startsWith('csound-')?24000:22050;

/** Validate a finite host timeline, without clamping a native sound parameter. */
export function planNativePhrase(engine,phrase) {
  if(!NATIVE_PHRASE_ENGINES.includes(engine))throw new Error('This engine does not expose native phrase notes.');
  if(!phrase||!Number.isFinite(phrase.tempo))throw new TypeError('Phrase tempo must be finite.');
  if(!Array.isArray(phrase.notes)||!phrase.notes.length||phrase.notes.length>NATIVE_PHRASE_BUDGET.notes)throw new Error('A phrase supports 1–62 notes within its rendering budget.');
  const pitchPortamento=phrase.pitchPortamento??0,vowelPortamento=phrase.vowelPortamento??0;
  for(const value of [pitchPortamento,vowelPortamento])if(!Number.isFinite(value)||value<0)throw new TypeError('Phrase portamento times must be finite and nonnegative.');
  const spec=NATIVE_MUSICAL_ENGINES[engine]??CSOUND_NATIVE[engine],sampleRate=nativeRate(engine);
  let start=0,estimatedFrames=0,estimatedEnd=0;
  const notes=phrase.notes.map((note,index)=>{
    if(!note||typeof note!=='object'||!note.input||typeof note.input!=='object'||Array.isArray(note.input)||!note.values||typeof note.values!=='object'||Array.isArray(note.values))throw new TypeError(`Phrase note ${index+1} needs original input and complete native values.`);
    if(note.rest!==undefined&&typeof note.rest!=='boolean')throw new TypeError('A phrase rest flag must be boolean.');
    const values=note.values;
    if(Object.keys(values).length!==Object.keys(spec.controls).length)throw new Error(`Phrase note ${index+1} has incomplete native values.`);
    for(const [key,rule]of Object.entries(spec.controls))if(rule.choices?!rule.choices.includes(values[key]):!Number.isFinite(values[key]))throw new TypeError(`Invalid native phrase value: ${key}.`);
    if(spec.input&&!spec.input.choices.includes(note.input.phone))throw new Error(`Phrase note ${index+1} needs an original vocal shape.`);
    if(values.duration<0)throw new Error('A sequential phrase needs nonnegative note durations.');
    const end=start+values.duration,rest=note.rest===true,interior=index<phrase.notes.length-1;
    // Interior duration is a fixed slot. Fit a valid release inside it without
    // changing stored values; a release that fills/exceeds the slot is heard
    // as authored until a short boundary fade. The final note keeps its tail.
    const fitRelease=interior&&values.release>=0&&values.release<values.duration;
    const renderValues=fitRelease?{...values,duration:values.duration-values.release}:values;
    const boundaryFade=interior&&values.release>=values.duration;
    const renderSeconds=interior?Math.min(values.duration,Math.max(0,renderValues.duration+renderValues.release)):Math.max(0,values.duration+values.release);
    const releaseEnd=rest?end:start+renderSeconds;
    estimatedEnd=Math.max(estimatedEnd,end,releaseEnd);
    if(!rest)estimatedFrames+=Math.ceil(renderSeconds*sampleRate)+2;
    const entry={index,rest,start,end,input:note.input,values,renderValues,interior,boundaryFade};start=end;return entry;
  });
  if(!Number.isFinite(estimatedEnd)||estimatedEnd>NATIVE_PHRASE_BUDGET.seconds)throw new Error('The phrase exceeds its 120-second output budget, including its final release tail.');
  if(!Number.isSafeInteger(estimatedFrames)||estimatedFrames>NATIVE_PHRASE_BUDGET.renderedFrames)throw new Error('The phrase exceeds its native-render work budget.');
  return {sampleRate,notes,duration:start,estimatedEnd,pitchPortamento,vowelPortamento};
}

/** Native notes occupy disjoint slots; each note retains its own attack. */
export function createNativePhraseRenderer({musicalFactory=createNativeMusicalRenderer,csoundRenderer=renderNativeCsound}={}) {
  let musicalRenderer;
  const renderNote=async(engine,input,values,transition)=>{
    if(engine.startsWith('csound-'))return csoundRenderer(engine,input,values,transition);
    if(!musicalRenderer)musicalRenderer=Promise.resolve().then(()=>musicalFactory()).catch(error=>{musicalRenderer=null;throw error;});
    return (await musicalRenderer)(engine,input,values,transition);
  };
  return async function renderNativePhrase(engine,phrase) {
    const plan=planNativePhrase(engine,phrase),{sampleRate}=plan;
    const capacity=Math.ceil(NATIVE_PHRASE_BUDGET.seconds*sampleRate);
    const output=new Float32Array(capacity),noteTimings=[];
    let length=Math.max(1,Math.round(plan.duration*sampleRate)),renderedFrames=0,previous;
    for(const note of plan.notes){
      const offset=Math.round(note.start*sampleRate),slotEnd=Math.round(note.end*sampleRate),slotFrames=slotEnd-offset;
      if(note.rest){noteTimings.push({index:note.index,rest:true,start:offset/sampleRate,end:slotEnd/sampleRate,gateEnd:slotEnd/sampleRate,releaseEnd:slotEnd/sampleRate});previous=undefined;continue;}
      const transition={pitchPortamento:plan.pitchPortamento,vowelPortamento:plan.vowelPortamento,...(previous?{previous}:{}),...(note.interior?{maxRenderSeconds:slotFrames/sampleRate}:{})};
      const result=await renderNote(engine,note.input,note.renderValues,transition);
      if(!(result.samples instanceof Float32Array)||result.sampleRate!==sampleRate)throw new Error('A native phrase note returned an unexpected PCM format.');
      renderedFrames+=result.samples.length;
      if(renderedFrames>NATIVE_PHRASE_BUDGET.renderedFrames)throw new Error('The phrase exceeds its native-render work budget.');
      const keep=note.interior?Math.min(slotFrames,result.samples.length):result.samples.length;
      const releaseFrame=offset+keep;
      if(releaseFrame>capacity)throw new Error('The phrase exceeds its 120-second native output budget.');
      const fade=note.boundaryFade?Math.min(keep,Math.max(1,Math.round(.005*sampleRate))):0;
      for(let i=0;i<result.samples.length;i++){
        const value=result.samples[i];
        if(!Number.isFinite(value))throw new Error('A native phrase note produced non-finite PCM.');
        if(i<keep)output[offset+i]=value*(fade&&i>=keep-fade?(keep-1-i)/Math.max(1,fade-1):1);
      }
      length=Math.max(length,releaseFrame);
      const gate=Number.isFinite(result.noteOffTime)?result.noteOffTime:note.renderValues.duration;
      noteTimings.push({index:note.index,rest:false,start:offset/sampleRate,end:slotEnd/sampleRate,gateEnd:Math.min(offset/sampleRate+gate,releaseFrame/sampleRate),releaseEnd:releaseFrame/sampleRate,...(fade?{boundaryFade:fade/sampleRate}:{})});
      previous=result.transitionEnd??{input:note.input,values:note.renderValues};
    }
    return {samples:output.slice(0,length),sampleRate,duration:length/sampleRate,noteTimings,timingBasis:'native-note-slots'};
  };
}

export const renderNativePhrase=createNativePhraseRenderer();

/** Nominal score-note timing, not native phoneme labels or waveform alignment. */
export function sinsyScoreTimings(score) {
  if(!score?.notes?.length||!Number.isFinite(score.tempo)||score.tempo<=0)return {noteTimings:[],timingBasis:'score-derived',timingUnavailable:true};
  const secondsPerTick=60/score.tempo/480;
  const first=score.notes[0],last=score.notes.at(-1);
  const leading=first.rest||first.midi===null?0:120,trailing=last.rest||last.midi===null?0:120;
  let tick=leading;
  const noteTimings=score.notes.map((note,index)=>{
    const start=tick*secondsPerTick;tick+=Math.round((note.beats??1)*480);
    const end=tick*secondsPerTick;return {index,rest:!!note.rest||note.midi===null,start,end,releaseEnd:null};
  });
  return {noteTimings,timingBasis:'score-derived',leadingRest:leading*secondsPerTick,trailingRest:trailing*secondsPerTick,scoreDuration:(tick+trailing)*secondsPerTick};
}
