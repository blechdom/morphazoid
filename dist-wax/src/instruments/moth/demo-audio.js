import { mothWingFrequency } from './demo-model.js';

/** Two damped papery voices. No borrowed mosquito carrier or animal samples. */
export function createMothDemoAudio(context, destination) {
  const bus = context.createGain();
  bus.gain.value = 0;
  bus.connect(destination);
  const active = new Set();
  let selected = false, disposed = false;
  const buffer = context.createBuffer(1, Math.max(64, Math.round(context.sampleRate * 0.18)), context.sampleRate);
  let seed = 0x617057;
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i += 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    samples[i] = (seed / 0xffffffff) * 2 - 1;
  }

  function setSelected(value) {
    selected = Boolean(value);
    if (!disposed) bus.gain.setTargetAtTime(selected ? 1 : 0, context.currentTime, 0.02);
  }

  function trigger(side, settings, { strength = 0.7, ridge = 0, at = context.currentTime } = {}) {
    if (disposed || !selected || active.size >= 14) return false;
    const when = Math.max(context.currentTime + 0.003, Number(at) || 0);
    if (when > context.currentTime + 0.13) return false;
    const fold = Math.max(0, Math.min(1, side === 'left' ? settings.leftFold : settings.rightFold));
    const span = Math.max(0.68, Math.min(1.35, Number(settings.span) || 1));
    const duration = 0.16 + (1 - fold) * 0.34;
    const velocity = Math.max(0.04, Math.min(1, Number(strength) || 0));
    const frequency = mothWingFrequency(fold, span) * (1 + Math.max(0, Math.min(8, ridge)) * 0.09);
    const oscillator = context.createOscillator();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(frequency, when);
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(800 + (1 - fold) * 2700, when);
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0.0001, when);
    envelope.gain.exponentialRampToValueAtTime(0.045 * velocity, when + 0.009);
    envelope.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    const panner = context.createStereoPanner();
    panner.pan.value = side === 'left' ? -0.62 : 0.62;
    oscillator.connect(filter).connect(envelope).connect(panner).connect(bus);

    const grains = context.createBufferSource();
    grains.buffer = buffer;
    const noiseFilter = context.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 1100 + (1 - fold) * 2000;
    const noiseEnvelope = context.createGain();
    noiseEnvelope.gain.setValueAtTime(0.0001, when);
    noiseEnvelope.gain.linearRampToValueAtTime(0.036 * velocity, when + 0.004);
    noiseEnvelope.gain.exponentialRampToValueAtTime(0.0001, when + 0.085);
    grains.connect(noiseFilter).connect(noiseEnvelope).connect(panner);
    const voice = { oscillator, grains, filter, envelope, noiseFilter, noiseEnvelope, panner };
    active.add(voice);
    oscillator.onended = () => {
      for (const node of Object.values(voice)) node.disconnect();
      active.delete(voice);
    };
    grains.start(when);
    grains.stop(when + 0.1);
    oscillator.start(when);
    oscillator.stop(when + duration + 0.015);
    return true;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const voice of active) {
      try { voice.oscillator.stop(); } catch { /* Already ended. */ }
      try { voice.grains.stop(); } catch { /* Already ended. */ }
      for (const node of Object.values(voice)) node.disconnect();
    }
    active.clear();
    bus.disconnect();
  }
  return { setSelected, trigger, dispose, get activeVoices() { return active.size; } };
}
