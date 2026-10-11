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

export class DeckTransport {
  constructor() {
    this.state = { position: 0, duration: 0, time: 0, playing: false, rate: 1, loop: null };
  }

  snapshot(time) {
    const state = this.state;
    const position = transportPosition(state, time);
    return {
      position, duration: state.duration,
      playing: state.playing && Boolean(state.duration) && (Boolean(state.loop) || position < state.duration),
      rate: state.rate, loop: state.loop ? { ...state.loop } : null,
    };
  }

  rebase(fromTime, toTime) {
    this.state = { ...this.snapshot(fromTime), time: toTime };
  }

  load(duration, time) {
    this.state = { ...this.state, duration: clamp(duration, 0, 24 * 60 * 60), position: 0, playing: false, loop: null, time };
  }

  change(time, changes) {
    this.state = { ...this.snapshot(time), time, ...changes };
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
