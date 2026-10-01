import initialize from '../../../vendor/hts/hts.js';
export function createHts(options={}) {
 return initialize({locateFile:name=>new URL('../../../vendor/hts/'+name,import.meta.url).href,print:()=>{},printErr:()=>{},...options});
}
export function synthesizeHts(module,{text='Hello from the HMM voice.',speed=1,semitones=0,beta=0,voicingThreshold=.5,gvWeight=1,alpha=.55,framePeriod=240,volumeDb=0,f0GvWeight=1,sampleRate=48000}={}) {
 if(typeof text!=='string'||!text.trim()||text.length>1000||!/^[\x09\x0a\x0d\x20-\x7e]+$/.test(text))throw new Error('HTS currently accepts 1–1000 English/ASCII characters.');
 if(![speed,semitones,beta,voicingThreshold,gvWeight,alpha,volumeDb,f0GvWeight].every(Number.isFinite))throw new TypeError('HTS controls must be finite.');
 if(module._hts_init()!==1)throw new Error('HTS SLT model failed to load.');
 if(![framePeriod,sampleRate].every(value=>Number.isInteger(value)&&value>=0&&value<=0xffffffff))throw new TypeError('HTS frame period and sample rate use native unsigned 32-bit integers.');
 if(module._hts_configure(alpha,framePeriod,volumeDb,f0GvWeight,sampleRate)!==1)throw new Error('HTS rejected its vocoder configuration.');
 const bytes=new TextEncoder().encode(text+'\0'),ptr=module._malloc(bytes.length);
 try {
  module.HEAPU8.set(bytes,ptr);const length=module._hts_render_text(ptr,speed,semitones,beta,voicingThreshold,gvWeight);
  if(length<1||length>0x1000000)throw new Error('HTS did not generate bounded speech: '+length);
  const offset=module._hts_data()/4,samples=module.HEAPF32.slice(offset,offset+length);
  if(!samples.every(x=>Number.isFinite(x)&&Math.abs(x)<=1))throw new Error('Invalid HTS PCM.');
  const events=[];for(let n=0;n<module._hts_event_count();n++)events.push({type:'phoneme',phone:module.UTF8ToString(module._hts_event_phone(n)),start:module._hts_event_start(n),end:module._hts_event_end(n)});
  return {samples,sampleRate:module._hts_sample_rate()>>>0,events};
 }finally{module._free(ptr);}
}
