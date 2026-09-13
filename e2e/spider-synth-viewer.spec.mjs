import { test, expect } from '@playwright/test';

test.setTimeout(60000);
const fixture = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><style>html,body{margin:0;background:#080d11}canvas{display:block;width:100vw;height:min(700px,100vh);touch-action:pan-y}body.phone{min-height:1800px}body.phone canvas{height:388px}</style></head><body><canvas tabindex="0" aria-label="Spider viewer"></canvas><script type="module">
import {SpiderSynthViewer} from './src/spider-synth-viewer.js';import * as model from './src/spider-synth-model.js';
const web=model.createSpiderWeb(),frame=model.createSpiderFrame();const motion={...model.SPIDER_MOTION_DEFAULTS,preset:'none',explore:false};const events=[];const selections=[];
const viewer=new SpiderSynthViewer({canvas:document.querySelector('canvas'),onPreySelect:e=>selections.push(e),onPluck:e=>events.push(e),onInteract:e=>{motion.offsets={...motion.offsets,[e.jointId]:e.offset};viewer.setOffsets(motion.offsets);update()}});
function update(){model.writeSpiderFrame(0,motion,web,frame);viewer.setFrame(frame)}viewer.setWeb(web);update();
window.spiderViewerQA={viewer,model,web,frame,events,selections,update,ready:false};await viewer.load();update();spiderViewerQA.ready=true;
</script></body></html>`;
async function open(page, baseURL) {
  await page.route('**/__spider-viewer-qa.html', route => route.fulfill({ contentType: 'text/html', body: fixture }));
  await page.goto(new URL('__spider-viewer-qa.html', baseURL.endsWith('/') ? baseURL : `${baseURL}/`).href);
  await page.waitForFunction(() => window.spiderViewerQA?.ready); await page.waitForTimeout(90);
}
async function drawn(page, operation, value) {
  const old = await page.evaluate(({ source, value }) => { const old = spiderViewerQA.viewer.renderCount; Function('value', source)(value); return old; }, { source: operation, value });
  await expect.poll(() => page.evaluate(() => spiderViewerQA.viewer.renderCount)).toBeGreaterThan(old);
}

test('Face fits actual skinned front vertices for every specimen and preserves explicit zoom on rotation and resize', async ({ page, baseURL }) => {
  test.setTimeout(120000); await open(page, baseURL);
  for (const id of ['argiope', 'golden', 'devil', 'tarantula', 'huntsman', 'fishing']) {
    const report = await page.evaluate(async id => {
      const viewer = spiderViewerQA.viewer, base = `./assets/spider-synth/${id === 'argiope' ? '' : `skins/${id}/`}`;
      if (!await viewer.load(`${base}spider-mobile.glb`, `${base}rig-manifest.json`)) throw new Error(`Load failed: ${id}`);
      viewer.setFrame({ time: 0, body: { x: 0, y: viewer.rig.neutralBodyHeight, z: 0, yaw: 0, pitch: 0, roll: 0 }, pose: new Float32Array(114), feet: [] });
      viewer.applyFrame(); viewer.setViewPreset('face');
      let sampled = 0, clipped = 0, nearest = Infinity;
      const joints = viewer.mesh.geometry.attributes.skinIndex, point = viewer.temp[9];
      for (let i = 0; i < joints.count; i += 17) {
        const joint = joints.getX(i); if (joint === 1 || joint > 5) continue;
        viewer.mesh.getVertexPosition(i, point); point.applyMatrix4(viewer.mesh.matrixWorld).project(viewer.camera);
        sampled++; if (Math.abs(point.x) > 1 || Math.abs(point.y) > 1 || point.z < -1 || point.z > 1) clipped++;
        nearest = Math.min(nearest, point.z);
      }
      const distance = viewer.distance;
      viewer.orbit.setFromAxisAngle(viewer.camera.up, .5); viewer.updateCamera();
      const rotatedDistance = viewer.distance; viewer.fit(); viewer.zoomBy(.85);
      return { sampled, clipped, nearest, distance, rotatedDistance, zoomFactor: viewer.zoomFactor, display: viewer.getState().display };
    }, id);
    expect(report.sampled, id).toBeGreaterThan(20); expect(report.clipped, id).toBe(0);
    expect(report.nearest, id).toBeGreaterThan(-1); expect(report.rotatedDistance, id).toBe(report.distance);
    expect(report.zoomFactor, id).toBeCloseTo(.85, 10);
    expect(report.display.width * report.display.height).toBeLessThanOrEqual(report.display.maxPixels);
    expect(report.display.pixelRatio).toBeLessThanOrEqual(report.display.maxDpr);
    expect(report.display).toMatchObject({ mobileAssets: false, maxFps: 20, shadowMapSize: 768 });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => spiderViewerQA.viewer.camera.aspect)).toBeCloseTo(390 / 700, 4);
  expect(await page.evaluate(() => spiderViewerQA.viewer.zoomFactor)).toBeCloseTo(.85, 10);
  expect(await page.evaluate(() => spiderViewerQA.viewer.getState().display.mobileAssets)).toBe(false);
  await drawn(page, 'spiderViewerQA.viewer.fit()');
  expect(await page.evaluate(() => spiderViewerQA.viewer.zoomFactor)).toBe(1);
});

test('magnified event waves travel while every actual planted toe remains pinned in all four views', async ({ page, baseURL }, testInfo) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message)); await open(page, baseURL);
  const selected = await page.evaluate(() => {
    const qa = spiderViewerQA, foot = qa.frame.feet.find(foot => foot.stance && foot.u > .05 && foot.u < .95) || qa.frame.feet[0];
    qa.viewer.setEvents([{ id: 1, segmentId: foot.segmentId, u: .5, audioTime: 10, velocity: 1 }], 10); qa.viewer.setClock(10.12);
    return { id: foot.segmentId, u: foot.u };
  });
  for (const view of ['top', 'side', 'bottom', 'face']) {
    await drawn(page, 'spiderViewerQA.viewer.setViewPreset(value)', view);
    const state = await page.evaluate(({ id, u }) => { const v = spiderViewerQA.viewer, samples = v.getSegmentSamples(id); return { ...v.getState(), toe: samples.find(point => Math.abs(point.u - u) < 1e-8), samples }; }, selected);
    expect(state.waves.maxDisplacement).toBeGreaterThan(.001); expect(state.toe.displacement).toBe(0);
    for (const foot of state.footPositions) if (foot.stance) expect(foot.error).toBeLessThan(.004);
    await page.screenshot({ path: testInfo.outputPath(`wave-${view}.png`) });
  }
  await drawn(page, 'spiderViewerQA.viewer.setClock(13)');
  expect(await page.evaluate(() => spiderViewerQA.viewer.getState().waves.activeSegments)).toBe(0); expect(errors).toEqual([]);
});

test('three-dimensional graph, distinct prey hits and laid silk plucks preserve the chosen camera', async ({ page, baseURL }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message)); await open(page, baseURL);
  await drawn(page, `const q=spiderViewerQA;const web={...q.web,nodes:q.web.nodes.map(n=>({...n,y:.18*Math.sin(n.x*2+n.z)}))};q.viewer.setWeb(web);q.viewer.setWorld({time:10,prey:[{id:'near',state:'trapped',x:.5,y:.3,z:.2,struggle:1},{id:'far',state:'flying',x:-.55,y:.4,z:-.2,struggle:1}],silkSegments:[{id:'thread',ax:-.65,ay:.22,az:.55,bx:.65,by:.22,bz:.55,born:8}],activeSilk:{ax:-.65,ay:.22,az:.55,bx:0,by:.1,bz:0,progress:.5}});q.viewer.fit()`);
  const camera = await page.evaluate(() => spiderViewerQA.viewer.getState().camera);
  for (const id of ['near', 'far']) {
    const point = await page.evaluate(id => spiderViewerQA.viewer.getPreyScreenPosition(id), id); expect(point.visible).toBe(true); await page.mouse.click(point.x, point.y);
    expect(await page.evaluate(() => spiderViewerQA.selections.at(-1).id)).toBe(id);
  }
  const silk = await page.evaluate(() => spiderViewerQA.viewer.getSilkScreenPosition('thread', .43)); expect(silk.visible).toBe(true); await page.mouse.click(silk.x, silk.y);
  expect(await page.evaluate(() => spiderViewerQA.events.at(-1))).toMatchObject({ source: 'silk', silkId: 'thread' });
  expect(await page.evaluate(() => spiderViewerQA.viewer.getState().camera)).toEqual(camera);
  await drawn(page, "spiderViewerQA.viewer.setWorld({time:12,prey:[{id:'near',state:'eaten',x:.5,y:.3,z:.2}],silkSegments:[]})");
  expect(await page.evaluate(() => spiderViewerQA.viewer.getState().world.prey)).toHaveLength(0); expect(errors).toEqual([]);
});

test('phone body dragging and multi-touch preserve explicit zoom while native scrolling and prey taps work', async ({ browser, baseURL }, testInfo) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message)); await open(page, baseURL);
    await page.evaluate(() => document.body.classList.add('phone')); await page.waitForTimeout(80);
    await drawn(page, 'spiderViewerQA.viewer.fit()');
    const camera = await page.evaluate(() => spiderViewerQA.viewer.getState().camera);
    const point = await page.evaluate(() => { spiderViewerQA.viewer.setAxis('x'); spiderViewerQA.viewer.setTouchMode(true); return spiderViewerQA.viewer.getPartScreenPosition('abdomen'); }); expect(point?.visible).toBe(true);
    const session = await context.newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: point.x, y: point.y }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x + 20, y: point.y - 8 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => page.evaluate(() => spiderViewerQA.viewer.getState().bones.find(bone => bone.id === 'abdomen').offset.x)).toBeGreaterThan(.1);
    expect(await page.evaluate(() => spiderViewerQA.viewer.getState().camera)).toEqual(camera);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 40, y: 80 }, { x: 140, y: 80 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 20, y: 80 }, { x: 180, y: 80 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    expect(await page.evaluate(() => spiderViewerQA.viewer.getState().camera.distance)).toBe(camera.distance);
    await drawn(page, "spiderViewerQA.viewer.setWorld({time:10,prey:[{id:'tap',state:'trapped',x:.5,y:.1,z:.1,struggle:1}],silkSegments:[]})");
    const prey = await page.evaluate(() => spiderViewerQA.viewer.getPreyScreenPosition('tap')); await page.touchscreen.tap(prey.x, prey.y);
    expect(await page.evaluate(() => spiderViewerQA.selections.at(-1).id)).toBe('tap');
    await page.evaluate(() => spiderViewerQA.viewer.setTouchMode(false));
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 30, y: 340 }] });
    for (let i = 1; i <= 6; i++) await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 30, y: 340 - i * 30 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(30); await session.detach();
    await page.screenshot({ path: testInfo.outputPath('phone-viewer.png') }); expect(errors).toEqual([]);
  } finally { await context.close(); }
});
