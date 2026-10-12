import { compileSampleTempoMap, sampleSecondsAt } from '../midi-mixer/midi-mixer-clock.js';
import { transformMidiNote } from '../midi-mixer/midi-mixer-parameters.js';
import { midiNoteEffectChildren, sanitizeMidiNoteEffects } from '../../midi-note-effects.js';
import { automatapoeiaNextRow, automatapoeiaTransformRow } from '../cellular-automata/automatapoeia.js';

export const BLECH_LIVE_NOTE_LIMIT = 12288;
export const BLECH_LIVE_CYCLE_LIMIT = 256;
export const BLECH_AUTOMATA_ROW_LIMIT = 256;
const bound = (value, low, high, fallback) => Math.max(low, Math.min(high, Number.isFinite(Number(value)) ? Number(value) : fallback));

function indexSample(analysis) {
  const tempo = { tempoMap: compileSampleTempoMap(analysis.tempoMap) };
  const notes = analysis.notes, ends = new Float64Array(notes.length), seconds = new Float64Array(notes.length), secondEnds = new Float64Array(notes.length);
  let maxEnd = 0;
  for (let index = 0; index < notes.length; index++) {
    const note = notes[index];
    maxEnd = Math.max(maxEnd, note.beat + note.duration); ends[index] = maxEnd;
    seconds[index] = sampleSecondsAt(tempo, note.beat);
    secondEnds[index] = sampleSecondsAt(tempo, Math.min(analysis.durationBeats, note.beat + note.duration));
  }
  return { notes, ends, seconds, secondEnds, tempo, durationSeconds: sampleSecondsAt(tempo, analysis.durationBeats) };
}

/** Deterministic source forecast, using the same row functions as the audio
 * clock. Current row controls stay in force until the next row boundary.
 * Forecasts never mutate the evolution, trigger sound, or consume random state.
 */
function forecastAutomata(state, seconds, tempo) {
  let row = [...state.row], start = state.rowStart, length = state.rowLength, settings = state.rowSettings;
  const end = start + length + seconds * tempo / 60, notes = [], held = new Map();
  let rows = 0;
  while (start < end && rows < BLECH_AUTOMATA_ROW_LIMIT) {
    const wanted = new Set(row.flatMap((cell, column) => cell ? [settings.lowestNote + column] : []));
    for (const [pitch, note] of held) if (settings.articulation !== 'hold' || !wanted.has(pitch)) {
      note.end = start; held.delete(pitch);
    }
    for (const pitch of wanted) if (!held.has(pitch)) {
      const note = { pitch, velocity: settings.velocity, channel: 0, track: 196608, gain: settings.gain, start, end: start + length };
      held.set(pitch, note); notes.push(note);
    }
    for (const note of held.values()) note.end = start + length;
    start += length; rows++;
    settings = state.settings;
    const offset = Math.floor((row.length - settings.columns) / 2);
    row = Array.from({ length: settings.columns }, (_, column) => row[column + offset] ?? 0);
    row = automatapoeiaTransformRow(automatapoeiaNextRow(row, settings.rule, settings.boundary, settings.family), settings.transform, settings.boundary);
    length = settings.rowBeats;
  }
  return { notes, truncated: start < end, rows };
}

/** A read-only projection of engine.state into seconds relative to *now*.
 * Sample position comes from its own audio clock, independent of file playback.
 * Source scores are indexed once; queries, loop repetitions, expansion and
 * automata rows have explicit caps. No timer or browser/audio API is used here.
 */
export function createBlechLiveProjector() {
  const samples = new WeakMap();
  let evolution = null;
  return function project(state, { lookAhead = 6, limit = BLECH_LIVE_NOTE_LIMIT } = {}) {
    lookAhead = bound(lookAhead, .25, 60, 6);
    limit = Math.floor(bound(limit, 0, BLECH_LIVE_NOTE_LIMIT, BLECH_LIVE_NOTE_LIMIT));
    const notes = [], sources = [], tempo = bound(state?.tempo, 30, 300, 120);
    const effects = sanitizeMidiNoteEffects({ ...state?.noteEffects, tempo });
    const tail = effects.enabled ? (effects.delayBeats + effects.echoCount * effects.echoBeats) * 60 / tempo : 0;
    let truncated = false, scanned = 0, held = 0;
    const sourceList = (state?.samples ?? []).slice(0, 4).filter(sample => sample.analysis?.notes?.length && !sample.pending);
    const automata = state?.automata;
    const hasAutomata = automata?.playing && automata.generation >= 0 && automata.row?.length;
    const perSource = Math.max(1, Math.floor(limit / Math.max(1, sourceList.length + Number(Boolean(hasAutomata)))));
    function emit(note, source, sourceLimit, drums = false) {
      if (!(note.gain > .0001) || !Number.isInteger(note.pitch) || note.pitch < 0 || note.pitch > 127 || !(note.end > note.start)) return;
      for (const child of midiNoteEffectChildren(effects, note.pitch, note.velocity, { drums })) {
        const start = note.start + child.delaySeconds, end = start + Math.min(note.end - note.start, child.gateSeconds);
        if (end <= 0 || start > lookAhead) continue;
        if (notes.length >= sourceLimit || notes.length >= limit) { truncated = true; return; }
        const value = { ...note, pitch: child.note, velocity: child.velocity, start, end, source };
        notes.push(value); if (start <= 0 && end > 0) held++;
      }
    }
    for (const sample of sourceList) {
      const source = `sample:${sample.id}`, sourceLimit = Math.min(limit, notes.length + perSource), analysis = sample.analysis;
      let indexed = samples.get(analysis);
      if (!indexed) { indexed = indexSample(analysis); samples.set(analysis, indexed); }
      const sync = sample.sync !== false, scale = sync ? 60 / tempo : 1;
      const position = sync ? sample.positionBeats : sampleSecondsAt(indexed.tempo, sample.positionBeats);
      const length = sync ? analysis.durationBeats : indexed.durationSeconds;
      if (!(length > 0) || !Number.isFinite(position)) continue;
      const firstCycle = sample.loop ? Math.max(-Number(sample.cycle || 0), Math.floor((position - tail / scale) / length)) : 0;
      const finalCycle = sample.loop ? Math.max(0, Math.floor((position + lookAhead / scale) / length)) : 0;
      const lastCycle = Math.min(finalCycle, firstCycle + BLECH_LIVE_CYCLE_LIMIT - 1);
      if (lastCycle < finalCycle) truncated = true;
      sources.push(source);
      for (let cycle = firstCycle; cycle <= lastCycle && notes.length < sourceLimit; cycle++) {
        const offset = cycle * length - position, from = Math.max(0, -offset - tail / scale), to = Math.min(length, lookAhead / scale - offset);
        if (to < from) continue;
        let low = 0, high = indexed.notes.length;
        const at = index => sync ? indexed.notes[index].beat : indexed.seconds[index];
        while (low < high) { const middle = (low + high) >>> 1; if (at(middle) <= to) low = middle + 1; else high = middle; }
        // Prefix ends skip finished source material. Visiting at most four
        // times the source budget also bounds pathological held-note overlaps.
        let visited = 0;
        for (let index = low - 1; index >= 0 && visited < perSource * 4; index--, visited++) {
          const prefixEnd = sync ? indexed.ends[index] : sampleSecondsAt(indexed.tempo, indexed.ends[index]);
          if (prefixEnd <= from) break;
          scanned++;
          const original = indexed.notes[index], end = sync ? Math.min(length, original.beat + original.duration) : indexed.secondEnds[index];
          if (end <= from) continue;
          const note = transformMidiNote(original, sample.midi), midi = sample.midi ?? {};
          if (!note.velocity || midi.controllers?.[7] === 0 || midi.controllers?.[11] === 0) continue;
          emit({ pitch: note.note, velocity: note.velocity, channel: note.channel % 16,
            track: 65536 + sample.slot * 4096 + note.track, gain: sample.gain * (midi.gain ?? 1),
            start: (at(index) + offset) * scale, end: (end + offset) * scale }, source, sourceLimit, note.channel % 16 === 9);
          if (notes.length >= sourceLimit) { truncated = true; break; }
        }
        if (visited >= perSource * 4) truncated = true;
      }
    }
    if (hasAutomata && notes.length < limit) {
      const source = 'automata', sourceLimit = Math.min(limit, notes.length + perSource);
      const key = JSON.stringify([automata.generation, automata.rowStart, automata.rowLength, automata.row, automata.rowSettings, automata.settings, lookAhead, tempo]);
      if (evolution?.key !== key) evolution = { key, ...forecastAutomata(automata, lookAhead, tempo) };
      truncated ||= evolution.truncated;
      sources.push(source);
      for (const note of evolution.notes) {
        scanned++;
        emit({ ...note, start: (note.start - automata.beat) * 60 / tempo, end: (note.end - automata.beat) * 60 / tempo }, source, sourceLimit);
        if (notes.length >= sourceLimit) { truncated = true; break; }
      }
    }
    // Nothing retains a stopped source or a previous AudioContext's clock.
    if (!hasAutomata) evolution = null;
    return { notes, sources, held, scanned, truncated };
  };
}
