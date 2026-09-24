import {test,expect} from '@playwright/test';
const state=page=>page.evaluate(()=>window.__puggler.snapshot());
const range=(page,id,value)=>page.locator(`#${id}`).evaluate((node,v)=>{node.value=v;node.dispatchEvent(new Event('input',{bubbles:true}));},String(value));
async function open(page){await page.goto('puggler.html');await page.waitForFunction(()=>window.__puggler?.snapshot().collage.ready);await page.locator('#audioButton').click();await page.waitForFunction(()=>window.__puggler.snapshot().audioOn,{timeout:20000});}
async function level(page){return page.evaluate(async()=>{
  const {getSharedAudioOutputManager}=await import(new URL('src/audio-output-manager.js',location.href)),manager=getSharedAudioOutputManager(globalThis),rows=[];
  for(let i=0;i<40;i++){const s=manager.getStatus();rows.push({rms:s.rms,peak:s.peak,clipped:s.clipped});await new Promise(r=>setTimeout(r,80));}
  const active=rows.filter(s=>s.rms>.0003);return {mean:active.reduce((n,s)=>n+s.rms,0)/Math.max(1,active.length),peak:Math.max(...rows.map(s=>s.peak)),finite:rows.every(s=>Number.isFinite(s.rms)&&Number.isFinite(s.peak)),clipped:rows.some(s=>s.clipped)};
});}
test('complete scenes and seeded dice remain audible at one unchanged output level',async({page},testInfo)=>{
  test.setTimeout(300000);
  await page.addInitScript(()=>{let seed=9193;window.__seedPugglerDice=value=>{seed=value;};Math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await open(page);await range(page,'level',.48);
  const ids=await page.locator('[data-full-preset]').evaluateAll(nodes=>nodes.map(n=>n.dataset.presetId)),rows=[];
  for(const id of [...ids,...Array.from({length:8},(_,i)=>`dice-${i}`)]){
    await page.evaluate(id=>{if(id.startsWith('dice-')){window.__seedPugglerDice(9193+Number(id.slice(5)));document.querySelector('.header-preset-random').click();}else document.querySelector(`[data-full-preset][data-preset-id="${id}"]`).click();},id);
    await page.waitForTimeout(450);const measured=await level(page);const snapshot=await page.evaluate(async()=>{const m=await import(new URL('src/site/header-presets.js',location.href));return m.captureHeaderPresetState().snapshot;});rows.push({id,snapshot,...measured});
    expect(measured.finite).toBe(true);expect(measured.clipped).toBe(false);expect(measured.mean).toBeGreaterThan(.006);expect(measured.peak).toBeLessThan(.46);
    expect(await state(page)).toMatchObject({level:.48,audioOn:true,running:true,objectBufferCount:198});
  }
  const spread=items=>20*Math.log10(Math.max(...items.map(s=>s.mean))/Math.min(...items.map(s=>s.mean)));
  await testInfo.attach('preset-and-dice-levels',{body:JSON.stringify({rows,presetSpreadDb:spread(rows.slice(0,ids.length)),diceSpreadDb:spread(rows.slice(ids.length))},null,2),contentType:'application/json'});
  // The rejected version measured ~29 dB across its factory scenes. This gate
  // allows real articulation/rest differences but rejects that order-of-magnitude jump.
  expect(spread(rows.slice(0,ids.length))).toBeLessThan(12);expect(spread(rows.slice(ids.length))).toBeLessThan(14);
  expect(errors).toEqual([]);
});
test('pitch sweeps keep notes tied to the juggling beat and rapid edits keep resources bounded',async({page})=>{
  test.setTimeout(45000);await open(page);await range(page,'count','3');await page.locator('#pattern').selectOption('cascade');await range(page,'tempo',240);await range(page,'chaos',0);await range(page,'assist',120);
  await page.locator('#object0').selectOption('guitar');const before=await state(page);
  for(let i=0;i<12;i++){
    await range(page,'height',i%2?1.5:0);await range(page,'loft',i%2?2.5:.8);
    await page.locator('#skin').selectOption(['punk','history','future'][i%3]);await page.waitForTimeout(220);
    const s=await state(page);expect(s.tempo).toBe(240);expect(s.sonics.length).toBeLessThanOrEqual(10);expect(s.airTails).toBeLessThanOrEqual(20);expect(s.attacks).toBeLessThanOrEqual(48);
    for(const voice of s.sonics.filter(v=>v.noteBeat!==null)){expect(Number.isFinite(voice.noteBeat)).toBe(true);expect(voice.noteBeat).toBeLessThanOrEqual(s.beat+.1);}
  }
  expect((await state(page)).rhythmicNotes).toBeGreaterThan(before.rhythmicNotes+5);
  await page.locator('#audioButton').click();await page.waitForTimeout(200);expect((await level(page)).peak).toBeLessThan(.001);
});
