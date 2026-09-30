import { connectAudioOutput } from '../../audio-output-manager.js';
import { calibratedOutputGain } from '../../families/tract/throatazoid.js';

// Fixed output calibration, not scene volume. Measured on the same spoken text
// through all five real browser engines; the performer still owns master level.
export const SPELLING_VOICE_TRIMS = Object.freeze({
  tube: 1.7,
  diphone: 1.55,
  vocoder: 2.6,
  bell: 4.8,
  lpc: 2.25,
});
// Breathy/high-register bodies can differ much more than the engine averages.
// These fixed trims retain articulation dynamics; no AGC or preset volume.
export const SPELLING_PERSONALITY_TRIMS = Object.freeze({
  tube: Object.freeze({ clear: 1, warm: .8, whisper: .35, reed: 1.12, creature: 1.9 }),
  vocoder: Object.freeze({ clear: 1, warm: 1.12, whisper: 1.06, reed: 1.16, creature: 1.13 }),
  bell: Object.freeze({ clear: 1, warm: 1.15, whisper: .76, reed: 1, creature: 1.3 }),
  lpc: Object.freeze({ clear: 1.13, warm: 1.18, whisper: 1, reed: 1.02, creature: 1.27 }),
});
// Reserve headroom for the oversampling filter's inter-sample reconstruction.
export const SPELLING_OUTPUT_CEILING = 0.88;
const SOFT_CEILING = 0.8;
const KNEE = 0.58;
const HEADROOM = 8;
let protectionCurve;
let guardCurve;

export function spellingOutputGain(engine, level, balanced = false, personality = 'clear') {
  const finite = Number.isFinite(Number(level)) ? Number(level) : 0;
  const value = Math.min(0.82, Math.max(0, finite));
  const retro = engine === 'bell' || engine === 'lpc';
  if (!balanced) return retro ? value : calibratedOutputGain(value);
  // Match the existing master taper on the sample/tract voices, including the
  // new engines: equal knob changes should not undo the cross-engine balance.
  const base = retro ? Math.sqrt(value / 0.82) * 0.82 : calibratedOutputGain(value);
  return base * (SPELLING_VOICE_TRIMS[engine] ?? 1)
    * (SPELLING_PERSONALITY_TRIMS[engine]?.[personality] ?? 1);
}

export function protectSpellingSample(value) {
  if (!Number.isFinite(value)) return 0;
  const magnitude = Math.abs(value);
  if (magnitude <= KNEE) return value;
  const range = SOFT_CEILING - KNEE;
  return Math.sign(value) * (KNEE + range * Math.tanh((magnitude - KNEE) / range));
}

export function guardSpellingSample(value) {
  if (!Number.isFinite(value)) return 0;
  if (Math.abs(value) <= SOFT_CEILING) return value;
  const range = SPELLING_OUTPUT_CEILING - SOFT_CEILING;
  return Math.sign(value) * (SOFT_CEILING + range * Math.tanh((Math.abs(value) - SOFT_CEILING) / range));
}

export function connectSpellingOutput(context, master, { runtime, balanced = false } = {}) {
  // Pink Trombonazoid also uses this engine class. Its existing sound/output
  // path is deliberately unchanged; only Spelling opts into this calibration.
  if (!balanced) return { node: master, release: connectAudioOutput(context, master, { runtime }) };
  if (!protectionCurve) {
    protectionCurve = Float32Array.from({ length: 8193 }, (_, index) => (
      protectSpellingSample((index / 8192 * 2 - 1) * HEADROOM)
    ));
  }
  if (!guardCurve) {
    guardCurve = Float32Array.from({ length: 8193 }, (_, index) => guardSpellingSample(index / 8192 * 2 - 1));
  }
  const headroom = context.createGain();
  headroom.gain.value = 1 / HEADROOM;
  const protection = context.createWaveShaper();
  protection.curve = protectionCurve;
  protection.oversample = '2x';
  // Oversampling filters can ring past a shaper's curve ceiling on plosives.
  // Guard the reconstructed samples too; keep normal output entirely linear.
  const guard = context.createWaveShaper();
  guard.curve = guardCurve;
  guard.oversample = 'none';
  master.connect(headroom);
  headroom.connect(protection);
  protection.connect(guard);
  const releaseOutput = connectAudioOutput(context, guard, { runtime });
  let released = false;
  return {
    node: guard,
    release() {
      if (released) return;
      released = true;
      releaseOutput();
      master.disconnect(headroom);
      headroom.disconnect();
      protection.disconnect();
      guard.disconnect();
    },
  };
}
