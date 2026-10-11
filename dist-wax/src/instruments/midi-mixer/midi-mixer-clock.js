import { midiParametersNeedResync } from './midi-mixer-parameters.js';
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
        const info = held.info[middle];
        result.push({ beat, sourceBeat: held.start[middle], kind: 9, channel: info >>> 14, a: info >>> 7 & 127, b: info & 127, noteId: held.ids?.[middle] ?? middle, durationBeats: held.end[middle] - beat });
      }
      stack.push([middle + 1, high]);
    }
  }
  return result;
}

/** Four one-shots use the same rendered frames and tempo as the decks, but
 * continue while their transport is paused. No UI timer schedules MIDI. */
export const MAX_SAMPLE_EVENTS_PER_BLOCK = 2048;
export class MidiSampleClock {
  constructor({ emit = () => {}, release = () => {}, restore = () => {}, configure = () => {} } = {}) {
    this.emit = emit; this.release = release; this.restore = restore; this.configure = configure;
    this.beat = 0; this.samples = [null, null, null, null]; this.skippedEvents = 0;
  }
  load(slot, sample) {
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.samples.length) return false;
    this.stop(slot);
    const position = Math.max(0, this.beat - sample.startBeat);
    if (position >= sample.data.durationBeats) return false;
    this.samples[slot] = { ...sample, cursor: lowerBound(sample.data.events, position) };
    this.restore(slot + 2, sample.data.controllers, position);
    this.configure(slot + 2, sample.config, sample.channels);
    for (const event of heldNotesAt(sample.data.held, position)) this.emit(slot + 2, event, 0);
    return true;
  }
  stop(slot) { if (this.samples[slot]) this.release(slot + 2); this.samples[slot] = null; }
  stopAll() { for (let slot = 0; slot < this.samples.length; slot++) this.stop(slot); }
  process(frames, sampleRate, tempo) {
    const increment = tempo / (60 * sampleRate), end = this.beat + frames * increment;
    let budget = MAX_SAMPLE_EVENTS_PER_BLOCK;
    for (let slot = 0; slot < this.samples.length; slot++) {
      const sample = this.samples[slot]; if (!sample) continue;
      const finish = Math.min(sample.data.durationBeats, end - sample.startBeat);
      const endIndex = lowerBound(sample.data.events, finish - 1e-10);
      const available = Math.max(0, endIndex - sample.cursor), count = Math.min(available, budget);
      for (let index = 0; index < count; index++) {
        const event = sample.data.events[sample.cursor++];
        const frame = Math.max(0, Math.min(frames - 1, Math.round((sample.startBeat + event.beat - this.beat) / increment)));
        this.emit(slot + 2, event, frame);
      }
      budget -= count;
      if (available > count) { this.skippedEvents += available - count; sample.cursor = endIndex; this.release(slot + 2, frames - 1); }
      if (end >= sample.startBeat + sample.data.durationBeats) {
        const frame = Math.max(0, Math.min(frames - 1, Math.round((sample.startBeat + sample.data.durationBeats - this.beat) / increment)));
        this.release(slot + 2, frame); this.samples[slot] = null;
      }
    }
    this.beat = end;
  }
}
export const MAX_EVENTS_PER_BLOCK = 8192;
export class MidiMixerClock {
  constructor({ emit = () => {}, release = () => {}, restore = () => {}, configure = () => {} } = {}) {
    this.emit = emit; this.release = release; this.restore = restore; this.configure = configure;
    this.beat = 0; this.tempo = 120; this.playing = false; this.decks = [null, null]; this.skippedEvents = 0;
  }
  load(index, data, config, channels) {
    this.release(index);
    this.decks[index] = { ...data, config: { ...config }, channelConfig: channels, cursor: 0, cycle: null };
    this.resync(index);
  }
  resync(index) {
    const deck = this.decks[index]; if (!deck) return;
    this.release(index);
    const absolute = this.beat * (deck.config.rate ?? 1) + deck.config.offsetBeats;
    const bounds = mixerLoopBounds(deck), position = bounds.start + (deck.config.loop ? mod(absolute, bounds.length) : absolute);
    deck.cursor = lowerBound(deck.events, Math.max(bounds.start, position)); deck.ended = false;
    deck.cycle = deck.config.loop ? Math.floor(absolute / bounds.length) : 0;
    // Controller-only history is separate: seeking never triggers overdue attacks.
    this.restore(index, deck.controllers, Math.max(bounds.start, position));
    this.configure(index, deck.config, deck.channelConfig);
    if (this.playing && position >= bounds.start && position < bounds.end) {
      for (const event of heldNotesAt(deck.held, position)) this.emit(index, event, 0);
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
    for (let index = 0; index < 2; index++) {
      const deck = this.decks[index]; if (!deck) continue;
      const bounds = mixerLoopBounds(deck), sourceIncrement = increment * (deck.config.rate ?? 1);
      const start = this.beat * (deck.config.rate ?? 1) + deck.config.offsetBeats, finish = end * (deck.config.rate ?? 1) + deck.config.offsetBeats;
      if (!deck.config.loop && deck.ended) continue;
      if (!deck.config.loop && start < 0 && finish >= 0) {
        const frame = Math.max(0, Math.min(frames - 1, Math.round(-start / sourceIncrement)));
        for (const event of heldNotesAt(deck.held, bounds.start)) this.emit(index, event, frame);
      }
      let cursorBeat = start, budget = MAX_EVENTS_PER_BLOCK;
      // Minimum loop length is >= 1/32 quarter; at 300 BPM even the slowest supported
      // browser sample rate crosses at most a few boundaries in one render quantum.
      while (cursorBeat < finish - 1e-12) {
        const cycle = deck.config.loop ? Math.floor((cursorBeat + 1e-10) / bounds.length) : 0;
        const base = (deck.config.loop ? cycle * bounds.length : 0) - bounds.start;
        if (deck.cycle !== cycle) {
          this.release(index, Math.max(0, Math.round((cursorBeat - start) / sourceIncrement)));
          deck.cycle = cycle; deck.cursor = lowerBound(deck.events, bounds.start);
          this.restore(index, deck.controllers, bounds.start); this.configure(index, deck.config, deck.channelConfig);
          const frame = Math.max(0, Math.round((cursorBeat - start) / sourceIncrement));
          for (const event of heldNotesAt(deck.held, bounds.start)) this.emit(index, event, frame);
        }
        const segmentEnd = deck.config.loop ? Math.min(finish, base + bounds.end) : finish;
        const endIndex = lowerBound(deck.events, Math.min(bounds.end, segmentEnd - base) - 1e-10);
        const available = Math.max(0, endIndex - deck.cursor), count = Math.min(available, budget);
        for (let n = 0; n < count; n++) {
          const event = deck.events[deck.cursor++];
          const frame = Math.max(0, Math.min(frames - 1, Math.round((event.beat + base - start) / sourceIncrement)));
          this.emit(index, event, frame);
        }
        budget -= count;
        if (available > count) {
          this.skippedEvents += available - count; deck.cursor = endIndex;
          // Dense overload must never leave an unmatched note or pedal held.
          this.release(index, frames - 1);
        }
        cursorBeat = segmentEnd;
        if (!deck.config.loop) {
          if (finish >= bounds.length) {
            this.release(index, Math.max(0, Math.min(frames - 1, Math.round((bounds.length - start) / sourceIncrement))));
            deck.ended = true;
          }
          break;
        }
      }
    }
    this.beat = end;
  }
}
