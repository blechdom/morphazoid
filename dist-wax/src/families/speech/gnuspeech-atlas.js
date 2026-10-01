import {synthesizeGnuspeech} from './gnuspeech-runtime.js';
import {sustainPoints} from './vowel-loop.js';
import {SPELLING_DIPHONE_CLIPS} from '../../instruments/spelling-synthesizer/spelling-diphone-atlas.js';
// The model's own phonetic symbols; vowels verified against its English dictionary.
export const GNUSPEECH_PHONES=Object.freeze({
  a:'aa',b:'b',c:'k',d:'d',e:'e',f:'f',g:'g',h:'h',i:'i',j:'j',k:'k',l:'l',m:'m',n:'n',ng:'ng',o:'ar',p:'p',q:'k_w',r:'r',s:'s',sh:'sh',t:'t',th:'th',dh:'dh',u:'a',v:'v',w:'w',x:'k_s',y:'y',z:'z',ch:'ch',ai:'e_i',au:'aw',ei:'e_i',oi:'o_i',ou:'ah_uu',ee:'ee',oo:'uu',oa:'uh_uu',ay:'ah_i',er:'er_r',uh:'u',zh:'zh',
});
export function renderGnuspeechAtlas(engine,options={}) {
  const clips={},pieces=[];
  const sampleRate=options.sampleRate??44100,gap=Math.round(sampleRate*.012);
  let total=gap;
  for(const [key,phone]of Object.entries(GNUSPEECH_PHONES)){
    const result=synthesizeGnuspeech(engine,{...options,phones:`/c // /0 # /w /l /* ${phone} # // /c`,drift:false,microIntonation:false,macroIntonation:false,randomIntonation:false,sampleRate});
    const rendered=result.samples;
    const first=rendered.findIndex(n=>Math.abs(n)>.001);
    let last=rendered.length-1;
    while(last>first&&Math.abs(rendered[last])<=.001)last--;
    if(first<0||last<=first)throw new Error(`Gnuspeech could not render ${key}.`);
    const pad=Math.round(sampleRate*.008);
    const samples=rendered.slice(Math.max(0,first-pad),Math.min(rendered.length,last+pad+1));
    const fade=Math.min(Math.round(sampleRate*.003),Math.floor(samples.length/4));
    for(let i=0;i<fade;i++){samples[i]*=i/fade;samples[samples.length-1-i]*=i/fade;}
    const {kind,phone:label}=SPELLING_DIPHONE_CLIPS[key];
    clips[key]={offset:total/sampleRate,duration:samples.length/sampleRate,kind,phone:label,gain:1,
      ...(kind==='vowel'?sustainPoints(samples,sampleRate):{sustainStart:0,sustainEnd:0})};
    pieces.push({samples,offset:total});total+=samples.length+gap;
  }
  const samples=new Float32Array(total);for(const piece of pieces)samples.set(piece.samples,piece.offset);
  return {samples,sampleRate,clips};
}
