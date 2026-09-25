import { SequencerVoiceBank, SEQUENCER_VOICES } from "../../sequencer-voices.js";
import { jawJamResolvedMidi, jawJamStepIntervalSeconds, jawJamBreathRateBpm } from "./jaw-jam.js";
export const jawJamSharedVoice = (id) => SEQUENCER_VOICES.find((voice) => voice.id === id) ?? null;
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

/** A pluck owns the following hold cells, ending at the next pluck or rest. */
export function jawJamSharedDuration(pattern, index, absoluteStep = index) {
  let duration = jawJamStepIntervalSeconds(pattern, absoluteStep);
  for (let offset = 1; offset < pattern.stepCount; offset += 1) {
    if (pattern.steps[(index + offset) % pattern.stepCount].action !== "sustain") break;
    duration += jawJamStepIntervalSeconds(pattern, absoluteStep + offset);
  }
  return Math.min(16, duration);
}

export class JawJamSharedVoices {
  constructor(runtime = globalThis) {
    this.bank = new SequencerVoiceBank({ runtime, maxVoices: 8 });
    this.lastHandle = null;
    this.lastVelocity = .65;
  }
  prepare(context, destination) { return this.bank.prepare(context, destination); }
  schedule(pattern, index, absoluteStep, when, { preview = false } = {}) {
    const step = pattern.steps[index];
    const voice = jawJamSharedVoice(step.soundPresetId);
    if (step.action === "rest" || !voice) {
      if (this.lastHandle) this.bank.releaseVoice(this.lastHandle, Math.max(this.bank.context.currentTime, when - .008));
      this.lastHandle = null;
      return false;
    }
    const midi = preview ? step.midi : jawJamResolvedMidi(pattern, index);
    if (midi === null) return true; // A hold after a hard rest remains silent.
    const frequency = 440 * 2 ** ((midi - 69) / 12);
    const vowels = { a: [1500, .48], e: [2800, .7], i: [4200, .9], o: [950, .32], u: [560, .18] };
    const [cutoff, brightness] = vowels[step.vowelId] ?? vowels.a;
    const duration = preview ? .5 : jawJamSharedDuration(pattern, index, absoluteStep);
    let handle = this.lastHandle;
    const hold = !preview && step.action === "sustain" && handle && !handle.stopped && handle.voice === voice.id;
    if (!hold) {
      if (handle) this.bank.releaseVoice(handle, Math.max(this.bank.context.currentTime, when - .008));
      if (step.action === "pluck" || preview) this.lastVelocity = preview && step.action === "sustain" ? .72 : step.pluckIntensity;
      handle = this.bank.trigger({
        voice: voice.id, when, frequency, velocity: clamp(this.lastVelocity * (.72 + step.breathPower * .12), 0, 1),
        duration: Math.max(.015, duration - .012), release: .012,
        attack: hold ? .008 : .003, sustain: .72,
        brightness, cutoff, resonance: 1.5 + brightness * 4,
        drive: .7 + step.breathPower * .6, character: brightness,
      });
      this.lastHandle = handle;
    }
    if (handle) {
      const span = preview ? duration : jawJamStepIntervalSeconds(pattern, absoluteStep);
      const cycles = jawJamBreathRateBpm(pattern, step) / 60;
      handle.filter.frequency.cancelScheduledValues(when);
      for (let i = 0; i <= 12; i += 1) {
        const phase = i / 12;
        const modulation = 1 + Math.sin(phase * span * cycles * Math.PI * 2) * Math.min(.65, step.breathPower * .2);
        handle.filter.frequency.linearRampToValueAtTime(cutoff * modulation, when + phase * span);
      }
      handle.driveGain.gain.setTargetAtTime(.7 + step.breathPower * .6, when, .008);
    }
    return true;
  }
  stop() { this.bank.stop(); this.lastHandle = null; }
  cancelScheduled() {
    this.bank.cancelScheduled();
    this.lastHandle = [...this.bank.active].filter((handle) => !handle.stopped && handle.when <= this.bank.context.currentTime).at(-1) ?? null;
  }
  dispose() { this.bank.dispose(); this.lastHandle = null; }
}
