import { test, expect } from '@playwright/test';

test('portrait cupboard reflows above the hat with live taps, drops and rotation',async({page},testInfo)=>{
  await page.setViewportSize({width:390,height:844});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/witch.html');
  await page.waitForFunction(()=>window.witchInstrument?.state.handReady&&window.witchInstrument.state.eyeReady);
  const session=await page.context().newCDPSession(page);
  await session.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
  const inspect=()=>page.evaluate(async()=>{
    const {hitTestWitch,warpWitchPoint,getWitchHat}=await import('/src/instruments/witch/witch-renderer.js');
    const current=window.witchInstrument.state,visual={...current.config,...current.world,
      portraitLayout:current.portraitLayout,objects:current.objects,reducedMotion:true,
      hitRadius:24/current.viewport.scale,spiderCaptured:current.spiderCaptured};
    const icons=current.objects.filter(object=>['shelf','cupboard-top'].includes(object.location));
    return {portrait:current.portraitLayout,rows:current.shelves[0].rows,
      counts:Object.values(Object.groupBy(icons.filter(object=>!object.dropped),object=>object.y)).map(row=>row.length),
      icons,
      hatTop:Math.min(...getWitchHat(visual).panels.flat().map(point=>point.y)),
      hits:icons.filter(object=>!object.dropped).map(object=>{
        const p=warpWitchPoint(object,visual);return {id:object.id,hit:hitTestWitch(p.x,p.y,visual)?.id};
      }),broom:current.targets.broom,view:current.viewport,config:current.config,
      overflow:document.documentElement.scrollWidth-innerWidth,
      bottom:document.querySelector('#witchCanvas').getBoundingClientRect().bottom};
  });
  const initial=await inspect();
  expect(initial.portrait).toBe(true);expect(initial.counts).toEqual([8,7,7]);
  expect(initial.icons).toHaveLength(22);expect(initial.rows).toHaveLength(3);
  for(const icon of initial.icons) {
    expect(icon.y+27*icon.iconSize).toBeLessThan(initial.hatTop);
    expect(icon.x-icon.r).toBeGreaterThan(initial.view.left);expect(icon.x+icon.r).toBeLessThan(1000);
  }
  expect(initial.hits.every(({id,hit})=>id===hit)).toBe(true);
  expect(initial.broom.x).toBeGreaterThan(280);expect(initial.broom.x).toBeLessThan(330);expect(initial.overflow).toBe(0);
  await page.screenshot({path:testInfo.outputPath('portrait.png')});
  const tap=async(id,kind='object')=>{
    const point=await page.evaluate(async({id,kind})=>{
      const {warpWitchPoint}=await import('/src/instruments/witch/witch-renderer.js');
      const current=window.witchInstrument.state,canvas=document.querySelector('#witchCanvas'),rect=canvas.getBoundingClientRect();
      const object=kind==='object'?current.objects.find(object=>object.id===id):current.targets[id];
      const p=warpWitchPoint(object,{...current.config,...current.world,portraitLayout:current.portraitLayout,reducedMotion:true});
      canvas.addEventListener('pointerdown',()=>{
        const after=window.witchInstrument.state;
        window.witchPortraitTap={id,origin:{x:object.x,y:object.y},object:after.objects.find(object=>object.id===id)};
      },{once:true});
      return {x:rect.x+current.viewport.x+p.x*current.viewport.scale,y:rect.y+current.viewport.y+p.y*current.viewport.scale};
    },{id,kind});
    await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
    await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  };
  for(const id of ['glass','acid-303']) {
    await tap(id);
    const captured=await page.evaluate(()=>window.witchPortraitTap);
    expect(captured.object.dropped).toBe(true);expect(captured.object.dropAge).toBe(0);
    expect(captured.object.x).toBe(captured.origin.x);expect(captured.object.y).toBe(captured.origin.y);
  }
  await tap('broom','target');
  await expect.poll(()=>page.evaluate(()=>window.witchInstrument.state.config.scene)).toBe('flight');
  await expect.poll(()=>page.evaluate(()=>window.witchInstrument.state.world.flightLift)).toBe(1);
  const cloth=await page.evaluate(async()=>{
    const {hitTestWitch,warpWitchPoint}=await import('/src/instruments/witch/witch-renderer.js');
    const state=window.witchInstrument.state,rect=document.querySelector('#witchCanvas').getBoundingClientRect();
    const visual={...state.config,...state.world,portraitLayout:state.portraitLayout,flybyTime:state.flybyTime,reducedMotion:true};
    // The noodles now share the upper sky; find a gap in front of the cloth.
    for(let x=state.viewport.left+60;x<state.viewport.left+state.viewport.width-60;x+=30) {
      const p=warpWitchPoint({x,y:-180},visual);
      if(hitTestWitch(p.x,p.y,visual)?.type==='fabric')return {
        x:rect.x+state.viewport.x+p.x*state.viewport.scale,y:rect.y+state.viewport.y+p.y*state.viewport.scale};
    }
    throw new Error('No exposed upper-sky fabric point');
  });
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[cloth]});
  await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:cloth.x+24,y:cloth.y+32}]});
  const held=await page.evaluate(()=>window.witchInstrument.state);
  expect(held.fabricGesture.held).toBe(true);expect(held.fabricGesture.audio.fabricPull).toBeGreaterThan(0);
  expect(held.fabricGesture.visual.fabricGrabY).toBeCloseTo(140/1040,2);
  await page.setViewportSize({width:844,height:390});
  await expect.poll(()=>page.evaluate(()=>window.witchInstrument.state.portraitLayout)).toBe(false);
  await expect.poll(()=>page.evaluate(()=>window.witchInstrument.state.fabricGesture.held)).toBe(false);
  const rotated=await page.evaluate(()=>window.witchInstrument.state);
  expect(rotated.audioOn).toBe(true);expect(rotated.config.scene).toBe('flight');
  expect([rotated.config.fabricX,rotated.config.fabricY]).toEqual([held.config.fabricX,held.config.fabricY]);
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.locator('#witchCanvas').focus();await page.keyboard.press('b');
  await expect.poll(()=>page.evaluate(()=>window.witchInstrument.state.config.scene)).toBe('brew');
  await expect.poll(()=>page.evaluate(()=>window.witchInstrument.state.world.flightLift)).toBe(0);
  const landscape=await inspect();expect(landscape.rows).toHaveLength(6);
  expect(landscape.hits.every(({id,hit})=>id===hit)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('landscape.png')});
  await page.setViewportSize({width:768,height:1024});
  await expect.poll(()=>page.evaluate(()=>window.witchInstrument.state.portraitLayout)).toBe(true);
  const tablet=await inspect();expect(tablet.rows).toHaveLength(3);expect(tablet.overflow).toBe(0);
  expect(tablet.bottom).toBeLessThanOrEqual(1024);
  expect(tablet.hits.every(({id,hit})=>id===hit)).toBe(true);
  expect(tablet.icons.filter(object=>object.dropped).map(object=>object.id)).toEqual(['glass','acid-303']);
  expect(tablet.config).toEqual(landscape.config);
  await page.screenshot({path:testInfo.outputPath('tablet.png')});
  await session.detach();expect(errors).toEqual([]);
});
