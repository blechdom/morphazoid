const clamp = (value, min, max, fallback) => Math.min(max,
  Math.max(min, Number.isFinite(Number(value)) ? Number(value) : fallback));

export function makeNoise(context, seconds = 0.21, seedValue = 0x518563) {
  const buffer = context.createBuffer(1, Math.max(64, Math.round(context.sampleRate * seconds)),
    context.sampleRate);
  const samples = buffer.getChannelData(0);
  let seed = seedValue >>> 0;
  for (let i = 0; i < samples.length; i += 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    samples[i] = seed / 0xffffffff * 2 - 1;
  }
  return buffer;
}

/** Bounded modal/noise attacks shared by five prototypes; no samples loaded. */
export function createDemoVoices(context, destination, { maxVoices = 12, seed = 0x518563 } = {}) {
  const active = new Set(), noiseBuffer = makeNoise(context, 0.23, seed);
  let disposed = false;
  function hit({
    hz = 220, at = context.currentTime, gain = 0.055, duration = 0.24,
    pan = 0, noise = 0.1, type = 'sine', cutoff = 2200,
  } = {}) {
    if (disposed || active.size >= maxVoices) return false;
    const now = context.currentTime;
    if (!Number.isFinite(at) || at < now - 0.02 || at > now + 0.14) return false;
    const start = Math.max(now + 0.003, at), length = clamp(duration, 0.06, 1.15, 0.24);
    const oscillator = context.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(clamp(hz, 65, Math.min(4200, context.sampleRate * 0.3), 220), start);
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(clamp(cutoff, 250, context.sampleRate * 0.4, 2200), start);
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0.00001, start);
    envelope.gain.exponentialRampToValueAtTime(clamp(gain, 0.0001, 0.11, 0.055)
      / Math.max(1, active.size / 6), start + 0.006);
    envelope.gain.exponentialRampToValueAtTime(0.00001, start + length);
    const panner = context.createStereoPanner();
    panner.pan.value = clamp(pan, -0.85, 0.85, 0);
    oscillator.connect(filter).connect(envelope).connect(panner).connect(destination);

    const grains = context.createBufferSource();
    grains.buffer = noiseBuffer;
    const hiss = context.createBiquadFilter();
    hiss.type = 'bandpass';
    hiss.frequency.value = clamp(cutoff * 0.68, 180, 6000, 1500);
    const noiseLevel = context.createGain();
    noiseLevel.gain.setValueAtTime(0.00001, start);
    noiseLevel.gain.linearRampToValueAtTime(clamp(noise, 0, 0.12, 0.1) * 0.27, start + 0.004);
    noiseLevel.gain.exponentialRampToValueAtTime(0.00001, start + Math.min(length, 0.15));
    grains.connect(hiss).connect(noiseLevel).connect(panner);
    const voice = { oscillator, filter, envelope, panner, grains, hiss, noiseLevel };
    active.add(voice);
    oscillator.onended = () => {
      for (const node of Object.values(voice)) node.disconnect();
      active.delete(voice);
    };
    grains.start(start);
    grains.stop(start + Math.min(length, 0.16));
    oscillator.start(start);
    oscillator.stop(start + length + 0.006);
    return true;
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const voice of active) {
      for (const source of [voice.oscillator, voice.grains]) {
        try { source.stop(); } catch { /* Already ended. */ }
      }
      for (const node of Object.values(voice)) node.disconnect();
    }
    active.clear();
  }
  return { hit, dispose, get activeVoices() { return active.size; } };
}

/** Quiet held audition while a cell or strut is physically pulled. */
export function createDemoHold(context, destination, type = 'sine') {
  const oscillator = context.createOscillator();
  oscillator.type = type;
  const filter = context.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 1600;
  const envelope = context.createGain();
  envelope.gain.value = 0;
  const panner = context.createStereoPanner();
  oscillator.connect(filter).connect(envelope).connect(panner).connect(destination);
  oscillator.start();
  let disposed = false;
  function update({ hz, brightness = 0.5, pan = 0, level = 0.04 }) {
    if (disposed) return;
    const time = context.currentTime;
    oscillator.frequency.setTargetAtTime(clamp(hz, 70, 1000, 240), time, 0.024);
    filter.frequency.setTargetAtTime(700 + clamp(brightness, 0, 1, 0.5) * 4500, time, 0.035);
    panner.pan.setTargetAtTime(clamp(pan, -0.8, 0.8, 0), time, 0.03);
    envelope.gain.setTargetAtTime(clamp(level, 0, 0.08, 0.04), time, 0.025);
  }
  function silence() {
    if (!disposed) envelope.gain.setTargetAtTime(0, context.currentTime, 0.035);
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    try { oscillator.stop(); } catch { /* Already stopped. */ }
    for (const node of [oscillator, filter, envelope, panner]) node.disconnect();
  }
  return { update, silence, dispose };
}
