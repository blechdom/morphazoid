import {test,expect} from '@playwright/test';

const singing=['singer','stk-voicform','csound-fof','csound-vosim','sinsy','sample-bank'];
async function capture(page){return page.evaluate(async()=>(await import('./src/site/header-presets.js')).captureHeaderPresetState());}
async function mode(page,value){await page.locator(`[data-voice-mode="${value}"]`).click();await expect(page.locator(`[data-voice-mode="${value}"]`)).toHaveAttribute('aria-pressed','true');}
async function ready(page){await expect(page.locator('#nativeStatus')).not.toHaveText('Rendering voice…');}

test('mode switch scopes methods, complete preset tours, and dice',async({page})=>{
 test.setTimeout(120000);await page.goto('voicesaurus.html');
 const banks=await page.evaluate(async()=>{const m=await import('./src/instruments/voicesaurus/native-model.js');return Object.fromEntries(['speaking','singing'].map(mode=>[mode,m.presetsForVoiceMode(mode)]));});
 for(const activeMode of ['speaking','singing']){
  await mode(page,activeMode);
  const engines=await page.locator('#voiceMethod option').evaluateAll(options=>options.map(o=>o.value));
  expect(engines.every(engine=>singing.includes(engine)===(activeMode==='singing'))).toBe(true);
  expect((await capture(page)).presetCount).toBe(banks[activeMode].length);
  const ids=[];
  for(let i=0;i<banks[activeMode].length;i++){
   await page.locator('.header-preset-next').click();
   await expect(page.locator('.header-preset-controls')).not.toHaveAttribute('aria-busy','true');
   const state=await capture(page);ids.push(state.selectedId);expect(singing.includes(state.snapshot.engine)).toBe(activeMode==='singing');
   if(activeMode==='singing'){
    const notes=state.snapshot.input.phrase?.notes??state.snapshot.input.notes;
    expect(notes.filter(note=>!note.rest).length,state.selectedId).toBeGreaterThanOrEqual(3);
    await expect(page.locator('.native-timeline-note')).toHaveCount(notes.length);
   }
  }
  expect(ids).toEqual(banks[activeMode].map(p=>p.id));
  for(let i=0;i<12;i++){
   await page.locator('.header-preset-random').click();
   await expect(page.locator('.header-preset-controls')).not.toHaveAttribute('aria-busy','true');
   expect(singing.includes((await capture(page)).snapshot.engine)).toBe(activeMode==='singing');
   await expect(page.locator('.header-preset-controls')).toHaveAttribute('data-preset-id','custom');
  }
 }
 await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','false');
});

test('switching modes restores exact edits, selected note, preset tour, prose, and transport settings',async({page})=>{
 await page.goto('voicesaurus.html');
 await page.locator('#nativeText').fill('Keep my speaking phrase.');
 await page.locator('.header-preset-next').click();
 const speech=await capture(page);
 await page.locator('#nativeLoop').click();
 await mode(page,'singing');await page.locator('#voiceMethod').selectOption('singer',{force:true});
 await page.getByRole('button',{name:'Add note',exact:true}).click();
 await page.locator('[data-note-handle="1"]').focus();await page.locator('[data-note-handle="1"]').press('ArrowUp');
 const song=await capture(page);
 await mode(page,'speaking');expect((await capture(page)).snapshot).toEqual(speech.snapshot);
 expect((await capture(page)).selectedId).toBe(speech.selectedId);
 await expect(page.locator('#nativeText')).toHaveValue('Keep my speaking phrase.');
 await page.locator('.header-preset-next').click();expect((await capture(page)).selectedId).not.toBe(speech.selectedId);
 await mode(page,'singing');expect((await capture(page)).snapshot).toEqual(song.snapshot);
 await expect(page.locator('.native-note-editor')).toHaveAttribute('data-note-index','1');
 await expect(page.locator('#nativeLoop')).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('#level')).toHaveValue('0.46');
 await expect(page.locator('#nativePlay')).toHaveAttribute('aria-pressed','false');
 await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','false');
});

test('mode switch cancels a pending old preset without rollback and preserves play or pause intention',async({page})=>{
 await page.addInitScript(()=>{
  const WorkerClass=window.Worker;window.modeWorkers=[];window.holdModeWorker=false;
  window.Worker=class extends WorkerClass{
   constructor(...args){super(...args);this.killed=false;window.modeWorkers.push(this);}
   postMessage(...args){if(!window.holdModeWorker)super.postMessage(...args);}
   terminate(){this.killed=true;super.terminate();}
  };
 });
 await page.goto('voicesaurus.html');await page.locator('#nativeLoop').click();await page.locator('#audioButton').click();await page.locator('#nativePlay').click();await ready(page);
 await page.evaluate(()=>holdModeWorker=true);await page.locator('.header-preset-next').click();
 await expect(page.locator('.header-preset-controls')).toHaveAttribute('aria-busy','true');
 await page.evaluate(()=>holdModeWorker=false);await mode(page,'singing');await ready(page);
 expect(singing.includes((await capture(page)).snapshot.engine)).toBe(true);
 await expect(page.locator('#nativePlay')).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('#nativeLoop')).toHaveAttribute('aria-pressed','true');
 expect(await page.evaluate(()=>modeWorkers.every(worker=>worker.killed))).toBe(true);
 await page.locator('#nativePlay').click();await mode(page,'speaking');await ready(page);
 await expect(page.locator('#nativePlay')).toHaveAttribute('aria-pressed','false');
 await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('#audioError')).toBeHidden();
});
