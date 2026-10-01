import createModule from './musical-voices.js';
import {STK_PHONES,SINGER_SHAPES,SINGER_GLOTTIS} from './voice-data.js';
export {STK_PHONES,SINGER_SHAPES,SINGER_GLOTTIS};
export const SAMPLE_RATE=22050;
// Every original shape is exposed; native nonfinite output can reject a render.
export const PLAYABLE_SINGER_SHAPES=Object.freeze([...SINGER_SHAPES]);
const PARAMETERS={pitch:0,voiced:1,vibrato:2,vibratoRate:3,jitter:4,noise:5,glide:6,transition:7,tilt:8,velum:9,tractScale:10,formantScale:12,voiceGainRate:13,noiseGainRate:14,sourceZero:15,tongueHumpPole:20,tongueTipPole:21,jitterRate:22};
const unvoiced=new Set(['fff','sss','thh','shh','xxx','wsp','breath','hhh','hoo','kk+','pp+','tt+']);
/** Loads WASM only. It never creates an AudioContext or opens an audio device. */
export async function createMusicalVoices(moduleOptions={}) {
  const module=await createModule(moduleOptions);
  function create(method='stk') {
    if(method!=='stk'&&method!=='singer')throw new Error('Unknown musical voice method.');
    const id=module._voice_create(method==='stk'?0:1);if(!id)throw new Error('Musical voice initialization failed.');
    let alive=true;
    const check=()=>{if(!alive)throw new Error('Musical voice has been disposed.');};
    return {
      set(options={}) {
        check();
        // SingWave's sweep rate is consumed when the next pitch target is set.
        if(options.glide!==undefined){if(!Number.isFinite(options.glide))throw new Error('Invalid glide.');module._voice_control(id,6,options.glide);}
        if(options.phone!==undefined) {
          const names=method==='stk'?STK_PHONES:SINGER_SHAPES;
          const phone=names.indexOf(options.phone);
          if(phone<0||!module._voice_phone(id,phone))throw new Error(`Unknown ${method} phoneme/shape: ${options.phone}`);
          if(method==='singer') {
            module._voice_control(id,1,unvoiced.has(options.phone)?0:.8);
            module._voice_control(id,5,1);
          }
        }
        for(const [name,param] of Object.entries(PARAMETERS))if(options[name]!==undefined){const v=Number(options[name]);if(!Number.isFinite(v))throw new Error(`Invalid ${name}.`);if(method==='stk'&&((name==='tilt'&&Math.abs(v)>=1)||(name==='transition'&&(v<0||v>1))||(['voiceGainRate','noiseGainRate'].includes(name)&&v<0)))throw new Error(`STK rejected ${name}: value outside its native setter range.`);module._voice_control(id,param,v);}
        if(options.glottis!==undefined) {
          if(method!=='singer')throw new Error('Glottis selection belongs to Singer.');
          const g=SINGER_GLOTTIS.indexOf(options.glottis);if(g<0)throw new Error('Unknown Singer glottis.');
          module._voice_glot(id,g,Math.round((options.glottisTransition ?? .02)*SAMPLE_RATE));
        }
        if(options.glottisParameters!==undefined) {
          const {harmonics,a,b}=options.glottisParameters;
          if(method!=='singer'||!Number.isFinite(harmonics)||harmonics>=200||![a,b].every(Number.isFinite))throw new Error('Invalid Singer glottal parameters.');
          module._voice_glot_parameters(id,harmonics,a,b,Math.round((options.glottisTransition ?? .02)*SAMPLE_RATE));
        }
        if(options.shapeParameters!==undefined) {
          if(method!=='singer'||options.shapeParameters.length!==17||options.shapeParameters.some(x=>!Number.isFinite(x)))throw new Error('Expected17 finite Singer shape parameters.');
          options.shapeParameters.forEach((v,i)=>module._voice_control(id,32+i,v));
        }
        if(options.formantSweepRates!==undefined) {
          if(method!=='stk'||options.formantSweepRates.length!==4||options.formantSweepRates.some(x=>!Number.isFinite(x)||x<0||x>1))throw new Error('Expected4 formant sweep rates.');
          options.formantSweepRates.forEach((v,i)=>module._voice_control(id,16+i,v));
        }
        if(options.radii!==undefined){if(method!=='singer'||options.radii.length!==8||options.radii.some(x=>!Number.isFinite(x)))throw new Error('Expected eight finite tract radii.');options.radii.forEach((v,i)=>module._voice_control(id,32+i,v));}
        if(options.formants!==undefined){if(method!=='stk'||options.formants.length!==4)throw new Error('Expected four STK formants.');options.formants.forEach(({frequency,radius,gain},i)=>{if(![frequency,radius,gain].every(Number.isFinite))throw new Error('Invalid formant.');module._voice_formant(id,i,frequency,radius,gain);});}
        return this;
      },
      render(frames) {
        check();if(!Number.isInteger(frames)||frames<0||frames>SAMPLE_RATE*30)throw new Error('Render must contain 0–30 seconds.');
        if(!frames)return new Float32Array();
        const p=module._malloc(frames*4);if(!p)throw new Error('Musical voice memory allocation failed.');
        try {const rendered=module._voice_render(id,p,frames);if(rendered===-3)throw new Error('An STK formant exceeds Nyquist (11025 Hz) or has an invalid pole radius. Reduce its multiplier or edit its original formants.');if(rendered!==frames)throw new Error('Musical voice produced unstable output.');return module.HEAPF32.slice(p/4,p/4+frames);}finally{module._free(p);}
      },
      release(){check();module._voice_release(id);},
      dispose(){if(alive){module._voice_destroy(id);alive=false;}},
    };
  }
  function synthesize({method='stk',sequence,phone=method==='stk'?'aaa':'ahh',duration=.4,...options}={}) {
    if(!sequence)sequence=[{phone,duration,...options}];
    if(!Array.isArray(sequence)||!sequence.length||sequence.length>512)throw new Error('Invalid vocal sequence.');
    const voice=create(method),parts=[];let length=0;
    try {
      voice.set(options);
      for(const step of sequence){if(!Number.isFinite(step.duration)||step.duration<=0||step.duration>10)throw new Error('Invalid phoneme duration.');voice.set(step);const n=Math.round(step.duration*SAMPLE_RATE);length+=n;if(length>SAMPLE_RATE*30)throw new Error('Vocal phrase exceeded 30 seconds.');parts.push(voice.render(n));}
      const samples=new Float32Array(length);let at=0;for(const part of parts){samples.set(part,at);at+=part.length;}
      return {samples,sampleRate:SAMPLE_RATE};
    }finally{voice.dispose();}
  }
  return {create,synthesize};
}
