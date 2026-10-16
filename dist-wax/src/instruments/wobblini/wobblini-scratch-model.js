import { clamp } from "./wobblini-model.js";

export const SCRATCH_MAX_SPEED = 8;
export const SCRATCH_HOLD_SECONDS = 0.1;
const TAU = 0.004;

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
  constructor(sampleRate = 48000) {
    this.sampleRate = clamp(sampleRate, 8000, 192000, 48000);
    this.smoothing = 1 - Math.exp(-1 / (this.sampleRate * TAU));
    this.lanes = Array(8).fill(null); this.time = 0;
  }
  begin(message) {
    const { index, generation, channels, sampleRate, duration, position, loopEnabled, loopStart, loopEnd } = message;
    if (!Number.isInteger(index) || index < 0 || index > 7 || !Array.isArray(channels) || channels.length < 1 || channels.length > 2 ||
        !channels.every(channel => channel instanceof Float32Array && channel.length > 0 && channel.length <= 16777216) ||
        !Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000 || !Number.isFinite(duration) || duration <= 0 ||
        !Number.isFinite(position)) return false;
    this.lanes[index] = { generation, channels, sampleRate, duration, loopEnabled: Boolean(loopEnabled),
      loopStart: clamp(loopStart, 0, duration), loopEnd: clamp(loopEnd, 0, duration, duration),
      position, target: position, velocity: 0, desiredVelocity: 0, gain: 0,
      lastMove: this.time, lastHandTime: this.time, releasing: false };
    return true;
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
  _sample(lane, channel) {
    const data = lane.channels[channel] ?? lane.channels[0];
    const seconds = scratchPosition(lane.position, lane), offset = seconds * lane.sampleRate;
    const index = Math.min(data.length - 1, Math.floor(offset)), fraction = offset - Math.floor(offset);
    const nextSeconds = scratchPosition((index + 1) / lane.sampleRate, lane);
    const next = Math.min(data.length - 1, Math.floor(nextSeconds * lane.sampleRate + 1e-8));
    const value = data[index] * (1 - fraction) + data[next] * fraction;
    return Number.isFinite(value) ? clamp(value, -1, 1) : 0;
  }
  process(outputs, frames = outputs[0]?.[0]?.length ?? 128) {
    for (const output of outputs) for (const channel of output) channel.fill(0);
    for (let frame = 0; frame < frames; frame++) {
      for (let index = 0; index < this.lanes.length; index++) {
        const lane = this.lanes[index]; if (!lane) continue;
        const stale = this.time - lane.lastMove > SCRATCH_HOLD_SECONDS;
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
          if (lane.releasing) this.lanes[index] = null;
          else if (stale) lane.position = lane.target;
        }
      }
      this.time += 1 / this.sampleRate;
    }
  }
}
