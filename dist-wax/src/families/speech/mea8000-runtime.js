import createMea8000 from '../../../vendor/mea8000/mea8000.js';
export {createMea8000};
export const MEA8000_TABLES=Object.freeze({
 formant1:[150,162,174,188,202,217,233,250,267,286,305,325,346,368,391,415,440,466,494,523,554,587,622,659,698,740,784,830,880,932,988,1047],
 formant2:[440,466,494,523,554,587,622,659,698,740,784,830,880,932,988,1047,1100,1179,1254,1337,1428,1528,1639,1761,1897,2047,2214,2400,2609,2842,3105,3400],
 formant3:[1179,1337,1528,1761,2047,2400,2842,3400],formant4:[3500],
 bandwidth:[726,309,125,50],amplitude:[0,.008,.011,.016,.022,.031,.044,.062,.088,.125,.177,.25,.354,.5,.707,1],
 durationMs:[8,16,32,64],pitchIncrement:[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,0,-15,-14,-13,-12,-11,-10,-9,-8,-7,-6,-5,-4,-3,-2,-1]
});
const nearest=(table,value)=>table.reduce((best,x,i)=>Math.abs(x-value)<Math.abs(table[best]-value)?i:best,0);
/** Encodes actual MEA8000 quantized parameter frames; fourth formant is fixed3500Hz. */
export function encodeMea8000Frame({formants=[700,1200,2600],bandwidths=[125,125,125,125],amplitude=.088,durationMs=64,pitchDelta=0,noise=false}={}) {
 if(formants.length!==3||bandwidths.length!==4||![...formants,...bandwidths,amplitude,durationMs,pitchDelta].every(Number.isFinite))throw new Error('Invalid MEA8000 frame parameters.');
 const t=MEA8000_TABLES,f=formants.map((v,i)=>nearest(t['formant'+(i+1)],v)),b=bandwidths.map(v=>nearest(t.bandwidth,v));
 const a=nearest(t.amplitude,amplitude),d=nearest(t.durationMs,durationMs);
 let p=0;if(noise)p=16;else{const target=pitchDelta/(1<<d);for(let i=1;i<32;i++)if(i!==16&&Math.abs(t.pitchIncrement[i]-target)<Math.abs(t.pitchIncrement[p]-target))p=i;}
 return Uint8Array.of((b[0]<<6)|(b[1]<<4)|(b[2]<<2)|b[3],(f[2]<<5)|f[1],(f[0]<<3)|(a>>1),((a&1)<<7)|(d<<5)|p);
}
export function synthesizeMea8000(module,{frames=[{},{}],pitchHz=120,seed=1}={}) {
 if(!Number.isFinite(pitchHz)||pitchHz<0||pitchHz>510)throw new Error('Initial MEA8000 pitch uses the native 0–510 Hz pitch byte.');
 if(!Number.isInteger(seed)||seed<0||seed>0xffffffff)throw new Error('Noise seed must be an unsigned 32-bit integer.');
 let bytes;
 if(frames instanceof Uint8Array)bytes=frames;
 else if(Array.isArray(frames)&&frames.length>=1){bytes=new Uint8Array(frames.length*4);frames.forEach((f,i)=>bytes.set(encodeMea8000Frame(f),i*4));}
 else throw new Error('Provide one or more MEA8000 frames.');
 if(bytes.length<4||bytes.length%4)throw new Error('Invalid MEA8000 frame data.');
 const ptr=module._malloc(bytes.length);
 if(!ptr)throw new Error('MEA8000 could not allocate its input.');
 try {
  module.HEAPU8.set(bytes,ptr);const length=module._mea8000_render(ptr,bytes.length,Math.round(pitchHz/2)*2,seed);
  if(length<1)throw new Error('Invalid MEA8000 output length.');
  const offset=module._mea8000_data()/4;
  if(!Number.isInteger(offset)||offset<0||offset+length>module.HEAPF32.length)throw new Error('Invalid MEA8000 output memory.');
  const samples=module.HEAPF32.slice(offset,offset+length);
  if(!samples.every(x=>Number.isFinite(x)&&Math.abs(x)<1))throw new Error('Invalid MEA8000 PCM.');
  return {samples,sampleRate:64000};
 } finally{module._free(ptr);}
}
