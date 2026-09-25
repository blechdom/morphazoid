import { rubixStickerVisibility, rubixVisibilityGain } from "./rubix-visibility.js";

export const RUBIX_FACE_ROLES = Object.freeze({
  up: "acid", down: "acid",
  front: "drumLeft", back: "drumLeft",
  right: "drumRight", left: "drumRight",
});

/**
 * A gate belongs to a physical sticker, not to its current screen lane.
 * All attacks (including hidden ones) share it, so orbiting also mixes tails and
 * notes already in the audio-clock lookahead. No graphics callback triggers notes.
 */
export class RubixStickerMixer {
  constructor(context) {
    this.context = context;
    this.gates = new Map();
    this.profile = {};
    this.amount = 1;
  }

  gainFor(id) {
    return rubixVisibilityGain(rubixStickerVisibility(this.profile, id), this.amount);
  }

  destination(id, bus) {
    let buses = this.gates.get(id);
    if (!buses) this.gates.set(id, buses = new Map());
    if (!buses.has(bus)) {
      const gate = this.context.createGain();
      gate.gain.value = this.gainFor(id);
      gate.connect(bus);
      buses.set(bus, gate);
    }
    return buses.get(bus);
  }

  update(profile, amount = 1) {
    this.profile = profile;
    this.amount = amount;
    const now = this.context.currentTime;
    for (const [id, buses] of this.gates) {
      const target = this.gainFor(id);
      for (const gate of buses.values()) {
        if (gate.rubixTarget === target) continue;
        gate.rubixTarget = target;
        const gain = gate.gain;
        if (gain.cancelAndHoldAtTime) gain.cancelAndHoldAtTime(now);
        else gain.cancelScheduledValues(now);
        gain.linearRampToValueAtTime(target, now + 0.012);
      }
    }
  }

  dispose() {
    for (const buses of this.gates.values()) {
      for (const gate of buses.values()) gate.disconnect();
    }
    this.gates.clear();
  }
}

/** Fixed output calibration. Quiet passages keep their dynamics; the safety
 * curve only softens peaks above -6 dB and remains bounded under dense chords. */
export function createRubixOutputStage(context, gain = 2.8, { peakCeiling = null } = {}) {
  // Fixed makeup restores working level after compression. This is not preset
  // state or an AGC: quiet/hidden geometry never receives adaptive boosting.
  const makeup = context.createGain();
  makeup.gain.value = gain;
  const safety = context.createWaveShaper();
  safety.oversample = "4x";
  safety.curve = Float32Array.from({ length: 4097 }, (_, i) => {
    const x = i / 2048 - 1;
    // Linear below -6 dB; asymptotically bounded above it.
    return Math.sign(x) * (Math.abs(x) <= 0.5
      ? Math.abs(x)
      : 0.5 + 0.3 * Math.tanh((Math.abs(x) - 0.5) / 0.3));
  });
  makeup.connect(safety);
  if (Number.isFinite(peakCeiling) && peakCeiling > 0 && peakCeiling < 1) {
    // Oversampling reconstruction can overshoot the bounded soft curve.
    // A unity-slope final guard catches those peaks without processing ordinary
    // levels again. This guard itself must not oversample and ring afterward.
    const ceiling = context.createWaveShaper();
    ceiling.oversample = "none";
    ceiling.curve = Float32Array.from({ length: 4097 }, (_, i) => (
      Math.max(-peakCeiling, Math.min(peakCeiling, i / 2048 - 1))
    ));
    safety.connect(ceiling);
    return { makeup, safety, output: ceiling };
  }
  return { makeup, output: safety };
}

/** A soft-knee mix compressor, followed by a fixed, bounded safety curve. */
export function createRubixDynamics(context) {
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -24;
  compressor.knee.value = 18;
  compressor.ratio.value = 5;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.18;
  const stage = createRubixOutputStage(context);
  compressor.connect(stage.makeup);
  return { compressor, ...stage };
}
