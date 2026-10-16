export const WOBBLINI_DECK_COUNT = 8;
export const WOBBLINI_LOOP_BEATS = Object.freeze([0.5, 1, 2, 4, 8, 16, 32]);
export const WOBBLINI_DEMOS = Object.freeze([
  { name: "Pocket kick", color: "#ff7968" },
  { name: "Velvet snare", color: "#ffb75e" },
  { name: "Glass hats", color: "#f5d76a" },
  { name: "Rubber bass", color: "#a3df77" },
  { name: "Orbit bells", color: "#68ddcb" },
  { name: "Liquid chords", color: "#6fb9ff" },
  { name: "Wood chatter", color: "#b399ff" },
  { name: "Air ribbon", color: "#f099d7" },
].map((demo, id) => Object.freeze({ ...demo, id, bpm: 120, beats: 16, duration: 8 })));

export function clamp(value, min, max, fallback = min) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

export function createDeckState(id) {
  if (!Number.isInteger(id) || id < 0 || id >= WOBBLINI_DECK_COUNT) throw new RangeError("Unknown Wobblini deck.");
  const demo = WOBBLINI_DEMOS[id];
  return { id, name: demo.name, kind: "demo", duration: demo.duration,
    position: 0, anchorTime: 0, playing: false, rate: 1, bpm: demo.bpm,
    cuePoint: 0, loopBeats: 16, loopEnabled: true, loopStart: 0, loopEnd: demo.duration,
    gain: 0.7, pan: 0, mute: false, solo: false, eq: { low: 0, mid: 0, high: 0 },
    filter: 0, assignment: id < 4 ? "A" : "B", loading: false, scratching: false, scratchVelocity: 0 };
}

/** Only musical mix fields can be patched; callers cannot mutate live clocks. */
export function sanitizeDeckPatch(patch = {}, current = createDeckState(0)) {
  const result = {};
  for (const [key, min, max] of [["rate", 0.5, 2], ["bpm", 40, 240], ["gain", 0, 1], ["pan", -1, 1], ["filter", -1, 1]]) {
    if (Object.hasOwn(patch, key)) result[key] = clamp(patch[key], min, max, current[key]);
  }
  for (const key of ["mute", "solo"]) if (typeof patch[key] === "boolean") result[key] = patch[key];
  if (["A", "THRU", "B"].includes(patch.assignment)) result.assignment = patch.assignment;
  if (patch.eq && typeof patch.eq === "object") {
    result.eq = { ...current.eq };
    for (const key of ["low", "mid", "high"]) {
      if (Object.hasOwn(patch.eq, key)) result.eq[key] = clamp(patch.eq[key], -24, 12, current.eq[key]);
    }
  }
  return result;
}

export function sanitizeMasterPatch(patch = {}, current = {}) {
  const result = {};
  for (const [key, min, max, fallback] of [["gain", 0, 1, 0.65], ["crossfader", -1, 1, 0],
    ["wobbleAmount", 0, 1, 0], ["wobbleRate", 0.125, 8, 2]]) {
    if (Object.hasOwn(patch, key)) result[key] = clamp(patch[key], min, max, current[key] ?? fallback);
  }
  return result;
}

/** Equal-power A/B crossfade, with exact silence at the endpoints. */
export function crossfadeGains(value) {
  const position = (clamp(value, -1, 1, 0) + 1) / 2;
  return { A: position === 1 ? 0 : Math.cos(position * Math.PI / 2),
    B: position === 0 ? 0 : Math.sin(position * Math.PI / 2), THRU: 1 };
}

/** Audio-clock projection also works with the silent monotonic clock. */
export function deckPosition(state, time) {
  const elapsed = state.playing && !state.scratching ? Math.max(0, time - state.anchorTime) * state.rate : 0;
  let position = state.position + elapsed;
  if (state.loopEnabled && state.loopEnd > state.loopStart && position >= state.loopEnd - 1e-9) {
    position = state.loopStart + (Math.max(position, state.loopEnd) - state.loopStart) % (state.loopEnd - state.loopStart);
  }
  return clamp(position, 0, state.duration);
}

export function beatLoop(position, beats, bpm, duration) {
  const length = clamp(beats, 0.5, 32, 4) * 60 / clamp(bpm, 40, 240, 120);
  const beat = 60 / clamp(bpm, 40, 240, 120);
  const start = Math.min(Math.floor(clamp(position, 0, duration) / beat + 1e-8) * beat, Math.max(0, duration - Math.min(length, duration)));
  return { loopStart: start, loopEnd: Math.min(duration, start + length) };
}

/** Integrate a linear frequency ramp so visual wobble follows oscillator phase. */
export function wobbleAt(clock, time) {
  const elapsed = Math.max(0, time - clock.time), duration = Math.max(0, clock.endTime - clock.time);
  const rampTime = Math.min(elapsed, duration);
  const slope = duration > 0 ? (clock.targetFrequency - clock.frequency) / duration : 0;
  const cycles = clock.phase + clock.frequency * rampTime + slope * rampTime * rampTime / 2
    + clock.targetFrequency * Math.max(0, elapsed - duration);
  const phase = ((cycles % 1) + 1) % 1;
  return { phase, value: Math.sin(phase * Math.PI * 2),
    frequency: elapsed >= duration ? clock.targetFrequency : clock.frequency + slope * rampTime };
}

export function waveformPeaks(channels, bins = 256) {
  const length = channels[0]?.length ?? 0;
  const peaks = new Float32Array(Math.max(1, Math.min(1024, Math.trunc(bins))));
  for (let bin = 0; bin < peaks.length; bin++) {
    const first = Math.floor(bin * length / peaks.length), last = Math.ceil((bin + 1) * length / peaks.length);
    for (const channel of channels) for (let sample = first; sample < last; sample++) {
      const value = channel[sample];
      if (Number.isFinite(value)) peaks[bin] = Math.max(peaks[bin], Math.min(1, Math.abs(value)));
    }
  }
  return peaks;
}

/** Original procedural phrases: no external recordings, samples, or note quantizer. */
export function createDemoSamples(id, sampleRate = 24000) {
  const demo = WOBBLINI_DEMOS[id];
  if (!demo) throw new RangeError("Unknown Wobblini demo.");
  sampleRate = Math.round(clamp(sampleRate, 8000, 96000, 24000));
  const samples = new Float32Array(Math.round(demo.duration * sampleRate));
  let random = 0x12345678 + id * 10007;
  const noise = () => { random ^= random << 13; random ^= random >>> 17; random ^= random << 5; return (random >>> 0) / 2147483648 - 1; };
  const tau = Math.PI * 2;
  for (let i = 0; i < samples.length; i++) {
    const time = i / sampleRate, beat = time * 2, step = Math.floor(beat * 2), beatTime = time % 0.5;
    let value = 0;
    if (id === 0) value = Math.sin(tau * (48 * beatTime + 3 * (1 - Math.exp(-beatTime * 34)))) * Math.exp(-beatTime * 15) * 0.8;
    if (id === 1 && Math.floor(beat) % 2 === 1) value = (noise() * 0.54 + Math.sin(tau * 176 * beatTime) * 0.28) * Math.exp(-beatTime * 19);
    if (id === 2) { const phase = time % 0.25; value = (noise() + Math.sin(tau * 7270 * time) * 0.2) * Math.exp(-phase * (step % 4 === 3 ? 35 : 80)) * 0.25; }
    if (id === 3) { const phase = time % 0.5, frequency = 49 * [1, 1, 1.5, 1.333333][Math.floor(beat / 4) % 4]; value = (Math.sin(tau * frequency * time) + 0.28 * Math.sin(tau * frequency * 3 * time)) * Math.exp(-phase * 5) * 0.48; }
    if (id === 4 && step % 3 === 0) { const phase = time % 0.25, frequency = 244 * [1, 1.5, 1.25, 1.75][Math.floor(step / 3) % 4]; value = (Math.sin(tau * frequency * phase) + 0.35 * Math.sin(tau * frequency * 2.76 * phase)) * Math.exp(-phase * 13) * 0.32; }
    if (id === 5) { const phase = time % 2, base = 98 * (Math.floor(time / 4) ? 4 / 3 : 1); value = [1, 1.25, 1.5, 2.125].reduce((sum, ratio) => sum + Math.sin(tau * base * ratio * time), 0) * Math.sin(Math.PI * phase / 2) ** 2 * 0.075; }
    if (id === 6 && [0, 3, 5, 6].includes(step % 8)) { const phase = time % 0.25; value = (Math.sin(tau * 413 * phase) + 0.6 * Math.sin(tau * 907 * phase)) * Math.exp(-phase * 47) * 0.3; }
    if (id === 7) { const phase = time % 2; value = (noise() * 0.25 + Math.sin(tau * 138.6 * time) * 0.35) * Math.sin(Math.PI * phase / 2) ** 4 * 0.2; }
    // Tiny edge fades remove loop-boundary discontinuities without changing tempo.
    const edge = Math.min(1, time / 0.004, (demo.duration - time) / 0.004);
    samples[i] = value * edge;
  }
  return { samples, sampleRate, duration: demo.duration, bpm: demo.bpm };
}
