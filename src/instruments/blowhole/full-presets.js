import {
  BLOWHOLE_CALLS, BLOWHOLE_LIMITS, BLOWHOLE_PROPAGATION_PRESETS, blowholeCall, createBlowholeState, sanitizeBlowholeState,
} from "./blowhole.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

export const BLOWHOLE_PRESET_KEYS = Object.freeze([
  "callId", "pressure", "tension", "closure", "asymmetry", "recycle", "focus", "scale", "roughness",
  "pulseRateHz", "depthM", "propagationId", "propagationDistanceM", "propagationMix",
]);
const FIXED_ASYMMETRY = new Set([
  "bottlenose-signature-whistle", "dolphin-search-clicks", "dolphin-terminal-buzz", "orca-pulsed-call", "sperm-whale-coda",
]);

// Output level and the monitor bandwidth choice belong to the listener, not the scene.
export function captureBlowholePreset(state) {
  const clean = sanitizeBlowholeState(state);
  return Object.fromEntries(BLOWHOLE_PRESET_KEYS.map(key => [key, clean[key]]));
}

export function applyBlowholePresetState(snapshot, liveState) {
  return sanitizeBlowholeState({ ...snapshot, level: liveState.level, monitorMode: liveState.monitorMode });
}

export function validateBlowholePreset(snapshot) {
  presetStateKey(snapshot);
  if (!snapshot || presetStateKey(captureBlowholePreset(snapshot)) !== presetStateKey(snapshot)) {
    throw new TypeError("Invalid complete Blowhole preset");
  }
  return snapshot;
}

const scene = (id, label, callId, overrides = {}) => {
  const snapshot = captureBlowholePreset(createBlowholeState(callId, overrides));
  validateBlowholePreset(snapshot);
  return Object.freeze({ id, label, snapshot: Object.freeze(snapshot) });
};

export const BLOWHOLE_FULL_PRESETS = Object.freeze([
  scene("humpback-song", "Humpback · Open-ocean moan", "humpback-moan"),
  scene("humpback-deep-duet", "Humpback · Deep duet", "humpback-two-voice-phrase", { depthM: 180, propagationDistanceM: 220, tension: 0.4, asymmetry: 0.3 }),
  scene("blue-whale-basin", "Blue whale · Distant basin", "blue-whale-b-call", { propagationDistanceM: 480, propagationMix: 0.95, depthM: 400, scale: 0.98 }),
  scene("humpback-surface-wind", "Humpback · Windy surface", "humpback-moan", { propagationId: "air-windy", propagationDistanceM: 90, propagationMix: 0.8, depthM: 0, roughness: 0.3 }),
  scene("bottlenose-signature", "Bottlenose · Signature whistle", "bottlenose-signature-whistle"),
  scene("bottlenose-lagoon", "Bottlenose · Chopped lagoon whistle", "bottlenose-signature-whistle", { propagationId: "water-choppy", propagationDistanceM: 12, pressure: 0.78, focus: 0.9, scale: 0.3 }),
  scene("sonar-sweep", "Dolphin · Sonar sweep", "dolphin-search-clicks", { pulseRateHz: 22, propagationDistanceM: 120, propagationMix: 0.55 }),
  scene("slow-search", "Dolphin · Slow search", "dolphin-search-clicks", { pulseRateHz: 5, closure: 0.6, scale: 0.8, depthM: 60 }),
  scene("terminal-buzz", "Dolphin · Terminal buzz", "dolphin-terminal-buzz"),
  scene("orca-pod-call", "Orca · Pod call", "orca-pulsed-call", { propagationDistanceM: 150 }),
  scene("orca-rasp", "Orca · Rasping pulses", "orca-pulsed-call", { pulseRateHz: 1_400, roughness: 0.55, tension: 0.75, scale: 0.35 }),
  scene("sperm-coda", "Sperm whale · Coda", "sperm-whale-coda"),
  scene("sperm-abyss", "Sperm whale · Abyssal clicks", "sperm-whale-coda", { pulseRateHz: 2, depthM: 1_200, scale: 0.9, propagationDistanceM: 320, propagationMix: 0.9 }),
  scene("sperm-airborne", "Sperm whale · Open-air clicks", "sperm-whale-coda", { propagationId: "air-still", pulseRateHz: 9, scale: 0.4, propagationDistanceM: 30 }),
]);

export function randomizeBlowholePreset(current, random = Math.random) {
  validateBlowholePreset(current);
  const rng = presetRandom(random);
  const call = rng.pick(BLOWHOLE_CALLS);
  const [pulseMin, pulseMax] = call.physicalRange.pulseRateHz;
  const [distMin, distMax] = BLOWHOLE_LIMITS.propagationDistanceM;
  const defaults = createBlowholeState(call.id);
  const unit = rng.unit();
  const asymmetry = rng.between(-0.72, 0.72);
  return validateBlowholePreset(captureBlowholePreset({
    callId: call.id,
    pressure: rng.between(0.38, 0.98),
    tension: rng.between(0.16, 0.88),
    closure: rng.between(0.34, 0.97),
    asymmetry: FIXED_ASYMMETRY.has(call.id) ? defaults.asymmetry : asymmetry,
    recycle: rng.between(0.34, 0.99),
    focus: rng.between(0.28, 0.99),
    scale: rng.between(0.14, 0.94),
    roughness: rng.between(0.01, 0.58),
    pulseRateHz: pulseMax > 0 ? rng.between(pulseMin, pulseMax) : 0,
    depthM: rng.between(0, 1_500),
    propagationId: rng.pick(BLOWHOLE_PROPAGATION_PRESETS).id,
    propagationDistanceM: Math.exp(Math.log(distMin) + unit * Math.log(distMax / distMin)),
    propagationMix: rng.between(0.2, 1),
  }));
}
