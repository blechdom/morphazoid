import { MAX_MIDI_MIXER_TEMPO } from '../midi-mixer/midi-mixer-model.js';
import { compileSampleTempoMap, sampleSecondsAt } from '../midi-mixer/midi-mixer-clock.js';
import { transformMidiNote } from '../midi-mixer/midi-mixer-parameters.js';
import { midiNoteEffectChildren, sanitizeMidiNoteEffects } from '../../midi-note-effects.js';
import { createBlechNoteHistory } from './blech-midi-note-history.js';
import { automatapoeiaNextRow, automatapoeiaTransformRow } from '../cellular-automata/automatapoeia.js';

export const BLECH_LIVE_NOTE_LIMIT = 12288;
export const BLECH_LIVE_CYCLE_LIMIT = 256;
export const BLECH_AUTOMATA_ROW_LIMIT = 256;
const bound = (value, low, high, fallback) => Math.max(low, Math.min(high, Number.isFinite(Number(value)) ? Number(value) : fallback));
const railTrack = source => 262144 + (source === 'rail' ? 0 : source === 'comb' ? 1 : 2);

/** The square is already down at the rail: its key outline need not wait for
 * a MIDI sample or an animation tick to travel through the future plane. */
export function blechRailHeldOutlines(state) {
  return (state?.rails ?? []).filter(rail => rail.source === 'rail' && rail.held && !rail.paused
    && (state.sampleBeat ?? 0) >= rail.startBeat + rail.delayBeats).flatMap(rail => rail.notes.map(note => ({
    pitch: note.note, velocity: note.velocity, channel: rail.channel, track: railTrack(rail.source),
    source: rail.id, fromRail: true, start: 0, end: 0,
  }))).slice(0, 192);
}

/** The audio clock parks a latched key just before its finite MIDI key-off.
 * Remember its real elapsed time instead of mistaking that parked score phase
 * for a released note. A pause, mute, replacement or removal ends the outline;
 * a rejoined key starts a new visible segment without another MIDI attack.
 */
export function createBlechHeldOutlineProjector() {
  const starts = new Map();
  let previousTime = -Infinity;
  return function heldOutlines(state, now = state?.sampleTime ?? 0) {
    if (!state || !Number.isFinite(now) || now < previousTime - .001) starts.clear();
    previousTime = Number.isFinite(now) ? now : -Infinity;
    const active = new Set(), outlines = [];
    for (const sample of state?.samples ?? []) {
      const note = sample.analysis?.notes?.[0];
      if (!sample.hold || sample.analysis?.notes?.length !== 1 || sample.pending || sample.paused || sample.effectiveMuted
        || !note || !(sample.positionBeats >= note.beat) || !Number.isInteger(note.note) || note.note < 0 || note.note > 127) continue;
      const voiced = transformMidiNote(note, sample.midi);
      if (!voiced.velocity || !(sample.gain > .0001) || sample.midi?.controllers?.[7] === 0 || sample.midi?.controllers?.[11] === 0) continue;
      const id = `${sample.id}:${sample.scoreVersion ?? 0}:${sample.playbackEpoch ?? 0}`;
      active.add(id);
      if (!starts.has(id)) {
        const elapsed = (sample.playbackEpoch ?? 0) > 0 ? 0
          : Math.max(0, sample.positionBeats - note.beat) * 60 / bound(state.tempo, 30, 4800, 120);
        starts.set(id, now - Math.min(30, elapsed));
      }
      const elapsed = Math.min(30, Math.max(0, now - starts.get(id)));
      outlines.push({ pitch: voiced.note, velocity: voiced.velocity, channel: voiced.channel % 16, track: 65536 + sample.slot * 4096 + note.track,
        source: `sample:${sample.id}`, start: elapsed ? -elapsed : 0, end: 0 });
      if (outlines.length === 4) break;
    }
    for (const id of starts.keys()) if (!active.has(id)) starts.delete(id);
    return outlines;
  };
}

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
  // One immutable analysis may be visited thousands of times per second as
  // notes fall and pass into history. Cache only the visited, MIDI-transformed
  // notes; a different score or live MIDI edit must get its own projection.
  return { notes, ends, seconds, secondEnds, tempo, durationSeconds: sampleSecondsAt(tempo, analysis.durationBeats), projectedByMidi: new Map() };
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
  const samples = new WeakMap(), samplePlayback = new Map();
  const heldOutlines = createBlechHeldOutlineProjector();
  let evolution = null, automataEpoch = 0, lastAutomataBeat = 0, wasAutomataPlaying = false, sawAutomata = false, automataHistoryFloor = 0, effectRevision = 0, effectKey = '';
  const history = createBlechNoteHistory(), effectFamilies = new Map();
  let effectTimeline = [], automataFamilies = new Map(), automataFamilyKey = null;
  return function project(state, { lookAhead = 6, pastSeconds = 0, now = state?.sampleTime ?? 0, limit = BLECH_LIVE_NOTE_LIMIT } = {}) {
    if (!state) { samplePlayback.clear(); history.clear(); effectFamilies.clear(); effectTimeline = []; automataFamilies.clear(); automataFamilyKey = null; evolution = null; wasAutomataPlaying = false; sawAutomata = false; }
    pastSeconds = bound(pastSeconds, 0, 30, 0);
    lookAhead = bound(lookAhead, .25, 60, 6);
    limit = Math.floor(bound(limit, 0, BLECH_LIVE_NOTE_LIMIT, BLECH_LIVE_NOTE_LIMIT));
    const notes = [], past = [], sources = [], tempo = bound(state?.tempo, 30, MAX_MIDI_MIXER_TEMPO, 120);
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
    const availableSamples = (state?.samples ?? []).slice(0, 4).filter(sample => sample.analysis?.notes?.length);
    const activeSamples = availableSamples.filter(sample => !sample.pending && !sample.paused);
    // A positioned drop has not reached the keyboard yet. Forecast it at the
    // remaining launch delay without advancing its source phase or inventing
    // performed history. The same IDs continue when the audio clock starts it.
    const pendingForecasts = availableSamples.filter(sample => sample.pending && !sample.paused && Number.isFinite(sample.pendingBeats) && sample.pendingBeats > 0)
      .map(sample => ({ ...sample, forecastOnly: true, forecastOffset: sample.pendingBeats * 60 / tempo }));
    const playbackKey = sample => `${sample.id}:${sample.scoreVersion ?? 0}`;
    const replacementForecasts = activeSamples.filter(sample => sample.pendingReplacement).map(sample => {
      const remaining = sample.sync !== false ? (sample.analysis.durationBeats - sample.positionBeats) * 60 / tempo
        : (() => { const data = { tempoMap: compileSampleTempoMap(sample.analysis.tempoMap) }; return sampleSecondsAt(data, sample.analysis.durationBeats) - sampleSecondsAt(data, sample.positionBeats); })();
      return { ...sample, ...sample.pendingReplacement, scoreVersion: sample.pendingReplacement.token, scoreRevision: sample.pendingReplacement.token,
        pendingReplacement: null, playbackEpoch: (sample.playbackEpoch ?? 0) + 1, resumedPositionBeats: 0, resumedCycle: (sample.cycle ?? 0) + 1,
        cycle: (sample.cycle ?? 0) + 1, positionBeats: 0, forecastOnly: true, forecastOffset: remaining + Math.max(0, sample.pendingReplacement.delayBeats ?? 0) * 60 / tempo };
    });
    // Completion evidence comes from the source clock. Absence alone may mean
    // an explicit stop, and must never turn an unplayed forecast into history.
    const finishedSamples = (state?.finishedSamples ?? []).slice(-8).filter(sample => sample.analysis?.notes?.length && Number.isFinite(sample.finishedAt) && now - sample.finishedAt <= pastSeconds)
      .map(sample => ({ ...sample, completed: true }));
    // Retain only the four current sources and eight bounded completions. Pause
    // ends performed gates without forgetting their tails. A resumed source
    // chases its held notes, so it needs a new segment at the frozen position;
    // neither earlier attacks nor canceled effect echoes should replay.
    const observedSamples = [...availableSamples, ...replacementForecasts, ...finishedSamples], observedIds = new Set(), sourceReleases = new Map();
    for (const sample of observedSamples) {
      observedIds.add(playbackKey(sample));
      let playback = samplePlayback.get(playbackKey(sample));
      const epoch = Number.isInteger(sample.playbackEpoch) ? sample.playbackEpoch : null;
      if (!playback) {
        playback = { epoch: epoch ?? 0, paused: Boolean(sample.paused), floorPosition: 0, floorCycle: 0 };
        samplePlayback.set(playbackKey(sample), playback);
      } else if (epoch !== null && epoch !== playback.epoch || playback.paused && !sample.paused) {
        playback.epoch = epoch ?? playback.epoch + 1;
        playback.floorPosition = sample.positionBeats;
        playback.floorCycle = Number(sample.cycle || 0);
      }
      // Audio-clock metadata also covers pause/resume between display frames.
      // Older snapshots fall back to the first observed resumed position.
      if (epoch > 0) {
        playback.floorPosition = sample.resumedPositionBeats;
        playback.floorCycle = sample.resumedCycle;
      }
      // A pause bumps the engine revision to reject stale worklet messages;
      // it does not create a new performance. Keep the last played voice data
      // while paused so its fixed history cannot be duplicated or recolored.
      if (!sample.paused || !playback.voice) playback.voice = { midi: sample.midi, gain: sample.gain, revision: sample.revision, scoreRevision: sample.scoreRevision, sync: sample.sync, tempo: sample.tempo ?? tempo };
      playback.paused = Boolean(sample.paused);
      if (!sample.completed && !sample.forecastOnly) {
        const releases = [];
        if (Number.isFinite(sample.pausedAt)) releases.push({ at: sample.pausedAt, epoch: sample.pausedEpoch ?? playback.epoch - Number(!sample.paused) });
        if (Number.isFinite(sample.replacedAt)) releases.push({ at: sample.replacedAt, epoch: sample.replacedEpoch ?? playback.epoch - 1 });
        if (releases.length) sourceReleases.set(`sample:${sample.id}`, releases);
      }
    }
    for (const id of samplePlayback.keys()) if (!observedIds.has(id)) samplePlayback.delete(id);
    // A frozen position plus an exact pause time can recover short gates that
    // sounded between display frames. Its score remains anchored at that time.
    const pausedSamples = availableSamples.filter(sample => sample.paused && !sample.pending && Number.isFinite(sample.pausedAt)
      && !(sample.replacedAt >= sample.pausedAt && (sample.playbackEpoch ?? 0) > (sample.pausedEpoch ?? -1)))
      .map(sample => ({ ...sample, ...samplePlayback.get(playbackKey(sample)).voice }));
    const sourceList = [...activeSamples, ...pendingForecasts, ...replacementForecasts, ...pausedSamples, ...finishedSamples];
    const automata = state?.automata;
    const hasAutomata = automata?.playing && automata.generation >= 0 && automata.row?.length;
    if (hasAutomata && (!wasAutomataPlaying || automata.beat < lastAutomataBeat)) {
      automataEpoch++; automataFamilies.clear(); automataFamilyKey = null;
      automataHistoryFloor = sawAutomata && automata.beat >= lastAutomataBeat ? automata.beat : 0;
    }
    if (automata) { lastAutomataBeat = automata.beat; sawAutomata = true; }
    wasAutomataPlaying = Boolean(hasAutomata);
    if (hasAutomata) {
      const rows = (automata.history ?? []).slice(-BLECH_AUTOMATA_ROW_LIMIT);
      const key = `${automataEpoch}:${rows[0]?.generation}:${automata.generation}`;
      if (key !== automataFamilyKey) {
        const next = new Map(); let previous = null;
        for (const row of rows) {
          if (row.endBeat < automataHistoryFloor) continue;
          const cached = automataFamilies.get(row.generation), families = new Map();
          for (let column = 0; column < row.row.length; column++) if (row.row[column]) {
            const pitch = row.lowestNote + column;
            const family = cached?.get(pitch) ?? (row.articulation === 'hold' && !row.reseed ? previous?.get(pitch) : null)
              ?? { id: `automata:${automataEpoch}:${Math.max(row.startBeat, automataHistoryFloor)}:${pitch}`, start: Math.max(row.startBeat, automataHistoryFloor) };
            families.set(pitch, family);
          }
          next.set(row.generation, families); previous = families;
        }
        automataFamilies = next; automataFamilyKey = key;
      }
    }
    const pastIds = new Set(), pastSourceCounts = new Map();
    const rails = (state?.rails ?? []).slice(0, 192);
    const forecastRails = rails.filter(rail => !rail.held && !rail.paused);
    const historyPerSource = Math.max(1, Math.floor(BLECH_LIVE_NOTE_LIMIT / Math.max(1, sourceList.length + forecastRails.length + Number(Boolean(hasAutomata)))));
    const perSource = Math.max(1, Math.floor(limit / Math.max(1, activeSamples.length + pendingForecasts.length + forecastRails.length + Number(Boolean(hasAutomata)))));
    function emit(note, source, sourceLimit, drums = false, historyOnly = false) {
      if (!(note.gain > .0001) || !Number.isInteger(note.pitch) || note.pitch < 0 || note.pitch > 127
        || !Number.isFinite(note.velocity) || note.velocity <= 0 || !(note.end > note.start)) return;
      // The audio effects layer snapshots a note family at its attack. Editing
      // chords/transpose/echo does not retrigger already held notes; preserve the
      // same family in both forecast and history until this gate has finished.
      const effectId = note.effectId ?? note.id;
      let family = effectFamilies.get(effectId);
      if (!family) {
        const epoch = effectTimeline.findLast(item => item.at <= now + (note.effectStart ?? note.start)) ?? effectTimeline[0];
        family = { ...epoch, expires: now + note.end + tail };
        if (note.start <= 0) { effectFamilies.set(effectId, family); while (effectFamilies.size > BLECH_LIVE_NOTE_LIMIT) effectFamilies.delete(effectFamilies.keys().next().value); }
      }
      family.expires = Math.max(family.expires, now + note.end + tail);
      let childIndex = 0;
      // Most performances use no note effects. Expanding that identity note
      // through the full sanitizer for every forecast and history hit costs
      // more than the canvas; only use the expander when effects are enabled.
      const children = family.effects.enabled
        ? midiNoteEffectChildren(family.effects, note.pitch, note.velocity, { drums })
        : [{ note: note.pitch, velocity: note.velocity, delaySeconds: 0, gateSeconds: Infinity }];
      for (const child of children) {
        const id = `${note.id}:${family.revision}:${childIndex++}`;
        const start = note.start + child.delaySeconds, end = Math.min(start + Math.min(note.end - note.start, child.gateSeconds), note.releaseAt ?? Infinity);
        if (end <= start || end <= -pastSeconds || start > lookAhead) continue;
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
      const midi = sample.midi ?? {}, midiKey = JSON.stringify(midi);
      let projectedNotes = indexed.projectedByMidi.get(midiKey);
      if (!projectedNotes) {
        // Different layers may share an analysis but use different settings.
        // Bound revisions retained for an edited source; old score indexes are
        // otherwise released by the WeakMap when their analyses go away.
        if (indexed.projectedByMidi.size >= 2) indexed.projectedByMidi.delete(indexed.projectedByMidi.keys().next().value);
        projectedNotes = new Array(indexed.notes.length);
        indexed.projectedByMidi.set(midiKey, projectedNotes);
      }
      const projectedNote = index => projectedNotes[index] ??= transformMidiNote(indexed.notes[index], midi);
      const sync = sample.sync !== false, scale = sync ? 60 / (sample.completed || sample.paused ? bound(sample.tempo, 30, MAX_MIDI_MIXER_TEMPO, tempo) : tempo) : 1;
      const timeOffset = sample.completed ? sample.finishedAt - now : sample.paused ? sample.pausedAt - now : sample.forecastOffset ?? 0;
      const position = sync ? sample.positionBeats : sampleSecondsAt(indexed.tempo, sample.positionBeats);
      const length = sync ? analysis.durationBeats : indexed.durationSeconds;
      const playback = samplePlayback.get(playbackKey(sample)), epoch = playback?.epoch ?? 0;
      const revision = `${sample.scoreRevision ?? sample.revision ?? 0}:${epoch}`;
      const floorPosition = sync ? playback?.floorPosition ?? 0 : sampleSecondsAt(indexed.tempo, playback?.floorPosition ?? 0);
      const historyFloor = (floorPosition + ((playback?.floorCycle ?? 0) - Number(sample.cycle || 0)) * length - position) * scale + timeOffset;
      if (!(length > 0) || !Number.isFinite(position)) continue;
      const firstCycle = sample.loop ? Math.max(-Number(sample.cycle || 0), Math.floor((position - tail / scale) / length)) : 0;
      const finalCycle = sample.loop && !sample.pendingReplacement ? Math.max(0, Math.floor((position + (lookAhead - timeOffset) / scale) / length)) : 0;
      const lastCycle = Math.min(finalCycle, firstCycle + BLECH_LIVE_CYCLE_LIMIT - 1);
      if (lastCycle < finalCycle) truncated = true;
      if (!sample.completed && !sample.paused) sources.push(source);
      for (let cycle = firstCycle; !sample.completed && !sample.paused && cycle <= lastCycle && notes.length < sourceLimit; cycle++) {
        const offset = cycle * length - position, from = Math.max(0, -offset - (tail + timeOffset) / scale), to = Math.min(length, (lookAhead - timeOffset) / scale - offset);
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
          const note = projectedNote(index);
          if (!note.velocity || midi.controllers?.[7] === 0 || midi.controllers?.[11] === 0) continue;
          emit({ id: `${source}:${Number(sample.cycle || 0) + cycle}:${index}:${revision}`, revision, scoreVersion: sample.scoreVersion ?? 0, playbackEpoch: epoch, pitch: note.note, velocity: note.velocity, channel: note.channel % 16,
            track: 65536 + sample.slot * 4096 + note.track, gain: sample.gain * (midi.gain ?? 1),
            releaseAt: sample.pendingReplacement ? (length - position) * scale : undefined,
            start: Math.max((at(index) + offset) * scale + timeOffset, historyFloor), end: (end + offset) * scale + timeOffset }, source, sourceLimit, note.channel % 16 === 9);
          if (notes.length >= sourceLimit) { truncated = true; break; }
        }
        if (visited >= perSource * 4) truncated = true;
      }
      // History has its own bounded interval query. A dense forecast must not
      // consume every visit before we get to the gates that actually passed.
      if (pastSeconds > 0 && !sample.forecastOnly) {
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
            const note = projectedNote(index);
            if (!note.velocity || midi.controllers?.[7] === 0 || midi.controllers?.[11] === 0) continue;
            emit({ id: `${source}:${Number(sample.cycle || 0) + cycle}:${index}:${revision}`,
              revision, scoreVersion: sample.scoreVersion ?? 0, playbackEpoch: epoch, pitch: note.note, velocity: note.velocity, channel: note.channel % 16,
              track: 65536 + sample.slot * 4096 + note.track, gain: sample.gain * (midi.gain ?? 1),
              releaseAt: sample.replaced ? timeOffset : undefined,
              start: Math.max((at(index) + offset) * scale + timeOffset, historyFloor), end: (end + offset) * scale + timeOffset }, source, limit, note.channel % 16 === 9, true);
          }
        }
      }
    }
    // The editable Layers have their own four clip slots. These independent
    // rail sources are projected from their audio-clock beat, never inserted
    // into the layer rack or expanded into a repeatedly parsed MIDI score.
    const secondsPerBeat = 60 / tempo;
    for (const rail of forecastRails) {
      if (!rail.notes?.length) continue;
      const source = rail.id, sourceLimit = Math.min(limit, notes.length + perSource);
      const base = rail.startBeat + rail.delayBeats;
      const chord = rail.notes;
      if (notes.length >= sourceLimit) { truncated = true; continue; }
      sources.push(source);
      const projectNote = (note, beat, step) => {
        const start = (beat - state.sampleBeat) * secondsPerBeat;
        const end = start + note.duration * secondsPerBeat;
        if (start > lookAhead || end <= -pastSeconds) return;
        scanned++;
        emit({ id: `${source}:${step}:${note.note}`, pitch: note.note, velocity: note.velocity,
          channel: rail.channel, track: railTrack(rail.source), gain: rail.gain,
          start, end }, source, sourceLimit, rail.channel === 9);
      };
      if (rail.loop) {
        const period = rail.periodBeats, offset = (state.sampleBeat - base) / period;
        const first = Math.max(0, Math.floor(offset - pastSeconds / secondsPerBeat / period));
        const last = Math.max(-1, Math.ceil(offset + lookAhead / secondsPerBeat / period));
        // Reserve a fair visual budget per rail. Audio still schedules every
        // subdivision, even if the browser drops graphic frames under load.
        const maxRows = Math.min(BLECH_LIVE_CYCLE_LIMIT, Math.max(1, Math.floor(perSource / chord.length)));
        if (last - first + 1 > maxRows) truncated = true;
        for (let row = first; row <= Math.min(last, first + maxRows - 1) && notes.length < sourceLimit; row++) {
          const beat = base + row * period;
          for (const note of chord) projectNote(note, beat, row);
        }
      } else {
        // Search the sorted one-shot block from its visible interval. A huge
        // drag still visits at most a small multiple of its frame budget.
        let low = 0, high = chord.length;
        const begin = state.sampleBeat - base - pastSeconds / secondsPerBeat - .25;
        while (low < high) { const middle = (low + high) >>> 1; if (chord[middle].beat < begin) low = middle + 1; else high = middle; }
        const stop = Math.min(chord.length, low + perSource * 4);
        for (let index = low; index < stop && notes.length < sourceLimit; index++)
          projectNote(chord[index], base + chord[index].beat, index);
        if (stop < chord.length && base + chord[stop].beat <= state.sampleBeat + lookAhead / secondsPerBeat) truncated = true;
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
        const family = note.start === automata.rowStart ? automataFamilies.get(automata.generation)?.get(note.pitch) : null;
        emit({ ...note, id: family?.id ?? `automata:${automataEpoch}:${note.start}:${note.pitch}`,
          start: ((family?.start ?? Math.max(note.start, automataHistoryFloor)) - automata.beat) * 60 / tempo,
          end: (note.end - automata.beat) * 60 / tempo }, source, sourceLimit);
        if (notes.length >= sourceLimit) { truncated = true; break; }
      }
    }
    // Actual evolved rows, not forecast descendants, supply the past. A pause
    // stops adding gates; retained history can still leave through the bottom.
    if (hasAutomata && pastSeconds > 0) {
      // Starting/restarting a row precedes the clock's first advance, so its
      // published tempo history can legitimately be an empty array.
      const tempos = automata.tempos?.length ? automata.tempos : [{ beat: 0, bpm: tempo }];
      const tempoMap = { tempoMap: compileSampleTempoMap(tempos) };
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
          const pitch = row.lowestNote + column, family = automataFamilies.get(row.generation)?.get(pitch);
          emit({ id: family?.id ?? `row:${automataEpoch}:${row.generation}:${column}`, revision: automataEpoch, pitch, velocity: row.velocity,
            channel: 0, track: 196608, gain: row.gain,
            start: family ? sampleSecondsAt(tempoMap, family.start) - present : start, end }, 'automata', limit, false, true);
        }
      }
    }
    // Past notes are independent of currently active source IDs. Stopping a
    // pad removes its forecast immediately while its completed gates remain.
    const pastNotes = history.update(past, now, { seconds: pastSeconds, limit: BLECH_LIVE_NOTE_LIMIT, sourceReleases });
    // Forecast state is released as soon as its source stops.
    if (!hasAutomata) evolution = null;
    const railOutlines = blechRailHeldOutlines(state);
    return { notes, pastNotes, heldOutlines: [...heldOutlines(state, now), ...railOutlines],
      sources: [...sources, ...railOutlines.map(note => note.source)], held: held + railOutlines.length, scanned, truncated };
  };
}
