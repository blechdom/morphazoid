import {test,expect} from '@playwright/test';

async function scene(page){return page.evaluate(async()=>(await import('./src/site/header-presets.js')).captureHeaderPresetState().snapshot);}
async function choose(page,engine){await page.locator('[data-voice-mode="singing"]').click();await page.locator('#voiceMethod').selectOption(engine,{force:true});await expect(page.locator('.native-timeline-note').first()).toBeAttached();}
async function knob(page,label,value){const output=page.getByRole('button',{name:`Enter exact ${label} value`,exact:true});await output.click();const input=page.getByRole('textbox',{name:`Exact ${label}`,exact:true});await input.fill(String(value));await input.press('Enter');}
async function parameter(page,key,value){await page.locator('#param-'+key).evaluate((input,value)=>{input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));},value);}
async function ready(page){await expect(page.locator('#nativeStatus')).not.toHaveText('Rendering voice…');await expect(page.locator('#audioError')).toBeHidden();}
async function observe(page){await page.addInitScript(()=>{
 const Original=window.Worker;window.voiceRequests=[];window.voiceWorkers=[];window.holdVoice=false;window.voiceStarts=[];
 window.Worker=class extends Original{constructor(...args){super(...args);window.voiceWorkers.push(this);this.killed=false;}postMessage(request,...rest){window.voiceRequests.push(structuredClone(request));if(!window.holdVoice)super.postMessage(request,...rest);}terminate(){this.killed=true;super.terminate();}};
 const start=AudioBufferSourceNode.prototype.start;AudioBufferSourceNode.prototype.start=function(...args){window.voiceStarts.push({length:this.buffer?.length,loop:this.loop,offset:args[1]??0});return Reflect.apply(start,this,args);};
});}

test('each musical note retains independent native settings while tempo preserves its beat length',async({page})=>{
 await observe(page);await page.goto('voicesaurus.html');await choose(page,'singer');const original=(await scene(page)).values;
 await page.getByRole('button',{name:'Add note',exact:true}).click();await expect(page.locator('.native-timeline-note')).toHaveCount(2);
 await parameter(page,'pitch',333);await parameter(page,'radius1',1.1);
 let state=await scene(page);expect(state.input.phrase.notes[1].values.pitch).toBe(333);expect(state.input.phrase.notes[1].values.radius1).toBe(1.1);expect(state.input.phrase.notes[0].values).toEqual(original);
 await page.locator('[data-note-handle="0"]').click();await expect(page.locator('#param-pitch')).toHaveValue(String(original.pitch));
 await page.locator('[data-note-handle="1"]').click();await expect(page.locator('#param-pitch')).toHaveValue('333');
 const before=(await scene(page)).input.phrase;await knob(page,'Tempo',240);state=await scene(page);
 expect(state.input.phrase.tempo).toBe(240);for(let i=0;i<2;i++){expect(state.input.phrase.notes[i].values.duration).toBe(before.notes[i].values.duration/2);expect(state.input.phrase.notes[i].values.release).toBe(before.notes[i].values.release);}
 await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','false');expect(await page.evaluate(()=>voiceRequests.length)).toBe(0);
});

test('Sinsy note gestures and aligned knobs update native pitch and time with recoverable rest editing',async({page})=>{
 await page.goto('voicesaurus.html');await choose(page,'sinsy');
 const pitch=page.getByRole('slider',{name:'Note 1 pitch',exact:true}),box=await pitch.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2,box.y+box.height/2-13,{steps:4});await page.mouse.up();expect(Number.isInteger((await scene(page)).input.notes[0].midi)).toBe(true);
 const before=(await scene(page)).input.notes[0];const resize=page.getByRole('button',{name:'Resize note 1',exact:true}),edge=await resize.boundingBox();await page.mouse.move(edge.x+edge.width/2,edge.y+edge.height/2);await page.mouse.down();await page.mouse.move(edge.x+edge.width/2+60,edge.y+edge.height/2,{steps:5});await page.mouse.up();expect((await scene(page)).input.notes[0].beats).toBeCloseTo(before.beats+.5,5);
 const handle=page.locator('[data-note-handle="0"]');await handle.focus();await handle.press('ArrowUp');expect((await scene(page)).input.notes[0].midi).toBe(before.midi+1);
 const noteBounds=await page.locator('[data-note-index="0"].native-timeline-note').boundingBox(),editorBounds=await page.locator('.native-note-editor').boundingBox();expect(Math.abs(noteBounds.x-editorBounds.x)).toBeLessThan(2);expect(editorBounds.y).toBeGreaterThan(noteBounds.y);
 const rest=page.getByRole('checkbox',{name:'Note 1 rest',exact:true});await rest.check();await expect(page.getByRole('button',{name:'Audition selected note',exact:true})).toBeDisabled();await rest.uncheck();await expect(page.getByRole('button',{name:'Audition selected note',exact:true})).toBeEnabled();
});

test('vowel knobs follow the selected note and forward its independent native parameters',async({page})=>{
 await observe(page);await page.goto('voicesaurus.html');
 for(const [engine,key,value]of [['singer','radius1',1.2],['stk-voicform','formant1',900],['csound-fof','formant1',1100],['csound-vosim','formant1',1300]]){
  await choose(page,engine);const original=(await scene(page)).values;
  await page.getByRole('button',{name:'Add note',exact:true}).click();
  const editor=page.locator('.native-note-editor');await expect(editor).toHaveAttribute('data-note-index','1');
  await expect(editor.locator('#param-'+key)).toHaveCount(1);await expect(page.locator('#nativeParameters #param-'+key)).toHaveCount(0);
  await parameter(page,key,value);let state=await scene(page);expect(state.input.phrase.notes[1].values[key]).toBe(value);expect(state.input.phrase.notes[0].values).toEqual(original);
  await page.locator('[data-note-handle="0"]').click();await expect(editor).toHaveAttribute('data-note-index','0');await expect(editor.locator('#param-'+key)).toHaveValue(String(original[key]));
  if(engine==='stk-voicform'){
   await page.locator('#native-syllable-0').selectOption('eee',{force:true});
   const expected=await page.evaluate(async()=>(await import('./src/families/speech/native-musical-controls.js')).nativeMusicalDefaults('stk-voicform',{phone:'eee'}));
   await expect(editor.locator('#param-formant1')).toHaveValue(String(expected.formant1));
  }
  await page.locator('[data-note-handle="1"]').click();await expect(editor.locator('#param-'+key)).toHaveValue(String(value));
 }
 await page.evaluate(()=>holdVoice=true);await page.locator('#audioButton').click();await page.getByRole('button',{name:'Audition selected note',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>voiceRequests.at(-1)?.values.formant1)).toBe(1300);await page.locator('#nativePlay').click();
});

test('short notes never overlap and pitch and vowel transition times remain independent',async({page})=>{
 await page.goto('voicesaurus.html');await choose(page,'singer');await parameter(page,'duration',.0001);
 await page.getByRole('button',{name:'Add note',exact:true}).click();await page.getByRole('button',{name:'Add note',exact:true}).click();await parameter(page,'duration',2);
 const bounds=await page.locator('.native-timeline-note').evaluateAll(notes=>notes.map(note=>{const b=note.getBoundingClientRect();return{left:b.left,right:b.right};}));
 for(let i=1;i<bounds.length;i++)expect(bounds[i-1].right).toBeLessThanOrEqual(bounds[i].left+.001);
 await knob(page,'Pitch portamento',.17);await knob(page,'Vowel transition',.32);
 let state=await scene(page);expect(state.input.phrase.pitchPortamento).toBe(.17);expect(state.input.phrase.vowelPortamento).toBe(.32);
 await knob(page,'Pitch portamento',4);const pitch=page.getByRole('slider',{name:'Pitch portamento',exact:true});await expect(pitch).toHaveAttribute('data-drag-max','2');
 state=await scene(page);expect(state.input.phrase.pitchPortamento).toBe(4);expect(state.input.phrase.vowelPortamento).toBe(.32);
 await pitch.press('End');expect((await scene(page)).input.phrase.pitchPortamento).toBe(2);
 await knob(page,'Pitch portamento',-.5);await expect(pitch).toHaveValue('2');expect((await scene(page)).input.phrase.pitchPortamento).toBe(2);await expect(page.locator('#audioError')).toContainText('nonnegative');
 await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','false');
});

test('selecting another note commits an exact vowel edit to its original note',async({page})=>{
 await page.goto('voicesaurus.html');await choose(page,'singer');const original=(await scene(page)).values.radius1;
 await page.getByRole('button',{name:'Add note',exact:true}).click();
 await page.getByRole('button',{name:'Enter exact Tract radius 1 value',exact:true}).click();await page.getByRole('textbox',{name:'Exact Tract radius 1',exact:true}).fill('1.234');
 await page.locator('[data-note-handle="0"]').click();const notes=(await scene(page)).input.phrase.notes;
 expect(notes[0].values.radius1).toBe(original);expect(notes[1].values.radius1).toBe(1.234);await expect(page.locator('[data-note-handle="0"]')).toBeFocused();
});

test('the browser renders native note transitions into one source with disjoint note slots',async({page})=>{
 test.setTimeout(60000);await observe(page);
 await page.addInitScript(()=>{const Base=window.Worker;window.voiceResults=[];window.Worker=class extends Base{constructor(...args){super(...args);this.addEventListener('message',({data})=>{if(data.type==='ready')window.voiceResults.push({timings:data.noteTimings,basis:data.timingBasis,peak:data.samples.reduce((peak,value)=>Math.max(peak,Math.abs(value)),0),finite:data.samples.every(Number.isFinite)});});}};});
 await page.goto('voicesaurus.html');
 for(const engine of ['singer','stk-voicform','csound-fof','csound-vosim']){
  await choose(page,engine);await parameter(page,'duration',.2);await page.getByRole('button',{name:'Add note',exact:true}).click();await parameter(page,'pitch',330);
  await parameter(page,engine==='singer'?'radius1':'formant1',engine==='singer'?1.2:1100);
  await knob(page,'Pitch portamento',.2);await knob(page,'Vowel transition',.3);
  await page.evaluate(()=>{voiceResults=[];voiceStarts=[];});await page.locator('#audioButton').click();await page.locator('#nativePlay').click();await ready(page);
  const result=await page.evaluate(()=>voiceResults.at(-1));expect(result.basis,engine).toBe('native-note-slots');expect(result.finite,engine).toBe(true);expect(result.peak,engine).toBeGreaterThan(.001);
  expect(result.timings).toHaveLength(2);expect(result.timings[0].releaseEnd).toBeLessThanOrEqual(result.timings[1].start);expect(result.timings[0].end).toBeCloseTo(.2,5);
  expect(await page.evaluate(()=>voiceStarts.filter(start=>start.length>1).length),engine).toBe(1);
  const request=await page.evaluate(()=>voiceRequests.at(-1));expect(request.input.phrase.pitchPortamento).toBe(.2);expect(request.input.phrase.vowelPortamento).toBe(.3);
  await page.locator('#audioButton').click();
 }
});

test('horizontal note movement preserves zero Hz, and extreme native requests cannot trap preset recovery',async({page})=>{
 await page.goto('voicesaurus.html');await choose(page,'singer');await knob(page,'Pitch',0);await page.getByRole('button',{name:'Add note',exact:true}).click();await parameter(page,'pitch',333);
 await page.locator('[data-note-handle="0"]').click();const box=await page.locator('[data-note-handle="0"]').boundingBox();await page.mouse.move(box.x+20,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+510,box.y+box.height/2,{steps:8});await page.mouse.up();
 let state=await scene(page);expect(state.input.phrase.notes.map(note=>note.values.pitch)).toEqual([333,0]);
 await knob(page,'Note duration',1e308);expect((await scene(page)).input.phrase.notes[1].values.duration).toBe(1e308);await page.locator('.header-preset-next').click();await expect(page.locator('.header-preset-controls')).not.toHaveAttribute('aria-busy','true');
 await choose(page,'sinsy');const preset=await page.evaluate(async()=>(await import('./src/instruments/voicesaurus/native-model.js')).presets.find(p=>p.snapshot.engine==='sinsy'&&p.snapshot.input.notes.length===1));
 await page.locator(`[data-preset-id="${preset.id}"]`).evaluate(button=>button.click());await page.getByRole('checkbox',{name:'Note 1 rest',exact:true}).check();await page.locator('.header-preset-next').click();await expect(page.locator('.header-preset-controls')).not.toHaveAttribute('aria-busy','true');expect((await scene(page)).input.notes.some(note=>!note.rest&&note.midi!==null)).toBe(true);
});

test('selected-note audition is a single native render and preserves the complete looping phrase',async({page})=>{
 await observe(page);await page.goto('voicesaurus.html');await choose(page,'singer');await parameter(page,'duration',.3);await page.getByRole('button',{name:'Add note',exact:true}).click();await parameter(page,'duration',.4);await parameter(page,'pitch',330);
 await page.locator('#nativeLoop').click();await page.locator('#audioButton').click();await page.locator('#nativePlay').click();await ready(page);await expect(page.locator('#nativePlay')).toHaveAttribute('aria-pressed','true');
 const phraseStart=await page.evaluate(()=>voiceStarts.filter(start=>start.length>1).at(-1));await page.locator('#nativePlay').click();await page.evaluate(()=>voiceStarts=[]);
 await page.getByRole('button',{name:'Audition selected note',exact:true}).click();await ready(page);await expect.poll(()=>page.evaluate(()=>voiceStarts.filter(start=>start.length>1).length)).toBe(1);
 const audition=await page.evaluate(()=>({start:voiceStarts.filter(start=>start.length>1).at(-1),request:voiceRequests.at(-1)}));expect(audition.start.loop).toBe(false);expect(audition.request.values.pitch).toBe(330);expect(audition.request.input.phrase).toBeUndefined();expect(audition.start.length).toBeLessThan(phraseStart.length);
 await expect(page.locator('#nativePlay')).toHaveAttribute('aria-pressed','false');await expect(page.locator('#nativeLoop')).toHaveAttribute('aria-pressed','true');
 await page.evaluate(()=>voiceStarts=[]);await page.locator('#nativeRestart').click();await ready(page);const resumed=await page.evaluate(()=>voiceStarts.filter(start=>start.length>1));expect(resumed).toHaveLength(1);expect(resumed[0].length).toBe(phraseStart.length);expect(resumed[0].loop).toBe(true);expect((await scene(page)).input.phrase.notes).toHaveLength(2);
 await expect(page.locator('.native-score-playhead')).toBeVisible();
});

test('editing then pausing a pending note audition cancels stale output and clears its transport state',async({page})=>{
 await observe(page);await page.goto('voicesaurus.html');await choose(page,'singer');await page.locator('#audioButton').click();await page.evaluate(()=>holdVoice=true);await page.getByRole('button',{name:'Audition selected note',exact:true}).click();await expect(page.locator('#nativeStatus')).toHaveText('Rendering voice…');
 await parameter(page,'pitch',330);await expect.poll(()=>page.evaluate(()=>voiceWorkers[0].killed)).toBe(true);await expect.poll(()=>page.evaluate(()=>voiceRequests.length)).toBe(2);
 await page.locator('#nativePlay').click();await expect(page.locator('#nativePlay')).toHaveAttribute('aria-pressed','false');await page.waitForTimeout(400);expect(await page.evaluate(()=>voiceWorkers.every(worker=>worker.killed))).toBe(true);expect(await page.evaluate(()=>voiceStarts.filter(start=>start.length>1))).toEqual([]);
 await page.evaluate(()=>holdVoice=false);await page.locator('#nativePlay').click();await ready(page);await expect(page.locator('#nativePlay')).toHaveAttribute('aria-pressed','true');
});

for(const [name,viewport]of Object.entries({desktop:{width:1440,height:900},portrait:{width:390,height:844},landscape:{width:844,height:390}}))test(`singing note menus, piano roll, aligned editors and monitors are reachable on ${name}`,async({browser,baseURL})=>{
 const context=await browser.newContext({viewport,hasTouch:name!=='desktop',isMobile:name!=='desktop',baseURL});try{
  const page=await context.newPage();await page.goto('voicesaurus.html');await choose(page,'sinsy');const roll=page.locator('.native-piano-scroll');await roll.scrollIntoViewIfNeeded();await expect(roll).toBeVisible();
  expect((await roll.boundingBox()).width).toBeLessThanOrEqual(viewport.width);expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  const picker=page.locator('[data-select-id="native-syllable-0"]');await picker.locator('summary').click();await picker.getByRole('searchbox').fill('shi');await picker.getByRole('button',{name:'shi · し',exact:true}).click();expect((await scene(page)).input.notes[0].lyric).toBe('し');
  await page.locator('.native-note-editor').scrollIntoViewIfNeeded();await expect(page.getByRole('slider',{name:'Note 1 pitch',exact:true})).toBeVisible();await page.screenshot({path:test.info().outputPath(`singing-timeline-${name}.png`)});
  await choose(page,'stk-voicform');await page.locator('.native-note-editor #param-formant1').scrollIntoViewIfNeeded();await expect(page.locator('.native-note-editor #param-formant1')).toBeVisible();
  await page.screenshot({path:test.info().outputPath(`singing-formants-${name}.png`)});
  await page.locator('.native-note-editor #param-sweep4').scrollIntoViewIfNeeded();await expect(page.locator('.native-note-editor #param-sweep4')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  for(const id of ['voiceWave','voiceSpectrum','voiceSpectrogram']){await page.locator('#'+id).scrollIntoViewIfNeeded();await expect(page.locator('#'+id)).toBeVisible();}
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','false');
 }finally{await context.close();}
});
