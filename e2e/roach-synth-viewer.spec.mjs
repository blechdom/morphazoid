import { test, expect } from '@playwright/test';

async function specimen(page, { touch = false } = {}) {
  await page.goto('/README.md');
  await page.setContent(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;background:#090d12;min-height:1800px"><canvas id="specimen" tabindex="0" aria-label="Articulated roach" style="display:block;width:100%;height:${touch ? 460 : 700}px"></canvas></body></html>`);
  await page.evaluate(async () => {
    const { createRoachViewer } = await import('/src/roach-synth-viewer.js');
    const { writeRoachPose, writeRoachSceneState, createRoachSceneState } = await import('/src/roach-synth-motion.js');
    window.interactions = [];
    window.poseChanges = [];
    window.joints = [];
    window.motion = { presetId: 'none', intensity: 1, antennae: false, tempo: 108 };
    window.motionTime = 0;
    const scene = createRoachSceneState();
    let pose = null;
    window.drawSpecimen = () => {
      pose ??= new Float32Array(joints.length * 3);
      writeRoachPose(motionTime, motion, joints, pose);
      writeRoachSceneState(motionTime, motion, scene);
      specimenViewer.setExternalPose(pose);
      specimenViewer.setSceneState(scene);
    };
    window.specimenViewer = createRoachViewer({ canvas: document.querySelector('#specimen'),
      onRig(state) { joints = state.bones; },
      onPoseChange(change) { poseChanges.push(change); joints.find((joint) => joint.id === change.id).offset = change.offset; drawSpecimen(); },
      onInteraction(change) { interactions.push(change); },
    });
    await specimenViewer.loadUrl('/assets/roach-synth/cockroach.glb');
    drawSpecimen();
  });
  await expect.poll(() => page.evaluate(() => specimenViewer.getState().renderCount)).toBeGreaterThan(0);
}

test('roach scene grounds the neutral feet, casts shadows, and keeps a chosen view through standing', async ({ page }) => {
  await specimen(page);
  const initial = await page.evaluate(() => specimenViewer.getState());
  expect(initial.ground.visible).toBe(true);
  expect(initial.ground.receivesShadow).toBe(true);
  expect(initial.lighting.selfShadow).toBe(true);
  expect(initial.lighting.exposure).toBeLessThan(1);
  expect(initial.ground.contacts).toHaveLength(6);
  for (const foot of initial.ground.contacts) expect(foot.gap).toBeLessThan(0.04);
  expect(initial.bones.filter((joint) => joint.gaitPose).length).toBe(20);
  expect(initial.bones.every((joint) => Object.values(joint.restOffset).every(Number.isFinite))).toBe(true);
  await page.evaluate(() => { motion.presetId = 'dance_upright'; motionTime = 0.4; drawSpecimen(); });
  await expect.poll(() => page.evaluate(() => specimenViewer.getState().ground.body.pitch)).toBeGreaterThan(40);
  await expect.poll(() => page.evaluate(() => specimenViewer.getState().renderCount)).toBeGreaterThan(initial.renderCount);
  expect((await page.evaluate(() => specimenViewer.getState())).camera.viewPreset).toBe('side');
  expect((await page.evaluate(() => specimenViewer.getState())).camera).toEqual(initial.camera);
  await page.evaluate(() => { motion.presetId = 'side_run'; motionTime = 1; drawSpecimen(); });
  await expect.poll(() => page.evaluate(() => specimenViewer.getState().ground.offset)).toBeGreaterThan(0);
});

test('calibrated walk and run keep a low body with moving, grounded feet across the stride', async ({ page }, testInfo) => {
  await specimen(page);
  const initial = await page.evaluate(() => specimenViewer.getState());
  const records = [];
  for (const presetId of ['side_walk', 'side_run']) {
    for (let phase = 0; phase < 12; phase += 1) {
      const renderCount = await page.evaluate(() => specimenViewer.getState().renderCount);
      await page.evaluate(({ presetId, phase }) => {
        motion.presetId = presetId;
        motionTime = phase / 12 * 60 / motion.tempo;
        drawSpecimen();
      }, { presetId, phase });
      await expect.poll(() => page.evaluate(() => specimenViewer.getState().renderCount)).toBeGreaterThan(renderCount);
      const state = await page.evaluate(() => specimenViewer.getState());
      // This support correction is calculated from the actual transformed foot
      // endpoints. A wrong knee branch used to raise the body by ~.25 lengths.
      const clearance = (state.ground.bellyHeight - state.ground.height + state.ground.groundingOffset) / state.ground.bodyLength;
      expect(clearance).toBeGreaterThan(.07);
      expect(clearance).toBeLessThan(.20);
      expect(Math.min(...state.ground.contacts.map(foot => foot.gap))).toBeGreaterThanOrEqual(-.002);
      expect(Math.min(...state.ground.contacts.map(foot => foot.gap))).toBeLessThan(.02);
      expect(state.bones.filter(joint => /^(front|middle|hind)_/.test(joint.jointId)).map(joint => joint.quaternion))
        .not.toEqual(initial.bones.filter(joint => /^(front|middle|hind)_/.test(joint.jointId)).map(joint => joint.quaternion));
      expect(state.camera).toEqual(initial.camera);
      records.push({ presetId, phase, clearance, feet: state.ground.contacts });
    }
  }
  await testInfo.attach('grounded-gait.json', { body: JSON.stringify(records), contentType: 'application/json' });
});

test('roach surface drags edit all three joint axes; background drags orbit and cancellation releases ownership', async ({ page }) => {
  await specimen(page);
  for (const [jointId, view, axis] of [['wing_cover_left', 'top', 'z'], ['head', 'face', 'x'], ['middle_left_middle', 'bottom', 'y']]) {
    await page.evaluate(({ view, axis }) => { specimenViewer.setViewPreset(view); specimenViewer.setDragAxis(axis); }, { view, axis });
    const point = await page.evaluate((id) => specimenViewer.getPartScreenPosition(id), jointId);
    expect(point).not.toBeNull();
    const before = await page.evaluate(() => specimenViewer.getState());
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + 36, point.y, { steps: 3 });
    await page.mouse.up();
    const after = await page.evaluate(() => specimenViewer.getState());
    expect(after.selectedBone).toBe(point.id);
    expect(after.bones.find((joint) => joint.id === point.id).offset[axis]).toBeGreaterThan(10);
    expect(after.camera.quaternion).toEqual(before.camera.quaternion);
    expect(after.camera.distance).toBe(before.camera.distance);
    expect(after.camera.position).toEqual(before.camera.position);
    expect(after.camera.target).toEqual(before.camera.target);
    expect(after.interaction.active).toBeNull();
  }
  await page.evaluate(() => specimenViewer.setViewPreset('side'));
  const beforeOrbit = await page.evaluate(() => specimenViewer.getState().camera.quaternion);
  await page.mouse.move(15, 20);
  await page.mouse.down();
  await page.mouse.move(95, 60, { steps: 3 });
  await page.mouse.up();
  expect(await page.evaluate(() => specimenViewer.getState().camera.quaternion)).not.toEqual(beforeOrbit);
  await page.locator('#specimen').dispatchEvent('pointerdown', { pointerId: 42, pointerType: 'touch', clientX: 20, clientY: 25, button: 0 });
  await page.locator('#specimen').dispatchEvent('pointercancel', { pointerId: 42, pointerType: 'touch' });
  expect(await page.evaluate(() => specimenViewer.getState().interaction.active)).toBeNull();
  expect(await page.evaluate(() => interactions.filter((event) => event.kind === 'joint' && event.phase === 'change').length)).toBeGreaterThanOrEqual(9);
});

test('mobile vertical swipes on the roach canvas scroll the document; horizontal joint drags remain playable', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await specimen(page, { touch: true });
  const client = await context.newCDPSession(page);
  const swipe = async (x0, y0, x1, y1) => {
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
    for (let i = 1; i <= 6; i += 1) {
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * i / 6, y: y0 + (y1 - y0) * i / 6 }] });
      await page.waitForTimeout(20);
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  expect(await page.locator('#specimen').evaluate((canvas) => canvas.style.touchAction)).toBe('pan-y');
  await swipe(175, 380, 175, 130);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(80);
  expect(await page.evaluate(() => poseChanges.length)).toBe(0);
  // A second touch stops the native fling before positioning the independent
  // horizontal gesture. Otherwise scrollTo races the browser's inertial pan.
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 20, y: 700 }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.evaluate(() => { scrollTo(0, 0); specimenViewer.setViewPreset('top'); specimenViewer.setDragAxis('z'); });
  await page.waitForTimeout(300);
  const point = await page.evaluate(() => specimenViewer.getPartScreenPosition('wing_cover_left'));
  expect(point).not.toBeNull();
  await swipe(point.x, point.y, point.x + 50, point.y);
  expect(await page.evaluate(() => poseChanges.length)).toBeGreaterThan(0);
  expect(await page.evaluate(() => scrollY)).toBe(0);
  expect(await page.evaluate(() => specimenViewer.getState().interaction.active)).toBeNull();
  await context.close();
});

test('four textured/reconstructed wings articulate independently, underside fill is view-specific, and knees stay below the back', async ({ page }) => {
  await specimen(page);
  const geometry = await page.evaluate(async () => {
    const THREE = await import('/vendor/three/three.module.min.js');
    const state = specimenViewer.getState();
    const normal = new THREE.Vector3(...state.ground.normal), matrices = new Map();
    const ranges = state.bones.map((joint) => {
      const local = new THREE.Matrix4().compose(new THREE.Vector3(...joint.kinematics.position),
        new THREE.Quaternion(...joint.quaternion), new THREE.Vector3(...joint.kinematics.scale));
      local.premultiply(joint.parent ? matrices.get(joint.parent) : new THREE.Matrix4().fromArray(joint.kinematics.parentMatrix));
      matrices.set(joint.id, local);
      return { id: joint.jointId, high: Math.max(...joint.collisionSamples.map((sample) => new THREE.Vector3(...sample).applyMatrix4(local).dot(normal))) };
    });
    return { state, ranges };
  });
  expect(geometry.state.bones).toHaveLength(31);
  expect(geometry.state.bones[7].jointId).toBe('front_left_proximal');
  expect(geometry.state.wings.independent).toBe(4);
  expect(geometry.state.wings.originalPairedMeshRemoved).toBe(true);
  expect(geometry.state.wings.fanOpen).toEqual([0, 0]);
  expect(await page.evaluate(() => specimenViewer.getPartScreenPosition('wing_hind_left'))).toBeNull();
  expect(await page.evaluate(() => specimenViewer.getPartScreenPosition('wing_hind_right'))).toBeNull();
  const carapace = Math.max(...geometry.ranges.filter((part) => part.id.startsWith('wing_cover')).map((part) => part.high));
  for (const femur of geometry.ranges.filter((part) => /^(front|middle|hind)_(left|right)_middle$/.test(part.id))) expect(femur.high).toBeLessThan(carapace);
  const clearance = (geometry.state.ground.bellyHeight - geometry.state.ground.height) / geometry.state.ground.bodyLength;
  expect(clearance).toBeGreaterThan(.11); expect(clearance).toBeLessThan(.14);
  await page.evaluate(() => specimenViewer.setViewPreset('bottom'));
  expect(await page.evaluate(() => specimenViewer.getState().lighting.bottomFill)).toBeGreaterThan(2);
  await page.evaluate(() => specimenViewer.setViewPreset('top'));
  const beforeWings = await page.evaluate(() => specimenViewer.getState().camera);
  await page.evaluate(() => {
    for (const joint of joints) {
      if (joint.wingLayer === 'cover') joint.offset = { x: 4, y: joint.wingOpenSign * 22, z: joint.wingOpenSign * 65 };
      if (joint.wingLayer === 'hind') joint.offset = { x: -4, y: joint.wingOpenSign * 12, z: joint.wingOpenSign * 40 };
    }
    drawSpecimen();
  });
  await expect.poll(() => page.evaluate(() => specimenViewer.getState().wings.fanOpen[0])).toBeGreaterThan(.5);
  expect(await page.evaluate(() => specimenViewer.getState().camera)).toEqual(beforeWings);
  // Wide wings can be fitted deliberately; opening a body part never zooms.
  await page.evaluate(() => specimenViewer.resetCamera());
  expect(await page.evaluate(() => specimenViewer.getState().lighting.bottomFill)).toBe(0);
  for (const id of ['wing_cover_left', 'wing_cover_right', 'wing_hind_left', 'wing_hind_right']) expect(await page.evaluate((part) => specimenViewer.getPartScreenPosition(part), id)).not.toBeNull();
  const before = await page.evaluate(() => specimenViewer.getState().bones.filter((joint) => joint.wingLayer).map((joint) => ({ id: joint.jointId, quaternion: joint.quaternion })));
  await page.evaluate(() => { joints.find((joint) => joint.jointId === 'wing_hind_left').offset.z += 10; drawSpecimen(); });
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => specimenViewer.getState().bones.filter((joint) => joint.wingLayer).map((joint) => ({ id: joint.jointId, quaternion: joint.quaternion })));
  for (let i = 0; i < before.length; i += 1) {
    if (before[i].id === 'wing_hind_left') expect(after[i].quaternion).not.toEqual(before[i].quaternion);
    else expect(after[i].quaternion).toEqual(before[i].quaternion);
  }
  const constrained = await page.evaluate(async () => {
    const { constrainRoachPose } = await import('/src/roach-synth-motion.js');
    const pose = new Float32Array(joints.length * 3);
    joints.forEach((joint, i) => ['x', 'y', 'z'].forEach((axis, a) => { pose[i * 3 + a] = joint.restOffset[axis]; }));
    const wing = joints.findIndex((joint) => joint.jointId === 'wing_cover_left');
    pose[wing * 3 + 1] = -50; pose[wing * 3 + 2] = -90;
    constrainRoachPose(pose, joints);
    return { y: pose[wing * 3 + 1], z: pose[wing * 3 + 2], finite: Array.from(pose).every(Number.isFinite) };
  });
  expect(constrained).toEqual({ y: 0, z: 0, finite: true });
});

test('only explicit zoom controls change camera distance; wheel scrolling, resizing and invalid factors do not', async ({ page }) => {
  await specimen(page);
  const before = await page.evaluate(() => specimenViewer.getState().camera);
  expect(await page.evaluate(() => [0, -1, NaN, Infinity, undefined, '0.8'].map((factor) => specimenViewer.zoom(factor)))).toEqual(Array(6).fill(false));
  expect(await page.evaluate(() => specimenViewer.getState().camera)).toEqual(before);
  const wheel = await page.evaluate(() => {
    const canvas = document.querySelector('#specimen');
    return [false, true].map((ctrlKey) => {
      const event = new WheelEvent('wheel', { deltaY: 150, ctrlKey, bubbles: true, cancelable: true });
      canvas.dispatchEvent(event);
      return event.defaultPrevented;
    });
  });
  expect(wheel).toEqual([false, true]);
  expect(await page.evaluate(() => specimenViewer.getState().camera)).toEqual(before);
  await page.mouse.move(20, 40);
  await page.mouse.wheel(0, 250);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(100);
  expect(await page.evaluate(() => specimenViewer.getState().camera.distance)).toBe(before.distance);
  await page.evaluate(() => { scrollTo(0, 0); document.querySelector('#specimen').focus({ preventScroll: true }); });
  await page.keyboard.press('+');
  expect(await page.evaluate(() => specimenViewer.getState().camera.distance)).toBeCloseTo(before.distance * .87, 10);
  expect(await page.evaluate(() => specimenViewer.zoom(.8))).toBe(true);
  await page.keyboard.press('-');
  const zoomed = await page.evaluate(() => specimenViewer.getState());
  expect(zoomed.camera.distance).toBeCloseTo(before.distance * .87 * .8 * 1.15, 10);
  expect(zoomed.camera.quaternion).toEqual(before.quaternion);
  expect(zoomed.camera.target).toEqual(before.target);
  await page.setViewportSize({ width: 940, height: 720 });
  await expect.poll(() => page.evaluate(() => specimenViewer.getState().renderCount)).toBeGreaterThan(zoomed.renderCount);
  expect(await page.evaluate(() => specimenViewer.getState().camera)).toEqual(zoomed.camera);
});

test('two-finger churn cancels touch manipulation without zooming or restarting a remaining finger', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  try {
    await specimen(page, { touch: true });
    await page.evaluate(() => specimenViewer.setTouchInteraction(true));
    const client = await context.newCDPSession(page);
    const touch = (type, points) => client.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([id, x, y]) => ({ id, x, y })) });
    const initial = await page.evaluate(() => specimenViewer.getState().camera);
    await touch('touchStart', [[11, 20, 25]]);
    await touch('touchMove', [[11, 55, 35]]);
    const orbit = await page.evaluate(() => specimenViewer.getState().camera);
    expect(orbit.distance).toBe(initial.distance);
    expect(orbit.quaternion).not.toEqual(initial.quaternion);
    await touch('touchStart', [[11, 55, 35], [22, 125, 35]]);
    await touch('touchMove', [[11, 15, 130], [22, 245, 170]]);
    await touch('touchEnd', [[22, 245, 170]]);
    await touch('touchMove', [[22, 290, 215]]);
    await touch('touchStart', [[22, 290, 215], [33, 80, 250]]);
    await touch('touchEnd', [[33, 80, 250]]);
    await touch('touchMove', [[33, 120, 280]]);
    await touch('touchEnd', []);
    const after = await page.evaluate(() => specimenViewer.getState());
    expect(after.camera).toEqual(orbit);
    expect(after.interaction.active).toBeNull();
    expect(after.interaction.pointerCount).toBe(0);
    expect(await page.evaluate(() => interactions.some((event) => event.phase === 'cancel'))).toBe(true);
    expect(await page.evaluate(() => scrollY)).toBe(0);
    // After every finger is released, a new single-finger joint gesture works.
    await page.evaluate(() => { specimenViewer.setViewPreset('top'); specimenViewer.setDragAxis('z'); });
    const part = await page.evaluate(() => specimenViewer.getPartScreenPosition('wing_cover_left'));
    expect(part).not.toBeNull();
    const jointCamera = await page.evaluate(() => specimenViewer.getState().camera);
    await touch('touchStart', [[44, part.x, part.y]]);
    await touch('touchMove', [[44, part.x + 30, part.y]]);
    await touch('touchEnd', []);
    await expect.poll(() => page.evaluate(() => poseChanges.length)).toBeGreaterThan(0);
    const edited = await page.evaluate(() => specimenViewer.getState());
    expect(edited.selectedBone).toBe(part.id);
    expect(edited.camera).toEqual(jointCamera);
    expect(edited.interaction.active).toBeNull();
    expect(edited.interaction.pointerCount).toBe(0);
  } finally { await context.close(); }
});
