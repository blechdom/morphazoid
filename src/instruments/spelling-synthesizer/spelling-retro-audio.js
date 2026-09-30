import {unlockAudioContext} from '../../audio.js?v=pink-trombonazoid-20260821-6';
import {connectSpellingOutput, spellingOutputGain} from './spelling-output.js';
import {SPELLING_DIPHONE_CLIPS, spellingDiphoneClipKey} from './spelling-diphone-atlas.js';
import {bounded} from './spelling-lpc-codec.js';

const cancelled=()=>Object.assign(new Error('Audio start was cancelled.'),{name:'AbortError'});
export function retroVoiceConfiguration(event,mode) {
  const key=spellingDiphoneClipKey(event);
  const clip=SPELLING_DIPHONE_CLIPS[key];
  if(!event?.performance || (mode==='lpc'&&!clip))return null;
  const dynamics=event.dynamics??{}, performance=event.performance;
  const vowel=performance.articulationManner==='vowel';
  const duration=mode==='lpc'
    ? clip.kind==='vowel' ? bounded(dynamics.durationMs/1000,event.wordSpeech ? .1 : .26,event.wordSpeech ? .22 : .52,.3) : clip.duration
    : bounded(dynamics.durationMs/1000,.075,.65,.2);
  return {type:'voice',key,phone:event.articulation,carrier:event.carrierVowel,
    duration,sustain:Boolean(event.sustain&&(mode==='lpc'?clip.kind==='vowel':vowel)),
    frequency:bounded(performance.exciterPitch,65,420,130),
    voicing:bounded(performance.articulationVoicing,0,1,.9),
    breath:bounded(performance.exciterBreath,0,1,0),
    brightness:({clear:1,warm:.9,whisper:1.04,reed:1.14,creature:.82})[event.personality]??1,
    amplitude:bounded(.5+Number(dynamics.emphasis??.5)*.35,.2,.95,.7)};
}

export class RetroSpellingEngine {
  constructor({runtime=globalThis,level=.46,mode='bell',balancedOutput=false}={}) {
    this.balancedOutput=balancedOutput;this.personality='clear';
    this.runtime=runtime;this.level=level;this.mode=mode;this.context=null;this.node=null;this.master=null;
    this.enabled=false;this.generation=0;this.pending=null;this.releaseAudioOutput=null;this.output=null;
  }
  get running(){return Boolean(this.enabled&&this.context?.state==='running'&&this.node);}
  async enable() {
    if(this.pending)return this.pending;
    const generation=this.generation;
    const operation=this.build(generation);
    this.pending=operation;
    try {await operation;} finally {if(this.pending===operation)this.pending=null;}
  }
  async build(generation) {
    const Audio=this.runtime.AudioContext??this.runtime.webkitAudioContext;
    const Worklet=this.runtime.AudioWorkletNode??globalThis.AudioWorkletNode;
    if(typeof Audio!=='function'||typeof Worklet!=='function')throw Error('This voice requires Web Audio with AudioWorklet support.');
    let context=this.context;
    if(!context || context.state==='closed') {
      context=new Audio({latencyHint:'interactive'});this.context=context;
    }
    try {
      unlockAudioContext(context);
      const resumed=context.state==='running'?Promise.resolve():context.resume();
      if(!this.node) {
        if(!context.audioWorklet?.addModule)throw Error('This voice requires AudioWorklet support.');
        await Promise.all([resumed,context.audioWorklet.addModule(new URL('./spelling-retro-processor.js',import.meta.url))]);
        if(generation!==this.generation||this.context!==context)throw cancelled();
        const node=new Worklet(context,'spelling-retro',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[1],processorOptions:{mode:this.mode}});
        const master=context.createGain();master.gain.value=0;node.connect(master);
        const output=connectSpellingOutput(context,master,{runtime:this.runtime,balanced:this.balancedOutput});
        this.output=output.node;this.releaseAudioOutput=output.release;
        this.node=node;this.master=master;
      } else await resumed;
      if(generation!==this.generation||this.context!==context)throw cancelled();
      this.enabled=true;this.node.port.postMessage({type:'reset'});this.setLevel(this.level);
    } catch(error) {
      if(this.context===context) {
        this.enabled=false;this.node?.port.postMessage({type:'dispose'});this.node?.disconnect();
        this.releaseAudioOutput?.();this.master?.disconnect();this.releaseAudioOutput=null;this.output=null;this.node=null;this.master=null;this.context=null;
      }
      if(context.state!=='closed')await context.close();
      throw error;
    }
  }
  setLevel(value) {
    this.level=bounded(value,0,.82,.46);
    if(this.master) {
      const gain=this.master.gain, now=this.context.currentTime;
      gain.cancelScheduledValues?.(now);gain.setTargetAtTime?.(this.enabled?spellingOutputGain(this.mode,this.level,this.balancedOutput,this.personality):0,now,.012);
    }
  }
  durationMs(event){return (retroVoiceConfiguration(event,this.mode)?.duration??0)*1000;}
  articulate(event) {
    if(!this.running)return false;
    if(this.balancedOutput&&this.personality!==event.personality){this.personality=event.personality;this.setLevel(this.level);}
    const configuration=retroVoiceConfiguration(event,this.mode);if(!configuration)return false;
    this.node.port.postMessage(configuration);return true;
  }
  release({releaseMs=55}={}) {if(!this.node)return false;this.node.port.postMessage({type:'release',seconds:bounded(releaseMs/1000,.005,.3,.055)});return true;}
  async disable() {
    this.generation++;this.enabled=false;this.node?.port.postMessage({type:'reset'});
    const context=this.context;
    if(this.master){this.master.gain.cancelScheduledValues?.(context.currentTime);this.master.gain.setValueAtTime?.(0,context.currentTime);}
    if(context && context.state!=='closed')await context.suspend();
  }
  async close() {
    this.generation++;this.enabled=false;
    const context=this.context;this.context=null;
    this.node?.port.postMessage({type:'dispose'});this.node?.disconnect();this.releaseAudioOutput?.();this.master?.disconnect();
    this.node=null;this.master=null;this.releaseAudioOutput=null;this.output=null;
    if(context && context.state!=='closed')await context.close();
  }
}
