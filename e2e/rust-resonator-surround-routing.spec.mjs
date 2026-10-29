import { test, expect } from '@playwright/test';

test('real Web Audio maps every layout and preserves physical capture through preview and device changes', async ({ page }) => {
  await page.goto('/');
  const report = await page.evaluate(async () => {
    const { createResonatorSurroundOutput, RESONATOR_SURROUND_LAYOUTS } = await import('/src/instruments/simd-resonator-rust/surround-output.js');
    const result = [];
    for (const layoutId of RESONATOR_SURROUND_LAYOUTS) {
      const context = new OfflineAudioContext(32, 8192, 48000);
      Object.defineProperty(context, 'state', { get: () => 'running' });
      // Offline destinations report no hardware capacity. Model a 32-output
      // device while retaining real browser mixing and channel nodes.
      Object.defineProperty(context.destination, 'maxChannelCount', { value: 32 });
      const timers = new Map();
      const runtime = { setTimeout: fn => { const id = Symbol(); timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id) };
      const stereo = context.createGain(), spatial = context.createGain();
      spatial.channelCount = 16; spatial.channelCountMode = 'explicit'; spatial.channelInterpretation = 'discrete';
      spatial.gain.value = .5;
      const router = createResonatorSurroundOutput({ context, stereoSource: stereo, spatialSource: spatial, runtime,
        getAudioOn: () => true, settings: { enabled: true, layoutId, forcePreview: true } });
      const tap = context.createChannelSplitter(16), output = context.createChannelMerger(32);
      output.channelInterpretation = 'discrete';
      for (let channel = 0; channel < 16; channel++) tap.connect(output, channel, 16 + channel);
      output.connect(context.destination);
      const release = router.tapInto(context, tap);
      const flush = () => { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } };
      router.route({ forcePreview: false }); flush();
      context.dispatchEvent(new Event('sinkchange')); flush();
      const info = router.snapshot();
      context.destination.channelCount = 32; context.destination.channelInterpretation = 'discrete';
      const source = context.createBufferSource();
      source.buffer = context.createBuffer(16, 8192, 48000); source.channelInterpretation = 'discrete';
      info.speakers.forEach((_, index) => source.buffer.getChannelData(index).fill(.125, 2048 + index * 128, 2048 + index * 128 + 128));
      source.connect(spatial); source.start();
      const rendered = await context.startRendering();
      let checks = 0;
      info.speakers.forEach((speaker, index) => {
        const frame = 2048 + index * 128 + 64;
        for (let physical = 0; physical < 16; physical++) {
          const expected = physical === speaker.channel - 1 ? .0625 : 0;
          for (const offset of [0, 16]) {
            const actual = rendered.getChannelData(physical + offset)[frame];
            if (Math.abs(actual - expected) > 1e-7) throw new Error(`${layoutId}: logical ${index}, physical ${physical + 1}, ${offset ? 'record' : 'device'} ${actual} != ${expected}`);
            checks++;
          }
        }
      });
      result.push({ layoutId, mode: info.mode, channels: info.channelCount, checks });
      release(); router.destroy();
    }
    return result;
  });
  expect(report).toHaveLength(7);
  expect(report.find(item => item.layoutId === '7-1')?.channels).toBe(8);
  expect(report.every(item => item.mode === 'discrete' && item.checks >= 128)).toBe(true);
});

test('Surround off is sample-identical stereo; preview preserves left/right position without changing the capture', async ({ page }) => {
  await page.goto('/');
  const report = await page.evaluate(async () => {
    const { createResonatorSurroundOutput } = await import('/src/instruments/simd-resonator-rust/surround-output.js');
    const output = [];
    for (const enabled of [false, true]) {
      const context = new OfflineAudioContext(18, 4096, 48000);
      Object.defineProperty(context, 'state', { get: () => 'running' });
      const stereo = context.createGain(), spatial = context.createGain();
      spatial.channelCount = 16; spatial.channelCountMode = 'explicit'; spatial.channelInterpretation = 'discrete';
      const router = createResonatorSurroundOutput({ context, stereoSource: stereo, spatialSource: spatial,
        getAudioOn: () => true, settings: { enabled, layoutId: '8-circle', forcePreview: true } });
      context.destination.channelCount = 18; context.destination.channelInterpretation = 'discrete';
      let release;
      if (enabled) {
        const split = context.createChannelSplitter(16), merge = context.createChannelMerger(18);
        for (let channel = 0; channel < 16; channel++) split.connect(merge, channel, channel + 2);
        merge.channelInterpretation = 'discrete'; merge.connect(context.destination);
        release = router.tapInto(context, split);
      }
      const source = context.createBufferSource(); source.buffer = context.createBuffer(enabled ? 16 : 2, 4096, 48000);
      source.channelInterpretation = 'discrete';
      if (!enabled) {
        for (let i = 0; i < 4096; i++) { source.buffer.getChannelData(0)[i] = Math.sin(i / 19) * .25; source.buffer.getChannelData(1)[i] = Math.cos(i / 37) * .125; }
      } else {
        const speakers = router.snapshot().speakers;
        const left = speakers.reduce((a, b) => a.x < b.x ? a : b), right = speakers.reduce((a, b) => a.x > b.x ? a : b);
        source.buffer.getChannelData(speakers.indexOf(left)).fill(.125, 0, 128);
        source.buffer.getChannelData(speakers.indexOf(right)).fill(.125, 128, 256);
      }
      source.connect(enabled ? spatial : stereo); source.start();
      const result = await context.startRendering();
      if (!enabled) {
        for (let channel = 0; channel < 2; channel++) for (let frame = 0; frame < 4096; frame++) {
          if (result.getChannelData(channel)[frame] !== source.buffer.getChannelData(channel)[frame]) throw new Error('Stereo default changed samples');
        }
        output.push({ enabled, identical: true });
      } else {
        const left = result.getChannelData(0), right = result.getChannelData(1);
        if (left[64] < .0874 || Math.abs(right[64]) > 1e-6 || right[192] < .0874 || Math.abs(left[192]) > 1e-6) throw new Error('Azimuth preview lost left/right placement');
        let capturePeak = 0;
        for (let channel = 2; channel < 18; channel++) for (let frame = 0; frame < 256; frame++) capturePeak = Math.max(capturePeak, Math.abs(result.getChannelData(channel)[frame]));
        if (capturePeak !== .125) throw new Error('Preview gain leaked into physical recording');
        output.push({ enabled, capturePeak, previewPeak: left[64] });
      }
      release?.(); router.destroy();
    }
    return output;
  });
  expect(report[0].identical).toBe(true);
  expect(report[1].capturePeak).toBe(.125);
  expect(report[1].previewPeak).toBeCloseTo(.0875, 6);
});
