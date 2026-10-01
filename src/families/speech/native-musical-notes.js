import {createMusicalVoices,SAMPLE_RATE} from '../../../vendor/musical-voices/voice-api.js';
import {NATIVE_SHAPE_TRIMS} from '../../../vendor/musical-voices/native-data.js';
import {NATIVE_MUSICAL_ENGINES,nativeMusicalDefaults,SINGER_PARAMETER_KEYS} from './native-musical-controls.js';
import {validateMusicalTransition,renderMusicalTransition,musicalEndTarget} from './native-musical-transitions.js';

function validate(engine,input,parameters,maxRenderSeconds) {
 const spec=NATIVE_MUSICAL_ENGINES[engine];if(!spec)throw new Error('Unknown native musical engine.');
 const phone=input?.phone??spec.input.default;
 const p={...nativeMusicalDefaults(engine,{phone}),...parameters};
 for(const[key,value]of Object.entries(p)){
  const r=spec.controls[key];if(!r)throw new Error(`Unknown ${engine} parameter: ${key}`);
  if(r.choices ? !r.choices.includes(value) : !Number.isFinite(value)||(r.nativeMin!==undefined&&(r.nativeMinExclusive?value<=r.nativeMin:value<r.nativeMin))||(r.nativeMax!==undefined&&(r.nativeMaxExclusive?value>=r.nativeMax:value>r.nativeMax)))throw new Error(`Invalid ${engine} parameter: ${key}`);
 }
 const renderSeconds=Math.min(p.duration+p.release,maxRenderSeconds??Infinity);
 if(p.duration<=0||p.release<0||renderSeconds>30||p.attack<0||p.decay<0||p.changeTime<0||p.glottisTransition<0)throw new Error('Host note timing must be nonnegative, with at most30 seconds rendered per note.');
 return{phone,p};
}
function nativeOptions(engine,p) {
 const options={pitch:p.pitch,voiced:p.voiced,noise:p.noise,vibrato:p.vibrato,vibratoRate:p.vibratoRate,jitter:p.jitter,transition:p.transition};
 if(engine==='singer'){
  Object.assign(options,{glottis:p.glottis,glottisTransition:p.glottisTransition,tractScale:p.tractScale,tongueHumpPole:p.tongueHumpPole,tongueTipPole:p.tongueTipPole,jitterRate:p.jitterRate});
  if(p.customShape)options.shapeParameters=SINGER_PARAMETER_KEYS.map(key=>p[key]);
  if(p.customGlottis)options.glottisParameters={harmonics:p.glottisHarmonics,a:p.glottisA,b:p.glottisB};
 }else{
  Object.assign(options,{glide:p.glide,formantScale:p.formantScale,tilt:p.tilt,voiceGainRate:p.voiceGainRate,noiseGainRate:p.noiseGainRate,sourceZero:p.sourceZero});
  if(p.customFormants){
   options.formants=Array.from({length:4},(_,i)=>({frequency:p[`formant${i+1}`],radius:p[`radius${i+1}`],gain:p[`gain${i+1}`]}));
   options.formantSweepRates=Array.from({length:4},(_,i)=>p[`sweep${i+1}`]);
  }
 }
 return options;
}
function heldEnvelope(t,p) {
 if(t<p.attack)return t/p.attack;
 if(t<p.attack+p.decay)return 1-(1-p.sustain)*(t-p.attack)/p.decay;
 return p.sustain;
}
function outputGuard(x){const a=Math.abs(x);return a<=.75?x:Math.sign(x)*(.75+.15*Math.tanh((a-.75)/.15));}

/** Direct original phone/shape note. No text parser, resampling atlas or pseudo-phonemes. */
export async function createNativeMusicalRenderer(moduleOptions={}) {
 const models=await createMusicalVoices(moduleOptions);
 return function render(engine,input={},parameters={},transition={}) {
  const options=validateMusicalTransition(transition);
  const {phone,p}=validate(engine,input,parameters,options.maxRenderSeconds);
  if(options.previous){const prior=validate(engine,options.previous.input,options.previous.values,0);options.previous={input:{phone:prior.phone},values:prior.p};}
  const model=models.create(engine==='singer'?'singer':'stk');
  const noteFrames=Math.max(1,Math.round(p.duration*SAMPLE_RATE));
  const naturalLength=Math.max(noteFrames,Math.round((p.duration+p.release)*SAMPLE_RATE));
  const length=options.maxRenderSeconds===undefined?naturalLength:Math.min(naturalLength,Math.max(0,Math.round(options.maxRenderSeconds*SAMPLE_RATE)));
  const releaseFrames=naturalLength-noteFrames;
  const samples=new Float32Array(length);
  const native=nativeOptions(engine,p);
  let destination=null,transitionEnd;
  try{
   const portamento=renderMusicalTransition({model,engine,phone,p,native,options,frames:length,noteFrames,sampleRate:SAMPLE_RATE,nativeOptions});
   if(portamento){samples.set(portamento.samples);transitionEnd=portamento.transitionEnd;}
   else{
   model.set({phone,...native});
   const changeFrame=Math.min(noteFrames,Math.round(p.changeTime*SAMPLE_RATE));
   const changing=(p.destination!=='hold'||p.pitchSweep)&&changeFrame<noteFrames&&changeFrame<length;
   if(changing){
    samples.set(model.render(changeFrame));
    destination={...(p.destination!=='hold'?{phone:p.destination}:{}),...native,...(p.pitchSweep?{pitch:p.destinationPitch}:{})};
    model.set(destination);
    samples.set(model.render(length-changeFrame),changeFrame);
   }else samples.set(model.render(length));
   }
   // ADSR belongs to the note host, not to the historical model. The model is
   // held through the authored release, then receives its real quiet/release.
   model.release();
  }finally{model.dispose();}
  const trim=NATIVE_SHAPE_TRIMS[engine]?.[phone]??1;
  const levelAtRelease=heldEnvelope(p.duration,p);
  let previousInput=0,previousOutput=0;
  for(let i=0;i<samples.length;i++){
   const t=i/SAMPLE_RATE;
   const env=i<noteFrames?heldEnvelope(t,p):levelAtRelease*Math.max(0,1-(i-noteFrames)/Math.max(1,releaseFrames-1));
   // Output-only DC removal and fixed original-shape calibration. No result is
   // fed back into the model; amplitude and excitation changes stay audible.
   const x=samples[i],clean=x-previousInput+.999*previousOutput;
   previousInput=x;previousOutput=clean;
   const value=clean*trim*p.amplitude*env;
   if(!Number.isFinite(value))throw new Error('The selected musical voice became numerically unstable.');
   samples[i]=outputGuard(value);
  }
  if(samples.length){samples[0]=0;if(length===naturalLength)samples[samples.length-1]=0;}
  return{samples,sampleRate:SAMPLE_RATE,noteOffTime:noteFrames/SAMPLE_RATE,duration:samples.length/SAMPLE_RATE,
   input:{phone,...(destination?.phone?{destination:destination.phone}:{})},transitionEnd:transitionEnd??musicalEndTarget(engine,phone,p,length,SAMPLE_RATE)};
 };
}
