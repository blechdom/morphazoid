import { resumeAudioContext } from '../../audio-startup.js';
import { connectSpellingOutput } from '../spelling-synthesizer/spelling-output.js';
import { unlockAudioContext } from '../../audio.js';
import { NATIVE_OUTPUT_TRIMS } from './output-calibration.js';

/** Device consent and sample-clock playback; native engines render in workers. */
export class NativeVoiceAudio {
  constructor({onEnded=()=>{},onAuditionEnded=()=>{}}={}) {
    this.onEnded=onEnded;this.onAuditionEnded=onAuditionEnded; this.enabled=false; this.playing=false; this.level=.46;
    this.context=null; this.buffer=null; this.position=0; this.loop=false; this.generation=0;
    this.retiring=new Set();this.auditionGeneration=0;this.renderResults=new WeakMap();
  }
  async enable() {
    if(!this.context || this.context.state==='closed') {
      this.context=new AudioContext({latencyHint:'interactive'});
      this.master=this.context.createGain(); this.master.gain.value=this.level/.82;
      this.analyser=this.context.createAnalyser(); this.analyser.fftSize=2048;
      this.master.connect(this.analyser);
      this.output=connectSpellingOutput(this.context,this.analyser,{balanced:true});
    }
    this.armController?.abort();const controller=new AbortController();this.armController=controller;
    const context=this.context;this.enabled=true;unlockAudioContext(context);
    try {await resumeAudioContext(context,{signal:controller.signal});}
    catch(error){if(this.armController===controller)this.enabled=false;throw error;}
  }
  setLevel(value) {this.level=value;this.master?.gain.setTargetAtTime(value/.82,this.context.currentTime,.012);}
  setLoop(loop) {this.loop=loop;if(this.source)this.source.loop=loop;}
  currentPosition() {
    const position=this.playing?this.position+this.context.currentTime-this.started:this.position;
    return this.loop&&this.buffer ? position%this.buffer.duration : Math.min(position,this.buffer?.duration??0);
  }
  releaseSource(source,gain) {
    if(!source)return;
    const now=this.context.currentTime;
    if(this.enabled&&gain&&this.context.state==='running'){
      const retired={source,gain};this.retiring.add(retired);
      const release=()=>{
        if(!this.retiring.delete(retired))return;
        clearTimeout(retired.timeout);source.onended=null;
        try{source.stop();}catch{}source.disconnect();gain.disconnect();
      };
      retired.release=release;source.onended=release;
      // A source scheduled to end cannot fire onended while its context is
      // suspended. Release the disconnected voice even in that case.
      retired.timeout=setTimeout(release,80);
      gain.gain.cancelScheduledValues(now);gain.gain.setTargetAtTime(0,now,.002);
      try{source.stop(now+.012);}catch{release();}
    }else{source.onended=null;try{source.stop();}catch{}source.disconnect();gain?.disconnect();}
  }
  stopSource() {
    const source=this.source,gain=this.sourceGain;
    this.source=null;this.sourceGain=null;this.releaseSource(source,gain);
  }
  stopAudition() {
    this.auditionGeneration++;
    if(this.pendingRender?.store===false)this.cancelRender();
    const source=this.auditionSource,gain=this.auditionGain;
    this.auditionSource=null;this.auditionGain=null;this.releaseSource(source,gain);
  }
  get auditionPlaying() {return Boolean(this.auditionSource);}
  get auditioning() {return this.auditionPlaying;}
  audition(result) {
    const rendered=this.renderResults.get(result);
    if(!this.enabled||this.context?.state!=='running'||!rendered||
      rendered.context!==this.context||rendered.generation!==this.generation||
      rendered.auditionGeneration!==this.auditionGeneration)return false;
    this.stopAudition();
    const source=this.context.createBufferSource(),gain=this.context.createGain(),now=this.context.currentTime;
    source.buffer=rendered.buffer;source.loop=false;
    gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(NATIVE_OUTPUT_TRIMS[rendered.engine]??1,now+.008);
    source.connect(gain).connect(this.master);this.auditionSource=source;this.auditionGain=gain;
    source.onended=()=>{
      if(this.auditionSource!==source)return;
      source.onended=null;source.disconnect();gain.disconnect();this.auditionSource=null;this.auditionGain=null;this.onAuditionEnded();
    };
    try{source.start();}catch(error){this.stopAudition();throw error;}
    return true;
  }
  pause() {this.position=this.currentPosition();this.playing=false;this.stopSource();this.stopAudition();}
  play({restart=false}={}) {
    this.stopAudition();
    if(!this.enabled||!this.buffer)return false;
    if(restart||this.position>=this.buffer.duration-.01)this.position=0;
    this.stopSource();const source=this.context.createBufferSource();source.buffer=this.buffer;source.loop=this.loop;
    const gain=this.context.createGain(),now=this.context.currentTime;
    gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(NATIVE_OUTPUT_TRIMS[this.engine]??1,now+.008);
    source.connect(gain).connect(this.master);this.source=source;this.sourceGain=gain;this.started=now;this.playing=true;
    source.onended=()=>{if(this.source!==source)return;this.position=this.buffer.duration;this.playing=false;source.disconnect();gain.disconnect();this.source=null;this.sourceGain=null;this.onEnded();};
    source.start(0,this.position);return true;
  }
  cancelRender() {this.generation++;this.cancelWorker?.();this.cancelWorker=null;this.pendingRender=null;}
  async render(request,{store=true}={}) {
    if(!this.enabled||!this.context||this.context.state==='closed')throw Object.assign(Error('Enable Audio before rendering a voice.'),{name:'NotAllowedError'});
    this.cancelRender();this.stopAudition();const generation=this.generation,context=this.context;
    return new Promise((resolve,reject)=>{
      const worker=new Worker(new URL('./native-worker.js',import.meta.url),{type:'module'});
      let settled=false;
      const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timeout);worker.terminate();if(generation===this.generation){this.cancelWorker=null;this.pendingRender=null;}error?reject(error):resolve(result);};
      const timeout=setTimeout(()=>finish(Error('Voice rendering timed out.')),30000);
      this.pendingRender={store,generation};
      this.cancelWorker=()=>finish(Object.assign(Error('Voice rendering cancelled.'),{name:'AbortError'}));
      worker.onerror=event=>finish(Error(event.message||'Voice worker failed.'));
      worker.onmessage=({data})=>{
        if(settled)return;
        if(data.type==='error'){finish(Error(data.message));return;}
        if(data.type!=='ready')return;
        try{
          const {samples,sampleRate}=data;
          if(!(samples instanceof Float32Array)||!Number.isFinite(sampleRate)||sampleRate<=0||!samples.every(Number.isFinite))throw Error('Invalid native voice output.');
          if(samples.length/sampleRate>120)throw Error('Voice output exceeds the two-minute rendering budget.');
          if(generation!==this.generation||!this.enabled||context!==this.context||context?.state==='closed')throw Object.assign(Error('Cancelled'),{name:'AbortError'});
          // Web Audio restricts buffer rates. Convert the output format while
          // keeping the native engine's requested rate, pitch and duration.
          const playbackRate=sampleRate<3000||sampleRate>384000?context.sampleRate:sampleRate;
          const frames=Math.max(1,Math.round(samples.length*playbackRate/sampleRate));
          if(frames>12000000)throw Error('Voice output exceeds the playback memory budget.');
          const buffer=context.createBuffer(1,frames,playbackRate);
          if(playbackRate===sampleRate||!samples.length)buffer.copyToChannel(samples,0);
          else {const output=buffer.getChannelData(0);for(let i=0;i<frames;i++){const position=i*sampleRate/playbackRate,index=Math.min(samples.length-1,Math.floor(position)),fraction=position-index;output[i]=samples[index]*(1-fraction)+samples[Math.min(index+1,samples.length-1)]*fraction;}}
          if(store){
            const fraction=this.buffer?.duration?this.currentPosition()/this.buffer.duration:0;
            this.pause();this.buffer=buffer;this.engine=request.engine;this.position=fraction*buffer.duration;
          }
          const result={...data,buffer,engine:request.engine};
          this.renderResults.set(result,{buffer,engine:request.engine,context,generation,auditionGeneration:this.auditionGeneration});
          finish(null,result);
        }catch(error){finish(error);}
      };
      try{worker.postMessage(request);}catch(error){finish(error);}
    });
  }
  async disable() {this.armController?.abort();this.armController=null;this.enabled=false;this.cancelRender();this.pause();for(const retired of [...this.retiring])retired.release();await this.context?.suspend();}
  async close() {await this.disable();this.output?.release();await this.context?.close();this.context=null;}
}
