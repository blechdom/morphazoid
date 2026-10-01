import{synthesizePico}from'./pico-runtime.js';
import{sustainPoints}from'./vowel-loop.js';
import{SPELLING_DIPHONE_CLIPS}from'../../instruments/spelling-synthesizer/spelling-diphone-atlas.js';
// XSAMPA symbols verified against Pico's en-US examples, including affricate/diphthong separators.
export const PICO_PHONES=Object.freeze({
 a:'{',b:'b',c:'k',d:'d',e:'E',f:'f',g:'g',h:'h',i:'I',j:'d_Z',k:'k',l:'l',m:'m',n:'n',ng:'N',o:'A:',p:'p',q:'kw',r:'r\\',s:'s',sh:'S',t:'t',th:'T',dh:'D',u:'V',v:'v',w:'w',x:'ks',y:'j',z:'z',ch:'t_S',ai:'e_I',au:'O:',ei:'e_I',oi:'O_I',ou:'a_U',ee:'i:',oo:'u:',oa:'o_U',ay:'a_I',er:'3`:',uh:'U',zh:'Z',
});
export function renderPicoAtlas(engine,options={}){
 const clips={},pieces=[],sampleRate=16000,gap=Math.round(sampleRate*.012);let total=gap;
 for(const[key,phone]of Object.entries(PICO_PHONES)){
  const{kind,phone:label}=SPELLING_DIPHONE_CLIPS[key];
  // The non-rhotic British model omits isolated /r/ and gives weak unreleased
  // /b,g/. Render their opening into schwa, retaining the attack transition.
  const contextual=engine.language==='en-GB'&&['b','g','r'].includes(key);
  let rendered=synthesizePico(engine,{...options,phones:contextual?'"'+phone+'@':(['vowel','glide'].includes(kind)?'"':'')+phone,speed:options.speed??.8,volume:options.volume??.7}).samples;
  if(contextual){
   const frames=[];let max=0;const window=160;
   for(let pos=0;pos+window<=rendered.length;pos+=window){let sum=0;for(let i=pos;i<pos+window;i++)sum+=rendered[i]**2;const rms=Math.sqrt(sum/window);frames.push(rms);max=Math.max(max,rms);}
   const open=frames.findIndex(rms=>rms>max*.25);
   if(open<0)throw Error(`Missing Pico ${key} release.`);
   // This is an acoustic onset estimate, not a phoneme timing event.
   const end=Math.min(rendered.length,(open+2)*window);
   rendered=rendered.slice(Math.max(0,end-Math.round(sampleRate*.09)),end);
  }
  let first=rendered.findIndex(n=>Math.abs(n)>.0003),last=rendered.length-1;while(last>first&&Math.abs(rendered[last])<=.0003)last--;
  if(first<0||last<=first)throw Error(`Pico could not render ${key}.`);
  const pad=Math.round(sampleRate*.008),samples=rendered.slice(Math.max(0,first-pad),Math.min(rendered.length,last+pad+1));
  const fade=Math.min(Math.round(sampleRate*.003),Math.floor(samples.length/4));for(let i=0;i<fade;i++){samples[i]*=i/fade;samples[samples.length-1-i]*=i/fade;}
  let peak=0,squares=0;for(const sample of samples){peak=Math.max(peak,Math.abs(sample));squares+=sample*sample;}
  // Balance the rendered gesture bodies without increasing their peak beyond .85.
  const rms=Math.sqrt(squares/samples.length),target=['vowel','glide','liquid'].includes(kind)?.17:.12;
  const gain=Math.min(3,target/Math.max(.0001,rms),.85/Math.max(.0001,peak));
  for(let i=0;i<samples.length;i++)samples[i]*=gain;
  clips[key]={offset:total/sampleRate,duration:samples.length/sampleRate,kind,phone:label,gain:1,
   ...(kind==='vowel'?sustainPoints(samples,sampleRate):{sustainStart:0,sustainEnd:0})};
  pieces.push({samples,offset:total});total+=samples.length+gap;
 }
 const samples=new Float32Array(total);for(const p of pieces)samples.set(p.samples,p.offset);return{samples,sampleRate,clips};
}
