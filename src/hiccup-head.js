const finiteOr = (value, fallback) => (
  Number.isFinite(Number(value)) ? Number(value) : fallback
);

export const clamp = (value, minimum = 0, maximum = 1) => (
  Math.min(maximum, Math.max(minimum, finiteOr(value, minimum)))
);

const freezeSettings = (settings) => Object.freeze({ ...settings });

export const HICCUP_HEAD_STEP_COUNT = 64;
export const HICCUP_HEAD_VELOCITIES = Object.freeze([0, 0.42, 0.72, 1]);

export const HICCUP_HEAD_LIMITS = Object.freeze({
  lungPressure: Object.freeze([0, 1.6]),
  // The central 0..1 zone is roughly human. The outer ranges deliberately
  // allow retracted/projected lips, hollow/ballooned cheeks, and impossible
  // tongue and tract poses without passing unbounded values to the worklet.
  lipTension: Object.freeze([-0.35, 1.65]),
  lipRounding: Object.freeze([-0.45, 1.8]),
  cheekVolume: Object.freeze([-0.4, 2]),
  cheekTension: Object.freeze([-0.35, 1.7]),
  tonguePosition: Object.freeze([-0.65, 1.65]),
  tongueCurl: Object.freeze([-0.7, 1.8]),
  tongueOut: Object.freeze([0, 1.6]),
  mouthOpening: Object.freeze([0.01, 1.85]),
  tractLengthM: Object.freeze([0.035, 0.52]),
  nasalMix: Object.freeze([0, 1]),
  dooPitch: Object.freeze([-24, 24]),
  earSpread: Object.freeze([0, 1]),
  leftHairLength: Object.freeze([0, 1]),
  rightHairLength: Object.freeze([0, 1]),
  leftHairAngle: Object.freeze([-1, 1]),
  rightHairAngle: Object.freeze([-1, 1]),
  // Signed pupil travel alone chooses the cross-fed room character. The two
  // lids are separate performance effects and never change reverb wetness.
  eyeDivergence: Object.freeze([-1, 1]),
  eyeClosure: Object.freeze([0, 1]),
  leftEyeClosure: Object.freeze([0, 1]),
  rightEyeClosure: Object.freeze([0, 1]),
  leftBrow: Object.freeze([0, 1]),
  rightBrow: Object.freeze([0, 1]),
  silliness: Object.freeze([0, 1]),
  decay: Object.freeze([0.35, 1.8]),
  tempo: Object.freeze([48, 520]),
  swing: Object.freeze([0, 0.46]),
  humanize: Object.freeze([0, 0.45]),
  level: Object.freeze([0, 0.82]),
});

export const HICCUP_HEAD_DEFAULTS = Object.freeze({
  presetId: "rubber-face",
  patternId: "mouth-party",
  lungPressure: 0.82,
  lipTension: 0.46,
  lipRounding: 0.38,
  cheekVolume: 0.64,
  cheekTension: 0.42,
  tonguePosition: 0.58,
  tongueCurl: 0.4,
  tongueOut: 0.08,
  mouthOpening: 0.48,
  tractLengthM: 0.165,
  nasalMix: 0.14,
  dooPitch: 0,
  earSpread: 0.18,
  leftHairLength: 0.14,
  rightHairLength: 0.14,
  leftHairAngle: -0.78,
  rightHairAngle: -0.64,
  eyeDivergence: 0.08,
  eyeClosure: 0,
  leftEyeClosure: 0,
  rightEyeClosure: 0,
  leftBrow: 0,
  rightBrow: 0,
  silliness: 0.56,
  decay: 0.92,
  tempo: 118,
  swing: 0.1,
  humanize: 0.06,
  level: 0.76,
});

// Native Web Audio convolution replaces the former pair of long feedback taps.
// These dense, deterministic room profiles contain no isolated reflections, so
// the eyes can move from a bright plate to a large cathedral without turning
// the room into a tempo-like echo. Compact layouts use a shorter allocation to
// protect phone memory while retaining a multi-second low-frequency tail.
export const HICCUP_HEAD_ROOM_PROFILES = Object.freeze({
  plate: Object.freeze({
    durationSeconds: 1.65,
    compactDurationSeconds: 1.45,
    lowRt60Seconds: 1.45,
    highRt60Seconds: 0.95,
    onsetSeconds: 0.003,
    attackSeconds: 0.007,
    lowSplitHz: 1_600,
    highDampingStart: 0.76,
    highDampingEnd: 0.4,
    lowWeight: 0.72,
    highWeight: 0.9,
    energy: 0.9,
    seed: 0x706c6174,
  }),
  cathedral: Object.freeze({
    durationSeconds: 3.8,
    compactDurationSeconds: 3.2,
    lowRt60Seconds: 3.5,
    highRt60Seconds: 2.05,
    onsetSeconds: 0.008,
    attackSeconds: 0.015,
    lowSplitHz: 850,
    highDampingStart: 0.52,
    highDampingEnd: 0.18,
    lowWeight: 1.22,
    highWeight: 0.58,
    energy: 0.95,
    seed: 0x63617468,
  }),
});

const smoothUnit = (value) => {
  const amount = clamp(value);
  return amount * amount * (3 - 2 * amount);
};

/**
 * Generate two energy-normalized room channels for a ConvolverNode. The LCG,
 * continuous noise field, and independent channel seeds make this repeatable,
 * diffuse, and stereo without sparse peaks that can be heard as delay taps.
 */
export function hiccupHeadRoomImpulseChannels(
  roomId = "cathedral",
  sampleRate = 48_000,
  { compact = false } = {},
) {
  const profile = HICCUP_HEAD_ROOM_PROFILES[roomId]
    ?? HICCUP_HEAD_ROOM_PROFILES.cathedral;
  const rate = Math.round(clamp(sampleRate, 8_000, 192_000));
  const durationSeconds = compact
    ? profile.compactDurationSeconds
    : profile.durationSeconds;
  const length = Math.max(1, Math.round(rate * durationSeconds));
  const onsetFrames = Math.max(0, Math.round(rate * profile.onsetSeconds));
  const attackFrames = Math.max(1, Math.round(rate * profile.attackSeconds));
  const finalFadeFrames = Math.max(1, Math.round(rate * 0.04));
  const lowSplitAlpha = 1 - Math.exp(-Math.PI * 2 * profile.lowSplitHz / rate);
  const dcAlpha = 1 - Math.exp(-Math.PI * 2 * 14 / rate);
  const lowDecay = 10 ** (-3 / (profile.lowRt60Seconds * rate));
  const highDecay = 10 ** (-3 / (profile.highRt60Seconds * rate));
  const channels = [];

  for (let channel = 0; channel < 2; channel += 1) {
    const samples = new Float32Array(length);
    let seed = (profile.seed ^ Math.imul(channel + 1, 0x45d9f3b)) >>> 0;
    let lowBand = 0;
    let dampedHigh = 0;
    let dc = 0;
    let lowEnvelope = 1;
    let highEnvelope = 1;
    let energy = 0;
    for (let index = onsetFrames; index < length; index += 1) {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      const noise = seed / 0xffff_ffff * 2 - 1;
      lowBand += (noise - lowBand) * lowSplitAlpha;
      const highBand = noise - lowBand;
      const progress = (index - onsetFrames) / Math.max(1, length - onsetFrames - 1);
      const highDamping = profile.highDampingStart
        + (profile.highDampingEnd - profile.highDampingStart) * progress;
      dampedHigh += (highBand - dampedHigh) * highDamping;
      let value = lowBand * profile.lowWeight * lowEnvelope
        + dampedHigh * profile.highWeight * highEnvelope;
      dc += (value - dc) * dcAlpha;
      value -= dc;
      const attack = Math.min(1, (index - onsetFrames + 1) / attackFrames);
      const remaining = length - index;
      const finalFade = Math.min(1, remaining / finalFadeFrames);
      value *= attack * finalFade;
      samples[index] = value;
      energy += value * value;
      lowEnvelope *= lowDecay;
      highEnvelope *= highDecay;
    }
    const scale = profile.energy / Math.sqrt(Math.max(1e-12, energy));
    for (let index = onsetFrames; index < length; index += 1) {
      samples[index] *= scale;
    }
    channels.push(samples);
  }

  return Object.freeze({
    channels,
    compact: Boolean(compact),
    durationSeconds,
    roomId: HICCUP_HEAD_ROOM_PROFILES[roomId] ? roomId : "cathedral",
    sampleRate: rate,
  });
}

export function hiccupHeadFuzzCurve(size = 4_096) {
  const length = Math.round(clamp(size, 256, 65_536));
  const curve = new Float32Array(length);
  const drive = 1.8;
  const normalization = Math.tanh(drive);
  for (let index = 0; index < length; index += 1) {
    const input = index / (length - 1) * 2 - 1;
    curve[index] = Math.tanh(input * drive) / normalization;
  }
  return curve;
}

/**
 * Convert face positions into smoothed native-node targets. Keeping this pure
 * makes gain matching testable and ensures presets, mutation, and live drags
 * all use exactly the same mapping.
 */
export function hiccupHeadFaceEffectTargets(source = {}, enabled = {}) {
  const divergence = clamp(finiteOr(source.eyeDivergence, 0), -1, 1);
  const cathedralAmount = smoothUnit(Math.max(0, divergence) / 0.9);
  const plateAmount = smoothUnit(Math.max(0, -divergence) / 0.9);
  const reverbEnabled = enabled.reverb !== false;
  // Both captured IRs are shaped toward their diffuse late fields. These sends
  // can therefore make the sustained tail obvious without bringing back the
  // close early-room signature that dominated the previous eye extremes.
  const cathedralSendGain = reverbEnabled ? cathedralAmount * 0.36 : 0;
  const plateSendGain = reverbEnabled ? plateAmount * 0.38 : 0;
  // Convolution is an added room return, not a replacement for the face.
  // Keeping the direct anchor at unity prevents wet eyes from making every
  // mouth sound smaller or farther away.
  const roomDryGain = 1;

  const sharedClosure = clamp(finiteOr(source.eyeClosure, 0));
  const leftClosure = clamp(finiteOr(source.leftEyeClosure, sharedClosure));
  const rightClosure = clamp(finiteOr(source.rightEyeClosure, sharedClosure));
  const highpassAmount = leftClosure ** 0.75;
  const fuzzDriveGain = 1 + 9 * rightClosure ** 1.1;
  const fuzzMix = rightClosure * 0.99;
  return Object.freeze({
    cathedralAmount,
    cathedralSendGain,
    plateAmount,
    plateSendGain,
    roomDryGain,
    roomWetGate: reverbEnabled ? 1 : 0,
    highpassAmount,
    // A front-loaded travel curve makes every quarter of the lid audible;
    // makeup offsets the perceived energy loss without bypassing the filter.
    highpassCutoffHz: 30 * 2 ** (highpassAmount * Math.log2(10_000 / 30)),
    highpassQ: 0.707 + highpassAmount * 2,
    highpassMakeupGain: 1 + highpassAmount * 0.32,
    // Compatibility telemetry: the actual Biquad is always in series, with
    // its cutoff—not a parallel dry/wet blend—performing the sweep.
    highpassDryGain: 0,
    highpassWetGain: 1,
    fuzzAmount: rightClosure,
    fuzzDriveGain,
    fuzzDryGain: 1 - fuzzMix,
    fuzzWetGain: fuzzMix * 0.74,
    // The post-worklet rounded fuzz has no tone-filter or delayed phase branch.
    fuzzToneHz: 0,
  });
}

// Hiccup Head uses one continuous oral tube. The section count and tongue
// landmarks deliberately match the 44-section Pink Trombone convention used
// by Throatazoid, while the control mapping remains Hiccup Head-specific.
export const HICCUP_HEAD_TRACT_SECTION_COUNT = 44;
export const HICCUP_HEAD_TRACT_DIAMETER_FLOOR_CM = 0.001;
export const HICCUP_HEAD_TRACT_LANDMARKS = Object.freeze({
  glottis: 0,
  tongueBodyStart: 10,
  tongueControlStart: 12.9,
  // Canonical Pink/Throatazoid K place (full-tract section 22).
  velar: 22,
  tongueControlEnd: 30.4,
  postalveolar: 31,
  alveolar: 35,
  lipShapingStart: 37,
  lips: HICCUP_HEAD_TRACT_SECTION_COUNT - 1,
});

// Hiccup Head is missing his upper-left central incisor. The dimensions describe
// the anatomical vacancy and the much smaller tongue-to-gap air slot that is
// actually used to whistle. The jet is generated immediately behind the
// dental edge and is injected into the anterior cells of the same oral tube.
export const HICCUP_HEAD_TOOTH_GAP_ANATOMY = Object.freeze({
  missingTooth: "upper-left central incisor",
  crownGapWidthCm: 0.86,
  crownGapHeightCm: 1.04,
  jetSlotHeightCm: 0.072,
  jetSlotAreaCm2: 0.06192,
  edgeAngleDegrees: 34,
  canonicalOralSection: 40.5,
  baseImpingementLengthM: 0.00165,
  airDensityKgM3: 1.204,
  maximumOralPressurePa: 1_650,
  strouhalNumbers: Object.freeze([0.14, 0.2, 0.27]),
});

export const HICCUP_HEAD_GESTURE_CHANNELS = Object.freeze([
  "poseMix",
  "pressure",
  "lipClosure",
  "lipImpulse",
  "tongueContact",
  "constrictionPosition",
  "constriction",
  "secondaryConstrictionPosition",
  "secondaryConstriction",
  "velum",
  "turbulence",
  "suction",
  "cheekImpulse",
  "jawImpulse",
  "voicing",
  "aspiration",
  "lipFlutter",
  "tongueTrill",
  "tongueExtension",
  "throatRattle",
  "registerLift",
  "toothJet",
  "breathDirection",
  "diaphragmCatch",
]);

export const HICCUP_HEAD_SOUNDS = Object.freeze([
  Object.freeze({
    id: "bop",
    label: "BOP",
    subtitle: "bilabial kick",
    key: "1",
    family: "plosive",
    color: "#ff6f79",
    description: "Pressed lips store breath, then release a compact bilabial kick with just a trace of voice.",
  }),
  Object.freeze({
    id: "boop",
    label: "BOOP",
    subtitle: "rounded lip kick",
    key: "2",
    family: "plosive",
    color: "#ffb15d",
    description: "Projected lips turn the kick into a rounder, voiced beatbox bass with a brief cavity ring.",
  }),
  Object.freeze({
    id: "pop",
    label: "POP",
    subtitle: "inward cheek pop",
    key: "3",
    family: "cavity",
    color: "#f7dc6a",
    description: "An inward cheek pull collapses a sealed pocket of air into a dry, human mouth pop.",
  }),
  Object.freeze({
    id: "tlik",
    label: "TLIK",
    subtitle: "palatal tongue click",
    key: "4",
    family: "tongue",
    color: "#7ce7bd",
    description: "Tongue suction releases from the palate and the tip follows with a tight two-part click.",
  }),
  Object.freeze({
    id: "shh",
    label: "PHSHSHK",
    subtitle: "puff · scrape · cut",
    key: "5",
    family: "hybrid",
    color: "#65dfe8",
    description: "A lip-pressure PH puff flashes across a short SH groove and stops on a crisp rear-tongue K cut.",
  }),
  Object.freeze({
    id: "shack",
    label: "SHACK!",
    subtitle: "SH · open A · K",
    key: "6",
    family: "hybrid",
    color: "#70a9ff",
    description: "A brief postalveolar SH opens into a wide A-shaped jaw, then a rear tongue seal releases as a hard K.",
  }),
  Object.freeze({
    id: "slap",
    label: "SLAP",
    subtitle: "left palm face clap",
    key: "7",
    family: "membrane",
    color: "#bb8cff",
    description: "Palm, fingers, and a skin-fold rebound form a clap-like contact cluster through cheek and mouth resonance.",
  }),
  Object.freeze({
    id: "pff",
    label: "PFRR",
    subtitle: "pressure lip roll",
    key: "8",
    family: "flutter",
    color: "#f07fd0",
    description: "Stored breath drives a loose bilabial valve into a full-bodied, pressure-sustained human lip roll.",
  }),
  Object.freeze({
    id: "kick",
    label: "KICK",
    subtitle: "low body thump",
    key: "9",
    family: "body",
    color: "#ff526b",
    description: "A low-pressure body impulse folds the cheek wall into the mouth cavity for a resonant beatbox kick.",
  }),
  Object.freeze({
    id: "smack",
    label: "SMACK",
    subtitle: "right palm face clap",
    key: "0",
    family: "membrane",
    color: "#ff9257",
    description: "The opposite palm lands an offset clap doublet whose brightness and tail follow the chosen face impact zone.",
  }),
  Object.freeze({
    id: "hee",
    label: "HEE",
    subtitle: "ingressive voice",
    key: "q",
    family: "vocal",
    color: "#f4d35e",
    description: "Air is pulled inward across briefly vibrating vocal folds through a tight, bright HEE-shaped tract.",
  }),
  Object.freeze({
    id: "haw",
    label: "HAW",
    subtitle: "egressive voice",
    key: "w",
    family: "vocal",
    color: "#79e5ae",
    description: "The folds reverse to outward breath while the jaw falls into a short, open HAW vowel.",
  }),
  Object.freeze({
    id: "doo",
    label: "DOO",
    subtitle: "pitched round voice",
    key: "e",
    family: "vocal",
    color: "#58dbe8",
    description: "A compact voiced pulse travels through a rounded DOO tube, transposed by the dedicated DOO pitch control.",
  }),
  Object.freeze({
    id: "mwah",
    label: "MWAH",
    subtitle: "suction kiss",
    key: "r",
    family: "cavity",
    color: "#629dff",
    description: "Projected lips seal around a falling-pressure pocket, then spring open into a wet suction kiss.",
  }),
  Object.freeze({
    id: "kiss",
    label: "KISS",
    subtitle: "lipstick pop kiss",
    key: ";",
    family: "cavity",
    color: "#ff4f9a",
    description: "A short projected-lip suction kiss leaves a fading lipstick print at a new place on the face.",
  }),
  Object.freeze({
    id: "drr",
    label: "DRR",
    subtitle: "tongue-tip roll",
    key: "t",
    family: "tongue",
    color: "#ae7df2",
    description: "Oral pressure repeatedly parts a compliant tongue tip for an organic, pressure-driven rolled DRR.",
  }),
  Object.freeze({
    id: "burp",
    label: "BURP",
    subtitle: "irregular low fold",
    key: "y",
    family: "vocal",
    color: "#e978bd",
    description: "An uneven low gas pulse rattles relaxed vocal folds and the full tract into a short human burp.",
  }),
  Object.freeze({
    id: "aah",
    label: "AAH",
    subtitle: "open modal throat",
    key: "u",
    family: "open-vocal",
    color: "#ff5f87",
    description: "A broad pharynx, low tongue, and freely vibrating modal glottis make a sustained human AAH.",
  }),
  Object.freeze({
    id: "ooh",
    label: "OOH",
    subtitle: "rounded open throat",
    key: "i",
    family: "open-vocal",
    color: "#ff9c59",
    description: "The same open throat flows into a long rounded lip tube for a dark, resonant OOH.",
  }),
  Object.freeze({
    id: "wail",
    label: "WAIL",
    subtitle: "head-voice vibrato",
    key: "o",
    family: "open-vocal",
    color: "#efd452",
    description: "Taut folds climb into head voice while a real cyclic tension modulation produces wide organic vibrato.",
  }),
  Object.freeze({
    id: "yodel",
    label: "YODEL",
    subtitle: "register break",
    key: "p",
    family: "open-vocal",
    color: "#70e4a0",
    description: "Fold tension and glottal closure jump between chest and head registers while the tract stays continuous.",
  }),
  Object.freeze({
    id: "growl",
    label: "GROWL",
    subtitle: "rough subharmonic",
    key: "a",
    family: "rough-vocal",
    color: "#50d8dd",
    description: "Alternating fold cycles and irregular pressure entrainment pull the glottis into a low subharmonic growl.",
  }),
  Object.freeze({
    id: "holler",
    label: "HOLLER",
    subtitle: "high-pressure belt",
    key: "s",
    family: "open-vocal",
    color: "#6098ff",
    description: "A braced open tract and high-pressure, high-closure glottis create a short projected belt.",
  }),
  Object.freeze({
    id: "hum",
    label: "HUM",
    subtitle: "nasal voiced closure",
    key: "d",
    family: "nasal-vocal",
    color: "#aa7cf1",
    description: "Closed lips divert a modal fold pulse through the physical velum and nasal side branch.",
  }),
  Object.freeze({
    id: "rattle",
    label: "RATTLE",
    subtitle: "throat flap",
    key: "f",
    family: "rough-vocal",
    color: "#e46fbd",
    description: "A compliant uvular and epiglottal-region flap self-oscillates in the pressure-driven throat.",
  }),
  Object.freeze({
    id: "whistle",
    label: "FWEE",
    subtitle: "missing-tooth whistle",
    key: "g",
    family: "tooth-whistle",
    color: "#ff73a9",
    description: "A focused tongue jet catches the edge of Hiccup Head's missing upper front tooth and whistles through the living oral tube.",
  }),
  Object.freeze({
    id: "grunt",
    label: "HNNGH",
    subtitle: "short chest grunt",
    key: "h",
    family: "rough-vocal",
    color: "#ff805e",
    description: "A compact chest-pressure pulse closes into rough low folds, then opens through the same living throat as a warm human grunt.",
  }),
  Object.freeze({
    id: "moan",
    label: "MMOAN",
    subtitle: "open sliding moan",
    key: "j",
    family: "open-vocal",
    color: "#d98cff",
    description: "Relaxed folds and a slowly opening oral tube bend through a sustained, breath-shaped moan with gentle vibrato.",
  }),
  Object.freeze({
    id: "lala",
    label: "LA-LA",
    subtitle: "rolling lateral voice",
    key: "k",
    family: "tongue-vocal",
    color: "#72e6cf",
    description: "One voiced breath passes a tongue that repeatedly touches and peels from the alveolar ridge for wet rolling LA syllables.",
  }),
  Object.freeze({
    id: "pbpb",
    label: "PB-PB",
    subtitle: "voiced lip burble",
    key: "l",
    family: "flutter-vocal",
    color: "#ff8ac8",
    description: "Soft lips alternately meet and part around a voiced pressure stream, shaping a rounded PB-PB burble instead of a noise slab.",
  }),
  Object.freeze({
    id: "slurp",
    label: "SLRRP",
    subtitle: "wet tongue pull",
    key: "z",
    family: "tongue",
    color: "#69b7ff",
    description: "The tongue reaches beyond the lips, stores a shallow suction pocket, then peels back through a damp two-stage release.",
  }),
  Object.freeze({
    id: "hiccup",
    label: "HIC!",
    subtitle: "diaphragm catch",
    key: "x",
    family: "body-vocal",
    color: "#ffd166",
    description: "The diaphragm charges against a caught glottis, then rebounds through the one living tract as a short, comic human hiccup.",
  }),
  Object.freeze({
    id: "eef",
    label: "EEF!",
    subtitle: "folded breath reversal",
    key: "c",
    family: "vocal",
    color: "#68e1ff",
    description: "A tight EEF-shaped tract folds a forceful inward breath across the glottis, catches, and flicks outward without becoming a noise burst.",
  }),
  Object.freeze({
    id: "snare",
    label: "KSH!",
    subtitle: "mouth snare",
    key: "v",
    family: "hybrid",
    color: "#ff6f91",
    description: "A rear tongue seal snaps into a narrow forward groove, turning stored mouth pressure into a compact physical KSH snare.",
  }),
  Object.freeze({
    id: "snap",
    label: "SNAP",
    subtitle: "tongue suction snap",
    key: "b",
    family: "tongue",
    color: "#ffb45f",
    description: "The tongue stores suction against the hard palate and peels free as a sharp two-stage oral snap through the same tract.",
  }),
  Object.freeze({
    id: "tomlo",
    label: "TOM-L",
    subtitle: "low cheek tom",
    key: "n",
    family: "body",
    color: "#f3d765",
    description: "A loose deep cheek wall is struck inward and rebounds through a long open cavity like a low human mouth tom.",
  }),
  Object.freeze({
    id: "tomhi",
    label: "TOM-H",
    subtitle: "high cheek tom",
    key: "m",
    family: "body",
    color: "#76e3b7",
    description: "A taut smaller cheek pocket takes a quicker paired impact for a higher, drier physical mouth tom.",
  }),
  Object.freeze({
    id: "braap",
    label: "BRRAP",
    subtitle: "voiced loose-lip blat",
    key: ",",
    family: "flutter-vocal",
    color: "#69dce8",
    description: "Low rough folds push uneven pressure pockets through a loose bilabial valve for an organic voiced BRRAP distinct from the breathier PFRR.",
  }),
  Object.freeze({
    id: "brush",
    label: "BRUSH",
    subtitle: "toothbrush wood gliss",
    key: ".",
    family: "body",
    color: "#72d9ff",
    description: "A toothbrush sweeps all twelve warm dead-wood teeth in sequence as a visible marimba-like glissando.",
  }),
]);

const soundById = new Map(HICCUP_HEAD_SOUNDS.map((sound) => [sound.id, sound]));

const hiccupHeadModelSoundId = (soundId) => (
  soundId === "kiss" ? "mwah" : soundId === "brush" ? "tomhi" : soundId
);

export function hiccupHeadSound(id) {
  return soundById.get(id) ?? HICCUP_HEAD_SOUNDS[0];
}

export const HICCUP_HEAD_VOICE_LIMITS = Object.freeze({
  pitchOffsetSemitones: Object.freeze([-24, 24]),
  vibratoRateHz: Object.freeze([0, 12]),
  vibratoDepthSemitones: Object.freeze([0, 5]),
  breathiness: Object.freeze([0, 1]),
  roughness: Object.freeze([0, 1]),
  subharmonicMix: Object.freeze([0, 1]),
  tractScale: Object.freeze([0.82, 1.18]),
});

export const HICCUP_HEAD_VOICE_MODULATION_SOURCES = Object.freeze([
  "sine", "triangle", "random",
]);
export const HICCUP_HEAD_VOICE_MODULATION_TARGETS = Object.freeze([
  "pitch", "vibratoDepth", "breathiness", "roughness", "tractScale",
]);
export const HICCUP_HEAD_VOICE_MODULATION_LIMITS = Object.freeze({
  depth: Object.freeze([0, 1]),
  rateHz: Object.freeze([0.05, 20]),
  phase: Object.freeze([0, 1]),
});

export function sanitizeHiccupHeadVoiceModulation(source = {}) {
  const modulation = source && typeof source === "object" ? source : {};
  const sourceId = HICCUP_HEAD_VOICE_MODULATION_SOURCES.includes(modulation.source)
    ? modulation.source
    : "sine";
  const target = HICCUP_HEAD_VOICE_MODULATION_TARGETS.includes(modulation.target)
    ? modulation.target
    : "pitch";
  return {
    source: sourceId,
    target,
    depth: clamp(finiteOr(modulation.depth, 0), ...HICCUP_HEAD_VOICE_MODULATION_LIMITS.depth),
    rateHz: clamp(finiteOr(modulation.rateHz, 2), ...HICCUP_HEAD_VOICE_MODULATION_LIMITS.rateHz),
    phase: clamp(finiteOr(modulation.phase, 0), ...HICCUP_HEAD_VOICE_MODULATION_LIMITS.phase),
  };
}

const defineVoiceCharacter = (id, label, description, settings) => Object.freeze({
  id,
  label,
  description,
  settings: freezeSettings(settings),
});

// These are characters of the one larynx/tract, not concurrent oscillators.
// A strike captures one sanitized character and atomically retunes the same
// folds and tube when its gesture begins.
export const HICCUP_HEAD_VOICE_CHARACTERS = Object.freeze([
  defineVoiceCharacter("natural", "Natural", "Centered modal folds with a small living vibrato.", {
    pitchOffsetSemitones: 0, vibratoRateHz: 5.15, vibratoDepthSemitones: 0.24,
    breathiness: 0.13, roughness: 0.08, subharmonicMix: 0.02, tractScale: 1,
  }),
  defineVoiceCharacter("velvet", "Velvet", "Relaxed low folds and a slightly longer, breath-warmed tract.", {
    pitchOffsetSemitones: -7, vibratoRateHz: 4.35, vibratoDepthSemitones: 0.34,
    breathiness: 0.26, roughness: 0.1, subharmonicMix: 0.08, tractScale: 1.09,
  }),
  defineVoiceCharacter("reed", "Reed", "A compact bright tube with firm, nearly periodic closure.", {
    pitchOffsetSemitones: 5, vibratoRateHz: 5.8, vibratoDepthSemitones: 0.12,
    breathiness: 0.04, roughness: 0.04, subharmonicMix: 0, tractScale: 0.91,
  }),
  defineVoiceCharacter("choirboy", "Choirboy", "Light head-voice folds, short tract, and clear vibrato.", {
    pitchOffsetSemitones: 12, vibratoRateHz: 6.15, vibratoDepthSemitones: 0.62,
    breathiness: 0.2, roughness: 0.025, subharmonicMix: 0, tractScale: 0.88,
  }),
  defineVoiceCharacter("smoker", "Smoker", "Loose asymmetrical folds with an audible alternate-cycle undertow.", {
    pitchOffsetSemitones: -10, vibratoRateHz: 3.4, vibratoDepthSemitones: 0.18,
    breathiness: 0.32, roughness: 0.62, subharmonicMix: 0.38, tractScale: 1.08,
  }),
  defineVoiceCharacter("warble", "Warble", "Wide, quick tension modulation for an unruly singing wobble.", {
    pitchOffsetSemitones: 3, vibratoRateHz: 7.3, vibratoDepthSemitones: 1.72,
    breathiness: 0.12, roughness: 0.18, subharmonicMix: 0.06, tractScale: 0.98,
  }),
  defineVoiceCharacter("monster", "Monster", "A long tract driven by low, rough, period-doubled folds.", {
    pitchOffsetSemitones: -17, vibratoRateHz: 2.7, vibratoDepthSemitones: 0.42,
    breathiness: 0.22, roughness: 0.84, subharmonicMix: 0.74, tractScale: 1.17,
  }),
  defineVoiceCharacter("helium", "Helium", "High folds and a physically shortened tract without chipmunk samples.", {
    pitchOffsetSemitones: 19, vibratoRateHz: 6.7, vibratoDepthSemitones: 0.48,
    breathiness: 0.18, roughness: 0.05, subharmonicMix: 0, tractScale: 0.82,
  }),
]);

const voiceCharacterById = new Map(HICCUP_HEAD_VOICE_CHARACTERS.map((voice) => [voice.id, voice]));

export function hiccupHeadVoiceCharacter(id) {
  return voiceCharacterById.get(id) ?? HICCUP_HEAD_VOICE_CHARACTERS[0];
}

export function sanitizeHiccupHeadVoice(
  source = {},
  fallback = HICCUP_HEAD_VOICE_CHARACTERS[0].settings,
) {
  const voice = source && typeof source === "object" ? source : {};
  const base = fallback && typeof fallback === "object"
    ? fallback
    : HICCUP_HEAD_VOICE_CHARACTERS[0].settings;
  const explicitCharacterId = voice.characterId ?? voice.id;
  const requestedCharacterId = explicitCharacterId ?? base.characterId ?? base.id;
  const character = hiccupHeadVoiceCharacter(requestedCharacterId);
  const valueBase = explicitCharacterId ? character.settings : base;
  const result = { characterId: character.id };
  for (const [key, limits] of Object.entries(HICCUP_HEAD_VOICE_LIMITS)) {
    result[key] = clamp(
      finiteOr(
        voice[key],
        finiteOr(valueBase[key], character.settings[key]),
      ),
      limits[0],
      limits[1],
    );
  }
  result.modulation = sanitizeHiccupHeadVoiceModulation(
    voice.modulation ?? valueBase.modulation,
  );
  return result;
}

export function mutateHiccupHeadVoice(source = {}, random = Math.random, amount = 0.36) {
  const voice = sanitizeHiccupHeadVoice(source);
  const depth = clamp(amount);
  const result = { ...voice };
  for (const [key, [minimum, maximum]] of Object.entries(HICCUP_HEAD_VOICE_LIMITS)) {
    const draw = clamp(finiteOr(random(), 0.5));
    const displacement = (draw * 2 - 1) * (maximum - minimum) * depth * 0.5;
    result[key] = clamp(voice[key] + displacement, minimum, maximum);
  }
  const mutated = sanitizeHiccupHeadVoice(result, voice);
  // Keep mutation characterful without pushing folds or tube beyond the
  // reliably radiating region of the physical model.
  mutated.pitchOffsetSemitones = clamp(mutated.pitchOffsetSemitones, -16, 16);
  mutated.breathiness = clamp(mutated.breathiness, 0.03, 0.68);
  mutated.roughness = clamp(mutated.roughness, 0, 0.82);
  mutated.subharmonicMix = clamp(mutated.subharmonicMix, 0, 0.68);
  mutated.tractScale = clamp(mutated.tractScale, 0.88, 1.12);
  mutated.modulation = {
    ...mutated.modulation,
    depth: clamp(mutated.modulation.depth, ...HICCUP_HEAD_VOICE_MODULATION_LIMITS.depth),
  };
  return mutated;
}

export function randomizeHiccupHeadVoice(source = {}, random = Math.random) {
  return mutateHiccupHeadVoice(source, random, 1);
}

export const HICCUP_HEAD_PRESETS = Object.freeze([
  Object.freeze({
    id: "humming-head",
    label: "Humming head",
    description: "Closed resonant lips and an open nasal path tuned for the HUM trigger.",
    settings: freezeSettings({
      lungPressure: 0.62, lipTension: 0.34, lipRounding: 0.72,
      cheekVolume: 0.72, cheekTension: 0.3, tonguePosition: 0.42,
      tongueCurl: 0.18, mouthOpening: 0.035, tractLengthM: 0.19,
      nasalMix: 0.72, earSpread: 0.28, eyeDivergence: 0.24,
      leftHairLength: 0.14, rightHairLength: 0.14,
      leftHairAngle: -0.78, rightHairAngle: -0.64,
      leftEyeClosure: 0.12, rightEyeClosure: 0.12, eyeClosure: 0.12,
      leftBrow: 0.56, rightBrow: 0.56, silliness: 0.38, decay: 1.34,
    }),
  }),
  Object.freeze({
    id: "rubber-face",
    label: "Rubber face",
    description: "A recognizably human beatbox mouth with punchy closures, elastic cheeks, and compact releases.",
    settings: freezeSettings({
      lungPressure: 0.82, lipTension: 0.46, lipRounding: 0.38,
      cheekVolume: 0.64, cheekTension: 0.42, tonguePosition: 0.58,
      tongueCurl: 0.4, mouthOpening: 0.48, tractLengthM: 0.165,
      nasalMix: 0.14, earSpread: 0.18,
      leftHairLength: 0.12, rightHairLength: 0.16,
      leftHairAngle: -0.82, rightHairAngle: -0.62, eyeDivergence: 0.08, eyeClosure: 0,
      leftBrow: 0, rightBrow: 0,
      silliness: 0.56, decay: 0.92,
    }),
  }),
  Object.freeze({
    id: "chipmunk-box",
    label: "Chipmunk box",
    description: "A beyond-human pinched tract and projected lips push clicks and kicks into a bright toy register.",
    settings: freezeSettings({
      lungPressure: 0.74, lipTension: 1.28, lipRounding: 1.08,
      cheekVolume: -0.18, cheekTension: 1.34, tonguePosition: 1.3,
      tongueCurl: 1.24, mouthOpening: 0.24, tractLengthM: 0.05,
      nasalMix: 0.22, earSpread: 0.3,
      leftHairLength: 0.06, rightHairLength: 0.1,
      leftHairAngle: -0.94, rightHairAngle: -0.74, eyeDivergence: -0.28, eyeClosure: 0.08,
      leftBrow: 0.8, rightBrow: 0.32,
      silliness: 0.82, decay: 0.62,
    }),
  }),
  Object.freeze({
    id: "cavern-gob",
    label: "Cavern gob",
    description: "A half-metre tract, balloon cheeks, and tube-like lips turn each consonant into a low hollow whomp.",
    settings: freezeSettings({
      lungPressure: 1.08, lipTension: -0.08, lipRounding: 1.52,
      cheekVolume: 1.82, cheekTension: -0.12, tonguePosition: -0.38,
      tongueCurl: 0.08, mouthOpening: 1.24, tractLengthM: 0.46,
      nasalMix: 0.08, earSpread: 0.72,
      leftHairLength: 0.58, rightHairLength: 0.68,
      leftHairAngle: -0.02, rightHairAngle: 0.42, eyeDivergence: 0.46, eyeClosure: 0.12,
      leftBrow: 0.34, rightBrow: 0.76,
      silliness: 0.68, decay: 1.34,
    }),
  }),
  Object.freeze({
    id: "tin-grin",
    label: "Tin grin",
    description: "Impossible surface tension and a pulled-back grin make tongue and face contacts sharp and metallic.",
    settings: freezeSettings({
      lungPressure: 0.9, lipTension: 1.48, lipRounding: -0.32,
      cheekVolume: 0.38, cheekTension: 1.52, tonguePosition: 1.08,
      tongueCurl: 1.46, mouthOpening: 0.52, tractLengthM: 0.1,
      nasalMix: 0.06, earSpread: 0.4,
      leftHairLength: 0.05, rightHairLength: 0.08,
      leftHairAngle: -0.98, rightHairAngle: -0.78, eyeDivergence: -0.42, eyeClosure: 0.18,
      leftBrow: 0.72, rightBrow: 0.7,
      silliness: 0.42, decay: 0.5,
    }),
  }),
  Object.freeze({
    id: "whisper-gremlin",
    label: "PHSHK gremlin",
    description: "Compressed lips and an over-curled tongue favor fast PHSHSHK sprays, puffs, and dry clicks.",
    settings: freezeSettings({
      lungPressure: 1.12, lipTension: 0.72, lipRounding: 0.86,
      cheekVolume: 1.08, cheekTension: 0.9, tonguePosition: 0.96,
      tongueCurl: 1.54, mouthOpening: 0.14, tractLengthM: 0.19,
      nasalMix: 0.18, earSpread: 0.56,
      leftHairLength: 0.22, rightHairLength: 0.34,
      leftHairAngle: -0.62, rightHairAngle: -0.26, eyeDivergence: 0.34, eyeClosure: 0.22,
      silliness: 0.62, decay: 0.68,
    }),
  }),
  Object.freeze({
    id: "vowel-engine",
    label: "Vowel engine",
    description: "A supple human-length tract with a mobile tongue and rounded outlet keeps HEE, HAW, and pitched DOO articulate.",
    settings: freezeSettings({
      lungPressure: 0.7, lipTension: 0.34, lipRounding: 0.74,
      cheekVolume: 0.52, cheekTension: 0.3, tonguePosition: 0.76,
      tongueCurl: 0.28, mouthOpening: 0.46, tractLengthM: 0.172,
      nasalMix: 0.1, dooPitch: 5, earSpread: 0.34,
      leftHairLength: 0.15, rightHairLength: 0.22,
      leftHairAngle: -0.78, rightHairAngle: -0.5,
      eyeDivergence: 0.16, eyeClosure: 0.04, silliness: 0.3, decay: 1.08,
    }),
  }),
  Object.freeze({
    id: "inside-out",
    label: "Inside-out singer",
    description: "A short bright tube and forward tongue emphasize the reversal between ingressive HEE and egressive HAW.",
    settings: freezeSettings({
      lungPressure: 0.92, lipTension: 0.78, lipRounding: 0.18,
      cheekVolume: 0.28, cheekTension: 0.68, tonguePosition: 1.28,
      tongueCurl: 0.74, mouthOpening: 0.3, tractLengthM: 0.115,
      nasalMix: 0.24, dooPitch: 12, earSpread: 0.24,
      leftHairLength: 0.08, rightHairLength: 0.13,
      leftHairAngle: -0.92, rightHairAngle: -0.7,
      eyeDivergence: -0.12, eyeClosure: 0.14, silliness: 0.72, decay: 0.74,
    }),
  }),
  Object.freeze({
    id: "slap-canyon",
    label: "Slap canyon",
    description: "Loose, oversized cheeks and a deep tract exaggerate alternating hand contacts, kick thumps, and their stereo tail.",
    settings: freezeSettings({
      lungPressure: 0.58, lipTension: -0.2, lipRounding: 0.26,
      cheekVolume: 1.72, cheekTension: -0.2, tonguePosition: -0.14,
      tongueCurl: 0.02, mouthOpening: 0.72, tractLengthM: 0.34,
      nasalMix: 0.08, dooPitch: -9, earSpread: 0.86,
      leftHairLength: 0.72, rightHairLength: 0.84,
      leftHairAngle: 0.32, rightHairAngle: 0.72,
      eyeDivergence: -0.35, eyeClosure: 0.02, silliness: 0.64, decay: 1.48,
    }),
  }),
  Object.freeze({
    id: "feral-baron",
    label: "Feral baron",
    description: "Relaxed folds, a long throat, and an unruly tongue favor low burps, suction kisses, and unstable DRR rolls.",
    settings: freezeSettings({
      lungPressure: 1.18, lipTension: -0.28, lipRounding: 1.1,
      cheekVolume: 1.26, cheekTension: 0.02, tonguePosition: 0.16,
      tongueCurl: 1.34, mouthOpening: 0.82, tractLengthM: 0.3,
      nasalMix: 0.32, dooPitch: -17, earSpread: 0.58,
      leftHairLength: 0.74, rightHairLength: 0.58,
      leftHairAngle: 0.52, rightHairAngle: 0.12,
      eyeDivergence: 0.7, eyeClosure: 0.28, silliness: 0.96, decay: 1.62,
    }),
  }),
  Object.freeze({
    id: "open-throat",
    label: "Open throat",
    description: "A broad modal pharynx and dropped jaw give AAH, OOH, and HOLLER room to bloom.",
    settings: freezeSettings({
      lungPressure: 0.84, lipTension: 0.3, lipRounding: 0.16,
      cheekVolume: 0.82, cheekTension: 0.26, tonguePosition: -0.3,
      tongueCurl: -0.24, mouthOpening: 1.28, tractLengthM: 0.19,
      nasalMix: 0.04, dooPitch: 0, earSpread: 0.26,
      leftHairLength: 0.3, rightHairLength: 0.38,
      leftHairAngle: -0.5, rightHairAngle: -0.14,
      eyeDivergence: 0.2, eyeClosure: 0, silliness: 0.28, decay: 1.42,
    }),
  }),
  Object.freeze({
    id: "head-voice",
    label: "Head voice",
    description: "A compact, lightly braced tract favors WAIL vibrato and a clean YODEL register break.",
    settings: freezeSettings({
      lungPressure: 0.72, lipTension: 0.78, lipRounding: 0.22,
      cheekVolume: 0.24, cheekTension: 0.72, tonguePosition: 0.72,
      tongueCurl: 0.16, mouthOpening: 0.74, tractLengthM: 0.13,
      nasalMix: 0.08, dooPitch: 9, earSpread: 0.42,
      leftHairLength: 0.2, rightHairLength: 0.32,
      leftHairAngle: -0.64, rightHairAngle: -0.32,
      eyeDivergence: 0.5, eyeClosure: 0.06, silliness: 0.4, decay: 1.26,
    }),
  }),
  Object.freeze({
    id: "humming-mask",
    label: "Humming mask",
    description: "A raised velum control and sealed lips make the nasal branch the main acoustic outlet.",
    settings: freezeSettings({
      lungPressure: 0.66, lipTension: 0.54, lipRounding: 0.34,
      cheekVolume: 0.48, cheekTension: 0.44, tonguePosition: 0.52,
      tongueCurl: 0.3, mouthOpening: 0.08, tractLengthM: 0.168,
      nasalMix: 0.92, dooPitch: -2, earSpread: 0.5,
      leftHairLength: 0.38, rightHairLength: 0.48,
      leftHairAngle: -0.38, rightHairAngle: 0.06,
      eyeDivergence: 0.36, eyeClosure: 0.16, silliness: 0.22, decay: 1.3,
    }),
  }),
  Object.freeze({
    id: "rattle-cave",
    label: "Rattle cave",
    description: "A long low tract, loose tissues, and open room exaggerate GROWL and throat RATTLE.",
    settings: freezeSettings({
      lungPressure: 1.24, lipTension: -0.18, lipRounding: 0.62,
      cheekVolume: 1.38, cheekTension: -0.08, tonguePosition: -0.22,
      tongueCurl: 0.56, mouthOpening: 0.92, tractLengthM: 0.36,
      nasalMix: 0.26, dooPitch: -14, earSpread: 0.8,
      leftHairLength: 0.82, rightHairLength: 0.92,
      leftHairAngle: 0.52, rightHairAngle: 0.88,
      eyeDivergence: 0.82, eyeClosure: 0.2, silliness: 0.9, decay: 1.7,
    }),
  }),
  Object.freeze({
    id: "sloppy-oracle",
    label: "Sloppy oracle",
    description: "A long visible tongue, loose lips, and a wet open tract favor LA-LA, DRR, PB-PB, and suction pulls.",
    settings: freezeSettings({
      lungPressure: 0.76, lipTension: -0.24, lipRounding: 0.34,
      cheekVolume: 0.9, cheekTension: -0.04, tonguePosition: 1.18,
      tongueCurl: -0.34, tongueOut: 1.28, mouthOpening: 0.94,
      tractLengthM: 0.19, nasalMix: 0.18, dooPitch: -5,
      earSpread: 0.64, leftHairLength: 0.78, rightHairLength: 0.64,
      leftHairAngle: 0.18, rightHairAngle: 0.62,
      eyeDivergence: 0.48, eyeClosure: 0.1, leftBrow: 0.82,
      rightBrow: 0.28, silliness: 0.92, decay: 1.34,
    }),
  }),
  Object.freeze({
    id: "moan-cellar",
    label: "Moan cellar",
    description: "A relaxed long tube and low fold register turn grunts and moans into warm, room-sized human shapes.",
    settings: freezeSettings({
      lungPressure: 0.68, lipTension: -0.16, lipRounding: 0.66,
      cheekVolume: 1.26, cheekTension: -0.1, tonguePosition: -0.24,
      tongueCurl: -0.18, tongueOut: 0.18, mouthOpening: 1.08,
      tractLengthM: 0.37, nasalMix: 0.22, dooPitch: -18,
      earSpread: 0.78, leftHairLength: 0.76, rightHairLength: 0.9,
      leftHairAngle: 0.44, rightHairAngle: 0.82,
      eyeDivergence: 0.74, eyeClosure: 0.24, leftBrow: 0.3,
      rightBrow: 0.78, silliness: 0.58, decay: 1.72,
    }),
  }),
]);

export function hiccupHeadPreset(id) {
  return HICCUP_HEAD_PRESETS.find((preset) => preset.id === id) ?? HICCUP_HEAD_PRESETS[0];
}

const velocity = (value) => clamp(value, 0, 1);

// Hiccup Head is one physical mouth. A column therefore represents one pose and
// one gesture, never a chord. Stronger hits win; equal hits follow the stable
// HICCUP_HEAD_SOUNDS order so imported or hostile patterns resolve predictably.
const exclusivePatternRows = (rows, freezeRows = false) => {
  const result = Object.fromEntries(HICCUP_HEAD_SOUNDS.map(({ id }) => [
    id,
    Array(HICCUP_HEAD_STEP_COUNT).fill(0),
  ]));
  for (let step = 0; step < HICCUP_HEAD_STEP_COUNT; step += 1) {
    let winnerId = "";
    let winnerVelocity = 0;
    for (const { id } of HICCUP_HEAD_SOUNDS) {
      const amount = velocity(rows?.[id]?.[step] ?? 0);
      if (amount > winnerVelocity) {
        winnerId = id;
        winnerVelocity = amount;
      }
    }
    if (winnerId) result[winnerId][step] = winnerVelocity;
  }
  if (!freezeRows) return result;
  for (const values of Object.values(result)) Object.freeze(values);
  return Object.freeze(result);
};

const freezePatternRows = (rows) => exclusivePatternRows(rows, true);

const row = (...active) => {
  const result = Array(HICCUP_HEAD_STEP_COUNT).fill(0);
  // Preset notation is a compact 16-step phrase; longer grids tile it so
  // 16/32/48/64-step views all contain a complete, playable arrangement.
  for (let phraseStart = 0; phraseStart < HICCUP_HEAD_STEP_COUNT; phraseStart += 16) {
    for (const [step, amount = 1] of active) {
      const index = phraseStart + Math.trunc(finiteOr(step, 0));
      if (index >= 0 && index < HICCUP_HEAD_STEP_COUNT) result[index] = amount;
    }
  }
  return result;
};

const phraseRow = (...phrases) => {
  const result = Array(HICCUP_HEAD_STEP_COUNT).fill(0);
  const phraseCount = Math.ceil(HICCUP_HEAD_STEP_COUNT / 16);
  for (let phraseIndex = 0; phraseIndex < phraseCount; phraseIndex += 1) {
    const active = phrases[Math.min(phraseIndex, phrases.length - 1)] ?? [];
    for (const [step, amount = 1] of active) {
      const index = phraseIndex * 16 + Math.trunc(finiteOr(step, 0));
      if (index >= 0 && index < HICCUP_HEAD_STEP_COUNT) result[index] = amount;
    }
  }
  return result;
};

export const HICCUP_HEAD_PATTERNS = Object.freeze([
  Object.freeze({
    id: "mouth-party",
    label: "Mouth party",
    rows: freezePatternRows({
      bop: row([0, 1], [8, 1], [11, 0.56], [14, 0.8]),
      boop: row([6, 0.72], [13, 0.84]),
      pop: row([3, 0.64], [10, 0.62]),
      tlik: row([2, 0.44], [7, 0.52]),
      shh: row([5, 0.45]),
      shack: row([15, 1]),
      slap: row([4, 0.68], [12, 0.82]),
      pff: row([9, 0.58]),
      snare: row([1, 0.78]),
    }),
  }),
  Object.freeze({
    id: "boots-cats",
    label: "Bops & cats",
    rows: freezePatternRows({
      bop: row([0, 1], [8, 0.94]),
      boop: row([6, 0.62], [14, 0.7]),
      tlik: row([4, 0.72], [12, 0.76]),
      shh: row([2, 0.35], [10, 0.38]),
      shack: row([15, 0.86]),
      pff: row([7, 0.45]),
      tomlo: row([1, 0.86]),
      snare: row([3, 0.82]),
      tomhi: row([9, 0.76]),
      snap: row([11, 0.72]),
      braap: row([13, 0.84]),
    }),
  }),
  Object.freeze({
    id: "cheeky-break",
    label: "Cheeky break",
    rows: freezePatternRows({
      bop: row([0, 0.9], [7, 0.54], [10, 0.78]),
      boop: row([3, 0.64], [13, 0.8]),
      pop: row([2, 0.7], [6, 0.48], [11, 0.82], [15, 0.6]),
      tlik: row([1, 0.4], [5, 0.4], [9, 0.46], [14, 0.62]),
      slap: row([4, 0.94], [12, 1]),
      pff: row([8, 0.52]),
    }),
  }),
  Object.freeze({
    id: "hush-rush",
    label: "PHSHK rush",
    rows: freezePatternRows({
      bop: row([0, 0.72], [8, 0.82]),
      pop: row([7, 0.5], [15, 0.62]),
      tlik: row([2, 0.42], [4, 0.48], [10, 0.46], [12, 0.56]),
      shh: row([1, 0.62], [9, 0.7]),
      shack: row([6, 0.9], [14, 1]),
      pff: row([5, 0.5], [13, 0.54]),
      snap: row([3, 0.72]),
      tomhi: row([11, 0.82]),
    }),
  }),
  Object.freeze({
    id: "hee-haw-loop",
    label: "HEE HAW loop",
    rows: freezePatternRows({
      kick: row([0, 1], [8, 0.92]),
      hee: row([2, 0.78], [10, 0.84]),
      haw: row([4, 0.9], [12, 1]),
      doo: row([6, 0.62], [14, 0.74]),
      smack: row([7, 0.54], [15, 0.72]),
      tomlo: row([1, 0.88]),
      tomhi: row([9, 0.82]),
      snare: row([13, 0.9]),
    }),
  }),
  Object.freeze({
    id: "two-hands",
    label: "Two hands",
    rows: freezePatternRows({
      kick: row([0, 1], [6, 0.72], [8, 0.94], [14, 0.76]),
      slap: row([2, 0.82], [10, 0.92]),
      smack: row([4, 0.88], [12, 1]),
      pop: row([3, 0.46], [11, 0.56]),
      mwah: row([7, 0.58], [15, 0.74]),
      snap: row([5, 0.78]),
      braap: row([9, 0.84]),
      snare: row([13, 0.88]),
    }),
  }),
  Object.freeze({
    id: "doo-wop",
    label: "Pitchy doo-wop",
    rows: freezePatternRows({
      kick: row([0, 0.86], [8, 0.92]),
      doo: row([1, 0.58], [3, 0.72], [5, 0.5], [7, 0.86], [9, 0.64], [11, 0.78], [15, 1]),
      hee: row([4, 0.52]),
      haw: row([12, 0.68]),
      mwah: row([14, 0.62]),
    }),
  }),
  Object.freeze({
    id: "rolled-and-rude",
    label: "Rolled & rude",
    rows: freezePatternRows({
      kick: row([0, 1], [5, 0.72], [8, 0.9]),
      drr: row([2, 0.62], [6, 0.8], [10, 0.7], [14, 1]),
      burp: row([4, 0.86], [12, 1]),
      tlik: row([3, 0.42], [11, 0.52]),
      smack: row([7, 0.64], [15, 0.82]),
      tomlo: row([1, 0.86]),
      braap: row([9, 0.9]),
      tomhi: row([13, 0.82]),
    }),
  }),
  Object.freeze({
    id: "sixteen-faces",
    label: "Sixteen faces",
    rows: freezePatternRows({
      bop: row([0, 0.88]), boop: row([1, 0.68]), pop: row([2, 0.72]),
      tlik: row([3, 0.64]), shh: row([4, 0.58]), shack: row([5, 0.78]),
      slap: row([6, 0.82]), pff: row([7, 0.66]), kick: row([8, 1]),
      smack: row([9, 0.86]), hee: row([10, 0.7]), haw: row([11, 0.76]),
      doo: row([12, 0.72]), mwah: row([13, 0.68]), drr: row([14, 0.82]),
      burp: row([15, 1]),
    }),
  }),
  Object.freeze({
    id: "open-air",
    label: "Open-air choir",
    rows: freezePatternRows({
      kick: phraseRow(
        [[0, 0.88], [8, 0.8]], [[0, 0.92], [7, 0.68]],
        [[0, 0.86], [10, 0.76]], [[0, 1], [6, 0.62], [14, 0.82]],
      ),
      aah: phraseRow([[1, 0.72], [9, 0.82]], [[2, 0.78]], [[1, 0.66], [12, 0.86]], [[3, 0.92]]),
      ooh: phraseRow([[3, 0.66], [11, 0.76]], [[5, 0.72], [13, 0.82]], [[4, 0.7]], [[8, 0.88]]),
      wail: phraseRow([[5, 0.72], [13, 0.9]], [[9, 0.84]], [[7, 0.78], [15, 0.94]], [[11, 1]]),
      hum: phraseRow([[7, 0.56], [15, 0.7]], [[3, 0.62], [15, 0.76]], [[5, 0.64]], [[1, 0.58], [13, 0.8]]),
    }),
  }),
  Object.freeze({
    id: "alpine-break",
    label: "Alpine break",
    rows: freezePatternRows({
      yodel: phraseRow(
        [[0, 0.76], [4, 0.9], [8, 0.82], [12, 1]],
        [[0, 0.82], [5, 0.94], [10, 1]],
        [[1, 0.72], [4, 0.88], [9, 0.92], [13, 1]],
        [[0, 0.9], [3, 0.76], [6, 0.94], [11, 0.82], [14, 1]],
      ),
      aah: phraseRow([[2, 0.5], [10, 0.58]], [[3, 0.56], [13, 0.64]], [[6, 0.6]], [[8, 0.68]]),
      wail: phraseRow([[6, 0.72], [14, 0.86]], [[7, 0.8], [15, 0.92]], [[11, 0.84]], [[4, 0.78], [15, 0.96]]),
      smack: phraseRow([[7, 0.46], [15, 0.6]], [[8, 0.52]], [[0, 0.48], [15, 0.66]], [[9, 0.58]]),
    }),
  }),
  Object.freeze({
    id: "rough-house",
    label: "Rough house",
    rows: freezePatternRows({
      kick: phraseRow([[0, 1], [8, 0.92]], [[0, 1], [6, 0.74], [11, 0.86]], [[0, 0.94], [9, 1]], [[0, 1], [5, 0.7], [13, 0.9]]),
      growl: phraseRow([[2, 0.72], [6, 0.86], [10, 0.78], [14, 1]], [[2, 0.78], [8, 0.9], [14, 1]], [[3, 0.82], [7, 0.72], [12, 0.96]], [[2, 0.86], [7, 0.94], [11, 0.8], [15, 1]]),
      holler: phraseRow([[4, 0.82], [12, 0.94]], [[4, 0.88], [12, 1]], [[5, 0.9], [14, 1]], [[3, 0.84], [10, 1]]),
      rattle: phraseRow([[7, 0.62], [15, 0.84]], [[5, 0.7], [15, 0.9]], [[2, 0.64], [11, 0.88]], [[6, 0.76], [14, 1]]),
    }),
  }),
  Object.freeze({
    id: "hummer-step",
    label: "Hummer step",
    rows: freezePatternRows({
      hum: phraseRow([[0, 0.7], [3, 0.54], [6, 0.66], [10, 0.72], [14, 0.86]], [[1, 0.62], [4, 0.72], [9, 0.66], [13, 0.9]], [[0, 0.76], [5, 0.64], [8, 0.72], [15, 0.94]], [[2, 0.68], [6, 0.78], [11, 0.74], [14, 1]]),
      ooh: phraseRow([[2, 0.62], [8, 0.76]], [[3, 0.68], [11, 0.8]], [[3, 0.72], [12, 0.84]], [[4, 0.76], [12, 0.9]]),
      rattle: phraseRow([[5, 0.5], [13, 0.7]], [[7, 0.58], [15, 0.76]], [[6, 0.64], [13, 0.82]], [[8, 0.68], [15, 0.9]]),
      slap: phraseRow([[4, 0.74], [12, 0.9]], [[6, 0.78], [14, 0.94]], [[4, 0.82], [11, 0.96]], [[5, 0.86], [13, 1]]),
      kick: phraseRow([[7, 0.82], [15, 1]], [[0, 0.88], [8, 1]], [[2, 0.86], [10, 1]], [[0, 0.92], [10, 1]]),
    }),
  }),
  Object.freeze({
    id: "throat-tour",
    label: "Throat tour",
    rows: freezePatternRows({
      aah: phraseRow([[0, 0.68]], [[2, 0.74]], [[4, 0.8]], [[6, 0.9]]),
      ooh: phraseRow([[2, 0.68]], [[4, 0.74]], [[6, 0.8]], [[8, 0.9]]),
      wail: phraseRow([[4, 0.76]], [[6, 0.82]], [[8, 0.88]], [[10, 1]]),
      yodel: phraseRow([[6, 0.84]], [[8, 0.9]], [[10, 0.96]], [[12, 1]]),
      growl: phraseRow([[8, 0.82]], [[10, 0.88]], [[12, 0.94]], [[14, 1]]),
      holler: phraseRow([[10, 0.9]], [[12, 0.94]], [[14, 1]], [[0, 0.96]]),
      hum: phraseRow([[12, 0.72]], [[14, 0.8]], [[0, 0.86]], [[2, 0.94]]),
      rattle: phraseRow([[14, 1]], [[0, 0.88]], [[2, 0.94]], [[4, 1]]),
      kick: phraseRow([[15, 0.86]], [[15, 0.9]], [[15, 0.94]], [[15, 1]]),
    }),
  }),
  Object.freeze({
    id: "gap-tooth-fwee",
    label: "Gap-tooth FWEE",
    rows: freezePatternRows({
      whistle: phraseRow(
        [[1, 0.58], [5, 0.78], [11, 0.92]],
        [[2, 0.68], [7, 0.86], [13, 1]],
        [[1, 0.76], [6, 0.9], [10, 0.64], [14, 1]],
        [[3, 0.82], [8, 0.7], [12, 0.94], [15, 1]],
      ),
      kick: phraseRow(
        [[0, 0.9], [8, 0.82]], [[0, 0.94], [8, 0.88]],
        [[0, 0.9], [8, 0.84]], [[0, 1], [10, 0.88]],
      ),
      tlik: phraseRow(
        [[3, 0.44], [13, 0.58]], [[4, 0.5], [11, 0.62]],
        [[3, 0.54], [12, 0.66]], [[5, 0.58], [14, 0.7]],
      ),
      slap: phraseRow([[7, 0.68]], [[10, 0.74]], [[9, 0.78]], [[6, 0.82]]),
    }),
  }),
  Object.freeze({
    id: "tongue-parade",
    label: "Tongue parade",
    rows: freezePatternRows({
      kick: phraseRow([[0, 0.9], [8, 0.84]], [[0, 0.94], [10, 0.8]], [[0, 0.9], [8, 0.88]], [[0, 1], [11, 0.82]]),
      lala: phraseRow([[1, 0.62], [5, 0.76], [9, 0.68], [13, 0.9]], [[2, 0.7], [6, 0.84], [12, 0.94]], [[1, 0.74], [7, 0.88], [14, 1]], [[2, 0.8], [6, 0.7], [10, 0.9], [15, 1]]),
      drr: phraseRow([[3, 0.58], [11, 0.76]], [[4, 0.66], [14, 0.84]], [[4, 0.72], [12, 0.9]], [[5, 0.78], [13, 0.96]]),
      pbpb: phraseRow([[4, 0.52], [12, 0.68]], [[8, 0.62]], [[5, 0.66], [10, 0.72]], [[4, 0.7], [12, 0.82]]),
      slurp: phraseRow([[7, 0.64], [15, 0.84]], [[7, 0.72], [15, 0.9]], [[3, 0.7], [11, 0.88]], [[8, 0.78], [14, 1]]),
    }),
  }),
  Object.freeze({
    id: "grunt-and-moan",
    label: "Grunt & moan",
    rows: freezePatternRows({
      kick: phraseRow([[0, 1], [8, 0.9]], [[0, 1], [7, 0.78]], [[0, 0.94], [9, 0.88]], [[0, 1], [10, 0.9]]),
      grunt: phraseRow([[2, 0.72], [6, 0.88], [11, 0.78]], [[3, 0.8], [9, 0.92], [14, 1]], [[2, 0.84], [7, 0.74], [13, 0.96]], [[3, 0.9], [8, 0.8], [15, 1]]),
      moan: phraseRow([[4, 0.68], [12, 0.84]], [[5, 0.76], [13, 0.92]], [[4, 0.8], [14, 0.96]], [[6, 0.88], [12, 1]]),
      slap: phraseRow([[7, 0.62], [15, 0.78]], [[6, 0.68], [15, 0.84]], [[8, 0.72], [15, 0.9]], [[5, 0.76], [14, 0.94]]),
    }),
  }),
]);

export function hiccupHeadPattern(id) {
  return HICCUP_HEAD_PATTERNS.find((pattern) => pattern.id === id) ?? HICCUP_HEAD_PATTERNS[0];
}

export function clonePattern(source = hiccupHeadPattern(HICCUP_HEAD_DEFAULTS.patternId).rows) {
  const rows = source?.rows ?? source;
  return exclusivePatternRows(rows);
}

export function sanitizePattern(source) {
  return clonePattern(source);
}

export function sanitizeHiccupHeadState(source = {}, fallback = HICCUP_HEAD_DEFAULTS) {
  const state = source && typeof source === "object" ? source : {};
  const base = fallback && typeof fallback === "object" ? fallback : HICCUP_HEAD_DEFAULTS;
  // `hairDelay` belonged to the former single mono echo. Accept it only as an
  // input migration source: the returned state and processor use independent
  // bilateral lengths and angles exclusively.
  const migrateLegacyHair = (candidate) => {
    const legacyValue = Number(candidate?.hairDelay);
    if (!Number.isFinite(legacyValue)) return candidate;
    const legacyLength = clamp(legacyValue);
    const legacyAngle = legacyLength * 2 - 1;
    return {
      ...candidate,
      leftHairLength: Number.isFinite(Number(candidate.leftHairLength))
        ? candidate.leftHairLength
        : legacyLength,
      rightHairLength: Number.isFinite(Number(candidate.rightHairLength))
        ? candidate.rightHairLength
        : legacyLength,
      leftHairAngle: Number.isFinite(Number(candidate.leftHairAngle))
        ? candidate.leftHairAngle
        : legacyAngle,
      rightHairAngle: Number.isFinite(Number(candidate.rightHairAngle))
        ? candidate.rightHairAngle
        : legacyAngle,
    };
  };
  const migratedState = migrateLegacyHair(state);
  const migratedBase = migrateLegacyHair(base);
  const result = {};
  for (const [key, limits] of Object.entries(HICCUP_HEAD_LIMITS)) {
    result[key] = clamp(
      finiteOr(
        migratedState[key],
        finiteOr(migratedBase[key], HICCUP_HEAD_DEFAULTS[key]),
      ),
      limits[0],
      limits[1],
    );
  }
  result.presetId = hiccupHeadPreset(migratedState.presetId ?? migratedBase.presetId).id;
  result.patternId = hiccupHeadPattern(migratedState.patternId ?? migratedBase.patternId).id;
  return result;
}

export function hiccupHeadState(presetId = HICCUP_HEAD_DEFAULTS.presetId, overrides = {}) {
  const preset = hiccupHeadPreset(presetId);
  return sanitizeHiccupHeadState({
    ...HICCUP_HEAD_DEFAULTS,
    ...preset.settings,
    ...overrides,
    presetId: preset.id,
  });
}

export function cycleStepVelocity(value) {
  const current = velocity(value);
  // A newly painted step starts with a confident roughly two-thirds strike.
  // The quiet 42% tier remains loadable from existing patterns, then advances
  // to the same 72% performance level on its next click.
  if (current <= 0.001) return 0.72;
  const index = HICCUP_HEAD_VELOCITIES.findIndex((candidate) => Math.abs(candidate - current) < 0.02);
  if (index >= 0) return HICCUP_HEAD_VELOCITIES[(index + 1) % HICCUP_HEAD_VELOCITIES.length];
  return HICCUP_HEAD_VELOCITIES.find((candidate) => candidate > current) ?? 0;
}

export function sequenceStepIntervalSeconds(tempo, swing = 0, step = 0) {
  const bpm = clamp(tempo, HICCUP_HEAD_LIMITS.tempo[0], HICCUP_HEAD_LIMITS.tempo[1]);
  const amount = clamp(swing, HICCUP_HEAD_LIMITS.swing[0], HICCUP_HEAD_LIMITS.swing[1]);
  const straightSixteenth = 15 / bpm;
  return straightSixteenth * (Math.trunc(step) % 2 === 0 ? 1 + amount : 1 - amount);
}

export function patternEventsAtStep(pattern, step) {
  const safe = sanitizePattern(pattern);
  const index = ((Math.trunc(finiteOr(step, 0)) % HICCUP_HEAD_STEP_COUNT) + HICCUP_HEAD_STEP_COUNT)
    % HICCUP_HEAD_STEP_COUNT;
  const event = HICCUP_HEAD_SOUNDS.map(({ id }) => {
    const amount = safe[id][index];
    return amount > 0 ? Object.freeze({ soundId: id, velocity: amount, step: index }) : null;
  }).find(Boolean);
  return Object.freeze(event ? [event] : []);
}

export function randomizePattern(random = Math.random, density = 0.22) {
  const chance = clamp(density, 0.04, 0.68);
  const result = clonePattern({});
  const weightedSoundIds = Object.freeze([
    "bop", "bop", "boop", "pop", "tlik", "shh", "shack", "slap", "pff",
    "kick", "kick", "smack", "hee", "haw", "doo", "mwah", "drr", "burp",
    "aah", "aah", "ooh", "wail", "yodel", "growl", "holler", "hum", "rattle",
    "whistle", "whistle", "grunt", "moan", "lala", "pbpb", "slurp",
    "hiccup", "hiccup", "eef", "eef", "snare", "snare", "snap",
    "tomlo", "tomlo", "tomhi", "tomhi", "braap", "braap",
  ]);
  for (let step = 0; step < HICCUP_HEAD_STEP_COUNT; step += 1) {
    const downbeatBias = step % 4 === 0 ? 0.15 : 0;
    if (clamp(finiteOr(random(), 0.5)) >= Math.min(0.94, chance * 2.2 + downbeatBias)) continue;
    const soundDraw = clamp(finiteOr(random(), 0.5), 0, 1 - Number.EPSILON);
    const id = weightedSoundIds[Math.floor(soundDraw * weightedSoundIds.length)];
    const draw = clamp(finiteOr(random(), 0.5));
    result[id][step] = draw < 0.34 ? 0.42 : draw < 0.72 ? 0.72 : 1;
  }
  if (!patternEventsAtStep(result, 0).length) result.bop[0] = 1;
  return result;
}

export function randomizeHiccupHeadState(source = HICCUP_HEAD_DEFAULTS, random = Math.random) {
  const state = sanitizeHiccupHeadState(source);
  const pick = (key) => {
    const [minimum, maximum] = HICCUP_HEAD_LIMITS[key];
    const draw = clamp(finiteOr(random(), 0.5));
    if (draw === 0) return minimum;
    if (draw === 1) return maximum;
    return minimum + draw * (maximum - minimum);
  };
  return sanitizeHiccupHeadState({
    ...state,
    lungPressure: pick("lungPressure"),
    lipTension: pick("lipTension"),
    lipRounding: pick("lipRounding"),
    cheekVolume: pick("cheekVolume"),
    cheekTension: pick("cheekTension"),
    tonguePosition: pick("tonguePosition"),
    tongueCurl: pick("tongueCurl"),
    tongueOut: pick("tongueOut"),
    mouthOpening: pick("mouthOpening"),
    tractLengthM: pick("tractLengthM"),
    nasalMix: pick("nasalMix"),
    dooPitch: pick("dooPitch"),
    earSpread: pick("earSpread"),
    leftHairLength: pick("leftHairLength"),
    rightHairLength: pick("rightHairLength"),
    leftHairAngle: pick("leftHairAngle"),
    rightHairAngle: pick("rightHairAngle"),
    eyeDivergence: pick("eyeDivergence"),
    eyeClosure: pick("eyeClosure"),
    leftEyeClosure: pick("leftEyeClosure"),
    rightEyeClosure: pick("rightEyeClosure"),
    leftBrow: pick("leftBrow"),
    rightBrow: pick("rightBrow"),
    silliness: pick("silliness"),
    decay: pick("decay"),
  }, state);
}

export function hiccupHeadGeometry(source = HICCUP_HEAD_DEFAULTS) {
  const state = sanitizeHiccupHeadState(source);
  const opening = Math.max(0, state.mouthOpening);
  const projection = state.lipRounding;
  const apertureCm2 = clamp(
    0.06
      + Math.pow(opening, 1.25) * 4.8
      - Math.max(0, projection) * 1.25
      + Math.max(0, -projection) * 1.5,
    0.008,
    18,
  );
  const cheekVolumeMl = clamp(
    28
      + state.cheekVolume * 132
      + Math.max(0, state.cheekVolume - 1) * 190,
    8,
    480,
  );
  const neckLengthM = clamp(
    0.0055
      + Math.max(0, projection) * 0.034
      + Math.max(0, projection - 1) * 0.032
      + Math.max(0, 1 - opening) * 0.01,
    0.0025,
    0.12,
  );
  const apertureM2 = apertureCm2 * 1e-4;
  const volumeM3 = cheekVolumeMl * 1e-6;
  const cavityFrequencyHz = clamp(
    343 / (2 * Math.PI) * Math.sqrt(apertureM2 / Math.max(1e-9, volumeM3 * neckLengthM)),
    22,
    4_200,
  );
  return Object.freeze({
    apertureCm2,
    cheekVolumeMl,
    neckLengthM,
    cavityFrequencyHz,
  });
}

// DOO pitch belongs to the folds, while ear spread and eye divergence follow
// the tract as global effects. They deliberately do not reshape oral sections.
const HICCUP_HEAD_ANATOMY_KEYS = Object.freeze([
  "lipTension",
  "lipRounding",
  "cheekVolume",
  "cheekTension",
  "tonguePosition",
  "tongueCurl",
  "tongueOut",
  "mouthOpening",
  "tractLengthM",
  "nasalMix",
]);

const oralBell = (index, center, radius) => {
  const safeRadius = Math.max(0.0001, finiteOr(radius, 1));
  const distance = Math.abs(index - finiteOr(center, 0));
  if (distance >= safeRadius) return 0;
  return 0.5 * (1 + Math.cos(Math.PI * distance / safeRadius));
};

const articulatedHiccupHeadState = (source, articulation = {}) => {
  const state = sanitizeHiccupHeadState(source);
  const overrides = Object.fromEntries(HICCUP_HEAD_ANATOMY_KEYS.flatMap((key) => (
    Number.isFinite(Number(articulation?.[key])) ? [[key, Number(articulation[key])]] : []
  )));
  return sanitizeHiccupHeadState({ ...state, ...overrides }, state);
};

const tongueBodyIndexForState = (state) => clamp(
  HICCUP_HEAD_TRACT_LANDMARKS.tongueControlStart
    + state.tonguePosition * (
      HICCUP_HEAD_TRACT_LANDMARKS.tongueControlEnd
      - HICCUP_HEAD_TRACT_LANDMARKS.tongueControlStart
    )
    + state.tongueOut * 1.4,
  2,
  HICCUP_HEAD_TRACT_SECTION_COUNT - 2,
);

const tongueBodyDiameterForState = (state) => clamp(
  3.5
    - state.tongueCurl * 1.05
    - state.tongueOut * 0.16
    - Math.max(0, state.tonguePosition - 1) * 0.18
    + Math.max(0, -state.tonguePosition) * 0.12,
  0.08,
  5.5,
);

const shapeOralDiameter = (
  diameters,
  center,
  radius,
  desiredDiameter,
  amount = 1,
) => {
  const blendAmount = clamp(amount);
  if (blendAmount <= 0) return;
  const desired = clamp(
    desiredDiameter,
    HICCUP_HEAD_TRACT_DIAMETER_FLOOR_CM,
    6.5,
  );
  for (let index = 0; index < diameters.length; index += 1) {
    const blend = oralBell(index, center, radius) * blendAmount;
    diameters[index] = clamp(
      diameters[index] + (desired - diameters[index]) * blend,
      HICCUP_HEAD_TRACT_DIAMETER_FLOOR_CM,
      6.5,
    );
  }
};

// Contacts and consonant constrictions can remove aperture, but they must
// never reopen a narrower piece of anatomy established by another contact.
const constrictOralDiameter = (
  diameters,
  center,
  radius,
  desiredDiameter,
  amount = 1,
) => {
  const blendAmount = clamp(amount);
  if (blendAmount <= 0) return;
  const desired = clamp(
    desiredDiameter,
    HICCUP_HEAD_TRACT_DIAMETER_FLOOR_CM,
    6.5,
  );
  for (let index = 0; index < diameters.length; index += 1) {
    const blend = oralBell(index, center, radius) * blendAmount;
    const constricted = Math.min(diameters[index], desired);
    diameters[index] = clamp(
      diameters[index] + (constricted - diameters[index]) * blend,
      HICCUP_HEAD_TRACT_DIAMETER_FLOOR_CM,
      6.5,
    );
  }
};

/**
 * Build the resting 44-section oral tube for one Hiccup Head state. Diameters are
 * centimeters and follow Pink Trombone's tongue-body cosine model. Hiccup Head's
 * signed/exaggerated controls extend that curve beyond the usual human zone.
 */
export function hiccupHeadBaseOralDiameters(source = HICCUP_HEAD_DEFAULTS) {
  const state = sanitizeHiccupHeadState(source);
  const tongueIndex = tongueBodyIndexForState(state);
  const tongueDiameter = tongueBodyDiameterForState(state);
  const tractRatio = state.tractLengthM / HICCUP_HEAD_DEFAULTS.tractLengthM;
  const diameterScale = clamp(
    0.84
      + Math.cbrt(Math.max(0.01, tractRatio)) * 0.12
      + (state.cheekVolume - 0.5) * 0.065,
    0.68,
    1.48,
  );
  const cheekDisplacement = clamp(
    (state.cheekVolume - 0.5) * 0.22 - (state.cheekTension - 0.5) * 0.045,
    -0.24,
    0.46,
  );
  const jawDisplacement = clamp((state.mouthOpening - 0.22) * 0.34, -0.12, 0.62);
  const diameters = Array.from({ length: HICCUP_HEAD_TRACT_SECTION_COUNT }, (_, index) => {
    const position = index / (HICCUP_HEAD_TRACT_SECTION_COUNT - 1);
    const neutral = index < 7
      ? 0.72 + index * 0.055
      : index < 12
        ? 1.105 + (index - 7) * 0.079
        : 1.5;
    const cheekWeight = oralBell(index, 25, 14);
    const jawWeight = clamp((position - 0.42) / 0.58);
    // A stable, low-amplitude tissue asymmetry prevents a mathematically
    // perfect tube without turning organic variation into another sound layer.
    const tissueWarp = 1 + state.silliness * (
      Math.sin(index * 0.79 + state.cheekVolume * 1.7) * 0.026
      + Math.sin(index * 1.73 + state.tongueCurl * 0.61) * 0.012
    );
    return clamp(
      neutral * diameterScale * tissueWarp
        + cheekDisplacement * cheekWeight
        + jawDisplacement * jawWeight,
      HICCUP_HEAD_TRACT_DIAMETER_FLOOR_CM,
      6.5,
    );
  });

  // Pink Trombone's primary tongue replaces the neutral tube with a smooth
  // cosine body instead of merely clipping it. That preserves the widened
  // cavity on the opposite side of the constriction and keeps formants mobile.
  for (
    let index = HICCUP_HEAD_TRACT_LANDMARKS.tongueBodyStart;
    index <= HICCUP_HEAD_TRACT_LANDMARKS.lipShapingStart + 1;
    index += 1
  ) {
    const interpolation = (tongueIndex - index) / 22;
    const angle = 1.1 * Math.PI * interpolation;
    const normalizedDiameter = 2 + (tongueDiameter - 2) / 1.5;
    let curve = (1.5 - normalizedDiameter + 1.7) * Math.cos(angle);
    if (index === HICCUP_HEAD_TRACT_LANDMARKS.lipShapingStart + 1) curve *= 0.8;
    if (
      index === HICCUP_HEAD_TRACT_LANDMARKS.tongueBodyStart
      || index === HICCUP_HEAD_TRACT_LANDMARKS.lipShapingStart
    ) curve *= 0.94;
    const cheekWeight = oralBell(index, 25, 14);
    const tissueWarp = 1 + state.silliness * (
      Math.sin(index * 0.79 + state.cheekVolume * 1.7) * 0.026
      + Math.sin(index * 1.73 + state.tongueCurl * 0.61) * 0.012
    );
    diameters[index] = clamp(
      (1.5 - curve) * diameterScale * tissueWarp
        + cheekDisplacement * cheekWeight
        + jawDisplacement * clamp((index - 18) / 25),
      HICCUP_HEAD_TRACT_DIAMETER_FLOOR_CM,
      6.5,
    );
  }
  return Object.freeze(diameters);
}

/**
 * Apply independent tongue-tip, one or two constriction, cheek/jaw impulse,
 * and lip shapes to the state's Pink-style base tube.
 */
export function hiccupHeadTargetOralDiameters(
  source = HICCUP_HEAD_DEFAULTS,
  articulation = {},
) {
  const state = articulatedHiccupHeadState(source, articulation);
  const diameters = Array.from(hiccupHeadBaseOralDiameters(state));
  const acousticMix = clamp(finiteOr(articulation?.acousticMix, 0));
  const acousticTongueIndex = finiteOr(
    articulation?.tongueBodyIndex,
    tongueBodyIndexForState(state),
  );
  const acousticTongueDiameter = clamp(
    finiteOr(articulation?.tongueBodyDiameterCm, tongueBodyDiameterForState(state)),
    0.08,
    5.5,
  );
  if (acousticMix > 0) {
    // Pink Trombone's vowel body is a replacement curve: narrowing one side
    // of the tongue necessarily opens the opposite cavity and moves formants.
    for (
      let index = HICCUP_HEAD_TRACT_LANDMARKS.tongueBodyStart;
      index <= HICCUP_HEAD_TRACT_LANDMARKS.lipShapingStart + 1;
      index += 1
    ) {
      const interpolation = (acousticTongueIndex - index) / 22;
      const angle = 1.1 * Math.PI * interpolation;
      const normalizedDiameter = 2 + (acousticTongueDiameter - 2) / 1.5;
      let curve = (1.5 - normalizedDiameter + 1.7) * Math.cos(angle);
      if (index === HICCUP_HEAD_TRACT_LANDMARKS.lipShapingStart + 1) curve *= 0.8;
      if (
        index === HICCUP_HEAD_TRACT_LANDMARKS.tongueBodyStart
        || index === HICCUP_HEAD_TRACT_LANDMARKS.lipShapingStart
      ) curve *= 0.94;
      const target = clamp(1.5 - curve, HICCUP_HEAD_TRACT_DIAMETER_FLOOR_CM, 6.5);
      diameters[index] = clamp(
        diameters[index] + (target - diameters[index]) * acousticMix,
        HICCUP_HEAD_TRACT_DIAMETER_FLOOR_CM,
        6.5,
      );
    }
  }
  const cheekImpulse = clamp(finiteOr(articulation?.cheekImpulse, 0), -1, 1);
  const jawImpulse = clamp(finiteOr(articulation?.jawImpulse, 0), -1, 1);

  for (let index = 0; index < diameters.length; index += 1) {
    diameters[index] = clamp(
      diameters[index]
        + cheekImpulse * 0.46 * oralBell(index, 25, 14)
        + jawImpulse * 0.38 * clamp((index - 17) / 26),
      HICCUP_HEAD_TRACT_DIAMETER_FLOOR_CM,
      6.5,
    );
  }

  const tongueIndex = tongueBodyIndexForState(state);
  const tongueTipIndex = clamp(
    tongueIndex + 5.5 + state.tongueCurl * 1.8 + state.tongueOut * 2.4,
    2,
    HICCUP_HEAD_TRACT_SECTION_COUNT - 2,
  );
  const restingTipContact = clamp((state.tongueCurl - 0.45) / 2.2, 0, 0.58);
  const tongueContact = Math.max(
    restingTipContact,
    clamp(finiteOr(articulation?.tongueContact, 0)),
  );

  const applyConstriction = (positionKey, amountKey) => {
    const amount = clamp(finiteOr(articulation?.[amountKey], 0));
    if (amount <= 0) return;
    const position = clamp(finiteOr(articulation?.[positionKey], 0.5));
    const center = 2 + position * (HICCUP_HEAD_TRACT_SECTION_COUNT - 4);
    const radius = center < 24 ? 7.2 : center < 33 ? 5.4 : 3.4;
    const desired = HICCUP_HEAD_TRACT_DIAMETER_FLOOR_CM + (1 - amount) * 1.14;
    constrictOralDiameter(
      diameters,
      center,
      radius,
      desired,
      Math.min(1, amount * 1.45),
    );
  };

  // Projection lengthens and narrows an outlet; it does not make a rounded
  // vowel lip tube vanish. True bilabial contact belongs to `lipClosure`.
  const projectedLipFloor = 0.08
    + Math.max(0, state.lipRounding) * 0.08
    + Math.max(0, state.mouthOpening) * 0.18;
  const anatomicalLipDiameter = clamp(
    Math.max(
      projectedLipFloor,
      0.035
        + state.mouthOpening * 2.35
        - Math.max(0, state.lipRounding) * 0.25
        + Math.max(0, -state.lipRounding) * 0.5,
    ),
    HICCUP_HEAD_TRACT_DIAMETER_FLOOR_CM,
    5.6,
  );
  const acousticLipDiameter = clamp(
    finiteOr(articulation?.lipDiameterCm, anatomicalLipDiameter),
    HICCUP_HEAD_TRACT_DIAMETER_FLOOR_CM,
    5.6,
  );
  const lipDiameter = anatomicalLipDiameter
    + (acousticLipDiameter - anatomicalLipDiameter) * acousticMix;
  shapeOralDiameter(
    diameters,
    HICCUP_HEAD_TRACT_LANDMARKS.lips,
    HICCUP_HEAD_TRACT_LANDMARKS.lips - HICCUP_HEAD_TRACT_LANDMARKS.lipShapingStart + 1,
    lipDiameter,
    1,
  );

  // Apply all seals after the vowel/lip tube. This preserves real contacts
  // when a projected lip or rounded-vowel target overlaps the tongue tip.
  constrictOralDiameter(
    diameters,
    tongueTipIndex,
    2.7,
    HICCUP_HEAD_TRACT_DIAMETER_FLOOR_CM + (1 - tongueContact) * 0.7,
    tongueContact,
  );
  applyConstriction("constrictionPosition", "constriction");
  applyConstriction("secondaryConstrictionPosition", "secondaryConstriction");

  const lipClosure = clamp(finiteOr(articulation?.lipClosure, 0));
  constrictOralDiameter(
    diameters,
    HICCUP_HEAD_TRACT_LANDMARKS.lips,
    4.5,
    HICCUP_HEAD_TRACT_DIAMETER_FLOOR_CM,
    lipClosure,
  );

  return Object.freeze(diameters.map((diameter) => clamp(
    diameter,
    HICCUP_HEAD_TRACT_DIAMETER_FLOOR_CM,
    6.5,
  )));
}

export function hiccupHeadOralTractProfile(
  source = HICCUP_HEAD_DEFAULTS,
  articulation = {},
) {
  const state = sanitizeHiccupHeadState(source);
  const posedState = articulatedHiccupHeadState(state, articulation);
  const baseDiameters = hiccupHeadBaseOralDiameters(state);
  const targetDiameters = hiccupHeadTargetOralDiameters(state, articulation);
  return Object.freeze({
    sectionCount: HICCUP_HEAD_TRACT_SECTION_COUNT,
    sectionLengthM: posedState.tractLengthM / HICCUP_HEAD_TRACT_SECTION_COUNT,
    tongueBodyIndex: tongueBodyIndexForState(posedState),
    tongueBodyDiameterCm: tongueBodyDiameterForState(posedState),
    tongueTipIndex: clamp(
      tongueBodyIndexForState(posedState) + 5.5 + posedState.tongueCurl * 1.8
        + posedState.tongueOut * 2.4,
      2,
      HICCUP_HEAD_TRACT_SECTION_COUNT - 2,
    ),
    lipIndex: HICCUP_HEAD_TRACT_LANDMARKS.lips,
    baseDiameters,
    targetDiameters,
  });
}

export function hiccupHeadFormants(source = HICCUP_HEAD_DEFAULTS) {
  const state = sanitizeHiccupHeadState(source);
  const lengthScale = 0.165 / state.tractLengthM;
  const front = state.tonguePosition;
  const curl = state.tongueCurl;
  const opening = state.mouthOpening;
  const rounding = state.lipRounding;
  const first = clamp(
    (260 + opening * 610 + (1 - curl) * 120 - rounding * 105) * lengthScale,
    90,
    2_200,
  );
  const second = clamp(
    (680 + front * 1_760 - rounding * 430 + opening * 90) * lengthScale,
    first + 80,
    5_800,
  );
  const third = clamp(
    (2_050 + front * 630 + curl * 380 - rounding * 210) * lengthScale,
    second + 120,
    8_800,
  );
  return Object.freeze({
    frequenciesHz: Object.freeze([first, second, third]),
    bandwidthsHz: Object.freeze([
      clamp(65 + opening * 150 + state.nasalMix * 90, 35, 1_800),
      clamp(105 + (1 - curl) * 170 + state.nasalMix * 120, 35, 2_400),
      clamp(180 + rounding * 210 + state.nasalMix * 180, 50, 3_200),
    ]),
    nasalFrequencyHz: clamp(245 * lengthScale + state.nasalMix * 110, 110, 750),
  });
}

const SOUND_POSES = Object.freeze({
  bop: freezeSettings({
    mouthOpening: 0.055, lipRounding: -0.12, lipTension: 0.76,
    cheekVolume: 0.18, tonguePosition: 0.42,
  }),
  boop: freezeSettings({
    mouthOpening: 0.07, lipRounding: 1.25, lipTension: 0.52,
    cheekVolume: 0.5, tonguePosition: -0.12,
  }),
  pop: freezeSettings({
    mouthOpening: 0.025, lipRounding: 0.42, cheekVolume: 1.28,
    cheekTension: 0.88, tonguePosition: 0.24,
  }),
  tlik: freezeSettings({
    mouthOpening: 0.36, lipRounding: -0.08, tonguePosition: 1.2,
    tongueCurl: 1.26, cheekVolume: 0.12,
  }),
  shh: freezeSettings({
    mouthOpening: 0.13, lipRounding: 0.66, lipTension: 0.82,
    cheekVolume: 0.34, tonguePosition: 0.88, tongueCurl: 1.12,
  }),
  shack: freezeSettings({
    mouthOpening: 0.72, lipRounding: -0.22, lipTension: 0.94,
    cheekVolume: 0.55, tonguePosition: -0.18, tongueCurl: 0.84,
  }),
  slap: freezeSettings({
    mouthOpening: 0.28, lipRounding: -0.18, cheekVolume: 1.44,
    cheekTension: 1.08, tonguePosition: 0.12,
  }),
  pff: freezeSettings({
    mouthOpening: 0.1, lipRounding: 0.48, lipTension: -0.18,
    cheekVolume: 0.82, tonguePosition: 0.36, tongueCurl: 0.06,
  }),
  kick: freezeSettings({
    mouthOpening: 0.2, lipRounding: 0.46, lipTension: -0.26,
    cheekVolume: 1.62, cheekTension: -0.22, tonguePosition: -0.2,
    tongueCurl: -0.08, tractLengthM: 0.28,
  }),
  smack: freezeSettings({
    mouthOpening: 0.34, lipRounding: -0.24, lipTension: 0.16,
    cheekVolume: 1.54, cheekTension: 1.14, tonguePosition: 0.04,
  }),
  hee: freezeSettings({
    mouthOpening: 0.16, lipRounding: -0.2, lipTension: 0.72,
    cheekVolume: 0.22, tonguePosition: 1.42, tongueCurl: 0.56,
  }),
  haw: freezeSettings({
    mouthOpening: 1.18, lipRounding: -0.12, lipTension: 0.24,
    cheekVolume: 0.74, tonguePosition: -0.42, tongueCurl: -0.08,
  }),
  doo: freezeSettings({
    mouthOpening: 0.22, lipRounding: 1.5, lipTension: 0.42,
    cheekVolume: 0.68, tonguePosition: 0.34, tongueCurl: 0.18,
  }),
  mwah: freezeSettings({
    mouthOpening: 0.045, lipRounding: 1.7, lipTension: 0.22,
    cheekVolume: 1.06, cheekTension: 0.5, tonguePosition: 0.08,
  }),
  drr: freezeSettings({
    mouthOpening: 0.32, lipRounding: 0.04, lipTension: 0.28,
    cheekVolume: 0.58, tonguePosition: 1.12, tongueCurl: 1.36,
  }),
  burp: freezeSettings({
    mouthOpening: 0.82, lipRounding: 0.38, lipTension: -0.3,
    cheekVolume: 1.2, cheekTension: -0.22, tonguePosition: -0.28,
    tongueCurl: -0.18, tractLengthM: 0.3,
  }),
  aah: freezeSettings({
    mouthOpening: 1.28, lipRounding: -0.08, lipTension: 0.3,
    cheekVolume: 0.82, cheekTension: 0.22, tonguePosition: -0.42,
    tongueCurl: -0.28,
  }),
  ooh: freezeSettings({
    mouthOpening: 0.54, lipRounding: 1.52, lipTension: 0.38,
    cheekVolume: 0.92, cheekTension: 0.28, tonguePosition: 0.02,
    tongueCurl: -0.12,
  }),
  wail: freezeSettings({
    mouthOpening: 0.86, lipRounding: -0.16, lipTension: 0.94,
    cheekVolume: 0.3, cheekTension: 0.78, tonguePosition: 1.08,
    tongueCurl: 0.16,
  }),
  yodel: freezeSettings({
    mouthOpening: 1.02, lipRounding: -0.08, lipTension: 0.74,
    cheekVolume: 0.48, cheekTension: 0.62, tonguePosition: 0.32,
    tongueCurl: 0.04,
  }),
  growl: freezeSettings({
    mouthOpening: 0.74, lipRounding: 0.82, lipTension: -0.18,
    cheekVolume: 1.24, cheekTension: -0.12, tonguePosition: -0.14,
    tongueCurl: 0.14, tractLengthM: 0.28,
  }),
  holler: freezeSettings({
    mouthOpening: 1.46, lipRounding: -0.26, lipTension: 1.08,
    cheekVolume: 0.72, cheekTension: 0.96, tonguePosition: -0.38,
    tongueCurl: -0.2,
  }),
  hum: freezeSettings({
    mouthOpening: 0.035, lipRounding: 0.38, lipTension: 0.62,
    cheekVolume: 0.48, cheekTension: 0.42, tonguePosition: 0.7,
    tongueCurl: 0.18, nasalMix: 1,
  }),
  rattle: freezeSettings({
    mouthOpening: 0.9, lipRounding: 0.24, lipTension: -0.12,
    cheekVolume: 1.08, cheekTension: 0.02, tonguePosition: -0.24,
    tongueCurl: 0.7, tractLengthM: 0.25,
  }),
  whistle: freezeSettings({
    mouthOpening: 0.12, lipRounding: 0.62, lipTension: 0.92,
    cheekVolume: 0.38, cheekTension: 0.68, tonguePosition: 1.34,
    tongueCurl: 1.08, tongueOut: 0.04, nasalMix: 0.015,
  }),
  grunt: freezeSettings({
    mouthOpening: 0.46, lipRounding: 0.42, lipTension: -0.14,
    cheekVolume: 0.9, cheekTension: 0.02, tonguePosition: -0.28,
    tongueCurl: -0.12, tongueOut: 0.08, tractLengthM: 0.31,
  }),
  moan: freezeSettings({
    mouthOpening: 0.82, lipRounding: 0.76, lipTension: -0.08,
    cheekVolume: 1.04, cheekTension: 0.08, tonguePosition: -0.1,
    tongueCurl: -0.18, tongueOut: 0.18, tractLengthM: 0.27,
  }),
  lala: freezeSettings({
    mouthOpening: 0.68, lipRounding: -0.08, lipTension: 0.26,
    cheekVolume: 0.54, tonguePosition: 1.18, tongueCurl: 0.82,
    tongueOut: 0.78,
  }),
  pbpb: freezeSettings({
    mouthOpening: 0.1, lipRounding: 0.48, lipTension: -0.26,
    cheekVolume: 0.86, cheekTension: 0.04, tonguePosition: 0.18,
    tongueCurl: -0.08, tongueOut: 0.08,
  }),
  slurp: freezeSettings({
    mouthOpening: 0.74, lipRounding: 0.18, lipTension: -0.12,
    cheekVolume: 0.72, cheekTension: 0.12, tonguePosition: 1.38,
    tongueCurl: -0.42, tongueOut: 1.48,
  }),
  hiccup: freezeSettings({
    mouthOpening: 0.42, lipRounding: 0.12, lipTension: 0.34,
    cheekVolume: 0.78, cheekTension: 0.3, tonguePosition: 0.04,
    tongueCurl: 0.22, tongueOut: 0.06, tractLengthM: 0.245,
  }),
  eef: freezeSettings({
    mouthOpening: 0.2, lipRounding: -0.24, lipTension: 0.82,
    cheekVolume: 0.3, cheekTension: 0.58, tonguePosition: 1.36,
    tongueCurl: 0.46, tongueOut: 0.12, tractLengthM: 0.205,
  }),
  snare: freezeSettings({
    mouthOpening: 0.18, lipRounding: -0.15, lipTension: 1.05,
    cheekVolume: 0.36, cheekTension: 0.92, tonguePosition: 1.05,
    tongueCurl: 0.78, tongueOut: 0.05,
  }),
  snap: freezeSettings({
    mouthOpening: 0.4, lipRounding: -0.12, lipTension: 0.52,
    cheekVolume: 0.4, cheekTension: 1.18, tonguePosition: 1.34,
    tongueCurl: 1.5, tongueOut: 0.12,
  }),
  tomlo: freezeSettings({
    mouthOpening: 0.3, lipRounding: 1.05, lipTension: 0.08,
    cheekVolume: 1.52, cheekTension: -0.12, tonguePosition: -0.35,
    tongueCurl: -0.15, tongueOut: 0.04, tractLengthM: 0.34,
  }),
  tomhi: freezeSettings({
    mouthOpening: 0.36, lipRounding: 0.38, lipTension: 0.38,
    cheekVolume: 0.72, cheekTension: 0.88, tonguePosition: 0.32,
    tongueCurl: 0.2, tongueOut: 0.05, tractLengthM: 0.145,
  }),
  braap: freezeSettings({
    mouthOpening: 0.12, lipRounding: 0.85, lipTension: -0.22,
    cheekVolume: 1.32, cheekTension: -0.16, tonguePosition: -0.15,
    tongueCurl: -0.12, tongueOut: 0.04, tractLengthM: 0.28,
  }),
});

// Canonical Pink Trombone vowel geometry. These acoustic keyframes move the
// actual tube independently from the more exaggerated face illustration.
const SOUND_ACOUSTIC_POSES = Object.freeze({
  hee: freezeSettings({ tongueBodyIndex: 27.4, tongueBodyDiameterCm: 2.25, lipDiameterCm: 3 }),
  haw: freezeSettings({ tongueBodyIndex: 13, tongueBodyDiameterCm: 2.4, lipDiameterCm: 3 }),
  doo: freezeSettings({ tongueBodyIndex: 23, tongueBodyDiameterCm: 2.1, lipDiameterCm: 0.5 }),
  aah: freezeSettings({ tongueBodyIndex: 13, tongueBodyDiameterCm: 2.4, lipDiameterCm: 3 }),
  ooh: freezeSettings({ tongueBodyIndex: 17.7, tongueBodyDiameterCm: 2.05, lipDiameterCm: 0.95 }),
  wail: freezeSettings({ tongueBodyIndex: 27.4, tongueBodyDiameterCm: 2.25, lipDiameterCm: 3 }),
  growl: freezeSettings({ tongueBodyIndex: 17.7, tongueBodyDiameterCm: 2.05, lipDiameterCm: 0.95 }),
  holler: freezeSettings({ tongueBodyIndex: 13, tongueBodyDiameterCm: 2.4, lipDiameterCm: 3 }),
  hum: freezeSettings({ tongueBodyIndex: 23, tongueBodyDiameterCm: 2.1, lipDiameterCm: 0.5 }),
  rattle: freezeSettings({ tongueBodyIndex: 13, tongueBodyDiameterCm: 2.4, lipDiameterCm: 2.6 }),
  whistle: freezeSettings({ tongueBodyIndex: 26.2, tongueBodyDiameterCm: 1.7, lipDiameterCm: 0.42 }),
  grunt: freezeSettings({ tongueBodyIndex: 14, tongueBodyDiameterCm: 2.3, lipDiameterCm: 2.1 }),
  moan: freezeSettings({ tongueBodyIndex: 17.7, tongueBodyDiameterCm: 2.05, lipDiameterCm: 1.7 }),
  lala: freezeSettings({ tongueBodyIndex: 27.4, tongueBodyDiameterCm: 1.8, lipDiameterCm: 2.4 }),
  pbpb: freezeSettings({ tongueBodyIndex: 20, tongueBodyDiameterCm: 2.2, lipDiameterCm: 0.34 }),
  slurp: freezeSettings({ tongueBodyIndex: 29, tongueBodyDiameterCm: 1.62, lipDiameterCm: 2.2 }),
  hiccup: freezeSettings({ tongueBodyIndex: 16.2, tongueBodyDiameterCm: 1.9, lipDiameterCm: 2.15 }),
  eef: freezeSettings({ tongueBodyIndex: 28.2, tongueBodyDiameterCm: 1.72, lipDiameterCm: 2.55 }),
  snare: freezeSettings({ tongueBodyIndex: 26.2, tongueBodyDiameterCm: 1.55, lipDiameterCm: 2.1 }),
  snap: freezeSettings({ tongueBodyIndex: 29.1, tongueBodyDiameterCm: 1.42, lipDiameterCm: 1.8 }),
  tomlo: freezeSettings({ tongueBodyIndex: 14, tongueBodyDiameterCm: 2.45, lipDiameterCm: 1.6 }),
  tomhi: freezeSettings({ tongueBodyIndex: 21, tongueBodyDiameterCm: 2.15, lipDiameterCm: 1.4 }),
  braap: freezeSettings({ tongueBodyIndex: 17, tongueBodyDiameterCm: 2.2, lipDiameterCm: 0.34 }),
});

const freezeGestureCurve = (points) => Object.freeze(points.map(([phase, value]) => (
  Object.freeze([clamp(phase), finiteOr(value, 0)])
)));

const GESTURE_CURVE_DEFAULTS = Object.freeze({
  poseMix: Object.freeze([[0, 0], [0.08, 1], [0.78, 1], [1, 0]]),
  pressure: Object.freeze([[0, 0], [1, 0]]),
  lipClosure: Object.freeze([[0, 0], [1, 0]]),
  lipImpulse: Object.freeze([[0, 0], [1, 0]]),
  tongueContact: Object.freeze([[0, 0], [1, 0]]),
  constrictionPosition: Object.freeze([[0, 0.5], [1, 0.5]]),
  constriction: Object.freeze([[0, 0], [1, 0]]),
  secondaryConstrictionPosition: Object.freeze([[0, 0.5], [1, 0.5]]),
  secondaryConstriction: Object.freeze([[0, 0], [1, 0]]),
  velum: Object.freeze([[0, 0.04], [1, 0.04]]),
  turbulence: Object.freeze([[0, 0], [1, 0]]),
  suction: Object.freeze([[0, 0], [1, 0]]),
  cheekImpulse: Object.freeze([[0, 0], [1, 0]]),
  jawImpulse: Object.freeze([[0, 0], [1, 0]]),
  voicing: Object.freeze([[0, 0], [1, 0]]),
  aspiration: Object.freeze([[0, 0], [1, 0]]),
  lipFlutter: Object.freeze([[0, 0], [1, 0]]),
  tongueTrill: Object.freeze([[0, 0], [1, 0]]),
  tongueExtension: Object.freeze([[0, 0], [1, 0]]),
  throatRattle: Object.freeze([[0, 0], [1, 0]]),
  registerLift: Object.freeze([[0, 0], [1, 0]]),
  toothJet: Object.freeze([[0, 0], [1, 0]]),
  breathDirection: Object.freeze([[0, 0], [1, 0]]),
  diaphragmCatch: Object.freeze([[0, 0], [1, 0]]),
});

const defineHiccupHeadGesture = (id, label, curves) => Object.freeze({
  id,
  label,
  curves: Object.freeze(Object.fromEntries(HICCUP_HEAD_GESTURE_CHANNELS.map((channel) => [
    channel,
    freezeGestureCurve(curves[channel] ?? GESTURE_CURVE_DEFAULTS[channel]),
  ]))),
});

/**
 * Normalized, explicitly timed articulator trajectories. A processor samples
 * these at its current sample frame; no UI or animation clock is involved.
 */
export const HICCUP_HEAD_GESTURE_TRAJECTORIES = Object.freeze({
  bop: defineHiccupHeadGesture("bop", "bilabial kick", {
    poseMix: [[0, 0], [0.045, 1], [0.7, 1], [1, 0]],
    pressure: [[0, 0.12], [0.08, 0.74], [0.29, 1], [0.36, 0.42], [0.7, 0.08], [1, 0]],
    lipClosure: [[0, 0.9], [0.05, 1], [0.3, 1], [0.355, 0], [1, 0]],
    lipImpulse: [[0, 0], [0.3, 0], [0.35, 1], [0.43, 0.08], [1, 0]],
    constrictionPosition: [[0, 0.995], [1, 0.995]],
    constriction: [[0, 0.82], [0.05, 1], [0.3, 1], [0.355, 0], [1, 0]],
    turbulence: [[0, 0], [0.31, 0], [0.355, 0.62], [0.48, 0.06], [1, 0]],
    cheekImpulse: [[0, 0.12], [0.3, 0.3], [0.36, -0.16], [0.52, 0], [1, 0]],
    jawImpulse: [[0, 0], [0.35, 0.2], [0.5, 0], [1, 0]],
    voicing: [[0, 0], [0.34, 0.28], [0.64, 0.08], [1, 0]],
    aspiration: [[0, 0.05], [0.35, 0.34], [0.54, 0], [1, 0]],
  }),
  boop: defineHiccupHeadGesture("boop", "rounded lip kick", {
    poseMix: [[0, 0], [0.055, 1], [0.82, 1], [1, 0]],
    pressure: [[0, 0.1], [0.11, 0.76], [0.37, 1], [0.45, 0.46], [0.82, 0.1], [1, 0]],
    lipClosure: [[0, 0.88], [0.06, 1], [0.38, 1], [0.435, 0], [1, 0]],
    lipImpulse: [[0, 0], [0.38, 0], [0.43, 0.92], [0.56, 0.06], [1, 0]],
    constrictionPosition: [[0, 0.99], [1, 0.99]],
    constriction: [[0, 0.82], [0.07, 1], [0.38, 1], [0.44, 0], [1, 0]],
    turbulence: [[0, 0], [0.39, 0], [0.44, 0.42], [0.6, 0.04], [1, 0]],
    cheekImpulse: [[0, 0.08], [0.38, 0.34], [0.46, -0.12], [0.66, 0], [1, 0]],
    jawImpulse: [[0, 0], [0.44, 0.16], [0.62, 0], [1, 0]],
    voicing: [[0, 0], [0.42, 0.48], [0.82, 0.18], [1, 0]],
    aspiration: [[0, 0.03], [0.44, 0.22], [0.63, 0], [1, 0]],
  }),
  pop: defineHiccupHeadGesture("pop", "inward cheek pop", {
    poseMix: [[0, 0], [0.04, 1], [0.72, 1], [1, 0]],
    pressure: [[0, 0.05], [0.18, 0.32], [0.36, 0.54], [0.44, 0.18], [0.72, 0.04], [1, 0]],
    lipClosure: [[0, 0.72], [0.08, 0.92], [0.37, 0.92], [0.42, 0], [1, 0]],
    lipImpulse: [[0, 0], [0.36, 0], [0.415, 0.74], [0.52, 0], [1, 0]],
    constrictionPosition: [[0, 0.965], [1, 0.965]],
    constriction: [[0, 0.68], [0.1, 0.9], [0.37, 0.9], [0.42, 0], [1, 0]],
    turbulence: [[0, 0], [0.38, 0], [0.42, 0.35], [0.54, 0], [1, 0]],
    suction: [[0, 0.12], [0.16, 0.62], [0.35, 1], [0.43, 0], [1, 0]],
    cheekImpulse: [[0, -0.08], [0.34, -0.72], [0.405, -1], [0.46, 0.66], [0.64, 0], [1, 0]],
    jawImpulse: [[0, 0], [0.42, 0.12], [0.56, 0], [1, 0]],
    aspiration: [[0, 0], [0.42, 0.18], [0.55, 0], [1, 0]],
  }),
  tlik: defineHiccupHeadGesture("tlik", "palatal tongue click", {
    poseMix: [[0, 0], [0.035, 1], [0.75, 1], [1, 0]],
    pressure: [[0, 0.02], [0.22, 0.18], [0.49, 0.3], [0.58, 0.08], [1, 0]],
    tongueContact: [[0, 0.2], [0.15, 0.72], [0.26, 1], [0.49, 1], [0.545, 0], [1, 0]],
    constrictionPosition: [[0, 0.78], [0.48, 0.82], [0.58, 0.86], [1, 0.86]],
    constriction: [[0, 0.18], [0.17, 0.72], [0.27, 1], [0.49, 1], [0.545, 0], [1, 0]],
    secondaryConstrictionPosition: [[0, 0.5], [1, 0.5]],
    secondaryConstriction: [[0, 0.56], [0.14, 1], [0.49, 1], [0.58, 1], [0.61, 0], [1, 0]],
    turbulence: [[0, 0], [0.5, 0], [0.545, 0.56], [0.64, 0], [1, 0]],
    suction: [[0, 0.18], [0.18, 0.64], [0.45, 1], [0.545, 0], [1, 0]],
    cheekImpulse: [[0, 0], [0.42, -0.18], [0.55, 0.12], [0.67, 0], [1, 0]],
    jawImpulse: [[0, 0], [0.535, 0.34], [0.67, 0], [1, 0]],
    aspiration: [[0, 0], [0.54, 0.24], [0.64, 0], [1, 0]],
  }),
  shh: defineHiccupHeadGesture("shh", "PH puff · SH groove · K cut", {
    poseMix: [[0, 0], [0.035, 1], [0.9, 1], [1, 0]],
    pressure: [[0, 0.12], [0.08, 0.74], [0.18, 1], [0.68, 0.82], [0.84, 1], [0.9, 0.14], [1, 0]],
    lipClosure: [[0, 0.88], [0.05, 1], [0.17, 1], [0.225, 0], [1, 0]],
    lipImpulse: [[0, 0], [0.17, 0], [0.22, 1], [0.31, 0], [1, 0]],
    tongueContact: [[0, 0], [0.23, 0.28], [0.66, 0.35], [0.74, 0.78], [0.82, 1], [0.875, 0], [1, 0]],
    constrictionPosition: [[0, 0.73], [1, 0.73]],
    constriction: [[0, 0], [0.21, 0], [0.28, 0.62], [0.66, 0.66], [0.78, 0], [1, 0]],
    secondaryConstrictionPosition: [[0, 0.5], [1, 0.5]],
    secondaryConstriction: [[0, 0], [0.65, 0], [0.75, 0.96], [0.83, 1], [0.875, 0], [1, 0]],
    velum: [[0, 0.04], [0.68, 0.06], [0.82, 0.02], [1, 0.04]],
    turbulence: [[0, 0.02], [0.18, 0.08], [0.23, 0.58], [0.31, 1], [0.68, 0.88], [0.76, 0.18], [0.875, 0.82], [0.95, 0.04], [1, 0]],
    suction: [[0, 0.04], [0.17, 0.12], [0.24, 0], [0.71, 0], [0.81, 0.2], [0.88, 0], [1, 0]],
    cheekImpulse: [[0, 0.1], [0.2, 0.34], [0.27, -0.14], [0.48, 0], [0.84, 0.18], [0.94, 0], [1, 0]],
    jawImpulse: [[0, 0], [0.22, 0.12], [0.36, 0], [0.84, 0], [0.875, 0.46], [0.97, 0], [1, 0]],
    voicing: [[0, 0], [0.18, 0.06], [0.31, 0], [1, 0]],
    aspiration: [[0, 0.16], [0.22, 0.5], [0.32, 0.9], [0.69, 0.82], [0.77, 0.12], [0.88, 0.58], [0.96, 0], [1, 0]],
  }),
  shack: defineHiccupHeadGesture("shack", "SH groove · open A · K release", {
    poseMix: [[0, 0], [0.035, 1], [0.82, 1], [1, 0]],
    pressure: [[0, 0.14], [0.07, 0.76], [0.2, 0.9], [0.54, 0.72], [0.7, 1], [0.8, 0.14], [1, 0]],
    tongueContact: [[0, 0.2], [0.08, 0.42], [0.31, 0.22], [0.53, 0.18], [0.62, 0.88], [0.72, 1], [0.79, 0], [1, 0]],
    constrictionPosition: [[0, 0.72], [1, 0.72]],
    constriction: [[0, 0.36], [0.08, 0.62], [0.28, 0.58], [0.38, 0], [1, 0]],
    secondaryConstrictionPosition: [[0, 0.5], [1, 0.5]],
    secondaryConstriction: [[0, 0], [0.54, 0], [0.63, 0.94], [0.72, 1], [0.79, 0], [1, 0]],
    turbulence: [[0, 0.12], [0.08, 0.78], [0.2, 0.92], [0.34, 0.28], [0.54, 0.04], [0.72, 0], [0.79, 0.86], [0.9, 0.04], [1, 0]],
    suction: [[0, 0], [0.61, 0.14], [0.72, 0.2], [0.8, 0], [1, 0]],
    cheekImpulse: [[0, 0.06], [0.18, 0.16], [0.4, 0.04], [0.72, 0.18], [0.88, 0], [1, 0]],
    jawImpulse: [[0, 0.04], [0.16, 0.2], [0.38, 0.72], [0.56, 0.82], [0.7, 0.32], [0.79, 0.64], [0.92, 0], [1, 0]],
    voicing: [[0, 0], [0.34, 0.22], [0.56, 0.3], [0.7, 0], [1, 0]],
    aspiration: [[0, 0.24], [0.1, 0.76], [0.3, 0.58], [0.44, 0.12], [0.72, 0], [0.79, 0.56], [0.9, 0], [1, 0]],
  }),
  slap: defineHiccupHeadGesture("slap", "face-pat impulse", {
    poseMix: [[0, 0], [0.025, 1], [0.62, 1], [1, 0]],
    pressure: [[0, 0], [0.09, 0.12], [0.3, 0.04], [1, 0]],
    turbulence: [[0, 0], [0.075, 0.34], [0.18, 0.06], [1, 0]],
    cheekImpulse: [[0, 0], [0.055, -0.18], [0.09, -1], [0.15, 0.7], [0.32, -0.2], [0.58, 0], [1, 0]],
    jawImpulse: [[0, 0], [0.09, 0.42], [0.23, -0.1], [0.5, 0], [1, 0]],
    aspiration: [[0, 0], [0.08, 0.22], [0.2, 0], [1, 0]],
  }),
  pff: defineHiccupHeadGesture("pff", "breathy lip flutter", {
    poseMix: [[0, 0], [0.09, 0.42], [0.2, 1], [0.78, 1], [1, 0]],
    pressure: [[0, 0], [0.08, 0.16], [0.2, 0.72], [0.34, 0.94], [0.72, 0.78], [0.9, 0.18], [1, 0]],
    lipClosure: [[0, 0.86], [0.08, 0.96], [0.18, 0.7], [0.3, 0.18], [0.43, 0.66], [0.56, 0.14], [0.69, 0.58], [0.8, 0.08], [0.9, 0.3], [0.96, 0], [1, 0]],
    lipImpulse: [[0, 0], [0.18, 0.32], [0.31, 0.06], [0.43, 0.28], [0.56, 0.05], [0.68, 0.24], [0.82, 0], [1, 0]],
    constrictionPosition: [[0, 0.995], [1, 0.995]],
    constriction: [[0, 0.82], [0.08, 0.94], [0.2, 0.48], [0.31, 0.1], [0.43, 0.52], [0.56, 0.08], [0.69, 0.44], [0.82, 0.04], [0.96, 0], [1, 0]],
    turbulence: [[0, 0], [0.12, 0.04], [0.24, 0.2], [0.74, 0.16], [0.9, 0.04], [1, 0]],
    cheekImpulse: [[0, 0], [0.18, 0.22], [0.34, 0.12], [0.52, 0.18], [0.78, 0.08], [0.94, 0], [1, 0]],
    jawImpulse: [[0, 0], [0.18, 0.1], [0.54, 0.06], [0.86, 0], [1, 0]],
    voicing: [[0, 0], [0.12, 0.18], [0.3, 0.34], [0.76, 0.28], [0.92, 0], [1, 0]],
    aspiration: [[0, 0], [0.1, 0.08], [0.24, 0.3], [0.74, 0.24], [0.92, 0.03], [1, 0]],
    lipFlutter: [[0, 0], [0.08, 0.18], [0.2, 0.82], [0.76, 0.76], [0.92, 0.04], [1, 0]],
  }),
  kick: defineHiccupHeadGesture("kick", "low-pressure body kick", {
    poseMix: [[0, 0], [0.018, 1], [0.58, 1], [1, 0]],
    pressure: [[0, 0.04], [0.05, 0.18], [0.14, 0.1], [0.36, 0.025], [1, 0]],
    cheekImpulse: [[0, 0], [0.035, 0.18], [0.07, -1], [0.13, 0.82], [0.28, -0.28], [0.58, 0], [1, 0]],
    jawImpulse: [[0, 0], [0.055, -0.5], [0.1, 0.72], [0.24, -0.18], [0.5, 0], [1, 0]],
    voicing: [[0, 0], [0.045, 0.24], [0.16, 0.08], [0.32, 0], [1, 0]],
    aspiration: [[0, 0], [0.06, 0.1], [0.18, 0], [1, 0]],
  }),
  smack: defineHiccupHeadGesture("smack", "opposite-hand cheek impulse", {
    poseMix: [[0, 0], [0.018, 1], [0.64, 1], [1, 0]],
    pressure: [[0, 0], [0.09, 0.08], [0.28, 0.025], [1, 0]],
    turbulence: [[0, 0], [0.06, 0.42], [0.16, 0.08], [1, 0]],
    cheekImpulse: [[0, 0], [0.04, -0.14], [0.075, 1], [0.14, -0.78], [0.3, 0.24], [0.62, 0], [1, 0]],
    jawImpulse: [[0, 0], [0.075, -0.46], [0.2, 0.14], [0.5, 0], [1, 0]],
    aspiration: [[0, 0], [0.065, 0.18], [0.17, 0], [1, 0]],
  }),
  hee: defineHiccupHeadGesture("hee", "ingressive HEE", {
    poseMix: [[0, 0], [0.025, 1], [0.84, 1], [1, 0]],
    pressure: [[0, 0.08], [0.04, 0.72], [0.16, 0.9], [0.7, 0.68], [0.88, 0.08], [1, 0]],
    constrictionPosition: [[0, 0.7], [1, 0.7]],
    constriction: [[0, 0.28], [0.08, 0.48], [0.74, 0.44], [0.9, 0.08], [1, 0]],
    velum: [[0, 0.08], [0.14, 0.18], [0.74, 0.12], [1, 0.06]],
    turbulence: [[0, 0.06], [0.05, 0.28], [0.72, 0.16], [0.9, 0], [1, 0]],
    cheekImpulse: [[0, 0], [0.08, -0.14], [0.4, -0.06], [0.86, 0], [1, 0]],
    jawImpulse: [[0, 0], [0.08, -0.18], [0.72, -0.08], [0.9, 0], [1, 0]],
    voicing: [[0, 0], [0.035, 0.72], [0.16, 1], [0.7, 0.86], [0.88, 0.06], [1, 0]],
    aspiration: [[0, 0.1], [0.04, 0.48], [0.18, 0.28], [0.76, 0.2], [0.9, 0], [1, 0]],
  }),
  haw: defineHiccupHeadGesture("haw", "egressive HAW", {
    poseMix: [[0, 0], [0.025, 1], [0.86, 1], [1, 0]],
    pressure: [[0, 0.08], [0.05, 0.78], [0.18, 1], [0.72, 0.72], [0.9, 0.08], [1, 0]],
    velum: [[0, 0.08], [0.12, 0.12], [0.78, 0.1], [1, 0.06]],
    turbulence: [[0, 0.08], [0.045, 0.34], [0.18, 0.16], [0.78, 0.08], [0.92, 0], [1, 0]],
    cheekImpulse: [[0, 0], [0.1, 0.18], [0.72, 0.1], [0.9, 0], [1, 0]],
    jawImpulse: [[0, 0.1], [0.08, 0.86], [0.7, 0.72], [0.9, 0], [1, 0]],
    voicing: [[0, 0], [0.04, 0.62], [0.15, 0.9], [0.74, 0.76], [0.9, 0.04], [1, 0]],
    aspiration: [[0, 0.18], [0.04, 0.64], [0.22, 0.3], [0.78, 0.18], [0.92, 0], [1, 0]],
  }),
  doo: defineHiccupHeadGesture("doo", "pitched rounded DOO", {
    poseMix: [[0, 0], [0.025, 1], [0.9, 1], [1, 0]],
    pressure: [[0, 0.08], [0.045, 0.68], [0.14, 0.88], [0.8, 0.68], [0.92, 0.06], [1, 0]],
    constrictionPosition: [[0, 0.98], [1, 0.98]],
    constriction: [[0, 0.12], [0.1, 0.28], [0.82, 0.24], [0.94, 0], [1, 0]],
    cheekImpulse: [[0, 0], [0.12, 0.12], [0.78, 0.08], [0.92, 0], [1, 0]],
    jawImpulse: [[0, 0], [0.08, 0.1], [0.82, 0.08], [0.94, 0], [1, 0]],
    voicing: [[0, 0], [0.035, 0.7], [0.12, 1], [0.8, 0.9], [0.92, 0.04], [1, 0]],
    aspiration: [[0, 0.06], [0.05, 0.18], [0.82, 0.1], [0.94, 0], [1, 0]],
  }),
  mwah: defineHiccupHeadGesture("mwah", "sealed suction kiss", {
    poseMix: [[0, 0], [0.03, 1], [0.82, 1], [1, 0]],
    pressure: [[0, 0.02], [0.2, 0.12], [0.46, 0.24], [0.55, 0.62], [0.76, 0.34], [0.9, 0.04], [1, 0]],
    lipClosure: [[0, 0.82], [0.08, 1], [0.48, 1], [0.54, 0], [1, 0]],
    lipImpulse: [[0, 0], [0.48, 0], [0.53, 1], [0.64, 0.08], [1, 0]],
    constrictionPosition: [[0, 0.995], [1, 0.995]],
    constriction: [[0, 0.76], [0.08, 1], [0.48, 1], [0.54, 0], [1, 0]],
    turbulence: [[0, 0], [0.48, 0], [0.54, 0.38], [0.68, 0.04], [1, 0]],
    suction: [[0, 0.16], [0.12, 0.68], [0.42, 1], [0.54, 0], [1, 0]],
    cheekImpulse: [[0, -0.08], [0.38, -0.58], [0.5, -0.88], [0.56, 0.62], [0.74, 0], [1, 0]],
    jawImpulse: [[0, 0], [0.52, 0.32], [0.68, 0.08], [0.82, 0], [1, 0]],
    voicing: [[0, 0], [0.53, 0.62], [0.78, 0.42], [0.9, 0], [1, 0]],
    aspiration: [[0, 0], [0.52, 0.2], [0.68, 0], [1, 0]],
  }),
  drr: defineHiccupHeadGesture("drr", "pressure-driven tongue roll", {
    poseMix: [[0, 0], [0.025, 1], [0.9, 1], [1, 0]],
    pressure: [[0, 0.08], [0.05, 0.76], [0.16, 1], [0.82, 0.82], [0.94, 0.06], [1, 0]],
    tongueContact: [[0, 0.14], [0.08, 0.34], [0.84, 0.3], [0.94, 0], [1, 0]],
    constrictionPosition: [[0, 0.84], [1, 0.84]],
    constriction: [[0, 0.18], [0.08, 0.58], [0.84, 0.54], [0.94, 0], [1, 0]],
    turbulence: [[0, 0.04], [0.06, 0.34], [0.84, 0.42], [0.95, 0], [1, 0]],
    cheekImpulse: [[0, 0], [0.12, 0.1], [0.84, 0.06], [0.94, 0], [1, 0]],
    voicing: [[0, 0], [0.045, 0.48], [0.18, 0.72], [0.84, 0.6], [0.94, 0], [1, 0]],
    aspiration: [[0, 0.1], [0.05, 0.5], [0.82, 0.44], [0.94, 0], [1, 0]],
    tongueTrill: [[0, 0], [0.045, 0.62], [0.14, 1], [0.84, 0.92], [0.94, 0.04], [1, 0]],
  }),
  burp: defineHiccupHeadGesture("burp", "irregular low gastric fold", {
    poseMix: [[0, 0], [0.025, 1], [0.92, 1], [1, 0]],
    pressure: [[0, 0.04], [0.04, 0.62], [0.16, 1], [0.31, 0.52], [0.45, 0.92], [0.68, 0.38], [0.8, 0.72], [0.94, 0.04], [1, 0]],
    velum: [[0, 0.08], [0.18, 0.3], [0.78, 0.22], [1, 0.08]],
    turbulence: [[0, 0.05], [0.06, 0.28], [0.3, 0.14], [0.46, 0.34], [0.82, 0.16], [0.95, 0], [1, 0]],
    cheekImpulse: [[0, 0], [0.08, 0.34], [0.28, -0.14], [0.48, 0.24], [0.72, -0.08], [0.92, 0], [1, 0]],
    jawImpulse: [[0, 0.04], [0.08, 0.58], [0.34, 0.38], [0.5, 0.72], [0.78, 0.46], [0.94, 0], [1, 0]],
    voicing: [[0, 0], [0.035, 0.58], [0.14, 1], [0.32, 0.5], [0.46, 0.92], [0.68, 0.42], [0.82, 0.78], [0.94, 0], [1, 0]],
    aspiration: [[0, 0.12], [0.04, 0.46], [0.26, 0.3], [0.5, 0.52], [0.82, 0.36], [0.95, 0], [1, 0]],
  }),
  aah: defineHiccupHeadGesture("aah", "open modal AAH", {
    poseMix: [[0, 0], [0.055, 1], [0.9, 1], [1, 0]],
    pressure: [[0, 0.04], [0.055, 0.68], [0.16, 0.92], [0.78, 0.78], [0.93, 0.08], [1, 0]],
    velum: [[0, 0.025], [0.12, 0.045], [0.84, 0.035], [1, 0.02]],
    cheekImpulse: [[0, 0], [0.12, 0.1], [0.8, 0.06], [0.94, 0], [1, 0]],
    jawImpulse: [[0, 0.08], [0.09, 0.82], [0.78, 0.7], [0.93, 0], [1, 0]],
    voicing: [[0, 0], [0.045, 0.56], [0.13, 1], [0.8, 0.92], [0.94, 0.04], [1, 0]],
    aspiration: [[0, 0.1], [0.05, 0.36], [0.18, 0.16], [0.82, 0.12], [0.95, 0], [1, 0]],
  }),
  ooh: defineHiccupHeadGesture("ooh", "rounded open OOH", {
    poseMix: [[0, 0], [0.055, 1], [0.91, 1], [1, 0]],
    pressure: [[0, 0.04], [0.06, 0.66], [0.17, 0.9], [0.8, 0.74], [0.94, 0.06], [1, 0]],
    constrictionPosition: [[0, 0.97], [1, 0.97]],
    constriction: [[0, 0.04], [0.12, 0.22], [0.82, 0.18], [0.95, 0], [1, 0]],
    velum: [[0, 0.025], [0.14, 0.06], [0.84, 0.045], [1, 0.02]],
    cheekImpulse: [[0, 0], [0.15, 0.14], [0.82, 0.08], [0.94, 0], [1, 0]],
    jawImpulse: [[0, 0.04], [0.1, 0.42], [0.8, 0.34], [0.94, 0], [1, 0]],
    voicing: [[0, 0], [0.045, 0.6], [0.14, 1], [0.82, 0.9], [0.94, 0.03], [1, 0]],
    aspiration: [[0, 0.08], [0.05, 0.3], [0.19, 0.12], [0.84, 0.09], [0.95, 0], [1, 0]],
  }),
  wail: defineHiccupHeadGesture("wail", "head-voice WAIL", {
    poseMix: [[0, 0], [0.045, 1], [0.92, 1], [1, 0]],
    pressure: [[0, 0.05], [0.05, 0.72], [0.18, 1], [0.82, 0.84], [0.95, 0.06], [1, 0]],
    velum: [[0, 0.03], [0.14, 0.08], [0.86, 0.05], [1, 0.02]],
    cheekImpulse: [[0, 0], [0.11, -0.08], [0.8, -0.04], [0.95, 0], [1, 0]],
    jawImpulse: [[0, 0.04], [0.08, 0.56], [0.84, 0.64], [0.95, 0], [1, 0]],
    voicing: [[0, 0], [0.035, 0.58], [0.12, 1], [0.84, 0.94], [0.95, 0.03], [1, 0]],
    aspiration: [[0, 0.14], [0.045, 0.4], [0.2, 0.2], [0.85, 0.14], [0.96, 0], [1, 0]],
    registerLift: [[0, 0], [0.12, 0.72], [0.84, 0.78], [0.95, 0], [1, 0]],
  }),
  yodel: defineHiccupHeadGesture("yodel", "chest-head register break", {
    poseMix: [[0, 0], [0.04, 1], [0.93, 1], [1, 0]],
    pressure: [[0, 0.05], [0.05, 0.72], [0.16, 0.94], [0.86, 0.78], [0.96, 0.05], [1, 0]],
    velum: [[0, 0.035], [0.16, 0.08], [0.82, 0.05], [1, 0.02]],
    jawImpulse: [[0, 0.06], [0.08, 0.72], [0.34, 0.66], [0.4, 0.42], [0.66, 0.52], [0.72, 0.76], [0.94, 0], [1, 0]],
    voicing: [[0, 0], [0.035, 0.62], [0.12, 1], [0.34, 0.94], [0.39, 0.7], [0.44, 0.98], [0.66, 0.9], [0.71, 0.68], [0.76, 0.96], [0.95, 0.03], [1, 0]],
    aspiration: [[0, 0.12], [0.04, 0.34], [0.2, 0.14], [0.36, 0.24], [0.46, 0.12], [0.68, 0.25], [0.78, 0.12], [0.96, 0], [1, 0]],
    registerLift: [[0, 0], [0.34, 0], [0.405, 1], [0.64, 1], [0.705, 0], [0.82, 0], [0.87, 1], [0.95, 0], [1, 0]],
  }),
  growl: defineHiccupHeadGesture("growl", "subharmonic fold growl", {
    poseMix: [[0, 0], [0.04, 1], [0.93, 1], [1, 0]],
    pressure: [[0, 0.05], [0.05, 0.7], [0.16, 1], [0.84, 0.86], [0.96, 0.05], [1, 0]],
    constrictionPosition: [[0, 0.24], [1, 0.24]],
    constriction: [[0, 0.08], [0.12, 0.34], [0.84, 0.3], [0.96, 0], [1, 0]],
    velum: [[0, 0.05], [0.18, 0.2], [0.84, 0.16], [1, 0.04]],
    turbulence: [[0, 0.04], [0.08, 0.26], [0.86, 0.34], [0.96, 0], [1, 0]],
    cheekImpulse: [[0, 0], [0.12, 0.2], [0.42, -0.08], [0.7, 0.14], [0.94, 0], [1, 0]],
    jawImpulse: [[0, 0.06], [0.09, 0.5], [0.86, 0.42], [0.96, 0], [1, 0]],
    voicing: [[0, 0], [0.035, 0.58], [0.13, 1], [0.86, 0.9], [0.96, 0.02], [1, 0]],
    aspiration: [[0, 0.12], [0.05, 0.36], [0.84, 0.28], [0.96, 0], [1, 0]],
  }),
  holler: defineHiccupHeadGesture("holler", "high-pressure belt", {
    poseMix: [[0, 0], [0.035, 1], [0.92, 1], [1, 0]],
    pressure: [[0, 0.08], [0.035, 0.82], [0.12, 1], [0.82, 0.98], [0.95, 0.08], [1, 0]],
    velum: [[0, 0.025], [0.12, 0.04], [0.88, 0.03], [1, 0.02]],
    turbulence: [[0, 0.04], [0.04, 0.28], [0.18, 0.12], [0.84, 0.08], [0.96, 0], [1, 0]],
    cheekImpulse: [[0, 0], [0.08, 0.18], [0.84, 0.12], [0.95, 0], [1, 0]],
    jawImpulse: [[0, 0.12], [0.06, 1], [0.86, 0.9], [0.96, 0], [1, 0]],
    voicing: [[0, 0], [0.025, 0.64], [0.1, 1], [0.86, 0.98], [0.96, 0.03], [1, 0]],
    aspiration: [[0, 0.18], [0.035, 0.46], [0.16, 0.2], [0.86, 0.14], [0.96, 0], [1, 0]],
  }),
  hum: defineHiccupHeadGesture("hum", "closed-lip nasal hum", {
    poseMix: [[0, 0], [0.04, 1], [0.92, 1], [1, 0]],
    pressure: [[0, 0.04], [0.05, 0.62], [0.16, 0.86], [0.82, 0.72], [0.95, 0.04], [1, 0]],
    lipClosure: [[0, 0.7], [0.045, 1], [0.9, 1], [0.96, 0], [1, 0]],
    constrictionPosition: [[0, 0.995], [1, 0.995]],
    constriction: [[0, 0.62], [0.05, 1], [0.9, 1], [0.96, 0], [1, 0]],
    velum: [[0, 0.72], [0.08, 1], [0.9, 0.98], [1, 0.4]],
    cheekImpulse: [[0, 0], [0.14, 0.08], [0.86, 0.05], [0.96, 0], [1, 0]],
    voicing: [[0, 0], [0.035, 0.62], [0.13, 1], [0.86, 0.9], [0.96, 0.02], [1, 0]],
    aspiration: [[0, 0.06], [0.05, 0.16], [0.86, 0.1], [0.96, 0], [1, 0]],
  }),
  rattle: defineHiccupHeadGesture("rattle", "pressure-driven throat rattle", {
    poseMix: [[0, 0], [0.035, 1], [0.93, 1], [1, 0]],
    pressure: [[0, 0.06], [0.04, 0.78], [0.14, 1], [0.86, 0.88], [0.96, 0.05], [1, 0]],
    constrictionPosition: [[0, 0.22], [0.36, 0.26], [0.72, 0.2], [1, 0.23]],
    constriction: [[0, 0.1], [0.08, 0.54], [0.86, 0.5], [0.96, 0], [1, 0]],
    velum: [[0, 0.05], [0.16, 0.22], [0.86, 0.16], [1, 0.04]],
    turbulence: [[0, 0.05], [0.06, 0.36], [0.88, 0.48], [0.97, 0], [1, 0]],
    cheekImpulse: [[0, 0], [0.12, 0.14], [0.5, -0.06], [0.82, 0.1], [0.95, 0], [1, 0]],
    jawImpulse: [[0, 0.06], [0.08, 0.58], [0.86, 0.5], [0.96, 0], [1, 0]],
    voicing: [[0, 0], [0.035, 0.46], [0.14, 0.8], [0.86, 0.68], [0.96, 0], [1, 0]],
    aspiration: [[0, 0.14], [0.04, 0.48], [0.86, 0.4], [0.96, 0], [1, 0]],
    throatRattle: [[0, 0], [0.045, 0.62], [0.14, 1], [0.86, 0.94], [0.96, 0.03], [1, 0]],
  }),
  whistle: defineHiccupHeadGesture("whistle", "missing-incisor edge whistle", {
    poseMix: [[0, 0], [0.045, 1], [0.94, 1], [1, 0]],
    pressure: [[0, 0.03], [0.05, 0.58], [0.16, 0.92], [0.86, 0.8], [0.96, 0.04], [1, 0]],
    tongueContact: [[0, 0.04], [0.08, 0.26], [0.88, 0.24], [0.96, 0], [1, 0]],
    constrictionPosition: [[0, 0.91], [1, 0.91]],
    constriction: [[0, 0.05], [0.08, 0.54], [0.88, 0.5], [0.96, 0], [1, 0]],
    velum: [[0, 0.015], [0.12, 0.025], [0.9, 0.018], [1, 0.01]],
    turbulence: [[0, 0.01], [0.06, 0.18], [0.9, 0.12], [0.97, 0], [1, 0]],
    cheekImpulse: [[0, 0], [0.12, 0.08], [0.86, 0.04], [0.96, 0], [1, 0]],
    jawImpulse: [[0, 0.02], [0.08, 0.16], [0.86, 0.12], [0.96, 0], [1, 0]],
    aspiration: [[0, 0.05], [0.05, 0.5], [0.18, 0.34], [0.88, 0.28], [0.97, 0], [1, 0]],
    toothJet: [[0, 0], [0.03, 0], [0.045, 0.5], [0.14, 1], [0.88, 0.92], [0.96, 0.02], [1, 0]],
  }),
  grunt: defineHiccupHeadGesture("grunt", "short chest grunt", {
    poseMix: [[0, 0], [0.04, 1], [0.72, 1], [1, 0]],
    pressure: [[0, 0.04], [0.05, 0.74], [0.18, 1], [0.56, 0.62], [0.8, 0.08], [1, 0]],
    constrictionPosition: [[0, 0.18], [1, 0.22]],
    constriction: [[0, 0.18], [0.08, 0.56], [0.58, 0.48], [0.82, 0], [1, 0]],
    velum: [[0, 0.08], [0.14, 0.26], [0.68, 0.2], [1, 0.06]],
    turbulence: [[0, 0], [0.08, 0.1], [0.62, 0.08], [0.82, 0], [1, 0]],
    cheekImpulse: [[0, 0], [0.08, 0.22], [0.42, 0.1], [0.76, 0], [1, 0]],
    jawImpulse: [[0, -0.04], [0.08, 0.34], [0.58, 0.18], [0.82, 0], [1, 0]],
    voicing: [[0, 0], [0.035, 0.68], [0.14, 1], [0.58, 0.72], [0.82, 0], [1, 0]],
    aspiration: [[0, 0.02], [0.06, 0.16], [0.58, 0.1], [0.82, 0], [1, 0]],
    throatRattle: [[0, 0], [0.04, 0.48], [0.16, 0.84], [0.56, 0.56], [0.8, 0], [1, 0]],
  }),
  moan: defineHiccupHeadGesture("moan", "open sliding moan", {
    poseMix: [[0, 0], [0.08, 0.62], [0.2, 1], [0.9, 1], [1, 0]],
    pressure: [[0, 0], [0.08, 0.34], [0.22, 0.82], [0.76, 0.72], [0.94, 0.12], [1, 0]],
    constrictionPosition: [[0, 0.34], [0.58, 0.42], [1, 0.3]],
    constriction: [[0, 0.04], [0.18, 0.2], [0.8, 0.14], [0.96, 0], [1, 0]],
    velum: [[0, 0.08], [0.18, 0.34], [0.82, 0.28], [1, 0.06]],
    cheekImpulse: [[0, 0], [0.2, 0.14], [0.82, 0.08], [0.96, 0], [1, 0]],
    jawImpulse: [[0, 0], [0.1, 0.38], [0.42, 0.72], [0.84, 0.54], [0.96, 0], [1, 0]],
    voicing: [[0, 0], [0.06, 0.46], [0.2, 0.92], [0.82, 0.82], [0.96, 0], [1, 0]],
    aspiration: [[0, 0], [0.08, 0.22], [0.82, 0.18], [0.96, 0], [1, 0]],
    tongueExtension: [[0, 0], [0.2, 0.18], [0.82, 0.14], [1, 0]],
  }),
  lala: defineHiccupHeadGesture("lala", "rolling lateral LA voice", {
    poseMix: [[0, 0], [0.04, 1], [0.92, 1], [1, 0]],
    pressure: [[0, 0.04], [0.06, 0.66], [0.18, 0.9], [0.86, 0.78], [0.96, 0], [1, 0]],
    tongueContact: [[0, 0.08], [0.1, 0.66], [0.2, 0.08], [0.31, 0.7], [0.42, 0.08], [0.54, 0.68], [0.65, 0.06], [0.77, 0.64], [0.88, 0.04], [1, 0]],
    constrictionPosition: [[0, 0.82], [1, 0.88]],
    constriction: [[0, 0.06], [0.1, 0.46], [0.2, 0.1], [0.31, 0.5], [0.42, 0.09], [0.54, 0.47], [0.65, 0.08], [0.77, 0.44], [0.9, 0], [1, 0]],
    velum: [[0, 0.05], [0.16, 0.12], [0.86, 0.1], [1, 0.04]],
    turbulence: [[0, 0], [0.16, 0.08], [0.86, 0.06], [0.96, 0], [1, 0]],
    jawImpulse: [[0, 0], [0.08, 0.42], [0.88, 0.36], [0.96, 0], [1, 0]],
    voicing: [[0, 0], [0.04, 0.76], [0.14, 1], [0.86, 0.94], [0.96, 0], [1, 0]],
    aspiration: [[0, 0], [0.08, 0.16], [0.86, 0.1], [0.96, 0], [1, 0]],
    tongueTrill: [[0, 0], [0.08, 0.22], [0.86, 0.18], [0.96, 0], [1, 0]],
    tongueExtension: [[0, 0], [0.06, 0.58], [0.18, 0.92], [0.86, 0.82], [0.97, 0], [1, 0]],
  }),
  pbpb: defineHiccupHeadGesture("pbpb", "voiced PB-PB lip burble", {
    poseMix: [[0, 0], [0.06, 1], [0.9, 1], [1, 0]],
    pressure: [[0, 0], [0.08, 0.28], [0.2, 0.82], [0.82, 0.72], [0.94, 0.08], [1, 0]],
    lipClosure: [[0, 0.86], [0.08, 1], [0.17, 0.12], [0.27, 0.92], [0.37, 0.1], [0.48, 0.88], [0.58, 0.08], [0.69, 0.84], [0.8, 0.06], [0.9, 0.5], [0.96, 0], [1, 0]],
    lipImpulse: [[0, 0], [0.16, 0.42], [0.22, 0], [0.36, 0.38], [0.42, 0], [0.57, 0.34], [0.63, 0], [0.79, 0.3], [0.86, 0], [1, 0]],
    constrictionPosition: [[0, 0.995], [1, 0.995]],
    constriction: [[0, 0.78], [0.08, 0.96], [0.18, 0.12], [0.28, 0.88], [0.38, 0.1], [0.49, 0.84], [0.59, 0.08], [0.7, 0.8], [0.82, 0.05], [0.96, 0], [1, 0]],
    turbulence: [[0, 0], [0.16, 0.08], [0.82, 0.06], [0.94, 0], [1, 0]],
    cheekImpulse: [[0, 0], [0.18, 0.16], [0.4, 0.1], [0.62, 0.12], [0.84, 0.06], [0.96, 0], [1, 0]],
    voicing: [[0, 0], [0.08, 0.34], [0.2, 0.78], [0.82, 0.7], [0.94, 0], [1, 0]],
    aspiration: [[0, 0], [0.12, 0.12], [0.82, 0.08], [0.94, 0], [1, 0]],
    lipFlutter: [[0, 0], [0.08, 0.24], [0.2, 0.82], [0.82, 0.72], [0.94, 0], [1, 0]],
  }),
  slurp: defineHiccupHeadGesture("slurp", "wet tongue pull", {
    poseMix: [[0, 0], [0.04, 1], [0.86, 1], [1, 0]],
    pressure: [[0, 0.02], [0.16, 0.18], [0.46, 0.28], [0.62, 0.08], [1, 0]],
    tongueContact: [[0, 0.12], [0.12, 0.68], [0.32, 1], [0.52, 0.94], [0.61, 0.08], [0.78, 0.42], [0.9, 0], [1, 0]],
    constrictionPosition: [[0, 0.76], [0.54, 0.92], [1, 0.82]],
    constriction: [[0, 0.08], [0.14, 0.52], [0.34, 0.9], [0.52, 0.84], [0.62, 0.06], [0.8, 0.3], [0.92, 0], [1, 0]],
    secondaryConstrictionPosition: [[0, 0.5], [1, 0.5]],
    secondaryConstriction: [[0, 0.1], [0.18, 0.62], [0.5, 0.74], [0.64, 0], [1, 0]],
    suction: [[0, 0.08], [0.18, 0.58], [0.42, 1], [0.58, 0.94], [0.64, 0], [0.8, 0.32], [0.9, 0], [1, 0]],
    turbulence: [[0, 0], [0.56, 0], [0.64, 0.24], [0.78, 0.08], [0.86, 0.18], [0.94, 0], [1, 0]],
    cheekImpulse: [[0, 0], [0.36, -0.14], [0.62, 0.2], [0.82, -0.06], [0.94, 0], [1, 0]],
    jawImpulse: [[0, 0], [0.08, 0.48], [0.72, 0.38], [0.92, 0], [1, 0]],
    aspiration: [[0, 0], [0.58, 0.2], [0.72, 0.06], [0.86, 0.12], [0.94, 0], [1, 0]],
    tongueExtension: [[0, 0], [0.06, 0.48], [0.2, 1], [0.56, 0.94], [0.68, 0.34], [0.82, 0.7], [0.94, 0], [1, 0]],
  }),
  hiccup: defineHiccupHeadGesture("hiccup", "diaphragm glottal catch", {
    poseMix: [[0, 0], [0.035, 1], [0.76, 1], [1, 0]],
    pressure: [[0, 0.04], [0.07, 0.48], [0.2, 0.9], [0.31, 1], [0.355, 0.22], [0.43, 0.88], [0.62, 0.34], [0.8, 0.04], [1, 0]],
    constrictionPosition: [[0, 0.13], [0.32, 0.16], [1, 0.2]],
    constriction: [[0, 0.16], [0.08, 0.64], [0.22, 0.94], [0.315, 1], [0.36, 0.08], [0.48, 0.36], [0.72, 0.06], [1, 0]],
    velum: [[0, 0.08], [0.18, 0.22], [0.58, 0.14], [1, 0.05]],
    turbulence: [[0, 0], [0.31, 0.02], [0.365, 0.24], [0.52, 0.08], [0.76, 0], [1, 0]],
    cheekImpulse: [[0, 0], [0.18, -0.12], [0.34, 0.26], [0.52, -0.08], [0.76, 0], [1, 0]],
    jawImpulse: [[0, -0.08], [0.28, -0.14], [0.36, 0.74], [0.52, 0.12], [0.78, 0], [1, 0]],
    voicing: [[0, 0], [0.28, 0.08], [0.345, 0.74], [0.43, 1], [0.58, 0.42], [0.76, 0], [1, 0]],
    aspiration: [[0, 0], [0.3, 0.04], [0.36, 0.3], [0.5, 0.13], [0.72, 0], [1, 0]],
    throatRattle: [[0, 0], [0.27, 0.12], [0.35, 0.58], [0.48, 0.3], [0.68, 0], [1, 0]],
    breathDirection: [[0, -0.28], [0.28, -0.18], [0.33, 0], [0.37, 1], [1, 1]],
    diaphragmCatch: [[0, 0.08], [0.08, 0.62], [0.2, 1], [0.315, 1], [0.36, 0.04], [0.45, 0.5], [0.53, 0], [1, 0]],
  }),
  eef: defineHiccupHeadGesture("eef", "folded breath reversal", {
    poseMix: [[0, 0], [0.04, 1], [0.9, 1], [1, 0]],
    pressure: [[0, 0.08], [0.05, 0.72], [0.17, 1], [0.38, 0.86], [0.48, 0.18], [0.56, 0.88], [0.76, 0.68], [0.92, 0.05], [1, 0]],
    tongueContact: [[0, 0.08], [0.08, 0.28], [0.8, 0.24], [0.94, 0], [1, 0]],
    constrictionPosition: [[0, 0.72], [0.48, 0.77], [1, 0.7]],
    constriction: [[0, 0.18], [0.08, 0.52], [0.4, 0.58], [0.49, 0.78], [0.57, 0.44], [0.84, 0.38], [0.95, 0], [1, 0]],
    velum: [[0, 0.06], [0.16, 0.14], [0.8, 0.1], [1, 0.04]],
    turbulence: [[0, 0.02], [0.06, 0.2], [0.4, 0.12], [0.49, 0.04], [0.57, 0.22], [0.84, 0.1], [0.95, 0], [1, 0]],
    cheekImpulse: [[0, 0], [0.12, -0.16], [0.44, -0.06], [0.56, 0.18], [0.82, 0.08], [0.95, 0], [1, 0]],
    jawImpulse: [[0, -0.04], [0.1, -0.2], [0.43, -0.1], [0.56, 0.28], [0.82, 0.14], [0.95, 0], [1, 0]],
    voicing: [[0, 0.08], [0.045, 0.68], [0.14, 1], [0.4, 0.88], [0.49, 0.18], [0.56, 0.82], [0.78, 0.66], [0.93, 0], [1, 0]],
    aspiration: [[0, 0.04], [0.05, 0.26], [0.38, 0.18], [0.48, 0.03], [0.56, 0.28], [0.82, 0.14], [0.94, 0], [1, 0]],
    registerLift: [[0, 0.12], [0.38, 0.28], [0.52, 0.08], [0.78, 0.18], [1, 0]],
    breathDirection: [[0, -1], [0.4, -1], [0.48, -0.16], [0.525, 0], [0.58, 1], [1, 1]],
    diaphragmCatch: [[0, 0], [0.39, 0.12], [0.48, 0.62], [0.54, 0.06], [0.62, 0], [1, 0]],
  }),
  snare: defineHiccupHeadGesture("snare", "rear K release into SH mouth snare", {
    poseMix: [[0, 0], [0.03, 1], [0.76, 1], [1, 0]],
    pressure: [[0, 0.08], [0.06, 0.72], [0.22, 1], [0.31, 0.9], [0.48, 0.54], [0.76, 0.08], [1, 0]],
    tongueContact: [[0, 0.28], [0.08, 0.72], [0.24, 0.9], [0.295, 0.16], [0.66, 0.12], [1, 0]],
    constrictionPosition: [[0, 0.73], [1, 0.73]],
    constriction: [[0, 0.08], [0.22, 0.18], [0.3, 0.68], [0.62, 0.62], [0.78, 0.08], [1, 0]],
    secondaryConstrictionPosition: [[0, 0.5], [1, 0.5]],
    secondaryConstriction: [[0, 0.86], [0.06, 1], [0.25, 1], [0.3, 0.02], [1, 0]],
    velum: [[0, 0.02], [0.72, 0.025], [1, 0.02]],
    turbulence: [[0, 0], [0.27, 0.02], [0.305, 1], [0.46, 0.94], [0.66, 0.46], [0.8, 0], [1, 0]],
    cheekImpulse: [[0, 0.04], [0.26, 0.22], [0.305, -0.26], [0.43, 0.12], [0.7, 0], [1, 0]],
    jawImpulse: [[0, -0.08], [0.29, 0.06], [0.43, 0.28], [0.74, 0], [1, 0]],
    aspiration: [[0, 0.02], [0.28, 0.16], [0.31, 1], [0.52, 0.72], [0.74, 0.1], [0.82, 0], [1, 0]],
  }),
  snap: defineHiccupHeadGesture("snap", "palatal suction snap", {
    poseMix: [[0, 0], [0.025, 1], [0.64, 1], [1, 0]],
    pressure: [[0, 0.02], [0.16, 0.12], [0.34, 0.22], [0.5, 0.04], [1, 0]],
    tongueContact: [[0, 0.3], [0.08, 0.82], [0.17, 1], [0.34, 1], [0.375, 0.1], [0.44, 0.72], [0.475, 0], [1, 0]],
    constrictionPosition: [[0, 0.86], [0.42, 0.9], [1, 0.88]],
    constriction: [[0, 0.3], [0.08, 0.78], [0.18, 1], [0.34, 1], [0.375, 0.04], [0.44, 0.62], [0.475, 0], [1, 0]],
    secondaryConstrictionPosition: [[0, 0.64], [1, 0.64]],
    secondaryConstriction: [[0, 0.18], [0.1, 0.72], [0.34, 0.76], [0.39, 0], [1, 0]],
    turbulence: [[0, 0], [0.35, 0], [0.38, 0.34], [0.46, 0.08], [0.48, 0.22], [0.58, 0], [1, 0]],
    suction: [[0, 0.08], [0.1, 0.62], [0.24, 1], [0.35, 1], [0.38, 0], [0.44, 0.3], [0.48, 0], [1, 0]],
    cheekImpulse: [[0, 0], [0.28, -0.16], [0.37, 0.34], [0.47, -0.12], [0.58, 0], [1, 0]],
    jawImpulse: [[0, 0], [0.36, 0.18], [0.48, -0.06], [0.62, 0], [1, 0]],
    aspiration: [[0, 0], [0.37, 0.18], [0.48, 0.08], [0.58, 0], [1, 0]],
  }),
  tomlo: defineHiccupHeadGesture("tomlo", "low compliant cheek tom", {
    poseMix: [[0, 0], [0.025, 1], [0.8, 1], [1, 0]],
    pressure: [[0, 0.02], [0.08, 0.16], [0.24, 0.08], [0.62, 0.02], [1, 0]],
    turbulence: [[0, 0], [0.17, 0.08], [0.28, 0], [1, 0]],
    cheekImpulse: [[0, 0.04], [0.12, 0.22], [0.18, -1], [0.25, 0.82], [0.48, -0.26], [0.8, 0], [1, 0]],
    jawImpulse: [[0, -0.12], [0.16, -0.34], [0.23, 0.48], [0.56, 0.08], [0.82, 0], [1, 0]],
    voicing: [[0, 0], [0.17, 0.34], [0.27, 0.56], [0.52, 0.16], [0.72, 0], [1, 0]],
    aspiration: [[0, 0], [0.18, 0.1], [0.34, 0], [1, 0]],
  }),
  tomhi: defineHiccupHeadGesture("tomhi", "high taut cheek tom", {
    poseMix: [[0, 0], [0.02, 1], [0.68, 1], [1, 0]],
    pressure: [[0, 0.02], [0.06, 0.14], [0.2, 0.06], [0.5, 0.01], [1, 0]],
    turbulence: [[0, 0], [0.135, 0.18], [0.27, 0], [1, 0]],
    cheekImpulse: [[0, 0], [0.09, 0.16], [0.14, -0.92], [0.19, 0.66], [0.28, -0.28], [0.38, 0.18], [0.64, 0], [1, 0]],
    jawImpulse: [[0, -0.06], [0.13, -0.2], [0.19, 0.3], [0.44, 0], [1, 0]],
    voicing: [[0, 0], [0.14, 0.2], [0.22, 0.36], [0.42, 0.06], [0.56, 0], [1, 0]],
    aspiration: [[0, 0], [0.15, 0.08], [0.3, 0], [1, 0]],
  }),
  braap: defineHiccupHeadGesture("braap", "voiced loose-lip BRRAP", {
    poseMix: [[0, 0], [0.05, 1], [0.88, 1], [1, 0]],
    pressure: [[0, 0.04], [0.06, 0.26], [0.16, 0.94], [0.38, 0.76], [0.56, 1], [0.8, 0.82], [0.92, 0.14], [1, 0]],
    lipClosure: [[0, 0.84], [0.06, 0.96], [0.14, 0.3], [0.34, 0.62], [0.5, 0.18], [0.68, 0.54], [0.84, 0.12], [0.95, 0], [1, 0]],
    lipImpulse: [[0, 0], [0.12, 0.24], [0.24, 0.04], [0.36, 0.18], [0.52, 0.03], [0.68, 0.14], [0.86, 0], [1, 0]],
    constrictionPosition: [[0, 0.995], [1, 0.995]],
    constriction: [[0, 0.78], [0.06, 0.94], [0.15, 0.26], [0.34, 0.58], [0.5, 0.16], [0.68, 0.5], [0.84, 0.08], [0.96, 0], [1, 0]],
    turbulence: [[0, 0], [0.14, 0.04], [0.82, 0.1], [0.94, 0], [1, 0]],
    cheekImpulse: [[0, 0], [0.15, 0.24], [0.4, 0.12], [0.62, 0.2], [0.9, 0], [1, 0]],
    jawImpulse: [[0, 0], [0.13, 0.12], [0.8, 0.07], [0.94, 0], [1, 0]],
    voicing: [[0, 0], [0.1, 0.36], [0.18, 0.9], [0.78, 0.84], [0.92, 0], [1, 0]],
    aspiration: [[0, 0], [0.12, 0.12], [0.78, 0.16], [0.92, 0], [1, 0]],
    lipFlutter: [[0, 0], [0.06, 0.24], [0.14, 1], [0.8, 0.94], [0.91, 0.2], [0.97, 0], [1, 0]],
  }),
});

export function sampleHiccupHeadGestureCurve(points, normalizedPhase) {
  if (!Array.isArray(points) || points.length === 0) return 0;
  const phase = clamp(normalizedPhase);
  const first = points[0];
  if (phase <= finiteOr(first?.[0], 0)) return finiteOr(first?.[1], 0);
  for (let index = 1; index < points.length; index += 1) {
    const right = points[index];
    const rightPhase = clamp(finiteOr(right?.[0], 1));
    if (phase > rightPhase) continue;
    const left = points[index - 1];
    const leftPhase = clamp(finiteOr(left?.[0], 0));
    const span = Math.max(1e-9, rightPhase - leftPhase);
    const amount = clamp((phase - leftPhase) / span);
    const eased = amount * amount * (3 - 2 * amount);
    return finiteOr(left?.[1], 0)
      + (finiteOr(right?.[1], 0) - finiteOr(left?.[1], 0)) * eased;
  }
  return finiteOr(points.at(-1)?.[1], 0);
}

export function hiccupHeadPoseForSound(soundId, source = HICCUP_HEAD_DEFAULTS, amount = 1) {
  const state = sanitizeHiccupHeadState(source);
  const pose = SOUND_POSES[hiccupHeadModelSoundId(hiccupHeadSound(soundId).id)];
  const mix = clamp(amount);
  return sanitizeHiccupHeadState(Object.fromEntries(Object.entries(state).map(([key, value]) => [
    key,
    typeof value === "number" && Number.isFinite(pose[key])
      ? value + (pose[key] - value) * mix
      : value,
  ])), state);
}

export function physicalVoiceParameters(
  soundId,
  source = HICCUP_HEAD_DEFAULTS,
  strikeVelocity = 1,
  voiceSource = {},
) {
  const displaySound = hiccupHeadSound(soundId);
  const sound = hiccupHeadSound(hiccupHeadModelSoundId(displaySound.id));
  const velocityAmount = clamp(strikeVelocity, 0.01, 1);
  const voice = sanitizeHiccupHeadVoice(voiceSource);
  const posedState = hiccupHeadPoseForSound(sound.id, source, 0.72);
  const state = sanitizeHiccupHeadState({
    ...posedState,
    tractLengthM: posedState.tractLengthM * voice.tractScale,
  }, posedState);
  const geometry = hiccupHeadGeometry(state);
  const formants = hiccupHeadFormants(state);
  const pressureScale = ({
    kick: 0.26,
    slap: 0.18,
    smack: 0.18,
    holler: 1.24,
    grunt: 0.9,
    moan: 0.78,
    hiccup: 1.08,
    eef: 0.96,
    rattle: 1.08,
    whistle: 1.12,
    snare: 1.1,
    snap: 0.34,
    tomlo: 0.26,
    tomhi: 0.22,
    braap: 1.08,
  })[sound.id] ?? 1;
  const pressure = clamp(
    state.lungPressure * (0.34 + velocityAmount * 0.82) * pressureScale,
    0,
    1.8,
  );
  const durationBySound = {
    bop: 0.15, boop: 0.22, pop: 0.14, tlik: 0.095,
    shh: 0.14, shack: 0.18, slap: 0.25, pff: 0.22,
    kick: 0.28, smack: 0.24, hee: 0.2, haw: 0.24,
    doo: 0.28, mwah: 0.24, drr: 0.31, burp: 0.42,
    aah: 0.56, ooh: 0.58, wail: 0.68, yodel: 0.72,
    growl: 0.62, holler: 0.52, hum: 0.58, rattle: 0.6,
    whistle: 0.74, grunt: 0.34, moan: 0.82, lala: 0.62,
    pbpb: 0.5, slurp: 0.46, hiccup: 0.31, eef: 0.42,
    snare: 0.22, snap: 0.16, tomlo: 0.34, tomhi: 0.24, braap: 0.52,
  };
  durationBySound.pff = 0.32;
  const tempoAwareSounds = new Set([
    "pff", "aah", "ooh", "wail", "yodel", "growl", "holler", "hum", "rattle", "whistle",
    "grunt", "moan", "lala", "pbpb", "slurp", "eef", "braap",
  ]);
  const tempoStepSeconds = 15 / state.tempo;
  const baseDuration = durationBySound[sound.id];
  const tempoAwareDuration = tempoAwareSounds.has(sound.id)
    ? clamp(baseDuration * 0.5 + tempoStepSeconds * 2.2, baseDuration * 0.55, 1.3)
    : baseDuration;
  // Vocal-fold pitch and closure belong to the larynx, not the lips. Keep
  // their internal gesture parameters independent even though Hiccup Head's UI
  // intentionally exposes only the face-level controls.
  const glottalBase = 68 + state.lungPressure * 38 + state.silliness * 58;
  const glottalRatioBySound = {
    kick: 0.42,
    hee: 1.48,
    haw: 0.76,
    doo: 2 ** (state.dooPitch / 12),
    mwah: 0.92,
    drr: 0.82,
    burp: 0.34,
    aah: 0.92,
    ooh: 0.74,
    wail: 1.72,
    yodel: 0.88,
    growl: 0.48,
    holler: 1.28,
    hum: 0.68,
    rattle: 0.52,
    whistle: 1,
    grunt: 0.38,
    moan: 0.58,
    lala: 0.94,
    pbpb: 0.72,
    slurp: 0.68,
    hiccup: 0.62,
    eef: 1.32,
    snare: 1,
    snap: 1,
    tomlo: 0.4,
    tomhi: 0.68,
    braap: 0.38,
  };
  const glottalRatio = glottalRatioBySound[sound.id]
    ?? (sound.id === "boop" ? 0.72 : 1);
  const pitchRatio = 2 ** (voice.pitchOffsetSemitones / 12);
  const glottalTenseness = clamp(
    0.3
      + state.lungPressure * 0.2
      + state.silliness * 0.12
      + (sound.id === "boop" ? -0.08 : 0)
      + (sound.id === "shack" || sound.id === "hee" ? 0.08 : 0)
      - (sound.id === "haw" ? 0.06 : 0)
      - (sound.id === "burp" || sound.id === "growl" ? 0.2 : 0)
      - (sound.id === "grunt" || sound.id === "moan" ? 0.14 : 0)
      + (sound.id === "hiccup" ? 0.12 : 0)
      + (sound.id === "eef" ? 0.1 : 0)
      - (sound.id === "tomlo" ? 0.12 : 0)
      - (sound.id === "braap" ? 0.2 : 0)
      + (sound.id === "wail" || sound.id === "holler" ? 0.18 : 0)
      - voice.breathiness * 0.12
      - voice.roughness * 0.08,
    0.16,
    0.88,
  );
  const flutterBase = 18 + state.lipTension * 38 + pressure * 10;
  const membraneBase = 92 + state.cheekTension * 250 + (1 - state.cheekVolume) * 120;
  const noiseCenterBase = 1_100 + state.tonguePosition * 3_500 + state.tongueCurl * 1_200;
  const toothJetLengthScale = clamp(
    voice.tractScale
      + state.lipRounding * 0.12
      - state.tonguePosition * 0.095
      + state.tongueCurl * 0.055,
    0.58,
    1.72,
  ) * 2 ** (-voice.pitchOffsetSemitones / 48);
  const toothJetSlotHeightCm = clamp(
    HICCUP_HEAD_TOOTH_GAP_ANATOMY.jetSlotHeightCm * (
      0.72
      + state.mouthOpening * 0.34
      - state.lipTension * 0.12
      + state.tongueCurl * 0.08
    ),
    0.026,
    0.16,
  );
  const toothJetImpingementLengthM = clamp(
    HICCUP_HEAD_TOOTH_GAP_ANATOMY.baseImpingementLengthM * toothJetLengthScale,
    0.00072,
    0.0038,
  );
  return Object.freeze({
    soundId: displaySound.id,
    family: displaySound.family,
    velocity: velocityAmount,
    pressure,
    durationSeconds: clamp(
      tempoAwareDuration * state.decay * (0.86 + velocityAmount * 0.24),
      0.055,
      1.4,
    ),
    glottalFrequencyHz: clamp(glottalBase * glottalRatio * pitchRatio, 24, 980),
    glottalTenseness,
    voice: Object.freeze({
      ...voice,
      modulation: Object.freeze({ ...voice.modulation }),
    }),
    voiceCharacterId: voice.characterId,
    pitchOffsetSemitones: voice.pitchOffsetSemitones,
    vibratoRateHz: clamp(
      sound.id === "wail" ? Math.max(5.3, voice.vibratoRateHz)
        : sound.id === "yodel" ? Math.max(4.2, voice.vibratoRateHz)
          : sound.id === "moan" ? Math.max(3.1, voice.vibratoRateHz)
          : voice.vibratoRateHz,
      0,
      12,
    ),
    vibratoDepthSemitones: clamp(
      voice.vibratoDepthSemitones
        + (sound.id === "wail" ? 1.45
          : sound.id === "yodel" ? 0.34
            : sound.id === "moan" ? 0.72
              : 0),
      0,
      5,
    ),
    breathiness: clamp(
      voice.breathiness
        + (sound.id === "holler" ? 0.14 : sound.id === "rattle" ? 0.12 : 0),
    ),
    roughness: clamp(Math.max(
      voice.roughness,
      sound.id === "growl" ? 0.78
        : sound.id === "rattle" ? 0.5
          : sound.id === "burp" ? 0.64
            : sound.id === "grunt" ? 0.72
              : sound.id === "hiccup" ? 0.34
                : sound.id === "eef" ? 0.24
                  : sound.id === "braap" ? 0.54
                    : 0,
    )),
    subharmonicMix: clamp(Math.max(
      voice.subharmonicMix,
      sound.id === "growl" ? 0.7
        : sound.id === "rattle" ? 0.3
          : sound.id === "burp" ? 0.42
            : sound.id === "grunt" ? 0.54
              : sound.id === "hiccup" ? 0.18
                : sound.id === "eef" ? 0.06
                  : sound.id === "braap" ? 0.38
                    : 0,
    )),
    tractScale: voice.tractScale,
    tempoStepSeconds,
    registerJumpSemitones: sound.id === "yodel" ? 12 : sound.id === "wail" ? 4.5 : 0,
    flutterFrequencyHz: clamp(
      sound.id === "braap"
        ? 14 + Math.max(0, state.lipTension + 0.35) * 18 + pressure * 5
        : flutterBase,
      12,
      92,
    ),
    membraneFrequencyHz: clamp(
      sound.id === "kick"
        ? membraneBase * 0.38
        : sound.id === "tomlo"
          ? 44 + (state.cheekTension + 0.35) * 24
          : sound.id === "tomhi"
            ? 138 + (state.cheekTension + 0.35) * 128
            : membraneBase,
      34,
      620,
    ),
    handImpactBrightness: clamp((state.cheekTension + 0.35) / 2.05),
    handContactSpacingMs: clamp(
      1.25 + state.cheekVolume * 1.45 - state.cheekTension * 0.38,
      0.7,
      4.8,
    ),
    handTail: clamp(
      0.34 + state.cheekVolume * 0.28 - state.cheekTension * 0.1 + state.decay * 0.18,
      0.22,
      0.94,
    ),
    cavityFrequencyHz: geometry.cavityFrequencyHz,
    noiseCenterHz: clamp(
      noiseCenterBase * (sound.id === "shh" ? 1.32 : sound.id === "snare" ? 1.48 : 1),
      650,
      7_600,
    ),
    noiseBandwidthHz: clamp(780 + state.mouthOpening * 2_200 + state.silliness * 1_400, 320, 4_600),
    formantFrequenciesHz: formants.frequenciesHz,
    formantBandwidthsHz: formants.bandwidthsHz,
    nasalFrequencyHz: formants.nasalFrequencyHz,
    nasalMix: state.nasalMix,
    dooPitch: state.dooPitch,
    airflowDirection: sound.id === "hee" || sound.id === "eef" ? -1 : 1,
    trillFrequencyHz: clamp(
      22 + state.tongueCurl * 12 + state.lungPressure * 9 + state.silliness * 7,
      16,
      72,
    ),
    rattleFrequencyHz: clamp(
      18 + state.tongueCurl * 7 + state.lungPressure * 8 + state.silliness * 5,
      14,
      52,
    ),
    irregularity: sound.id === "burp" ? clamp(0.62 + state.silliness * 0.36)
      : sound.id === "grunt" ? clamp(0.34 + state.silliness * 0.3)
        : sound.id === "slurp" ? clamp(0.28 + state.silliness * 0.4)
          : sound.id === "hiccup" ? clamp(0.38 + state.silliness * 0.42)
            : sound.id === "braap" ? clamp(0.46 + state.silliness * 0.42)
              : 0,
    diaphragmFrequencyHz: clamp(
      10.5 + state.lungPressure * 5.5 + state.silliness * 3.5,
      8,
      24,
    ),
    toothGapCanonicalSection: HICCUP_HEAD_TOOTH_GAP_ANATOMY.canonicalOralSection,
    toothGapWidthCm: HICCUP_HEAD_TOOTH_GAP_ANATOMY.crownGapWidthCm,
    toothGapHeightCm: HICCUP_HEAD_TOOTH_GAP_ANATOMY.crownGapHeightCm,
    toothJetSlotHeightCm,
    toothJetAreaCm2: HICCUP_HEAD_TOOTH_GAP_ANATOMY.crownGapWidthCm * toothJetSlotHeightCm,
    toothEdgeAngleDegrees: HICCUP_HEAD_TOOTH_GAP_ANATOMY.edgeAngleDegrees,
    toothJetImpingementLengthM,
    toothWhistleMaximumPressurePa: HICCUP_HEAD_TOOTH_GAP_ANATOMY.maximumOralPressurePa,
    toothWhistleStrouhalNumbers: HICCUP_HEAD_TOOTH_GAP_ANATOMY.strouhalNumbers,
    silliness: state.silliness,
    lipTension: state.lipTension,
    cheekTension: state.cheekTension,
    cheekVolume: state.cheekVolume,
    tonguePosition: state.tonguePosition,
    tongueCurl: state.tongueCurl,
    tongueOut: state.tongueOut,
    mouthOpening: state.mouthOpening,
    // The oral radiator stays in one place; only asymmetric cheek contact gets
    // a restrained spatial offset.
    pan: sound.id === "slap"
      ? -0.42
      : sound.id === "smack"
        ? 0.42
        : sound.id === "pop"
          ? 0.08
          : sound.id === "snap"
            ? 0.12
            : 0,
  });
}

const HICCUP_HEAD_SIGNED_GESTURE_CHANNELS = Object.freeze([
  "cheekImpulse",
  "jawImpulse",
  "breathDirection",
]);

/**
 * Sample one continuous physical gesture at a normalized 0..1 phase. Energy
 * channels remain normalized; `pressureDrive` combines the pressure envelope
 * with the state's finite physical pressure for direct DSP consumption.
 */
export function hiccupHeadGestureFrame(
  soundId,
  normalizedPhase,
  source = HICCUP_HEAD_DEFAULTS,
  strikeVelocity = 1,
  voiceSource = {},
) {
  const sound = hiccupHeadSound(soundId);
  const modelSoundId = hiccupHeadModelSoundId(sound.id);
  const trajectory = HICCUP_HEAD_GESTURE_TRAJECTORIES[modelSoundId];
  const phase = clamp(normalizedPhase);
  const velocityAmount = clamp(strikeVelocity, 0.01, 1);
  const state = sanitizeHiccupHeadState(source);
  const voice = sanitizeHiccupHeadVoice(voiceSource);
  const channels = Object.fromEntries(HICCUP_HEAD_GESTURE_CHANNELS.map((channel) => {
    const sampled = sampleHiccupHeadGestureCurve(trajectory.curves[channel], phase);
    return [
      channel,
      HICCUP_HEAD_SIGNED_GESTURE_CHANNELS.includes(channel)
        ? clamp(sampled, -1, 1)
        : clamp(sampled),
    ];
  }));
  if (sound.id === "kiss") {
    channels.suction = clamp(channels.suction * 1.7);
    channels.lipImpulse = clamp(channels.lipImpulse * 1.9);
    channels.voicing *= 0.12;
    channels.aspiration *= 0.18;
    channels.pressure = clamp(channels.pressure * 0.82);
  }
  const pose = hiccupHeadPoseForSound(sound.id, state, channels.poseMix);
  channels.velum = clamp(
    pose.nasalMix * 0.98 + channels.velum * (1 - pose.nasalMix * 0.18),
  );
  const plan = physicalVoiceParameters(sound.id, state, velocityAmount, voice);
  const cheekVolume = clamp(
    pose.cheekVolume + channels.cheekImpulse * 0.2,
    ...HICCUP_HEAD_LIMITS.cheekVolume,
  );
  const mouthOpening = clamp(
    pose.mouthOpening + channels.jawImpulse * 0.24,
    ...HICCUP_HEAD_LIMITS.mouthOpening,
  );
  const tongueCurl = clamp(
    pose.tongueCurl + channels.tongueContact * 0.08,
    ...HICCUP_HEAD_LIMITS.tongueCurl,
  );
  const tongueOut = clamp(
    pose.tongueOut + channels.tongueExtension * 0.74,
    ...HICCUP_HEAD_LIMITS.tongueOut,
  );
  const yodelRegister = channels.registerLift;
  const acousticPose = sound.id === "yodel"
    ? {
      tongueBodyIndex: 13 + (27.4 - 13) * yodelRegister,
      tongueBodyDiameterCm: 2.4 + (2.25 - 2.4) * yodelRegister,
      lipDiameterCm: 3,
    }
    : SOUND_ACOUSTIC_POSES[modelSoundId];
  return Object.freeze({
    soundId: sound.id,
    phase,
    active: phase < 1,
    complete: phase >= 1,
    velocity: velocityAmount,
    durationSeconds: plan.durationSeconds,
    pressureDrive: clamp(plan.pressure * channels.pressure, 0, 1.8),
    ...channels,
    lipTension: pose.lipTension,
    lipRounding: pose.lipRounding,
    lipProjection: pose.lipRounding,
    cheekVolume,
    cheekTension: pose.cheekTension,
    tonguePosition: pose.tonguePosition,
    tongueCurl,
    tongueOut,
    mouthOpening,
    tractLengthM: clamp(
      pose.tractLengthM * voice.tractScale,
      ...HICCUP_HEAD_LIMITS.tractLengthM,
    ),
    nasalMix: pose.nasalMix,
    acousticMix: acousticPose ? channels.poseMix : 0,
    tongueBodyIndex: acousticPose?.tongueBodyIndex,
    tongueBodyDiameterCm: acousticPose?.tongueBodyDiameterCm,
    lipDiameterCm: acousticPose?.lipDiameterCm,
    voiceCharacterId: voice.characterId,
  });
}

/**
 * Sample-addressed counterpart to `hiccupHeadGestureFrame`. Frame zero is the
 * first active sample; `totalFrames` is derived from this strike's duration,
 * so completion and articulation timing are independent of render block size.
 */
export function hiccupHeadGestureFrameAtSample(
  soundId,
  sampleFrame,
  sampleRate = 48_000,
  source = HICCUP_HEAD_DEFAULTS,
  strikeVelocity = 1,
  voiceSource = {},
) {
  const rate = clamp(finiteOr(sampleRate, 48_000), 8_000, 384_000);
  const frame = Math.max(0, Math.trunc(finiteOr(sampleFrame, 0)));
  const plan = physicalVoiceParameters(soundId, source, strikeVelocity, voiceSource);
  const totalFrames = Math.max(1, Math.ceil(plan.durationSeconds * rate));
  const complete = frame >= totalFrames;
  const frameIndex = Math.min(frame, totalFrames);
  const phase = complete ? 1 : clamp(frameIndex / totalFrames);
  const sampled = hiccupHeadGestureFrame(
    soundId,
    phase,
    source,
    strikeVelocity,
    voiceSource,
  );
  return Object.freeze({
    ...sampled,
    phase,
    active: !complete,
    complete,
    sampleRate: rate,
    frameIndex,
    totalFrames,
    remainingFrames: Math.max(0, totalFrames - frame),
  });
}
