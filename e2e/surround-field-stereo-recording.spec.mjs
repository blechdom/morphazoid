import { expect, test } from "@playwright/test";

// Use the production class and native Web Audio throughout. Isolating graph
// construction from the DOM lets OfflineAudioContext exercise real 2–32-channel
// layouts without pretending the test machine has a surround output device.
test("Surround Field preserves every speaker in stereo capture and cleans old routes", async ({ page }, testInfo) => {
  await page.goto("surround-field.html", { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(async () => {
    const response = await fetch("/src/instruments/surround-field/surround-field-app.js");
    if (!response.ok) throw new Error("Could not load production SurroundAudio source");
    const app = await response.text();
    const start = app.indexOf("class SurroundAudio {");
    const end = app.indexOf("const audio = new SurroundAudio();");
    if (start < 0 || end < start) throw new Error("SurroundAudio extraction boundary changed");
    const classSource = app.slice(start, end);
    const helpers = await import("/src/instruments/surround-field/surround-field.js");
    const { AudioOutputManager } = await import("/src/audio-output-manager.js");
    const {makeLayouts, outputModeFor, speakerPan, clamp} = helpers;
    const rate = 48000, slot = 0.08, lead = 0.02, signalLength = 0.04, amplitude = 0.1;
    const layoutEntries = Object.entries(makeLayouts()).filter(([id]) => id !== 'custom');
    for (let count = 2; count <= 32; count++) layoutEntries.push(['custom-' + count, makeLayouts(count).custom]);
    function graph(layout, forcePreview, {staleSource = false} = {}) {
      const count = layout.speakers.length;
      const context = new OfflineAudioContext(forcePreview ? 2 : count, Math.ceil((lead + count * slot + 0.06) * rate), rate);
      const manager = new AudioOutputManager({});
      const state = {level: .55, color: .62, gains: Array(count).fill(0)};
      const connect = (c, s, options) => manager.connect(c, s, options);
      const SurroundAudio = new Function('state', 'connectAudioOutput', 'outputModeFor', 'speakerPan', 'clamp', classSource + '\nreturn SurroundAudio;')(state, connect, outputModeFor, speakerPan, clamp);
      const audio = new SurroundAudio();
      audio.context = context;
      audio.master = context.createGain();
      audio.patchInput = context.createGain();
      if (staleSource) {
        audio.rebuildRoutes(layout, false);
        const oldSource = context.createBufferSource();
        const oldBuffer = context.createBuffer(1, context.length, rate);
        oldBuffer.getChannelData(0).fill(.4);
        oldSource.buffer = oldBuffer;
        oldSource.connect(audio.speakerRoutes.at(-1).channelBus);
        oldSource.start();
        const oldPhysical = audio.outputNode, oldPreview = audio.previewLimiter;
        audio.routeSignature = '';
        audio.rebuildRoutes(layout, true);
        if (manager.sources.has(oldPhysical)) throw new Error('Stale physical registration survived rebuild');
        if (manager.sources.get(audio.outputNode)?.stereoSource === oldPreview) throw new Error('Stale preview registration survived rebuild');
      } else audio.rebuildRoutes(layout, forcePreview);
      for (let index = 0; index < count; index++) {
        const source = context.createBufferSource();
        const buffer = context.createBuffer(1, Math.round(signalLength * rate), rate);
        const samples = buffer.getChannelData(0);
        for (let frame = 0; frame < samples.length; frame++) samples[frame] = amplitude * Math.sin(2 * Math.PI * 1000 * frame / rate);
        source.buffer = buffer;
        source.connect(audio.speakerRoutes[index].channelBus);
        source.start(lead + index * slot);
      }
      const record = manager.contexts.get(context);
      const sourceRecord = manager.sources.get(audio.outputNode);
      if (!record || manager.connectionCount() !== 1 || sourceRecord.stereoSource !== audio.previewLimiter) throw new Error('Wrong monitor registration');
      if (sourceRecord.meterTarget !== record.meterBus) throw new Error('Wrong monitor bus');
      return {context, audio, manager, record};
    }
    function peak(samples, index) {
      const from = Math.round((lead + index * slot) * rate);
      const to = Math.min(samples.length, Math.round((lead + (index + 1) * slot) * rate));
      let value = 0;
      for (let frame = from; frame < to; frame++) value = Math.max(value, Math.abs(samples[frame]));
      return value;
    }
    function cleanup({audio, manager}) {
      audio.teardownRoutes();
      if (manager.connectionCount() || manager.contexts.size || audio.speakerRoutes.length || audio.previewBus || audio.previewLimiter || audio.captureBus || audio.outputNode) throw new Error('Teardown retained a route');
    }
    const results = [];
    for (const [id, layout] of layoutEntries) {
      const physical = graph(layout, false);
      if (physical.audio.mode !== 'discrete') throw new Error(id + ': expected discrete mode');
      const discreteBuffer = await physical.context.startRendering();
      let physicalError = 0, crossTalk = 0;
      for (let index = 0; index < layout.speakers.length; index++) {
        const target = layout.speakers[index].channel - 1;
        physicalError = Math.max(physicalError, Math.abs(peak(discreteBuffer.getChannelData(target), index) - amplitude));
        for (let channel = 0; channel < layout.speakers.length; channel++) {
          if (channel !== target) crossTalk = Math.max(crossTalk, peak(discreteBuffer.getChannelData(channel), index));
        }
      }
      cleanup(physical);
      const capture = graph(layout, false);
      capture.audio.outputNode.disconnect(capture.context.destination);
      capture.record.meterBus.connect(capture.context.destination);
      const stereoBuffer = await capture.context.startRendering();
      const preview = graph(layout, true);
      const previewBuffer = await preview.context.startRendering();
      let foldError = 0, previewError = 0, minimumSpeakerPeak = 1;
      for (let index = 0; index < layout.speakers.length; index++) {
        const speaker = layout.speakers[index];
        const pan = speaker.kind === 'lfe' ? 0 : speakerPan(speaker);
        const observed = [peak(stereoBuffer.getChannelData(0), index), peak(stereoBuffer.getChannelData(1), index)];
        // The authored compressor has automatic make-up gain even below threshold.
        // Check panning ratios here; the exact PCM comparison below checks level.
        const expected = [Math.cos((pan + 1) * Math.PI / 4), Math.sin((pan + 1) * Math.PI / 4)];
        const magnitude = Math.hypot(...observed);
        minimumSpeakerPeak = Math.min(minimumSpeakerPeak, Math.max(...observed));
        for (let side = 0; side < 2; side++) foldError = Math.max(foldError, Math.abs(observed[side] / magnitude - expected[side]));
      }
      for (let side = 0; side < 2; side++) {
        const captured = stereoBuffer.getChannelData(side), heard = previewBuffer.getChannelData(side);
        for (let frame = 0; frame < captured.length; frame++) previewError = Math.max(previewError, Math.abs(captured[frame] - heard[frame]));
      }
      cleanup(capture); cleanup(preview);
      results.push({id, channels: layout.speakers.length, physicalError, crossTalk, foldError, previewError, minimumSpeakerPeak});
    }
    const layout = makeLayouts()['8-circle'];
    const stale = graph(layout, false, {staleSource: true});
    stale.audio.outputNode.disconnect(stale.context.destination);
    stale.record.meterBus.connect(stale.context.destination);
    const rebuilt = await stale.context.startRendering();
    const reference = graph(layout, true);
    const clean = await reference.context.startRendering();
    let staleRouteError = 0;
    for (let side = 0; side < 2; side++) {
      const actual = rebuilt.getChannelData(side), expected = clean.getChannelData(side);
      for (let frame = 0; frame < actual.length; frame++) staleRouteError = Math.max(staleRouteError, Math.abs(actual[frame] - expected[frame]));
    }
    cleanup(stale); cleanup(reference);
    return {results, staleRouteError};
  });
  await testInfo.attach("surround-stereo-layout-pcm.json", {
    body: JSON.stringify(result, null, 2),
    contentType: "application/json",
  });
  expect(result.results).toHaveLength(35);
  expect(result.results.reduce((sum, value) => sum + value.channels, 0)).toBe(560);
  for (const entry of result.results) {
    expect(entry.physicalError, `${entry.id}: physical channel gain is unchanged`).toBeLessThan(1e-6);
    expect(entry.crossTalk, `${entry.id}: physical speakers stay isolated`).toBeLessThan(1e-7);
    expect(entry.foldError, `${entry.id}: authored panning survives stereo capture`).toBeLessThan(1e-4);
    expect(entry.previewError, `${entry.id}: recording equals the audible stereo preview`).toBeLessThan(1e-7);
    expect(entry.minimumSpeakerPeak, `${entry.id}: every speaker reaches recording`).toBeGreaterThan(.06);
  }
  expect(result.staleRouteError, "an old still-running source cannot leak after route rebuild").toBeLessThan(1e-7);
});
