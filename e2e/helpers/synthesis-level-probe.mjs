/** Identify the instrument-owned worklet before its audio graph is created. */
export async function prepareSynthesisLevelProbe(page) {
  await page.addInitScript(() => {
    const NativeAudioWorkletNode = globalThis.AudioWorkletNode;
    globalThis.AudioWorkletNode = class extends NativeAudioWorkletNode {
      constructor(context, name, ...options) {
        super(context, name, ...options);
        if (name === 'roads-synthesis') window.__synthesisLevelWorklet = this;
      }
    };
  });
}

/** A silent measurement tap on the actual browser destination's final mix. */
export async function installSynthesisLevelProbe(page) {
  return page.evaluate(async () => {
    const { getSharedAudioOutputManager } = await import('/src/audio-output-manager.js');
    const manager = getSharedAudioOutputManager(globalThis);
    const worklet = window.__synthesisLevelWorklet;
    const record = [...manager.contexts.values()].find(record => record.context === worklet?.context);
    const master = record && [...record.sources][0];
    if (!master || !record.context) throw new Error('Enable Synthesaurus Audio before measuring output.');
    const context = record.context;
    const source = `
      class SynthesisLevelProbe extends AudioWorkletProcessor {
        constructor() {
          super(); this.capture = null;
          this.port.onmessage = ({ data }) => {
            if (data.type === 'capture') this.capture = {
              id: data.id, samples: new Float32Array(data.frames), raw: new Float32Array(data.frames), at: 0,
            };
          };
        }
        process(inputs, outputs) {
          // The real final mix keeps its direct output connection. This branch
          // contributes silence, so collecting samples never doubles its level.
          for (const channel of outputs[0] ?? []) channel.fill(0);
          const capture = this.capture, raw = inputs[0]?.[0], input = inputs[1]?.[0];
          if (!capture || !input || !raw) return true;
          const count = Math.min(input.length, capture.samples.length - capture.at);
          capture.samples.set(input.subarray(0, count), capture.at);
          capture.raw.set(raw.subarray(0, count), capture.at);
          capture.at += count;
          if (capture.at === capture.samples.length) {
            this.port.postMessage({ id: capture.id, samples: capture.samples, raw: capture.raw }, [capture.samples.buffer, capture.raw.buffer]);
            this.capture = null;
          }
          return true;
        }
      }
      registerProcessor('synthesaurus-level-probe', SynthesisLevelProbe);
    `;
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    try { await context.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
    const tap = new AudioWorkletNode(context, 'synthesaurus-level-probe', {
      numberOfInputs: 2, numberOfOutputs: 1, outputChannelCount: [1],
    });
    worklet.connect(tap, 0, 0); master.connect(tap, 0, 1); tap.connect(context.destination);
    let sequence = 0;
    const db = value => value > 0 ? 20 * Math.log10(value) : -180;
    function measure(samples) {
      let peak = 0, energy = 0, nonfinite = 0, clipped = 0;
      const cumulative = new Float64Array(samples.length + 1);
      for (let i = 0; i < samples.length; i++) {
        const value = samples[i];
        if (!Number.isFinite(value)) { nonfinite++; cumulative[i + 1] = energy; continue; }
        peak = Math.max(peak, Math.abs(value));
        if (Math.abs(value) >= 1) clipped++;
        energy += value * value; cumulative[i + 1] = energy;
      }
      const result = { frames: samples.length, seconds: samples.length / context.sampleRate,
        peak, peakDb: db(peak), rmsDb: db(Math.sqrt(energy / samples.length)), nonfinite, clipped };
      for (const ms of [10, 100, 400]) {
        const frames = Math.round(context.sampleRate * ms / 1000);
        let best = 0;
        for (let i = 1; i < cumulative.length; i++) {
          best = Math.max(best, cumulative[i] - cumulative[Math.max(0, i - frames)]);
        }
        result['max' + ms + 'msRmsDb'] = db(Math.sqrt(best / frames));
        result['tail' + ms + 'msRmsDb'] = db(Math.sqrt((energy - cumulative[Math.max(0, samples.length - frames)]) / frames));
      }
      return result;
    }
    window.__captureSynthesaurusPreset = (presetId, seconds) => new Promise((resolve, reject) => {
      const button = document.querySelector('[data-full-preset][data-preset-id="' + presetId + '"]');
      if (!button) { reject(new Error('Missing synthesis preset ' + presetId)); return; }
      const id = ++sequence;
      const timer = setTimeout(() => reject(new Error('Audio capture timed out')), seconds * 1000 + 10000);
      tap.port.onmessage = ({ data }) => {
        if (data.id !== id) return;
        clearTimeout(timer);
        resolve({ ...measure(data.samples), raw: measure(data.raw), state: window.MorphazoidSynthesis.getState(),
          masterGain: master.gain.value, sampleRate: context.sampleRate });
      };
      tap.port.postMessage({ type: 'capture', id, frames: Math.ceil(seconds * context.sampleRate) });
      // Dispatch the production recall handler in the same task as capture,
      // avoiding UI automation delays before a very short attack.
      button.click();
    });
    return { sampleRate: context.sampleRate, masterGain: master.gain.value };
  });
}

export async function captureSynthesisPreset(page, methodId, presetId, seconds) {
  return page.evaluate(({ id, seconds }) => window.__captureSynthesaurusPreset(id, seconds), {
    id: methodId + ':' + presetId, seconds,
  });
}
