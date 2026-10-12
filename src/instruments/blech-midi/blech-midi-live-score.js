import { compileSampleTempoMap, sampleSecondsAt } from '../midi-mixer/midi-mixer-clock.js';
import { transformMidiNote } from '../midi-mixer/midi-mixer-parameters.js';
import { midiNoteEffectChildren, sanitizeMidiNoteEffects } from '../../midi-note-effects.js';
import { createBlechNoteHistory } from './blech-midi-note-history.js';
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
  let evolution = null, automataEpoch = 0, lastAutomataBeat = 0, wasAutomataPlaying = false, sawAutomata = false, automataHistoryFloor = 0, effectRevision = 0, effectKey = '';
  const history = createBlechNoteHistory(), effectFamilies = new Map();
  let effectTimeline = [];
  return function project(state, { lookAhead = 6, pastSeconds = 0, now = state?.sampleTime ?? 0, limit = BLECH_LIVE_NOTE_LIMIT } = {}) {
    if (!state) { history.clear(); effectFamilies.clear(); effectTimeline = []; evolution = null; wasAutomataPlaying = false; sawAutomata = false; }
    pastSeconds = bound(pastSeconds, 0, 30, 0);
    lookAhead = bound(lookAhead, .25, 60, 6);
    limit = Math.floor(bound(limit, 0, BLECH_LIVE_NOTE_LIMIT, BLECH_LIVE_NOTE_LIMIT));
    const notes = [], past = [], sources = [], tempo = bound(state?.tempo, 30, 300, 120);
    const effects = sanitizeMidiNoteEffects({ ...state?.noteEffects, tempo });
    const nextEffectKey = JSON.stringify(effects);
    if (nextEffectKey !== effectKey || !effectTimeline.length) {
      effectKey = nextEffectKey; effectRevision++;
      effectTimeline.push({ at: effectTimeline.length ? now : -Infinity, effects, revision: effectRevision });
      if (effectTimeline.length > 64) effectTimeline.shift();
    }
    for (const [id, family] of effectFamilies) if (family.expires < now - pastSeconds) effectFamilies.delete(id);
    const tail = effects.enabled ? (effects.delayBeats + effects.echoCount * effects.echoBeats) * 60 / tempo : 0;
    let truncated = false, scanned = 0, held = 0;
    const activeSamples = (state?.samples ?? []).slice(0, 4).filter(sample => sample.analysis?.notes?.length && !sample.pending);
    // Completion evidence comes from the source clock. Absence alone may mean
    // an explicit stop, and must never turn an unplayed forecast into history.
    const finishedSamples = (state?.finishedSamples ?? []).slice(-8).filter(sample => sample.analysis?.notes?.length && Number.isFinite(sample.finishedAt) && now - sample.finishedAt <= pastSeconds)
      .map(sample => ({ ...sample, completed: true }));
    const sourceList = [...activeSamples, ...finishedSamples];
    const automata = state?.automata;
    const hasAutomata = automata?.playing && automata.generation >= 0 && automata.row?.length;
    if (hasAutomata && (!wasAutomataPlaying || automata.beat < lastAutomataBeat)) {
      automataEpoch++;
      automataHistoryFloor = sawAutomata && automata.beat >= lastAutomataBeat ? automata.beat : 0;
    }
    if (automata) { lastAutomataBeat = automata.beat; sawAutomata = true; }
    wasAutomataPlaying = Boolean(hasAutomata);
    const pastIds = new Set(), pastSourceCounts = new Map();
    const historyPerSource = Math.max(1, Math.floor(BLECH_LIVE_NOTE_LIMIT / Math.max(1, sourceList.length + Number(Boolean(hasAutomata)))));
    const perSource = Math.max(1, Math.floor(limit / Math.max(1, activeSamples.length + Number(Boolean(hasAutomata)))));
    function emit(note, source, sourceLimit, drums = false, historyOnly = false) {
      if (!(note.gain > .0001) || !Number.isInteger(note.pitch) || note.pitch < 0 || note.pitch > 127 || !(note.end > note.start)) return;
      // The audio effects layer snapshots a note family at its attack. Editing
      // chords/transpose/echo does not retrigger already held notes; preserve the
      // same family in both forecast and history until this gate has finished.
      let family = effectFamilies.get(note.id);
      if (!family) {
        const epoch = effectTimeline.findLast(item => item.at <= now + note.start) ?? effectTimeline[0];
        family = { ...epoch, expires: now + note.end + tail };
        if (note.start <= 0) { effectFamilies.set(note.id, family); while (effectFamilies.size > BLECH_LIVE_NOTE_LIMIT) effectFamilies.delete(effectFamilies.keys().next().value); }
      }
      let childIndex = 0;
      for (const child of midiNoteEffectChildren(family.effects, note.pitch, note.velocity, { drums })) {
        const id = `${note.id}:${family.revision}:${childIndex++}`;
        const start = note.start + child.delaySeconds, end = start + Math.min(note.end - note.start, child.gateSeconds);
        if (end <= -pastSeconds || start > lookAhead) continue;
        const value = { ...note, id, pitch: child.note, velocity: child.velocity, start, end, source };
        if ((source !== 'automata' || historyOnly) && start < 0 && !pastIds.has(id) && (pastSourceCounts.get(source) ?? 0) < historyPerSource) {
          past.push(value); pastIds.add(id); pastSourceCounts.set(source, (pastSourceCounts.get(source) ?? 0) + 1);
        }
        if (historyOnly || end <= 0) continue;
        if (notes.length >= sourceLimit || notes.length >= limit) { truncated = true; return; }
        notes.push(value); if (start <= 0 && end > 0) held++;
      }
    }
    for (const sample of sourceList) {
      const source = `sample:${sample.id}`, sourceLimit = Math.min(limit, notes.length + perSource), analysis = sample.analysis;
      let indexed = samples.get(analysis);
      if (!indexed) { indexed = indexSample(analysis); samples.set(analysis, indexed); }
      const sync = sample.sync !== false, scale = sync ? 60 / (sample.completed ? bound(sample.tempo, 30, 300, tempo) : tempo) : 1;
      const timeOffset = sample.completed ? sample.finishedAt - now : 0;
      const position = sync ? sample.positionBeats : sampleSecondsAt(indexed.tempo, sample.positionBeats);
      const length = sync ? analysis.durationBeats : indexed.durationSeconds;
      if (!(length > 0) || !Number.isFinite(position)) continue;
      const firstCycle = sample.loop ? Math.max(-Number(sample.cycle || 0), Math.floor((position - tail / scale) / length)) : 0;
      const finalCycle = sample.loop ? Math.max(0, Math.floor((position + lookAhead / scale) / length)) : 0;
      const lastCycle = Math.min(finalCycle, firstCycle + BLECH_LIVE_CYCLE_LIMIT - 1);
      if (lastCycle < finalCycle) truncated = true;
      if (!sample.completed) sources.push(source);
      for (let cycle = firstCycle; !sample.completed && cycle <= lastCycle && notes.length < sourceLimit; cycle++) {
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
          emit({ id: `${source}:${Number(sample.cycle || 0) + cycle}:${index}:${sample.revision ?? 0}`, revision: sample.revision ?? 0, pitch: note.note, velocity: note.velocity, channel: note.channel % 16,
            track: 65536 + sample.slot * 4096 + note.track, gain: sample.gain * (midi.gain ?? 1),
            start: (at(index) + offset) * scale, end: (end + offset) * scale }, source, sourceLimit, note.channel % 16 === 9);
          if (notes.length >= sourceLimit) { truncated = true; break; }
        }
        if (visited >= perSource * 4) truncated = true;
      }
      // History has its own bounded interval query. A dense forecast must not
      // consume every visit before we get to the gates that actually passed.
      if (pastSeconds > 0) {
        const begin = sample.loop ? Math.max(-Number(sample.cycle || 0), Math.floor((position - (pastSeconds + timeOffset + tail) / scale) / length)) : 0;
        const finish = sample.loop ? Math.floor(position / length) : 0;
        let visited = 0;
        for (let cycle = finish; cycle >= Math.max(begin, finish - BLECH_LIVE_CYCLE_LIMIT + 1) && visited < perSource * 4; cycle--) {
          const offset = cycle * length - position, from = Math.max(0, -offset - (pastSeconds + timeOffset + tail) / scale);
          const to = Math.min(length, -offset), at = index => sync ? indexed.notes[index].beat : indexed.seconds[index];
          let low = 0, high = indexed.notes.length;
          while (low < high) { const middle = (low + high) >>> 1; if (at(middle) <= to) low = middle + 1; else high = middle; }
          for (let index = low - 1; index >= 0 && visited < perSource * 4; index--, visited++) {
            const prefixEnd = sync ? indexed.ends[index] : sampleSecondsAt(indexed.tempo, indexed.ends[index]);
            if (prefixEnd <= from) break;
            scanned++;
            const original = indexed.notes[index], end = sync ? Math.min(length, original.beat + original.duration) : indexed.secondEnds[index];
            if (end <= from) continue;
            const note = transformMidiNote(original, sample.midi), midi = sample.midi ?? {};
            if (!note.velocity || midi.controllers?.[7] === 0 || midi.controllers?.[11] === 0) continue;
            emit({ id: `${source}:${Number(sample.cycle || 0) + cycle}:${index}:${sample.revision ?? 0}`,
              revision: sample.revision ?? 0, pitch: note.note, velocity: note.velocity, channel: note.channel % 16,
              track: 65536 + sample.slot * 4096 + note.track, gain: sample.gain * (midi.gain ?? 1),
              start: (at(index) + offset) * scale + timeOffset, end: (end + offset) * scale + timeOffset }, source, limit, note.channel % 16 === 9, true);
          }
        }
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
        emit({ ...note, id: `automata:${automataEpoch}:${note.start}:${note.pitch}`, start: (Math.max(note.start, automataHistoryFloor) - automata.beat) * 60 / tempo, end: (note.end - automata.beat) * 60 / tempo }, source, sourceLimit);
        if (notes.length >= sourceLimit) { truncated = true; break; }
      }
    }
    // Actual evolved rows, not forecast descendants, supply the past. A pause
    // stops adding gates; retained history can still leave through the bottom.
    if (hasAutomata && pastSeconds > 0) {
      const tempoMap = { tempoMap: compileSampleTempoMap(automata.tempos ?? [{ beat: 0, bpm: tempo }]) };
      const present = sampleSecondsAt(tempoMap, automata.beat);
      let visited = 0;
      for (let rowIndex = (automata.history?.length ?? 0) - 1; rowIndex >= 0 && visited < BLECH_LIVE_NOTE_LIMIT; rowIndex--) {
        const row = automata.history[rowIndex];
        if (row.endBeat <= automataHistoryFloor) continue;
        const start = sampleSecondsAt(tempoMap, Math.max(row.startBeat, automataHistoryFloor)) - present;
        const end = sampleSecondsAt(tempoMap, row.endBeat) - present + (row.endBeat >= automata.beat ? 1e-6 : 0);
        if (end <= -pastSeconds) break;
        for (let column = 0; column < row.row.length && visited < BLECH_LIVE_NOTE_LIMIT; column++) if (row.row[column]) {
          visited++;
          emit({ id: `row:${automataEpoch}:${row.generation}:${column}`, revision: automataEpoch, pitch: row.lowestNote + column, velocity: row.velocity,
            channel: 0, track: 196608, gain: row.gain, start, end }, 'automata', limit, false, true);
        }
      }
    }
    // Past notes are independent of currently active source IDs. Stopping a
    // pad removes its forecast immediately while its completed gates remain.
    const pastNotes = history.update(past, now, { seconds: pastSeconds, limit: BLECH_LIVE_NOTE_LIMIT });
    // Forecast state is released as soon as its source stops.
    if (!hasAutomata) evolution = null;
    return { notes, pastNotes, sources, held, scanned, truncated };
  };
}
