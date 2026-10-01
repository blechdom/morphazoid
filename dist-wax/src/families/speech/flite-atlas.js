import { sustainPoints } from './vowel-loop.js';
import { synthesizeFlite } from './flite-runtime.js';
import { FLITE_PHONES } from './flite-phones.js';

/** Render all clips in one WASI invocation; metadata is SPELLING_DIPHONE_CLIPS. */
export function renderFliteAtlas(module, { voice = 'slt', metadata, rate = .8 } = {}) {
  if (!['slt', 'awb', 'rms'].includes(voice)) throw new Error('Use a Flite Clustergen voice for this atlas.');
  if (!metadata) throw new Error('Flite atlas requires clip metadata.');
  const sequence = ['pau'];
  const groups = [];
  for (const [key, phone] of Object.entries(FLITE_PHONES)) {
    const meta = metadata[key];
    if (!meta?.kind) throw new Error(`Missing ${key} metadata.`);
    // Three voiced units provide a stable vowel body without a recorded loop.
    const units = meta.kind === 'vowel' ? [phone, phone, phone] : phone.split(' ');
    groups.push({ key, startEvent: sequence.length, count: units.length });
    sequence.push(...units, 'pau');
  }
  const rendered = synthesizeFlite(module, { phones: sequence, voice, rate, pitchRange: 0 });
  const sampleRate = rendered.sampleRate;
  if (rendered.events.length !== sequence.length) throw new Error('Flite phoneme timings did not match the atlas.');
  for (let n = 0; n < sequence.length; n++) {
    if (rendered.events[n].phone !== sequence[n]) throw new Error(`Unexpected Flite phoneme at ${n}.`);
  }
  const clips = {}, pieces = [];
  const gap = Math.round(sampleRate * .012);
  let total = gap;
  for (const { key, startEvent, count } of groups) {
    const start = Math.round(rendered.events[startEvent].start * sampleRate);
    // CG acoustic frames are 5 ms; keep the final frame after rounded timing.
    const end = Math.min(rendered.samples.length, Math.round((rendered.events[startEvent + count - 1].end + .005) * sampleRate));
    const raw = rendered.samples.subarray(start, end);
    const first = raw.findIndex(value => Math.abs(value) > .001);
    let last = raw.length - 1;
    while (last > first && Math.abs(raw[last]) <= .001) last--;
    if (first < 0 || last <= first) throw new Error(`Flite ${voice} could not render ${key}.`);
    const pad = Math.round(sampleRate * .008);
    const samples = raw.slice(Math.max(0, first - pad), Math.min(raw.length, last + pad + 1));
    const fade = Math.min(Math.round(sampleRate * .003), Math.floor(samples.length / 4));
    for (let n = 0; n < fade; n++) {
      samples[n] *= n / fade;
      samples[samples.length - 1 - n] *= n / fade;
    }
    const kind = metadata[key].kind;
    clips[key] = { offset: total / sampleRate, duration: samples.length / sampleRate,
      kind, phone: metadata[key].phone, gain: kind === 'consonant' || kind === 'cluster' ? 1.8 : 1,
      ...(kind === 'vowel' ? sustainPoints(samples, sampleRate) : { sustainStart: 0, sustainEnd: 0 }) };
    if (kind === 'vowel' && clips[key].sustainEnd <= clips[key].sustainStart) throw new Error(`Flite ${voice} has no stable ${key} vowel loop.`);
    pieces.push({ samples, offset: total });
    total += samples.length + gap;
  }
  const samples = new Float32Array(total);
  for (const piece of pieces) samples.set(piece.samples, piece.offset);
  return { samples, sampleRate, clips };
}
