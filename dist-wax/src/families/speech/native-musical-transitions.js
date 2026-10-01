import {SINGER_SHAPE_DATA,STK_PHONE_DATA} from '../../../vendor/musical-voices/native-data.js';
import {SINGER_PARAMETER_KEYS} from './native-musical-controls.js';

export const MUSICAL_TRANSITION_CHUNK=32;
const lerp=(a,b,t)=>t>=1?b:t<=0?a:a*(1-t)+b*t;
const progress=(frames,seconds,sampleRate)=>Math.min(1,frames/sampleRate/seconds);

export function validateMusicalTransition(options={}) {
 const pitchPortamento=options.pitchPortamento??0,vowelPortamento=options.vowelPortamento??0;
 for(const value of [pitchPortamento,vowelPortamento])if(!Number.isFinite(value)||value<0)throw new Error('Note portamento times must be finite and nonnegative.');
 if(options.maxRenderSeconds!==undefined&&(!Number.isFinite(options.maxRenderSeconds)||options.maxRenderSeconds<0))throw new Error('The note render boundary must be finite and nonnegative.');
 return {...options,pitchPortamento,vowelPortamento};
}

function singerShape(phone,p) {
 return {shapeParameters:p.customShape?SINGER_PARAMETER_KEYS.map(key=>p[key]):[...SINGER_SHAPE_DATA[phone]],tractScale:p.tractScale};
}
function stkFormants(phone,p) {
 return p.customFormants?Array.from({length:4},(_,i)=>({frequency:p[`formant${i+1}`],radius:p[`radius${i+1}`],gain:p[`gain${i+1}`]}))
 :STK_PHONE_DATA[phone].formants.map(([frequency,radius,gain])=>({frequency:frequency*p.formantScale,radius,gain:10**(gain/20)}));
}
function shapeAt(engine,from,to,t) {
 if(engine==='singer')return {shapeParameters:to.shapeParameters.map((v,i)=>lerp(from.shapeParameters[i],v,t)),tractScale:lerp(from.tractScale,to.tractScale,t)};
 return {formants:to.map((formant,i)=>Object.fromEntries(Object.keys(formant).map(key=>[key,lerp(from[i][key],formant[key],t)])))};
}

/**
 * Track the pinned native SingWave pitch envelope, excluding vibrato/randomness.
 * Its 256-sample impuls20 source starts settled at75 Hz; StkVoice then commands
 * 220 Hz. setFrequency derives the rate from the previous COMMAND, whereas
 * Envelope ticks from its CURRENT value. A negative rate is rejected without
 * replacing the existing rate. Keeping both states matters for interrupted
 * sweeps, zero glide and custom native rates; this never generates audio.
 */
export function stkEndingPitch(p,frames,noteFrames,sampleRate,{previous,pitchSeconds=0,vowelSeconds=0}={}) {
 const scale=256/sampleRate;
 let value=75*scale,target=220*scale,command=220,rate=.001*Math.abs(target-value),sweep=.001;
 const setPitch=(pitch,glide)=>{
  sweep=glide;
  if(pitch===command)return;
  const next=pitch*scale,nextRate=sweep*Math.abs(target-next);
  target=next;command=pitch;
  if(nextRate>=0)rate=nextRate;
 };
 const tick=count=>{
  // This follows Envelope::tick's repeated additions, including rounding,
  // instead of assuming an uninterrupted target-to-target lerp.
  for(let i=0;i<count&&value!==target;i++){
   if(target>value){value+=rate;if(value>=target)value=target;}
   else{value-=rate;if(value<=target)value=target;}
  }
 };
 if(previous&&pitchSeconds>0){
  setPitch(0,1);tick(1);setPitch(previous.values.pitch,1);tick(1);
  setPitch(p.pitch,Math.min(1,1/(pitchSeconds*sampleRate)));
 }else{
  setPitch(p.pitch,p.glide);
  if(previous&&vowelSeconds>0)tick(1);
 }
 const change=Math.round(p.changeTime*sampleRate);
 if(p.pitchSweep&&change<noteFrames&&change<frames){tick(change);setPitch(p.destinationPitch,p.glide);tick(frames-change);}
 else tick(frames);
 return value/scale;
}

/** End target of a legacy note; timing is the audible/native render boundary. */
export function musicalEndTarget(engine,phone,p,frames,sampleRate) {
 const noteFrames=Math.max(1,Math.round(p.duration*sampleRate));
 const changed=Math.round(p.changeTime*sampleRate)<Math.min(noteFrames,frames);
 const pitch=engine==='stk-voicform'?stkEndingPitch(p,frames,noteFrames,sampleRate):changed&&p.pitchSweep?p.destinationPitch:p.pitch;
 return {input:{phone:changed&&p.destination!=='hold'?p.destination:phone},values:{...p,pitch,destination:'hold',pitchSweep:false}};
}

/**
 * Control the original models, never resample their PCM. Singer's original
 * source accepts pitch/tract trajectories: the bridge receives linear targets
 * every 32 samples and retains its authored tract smoothing. STK uses its own
 * sample-by-sample SingWave and FormSwep ramps. This is an explicit phrase
 * feature; absent/zero portamento leaves the legacy renderer untouched.
 */
export function renderMusicalTransition({model,engine,phone,p,native,options,frames,noteFrames,sampleRate,nativeOptions}) {
 const previous=options.previous;
 const pitchSeconds=previous?options.pitchPortamento:0,vowelSeconds=previous?options.vowelPortamento:0;
 const pitchOn=pitchSeconds>0,vowelOn=vowelSeconds>0;
 if(!pitchOn&&!vowelOn)return null;
 const fromP=previous.values,fromPhone=previous.input.phone;
 const singer=engine==='singer';
 const fromShape=vowelOn?(singer?singerShape(fromPhone,fromP):stkFormants(fromPhone,fromP)):null;
 const toShape=vowelOn?(singer?singerShape(phone,p):stkFormants(phone,p)):null;
 const fromPitch=fromP.pitch;
 const startShape=vowelOn?shapeAt(engine,fromShape,toShape,0):{};
 const samples=new Float32Array(frames);
 const sweepRate=seconds=>Math.min(1,1/(seconds*sampleRate));

 if(singer){
  if(vowelOn){
   // One silent tick establishes custom as well as factory tract radii.
   model.set({phone:fromPhone,...native,...startShape,pitch:pitchOn?fromPitch:p.pitch,transition:0,tongueHumpPole:0,tongueTipPole:0,voiced:0,noise:0,glottisTransition:0});
   model.render(1);
  }
  model.set({phone,...native,...startShape,...(pitchOn?{pitch:fromPitch}:{})});
 }else{
  // The constructor's pitch command is not its settled envelope value. First
  // reach zero, then the requested previous pitch with one-sample sweeps.
  // Silence both excitations so this initialization cannot add an attack.
  model.set({phone,...native,...startShape,...(pitchOn?{glide:1,pitch:0}:{}),...(vowelOn?{transition:1,formantSweepRates:[1,1,1,1]}:{}),voiced:0,noise:0,voiceGainRate:1,noiseGainRate:1});
  model.render(1);
  if(pitchOn){model.set({glide:1,pitch:fromPitch});model.render(1);}
  model.set({phone,...native,...(pitchOn?{glide:sweepRate(pitchSeconds)}:{}),...(vowelOn?{transition:sweepRate(vowelSeconds),formantSweepRates:Array(4).fill(sweepRate(vowelSeconds))}:{})});
 }

 const changeFrame=Math.round(p.changeTime*sampleRate);
 const hasChange=(p.destination!=='hold'||p.pitchSweep)&&changeFrame<noteFrames&&changeFrame<frames;
 let at=0,changed=false,pitchRunning=pitchOn,shapeRunning=vowelOn;
 while(at<frames){
  if(hasChange&&!changed&&at===changeFrame){
   // A within-note destination retains its original native meaning. A shape
   // change does not interrupt independent pitch portamento, or vice versa.
   if(p.destination!=='hold'){
    const destination={phone:p.destination,...nativeOptions(engine,p)};
    delete destination.pitch;
    if(pitchRunning&&!singer)destination.glide=sweepRate(pitchSeconds);
    model.set(destination);shapeRunning=false;
   }
   if(p.pitchSweep){model.set({...(!singer?{glide:p.glide}:{}),pitch:p.destinationPitch});pitchRunning=false;}
   changed=true;
  }
  if(singer){
   const controls={};
   if(pitchRunning){const t=progress(at,pitchSeconds,sampleRate);controls.pitch=lerp(fromPitch,p.pitch,t);if(t>=1)pitchRunning=false;}
   if(shapeRunning){const t=progress(at,vowelSeconds,sampleRate);Object.assign(controls,shapeAt(engine,fromShape,toShape,t));if(t>=1)shapeRunning=false;}
   if(Object.keys(controls).length)model.set(controls);
  }else{
   if(pitchRunning&&at/sampleRate>=pitchSeconds){model.set({glide:p.glide});pitchRunning=false;}
   if(shapeRunning&&at/sampleRate>=vowelSeconds){model.set({transition:p.transition,...(p.customFormants?{formantSweepRates:Array.from({length:4},(_,i)=>p[`sweep${i+1}`])}:{})});shapeRunning=false;}
  }
  let end=frames;
  if(hasChange&&!changed)end=Math.min(end,changeFrame);
  if(pitchRunning)end=Math.min(end,Math.ceil(pitchSeconds*sampleRate));
  if(shapeRunning)end=Math.min(end,Math.ceil(vowelSeconds*sampleRate));
  if(singer&&(pitchRunning||shapeRunning))end=Math.min(end,at+MUSICAL_TRANSITION_CHUNK);
  // A positive sub-sample glide settles at the first available native frame.
  end=Math.max(at+1,end);
  samples.set(model.render(end-at),at);at=end;
 }
 const target=musicalEndTarget(engine,phone,p,frames,sampleRate);
 if(!singer)target.values.pitch=stkEndingPitch(p,frames,noteFrames,sampleRate,{previous,pitchSeconds,vowelSeconds});
 else if(pitchOn&&!(changed&&p.pitchSweep))target.values.pitch=lerp(fromPitch,p.pitch,progress(frames,pitchSeconds,sampleRate));
 if(vowelOn&&!(changed&&p.destination!=='hold')){
  const state=shapeAt(engine,fromShape,toShape,progress(frames,vowelSeconds,sampleRate));
  if(singer){target.values.customShape=true;target.values.tractScale=state.tractScale;SINGER_PARAMETER_KEYS.forEach((key,i)=>target.values[key]=state.shapeParameters[i]);}
  else{target.values.customFormants=true;state.formants.forEach((formant,i)=>{target.values[`formant${i+1}`]=formant.frequency;target.values[`radius${i+1}`]=formant.radius;target.values[`gain${i+1}`]=formant.gain;});}
 }
 return {samples,transitionEnd:target};
}
