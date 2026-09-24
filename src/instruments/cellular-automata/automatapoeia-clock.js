// Web Audio owns event times. The timer only fills a bounded queue; animation
// frames consume its presentations and never advance the audible score.
export const AUTOMATA_LOOKAHEAD = 0.35;
export const AUTOMATA_CLOCK_POLL_MS = 12;
export const AUTOMATA_START_LEAD = 0.06;

export class AutomatapoeiaClock {
  constructor({ now, advance, present,
    setTimer = (callback, delay) => setTimeout(callback, delay),
    clearTimer = id => clearTimeout(id),
  }) {
    Object.assign(this, { now, advance, present, setTimer, clearTimer });
    this.running = false;
    this.timer = null;
    this.queue = [];
    this.current = null;
    this.nextTime = 0;
  }

  start({ delay = 0, initial = null } = {}) {
    this.stop();
    this.running = true;
    const start = this.now() + AUTOMATA_START_LEAD;
    this.nextTime = start + Math.max(0, delay);
    if (initial) {
      const event = initial(start);
      this.queue.push({ ...event, time: start });
      this.nextTime = start + event.interval;
    }
    this.pump();
  }

  pump() {
    if (!this.running) return;
    this.timer = null;
    const horizon = this.now() + AUTOMATA_LOOKAHEAD;
    // Bound catch-up after suspension/overload. Stale rows evolve the score but
    // never replay late attacks or rebase the tempo onto a delayed UI callback.
    let steps = 0;
    while (this.nextTime < horizon && steps++ < 64) {
      const time = this.nextTime;
      const audible = time >= this.now() + 0.004;
      const event = this.advance(time, audible);
      if (!Number.isFinite(event.interval) || event.interval <= 0) {
        this.stop();
        throw new RangeError("Automatapoeia requires a positive row interval");
      }
      this.queue.push({ ...event, time });
      this.nextTime += event.interval;
    }
    this.drain();
    this.timer = this.setTimer(() => this.pump(), AUTOMATA_CLOCK_POLL_MS);
  }

  revise(rewind) {
    if (!this.running) return;
    // Commit only rows already heard, then reuse the earliest unheard deadline.
    // Repeated edits before that boundary replace the same row, never add rows
    // or restart the clock. Existing current-row audio keeps playing.
    this.drain();
    const when = this.queue[0]?.time ?? this.nextTime;
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    this.queue = [];
    this.nextTime = when;
    rewind(when);
    this.pump();
  }

  drain() {
    const now = this.now();
    // Collapse obsolete visual frames, not musical events. Even a long hidden
    // tab never needs to paint every intervening generation on its return.
    while (this.queue.length && this.queue[0].time <= now) this.current = this.queue.shift();
    if (this.current) this.present(this.current.view, Math.max(0, now - this.current.time));
  }

  get headroom() { return this.running ? this.nextTime - this.now() : Infinity; }

  stop() {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    this.running = false;
    this.queue = [];
    this.current = null;
  }
}
