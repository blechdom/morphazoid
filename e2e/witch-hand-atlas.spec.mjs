import { test, expect } from '@playwright/test';

test('native hand atlas keeps both poses, pixels and picking independent with one GPU snapshot',async({page})=>{
  test.setTimeout(60000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  // Load only the native adapter: no Witch app, musical clock or extra models.
  await page.route('**/witch-hand-atlas-harness.html',route=>route.fulfill({contentType:'text/html',
    body:'<!doctype html><title>Witch hand atlas</title><body style="background:#141418"></body>'}));
  await page.goto('/witch-hand-atlas-harness.html');
  const result=await page.evaluate(async()=>{
    const [{createWitchHand},{createHandPose}]=await Promise.all([
      import('/src/instruments/witch/witch-hand.js'),
      import('/src/instruments/gesticulating-hand/hand-model.js'),
    ]);
    const hand=createWitchHand({quality:{maxWidth:384,textureSize:512,frameInterval:0}});
    try {
      if(!await hand.ready)throw new Error('Native Witch hand model did not load');
      const poses=[createHandPose(),createHandPose()];
      for(let i=0;i<5;i++) {
        Object.assign(poses[0].fingers[i],{mcp:8+i*6,pip:12+i*4,dip:9+i*3,spread:-16+i*8});
        Object.assign(poses[1].fingers[i],{mcp:42+i*3,pip:50-i*3,dip:32+i*2,spread:13-i*5});
      }
      Object.assign(poses[0].wrist,{flex:-12,side:6,twist:13});
      Object.assign(poses[1].wrist,{flex:7,side:-7,twist:-19});
      const state={handReach:1,flightLift:0,renderScale:.5,handPoses:poses,
        handFingerLevels:[[.1,.3,.5,.7,.9],[.8,.6,.4,.2,0]]};
      const read=surface=>surface.getContext('2d').getImageData(0,0,surface.width,surface.height).data;
      const difference=(a,b)=>{
        if(a.length!==b.length)return Infinity;
        let pixels=0;
        for(let i=0;i<a.length;i+=4)if(a[i]!==b[i]||a[i+1]!==b[i+1]||a[i+2]!==b[i+2]||a[i+3]!==b[i+3])pixels++;
        return pixels;
      };
      const occupancy=data=>{
        let opaque=0,clear=0;
        for(let i=3;i<data.length;i+=4){if(data[i]>32)opaque++;if(data[i]===0)clear++;}
        return {opaque,clear};
      };
      const projected=()=>[0,1].map(index=>{
        const tips=hand.getTips(index);
        return {tips,wrist:hand.getWrist(index),palm:hand.getPalm(index),
          picks:tips.map(tip=>hand.pick(tip.x,tip.y,8,index))};
      });
      const before=hand.getMetadata(),surfaces=hand.renderPair(state),paired=hand.getMetadata();
      const pairPixels=surfaces.map(read),pairProjection=projected();
      // Compare equal-sized images so distinct source sizes cannot pass this
      // assertion on their own; the independent skin/pose pixels must differ.
      const probe=document.createElement('canvas');probe.width=100;probe.height=72;
      const ink=probe.getContext('2d'),normalized=surfaces.map(surface=>{
        ink.clearRect(0,0,100,72);ink.drawImage(surface,0,0,100,72);return read(probe);
      });
      const repeated=hand.renderPair({...state}),unchanged=hand.getMetadata();
      const unchangedPixels=repeated.map((surface,index)=>difference(read(surface),pairPixels[index]));
      const singleState=structuredClone(state);
      singleState.handPoses[0].fingers[1].mcp+=25;singleState.handPoses[0].fingers[1].pip+=26;
      // A caller may pass changes for both poses while requesting just hand0.
      // Hand1's last published snapshot and coordinates must remain untouched.
      singleState.handPoses[1].fingers[2].mcp-=30;
      hand.render(singleState,0);
      const single=hand.getMetadata(),singleProjection=projected();
      const singlePixels=surfaces.map((surface,index)=>difference(read(surface),pairPixels[index]));
      // Force fresh individual paints of the original inputs and compare with
      // the paired result; neither half may retain its neighbor's color/pose.
      hand.setQuality({});hand.render(state,0);
      const firstIndividual=read(surfaces[0]);hand.render(state,1);
      const individual=hand.getMetadata(),individualProjection=projected();
      const individualPixels=[difference(firstIndividual,pairPixels[0]),difference(read(surfaces[1]),pairPixels[1])];
      const firstSurvivesSecond=difference(read(surfaces[0]),firstIndividual);
      hand.setQuality({maxWidth:256});hand.renderPair(state);
      const resized=hand.getMetadata(),resizedProjection=projected(),resizedPixels=surfaces.map(surface=>occupancy(read(surface)));
      hand.dispose();
      return {before,paired,unchanged,single,individual,resized,disposed:hand.getMetadata(),disposedTips:[hand.getTips(0),hand.getTips(1)],
        occupancy:pairPixels.map(occupancy),asymmetricPixels:difference(normalized[0],normalized[1]),
        independentSurfaces:surfaces[0]!==surfaces[1],stableSurfaces:repeated.every((surface,index)=>surface===surfaces[index]),
        unchangedPixels,singlePixels,individualPixels,firstSurvivesSecond,resizedPixels,
        pairProjection,singleProjection,individualProjection,resizedProjection};
    } finally {hand.dispose();}
  });
  expect(result.paired.atlasCopies-result.before.atlasCopies).toBe(1);
  expect(result.paired.renderCounts.map((count,index)=>count-result.before.renderCounts[index])).toEqual([1,1]);
  expect(result.independentSurfaces).toBe(true);expect(result.stableSurfaces).toBe(true);
  expect(result.paired.surfaceSizes[0]).not.toEqual(result.paired.surfaceSizes[1]);
  for(const pixels of [...result.occupancy,...result.resizedPixels]) {
    expect(pixels.opaque).toBeGreaterThan(100);expect(pixels.clear).toBeGreaterThan(100);
  }
  expect(result.asymmetricPixels).toBeGreaterThan(100);
  expect(result.unchanged.atlasCopies).toBe(result.paired.atlasCopies);
  expect(result.unchanged.renderCounts).toEqual(result.paired.renderCounts);
  expect(result.unchangedPixels).toEqual([0,0]);
  expect(result.single.atlasCopies-result.unchanged.atlasCopies).toBe(1);
  expect(result.single.renderCounts.map((count,index)=>count-result.unchanged.renderCounts[index])).toEqual([1,0]);
  expect(result.singlePixels[0]).toBeGreaterThan(20);expect(result.singlePixels[1]).toBe(0);
  expect(result.singleProjection[0].tips).not.toEqual(result.pairProjection[0].tips);
  expect(result.singleProjection[1]).toEqual(result.pairProjection[1]);
  expect(result.individual.atlasCopies-result.single.atlasCopies).toBe(2);
  expect(result.individualPixels).toEqual([0,0]);expect(result.firstSurvivesSecond).toBe(0);
  expect(result.individualProjection).toEqual(result.pairProjection);
  expect(result.resized.surfaceSizes[0][0]).toBe(256);
  expect(result.resized.bufferSize).not.toEqual(result.individual.bufferSize);
  expect(result.resized.atlasCopies-result.individual.atlasCopies).toBe(1);
  expect(result.resizedProjection).toEqual(result.pairProjection);
  for(const projected of result.pairProjection) {
    expect(projected.tips).toHaveLength(5);
    expect(projected.picks).toEqual(Array.from({length:5},(_,index)=>({type:'finger',index})));
    for(const point of [...projected.tips,projected.wrist,projected.palm]) {
      expect(Number.isFinite(point.x)&&Number.isFinite(point.y)).toBe(true);
    }
  }
  expect(result.disposed).toMatchObject({loaded:false,webglContexts:0,bufferSize:[1,1],atlasSize:[1,1],surfaceSizes:[[1,1],[1,1]]});
  expect(result.disposedTips).toEqual([[],[]]);expect(errors).toEqual([]);
});
