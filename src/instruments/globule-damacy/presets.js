/** Focused musical starting points; never include the ball, sources, output,
 * Audio permission, position, or the running transport. */
export const RECORD_PRESETS = Object.freeze([
  Object.freeze({ id: "chrome-confetti", label: "Chrome confetti",
    grainMs: 100, grainMode: "fixed", grainSpreadMs: 60 }),
  Object.freeze({ id: "vhs-glitter", label: "VHS glitter",
    grainMs: 60, grainMode: "fixed", grainSpreadMs: 60 }),
  Object.freeze({ id: "afterparty", label: "Afterparty",
    grainMs: 150, grainMode: "random", grainSpreadMs: 90 }),
  Object.freeze({ id: "slow-sparkle", label: "Slow sparkle",
    grainMs: 220, grainMode: "random", grainSpreadMs: 30 }),
]);

export const PLAY_PRESETS = Object.freeze([
  Object.freeze({ id: "mirrorball", label: "Mirrorball",
    speed: 1, direction: 1, scatter: .68, needleWidth: 30, needle: 3.5,
    layerTransparency: 40 }),
  Object.freeze({ id: "backspin", label: "Backspin",
    speed: .77, direction: -1, scatter: .35, needleWidth: 30, needle: 2,
    layerTransparency: 65 }),
  Object.freeze({ id: "shattered-neon", label: "Shattered neon",
    speed: 1.6, direction: 1, scatter: .96, needleWidth: 85, needle: 5.6,
    layerTransparency: 20 }),
  Object.freeze({ id: "slow-burn", label: "Slow burn",
    speed: .6, direction: 1, scatter: .18, needleWidth: 10, needle: 3.5,
    layerTransparency: 80 }),
]);

export const matchingPreset = (presets, state) => presets.find(preset =>
  Object.entries(preset).every(([key, value]) =>
    key === "id" || key === "label" || state[key] === value))?.id ?? "custom";
