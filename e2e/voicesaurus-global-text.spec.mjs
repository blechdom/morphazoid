import {test,expect} from '@playwright/test';
import {selectVoiceNote} from './voicesaurus-fixtures.mjs';
const capture=page=>page.evaluate(async()=>(await import('./src/site/header-presets.js')).captureHeaderPresetState().snapshot);
async function choose(page,engine){await page.locator('[data-voice-mode="singing"]').click();await page.locator('#voiceMethod').selectOption(engine,{force:true});}
async function parameter(page,id,value){await page.locator('#'+id).evaluate((input,value)=>{input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));},value);}
async function textPreset(page,id,text){await page.locator('#textPreset').selectOption(id,{force:true});await expect.poll(async()=>(await capture(page)).input.singingText).toBe(text);}

for(const engine of ['singer','stk-voicform','csound-fof','csound-vosim','sample-bank'])test(`${engine}: global knobs, note overrides and restored inheritance remain distinct`,async({page})=>{
 await page.goto('voicesaurus.html');await choose(page,engine);await textPreset(page,'love','i love you');
 const key=engine==='sample-bank'?'vibratoCents':'vibrato',a=engine==='sample-bank'?40:.08,b=engine==='sample-bank'?70:.17,local=engine==='sample-bank'?10:.02;
 const before=await capture(page);await parameter(page,'param-'+key,a);
 expect((await capture(page)).input.phrase.notes.every(note=>note.values[key]===a)).toBe(true);
 await selectVoiceNote(page,1);await parameter(page,'note-param-'+key,local);
 await expect(page.locator(`[data-override-param="${key}"]`)).toHaveAttribute('aria-pressed','true');
 await parameter(page,'param-'+key,b);let state=await capture(page);
 expect(state.values[key]).toBe(b);expect(state.input.phrase.notes[0].values[key]).toBe(b);expect(state.input.phrase.notes[1].values[key]).toBe(local);
 expect(state.input.phrase.notes.map(note=>[note.values.pitch,note.values.duration])).toEqual(before.input.phrase.notes.map(note=>[note.values.pitch,note.values.duration]));
 await page.locator(`[data-override-param="${key}"]`).click();await expect(page.locator('#note-param-'+key)).toHaveValue(String(b));
 expect((await capture(page)).input.phrase.notes[1].voiceOverrides).not.toContain(key);
 await page.getByRole('button',{name:'Use global voice for selected note',exact:true}).click();
 expect((await capture(page)).input.phrase.notes[1].voiceOverrides).toEqual([]);
 const ids=await page.locator('[data-param]').evaluateAll(fields=>fields.map(field=>field.id));expect(new Set(ids).size).toBe(ids.length);
 await expect(page.locator('#nativeSelectionLabel')).toContainText('Global voice');await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','false');
});

test('text presets insert exact speech or editable note contours using the native language menu',async({page})=>{
 await page.goto('voicesaurus.html');await page.locator('#textPreset').selectOption('consonants',{force:true});
 await expect(page.locator('#nativeText')).toHaveValue('pbpbpbpbpb shshshththththt s s s pl pl pl pl zzz gggg ghesghzhzhgh');
 await choose(page,'singer');const voice=(await capture(page)).values;
 for(const [id,text]of [['daisy','daisy daisy give me your answer please'],['moon','do you really want to go to the moon'],['love','i love you']]){
  await textPreset(page,id,text);const state=await capture(page);expect(state.values).toEqual(voice);
  const notes=state.input.phrase.notes;expect(new Set(notes.filter(note=>!note.rest).map(note=>note.values.pitch)).size).toBeGreaterThan(2);expect(new Set(notes.map(note=>note.values.duration)).size).toBeGreaterThan(1);
  await expect(page.locator('.native-timeline-note')).toHaveCount(notes.length);
 }
 await choose(page,'sinsy');expect(await page.locator('#textPreset option').evaluateAll(options=>options.filter(option=>option.value).every(option=>option.value.startsWith('jp-')))).toBe(true);
 await textPreset(page,'jp-sakura','sakura sakura');expect((await capture(page)).input.notes.filter(note=>!note.rest).map(note=>note.lyric)).toEqual(['さ','く','ら','さ','く','ら']);
 await expect(page.locator('.native-note-parameters [data-param]')).toHaveCount(0);
 await page.locator('[data-voice-mode="speaking"]').click();await page.locator('#voiceMethod').selectOption('mea8000',{force:true});await expect(page.locator('#textPresetField')).toBeHidden();
 await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','false');
});

test('sample-note text keeps editing the sounding note after its first voice override',async({page})=>{
 await page.goto('voicesaurus.html');await choose(page,'sample-bank');await selectVoiceNote(page,0);
 await parameter(page,'note-param-vibratoCents',50);
 const editor=page.locator('.native-note-editor'),alias=editor.getByRole('combobox',{name:'Exact OTO alias',exact:true});await alias.fill('test alias');await alias.press('Tab');
 await editor.getByRole('textbox',{name:'Lyric',exact:true}).fill('ah');await editor.getByRole('textbox',{name:'Lyric',exact:true}).press('Tab');
 let state=await capture(page);expect(state.input.phrase.notes[0].input.alias).toBe('test alias');expect(state.input.phrase.notes[0].input.lyric).toBe('ah');expect(state.input.alias).toBe('');
 await editor.locator('select[aria-label="Sample note phone"]').selectOption('AA',{force:true});state=await capture(page);
 expect(state.input.phrase.notes[0].input.phones).toEqual(['AA']);expect(state.input.phrase.notes[0].input.alias).toBe('');
});

test('global and note edits reach actual phrase audio while retaining loop and play',async({page})=>{
 await page.addInitScript(()=>{const Base=window.Worker;window.voiceResults=[];window.voiceRequests=[];window.Worker=class extends Base{constructor(...args){super(...args);this.addEventListener('message',({data})=>{if(data.type==='ready')voiceResults.push({finite:data.samples.every(Number.isFinite),peak:data.samples.reduce((peak,value)=>Math.max(peak,Math.abs(value)),0),notes:data.noteTimings?.length});});}postMessage(request,...args){voiceRequests.push(structuredClone(request));super.postMessage(request,...args);}};});
 await page.goto('voicesaurus.html');await choose(page,'singer');await textPreset(page,'love','i love you');
 await page.locator('#nativeLoop').click();await page.locator('#audioButton').click();await page.locator('#nativePlay').click();
 await expect.poll(()=>page.evaluate(()=>voiceResults.length)).toBeGreaterThan(0);
 await selectVoiceNote(page,1);await parameter(page,'note-param-vibrato',.12);await parameter(page,'param-vibrato',.04);
 await expect.poll(()=>page.evaluate(()=>voiceRequests.at(-1)?.input.phrase?.notes[0].values.vibrato)).toBe(.04);
 await expect(page.locator('#nativeStatus')).not.toHaveText('Rendering voice…');
 expect(await page.evaluate(()=>voiceRequests.at(-1).input.phrase.notes[1].values.vibrato)).toBe(.12);
 const audio=await page.evaluate(()=>voiceResults.at(-1));expect(audio.finite).toBe(true);expect(audio.peak).toBeGreaterThan(.001);expect(audio.notes).toBe((await capture(page)).input.phrase.notes.length);
 await expect(page.locator('#nativePlay')).toHaveAttribute('aria-pressed','true');await expect(page.locator('#nativeLoop')).toHaveAttribute('aria-pressed','true');await expect(page.locator('#audioError')).toBeHidden();
});

for(const engine of ['singer','stk-voicform','csound-fof','csound-vosim','sample-bank','sinsy'])test(`${engine}: every text preset renders finite audible phrases`,async({page})=>{
 test.setTimeout(180000);await page.goto('voicesaurus.html');
 const results=await page.evaluate(async engine=>{
  const {defaultScene}=await import('./src/instruments/voicesaurus/native-model.js');
  const {textPresetsForEngine,singingSceneFromTextPreset}=await import('./src/instruments/voicesaurus/text-presets.js');
  const results=[];
  for(const preset of textPresetsForEngine(engine)){
   const {scene}=await singingSceneFromTextPreset(defaultScene(engine),preset);let result;
   if(engine==='sample-bank'){
    const {createSampleBankRenderer}=await import('./src/families/speech/sample-bank-renderer.js'),{sampleBankRequest}=await import('./src/instruments/voicesaurus/sample-bank-model.js');
    const renderer=createSampleBankRenderer();try{result=await renderer.render(sampleBankRequest(scene));}finally{renderer.close();}
   }else result=await new Promise((resolve,reject)=>{
    const worker=new Worker('/src/instruments/voicesaurus/native-worker.js',{type:'module'}),timer=setTimeout(()=>{worker.terminate();reject(Error(preset.id+' timed out'));},30000);
    worker.onerror=event=>{clearTimeout(timer);worker.terminate();reject(Error(event.message));};
    worker.onmessage=({data})=>{clearTimeout(timer);worker.terminate();data.type==='error'?reject(Error(preset.id+': '+data.message)):resolve(data);};worker.postMessage(scene);
   });
   results.push({id:preset.id,finite:result.samples.every(Number.isFinite),peak:result.samples.reduce((peak,value)=>Math.max(peak,Math.abs(value)),0)});
  }
  return results;
 },engine);
 for(const result of results){expect(result.finite,result.id).toBe(true);expect(result.peak,result.id).toBeGreaterThan(.00001);}
});
