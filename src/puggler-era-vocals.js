import { renderCharacterVocal } from './puggler-vocals.js';

// Theatrical transformations of the licensed OI/WOO recordings, not historical
// reconstructions or recordings of additional people. The recorded waveform and
// syllable envelope remain the principal voice; a quieter formant layer sings.
// Source/filter and parallel formant sections: Julius O. Smith,
// https://dsprelated.com/freebooks/pasp/Voice_Synthesis.html
// Harmonic excitation/formant groups as a compact singing-voice approximation:
// https://dsprelated.com/freebooks/sasp/FM_Voice.html
const TAU=Math.PI*2;
const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
const sample=(data,at)=>{
  if(at<0||at>=data.length)return 0;
  const i=Math.floor(at),f=at-i;return data[i]*(1-f)+(data[i+1]??0)*f;
};
const smooth=x=>{x=clamp(x,0,1);return x*x*(3-2*x);};
const profiles=[
  {id:'history-caveman',skin:'history',owner:0,hz:196,notes:[0,-2,0,3,0],stretch:1.04,formant:.86,vowel:0,vibrato:.19,vibratoHz:4.2,liquid:0,singing:.27,room:.19,chorus:.06,cutoff:4500},
  {id:'history-dame-roxy',skin:'history',owner:1,hz:261.63,notes:[0,3,2,0,-2],stretch:1.07,formant:1.05,vowel:1,vibrato:.24,vibratoHz:5.1,liquid:0,singing:.31,room:.24,chorus:.05,cutoff:6100},
  {id:'history-maestro-moss',skin:'history',owner:2,hz:329.63,notes:[0,4,7,9,7,4,2,0],stretch:1.10,formant:.96,vowel:2,vibrato:.36,vibratoHz:5.6,liquid:0,singing:.39,room:.28,chorus:.06,cutoff:7000},
  {id:'future-futureman',skin:'future',owner:0,hz:174.61,notes:[0,0,-3,0,7,5,0],stretch:.99,formant:.84,vowel:2,vibrato:.09,vibratoHz:4.7,liquid:.12,singing:.42,room:.05,chorus:.17,cutoff:4300},
  {id:'future-cyberwoman',skin:'future',owner:1,hz:523.25,notes:[0,7,9,7,4,12,7,0],stretch:1.06,formant:1.16,vowel:1,vibrato:.37,vibratoHz:5.8,liquid:.24,singing:.37,room:.13,chorus:.18,cutoff:8200},
  {id:'future-quor',skin:'future',owner:2,hz:261.63,notes:[0,7,2,10,5,12,3,0],stretch:1.09,formant:.78,vowel:3,vibrato:.88,vibratoHz:5.2,liquid:1,singing:.42,room:.11,chorus:.24,cutoff:5300},
];
export const ERA_VOCAL_PROFILES=Object.freeze(profiles.map(p=>Object.freeze({...p,notes:Object.freeze(p.notes)})));
const vowels=[[740,1120,2480],[440,1720,2600],[560,900,2300],[330,730,2180]];

function chooseProfile(character) {
  return ERA_VOCAL_PROFILES.find(p=>p.id===character?.id)
    ??ERA_VOCAL_PROFILES.find(p=>p.skin===character?.skin&&p.owner===character?.owner)
    ??ERA_VOCAL_PROFILES[character?.skin==='future'?3:0];
}
function rms(data) {let sum=0;for(const x of data)sum+=x*x;return Math.sqrt(sum/Math.max(1,data.length));}

// A small, fixed-rate analysis follows syllables and voiced pitch. It is only a
// guide for a sound effect, not a transcript or a validated pitch estimator.
function analyse(source,sampleRate) {
  const rate=4000,hop=40,window=240;
  const low=new Float32Array(Math.ceil(source.length*rate/sampleRate));
  // Average a short input interval before decimating rather than folding all
  // high-frequency consonants straight into the pitch estimate.
  const width=Math.max(1,Math.round(sampleRate/rate));
  for(let i=0;i<low.length;i++){
    const at=i*sampleRate/rate;let sum=0;
    for(let j=0;j<width;j++)sum+=sample(source,at+j-width*.5);
    low[i]=sum/width;
  }
  const frames=[],correlations=new Float32Array(65);
  for(let start=-window/2;start<low.length;start+=hop){
    let energy=0;for(let j=0;j<window;j++){const x=low[start+j]??0;energy+=x*x;}
    let best=0,bestLag=20;
    for(let lag=7;lag<65;lag++){
      let xy=0,xx=0,yy=0;
      for(let j=0;j<window-lag;j++){
        const x=low[start+j]??0,y=low[start+j+lag]??0;xy+=x*y;xx+=x*x;yy+=y*y;
      }
      const score=xy/Math.sqrt(Math.max(1e-18,xx*yy));correlations[lag]=score;
      if(score>best){best=score;bestLag=lag;}
    }
    // Select the first convincing periodic peak, avoiding later multiples.
    for(let lag=8;lag<64;lag++)if(correlations[lag]>.88*best&&correlations[lag]>.45&&correlations[lag]>=correlations[lag-1]&&correlations[lag]>=correlations[lag+1]){bestLag=lag;break;}
    frames.push({rms:Math.sqrt(energy/window),pitch:rate/bestLag,voicing:clamp((best-.28)/.45,0,1)});
  }
  return frames;
}
function frameAt(frames,time) {
  const at=clamp(time*100,0,frames.length-1),i=Math.floor(at),f=at-i,a=frames[i],b=frames[Math.min(i+1,frames.length-1)];
  return {rms:a.rms+(b.rms-a.rms)*f,pitch:a.pitch+(b.pitch-a.pitch)*f,voicing:a.voicing+(b.voicing-a.voicing)*f};
}
function noteAt(profile,progress,role) {
  // OI uses a slower phrase contour so each recorded consonant still resolves;
  // WOO carries the more elaborate melisma between the same source boundaries.
  const notes=profile.notes,at=clamp(progress,0,.999999)*(notes.length-1),i=Math.floor(at),f=at-i;
  const blend=smooth(f/(profile.skin==='future'&&profile.owner===0?.2:.7));
  return (notes[i]+(notes[i+1]-notes[i])*blend)*(role==='oi'?.62:1);
}
function bandpass(rate,hz,bandwidth) {
  const w=TAU*Math.min(rate*.42,hz)/rate,a=Math.sin(w)/(2*Math.max(.6,hz/bandwidth));
  return [a/(1+a),-2*Math.cos(w)/(1+a),(1-a)/(1+a)];
}
function polyBlep(t,dt) {
  if(t<dt){const x=t/dt;return x+x-x*x-1;}
  if(t>1-dt){const x=(t-1)/dt;return x*x+x+x+1;}
  return 0;
}

/** Render once at Audio arm; no nodes, timers, randomness or persistent caches.
 * Accepts mono PCM at 8–192 kHz, at most eight seconds. Normal game phrases are
 * about two seconds with a short finite tail. Every source syllable is visited
 * in order; two crossfaded granular reads bend its pitch without chopping it.
 */
export function renderEraVocal(input,sampleRate,character,role='woo') {
  if(!(input instanceof Float32Array))throw new TypeError('Era vocals require Float32Array PCM');
  if(!Number.isFinite(sampleRate)||sampleRate<8000||sampleRate>192000)throw new RangeError('Era vocal sample rate must be 8000–192000 Hz');
  if(input.length>sampleRate*8)throw new RangeError('Era vocal input is limited to eight seconds');
  if(character?.skin==='punk')return renderCharacterVocal(input,sampleRate,character);
  if(!input.length)return new Float32Array();
  const p=chooseProfile(character),isOi=role==='oi',stretch=p.stretch*(isOi?.96:1);
  const speechLength=Math.ceil(input.length*stretch),tail=Math.ceil(sampleRate*.18),length=speechLength+tail;
  const source=Float32Array.from(input,x=>Number.isFinite(x)?clamp(x,-1,1):0),sourceRms=rms(source);
  const output=new Float32Array(length);
  if(sourceRms<1e-12)return output;
  const frames=analyse(source,sampleRate),human=new Float32Array(length),sung=new Float32Array(length);
  const states=Array.from({length:3},()=>({z1:0,z2:0,coeff:[0,0,0]}));
  const grain=sampleRate*(p.skin==='history'?.036:.046),baseSpeed=1/stretch;
  const lowAlpha=1-Math.exp(-TAU*Math.min(p.cutoff,sampleRate*.4)/sampleRate),highAlpha=Math.exp(-TAU*65/sampleRate);
  let grainPhase=.25,phase=0,lp=0,hp=0,previous=0,pitch=200,pitchRatio=1,envelope=0,voicing=0;
  for(let i=0;i<speechLength;i++){
    const time=i/sampleRate,progress=i/speechLength,sourceTime=i*baseSpeed/sampleRate;
    if(i%32===0){
      const f=frameAt(frames,sourceTime),note=noteAt(p,progress,role);
      const vibrato=p.vibrato*Math.sin(TAU*p.vibratoHz*time)*smooth(progress*9);
      const liquid=p.liquid*.8*Math.sin(TAU*1.7*time+.5);
      pitch=clamp(p.hz*2**((note+vibrato+liquid)/12),80,960);
      pitchRatio=pitch/Math.max(75,f.pitch);
      // Keep extreme soprano notes in a musically related octave instead of
      // clipping the recorded pitch to an unrelated fixed transposition.
      while(pitchRatio>2.8)pitchRatio*=.5;
      while(pitchRatio<.55)pitchRatio*=2;
      envelope=f.rms;voicing=f.voicing;
      const moving=.5+.5*Math.sin(TAU*(p.skin==='future'?1.1:.34)*time+p.owner);
      const a=vowels[p.vowel],b=vowels[(p.vowel+1)%vowels.length],vowelMix=moving*(p.skin==='future'?.75:.32);
      for(let k=0;k<3;k++){
        const hz=(a[k]+(b[k]-a[k])*vowelMix)*p.formant*(1+p.liquid*.16*Math.sin(TAU*.7*time+k));
        states[k].coeff=bandpass(sampleRate,hz,[110,150,220][k]*(p.skin==='future'?1.3:1));
      }
    }
    grainPhase+=(pitchRatio-baseSpeed)/grain;grainPhase-=Math.floor(grainPhase);
    const other=(grainPhase+.5)%1,weight=.5-.5*Math.cos(TAU*grainPhase),at=i*baseSpeed;
    let recorded=sample(source,at+(grainPhase-.5)*grain)*weight+sample(source,at+(other-.5)*grain)*(1-weight);
    // The unshifted consonant edge remains audible where pitch evidence is weak.
    const original=sample(source,at),wet=.28+.68*voicing;
    recorded=recorded*wet+original*(1-wet);
    hp=highAlpha*(hp+recorded-previous);previous=recorded;lp+=lowAlpha*(hp-lp);
    const syllableGate=smooth(envelope/Math.max(.004,sourceRms*.17));
    human[i]=lp*syllableGate;
    const dt=Math.min(.12,pitch/sampleRate);phase+=dt;phase-=Math.floor(phase);
    // A band-limited glottal-like excitation feeds three parallel vowel bands.
    // Its amplitude follows the recorded human syllable, never a free-running bed.
    const excitation=(2*phase-1-polyBlep(phase,dt))*.72+Math.sin(TAU*phase)*.28;
    let vowel=0;
    for(let k=0;k<3;k++){
      const state=states[k],[b,a1,a2]=state.coeff,y=b*excitation+state.z1;
      state.z1=-a1*y+state.z2;state.z2=-b*excitation-a2*y;
      vowel+=y*[1,.72,.34][k];
    }
    const funk=p.skin==='future'&&p.owner===0?.84+.16*Math.cos(TAU*3.3*time):1;
    sung[i]=vowel*envelope*voicing*syllableGate*funk;
  }
  const humanGain=Math.min(3,sourceRms/Math.max(1e-12,rms(human))),sungGain=Math.min(18,sourceRms/Math.max(1e-12,rms(sung)));
  for(let i=0;i<length;i++)output[i]=human[i]*humanGain*(1-p.singing)+sung[i]*sungGain*p.singing;
  const dry=output.slice();
  const delay=sampleRate*(p.skin==='future'?.021+p.owner*.008:.019);
  for(let i=0;i<length;i++){
    const time=i/sampleRate,mod=p.skin==='future'?sampleRate*(.0007+p.liquid*.004)*Math.sin(TAU*(1.1+p.owner*.4)*time):0;
    output[i]+=p.chorus*sample(dry,i-delay-mod);
    // Sparse early reflections, bounded to 113 ms rather than a feedback reverb.
    output[i]+=p.room*(sample(dry,i-sampleRate*.037)*.52+sample(dry,i-sampleRate*.071)*.30+sample(dry,i-sampleRate*.113)*.18);
    const fade=Math.min(smooth(i/(sampleRate*.008)),smooth((length-1-i)/(sampleRate*.035)));
    output[i]*=fade;
  }
  let peak=0;for(const x of output)peak=Math.max(peak,Math.abs(x));
  const target=Math.min(.18,sourceRms*.92),gain=Math.min(3,target/Math.max(1e-12,rms(output)),.8799/Math.max(1e-12,peak));
  for(let i=0;i<length;i++)output[i]*=gain;
  return output;
}
