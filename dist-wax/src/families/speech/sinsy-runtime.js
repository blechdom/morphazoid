import initialize from '../../../vendor/sinsy/sinsy.js';
import {validateSinsyMusicXml,validateSinsyValues} from './sinsy-score.js';

const timingDiagnostics = new WeakMap();
export async function createSinsy(options={}) {
  const diagnostic = { shortFrames: false };
  const module = await initialize({locateFile:name=>new URL('../../../vendor/sinsy/'+name,import.meta.url).href,print:()=>{},...options,
    printErr: message => {
      if (String(message).includes('Specified frame length is too short')) diagnostic.shortFrames = true;
      options.printErr?.(message);
    },
  });
  timingDiagnostics.set(module, diagnostic);
  return module;
}

/** The native bridge saturates doubles to signed 16-bit PCM. Finite/±1 checks
 * alone therefore accept an unstable vocoder as a successful, full-scale render.
 * Reject sustained saturation, not the native controls: their exact values and
 * occasional clipped peaks remain available for experimentation.
 */
export function validateSinsyOutput(samples, sampleRate) {
  if (!samples.length || !Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error('Sinsy produced invalid PCM.');
  let clipped = 0, run = 0;
  for (const sample of samples) {
    if (!Number.isFinite(sample) || Math.abs(sample) > 1) throw new Error('Sinsy produced invalid PCM.');
    // The positive endpoint is 32767/32768, not +1.
    const saturated = sample === -1 || sample === 32767 / 32768;
    if (saturated) clipped++;
    run = saturated ? run + 1 : 0;
    if (run >= Math.ceil(sampleRate * .02)) throw new Error('Sinsy produced sustained clipping. Choose another preset or adjust Vocal tract / alpha and Spectral variation.');
  }
  if (clipped > samples.length * .2) throw new Error('Sinsy produced sustained clipping. Choose another preset or adjust Vocal tract / alpha and Spectral variation.');
}

export function synthesizeSinsy(module, xml, values={}) {
  const v=validateSinsyValues(values);validateSinsyMusicXml(xml,v.speed);
  if(module._sinsy_init()!==1)throw new Error(module.UTF8ToString(module._sinsy_error()));
  const bytes=new TextEncoder().encode(xml+'\0'),pointer=module._malloc(bytes.length);
  if(!pointer)throw new Error('Sinsy could not allocate its score.');
  try {
    module.HEAPU8.set(bytes,pointer);
    const diagnostic=timingDiagnostics.get(module);
    if(diagnostic)diagnostic.shortFrames=false;
    const length=module._sinsy_render_xml(pointer,v.alpha,v.volumeDb,v.semitones,v.speed,v.beta,v.voicingThreshold,v.gvWeight);
    if(length<1||length>48000*60)throw new Error(module.UTF8ToString(module._sinsy_error())||'Sinsy did not produce audio.');
    const offset=module._sinsy_data()/4,samples=module.HEAPF32.slice(offset,offset+length);
    const sampleRate=module._sinsy_sample_rate();
    validateSinsyOutput(samples,sampleRate);
    return {samples,sampleRate,...(diagnostic?.shortFrames ? {
      timingUnavailable:true,noteTimings:[],timingBasis:'unavailable',
      timingWarning:'Sinsy stretched short notes at this frame density; precise piano-roll tracking is unavailable. Increase frame density or lengthen the notes.',
    } : {})};
  }finally{module._free(pointer);}
}
export async function renderSinsyScore(xml,values={}) {
  const v=validateSinsyValues(values);validateSinsyMusicXml(xml,v.speed);
  const module=await createSinsy();
  try{return synthesizeSinsy(module,xml,v);}finally{module._sinsy_close();}
}
