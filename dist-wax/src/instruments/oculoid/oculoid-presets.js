import { clampEye, normalizeOculoid, OCULOID_DEFAULTS, OCULOID_EYEBALL_STYLES,
  OCULOID_EYELID_STYLES } from "./oculoid-model.js";

const scenes = [
  ["Still witness", { ...OCULOID_DEFAULTS }],
  ["Long stare", { gazeY: 0.38, blink: 0, pupil: 0.31, motion: 0.12, eyeballStyle: "drowse", eyelidStyle: "drowse", rootHz: 86, tone: 0.24, air: 0.05, wetness: 0.86, veins: 0.14 }],
  ["Corner watch", { gazeX: -0.8, gazeY: 0.26, pupil: 0.66, tempo: 74, motion: 0.16, rootHz: 146, tone: 0.56, irisTint: 0.18 }],
  ["Downcast", { gazeX: 0.17, gazeY: -0.8, blink: 0.41, pupil: 0.2, motion: 0.3, eyeballStyle: "drowse", eyelidStyle: "drowse", rootHz: 68, tone: 0.14, air: 0.14, veins: 0.12 }],
  ["Dry flutter", { blink: 0.14, pupil: 0.58, tempo: 160, motion: 1, eyeballStyle: "flutter", eyelidStyle: "flutter", rootHz: 174, tone: 0.76, air: 0.81, wetness: 0.11, veins: 0.46 }],
  ["Wet glass", { gazeX: 0.34, gazeY: -0.3, lowerLid: 0.26, pupil: 0.67, tempo: 56, motion: 0.28, rootHz: 98, tone: 0.3, wetness: 1, veins: 0.16, irisTint: 0.82 }],
  ["Saccade lattice", { gazeX: 0.19, gazeY: 0.19, blink: 0.03, pupil: 0.36, tempo: 192, motion: 0.96, eyeballStyle: "wild", eyelidStyle: "wild", rootHz: 260, tone: 0.84, air: 0.43 }],
  ["Night pupil", { gazeX: -0.1, gazeY: -0.13, pupil: 1, tempo: 48, motion: 0.22, rootHz: 58, tone: 0.08, air: 0.12, wetness: 0.79, irisTint: 0.1 }],
  ["Vein chorus", { blink: 0.09, pupil: 0.39, tempo: 118, motion: 0.65, eyeballStyle: "flutter", eyelidStyle: "flutter", rootHz: 122, tone: 0.48, air: 0.65, veins: 1, irisTint: 0.69 }],
  ["Half asleep", { gazeX: 0.48, gazeY: -0.43, blink: 0.63, lowerLid: -0.3, pupil: 0.16, tempo: 61, motion: 0.38, eyeballStyle: "drowse", eyelidStyle: "drowse", rootHz: 78, tone: 0.2, air: 0.07 }],
  ["Amber arc", { gazeX: 0.7, gazeY: 0.08, pupil: 0.52, tempo: 103, motion: 0.72, rootHz: 212, tone: 0.65, irisTint: 0, wetness: 0.7 }],
  ["Iris fever", { gazeX: -0.52, gazeY: 0.4, blink: 0.05, pupil: 0.76, tempo: 143, motion: 0.85, eyeballStyle: "wild", eyelidStyle: "wild", rootHz: 294, tone: 0.93, air: 0.66, wetness: 0.36, veins: 0.83, irisTint: 1 }],

  // Only the pupil changes: neither lid nor the forward gaze follows it.
  ["Pupil pendulum", { pupil: 0.5, tempo: 90, motion: 1, eyeballStyle: "pupil", eyelidStyle: "still", rootHz: 134, tone: 0.55, air: 0.15, wetness: 0.35 }],
  ["Needle to saucer", { pupil: 0.48, blink: -0.16, lowerLid: 0.12, tempo: 138, motion: 0.97, eyeballStyle: "pupil", eyelidStyle: "still", rootHz: 246, tone: 0.81, air: 0.4, irisTint: 0.86 }],
  ["Low-light dilation", { pupil: 0.54, blink: 0.22, tempo: 47, motion: 0.82, eyeballStyle: "pupil", eyelidStyle: "still", rootHz: 73, tone: 0.25, air: 0.12, wetness: 0.89, irisTint: 0.23 }],
  ["Quick constrict", { pupil: 0.39, lowerLid: 0.26, tempo: 190, motion: 0.73, eyeballStyle: "pupil", eyelidStyle: "still", rootHz: 310, tone: 0.92, air: 0.58, veins: 0.72 }],
  ["Micro pupil breath", { pupil: 0.1, blink: -0.2, tempo: 86, motion: 0.18, eyeballStyle: "pupil", eyelidStyle: "still", rootHz: 98, tone: 0.34, air: 0.27, wetness: 0.28 }],
  ["Pinpoint pulse", { pupil: 0.07, blink: 0.08, tempo: 161, motion: 0.12, eyeballStyle: "pupil", eyelidStyle: "still", rootHz: 284, tone: 0.76, air: 0.49, irisTint: 0.74 }],
  ["Afterimage aperture", { pupil: 0.25, blink: -0.35, lowerLid: 0.2, tempo: 112, motion: 0.49, eyeballStyle: "pupil", eyelidStyle: "still", rootHz: 168, tone: 0.64, wetness: 0.67, veins: 0.19 }],
  ["Glass diaphragm", { pupil: 0.55, blink: 0.15, lowerLid: -0.08, tempo: 59, motion: 0.92, eyeballStyle: "pupil", eyelidStyle: "still", rootHz: 228, tone: 0.31, wetness: 1, irisTint: 0.97 }],

  // Smaller resting pupils; these scenes also explore other eye movements.
  ["Pinlight stare", { pupil: 0, blink: -0.32, motion: 0.2, eyeballStyle: "drift", eyelidStyle: "blink", rootHz: 116, tone: 0.81, air: 0.04, wetness: 0.08, irisTint: 0.82 }],
  ["Needle watch", { pupil: 0.02, gazeX: -0.63, gazeY: 0.16, tempo: 123, motion: 0.4, eyeballStyle: "drift", eyelidStyle: "blink", rootHz: 166, tone: 0.66, veins: 0.61 }],
  ["Focused amber", { pupil: 0.04, gazeX: 0.38, gazeY: 0.31, blink: -0.2, tempo: 76, motion: 0.28, rootHz: 222, tone: 0.87, air: 0.22, irisTint: 0 }],
  ["Small nocturne", { pupil: 0.06, gazeY: -0.46, blink: 0.4, lowerLid: -0.12, tempo: 55, motion: 0.37, eyeballStyle: "drowse", eyelidStyle: "drowse", rootHz: 62, tone: 0.18, air: 0.06, wetness: 0.87 }],
  ["Narrow glance", { pupil: 0.07, gazeX: 0.66, blink: 0.17, tempo: 174, motion: 0.65, eyeballStyle: "wild", eyelidStyle: "wild", rootHz: 270, tone: 0.74, air: 0.37 }],
  ["Twitch in the dark", { pupil: 0.08, gazeX: -0.34, lowerLid: -0.26, tempo: 147, motion: 0.42, eyeballStyle: "flutter", eyelidStyle: "flutter", rootHz: 194, tone: 0.57, veins: 0.84 }],
  ["Storm slit", { pupil: 0.11, gazeX: 0.25, gazeY: -0.15, blink: 0.29, tempo: 189, motion: 0.71, eyeballStyle: "wild", eyelidStyle: "wild", rootHz: 315, tone: 0.92, air: 0.8, veins: 1 }],
  ["Tear bright", { pupil: 0.13, gazeX: -0.22, blink: -0.24, lowerLid: 0.24, tempo: 67, motion: 0.31, rootHz: 182, tone: 0.48, wetness: 1, irisTint: 0.94 }],

  // Gaze stays dead center and the pupil holds still; only the lids flutter.
  ["Straight-ahead flutter", { pupil: 0.12, blink: 0, tempo: 154, motion: 1, eyeballStyle: "still", eyelidStyle: "lid-flutter", rootHz: 192, tone: 0.71, air: 0.4 }],
  ["Tiny tremble", { pupil: 0.05, blink: 0.16, tempo: 182, motion: 0.84, eyeballStyle: "still", eyelidStyle: "lid-flutter", rootHz: 278, tone: 0.83, air: 0.62, wetness: 0.12 }],
  ["Waiting blink", { pupil: 0.08, blink: -0.21, lowerLid: 0.15, tempo: 65, motion: 0.62, eyeballStyle: "still", eyelidStyle: "lid-flutter", rootHz: 83, tone: 0.23, air: 0.07, wetness: 0.8 }],
  ["Rapid lid brush", { pupil: 0.1, blink: 0.18, lowerLid: -0.18, tempo: 194, motion: 0.95, eyeballStyle: "still", eyelidStyle: "lid-flutter", rootHz: 316, tone: 0.96, veins: 0.7 }],
  ["Soft double lid", { pupil: 0.21, blink: 0.32, lowerLid: 0.18, tempo: 100, motion: 0.67, eyeballStyle: "still", eyelidStyle: "lid-flutter", rootHz: 122, tone: 0.32, air: 0.16, wetness: 0.43 }],
  ["Wide-eyed flutter", { pupil: 0.39, blink: -0.44, lowerLid: 0.42, tempo: 146, motion: 0.92, eyeballStyle: "still", eyelidStyle: "lid-flutter", rootHz: 242, tone: 0.6, irisTint: 0.77 }],
  ["Crying in place", { pupil: 0.03, blink: 0.07, lowerLid: 0.2, tempo: 80, motion: 0.77, eyeballStyle: "still", eyelidStyle: "lid-flutter", rootHz: 149, tone: 0.5, wetness: 1, veins: 0.45 }],
  ["Quiet eyelashes", { pupil: 0.44, blink: -0.09, tempo: 118, motion: 0.58, eyeballStyle: "still", eyelidStyle: "lid-flutter", rootHz: 110, tone: 0.4, air: 0.12, wetness: 0.25 }],
];

export const OCULOID_PRESETS = Object.freeze(scenes.map(([label, settings], index) => Object.freeze({
  id: `eye-${index + 1}`,
  label,
  snapshot: Object.freeze(normalizeOculoid(settings)),
})));

/** Local animation dice change one moving part, never the other part, Audio
 * arm, Tempo, Movement or the shared clock. Still is chosen explicitly. */
export function randomOculoidStyle(styles, current, random = Math.random) {
  const choices = styles.filter(style => style.id !== "still" && style.id !== current);
  if (!choices.length) return "still";
  return choices[Math.floor(clampEye(random(), 0, 0.999999, 0) * choices.length)].id;
}

/** Bounded full-state dice; output gain, Audio and transport are never owned by
 * a musical preset. `random` is injectable for reproducible tests. */
export function randomizeOculoid(_previous, random = Math.random) {
  const pick = (min, max) => min + (max - min) * Math.min(0.999999, Math.max(0, Number(random()) || 0));
  return normalizeOculoid({
    gazeX: pick(-0.85, 0.85), gazeY: pick(-0.75, 0.75), blink: pick(0, 0.62),
    lowerLid: pick(-0.65, 0.85),
    pupil: pick(0.1, 0.93), tempo: pick(45, 185), lidRate: pick(0.5, 2),
    motion: pick(0.08, 1),
    eyeballStyle: OCULOID_EYEBALL_STYLES[Math.floor(pick(0, OCULOID_EYEBALL_STYLES.length))].id,
    eyelidStyle: OCULOID_EYELID_STYLES[Math.floor(pick(0, OCULOID_EYELID_STYLES.length))].id,
    rootHz: pick(62, 320), tone: pick(0.08, 0.97), air: pick(0.02, 0.9),
    wetness: pick(0.06, 1), veins: pick(0.08, 1), irisTint: pick(0.03, 1),
  });
}
