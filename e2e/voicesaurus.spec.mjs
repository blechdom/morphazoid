import {test,expect} from '@playwright/test';
import {selectVoiceNote} from './voicesaurus-fixtures.mjs';

async function observe(page){
 await page.addInitScript(()=>{
  const NativeWorker=window.Worker;window.__voiceWorkers=[];window.__voiceRequests=[];window.__holdVoice=false;window.__failVoiceOnce=false;window.__sourceStarts=[];
  window.Worker=class extends NativeWorker{
   constructor(url,opts){super(url,opts);this.killed=0;this.url=String(url);window.__voiceWorkers.push(this);}
   terminate(){this.killed++;super.terminate();}
   postMessage(...args){window.__voiceRequests.push(structuredClone(args[0]));if(window.__failVoiceOnce){window.__failVoiceOnce=false;queueMicrotask(()=>this.dispatchEvent(new MessageEvent('message',{data:{type:'error',message:'Injected native voice failure'}})));return;}if(!window.__holdVoice)super.postMessage(...args);}
  };
  const original=AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start=function(...args){window.__sourceStarts.push({when:args[0],offset:args[1]??0,length:this.buffer?.length});return Reflect.apply(original,this,args);};
 });
}
async function ready(page){await expect(page.locator('#nativeStatus')).not.toHaveText('Rendering voice…');}
async function selectModeFor(page,engine){const mode=await page.evaluate(async engine=>(await import('./src/instruments/voicesaurus/native-model.js')).voiceModeForEngine(engine),engine);await page.locator(`[data-voice-mode="${mode}"]`).click();}
async function select(page,engine){await selectModeFor(page,engine);await page.locator('#voiceMethod').selectOption(engine,{force:true});await ready(page);await expect(page.locator('#voiceMethod')).toHaveValue(engine);}
async function capture(page){return page.evaluate(async()=>({scene:(await import('./src/site/header-presets.js')).captureHeaderPresetState().snapshot,method:document.querySelector('#voiceMethod').value,text:document.querySelector('#nativeText').value,play:document.querySelector('#nativePlay').getAttribute('aria-pressed'),audio:document.querySelector('#audioButton').getAttribute('aria-pressed'),loop:document.querySelector('#nativeLoop').getAttribute('aria-pressed'),level:document.querySelector('#level').value}));}
async function signal(page,ms=1000){return page.evaluate(async(ms)=>{const{getSharedAudioOutputManager}=await import('./src/audio-output-manager.js');let peak=0,rms=0,clipped=false,finite=true;const end=performance.now()+ms;while(performance.now()<end){const s=getSharedAudioOutputManager(globalThis).getStatus();peak=Math.max(peak,s.peak??0);rms=Math.max(rms,s.rms??0);clipped||=Boolean(s.clipped);finite&&=Number.isFinite(s.peak??0)&&Number.isFinite(s.rms??0);await new Promise(r=>setTimeout(r,30));}return{peak,rms,clipped,finite};},ms);}
async function setKnob(page,key,value){const field=page.locator(`#param-${key}`);if(await field.evaluate(el=>!!el.closest('.native-note-editor'))&&!await page.locator('.native-note-editor').isVisible())await selectVoiceNote(page,0);await field.evaluate((el,value)=>{el.value=String(value);el.dispatchEvent(new Event('input',{bubbles:true}));},value);await page.waitForTimeout(350);await ready(page);}
async function startLoop(page,engine='singer'){await select(page,engine);await page.locator('#nativeLoop').click();await page.locator('#audioButton').click();await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','true');await page.locator('#nativePlay').click();await ready(page);await expect(page.locator('#audioError')).toBeHidden();}

for(const[name,viewport]of Object.entries({desktop:{width:1440,height:900},portrait:{width:390,height:844},landscape:{width:844,height:390}}))test(`Japanese syllable menu supports western spelling and custom lyrics on ${name}`,async({browser,baseURL})=>{
 const context=await browser.newContext({viewport,hasTouch:name!=='desktop',isMobile:name!=='desktop',baseURL});
 try{
  const page=await context.newPage();await observe(page);await page.goto('voicesaurus.html');await select(page,'sinsy');
  const picker=page.locator('[data-select-id="native-syllable-0"]'),summary=picker.locator('summary'),search=picker.getByRole('searchbox'),lyric=page.getByRole('textbox',{name:'Note 1 kana syllable',exact:true});
  const original=(await capture(page)).scene.input.notes[0].lyric;
  await expect(page.locator('#native-syllable-0')).toHaveValue(original);
  await summary.click();await search.fill('shi');
  const choice=picker.getByRole('button',{name:'shi · し',exact:true});await expect(choice).toBeVisible();
  const bounds=await picker.locator('.instrument-picker-panel').boundingBox();expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.y).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(viewport.width+1);expect(bounds.y+bounds.height).toBeLessThanOrEqual(viewport.height+1);
  const searchBounds=await search.boundingBox();expect(searchBounds.width).toBeGreaterThan(150);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  expect((await page.locator('.native-piano-scroll').boundingBox()).width).toBeLessThanOrEqual(viewport.width);
  await page.screenshot({path:test.info().outputPath(`japanese-syllables-${name}.png`)});
  await search.press('ArrowDown');await expect(choice).toBeFocused();await choice.press('Enter');
  await expect(summary).toContainText('shi · し');expect((await capture(page)).scene.input.notes[0].lyric).toBe('し');await expect(lyric).toBeHidden();
  await summary.click();await search.fill('Custom');await picker.getByRole('button',{name:'Custom lyric…',exact:true}).click();await expect(lyric).toBeFocused();
  const custom='かきくけこさしすせそ';await lyric.fill(custom);expect((await capture(page)).scene.input.notes[0].lyric).toBe(custom);
  // A copied note gets its own popup field; the source lyric remains authored.
  await page.getByRole('button',{name:'Add note',exact:true}).click();await expect(page.getByRole('textbox',{name:'Note 2 kana syllable',exact:true})).toHaveValue(custom);await expect(summary).toContainText('Custom lyric…');
  const rowCount=await page.locator('.native-timeline-note').count();await expect(page.locator('[data-note-handle="1"]')).toBeFocused();await page.getByRole('button',{name:'Remove selected note',exact:true}).click();
  expect(await page.locator('.native-timeline-note').count()).toBe(rowCount-1);expect((await capture(page)).scene.input.notes[0].lyric).toBe(custom);await expect(page.locator('[data-note-handle="1"]')).toBeFocused();
  await summary.click();await expect(lyric).toHaveValue(custom);await search.fill('ka ·');await picker.getByRole('button',{name:'ka · か',exact:true}).click();expect((await capture(page)).scene.input.notes[0].lyric).toBe('か');await expect(lyric).toBeHidden();
  await page.locator('#audioButton').scrollIntoViewIfNeeded();await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','false');expect(await page.evaluate(()=>window.__voiceWorkers.length)).toBe(0);
 }finally{await context.close();}
});

test('Japanese syllable selection reaches native singing and follows preset recall',async({page})=>{
 await observe(page);await page.goto('voicesaurus.html');await startLoop(page,'sinsy');
 const picker=page.locator('[data-select-id="native-syllable-0"]');await picker.locator('summary').click();await picker.getByRole('searchbox').fill('tsu');await picker.getByRole('button',{name:'tsu · つ',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>window.__voiceRequests.at(-1)?.input.notes[0].lyric)).toBe('つ');await ready(page);await expect(page.locator('#audioError')).toBeHidden();
 expect((await signal(page,1200)).peak).toBeGreaterThan(.0005);
 const presets=await page.evaluate(async()=>(await import('./src/instruments/voicesaurus/native-model.js')).presets.filter(p=>p.snapshot.engine==='sinsy'));
 expect(presets.length).toBeGreaterThan(0);
 await page.locator('#nativePlay').click();await page.locator('#audioButton').click();
 for(const preset of presets){
  await page.locator(`[data-preset-id="${preset.id}"]`).evaluate(el=>el.click());await expect(page.locator('.header-preset-controls')).not.toHaveAttribute('aria-busy','true');
  for(const[noteIndex,note]of preset.snapshot.input.notes.entries()){
   const field=page.locator(`#native-syllable-${noteIndex}`);const known=await field.locator('option').evaluateAll((options,lyric)=>options.some(option=>option.value===lyric),note.lyric);
   await expect(field).toHaveValue(known?note.lyric:'__custom__');
  }
 }
});

test('Audio off keeps native input editing and presets local',async({page})=>{
 await observe(page);const wasm=[];page.on('request',r=>{if(r.url().endsWith('.wasm'))wasm.push(r.url());});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('voicesaurus.html');await expect(page.locator('#voiceMethod')).toHaveValue('espeak');
 const prose='Keep this native phrase, punctuation and question?';await page.locator('#nativeText').fill(prose);
 await select(page,'singer');await expect(page.locator('#nativeText')).toBeHidden();await expect(page.locator('#nativePhone option')).toHaveCount(71);await expect(page.locator('#nativePhone option[value=open]')).toHaveCount(1);
 await page.locator('#nativePhone').selectOption('rr2',{force:true});const oldPitch=(await capture(page)).scene.values.pitch;await page.locator('[data-note-handle="0"]').press('ArrowUp');expect((await capture(page)).scene.input.phrase.notes[0].values.pitch).toBeCloseTo(oldPitch*2**(1/12));expect((await capture(page)).scene.values.pitch).toBe(oldPitch);
 await page.locator('#nativePlay').click();await page.locator('.header-preset-next').click();await ready(page);
 await select(page,'stk-voicform');await expect(page.locator('#nativePhone option')).toHaveCount(32);
 await select(page,'mea8000');await expect(page.locator('#nativeText')).toBeHidden();await expect(page.locator('#nativePhoneField')).toBeHidden();
 await select(page,'vizsn');await expect(page.locator('#nativeInputLabel')).toContainText('Native');await page.locator('#nativeText').fill('a oe u');
 await select(page,'espeak');await expect(page.locator('#nativeText')).toHaveValue(prose);await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','false');
 expect(await page.evaluate(()=>window.__voiceWorkers.length)).toBe(0);expect(wasm).toEqual([]);expect(errors).toEqual([]);
});

test('Each actual engine plays its own native input and preserves the common prose',async({page})=>{
 test.setTimeout(180000);await observe(page);const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('voicesaurus.html');
 const prose='Daisy, answer me. The quick brown fox can sing.';await page.locator('#nativeText').fill(prose);await startLoop(page,'singer');
 const ids=await page.evaluate(async()=>Object.keys((await import('./src/instruments/voicesaurus/native-model.js')).NATIVE_METHODS));
 for(const engine of ids){await select(page,engine);await expect(page.locator('#nativePlay')).toHaveAttribute('aria-pressed','true');await expect(page.locator('#nativeLoop')).toHaveAttribute('aria-pressed','true');await expect(page.locator('#audioError')).toBeHidden();const sound=await signal(page,1100);expect(sound.finite,engine).toBe(true);expect(sound.peak,engine).toBeGreaterThan(.0005);expect(sound.clipped,engine).toBe(false);await expect(page.locator('#level')).toHaveValue('0.46');}
 await select(page,'espeak');await expect(page.locator('#nativeText')).toHaveValue(prose);
 const requests=await page.evaluate(()=>window.__voiceRequests);expect(requests.some(r=>r.engine==='espeak'&&r.text===prose)).toBe(true);expect(requests.some(r=>r.engine==='singer'&&r.input.phone==='ahh')).toBe(true);
 expect(await page.evaluate(()=>window.__voiceWorkers.every(w=>w.url.includes('/native-worker.js')&&w.killed===1))).toBe(true);expect(errors).toEqual([]);
});

test('One Trigger or From start action creates one audible source',async({page})=>{
 await observe(page);await page.goto('voicesaurus.html');await startLoop(page);
 for(const selector of ['#nativeAudition','#nativeRestart']){await page.evaluate(()=>window.__sourceStarts=[]);await page.locator(selector).click();await ready(page);await page.waitForTimeout(100);const starts=await page.evaluate(()=>window.__sourceStarts.filter(s=>s.length>1));expect(starts,selector).toHaveLength(1);expect(starts[0].offset,selector).toBe(0);}
});

test('Native coefficient editing activates the correct overrides while looping',async({page})=>{
 await observe(page);await page.goto('voicesaurus.html');await startLoop(page);const before=await capture(page);
 await page.locator('#nativeParameters > details').filter({has:page.locator('summary',{hasText:'Experimental'})}).evaluate(el=>el.open=true);
 await setKnob(page,'radius1',1.1);let after=await capture(page);expect(after.scene.values.customShape).toBe(true);expect(after.play).toBe('true');expect(after.loop).toBe(before.loop);expect(after.level).toBe(before.level);await expect(page.locator('#audioError')).toBeHidden();
 await setKnob(page,'glottisA',.4);after=await capture(page);expect(after.scene.values.customGlottis).toBe(true);await expect(page.locator('#audioError')).toBeHidden();
 await select(page,'stk-voicform');await page.locator('#nativeParameters > details').filter({has:page.locator('summary',{hasText:'Experimental'})}).evaluate(el=>el.open=true);await setKnob(page,'formant1',1100);after=await capture(page);expect(after.scene.values.customFormants).toBe(true);expect(after.scene.values.formant1).toBe(1100);expect((await signal(page)).peak).toBeGreaterThan(.0005);
});

test('Pause and Audio off cancel pending native rendering; failed preset restores its scene',async({page})=>{
 await observe(page);await page.goto('voicesaurus.html');await select(page,'singer');await page.locator('#audioButton').click();await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','true');
 await page.evaluate(()=>window.__holdVoice=true);await page.locator('#nativePlay').click();await expect(page.locator('#nativeStatus')).toHaveText('Rendering voice…');await page.locator('#nativePlay').click();await page.waitForTimeout(150);expect(await page.evaluate(()=>window.__voiceWorkers.every(w=>w.killed===1))).toBe(true);await expect(page.locator('#nativePlay')).toHaveAttribute('aria-pressed','false');
 await page.locator('#nativeAudition').click();await expect(page.locator('#nativeStatus')).toHaveText('Rendering voice…');await page.locator('#audioButton').click();await ready(page);await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','false');expect(await page.evaluate(()=>window.__voiceWorkers.every(w=>w.killed===1))).toBe(true);
 await page.evaluate(()=>window.__holdVoice=false);await page.locator('#audioButton').click();await page.locator('#nativeLoop').click();await page.locator('#nativePlay').click();await ready(page);const before=await capture(page);
 await page.evaluate(()=>window.__failVoiceOnce=true);await page.locator('.header-preset-next').click();await expect(page.locator('.header-preset-controls')).not.toHaveAttribute('aria-busy','true');await ready(page);const after=await capture(page);expect(after.scene).toEqual(before.scene);expect(after.loop).toEqual(before.loop);expect(after.level).toEqual(before.level);expect((await signal(page)).peak).toBeGreaterThan(.0005);
});

for(const[name,viewport]of Object.entries({portrait:{width:390,height:844},landscape:{width:844,height:390}}))test(`Native controls, transport and three monitors remain reachable on ${name}`,async({browser,baseURL})=>{
 const context=await browser.newContext({viewport,hasTouch:true,isMobile:true,baseURL});const page=await context.newPage();await page.goto('voicesaurus.html');await select(page,'singer');
 for(const id of ['voiceWave','voiceSpectrum','voiceSpectrogram']){await page.locator('#'+id).scrollIntoViewIfNeeded();await expect(page.locator('#'+id)).toBeVisible();const b=await page.locator('#'+id).boundingBox();expect(b.width).toBeGreaterThan(80);expect(b.height).toBeGreaterThan(70);}
 await page.locator('#nativeParameters > details').filter({has:page.locator('summary',{hasText:'Experimental'})}).evaluate(el=>el.open=true);await page.locator('#param-glottisB').scrollIntoViewIfNeeded();await expect(page.locator('#param-glottisB')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);for(const id of ['audioButton','nativePlay']){const b=await page.locator('#'+id).boundingBox();expect(b.width,id).toBeGreaterThanOrEqual(48);expect(b.height,id).toBeGreaterThanOrEqual(48);}
 await page.screenshot({path:test.info().outputPath(`voicesaurus-native-${name}.png`)});await context.close();
});


test('Every factory preset recalls native values and exposes sound controls plus note geometry with Audio off',async({page})=>{
 test.setTimeout(120000);await observe(page);await page.goto('voicesaurus.html');
 const presets=await page.evaluate(async()=>(await import('./src/instruments/voicesaurus/native-model.js')).presets);const mismatches=[];
 for(const preset of presets){
  await selectModeFor(page,preset.snapshot.engine);
  await page.locator(`[data-preset-id="${preset.id}"]`).evaluate(el=>el.click());
  await expect(page.locator('.header-preset-controls')).not.toHaveAttribute('aria-busy','true');
  const singing=await page.evaluate(async engine=>(await import('./src/instruments/voicesaurus/native-singing-model.js')).isSingingEngine(engine),preset.snapshot.engine);
  if(singing)await selectVoiceNote(page,0);
  const rendered=await page.evaluate(async()=>{
   const state=(await import('./src/site/header-presets.js')).captureHeaderPresetState().snapshot;
   const {isSingingEngine,editableNote,singingNoteDescriptors}=await import('./src/instruments/voicesaurus/native-singing-model.js');
   const note=isSingingEngine(state)?editableNote(state,0):state;
   const fields=selector=>Object.fromEntries([...document.querySelectorAll(selector+' [data-param]')].map(el=>[el.dataset.param,{value:el.value,type:el.type,knob:Boolean(el.closest('.mz-range-knob')),toggle:Boolean(el.closest('.is-toggle')),pressed:el.closest('.is-toggle')?.querySelector('[aria-pressed="true"]')?.value,groupOpen:el.closest('details').open}]));
   return {state,values:note.values,notes:isSingingEngine(state)?singingNoteDescriptors(state).map(note=>({pitch:note.pitch,beats:note.beats})):null,
    globalFields:fields('#nativeParameters'),noteFields:fields('.native-note-parameters'),ids:[...document.querySelectorAll('[data-param]')].map(el=>el.id),phone:document.querySelector('#nativePhone').value};
  });
  expect(rendered.state,preset.id).toEqual(preset.snapshot);
  expect(new Set(rendered.ids).size,preset.id).toBe(rendered.ids.length);
  if(singing){expect(rendered.notes.length).toBeGreaterThan(0);await expect(page.locator('.native-timeline-note')).toHaveCount(rendered.notes.length);await expect(page.locator('#param-pitch,#param-duration')).toHaveCount(0);}
  const scopes=[[rendered.globalFields,rendered.state.values],...(singing&&preset.snapshot.engine!=='sinsy'?[[rendered.noteFields,rendered.values]]:[])];
  for(const [fields,values]of scopes){
   const exposed=Object.entries(values).filter(([key])=>!singing||!['pitch','duration'].includes(key));
   expect(Object.keys(fields).sort(),preset.id).toEqual(exposed.map(([key])=>key).sort());
   for(const[key,value]of exposed){const field=fields[key];expect(field.groupOpen,preset.id+':'+key).toBe(true);if(field.toggle){expect(field.type,preset.id+':'+key).toBe('hidden');expect(field.pressed,preset.id+':'+key).toBe(String(value));}else if(typeof value==='number'){expect(field.type,preset.id+':'+key).toBe('range');expect(field.knob,preset.id+':'+key).toBe(true);if(Math.abs(Number(field.value)-value)>1e-6)mismatches.push({preset:preset.id,key,expected:value,actual:Number(field.value)});}else expect(field.value,preset.id+':'+key).toBe(String(value));}
  }
  if(preset.snapshot.input.phone)expect(rendered.phone,preset.id).toBe(preset.snapshot.input.phone);
 }
 console.log(JSON.stringify({factoryCount:presets.length,mismatches}));expect(mismatches).toEqual([]);
 expect(await page.evaluate(()=>window.__voiceWorkers.length)).toBe(0);
});

for(const[name,viewport]of Object.entries({desktop:{width:1440,height:900},portrait:{width:390,height:844},landscape:{width:844,height:390}}))test(`First native knobs are immediately visible below the method picker on ${name}`,async({page})=>{
 await page.setViewportSize(viewport);await page.goto('voicesaurus.html');await expect(page.locator('#param-rate')).toBeAttached();
 const bounds=await page.evaluate(()=>{const panel=document.querySelector('.voicesaurus-panel'),param=document.querySelector('#nativeParameters .native-param'),picker=document.querySelector('[data-select-id=voiceMethod]');return{panel:panel.getBoundingClientRect().toJSON(),param:param.getBoundingClientRect().toJSON(),picker:picker.getBoundingClientRect().toJSON(),scroll:panel.scrollTop,height:innerHeight};});
 expect(bounds.scroll).toBe(0);expect(bounds.picker.height).toBeLessThan(80);expect(bounds.param.top).toBeGreaterThan(bounds.picker.bottom);expect(bounds.param.bottom).toBeLessThanOrEqual(Math.min(bounds.panel.bottom,bounds.height));
});


test('Numeric sound parameters reach their gesture bounds and binary native choices use typed buttons',async({page})=>{
 test.setTimeout(180000);await observe(page);await page.goto('voicesaurus.html');
 const methods=await page.evaluate(async()=>Object.fromEntries(Object.entries((await import('./src/instruments/voicesaurus/native-model.js')).NATIVE_METHODS).map(([id,spec])=>[id,spec.controls])));
 const failures=[];let count=0,toggleCount=0;
 for(const[engine,controls]of Object.entries(methods)){
  await select(page,engine);
  const singing=await page.evaluate(async engine=>(await import('./src/instruments/voicesaurus/native-singing-model.js')).isSingingEngine(engine),engine);
  for(const[key,rule]of Object.entries(controls)){
   if(singing&&['pitch','duration'].includes(key)){await expect(page.locator(`#param-${key}`)).toHaveCount(0);continue;}
   if(rule.freeText)continue;
   const field=page.locator(`#param-${key}`);
   if(await field.evaluate(el=>!!el.closest('.native-note-editor'))&&!await page.locator('.native-note-editor').isVisible())await selectVoiceNote(page,0);
   if(rule.choices?.length===2){
    await expect(field).toHaveAttribute('type','hidden');
    const group=field.locator('..').getByRole('group',{name:rule.label,exact:true});
    for(const value of rule.choices){await group.getByRole('button',{name:typeof value==='boolean'?(value?'On':'Off'):String(value).replaceAll('_',' '),exact:true}).click();await expect(field).toHaveValue(String(value));await expect(group.locator(`[aria-pressed="true"]`)).toHaveAttribute('value',String(value));
      const actual=await page.evaluate(async key=>(await import('./src/site/header-presets.js')).captureHeaderPresetState().snapshot.values[key],key);expect(actual).toBe(value);
    }
    toggleCount++;continue;
   }
   if(rule.choices?.some(v=>typeof v!=='number'))continue;
   const min=rule.choices?Math.min(...rule.choices):(rule.dragMin??rule.min),max=rule.choices?Math.max(...rule.choices):(rule.dragMax??rule.max);
   const actual=await field.evaluate(el=>({type:el.type,knob:Boolean(el.closest('.mz-range-knob')),min:Number(el.dataset.dragMin??el.min),max:Number(el.dataset.dragMax??el.max)}));
   expect(actual,engine+':'+key).toEqual({type:'range',knob:true,min,max});
   await field.focus();await field.press('Home');let value=Number(await field.inputValue());if(Math.abs(value-min)>1e-9)failures.push({engine,key,end:'min',expected:min,actual:value});
   await field.press('End');value=Number(await field.inputValue());if(Math.abs(value-max)>1e-9)failures.push({engine,key,end:'max',expected:max,actual:value});
   count++;
  }
 }
 console.log(JSON.stringify({numericControls:count,binaryControls:toggleCount,endpointFailures:failures}));expect(failures).toEqual([]);expect(toggleCount).toBeGreaterThan(0);expect(await page.evaluate(()=>window.__voiceWorkers.length)).toBe(0);
});


test('Exact numeric entry reaches the native worker while knob gestures keep fixed bounds',async({page})=>{
 await observe(page);await page.goto('voicesaurus.html');await select(page,'singer');
 const pitch=page.locator('#param-jitterRate'),readout=page.locator('label[for="param-jitterRate"] output');
 const bounds=await pitch.evaluate(el=>({min:Number(el.dataset.dragMin),max:Number(el.dataset.dragMax)}));
 const exact=12345.678901;
 await readout.click();await page.getByRole('textbox',{name:'Exact Random pitch update rate',exact:true}).fill(String(exact));await page.getByRole('textbox',{name:'Exact Random pitch update rate',exact:true}).press('Enter');
 expect(Number(await pitch.inputValue())).toBe(exact);expect((await capture(page)).scene.values.jitterRate).toBe(exact);
 expect(await pitch.evaluate(el=>({min:Number(el.dataset.dragMin),max:Number(el.dataset.dragMax)}))).toEqual(bounds);
 // Taking hold does not silently replace an exact request with its nearest endpoint.
 await pitch.click();expect(Number(await pitch.inputValue())).toBe(exact);
 await page.evaluate(()=>window.__holdVoice=true);await page.locator('#audioButton').click();await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','true');await page.locator('#nativePlay').click();
 await expect.poll(()=>page.evaluate(()=>window.__voiceRequests.at(-1)?.values.jitterRate)).toBe(exact);await page.locator('#nativePlay').click();await expect(page.locator('#nativePlay')).toHaveAttribute('aria-pressed','false');
 await readout.click();await page.getByRole('textbox',{name:'Exact Random pitch update rate',exact:true}).fill('-33.25');await page.getByRole('textbox',{name:'Exact Random pitch update rate',exact:true}).press('Enter');
 expect(Number(await pitch.inputValue())).toBe(-33.25);expect((await capture(page)).scene.values.jitterRate).toBe(-33.25);
 await pitch.click();expect(Number(await pitch.inputValue())).toBe(-33.25);
 await pitch.press('End');expect(Number(await pitch.inputValue())).toBe(bounds.max);
 const box=await pitch.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2,box.y+box.height/2-100,{steps:5});await page.mouse.up();
 expect(Number(await pitch.inputValue())).toBe(bounds.max);await pitch.press('ArrowRight');expect(Number(await pitch.inputValue())).toBe(bounds.max);
 await pitch.press('Home');expect(Number(await pitch.inputValue())).toBe(bounds.min);await pitch.press('ArrowLeft');expect(Number(await pitch.inputValue())).toBe(bounds.min);
 expect(await pitch.evaluate(el=>({min:Number(el.dataset.dragMin),max:Number(el.dataset.dragMax)}))).toEqual(bounds);
 await page.locator('#audioButton').click();await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','false');
});


test('Space edits an exact readout or toggles a parameter group without playing',async({page})=>{
 await page.goto('voicesaurus.html');await select(page,'singer');
 const output=page.locator('label[for="param-jitterRate"] output');await output.focus();await output.press('Space');await expect(page.getByRole('textbox',{name:'Exact Random pitch update rate',exact:true})).toBeVisible();await expect(page.locator('#nativePlay')).toHaveAttribute('aria-pressed','false');
 await page.getByRole('textbox',{name:'Exact Random pitch update rate',exact:true}).press('Escape');const group=page.locator('#nativeParameters > details').first();await group.locator(':scope > summary').focus();await group.locator(':scope > summary').press('Space');await expect(page.locator('#nativePlay')).toHaveAttribute('aria-pressed','false');
});

test('Pausing in a suspended context disconnects its source immediately',async({page})=>{
 await page.goto('voicesaurus.html');const result=await page.evaluate(async()=>{
  const{NativeVoiceAudio}=await import('./src/instruments/voicesaurus/native-audio.js');const audio=new NativeVoiceAudio();let disconnected=0;
  try{await audio.enable();audio.buffer=audio.context.createBuffer(1,22050,22050);audio.setLoop(true);audio.play();await audio.context.suspend();const source=audio.source,disconnect=source.disconnect.bind(source);source.disconnect=(...args)=>{disconnected++;return disconnect(...args);};audio.pause();return{disconnected,playing:audio.playing,state:audio.context.state};}
  finally{await audio.close();}
 });expect(result.playing).toBe(false);expect(result.state).toBe('suspended');expect(result.disconnected).toBeGreaterThan(0);
});


test('Selecting the next preset auditions exactly once from the beginning',async({page})=>{
 await observe(page);await page.goto('voicesaurus.html');await startLoop(page,'singer');await page.waitForTimeout(250);await page.evaluate(()=>window.__sourceStarts=[]);await page.locator('.header-preset-next').click();await expect(page.locator('.header-preset-controls')).not.toHaveAttribute('aria-busy','true');await ready(page);await page.waitForTimeout(50);const starts=await page.evaluate(()=>window.__sourceStarts.filter(s=>s.length>1));expect(starts).toHaveLength(1);expect(starts[0].offset).toBe(0);
});
