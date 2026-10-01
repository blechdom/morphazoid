import {synthesizeHts} from './hts-runtime.js';
import {sustainPoints} from './vowel-loop.js';
// Real phones synthesized in dictionary-word context, then sliced by the HMM's
// state durations. Full native phrase prosody remains available via runtime.js.
export const HTS_GESTURES=Object.freeze({
 a:['cat',['ae']],b:['bat',['b']],c:['cat',['k']],d:['dog',['d']],e:['bed',['eh']],f:['fish',['f']],g:['go',['g']],h:['hat',['hh']],i:['bit',['ih']],j:['jam',['jh']],
 k:['cat',['k']],l:['light',['l']],m:['moon',['m']],n:['night',['n']],ng:['sing',['ng']],o:['father',['aa']],p:['pen',['p']],q:['queen',['k','w']],r:['red',['r']],s:['see',['s']],
 sh:['ship',['sh']],t:['top',['t']],th:['thin',['th']],dh:['this',['dh']],u:['cup',['ah']],v:['van',['v']],w:['wet',['w']],x:['six',['k','s']],y:['yes',['y']],z:['zoo',['z']],
 ch:['chin',['ch']],ai:['day',['ey']],au:['law',['ao']],ei:['day',['ey']],oi:['boy',['oy']],ou:['cow',['aw']],ee:['see',['iy']],oo:['food',['uw']],oa:['go',['ow']],ay:['eye',['ay']],er:['bird',['er']],uh:['book',['uh']],zh:['vision',['zh']]
});
export function renderHtsAtlas(module,{metadata,speed=.5,semitones=0,beta=0,voicingThreshold=.5,gvWeight=1}={}) {
 if(!metadata)throw new Error('HTS needs gesture metadata.');
 const clips={},pieces=[],sampleRate=48000,gap=576,cache=new Map();let total=gap;
 for(const [key,[text,phones]] of Object.entries(HTS_GESTURES)) {
  const meta=metadata[key];if(!meta)throw new Error('Missing HTS gesture '+key);
  if(!cache.has(text))cache.set(text,synthesizeHts(module,{text,speed,semitones,beta,voicingThreshold,gvWeight}));
  const rendered=cache.get(text),index=rendered.events.findIndex((e,n)=>phones.every((phone,i)=>rendered.events[n+i]?.phone===phone));
  if(index<0)throw new Error('HTS dictionary did not produce '+key+' in '+text+': '+rendered.events.map(e=>e.phone).join(' '));
  const start=Math.round(rendered.events[index].start*sampleRate),end=Math.round(rendered.events[index+phones.length-1].end*sampleRate);
  const samples=rendered.samples.slice(start,end);
  if(!samples.some(x=>Math.abs(x)>.0005))throw new Error('Silent HTS gesture '+key);
  const rms=Math.sqrt(samples.reduce((s,x)=>s+x*x,0)/samples.length),peak=samples.reduce((p,x)=>Math.max(p,Math.abs(x)),0),gain=Math.min(.13/Math.max(rms,1e-6),.8/Math.max(peak,1e-6));
  for(let n=0;n<samples.length;n++)samples[n]*=gain;
  const fade=Math.min(144,Math.floor(samples.length/4));for(let n=0;n<fade;n++){samples[n]*=n/fade;samples[samples.length-1-n]*=n/fade;}
  const sustain=meta.kind==='vowel'?sustainPoints(samples,sampleRate):{sustainStart:0,sustainEnd:0};
  if(meta.kind==='vowel'&&sustain.sustainEnd<=sustain.sustainStart)throw new Error('No stable HTS vowel '+key);
  clips[key]={offset:total/sampleRate,duration:samples.length/sampleRate,kind:meta.kind,phone:meta.phone,gain:meta.kind==='vowel'?1:1.8,...sustain};
  pieces.push({samples,offset:total});total+=samples.length+gap;
 }
 const samples=new Float32Array(total);for(const piece of pieces)samples.set(piece.samples,piece.offset);
 return {samples,sampleRate,clips};
}
