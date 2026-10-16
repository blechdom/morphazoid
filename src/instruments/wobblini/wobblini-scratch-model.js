import { clamp } from "./wobblini-model.js";

export const SCRATCH_MAX_SPEED = 8;
export const SCRATCH_HOLD_SECONDS = 0.1;
const TAU = 0.004;
export const SCRATCH_WINDOW_SECONDS = 2;
// More than the maximum 0.8 source seconds traversed before the held-hand
// timeout, plus one render quantum at the minimum supported output rate.
const WINDOW_MARGIN = 1.1;

/** Copy at most two seconds of original PCM, plus interpolation guard samples.
 * Segments retain source-frame coordinates, so fractional beat-loop boundaries
 * use exactly the same interpolation as a complete source buffer. */
export function createScratchWindow(buffer, bounds, position) {
  const rate = buffer.sampleRate, radius = SCRATCH_WINDOW_SECONDS / 2;
  const start = bounds.loopEnabled ? bounds.loopStart : 0;
  const end = bounds.loopEnabled ? bounds.loopEnd : bounds.duration;
  const center = scratchPosition(position, bounds), complete = end - start <= SCRATCH_WINDOW_SECONDS;
  let ranges;
  if (complete) ranges = [[start, end]];
  else if (!bounds.loopEnabled) ranges = [[Math.max(start, center - radius), Math.min(end, center + radius)]];
  else if (center - radius < start) ranges = [[start, center + radius], [end - (start - center + radius), end]];
  else if (center + radius > end) ranges = [[center - radius, end], [start, start + center + radius - end]];
  else ranges = [[center - radius, center + radius]];
  const chunks = ranges.map(([from, to]) => {
    const startFrame = Math.max(0, Math.floor(from * rate));
    const endFrame = Math.min(buffer.length, Math.ceil(to * rate) + 2);
    return { startFrame, channels: Array.from({ length: buffer.numberOfChannels }, (_, channel) => {
      const samples = new Float32Array(endFrame - startFrame);
      // copyFromChannel does not materialize a full getChannelData view after
      // a native source has acquired the AudioBuffer's channel contents.
      if (buffer.copyFromChannel) buffer.copyFromChannel(samples, channel, startFrame);
      else samples.set(buffer.getChannelData(channel).subarray(startFrame, endFrame));
      return samples;
    }) };
  });
  return { position, radius, complete, chunks };
}

function validWindow(window, sampleRate) {
  return window && Number.isFinite(window.position) && Number.isFinite(window.radius) && window.radius > 0 &&
    Array.isArray(window.chunks) && window.chunks.length > 0 && window.chunks.length <= 2 &&
    window.chunks.every(chunk => Number.isInteger(chunk.startFrame) && chunk.startFrame >= 0 &&
      Array.isArray(chunk.channels) && chunk.channels.length >= 1 && chunk.channels.length <= 2 &&
      chunk.channels.every(channel => channel instanceof Float32Array && channel.length > 0 &&
        channel.length <= Math.ceil(sampleRate * SCRATCH_WINDOW_SECONDS) + 4)) &&
    window.chunks.reduce((total, chunk) => total + chunk.channels[0].length, 0) <= Math.ceil(sampleRate * SCRATCH_WINDOW_SECONDS) + 8;
}

export function scratchPosition(position, { duration, loopEnabled, loopStart, loopEnd }) {
  if (loopEnabled && loopEnd > loopStart) {
    const length = loopEnd - loopStart;
    return loopStart + (((position - loopStart) % length) + length) % length;
  }
  return clamp(position, 0, duration);
}

/** Native-rate PCM traversal, including negative velocity. No seek grains or
 * source restarts: every output sample interpolates adjacent source samples.
 * A bounded velocity servo follows the hand, settles at its target, and fades
 * to silence when held. Audio-clock timeout covers lost pointer updates.
 */
export class WobbliniScratchSampler {
  constructor(sampleRate = 48000, requestWindow = () => {}) {
    this.sampleRate = clamp(sampleRate, 8000, 192000, 48000);
    this.smoothing = 1 - Math.exp(-1 / (this.sampleRate * TAU));
    this.lanes = Array(8).fill(null); this.time = 0; this.requestWindow = requestWindow;
  }
  begin(message) {
    const { index, generation, channels, window, sampleRate, duration, position, loopEnabled, loopStart, loopEnd } = message;
    if (!Number.isInteger(index) || index < 0 || index > 7 || !(validWindow(window, sampleRate) || Array.isArray(channels) && channels.length >= 1 && channels.length <= 2 &&
          channels.every(channel => channel instanceof Float32Array && channel.length > 0 && channel.length <= 16777216)) ||
        !Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000 || !Number.isFinite(duration) || duration <= 0 ||
        !Number.isFinite(position)) return false;
    this.lanes[index] = { generation, channels, windows: window ? [window] : [], pendingWindow: false, sampleRate, duration, loopEnabled: Boolean(loopEnabled),
      loopStart: clamp(loopStart, 0, duration), loopEnd: clamp(loopEnd, 0, duration, duration),
      position, target: position, velocity: 0, desiredVelocity: 0, gain: 0,
      lastMove: this.time, lastHandTime: this.time, releasing: false };
    return true;
  }
  window({ index, generation, window }) {
    const lane = this.lanes[index];
    if (!lane || lane.generation !== generation || lane.releasing || !validWindow(window, lane.sampleRate)) return;
    lane.windows.unshift(window); lane.windows.length = Math.min(2, lane.windows.length); lane.pendingWindow = false;
  }
  _requestWindow(index, lane) {
    if (lane.channels || lane.pendingWindow || lane.releasing) return;
    const window = lane.windows[0];
    if (window?.complete) return;
    const remaining = lane.target - lane.position;
    if (Math.abs(remaining) < 1e-8 && Math.abs(lane.velocity) < 0.002 &&
        Math.abs(lane.position - window.position) <= window.radius) return;
    const direction = Math.sign(remaining) || Math.sign(lane.velocity) || 1;
    if (!lane.loopEnabled && (direction > 0 && window.position + window.radius >= lane.duration ||
        direction < 0 && window.position - window.radius <= 0)) return;
    const ahead = window ? window.radius + direction * (window.position - lane.position) : 0;
    if (ahead > WINDOW_MARGIN && Math.abs(lane.position - window.position) < window.radius) return;
    lane.pendingWindow = true;
    let position = lane.position + direction * 0.6;
    if (!lane.loopEnabled) position = clamp(position, 0, lane.duration);
    this.requestWindow({ type: "window-request", index, generation: lane.generation, position });
  }
  move({ index, generation, position }) {
    const lane = this.lanes[index];
    if (!lane || lane.generation !== generation || lane.releasing || !Number.isFinite(position)) return;
    if (!lane.loopEnabled) position = clamp(position, 0, lane.duration);
    const interval = clamp(this.time - lane.lastHandTime, 0.008, 0.04, 0.016);
    lane.target = position; lane.lastHandTime = this.time; lane.lastMove = this.time;
    lane.desiredVelocity = clamp((lane.target - lane.position) / interval, -SCRATCH_MAX_SPEED, SCRATCH_MAX_SPEED);
  }
  end({ index, generation }) {
    const lane = this.lanes[index];
    if (!lane || lane.generation !== generation) return;
    lane.releasing = true; lane.desiredVelocity = 0;
  }
  release() { for (const lane of this.lanes) if (lane) { lane.releasing = true; lane.desiredVelocity = 0; } }
  clear() { this.lanes.fill(null); }
  _value(lane, channel, frame) {
    if (lane.channels) return (lane.channels[channel] ?? lane.channels[0])[frame];
    for (const window of lane.windows) for (const chunk of window.chunks) {
      const data = chunk.channels[channel] ?? chunk.channels[0], offset = frame - chunk.startFrame;
      if (offset >= 0 && offset < data.length) return data[offset];
    }
    return 0;
  }
  _sample(lane, channel) {
    const length = Math.round(lane.duration * lane.sampleRate);
    const seconds = scratchPosition(lane.position, lane), offset = seconds * lane.sampleRate;
    const index = Math.min(length - 1, Math.floor(offset)), fraction = offset - Math.floor(offset);
    const nextSeconds = scratchPosition((index + 1) / lane.sampleRate, lane);
    const next = Math.min(length - 1, Math.floor(nextSeconds * lane.sampleRate + 1e-8));
    const value = this._value(lane, channel, index) * (1 - fraction) + this._value(lane, channel, next) * fraction;
    return Number.isFinite(value) ? clamp(value, -1, 1) : 0;
  }
  process(outputs, frames = outputs[0]?.[0]?.length ?? 128) {
    for (const output of outputs) for (const channel of output) channel.fill(0);
    for (let index = 0; index < this.lanes.length; index++) {
      const lane = this.lanes[index]; if (!lane) continue;
      for (let frame = 0; frame < frames; frame++) {
        const stale = this.time + frame / this.sampleRate - lane.lastMove > SCRATCH_HOLD_SECONDS;
        const moving = !lane.releasing && !stale && Math.abs(lane.target - lane.position) > 1e-8;
        lane.velocity += ((moving ? lane.desiredVelocity : 0) - lane.velocity) * this.smoothing;
        const remaining = lane.target - lane.position, step = lane.velocity / this.sampleRate;
        if (moving && Math.sign(step) === Math.sign(remaining)) {
          lane.position += Math.abs(step) >= Math.abs(remaining) ? remaining : step;
        }
        const audible = moving && Math.abs(lane.velocity) > 0.002 && Math.sign(lane.velocity) === Math.sign(remaining);
        lane.gain += ((audible ? 1 : 0) - lane.gain) * this.smoothing;
        const output = outputs[index];
        if (output && lane.gain > 1e-6) for (let channel = 0; channel < output.length; channel++) {
          output[channel][frame] = this._sample(lane, channel) * lane.gain;
        }
        if (!audible && lane.gain < 1e-6) {
          lane.gain = 0; lane.velocity = 0;
          if (lane.releasing) { this.lanes[index] = null; break; }
          else if (stale) lane.position = lane.target;
        }
      }
      this._requestWindow(index, lane);
    }
    this.time += frames / this.sampleRate;
  }
}
