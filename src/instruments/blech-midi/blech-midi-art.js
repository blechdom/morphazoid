import { parseMidi, MAX_MIDI_MIXER_TEMPO } from '../midi-mixer/midi-mixer-model.js';

export const ART_LIMITS = Object.freeze({ notes: 32768, layers: 8, beats: 512, imageBytes: 16 * 1024 * 1024 });
const clamp = (value, lo, hi, fallback = lo) => Math.max(lo, Math.min(hi, Number.isFinite(Number(value)) ? Number(value) : fallback));
const tick = value => Math.round(value * 960) / 960;
export const ART_SCRIPTS = Object.freeze([
  ['none', 'Original', 'Keep the prepared notes unchanged.'],
  ['arp-up', 'Arpeggiate ↑', 'Spread each simultaneous chord upward, using Step beats between attacks.'],
  ['arp-down', 'Arpeggiate ↓', 'Spread each simultaneous chord downward.'],
  ['arp-pingpong', 'Arpeggiate ↕', 'Alternate low and high notes within each chord.'],
  ['ratchet', 'Ratchet / chop', 'Split each held note into Repeats evenly spaced attacks.'],
  ['mirror-pitch', 'Mirror pitch', 'Reflect pitches around the middle of the occupied range.'],
  ['mirror-time', 'Mirror time', 'Reverse note positions and durations across the prepared timeline.'],
  ['scatter', 'Seeded scatter', 'Jitter pitch, onset and velocity reproducibly. Amount sets the spread.'],
  ['strum', 'Strum', 'Delay successive notes in each chord by Step beats; retain their lengths.'],
  ['canon', 'Canon / echoes', 'Add Repeats copies spaced by Step beats; each copy moves by Interval semitones.'],
  ['quantize', 'Quantize time', 'Snap attack times to Step beats. Pitch remains chromatic.'],
  ['sine', 'Sine ribbon', 'Generate a pitch wave within the image pitch range. Step sets note spacing.'],
  ['zigzag', 'Zigzag ribbon', 'Generate a triangular pitch path across the image pitch range.'],
  ['noise', 'Seeded note cloud', 'Generate a reproducible cloud of pitches across the image pitch range.'],
].map(([id, label, description]) => Object.freeze({ id, label, description })));
export const ART_CURVES = Object.freeze(['flat', 'rise', 'fall', 'sine', 'triangle', 'arch']);

export function artworkRandom(seed = 1) {
  let value = Number(seed) >>> 0;
  return () => { value += 0x6d2b79f5; let n = value; n = Math.imul(n ^ n >>> 15, n | 1); n ^= n + Math.imul(n ^ n >>> 7, n | 61); return ((n ^ n >>> 14) >>> 0) / 4294967296; };
}
export function artCurve(kind, phase, cycles = 1) {
  const p = clamp(phase, 0, 1), wave = p * cycles;
  if (kind === 'rise') return p * 2 - 1;
  if (kind === 'fall') return 1 - p * 2;
  if (kind === 'sine') return Math.sin(wave * Math.PI * 2);
  if (kind === 'triangle') return 1 - 4 * Math.abs((wave % 1) - .5);
  if (kind === 'arch') return Math.sin(p * Math.PI) * 2 - 1;
  return 0;
}

/** Canvas supplies a small raster. Pitch is horizontal, time rises from the bottom. */
export function imageArtwork({ data, width, height }, options = {}) {
  if (!Number.isInteger(width) || width < 1 || width > 128 || !Number.isInteger(height) || height < 1 || height > 256 || data?.length !== width * height * 4) throw new Error('Use a raster up to 128 × 256 cells.');
  const low = Math.round(clamp(options.low, 0, 127)), high = Math.round(clamp(options.high, low, 127, 127));
  const beats = clamp(options.beats, .25, 128, 8), rowBeat = beats / height, threshold = clamp(options.threshold, 0, 255, 128);
  const velocity = Math.round(clamp(options.velocity, 1, 127, 96));
  const columns = new Map();
  for (let x = 0; x < width; x++) {
    const pitch = Math.round(low + (high - low) * x / Math.max(1, width - 1));
    if (!columns.has(pitch)) columns.set(pitch, Array(height).fill(0));
    const cells = columns.get(pitch);
    for (let y = 0; y < height; y++) {
      const i = ((height - 1 - y) * width + x) * 4, alpha = data[i + 3] / 255;
      const luminance = (data[i] * .2126 + data[i + 1] * .7152 + data[i + 2] * .0722) * alpha + 255 * (1 - alpha);
      const ink = options.invert ? luminance : 255 - luminance;
      if (ink >= 255 - threshold && alpha > 0) cells[y] = Math.max(cells[y], options.velocityFromImage ? Math.round(clamp(ink / 255 * velocity, 1, 127)) : velocity);
    }
  }
  const notes = [];
  for (const [note, cells] of columns) for (let row = 0; row < height;) {
    if (!cells[row]) { row++; continue; }
    const start = row, level = cells[row++];
    while (!options.retrigger && row < height && cells[row] === level) row++;
    notes.push({ note, beat: start * rowBeat, duration: (row - start) * rowBeat, velocity: level, layer: 0 });
  }
  return { notes, durationBeats: beats };
}

function validNotes(notes) {
  if (!Array.isArray(notes) || notes.length > ART_LIMITS.notes) throw new Error(`Artwork allows up to ${ART_LIMITS.notes.toLocaleString('en-US')} notes. Reduce Repeats, image resolution or layers.`);
  return notes.map(n => {
    if (![n.note, n.beat, n.duration, n.velocity].every(Number.isFinite) || n.beat < 0 || n.duration <= 0 || n.beat + n.duration > ART_LIMITS.beats) throw new Error('Keep artwork within 512 beats with positive note lengths.');
    return { ...n, note: Math.round(clamp(n.note, 0, 127)), beat: tick(n.beat), duration: Math.max(1 / 960, tick(n.duration)), velocity: Math.round(clamp(n.velocity, 1, 127)), layer: Math.round(clamp(n.layer ?? 0, 0, 7)) };
  });
}

export function transformArtwork(source, script = 'none', options = {}) {
  let notes = validNotes(source), duration = Math.max(clamp(options.beats, .25, 128, 8), ...notes.map(n => n.beat + n.duration));
  const random = artworkRandom(options.seed), step = clamp(options.step, 1 / 64, 8, .125), repeats = Math.round(clamp(options.repeats, 1, 16, 4));
  const amount = clamp(options.amount, 0, 1, .3), interval = Math.round(clamp(options.interval, -48, 48, 12));
  const low = Math.round(clamp(options.low, 0, 127)), high = Math.round(clamp(options.high, low, 127, 127));
  const cycles = clamp(options.cycles, .25, 16, 2);
  if (['sine', 'zigzag', 'noise'].includes(script)) {
    const generated = [], count = Math.ceil(duration / step);
    if (notes.length + count > ART_LIMITS.notes) throw new Error('Reduce layers or increase Step to stay within 32,768 notes.');
    const layer = notes.length ? Math.max(...notes.map(n => n.layer)) + 1 : 0;
    if (layer >= ART_LIMITS.layers) throw new Error('Remove a layer before adding a generated ribbon.');
    for (let i = 0; i < count; i++) {
      const fraction = script === 'noise' ? random() : (artCurve(script === 'sine' ? 'sine' : 'triangle', i / Math.max(1, count - 1), cycles) + 1) / 2;
      generated.push({ note: Math.round(low + fraction * (high - low)), beat: i * step, duration: Math.min(step * .8, duration - i * step), velocity: Math.round(clamp(options.velocity, 1, 127, 96)), layer });
    }
    notes = [...notes, ...generated];
  } else if (script.startsWith('arp-') || script === 'strum') {
    const groups = new Map();
    for (const n of notes) { const key = `${n.layer}:${n.beat}`; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(n); }
    notes = [];
    for (const group of groups.values()) {
      group.sort((a, b) => script === 'arp-down' ? b.note - a.note : a.note - b.note);
      const ordered = script === 'arp-pingpong' ? group.map((_, i) => group[i % 2 ? group.length - 1 - Math.floor(i / 2) : i / 2]) : group;
      ordered.forEach((n, i) => notes.push({ ...n, beat: n.beat + i * step, duration: script === 'strum' ? n.duration : Math.min(n.duration, step * .9) }));
    }
  } else if (script === 'ratchet' || script === 'canon') {
    if (notes.length * repeats > ART_LIMITS.notes) throw new Error('Reduce Repeats or layers to stay within 32,768 notes.');
    notes = notes.flatMap(n => Array.from({ length: repeats }, (_, i) => script === 'ratchet'
      ? { ...n, beat: n.beat + n.duration * i / repeats, duration: n.duration / repeats * .85 }
      : { ...n, beat: n.beat + i * step, note: n.note + i * interval, velocity: Math.max(1, n.velocity - i * 5) }));
  } else if (script === 'mirror-pitch' && notes.length) {
    const sum = Math.min(...notes.map(n => n.note)) + Math.max(...notes.map(n => n.note)); notes = notes.map(n => ({ ...n, note: sum - n.note }));
  } else if (script === 'mirror-time') notes = notes.map(n => ({ ...n, beat: Math.max(0, duration - n.beat - n.duration) }));
  else if (script === 'scatter') notes = notes.map(n => ({ ...n, note: n.note + Math.round((random() * 2 - 1) * amount * 48), beat: Math.max(0, n.beat + (random() * 2 - 1) * step * amount), velocity: n.velocity + Math.round((random() * 2 - 1) * amount * 48) }));
  else if (script === 'quantize') notes = notes.map(n => ({ ...n, beat: Math.round(n.beat / step) * step }));
  duration = Math.max(duration, ...notes.map(n => n.beat + n.duration));
  notes = notes.map(n => {
    const phase = n.beat / duration;
    return { ...n, note: n.note + artCurve(options.pitchCurve, phase, cycles) * clamp(options.pitchDepth, -64, 64),
      velocity: n.velocity * (1 + artCurve(options.velocityCurve, phase, cycles) * clamp(options.velocityDepth, 0, 1)),
      duration: n.duration * Math.max(.05, 1 + artCurve(options.gateCurve, phase, cycles) * clamp(options.gateDepth, 0, 1)) };
  });
  return { notes: validNotes(notes), durationBeats: Math.max(duration, ...notes.map(n => n.beat + n.duration)) };
}

const vlq = value => { const bytes = [value & 127]; while ((value >>>= 7)) bytes.unshift((value & 127) | 128); return bytes; };
const u32 = value => [value >>> 24, value >>> 16 & 255, value >>> 8 & 255, value & 255];
/** SMF1: distinct tracks/channels preserve overlapping original and generated voices. */
export function encodeArtwork(input, { title = 'MIDI artwork', tempo = 120, durationBeats = 0 } = {}) {
  const notes = validNotes(input);
  if (!notes.length) throw new Error('Add an image, drawing or generated ribbon first.');
  const end = Math.max(clamp(durationBeats, 0, ART_LIMITS.beats), ...notes.map(n => n.beat + n.duration));
  const micros = Math.round(60000000 / clamp(tempo, 30, MAX_MIDI_MIXER_TEMPO, 120)), chunks = [];
  const layers = [...new Set(notes.map(n => n.layer))].sort((a, b) => a - b);
  for (const [index, layer] of layers.entries()) {
    const name = [...new TextEncoder().encode(`${String(title).slice(0, 100)} · ${layer + 1}`)], channel = index;
    const events = [{ at: 0, order: 0, data: [255, 3, ...vlq(name.length), ...name] }, { at: 0, order: 0, data: [0xc0 | channel, 0] }];
    if (index === 0) events.push({ at: 0, order: 0, data: [255, 0x51, 3, micros >>> 16 & 255, micros >>> 8 & 255, micros & 255] });
    for (const n of notes.filter(n => n.layer === layer)) {
      events.push({ at: Math.round(n.beat * 960), order: 2, data: [0x90 | channel, n.note, n.velocity] });
      events.push({ at: Math.round((n.beat + n.duration) * 960), order: 1, data: [0x80 | channel, n.note, 0] });
    }
    events.push({ at: Math.round(end * 960), order: 3, data: [255, 0x2f, 0] });
    events.sort((a, b) => a.at - b.at || a.order - b.order);
    const bytes = []; let previous = 0;
    for (const event of events) { bytes.push(...vlq(event.at - previous), ...event.data); previous = event.at; }
    chunks.push(new Uint8Array([77, 84, 114, 107, ...u32(bytes.length), ...bytes]));
  }
  const bytes = new Uint8Array(14 + chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  bytes.set([77, 84, 104, 100, 0, 0, 0, 6, 0, 1, 0, chunks.length, 3, 192]);
  let at = 14; for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
  const buffer = bytes.buffer, analysis = parseMidi(buffer);
  return { buffer, analysis, durationBeats: analysis.durationBeats, duration: analysis.durationSeconds, text: title, notes };
}

export function artworkStatistics(notes) {
  const events = notes.flatMap(n => [{ beat: n.beat, delta: 1 }, { beat: n.beat + n.duration, delta: -1 }]).sort((a, b) => a.beat - b.beat || a.delta - b.delta);
  let held = 0, peak = 0; for (const event of events) { held += event.delta; peak = Math.max(peak, held); }
  return { notes: notes.length, peakPolyphony: peak };
}
