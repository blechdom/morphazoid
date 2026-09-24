import {expect,test} from '@playwright/test';
const state=page=>page.evaluate(()=>window.__puggler.snapshot());
const setRange=(page,id,value)=>page.locator(`#${id}`).evaluate((input,value)=>{input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));},String(value));
for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:844,height:390}])test(`shared knobs remain reachable and connected at ${viewport.width}x${viewport.height}`,async({browser,baseURL},testInfo)=>{
  const context=await browser.newContext({baseURL,viewport,hasTouch:viewport.width<1000,isMobile:viewport.width<1000});
  try{
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('puggler.html');await page.waitForFunction(()=>window.__puggler?.snapshot().collage.ready);
    const presentation=await page.evaluate(()=>{
      const rect=node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right};};
      const button=document.querySelector('#playButton'),objects=document.querySelector('#randomButton'),crowd=document.querySelector('#crowdButton');
      return {play:rect(button),radius:getComputedStyle(button).borderRadius,objects:rect(objects),crowd:rect(crowd),crowdBorder:parseFloat(getComputedStyle(crowd).borderTopWidth),adjacent:objects.nextElementSibling===crowd,
        knobs:[...document.querySelectorAll('.puggler-knob-bank .mz-range-knob')].map(field=>{
          const dial=field.querySelector('.mz-range-knob__dial'),label=field.querySelector('.mz-field__label'),output=field.querySelector('output');
          return {dial:rect(dial),label:rect(label),output:rect(output),color:getComputedStyle(dial).borderTopColor,labelSize:parseFloat(getComputedStyle(label).fontSize),valueSize:parseFloat(getComputedStyle(output).fontSize)};
        })};
    });
    expect(presentation.play.width).toBe(presentation.play.height);
    expect(presentation.play.width).toBe(viewport.width<1000?48:40);expect(presentation.radius).toBe('50%');
    expect(presentation.adjacent).toBe(true);expect(presentation.crowdBorder).toBeGreaterThan(0);
    expect(presentation.objects.y).toBe(presentation.crowd.y);expect(presentation.crowd.x-presentation.objects.right).toBeLessThanOrEqual(10);
    expect(presentation.crowd.width).toBeLessThan(110);expect(presentation.objects.width).toBeLessThan(110);
    for(const knob of presentation.knobs){
      expect(knob.label.y).toBeGreaterThan(knob.dial.bottom);
      expect(knob.output.y).toBeGreaterThan(knob.label.bottom);expect(knob.valueSize).toBeLessThan(knob.labelSize);
    }
    expect(presentation.knobs[0].color).not.toBe(presentation.knobs[8].color);
    if(viewport.width===1440)expect(presentation.knobs.filter(k=>k.dial.y===presentation.knobs[0].dial.y).length).toBeGreaterThan(8);
    await expect(page.locator('.puggler-performance-controls details')).toHaveCount(0);
    expect(await page.locator('.puggler-performance-controls').innerText()).not.toMatch(/drag up|drag down|drag.*up.*down/i);
    await expect(page.locator('#playButton')).toHaveAccessibleName('Pause');
    await page.locator('#playButton').click();
    await expect(page.locator('#playButton')).toHaveAccessibleName('Play');
    await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed','false');
    const before=await state(page);
    await expect(page.locator('.puggler-panel #loft, .puggler-panel #soundControls, .key-grid')).toHaveCount(0);
    await expect(page.locator('#performanceKnobs input[type=range]')).toHaveCount(8);
    await expect(page.locator('#soundControls input[type=range]')).toHaveCount(10);
    await expect(page.locator('#boo')).toHaveAttribute('max','3');
    for(const id of ['rideSpeed','tempo','count','loft','assist','chaos','gravity','wind','sceneGain','flight','impacts','drops','boo','height','stereo','grit','motion','decay']){
      const input=page.locator(`#${id}`);await input.scrollIntoViewIfNeeded();
      const limits=await input.evaluate(i=>[Number(i.min),Number(i.max),Number(i.step)]);
      for(const value of [limits[0],limits[0]+Math.round((limits[1]-limits[0])/2/limits[2])*limits[2],limits[1]]){
        await setRange(page,id,value);
        const actual=await page.evaluate(async id=>{const {captureHeaderPresetState}=await import('/src/site/header-presets.js');const s=captureHeaderPresetState().snapshot;return id in s.model?s.model[id]:s.sound[id];},id);
        expect(actual).toBeCloseTo(Number(await input.inputValue()),6);
        if(id==='boo'&&value===3)await expect(page.locator('output[for=boo]')).toHaveText('300%');
      }
      await input.focus();const max=Number(await input.inputValue());await input.press('ArrowLeft');expect(Number(await input.inputValue())).toBeLessThan(max);
      expect(await input.evaluate(i=>{const r=i.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===i;})).toBe(true);
    }
    expect(await state(page)).toMatchObject({audioOn:false,running:false,level:before.level});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({path:testInfo.outputPath('sound-knobs.png')});expect(errors).toEqual([]);
  }finally{await context.close();}
});

test('a real touch drag adjusts the ride knob without scrolling; cancellation releases it',async({browser,baseURL})=>{
  const context=await browser.newContext({baseURL,viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  try{
    const page=await context.newPage();await page.goto('puggler.html');await page.waitForFunction(()=>window.__puggler);
    const knob=page.locator('#rideSpeed');await knob.scrollIntoViewIfNeeded();await setRange(page,'rideSpeed',.5);
    const box=await knob.boundingBox(),session=await context.newCDPSession(page),scroll=await page.evaluate(()=>scrollY);
    const p={x:box.x+box.width/2,y:box.y+box.height/2,id:1};
    await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p]});
    await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...p,y:p.y-45}]});
    await expect.poll(async()=>(await state(page)).rideSpeed).toBeGreaterThan(1);
    await session.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
    expect(await page.evaluate(()=>scrollY)).toBe(scroll);
    const speed=(await state(page)).rideSpeed;await page.mouse.move(p.x,p.y+60);expect((await state(page)).rideSpeed).toBe(speed);
    expect((await state(page)).audioOn).toBe(false);
  }finally{await context.close();}
});

test('recorded drop voice renders louder than background boos, scales monotonically, and zero is silent',async({page},testInfo)=>{
  await page.goto('puggler.html');
  const rows=await page.evaluate(async()=>{
    const {PugglerAudio}=await import('/src/instruments/puggler/puggler-audio.js');
    const {PROPS}=await import('/src/instruments/puggler/puggler.js');
    const bytes=await (await fetch('/assets/puggler/boo.wav')).arrayBuffer(),rows=[];
    for(const [kind,amount] of [['crowd-boo',.28],['drop',0],['drop',.35],['drop',.7],['drop',1]]){
      // Isolate the real strike() voice before the shared ceiling/output stage.
      const c=new OfflineAudioContext(2,48000*3,48000),audio=new PugglerAudio();
      audio.context=c;audio.on=true;audio.buffers={boo:await c.decodeAudioData(bytes.slice(0))};
      audio.bus=c.createGain();audio.bus.connect(c.destination);audio.airDuck=c.createGain();
      audio.strike({kind,id:0,prop:PROPS[0],x:500,y:25,vx:20,vy:-500},{boo:amount,drops:amount},.05);
      const b=await c.startRendering(),data=b.getChannelData(0);let peak=0,sum=0;
      for(const v of data){if(!Number.isFinite(v))throw Error('non-finite drop');peak=Math.max(peak,Math.abs(v));sum+=v*v;}
      rows.push({kind,amount,peak,rms:Math.sqrt(sum/data.length),attacks:audio.attacks.size});
    }return rows;
  });
  expect(rows[1].peak).toBe(0);expect(rows[3].rms).toBeGreaterThan(rows[0].rms*4);
  expect(rows[2].rms).toBeLessThan(rows[3].rms);expect(rows[3].rms).toBeLessThan(rows[4].rms);
  expect(rows.every(r=>r.peak<1&&r.attacks===0)).toBe(true);
  await testInfo.attach('isolated-pre-ceiling-drop-levels',{body:JSON.stringify(rows,null,2),contentType:'application/json'});
});

test('live Audience and Drops fades change an existing recording, and Scene level scales every layer',async({page},testInfo)=>{
  await page.goto('puggler.html');
  const rows=await page.evaluate(async()=>{
    const {PugglerAudio}=await import('/src/instruments/puggler/puggler-audio.js');
    const {PROPS}=await import('/src/instruments/puggler/puggler.js');
    const recordings=Object.fromEntries(await Promise.all(['boo','woo','crash'].map(async id=>[id,await(await fetch(`/assets/puggler/${id}.wav`)).arrayBuffer()])));
    const rows=[];
    // Isolate actual strike() envelopes and live update() gains from the nonlinear
    // ceiling. All three paths use the same final master, as in the armed graph.
    async function render(kind,control,amount){
      const c=new OfflineAudioContext(2,48000*3,48000),audio=new PugglerAudio();
      audio.context=c;audio.on=true;audio.buffers=Object.fromEntries(await Promise.all(Object.entries(recordings).map(async([id,bytes])=>[id,await c.decodeAudioData(bytes.slice(0))])));
      audio.bus=c.createGain();audio.drumBus=c.createGain();audio.drumBus.connect(audio.bus);
      audio.master=c.createGain();audio.bus.connect(audio.master);audio.master.connect(c.destination);audio.airDuck=c.createGain();
      const params={level:.48,sceneGain:1,boo:1,drops:1,impacts:1};
      audio.update([],params,false);
      audio.strike({kind,id:0,drum:'crash',prop:PROPS[0],x:500,y:25,vx:20,vy:-500},params,.03);
      const voice=[...audio.attacks][0];
      const paused=c.suspend(.25),rendering=c.startRendering();await paused;
      audio.update([],{...params,[control]:amount},false);
      const sameVoice=audio.attacks.size===1&&[...audio.attacks][0]===voice;
      await c.resume();const b=await rendering,data=b.getChannelData(0);
      const rms=(from,to)=>{const samples=data.subarray(from*48000,to*48000);return Math.sqrt(samples.reduce((sum,v)=>sum+v*v,0)/samples.length);};
      let peak=0;for(const value of data){if(!Number.isFinite(value))throw Error('non-finite live level');peak=Math.max(peak,Math.abs(value));}
      return {kind,control,amount,before:rms(.1,.2),after:rms(.45,.8),tail:rms(2.3,3),peak,sameVoice,attacks:audio.attacks.size,disconnected:voice.disconnected};
    }
    for(const kind of ['crowd-woo','crowd-boo','drop','catch']){
      const control=kind==='drop'?'drops':kind==='catch'?'sceneGain':'boo';
      for(const amount of [1,.25,0])rows.push(await render(kind,control,amount));
      if(control==='boo')for(const amount of [2,3])rows.push(await render(kind,control,amount));
      if(kind!=='catch')for(const amount of [.25,0])rows.push(await render(kind,'sceneGain',amount));
      if(kind==='drop')rows.push(await render(kind,'boo',0));
    }
    return rows;
  });
  for(const row of rows){
    const base=rows.find(r=>r.kind===row.kind&&r.amount===1);
    expect(row.sameVoice).toBe(true);expect(row.disconnected).toBe(true);expect(row.attacks).toBe(0);
    expect(row.peak).toBeLessThan(1);expect(row.tail).toBe(0);expect(row.before).toBeGreaterThan(.0001);
    expect(row.before/base.before).toBeCloseTo(1,5);
    const expected=row.kind==='drop'&&row.control==='boo'?1:row.amount;
    expect(row.after/base.after).toBeCloseTo(expected,4);
  }
  await testInfo.attach('live-level-recording-ratios',{body:JSON.stringify(rows,null,2),contentType:'application/json'});
});
