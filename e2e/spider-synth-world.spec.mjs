import { expect, test } from '@playwright/test';
import { installFakeMidi, enableFakeMidi, sendMidi, MIDI_BYTES } from './helpers/fake-midi.mjs';

test.setTimeout(90000);
const state = page => page.evaluate(() => window.spiderSynth.getState());
async function open(page) {
  await page.goto('spider-synth.html');
  await page.waitForFunction(() => window.spiderSynth?.getState().loaded, undefined, { timeout: 45000 });
}
async function arm(page) {
  await page.locator('#audioButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true', { timeout: 15000 });
}
async function setRange(page, id, value) {
  await page.locator(`#${id}`).evaluate((input, value) => { input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true })); }, value);
}
async function webHub(page) {
  return page.evaluate(async () => {
    const { createSpiderWeb } = await import('./src/spider-synth-web.js');
    return createSpiderWeb(window.spiderSynth.getState().webSettings).nodes.find(node => node.role === 'hub');
  });
}

test('every sound preset preserves the web, held pose, travel and both players', async ({ page }) => {
  await open(page);
  await page.locator('#webPreset').selectOption('missing-sector');
  await page.locator('#motionPreset').selectOption('backpedal');
  await page.locator('#catchBug').click();
  await expect.poll(async () => (await state(page)).world.prey.at(-1)?.state).toBe('trapped');
  await arm(page); await page.locator('#soundPlayButton').click();
  const before = await state(page);
  const ids = await page.locator('#soundPreset option').evaluateAll(options => options.map(option => option.value));
  for (const id of ids) {
    await page.locator('#soundPreset').selectOption(id);
    const after = await state(page);
    expect(after.webSettings, id).toEqual(before.webSettings);
    expect(after.worldSettings, id).toEqual(before.worldSettings);
    expect(after.world.graphVersion, id).toBe(before.world.graphVersion);
    expect(after.world.prey.map(prey => prey.id), id).toEqual(before.world.prey.map(prey => prey.id));
    expect(after.motionSettings, id).toEqual(before.motionSettings);
    expect(after.frame.body, id).toEqual(before.frame.body);
    expect(after.frame.feet, id).toEqual(before.frame.feet);
    expect(after.time, id).toBe(before.time);
    expect(after.camera, id).toEqual(before.camera);
    expect(after.playing, id).toBe(false); expect(after.soundPlaying, id).toBe(true);
  }
  await page.locator('#motionButton').click();
  await expect.poll(async () => (await state(page)).audio.contactEvents).toBeGreaterThan(3);
  const moving = await state(page);
  await page.locator('#soundPreset').selectOption(ids[1]);
  await page.locator('#randomSound').click();
  await expect.poll(async () => (await state(page)).time).toBeGreaterThan(moving.time + .2);
  const after = await state(page);
  expect(after.motionSettings).toEqual(moving.motionSettings);
  expect(after.webSettings).toEqual(moving.webSettings);
  expect(after.world.graphVersion).toBe(moving.world.graphVersion);
  expect(after.playing).toBe(true); expect(after.soundPlaying).toBe(true);
});

test('Argiope web and construction controls change geometry without changing players or camera', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await open(page); const initial = await state(page);
  expect(initial.webSettings.preset).toBe('argiope');
  const families = await page.locator('#webPreset option').evaluateAll(options => options.map(item => item.value));
  expect(families.length).toBeGreaterThanOrEqual(17);
  const graphs = new Set();
  for (const preset of families) {
    await page.locator('#webPreset').selectOption(preset);
    const s = await state(page); graphs.add(JSON.stringify(s.web));
    expect(s.web.nodes).toBeLessThanOrEqual(1200); expect(s.web.segments).toBeLessThanOrEqual(2400);
    expect(s.frame.feet.every(foot => Number.isFinite(foot.y))).toBe(true);
    expect(s.camera).toEqual(initial.camera); expect(s.playing).toBe(false); expect(s.soundPlaying).toBe(false);
  }
  expect(graphs.size).toBeGreaterThan(5);
  for (const id of ['anchors', 'spacing', 'asymmetry', 'twist', 'irregularity', 'depth', 'stabilimentum', 'texture', 'slide', 'flutter', 'space', 'pluckRegister', 'pluckSpread', 'pluckAttack', 'pluckHold', 'pluckRelease']) await expect(page.locator(`#${id}`)).toBeEnabled();
  expect(errors).toEqual([]);
});

test('joystick lays playable silk while both players stay stopped, then Audio preserves the route', async ({ page }) => {
  await open(page); await page.locator('#laySilk').click();
  await setRange(page, 'travelSpeed', 2);
  const initial = await state(page);
  await page.locator('#webJoystick').focus(); await page.keyboard.down('ArrowRight');
  await expect.poll(async () => (await state(page)).frame.body.x).toBeLessThan(initial.frame.body.x - .08);
  await page.keyboard.up('ArrowRight');
  const stopped = await state(page);
  expect(stopped.world.silkSegments.length).toBeGreaterThan(2);
  expect(stopped.playing).toBe(false); expect(stopped.soundPlaying).toBe(false);
  expect(stopped.camera).toEqual(initial.camera); expect(stopped.navigation.active).toBe(false);
  await arm(page);
  await expect.poll(async () => (await state(page)).audio.world?.silkSegments.length).toBeGreaterThan(2);
  expect(Math.abs((await state(page)).frame.body.x - stopped.frame.body.x)).toBeLessThan(.03);
  await page.locator('#clearSilk').click();
  await expect.poll(async () => (await state(page)).world.silkSegments.length).toBe(0);
  await page.locator('#homeSpider').click();
  const hub = await webHub(page);
  await expect.poll(async () => {
    const body = (await state(page)).frame.body;
    return Math.hypot(body.x - hub.x, body.z - hub.z);
  }).toBeLessThan(.00001);
});

test('manual travel makes worklet foot contacts, while release and blur stop steering', async ({ page }) => {
  await open(page); await arm(page); await setRange(page, 'travelSpeed', 2);
  await page.locator('#webJoystick').focus(); await page.keyboard.down('ArrowUp');
  await expect.poll(async () => (await state(page)).audio.contactEvents).toBeGreaterThan(3);
  expect((await state(page)).playing).toBe(false); expect((await state(page)).soundPlaying).toBe(false);
  await page.locator('#phrase').focus(); await page.keyboard.up('ArrowUp');
  await expect.poll(async () => (await state(page)).worldSettings.joystick).toEqual({ x: 0, z: 0 });
  const stopped = (await state(page)).frame.body;
  await page.waitForTimeout(400);
  expect(Math.abs((await state(page)).frame.body.z - stopped.z)).toBeLessThan(.01);
});

test('Home reaches an eccentric hub with Animation stopped and preserves it when Audio starts', async ({ page }) => {
  await open(page); await page.locator('#webPreset').selectOption('eccentric');
  const hub = await webHub(page);
  expect(Math.hypot(hub.x, hub.z)).toBeGreaterThan(.1);
  await page.locator('#homeSpider').click();
  const gap = async () => {
    const body = (await state(page)).frame.body;
    return Math.hypot(body.x - hub.x, body.z - hub.z);
  };
  await expect.poll(gap).toBeLessThan(.00001);
  await arm(page); await expect.poll(gap).toBeLessThan(.00001);
  expect((await state(page)).playing).toBe(false);
  expect((await state(page)).soundPlaying).toBe(false);
});

test('real worklet foot attacks retain the planned leg, strand, position and sample-clock time', async ({ page }) => {
  await open(page); await arm(page);
  await page.locator('#motionPreset').selectOption('orb-walk');
  await setRange(page, 'tempo', 137);
  await page.locator('#motionButton').click();
  await expect.poll(async () => (await state(page)).audio.contactEvents).toBeGreaterThan(8);
  const s = await state(page), audio = s.audio;
  const ledger = audio.world.locomotion.footEvents;
  const matches = audio.recentEvents.filter(event => event.footSerial != null)
    .map(event => ({ event, planned: ledger.find(item => item.serial === event.footSerial) }))
    .filter(({ planned }) => planned);
  expect(matches.length).toBeGreaterThan(0);
  for (const { event, planned } of matches) {
    expect(event.legIndex).toBe(planned.legIndex);
    expect(event.kind).toBe(planned.kind);
    expect(event.segmentId).toBe(planned.segmentId);
    expect(event.u).toBeCloseTo(planned.u, 9);
    expect(event.sourceTime).toBeCloseTo(planned.time, 9);
    expect(Math.abs(event.audioTime - planned.time)).toBeLessThanOrEqual(1 / 44100);
  }
  expect(audio.pullEvents).toBeGreaterThan(0);
  expect(audio.lateFootEvents).toBe(0);
  expect(s.frame.supportCount).toBeGreaterThanOrEqual(4);
});

test('tempo accelerates body travel and steps together during manual steering', async ({ page }) => {
  await open(page); await arm(page); await setRange(page, 'travelSpeed', .45);
  async function travel(tempo) {
    await page.locator('#homeSpider').click(); await setRange(page, 'tempo', tempo);
    await page.locator('#webJoystick').focus(); await page.keyboard.down('ArrowUp');
    const result = await page.evaluate(async () => {
      let prior = window.spiderSynth.getState().frame.body, distance = 0;
      const start = performance.now(), contacts = window.spiderSynth.getState().audio.contactEvents;
      while (performance.now() - start < 1800) {
        await new Promise(resolve => setTimeout(resolve, 25));
        const body = window.spiderSynth.getState().frame.body;
        distance += Math.hypot(body.x - prior.x, body.z - prior.z); prior = body;
      }
      return { distance, contacts: window.spiderSynth.getState().audio.contactEvents - contacts };
    });
    await page.keyboard.up('ArrowUp'); return result;
  }
  const slow = await travel(60), fast = await travel(300);
  expect(slow.distance).toBeGreaterThan(.005);
  expect(fast.distance).toBeGreaterThan(slow.distance * 2);
  expect(fast.contacts).toBeGreaterThan(slow.contacts * 2);
  expect((await state(page)).playing).toBe(false);
});

test('MIDI travel retains body-pose ownership and sustain cannot latch steering', async ({ page }) => {
  await installFakeMidi(page); await open(page); await enableFakeMidi(page);
  if (!(await state(page)).audioOn) await arm(page);
  await page.locator('#midiNoteMode').selectOption('travel');
  await sendMidi(page, MIDI_BYTES.noteOn(63, 110));
  await expect.poll(async () => (await state(page)).worldSettings.joystick.x).toBeLessThan(-.5);
  await expect.poll(async () => (await state(page)).frame.body.x).toBeLessThan(-.03);
  await sendMidi(page, [0xb0, 64, 127]); await sendMidi(page, MIDI_BYTES.noteOff(63));
  await expect.poll(async () => (await state(page)).worldSettings.joystick).toEqual({ x: 0, z: 0 });
  const s = await state(page); expect(s.playing).toBe(false); expect(s.soundPlaying).toBe(false);
  await page.locator('#midiPanic').click();
  await expect.poll(async () => (await state(page)).midi.activeCount).toBe(0);
});

test('automatic paths preserve jump and dance choices and span the web', async ({ page }) => {
  await open(page); await setRange(page, 'travelSpeed', 2); await setRange(page, 'tempo', 300);
  await page.locator('#motionPreset').selectOption('web-jump'); await page.locator('#motionButton').click();
  await expect.poll(async () => (await state(page)).frame.airborne, { timeout: 10000, intervals: [70] }).toBe(true);
  // Acrobatics keep their own pose; the running patch recalls a travel route.
  await page.locator('#motionPreset').selectOption('radial-run');
  const origin = (await state(page)).frame.body;
  await expect.poll(async () => {
    const body = (await state(page)).frame.body;
    return Math.hypot(body.x - origin.x, body.z - origin.z);
  }, { timeout: 10000 }).toBeGreaterThan(.15);
  await page.locator('#motionPreset').selectOption('macarena');
  const first = (await state(page)).frame.pose;
  await expect.poll(async () => JSON.stringify((await state(page)).frame.pose)).not.toBe(JSON.stringify(first));
  expect((await state(page)).motionSettings.preset).toBe('macarena');
});

test('a trapped fly can be hunted with Animation paused and topology changes clear attachments', async ({ page }) => {
  await open(page); await arm(page); await setRange(page, 'travelSpeed', 2);
  await page.locator('#catchBug').click();
  await expect.poll(async () => (await state(page)).world.prey.at(-1)?.state).toBe('trapped');
  const preyPoint = await page.evaluate(() => window.spiderSynth.getPreyScreenPosition(window.spiderSynth.getState().world.prey.at(-1).id));
  expect(preyPoint.visible).toBe(true); await page.mouse.click(preyPoint.x, preyPoint.y);
  await expect.poll(async () => (await state(page)).world.prey.at(-1)?.state, { timeout: 15000 }).toBe('eaten');
  expect((await state(page)).playing).toBe(false); expect((await state(page)).soundPlaying).toBe(false);
  await page.locator('#catchBug').click(); await page.locator('#webPreset').selectOption('dome');
  await expect.poll(async () => (await state(page)).world.prey.length).toBe(0);
  await expect.poll(async () => (await state(page)).audio.world?.prey.length).toBe(0);
});

test('phone steering owns only the pad and releases cleanly without zooming or starting players', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const page = await context.newPage(); await page.goto(new URL('spider-synth.html', baseURL.endsWith('/') ? baseURL : `${baseURL}/`).href);
    await page.waitForFunction(() => window.spiderSynth?.getState().loaded, undefined, { timeout: 45000 });
    await page.locator('#webJoystick').scrollIntoViewIfNeeded(); const box = await page.locator('#webJoystick').boundingBox();
    const before = await state(page), scroll = await page.evaluate(() => scrollY), session = await context.newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + 82, y: box.y + 51 }] });
    await expect.poll(async () => (await state(page)).frame.body.x).toBeLessThan(before.frame.body.x - .025);
    await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await expect.poll(async () => (await state(page)).navigation.active).toBe(false);
    const after = await state(page); expect(after.camera).toEqual(before.camera); expect(after.playing).toBe(false); expect(after.soundPlaying).toBe(false);
    expect(await page.evaluate(() => scrollY)).toBe(scroll);
    await page.locator('#webPreset').scrollIntoViewIfNeeded(); expect(await page.evaluate(() => scrollY)).toBeGreaterThan(scroll);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390); await session.detach();
  } finally { await context.close(); }
});
