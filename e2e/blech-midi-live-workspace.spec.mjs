import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { parseMidi } from '../src/instruments/midi-mixer/midi-mixer-model.js';
import { automataMidiSeedRow } from '../src/instruments/midiphoria/midiphoria-automata-midi.js';
import { readAudioStatus, sampleAudioEnvelope } from './helpers/audio-probe.mjs';

const errors = new WeakMap();
test.beforeEach(({ page }) => { errors.set(page, []); page.on('pageerror', error => errors.get(page).push(error.message)); });
test.afterEach(({ page }) => { expect(errors.get(page), 'uncaught browser errors').toEqual([]); });

async function openSavedDrops(page) {
  const shelf = page.locator('#blechSavedDrops');
  if (!(await shelf.evaluate(node => node.open))) await shelf.locator(':scope > summary').click();
  await expect(shelf).toHaveAttribute('open', '');
}

async function open(page) {
  await page.addInitScript(() => {
    globalThis.__liveQA = { contexts: [], engine: null, notes: [], projections: [], launches: [], captures: [] };
    const Native = AudioContext;
    globalThis.AudioContext = class extends Native { constructor(...args) { super(...args); __liveQA.contexts.push(this); } };
  });
  // Observers never replace state, sound, clocks, evolution or visual rendering.
  await page.route('**/src/instruments/midi-mixer/midi-mixer-engine.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
      const qaVolume=MidiMixerEngine.prototype.setVolume,qaTrigger=MidiMixerEngine.prototype.triggerSample,
        qaCapture=MidiMixerEngine.prototype.captureAutomata,qaSeen=new WeakSet();
      MidiMixerEngine.prototype.setVolume=function(...args){__liveQA.engine=this;
        if(!qaSeen.has(this)){qaSeen.add(this);this.subscribeNotes(notes=>{
          __liveQA.notes.push(...notes.map(note=>({...note})));
          if(__liveQA.notes.length>20000)__liveQA.notes.splice(0,__liveQA.notes.length-20000);
        });} return qaVolume.apply(this,args);};
      MidiMixerEngine.prototype.triggerSample=function(buffer,...args){const result=qaTrigger.call(this,buffer,...args);
        if(result)__liveQA.launches.push({id:result.id,bytes:Array.from(new Uint8Array(buffer)),
          notes:result.analysis.notes.map(({note,beat,duration,velocity})=>({note,beat,duration,velocity}))});return result;};
      MidiMixerEngine.prototype.captureAutomata=async function(...args){const score=await qaCapture.apply(this,args);
        if(score)__liveQA.captures.push({bytes:Array.from(new Uint8Array(score.buffer)),
          duration:score.durationBeats,start:score.sourceStartBeat,end:score.sourceEndBeat,
          notes:score.analysis.notes.map(({note,beat,duration,velocity})=>({note,beat,duration,velocity}))});return score;};` });
  });
  await page.route('**/src/instruments/blech-midi/blech-midi-live-score.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
      const qaProject=createBlechLiveProjector;
      createBlechLiveProjector=function(...args){const project=qaProject(...args);return function(state,...args){const result=project(state,...args);
        if(state?.automata){__liveQA.projections.push({generation:state.automata.generation,playing:state.automata.playing,
          row:[...state.automata.row],lowest:state.automata.rowSettings.lowestNote,
          held:result.notes.filter(note=>note.source==='automata'&&note.start<=0&&note.end>0).map(({id,pitch})=>({id,pitch})),
          future:result.notes.filter(note=>note.source==='automata'&&note.start>0).length});
          if(__liveQA.projections.length>256)__liveQA.projections.shift();}return result;};};` });
  });
  await page.goto('/blech-midi.html');
  await tab(page, 'automata');
  await expect(page.locator('#automataMidiPlayPause')).toBeVisible();
  await tab(page, 'drawing');
  await expect(page.locator('#drawingCanvas')).toBeVisible();
  await expect(page.locator('#blechStampPicker [data-stamp-id]')).toHaveCount(58);
}
const state = page => page.evaluate(() => {
  const state=__liveQA.engine.state;
  return { automata:state.automata, audio:state.audioEnabled, tempo:state.tempo,
    contexts:__liveQA.contexts.map(context=>({state:context.state,sampleRate:context.sampleRate})),
    samples:state.samples.map(sample=>({id:sample.id,loop:sample.loop,beat:sample.positionBeats,cycle:sample.cycle,duration:sample.analysis.durationBeats})) };
});
const notes = page => page.evaluate(() => __liveQA.notes.filter(note=>note.sourceId==='automata'&&note.type==='noteOn'));
const saved = page => page.locator('#mixerSavedPads [data-saved-pad]');
async function input(page, id, value) {
  await page.locator(`#${id}`).evaluate((node,value)=>{node.value=String(value);node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));},value);
}
async function expand(locator) { if (await locator.getAttribute('open') === null) await locator.locator(':scope > summary').click(); }
async function tab(page, name) {
  if (['stamps', 'drawing', 'art', 'scripts', 'sequence'].includes(name)) await page.locator('#blechTab-frames').click();
  await page.locator(`#blechTab-${name}`).click(); await expect(page.locator(`#blechPanel-${name}`)).toBeVisible();
}
async function prepareStamp(page, id) {
  await tab(page, 'stamps'); await page.locator('#blechStampPicker summary').click();
  await page.locator(`#blechStampPicker [data-stamp-id="${id}"]`).click();
  await expect(page.locator('#blechDropSend')).toBeEnabled();
}
async function dropPrepared(page, loop = true) {
  await input(page, 'blechDropDelay', 0);
  await page.locator(loop ? '#blechDropLoop' : '#blechDropOnce').click();
  await page.locator('#blechDropSend').click();
}
const liveStage = page => page.locator('#blackMidiViewport .midiphoria-black-stage');
const projections = page => page.evaluate(() => __liveQA.projections);

async function configure(page, { rule=204, rate=2, tempo=120, width=8, lowest=60 } = {}) {
  await tab(page, 'automata');
  await expand(page.locator('.automata-midi-rule-details'));
  await expand(page.locator('#automataMidiParameters'));
  await page.locator('#automataMidiFamily').selectOption('elementary');
  await page.locator('#automataMidiBoundary').selectOption('fixed');
  await page.locator('#automataMidiTransform').selectOption('none');
  for(const [id,value] of Object.entries({automataMidiColumns:width,automataMidiLowestNote:lowest,automataMidiDensity:0,automataMidiRule:rule,automataMidiRate:rate,automataMidiVelocity:73,creativeTempo:tempo})) await input(page,id,value);
  await page.locator('#automataMidiArticulation').selectOption('retrigger');
  await page.locator('#automataMidiRestart').click();
}
async function arm(page) { await page.locator('#audioButton').click();await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','true',{timeout:20000}); }
async function play(page) { await tab(page, 'automata');await page.locator('#automataMidiPlayPause').click();await expect(page.locator('#automataMidiPlayPause')).toHaveAttribute('aria-pressed','true'); }
async function audible(page) {
  await expect.poll(async()=>(await readAudioStatus(page)).rms,{timeout:10000}).toBeGreaterThan(.001);
  const {summary}=await sampleAudioEnvelope(page,{durationMs:350,intervalMs:30});
  expect(summary.finite).toBe(true);expect(summary.maxRms).toBeGreaterThan(.001);expect(summary.clippedSamples).toBe(0);expect(summary.maxPeak).toBeLessThanOrEqual(.981);return summary;
}
async function silent(page) { await expect.poll(async()=>(await readAudioStatus(page)).peak,{timeout:8000}).toBeLessThan(.0001); }
function xorRows(width,count) {
  const result=[];let row=Array.from({length:width},(_,i)=>Number(i===Math.floor(width/2)));
  for(let generation=0;generation<count;generation++){result.push(row);row=row.map((_,i)=>(row[i-1]??0)^(row[i+1]??0));}return result;
}
function cadence(events, seconds, sampleRate) {
  expect(events.length).toBeGreaterThanOrEqual(6);
  events.slice(1).forEach((event,index)=>expect(Math.abs(event.at-events[index].at-seconds)).toBeLessThanOrEqual(2/sampleRate));
}

test('native live rows continue beyond a finite preview and match independent Rule 90 audio and graphics', async ({page},testInfo)=>{
  test.setTimeout(60000);await open(page);await configure(page,{rule:90,rate:8,tempo:240});
  await arm(page);await play(page);
  await expect.poll(async()=>(await state(page)).automata.generation,{timeout:15000}).toBeGreaterThan(72);
  const observed=await state(page),history=observed.automata.history;
  expect(history.length).toBeGreaterThan(16);expect(observed.automata.playing).toBe(true);
  const expected=xorRows(8,observed.automata.generation+2);
  for(const row of history){expect(row.row).toEqual(expected[row.generation]);
    if(row.generation<observed.automata.generation)expect(row.endBeat-row.startBeat).toBeCloseTo(.125,8);
    else{expect(row.endBeat-row.startBeat).toBeGreaterThanOrEqual(0);expect(row.endBeat-row.startBeat).toBeLessThanOrEqual(.125+1e-8);}
  }
  const attacks=await notes(page);expect(attacks.length).toBeGreaterThan(50);
  for(const event of attacks.filter(event=>event.generation<expected.length)){
    expect(Number.isInteger(event.generation)).toBe(true);expect(expected[event.generation][event.note-60]).toBe(1);expect(event.velocity).toBe(73);
  }
  const rendered=(await projections(page)).filter(frame=>frame.playing&&frame.generation>=0);
  expect(rendered.length).toBeGreaterThan(10);
  const graphicRows=xorRows(8,Math.max(...rendered.map(frame=>frame.generation))+1);
  for(const frame of rendered) expect(frame.held.map(note=>note.pitch).sort((a,b)=>a-b))
    .toEqual(graphicRows[frame.generation].flatMap((on,i)=>on?[60+i]:[]));
  // Each complete audible generation must contain every expected source voice.
  for(const row of history.filter(row=>row.generation<observed.automata.generation-1)){
    const pitches=expected[row.generation].flatMap((on,i)=>on?[60+i]:[]);
    expect(attacks.filter(event=>event.generation===row.generation).map(event=>event.note).sort((a,b)=>a-b)).toEqual(pitches);
  }
  await expect(liveStage(page)).toHaveAttribute('data-live-sources', /automata/);
  const signal=await audible(page);await page.locator('#creativeStop').click();await silent(page);
  await testInfo.attach('continuous-native-rows',{body:JSON.stringify({generation:observed.automata.generation,signal}),contentType:'application/json'});
});

test('native generation clock survives UI stalls, tempo changes and live rule edits without restarting',async({page},testInfo)=>{
  test.setTimeout(60000);await open(page);await configure(page);await arm(page);await play(page);
  await expect.poll(async()=>(await notes(page)).length).toBeGreaterThanOrEqual(8);
  await page.evaluate(()=>{const until=performance.now()+260;while(performance.now()<until){/* Deliberately stall only the UI. */}});
  await expect.poll(async()=>(await notes(page)).length).toBeGreaterThanOrEqual(12);
  const before=await state(page),first=await notes(page);cadence(first.slice(-8),.25,before.contexts[0].sampleRate);
  await input(page,'creativeTempo',240);
  const editAt=(await notes(page)).length;
  await expect.poll(async()=>(await notes(page)).length).toBeGreaterThanOrEqual(editAt+10);
  const faster=await notes(page);cadence(faster.slice(-6),.125,before.contexts[0].sampleRate);
  expect((await state(page)).automata.generation).toBeGreaterThan(before.automata.generation);
  const generation=(await state(page)).automata.generation;await input(page,'automataMidiRule',255);
  await expect.poll(async()=>(await state(page)).automata.row).toEqual(Array(8).fill(1));
  await expect.poll(async()=>(await notes(page)).filter(event=>event.generation>generation+1).length).toBeGreaterThanOrEqual(16);
  const current=await state(page);expect(current.automata.generation).toBeGreaterThan(generation);expect(current.contexts).toHaveLength(1);
  expect([...new Set((await notes(page)).filter(event=>event.generation>generation+1).map(event=>event.note))].sort((a,b)=>a-b)).toEqual([60,61,62,63,64,65,66,67]);
  const signal=await audible(page);await testInfo.attach('native-clock',{body:JSON.stringify({sampleRate:before.contexts[0].sampleRate,signal}),contentType:'application/json'});
});

test('pausing the live source freezes only its phase while independent pads keep playing',async({page})=>{
  test.setTimeout(60000);await open(page);await configure(page,{tempo:240});
  await prepareStamp(page,'square'); await arm(page); await dropPrepared(page); await play(page); await audible(page);
  await expect.poll(async()=>(await state(page)).automata.generation).toBeGreaterThan(4);
  await page.locator('#automataMidiPlayPause').click();await expect.poll(async()=>(await state(page)).automata.playing).toBe(false);
  const paused=await state(page),pad=paused.samples[0];expect(pad.loop).toBe(true);
  await tab(page,'drawing');
  await page.locator('#blechDropLoop').click(); await page.locator('#blechDropOnce').click();
  await page.waitForTimeout(450);const later=await state(page);
  expect(later.automata.generation).toBe(paused.automata.generation);expect(later.automata.beat).toBeCloseTo(paused.automata.beat,8);
  expect(later.samples[0].id).toBe(pad.id);expect(later.samples[0].loop).toBe(true);
  expect(later.samples[0].cycle*pad.duration+later.samples[0].beat).toBeGreaterThan(pad.cycle*pad.duration+pad.beat+.25);await audible(page);
  await play(page);await expect.poll(async()=>(await state(page)).automata.generation).toBeGreaterThan(paused.automata.generation+2);
  await tab(page,'stamps');
  await page.locator('#blechLiveLayers [data-layer-stop]').click();expect((await state(page)).samples).toEqual([]);await audible(page);
  await page.locator('#creativeStop').click();await silent(page);expect((await state(page)).automata.playing).toBe(false);
});

test('Capture saves the last four live beats stopped and replays the exact exported MIDI without doubling',async({page})=>{
  test.setTimeout(60000);await open(page);await configure(page,{tempo:240});await arm(page);await play(page);
  await expect(page.locator('#automataMidiCaptureBeats')).toHaveValue('4');
  await expect.poll(async()=>(await state(page)).automata.beat).toBeGreaterThan(5);
  await page.locator('#automataMidiCapture').click();await expect(saved(page)).toHaveCount(1);
  await openSavedDrops(page); const card=saved(page).first();await expect(card.locator('[data-pad-play]')).toHaveAttribute('aria-pressed','false');
  expect((await state(page)).samples).toEqual([]);expect(await page.evaluate(()=>__liveQA.launches)).toEqual([]);
  const capture=await page.evaluate(()=>__liveQA.captures.at(-1));expect(capture.duration).toBeCloseTo(4,6);expect(capture.end-capture.start).toBeCloseTo(4,6);
  expect(capture.notes.length).toBeGreaterThanOrEqual(8);expect(capture.notes.every(note=>note.note===64&&note.velocity===73)).toBe(true);
  const interior=capture.notes.filter(note=>note.beat>0&&note.beat+note.duration<4);
  expect(interior.length).toBeGreaterThanOrEqual(6);interior.forEach(note=>expect(note.duration).toBeCloseTo(.5,3));
  await tab(page,'automata'); const pending=page.waitForEvent('download');await page.locator('#automataMidiDownload').click();const bytes=await readFile(await(await pending).path());
  expect([...bytes]).toEqual(capture.bytes);const exported=parseMidi(bytes);expect(exported.notes.length).toBe(capture.notes.length);
  const expected=[];
  for(let beat=Math.floor(capture.start/.5)*.5;beat<capture.end-1e-9;beat+=.5){
    const on=Math.max(capture.start,beat)-capture.start,off=Math.min(capture.end,beat+.5)-capture.start;
    if(off>on)expected.push({note:64,beat:Math.round(on*exported.ppq)/exported.ppq,duration:(Math.round(off*exported.ppq)-Math.round(on*exported.ppq))/exported.ppq,velocity:73});
  }
  expect(capture.notes).toHaveLength(expected.length);
  capture.notes.forEach((note,index)=>{expect(note.note).toBe(expected[index].note);expect(note.velocity).toBe(expected[index].velocity);
    expect(note.beat).toBeCloseTo(expected[index].beat,12);expect(note.duration).toBeCloseTo(expected[index].duration,12);});
  const generation=(await state(page)).automata.generation;await expect.poll(async()=>(await state(page)).automata.generation).toBeGreaterThan(generation);
  await page.locator('#automataMidiPlayPause').click();await silent(page);const paused=(await state(page)).automata.generation;
  await openSavedDrops(page); await card.locator('[data-pad-loop]').check();await card.locator('[data-pad-play]').click();await audible(page);
  expect(await page.evaluate(()=>__liveQA.launches.at(-1).bytes)).toEqual(capture.bytes);
  await expect.poll(async()=>(await state(page)).samples[0]?.cycle).toBeGreaterThanOrEqual(1);
  expect((await state(page)).automata.generation).toBe(paused);
  await card.locator('[data-pad-play]').click();await silent(page);
});

async function drawCell(page,x,y){
  const point=await page.locator('#drawingCanvas').evaluate((canvas,{x,y})=>{const r=canvas.getBoundingClientRect(),cell=Math.min((r.width-28)/48,(r.height-52)/32);return{x:r.left+(r.width-cell*48)/2+(x+.5)*cell,y:r.top+(r.height-cell*32)/2+(y+.5)*cell};},{x,y});
  await page.mouse.click(point.x,point.y);
}
const seedPitches=source=>source.settings.seedRow?.flatMap((on,index)=>on?[source.settings.lowestNote+index]:[]) ?? [];
test('a selected drawing row seeds live rules only on Apply and preserves sent drawing snapshots',async({page})=>{
  await open(page);await page.locator('#drawingCanvas').scrollIntoViewIfNeeded();await drawCell(page,8,5);await drawCell(page,20,5);
  await expect(page.locator('#blechDropSend')).toBeEnabled(); await dropPrepared(page); await expect(saved(page)).toHaveCount(1);
  const sent=await page.evaluate(()=>__liveQA.launches[0]),before=(await state(page)).automata;
  await input(page,'drawingSeedRow',6);expect((await state(page)).automata.row).toEqual(before.row);
  await page.locator('#drawingUseSeed').click();await expect.poll(async()=>seedPitches((await state(page)).automata)).toEqual([56,68]);
  expect((await state(page)).automata.playing).toBe(false);expect((await state(page)).samples.map(sample=>sample.id)).toEqual([sent.id]);
  await tab(page,'automata'); await expand(page.locator('.automata-midi-rule-details')); await input(page,'automataMidiRule',204);await play(page);
  await expect.poll(async()=>{const source=(await state(page)).automata;return source.row.flatMap((on,index)=>on?[source.settings.lowestNote+index]:[]);}).toEqual([56,68]);
  await page.locator('#automataMidiPlayPause').click(); await tab(page,'drawing');
  await page.locator('#drawingCanvas').scrollIntoViewIfNeeded();await drawCell(page,30,5);
  expect(seedPitches((await state(page)).automata)).toEqual([56,68]);expect(await page.evaluate(()=>__liveQA.launches[0].bytes)).toEqual(sent.bytes);
  const pixels=await page.locator('#drawingCanvas').getAttribute('data-pixels');await page.locator('#drawingSeedMode').click();await page.locator('#drawingCanvas').scrollIntoViewIfNeeded();await drawCell(page,10,12);
  await expect(page.locator('#drawingSeedRow')).toHaveValue('13');await expect(page.locator('#drawingCanvas')).toHaveAttribute('data-pixels',pixels);
  expect((await state(page)).contexts).toEqual([]);expect((await state(page)).audio).toBe(false);
});

test('live sound and level are independent of pads and rule edits preserve explicit Audio intent',async({page},testInfo)=>{
  test.setTimeout(60000);await open(page);await configure(page,{tempo:240});
  await page.locator('#automataSound').selectOption('16');await input(page,'automataVolume',.65);await play(page);
  await expect.poll(async()=>(await state(page)).automata.generation).toBeGreaterThan(3);
  expect((await state(page)).contexts).toEqual([]);expect((await state(page)).automata.settings.program).toBe(16);
  await expect(liveStage(page)).toHaveAttribute('data-live-sources', /automata/);
  await arm(page);const signal=await audible(page);await input(page,'automataVolume',0);await silent(page);
  const generation=(await state(page)).automata.generation;
  await prepareStamp(page,'square'); await input(page,'mixerStampBeats',4); await dropPrepared(page); await audible(page);
  expect((await state(page)).automata.settings.gain).toBe(0);expect((await state(page)).automata.generation).toBeGreaterThan(generation);
  await page.locator('#blechDropStop').click(); await silent(page);
  await tab(page,'automata'); await input(page,'automataVolume',.65);await audible(page);
  await page.locator('#audioButton').click();await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','false');await silent(page);
  await input(page,'automataMidiRule',255);await page.locator('#automataMidiRestart').click();
  if(!(await state(page)).automata.playing)await play(page);
  await expect.poll(async()=>(await state(page)).automata.generation).toBeGreaterThan(2);await silent(page);
  await arm(page);await audible(page);expect((await state(page)).contexts).toHaveLength(1);
  await testInfo.attach('live-independent-output',{body:JSON.stringify(signal),contentType:'application/json'});
});

for(const viewport of [{width:390,height:844},{width:844,height:390}]){
  test(`shared live transports, drawing seed and independent loop controls are reachable at ${viewport.width}×${viewport.height}`,async({browser},testInfo)=>{
    const context=await browser.newContext({baseURL:testInfo.project.use.baseURL,viewport,isMobile:true,hasTouch:true});const page=await context.newPage();const failures=[];page.on('pageerror',error=>failures.push(error.message));
    try{
      await open(page);
      const groups = [
        ['automata',['#automataMidiPlayPause','#automataMidiCapture','#automataMidiCaptureBeats']],
        ['drawing',['#drawingSeedMode','#drawingUseSeed','#drawingSeedRow','#blechDropSend','#blechDropLoop']],
        ['stamps',['#blechStampPicker summary','#blechDropSend','#blechDropStop']],
      ];
      for(const [view,selectors] of groups){await tab(page,view);
        for(const selector of selectors){
          const control=page.locator(selector);await control.scrollIntoViewIfNeeded();await expect(control).toBeVisible();const box=await control.boundingBox();
          expect(box.x).toBeGreaterThanOrEqual(-1);expect(box.x+box.width).toBeLessThanOrEqual(viewport.width+1);
          if(selector==='#drawingSeedRow') continue;
          expect(box.width,selector).toBeGreaterThanOrEqual(48);expect(box.height,selector).toBeGreaterThanOrEqual(48);
        }
      }
      await tab(page,'automata');
      await page.locator('#automataMidiPlayPause').focus();await page.keyboard.press('Space');await expect(page.locator('#automataMidiPlayPause')).toHaveAttribute('aria-pressed','true');
      await expect.poll(async()=>(await state(page)).automata.generation).toBeGreaterThan(2);
      await page.keyboard.press('Space');await expect(page.locator('#automataMidiPlayPause')).toHaveAttribute('aria-pressed','false');
      expect((await state(page)).contexts).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
      for(const [view,id] of [['drawing','drawingEditor'],['automata','automataMidiTools']]){await tab(page,view);expect(await page.locator(`#${id}`).evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);}
      await page.locator('#automataMidiPlayPause').scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath(`shared-live-${viewport.width}.png`)});expect(failures).toEqual([]);
    }finally{await context.close();}
  });
}

test('silent Rule 204 holds one visual gate across generations and preserves it through retrigger-to-hold edits',async({page})=>{
  await open(page);await configure(page,{rule:204,rate:2,tempo:240});
  await page.locator('#automataMidiArticulation').selectOption('hold');await play(page);
  await expect.poll(async()=>(await state(page)).automata.generation).toBeGreaterThan(8);
  await expect(liveStage(page)).toHaveAttribute('data-live-held','1');
  const held=(await projections(page)).filter(frame=>frame.playing&&frame.generation>1);
  expect(held.length).toBeGreaterThan(3);expect(new Set(held.flatMap(frame=>frame.held.map(note=>note.id))).size).toBe(1);
  expect([...new Set(held.flatMap(frame=>frame.held.map(note=>note.pitch)))]).toEqual([64]);
  await page.locator('#automataMidiPlayPause').click();await expect(liveStage(page)).toHaveAttribute('data-live-held','0');
  await page.locator('#automataMidiArticulation').selectOption('retrigger');await page.locator('#automataMidiRestart').click();
  await play(page);await expect.poll(async()=>(await state(page)).automata.generation).toBeGreaterThanOrEqual(5);
  await page.locator('#automataMidiArticulation').selectOption('hold');
  await expect.poll(async()=>(await state(page)).automata.rowSettings.articulation).toBe('hold');
  await expect(liveStage(page)).toHaveAttribute('data-live-held','1');
  const transitioned=(await state(page)).automata.generation, transitionStart=(await projections(page)).length;
  await expect.poll(async()=>(await state(page)).automata.generation).toBeGreaterThan(transitioned+8);
  // Restart resets generation numbers. Exclude observations from the first
  // hold run even when its generation number overlaps this later run.
  const continued=(await projections(page)).slice(transitionStart).filter(frame=>frame.playing&&frame.generation>transitioned+1);
  expect(continued.length).toBeGreaterThan(3);
  expect(new Set(continued.flatMap(frame=>frame.held.map(note=>note.id))).size).toBe(1);
  expect((await state(page)).automata.row.flatMap((on,i)=>on?[60+i]:[])).toEqual([64]);
  await page.locator('#automataMidiPlayPause').click();await expect(liveStage(page)).toHaveAttribute('data-live-held','0');
  expect((await state(page)).contexts).toEqual([]);expect((await state(page)).samples).toEqual([]);
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','false');
});

test('New seed creates a fresh pattern at full density, keeps played history and stages while paused', async ({ page }) => {
  await open(page); await configure(page);
  await input(page, 'automataMidiDensity', 1); await page.locator('#automataMidiRestart').click(); await play(page);
  await expect.poll(async () => (await state(page)).automata.generation).toBeGreaterThan(2);
  const before = (await state(page)).automata;
  expect(before.row).toEqual(Array(8).fill(1));
  await page.locator('#automataMidiNextSeed').click();
  const changed = (await state(page)).automata;
  expect(changed.playing).toBe(true); expect(changed.generation).toBeGreaterThan(before.generation);
  expect(changed.beat).toBeGreaterThanOrEqual(before.beat);
  expect(changed.history[0].row).toEqual(before.history[0].row);
  expect(changed.row).not.toEqual(before.row); expect(changed.row.some(Boolean)).toBe(true);
  await expect(page.locator('#automataMidiDensity')).toHaveValue('0.5');
  await expect(page.locator('#automataMidiStatus')).toContainText('Earlier rows are kept');
  await page.locator('#automataMidiPlayPause').click(); const paused = (await state(page)).automata;
  await page.locator('#automataMidiNextSeed').click();
  await expect(page.locator('#automataMidiLiveStatus')).toContainText('new seed ready');
  await expect(page.locator('#automataMidiStatus')).toContainText('Press Play');
  const queued = (await state(page)).automata;
  expect(queued.playing).toBe(false); expect(queued.seedPending).toBe(true);
  expect(queued.row).toEqual(paused.row); expect(queued.history).toEqual(paused.history);
  expect(queued.beat).toBe(paused.beat);
  await input(page, 'automataMidiSeed', 928);
  await expect(page.locator('#automataMidiStatus')).toContainText('Seed prepared');
  const desired = automataMidiSeedRow((await state(page)).automata.settings);
  await play(page);
  await expect.poll(async () => (await state(page)).automata.row).toEqual(desired);
  expect((await state(page)).automata.seedPending).toBe(false);
  expect((await state(page)).contexts).toEqual([]); expect((await state(page)).audio).toBe(false);
});

test('native New seed replaces only live automata notes and Restart alone clears its history', async ({ page }) => {
  test.setTimeout(60000); await open(page); await configure(page);
  await page.locator('#automataMidiArticulation').selectOption('hold');
  await prepareStamp(page, 'square'); await arm(page); await dropPrepared(page); await play(page); await audible(page);
  await expect.poll(async () => (await state(page)).automata.generation).toBeGreaterThan(3);
  const before = await state(page), pad = before.samples[0].id;
  await page.locator('#automataMidiNextSeed').click();
  await expect.poll(async () => (await state(page)).automata.history.some(row => row.reseed)).toBe(true);
  const current = await state(page), fresh = current.automata.history.find(row => row.reseed);
  expect(current.automata.generation).toBeGreaterThan(before.automata.generation);
  expect(current.samples[0].id).toBe(pad); expect(current.audio).toBe(true); expect(current.contexts).toHaveLength(1);
  await expect.poll(async () => (await notes(page)).filter(note => note.generation === fresh.generation).map(note => note.note).sort((a,b) => a-b))
    .toEqual(fresh.row.flatMap((cell, index) => cell ? [fresh.lowestNote + index] : []));
  await audible(page);
  await page.locator('#automataMidiPlayPause').click(); await page.locator('#automataMidiNextSeed').click();
  const paused = await state(page), mark = (await notes(page)).length;
  await page.waitForTimeout(250); expect((await notes(page)).length).toBe(mark);
  expect((await state(page)).automata.beat).toBe(paused.automata.beat); await audible(page);
  await page.locator('#automataMidiRestart').click();
  await expect.poll(async () => (await state(page)).automata.history.length).toBe(0);
  expect((await state(page)).automata.playing).toBe(false); expect((await state(page)).samples[0].id).toBe(pad);
});
