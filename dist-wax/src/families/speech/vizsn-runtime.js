import createVizsn from '../../../vendor/vizsn/vizsn.js';
export { createVizsn };
export const VIZSN_PHONES = Object.freeze({ a:0, ae:1, e:2, oe:3, o:4, i:5, y:6, u:7, h:8, v:9, j:10, s:11, l:12, r:13, k:14, t:15, p:16, n:17, m:18, ng:19 });
/** Native Vizsn letter mapping, not a general English TTS frontend.
 * Pitch is converted to the original signed 32-bit phase increment. Rate is a
 * host timing extension; its positive finite domain has no musical range cap.
 */
export function synthesizeVizsn(module, { text='aeiou', phones=null, voiceType=6, pitchHz=98, rate=1, seed=1 }={}) {
  const phase = Math.fround(Math.fround(Math.fround(pitchHz) * 65536) / 8000);
  if(!Number.isFinite(pitchHz)||!Number.isFinite(phase)||phase < -2147483648||phase >= 2147483648)throw new Error('Vizsn pitch must fit its native signed 32-bit phase increment.');
  if(!Number.isFinite(rate)||!Number.isFinite(Math.fround(rate))||Math.fround(rate)<=0)throw new Error('Vizsn timing rate must be positive and finite in native float precision.');
  if(!Number.isInteger(voiceType)||voiceType<0||voiceType>9)throw new Error('Unknown Vizsn excitation.');
  if(!Number.isInteger(seed)||seed<0||seed>0xffffffff)throw new Error('Noise seed must be an unsigned 32-bit integer.');
  let input;
  if(phones!==null) {
    if(!Array.isArray(phones)||phones.some(x=>!Number.isInteger(x)||x<0||x>19))throw new Error('Use native Vizsn phone IDs 0–19.');
    input=Uint8Array.from(phones);
  } else {
    if(typeof text!=='string')throw new Error('Use Vizsn letters.');
    text=text.toLowerCase().replaceAll('ä','{').replaceAll('ö','|').replace(/[^a-z{|\s]/g,' ');
    input=new TextEncoder().encode(text+'\0');
  }
  const ptr=module._malloc(Math.max(1,input.length));
  if(!ptr)throw new Error('Vizsn could not allocate its input.');
  try {
    module.HEAPU8.set(input,ptr);
    const length=phones===null?module._vizsn_render_text(ptr,voiceType,pitchHz,rate,seed):module._vizsn_render_phones(ptr,input.length,voiceType,pitchHz,rate,seed);
    if(length<0)throw new Error('Vizsn rejected input outside its native numeric representation.');
    const offset=module._vizsn_data()/4;
    if(!Number.isInteger(offset)||offset<0||offset+length>module.HEAPF32.length)throw new Error('Invalid Vizsn output memory.');
    const samples=module.HEAPF32.slice(offset,offset+length);
    if(!samples.every(x=>Number.isFinite(x)&&Math.abs(x)<=1))throw new Error('Invalid Vizsn PCM.');
    return {samples,sampleRate:8000};
  } finally {module._free(ptr);}
}
