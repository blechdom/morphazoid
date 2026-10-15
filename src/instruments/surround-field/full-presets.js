import { clamp, clampPosition } from "./surround-field.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

export const SURROUND_MOTIONS = Object.freeze(["manual", "orbit", "wander"]);
export const SURROUND_VOICES = Object.freeze(["halo", "glass", "pulse"]);
export const SURROUND_PRESET_KEYS = Object.freeze(["x", "y", "z", "focus", "motion", "orbitRate", "voice", "color", "release"]);

export function captureSurroundPreset(state) {
  const moving = state.motion !== "manual" && SURROUND_MOTIONS.includes(state.motion);
  const position = clampPosition(moving ? { x: 0, y: 0, z: state.position?.z } : state.position);
  return {
    x: position.x, y: position.y, z: position.z,
    focus: clamp(state.focus, 0, 1),
    motion: SURROUND_MOTIONS.includes(state.motion) ? state.motion : "manual",
    orbitRate: clamp(state.orbitRate, 0.03, 0.5),
    voice: SURROUND_VOICES.includes(state.voice) ? state.voice : "halo",
    color: clamp(state.color, 0, 1),
    release: clamp(state.release, 0.18, 2.4),
  };
}

export function validateSurroundPreset(snapshot) {
  const position = { x: snapshot?.x, y: snapshot?.y, z: snapshot?.z };
  if (!snapshot || Object.keys(snapshot).length !== SURROUND_PRESET_KEYS.length
    || presetStateKey(snapshot) !== presetStateKey(captureSurroundPreset({ ...snapshot, position }))) {
    throw new TypeError("Invalid complete Surround for Safety preset");
  }
  return snapshot;
}

const scene = (id, label, x, y, z, focus, motion, orbitRate, voice, color, release) => ({
  id, label, snapshot: { x, y, z, focus, motion, orbitRate, voice, color, release },
});
export const SURROUND_FULL_PRESETS = Object.freeze([
  scene("front-halo", "Front halo", 0.18, -0.1, 0, 0.58, "manual", 0.12, "halo", 0.62, 0.9),
  scene("slow-carousel", "Slow carousel", 0, 0, 0, 0.5, "orbit", 0.06, "halo", 0.5, 1.6),
  scene("glass-roundabout", "Glass roundabout", 0, 0, 0.2, 0.7, "orbit", 0.28, "glass", 0.85, 0.7),
  scene("pulse-whirl", "Pulse whirl", 0, 0, 0, 0.8, "orbit", 0.48, "pulse", 0.7, 0.3),
  scene("drifting-fog", "Drifting fog", 0, 0, 0.35, 0.35, "wander", 0.05, "halo", 0.3, 2.3),
  scene("wandering-glass", "Wandering glass", 0, 0, 0.5, 0.55, "wander", 0.2, "glass", 0.9, 1.1),
  scene("rear-corner-pulse", "Rear corner pulse", -0.6, 0.6, 0, 0.9, "manual", 0.12, "pulse", 0.55, 0.22),
  scene("overhead-bell", "Overhead bell", 0, 0, 1, 0.4, "manual", 0.1, "glass", 0.75, 2),
  scene("left-wall", "Left wall", -0.84, 0, 0.1, 0.95, "manual", 0.12, "pulse", 0.4, 0.45),
  scene("center-bloom", "Center bloom", 0, 0, 0.6, 0.15, "manual", 0.12, "halo", 0.68, 1.8),
  scene("dark-tide", "Dark tide", 0, 0, 0, 0.3, "orbit", 0.03, "halo", 0.08, 2.4),
  scene("tight-spotlight", "Tight spotlight", 0.4, -0.55, 0.15, 1, "manual", 0.12, "glass", 0.95, 0.35),
  scene("jittery-hornet", "Jittery hornet", 0, 0, 0.7, 0.85, "wander", 0.5, "pulse", 0.88, 0.18),
  scene("slow-lift", "Slow lift", 0, 0, 0.85, 0.25, "wander", 0.03, "halo", 0.45, 2.2),
].map(item => Object.freeze({ ...item, snapshot: Object.freeze(captureSurroundPreset({ ...item.snapshot, position: item.snapshot })) })));

const round = (value, digits = 2) => Number(value.toFixed(digits));

export function randomizeSurroundPreset(current, random = Math.random) {
  validateSurroundPreset(current);
  const rng = presetRandom(random);
  const motion = rng.pick(SURROUND_MOTIONS);
  const angle = rng.between(0, Math.PI * 2), radius = 0.86 * Math.sqrt(rng.unit());
  const position = motion === "manual"
    ? { x: round(Math.sin(angle) * radius, 3), y: round(-Math.cos(angle) * radius, 3) }
    : { x: 0, y: 0 };
  return validateSurroundPreset(captureSurroundPreset({
    motion, position: { ...position, z: round(rng.between(0, 1)) },
    focus: round(rng.between(0, 1)), orbitRate: round(rng.between(0.03, 0.5)),
    voice: rng.pick(SURROUND_VOICES), color: round(rng.between(0, 1)), release: round(rng.between(0.18, 2.4)),
  }));
}
