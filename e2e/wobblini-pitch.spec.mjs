import { test, expect } from "@playwright/test";

// Isolate the real vendored DSP from app transport/UI so frequency, end gates
// and eight-voice rendering are measured independently of model assertions.
async function fixture(page, { decks = 1, sourceRate = 48000, pulse = false, duration = 6 } = {}) {
  await page.goto("/wobblini.html");
  await page.evaluate(({ decks, sourceRate, pulse, duration }) => {
    const button = document.createElement("button"); button.id = "pitchProbeStart"; button.textContent = "Start pitch probe";
    document.body.prepend(button);
    button.onclick = () => {
      const context = new AudioContext({ sampleRate: 48000, latencyHint: "interactive" });
      const resumed = context.resume();
      window.__pitchReady = (async () => {
        await resumed;
        const { createWobbliniPitch, wobbliniPitchMemoryBytes } = await import("/src/instruments/wobblini/wobblini-pitch.js");
        const sum = context.createGain(); sum.gain.value = 1 / decks;
        const analyser = context.createAnalyser(); analyser.fftSize = 16384; analyser.smoothingTimeConstant = 0;
        sum.connect(analyser).connect(context.destination);
        const buffers = Array.from({ length: decks }, (_, index) => {
          const pcm = context.createBuffer(1, Math.ceil(sourceRate * duration), sourceRate), data = pcm.getChannelData(0);
          for (let frame = 0; frame < data.length; frame++) {
            const time = frame / sourceRate;
            const envelope = pulse ? Math.exp(-(((time - 1) / 0.025) ** 2)) : 1;
            data[frame] = envelope * 0.2 * Math.sin(frame * Math.PI * 2 * (220 + index * 30) / sourceRate);
          }
          return pcm;
        });
        const errors = [], helpers = buffers.map(() => createWobbliniPitch({ context, output: sum,
          memoryLimit: 64 * 1024 * 1024, getBaseBytes: () => buffers.reduce((total, pcm) => total + pcm.length * 4, 0),
          onError: error => errors.push(error.message) }));
        await Promise.all(helpers.map((helper, index) => helper.prepare(buffers[index])));
        const code = `class PitchProbe extends AudioWorkletProcessor {
          constructor() { super(); this.capture = null; this.port.onmessage = ({data}) => { this.capture = {remaining: data, blocks: []}; }; }
          process(inputs, outputs) {
            for (const channel of outputs[0]) channel.fill(0);
            const capture = this.capture, input = inputs[0]; if (!capture || !input?.[0]) return true;
            let square = 0, peak = 0, invalid = 0;
            for (const channel of input) for (const value of channel) {
              if (!Number.isFinite(value)) invalid++; square += value * value; peak = Math.max(peak, Math.abs(value));
            }
            capture.blocks.push({time: currentTime, rms: Math.sqrt(square / (input.length * input[0].length)), peak, invalid});
            capture.remaining -= input[0].length;
            if (capture.remaining <= 0) { this.port.postMessage(capture.blocks); this.capture = null; }
            return true;
          }
        }; registerProcessor("wobblini-pitch-probe", PitchProbe);`;
        const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
        try { await context.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
        const probe = new AudioWorkletNode(context, "wobblini-pitch-probe", { outputChannelCount: [2] });
        sum.connect(probe); probe.connect(context.destination);
        window.__pitch = { context, helpers, errors, buffers,
          memory: () => wobbliniPitchMemoryBytes(context),
          frequency() {
            const data = new Float32Array(analyser.frequencyBinCount); analyser.getFloatFrequencyData(data);
            let bin = 1; for (let i = 2; i < data.length; i++) if (data[i] > data[bin]) bin = i;
            const left = data[bin - 1], center = data[bin], right = data[bin + 1];
            const offset = (left - right) / (2 * (left - 2 * center + right));
            return (bin + (Number.isFinite(offset) ? offset : 0)) * context.sampleRate / analyser.fftSize;
          },
          capture(seconds) { return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("Pitch audio probe did not finish")), seconds * 1000 + 5000);
            probe.port.onmessage = ({data}) => { clearTimeout(timer); resolve(data); };
            probe.port.postMessage(Math.ceil(seconds * context.sampleRate));
          }); },
          async dispose() { helpers.forEach(helper => helper.dispose()); probe.disconnect(); probe.port.close(); sum.disconnect(); analyser.disconnect(); await context.close(); },
        };
      })();
    };
  }, { decks, sourceRate, pulse, duration });
  await page.locator("#pitchProbeStart").click();
  await page.evaluate(() => window.__pitchReady);
}

async function play(page, state) {
  return page.evaluate(async state => {
    const p = window.__pitch, when = p.context.currentTime + Math.max(...p.helpers.map(helper => helper.latency)) + 0.04;
    await Promise.all(p.helpers.map((helper, index) => helper.play({ when, position: 0, rate: 1,
      keyLock: true, pitchSemitones: 0, ...state, ...(state.perDeck?.[index] ?? {}) })));
    return when;
  }, state);
}

test("real pitch output preserves original frequency and applies independent transpose after resampling", async ({ page }) => {
  await fixture(page, { sourceRate: 32000 });
  try {
    for (const [state, frequency] of [
      [{ rate: 1.5, keyLock: true, pitchSemitones: 0 }, 220],
      [{ rate: 0.75, keyLock: true, pitchSemitones: 7 }, 220 * 2 ** (7 / 12)],
      [{ rate: 0.5, keyLock: false, pitchSemitones: 7 }, 110 * 2 ** (7 / 12)],
      [{ rate: 1.75, keyLock: true, pitchSemitones: -12 }, 110],
      [{ rate: 0.25, keyLock: true, pitchSemitones: 12 }, 440],
    ]) {
      const when = await play(page, state);
      await expect.poll(() => page.evaluate(() => window.__pitch.context.currentTime)).toBeGreaterThan(when + 0.55);
      const measured = await page.evaluate(() => window.__pitch.frequency());
      expect(Math.abs(measured - frequency)).toBeLessThan(4);
    }
    expect(await page.evaluate(() => window.__pitch.errors)).toEqual([]);
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  } finally { await page.evaluate(() => window.__pitch?.dispose()); }
});

test("eight real pitch voices remain finite and audible through a main-thread stall", async ({ page }) => {
  test.setTimeout(45000);
  await fixture(page, { decks: 8 });
  try {
    const when = await play(page, { perDeck: Array.from({ length: 8 }, (_, i) => ({ rate: 0.5 + i / 6, pitchSemitones: i % 2 ? -7 : 7 })) });
    await expect.poll(() => page.evaluate(() => window.__pitch.context.currentTime)).toBeGreaterThan(when + 0.2);
    const blocks = await page.evaluate(async () => {
      const capture = window.__pitch.capture(0.8), until = performance.now() + 300;
      while (performance.now() < until) { /* Simulated busy UI; audio must keep rendering. */ }
      return capture;
    });
    expect(blocks.every(block => block.invalid === 0 && Number.isFinite(block.rms))).toBe(true);
    expect(Math.min(...blocks.map(block => block.rms))).toBeGreaterThan(0.001);
    expect(Math.max(...blocks.map(block => block.peak))).toBeLessThan(0.5);
    expect(await page.evaluate(() => window.__pitch.memory())).toBe(8 * 48000 * 6 * 4);
    expect(await page.evaluate(() => window.__pitch.errors)).toEqual([]);
  } finally { await page.evaluate(() => window.__pitch?.dispose()); }
  expect(await page.evaluate(() => window.__pitch.memory())).toBe(0);
});

test("real pitch stops at the file end and immediate scratch handoff mutes its analysis tail", async ({ page }) => {
  await fixture(page);
  try {
    const when = await play(page, { position: 5.6, rate: 1, keyLock: true, pitchSemitones: 7 });
    const blocks = await page.evaluate(() => window.__pitch.capture(1));
    expect(blocks.filter(block => block.time > when + 0.1 && block.time < when + 0.3).some(block => block.rms > 0.01)).toBe(true);
    expect(Math.max(...blocks.filter(block => block.time > when + 0.42).map(block => block.rms))).toBeLessThan(1e-7);
    const resumed = await play(page, { position: 1, rate: 1.2, pitchSemitones: -3 });
    await expect.poll(() => page.evaluate(() => window.__pitch.context.currentTime)).toBeGreaterThan(resumed + 0.2);
    await page.evaluate(() => window.__pitch.helpers[0].stop(window.__pitch.context.currentTime, true));
    const stopped = await page.evaluate(() => window.__pitch.capture(0.2));
    expect(Math.max(...stopped.slice(2).map(block => block.rms))).toBeLessThan(1e-7);
    expect(await page.evaluate(() => window.__pitch.errors)).toEqual([]);
  } finally { await page.evaluate(() => window.__pitch?.dispose()); }
});

test("eight pitch voices repeat full sources through their ends during a UI stall", async ({ page }, info) => {
  await fixture(page, { decks: 8, duration: 0.5, sourceRate: 32000 });
  try {
    const rates = Array.from({ length: 8 }, (_, index) => 0.5 + index / 6);
    const when = await play(page, { position: 0.35, loopEnabled: true,
      perDeck: rates.map((rate, index) => ({ rate, pitchSemitones: index % 2 ? -7 : 7 })) });
    await expect.poll(() => page.evaluate(() => window.__pitch.context.currentTime)).toBeGreaterThan(when + 0.1);
    const blocks = await page.evaluate(async () => {
      const capture = window.__pitch.capture(1.5), until = performance.now() + 650;
      while (performance.now() < until) { /* Cross several ends while UI callbacks cannot run. */ }
      return capture;
    });
    expect(blocks.every(block => block.invalid === 0 && Number.isFinite(block.rms))).toBe(true);
    expect(Math.min(...blocks.map(block => block.rms))).toBeGreaterThan(0.001);
    expect(Math.max(...blocks.map(block => block.peak))).toBeLessThan(0.5);
    expect(await page.evaluate(() => window.__pitch.errors)).toEqual([]);
    expect(await page.evaluate(() => window.__pitch.memory())).toBe(8 * 48000 * 0.5 * 4);
    await info.attach("pitch-full-file-repeat", { body: JSON.stringify({ when, rates, blocks }), contentType: "application/json" });
  } finally { await page.evaluate(() => window.__pitch?.dispose()); }
});

for (const duration of [0.02, 0.001]) test(`a ${duration * 1000} ms source keeps repeating and remains stoppable`, async ({ page }, info) => {
  await fixture(page, { duration });
  try {
    const when = await play(page, { loopEnabled: true, rate: 1.75, pitchSemitones: 7 });
    await expect.poll(() => page.evaluate(() => window.__pitch.context.currentTime)).toBeGreaterThan(when + 0.15);
    const blocks = await page.evaluate(() => window.__pitch.capture(0.3));
    expect(blocks.every(block => block.invalid === 0 && Number.isFinite(block.rms))).toBe(true);
    expect(Math.min(...blocks.map(block => block.rms))).toBeGreaterThan(0.001);
    await info.attach("pitch-short-file-repeat", { body: JSON.stringify(blocks), contentType: "application/json" });
    await page.evaluate(() => window.__pitch.helpers[0].stop(window.__pitch.context.currentTime, true));
    const stopped = await page.evaluate(() => window.__pitch.capture(0.1));
    expect(Math.max(...stopped.slice(2).map(block => block.rms))).toBeLessThan(1e-7);
  } finally { await page.evaluate(() => window.__pitch?.dispose()); }
});

test("real pitch places a source transient on the projected audible timeline at different speeds", async ({ page }, info) => {
  await fixture(page, { pulse: true, sourceRate: 32000 });
  try {
    const results = [];
    for (const rate of [0.5, 1.5]) {
      const position = 0.7, when = await play(page, { position, rate, keyLock: true, pitchSemitones: 0 });
      const expected = when + (1 - position) / rate;
      const blocks = await page.evaluate(() => window.__pitch.capture(1));
      const peak = blocks.reduce((best, block) => block.rms > best.rms ? block : best, blocks[0]);
      expect(peak.rms).toBeGreaterThan(0.01);
      results.push({ rate, expected, actual: peak.time, error: peak.time - expected });
      expect(Math.abs(peak.time - expected)).toBeLessThan(0.04);
    }
    await info.attach("pitch-transient-timing", { body: JSON.stringify(results), contentType: "application/json" });
  } finally { await page.evaluate(() => window.__pitch?.dispose()); }
});
