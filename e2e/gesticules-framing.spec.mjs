import { test, expect } from '@playwright/test';

for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:844,height:390}]){
  test(`complete hand and foot surfaces stay framed at ${viewport.width}×${viewport.height}`,async({page})=>{
    test.setTimeout(120000);
    await page.setViewportSize(viewport);await page.goto('gesticules.html');
    await page.waitForFunction(()=>window.__gesticulatingHand?.snapshot().loaded);
    const result=await page.evaluate(async()=>{
      const {createHandViewer}=await import('/src/instruments/gesticulating-hand/hand-viewer.js');
      const model=await import('/src/instruments/gesticulating-hand/hand-model.js');
      const size=document.querySelector('#handCanvas').getBoundingClientRect(),host=document.createElement('div'),canvas=document.createElement('canvas');
      host.style.cssText=`position:fixed;left:0;top:0;width:${size.width}px;height:${size.height}px;z-index:1000`;
      canvas.style.cssText='display:block;width:100%;height:100%';host.append(canvas);document.body.append(host);
      const viewer=createHandViewer(canvas),failures=[],pumping=[],distances=[],guarded=[];
      let testedVertices=0,poseCount=0,seed=840713;
      const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
      const cases=model.HAND_PRESETS.map(preset=>({id:preset.id,...structuredClone(preset.snapshot)}));
      for(let i=0;i<12;i++)cases.push({id:`random-${i}`,...model.randomizeHandConfig(model.HAND_DEFAULTS,random)});
      for(const form of ['hand','foot'])for(const edge of [0,1]){
        const config=model.normalizeHandConfig({form,motion:{id:'still'}});
        for(let finger=0;finger<5;finger++)for(const [key,limits] of Object.entries(model.handDigitLimits(form,finger)))config.pose.fingers[finger][key]=limits[edge];
        for(const [key,limits] of Object.entries(model.handWristLimits(form)))config.pose.wrist[key]=limits[edge];
        if(form==='foot')for(const [key,limits] of Object.entries(model.FOOT_LIMITS.shape))config.pose.foot[key]=limits[edge];
        cases.push({id:`limits-${form}-${edge}`,...config});
      }
      try{
        for(const config of cases){
          viewer.setFraming(config);await viewer.setForm(config.form);
          const radius=viewer.getState().framing.radius;
          for(const view of [{...config.view,zoom:1},{yaw:-2.4,pitch:1.15,zoom:.62},{yaw:1.6,pitch:-1.15,zoom:.62}]){
            viewer.setCameraView(view);
            for(let frame=0;frame<5;frame++){
              const time=model.handMotionPeriod(config.motion)*(frame+.31)/5;
              viewer.setPose(model.evaluateHandPose(config,time,undefined,(frame+.17)*1.719/model.handTremorRate(config)));
              const state=viewer.getState({includeSurfaceBounds:true}),bounds=state.surfaceBounds;poseCount++;testedVertices+=bounds.vertices;
              if(Math.min(...bounds.min.slice(0,2)) < -.999 || Math.max(...bounds.max.slice(0,2)) > .999 || bounds.min[2]<=-1 || bounds.max[2]>=1){
                failures.push({id:config.id,view,frame,bounds});
              }
            }
          }
          if(viewer.getState().framing.radius>radius+1e-6)pumping.push(config.id);
        }
        // A direct gesture can extend past the precomputed choreography. It
        // must fit immediately and keep that stable envelope when released.
        for(const form of ['hand','foot']){
          const config=model.normalizeHandConfig({form,motion:{id:'still'}});
          viewer.setFraming(config);await viewer.setForm(form);viewer.setCameraView({yaw:2.7,pitch:1.15,zoom:.62});
          const pose=model.evaluateHandPose(config,0),before=viewer.getState().framing.radius;
          for(let finger=0;finger<5;finger++)for(const [key,limits] of Object.entries(model.handDigitLimits(form,finger)))pose.fingers[finger][key]=limits[0];
          for(const [key,limits] of Object.entries(model.handWristLimits(form)))pose.wrist[key]=limits[1];
          if(form==='foot')Object.assign(pose.foot,{arch:85,twist:55,stretch:1});
          viewer.setPose(pose);const extended=viewer.getState({includeSurfaceBounds:true});
          viewer.setPose(model.evaluateHandPose(config,0));const released=viewer.getState();
          guarded.push({before,extended:extended.framing.radius,released:released.framing.radius,bounds:extended.surfaceBounds});
        }
        // A zoom-out/zoom-in round trip still changes scale. The inward limit
        // remains the same safe envelope at every orientation and phase.
        for(const zoom of [2,1,.62]){viewer.setCameraView({zoom});distances.push(viewer.getState().framing.distance);}
        return {failures,pumping,distances,guarded,poseCount,testedVertices,cases:cases.length,presets:model.HAND_PRESETS.length};
      }finally{viewer.dispose();host.remove();}
    });
    expect(result.cases).toBe(result.presets+16);
    expect(result.failures).toEqual([]);
    expect(result.pumping).toEqual([]);
    expect(result.testedVertices).toBeGreaterThan(19000000);
    expect(result.guarded.some(item=>item.extended>item.before)).toBe(true);
    for(const item of result.guarded){
      expect(item.released).toBe(item.extended);
      expect(Math.min(...item.bounds.min.slice(0,2))).toBeGreaterThan(-1);
      expect(Math.max(...item.bounds.max.slice(0,2))).toBeLessThan(1);
    }
    expect(result.distances[0]).toBeGreaterThan(result.distances[1]);
    expect(result.distances[1]).toBeGreaterThan(result.distances[2]);
  });
}
