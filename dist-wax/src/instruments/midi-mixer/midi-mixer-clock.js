import { midiParametersNeedResync } from './midi-mixer-parameters.js';
import { defaultWeaveConfig, sanitizeWeaveConfig, weavePosition } from './midi-mixer-model.js';
/** Two decks advance from the same audio-frame counter. No wall-clock timers. */
const mod = (value, size) => ((value % size) + size) % size;
export function lowerBound(events, beat) {
  let low = 0, high = events.length;
  while (low < high) { const middle = (low + high) >>> 1; if (events[middle].beat < beat) low = middle + 1; else high = middle; }
  return low;
}
export const mixerLoopBounds = deck => {
  const start = Math.max(0, Math.min(deck.loopBeats - 1 / 32, deck.config.loopStartBeats ?? 0));
  const end = Math.max(start + 1 / 32, Math.min(deck.loopBeats, deck.config.loopEndBeats ?? deck.loopBeats));
  return { start, end, length: end - start };
};
/** Find notes that are sounding now, pruning an augmented interval tree.
 * At most the audible voice budget is restored; notes ending before a seek
 * are never triggered. This also keeps long sparse pads audible on Audio arm. */
export function heldNotesAt(held, beat, limit = 192) {
  if (!held?.start?.length) return [];
  const result = [], stack = [[0, held.start.length]];
  while (stack.length && result.length < limit) {
    const [low, high] = stack.pop(); if (low >= high) continue;
    const middle = (low + high) >>> 1;
    if (held.maxEnd[middle] <= beat) continue;
    stack.push([low, middle]);
    if (held.start[middle] < beat - 1e-9) {
      if (held.end[middle] > beat) {
        const info = held.info[middle], channel = info >>> 14;
        const pedal = held.stateHistories?.channels.find(item => item.channel === channel)?.lanes.find(lane => lane.kind === 'cc' && lane.number === 66);
        let lowChange = 0, highChange = pedal?.changes.length ?? 0;
        while (lowChange < highChange) { const middleChange = (lowChange + highChange) >>> 1; if (pedal.changes[middleChange].tick / held.stateHistories.ppq < beat - 1e-9) lowChange = middleChange + 1; else highChange = middleChange; }
        const change = pedal?.changes[lowChange - 1], rise = (change?.rise ?? -Infinity) / (held.stateHistories?.ppq ?? 1);
        const afterAttack = rise > held.start[middle] || rise === held.start[middle] && change.riseOrder >= (held.ids?.[middle] ?? middle);
        const beforeRelease = rise < held.keyEnd?.[middle] || rise === held.keyEnd?.[middle] && change.riseOrder < held.keyEndOrder[middle];
        result.push({ keyReleased: (held.keyEnd?.[middle] ?? held.end[middle]) < beat - 1e-9, sostenutoHeld: change?.value >= 64 && afterAttack && beforeRelease, beat, sourceBeat: held.start[middle], kind: 9, channel: info >>> 14, a: info >>> 7 & 127, b: info & 127, noteId: held.ids?.[middle] ?? middle, durationBeats: held.end[middle] - beat });
      }
      stack.push([middle + 1, high]);
    }
  }
  return result;
}

/** Source-time lookup is logarithmic even for files with many tempo changes. */
export function compileSampleTempoMap(tempos = [{ beat: 0, bpm: 120 }]) {
  let seconds = 0, previous = 0, bpm = 120;
  return tempos.map(tempo => { seconds += (tempo.beat - previous) * 60 / bpm; previous = tempo.beat; bpm = tempo.bpm; return { beat: previous, bpm, seconds }; });
}
function tempoSegment(data, value, key = 'beat') {
  const map = data.tempoMap ?? [{ beat: 0, bpm: 120, seconds: 0 }];
  let low = 0, high = map.length;
  while (low < high) { const middle = (low + high) >>> 1; if (map[middle][key] <= value) low = middle + 1; else high = middle; }
  return map[Math.max(0, low - 1)];
}
export const sampleSecondsAt = (data, beat) => { const point = tempoSegment(data, beat); return point.seconds + (beat - point.beat) * 60 / point.bpm; };
export const sampleBeatAt = (data, seconds) => { const point = tempoSegment(data, seconds, 'seconds'); return point.beat + (seconds - point.seconds) * point.bpm / 60; };
export const sampleTempoAt = (data, beat) => tempoSegment(data, beat).bpm;
export function advanceSampleTiming(timing, data, options, beats, seconds) {
  if (options.paused) return { ...timing };
  const next = { ...timing }, delay = Math.min(next.pendingBeats, Math.max(0, beats));
  next.pendingBeats = Math.max(0, next.pendingBeats - delay);
  const elapsed = options.sync !== false ? Math.max(0, beats - delay) : Math.max(0, seconds) * (beats > 0 ? 1 - delay / beats : 1);
  const length = options.sync !== false ? data.durationBeats : sampleSecondsAt(data, data.durationBeats);
  const position = (options.sync !== false ? next.positionBeats : sampleSecondsAt(data, next.positionBeats)) + elapsed;
  const epsilon = Math.min(1e-10, length * 1e-9);
  const cycles = options.loop ? Math.floor((position + epsilon) / length) : 0;
  let coordinate = options.loop ? Math.max(0, position - cycles * length) : Math.min(length, position);
  if (options.loop && coordinate <= epsilon) coordinate = 0;
  next.positionBeats = options.sync !== false ? coordinate : sampleBeatAt(data, coordinate);
  next.cycle += cycles; next.ended = !options.loop && position >= length - epsilon;
  return next;
}

/** Fraction of an elapsed interval at which the current pass ends. */
export function sampleReplacementBoundary(timing, data, options, beats, seconds) {
  if (options.paused || !options.loop) return null;
  const delay = Math.min(timing.pendingBeats, Math.max(0, beats));
  const remaining = options.sync !== false
    ? timing.pendingBeats + data.durationBeats - timing.positionBeats
    : (beats > 0 ? seconds * delay / beats : 0) + sampleSecondsAt(data, data.durationBeats) - sampleSecondsAt(data, timing.positionBeats);
  const elapsed = options.sync !== false ? beats : seconds;
  return elapsed > 0 && remaining <= elapsed + 1e-9 ? Math.max(0, Math.min(1, remaining / elapsed)) : null;
}

/** Four clips share rendered frames with the decks; source tempo can run free. */
export const MAX_SAMPLE_EVENTS_PER_BLOCK = 2048;
export const MAX_SAMPLE_LOOPS_PER_BLOCK = 16;
// Each complete chase is separately bounded to 4,096 messages at compilation.
export const MAX_SAMPLE_RESTORES_PER_BLOCK = 4;
export class MidiSampleClock {
  constructor({ emit = () => {}, release = () => {}, restore = () => {}, configure = () => {}, replace = () => {}, rehydrate } = {}) {
    this.emit = emit; this.release = release; this.restore = restore; this.configure = configure; this.rehydrate = rehydrate ?? ((deck, events, frame) => { for (const event of events) this.emit(deck, event, frame); });
    this.replace = replace;
    this.beat = 0; this.seconds = 0; this.completed = []; this.samples = [null, null, null, null]; this.skippedEvents = 0;
  }
  load(slot, sample) {
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.samples.length) return false;
    this.stop(slot);
    const timing = sample.timing ?? { positionBeats: Math.max(0, this.beat - sample.startBeat), pendingBeats: Math.max(0, sample.startBeat - this.beat), cycle: 0, ended: false };
    if (timing.ended || !sample.loop && timing.positionBeats >= sample.data.durationBeats) return false;
    this.samples[slot] = { ...sample, paused: Boolean(sample.paused), sync: sample.sync !== false, loop: Boolean(sample.loop), timing: { ...timing }, cursor: lowerBound(sample.data.events, timing.positionBeats) };
    this.resync(slot);
    return true;
  }
  resync(slot, frame = 0) {
    const sample = this.samples[slot]; if (!sample) return;
    const position = sample.timing.positionBeats;
    this.restore(slot + 2, sample.data.stateHistories ?? sample.data.controllers, position, frame);
    this.configure(slot + 2, sample.config, sample.channels, frame);
    const notes = sample.paused || sample.timing.pendingBeats > 0 ? [] : heldNotesAt(sample.data.held, position).filter(event => sample.timing.cycle > 0 || !sample.skippedAppendNotes?.has(event.noteId));
    sample.rejoinedReleases = notes.filter(event => event.keyReleased && event.sostenutoHeld).map(event => ({ ...event, kind: 8, b: 0, beat: event.beat + event.durationBeats }));
    this.rehydrate(slot + 2, notes, frame);
  }
  setOptions(slot, { loop, sync, revision } = {}) {
    const sample = this.samples[slot]; if (!sample) return;
    if (loop !== undefined) { sample.loop = Boolean(loop); if (!sample.loop) sample.pendingReplacement = null; }
    if (sync !== undefined) { sample.sync = Boolean(sync); if (!sample.sync) sample.timing.pendingBeats = 0; }
    if (revision !== undefined) sample.revision = revision;
  }
  replaceScore(slot, replacement, { restart = false, defer = false, revision } = {}) {
    const sample = this.samples[slot]; if (!sample) return false;
    if (revision !== undefined) sample.revision = revision;
    if (defer && sample.loop) sample.pendingReplacement = replacement;
    else if (restart || sample.paused || sample.timing.pendingBeats > 0 || sample.timing.positionBeats === 0 && sample.timing.cycle === 0) {
      this.applyReplacement(slot, replacement, 0, this.seconds, sample.timing.pendingBeats);
    } else if (sample.loop) sample.pendingReplacement = replacement;
    else return false;
    return true;
  }
  appendScore(slot, data, revision) {
    const sample = this.samples[slot];
    if (!sample || sample.loop || sample.timing.cycle) return false;
    if (data.durationBeats <= sample.timing.positionBeats) {
      // Finalization may arrive after its requested endpoint. Acknowledge the
      // new revision and finish now; never leave the UI waiting on old telemetry.
      this.release(slot + 2); this.samples[slot] = null;
      if (this.completed.length >= 4) this.completed.shift();
      this.completed.push({ id: sample.id, revision, scoreVersion: sample.scoreVersion ?? 0, ended: true, positionBeats: data.durationBeats, cycle: 0, pendingBeats: 0, finishedAt: this.seconds });
      return true;
    }
    // No release, restore or replay: existing note IDs/gates remain owned by this
    // source. A stalled producer never catches up overdue newly added attacks.
    const oldIds = new Set(sample.data.held.ids);
    const late = new Set(data.events.filter(event => event.kind === 9 && !oldIds.has(event.noteId) && event.beat < sample.timing.positionBeats).map(event => event.noteId));
    sample.skippedAppendNotes ??= new Set();
    for (const id of late) sample.skippedAppendNotes.add(id);
    sample.data = data;
    sample.cursor = lowerBound(sample.data.events, sample.timing.positionBeats);
    sample.revision = revision;
    return true;
  }
  confirmScore(slot, version) {
    const sample = this.samples[slot];
    if (!sample || !Number.isInteger(version) || sample.pendingReplacement?.token !== version || sample.scoreVersion === version) return;
    // A UI snapshot can lead the rendered quantum by one block. If its next
    // gesture already names the newly current score, preserve that score before
    // replacing the queued draft or changing its transport. Never lose a pass
    // merely because its acknowledgement is still crossing the message port.
    sample.timing.cycle++;
    this.applyReplacement(slot, sample.pendingReplacement, 0, this.seconds);
  }
  applyReplacement(slot, replacement, frame, at, pendingBeats = 0, restore = true) {
    const sample = this.samples[slot]; if (!sample || !replacement) return;
    this.release(slot + 2, frame);
    sample.data = replacement.data; sample.channels = replacement.channels; sample.skippedAppendNotes = null;
    sample.scoreVersion = replacement.token; sample.replacedAt = at; sample.replacedEpoch = sample.playbackEpoch ?? 0;
    sample.pendingReplacement = null; sample.playbackEpoch = (sample.playbackEpoch ?? 0) + 1;
    sample.resumedPositionBeats = 0; sample.resumedCycle = sample.timing.cycle;
    sample.timing = { positionBeats: 0, cycle: sample.timing.cycle, pendingBeats: Math.max(pendingBeats, replacement.delayBeats ?? 0), ended: false };
    sample.cursor = 0; sample.wrapPending = sample.needsResync = false;
    this.replace(slot + 2, sample.data, frame);
    if (restore) this.resync(slot, frame); else sample.needsResync = true;
  }
  setPaused(slot, paused, revision) {
    const sample = this.samples[slot]; if (!sample) return false;
    if (revision !== undefined) sample.revision = revision;
    paused = Boolean(paused);
    if (sample.paused === paused) return true;
    sample.paused = paused;
    if (paused) { sample.pausedAt = this.seconds; sample.pausedEpoch = sample.playbackEpoch ?? 0; this.release(slot + 2); }
    else {
      sample.playbackEpoch = (sample.playbackEpoch ?? 0) + 1;
      sample.resumedPositionBeats = sample.timing.positionBeats; sample.resumedCycle = sample.timing.cycle;
      // A pause releases only this source. Resume chases its current controllers
      // and held gates, including a loop paused exactly at its wrap boundary.
      sample.cursor = lowerBound(sample.data.events, sample.timing.positionBeats);
      sample.wrapPending = sample.needsResync = false;
      this.resync(slot);
    }
    return true;
  }
  stop(slot) { if (this.samples[slot]) this.release(slot + 2); this.samples[slot] = null; }
  stopAll() { for (let slot = 0; slot < this.samples.length; slot++) this.stop(slot); }
  snapshot() { return [...this.samples.flatMap(sample => sample ? [{ id: sample.id, revision: sample.revision, ...sample.timing,
    scoreVersion: sample.scoreVersion ?? 0, ...(Number.isFinite(sample.replacedAt) ? { replacedAt: sample.replacedAt, replacedEpoch: sample.replacedEpoch } : {}),
    ...(Number.isFinite(sample.pausedAt) ? { pausedAt: sample.pausedAt, pausedEpoch: sample.pausedEpoch } : {}),
    ...(sample.playbackEpoch ? { playbackEpoch: sample.playbackEpoch, resumedPositionBeats: sample.resumedPositionBeats, resumedCycle: sample.resumedCycle } : {}) }] : []), ...this.completed.splice(0)]; }
  process(frames, sampleRate, tempo) {
    const beatIncrement = tempo / (60 * sampleRate), beatDelta = frames * beatIncrement;
    let budget = MAX_SAMPLE_EVENTS_PER_BLOCK, restores = MAX_SAMPLE_RESTORES_PER_BLOCK;
    for (let slot = 0; slot < this.samples.length; slot++) {
      const sample = this.samples[slot]; if (!sample || sample.paused) continue;
      let initial = sample.timing, final = advanceSampleTiming(initial, sample.data, sample, beatDelta, frames / sampleRate);
      const skipRemainder = frame => {
        this.skippedEvents += sample.data.events.length * Math.max(1, final.cycle - initial.cycle);
        const boundary = sample.pendingReplacement ? sampleReplacementBoundary(initial, sample.data, sample, beatDelta, frames / sampleRate) : null;
        if (boundary !== null) {
          sample.timing = { positionBeats: 0, cycle: initial.cycle + 1, pendingBeats: 0, ended: false };
          this.applyReplacement(slot, sample.pendingReplacement, Math.min(frames - 1, Math.round(frames * boundary)), this.seconds + frames * boundary / sampleRate, 0, false);
          final = advanceSampleTiming(sample.timing, sample.data, sample, beatDelta * (1 - boundary), frames * (1 - boundary) / sampleRate);
        }
        this.release(slot + 2, frame); sample.cursor = lowerBound(sample.data.events, final.positionBeats);
        sample.timing = final; sample.needsResync = true;
      };
      if (sample.wrapPending || sample.needsResync) {
        if (!restores) { skipRemainder(0); continue; }
        restores--; this.release(slot + 2, 0); sample.cursor = lowerBound(sample.data.events, sample.timing.positionBeats);
        this.resync(slot, 0); sample.wrapPending = sample.needsResync = false;
      }
      let frameStart = initial.pendingBeats / beatIncrement;
      if (frameStart >= frames - 1e-9) { sample.timing = final; continue; }
      const coordinate = beat => sample.sync ? beat : sampleSecondsAt(sample.data, beat);
      const toBeat = value => sample.sync ? value : sampleBeatAt(sample.data, value);
      const increment = sample.sync ? beatIncrement : 1 / sampleRate;
      let length = coordinate(sample.data.durationBeats);
      let position = coordinate(initial.positionBeats), crossings = 0;
      const frameAt = value => Math.max(0, Math.min(frames - 1, Math.round(value)));
      while (frameStart < frames - 1e-9) {
        const finish = Math.min(length, position + (frames - frameStart) * increment);
        const endIndex = lowerBound(sample.data.events, toBeat(finish) - 1e-10);
        const available = Math.max(0, endIndex - sample.cursor), count = Math.min(available, budget);
        for (let index = 0; index < count; index++) {
          const event = sample.data.events[sample.cursor++];
          if (sample.timing.cycle === 0 && sample.skippedAppendNotes?.has(event.noteId)) continue;
          const duration = sample.sync ? (event.durationBeats ?? 0) * 60 / tempo : sampleSecondsAt(sample.data, Math.min(sample.data.durationBeats, event.beat + (event.durationBeats ?? 0))) - sampleSecondsAt(sample.data, event.beat);
          this.emit(slot + 2, { ...event, sampleEndBeats: sample.data.durationBeats, durationSeconds: duration }, frameAt(frameStart + (coordinate(event.beat) - position) / increment));
        }
        for (const event of sample.rejoinedReleases ?? []) if (coordinate(event.beat) < finish) this.emit(slot + 2, event, frameAt(frameStart + (coordinate(event.beat) - position) / increment));
        sample.rejoinedReleases = sample.rejoinedReleases?.filter(event => coordinate(event.beat) >= finish);
        budget -= count;
        if (available > count) { this.skippedEvents += available - count; sample.cursor = endIndex; this.release(slot + 2, frameAt(frameStart + (finish - position) / increment)); }
        frameStart += (finish - position) / increment;
        if (finish < length - Math.min(1e-10, length * 1e-9)) break;
        if (!sample.loop) { this.release(slot + 2, frameAt(frameStart)); if (this.completed.length >= 4) this.completed.shift(); this.completed.push({ id: sample.id, revision: sample.revision, ended: true, positionBeats: sample.data.durationBeats, cycle: final.cycle, pendingBeats: 0, finishedAt: this.seconds + frameStart / sampleRate }); this.samples[slot] = null; break; }
        if (sample.pendingReplacement) {
          sample.timing = { positionBeats: 0, cycle: initial.cycle + 1, pendingBeats: 0, ended: false };
          const restore = restores > 0 && frameStart < frames - 1e-9;
          if (restore) restores--;
          this.applyReplacement(slot, sample.pendingReplacement, frameAt(frameStart), this.seconds + frameStart / sampleRate, 0, restore);
          initial = { ...sample.timing };
          final = advanceSampleTiming(initial, sample.data, sample, Math.max(0, frames - frameStart) * beatIncrement, Math.max(0, frames - frameStart) / sampleRate);
          length = coordinate(sample.data.durationBeats); position = 0;
          frameStart += initial.pendingBeats / beatIncrement;
          if (!restore) { sample.cursor = lowerBound(sample.data.events, final.positionBeats); break; }
          continue;
        }
        // At a block edge defer the new cycle to frame zero of the next block.
        if (frameStart >= frames - 1e-9) { sample.wrapPending = true; break; }
        if (!restores) { skipRemainder(frameAt(frameStart)); break; }
        restores--; this.release(slot + 2, frameAt(frameStart)); sample.cursor = 0;
        sample.timing = { ...final, positionBeats: 0, pendingBeats: 0 };
        this.resync(slot, frameAt(frameStart)); position = 0;
        if (++crossings >= MAX_SAMPLE_LOOPS_PER_BLOCK) {
          this.skippedEvents += sample.data.events.length * Math.max(1, final.cycle - initial.cycle - crossings);
          this.release(slot + 2, frames - 1); sample.cursor = lowerBound(sample.data.events, final.positionBeats); sample.needsResync = true; break;
        }
      }
      sample.timing = final;
    }
    this.beat += beatDelta; this.seconds += frames / sampleRate;
  }
}
export const MAX_EVENTS_PER_BLOCK = 8192;
export class MidiMixerClock {
  constructor({ emit = () => {}, release = () => {}, restore = () => {}, configure = () => {}, rehydrate } = {}) {
    this.emit = emit; this.release = release; this.restore = restore; this.configure = configure; this.rehydrate = rehydrate ?? ((deck, events, frame) => { for (const event of events) this.emit(deck, event, frame); });
    this.beat = 0; this.tempo = 120; this.playing = false; this.decks = [null, null]; this.skippedEvents = 0;
    this.weave = defaultWeaveConfig(); this.weavePhase = { startBeat: 0, deckBeats: [0, 0] };
  }
  load(index, data, config, channels) {
    this.release(index);
    this.decks[index] = { ...data, config: { ...config }, channelConfig: channels, cursor: 0, cycle: null };
    this.resync(index);
  }
  setWeave(config, phase) {
    this.weave = sanitizeWeaveConfig(config);
    this.weavePhase = { startBeat: phase.startBeat, deckBeats: [...phase.deckBeats] };
    for (let index = 0; index < 2; index++) this.resync(index, { hard: true });
  }
  rejoin(index, notes, frame) {
    this.decks[index].rejoinedReleases = notes.filter(event => event.keyReleased && event.sostenutoHeld).map(event => ({ ...event, kind: 8, b: 0, beat: event.beat + event.durationBeats }));
    this.rehydrate(index, notes, frame);
  }
  resync(index, { beat = this.beat, frame = 0, hard = false } = {}) {
    const deck = this.decks[index]; if (!deck) return;
    this.release(index, frame, hard); deck.rejoinedReleases = [];
    const weave = weavePosition(beat, this.weave, this.weavePhase);
    const absolute = weave.deckBeats[index] * (deck.config.rate ?? 1) + deck.config.offsetBeats;
    const bounds = mixerLoopBounds(deck), position = bounds.start + (deck.config.loop ? mod(absolute, bounds.length) : absolute);
    deck.cursor = lowerBound(deck.events, Math.max(bounds.start, position)); deck.ended = false;
    deck.cycle = deck.config.loop ? Math.floor(absolute / bounds.length) : 0;
    // Controller-only history is separate: seeking never triggers overdue attacks.
    this.restore(index, deck.stateHistories ?? deck.controllers, Math.max(bounds.start, position), frame);
    this.configure(index, deck.config, deck.channelConfig, frame);
    deck.weaveActive = weave.active[index];
    if (this.playing && deck.weaveActive && position >= bounds.start && position < bounds.end) {
      this.rejoin(index, heldNotesAt(deck.held, position), frame);
    }
  }
  setDeck(index, config, channels) {
    const deck = this.decks[index]; if (!deck) return;
    const seek = config.transpose !== deck.config.transpose || midiParametersNeedResync(deck.config.midi, config.midi) || channels.some(channel => midiParametersNeedResync(deck.channelConfig.find(item => item.channel === channel.channel)?.midi, channel.midi)) || config.rate !== deck.config.rate || config.offsetBeats !== deck.config.offsetBeats || config.loop !== deck.config.loop || config.loopStartBeats !== deck.config.loopStartBeats || config.loopEndBeats !== deck.config.loopEndBeats;
    deck.config = { ...config }; deck.channelConfig = channels;
    if (seek) this.resync(index); else this.configure(index, config, channels);
  }
  setTransport(playing, beat = this.beat) {
    const moved = Math.abs(beat - this.beat) > 1e-7, wasPlaying = this.playing;
    this.beat = Math.max(0, beat); this.playing = Boolean(playing);
    if (!playing) for (let index = 0; index < 2; index++) this.release(index);
    if (moved || playing && !wasPlaying) for (let index = 0; index < 2; index++) this.resync(index);
    this.playing = Boolean(playing);
  }
  process(frames, sampleRate) {
    if (!this.playing) return;
    const increment = this.tempo / (60 * sampleRate), end = this.beat + frames * increment;
    const budgets = [MAX_EVENTS_PER_BLOCK, MAX_EVENTS_PER_BLOCK];
    let cursor = this.beat;
    while (cursor < end - 1e-12) {
      const weave = weavePosition(cursor, this.weave, this.weavePhase), segmentEnd = Math.min(end, weave.nextBeat);
      const finish = weavePosition(segmentEnd, this.weave, this.weavePhase);
      const frame = Math.max(0, Math.min(frames - 1, Math.round((cursor - this.beat) / increment)));
      for (let index = 0; index < 2; index++) {
        const deck = this.decks[index];
        if (deck?.weaveActive && !weave.active[index]) { this.release(index, frame, true); deck.weaveActive = false; }
      }
      for (let index = 0; index < 2; index++) {
        const deck = this.decks[index]; if (!deck) continue;
        if (deck.weaveActive !== weave.active[index]) {
          if (weave.active[index]) this.resync(index, { beat: cursor, frame });
          else { this.release(index, frame, true); deck.weaveActive = false; }
        }
        if (weave.active[index]) this.processDeck(index, weave.deckBeats[index], finish.deckBeats[index], cursor, increment, frames, budgets);
      }
      cursor = segmentEnd;
    }
    this.beat = end;
  }
  processDeck(index, from, to, masterStart, increment, frames, budgets) {
    const deck = this.decks[index];
    const bounds = mixerLoopBounds(deck), sourceIncrement = increment * (deck.config.rate ?? 1);
    const start = from * (deck.config.rate ?? 1) + deck.config.offsetBeats, finish = to * (deck.config.rate ?? 1) + deck.config.offsetBeats;
    const frameAt = value => Math.max(0, Math.min(frames - 1, Math.round((masterStart - this.beat) / increment + (value - start) / sourceIncrement)));
    if (!deck.config.loop && deck.ended) return;
    if (!deck.config.loop && start < 0 && finish >= 0) {
      const frame = frameAt(0);
      this.rejoin(index, heldNotesAt(deck.held, bounds.start), frame);
    }
    let cursorBeat = start;
    // Minimum loop and weave lengths bound crossings even at 8× and 8 kHz.
    while (cursorBeat < finish - 1e-12) {
      const cycle = deck.config.loop ? Math.floor((cursorBeat + 1e-10) / bounds.length) : 0;
      const base = (deck.config.loop ? cycle * bounds.length : 0) - bounds.start;
      if (deck.cycle !== cycle) {
        const frame = frameAt(cursorBeat);
        this.release(index, frame);
        deck.cycle = cycle; deck.cursor = lowerBound(deck.events, bounds.start);
        this.restore(index, deck.stateHistories ?? deck.controllers, bounds.start, frame); this.configure(index, deck.config, deck.channelConfig, frame);
        this.rejoin(index, heldNotesAt(deck.held, bounds.start), frame);
      }
      const segmentEnd = deck.config.loop ? Math.min(finish, base + bounds.end) : finish;
      const endIndex = lowerBound(deck.events, Math.min(bounds.end, segmentEnd - base) - 1e-10);
      const available = Math.max(0, endIndex - deck.cursor), count = Math.min(available, budgets[index]);
      for (let n = 0; n < count; n++) {
        const event = deck.events[deck.cursor++];
        const frame = frameAt(event.beat + base);
        this.emit(index, event, frame);
      }
      for (const event of deck.rejoinedReleases ?? []) if (event.beat < segmentEnd - base) this.emit(index, event, frameAt(event.beat + base));
      deck.rejoinedReleases = deck.rejoinedReleases?.filter(event => event.beat >= segmentEnd - base);
      budgets[index] -= count;
      if (available > count) {
        this.skippedEvents += available - count; deck.cursor = endIndex;
        // Dense overload must never leave an unmatched note or pedal held.
        this.release(index, frames - 1);
      }
      cursorBeat = segmentEnd;
      if (!deck.config.loop) {
        if (finish >= bounds.length) {
          this.release(index, frameAt(bounds.length));
          deck.ended = true;
        }
        break;
      }
    }
  }
}
