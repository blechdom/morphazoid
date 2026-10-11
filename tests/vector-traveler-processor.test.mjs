import test from 'node:test';
import assert from 'node:assert/strict';

test('Audio rearm starts at the held Traveler pitch and voice without a height or XY glide', async () => {
  const keys = ['AudioWorkletProcessor', 'registerProcessor', 'sampleRate', 'currentTime'];
  const original = Object.fromEntries(keys.map(key => [key, globalThis[key]]));
  let Processor;
  globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage() {} }; } };
  globalThis.registerProcessor = (_name, implementation) => { Processor = implementation; };
  globalThis.sampleRate = 48000; globalThis.currentTime = 0;
  try {
    await import('../src/instruments/vector-fractals/processor.js');
    const values = value => new Float32Array(64).fill(value);
    const contact = { x: values(0), y: values(-.4), bend: values(0), fold: values(0), turn: values(0), turnPerLap: -2 * Math.PI };
    const snapshot = { version: 1, turns: Array(9).fill(0), pitch: Array(9).fill(3), smoothedPitch: Array(9).fill(3), initialized: Array(9).fill(1) };
    for (const voice of ['sine', 'shepard']) {
      const processor = new Processor({ processorOptions: {
        state: { mode: 'explorer', contourReader: 'traveler', pitch: 160, travelerOctaves: 1, layerVoices: [voice, voice, voice] },
        traceTravel: 100.3, travelerState: snapshot,
        traceBank: { reader: 'traveler', layers: [{ contacts: [contact] }] }, playing: false,
      } });
      const dsp = processor.dsp;
      assert.equal(dsp.traceMix, 1);
      assert.equal(dsp.trace.travelerMix, 1);
      assert.equal(dsp.trace.voiceWeights[voice === 'sine' ? 0 : 3], 1);
      processor.process([], [[new Float32Array(1), new Float32Array(1)]]);
      assert.equal(dsp.frequency, 160);
      assert.equal(dsp.trace.frequencies[0], 640);
      assert.equal(dsp.trace.travelerPitch[0], 3);
    }
  } finally {
    for (const key of keys) if (original[key] === undefined) delete globalThis[key]; else globalThis[key] = original[key];
  }
});
