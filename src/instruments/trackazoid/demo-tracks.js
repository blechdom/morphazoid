/** Original procedural demo music. No samples, network, or audio context needed. */
export const DEMO_TRACKS = Object.freeze([
  { id: "mint-transmission", name: "Mint transmission", bpm: 120, beats: 32, description: "House · round bass and chiming eighths" },
  { id: "amber-circuit", name: "Amber circuit", bpm: 126, beats: 32, description: "Techno · steady kick and bright pulse" },
  { id: "broken-orbit", name: "Broken orbit", bpm: 110, beats: 64, description: "Breakbeat · syncopated drums and plucked bass" },
  { id: "velvet-current", name: "Velvet current", bpm: 90, beats: 32, description: "Downtempo · spacious drums and floating chords" },
  { id: "chrome-parade", name: "Chrome parade", bpm: 116, beats: 64, description: "Disco · offbeat chords and octave bass" },
  { id: "cobalt-rush", name: "Cobalt rush", bpm: 174, beats: 64, description: "Drum & bass · rolling hats and growling low end" },
].map((track) => Object.freeze({ ...track, beatOffset: 0 })));

const SAMPLE_RATE = 24000, TAU = 2 * Math.PI;
const clampSample = (value) => Math.round(Math.max(-1, Math.min(1, value)) * 32767);

function wav(frames) {
  const bytes = new ArrayBuffer(44 + frames * 4), view = new DataView(bytes);
  const text = (offset, value) => { [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0))); };
  text(0, "RIFF"); view.setUint32(4, 36 + frames * 4, true); text(8, "WAVE"); text(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true); view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 4, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true);
  text(36, "data"); view.setUint32(40, frames * 4, true);
  return { bytes, view };
}

// Preserve the initial demo pair byte-for-byte, including their library identity.
function legacyDemo(track, variant) {
  const bpm = track.bpm, duration = 32 * 60 / bpm, frames = Math.ceil(duration * SAMPLE_RATE);
  const { bytes, view } = wav(frames);
  let seed = 123456 + variant;
  for (let i = 0; i < frames; i++) {
    const t = i / SAMPLE_RATE, beat = t * bpm / 60, phase = (beat % 1) * 60 / bpm;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = seed / 2147483648 - 1;
    const kick = Math.sin(2 * Math.PI * (46 * phase + 9 * (1 - Math.exp(-phase * 30)))) * Math.exp(-phase * 18) * 0.43;
    const hatPhase = (beat * 2 % 1) * 30 / bpm;
    const hat = noise * Math.exp(-hatPhase * 150) * 0.1;
    const note = [55, 55, 65.4, 49][Math.floor(beat / 2) % 4] * (variant ? 1.5 : 1);
    const bass = Math.sin(2 * Math.PI * note * t) * Math.exp(-phase * 6) * 0.16;
    const chimePhase = (beat % 2) * 60 / bpm;
    const chime = Math.sin(2 * Math.PI * (variant ? 660 : 440) * t) * Math.exp(-chimePhase * 5) * 0.045;
    const fade = Math.min(1, t / 0.003, (duration - t) / 0.01);
    const value = (kick + hat + bass + chime) * fade;
    view.setInt16(44 + i * 4, clampSample(value), true);
    view.setInt16(46 + i * 4, clampSample(value - chime * 0.5), true);
  }
  return bytes;
}

function renderGroove(track) {
  const beatSeconds = 60 / track.bpm, duration = track.beats * beatSeconds;
  const frames = Math.ceil(duration * SAMPLE_RATE);
  const left = new Float32Array(frames), right = new Float32Array(frames);
  let seed = 0x51f15e + track.bpm;
  const noise = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2147483648 - 1; };

  // Render finite voices into a bounded buffer. Each voice has a short edge ramp;
  // event times derive directly from beats, never from timers or accumulated steps.
  function voice(beat, seconds, gain, pan, sample) {
    const start = Math.round(beat * beatSeconds * SAMPLE_RATE);
    const length = Math.min(Math.ceil(seconds * SAMPLE_RATE), frames - start);
    const l = gain * (1 - Math.max(0, pan)), r = gain * (1 + Math.min(0, pan));
    for (let i = 0; i < length; i++) {
      const t = i / SAMPLE_RATE;
      const edge = Math.min(1, t / 0.001, (length - 1 - i) / (SAMPLE_RATE * 0.008));
      const value = sample(t) * edge;
      left[start + i] += value * l; right[start + i] += value * r;
    }
  }
  const kick = (beat, gain = 1) => voice(beat, 0.28, 0.4 * gain, 0,
    (t) => Math.sin(TAU * (45 * t + 3 * (1 - Math.exp(-t * 45)))) * Math.exp(-t * 18));
  const snare = (beat, gain = 1, clap = false) => {
    let previous = 0;
    voice(beat, 0.2, 0.19 * gain, 0.04, (t) => {
      const n = noise(), high = n - previous * 0.65; previous = n;
      const burst = clap ? 0.55 + 0.45 * Math.max(0, Math.cos(TAU * t / 0.012)) : 1;
      return (high * 0.72 * burst + Math.sin(TAU * 185 * t) * 0.28) * Math.exp(-t * (clap ? 24 : 32));
    });
  };
  const hat = (beat, open = false, gain = 1, pan = 0.22) => {
    let previous = 0;
    voice(beat, open ? 0.19 : 0.06, 0.052 * gain, pan, (t) => {
      const n = noise(), high = n - previous; previous = n;
      return high * Math.exp(-t * (open ? 25 : 85));
    });
  };
  const bass = (beat, frequency, length = 0.6, gain = 1, growl = false) => voice(beat, length * beatSeconds, 0.16 * gain, 0, (t) => {
    const phase = TAU * frequency * t;
    const tone = growl ? Math.tanh((Math.sin(phase) + Math.sin(TAU * (frequency + 0.8) * t)) * 1.2) * 0.65
      : Math.sin(phase) + Math.sin(phase * 2) * 0.22 + Math.sin(phase * 3) * 0.08;
    return tone * (1 - Math.exp(-t * 150)) * Math.exp(-t * (growl ? 3 : 7));
  });
  const chord = (beat, root, length, gain, pad = false) => {
    for (const [index, ratio] of [1, 6 / 5, 3 / 2, 9 / 5].entries()) {
      voice(beat, length * beatSeconds, gain / 4, (index - 1.5) * 0.35, (t) => {
        const phase = TAU * root * ratio * t;
        const attack = 1 - Math.exp(-t * (pad ? 7 : 180));
        return (Math.sin(phase) + Math.sin(phase * 2) * (pad ? 0.08 : 0.28)) * attack * Math.exp(-t * (pad ? 1.3 : 12));
      });
    }
  };
  const bell = (beat, frequency, gain, pan) => voice(beat, 0.8, gain, pan, (t) =>
    (Math.sin(TAU * frequency * t) + Math.sin(TAU * frequency * 2.71 * t) * 0.3 * Math.exp(-t * 14)) * Math.exp(-t * 7));

  for (let bar = 0; bar < track.beats / 4; bar++) {
    const at = bar * 4, root = 55 * [1, 1, 6 / 5, 8 / 9][Math.floor(bar / 2) % 4];
    if (track.id === "broken-orbit") {
      for (const beat of bar % 2 ? [0, 0.75, 2.5] : [0, 1.5, 2.75]) kick(at + beat);
      for (const beat of [1, 3]) snare(at + beat);
      if (bar % 4 === 3) snare(at + 3.75, 0.3);
      for (let step = 0; step < 8; step++) hat(at + step / 2, step === 5, step % 2 ? 0.7 : 1, step % 2 ? -0.3 : 0.3);
      for (const [beat, ratio] of [[0, 1], [0.75, 1], [1.5, 1.5], [2.75, 1], [3.5, 1.2]]) bass(at + beat, root * ratio);
      chord(at + 0.5, root * 4, 0.7, 0.085); chord(at + 2.5, root * 4, 0.7, 0.06);
    } else if (track.id === "velvet-current") {
      kick(at); kick(at + (bar % 2 ? 2.75 : 2.5), 0.75); snare(at + 2, 0.7);
      for (let step = 0; step < 8; step++) hat(at + step / 2 + (step % 2 ? 0.08 : 0), false, 0.45, step % 2 ? -0.4 : 0.4);
      bass(at, root, 2.5, 0.75); bass(at + 3, root * 1.5, 0.8, 0.6);
      chord(at, root * 4, 3.9, 0.11, true);
      bell(at + 1.5, root * (bar % 2 ? 8 : 6), 0.045, -0.4);
      if (bar % 2) bell(at + 3.25, root * 9, 0.03, 0.4);
    } else if (track.id === "chrome-parade") {
      for (let beat = 0; beat < 4; beat++) { kick(at + beat, 0.85); hat(at + beat + 0.5, true, 0.85, 0.28); }
      for (const beat of [1, 3]) snare(at + beat, 0.75, true);
      for (let step = 0; step < 8; step++) bass(at + step / 2, root * (step % 3 === 2 ? 2 : 1), 0.36, step % 2 ? 0.85 : 1);
      for (const beat of [0.5, 1.5, 2.75, 3.5]) chord(at + beat, root * 4, 0.45, 0.105);
      if (bar % 4 === 3) bell(at + 3, root * 12, 0.035, -0.3);
    } else {
      for (const beat of bar % 2 ? [0, 0.5, 2.75] : [0, 1.75, 2.5]) kick(at + beat, 1.05);
      for (const beat of [1, 3]) snare(at + beat, 1.1);
      for (let step = 0; step < 16; step++) hat(at + step / 4, step === 10, step % 2 ? 0.35 : 0.9, step % 2 ? -0.25 : 0.25);
      for (const [beat, ratio, length] of [[0, 1, 1.4], [1.75, 1, 0.6], [2.5, 8 / 9, 1.2]]) bass(at + beat, root * ratio, length, 1, true);
      if (bar % 2 === 0) chord(at + 0.5, root * 8, 1.6, 0.055, true);
      if (bar % 4 === 3) for (const beat of [3.5, 3.75]) snare(at + beat, 0.35);
    }
  }

  let peak = 0;
  for (let i = 0; i < frames; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  const gain = Math.min(1, 0.78 / peak), { bytes, view } = wav(frames);
  for (let i = 0; i < frames; i++) {
    const fade = Math.min(1, i / (SAMPLE_RATE * 0.003), (frames - 1 - i) / (SAMPLE_RATE * 0.012));
    view.setInt16(44 + i * 4, clampSample(left[i] * gain * fade), true);
    view.setInt16(46 + i * 4, clampSample(right[i] * gain * fade), true);
  }
  return bytes;
}

function findTrack(id) {
  const track = DEMO_TRACKS.find((entry) => entry.id === id);
  if (!track) throw new RangeError(`Unknown Trackazoid demo: ${String(id)}`);
  return track;
}

/** A fresh, deterministic 24 kHz, stereo, 16-bit PCM WAV (at most 35 seconds). */
export function createDemoWav(id) {
  const track = findTrack(id);
  if (id === "mint-transmission") return legacyDemo(track, 0);
  if (id === "amber-circuit") return legacyDemo(track, 1);
  return renderGroove(track);
}

export function createDemoFile(id) {
  const track = findTrack(id);
  return new File([createDemoWav(id)], `${track.name} — ${track.bpm} BPM.wav`, { type: "audio/wav", lastModified: 1 });
}
