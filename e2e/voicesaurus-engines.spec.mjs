import { test, expect } from '@playwright/test';
import { NATIVE_METHODS, presets } from '../src/instruments/voicesaurus/native-model.js';

for (const [engine, spec] of Object.entries(NATIVE_METHODS)) {
  test(`${engine}: every factory preset renders its native input`, async ({page}) => {
    test.setTimeout(180000);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto('voicesaurus.html');
    for (const preset of presets.filter(p=>p.snapshot.engine===engine)) {
      const result=await page.evaluate(request=>new Promise((resolve,reject)=>{
        const worker=new Worker('/src/instruments/voicesaurus/native-worker.js',{type:'module'});
        const timeout=setTimeout(()=>{worker.terminate();reject(Error('Native preset render timed out'));},30000);
        worker.onerror=error=>{clearTimeout(timeout);worker.terminate();reject(Error(error.message));};
        worker.onmessage=({data})=>{
          clearTimeout(timeout);worker.terminate();
          if(data.type==='error'){reject(Error(data.message));return;}
          const {samples,sampleRate}=data;let peak=0,bad=0;
          for(const sample of samples){if(!Number.isFinite(sample))bad++;peak=Math.max(peak,Math.abs(sample));}
          resolve({peak,bad,seconds:samples.length/sampleRate});
        };
        worker.postMessage({...request,text:'Daisy, give me your answer. The quick brown fox can sing.'});
      }),preset.snapshot);
      expect(result.bad,preset.id).toBe(0);
      expect(result.peak,preset.id).toBeGreaterThan(.00001);
      expect(result.seconds,preset.id).toBeGreaterThan(.01);
      expect(result.seconds,preset.id).toBeLessThanOrEqual(120);
    }
    expect(errors).toEqual([]);
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','false');
  });
}
