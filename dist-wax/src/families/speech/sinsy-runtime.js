import initialize from '../../../vendor/sinsy/sinsy.js';
import {validateSinsyMusicXml,validateSinsyValues} from './sinsy-score.js';

export function createSinsy(options={}) {
  return initialize({locateFile:name=>new URL('../../../vendor/sinsy/'+name,import.meta.url).href,print:()=>{},printErr:()=>{},...options});
}
export function synthesizeSinsy(module, xml, values={}) {
  const v=validateSinsyValues(values);validateSinsyMusicXml(xml,v.speed);
  if(module._sinsy_init()!==1)throw new Error(module.UTF8ToString(module._sinsy_error()));
  const bytes=new TextEncoder().encode(xml+'\0'),pointer=module._malloc(bytes.length);
  if(!pointer)throw new Error('Sinsy could not allocate its score.');
  try {
    module.HEAPU8.set(bytes,pointer);
    const length=module._sinsy_render_xml(pointer,v.alpha,v.volumeDb,v.semitones,v.speed,v.beta,v.voicingThreshold,v.gvWeight);
    if(length<1||length>48000*60)throw new Error(module.UTF8ToString(module._sinsy_error())||'Sinsy did not produce audio.');
    const offset=module._sinsy_data()/4,samples=module.HEAPF32.slice(offset,offset+length);
    if(!samples.every(value=>Number.isFinite(value)&&Math.abs(value)<=1))throw new Error('Sinsy produced invalid PCM.');
    return {samples,sampleRate:module._sinsy_sample_rate()};
  }finally{module._free(pointer);}
}
export async function renderSinsyScore(xml,values={}) {
  const v=validateSinsyValues(values);validateSinsyMusicXml(xml,v.speed);
  const module=await createSinsy();
  try{return synthesizeSinsy(module,xml,v);}finally{module._sinsy_close();}
}
