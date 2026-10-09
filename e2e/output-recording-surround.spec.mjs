import { expect, test } from "@playwright/test";

// Native browser rendering verifies arbitrary surround layouts instead of
// relying on Web Audio speaker-count downmix rules or fake audio nodes.
test("SPARTIAL preserves every surround channel in its stereo recording", async ({ page }) => {
  await page.goto("/");
  const results = await page.evaluate(async () => {
    const { SpartialAudio, spartialLayout, spartialSpeakers } = await import('/src/instruments/spartial/spartial-audio.js');
    const { speakerPan } = await import('/src/instruments/surround-field/surround-field.js');
    const { getSharedAudioOutputManager } = await import('/src/audio-output-manager.js');
    const manager = getSharedAudioOutputManager();
    const layouts = ['4-ring', '4-1', '8-circle', '8-cube', '7-4-1', '16-ring'];
    const amplitude = 0.125;
    const block = 512;
    const assert = (condition, message) => { if (!condition) throw new Error(message); };
    const expectedStereo = speaker => {
      const angle = (speakerPan(speaker) + 1) * Math.PI / 4;
      return [amplitude * .7 * Math.cos(angle), amplitude * .7 * Math.sin(angle)];
    };
    const rig = frames => {
      const context = new OfflineAudioContext(18, frames, 48000);
      // OfflineAudioContext starts suspended. Treat it as a running clock for
      // the manager's capture eligibility while using native AudioNodes/PCM.
      Object.defineProperty(context, 'state', { get: () => 'running' });
      const audio = new SpartialAudio();
      audio.context = context;
      audio.master = context.createGain();
      audio.master.channelCountMode = 'max';
      audio.master.channelInterpretation = 'discrete';
      const captureInput = context.createChannelSplitter(2);
      const captureOutput = context.createChannelMerger(18);
      captureOutput.channelInterpretation = 'discrete';
      captureInput.connect(captureOutput, 0, 16);
      captureInput.connect(captureOutput, 1, 17);
      captureOutput.connect(context.destination);
      let releaseTap;
      const route = (layoutId, forcePreview) => {
        audio.layoutId = layoutId;
        audio.forcePreview = forcePreview;
        audio.rebuildRoutes();
        // Reserve channels 16/17 as an independent test readout of the stereo
        // recorder tap. Channels 0..15 retain the physical route unchanged.
        context.destination.channelCount = 18;
        context.destination.channelInterpretation = 'discrete';
        assert(manager.connectionCount() === 1, 'route rebuild left a stale output');
        assert(manager.contexts.size === 1, 'route rebuild left a stale context record');
      };
      route('4-ring', false);
      releaseTap = manager.tapInto(context, captureInput);
      const tap = [...manager.recordingTaps][0];
      return { context, audio, route, tap, cleanup() {
        releaseTap(); audio.releaseOutput(); audio.master.disconnect();
        for (const node of audio.routes) node.disconnect();
        captureInput.disconnect(); captureOutput.disconnect();
        assert(manager.connectionCount() === 0 && manager.contexts.size === 0 && manager.recordingTaps.size === 0, 'teardown leaked an output/tap');
      } };
    };
    const render = async (layoutId, forcePreview) => {
      const layout = spartialLayout(layoutId);
      const speakers = spartialSpeakers(layout);
      const { context, audio, route, tap, cleanup } = rig(speakers.length * block + block);
      // Rebuild with an active recorder lease to exercise old monitor cleanup
      // and attachment of the replacement context record.
      route('16-ring', true);
      route(layoutId, forcePreview);
      assert(tap.connections.size === 1, 'capture did not reconnect after route rebuild');
      const source = context.createBufferSource();
      source.buffer = context.createBuffer(16, context.length, context.sampleRate);
      for (let index = 0; index < speakers.length; index += 1) {
        source.buffer.getChannelData(index).fill(amplitude, index * block, index * block + block / 2);
      }
      source.channelInterpretation = 'discrete';
      source.connect(audio.master); source.start();
      const rendered = await context.startRendering();
      const stereo = [rendered.getChannelData(16), rendered.getChannelData(17)];
      const channels = [];
      let maxError = 0;
      for (let index = 0; index < speakers.length; index += 1) {
        const frame = index * block + 128;
        const expected = expectedStereo(speakers[index]);
        const actual = stereo.map(data => data[frame]);
        assert(Math.max(...actual.map(Math.abs)) > .001, `${layoutId} ${speakers[index].label} is absent from stereo`);
        for (let side = 0; side < 2; side += 1) {
          maxError = Math.max(maxError, Math.abs(expected[side] - actual[side]));
          assert(Math.abs(expected[side] - actual[side]) < 1e-6, `${layoutId}: incorrect authored pan on speaker ${speakers[index].channel}`);
        }
        for (let channel = 0; channel < 16; channel += 1) {
          const expectedPhysical = forcePreview ? (expected[channel] ?? 0) : (channel === speakers[index].channel - 1 ? amplitude : 0);
          assert(Math.abs(rendered.getChannelData(channel)[frame] - expectedPhysical) < 1e-6, `${layoutId}: physical channel ${channel + 1} changed for speaker ${speakers[index].channel}`);
        }
        channels.push({ channel: speakers[index].channel, label: speakers[index].label, stereo: actual });
      }
      const copies = stereo.map(data => Array.from(data));
      cleanup();
      return { layoutId, mode: forcePreview ? 'preview' : 'discrete', channels, maxError, copies };
    };
    const results = [];
    for (const layoutId of layouts) {
      const discrete = await render(layoutId, false);
      const preview = await render(layoutId, true);
      let maxDifference = 0;
      for (let side = 0; side < 2; side += 1) for (let frame = 0; frame < discrete.copies[side].length; frame += 1) {
        maxDifference = Math.max(maxDifference, Math.abs(discrete.copies[side][frame] - preview.copies[side][frame]));
      }
      assert(maxDifference === 0, `${layoutId}: discrete monitor differs from audible stereo preview`);
      delete discrete.copies; delete preview.copies;
      results.push({ layoutId, speakers: discrete.channels.length, discrete, preview, maxDifference });
    }

    // Rebuild during an existing take, retaining the same clock and tap.
    const frameCount = 12288;
    const { context, audio, route, tap, cleanup } = rig(frameCount);
    route('8-circle', false);
    const source = context.createBufferSource();
    source.buffer = context.createBuffer(16, frameCount, context.sampleRate);
    source.buffer.getChannelData(7).fill(amplitude);
    source.channelInterpretation = 'discrete';
    source.connect(audio.master); source.start();
    const suspended = context.suspend(4096 / context.sampleRate);
    const rendering = context.startRendering();
    await suspended;
    route('16-ring', true);
    assert(tap.connections.size === 1, 'tap lost at first live rebuild');
    const suspendedAgain = context.suspend(8192 / context.sampleRate);
    await context.resume();
    await suspendedAgain;
    route('8-cube', false);
    assert(tap.connections.size === 1, 'tap lost at second live rebuild');
    await context.resume();
    const rendered = await rendering;
    const segments = [
      { frame: 2048, layoutId: '8-circle', preview: false },
      { frame: 6144, layoutId: '16-ring', preview: true },
      { frame: 10240, layoutId: '8-cube', preview: false },
    ];
    for (const segment of segments) {
      const speaker = spartialSpeakers(spartialLayout(segment.layoutId))[7];
      const expected = expectedStereo(speaker);
      segment.stereo = [rendered.getChannelData(16)[segment.frame], rendered.getChannelData(17)[segment.frame]];
      for (let side = 0; side < 2; side += 1) assert(Math.abs(segment.stereo[side] - expected[side]) < 1e-6, 'live rebuild lost or doubled monitor signal');
      for (let channel = 0; channel < 16; channel += 1) {
        const physical = segment.preview ? (expected[channel] ?? 0) : (channel === speaker.channel - 1 ? amplitude : 0);
        assert(Math.abs(rendered.getChannelData(channel)[segment.frame] - physical) < 1e-6, 'live rebuild changed physical channel isolation');
      }
    }
    cleanup();
    return { layouts: results, liveTakeRouteChanges: segments, managerClean: manager.contexts.size === 0 };
  });
  expect(results.layouts).toHaveLength(6);
  expect(results.layouts.every(result => result.maxDifference === 0)).toBe(true);
  expect(results.managerClean).toBe(true);
  await test.info().attach("spartial-stereo-routing.json", {
    body: JSON.stringify(results, null, 2),
    contentType: "application/json",
  });
});
