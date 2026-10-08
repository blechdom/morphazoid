import { test, expect } from "@playwright/test";

test("Quadruped calibration raises quiet audio by 12 dB and protects dense stereo peaks", async ({ page }) => {
  await page.goto("/quadruped.html");
  const report = await page.evaluate(async () => {
    const { createQuadrupedOutput, QUADRUPED_OUTPUT_CEILING } = await import("./src/instruments/quadruped/quadruped-output.js");
    const render = async ({ sampleRate = 48000, level = 0.62, dense = false, disconnected = false }) => {
      const context = new OfflineAudioContext(2, sampleRate, sampleRate);
      const stage = createQuadrupedOutput(context, { outputLevel: level });
      const buffer = context.createBuffer(2, sampleRate, sampleRate);
      for (let channel = 0; channel < 2; channel += 1) {
        const samples = buffer.getChannelData(channel);
        for (let frame = 0; frame < sampleRate * 0.75; frame += 1) {
          const time = frame / sampleRate;
          samples[frame] = dense
            ? 3 * Math.sin(time * Math.PI * 2 * 97) + 2 * Math.sin(time * Math.PI * 2 * 1733) + (frame % 181 === 0 ? 32 : 0)
            : 0.05 * Math.sin(time * Math.PI * 2 * 220);
          if (channel) samples[frame] *= -0.6;
        }
      }
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(stage.input);
      stage.output.connect(context.destination);
      if (disconnected) { stage.disconnect(); stage.disconnect(); }
      source.start();
      const rendered = await context.startRendering();
      const channels = [0, 1].map(channel => {
        const data = rendered.getChannelData(channel);
        let peak = 0, energy = 0, tail = 0, clipped = 0;
        for (let frame = 0; frame < data.length; frame += 1) {
          if (!Number.isFinite(data[frame])) throw new Error("Non-finite output");
          const magnitude = Math.abs(data[frame]);
          peak = Math.max(peak, magnitude);
          if (frame >= sampleRate * 0.1 && frame < sampleRate * 0.7) energy += data[frame] ** 2;
          if (frame >= sampleRate * 0.9) tail = Math.max(tail, magnitude);
          if (magnitude >= 1) clipped += 1;
        }
        return { peak, rms: Math.sqrt(energy / (sampleRate * 0.6)), tail, clipped };
      });
      stage.disconnect();
      return { sampleRate, level, dense, disconnected, channels, masterLevel: stage.masterGain.gain.value };
    };
    return {
      ceiling: QUADRUPED_OUTPUT_CEILING,
      renders: await Promise.all([
        render({}), render({ level: 0.31 }), render({ level: 0 }),
        render({ level: 0.72, dense: true }),
        render({ sampleRate: 96000, level: 0.72, dense: true }),
        render({ disconnected: true }),
      ]),
    };
  });
  const [normal, half, mute, dense48, dense96, disconnected] = report.renders;
  const uncalibratedRms = 0.05 * 0.62 / Math.sqrt(2);
  expect(normal.channels[0].rms / uncalibratedRms).toBeGreaterThan(3.99);
  expect(normal.channels[0].rms / uncalibratedRms).toBeLessThan(4.01);
  expect(normal.channels[0].rms / half.channels[0].rms).toBeCloseTo(2, 3);
  expect(normal.channels[1].rms / normal.channels[0].rms).toBeCloseTo(0.6, 3);
  expect(normal.masterLevel).toBeCloseTo(0.62, 6);
  for (const silent of [mute, disconnected]) for (const channel of silent.channels) expect(channel.peak).toBe(0);
  for (const dense of [dense48, dense96]) for (const channel of dense.channels) {
    expect(channel.peak).toBeLessThanOrEqual(report.ceiling + 1e-6);
    expect(channel.peak).toBeGreaterThan(0.8);
    expect(channel.clipped).toBe(0);
    expect(channel.rms).toBeGreaterThan(0.3);
    expect(channel.tail).toBe(0);
  }
  await test.info().attach("quadruped-output-calibration", { body: JSON.stringify(report, null, 2), contentType: "application/json" });
});
