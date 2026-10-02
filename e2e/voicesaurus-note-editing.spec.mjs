import {test,expect} from '@playwright/test';
import {applyVoiceFixture,selectVoiceNote} from './voicesaurus-fixtures.mjs';
const state=page=>page.evaluate(async()=>(await import('./src/site/header-presets.js')).captureHeaderPresetState().snapshot);
async function choose(page,engine='singer'){
 await page.goto('voicesaurus.html');await page.locator('[data-voice-mode="singing"]').click();await page.locator('#voiceMethod').selectOption(engine,{force:true});
}
async function drag(page,locator,dx,dy){await locator.scrollIntoViewIfNeeded();const rect=await locator.boundingBox();await page.mouse.move(rect.x+Math.min(8,rect.width/2),rect.y+rect.height/2);await page.mouse.down();await page.mouse.move(rect.x+Math.min(8,rect.width/2)+dx,rect.y+rect.height/2+dy,{steps:5});await page.mouse.up();}

for(const [name,viewport]of Object.entries({desktop:{width:1440,height:900},portrait:{width:390,height:844},landscape:{width:844,height:390}}))test(`notes and their menus fit one pitch row on ${name}`,async({browser,baseURL})=>{
 const context=await browser.newContext({viewport,hasTouch:name!=='desktop',isMobile:name!=='desktop',baseURL});try{
  const page=await context.newPage();await choose(page,'sinsy');
  const sizes=await page.locator('.native-timeline-note').evaluateAll(notes=>notes.map(note=>{
   const grid=document.querySelector('.native-piano-grid'),row=Number(grid.dataset.pitchRow),box=note.getBoundingClientRect();
   return {height:box.height,row,phase:(box.top-grid.getBoundingClientRect().top-1)/row,handle:note.querySelector('button').getBoundingClientRect().height,picker:note.querySelector('summary').getBoundingClientRect().height};
  }));
  for(const size of sizes){expect(size.height).toBeLessThanOrEqual(size.row);expect(size.height).toBeGreaterThan(16);expect(size.handle).toBe(size.height);expect(size.picker).toBe(size.height);expect(size.phase).toBeCloseTo(Math.round(size.phase),5);}
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
 }finally{await context.close();}
});

test('double-click inserts a snapped note after scrolling without arming Audio',async({page})=>{
 await choose(page);const handle=page.locator('[data-note-handle="0"]');await handle.focus();
 for(let i=0;i<16;i++)await handle.press('Shift+ArrowRight');
 expect((await state(page)).values.duration).toBe(4);
 await page.getByRole('button',{name:'Close note controls',exact:true}).click();
 const roll=page.locator('.native-piano-scroll');await page.locator('.native-piano-grid').scrollIntoViewIfNeeded();
 await roll.evaluate(el=>el.scrollLeft=el.scrollWidth-el.clientWidth);
 const target=await page.locator('.native-piano-grid').evaluate(grid=>{const rect=grid.getBoundingClientRect(),px=Number(grid.dataset.beatPixels),row=Number(grid.dataset.pitchRow);return{x:rect.left+48+8.5*px,y:rect.top+row*1.5,midi:Number(grid.dataset.maxMidi)-1};});
 await page.mouse.dblclick(target.x,target.y);
 const scene=await state(page);expect(scene.input.phrase.notes).toHaveLength(3);expect(scene.input.phrase.notes[1].rest).toBe(true);expect(scene.input.phrase.notes[1].values.duration).toBeCloseTo(.25);expect(scene.input.phrase.notes[2].values.pitch).toBeCloseTo(440*2**((target.midi-69)/12));
 await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','false');await expect(page.locator('#nativePlay')).toHaveAttribute('aria-pressed','false');
 await page.locator('[data-note-handle="2"]').dblclick();expect((await state(page)).input.phrase.notes).toHaveLength(3);
});

test('drag snaps pitch and length, preserves exact values before a snap, and allows fine Shift editing',async({page})=>{
 await choose(page);await applyVoiceFixture(page,{values:{pitch:333}});
 const handle=page.locator('[data-note-handle="0"]'),row=Number(await page.locator('.native-piano-grid').getAttribute('data-pitch-row'));
 await drag(page,handle,0,-4);expect((await state(page)).values.pitch).toBe(333);
 await drag(page,handle,0,-row);const snapped=69+12*Math.log2((await state(page)).values.pitch/440);expect(snapped).toBeCloseTo(Math.round(snapped),8);
 await handle.focus();for(let i=0;i<12;i++)await handle.press('Shift+ArrowLeft');
 expect((await state(page)).values.duration).toBe(.5);
 const px=Number(await page.locator('.native-piano-grid').getAttribute('data-beat-pixels'));
 await drag(page,page.getByRole('button',{name:'Resize note 1',exact:true}),px*.32,0);expect((await state(page)).values.duration).toBeCloseTo(.625);
 await page.locator('#nativeBeatSnap').selectOption('0.5',{force:true});await drag(page,page.getByRole('button',{name:'Resize note 1',exact:true}),px*.8,0);expect((await state(page)).values.duration*2).toBeCloseTo(2);
 await page.keyboard.down('Shift');await drag(page,handle,0,-7);await page.keyboard.up('Shift');const fine=69+12*Math.log2((await state(page)).values.pitch/440);expect(Math.abs(fine-Math.round(fine))).toBeGreaterThan(.05);
});

test('custom Sinsy lyrics remain editable beside the selected compact note',async({page})=>{
 await choose(page,'sinsy');await page.locator('#native-syllable-0').selectOption('__custom__',{force:true});
 const lyric=page.getByRole('textbox',{name:'Note 1 kana syllable',exact:true});await expect(lyric).toBeVisible();await lyric.fill('ああ');expect((await state(page)).input.notes[0].lyric).toBe('ああ');
 await page.locator('#native-syllable-0').selectOption('し',{force:true});await expect(lyric).toBeHidden();expect((await state(page)).input.notes[0].lyric).toBe('し');
});

test('note sound popup opens nearby, chooses an actual engine sound, and closes without scrolling',async({page})=>{
 await choose(page);await expect(page.locator('.native-note-editor')).toBeHidden();
 await page.getByRole('button',{name:'Add note',exact:true}).click();
 const editor=page.locator('.native-note-editor');await expect(editor).toBeVisible();
 await expect(page.getByRole('slider',{name:/^Note \d+ (pitch|beats)$/})).toHaveCount(0);
 await expect(page.locator('#param-pitch,#param-duration')).toHaveCount(0);
 const before=await state(page),scroll=await page.evaluate(()=>scrollY),menu=editor.locator('[data-select-id="native-note-sound-preset"]');
 await menu.locator('summary').click();await expect(menu.locator('.instrument-picker-panel')).toBeVisible();
 const choice=await editor.locator('#native-note-sound-preset').evaluate(select=>[...select.options].find(option=>option.value&&option.value!==select.value).value);
 await menu.locator(`[data-option-index="${await editor.locator('#native-note-sound-preset').evaluate((select,value)=>[...select.options].findIndex(option=>option.value===value),choice)}"]`).click();
 const after=await state(page);expect(after.input.phrase.notes[0]).toEqual(before.input.phrase.notes[0]);
 expect(after.input.phrase.notes[1].values.pitch).toBe(before.input.phrase.notes[1].values.pitch);expect(after.input.phrase.notes[1].values.duration).toBe(before.input.phrase.notes[1].values.duration);
 expect(after.input.phrase.notes[1].values).not.toEqual(before.input.phrase.notes[1].values);
 expect(await page.evaluate(()=>scrollY)).toBe(scroll);
 await page.getByRole('button',{name:'Close note controls',exact:true}).click();await expect(editor).toBeHidden();
 await selectVoiceNote(page,1);await page.keyboard.press('Escape');await expect(editor).toBeHidden();await expect(page.locator('[data-note-handle="1"]')).toBeFocused();
 await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','false');
});

test('cancelling a rest drag restores its exact null pitch and input',async({page})=>{
 await choose(page,'sinsy');await page.evaluate(async()=>{
  const {defaultScene,NATIVE_METHODS}=await import('./src/instruments/voicesaurus/native-model.js');
  const {mountSingingTimeline}=await import('./src/instruments/voicesaurus/native-timeline.js');
  const scene=defaultScene('sinsy');scene.input.notes=[{midi:null,rest:true,beats:1},{midi:64,lyric:'あ',beats:1}];
  const host=document.createElement('div');host.id='cancelTimeline';host.style.cssText='position:absolute;top:80px;left:10px;width:900px;background:#101713;z-index:1000';document.body.append(host);
  window.cancelScene=scene;mountSingingTimeline(host,scene,{spec:NATIVE_METHODS.sinsy});
 });
 const before=await page.evaluate(()=>structuredClone(cancelScene)),handle=page.locator('#cancelTimeline [data-note-handle="0"]');
 await handle.scrollIntoViewIfNeeded();const rect=await handle.boundingBox();await page.mouse.move(rect.x+8,rect.y+rect.height/2);await page.mouse.down();await page.mouse.move(rect.x+8,rect.y+rect.height/2-30,{steps:4});
 await handle.dispatchEvent('pointercancel',{pointerId:1});await page.mouse.up();
 expect(await page.evaluate(()=>cancelScene)).toEqual(before);
});
