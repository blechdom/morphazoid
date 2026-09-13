const finiteOr = (value, fallback) => (
  Number.isFinite(Number(value)) ? Number(value) : fallback
);

export const clamp = (value, minimum = 0, maximum = 1) => (
  Math.min(maximum, Math.max(minimum, finiteOr(value, minimum)))
);

const freeze = (value) => Object.freeze(value);
const freezeSettings = (settings) => freeze({ ...settings });

export const JULIE_SAW_LIMITS = freeze({
  bend: freeze([0.02, 0.98]),
  tipCurl: freeze([0, 1]),
  localization: freeze([0, 1]),
  bladeDamping: freeze([0, 1]),
  brightness: freeze([0, 1]),
  bowPressure: freeze([0, 1.4]),
  bowSpeed: freeze([0.01, 1.5]),
  bowContact: freeze([0, 1]),
  rosin: freeze([0, 1]),
  bowBite: freeze([0, 1]),
  edgeRasp: freeze([0, 1]),
  vibratoDepthCents: freeze([0, 120]),
  vibratoRateHz: freeze([0.1, 14]),
  vibratoDelaySeconds: freeze([0, 2.5]),
  glideSeconds: freeze([0.005, 1.5]),
  attackSeconds: freeze([0.002, 1.5]),
  decaySeconds: freeze([0.01, 2.5]),
  sustain: freeze([0, 1]),
  releaseSeconds: freeze([0.01, 5]),
  body: freeze([0, 1]),
  stereoWidth: freeze([0, 1]),
  tempoBpm: freeze([30, 300]),
  level: freeze([0, 0.78]),
});

export const JULIE_SAW_BLADES = freeze([
  freeze({
    id: "concert-tenor",
    label: "Concert tenor",
    description: "A balanced tapered blade with a strong lyrical center and a long, clean release.",
    lowMidi: 52,
    highMidi: 98,
    decayScale: 1,
    partialScale: 0.72,
    stiffness: 0.62,
  }),
  freeze({
    id: "long-baritone",
    label: "Long baritone",
    description: "A longer, wider blade with weight in the low register and slower pitch motion.",
    lowMidi: 45,
    highMidi: 88,
    decayScale: 1.18,
    partialScale: 0.6,
    stiffness: 0.48,
  }),
  freeze({
    id: "limber-soprano",
    label: "Limber soprano",
    description: "A narrow flexible blade that climbs quickly and tolerates fast hand vibrato.",
    lowMidi: 59,
    highMidi: 105,
    decayScale: 0.82,
    partialScale: 0.78,
    stiffness: 0.4,
  }),
  freeze({
    id: "thick-stage",
    label: "Thick stage blade",
    description: "A stiff, sustaining blade that asks for firmer bowing and rewards a stable sweet spot.",
    lowMidi: 50,
    highMidi: 96,
    decayScale: 1.32,
    partialScale: 0.84,
    stiffness: 0.84,
  }),
  freeze({
    id: "old-carpenter",
    label: "Old carpenter saw",
    description: "A deliberately rough creative approximation with short upper modes and a noisy edge.",
    lowMidi: 48,
    highMidi: 91,
    decayScale: 0.68,
    partialScale: 1.08,
    stiffness: 0.58,
  }),
]);

export const JULIE_SAW_DEFAULTS = freeze({
  bladeId: "concert-tenor",
  presetId: "julies-first-note",
  techniqueId: "clean-ring",
  rhythmId: "lyric-ring",
  bend: 0.43,
  tipCurl: 0.64,
  localization: 0.86,
  bladeDamping: 0.2,
  brightness: 0.48,
  bowPressure: 0.48,
  bowSpeed: 0.43,
  bowContact: 0.52,
  rosin: 0.62,
  bowBite: 0.58,
  edgeRasp: 0.24,
  vibratoDepthCents: 24,
  vibratoRateHz: 5.2,
  vibratoDelaySeconds: 0.28,
  glideSeconds: 0.16,
  attackSeconds: 0.035,
  decaySeconds: 0.16,
  sustain: 0.88,
  releaseSeconds: 0.44,
  body: 0.38,
  stereoWidth: 0.34,
  tempoBpm: 76,
  autoPlay: false,
  trackSweetSpot: true,
  level: 0.42,
});

export const JULIE_SAW_TECHNIQUES = freeze([
  freeze({ id: "clean-ring", label: "Ring + lift", description: "A defined rosined catch near the sweet spot, then the bow lifts so the cleaner localized fundamental can ring.", settings: freezeSettings({ bowPressure: 0.46, bowSpeed: 0.42, bowBite: 0.5, edgeRasp: 0.16, brightness: 0.42, releaseSeconds: 0.72 }) }),
  freeze({ id: "straight-tone", label: "Straight tone", description: "A centered bow with a restrained hair texture and no automatic vibrato; add hand or knee motion only when wanted.", settings: freezeSettings({ vibratoDepthCents: 0, bowPressure: 0.48, bowSpeed: 0.4, bowBite: 0.34, edgeRasp: 0.12 }) }),
  freeze({ id: "knee-vibrato", label: "Knee vibrato", description: "The seated player's raised heel and knee pulse the whole bend after a clean attack.", settings: freezeSettings({ vibratoDepthCents: 34, vibratoRateHz: 5.1, vibratoDelaySeconds: 0.3, localization: 0.88 }) }),
  freeze({ id: "hand-vibrato", label: "Hand vibrato", description: "Smaller, faster tip-hand motion perturbs curvature, pitch, Q, and sweet-spot position together.", settings: freezeSettings({ vibratoDepthCents: 19, vibratoRateHz: 7.2, vibratoDelaySeconds: 0.08, localization: 0.82 }) }),
  freeze({ id: "continuous-bow", label: "Continuous bow", description: "The bow stays in contact for controllable level and persistent hair-on-steel friction color.", settings: freezeSettings({ bowPressure: 0.54, bowSpeed: 0.48, bowBite: 0.62, edgeRasp: 0.34, sustain: 0.94 }) }),
  freeze({ id: "detache", label: "Détaché", description: "Alternating separate strokes make the rosined catch part of each articulation without muting the blade completely.", settings: freezeSettings({ attackSeconds: 0.012, releaseSeconds: 0.12, bowSpeed: 0.62, bowBite: 0.72, edgeRasp: 0.26 }) }),
  freeze({ id: "tremolo", label: "Bow tremolo", description: "Rapid alternating strokes repeatedly expose the bow catch and recharge the same localized mode.", settings: freezeSettings({ attackSeconds: 0.004, releaseSeconds: 0.055, bowSpeed: 0.82, bowPressure: 0.38, bowBite: 0.78, edgeRasp: 0.38 }) }),
  freeze({ id: "sweep", label: "Sweet-spot sweep", description: "A diagonal stroke hunts toward the moving sweet spot; useful and intentionally noisy.", settings: freezeSettings({ bowBite: 0.7, edgeRasp: 0.58, bowSpeed: 0.68, bowContact: 0.34, brightness: 0.62 }) }),
  freeze({ id: "harmonic", label: "Higher mode", description: "Contact below the usual sweet spot favors unstable upper plate motion; exact partials vary by blade.", settings: freezeSettings({ bowContact: 0.72, bowPressure: 0.34, bowSpeed: 0.54, brightness: 0.78, edgeRasp: 0.28 }) }),
  freeze({ id: "double-stop", label: "Mode pair", description: "A deliberately unstable approximation of fundamental and higher-mode coexistence on one saw.", settings: freezeSettings({ bowContact: 0.67, bowPressure: 0.63, bowSpeed: 0.32, localization: 0.66, brightness: 0.82 }) }),
  freeze({ id: "siren", label: "Siren glide", description: "A large continuous flex sweep makes the characteristic rising and falling saw glissando.", settings: freezeSettings({ glideSeconds: 0.42, vibratoDepthCents: 8, bowSpeed: 0.5, bowPressure: 0.5 }) }),
  freeze({ id: "wowa", label: "Wowa", description: "Repeated bend arcs make a broad vocal-like up/down slide.", settings: freezeSettings({ glideSeconds: 0.3, vibratoDepthCents: 52, vibratoRateHz: 1.25, vibratoDelaySeconds: 0 }) }),
  freeze({ id: "storm", label: "Storm wind", description: "Fast flex and contact drift trade a stable note for coarse bowed wind and shimmering plate modes.", settings: freezeSettings({ localization: 0.42, bowPressure: 0.72, bowSpeed: 0.92, bowBite: 0.92, edgeRasp: 0.88, brightness: 0.86, vibratoDepthCents: 92, vibratoRateHz: 3.2 }) }),
  freeze({ id: "soft-mallet", label: "Soft mallet", action: "soft-mallet", description: "A padded strike at the sweet spot rebounds quickly and leaves a rounded ring.", settings: freezeSettings({ edgeRasp: 0.05, brightness: 0.32, releaseSeconds: 1.2 }) }),
  freeze({ id: "hard-mallet", label: "Hard mallet", action: "hard-mallet", description: "A harder beater increases impact character and short-lived upper plate modes.", settings: freezeSettings({ edgeRasp: 0.18, brightness: 0.8, releaseSeconds: 0.7 }) }),
  freeze({ id: "edge-pluck", label: "Edge pluck", action: "pluck", description: "A thumb or plectrum snaps the edge into a short, partial-rich response.", settings: freezeSettings({ brightness: 0.68, bladeDamping: 0.38, releaseSeconds: 0.34 }) }),
  freeze({ id: "choke", label: "Pressure choke", action: "choke", description: "Stationary extra pressure or leaving the resonant region damps the note instead of making it louder.", settings: freezeSettings({ bowPressure: 1.24, bowSpeed: 0.03, edgeRasp: 0.54 }) }),
]);

const step = (kind, velocity = 0.72, duration = 0.72, direction = 1, bendOffset = 0, contactOffset = 0) => freeze({
  kind, velocity, duration, direction, bendOffset, contactOffset,
});
const rest = () => step("rest", 0, 0);

export const JULIE_SAW_RHYTHMS = freeze([
  freeze({ id: "lyric-ring", label: "Lyric ring", description: "Long up-bows with room for the high-Q blade to clear into its fundamental.", steps: freeze([step("bow", .78, .5, 1), rest(), rest(), rest(), step("bow", .68, .42, -1), rest(), rest(), rest()]) }),
  freeze({ id: "slow-boston", label: "Slow Boston", description: "A gentle three-feel inspired by period saw instructions for slow dance songs.", steps: freeze([step("bow", .82, .72, 1), rest(), step("bow", .52, .45, -1), step("bow", .6, .48, 1), rest(), rest()]) }),
  freeze({ id: "rebow", label: "Light re-bow", description: "Intermittent light strokes replenish a note before it dies away.", steps: freeze([step("bow", .76, .68, 1), rest(), step("bow", .34, .28, 1), rest(), step("bow", .4, .3, -1), rest(), rest(), rest()]) }),
  freeze({ id: "detache-eighths", label: "Détaché eighths", description: "Separate alternating bow directions in an even pulse.", steps: freeze([step("bow", .72, .58, 1), step("bow", .68, .58, -1)]) }),
  freeze({ id: "pulse-accent", label: "Pulse accent", description: "Bow pressure accents the first stroke of each four-pulse group.", steps: freeze([step("bow", 1, .52, 1), step("bow", .5, .45, -1), step("bow", .58, .45, 1), step("bow", .5, .45, -1)]) }),
  freeze({ id: "bounce-two", label: "Bow bounce ×2", description: "Two ricochet contacts inside each bow direction.", steps: freeze([step("bow", .78, .28, 1), step("bow", .56, .22, 1), rest(), rest(), step("bow", .76, .28, -1), step("bow", .54, .22, -1), rest(), rest()]) }),
  freeze({ id: "bounce-three", label: "Bow bounce ×3", description: "Three light contacts before the direction reverses.", steps: freeze([step("bow", .8, .24, 1), step("bow", .58, .2, 1), step("bow", .48, .18, 1), rest(), step("bow", .78, .24, -1), step("bow", .56, .2, -1), step("bow", .46, .18, -1), rest()]) }),
  freeze({ id: "bounce-four", label: "Bow bounce ×4", description: "Four compact contacts per direction, as documented in advanced bow patterns.", steps: freeze([step("bow", .78, .22, 1), step("bow", .58, .18, 1), step("bow", .5, .17, 1), step("bow", .44, .16, 1), step("bow", .76, .22, -1), step("bow", .56, .18, -1), step("bow", .48, .17, -1), step("bow", .42, .16, -1)]) }),
  freeze({ id: "bow-tremolo", label: "Bow tremolo", description: "Rapid alternating short strokes keep the blade continuously energized.", subdivision: 2, steps: freeze([step("bow", .56, .7, 1), step("bow", .52, .7, -1)]) }),
  freeze({ id: "mallet-duet", label: "Double mallet", description: "Alternating padded strikes from opposite faces, then a simultaneous accent.", steps: freeze([step("soft-mallet", .72), rest(), step("soft-mallet", .64, .7, -1), rest(), step("hard-mallet", .86), step("soft-mallet", .62, .7, -1), rest(), rest()]) }),
  freeze({ id: "siren-arc", label: "Siren arc", description: "A sustained bow under a large climb and fall of the flexing arm.", steps: freeze([step("bow", .76, .98, 1, -.22), step("bow", .72, .98, -1, .18), step("bow", .74, .98, 1, .28), step("bow", .7, .98, -1, -.16)]) }),
  freeze({ id: "storm-motion", label: "Storm motion", description: "Irregular bowed wind alternates contact misses, flex swells, and harder catches.", steps: freeze([step("bow", .84, .9, 1, -.1, -.22), step("bow", .38, .45, -1, .08, .2), rest(), step("bow", 1, .72, 1, .16, -.08), step("bow", .52, .55, -1, -.18, .28), step("choke", .72), step("bow", .78, .84, 1, .04, -.14), rest()]) }),
]);

export const JULIE_SAW_PRESETS = freeze([
  ["julies-first-note", "Julie's First Note", "concert-tenor", "clean-ring", "lyric-ring", {}],
  ["glassy-lament", "Glassy Lament", "concert-tenor", "knee-vibrato", "lyric-ring", { bend: .5, brightness: .3, body: .22, bowPressure: .4, localization: .95, releaseSeconds: 1.3 }],
  ["low-fog", "Low Fog", "long-baritone", "straight-tone", "rebow", { bend: .16, tipCurl: .36, brightness: .18, bladeDamping: .12, bowSpeed: .3, level: .46 }],
  ["high-wire", "High Wire", "limber-soprano", "hand-vibrato", "detache-eighths", { bend: .82, tipCurl: .78, brightness: .58, bowPressure: .34, level: .34 }],
  ["boston-sway", "Boston Sway", "concert-tenor", "knee-vibrato", "slow-boston", { tempoBpm: 88, vibratoDepthCents: 29, body: .48 }],
  ["bow-lift-halo", "Bow-Lift Halo", "thick-stage", "clean-ring", "lyric-ring", { bladeDamping: .06, localization: .98, releaseSeconds: 2.2, brightness: .26 }],
  ["continuous-silver", "Continuous Silver", "concert-tenor", "continuous-bow", "rebow", { bowContact: .54, rosin: .72, stereoWidth: .5 }],
  ["detache-dance", "Détaché Dance", "limber-soprano", "detache", "detache-eighths", { tempoBpm: 126, bend: .62 }],
  ["pulse-measure", "Pulse Measure", "thick-stage", "continuous-bow", "pulse-accent", { tempoBpm: 92, bowPressure: .6, body: .58 }],
  ["double-bounce", "Double Bounce", "concert-tenor", "detache", "bounce-two", { tempoBpm: 108, edgeRasp: .2 }],
  ["triple-bounce", "Triple Bounce", "limber-soprano", "detache", "bounce-three", { tempoBpm: 104, bowSpeed: .7 }],
  ["four-corners", "Four Bow Corners", "thick-stage", "detache", "bounce-four", { tempoBpm: 96, bowPressure: .5 }],
  ["silver-tremolo", "Silver Tremolo", "limber-soprano", "tremolo", "bow-tremolo", { tempoBpm: 154, localization: .78 }],
  ["sweet-spot-hunt", "Sweet-Spot Hunt", "old-carpenter", "sweep", "rebow", { bowContact: .26, edgeRasp: .56 }],
  ["mode-pair-mirage", "Mode-Pair Mirage", "thick-stage", "double-stop", "lyric-ring", { bend: .57, body: .68, stereoWidth: .76 }],
  ["siren-chair", "Siren Seat", "concert-tenor", "siren", "siren-arc", { tempoBpm: 62, glideSeconds: .62 }],
  ["wowa-bloom", "Wowa Bloom", "long-baritone", "wowa", "siren-arc", { bend: .32, tempoBpm: 54, vibratoDepthCents: 66 }],
  ["storm-window", "Storm Window", "old-carpenter", "storm", "storm-motion", { tempoBpm: 118, level: .35, stereoWidth: .84 }],
  ["felt-mallets", "Felt Mallets", "long-baritone", "soft-mallet", "mallet-duet", { tempoBpm: 84, body: .66, bladeDamping: .16 }],
  ["bright-beater", "Bright Beater", "thick-stage", "hard-mallet", "mallet-duet", { tempoBpm: 112, brightness: .9, edgeRasp: .12 }],
  ["edge-snap", "Edge Snap", "old-carpenter", "edge-pluck", "pulse-accent", { tempoBpm: 120, body: .24, stereoWidth: .62 }],
].map(([id, label, bladeId, techniqueId, rhythmId, settings]) => freeze({
  id,
  label,
  bladeId,
  techniqueId,
  rhythmId,
  settings: freezeSettings(settings),
})));

export function julieSawBlade(id) {
  return JULIE_SAW_BLADES.find((blade) => blade.id === id) ?? JULIE_SAW_BLADES[0];
}

export function julieSawTechnique(id) {
  return JULIE_SAW_TECHNIQUES.find((technique) => technique.id === id) ?? JULIE_SAW_TECHNIQUES[0];
}

export function techniqueTracksSweetSpot(id) {
  return !["sweep", "harmonic", "double-stop", "storm"].includes(julieSawTechnique(id).id);
}

export function julieSawRhythm(id) {
  return JULIE_SAW_RHYTHMS.find((rhythm) => rhythm.id === id) ?? JULIE_SAW_RHYTHMS[0];
}

export function julieSawPreset(id) {
  return JULIE_SAW_PRESETS.find((preset) => preset.id === id) ?? JULIE_SAW_PRESETS[0];
}

export function midiToFrequency(note) {
  return 440 * (2 ** ((clamp(note, 0, 127) - 69) / 12));
}

export function bendToFrequency(state) {
  const blade = julieSawBlade(state?.bladeId);
  const arch = clamp(state?.bend, ...JULIE_SAW_LIMITS.bend);
  const curl = clamp(state?.tipCurl, ...JULIE_SAW_LIMITS.tipCurl);
  const effectiveCurvature = clamp(arch * 0.82 + curl * 0.18);
  const midi = blade.lowMidi + (blade.highMidi - blade.lowMidi) * effectiveCurvature;
  return midiToFrequency(midi);
}

export function flexHandlePosition(state, width = 1, height = 1) {
  const arch = clamp(state?.bend, ...JULIE_SAW_LIMITS.bend);
  const curl = clamp(state?.tipCurl, ...JULIE_SAW_LIMITS.tipCurl);
  return {
    x: Math.max(1, Number(width) || 1) * (0.43 + arch * 0.25),
    y: Math.max(1, Number(height) || 1) * (0.13 + (1 - curl) * 0.3),
  };
}

export function sweetSpotPosition(state) {
  const arch = clamp(state?.bend, ...JULIE_SAW_LIMITS.bend);
  const curl = clamp(state?.tipCurl, ...JULIE_SAW_LIMITS.tipCurl);
  return clamp(0.16 + arch * 0.53 + curl * 0.17, 0.12, 0.9);
}

export function contactAlignment(state, contact = state?.bowContact) {
  const error = clamp(contact) - sweetSpotPosition(state);
  const width = 0.055 + (1 - clamp(state?.localization)) * 0.16;
  return Math.exp(-((error / width) ** 2));
}

export function pitchName(frequencyHz) {
  const frequency = Math.max(1, finiteOr(frequencyHz, 440));
  const midi = Math.round(69 + 12 * Math.log2(frequency / 440));
  const names = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
  return `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

export function sanitizeJulieSawState(candidate = {}, fallback = JULIE_SAW_DEFAULTS) {
  const base = fallback && typeof fallback === "object" ? fallback : JULIE_SAW_DEFAULTS;
  const source = candidate && typeof candidate === "object" ? candidate : {};
  const next = { ...JULIE_SAW_DEFAULTS, ...base };
  for (const [key, limits] of Object.entries(JULIE_SAW_LIMITS)) {
    next[key] = clamp(source[key] ?? next[key], limits[0], limits[1]);
  }
  next.bladeId = julieSawBlade(source.bladeId ?? next.bladeId).id;
  next.techniqueId = julieSawTechnique(source.techniqueId ?? next.techniqueId).id;
  next.rhythmId = julieSawRhythm(source.rhythmId ?? next.rhythmId).id;
  next.presetId = JULIE_SAW_PRESETS.some(({ id }) => id === source.presetId)
    ? source.presetId
    : String(source.presetId ?? next.presetId ?? "custom");
  next.autoPlay = Boolean(source.autoPlay ?? next.autoPlay);
  next.trackSweetSpot = Boolean(source.trackSweetSpot ?? next.trackSweetSpot);
  return next;
}

export function applyJulieSawTechnique(state, techniqueId) {
  const technique = julieSawTechnique(techniqueId);
  return sanitizeJulieSawState({
    ...state,
    ...technique.settings,
    techniqueId: technique.id,
    trackSweetSpot: techniqueTracksSweetSpot(technique.id),
    presetId: "custom",
  }, state);
}

export function applyJulieSawPreset(presetId, current = JULIE_SAW_DEFAULTS) {
  const preset = julieSawPreset(presetId);
  const technique = julieSawTechnique(preset.techniqueId);
  return sanitizeJulieSawState({
    ...JULIE_SAW_DEFAULTS,
    ...technique.settings,
    ...preset.settings,
    bladeId: preset.bladeId,
    techniqueId: preset.techniqueId,
    rhythmId: preset.rhythmId,
    trackSweetSpot: techniqueTracksSweetSpot(preset.techniqueId),
    presetId: preset.id,
    autoPlay: Boolean(current?.autoPlay),
  });
}

export function rhythmStepAt(state, stepIndex) {
  const rhythm = julieSawRhythm(state?.rhythmId);
  const index = ((Math.trunc(finiteOr(stepIndex, 0)) % rhythm.steps.length) + rhythm.steps.length) % rhythm.steps.length;
  return rhythm.steps[index];
}

export function randomizedJulieSawState(state = JULIE_SAW_DEFAULTS, random = Math.random) {
  const choose = (items) => items[Math.min(items.length - 1, Math.floor(clamp(random()) * items.length))];
  const blade = choose(JULIE_SAW_BLADES);
  const technique = choose(JULIE_SAW_TECHNIQUES.filter(({ action }) => action !== "choke"));
  const rhythm = choose(JULIE_SAW_RHYTHMS);
  const range = (minimum, maximum) => minimum + clamp(random()) * (maximum - minimum);
  return sanitizeJulieSawState({
    ...state,
    ...technique.settings,
    bladeId: blade.id,
    techniqueId: technique.id,
    rhythmId: rhythm.id,
    presetId: "custom",
    bend: range(.12, .86),
    tipCurl: range(.22, .9),
    localization: range(.48, .98),
    bladeDamping: range(.06, .5),
    brightness: range(.18, .9),
    bowPressure: range(.24, .86),
    bowSpeed: range(.22, 1.02),
    rosin: range(.28, .9),
    bowBite: range(.22, .92),
    edgeRasp: range(.05, .58),
    vibratoDepthCents: range(0, 72),
    vibratoRateHz: range(2.8, 8.2),
    body: range(.16, .76),
    stereoWidth: range(.08, .82),
    tempoBpm: range(52, 156),
    level: range(.3, .48),
  }, state);
}
