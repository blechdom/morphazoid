import { expect, test } from '@playwright/test';

test.setTimeout(90000);
const parts = ['head', 'antenna_left', 'antenna_right'];
const tolerance = .0002;
// Test-only access to actual posed scan vertices. Production clearance samples
// are checked separately; this catches a proxy that misses real antenna tips.
async function instrument(page) {
  await page.route('**/src/roach-synth-viewer.js*', async route => {
    const response = await route.fetch(), source = await response.text();
    const marker = 'return { loadUrl, loadArrayBuffer, getState,';
    expect(source).toContain(marker);
    const body = source.replace(marker, `return globalThis.__roachFloorViewer = { probeFloorVertices() {
      applyPose(0);
      const point = new THREE.Vector3(), owners = new Set(bones.map(item => item.bone)), parts = [];
      for (const item of bones.filter(item => ['head','antenna_left','antenna_right'].includes(item.bone.userData.jointId))) {
        let clearance = Infinity, count = 0;
        item.bone.traverse(object => {
          const positions = object.geometry?.attributes?.position; if (!positions) return;
          let owner = object; while (owner && !owners.has(owner)) owner = owner.parent;
          if (owner !== item.bone) return;
          for (let i = 0; i < positions.count; i++) {
            const gap = point.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld).dot(anatomy.dorsal) - groundHeight;
            clearance = Math.min(clearance, gap); count++;
          }
        });
        parts.push({jointId:item.bone.userData.jointId,clearance,count});
      }
      return {parts,state:getState()};
    }, loadUrl, loadArrayBuffer, getState,`);
    await route.fulfill({ response, body });
  });
}
const fixture = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><style>html,body{margin:0;background:#090d12}canvas{display:block;width:100vw;height:min(700px,100vh)}</style></head><body><canvas tabindex="0" aria-label="Roach floor fixture"></canvas><script type="module">
import {createRoachViewer} from './src/roach-synth-viewer.js';
import * as model from './src/roach-synth-motion.js';
let joints=[],body={},contribution={};const motion={presetId:'none',intensity:1,antennae:false,tempo:108},scene=model.createRoachSceneState();
const viewer=createRoachViewer({canvas:document.querySelector('canvas'),onRig:s=>{joints=s.bones},onPoseChange:()=>{joints=viewer.getState().bones;draw()}});
function draw(){const pose=new Float32Array(joints.length*3);model.writeRoachPose(0,motion,joints,pose);joints.forEach((j,i)=>['x','y','z'].forEach((axis,a)=>{pose[i*3+a]+=contribution[j.jointId]?.[axis]||0}));model.writeRoachSceneState(0,motion,scene,joints);Object.assign(scene.body,body);viewer.setExternalPose(pose);viewer.setSceneState(scene)}
function setPose(offsets={},nextBody={},nextContribution={}){body=nextBody;contribution=nextContribution;for(const j of joints){j.offset={x:0,y:0,z:0,...offsets[j.jointId]};viewer.setBoneOffset(j.id,j.offset)}draw()}
window.roachFloorQA={viewer,setPose,draw,getJoints:()=>joints,getContribution:()=>structuredClone(contribution),ready:false};await viewer.loadUrl('./assets/roach-synth/cockroach-mobile.glb');setPose();roachFloorQA.ready=true;
</script></body></html>`;
async function openFixture(page, baseURL) {
  await instrument(page);
  await page.route('**/__roach-floor.html', route => route.fulfill({ contentType: 'text/html', body: fixture }));
  await page.goto(new URL('__roach-floor.html', `${baseURL.replace(/\/$/, '')}/`).href);
  await page.waitForFunction(() => window.roachFloorQA?.ready);
}
const measure = page => page.evaluate(() => __roachFloorViewer.probeFloorVertices());
function expectClear(report, label = '') {
  expect(report.parts.map(part => part.jointId).sort()).toEqual([...parts].sort());
  for (const part of report.parts) {
    expect(part.count, `${label} ${part.jointId}: actual scan vertices`).toBeGreaterThan(100);
    expect(part.clearance, `${label} ${part.jointId}: actual scan clearance`).toBeGreaterThanOrEqual(-tolerance);
  }
  expect(report.state.ground.parts.map(part => part.jointId)).toEqual(expect.arrayContaining(parts));
  for (const part of report.state.ground.parts.filter(part => parts.includes(part.jointId))) {
    expect(part.clearance, `${label} ${part.jointId}: reported conservative clearance`).toBeGreaterThanOrEqual(-tolerance);
  }
}
function expectSameSupport(before, after) {
  expect(after.ground.floorLift ?? 0).toBeLessThanOrEqual(1e-7);
  expect(after.ground.groundingOffset).toBeCloseTo(before.ground.groundingOffset, 7);
  expect(after.ground.contacts).toHaveLength(6);
  after.ground.contacts.forEach((foot, i) => expect(foot.gap).toBeCloseTo(before.ground.contacts[i].gap, 7));
  const legs = state => state.bones.filter(j => /^(front|middle|hind)_/.test(j.jointId)).map(j => j.quaternion);
  expect(legs(after)).toEqual(legs(before));
}
const quaternion = (state, part) => state.bones.find(j => j.jointId === part).quaternion;

test('head and both antenna meshes stop at the floor without lifting normal foot support', async ({ page, baseURL }, testInfo) => {
  await openFixture(page, baseURL); const initial = await measure(page); expectClear(initial, 'neutral');
  const cases = [
    { head: { x: -90 } }, { head: { y: -90 } }, { head: { z: -90 } },
    { antenna_left: { y: -90 } }, { antenna_right: { y: 90 } },
    { head: { x: -90, z: -25 }, antenna_left: { y: -90 }, antenna_right: { y: 90 } },
  ];
  const records = [];
  for (const offsets of cases) {
    await page.evaluate(offsets => roachFloorQA.setPose(offsets), offsets);
    const down = await measure(page); expectClear(down, JSON.stringify(offsets)); expectSameSupport(initial.state, down.state);
    records.push({ offsets, parts: down.parts, ground: down.state.ground });
  }
  await testInfo.attach('actual-head-antenna-clearance.json', { body: JSON.stringify(records), contentType: 'application/json' });
});

for (const touch of [false, true]) test(`${touch ? 'phone' : 'desktop'} downward dragging stops at the floor and a short reverse moves immediately`, async ({ browser, baseURL }) => {
  const context = await browser.newContext({ viewport: touch ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: touch, hasTouch: touch });
  try {
    const page = await context.newPage(); await openFixture(page, baseURL);
    const client = touch ? await context.newCDPSession(page) : null;
    for (const [part, axis, sign] of [['head', 'x', -1], ['antenna_left', 'y', -1], ['antenna_right', 'y', 1]]) {
      await page.evaluate(() => { roachFloorQA.setPose(); __roachFloorViewer.setViewPreset('face'); __roachFloorViewer.setTouchInteraction(true); });
      await page.waitForTimeout(100);
      await page.evaluate(axis => __roachFloorViewer.setDragAxis(axis), axis);
      const point = await page.evaluate(part => __roachFloorViewer.getPartScreenPosition(part), part);
      expect(point, part).not.toBeNull();
      const initial = (await measure(page)).state;
      async function move(x, y) {
        if (touch) await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
        else await page.mouse.move(x, y);
      }
      if (touch) await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: point.x, y: point.y }] });
      else { await page.mouse.move(point.x, point.y); await page.mouse.down(); }
      const selected = await page.evaluate(() => __roachFloorViewer.getState());
      const jointId = selected.bones.find(joint => joint.jointId === part).id;
      expect(selected.selectedBone, `${part}: selected hit`).toBe(jointId);
      expect(selected.interaction).toMatchObject({ pointerCount: 1, active: { kind: 'joint', jointId, committed: true } });
      // Keep the pointer in the viewport; repeated movement can exceed the safe
      // angle without releasing capture. Head X uses a vertical drag on phone.
      const dx = axis === 'x' ? 0 : sign * Math.min(160, sign < 0 ? point.x - 8 : (touch ? 390 : 1440) - point.x - 8);
      const dy = axis === 'x' ? 160 : 0;
      await move(point.x + dx, point.y + dy); await page.waitForTimeout(100);
      const down = await measure(page); expectClear(down, part); expectSameSupport(initial, down.state);
      const wallX = point.x + dx + (axis === 'x' ? 0 : sign * 4), wallY = point.y + dy + (axis === 'x' ? 4 : 0);
      await move(wallX, wallY); await page.waitForTimeout(80);
      const atWall = await measure(page); expectClear(atWall, `${part} continued downward`);
      expect(atWall.state.interaction).toMatchObject({ pointerCount: 1, active: { kind: 'joint', jointId, committed: true } });
      const qDown = quaternion(down.state, part), qWall = quaternion(atWall.state, part);
      expect(Math.max(...qWall.map((v, i) => Math.abs(v - qDown[i]))), `${part}: floor boundary reached`).toBeLessThan(.001);
      await move(wallX - (axis === 'x' ? 0 : sign * 10), wallY - (axis === 'x' ? 10 : 0));
      await page.waitForTimeout(100);
      const reversed = await measure(page); expectClear(reversed, `${part} reverse`);
      expect(quaternion(reversed.state, part), `${part}: reverse must not consume hidden overshoot`).not.toEqual(qWall);
      if (touch) await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); else await page.mouse.up();
    }
    // A preset or held MIDI/animation contribution can already request a pose
    // beyond the floor before the pointer starts. Accepted-delta persistence
    // must remove that existing overshoot too, without editing the contribution.
    for (const external of [false, true]) for (const [part, axis, unsafe] of [['head', 'x', -35], ['antenna_left', 'y', -75], ['antenna_right', 'y', 75]]) {
      const input = { [part]: { [axis]: unsafe } }, contribution = external ? input : {};
      await page.evaluate(({ input, external }) => {
        roachFloorQA.setPose(external ? {} : input, {}, external ? input : {});
        __roachFloorViewer.setViewPreset('face');
      }, { input, external });
      await page.waitForTimeout(100); await page.evaluate(axis => __roachFloorViewer.setDragAxis(axis), axis);
      const point = await page.evaluate(part => __roachFloorViewer.getPartScreenPosition(part), part);
      expect(point, `${part}: already constrained ${external ? 'external' : 'static'} pose`).not.toBeNull();
      const before = await measure(page); expectClear(before, `${part} before reverse`);
      if (touch) await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: point.x, y: point.y }] });
      else { await page.mouse.move(point.x, point.y); await page.mouse.down(); }
      const selected = await page.evaluate(() => __roachFloorViewer.getState()), jointId = selected.bones.find(j => j.jointId === part).id;
      expect(selected.selectedBone).toBe(jointId);
      expect(selected.interaction).toMatchObject({ pointerCount: 1, active: { kind: 'joint', jointId, committed: true } });
      const x = point.x + (axis === 'x' ? 0 : -Math.sign(unsafe) * 10), y = point.y - (axis === 'x' ? 10 : 0);
      if (touch) await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] }); else await page.mouse.move(x, y);
      await page.waitForTimeout(100);
      const after = await measure(page); expectClear(after, `${part} already constrained reverse`); expectSameSupport(before.state, after.state);
      const old = quaternion(before.state, part), next = quaternion(after.state, part);
      expect(Math.max(...next.map((v, i) => Math.abs(v - old[i]))), `${part}: short reverse from ${external ? 'fixed external contribution' : 'unsafe static input'}`).toBeGreaterThan(.0001);
      expect(await page.evaluate(() => roachFloorQA.getContribution())).toEqual(contribution);
      if (touch) await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); else await page.mouse.up();
    }
    await client?.detach();
  } finally { await context.close(); }
});

test('rotated body poses retain face clearance and actual app sound and animation players stay independent', async ({ page, baseURL }) => {
  await openFixture(page, baseURL);
  for (const body of [{ yaw: 60 }, { roll: -20 }, { roll: 20 }, { pitch: -30 }, { pitch: 30 }, { pitch: -20, roll: 15, yaw: 45 }]) {
    await page.evaluate(body => roachFloorQA.setPose({ head: { x: -35 }, antenna_left: { y: -75 }, antenna_right: { y: 75 } }, body), body);
    const report = await measure(page); expectClear(report, JSON.stringify(body));
    expect(Number.isFinite(report.state.ground.floorLift)).toBe(true);
    expect(report.state.ground.contacts.every(foot => foot.gap >= -tolerance)).toBe(true);
  }
  await page.goto(new URL('roach-synth.html', `${baseURL.replace(/\/$/, '')}/`).href);
  await page.waitForFunction(() => window.roachSynth?.getState().loaded);
  const state = () => page.evaluate(() => roachSynth.getState());
  await page.locator('#soundPlayButton').click(); await page.locator('#audioButton').click();
  await expect.poll(async () => (await state()).audio.peak).toBeGreaterThan(.0001);
  expect((await state()).playing).toBe(false); expect((await state()).soundPlaying).toBe(true);
  await page.locator('[data-view="face"]').click(); await page.locator('#dragAxis').selectOption('x');
  const point = await page.evaluate(() => roachSynth.getPartScreenPosition('head'));
  expect(point).not.toBeNull();
  const sounding = await state();
  await page.mouse.move(point.x, point.y); await page.mouse.down();
  await page.mouse.move(point.x, point.y + 160, { steps: 4 }); await page.mouse.up();
  expectClear(await measure(page), 'manual edit with sound only');
  expect((await state()).playing).toBe(false); expect((await state()).soundPlaying).toBe(true);
  expect((await state()).time).toBe(sounding.time);
  await expect.poll(async () => (await state()).audio.renderedFrames).toBeGreaterThan(sounding.audio.renderedFrames);
  await page.locator('#motionButton').click();
  await expect.poll(async () => (await state()).playing).toBe(true);
  const running = await state(); await page.locator('#soundPlayButton').click();
  await expect.poll(async () => (await state()).time).toBeGreaterThan(running.time);
  expect((await state()).soundPlaying).toBe(false); expect((await state()).audioOn).toBe(true);
  expectClear(await measure(page), 'animation only');
  await page.locator('#motionButton').click();
  const stopped = await state(); await page.waitForTimeout(150);
  expect((await state()).time).toBe(stopped.time); expectClear(await measure(page), 'paused');
});
