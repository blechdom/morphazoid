import { test, expect } from '@playwright/test';
import { NATIVE_METHODS, presets } from '../src/instruments/voicesaurus/native-model.js';

for (const [engine, spec] of Object.entries(NATIVE_METHODS)) {
  test(`${engine}: every factory preset renders its native input`, async ({page}) => {
    test.setTimeout(180000);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto('voicesaurus.html');
    for (const preset of presets.filter(p=>p.snapshot.engine===engine)) {
      const result=await page.evaluate(async request=>{
       if(request.engine==='sample-bank'){
        const {createSampleBankRenderer}=await import('./src/families/speech/sample-bank-renderer.js');
        const {sampleBankRequest}=await import('./src/instruments/voicesaurus/sample-bank-model.js');
        const renderer=createSampleBankRenderer();try{const data=await renderer.render(sampleBankRequest(request));return {bad:data.samples.every(Number.isFinite)?0:1,peak:data.samples.reduce((p,v)=>Math.max(p,Math.abs(v)),0),seconds:data.duration};}finally{renderer.close();}
       }
       return new Promise((resolve,reject)=>{
        const worker=new Worker('/src/instruments/voicesaurus/native-worker.js',{type:'module'});
        const timeout=setTimeout(()=>{worker.terminate();reject(Error('Native preset render timed out'));},30000);
        worker.onerror=error=>{clearTimeout(timeout);worker.terminate();reject(Error(error.message));};
        worker.onmessage=({data})=>{
          clearTimeout(timeout);worker.terminate();
          if(data.type==='error'){reject(Error(data.message));return;}
          const {samples,sampleRate}=data;let peak=0,bad=0;
          for(const sample of samples){if(!Number.isFinite(sample))bad++;peak=Math.max(peak,Math.abs(sample));}
          const noteSignals=data.timingBasis==='native-note-slots'?data.noteTimings.map(note=>{
            let energy=0,peak=0;const start=Math.round(note.start*sampleRate),end=Math.min(samples.length,Math.round(note.end*sampleRate));
            for(let index=start;index<end;index++){energy+=samples[index]**2;peak=Math.max(peak,Math.abs(samples[index]));}
            return {rest:note.rest,rms:Math.sqrt(energy/Math.max(1,end-start)),peak};
          }):null;
          resolve({peak,bad,seconds:samples.length/sampleRate,noteSignals});
        };
        worker.postMessage({...request,text:'Daisy, give me your answer. The quick brown fox can sing.'});
      });},preset.snapshot);
      expect(result.bad,preset.id).toBe(0);
      expect(result.peak,preset.id).toBeGreaterThan(.00001);
      expect(result.seconds,preset.id).toBeGreaterThan(.01);
      expect(result.seconds,preset.id).toBeLessThanOrEqual(120);
      if(preset.snapshot.input.phrase&&engine!=='sample-bank'){
        expect(result.noteSignals,preset.id).toHaveLength(preset.snapshot.input.phrase.notes.length);
        for(const [index,note]of result.noteSignals.entries())if(!note.rest){
          expect(note.rms,`${preset.id} note ${index+1}`).toBeGreaterThan(.00001);
          expect(note.peak,`${preset.id} note ${index+1}`).toBeLessThanOrEqual(1);
        }
      }
    }
    expect(errors).toEqual([]);
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','false');
  });
}
