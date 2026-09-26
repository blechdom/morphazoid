import { expect, test } from '@playwright/test';
import { sampleAudioEnvelope } from './helpers/audio-probe.mjs';

// Observe audio deadlines and worklet messages, not animation frames or meters.
for (const owned of [false, true]) for (const bank of ['soft-fm', 'shared-simd-chiptune', 'acid-303']) {
 test(`${owned ? 'Rubixoids 3D' : 'Rubix'} ${bank}: live Swing keeps every attack and score step`, async ({ page }, info) => {
 const prefix = owned ? '/src/instruments/rubixoids/rubix' : '/src/instruments/rubix';
 const errors=[]; page.on('pageerror',e=>errors.push(e.message));
 await page.goto(owned?'/rubixoids.html':'/rubix.html');
 const scope = owned ? page.locator('.rubixoids-pane[data-dimension="3d"]') : page;
 await scope.locator('#soundBank').waitFor({state:'visible'});
 await page.evaluate(async prefix => {
  const probe=globalThis.__swingProbe={notes:[],cancelled:[],simd:[],transports:[],inputs:[]};
  const {RubixAudioEngine}=await import(`${prefix}/rubix-app.js`);
  const build=RubixAudioEngine.prototype.buildGraph;
  RubixAudioEngine.prototype.buildGraph=function(...args){const result=build.apply(this,args);probe.engine=this;return result;};
  const schedule=RubixAudioEngine.prototype.scheduleDrum;
  RubixAudioEngine.prototype.scheduleDrum=function(value,when,gain,bank,sticker){probe.notes.push({when,id:sticker?.id,step:sticker?.homeRow*3+sticker?.homeColumn,bank});return schedule.apply(this,arguments);};
  const transport=RubixAudioEngine.prototype.setTransportActive;
  RubixAudioEngine.prototype.setTransportActive=function(active){probe.transports.push({active,time:this.context?.currentTime});return transport.apply(this,arguments);};
  const stop=AudioScheduledSourceNode.prototype.stop;
  AudioScheduledSourceNode.prototype.stop=function(when=0){if(Number.isFinite(this.rubixStartAt)&&this.rubixStartAt>this.context.currentTime&&when<this.rubixStartAt)probe.cancelled.push({id:this.rubixStickerId,start:this.rubixStartAt,when,now:this.context.currentTime});return stop.apply(this,arguments);};
  const {RubixSurfaceSimd303}=await import(`${prefix}/rubix-simd-surface.js`);
  const setStep=RubixSurfaceSimd303.prototype.setStepHandler;
  RubixSurfaceSimd303.prototype.setStepHandler=function(handler){return setStep.call(this,(step,time)=>{probe.simd.push({step,when:time});handler?.(step,time);});};
 },prefix);
 await scope.locator('#soundBank').selectOption(bank);
 if(bank==='acid-303')await scope.locator('#acidEngine').selectOption('simd-303');
 await scope.locator('#tempo').evaluate(input=>{input.value='126';input.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.locator('body > .masthead #audioButton').click();
 await page.locator('body > .masthead #audioButton[aria-pressed="true"]').waitFor();
 await scope.locator('#playButton').click();
 await scope.locator('#playButton[aria-pressed="true"]').waitFor();
 await page.waitForTimeout(400);
 await scope.locator('#swing').evaluate(async input=>{
  const p=globalThis.__swingProbe;p.start=p.engine.context.currentTime;
  // A realistic paced input stream, alternating near the long/short boundary
  // so remapping elapsed beat to phase cannot hide behind a single static edit.
  for(let index=0;index<180;index++){
   input.value=String(index%2===0?0:.42);input.dispatchEvent(new Event('input',{bubbles:true}));
   p.inputs.push({value:Number(input.value),time:p.engine.context.currentTime});
   await new Promise(resolve=>setTimeout(resolve,16));
  }
  input.dispatchEvent(new Event('change',{bubbles:true}));p.end=p.engine.context.currentTime;
 });
 await page.waitForTimeout(400);
 const evidence=await page.evaluate(async prefix=>{
  const p=globalThis.__swingProbe, snap=(await import(`${prefix}/rubix-app.js`)).rubixPlaybackSnapshot();
  const notes=p.notes.filter(note=>note.id?.startsWith('up:')&&note.when>=p.start-.2&&note.when<=p.end+.2);
  const simd=p.simd.filter(note=>note.when>=p.start-.2&&note.when<=p.end+.2);
  const seq=snap.soundBank==='acid-303'?simd:notes;
  const gaps=seq.slice(1).map((n,i)=>({from:seq[i].step,to:n.step,gap:n.when-seq[i].when,time:n.when}));
  return {start:p.start,end:p.end,inputCount:p.inputs.length,notes,simd,cancelled:p.cancelled,transports:p.transports,
   badSequence:gaps.filter(x=>x.to!==(x.from+1)%9),shortGaps:gaps.filter(x=>x.gap<.035),maxGap:Math.max(...gaps.map(x=>x.gap)),playing:snap.playing,backend:snap.simdBackend,errors:[]};
 },prefix);

 expect(errors).toEqual([]);
 expect(evidence.playing).toBe(true);
 expect(evidence.cancelled).toEqual([]);
 expect(evidence.badSequence).toEqual([]);
 expect(evidence.shortGaps).toEqual([]);
 expect(evidence.maxGap).toBeLessThan(.22);
 expect(evidence.notes.length || evidence.simd.length).toBeGreaterThan(20);
 expect(evidence.transports.filter(event => event.time >= evidence.start)).toEqual([]);
 const envelope = await sampleAudioEnvelope(page, { durationMs: 400 });
 expect(envelope.summary.finite).toBe(true);
 expect(envelope.summary.maxPeak).toBeGreaterThan(.001);
 expect(envelope.summary.clippedSamples).toBe(0);
 await info.attach('swing-continuity.json', {body: JSON.stringify({ ...evidence, envelope: envelope.summary }), contentType: 'application/json'});
 });
}

test('Rubixoids read-path presets retain playback and a nearby shared-grid deadline', async ({ page }) => {
  await page.goto('/rubixoids.html');
  const scope = page.locator('.rubixoids-pane[data-dimension="3d"]');
  await scope.locator('#soundBank').selectOption('soft-fm');
  await page.locator('body > .masthead #audioButton').click();
  await scope.locator('#playButton').click();
  await expect(scope.locator('#playButton')).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(1600);
  for (const [readingMode, tempo] of [['face', 142], ['parallel', 116], ['face', 116], ['parallel', 116]]) {
    await page.evaluate(async ({ readingMode, tempo }) => {
      const { rubixoidsInstrument } = await import('/src/instruments/rubixoids/rubixoids-app.js');
      const presets = rubixoidsInstrument('3d').context.presets;
      const snapshot = structuredClone(presets.capture());
      snapshot.readingMode = readingMode;
      snapshot.settings.tempo = tempo;
      await presets.apply(snapshot);
    }, { readingMode, tempo });
    await page.waitForTimeout(400);
    const snapshot = await page.evaluate(async () =>
      (await import('/src/instruments/rubixoids/rubix/rubix-app.js')).rubixPlaybackSnapshot());
    expect(snapshot.playing).toBe(true);
    expect(snapshot.timing.nextStepTime - snapshot.audioTime).toBeGreaterThan(0);
    expect(snapshot.timing.nextStepTime - snapshot.audioTime).toBeLessThan(.35);
    expect(snapshot.timing.scheduled.some(event => event.when > snapshot.audioTime - .2)).toBe(true);
  }
});
