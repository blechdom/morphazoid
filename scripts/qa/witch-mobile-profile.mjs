import { writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { previewServerConfiguration, verifyPreviewSource } from './preview-server.mjs';
const {baseURL}=previewServerConfiguration();
await verifyPreviewSource(baseURL,{files:['src/instruments/witch/witch-app.js','src/instruments/witch/witch-renderer.js']});
// Relative Chromium CPU evidence, not a substitute for a physical phone pass.
const cpu=Number(process.env.WITCH_PROFILE_CPU||4);
if(!Number.isFinite(cpu)||cpu<1||cpu>20)throw new Error('WITCH_PROFILE_CPU must be between 1 and 20.');
const output=process.env.WITCH_PROFILE_OUTPUT||'/tmp/witch-mobile-profile.json';
const browser=await chromium.launch({channel:'chromium',headless:true});
try {
const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true,reducedMotion:'no-preference'});
const page=await context.newPage(),errors=[];
page.on('pageerror',error=>errors.push(error.message));
await page.addInitScript(()=>{
  window.witchProfile={paints:0,frames:[],longTasks:[],audio:[],visual:null};
  const draw=CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage=function(...args){
    if(this.canvas.id==='witchCanvas')window.witchProfile.paints++;
    return draw.apply(this,args);
  };
  const raf=requestAnimationFrame;
  window.requestAnimationFrame=function(callback){return raf(time=>{
    const start=performance.now(),paint=window.witchProfile.paints;
    callback(time);
    if(callback.name==='draw'&&window.witchProfile.paints>paint)window.witchProfile.frames.push({at:start,duration:performance.now()-start});
  });};
  new PerformanceObserver(list=>{for(const item of list.getEntries())window.witchProfile.longTasks.push({at:item.startTime,duration:item.duration});}).observe({type:'longtask',buffered:true});
  const Original=AudioWorkletNode;
  window.AudioWorkletNode=class extends Original {constructor(...args){super(...args);if(args[1]==='witch-voice'){
    this.port.addEventListener('message',({data})=>{if(data.type==='visual'){window.witchProfile.visual=data;window.witchProfile.audio.push({at:performance.now(),time:data.audioTime,level:data.energy});}});this.port.start();
  }}};
});
const cdp=await context.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate',{rate:cpu});
await page.goto(new URL('witch.html',baseURL).href);
await page.waitForFunction(()=>window.witchInstrument?.state.handReady&&window.witchInstrument.state.spiderReady,{},{timeout:60000});
await page.waitForTimeout(600);
const outputs=[];
async function sample(name,ms=4000){
  await page.evaluate(()=>{const p=window.witchProfile;p.frames=[];p.longTasks=[];p.audio=[];p.started=performance.now();});
  await cdp.send('Profiler.enable');await cdp.send('Profiler.start');
  await page.waitForTimeout(ms);
  const {profile}=await cdp.send('Profiler.stop');
  const data=await page.evaluate(()=>{
    const p=window.witchProfile,sorted=p.frames.map(f=>f.duration).sort((a,b)=>a-b),elapsed=performance.now()-p.started;
    const quantile=t=>sorted[Math.min(sorted.length-1,Math.floor(sorted.length*t))]||0;
    const gaps=p.frames.slice(1).map((f,i)=>f.at-p.frames[i].at).sort((a,b)=>a-b);
    return {elapsed,paintCount:sorted.length,paintFps:sorted.length*1000/elapsed,paintMean:sorted.reduce((a,b)=>a+b,0)/Math.max(1,sorted.length),paintP50:quantile(.5),paintP95:quantile(.95),paintMax:quantile(1),gapP95:gaps[Math.floor(gaps.length*.95)]||0,longTasks:p.longTasks.length,longTaskMs:p.longTasks.reduce((a,b)=>a+b.duration,0),audioTimeAdvance:p.audio.length?p.audio.at(-1).time-p.audio[0].time:0,audioMessages:p.audio.length,canvas:{width:document.querySelector('#witchCanvas').width,height:document.querySelector('#witchCanvas').height},scene:window.witchInstrument.state.config.scene,quality:window.witchInstrument.state.renderQuality,hand:window.witchInstrument.state.handMetadata};
  });
  const byId=new Map(profile.nodes.map(node=>[node.id,node])),self=new Map();
  (profile.samples||[]).forEach((id,i)=>self.set(id,(self.get(id)||0)+(profile.timeDeltas?.[i]||0)));
  const hot=[...self].sort((a,b)=>b[1]-a[1]).slice(0,18).map(([id,us])=>({name:byId.get(id)?.callFrame.functionName,url:byId.get(id)?.callFrame.url.split('/').at(-1),ms:us/1000}));
  outputs.push({name,...data,hot});console.log(JSON.stringify(outputs.at(-1)));
}
await sample('rest');
await page.locator('#witchCanvas').focus();await page.keyboard.press('Space');
await page.waitForFunction(()=>window.witchInstrument.state.audioOn,{},{timeout:60000});
await page.waitForTimeout(1000);await sample('brew');
await page.keyboard.press('m');await page.waitForTimeout(700);await sample('flight');
await page.keyboard.press('m');await page.waitForTimeout(500);
const steps=await page.evaluate(async()=>{const {WITCH_PRESETS}=await import('/src/instruments/witch/witch-presets.js');return WITCH_PRESETS.findIndex(p=>p.snapshot.visualMode===5);});
for(let i=0;i<steps;i++)await page.keyboard.press('w');
await page.waitForTimeout(700);await sample('static-distortion');
await page.setViewportSize({width:844,height:390});await page.waitForTimeout(500);await sample('landscape-distortion');
const resources=await page.evaluate(()=>performance.getEntriesByType('resource').map(r=>({name:r.name.split('/').at(-1),bytes:r.decodedBodySize,duration:r.duration})).sort((a,b)=>b.bytes-a.bytes).slice(0,15));
await writeFile(output,JSON.stringify({baseURL,cpu,viewport:'390x844 DPR3; then844x390',browser:await browser.version(),errors,outputs,resources},null,2));
if(errors.length)process.exitCode=1;
} finally {await browser.close();}
