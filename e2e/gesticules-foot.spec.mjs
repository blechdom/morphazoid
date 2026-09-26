import { test, expect } from '@playwright/test';
import { readAudioStatus } from './helpers/audio-probe.mjs';

const snapshot = page => page.evaluate(() => window.__gesticulatingHand.snapshot());
const range = (page, id, value) => page.locator('#' + id).evaluate((input, value) => {
  input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true }));
}, value);
const loadedForm = (page, form) => page.waitForFunction(form => {
  const state = window.__gesticulatingHand?.snapshot();
  return state?.loaded && state.viewer.loaded && state.viewer.form === form && state.config.form === form;
}, form, { timeout: 15000 });
async function chooseForm(page, form) {
  await page.locator('#bodyForm').selectOption(form); await loadedForm(page, form);
}
async function chooseScene(page, label) {
  await page.locator('.header-preset-picker summary').click();
  await page.getByRole('button', { name: label, exact: true }).click();
}
const coordinate = (rect, point) => ({ x: rect.x + (point[0] + 1) * rect.width / 2, y: rect.y + (1 - point[1]) * rect.height / 2 });
const delta = (a, b) => Math.hypot(...a.map((value, i) => value - b[i]));

test.beforeEach(async ({ page }) => {
  page.footErrors = []; page.on('pageerror', error => page.footErrors.push(error.message));
  await page.goto('gesticules.html'); await loadedForm(page, 'hand');
});
test.afterEach(async ({ page }) => expect(page.footErrors).toEqual([]));

test('Hand is the default; Foot exposes fourteen toe joints, an ankle and five stable voices', async ({ page }) => {
  await expect(page.locator('#bodyForm')).toHaveValue('hand');
  expect((await snapshot(page)).viewer.markers.filter(marker => marker.finger < 5)).toHaveLength(15);
  await chooseForm(page, 'foot');
  const state = await snapshot(page), toeMarkers = state.viewer.markers.filter(marker => marker.finger < 5);
  expect(toeMarkers).toHaveLength(14); expect(state.viewer.markers.filter(marker => marker.finger === 5)).toHaveLength(1);
  expect(state.viewer.fingertips).toHaveLength(5); expect(state.config.voices).toHaveLength(5); expect(state.pose.source).toBeNull();
  expect(toeMarkers.filter(marker => marker.finger === 0).map(marker => marker.joint)).toEqual(['mcp', 'dip']);
  for (let finger = 1; finger < 5; finger++) expect(toeMarkers.filter(marker => marker.finger === finger).map(marker => marker.joint)).toEqual(['mcp', 'pip', 'dip']);
  await expect(page.locator('#voicesTitle')).toHaveText('Five toes · five voices'); await expect(page.locator('#wristTitle')).toHaveText('Ankle');
  await expect(page.locator('[data-view="palm"]')).toHaveText('Top'); await expect(page.locator('[data-view="back"]')).toHaveText('Sole');
  await page.locator('#fingerTabs [data-finger="0"]').click();
  await expect(page.locator('#joint-pip')).toHaveCount(0); await expect(page.locator('#joint-dip')).toBeVisible();
  await expect(page.locator('#joint-mcp')).toHaveAttribute('min', '-55'); await expect(page.locator('#wristFlex')).toHaveAttribute('min', '-20');
  await page.locator('#tremorFinger').selectOption('thumb'); await expect(page.locator('#tremorJoint option[value="middle"]')).toHaveJSProperty('disabled', true);
  await page.locator('#fingerTabs [data-finger="1"]').click(); await expect(page.locator('#joint-pip')).toBeVisible();
  expect((await snapshot(page)).audio.contextState).toBe('uninitialized');
});

for (const [finger, joint] of [[0, 'mcp'], [1, 'pip']]) {
  test(`dragging toe ${finger + 1} ${joint} moves its actual rig and cancellation releases the voice`, async ({ page }) => {
    await chooseForm(page, 'foot'); await page.locator('#motionPreset').selectOption('still');
    await page.locator('#handCanvas').scrollIntoViewIfNeeded();
    const before = await snapshot(page), rect = await page.locator('#handCanvas').boundingBox();
    const marker = before.viewer.markers.find(marker => marker.finger === finger && marker.joint === joint), point = coordinate(rect, marker.screen);
    await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.mouse.move(point.x + 8, point.y + 46, { steps: 6 });
    const held = await snapshot(page); expect(held.held).toBe(1 << finger); expect(held.selected).toBe(finger);
    expect(held.config.pose.fingers[finger][joint]).toBeGreaterThan(before.config.pose.fingers[finger][joint] + 15);
    expect(held.config.pose.fingers[0].pip).toBe(0);
    await expect.poll(async () => delta((await snapshot(page)).viewer.fingertips[finger], before.viewer.fingertips[finger])).toBeGreaterThan(.003);
    expect((await snapshot(page)).audio.contextState).toBe('uninitialized');
    const pointerId = await page.locator('#handCanvas').evaluate(canvas => [1, 2, 3].find(id => canvas.hasPointerCapture(id)));
    expect(pointerId).toBeDefined(); await page.locator('#handCanvas').dispatchEvent('pointercancel', { pointerId });
    expect((await snapshot(page)).held).toBe(0); await page.mouse.up();
  });
}

test('toe motion stays silent before Audio arm and both players continue through live form switches', async ({ page }) => {
  await chooseForm(page, 'foot'); await range(page, 'outputLevel', .23);
  await page.locator('#soundPlayButton').click(); await page.locator('#motionButton').click();
  await expect.poll(async () => (await snapshot(page)).time).toBeGreaterThan(.15);
  let state = await snapshot(page); expect(state.audio.contextState).toBe('uninitialized'); expect(state.audio.rms).toBe(0);
  await page.locator('#audioButton').click(); await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await snapshot(page)).audio.rms).toBeGreaterThan(.001);
  const connectionCount = (await readAudioStatus(page)).connectionCount; expect(connectionCount).toBe(1);
  for (const form of ['hand', 'foot', 'hand', 'foot']) {
    const before = await snapshot(page); await chooseForm(page, form); state = await snapshot(page);
    expect(state.playing && state.soundPlaying && state.audioOn).toBe(true); expect(state.audio.contextState).toBe('running');
    expect(state.time).toBeGreaterThanOrEqual(before.time - .012); expect(state.viewer.rigCount).toBeLessThanOrEqual(2);
    await expect.poll(async () => (await snapshot(page)).audio.rms).toBeGreaterThan(.001);
    const output = await readAudioStatus(page); expect(output.connectionCount).toBe(connectionCount); expect(output.clipped).toBe(false);
    expect(state.audio.peak).toBeLessThan(.82); await expect(page.locator('#outputLevel')).toHaveValue('0.23');
  }
  await page.locator('#audioButton').click(); await expect.poll(async () => (await snapshot(page)).audio.rms).toBeLessThan(.0001);
  expect((await snapshot(page)).playing).toBe(true); expect((await snapshot(page)).soundPlaying).toBe(true);
});

test('switching forms restores each independently edited base pose, including thumb and big-toe topology', async ({ page }) => {
  await page.locator('#motionPreset').selectOption('still'); await page.locator('#fingerTabs [data-finger="0"]').click();
  await range(page, 'joint-mcp', 31); await range(page, 'joint-pip', 62); await range(page, 'wristFlex', 28);
  const handPose = (await snapshot(page)).config.pose;
  await chooseForm(page, 'foot'); await expect(page.locator('#joint-pip')).toHaveCount(0);
  await range(page, 'joint-mcp', -21); await range(page, 'joint-dip', 47); await range(page, 'wristFlex', -12);
  await page.locator('#fingerTabs [data-finger="1"]').click(); await range(page, 'joint-pip', 53);
  const footPose = (await snapshot(page)).config.pose;
  for (let cycle = 0; cycle < 3; cycle++) {
    await chooseForm(page, 'hand'); expect((await snapshot(page)).config.pose).toEqual(handPose);
    await page.locator('#fingerTabs [data-finger="0"]').click(); await expect(page.locator('#joint-pip')).toHaveValue('62');
    await chooseForm(page, 'foot'); expect((await snapshot(page)).config.pose).toEqual(footPose);
    await expect(page.locator('#joint-pip')).toHaveCount(0); await expect(page.locator('#joint-dip')).toHaveValue('47');
  }
});

test('all four full foot presets restore form, pose, engines, speed, tempo, camera, tremor and appearance', async ({ page }) => {
  await range(page, 'outputLevel', .19); await page.locator('#soundPlayButton').click(); await page.locator('#motionButton').click();
  const scenes = await page.evaluate(async () => (await import('/src/instruments/gesticulating-hand/hand-model.js')).HAND_PRESETS.filter(preset => preset.snapshot.form === 'foot'));
  expect(scenes).toHaveLength(4);
  for (const scene of scenes) {
    await chooseForm(page, 'hand'); await range(page, 'tempo', 1023); await range(page, 'speed', 3.7);
    await page.locator('#skin').selectOption('jade'); await page.locator('#lighting').selectOption('noir');
    await page.locator('[data-view="back"]').click(); await chooseScene(page, scene.label); await loadedForm(page, 'foot');
    const state = await snapshot(page); expect(state.config).toEqual(scene.snapshot);
    expect(state.playing && state.soundPlaying).toBe(true); expect(state.audioOn).toBe(false); expect(state.pose.source).toBeNull();
    expect(state.viewer.appearance).toEqual(scene.snapshot.appearance);
    for (const key of ['yaw', 'pitch', 'zoom']) expect(state.viewer.view[key]).toBeCloseTo(scene.snapshot.view[key], 10);
    await expect(page.locator('#bodyForm')).toHaveValue('foot'); await expect(page.locator('#outputLevel')).toHaveValue('0.19');
    for (const id of ['speed', 'tempo']) expect(Number(await page.locator('#' + id).inputValue())).toBe(scene.snapshot.motion[id]);
    await expect(page.locator('#skin')).toHaveValue(scene.snapshot.appearance.skin); await expect(page.locator('#lighting')).toHaveValue(scene.snapshot.appearance.lighting);
  }
});

test('a delayed foot load cannot replace a newer hand request and the two cached rigs dispose cleanly', async ({ page }) => {
  let releaseFoot, requestedFoot; const hold = new Promise(resolve => { releaseFoot = resolve; }), requested = new Promise(resolve => { requestedFoot = resolve; });
  let footRequests = 0;
  await page.route('**/assets/gesticulating-foot/foot.glb', async route => { footRequests++; requestedFoot(); await hold; await route.continue(); });
  try {
    await page.evaluate(async () => {
      const { createHandViewer } = await import('/src/instruments/gesticulating-hand/hand-viewer.js');
      const { normalizeHandConfig, evaluateHandPose } = await import('/src/instruments/gesticulating-hand/hand-model.js');
      const canvas = document.createElement('canvas'); canvas.style.cssText = 'position:fixed;left:0;top:0;width:420px;height:420px'; document.body.append(canvas);
      const ready = [], viewer = createHandViewer(canvas, { onReady: form => ready.push(form) });
      const hand = evaluateHandPose(normalizeHandConfig({ motion: { id: 'still' } }), 0);
      const foot = evaluateHandPose(normalizeHandConfig({ form: 'foot', motion: { id: 'still' }, pose: { fingers: [{ mcp: 24, dip: 36 }] } }), 0);
      viewer.setPose(hand); await viewer.setForm('hand');
      const lateFoot = viewer.setForm('foot'); viewer.setPose(foot);
      const latestHand = viewer.setForm('hand'); viewer.setPose(hand); await latestHand;
      viewer.setCameraView({ yaw: .6, pitch: -.2, zoom: 1.12 }); viewer.setAppearance({ skin: 'violet', lighting: 'neon' });
      window.__footViewerRace = { viewer, canvas, ready, lateFoot, foot };
    });
    await requested; releaseFoot();
    const result = await page.evaluate(async () => {
      const { viewer, lateFoot, foot, ready } = window.__footViewerRace;
      const staleActivated = await lateFoot, retained = viewer.getState(), readyBeforeFoot = [...ready];
      const activateFoot = viewer.setForm('foot'); viewer.setPose(foot); await activateFoot;
      const activeFoot = viewer.getState();
      viewer.dispose(); const acceptedAfterDispose = await viewer.setForm('hand'), disposed = viewer.getState();
      return { staleActivated, retained, readyBeforeFoot, activeFoot, acceptedAfterDispose, disposed };
    });
    expect(result.staleActivated).toBe(false); expect(result.retained.loaded).toBe(true); expect(result.retained.form).toBe('hand');
    expect(result.readyBeforeFoot.every(form => form === 'hand')).toBe(true);
    expect(result.retained.rigCount).toBe(2); expect(result.activeFoot.rigCount).toBe(2); expect(footRequests).toBe(1);
    expect(result.activeFoot.form).toBe('foot'); expect(result.activeFoot.markers.filter(marker => marker.finger < 5)).toHaveLength(14);
    expect(result.activeFoot.appearance).toEqual({ skin: 'violet', lighting: 'neon' });
    expect(result.activeFoot.view.yaw).toBeCloseTo(.6, 10); expect(result.activeFoot.view.pitch).toBe(-.2); expect(result.activeFoot.view.zoom).toBe(1.12);
    expect(result.acceptedAfterDispose).toBe(false); expect(result.disposed.loaded).toBe(false); expect(result.disposed.rigCount).toBe(0);
  } finally {
    releaseFoot(); await page.evaluate(() => { const race = window.__footViewerRace; race?.viewer.dispose(); race?.canvas.remove(); delete window.__footViewerRace; });
    await page.unroute('**/assets/gesticulating-foot/foot.glb');
  }
});

for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
  test(`foot joints and controls remain visible at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport); await chooseForm(page, 'foot');
    await page.locator('#release').scrollIntoViewIfNeeded(); await expect(page.locator('#release')).toBeVisible();
    const dimensions = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      header: document.querySelector('.masthead').getBoundingClientRect().bottom,
      canvas: document.querySelector('#handCanvas').getBoundingClientRect().toJSON() }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width + 1);
    expect(dimensions.canvas.width).toBeGreaterThan(250); expect(dimensions.canvas.height).toBeGreaterThan(130);
    expect(dimensions.canvas.top).toBeGreaterThanOrEqual(dimensions.header - 1);
    expect(dimensions.canvas.bottom).toBeLessThanOrEqual(viewport.height + 1);
    const state = await snapshot(page);
    for (const point of [...state.viewer.fingertips, ...state.viewer.markers.map(marker => marker.screen)]) {
      expect(Math.abs(point[0])).toBeLessThan(1); expect(Math.abs(point[1])).toBeLessThan(1);
    }
    if (viewport.width === 320) for (const view of ['palm', 'back', 'side']) {
      await page.locator(`[data-view="${view}"]`).click();
      await expect(page.locator(`[data-view="${view}"]`)).toHaveAttribute('aria-pressed', 'true');
      const overlap = await page.evaluate(() => {
        const state = window.__gesticulatingHand.snapshot(), rect = document.querySelector('#handCanvas').getBoundingClientRect();
        const buttons = [...document.querySelectorAll('.hand-camera button')].map(button => ({ label: button.textContent, rect: button.getBoundingClientRect().toJSON() }));
        return state.viewer.markers.filter(marker => marker.finger < 5).flatMap(marker => {
          const x = rect.x + (marker.screen[0] + 1) * rect.width / 2, y = rect.y + (1 - marker.screen[1]) * rect.height / 2;
          return buttons.filter(button => x >= button.rect.left && x <= button.rect.right && y >= button.rect.top && y <= button.rect.bottom)
            .map(button => ({ finger: marker.finger, joint: marker.joint, button: button.label }));
        });
      });
      expect(overlap, `${view}: toe controls must remain outside camera buttons`).toEqual([]);
    }
    await page.locator('#source-4').scrollIntoViewIfNeeded(); await expect(page.locator('#source-4')).toBeVisible();
    await page.locator('#bodyForm').scrollIntoViewIfNeeded(); await expect(page.locator('#bodyForm')).toBeVisible();
    await chooseForm(page, 'hand'); await chooseForm(page, 'foot'); expect((await snapshot(page)).viewer.rigCount).toBe(2);
  });
}
