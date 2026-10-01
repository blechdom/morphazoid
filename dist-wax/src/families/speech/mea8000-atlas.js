import {synthesizeMea8000} from './mea8000-runtime.js';
import {sustainPoints} from './vowel-loop.js';
// Original educational English-ish formant/frame targets, not recovered chip
// speech ROMs or a historical MEA8000 text frontend. Encoder quantizes each.
const vowels={a:[700,1700,2600],e:[500,1800,2600],i:[350,2000,2842],o:[750,1100,2400],u:[650,1200,2600],ee:[300,2200,2842],oo:[350,800,2400],au:[550,900,2400],er:[450,1400,1761],uh:[450,1000,2400]};
const pairs={ai:['e','ee'],ei:['e','ee'],oi:['au','ee'],ou:['o','oo'],oa:['au','oo'],ay:['a','ee']};
const consonants={b:[300,800,2400],c:[650,1600,2842],d:[400,1700,2842],f:[900,2600,3400],g:[400,1500,2842],h:[700,1200,2600],j:[650,2200,3400],k:[650,1600,2842],l:[450,1200,2600],m:[250,900,1761],n:[250,1700,2400],ng:[250,1400,2400],p:[350,1000,2400],q:[650,1600,2842],r:[450,1300,1761],s:[1047,3400,3400],sh:[900,2600,3400],t:[900,3105,3400],th:[1047,2600,3400],dh:[500,2200,2842],v:[550,1800,2842],w:[350,800,2400],x:[900,2842,3400],y:[300,2200,2842],z:[650,3105,3400],ch:[900,2600,3400],zh:[650,2600,3400]};
export function mea8000GestureFrames(key) {
 if(vowels[key])return Array.from({length:5},()=>({formants:vowels[key],amplitude:.125}));
 if(pairs[key])return pairs[key].flatMap(k=>Array.from({length:2},()=>({formants:vowels[k],amplitude:.125})));
 const formants=consonants[key];if(!formants)throw new Error('Unknown MEA8000 gesture '+key);
 const noise=['c','f','h','k','p','q','s','sh','t','th','x','ch'].includes(key),stop=['b','c','d','g','k','p','q','t'].includes(key);
 return Array.from({length:stop?2:3},()=>({formants,noise,amplitude:noise?.25:.125,bandwidths:noise?[309,309,309,309]:[125,125,125,125],durationMs:stop?16:32}));
}
export function renderMea8000Atlas(module,{metadata,pitchHz=120,seed=1,formantScale=1,bandwidth=125,durationMs=32}={}) {
 if(!metadata)throw new Error('MEA8000 needs gesture metadata.');
 const clips={},pieces=[],sampleRate=64000,gap=768;let total=gap;
 for(const [key,meta] of Object.entries(metadata)) {
  let frames=mea8000GestureFrames(key);
  // Short chip frames still need a playable vowel body. Repeat the steady target
  // for at least128ms; the native update rate and attack interpolation stay intact.
  if(meta.kind==='vowel' && frames.length*durationMs<128) frames=Array.from({length:Math.ceil(128/durationMs)},()=>frames[0]);
  frames=frames.map(frame=>({...frame,formants:frame.formants.map(value=>value*formantScale),bandwidths:[bandwidth,bandwidth,bandwidth,bandwidth],durationMs}));
  const raw=synthesizeMea8000(module,{frames,pitchHz,seed}).samples;
  let first=raw.findIndex(x=>Math.abs(x)>.0005),last=raw.length-1;
  while(last>first&&Math.abs(raw[last])<=.0005)last--;
  if(first<0||last<=first)throw new Error('Silent MEA8000 gesture '+key);
  const samples=raw.slice(Math.max(0,first-512),Math.min(raw.length,last+513));
  // Fixed target per educational phone keeps different quantized resonances
  // comparable while retaining within-phone dynamics and explicit peak headroom.
  const rms=Math.sqrt(samples.reduce((s,x)=>s+x*x,0)/samples.length),peak=samples.reduce((p,x)=>Math.max(p,Math.abs(x)),0);
  const gain=Math.min(.13/Math.max(rms,1e-6),.8/Math.max(peak,1e-6));
  for(let n=0;n<samples.length;n++)samples[n]*=gain;
  const fade=Math.min(192,Math.floor(samples.length/4));for(let n=0;n<fade;n++){samples[n]*=n/fade;samples[samples.length-1-n]*=n/fade;}
  const sustain=meta.kind==='vowel'?sustainPoints(samples,sampleRate):{sustainStart:0,sustainEnd:0};
  if(meta.kind==='vowel'&&sustain.sustainEnd<=sustain.sustainStart)throw new Error('No stable MEA8000 vowel '+key);
  clips[key]={offset:total/sampleRate,duration:samples.length/sampleRate,kind:meta.kind,phone:meta.phone,gain:meta.kind==='vowel'?1:1.8,...sustain};
  pieces.push({samples,offset:total});total+=samples.length+gap;
 }
 const samples=new Float32Array(total);for(const piece of pieces)samples.set(piece.samples,piece.offset);
 return {samples,sampleRate,clips};
}
