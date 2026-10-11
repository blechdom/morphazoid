import { test, expect } from '@playwright/test';

const animalHandle = page => page.locator('.quadruped-animal-handle[data-gesture-actor="0"]');
const capture = page => page.evaluate(async () => (await import('/src/site/header-presets.js')).captureHeaderPresetState().snapshot);
const read = page => page.evaluate(() => globalThis.__quadrupedMotionEnvelopeProbe.read());
const audioStatus = page => page.evaluate(async () => (await import('/src/audio-output-manager.js')).getSharedAudioOutputManager().getStatus());

async function openInstrument(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // Observe the voices and gain actually queued by real browser interactions.
  // The clock, scheduler and synthesis implementations remain untouched.
  await page.route('**/src/instruments/quadruped/quadruped-app.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
      const envelopeContacts = [], envelopeBuffers = new WeakMap();
      let envelopeResets = 0, envelopeBufferId = 0;
      const originalEnvelopeReset = resetAudioSchedule;
      resetAudioSchedule = (...args) => { envelopeResets++; return originalEnvelopeReset(...args); };
      const originalEnvelopeContact = scheduleContactSound;
      scheduleContactSound = (...args) => {
        const [phase, contact, , when, normalization, position, score, actorIndex] = args;
        const before = pendingContactSounds?.length;
        const result = originalEnvelopeContact(...args);
        if (pendingContactSounds && pendingContactSounds.length > before) {
          const queued = pendingContactSounds.at(-1), motion = performanceFor(actorIndex).motion;
          const flight = phase === 'flight' ? quadrupedFlightTrajectory(score, position) : null;
          if (!envelopeBuffers.has(queued.voice.samples)) {
            let hash = 2166136261;
            const words = new Uint32Array(queued.voice.samples.buffer, queued.voice.samples.byteOffset, queued.voice.samples.length);
            for (const word of words) hash = Math.imul(hash ^ word, 16777619);
            envelopeBuffers.set(queued.voice.samples, { id: ++envelopeBufferId, hash: hash >>> 0 });
          }
          envelopeContacts.push({ phase, voicePhase: queued.voice.phase, skinId: queued.voice.skinId,
            when, position, progress: args[9], intensity: contact.intensity,
            gain: queued.gain, voiceGain: queued.voice.gain, normalization,
            bufferId: envelopeBuffers.get(queued.voice.samples).id, sampleHash: envelopeBuffers.get(queued.voice.samples).hash,
            flightStart: flight ? Math.round(flight.start * 10000) / 10000 : null,
            flightEnd: flight ? Math.round(flight.end * 10000) / 10000 : null,
            strength: motion?.strength ?? null, pace: motion?.pace ?? null });
        }
        return result;
      };
      globalThis.__quadrupedMotionEnvelopeProbe = {
        stopFrames: () => { cancelAnimationFrame(animationFrame); return canvas.dataset.clockPosition; },
        read: () => ({ contacts: envelopeContacts.slice(), resets: envelopeResets,
          position: actors[0].motor.position, motion: performanceFor(0).motion ? { ...performanceFor(0).motion } : null,
          gestureWidth: activeGesture?.value.width ?? null }),
      };
    ` });
  });
  await page.goto('/quadruped.html');
  await expect(animalHandle(page)).toBeVisible();
  return errors;
}

test('a rabbit hop carries the selected sound skin through a changing tone and rise-and-fall amplitude', async ({ page }) => {
  const errors = await openInstrument(page);
  await page.locator('#animalSelect').selectOption('rabbit');
  await page.locator('#behaviorSelect').selectOption('rabbit-gallop');
  await page.locator('#soundSkinSelect').selectOption('steel-wire');
  await page.locator('#tempo').fill('15');
  await page.locator('#groundProfile').selectOption('stairs-up');
  const before = await capture(page);
  await page.locator('#audioButton').click();
  await page.locator('#playButton').click();
  await expect.poll(async () => (await read(page)).position, { timeout: 8000 }).toBeGreaterThan(16.2);
  const report = await read(page);
  await page.locator('#playButton').click();
  const flights = report.contacts.filter(contact => contact.phase === 'flight');
  expect(flights.length).toBeGreaterThan(8);
  const firstArc = flights.filter(contact => contact.flightStart === flights[0].flightStart);
  expect(firstArc.every(contact => contact.skinId === 'steel-wire' && contact.voicePhase === 'flight')).toBe(true);
  expect(firstArc[0].progress).toBeLessThan(.15);
  expect(firstArc.at(-1).progress).toBeGreaterThan(.85);
  expect(new Set(firstArc.map(contact => contact.bufferId)).size).toBeGreaterThanOrEqual(3);
  const peak = Math.max(...firstArc.map(contact => contact.gain));
  expect(peak).toBeGreaterThan(0);
  expect(firstArc[0].gain).toBeLessThan(peak * .65);
  expect(firstArc.at(-1).gain).toBeLessThan(peak * .65);
  for (let index = 1; index < firstArc.length; index++) {
    expect(firstArc[index].progress).toBeGreaterThan(firstArc[index - 1].progress);
    const gap = firstArc[index].when - firstArc[index - 1].when;
    expect(gap).toBeGreaterThan(.05);
    expect(gap).toBeLessThan(.07);
  }
  await expect.poll(async () => (await audioStatus(page)).peak).toBeLessThan(.00001);
  expect(await capture(page)).toEqual(before);
  await page.locator('#soundSkinSelect').selectOption('porcelain');
  await page.locator('#restartButton').click();
  const porcelainScore = await capture(page);
  const firstCount = (await read(page)).contacts.length;
  await page.locator('#playButton').click();
  await expect.poll(async () => (await read(page)).position, { timeout: 8000 }).toBeGreaterThan(16.2);
  const porcelainFlights = (await read(page)).contacts.slice(firstCount).filter(contact => contact.phase === 'flight');
  await page.locator('#playButton').click();
  expect(porcelainFlights.length).toBeGreaterThan(8);
  expect(porcelainFlights.every(contact => contact.skinId === 'porcelain' && contact.voicePhase === 'flight')).toBe(true);
  const steelSamples = new Set(firstArc.map(contact => contact.sampleHash));
  expect(porcelainFlights.every(contact => !steelSamples.has(contact.sampleHash))).toBe(true);
  await expect.poll(async () => (await audioStatus(page)).peak).toBeLessThan(.00001);
  expect(await capture(page)).toEqual(porcelainScore);
  expect(errors).toEqual([]);
  await test.info().attach('rabbit-hop-voices-and-envelope', { body: JSON.stringify({ steelWire: firstArc, porcelain: porcelainFlights }), contentType: 'application/json' });
});

test('body drag pressure changes prepared amplitude within one pace without resetting audio or editing the score', async ({ page }) => {
  const errors = await openInstrument(page);
  await page.locator('#tempo').fill('60');
  await page.locator('#audioButton').click();
  const before = await capture(page);
  const origin = await animalHandle(page).evaluate(node => {
    const stage = document.querySelector('#stage').getBoundingClientRect();
    return { x: stage.x + Number(node.dataset.bodyX), y: stage.y + Number(node.dataset.bodyY) };
  });
  await page.mouse.move(origin.x, origin.y);
  await page.mouse.down();
  const dragScale = Math.max(32, (await read(page)).gestureWidth * .45);
  await page.mouse.move(origin.x + dragScale * .35, origin.y);
  await expect(animalHandle(page)).toHaveAttribute('data-action', 'run');
  await expect.poll(async () => (await read(page)).contacts.filter(contact => contact.strength >= .34 && contact.strength <= .36).length).toBeGreaterThan(3);
  const soft = await read(page);
  expect(soft.motion.pace).toBe(2);
  expect(soft.motion.strength).toBeCloseTo(.35, 2);
  await page.mouse.move(origin.x + dragScale * .60, origin.y, { steps: 8 });
  await expect.poll(async () => (await read(page)).contacts.filter(contact => contact.strength >= .59 && contact.strength <= .61).length).toBeGreaterThan(3);
  const firm = await read(page);
  expect(firm.motion.pace).toBe(soft.motion.pace);
  expect(firm.motion.strength).toBeCloseTo(.60, 2);
  expect(firm.position).toBeGreaterThan(soft.position);
  expect(firm.resets).toBe(soft.resets);
  const relativeGains = (contacts, low, high) => contacts
    .filter(contact => contact.strength >= low && contact.strength <= high && contact.voiceGain > 0 && contact.normalization > 0)
    .map(contact => contact.gain / (contact.voiceGain * contact.normalization));
  const softGains = relativeGains(soft.contacts, .34, .36);
  const firmGains = relativeGains(firm.contacts, .59, .61);
  expect(Math.min(...firmGains)).toBeGreaterThan(Math.max(...softGains) * 1.25);
  expect(await capture(page)).toEqual(before);
  const sounding = await audioStatus(page);
  expect(sounding.clipped).toBe(false);
  expect(sounding.peak).toBeLessThan(.90);
  await page.mouse.up();
  await expect(animalHandle(page)).toHaveAttribute('data-action', 'idle');
  await expect.poll(async () => (await audioStatus(page)).peak).toBeLessThan(.00001);
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed', 'false');
  expect(await capture(page)).toEqual(before);
  expect(errors).toEqual([]);
  await test.info().attach('body-drag-pressure', { body: JSON.stringify({ softGains, firmGains, soft: soft.motion, firm: firm.motion, resets: firm.resets }), contentType: 'application/json' });
});

for (const tempo of [500, 1000]) {
  test(`rabbit hops at ${tempo} BPM keep every short flight audible once while animation is paused`, async ({ page }) => {
    const errors = await openInstrument(page);
    await page.locator('#animalSelect').selectOption('rabbit');
    await page.locator('#behaviorSelect').selectOption('rabbit-gallop');
    await page.locator('#soundSkinSelect').selectOption('karplus');
    await page.locator('#tempo').fill(String(tempo));
    const before = await capture(page);
    await page.locator('#audioButton').click();
    await page.locator('#playButton').click();
    // Exclude startup preparation, then observe complete, consecutive cycles.
    await expect.poll(async () => (await read(page)).position).toBeGreaterThan(80);
    const frozenFrame = await page.evaluate(() => globalThis.__quadrupedMotionEnvelopeProbe.stopFrames());
    const startCycle = Math.ceil((await read(page)).position / 16) + 1;
    const cycles = 10;
    await expect.poll(async () => (await read(page)).position).toBeGreaterThan((startCycle + cycles + 1) * 16);
    const report = await read(page);
    const frameAfter = await page.locator('#stage').getAttribute('data-clock-position');
    const signal = await audioStatus(page);
    await page.locator('#playButton').click();
    expect(frameAfter).toBe(frozenFrame);
    const contacts = report.contacts.filter(contact => contact.position >= startCycle * 16
      && contact.position < (startCycle + cycles) * 16);
    const hops = contacts.filter(contact => contact.phase === 'flight');
    expect(hops).toHaveLength(cycles);
    const reference = contacts.find(contact => contact.phase === 'touchdown');
    expect(reference).toBeDefined();
    const clockRate = tempo * 16 / 60;
    for (let offset = 0; offset < cycles; offset++) {
      const cycle = startCycle + offset;
      const inCycle = hops.filter(contact => Math.floor(contact.flightStart / 16) === cycle);
      expect(inCycle, `cycle ${cycle} has one deduplicated flight`).toHaveLength(1);
      const hop = inCycle[0];
      expect(hop.skinId).toBe('karplus');
      expect(hop.voicePhase).toBe('flight');
      expect(hop.gain).toBeGreaterThan(0);
      expect(hop.position).toBeGreaterThan(hop.flightStart);
      expect(hop.position).toBeLessThan(hop.flightEnd);
      // Check the actual audio deadline against the same score timeline as a
      // real footfall, not against animation frames or browser-driver time.
      const liftTime = reference.when + (hop.flightStart - reference.position) / clockRate;
      const landingTime = reference.when + (hop.flightEnd - reference.position) / clockRate;
      expect(hop.when).toBeGreaterThan(liftTime);
      expect(hop.when).toBeLessThan(landingTime);
      expect(Math.abs(hop.when - reference.when - (hop.position - reference.position) / clockRate)).toBeLessThan(.0001);
      if (offset > 0) expect(Math.abs(hop.when - hops[offset - 1].when - 60 / tempo)).toBeLessThan(.0001);
    }
    expect(signal.rms).toBeGreaterThan(.0002);
    expect(signal.peak).toBeLessThan(.90);
    expect(signal.clipped).toBe(false);
    await expect.poll(async () => (await audioStatus(page)).peak).toBeLessThan(.00001);
    expect(await capture(page)).toEqual(before);
    expect(errors).toEqual([]);
    await test.info().attach('short-rabbit-flight-deadlines', { body: JSON.stringify({ tempo, hops, reference, signal }), contentType: 'application/json' });
  });
}
