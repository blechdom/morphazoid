import { VoicePool } from "../../audio.js";

// Opt-in only: unrelated instruments retain their existing pool policy.
// Runtime learning never mutates a preset's requested musical voice ceiling.
export function createGeometryVoicePool(size = 32) {
  return new VoicePool(size, {
    adaptive: true,
    maxVoices: size,
    minVoices: 2,
    voiceQuantum: 1,
    initialModeVoices: { shepard: 8 },
    smoothVoiceStealing: true,
    robustCoarseTelemetry: true,
    continuousPeakCeiling: 0.78,
  });
}
