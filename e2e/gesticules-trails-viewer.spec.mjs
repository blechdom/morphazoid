import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';

async function openViewer(page){
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.route('**/trails-viewer-harness.html',route=>route.fulfill({contentType:'text/html',body:`<!doctype html>
    <style>html,body{margin:0;width:100%;height:100%;background:#141418}canvas{display:block;width:100%;height:100%}</style>
    <canvas id="stage" aria-label="Trails viewer test"></canvas>`}));
  await page.goto('trails-viewer-harness.html');
  await page.evaluate(async()=>{
    const [{createHandViewer},model]=await Promise.all([import('/src/instruments/gesticulating-hand/hand-viewer.js'),import('/src/instruments/gesticulating-hand/hand-model.js')]);
    const canvas=document.querySelector('canvas'),config=model.normalizeHandConfig(model.HAND_DEFAULTS);
    config.motion.id='still';config.tremor.amount=0;
    let viewer;await new Promise(resolve=>{viewer=createHandViewer(canvas,{onReady:resolve});});
    viewer.setPose(model.evaluateHandPose(config,0));viewer.setShowJoints(false);
    viewer.setAppearance({skin:.23,lighting:.45});
    const read=()=>{const gl=canvas.getContext('webgl2'),data=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,data);return data;};
    const compare=(base,wet)=>{
      let ghosts=0,solid=0,solidDifference=0;const width=canvas.width,height=canvas.height;
      const background=i=>Math.abs(base[i]-20)+Math.abs(base[i+1]-20)+Math.abs(base[i+2]-24)<5;
      for(let y=2;y<height-2;y++)for(let x=2;x<width-2;x++){
        const i=(y*width+x)*4,difference=Math.abs(base[i]-wet[i])+Math.abs(base[i+1]-wet[i+1])+Math.abs(base[i+2]-wet[i+2]);
        if(background(i)){if(difference>24)ghosts++;}
        else if(![-2,-1,0,1,2].some(dy=>[-2,-1,0,1,2].some(dx=>background(((y+dy)*width+x+dx)*4)))){solid++;solidDifference+=difference;}
      }
      return {ghosts,solid,solidDifference:solidDifference/Math.max(1,solid)};
    };
    window.trailsHarness={viewer,canvas,config,model,read,compare};
  });
  return errors;
}

for(const form of ['hand','foot'])test(`${form} trails preserve live skin, leave visible history and clear exactly at zero`,async({page})=>{
  const errors=await openViewer(page);
  const result=await page.evaluate(async form=>{
    const h=window.trailsHarness,{viewer,model,config,canvas,read,compare}=h;
    config.form=form;config.pose=model.handPoseForForm('relaxed',form);await viewer.setForm(form);viewer.setPose(model.evaluateHandPose(config,0));
    viewer.setCameraView({yaw:.9,pitch:.15,zoom:.85});viewer.render();const dry=read();
    viewer.setTrails(1);let now=performance.now();
    for(let step=0;step<=24;step++){
      viewer.setCameraView({yaw:-1.1+step/12,pitch:.15,zoom:.85});viewer.render(now);now+=30;
    }
    const wet=read(),visual=compare(dry,wet),active=viewer.getState().trails;
    h.wetImage=canvas.toDataURL();
    // Unchanged poses, including new object instances, must not refresh the tail.
    for(let step=0;step<45;step++){viewer.setPose(model.evaluateHandPose(config,0));viewer.render(now);now+=100;}
    const expired=viewer.hasTrailTail(now),settled=read(),settledEqual=settled.every((value,index)=>value===dry[index]);
    viewer.setCameraView({yaw:-.7,pitch:.15,zoom:.85});viewer.render(now);viewer.setCameraView({yaw:.9,pitch:.15,zoom:.85});viewer.render(now+30);
    viewer.setTrails(0);const zero=viewer.getState().trails;viewer.render(now+60);const bypass=read();
    h.dryImage=canvas.toDataURL();
    return {visual,active,expired,settledEqual,zero,bypassEqual:bypass.every((value,index)=>value===dry[index])};
  },form);
  expect(result.visual.ghosts).toBeGreaterThan(400);
  expect(result.visual.solid).toBeGreaterThan(4000);expect(result.visual.solidDifference).toBeLessThan(.2);
  expect(result.active.resources).toBe(2);expect(result.active.size[0]*result.active.size[1]).toBeLessThanOrEqual(300000);
  expect(result.expired).toBe(false);expect(result.settledEqual).toBe(true);
  expect(result.zero).toMatchObject({amount:0,history:false,tail:false,resources:0});expect(result.bypassEqual).toBe(true);
  expect(errors).toEqual([]);
});

test('phone resize, model switch, clear and disposal bound and invalidate history',async({page})=>{
  await page.setViewportSize({width:390,height:844});const errors=await openViewer(page);
  const initial=await page.evaluate(()=>{const {viewer}=window.trailsHarness;viewer.setTrails(.8);viewer.render();viewer.setView('side');viewer.render();return viewer.getState().trails;});
  expect(initial.resources).toBe(2);expect(initial.size[0]*initial.size[1]).toBeLessThanOrEqual(180000);
  await page.setViewportSize({width:844,height:390});
  const resized=await page.evaluate(()=>{const {viewer}=window.trailsHarness;viewer.resize();const clear=viewer.getState().trails.history;viewer.render();return {clear,state:viewer.getState().trails};});
  expect(resized.clear).toBe(false);expect(resized.state.resources).toBe(2);expect(resized.state.size).not.toEqual(initial.size);
  expect(resized.state.size[0]*resized.state.size[1]).toBeLessThanOrEqual(180000);
  const result=await page.evaluate(async()=>{
    const {viewer,model,config}=window.trailsHarness;
    const switching=viewer.setForm('foot'),during=viewer.getState().trails.history;await switching;
    config.form='foot';config.pose=model.handPoseForForm('relaxed','foot');viewer.setPose(model.evaluateHandPose(config,0));viewer.render();
    viewer.clearTrails();const cleared=viewer.getState().trails;viewer.render();const afterClear=viewer.getState().trails;
    viewer.setView('back');viewer.render();viewer.dispose();return {during,cleared,afterClear,disposed:viewer.getState().trails};
  });
  expect(result.during).toBe(false);expect(result.cleared).toMatchObject({history:false,tail:false});expect(result.afterClear.history).toBe(false);
  expect(result.disposed).toMatchObject({history:false,tail:false,resources:0});expect(errors).toEqual([]);
});


test('hand and foot choreography leave afterimages with a fixed camera',async({page},testInfo)=>{
  const errors=await openViewer(page);
  for(const form of ['hand','foot']){
    const result=await page.evaluate(async form=>{
      const {viewer,model,config,canvas,read,compare}=window.trailsHarness;
      viewer.setTrails(0);config.form=form;config.pose=model.handPoseForForm('relaxed',form);
      config.motion={...config.motion,id:'flourish-spiral',amount:1,elasticity:1,tempo:120,speed:1};
      await viewer.setForm(form);viewer.setFraming(config);viewer.setCameraView({yaw:.6,pitch:.2,zoom:.8});
      viewer.setTrails(.85);const start=performance.now();
      for(let frame=0;frame<=48;frame++){viewer.setPose(model.evaluateHandPose(config,frame*.04));viewer.render(start+frame*40);}
      const wet=read(),wetImage=canvas.toDataURL('image/png');viewer.setTrails(0);viewer.render();
      return {visual:compare(read(),wet),wetImage,dryImage:canvas.toDataURL('image/png')};
    },form);
    for(const kind of ['wet','dry']){
      const path=testInfo.outputPath(`${form}-${kind}.png`);await writeFile(path,Buffer.from(result[`${kind}Image`].split(',')[1],'base64'));
      await testInfo.attach(`${form}-${kind}`,{path,contentType:'image/png'});
    }
    expect(result.visual.ghosts).toBeGreaterThan(100);expect(result.visual.solidDifference).toBeLessThan(.2);
  }
  expect(errors).toEqual([]);
});
