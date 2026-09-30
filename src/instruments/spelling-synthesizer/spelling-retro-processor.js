import {RetroSpeechCore} from './spelling-retro-model.js';

class SpellingRetroProcessor extends AudioWorkletProcessor {
  constructor(options={}) {
    super();this.core=new RetroSpeechCore(sampleRate,options.processorOptions?.mode);this.disposed=false;
    this.port.onmessage=({data})=>{
      if(!data || this.disposed)return;
      if(data.type==='voice')this.core.start(data);
      else if(data.type==='release')this.core.release(data.seconds);
      else if(data.type==='reset')this.core.reset();
      else if(data.type==='dispose'){this.core.reset();this.disposed=true;}
    };
  }
  process(inputs,outputs) {
    const output=outputs[0];if(!output?.length)return !this.disposed;
    if(this.disposed) {for(const channel of output)channel.fill(0);return false;}
    this.core.render(output[0]);
    for(let i=1;i<output.length;i++)output[i].set(output[0]);
    return true;
  }
}
registerProcessor('spelling-retro',SpellingRetroProcessor);
