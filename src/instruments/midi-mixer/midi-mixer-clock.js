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
    const absolute = this.beat + deck.config.offsetBeats;
    const bounds = mixerLoopBounds(deck), position = bounds.start + (deck.config.loop ? mod(absolute, bounds.length) : absolute);
    deck.cursor = lowerBound(deck.events, Math.max(bounds.start, position)); deck.ended = false;
    deck.cycle = deck.config.loop ? Math.floor(absolute / bounds.length) : 0;
    // Controller-only history is separate: seeking never triggers overdue attacks.
    this.restore(index, deck.controllers, Math.max(bounds.start, position));
    this.configure(index, deck.config, deck.channelConfig);
  }
  setDeck(index, config, channels) {
    const deck = this.decks[index]; if (!deck) return;
    const seek = config.offsetBeats !== deck.config.offsetBeats || config.loop !== deck.config.loop || config.loopStartBeats !== deck.config.loopStartBeats || config.loopEndBeats !== deck.config.loopEndBeats;
    deck.config = { ...config }; deck.channelConfig = channels;
    if (seek) this.resync(index); else this.configure(index, config, channels);
  }
  setTransport(playing, beat = this.beat) {
    const moved = Math.abs(beat - this.beat) > 1e-7;
    this.beat = Math.max(0, beat);
    if (!playing) for (let index = 0; index < 2; index++) this.release(index);
    if (moved || playing && !this.playing) for (let index = 0; index < 2; index++) this.resync(index);
    this.playing = Boolean(playing);
  }
  process(frames, sampleRate) {
    if (!this.playing) return;
    const increment = this.tempo / (60 * sampleRate), end = this.beat + frames * increment;
    for (let index = 0; index < 2; index++) {
      const deck = this.decks[index]; if (!deck) continue;
      const bounds = mixerLoopBounds(deck);
      const start = this.beat + deck.config.offsetBeats, finish = end + deck.config.offsetBeats;
      if (!deck.config.loop && deck.ended) continue;
      let cursorBeat = start, budget = MAX_EVENTS_PER_BLOCK;
      // Minimum loop length is >= 1/32 quarter; at 300 BPM even the slowest supported
      // browser sample rate crosses at most a few boundaries in one render quantum.
      while (cursorBeat < finish - 1e-12) {
        const cycle = deck.config.loop ? Math.floor((cursorBeat + 1e-10) / bounds.length) : 0;
        const base = (deck.config.loop ? cycle * bounds.length : 0) - bounds.start;
        if (deck.cycle !== cycle) {
          this.release(index, Math.max(0, Math.round((cursorBeat - start) / increment)));
          deck.cycle = cycle; deck.cursor = lowerBound(deck.events, bounds.start);
          this.restore(index, deck.controllers, bounds.start); this.configure(index, deck.config, deck.channelConfig);
        }
        const segmentEnd = deck.config.loop ? Math.min(finish, base + bounds.end) : finish;
        const endIndex = lowerBound(deck.events, Math.min(bounds.end, segmentEnd - base) - 1e-10);
        const available = Math.max(0, endIndex - deck.cursor), count = Math.min(available, budget);
        for (let n = 0; n < count; n++) {
          const event = deck.events[deck.cursor++];
          const frame = Math.max(0, Math.min(frames - 1, Math.round((event.beat + base - start) / increment)));
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
            this.release(index, Math.max(0, Math.min(frames - 1, Math.round((bounds.length - start) / increment))));
            deck.ended = true;
          }
          break;
        }
      }
    }
    this.beat = end;
  }
}
