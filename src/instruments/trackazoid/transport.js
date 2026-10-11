/** Pure, seconds-based transport; audio rendering never depends on animation frames. */
export const MIN_RATE = 0.84;
export const MAX_RATE = 1.16;

export function clamp(value, low, high, fallback = low) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(low, Math.min(high, number)) : fallback;
}

export function normalizeLoop(start, end, duration) {
  const from = clamp(start, 0, duration);
  const to = clamp(end, 0, duration);
  return to - from >= 0.05 ? { start: from, end: to } : null;
}

export function transportPosition(state, time) {
  let position = state.position;
  if (state.playing) position += Math.max(0, time - state.time) * state.rate;
  if (state.loop && position >= state.loop.end) {
    const length = state.loop.end - state.loop.start;
    position = state.loop.start + ((position - state.loop.start) % length + length) % length;
  }
  return clamp(position, 0, state.duration);
}

export function beatPhase(position, grid) {
  if (!grid?.bpm) return null;
  const beats = (position - grid.beatOffset) * grid.bpm / 60;
  return ((beats % 1) + 1) % 1;
}

export function phaseDifference(position, grid, referencePosition, referenceGrid) {
  const phase = beatPhase(position, grid), reference = beatPhase(referencePosition, referenceGrid);
  return phase === null || reference === null ? null : ((phase - reference + 1.5) % 1) - 0.5;
}

/** Find the nearest matching beat phase inside the playable region. */
export function alignedPosition(position, grid, phase, duration, loop = null) {
  if (!grid?.bpm || phase === null) return position;
  const beat = 60 / grid.bpm;
  const low = loop?.start ?? 0, high = Math.min(duration, loop?.end ?? duration) - 1e-7;
  const first = Math.ceil((low - grid.beatOffset) / beat - phase - 1e-8);
  const last = Math.floor((high - grid.beatOffset) / beat - phase + 1e-8);
  if (first > last) return clamp(position, low, Math.max(low, high));
  const index = clamp(Math.round((position - grid.beatOffset) / beat - phase), first, last);
  return clamp(grid.beatOffset + (index + phase) * beat, low, high);
}

export function matchingRate(bpm, masterBpm, masterRate) {
  if (!bpm || !masterBpm) return null;
  const rate = masterBpm * masterRate / bpm;
  return Number.isFinite(rate) && rate >= MIN_RATE - 1e-9 && rate <= MAX_RATE + 1e-9
    ? clamp(rate, MIN_RATE, MAX_RATE) : null;
}

export class DeckTransport {
  constructor() {
    this.state = { position: 0, duration: 0, time: 0, playing: false, rate: 1, loop: null };
    this.pending = null;
    this.pendingChanges = null;
  }

  snapshot(time) {
    const state = this.pending && time >= this.pending.time ? this.pending : this.state;
    const position = transportPosition(state, time);
    return {
      position, duration: state.duration,
      playing: state.playing && Boolean(state.duration) && (Boolean(state.loop) || position < state.duration),
      rate: state.rate, loop: state.loop ? { ...state.loop } : null,
    };
  }

  rebase(fromTime, toTime) {
    this.advance(fromTime);
    const current = this.snapshot(fromTime);
    if (this.pending) this.pending.time += toTime - fromTime;
    this.state = { ...current, time: toTime };
  }

  advance(time) {
    if (this.pending && time >= this.pending.time) {
      this.state = this.pending; this.pending = null; this.pendingChanges = null;
    }
  }

  intent(time) {
    const state = this.snapshot(time);
    if (!this.pending || this.pending.time <= time) return { ...state, pending: false };
    return { ...state, playing: this.pending.playing, rate: this.pending.rate,
      loop: this.pending.loop ? { ...this.pending.loop } : null, pending: true };
  }

  /** One replaceable future transition; slider traffic cannot grow a queue. */
  schedule(time, changes, now = time) {
    this.advance(now);
    const combined = { ...this.pendingChanges, ...changes };
    this.pending = null;
    const next = { ...this.snapshot(time), time, ...combined };
    if (time <= now) { this.state = next; this.pendingChanges = null; }
    else { this.pending = next; this.pendingChanges = combined; }
    return this.intent(now);
  }

  load(duration, time) {
    this.pending = null; this.pendingChanges = null;
    this.state = { ...this.state, duration: clamp(duration, 0, 24 * 60 * 60), position: 0, playing: false, loop: null, time };
  }

  change(time, changes) {
    this.schedule(time, changes);
    return this.snapshot(time);
  }

  play(time) {
    const state = this.snapshot(time);
    if (!state.duration || state.playing) return state;
    return this.change(time, { playing: true, position: state.position >= state.duration ? 0 : state.position });
  }

  pause(time) { return this.change(time, { playing: false }); }
  seek(position, time) { return this.change(time, { position: clamp(position, 0, this.state.duration) }); }
  setRate(rate, time) { return this.change(time, { rate: clamp(rate, MIN_RATE, MAX_RATE, 1) }); }
  setLoop(start, end, time) {
    const loop = normalizeLoop(start, end, this.state.duration);
    const position = this.snapshot(time).position;
    return this.change(time, { loop, position: loop && position >= loop.end ? loop.start : position });
  }
  clearLoop(time) { return this.change(time, { loop: null }); }
}

/** Equal-power crossfade; endpoints silence the opposite deck exactly. */
export function crossfadeGains(value) {
  const mix = (clamp(value, -1, 1, 0) + 1) / 2;
  return [mix === 1 ? 0 : Math.cos(mix * Math.PI / 2), mix === 0 ? 0 : Math.sin(mix * Math.PI / 2)];
}
