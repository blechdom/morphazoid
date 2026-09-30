import {SPELLING_LPC_ATLAS} from './spelling-lpc-atlas.js';
import {LPC_RATE, LPC_FRAME, LPC_ORDER, bounded, energyValue, pitchValue, reflectionValue} from './spelling-lpc-codec.js';

const SECTIONS = 24;
// Authored, approximate oral area functions (cm², glottis -> lips), NOT Fant's
// measurements or recovered Bell Labs data. Kelly–Lochbaum scattering is real;
// these intentionally compact articulations are an instrument voice, not anatomy.
const AREA_PROFILES = Object.freeze({
  a: [1.0, .7, .45, .55, 1.1, 2.7, 5.5, 6.0, 4.5, 3.0, 2.5, 2.3],
  e: [1.0, 1.6, 2.7, 3.6, 3.0, 1.4, .6, .5, 1.0, 1.8, 2.1, 2.0],
  i: [1.0, 1.8, 3.8, 4.9, 4.2, 2.3, .7, .32, .5, 1.0, 1.6, 1.8],
  iy:[1.0, 2.0, 4.0, 5.2, 5.0, 3.0, .6, .2, .28, .7, 1.3, 1.8],
  o: [1.0, .8, .5, .4, .7, 1.5, 3.4, 5.2, 6.0, 5.5, 4.4, 3.0],
  u: [1.0, 1.0, 1.0, 1.1, 1.5, 2.0, 2.0, 1.6, 1.3, 1.5, 2.0, 2.0],
  ao:[1.0, 1.0, .8, .6, 1.2, 2.5, 4.5, 5.0, 4.0, 2.0, .8, .45],
  uw:[1.0, 1.4, 2.0, 2.8, 1.8, .55, .35, 1.0, 2.8, 3.2, .6, .22],
});
const CONSTRICTIONS = Object.freeze({
  p:[22,.008],b:[22,.008],m:[22,.035],f:[22,.18],v:[22,.18],
  th:[21,.24],dh:[21,.24],t:[19,.008],d:[19,.008],n:[19,.055],
  s:[20,.12],z:[20,.12],sh:[18,.19],c:[18,.04],j:[18,.06],
  l:[19,.24],r:[17,.34],y:[15,.3],k:[12,.008],g:[12,.008],
  q:[12,.01],ng:[12,.065],w:[22,.22],x:[20,.13],h:[3,1.0],
});
const PLOSIVES = new Set(['p','b','t','d','k','g','q','c','j']);
const NASALS = new Set(['m','n','ng']);
export function bellTractAreas(phone, carrier = 'u') {
  const profile = AREA_PROFILES[phone] ?? AREA_PROFILES[carrier] ?? AREA_PROFILES.u;
  const areas = new Float64Array(SECTIONS);
  for(let i=0;i<SECTIONS;i++) {
    const position=i*(profile.length-1)/(SECTIONS-1), left=Math.floor(position), t=position-left;
    areas[i]=profile[left]*(1-t)+(profile[Math.min(left+1,profile.length-1)])*t;
  }
  return areas;
}

class EnvelopeVoice {
  constructor(rate) { this.rate=rate; this.active=false; this.age=0; this.gain=0; this.faults=0; }
  startEnvelope(config) {
    this.active=true;this.age=0;this.gain=0;this.sustain=Boolean(config.sustain);
    this.length=Math.max(1,Math.round(bounded(config.duration,.04,2,.22)*this.rate));
    this.attack=Math.max(1,Math.round(.008*this.rate));this.tail=Math.max(1,Math.round(.035*this.rate));
    this.releaseAge=-1;this.releaseLength=1;this.releaseGain=0;
    this.amplitude=bounded(config.amplitude,.1,1,.7);this.breath=bounded(config.breath,0,1,0);
  }
  release(seconds=.05) {
    if(this.releaseAge>=0 || !this.active)return;
    this.releaseAge=this.age;this.releaseLength=Math.max(1,Math.round(bounded(seconds,.005,.3,.05)*this.rate));this.releaseGain=this.gain;
  }
  envelope() {
    if(!this.active)return 0;
    if(this.releaseAge>=0) this.gain=this.releaseGain*Math.max(0,1-(this.age-this.releaseAge)/this.releaseLength);
    else this.gain=Math.min(1,this.age/this.attack)*(this.sustain ? 1 : Math.max(0,Math.min(1,(this.length-this.age)/this.tail)));
    if((this.releaseAge>=0 && this.age-this.releaseAge>=this.releaseLength) || (!this.sustain && this.age>=this.length))this.active=false;
    this.age++;
    return this.active ? this.gain*this.amplitude : 0;
  }
  noise() { this.seed^=this.seed<<13;this.seed^=this.seed>>>17;this.seed^=this.seed<<5;return (this.seed>>>0)/2147483648-1; }
}

export class KellyLochbaumVoice extends EnvelopeVoice {
  constructor() {
    super(48000);this.right=new Float64Array(SECTIONS);this.left=new Float64Array(SECTIONS);
    this.nextRight=new Float64Array(SECTIONS);this.nextLeft=new Float64Array(SECTIONS);
    this.areas=new Float64Array(SECTIONS);this.baseAreas=new Float64Array(SECTIONS);this.constrictionWeight=new Float64Array(SECTIONS);
  }
  start(config) {
    this.rate=48000*bounded(config.brightness,.8,1.2,1);
    this.startEnvelope(config);this.phase=0;this.previousLip=0;this.radiation=0;this.nasal=0;this.seed=0x1961be11;
    this.right.fill(0);this.left.fill(0);this.nextRight.fill(0);this.nextLeft.fill(0);
    this.phone=config.phone;this.baseAreas.set(bellTractAreas(config.phone,config.carrier));this.areas.set(this.baseAreas);
    this.constriction=CONSTRICTIONS[config.phone];this.plosive=PLOSIVES.has(config.phone);this.isNasal=NASALS.has(config.phone);
    for(let i=0;i<SECTIONS;i++)this.constrictionWeight[i]=this.constriction ? Math.exp(-(((i-this.constriction[0])/1.15)**2)) : 0;
    this.frequency=bounded(config.frequency,65,420,130);this.voicing=bounded(config.voicing,0,1,.9);
  }
  tick() {
    const gain=this.envelope();if(!this.active)return 0;
    const seconds=this.age/this.rate;
    const closure=this.plosive ? Math.max(0,1-Math.max(0,seconds-.023)/.028) : 1;
    for(let i=0;i<SECTIONS;i++) {
      let area=this.baseAreas[i];
      if(this.constriction) {
        const weight=this.constrictionWeight[i]*closure;
        area=area*(1-weight)+this.constriction[1]*weight;
      }
      this.areas[i]+=(area-this.areas[i])*.035;
    }
    this.phase+=this.frequency/this.rate;if(this.phase>=1)this.phase-=1;
    const glottis=this.phase<.12 ? Math.sin(Math.PI*this.phase/.12) : 0;
    const noise=this.noise(), breath=noise*((1-this.voicing)*.008+this.breath*.012);
    this.nextRight[0]=.6*glottis*this.voicing*(1-this.breath*.7)+breath+.72*this.left[0];
    this.nextLeft[SECTIONS-1]=-.84*this.right[SECTIONS-1];
    for(let i=0;i<SECTIONS-1;i++) {
      const k=(this.areas[i]-this.areas[i+1])/(this.areas[i]+this.areas[i+1]);
      const scattering=k*(this.right[i]-this.left[i+1]);
      this.nextRight[i+1]=(this.right[i]+scattering)*.997;
      this.nextLeft[i]=(this.left[i+1]+scattering)*.997;
    }
    if(this.constriction && !this.isNasal) {
      const pos=Math.min(SECTIONS-1,this.constriction[0]+1);
      const burst=this.plosive ? Math.exp(-(((seconds-.03)/.009)**2))*.045 : .015;
      this.nextRight[pos]+=noise*burst*(1-this.voicing*.8);
    }
    this.right.set(this.nextRight);this.left.set(this.nextLeft);
    const lip=this.right[SECTIONS-1];
    const radiation=lip-.97*this.previousLip;this.previousLip=lip;
    // A simple low oral-leak component for nasals, not a full nasal side branch.
    this.nasal+=.035*(glottis-this.nasal);
    const output=this.isNasal ? radiation*.5+this.nasal*.04 : radiation;
    return Math.tanh(output*10)*gain*.55;
  }
}

export class LpcSpeechVoice extends EnvelopeVoice {
  constructor() {super(LPC_RATE);this.k=new Float64Array(LPC_ORDER);this.targetK=new Float64Array(LPC_ORDER);this.delay=new Float64Array(LPC_ORDER);}
  start(config) {
    this.startEnvelope(config);this.clip=SPELLING_LPC_ATLAS[config.key]??SPELLING_LPC_ATLAS.u;
    this.k.fill(0);this.targetK.fill(0);this.delay.fill(0);this.energy=0;this.targetEnergy=0;this.period=0;this.pitchPhase=0;
    this.deemphasis=0;this.dc=0;this.seed=0x1978a11c;this.frameCounter=0;
    this.pitchScale=bounded(config.frequency,65,420,130)/130;
    this.brightness=bounded(config.brightness,.8,1.2,1);
  }
  tick() {
    const gain=this.envelope();if(!this.active)return 0;
    if(this.frameCounter===0) {
      const framePosition=this.sustain ? Math.min((this.age-1)/LPC_FRAME,this.clip.hold)
        : (this.age-1)/this.length*(this.clip.frames.length-1);
      const frame=this.clip.frames[Math.min(this.clip.frames.length-1,Math.floor(framePosition))];
      this.targetEnergy=energyValue(frame[0]);this.period=pitchValue(frame[1]);
      for(let j=0;j<LPC_ORDER;j++)this.targetK[j]=reflectionValue(frame[j+2],j);
    }
    this.frameCounter=(this.frameCounter+1)%LPC_FRAME;
    this.energy+=(this.targetEnergy-this.energy)*.035;
    for(let j=0;j<LPC_ORDER;j++)this.k[j]+=(this.targetK[j]-this.k[j])*.035;
    let excitation;
    if(this.period>0) {
      const period=bounded(this.period/this.pitchScale,18,150,60);
      this.pitchPhase+=1;if(this.pitchPhase>=period)this.pitchPhase-=period;
      // Original short decaying chirp, not TI's mask-ROM excitation waveform.
      const t=this.pitchPhase;
      const chirp=t<18 ? Math.sin(.7*t+.028*t*t)*Math.exp(-t*.22) : 0;
      excitation=(chirp*Math.sqrt(period)*1.2*(1-this.breath*.8)+this.noise()*this.breath*2.5)*this.energy;
    } else {excitation=this.noise()*this.energy*1.732;this.pitchPhase=0;}
    // Ten-stage all-pole synthesis lattice, inverted from the analysis lattice.
    let value=excitation;
    for(let j=LPC_ORDER-1;j>=0;j--) {
      value-=this.k[j]*this.delay[j];
      if(j<LPC_ORDER-1)this.delay[j+1]=this.delay[j]+this.k[j]*value;
    }
    this.delay[0]=value;
    if(!Number.isFinite(value) || Math.abs(value)>8) {this.delay.fill(0);value=0;this.faults++;}
    this.deemphasis=value+(1-.18*this.brightness)*this.deemphasis;
    this.dc+=.003*(this.deemphasis-this.dc);
    const output=Math.tanh((this.deemphasis-this.dc)*2.5)*gain*.55;
    // Coarse DAC texture without claiming a particular TI chip's arithmetic.
    return Math.round(output*512)/512;
  }
}

// Two fixed voice slots permit bounded short crossfades between phonemes.
// All pitch, envelopes and internal clocks run on samples, never animation frames.
export class RetroSpeechCore {
  constructor(rate=48000,mode='bell') {
    this.rate=bounded(rate,8000,192000,48000);this.mode=mode;
    const Voice=mode==='lpc'?LpcSpeechVoice:KellyLochbaumVoice;
    this.voices=[new Voice(),new Voice()];this.fraction=new Float64Array(2);this.previous=new Float64Array(2);this.next=new Float64Array(2);this.slot=0;
  }
  start(config) {
    if(!config || typeof config!=='object')return false;
    this.release(.014);this.slot=1-this.slot;
    this.voices[this.slot].start(config);this.fraction[this.slot]=0;this.previous[this.slot]=0;this.next[this.slot]=0;
    return true;
  }
  release(seconds=.05) {for(const voice of this.voices)voice.release(seconds);}
  reset() {for(const voice of this.voices)voice.active=false;this.previous.fill(0);this.next.fill(0);this.fraction.fill(0);}
  tick() {
    let out=0;
    for(let i=0;i<2;i++) {
      const voice=this.voices[i];
      this.fraction[i]+=voice.rate/this.rate;
      while(this.fraction[i]>=1) {this.previous[i]=this.next[i];this.next[i]=voice.tick();this.fraction[i]-=1;}
      out+=this.previous[i]+(this.next[i]-this.previous[i])*this.fraction[i];
    }
    return bounded(out,-.85,.85,0);
  }
  render(output) {for(let i=0;i<output.length;i++)output[i]=this.tick();}
}
