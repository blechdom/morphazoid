/** Browser input choices. Rust's source IDs remain unchanged. */
export const PROCESSING_INPUT_OPTIONS = Object.freeze([
  { id: "microphone", label: "Mic / audio-in", group: "Live input / files", source: 0, kind: "microphone" },
  { id: "file", label: "Audio file", group: "Live input / files", source: 0, kind: "file" },
  { id: "sample-drums", label: "Acoustic drums", group: "Sample loops", source: 0, kind: "demo" },
  { id: "music-bass", label: "Bass groove", group: "Sample loops", source: 0, kind: "demo" },
  { id: "music-keys", label: "Electric piano chords", group: "Sample loops", source: 0, kind: "demo" },
  { id: "music-plucks", label: "Plucked strings", group: "Sample loops", source: 0, kind: "demo" },
  { id: "music-arp", label: "Synth arpeggio", group: "Sample loops", source: 0, kind: "demo" },
  { id: "voice-bdl", label: "Lower voice syllables", group: "Sample loops", source: 0, kind: "demo" },
  { id: "voice-slt", label: "Higher voice syllables", group: "Sample loops", source: 0, kind: "demo" },
  { id: "speech", label: "Synthetic speech", group: "Sample loops", source: 0, kind: "demo" },
  { id: "birdsong", label: "Birdsong", group: "Sample loops", source: 0, kind: "demo" },
  { id: "noise", label: "White noise", group: "Test signals", source: 3, kind: "signal" },
  { id: "pink-noise", label: "Pink noise", group: "Test signals", source: 8, kind: "signal" },
  { id: "brown-noise", label: "Brown noise", group: "Test signals", source: 9, kind: "signal" },
  { id: "gaussian-noise", label: "Gaussian white noise", group: "Test signals", source: 10, kind: "signal" },
  { id: "sine", label: "Sine tone", group: "Test signals", source: 1, kind: "signal" },
  { id: "two-tone", label: "Two tones", group: "Test signals", source: 2, kind: "signal" },
  { id: "impulses", label: "Impulse train", group: "Test signals", source: 4, kind: "signal" },
  { id: "pulse-saw", label: "Pulse / saw", group: "Test signals", source: 5, kind: "signal" },
  { id: "drum-pattern", label: "Synthetic drum pattern", group: "Test signals", source: 6, kind: "signal" },
  { id: "voiced-phrase", label: "Synthetic voiced phrase", group: "Test signals", source: 7, kind: "signal" },
].map(option => Object.freeze(option)));

export function getProcessingInput(id) {
  return PROCESSING_INPUT_OPTIONS.find(option => option.id === id) ?? null;
}

// Locally bundled recordings and original rendered musical loops. CMU banks
// contain edited phoneme excerpts, not sentence recordings. Credits stay with the assets.
const DEMOS = Object.freeze({
  "sample-drums": {
    paths: ["puggler/kick.wav", "puggler/snare.wav", "puggler/hat.wav", "puggler/tom.wav"],
    credit: "Karoryfer acoustic drums · CC0 · two-bar arrangement at 120 BPM",
    creditPath: "puggler/CREDITS.md",
  },
  "music-bass": {
    paths: ["synthesis/loops/bass-groove.wav"],
    credit: "Morphazoid · original subtractive bass phrase · 120 BPM · MIT",
    creditPath: "synthesis/loops/CREDITS.md",
    loop: true,
  },
  "music-keys": {
    paths: ["synthesis/loops/electric-piano.wav"],
    credit: "Morphazoid · original FM electric piano phrase · 120 BPM · MIT",
    creditPath: "synthesis/loops/CREDITS.md",
    loop: true,
  },
  "music-plucks": {
    paths: ["synthesis/loops/plucked-strings.wav"],
    credit: "Morphazoid · original Karplus–Strong strings phrase · 120 BPM · MIT",
    creditPath: "synthesis/loops/CREDITS.md",
    loop: true,
  },
  "music-arp": {
    paths: ["synthesis/loops/synth-arpeggio.wav"],
    credit: "Morphazoid · original wavetable arpeggio phrase · 120 BPM · MIT",
    creditPath: "synthesis/loops/CREDITS.md",
    loop: true,
  },
  "voice-bdl": {
    paths: ["audio/vocalzoid-cmu-arctic-bdl.wav"],
    credit: "CMU ARCTIC BDL · edited voice syllables · permissive license",
    creditPath: "../vendor/cmu-arctic/COPYING",
  },
  "voice-slt": {
    paths: ["audio/vocalzoid-cmu-arctic-slt.wav"],
    credit: "CMU ARCTIC SLT · edited voice syllables · permissive license",
    creditPath: "../vendor/cmu-arctic/COPYING",
  },
  speech: {
    paths: ["puggler/mic-check.wav"],
    credit: "Morphazoid · original eSpeak synthetic speech · MIT",
    creditPath: "puggler/CREDITS.md",
  },
  birdsong: {
    paths: ["bioacoustics/chaffinch.ogg"],
    credit: "Chaffinch recorded by Oona Räisänen · public-domain dedication",
    creditPath: "bioacoustics/SOURCES.md",
  },
});
const assetUrl = path => new URL(`../../../assets/${path}`, import.meta.url);
const finiteSample = value => Number.isFinite(value) ? value : 0;

function checkCancelled(signal) {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  const error = new Error("Demo input loading was cancelled.");
  error.name = "AbortError";
  throw error;
}

async function decodeAsset(context, path, signal) {
  checkCancelled(signal);
  const response = await fetch(assetUrl(path), { signal });
  if (!response.ok) throw new Error(`Demo input could not load (${response.status}).`);
  const bytes = await response.arrayBuffer();
  checkCancelled(signal);
  const buffer = await context.decodeAudioData(bytes);
  checkCancelled(signal);
  if (!buffer.length || !buffer.numberOfChannels || !(buffer.sampleRate > 0)) {
    throw new Error("The demo recording contains no audio.");
  }
  return buffer;
}

/** Keep recorded attacks and crest factor, using one static gain for a loop. */
function balance(buffer, activeFrames = buffer.length, fadeEdges = true) {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
  const edge = Math.min(Math.round(buffer.sampleRate * .004), Math.floor(activeFrames / 2));
  let peak = 0, energy = 0;
  for (const data of channels) {
    let mean = 0;
    for (let i = 0; i < activeFrames; i++) mean += finiteSample(data[i]);
    mean /= activeFrames;
    for (let i = 0; i < activeFrames; i++) {
      const fade = fadeEdges && edge ? Math.min(1, i / edge, (activeFrames - 1 - i) / edge) : 1;
      const value = (finiteSample(data[i]) - mean) * fade;
      data[i] = value;
      peak = Math.max(peak, Math.abs(value));
      energy += value * value;
    }
  }
  const rms = Math.sqrt(energy / (activeFrames * channels.length));
  // At most +18 dB of static gain; transients keep at least 1.7 dB headroom.
  const gain = Math.min(8, .16 / Math.max(rms, 1e-8), .82 / Math.max(peak, 1e-8));
  for (const data of channels) for (let i = 0; i < activeFrames; i++) data[i] *= gain;
  return buffer;
}

function prepareRecording(context, decoded, id) {
  const frames = Math.min(decoded.length, Math.round(decoded.sampleRate * 30));
  // A short rest makes speech articulation and processor tails easy to compare.
  const loop = DEMOS[id].loop === true;
  const rest = loop || id === "birdsong" ? 0 : Math.round(decoded.sampleRate * .35);
  const buffer = context.createBuffer(Math.min(2, decoded.numberOfChannels), frames + rest, decoded.sampleRate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    buffer.getChannelData(channel).set(decoded.getChannelData(channel).subarray(0, frames));
  }
  return balance(buffer, frames, !loop);
}

function arrangeDrums(context, recordings) {
  const sampleRate = context.sampleRate;
  const frames = Math.round(sampleRate * 4);
  const buffer = context.createBuffer(2, frames, sampleRate);
  const left = buffer.getChannelData(0), right = buffer.getChannelData(1);
  const mix = (sample, beat, level, pan) => {
    const data = sample.getChannelData(0), offset = Math.round(beat * .5 * sampleRate);
    const ratio = sample.sampleRate / sampleRate;
    const count = Math.min(frames, Math.ceil(data.length / ratio));
    const gainLeft = Math.sqrt((1 - pan) / 2) * level;
    const gainRight = Math.sqrt((1 + pan) / 2) * level;
    for (let i = 0; i < count; i++) {
      const position = i * ratio, first = Math.floor(position), fraction = position - first;
      const value = finiteSample(data[first]) * (1 - fraction) + finiteSample(data[first + 1] ?? 0) * fraction;
      // Wrap recorded tails so the repeated loop has no arbitrary cut at its end.
      const at = (offset + i) % frames;
      left[at] += value * gainLeft;
      right[at] += value * gainRight;
    }
  };
  const [kick, snare, hat, tom] = recordings;
  [[0, 1], [2.5, .72], [4, .92], [6, .8], [7.5, .52]].forEach(([beat, level]) => mix(kick, beat, level, 0));
  [[1, .88], [3, 1], [5, .84], [7, .96]].forEach(([beat, level]) => mix(snare, beat, level, .08));
  for (let step = 0; step < 16; step++) mix(hat, step * .5, step % 2 ? .46 : .7, -.3);
  mix(tom, 6.5, .43, .3);
  return balance(buffer, frames, false);
}

/** Decode bounded local samples only; the caller owns audio/device lifecycle. */
export async function loadProcessingDemo(context, id, { signal } = {}) {
  const option = getProcessingInput(id), demo = DEMOS[id];
  if (option?.kind !== "demo" || !demo) throw new RangeError("Choose a bundled demo input.");
  if (!context?.decodeAudioData || !context?.createBuffer || !(context.sampleRate > 0)) {
    throw new TypeError("Enable Audio before loading a demo input.");
  }
  const recordings = await Promise.all(demo.paths.map(path => decodeAsset(context, path, signal)));
  checkCancelled(signal);
  const buffer = id === "sample-drums" ? arrangeDrums(context, recordings) : prepareRecording(context, recordings[0], id);
  return { buffer, label: option.label, credit: demo.credit, creditUrl: assetUrl(demo.creditPath).href };
}
