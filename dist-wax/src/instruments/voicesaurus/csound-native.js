import { renderCsound } from '../../families/speech/csound-runtime.js';
const knob=(label,min,def,max,unit='',step=.01)=>({label,min,default:def,max,unit,step});
const common={
  pitch:knob('Fundamental',20,145,2000,'Hz',1),amplitude:knob('Amplitude',0,.2,1),duration:knob('Note duration',.08,2,12,'s'),
  attack:knob('Attack',.001,.02,2,'s',.001),release:knob('Release',.005,.12,3,'s',.001),
  formant1:knob('Formant 1',20,700,10000,'Hz',1),formant2:knob('Formant 2',20,1200,10000,'Hz',1),formant3:knob('Formant 3',20,2600,10000,'Hz',1),
  gain1:knob('Formant 1 gain',0,1,3),gain2:knob('Formant 2 gain',0,.55,3),gain3:knob('Formant 3 gain',0,.3,3),
  vibrato:knob('Vibrato depth',0,.01,.5),vibratoRate:knob('Vibrato rate',0,5.3,30,'Hz'),
};
export const CSOUND_NATIVE={
 'csound-fof':{mode:'note',controls:{...common,
   bandwidth1:knob('Bandwidth 1',1,70,3000,'Hz',1),bandwidth2:knob('Bandwidth 2',1,100,3000,'Hz',1),bandwidth3:knob('Bandwidth 3',1,140,3000,'Hz',1),
   octave:knob('Octaviation',0,0,8),grainRise:knob('Grain rise',.0001,.003,.2,'s',.0001),grainDuration:knob('Grain duration',.001,.03,.5,'s',.001),grainDecay:knob('Grain decay',.0001,.007,.2,'s',.0001),
   phase:knob('Initial phase',0,0,1),
 }},
 'csound-vosim':{mode:'note',controls:{...common,pulses:knob('Pulses',1,3,64,'',1),decay:{...knob('Pulse amplitude decrement',-1,.02,1,'',.001),description:'Native VOSIM kDecay: subtract this absolute amplitude from every successive pulse. Negative values grow the burst.'},pulseFactor:{...knob('Pulse width multiplier',-4,1,4),description:'Native VOSIM kPulseFactor: multiply pulse width on each new pulse. Negative values alternate table direction; zero removes later pulses.'}}},
};
const vowels=[['Open AH',700,1200,2600],['Bright EE',280,2300,3000],['Round OO',320,800,2300],['Low bass',500,900,2000],['High soprano',700,1400,3000],['Metal throat',1200,3000,5800],['Subaudio pulses',150,500,1800],['Uncanny whistle',3000,5100,8000]];
for(const [engine,spec] of Object.entries(CSOUND_NATIVE))spec.presets=vowels.map(([label,formant1,formant2,formant3],i)=>({id:`${engine}-${i+1}`,label,values:{formant1,formant2,formant3,...(i===3?{pitch:65}:i===4?{pitch:420}:i===6?{pitch:20}:i===7?{pitch:900}:{}),...(engine==='csound-vosim'&&i===5?{pulses:24,decay:.002}:{})}}));

// The enclosing worker owns this compiled module; instances remain per-note.
let nativeCsoundModule;
async function loadNativeCsoundModule() {
  if(!nativeCsoundModule)nativeCsoundModule=(async()=>{
    const response=await fetch(new URL('../../../vendor/csound/csound.wasm',import.meta.url));
    if(!response.ok)throw Error('Csound download failed.');
    return WebAssembly.compile(await response.arrayBuffer());
  })().catch(error=>{nativeCsoundModule=null;throw error;});
  return nativeCsoundModule;
}

/** Optional phrase transitions run inside the original Csound opcodes.
 * Pitch is linear in Hz. Vowel ramps use each opcode's native control-rate
 * formant centers/gains, plus FOF bandwidths. Envelopes and i-rate state stay
 * those of the current note. A time of zero keeps the original fixed note.
 */
export function buildNativeCsoundVoice(engine,p,transition={}) {
  if(!Object.hasOwn(CSOUND_NATIVE,engine))throw Error('Unknown native Csound voice.');
  const pitchPortamento=transition.pitchPortamento??0,vowelPortamento=transition.vowelPortamento??0;
  for(const [label,value]of [['Pitch portamento',pitchPortamento],['Vowel portamento',vowelPortamento]]){
    if(!Number.isFinite(value)||value<0)throw new TypeError(`${label} time must be finite and nonnegative.`);
  }
  const previous=transition.previous?.values,lines=[];
  function ramp(key,seconds,symbol){
    if(!previous||seconds===0)return String(p[key]);
    if(!Number.isFinite(previous[key])||!Number.isFinite(p[key]))throw new TypeError(`Native Csound transition endpoints must be finite: ${key}.`);
    if(previous[key]===p[key])return String(p[key]);
    lines.push(`${symbol} linseg ${previous[key]}, ${seconds}, ${p[key]}`);
    return symbol;
  }
  const pitch=ramp('pitch',pitchPortamento,'kNotePitch');
  const peakPitch=previous&&pitchPortamento>0?Math.max(Math.abs(previous.pitch),Math.abs(p.pitch)):Math.abs(p.pitch);
  const overlaps=Math.max(2048,Math.ceil(peakPitch*(1+Math.abs(p.vibrato))*Math.max(0,p.grainDuration??0))+4);
  if(engine==='csound-fof'&&overlaps>1000000)throw Error('This FOF request exceeds the grain-allocation memory budget.');
  const bands=[1,2,3].map(n=>{
    const formant=ramp('formant'+n,vowelPortamento,'kFormant'+n),gain=ramp('gain'+n,vowelPortamento,'kGain'+n);
    const amplitude=gain.startsWith('k')?`${p.amplitude}*${gain}`:p.amplitude*p['gain'+n];
    return engine==='csound-fof'
      ?`a${n} fof ${amplitude}, kPitch, ${formant}, ${p.octave}, ${ramp('bandwidth'+n,vowelPortamento,'kBandwidth'+n)}, ${p.grainRise}, ${p.grainDuration}, ${p.grainDecay}, ${overlaps}, giSine, giEnv, p3, ${p.phase}`
      :`a${n} vosim ${amplitude}, kPitch, ${formant}, ${p.decay}, ${p.pulses}, ${p.pulseFactor}, giEnv`;
  }).join('\n');
  const naturalDuration=p.duration+p.release;
  if(transition.maxRenderSeconds!==undefined&&(!Number.isFinite(transition.maxRenderSeconds)||transition.maxRenderSeconds<0))throw new TypeError('Native Csound rendering cap must be finite and nonnegative.');
  const duration=transition.maxRenderSeconds===undefined?naturalDuration:Math.min(naturalDuration,transition.maxRenderSeconds);
  // A positive gate can end while its authored attack is still rising. Start
  // release at that gate's actual level rather than giving linseg a negative
  // hold segment. All other native envelope requests retain their old path.
  const envelope=p.duration>0&&p.attack>0&&p.duration<p.attack
    ?`aEnv linseg 0,${p.duration},${p.duration/p.attack},${p.release},0`
    :`aEnv linseg 0,${p.attack},1,${p.duration-p.attack},1,${p.release},0`;
  const orchestra=`sr=24000
ksmps=32
nchnls=1
0dbfs=1
giSine ftgen 1,0,16384,10,1
giEnv ftgen 2,0,16384,19,${engine==='csound-vosim'?1:.5},.5,270,.5
instr 1
kVib oscili ${p.vibrato},${p.vibratoRate}
${lines.length?lines.join('\n')+'\n':''}kPitch = ${pitch}*(1+kVib)
${bands}
aClean dcblock2 a1+a2+a3
${envelope}
out aClean*aEnv
endin`;
  return {orchestra,score:`i1 0 ${duration}\ne`,maxSeconds:duration+1,renderDuration:duration};
}

export async function renderNativeCsound(engine,input,p,transition={},load=loadNativeCsoundModule) {
  const voice=buildNativeCsoundVoice(engine,p,transition),module=await load();
  const result=renderCsound(module,voice.orchestra,voice.score,{maxSeconds:voice.maxSeconds});
  const values={...p},previous=transition.previous?.values;
  const elapsed=Math.max(0,Math.min(voice.renderDuration,result.samples.length/result.sampleRate));
  function finish(key,seconds){
    if(!previous||!(seconds>0))return;
    const fraction=Math.min(1,elapsed/seconds);
    values[key]=fraction===1?p[key]:previous[key]*(1-fraction)+p[key]*fraction;
  }
  finish('pitch',transition.pitchPortamento);
  for(let n=1;n<=3;n++){
    finish('formant'+n,transition.vowelPortamento);finish('gain'+n,transition.vowelPortamento);
    if(engine==='csound-fof')finish('bandwidth'+n,transition.vowelPortamento);
  }
  return {...result,transitionEnd:{input:structuredClone(input),values}};
}
