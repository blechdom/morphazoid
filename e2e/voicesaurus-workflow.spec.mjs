import {test,expect} from '@playwright/test';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const capture=page=>page.evaluate(async()=>(await import('./src/site/header-presets.js')).captureHeaderPresetState().snapshot);
async function choose(page,engine){await page.locator('[data-voice-mode="singing"]').click();await page.locator('#voiceMethod').selectOption(engine,{force:true});}
async function observe(page){await page.addInitScript(()=>{
 window.phraseStarts=[];window.workerCount=0;
 const start=AudioBufferSourceNode.prototype.start;AudioBufferSourceNode.prototype.start=function(...args){if(this.context instanceof AudioContext&&this.buffer?.length>1)phraseStarts.push({offset:args[1]??0,length:this.buffer.length});return Reflect.apply(start,this,args);};
 const Original=window.Worker;window.Worker=class extends Original{constructor(...args){super(...args);workerCount++;}};
});}
for(const engine of ['singer','stk-voicform','csound-fof','csound-vosim','sinsy','sample-bank'])test(`${engine}: lyrics become editable singing notes without arming Audio`,async({page})=>{
 await observe(page);await page.goto('voicesaurus.html');await choose(page,engine);
 await page.locator('#singingText').fill(engine==='sinsy'?'sakura sakura':'Daisy Daisy');await page.locator('#applySingingText').click();
 await expect(page.locator('#singingTextStatus')).toContainText('editable notes');
 const scene=await capture(page),notes=engine==='sinsy'?scene.input.notes:scene.input.phrase.notes;
 expect(notes.length).toBeGreaterThan(1);expect(scene.input.singingText).toBe(engine==='sinsy'?'sakura sakura':'Daisy Daisy');
 await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','false');expect(await page.evaluate(()=>workerCount)).toBe(0);
 await expect(page.locator('#param-pitch,#param-duration')).toHaveCount(0);
});

test('a delayed text conversion never overwrites newer note edits or a newer mode',async({page})=>{
 let finish;const ready=new Promise(resolve=>finish=resolve);let requested;const began=new Promise(resolve=>requested=resolve);
 await page.route('**/cmudict-en-us.dict',async route=>{requested();await ready;await route.fulfill({body:'daisy D EY1 Z IY0\n',contentType:'text/plain'});});
 await page.goto('voicesaurus.html');await choose(page,'singer');await page.locator('#singingText').fill('Daisy');await page.locator('#applySingingText').click();await began;
 await page.getByRole('button',{name:'Add note',exact:true}).click();finish();
 await expect(page.locator('#singingTextStatus')).toContainText('score changed');expect((await capture(page)).input.phrase.notes).toHaveLength(2);
 await page.locator('#singingText').fill('hello');await page.locator('#applySingingText').click();await page.locator('[data-voice-mode="speaking"]').click();
 await expect(page.locator('#nativeScore')).toBeHidden();expect((await capture(page)).engine).toBe('espeak');
});

test('ruler seeks to a beat, keeps Audio off until armed, and reuses unchanged rendered audio',async({page})=>{
 await observe(page);await page.goto('voicesaurus.html');await choose(page,'singer');
 await page.getByRole('button',{name:'Add note',exact:true}).click();await page.getByRole('button',{name:'Close note controls'}).click();
 const ruler=page.getByRole('slider',{name:'Play from timeline beat'});
 await ruler.click({position:{x:48+120,y:14}});await expect(ruler).toHaveAttribute('aria-valuenow','1');
 await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','false');expect(await page.evaluate(()=>phraseStarts)).toHaveLength(0);
 await page.locator('#nativeLoop').click();await page.locator('#audioButton').click();
 await expect.poll(()=>page.evaluate(()=>phraseStarts.length)).toBe(1);expect((await page.evaluate(()=>phraseStarts))[0].offset).toBeCloseTo(.5,3);
 const workers=await page.evaluate(()=>workerCount);await ruler.click({position:{x:48+60,y:14}});
 await expect.poll(()=>page.evaluate(()=>phraseStarts.length)).toBe(2);expect((await page.evaluate(()=>phraseStarts))[1].offset).toBeCloseTo(.25,3);expect(await page.evaluate(()=>workerCount)).toBe(workers);
 await page.locator('#nativePlay').click();await ruler.focus();await ruler.press('Home');
 await expect.poll(()=>page.evaluate(()=>phraseStarts.length)).toBe(3);expect((await page.evaluate(()=>phraseStarts))[2].offset).toBe(0);
});

test('local UTAU import, exact alias editing, playback and removal live in Voicesaurus',async({page})=>{
 const folder=await mkdtemp(join(tmpdir(),'voicesaurus-bank-'));const rate=22050,frames=rate,bytes=Buffer.alloc(44+frames*2);
 bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(rate,24);bytes.writeUInt32LE(rate*2,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(frames*2,40);
 for(let i=0;i<frames;i++)bytes.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*261.625565/rate)*9000),44+i*2);
 try{
  await writeFile(join(folder,'a.wav'),bytes);await writeFile(join(folder,'oto.ini'),'a.wav=あ,0,80,-800,40,10\n');await writeFile(join(folder,'character.txt'),'name=Local test voice\nauthor=QA\n');
  await observe(page);await page.goto('voicesaurus.html?voice=sample-bank');await page.locator('#sampleBankFiles').setInputFiles(folder);
  await expect(page.locator('#sampleBankSource')).toHaveValue('local');await expect(page.locator('#sampleBankStatus')).toContainText('Local test voice');
  await page.locator('[data-note-handle="0"]').click();await page.locator('input[aria-label="Exact OTO alias"]').fill('あ');await page.locator('input[aria-label="Exact OTO alias"]').press('Tab');
  await page.getByRole('textbox',{name:'ARPAbet phones',exact:true}).fill('');await page.getByRole('textbox',{name:'ARPAbet phones',exact:true}).press('Tab');
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','false');expect(await page.evaluate(()=>phraseStarts)).toHaveLength(0);
  await page.getByRole('button',{name:'Close note controls'}).click();await page.locator('#audioButton').click();await page.locator('#nativePlay').click();
  await expect(page.locator('#sampleBankStatus')).toContainText('1 local');await expect(page.locator('#audioError')).toBeHidden();
  await page.getByRole('button',{name:'Remove local bank'}).click();await expect(page.locator('#sampleBankSource')).toHaveValue('kal');
  await page.goto('vocalzoid.html');await expect(page.locator('#bankInput,#openBankButtons')).toHaveCount(0);await expect(page.locator('a[href="voicesaurus.html?voice=sample-bank"]')).toBeVisible();
 }finally{await rm(folder,{recursive:true,force:true});}
});

test('a slow fresh seek keeps its play request after the previous phrase would have ended',async({page})=>{
 await observe(page);await page.addInitScript(()=>{
  const Original=window.Worker;window.holdSeek=false;window.seekJobs=[];
  window.Worker=class extends Original{postMessage(request,...rest){if(holdSeek)seekJobs.push(()=>super.postMessage(request,...rest));else super.postMessage(request,...rest);}};
 });
 await page.goto('voicesaurus.html');await choose(page,'singer');await page.locator('#audioButton').click();await page.locator('#nativePlay').click();
 await expect.poll(()=>page.evaluate(()=>phraseStarts.length)).toBe(1);
 const duration=(await capture(page)).values.duration;
 await page.evaluate(()=>holdSeek=true);await page.locator('#param-glottisA').evaluate(input=>{input.value='.43';input.dispatchEvent(new Event('input',{bubbles:true}));});
 await page.getByRole('slider',{name:'Play from timeline beat'}).click({position:{x:48+60,y:14}});
 await expect.poll(()=>page.evaluate(()=>seekJobs.length)).toBeGreaterThan(0);
 await page.waitForTimeout((duration+.2)*1000);await expect(page.locator('#nativePlay')).toHaveAttribute('aria-pressed','true');
 await page.evaluate(()=>{holdSeek=false;seekJobs.at(-1)();});await expect.poll(()=>page.evaluate(()=>phraseStarts.length)).toBe(2);
 expect((await page.evaluate(()=>phraseStarts))[1].offset).toBeCloseTo(.25,3);await expect(page.locator('#audioError')).toBeHidden();
});
