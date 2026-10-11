import { expect, test } from '@playwright/test';
import { readAudioStatus } from './helpers/audio-probe.mjs';

async function open(page) {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    globalThis.__levelsQA = { contexts: [], engine: null, launches: [] };
    const Native = AudioContext;
    globalThis.AudioContext = class extends Native { constructor(...args) { super(...args); __levelsQA.contexts.push(this); } };
  });
  // Observe submitted SMF and the real instance; preserve the native audio path.
  await page.route('**/src/instruments/midi-mixer/midi-mixer-engine.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
      const qaVolume=MidiMixerEngine.prototype.setVolume,qaTrigger=MidiMixerEngine.prototype.triggerSample;
      MidiMixerEngine.prototype.setVolume=function(...args){__levelsQA.engine=this;return qaVolume.apply(this,args);};
      MidiMixerEngine.prototype.triggerSample=function(...args){const sample=qaTrigger.apply(this,args);if(sample)__levelsQA.launches.push({
        id:sample.id,name:sample.name,midi:{...sample.midi},gain:sample.gain,duration:sample.analysis.durationBeats,
        notes:sample.analysis.notes.map(({note,beat,duration})=>({note,beat,duration})),
        programs:sample.analysis.events.filter(event=>event.kind===12).map(event=>event.a)});return sample;};` });
  });
  await page.goto('/midiphoria.html'); await page.locator('#mixerModeButton').click();
  await expect(page.locator('#tempoFromB')).toBeEnabled(); await expect(page.locator('#mixerStampCount')).toHaveText('58 / 58');
  return errors;
}
async function set(page, id, value) { await page.locator(`#${id}`).evaluate((input, value) => { input.value=String(value); input.dispatchEvent(new Event('input', {bubbles:true})); }, value); }
const launch = async (page, action) => {
  const count=await page.evaluate(()=>__levelsQA.launches.length); await action();
  await expect.poll(()=>page.evaluate(()=>__levelsQA.launches.length)).toBe(count+1);
  return page.evaluate(()=>__levelsQA.launches.at(-1));
};
const stamp=(page,id)=>page.locator(`[data-mixer-sample="${id}"]`);
const state=page=>page.evaluate(()=>{const state=__levelsQA.engine.state;return {playing:state.playing,beat:state.beat,audio:state.audioEnabled,
  gains:state.decks.map(deck=>deck.config.gain),samples:state.samples.map(sample=>({id:sample.id,gain:sample.gain,midi:sample.midi}))};});
async function sourcePanel(page) { const detail=page.locator('.mixer-stamp-midi'); if(!await detail.evaluate(node=>node.open))await detail.locator(':scope > summary').click(); }
async function sounding(page) { await expect.poll(async()=>(await readAudioStatus(page)).rms,{timeout:8000}).toBeGreaterThan(.001); }
async function silent(page) { await expect.poll(async()=>(await readAudioStatus(page)).peak,{timeout:8000}).toBeLessThan(.0001); }

test('generated stamps start and reset to piano while file instruments and remembered choices remain independent',async({page})=>{
  const errors=await open(page); await expect(page.locator('#mixerSampleProgram')).toHaveValue('0');
  const first=await launch(page,()=>stamp(page,'heart').click()); expect(first.midi.program).toBe(0); expect(first.programs).toEqual([0]);
  await page.locator('#mixerSampleProgram').selectOption('127');
  const file=await launch(page,()=>stamp(page,'black-pattern-3-beat-funnel-128').click());
  await expect(page.locator('#mixerSampleProgram')).toHaveValue('original'); expect(file.midi.program).toBeUndefined();
  await page.locator('#mixerSampleProgram').selectOption('80');
  const shape=await launch(page,()=>stamp(page,'square').click()); expect(shape.midi.program).toBe(127);
  await expect(page.locator('#mixerSampleProgram')).toHaveValue('127');
  const remembered=await launch(page,()=>stamp(page,'black-pattern-3-beat-funnel-128').click()); expect(remembered.midi.program).toBe(80);
  await page.locator('#mixerSampleProgram').selectOption('original');
  await launch(page,()=>stamp(page,'heart').click()); await sourcePanel(page);
  await page.locator('.mixer-stamp-live-midi summary').filter({hasText:/^Mix$/}).click();
  await page.getByRole('slider',{name:'Stamp sound: Voice gain',exact:true}).fill('1.2');
  await page.getByRole('button',{name:'Reset Stamp sound',exact:true}).click();
  await expect(page.locator('#mixerSampleProgram')).toHaveValue('0');
  const reset=await launch(page,()=>page.locator('#mixerStampAgain').click()); expect(reset.midi.program).toBe(0); expect(reset.programs).toEqual([0]);
  const original=await launch(page,()=>stamp(page,'black-pattern-3-beat-funnel-128').click()); expect(original.midi.program).toBeUndefined();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','false'); expect(await page.evaluate(()=>__levelsQA.contexts.length)).toBe(0); expect(errors).toEqual([]);
});

test('128-note stamps and transferred freehand drawings retain full pitch endpoints and timing',async({page})=>{
  const errors=await open(page); await expect(page.locator('#mixerStampSpan')).toHaveAttribute('max','128');
  await set(page,'mixerStampSpan',128); await set(page,'mixerStampDensity',1); await sourcePanel(page); await page.locator('#mixerStampSeed').fill('66');
  const scatter=await launch(page,()=>stamp(page,'scatter').click());
  const pitches=scatter.notes.map(note=>note.note); expect(Math.min(...pitches)).toBe(0); expect(Math.max(...pitches)).toBe(127);
  expect(new Set(pitches).size).toBeGreaterThan(48); expect(scatter.programs).toEqual([0]);
  await page.locator('#drawingModeButton').click(); if(await page.locator('#drawingClear').isEnabled())await page.locator('#drawingClear').click();
  const canvas=page.locator('#drawingCanvas'); await canvas.scrollIntoViewIfNeeded(); const box=await canvas.boundingBox();
  const cell=Math.min((box.width-28)/48,(box.height-52)/32),left=box.x+(box.width-cell*48)/2,top=box.y+(box.height-cell*32)/2;
  await page.mouse.move(left+cell*.5,top+cell*16.5); await page.mouse.down();
  await page.mouse.move(left+cell*47.5,top+cell*16.5,{steps:12}); await page.mouse.up();
  await page.locator('#mixerModeButton').click(); await set(page,'mixerStampSpan',48);
  const normal=await launch(page,()=>page.locator('#mixerSendDrawing').click()); expect(new Set(normal.notes.map(note=>note.note)).size).toBe(48);
  await set(page,'mixerStampSpan',128);
  const full=await launch(page,()=>page.locator('#mixerSendDrawing').click());
  expect(full.notes.map(note=>note.note).sort((a,b)=>a-b)).toEqual(Array.from({length:128},(_,index)=>index));
  expect(full.duration).toBe(normal.duration); expect(full.notes.every(note=>note.beat===normal.notes[0].beat&&note.duration===normal.notes[0].duration)).toBe(true);
  expect(full.programs).toEqual([0]); await expect(page.locator('#mixerStampDrawBase')).toHaveAttribute('max','0'); await expect(page.locator('#mixerStampDrawBase')).toHaveValue('0');
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','false'); expect(await page.evaluate(()=>__levelsQA.contexts.length)).toBe(0); expect(errors).toEqual([]);
});

function held(note,pan){
  const track=[0,192,16,0,176,10,pan,0,176,91,0,0,176,93,0,0,176,94,0,0,144,note,96,0x98,0,128,note,0,0,255,47,0];
  const size=Buffer.alloc(4);size.writeUInt32BE(track.length);
  return Buffer.concat([Buffer.from([77,84,104,100,0,0,0,6,0,0,0,1,0,96]),Buffer.from('MTrk'),size,Buffer.from(track)]);
}
async function stereo(page){return page.evaluate(()=>{
  const qa=__levelsQA;if(!qa.stereo){const splitter=qa.engine.context.createChannelSplitter(2),left=qa.engine.context.createAnalyser(),right=qa.engine.context.createAnalyser();
    left.fftSize=right.fftSize=2048;qa.engine._ceiling.connect(splitter);splitter.connect(left,0);splitter.connect(right,1);qa.stereo={left,right};}
  return Object.fromEntries(Object.entries(qa.stereo).map(([name,meter])=>{const data=new Float32Array(2048);meter.getFloatTimeDomainData(data);return[name,Math.sqrt(data.reduce((sum,value)=>sum+value*value,0)/data.length)];}));
});}

test('three source volume knobs independently control native decks and live and subsequent Black MIDI stamps',async({page},testInfo)=>{
  test.setTimeout(60000); const errors=await open(page);
  for(const [index,note,pan]of[[0,60,0],[1,72,127]]){await page.locator(`#deckFile${index}`).setInputFiles({name:`Level ${index}.mid`,mimeType:'audio/midi',buffer:held(note,pan)});await expect(page.locator(`#deckSong${index} option:checked`)).toHaveText(`Level ${index}.mid`);}
  await set(page,'deckGain0',1);await set(page,'deckGain1',0);await set(page,'mixerSampleLevel',0);
  await page.locator('#audioButton').click();await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','true',{timeout:20000});await page.locator('#mixerPlay').click();await sounding(page);
  await expect.poll(async()=>{const value=await stereo(page);return value.left/Math.max(1e-6,value.right);}).toBeGreaterThan(3);const onlyA=await stereo(page);
  await set(page,'deckGain0',0);await silent(page);await set(page,'deckGain1',1);await sounding(page);
  await expect.poll(async()=>{const value=await stereo(page);return value.right/Math.max(1e-6,value.left);}).toBeGreaterThan(3);const onlyB=await stereo(page);
  await set(page,'deckGain1',0);await silent(page);await set(page,'mixerSampleLevel',.7);await set(page,'mixerStampBeats',32);await page.locator('#mixerSampleProgram').selectOption('16');
  const shot=await launch(page,()=>stamp(page,'square').click());await sounding(page);await set(page,'mixerSampleLevel',0);await silent(page);
  expect((await state(page)).gains).toEqual([0,0]);await set(page,'mixerSampleLevel',.6);await sounding(page);
  expect((await state(page)).samples.find(sample=>sample.id===shot.id)?.gain).toBe(.6);
  await page.locator('#mixerStopSamples').click();await set(page,'mixerSampleLevel',0);
  const quiet=await launch(page,()=>page.locator('#mixerStampAgain').click());expect(quiet.gain).toBe(0);await silent(page);
  await set(page,'mixerSampleLevel',.4);await sounding(page);await page.locator('#mixerStopSamples').click();
  const next=await launch(page,()=>page.locator('#mixerStampAgain').click());expect(next.gain).toBe(.4);await sounding(page);
  const audio=await readAudioStatus(page);expect(audio.peak).toBeLessThanOrEqual(.981);expect((await state(page)).playing).toBe(true);
  await testInfo.attach('independent-source-levels',{body:JSON.stringify({onlyA,onlyB,audio,state:await state(page)}),contentType:'application/json'});
  await page.locator('#mixerStop').click();await silent(page);expect(errors).toEqual([]);
});

for(const viewport of[{width:1440,height:900},{width:390,height:844},{width:844,height:390}]){
  test(`three source volume knobs stay grouped and reachable at ${viewport.width}×${viewport.height}`,async({browser},testInfo)=>{
    const context=await browser.newContext({baseURL:testInfo.project.use.baseURL,viewport,isMobile:viewport.width<1000,hasTouch:viewport.width<1000});const page=await context.newPage();
    try{const errors=await open(page),group=page.getByRole('group',{name:'Source volumes',exact:true});
      await expect(group.locator('input[type=range]')).toHaveCount(3);
      const positions=[];for(const [id,name,value]of[['deckGain0','Volume A',.3],['deckGain1','Volume B',.8],['mixerSampleLevel','Black MIDI volume',.2]]){
        await expect(page.locator(`#${id}`)).toHaveCount(1);const control=group.getByRole('slider',{name,exact:true});await expect(control).toBeVisible();
        await expect(control.locator('..')).toHaveClass(/mixer-range-knob/);await control.scrollIntoViewIfNeeded();const box=await control.boundingBox();positions.push(box);
        expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(viewport.width);if(viewport.width<1000){expect(box.width).toBeGreaterThanOrEqual(48);expect(box.height).toBeGreaterThanOrEqual(48);}
        await control.fill(String(value));}
      expect(Math.max(...positions.map(box=>box.y))-Math.min(...positions.map(box=>box.y))).toBeLessThan(5);
      const geometry=await page.evaluate(()=>({group:document.getElementById('mixerSourceLevels').getBoundingClientRect().bottom,decks:document.getElementById('mixerDeckHost').getBoundingClientRect().top,overflow:document.documentElement.scrollWidth>innerWidth+1}));
      expect(geometry.group).toBeLessThan(geometry.decks);expect(geometry.overflow).toBe(false);expect((await state(page)).gains).toEqual([.3,.8]);
      await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','false');expect(await page.evaluate(()=>__levelsQA.contexts.length)).toBe(0);expect(errors).toEqual([]);
      await group.scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath(`source-levels-${viewport.width}.png`)});
    }finally{await context.close();}
  });
}
