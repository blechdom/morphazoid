import { test, expect } from '@playwright/test';

export async function installInteractionProbe(page) {
  await page.route('**/src/instruments/quadruped/quadruped-app.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
      const qa = { resets: [], updates: [], cancels: [], sources: [], contacts: [], serial: 0 };
      const originalReset = resetAudioSchedule;
      resetAudioSchedule = (...args) => { qa.resets.push(graph?.context.currentTime ?? 0); return originalReset(...args); };
      const originalUpdate = updateStateValue;
      updateStateValue = (...args) => { qa.updates.push({key: args[0], value: args[1]}); return originalUpdate(...args); };
      const originalCancel = cancelAudioSource;
      cancelAudioSource = (record, ...args) => {
        qa.cancels.push({ id: record.qaId, role: record.role, now: graph?.context.currentTime ?? 0,
          start: record.startTime, end: record.endTime, queueTime: record.queueTime });
        return originalCancel(record, ...args);
      };
      const originalRegister = registerAudioSource;
      registerAudioSource = (...args) => {
        const record = originalRegister(...args);
        record.qaId = ++qa.serial;
        const tracked = { id: record.qaId, role: record.role, source: record.source, buffer: record.source.buffer,
          originalEnd: record.endTime, queueTime: record.queueTime, start: null, offset: 0, stop: Infinity, disconnected: null };
        qa.sources.push(tracked);
        const originalStart = record.source.start.bind(record.source);
        record.source.start = (when, offset = 0, ...rest) => { tracked.start = when; tracked.offset = offset; return originalStart(when, offset, ...rest); };
        const originalStop = record.source.stop.bind(record.source);
        record.source.stop = when => { tracked.stop = when; return originalStop(when); };
        const originalDisconnect = record.source.disconnect.bind(record.source);
        record.source.disconnect = (...args) => { tracked.disconnected ??= graph?.context.currentTime ?? Infinity; return originalDisconnect(...args); };
        return record;
      };
      globalThis.quadrupedInteractions = {
        clear() { qa.resets.length = qa.updates.length = qa.cancels.length = 0; },
        stats() { return { resets: qa.resets.slice(), updates: qa.updates.slice(), cancels: qa.cancels.slice(),
          sources: qa.sources.map(({source, buffer, ...sourceInfo}) => sourceInfo), active: activeSources.size }; },
        // Arm Audio, then call this before Play. Existing motor transport need not
        // generate contacts: the real user knob event still invalidates the queue.
        async marker() {
          const sampleRate = 24000, samples = new Float32Array(sampleRate * 0.40);
          for (let index=0; index<samples.length; index++) samples[index] = 0.06 * Math.sin(index/sampleRate * Math.PI*2*313);
          const future = new Float32Array(sampleRate * 0.04); future.fill(0.12);
          const now = graph.context.currentTime;
          const voice = { samples, sampleRate, duration: 0.40, playbackRate: 1 };
          const futureVoice = { samples: future, sampleRate, duration: 0.04, playbackRate: 1 };
          const before = qa.sources.length;
          flushContactSounds([{voice, when: now+0.02, gain: 1, pan: -1},
            {voice: futureVoice, when: now+0.26, gain: 1, pan: 1}]);
          qa.markerIds = qa.sources.slice(before).map(record => record.id);
          qa.markerOrigin = now;
          // Hold the clock between attacks so browser-driver latency cannot
          // move the pointer edit past the future marker we intend to cancel.
          await new Promise(resolve => setTimeout(resolve, 80));
          await graph.context.suspend();
          return { ids: qa.markerIds, origin: now };
        },
        async markerPcm() {
          const selected = qa.sources.filter(record => qa.markerIds.includes(record.id));
          const sampleRate = 24000, origin = qa.markerOrigin, duration = 0.50;
          const render = async actual => {
            const offline = new OfflineAudioContext(2, sampleRate*duration, sampleRate);
            for (const record of selected) {
              if (!record.buffer || record.start === null) continue;
              const node = offline.createBufferSource(); node.buffer = record.buffer; node.connect(offline.destination);
              const start = record.start-origin;
              const stop = actual ? Math.min(record.stop, record.disconnected ?? Infinity) - origin : record.originalEnd + 0.005 - origin;
              if (stop <= start || stop <= 0) continue;
              node.start(Math.max(0, start), record.offset + Math.max(0,-start));
              node.stop(Math.max(0,stop));
            }
            return offline.startRendering();
          };
          const actual = await render(true), baseline = await render(false);
          const rms = (buffer, channel, from, through) => {
            const pcm = buffer.getChannelData(channel); let sum = 0, count = 0;
            for(let i=Math.round(from*sampleRate);i<Math.round(through*sampleRate);i++) { sum += pcm[i]*pcm[i]; count++; }
            return Math.sqrt(sum / count);
          };

          // Left marker is old sounding tail; right marker is future attack.
          return { actualTail: rms(actual, 0, .17, .38), referenceTail: rms(baseline, 0, .17, .38),
            actualFuture: rms(actual, 1, .26, .31), referenceFuture: rms(baseline, 1, .26, .31),
            // Send small per-window energies rather than large PCM through Playwright.
            tailWindows: Array.from({length:10}, (_,i)=>[rms(actual,0,.17+i*.02,.19+i*.02),rms(baseline,0,.17+i*.02,.19+i*.02)]) };
        },
      };
    `});
  });
}

export async function dragKnob(page, id, pixels = 20, steps = 24) {
  const input = page.locator('#'+id);
  await input.scrollIntoViewIfNeeded();
  const box = await input.boundingBox();
  const x = box.x + box.width/2, y = box.y + box.height/2;
  await page.mouse.move(x,y); await page.mouse.down();
  for(let step=1;step<=steps;step++) {
    await page.mouse.move(x,y-pixels*step/steps);
    await page.waitForTimeout(20);
  }
  await page.mouse.up();
}

// Marker test strategy: real knob input between marker onset and future cohort.
// Use a single movement here: a 0.5 s sustained drag would outlive these markers.
test('a motion edit retains the complete sounding tail and removes a future cohort', async ({page}) => {
  await installInteractionProbe(page); await page.goto('/quadruped.html');
  await page.locator('#audioButton').click();
  const input = page.locator('#gravity'); await input.scrollIntoViewIfNeeded();
  const box = await input.boundingBox(), x=box.x+box.width/2, y=box.y+box.height/2;
  await page.mouse.move(x,y); await page.mouse.down();
  await page.evaluate(() => quadrupedInteractions.marker());
  await page.mouse.move(x,y-16); await page.mouse.up();
  const markerStats = await page.evaluate(() => quadrupedInteractions.stats());
  await test.info().attach('marker-lifecycle', {body:JSON.stringify(markerStats),contentType:'application/json'});
  expect(markerStats.updates.some(event => event.key === 'gravity')).toBe(true);
  const pcm = await page.evaluate(() => quadrupedInteractions.markerPcm());
  expect(pcm.referenceTail).toBeGreaterThan(.01);
  expect(pcm.actualTail).toBeCloseTo(pcm.referenceTail, 7);
  for(const [actual, baseline] of pcm.tailWindows) expect(actual).toBeCloseTo(baseline,7);
  expect(pcm.referenceFuture).toBeGreaterThan(.02);
  expect(pcm.actualFuture).toBeLessThan(1e-7);
});

// For real transport test Level must start midrange, avoiding saturation/no inputs.
test('dragging Level never rebuilds or cancels the musical schedule', async ({page}) => {
  await installInteractionProbe(page); await page.goto('/quadruped.html');
  await page.locator('#level').fill('0.35');
  await page.locator('#audioButton').click(); await page.locator('#playButton').click();
  await page.waitForTimeout(300);
  await page.evaluate(()=>quadrupedInteractions.clear());
  await dragKnob(page,'level',32);
  const stats=await page.evaluate(()=>quadrupedInteractions.stats());
  expect(stats.updates.filter(update=>update.key==='outputLevel').length).toBeGreaterThan(8);
  expect(stats.resets).toHaveLength(0); expect(stats.cancels).toHaveLength(0);
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed','true');
});

test('selecting motion cards and resizing are inaudible operations', async ({page}) => {
  await installInteractionProbe(page); await page.goto('/quadruped.html');
  await page.locator('#audioButton').click(); await page.locator('#playButton').click();
  await page.waitForTimeout(300); await page.evaluate(()=>quadrupedInteractions.clear());
  for(const card of [4,8,12]) await page.locator('.quadruped-cabinet-frame').nth(card).click();
  await page.setViewportSize({width:1280,height:820});
  await page.waitForTimeout(100);
  const stats=await page.evaluate(()=>quadrupedInteractions.stats());
  expect(stats.resets).toHaveLength(0); expect(stats.cancels).toHaveLength(0);
});

async function installTransportInteractionProbe(page) {
  await page.route('**/src/instruments/quadruped/quadruped-app.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
      const transportQa = { updates: [], resets: [], cancels: [], earlyStops: [], steps: [], maxActive: 0, meter: [], timer: 0, recordSteps: true };
      const qaOriginalStep = scheduleStep;
      scheduleStep = (...args) => {
        if (transportQa.recordSteps) transportQa.steps.push({ ordinal: args[0], when: args[1], actor: args[4] ?? selectedActor, canceled: false });
        return qaOriginalStep(...args);
      };
      const qaOriginalReset = resetAudioSchedule;
      resetAudioSchedule = (...args) => {
        const oldCount = transportQa.steps.length;
        const before = performance.now();
        const result = qaOriginalReset(...args);
        const cutoff = audioScheduleFrom;
        // A reset owns only the old queue. Events created by the replacement
        // schedule in this same call must not be marked canceled.
        for (let index=0; index<oldCount; index++) {
          if (transportQa.steps[index].when >= cutoff - 1e-9) transportQa.steps[index].canceled = true;
        }
        transportQa.resets.push({ when: graph?.context.currentTime ?? 0, cutoff, costMs: performance.now()-before });
        return result;
      };
      const qaOriginalUpdate = updateStateValue;
      updateStateValue = (...args) => {
        transportQa.updates.push({ key: args[0], value: args[1] });
        return qaOriginalUpdate(...args);
      };
      const qaOriginalCancel = cancelAudioSource;
      cancelAudioSource = (record, ...args) => {
        const now = graph?.context.currentTime ?? 0;
        transportQa.cancels.push({role: record.role, now, start: record.startTime, end: record.endTime});
        return qaOriginalCancel(record, ...args);
      };
      const qaOriginalRegister = registerAudioSource;
      registerAudioSource = (...args) => {
        const record = qaOriginalRegister(...args);
        transportQa.maxActive = Math.max(transportQa.maxActive, activeSources.size);
        const originalStop = record.source.stop.bind(record.source);
        record.source.stop = when => {
          const now = graph?.context.currentTime ?? 0;
          if (record.role === 'body-contact-batch' && record.startTime <= now && now < record.endTime
              && when < record.endTime - 1e-6) {
            transportQa.earlyStops.push({when, now, start: record.startTime, end: record.endTime});
          }
          return originalStop(when);
        };
        return record;
      };
      globalThis.quadrupedTransportInteractions = {
        dense() {
          transportQa.recordSteps = false;
          const snapshot = capturePreset();
          snapshot.actors.forEach((score, index) => {
            Object.assign(score, { animalId: ['horse','dog','goat'][index], behaviorId: 'walk', tempoBpm: 1000,
              suspensionBeats: 0, paceRatio: 3, lopsided: index % 2 ? -.5 : .5, spring: 1.5, pitchSemitones: 0 });
            score.callPattern = emptyQuadrupedCalls();
            score.pattern = Object.fromEntries(QUADRUPED_LANES.map(({id}) => [id, Array(16).fill(1)]));
          });
          applyPreset(snapshot);
        },
        clear() {
          transportQa.updates.length = transportQa.resets.length = transportQa.cancels.length = transportQa.earlyStops.length = 0;
          transportQa.steps.length = transportQa.meter.length = 0;
          transportQa.maxActive = activeSources.size;
        },
        async startMeter() {
          if (transportQa.timer) clearInterval(transportQa.timer);
          const manager = (await import('/src/audio-output-manager.js')).getSharedAudioOutputManager();
          transportQa.timer = setInterval(() => {
            const {rms, peak, clipped, connectionCount} = manager.getStatus();
            transportQa.meter.push({rms, peak, clipped, connectionCount});
            transportQa.maxActive = Math.max(transportQa.maxActive, activeSources.size);
          }, 50);
        },
        stopMeter() { clearInterval(transportQa.timer); transportQa.timer = 0; },
        stats() { return { updates: transportQa.updates.slice(), resets: transportQa.resets.slice(), cancels: transportQa.cancels.slice(),
          earlyStops: transportQa.earlyStops.slice(), steps: transportQa.steps.map(event=>({...event})), meter: transportQa.meter.slice(),
          maxActive: transportQa.maxActive, active: activeSources.size, audioNow: graph?.context.currentTime ?? 0,
          position: motor.position, nextOrdinal: actors[selectedActor].nextOrdinal }; },
      };
    `});
  });
}

test('motion drags preserve tails at maximum density and on a throttled device', async ({page}) => {
  test.setTimeout(120_000);
  await installTransportInteractionProbe(page);
  await page.goto('/quadruped.html');
  await page.locator('[data-group-mode="trio"]').click();
  await page.evaluate(()=>quadrupedTransportInteractions.dense());
  await page.locator('#audioButton').click();
  if (await page.locator('#playButton').getAttribute('aria-pressed') !== 'true') await page.locator('#playButton').click();
  const cdp = await page.context().newCDPSession(page);
  try {
    for (const rate of [1,4]) {
      await cdp.send('Emulation.setCPUThrottlingRate', {rate});
      await page.evaluate(()=>quadrupedTransportInteractions.dense());
      if (rate > 1) {
        await page.locator('#tempo').fill('180');
        await page.locator('[data-pace-ratio="1"]').click();
      }
      await page.waitForTimeout(1000);
      await page.evaluate(async ()=>{quadrupedTransportInteractions.clear(); await quadrupedTransportInteractions.startMeter();});
      // Every path uses captured native pointer input; Tempo moves downward
      // from its maximum so a saturated knob cannot produce a false pass.
      await dragKnob(page,'gravity',16,12);
      await dragKnob(page,'tempo',-12,12);
      await dragKnob(page,'pitchSemitones',24,12);
      await dragKnob(page,'spring',12,8);
      await dragKnob(page,'groundResonance',12,8);
      await page.evaluate(()=>quadrupedTransportInteractions.stopMeter());
      const report = await page.evaluate(()=>quadrupedTransportInteractions.stats());
      for (const key of ['gravity','tempoBpm','pitchSemitones']) {
        expect(report.updates.some(event=>event.key===key), rate+'x '+key+' actually changed').toBe(true);
      }
      expect(report.resets.length, rate+'x exactly one reset per musical edit').toBe(report.updates.length);
      expect(report.cancels.filter(event=>event.role==='body-contact-batch' && event.start<=event.now && event.now<event.end),
        rate+'x no sounding contact cancellation').toHaveLength(0);
      expect(report.earlyStops, rate+'x no direct stop truncates a sounding contact').toHaveLength(0);
      expect(report.maxActive, rate+'x source budget').toBeLessThanOrEqual(48);
      expect(report.meter.length, rate+'x observed while dragging').toBeGreaterThan(5);
      expect(report.meter.every(row=>Number.isFinite(row.rms) && row.peak<.90 && !row.clipped && row.connectionCount===1)).toBe(true);
      expect(report.meter.filter(row=>row.rms>.001).length/report.meter.length, rate+'x continuous dense output').toBeGreaterThan(.8);
      await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed','true');
      await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed','true');
      await test.info().attach('quadruped-interaction-'+rate+'x', {body:JSON.stringify(report),contentType:'application/json'});
    }
  } finally {
    await cdp.send('Emulation.setCPUThrottlingRate', {rate:1}).catch(()=>{});
  }
});

test('repeated edits after a drastic slowdown never replay a retained ordinal', async ({page}) => {
  test.setTimeout(45_000);
  await installTransportInteractionProbe(page);
  await page.goto('/quadruped.html');
  await page.locator('#tempo').fill('1000');
  await page.locator('#audioButton').click();
  await page.locator('#playButton').click();
  await page.waitForTimeout(300);
  await page.evaluate(()=>quadrupedTransportInteractions.clear());
  // Capture the old fast future queue before reducing the rate. Some of its
  // steps are committed within the short cutover interval, ahead of the newly
  // slow motor for seconds. Repeated edits must keep their ownership intact.
  await page.waitForTimeout(120);
  await page.locator('#tempo').fill('10');
  for(let index=0;index<8;index++) {
    await page.waitForTimeout(180);
    await page.locator('#gravity').fill(String(index%2 ? 1.2 : 1.4));
  }
  await page.locator('#tempo').fill('20');
  await page.waitForTimeout(4000);
  const report=await page.evaluate(()=>quadrupedTransportInteractions.stats());
  const survivors=report.steps.filter(event=>!event.canceled);
  expect(survivors.length).toBeGreaterThan(10);
  const duplicates=[], seen=new Set();
  for(const event of survivors) {
    const key=event.actor+':'+event.ordinal;
    if(seen.has(key)) duplicates.push(event);
    seen.add(key);
  }
  expect(duplicates, 'an already retained attack is never sounded again at the slower tempo').toHaveLength(0);
  expect(survivors.some(event=>event.when>report.resets.at(-1).when+.5), 'playback advances past the retained fast queue').toBe(true);
  expect(report.earlyStops).toHaveLength(0);
  await expect(page.locator('#playButton')).toHaveAttribute('aria-pressed','true');
  await test.info().attach('quadruped-slowdown-ledger', {body:JSON.stringify(report),contentType:'application/json'});
});
