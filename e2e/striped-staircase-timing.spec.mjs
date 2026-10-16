import { expect, test } from '@playwright/test';
import { pageDiagnosticMessages, watchPageDiagnostics } from './helpers/diagnostics.mjs';

// A graph-timing regression, not a hardware-underrun or listening test. The
// normal instrument keeps rendering while a production StaircaseEngine plays
// constant geometry. Its linear threshold gives an unambiguous 250 ms period;
// the real staircase's nonlinear depth curve intentionally changes that period.
function analyzeOnsets(bytes, sampleRate, captureStart, stalls) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let dataOffset = -1, dataBytes = 0;
  for (let at = 12; at + 8 <= bytes.length;) {
    const size = view.getUint32(at + 4, true);
    const tag = String.fromCharCode(...bytes.subarray(at, at + 4));
    if (tag === 'data') { dataOffset = at + 8; dataBytes = size; break; }
    at += 8 + size + (size % 2);
  }
  if (dataOffset < 0 || dataOffset + dataBytes > bytes.length) throw new Error('Invalid recorded WAV.');
  const frames = dataBytes / 6, signal = new Float64Array(frames);
  let peak = 0, channelDifference = 0;
  for (let frame = 0; frame < frames; frame++) {
    const at = dataOffset + frame * 6;
    const left = (bytes[at] | bytes[at + 1] << 8 | bytes[at + 2] << 16) << 8 >> 8;
    const right = (bytes[at + 3] | bytes[at + 4] << 8 | bytes[at + 5] << 16) << 8 >> 8;
    signal[frame] = left / 8388608;
    peak = Math.max(peak, Math.abs(signal[frame]));
    channelDifference = Math.max(channelDifference, Math.abs(left - right));
  }
  // Two carrier cycles at 1 kHz suppress phase-dependent crossings. Advance
  // this RMS window one sample at a time, preserving sub-quantum resolution.
  const window = Math.round(sampleRate * .002), envelope = new Float64Array(frames);
  let power = 0, maximumRms = 0;
  for (let frame = 0; frame < frames; frame++) {
    power += signal[frame] ** 2;
    if (frame >= window) power -= signal[frame - window] ** 2;
    envelope[frame] = Math.sqrt(Math.max(0, power) / window);
    maximumRms = Math.max(maximumRms, envelope[frame]);
  }
  const high = maximumRms * .2, low = maximumRms * .04, onsets = [];
  let armed = true, quietFrames = 0;
  for (let frame = window; frame < frames; frame++) {
    if (armed && envelope[frame] > high) { onsets.push(frame); armed = false; quietFrames = 0; }
    if (envelope[frame] < low) quietFrames++; else quietFrames = 0;
    if (quietFrames >= sampleRate * .02) armed = true;
  }
  const periodSamples = sampleRate / 4;
  const residualSamples = onsets.map((frame, index) => frame - onsets[0] - index * periodSamples);
  const intervals = onsets.slice(1).map((frame, index) => {
    const from = captureStart + onsets[index] / sampleRate, to = captureStart + frame / sampleRate;
    return { fromSample: onsets[index], toSample: frame, samples: frame - onsets[index],
      errorSamples: frame - onsets[index] - periodSamples,
      overlapsStall: stalls.some(stall => from < stall.contextEnd && to > stall.contextStart) };
  });
  return { frames, seconds: frames / sampleRate, peak, channelDifference, maximumRms,
    periodSamples, onsets, residualSamples, intervals,
    quietIntervals: intervals.filter(interval => !interval.overlapsStall),
    stalledIntervals: intervals.filter(interval => interval.overlapsStall) };
}

test('moving stripe onsets retain their sample timing through repeated UI stalls', async ({ page, baseURL }, info) => {
  test.setTimeout(60_000);
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await page.goto('/striped-staircase-rust.html');
  await page.waitForFunction(() => window.__staircaseStudies?.snapshot().ready);
  await page.locator('#playButton').click();
  await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');

  // A test-only explicit gesture starts the fixture context. The page's own
  // Audio stays off, avoiding a second engine or contamination of the capture.
  await page.evaluate(() => {
    const button = document.createElement('button');
    button.id = 'startTimingProbe'; button.textContent = 'Start timing probe';
    button.style.cssText = 'position:fixed;left:8px;top:8px;z-index:99999';
    button.onclick = () => {
      const context = new AudioContext({ latencyHint: 'interactive' });
      window.__staircaseTimingContext = context;
      window.__staircaseTimingResume = context.resume();
      button.remove();
    };
    document.body.append(button);
  });
  await page.locator('#startTimingProbe').click();

  let capture;
  try {
    capture = await page.evaluate(async () => {
      const { StaircaseEngine } = await import('/src/instruments/striped-staircase-rust/engine.js');
      const { STAIRCASE_FIELD_FRAMES: frames, STAIRCASE_FIELD_STRIDE: stride,
        STAIRCASE_BRANCH_OFFSET: branchOffset, STAIRCASE_FIELD_METADATA: metadata } =
        await import('/src/instruments/striped-staircase-rust/field.js');
      const { OutputRecorder } = await import('/src/output-recorder.js');
      const { getSharedAudioOutputManager } = await import('/src/audio-output-manager.js');
      const context = window.__staircaseTimingContext;
      await window.__staircaseTimingResume;
      const errors = [], states = [], timestamps = [], stalls = [];
      let engine, recorder, animationFrame = 0, animationCount = 0, lastRequest = 0;
      const before = window.__staircaseStudies.snapshot().progress;
      const startWall = performance.now();
      const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
      const timestamp = () => {
        const output = context.getOutputTimestamp?.();
        timestamps.push({ now: performance.now(), currentTime: context.currentTime,
          outputContextTime: output?.contextTime ?? null, outputPerformanceTime: output?.performanceTime ?? null });
      };
      const waitUntil = async target => {
        while (context.currentTime < target) {
          if (performance.now() - startWall > 25_000) throw new Error('Audio clock did not reach the timing fixture deadline.');
          timestamp(); await pause(Math.min(40, Math.max(4, (target - context.currentTime) * 1000)));
        }
      };
      try {
        engine = await StaircaseEngine.create(context, {
          onState: state => states.push({ clock: state.clock, depth: state.depth, revision: state.revision }),
          onError: error => errors.push(error.message),
        });
        const table = new Float32Array(frames * stride);
        for (let frame = 0; frame < frames; frame++) {
          const at = frame * stride;
          table[at + metadata.valid] = 1;
          // Integer thresholds avoid Float32 interpolation drift. Advancing
          // four threshold units per second gives a white onset every 250 ms.
          table[at + metadata.threshold] = frame;
          table[at + metadata.stripePeriod] = 1;
          table[at + metadata.paired] = 1;
          table.set([1, .4, .5, .3, 1, 0, 1, .6, .5, .3, 2, 0], at + branchOffset);
        }
        engine.field(table, frames, 1);
        engine.controls({ mode: 2, baseFrequency: 1000, brightness: .8, body: 0,
          level: .35, speed: 4 / (frames - 1), pitchMapping: 1, pitchSpan: 0 });
        engine.seek(0, 1);
        engine.transport({ playing: false, audio: true, hold: false });
        const observe = now => {
          animationCount++;
          if (now - lastRequest >= 1000 / 30) { engine.requestState?.(); lastRequest = now; }
          animationFrame = requestAnimationFrame(observe);
        };
        animationFrame = requestAnimationFrame(observe);
        await pause(200); // Table blend and parameter smoothing settle silently.
        recorder = new OutputRecorder({ manager: getSharedAudioOutputManager() });
        await recorder.start();
        const captureStart = context.currentTime;
        await waitUntil(captureStart + .1);
        const playbackStart = context.currentTime;
        engine.transport({ playing: true, audio: true, hold: false });
        for (const offset of [.9, 2.4, 3.9]) {
          await waitUntil(playbackStart + offset);
          const stall = { wallStart: performance.now(), contextStart: context.currentTime };
          const until = performance.now() + 300;
          while (performance.now() < until) { /* Deliberate UI-only stall; audio keeps moving. */ }
          stall.wallEnd = performance.now(); stall.contextEnd = context.currentTime;
          stalls.push(stall); timestamp();
        }
        await waitUntil(playbackStart + 6.25);
        const captureEnd = context.currentTime;
        const take = await recorder.stop();
        const bytes = new Uint8Array(await take.blob.arrayBuffer());
        let binary = '';
        for (let at = 0; at < bytes.length; at += 32768) binary += String.fromCharCode(...bytes.subarray(at, at + 32768));
        return { audioBase64: btoa(binary), sampleRate: take.sampleRate, recorderError: take.error,
          recorderFrames: take.frames, captureStart, captureEnd, playbackStart, stalls, timestamps,
          states, errors, animationCount, progressBefore: before,
          progressAfter: window.__staircaseStudies.snapshot().progress,
          baseLatency: context.baseLatency, outputLatency: context.outputLatency ?? null };
      } finally {
        cancelAnimationFrame(animationFrame);
        if (recorder) { await recorder.destroy(); recorder.discard(); }
        engine?.dispose();
        await context.close();
        delete window.__staircaseTimingContext; delete window.__staircaseTimingResume;
      }
    });
    const bytes = Buffer.from(capture.audioBase64, 'base64');
    delete capture.audioBase64;
    const timing = analyzeOnsets(bytes, capture.sampleRate, capture.captureStart, capture.stalls);
    await info.attach('moving-stripes-through-ui-stalls.wav', { body: bytes, contentType: 'audio/wav' });
    await info.attach('moving-stripe-timing.json', { body: JSON.stringify({ ...capture, timing,
      scope: 'Production engine and shared output PCM. Does not establish physical-device underrun behavior.' }, null, 2), contentType: 'application/json' });
    expect(capture.recorderError).toBe(''); expect(capture.errors).toEqual([]);
    expect(capture.stalls).toHaveLength(3);
    for (const stall of capture.stalls) {
      expect(stall.wallEnd - stall.wallStart).toBeGreaterThanOrEqual(299);
      expect(stall.contextEnd - stall.contextStart).toBeGreaterThan(.2);
    }
    expect(capture.animationCount).toBeGreaterThan(20);
    expect(capture.progressAfter).toBeGreaterThan(capture.progressBefore);
    expect(timing.frames).toBe(capture.recorderFrames);
    expect(timing.seconds).toBeGreaterThan(6);
    expect(Math.abs(timing.seconds - (capture.captureEnd - capture.captureStart))).toBeLessThan(.05);
    expect(timing.peak).toBeGreaterThan(.01); expect(timing.peak).toBeLessThan(1);
    expect(timing.channelDifference).toBe(0);
    expect(timing.onsets.length).toBeGreaterThanOrEqual(24);
    expect(timing.quietIntervals.length).toBeGreaterThan(5);
    expect(timing.stalledIntervals.length).toBeGreaterThanOrEqual(3);
    // Sixteen samples allow the RMS edge detector and floating-point boundary
    // rounding, but reject a delayed/missing 128-sample rendering quantum.
    expect(Math.max(...timing.residualSamples.map(Math.abs))).toBeLessThanOrEqual(16);
    for (const group of [timing.quietIntervals, timing.stalledIntervals]) {
      expect(Math.max(...group.map(interval => Math.abs(interval.errorSamples)))).toBeLessThanOrEqual(16);
    }
  } finally {
    await page.evaluate(async () => {
      const context = window.__staircaseTimingContext;
      if (context && context.state !== 'closed') await context.close();
      delete window.__staircaseTimingContext; delete window.__staircaseTimingResume;
      window.__staircaseStudies?.teardown();
    });
    const messages = pageDiagnosticMessages(diagnostics);
    await info.attach('timing-browser-diagnostics.json', { body: JSON.stringify(messages), contentType: 'application/json' });
    expect(messages).toEqual([]);
  }
});
