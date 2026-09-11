import { expect, test } from "@playwright/test";
import { readAudioStatus, sampleAudioEnvelope, waitForStableAudioState } from "./helpers/audio-probe.mjs";
import { installFakeMidi, enableFakeMidi, sendMidi, MIDI_BYTES } from "./helpers/fake-midi.mjs";

test.setTimeout(60_000);
const snapshot = (page) => page.evaluate(() => window.roachSynth.getState());
async function openRoach(page) {
  await page.goto("roach-synth.html");
  await page.waitForFunction(() => window.roachSynth?.getState().loaded, undefined, { timeout: 45_000 });
  await expect(page.locator("#bodyPart option")).toHaveCount(27);
}
async function arm(page) {
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true", { timeout: 10_000 });
}

test("four anatomical views retain free orbit, side choice, face target and deterministic reset", async ({ page }) => {
  const failures = [];
  page.on("requestfailed", (request) => failures.push(request.url()));
  await openRoach(page);
  expect(failures).toEqual([]);
  const initial = await snapshot(page);
  expect(initial.playing).toBe(false);
  expect(initial.audio.contextState).toBe("uninitialized");
  expect(initial.mappings).toHaveLength(27);
  const cameras = [];
  for (const view of ["side", "top", "bottom", "face"]) {
    await page.locator(`[data-view="${view}"]`).click();
    const current = await snapshot(page);
    expect(current.camera.viewPreset).toBe(view);
    cameras.push(current.camera);
  }
  expect(new Set(cameras.map((camera) => JSON.stringify(camera.quaternion))).size).toBe(4);
  expect(cameras[3].target).not.toEqual(cameras[0].target);
  expect(cameras[3].distance).toBeLessThan(cameras[0].distance);
  await page.locator('[data-view="side"]').click();
  await page.locator("#sideToggle").click();
  expect((await snapshot(page)).camera.side).toBe("right");
  const before = (await snapshot(page)).camera;
  const canvas = page.locator("#roachCanvas"); const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width * .04, box.y + box.height * .12);
  await page.mouse.down(); await page.mouse.move(box.x + box.width * .16, box.y + box.height * .20, { steps: 6 }); await page.mouse.up();
  expect((await snapshot(page)).camera.quaternion).not.toEqual(before.quaternion);
  await canvas.focus(); await page.keyboard.press("+");
  expect((await snapshot(page)).camera.distance).toBeLessThan(before.distance);
  await page.locator("#resetCamera").click();
  expect((await snapshot(page)).camera).toEqual(before);
});

test("all 24 animation patches switch live without selecting a camera or arming audio", async ({ page }) => {
  test.setTimeout(120000);
  await openRoach(page);
  await expect(page.locator(".roach-panel #motionButton")).toBeVisible();
  await expect(page.locator("#motionPreset option")).toHaveCount(25);
  await page.locator('[data-view="top"]').click();
  const camera = (await snapshot(page)).camera;
  await page.locator("#motionButton").click();
  await expect(page.locator("#liveStatus")).toContainText("Audio is off");
  const ids = await page.locator("#motionPreset option").evaluateAll(options => options.map(o => o.value).filter(id => id !== 'none'));
  for (const id of ids) {
    await page.locator("#motionPreset").selectOption(id);
    const current = await snapshot(page);
    expect(current.motionSettings.presetId).toBe(id);
    expect(current.playing).toBe(true);
    expect(current.view).toBe("top");
    expect(current.camera.quaternion).toEqual(camera.quaternion);
  }
  const moving = await snapshot(page);
  await expect.poll(async () => (await snapshot(page)).bones.filter((part) => /antenna/i.test(part.name)).map((part) => part.quaternion)).not.toEqual(moving.bones.filter((part) => /antenna/i.test(part.name)).map((part) => part.quaternion));
  expect((await snapshot(page)).audio.contextState).toBe("uninitialized");
  await page.locator("#motionButton").click();
  await page.waitForTimeout(150);
  const paused = await snapshot(page);
  await page.waitForTimeout(150);
  expect((await snapshot(page)).time).toBe(paused.time);
  expect((await snapshot(page)).bones.map((part) => part.quaternion)).toEqual(paused.bones.map((part) => part.quaternion));
});

test("each part retains pose and editable multi-axis routes, and reset clears motion without erasing routes", async ({ page }) => {
  await openRoach(page);
  await page.locator("#bodyPart").selectOption({ label: "Head" });
  await page.locator("#poseX").fill("20");
  await page.locator("#addMapping").click();
  await expect(page.locator(".roach-mapping")).toHaveCount(2);
  const row = page.locator(".roach-mapping").last();
  await row.locator("select").nth(0).selectOption("xz");
  await row.locator("select").nth(1).selectOption("pitch");
  await row.locator('input[type="range"]').fill("0.8");
  const head = (await snapshot(page)).bones.find((part) => part.name === "Head");
  await page.locator("#bodyPart").selectOption({ label: "Left antenna" });
  await page.locator("#bodyPart").selectOption({ label: "Head" });
  await expect(page.locator("#poseX")).toHaveValue("20");
  expect((await snapshot(page)).mappings.find((route) => route.jointId === head.id && route.source === "xz")).toMatchObject({ target: "pitch", amount: .8 });
  await page.locator("#resetPose").click();
  const reset = await snapshot(page);
  expect(reset.playing).toBe(false);
  expect(reset.motionSettings.presetId).toBe("none");
  expect(reset.bones.every((part) => Object.values(part.offset).every((value) => value === 0) && !part.motion.enabled)).toBe(true);
  expect(reset.mappings).toHaveLength(28);
});

test("sixteen-step joint tracks retain independent XYZ edits, loop, save and recall without camera changes", async ({ page }) => {
  await openRoach(page);
  await page.locator('[data-view="bottom"]').click();
  await page.locator("#motionPreset").selectOption("none");
  await page.locator("#antennae").uncheck();
  await page.locator("#sequenceJoint").selectOption({ label: "Head" });
  const head = (await snapshot(page)).bones.find(part => part.name === "Head");
  await page.locator('#sequenceAxes [data-axis="x"]').click();
  await page.locator('#sequenceSteps [data-step="0"]').click();
  await page.locator("#stepRotation").fill("25");
  await page.locator('#sequenceSteps [data-step="8"]').click();
  await page.locator("#stepRotation").fill("-18");
  await page.locator("#poseX").fill("7");
  await page.locator("#captureStep").click();
  await expect(page.locator("#poseX")).toHaveValue("0");
  await page.locator('#sequenceAxes [data-axis="z"]').click();
  await page.locator("#waveTrack").click();
  await page.locator("#sequenceJoint").selectOption({ label: "Left antenna" });
  await page.locator('#sequenceAxes [data-axis="y"]').click();
  await page.locator("#stepRotation").fill("12");
  const tracks = (await snapshot(page)).motionSettings.tracks;
  expect(tracks).toHaveLength(3);
  expect(tracks.find(track => track.jointId === head.id && track.axis === 'x').steps[0]).toBe(25);
  expect(tracks.find(track => track.jointId === head.id && track.axis === 'x').steps[8]).toBe(-11);
  await page.locator("#timelinePosition").fill("0");
  const first = (await snapshot(page)).bones.find(part => part.id === head.id).quaternion;
  await page.locator("#timelinePosition").fill("8");
  expect((await snapshot(page)).bones.find(part => part.id === head.id).quaternion).not.toEqual(first);
  expect((await snapshot(page)).view).toBe("bottom");
  await page.locator("#motionButton").click();
  await page.locator("#motionPreset").selectOption("dance_upright");
  expect((await snapshot(page)).playing).toBe(true);
  expect((await snapshot(page)).view).toBe("bottom");
  await page.locator("#motionPreset").selectOption("none");
  expect((await snapshot(page)).motionSettings.tracks).toEqual(tracks);
  // Save one of the 24 routine slots, then verify browser reload persistence.
  await page.locator("#motionPreset").selectOption("side_walk");
  await page.locator("#waveTrack").click();
  await page.locator("#savePatch").click();
  const saved = (await snapshot(page)).motionSettings.tracks;
  await page.reload();
  await page.waitForFunction(() => window.roachSynth?.getState().loaded);
  expect((await snapshot(page)).motionSettings.tracks).toEqual(saved);
  expect((await snapshot(page)).playing).toBe(false);
});

test("real worklet audio is bounded, follows transport through a stalled renderer, and mutes independently", async ({ page }, testInfo) => {
  await openRoach(page);
  await page.locator("#motionButton").click();
  expect((await readAudioStatus(page)).active).toBe(false);
  await arm(page);
  await expect.poll(async () => (await snapshot(page)).audio.peak).toBeGreaterThan(.001);
  const envelope = await sampleAudioEnvelope(page, { durationMs: 500 });
  expect(envelope.summary.finite).toBe(true); expect(envelope.summary.clippedSamples).toBe(0);
  expect(envelope.summary.maxPeak).toBeGreaterThan(.001);
  const before = await snapshot(page);
  await page.evaluate(() => { const until = performance.now() + 700; while (performance.now() < until) { /* emulate a blocked graphics/UI thread */ } });
  await expect.poll(async () => (await snapshot(page)).audio.renderedFrames).toBeGreaterThan(before.audio.renderedFrames + 16000);
  const after = await snapshot(page);
  expect(after.time - before.time).toBeGreaterThan(.6);
  expect(Math.abs(after.audio.motionTime - after.time)).toBeLessThan(.4);
  await page.locator("#motionButton").click();
  await expect.poll(async () => (await snapshot(page)).audio.peak).toBeLessThan(.0001);
  await page.locator("#motionButton").click();
  await page.locator("#audioButton").click();
  expect((await snapshot(page)).playing).toBe(true);
  await waitForStableAudioState(page, false);
  await testInfo.attach("roach-audio-envelope.json", { body: JSON.stringify({ envelope: envelope.summary, before: before.audio, after: after.audio }), contentType: "application/json" });
});

test("spoken words enter the same audio graph while the motion is paused", async ({ page }) => {
  await openRoach(page);
  await expect(page.locator('.roach-voice .group-title')).toHaveText('VOICE');
  await expect(page.locator('#phrase')).toHaveValue("hi, I'm a cockroach and I live in your house");
  await expect(page.locator('#phrase')).toHaveJSProperty('tagName', 'TEXTAREA');
  await page.locator("#speakButton").click();
  expect((await snapshot(page)).audio.contextState).toBe("uninitialized");
  await arm(page);
  await page.locator("#soundPreset").selectOption("crunchy-orator");
  await page.locator("#phrase").fill("hello tiny robot bug");
  await page.locator("#speakButton").click();
  await expect.poll(async () => (await snapshot(page)).audio.speechEnvelope, { timeout: 12000 }).toBeGreaterThan(.0001);
  expect((await snapshot(page)).playing).toBe(false);
  const envelope = await sampleAudioEnvelope(page, { durationMs: 400 });
  expect(envelope.summary.maxPeak).toBeGreaterThan(.001);
  expect(envelope.summary.clippedSamples).toBe(0);
  await page.locator("#audioButton").click();
  await waitForStableAudioState(page, false);
});

test("explicit MIDI input reaches pitch and transport through the shared controls", async ({ page }) => {
  await installFakeMidi(page);
  await openRoach(page);
  await enableFakeMidi(page);
  await sendMidi(page, MIDI_BYTES.noteOn(69, 100));
  await expect(page.locator("#pitch")).toHaveValue("440");
  await expect(page.locator("#motionButton")).toHaveAttribute("aria-pressed", "true");
  expect((await snapshot(page)).sound.pitch).toBe(440);
});

test("invalid local model preserves the cockroach and makes no external requests", async ({ page }) => {
  await openRoach(page);
  const requests = []; const origin = new URL(page.url()).origin;
  page.on("request", (request) => { if (new URL(request.url()).origin !== origin) requests.push(request.url()); });
  await page.locator("#modelFile").setInputFiles({ name: "broken.glb", mimeType: "model/gltf-binary", buffer: Buffer.from("not a glb") });
  await expect(page.locator("#modelStatus")).toContainText("current model is still available");
  expect((await snapshot(page)).bones).toHaveLength(27); expect(requests).toEqual([]);
});

test("download failure keeps the preview visible and retry restores the full instrument", async ({ page }) => {
  await page.route("**/assets/roach-synth/cockroach.glb", (route) => route.fulfill({ status: 503, body: "Unavailable" }));
  await page.goto("roach-synth.html");
  await expect(page.locator("#modelStatus")).toContainText("503");
  await expect(page.locator("#specimenImage")).toBeVisible(); await expect(page.locator("#roachCanvas")).toBeHidden();
  await page.unroute("**/assets/roach-synth/cockroach.glb"); await page.locator("#retryModel").click();
  await expect(page.locator("#bodyPart option")).toHaveCount(27, { timeout: 45_000 });
  await expect(page.locator("#roachCanvas")).toBeVisible();
  expect((await snapshot(page)).mappings).toHaveLength(27);
});

test("invalid import during startup cannot hide a subsequently loaded model", async ({ page }) => {
  let release; const gate = new Promise((resolve) => { release = resolve; });
  await page.route("**/assets/roach-synth/cockroach.glb", async (route) => { await gate; await route.continue(); });
  await page.goto("roach-synth.html"); await page.waitForFunction(() => Boolean(window.roachSynth));
  await page.locator("#modelFile").setInputFiles({ name: "wrong.obj", mimeType: "text/plain", buffer: Buffer.from("wrong") });
  await expect(page.locator("#modelStatus")).toContainText("self-contained .glb"); release();
  await expect(page.locator("#bodyPart option")).toHaveCount(27, { timeout: 45_000 });
  await expect(page.locator("#specimenImage")).toBeHidden(); await expect(page.locator("#roachCanvas")).toBeVisible();
});

test("grabbing body parts plays them with animation paused, while background dragging only orbits", async ({ page }) => {
  await openRoach(page);
  await arm(page);
  expect((await snapshot(page)).playing).toBe(false);
  await expect.poll(async () => (await snapshot(page)).audio.peak).toBeLessThan(.0001);
  for (const target of [{ view: 'face', match: '^Head$', axis: 'x' }, { view: 'top', match: 'wing', axis: 'z' }, { view: 'side', match: 'leg', axis: 'y' }]) {
    await page.locator(`[data-view="${target.view}"]`).click();
    await page.locator('#dragAxis').selectOption(target.axis);
    const candidate = await page.evaluate(({ match }) => {
      for (const part of window.roachSynth.getState().bones.filter(part => new RegExp(match, 'i').test(part.name))) {
        const point = window.roachSynth.getPartScreenPosition(part.id);
        if (point) return { id: part.id, point };
      }
      return null;
    }, target);
    expect(candidate).not.toBeNull();
    const before = await snapshot(page);
    await page.mouse.move(candidate.point.x, candidate.point.y); await page.mouse.down();
    for (let step = 1; step <= 12; step++) {
      await page.mouse.move(candidate.point.x + step * 5, candidate.point.y - step * 2);
      await page.waitForTimeout(45);
    }
    const moved = await snapshot(page);
    expect(moved.selectedBone).toBe(candidate.id);
    expect(moved.camera.quaternion).toEqual(before.camera.quaternion);
    expect(moved.bones.find(part => part.id === candidate.id).offset).not.toEqual(before.bones.find(part => part.id === candidate.id).offset);
    expect(moved.audio.interactionPeak, `${target.match} motion must produce sound while moving`).toBeGreaterThan(.001);
    await page.mouse.up();
    expect((await snapshot(page)).playing).toBe(false);
    await expect.poll(async () => (await snapshot(page)).audio.peak).toBeLessThan(.0001);
  }
});

for (const size of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`touch scrolling at ${size.width}×${size.height} keeps the roach sticky and controls reachable`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: size, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:3435/roach-synth.html');
    await page.waitForFunction(() => window.roachSynth?.getState().loaded, undefined, { timeout: 45000 });
    const cdp = await context.newCDPSession(page);
    async function swipe(x, from, to) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: from }] });
      for (let i = 1; i <= 10; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: from + (to - from) * i / 10 }] });
        await page.waitForTimeout(16);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(250);
    }
    try {
      const canvas = await page.locator('#roachCanvas').boundingBox();
      await swipe(size.width * .45, canvas.y + canvas.height * .85, canvas.y + canvas.height * .15);
      await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(30);
      await expect.poll(() => page.locator('#specimenViewport').evaluate(element => Math.round(element.getBoundingClientRect().top))).toBe(0);
      const height = await page.locator('#specimenViewport').evaluate(element => element.getBoundingClientRect().height);
      const before = await page.evaluate(() => scrollY);
      await swipe(size.width - 10, size.height - 20, Math.max(height + 10, size.height * .55));
      await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(before);
      const after = await page.evaluate(() => scrollY);
      await swipe(size.width - 10, height + 12, size.height - 15);
      await expect.poll(() => page.evaluate(() => scrollY)).toBeLessThan(after);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(size.width);
      for (const selector of ['#audioButton', '#motionButton']) {
        const box = await page.locator(selector).boundingBox(); expect(box.width).toBeGreaterThanOrEqual(48); expect(box.height).toBeGreaterThanOrEqual(48);
      }
      await expect(page.locator('.roach-panel #motionButton')).toHaveCount(1);
      expect((await snapshot(page)).audio.contextState).toBe('uninitialized');
    } finally { await context.close(); }
  });
}
