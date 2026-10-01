import {synthesizeVizsn} from './vizsn-runtime.js';
import {sustainPoints} from './vowel-loop.js';
// Explicit best-fit mapping to Vizsn's 20 native sounds. It has no complete
// English phone inventory: voiced stops, affricates and interdental fricatives
// are approximations, not claims of native English phoneme support.
export const VIZSN_GESTURES=Object.freeze({
 a:[1],b:[16],c:[14],d:[15],e:[2],f:[9],g:[14],h:[8],i:[5],j:[15,10],k:[14],l:[12],m:[18],n:[17],ng:[19],o:[0],p:[16],q:[14,7],r:[13],s:[11],sh:[11],t:[15],th:[11],dh:[9],u:[0],v:[9],w:[7],x:[14,11],y:[10],z:[11],ch:[15,11],ai:[2,5],au:[4],ei:[2,5],oi:[4,5],ou:[0,7],ee:[5],oo:[7],oa:[4,7],ay:[0,5],er:[3],uh:[7],zh:[11]
});
export function renderVizsnAtlas(module,{metadata,voiceType=6,pitchHz=98,seed=1}={}) {
 if(!metadata)throw new Error('Vizsn needs gesture metadata.');
 const clips={},pieces=[],sampleRate=8000,gap=96;let total=gap;
 for(const [key,phones] of Object.entries(VIZSN_GESTURES)) {
  const meta=metadata[key];if(!meta)throw new Error('Missing Vizsn gesture '+key);
  const sequence=key==='h'?[8,0]:meta.kind==='vowel'?[...phones,...phones,...phones]:phones;
  let raw=synthesizeVizsn(module,{phones:sequence,voiceType,pitchHz,seed}).samples;
  // Isolated Vizsn H is silent. Its H→A transition opens the H noise filters;
  // retain only that context transition, excluding the following A body.
  if(key==='h')raw=raw.subarray(600,1400);
  let first=raw.findIndex(x=>Math.abs(x)>.001),last=raw.length-1;
  while(last>first&&Math.abs(raw[last])<=.001)last--;
  if(first<0||last<=first)throw new Error('Silent Vizsn gesture '+key);
  const samples=raw.slice(Math.max(0,first-64),Math.min(raw.length,last+65));
  const fade=Math.min(24,Math.floor(samples.length/4));
  for(let n=0;n<fade;n++){samples[n]*=n/fade;samples[samples.length-1-n]*=n/fade;}
  const sustain=meta.kind==='vowel'?sustainPoints(samples,sampleRate):{sustainStart:0,sustainEnd:0};
  if(meta.kind==='vowel'&&sustain.sustainEnd<=sustain.sustainStart)throw new Error('No stable Vizsn vowel '+key);
  clips[key]={offset:total/sampleRate,duration:samples.length/sampleRate,kind:meta.kind,phone:meta.phone,gain:meta.kind==='vowel'?1:1.8,...sustain};
  pieces.push({samples,offset:total});total+=samples.length+gap;
 }
 const samples=new Float32Array(total);for(const piece of pieces)samples.set(piece.samples,piece.offset);
 return {samples,sampleRate,clips};
}
