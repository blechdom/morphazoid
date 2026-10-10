import { test, expect } from '@playwright/test';

async function installTimingProbe(page) {
  await page.route('**/src/instruments/quadruped/quadruped-app.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
      const timingEvents = [], timingBatches = [];
      const originalStep = scheduleStep;
      scheduleStep = (...args) => { timingEvents.push({ ordinal: args[0], when: args[1], actor: args[4] ?? selectedActor }); return originalStep(...args); };
      const originalStart = AudioBufferSourceNode.prototype.start;
      let latestBufferStart;
      AudioBufferSourceNode.prototype.start = function(when, offset = 0, ...rest) {
        latestBufferStart = { when, offset }; return originalStart.call(this, when, offset, ...rest);
      };
      const originalFlush = flushContactSounds;
      flushContactSounds = events => {
        latestBufferStart = null;
        const result = originalFlush(events);
        if (latestBufferStart && events.length) timingBatches.push({ ...latestBufferStart, earliest: Math.min(...events.map(e => e.when)) });
        return result;
      };
      globalThis.quadrupedTiming = {
        snapshot: () => ({ wall: performance.now()/1000, audio: graph?.context.currentTime ?? null,
          motor: displayMotorSnapshots()[selectedActor], committed: motor, clock: motorClock }),
        events: () => timingEvents.slice(), batches: () => timingBatches.slice(),
        clear: () => { timingEvents.length = 0; timingBatches.length = 0; },
        stopFrames: () => cancelAnimationFrame(animationFrame),
        staleFrame: () => { const before = JSON.stringify([motor, motorClock]); drawScene(performance.now()-50); return before === JSON.stringify([motor, motorClock]); },
        block: ms => { scheduleAudioWindow(); const end = performance.now()+ms; while (performance.now()<end) {} },
        suspend: () => graph.context.suspend(), resume: () => graph.context.resume(),
        lateBatch: () => {
          const now = graph.context.currentTime;
          const samples = new Float32Array(480); samples[0] = 0.05;
          const voice = { samples, sampleRate: 24000, duration: 0.02, playbackRate: 1 };
          flushContactSounds([{ voice, when: now-0.05, pan: 0, gain: 1 }, { voice, when: now+0.08, pan: 0, gain: 1 }]);
          return timingBatches.at(-1);
        },
      };` });
  });
}

test('audio deadlines stay fixed with animation, without frames, and across a 150ms UI stall', async ({ page }) => {
  await installTimingProbe(page);
  await page.goto('/quadruped.html');
  await page.locator('#tempo').fill('120');
  await page.locator('#audioButton').click();
  await page.locator('#playButton').click();
  await page.waitForTimeout(400);
  const cdp = await page.context().newCDPSession(page);
  for (const mode of ['animation', 'slow-device', 'no-frames', 'UI-stall']) {
    await cdp.send('Emulation.setCPUThrottlingRate', {rate: mode === 'slow-device' ? 4 : 1});
    if (mode === 'no-frames') await page.evaluate(() => quadrupedTiming.stopFrames());
    await page.evaluate(() => quadrupedTiming.clear());
    const before = await page.evaluate(() => quadrupedTiming.snapshot());
    if (mode === 'UI-stall') await page.evaluate(() => quadrupedTiming.block(150));
    await page.waitForTimeout(1600);
    const after = await page.evaluate(() => quadrupedTiming.snapshot());
    expect(Math.abs((after.motor.elapsedSeconds-before.motor.elapsedSeconds)-(after.audio-before.audio)), mode).toBeLessThan(0.006);
    const events = await page.evaluate(() => quadrupedTiming.events());
    expect(events.length).toBeGreaterThan(35);
    for (let i=1; i<events.length; i++) {
      expect(events[i].ordinal-events[i-1].ordinal, mode).toBe(1);
      expect(Math.abs(events[i].when-events[i-1].when-1/32), mode).toBeLessThan(0.0001);
    }
    const batches = await page.evaluate(() => quadrupedTiming.batches());
    expect(batches.length).toBeGreaterThan(4);
    for (const batch of batches) expect(Math.abs(batch.when-batch.offset-batch.earliest)).toBeLessThan(1e-8);
    expect(await page.evaluate(() => quadrupedTiming.staleFrame())).toBe(true);
  }
});

test('silent playback and Audio changes preserve time; a suspended audio clock freezes motion', async ({ page }) => {
  await installTimingProbe(page);
  await page.goto('/quadruped.html');
  await page.locator('#playButton').click();
  await page.evaluate(() => quadrupedTiming.stopFrames());
  const before = await page.evaluate(() => quadrupedTiming.snapshot());
  await page.waitForTimeout(600);
  const silent = await page.evaluate(() => quadrupedTiming.snapshot());
  expect(Math.abs((silent.motor.elapsedSeconds-before.motor.elapsedSeconds)-(silent.wall-before.wall))).toBeLessThan(0.015);
  await page.locator('#audioButton').click();
  const audible = await page.evaluate(() => quadrupedTiming.snapshot());
  expect(audible.motor.position).toBeGreaterThanOrEqual(silent.motor.position);
  expect(audible.motor.elapsedSeconds-silent.motor.elapsedSeconds).toBeLessThan(0.7);
  await page.evaluate(() => quadrupedTiming.suspend());
  const frozen = await page.evaluate(() => quadrupedTiming.snapshot());
  await page.waitForTimeout(200);
  const still = await page.evaluate(() => quadrupedTiming.snapshot());
  expect(still.motor.position).toBe(frozen.motor.position);
  await page.evaluate(() => quadrupedTiming.resume());
  await page.waitForTimeout(200);
  const resumed = await page.evaluate(() => quadrupedTiming.snapshot());
  expect(resumed.motor.position).toBeGreaterThan(still.motor.position);
  await page.locator('#audioButton').click();
  const off = await page.evaluate(() => quadrupedTiming.snapshot());
  await page.waitForTimeout(300);
  const later = await page.evaluate(() => quadrupedTiming.snapshot());
  expect(later.audio).toBeNull();
  expect(Math.abs((later.motor.elapsedSeconds-off.motor.elapsedSeconds)-(later.wall-off.wall))).toBeLessThan(0.015);
});

test('a late mixed batch trims elapsed audio without delaying its future contacts', async ({ page }) => {
  await installTimingProbe(page);
  await page.goto('/quadruped.html');
  await page.locator('#audioButton').click();
  const batch = await page.evaluate(() => quadrupedTiming.lateBatch());
  expect(batch.offset).toBeGreaterThan(0.05);
  expect(batch.offset).toBeLessThan(0.13);
  expect(Math.abs(batch.when-batch.offset-batch.earliest)).toBeLessThan(1e-8);
});
