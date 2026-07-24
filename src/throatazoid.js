export const MAX_THROATS = 7;
export const MAX_MOUTHS = MAX_THROATS;
export const MAX_TONGUES = 5;
export const MAX_NOSES = 3;

function defineSpecimen(specimen) {
  const articulation = specimenArticulation(specimen);
  const seed = nameSeed(specimen.name);
  return Object.freeze({
    ...specimen,
    tongueCount: articulation.tongueCount,
    noseCount: articulation.noseCount,
    oralClosure: articulation.oralClosure,
    throats: Object.freeze(specimen.throats.map((throat) => Object.freeze({ ...throat }))),
    tongues: Object.freeze(
      Array.from({ length: MAX_TONGUES }, (_, index) => Object.freeze(
        normalizeTongue(articulation.tongues[index], defaultTongue(index, seed)),
      )),
    ),
    noses: Object.freeze(
      Array.from({ length: MAX_NOSES }, (_, index) => Object.freeze(
        normalizeNose(articulation.noses[index], defaultNose(index, seed)),
      )),
    ),
  });
}

export const SPECIMENS = Object.freeze({
  triune: defineSpecimen({
    name: "Triune",
    description: "three voices",
    throatCount: 3,
    bodyLength: 0.56,
    tension: 0.58,
    mutation: 0.32,
    coupling: 0.18,
    growl: 0.2,
    wet: 0.88,
    dry: 0.08,
    spread: 0.82,
    exciterPitch: 108,
    exciterIntensity: 0.72,
    exciterTenseness: 0.62,
    exciterBreath: 0.16,
    exciterVibrato: 0.08,
    exciterWobble: 0.05,
    throats: [
      { aperture: 0.42, length: 0.64 },
      { aperture: 0.68, length: 0.48 },
      { aperture: 0.36, length: 0.78 },
    ],
  }),
  oracle: defineSpecimen({
    name: "Oracle",
    description: "one abyss",
    throatCount: 1,
    bodyLength: 0.88,
    tension: 0.28,
    mutation: 0.12,
    coupling: 0.48,
    growl: 0.1,
    wet: 1,
    dry: 0,
    spread: 0,
    exciterPitch: 67,
    exciterIntensity: 0.78,
    exciterTenseness: 0.45,
    exciterBreath: 0.22,
    exciterVibrato: 0.03,
    exciterWobble: 0.18,
    throats: [{ aperture: 0.82, length: 0.95 }],
  }),
  hive: defineSpecimen({
    name: "Hive",
    description: "five mouths",
    throatCount: 5,
    bodyLength: 0.33,
    tension: 0.75,
    mutation: 0.62,
    coupling: 0.38,
    growl: 0.28,
    wet: 0.92,
    dry: 0.03,
    spread: 1,
    exciterPitch: 176,
    exciterIntensity: 0.62,
    exciterTenseness: 0.72,
    exciterBreath: 0.1,
    exciterVibrato: 0.12,
    exciterWobble: 0.08,
    throats: [
      { aperture: 0.3, length: 0.46 },
      { aperture: 0.47, length: 0.62 },
      { aperture: 0.25, length: 0.74 },
      { aperture: 0.52, length: 0.54 },
      { aperture: 0.34, length: 0.82 },
    ],
  }),
  hydra: defineSpecimen({
    name: "Hydra",
    description: "seven soft mouths",
    throatCount: 7,
    bodyLength: 0.68,
    tension: 0.31,
    mutation: 0.57,
    coupling: 0.62,
    growl: 0.34,
    wet: 0.98,
    dry: 0.01,
    spread: 1,
    exciterPitch: 76,
    exciterIntensity: 0.84,
    exciterTenseness: 0.38,
    exciterBreath: 0.38,
    exciterVibrato: 0.17,
    exciterWobble: 0.41,
    throats: [
      { aperture: 0.68, length: 0.72 },
      { aperture: 0.48, length: 0.58 },
      { aperture: 0.82, length: 0.84 },
      { aperture: 0.58, length: 0.66 },
      { aperture: 0.88, length: 0.9 },
      { aperture: 0.52, length: 0.62 },
      { aperture: 0.74, length: 0.78 },
    ],
  }),
  razor: defineSpecimen({
    name: "Razor",
    description: "metal teeth",
    throatCount: 4,
    bodyLength: 0.42,
    tension: 0.94,
    mutation: 0.82,
    coupling: 0.04,
    growl: 0.78,
    wet: 1,
    dry: 0,
    spread: 0.9,
    exciterPitch: 132,
    exciterIntensity: 0.8,
    exciterTenseness: 0.94,
    exciterBreath: 0.04,
    exciterVibrato: 0,
    exciterWobble: 0.02,
    throats: [
      { aperture: 0.14, length: 0.38 },
      { aperture: 0.22, length: 0.58 },
      { aperture: 0.1, length: 0.74 },
      { aperture: 0.18, length: 0.9 },
    ],
  }),
  monolith: defineSpecimen({
    name: "Monolith",
    description: "subterranean",
    throatCount: 1,
    bodyLength: 1,
    tension: 0.82,
    mutation: 0.04,
    coupling: 0.12,
    growl: 0.44,
    wet: 0.98,
    dry: 0.01,
    spread: 0,
    exciterPitch: 45,
    exciterIntensity: 0.92,
    exciterTenseness: 0.88,
    exciterBreath: 0.03,
    exciterVibrato: 0.02,
    exciterWobble: 0.08,
    throats: [{ aperture: 0.96, length: 1 }],
  }),
  siren: defineSpecimen({
    name: "Siren",
    description: "split signal",
    throatCount: 2,
    bodyLength: 0.32,
    tension: 0.66,
    mutation: 0.44,
    coupling: 0.18,
    growl: 0.18,
    wet: 0.94,
    dry: 0.02,
    spread: 1,
    exciterPitch: 240,
    exciterIntensity: 0.58,
    exciterTenseness: 0.58,
    exciterBreath: 0.12,
    exciterVibrato: 0.82,
    exciterWobble: 0.3,
    throats: [
      { aperture: 0.55, length: 0.25 },
      { aperture: 0.3, length: 0.78 },
    ],
  }),
  larva: defineSpecimen({
    name: "Larva",
    description: "soft membrane",
    throatCount: 2,
    bodyLength: 0.22,
    tension: 0.18,
    mutation: 0.24,
    coupling: 0.58,
    growl: 0.04,
    wet: 0.86,
    dry: 0.12,
    spread: 0.45,
    exciterPitch: 198,
    exciterIntensity: 0.42,
    exciterTenseness: 0.18,
    exciterBreath: 0.82,
    exciterVibrato: 0.16,
    exciterWobble: 0.28,
    throats: [
      { aperture: 0.72, length: 0.3 },
      { aperture: 0.62, length: 0.44 },
    ],
  }),
  cathedral: defineSpecimen({
    name: "Cathedral",
    description: "hollow colony",
    throatCount: 5,
    bodyLength: 0.95,
    tension: 0.46,
    mutation: 0.18,
    coupling: 0.7,
    growl: 0.08,
    wet: 1,
    dry: 0,
    spread: 0.75,
    exciterPitch: 83,
    exciterIntensity: 0.74,
    exciterTenseness: 0.5,
    exciterBreath: 0.26,
    exciterVibrato: 0.04,
    exciterWobble: 0.14,
    throats: [
      { aperture: 0.78, length: 0.92 },
      { aperture: 0.58, length: 0.82 },
      { aperture: 0.9, length: 1 },
      { aperture: 0.52, length: 0.74 },
      { aperture: 0.7, length: 0.88 },
    ],
  }),
  needle: defineSpecimen({
    name: "Needle",
    description: "high puncture",
    throatCount: 3,
    bodyLength: 0.24,
    tension: 0.98,
    mutation: 0.91,
    coupling: 0.02,
    growl: 0.52,
    wet: 1,
    dry: 0,
    spread: 0.6,
    exciterPitch: 310,
    exciterIntensity: 0.52,
    exciterTenseness: 0.91,
    exciterBreath: 0.06,
    exciterVibrato: 0.08,
    exciterWobble: 0.02,
    throats: [
      { aperture: 0.08, length: 0.12 },
      { aperture: 0.12, length: 0.34 },
      { aperture: 0.07, length: 0.56 },
    ],
  }),
  maw: defineSpecimen({
    name: "Maw",
    description: "overfed",
    throatCount: 2,
    bodyLength: 0.78,
    tension: 0.68,
    mutation: 0.74,
    coupling: 0.34,
    growl: 0.96,
    wet: 0.96,
    dry: 0.02,
    spread: 0.72,
    exciterPitch: 52,
    exciterIntensity: 0.96,
    exciterTenseness: 0.74,
    exciterBreath: 0.08,
    exciterVibrato: 0.03,
    exciterWobble: 0.11,
    throats: [
      { aperture: 0.98, length: 0.88 },
      { aperture: 0.72, length: 0.52 },
    ],
  }),
  choir: defineSpecimen({
    name: "Choir",
    description: "gentle swarm",
    throatCount: 5,
    bodyLength: 0.54,
    tension: 0.42,
    mutation: 0.14,
    coupling: 0.32,
    growl: 0.02,
    wet: 0.82,
    dry: 0.18,
    spread: 1,
    exciterPitch: 121,
    exciterIntensity: 0.62,
    exciterTenseness: 0.53,
    exciterBreath: 0.13,
    exciterVibrato: 0.28,
    exciterWobble: 0.22,
    throats: [
      { aperture: 0.54, length: 0.52 },
      { aperture: 0.62, length: 0.57 },
      { aperture: 0.7, length: 0.62 },
      { aperture: 0.6, length: 0.67 },
      { aperture: 0.52, length: 0.72 },
    ],
  }),
  void: defineSpecimen({
    name: "Void",
    description: "breath without body",
    throatCount: 3,
    bodyLength: 0.99,
    tension: 0.06,
    mutation: 0.92,
    coupling: 0.72,
    growl: 0.62,
    wet: 1,
    dry: 0,
    spread: 0.95,
    exciterPitch: 49,
    exciterIntensity: 0.68,
    exciterTenseness: 0.12,
    exciterBreath: 1,
    exciterVibrato: 0.46,
    exciterWobble: 0.82,
    throats: [
      { aperture: 0.15, length: 0.98 },
      { aperture: 0.64, length: 0.86 },
      { aperture: 0.08, length: 0.72 },
    ],
  }),
});

export function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

function unitValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? clamp(number) : clamp(fallback);
}

export function oralOpening(closure = 0) {
  const sealed = unitValue(closure);
  if (sealed >= 1) return 0;
  return Math.pow(Math.max(0, Math.cos(sealed * Math.PI * 0.5)), 1.35);
}

export function fricationOpening(closure = 0) {
  const sealProgress = clamp((unitValue(closure) - 0.72) / 0.28);
  return 1 - sealProgress * sealProgress * (3 - 2 * sealProgress);
}

function boundedInteger(value, minimum, maximum, fallback = minimum) {
  const number = Number(value);
  return Math.round(clamp(Number.isFinite(number) ? number : fallback, minimum, maximum));
}

function nameSeed(name) {
  return Array.from(String(name)).reduce(
    (seed, character, index) => (
      (seed + character.codePointAt(0) * (index + 11) * 17) % 65_521
    ),
    97,
  );
}

function seededUnit(seed, salt, minimum = 0.06, maximum = 0.94) {
  const fraction = ((seed * (salt * 29 + 47) + salt * 137) % 997) / 996;
  return minimum + fraction * (maximum - minimum);
}

function defaultTongue(index, seed = 0) {
  const safeIndex = boundedInteger(index, 0, MAX_TONGUES - 1);
  return {
    position: seededUnit(seed + 19, safeIndex + 1, 0.1, 0.9),
    height: seededUnit(seed + 43, safeIndex + 5, 0.12, 0.88),
    curl: seededUnit(seed + 71, safeIndex + 9, 0.04, 0.72),
  };
}

function defaultNose(index, seed = 0) {
  const safeIndex = boundedInteger(index, 0, MAX_NOSES - 1);
  return {
    openness: seededUnit(seed + 101, safeIndex + 2, 0.04, 0.74),
    length: seededUnit(seed + 131, safeIndex + 6, 0.18, 0.92),
    resonance: seededUnit(seed + 167, safeIndex + 10, 0.16, 0.9),
  };
}

function specimenArticulation(specimen) {
  if (specimen.name === "Triune") {
    return {
      tongueCount: 2,
      noseCount: 2,
      oralClosure: 0.03,
      tongues: [
        { position: 0.38, height: 0.14, curl: 0.08 },
        { position: 0.5, height: 0.22, curl: 0.14 },
        { position: 0.25, height: 0.32, curl: 0.21 },
      ],
      noses: [
        { openness: 0.03, length: 0.48, resonance: 0.42 },
        { openness: 0.02, length: 0.65, resonance: 0.56 },
        { openness: 0.01, length: 0.82, resonance: 0.7 },
      ],
    };
  }

  if (specimen.name === "Hydra") {
    return {
      tongueCount: 5,
      noseCount: 3,
      oralClosure: 0.12,
      tongues: [
        { position: 0.14, height: 0.42, curl: 0.18 },
        { position: 0.32, height: 0.58, curl: 0.34 },
        { position: 0.5, height: 0.74, curl: 0.5 },
        { position: 0.68, height: 0.54, curl: 0.66 },
        { position: 0.86, height: 0.38, curl: 0.82 },
      ],
      noses: [
        { openness: 0.44, length: 0.48, resonance: 0.66 },
        { openness: 0.58, length: 0.68, resonance: 0.78 },
        { openness: 0.36, length: 0.86, resonance: 0.9 },
      ],
    };
  }

  const seed = nameSeed(specimen.name);
  const activeThroats = specimen.throats.slice(0, specimen.throatCount);
  const averageAperture = activeThroats.reduce(
    (sum, throat) => sum + unitValue(throat.aperture, 0.5),
    0,
  ) / Math.max(1, activeThroats.length);
  const tongueCount = 1 + seed % MAX_TONGUES;
  const noseCount = 1 + Math.floor(seed / MAX_TONGUES) % MAX_NOSES;
  const oralClosure = clamp(
    0.025
      + (1 - averageAperture) * 0.28
      + unitValue(specimen.mutation) * 0.12
      + (seed % 13) * 0.003,
    0.02,
    0.62,
  );
  const tongues = Array.from({ length: MAX_TONGUES }, (_, index) => {
    const tongue = defaultTongue(index, seed);
    return {
      position: tongue.position,
      height: tongue.height,
      curl: clamp(
        tongue.curl * 0.72
          + unitValue(specimen.mutation) * 0.2
          + (1 - averageAperture) * 0.08,
      ),
    };
  });
  const noses = Array.from({ length: MAX_NOSES }, (_, index) => {
    const nose = defaultNose(index, seed);
    return {
      openness: clamp(
        nose.openness * 0.62
          + unitValue(specimen.coupling) * 0.3
          + index * 0.025,
      ),
      length: nose.length,
      resonance: clamp(
        nose.resonance * 0.72 + unitValue(specimen.tension) * 0.22,
      ),
    };
  });

  return { tongueCount, noseCount, oralClosure, tongues, noses };
}

function normalizeTongue(tongue, fallback) {
  return {
    position: unitValue(tongue?.position, fallback.position),
    height: unitValue(tongue?.height, fallback.height),
    curl: unitValue(tongue?.curl, fallback.curl),
  };
}

function normalizeNose(nose, fallback) {
  return {
    openness: unitValue(nose?.openness, fallback.openness),
    length: unitValue(nose?.length, fallback.length),
    resonance: unitValue(nose?.resonance, fallback.resonance),
  };
}

function freezePhoneme(phoneme) {
  const tongues = Array.from({ length: MAX_TONGUES }, (_, index) => (
    normalizeTongue(phoneme.tongues?.[index], defaultTongue(index))
  ));
  const noses = Array.from({ length: MAX_NOSES }, (_, index) => (
    normalizeNose(phoneme.noses?.[index], defaultNose(index))
  ));
  return Object.freeze({
    name: phoneme.name,
    kind: phoneme.kind,
    tongueCount: boundedInteger(phoneme.tongueCount, 1, MAX_TONGUES, 1),
    noseCount: boundedInteger(phoneme.noseCount, 0, MAX_NOSES, 0),
    oralClosure: unitValue(phoneme.oralClosure),
    tongues: Object.freeze(tongues.map((tongue) => Object.freeze(tongue))),
    noses: Object.freeze(noses.map((nose) => Object.freeze(nose))),
  });
}

const CLOSED_NOSES = [
  { openness: 0.01, length: 0.42, resonance: 0.38 },
  { openness: 0, length: 0.64, resonance: 0.55 },
  { openness: 0, length: 0.84, resonance: 0.72 },
];

export const PHONEMES = Object.freeze({
  a: freezePhoneme({
    name: "A",
    kind: "vowel",
    tongueCount: 2,
    noseCount: 2,
    oralClosure: 0.03,
    tongues: [
      { position: 0.38, height: 0.14, curl: 0.08 },
      { position: 0.5, height: 0.22, curl: 0.14 },
      { position: 0.25, height: 0.32, curl: 0.21 },
    ],
    noses: CLOSED_NOSES,
  }),
  e: freezePhoneme({
    name: "E",
    kind: "vowel",
    tongueCount: 2,
    noseCount: 2,
    oralClosure: 0.04,
    tongues: [
      { position: 0.76, height: 0.57, curl: 0.1 },
      { position: 0.68, height: 0.5, curl: 0.16 },
      { position: 0.58, height: 0.44, curl: 0.22 },
    ],
    noses: CLOSED_NOSES,
  }),
  i: freezePhoneme({
    name: "I",
    kind: "vowel",
    tongueCount: 2,
    noseCount: 2,
    oralClosure: 0.06,
    tongues: [
      { position: 0.92, height: 0.9, curl: 0.12 },
      { position: 0.82, height: 0.82, curl: 0.18 },
      { position: 0.72, height: 0.74, curl: 0.24 },
    ],
    noses: CLOSED_NOSES,
  }),
  o: freezePhoneme({
    name: "O",
    kind: "vowel",
    tongueCount: 2,
    noseCount: 2,
    oralClosure: 0.08,
    tongues: [
      { position: 0.2, height: 0.54, curl: 0.2 },
      { position: 0.28, height: 0.48, curl: 0.26 },
      { position: 0.36, height: 0.42, curl: 0.32 },
    ],
    noses: CLOSED_NOSES,
  }),
  u: freezePhoneme({
    name: "U",
    kind: "vowel",
    tongueCount: 2,
    noseCount: 2,
    oralClosure: 0.11,
    tongues: [
      { position: 0.08, height: 0.88, curl: 0.28 },
      { position: 0.16, height: 0.8, curl: 0.34 },
      { position: 0.24, height: 0.72, curl: 0.4 },
    ],
    noses: CLOSED_NOSES,
  }),
  s: freezePhoneme({
    name: "S",
    kind: "consonant",
    tongueCount: 3,
    noseCount: 2,
    oralClosure: 0.56,
    tongues: [
      { position: 0.94, height: 0.8, curl: 0.96 },
      { position: 0.86, height: 0.72, curl: 0.9 },
      { position: 0.78, height: 0.66, curl: 0.84 },
    ],
    noses: CLOSED_NOSES,
  }),
  k: freezePhoneme({
    name: "K",
    kind: "consonant",
    tongueCount: 2,
    noseCount: 2,
    oralClosure: 1,
    tongues: [
      { position: 0.12, height: 0.86, curl: 0.82 },
      { position: 0.22, height: 0.78, curl: 0.72 },
      { position: 0.32, height: 0.7, curl: 0.62 },
    ],
    noses: CLOSED_NOSES,
  }),
  m: freezePhoneme({
    name: "M",
    kind: "consonant",
    tongueCount: 1,
    noseCount: 3,
    oralClosure: 1,
    tongues: [
      { position: 0.42, height: 0.28, curl: 0.08 },
      { position: 0.5, height: 0.32, curl: 0.12 },
      { position: 0.34, height: 0.36, curl: 0.16 },
    ],
    noses: [
      { openness: 0.94, length: 0.46, resonance: 0.72 },
      { openness: 0.86, length: 0.66, resonance: 0.82 },
      { openness: 0.78, length: 0.86, resonance: 0.9 },
    ],
  }),
  n: freezePhoneme({
    name: "N",
    kind: "consonant",
    tongueCount: 2,
    noseCount: 3,
    oralClosure: 1,
    tongues: [
      { position: 0.84, height: 0.74, curl: 0.94 },
      { position: 0.72, height: 0.68, curl: 0.86 },
      { position: 0.62, height: 0.62, curl: 0.78 },
    ],
    noses: [
      { openness: 0.88, length: 0.42, resonance: 0.76 },
      { openness: 0.8, length: 0.62, resonance: 0.84 },
      { openness: 0.72, length: 0.82, resonance: 0.92 },
    ],
  }),
});

function freezeConsonant(id, consonant) {
  const freezeSpectrum = (spectrum) => Object.freeze({ ...spectrum });
  return Object.freeze({
    id,
    symbol: consonant.symbol,
    name: consonant.name,
    manner: consonant.manner,
    place: consonant.place,
    articulator: consonant.articulator,
    voiced: Boolean(consonant.voiced),
    constrictionPosition: unitValue(consonant.constrictionPosition),
    oralClosure: unitValue(consonant.oralClosure),
    glottalClosure: unitValue(consonant.glottalClosure),
    nasalCoupling: unitValue(consonant.nasalCoupling),
    frication: freezeSpectrum(consonant.frication),
    burst: freezeSpectrum(consonant.burst),
    nasal: freezeSpectrum(consonant.nasal),
    gesture: consonant.gesture,
  });
}

const GLOTTAL_GESTURE = freezePhoneme({
  name: "Glottal stop",
  kind: "consonant",
  tongueCount: 1,
  noseCount: 1,
  oralClosure: 0.06,
  tongues: [
    { position: 0.46, height: 0.22, curl: 0.08 },
  ],
  noses: CLOSED_NOSES,
});

const T_GESTURE = freezePhoneme({
  name: "T",
  kind: "consonant",
  tongueCount: 2,
  noseCount: 1,
  oralClosure: 1,
  tongues: [
    { position: 0.94, height: 0.98, curl: 0.76 },
    { position: 0.86, height: 0.9, curl: 0.68 },
  ],
  noses: CLOSED_NOSES,
});

const P_GESTURE = freezePhoneme({
  name: "P",
  kind: "consonant",
  tongueCount: 1,
  noseCount: 1,
  oralClosure: 1,
  tongues: [
    { position: 0.48, height: 0.24, curl: 0.06 },
  ],
  noses: CLOSED_NOSES,
});

const SH_GESTURE = freezePhoneme({
  name: "SH",
  kind: "consonant",
  tongueCount: 3,
  noseCount: 1,
  oralClosure: 0.58,
  tongues: [
    { position: 0.74, height: 0.86, curl: 0.94 },
    { position: 0.68, height: 0.78, curl: 0.88 },
    { position: 0.62, height: 0.7, curl: 0.8 },
  ],
  noses: CLOSED_NOSES,
});

const F_GESTURE = freezePhoneme({
  name: "F",
  kind: "consonant",
  tongueCount: 1,
  noseCount: 1,
  oralClosure: 0.38,
  tongues: [
    { position: 0.56, height: 0.28, curl: 0.1 },
  ],
  noses: CLOSED_NOSES,
});

const NG_GESTURE = freezePhoneme({
  name: "NG",
  kind: "consonant",
  tongueCount: 2,
  noseCount: 3,
  oralClosure: 1,
  tongues: [
    { position: 0.1, height: 0.94, curl: 0.68 },
    { position: 0.18, height: 0.86, curl: 0.6 },
  ],
  noses: [
    { openness: 0.9, length: 0.58, resonance: 0.82 },
    { openness: 0.84, length: 0.76, resonance: 0.9 },
    { openness: 0.76, length: 0.92, resonance: 0.96 },
  ],
});

export const CONSONANTS = Object.freeze({
  glottal: freezeConsonant("glottal", {
    symbol: "ʔ",
    name: "Glottal stop",
    manner: "stop",
    place: "glottal",
    articulator: "glottis",
    voiced: false,
    constrictionPosition: 0,
    oralClosure: GLOTTAL_GESTURE.oralClosure,
    glottalClosure: 1,
    nasalCoupling: 0,
    frication: { frequency: 720, q: 0.7, gain: 0 },
    burst: {
      frequency: 620,
      q: 0.8,
      gain: 0,
      halfLife: 0.005,
      duration: 0.2,
    },
    nasal: { poleFrequency: 240, notchFrequency: 920, q: 2.2, gain: 0 },
    gesture: GLOTTAL_GESTURE,
  }),
  k: freezeConsonant("k", {
    symbol: "K",
    name: "K",
    manner: "stop",
    place: "velar",
    articulator: "tongue",
    voiced: false,
    constrictionPosition: 0.14,
    oralClosure: PHONEMES.k.oralClosure,
    glottalClosure: 0.04,
    nasalCoupling: 0,
    frication: { frequency: 2_800, q: 1.4, gain: 0 },
    burst: {
      frequency: 2_350,
      q: 2.8,
      gain: 1,
      halfLife: 0.005,
      duration: 0.2,
    },
    nasal: { poleFrequency: 230, notchFrequency: 2_350, q: 4.8, gain: 0 },
    gesture: PHONEMES.k,
  }),
  t: freezeConsonant("t", {
    symbol: "T",
    name: "T",
    manner: "stop",
    place: "alveolar",
    articulator: "tongue",
    voiced: false,
    constrictionPosition: 0.9,
    oralClosure: T_GESTURE.oralClosure,
    glottalClosure: 0.03,
    nasalCoupling: 0,
    frication: { frequency: 5_800, q: 2.2, gain: 0 },
    burst: {
      frequency: 5_150,
      q: 3.4,
      gain: 0.94,
      halfLife: 0.005,
      duration: 0.2,
    },
    nasal: { poleFrequency: 285, notchFrequency: 1_720, q: 5.2, gain: 0 },
    gesture: T_GESTURE,
  }),
  p: freezeConsonant("p", {
    symbol: "P",
    name: "P",
    manner: "stop",
    place: "bilabial",
    articulator: "lips",
    voiced: false,
    constrictionPosition: 1,
    oralClosure: P_GESTURE.oralClosure,
    glottalClosure: 0.02,
    nasalCoupling: 0,
    frication: { frequency: 1_450, q: 0.65, gain: 0 },
    burst: {
      frequency: 1_050,
      q: 0.85,
      gain: 0.82,
      halfLife: 0.005,
      duration: 0.2,
    },
    nasal: { poleFrequency: 260, notchFrequency: 1_040, q: 4.4, gain: 0 },
    gesture: P_GESTURE,
  }),
  s: freezeConsonant("s", {
    symbol: "S",
    name: "S",
    manner: "fricative",
    place: "alveolar",
    articulator: "tongue",
    voiced: false,
    constrictionPosition: 0.94,
    oralClosure: PHONEMES.s.oralClosure,
    glottalClosure: 0,
    nasalCoupling: 0,
    frication: { frequency: 7_800, q: 4.8, gain: 1 },
    burst: {
      frequency: 7_100,
      q: 3.6,
      gain: 0,
      halfLife: 0.005,
      duration: 0.035,
    },
    nasal: { poleFrequency: 280, notchFrequency: 1_700, q: 4.8, gain: 0 },
    gesture: PHONEMES.s,
  }),
  sh: freezeConsonant("sh", {
    symbol: "SH",
    name: "SH",
    manner: "fricative",
    place: "postalveolar",
    articulator: "tongue",
    voiced: false,
    constrictionPosition: 0.72,
    oralClosure: SH_GESTURE.oralClosure,
    glottalClosure: 0,
    nasalCoupling: 0,
    frication: { frequency: 3_650, q: 2.7, gain: 0.92 },
    burst: {
      frequency: 3_450,
      q: 2.2,
      gain: 0,
      halfLife: 0.005,
      duration: 0.045,
    },
    nasal: { poleFrequency: 270, notchFrequency: 1_520, q: 4.2, gain: 0 },
    gesture: SH_GESTURE,
  }),
  f: freezeConsonant("f", {
    symbol: "F",
    name: "F",
    manner: "fricative",
    place: "labiodental",
    articulator: "lip-teeth",
    voiced: false,
    constrictionPosition: 0.99,
    oralClosure: F_GESTURE.oralClosure,
    glottalClosure: 0,
    nasalCoupling: 0,
    frication: { frequency: 1_850, q: 0.72, gain: 0.7 },
    burst: {
      frequency: 1_600,
      q: 0.68,
      gain: 0,
      halfLife: 0.005,
      duration: 0.04,
    },
    nasal: { poleFrequency: 255, notchFrequency: 1_120, q: 3.4, gain: 0 },
    gesture: F_GESTURE,
  }),
  m: freezeConsonant("m", {
    symbol: "M",
    name: "M",
    manner: "nasal",
    place: "bilabial",
    articulator: "lips",
    voiced: true,
    constrictionPosition: 1,
    oralClosure: PHONEMES.m.oralClosure,
    glottalClosure: 0,
    nasalCoupling: 0.96,
    frication: { frequency: 1_100, q: 0.8, gain: 0 },
    burst: {
      frequency: 1_000,
      q: 0.9,
      gain: 0,
      halfLife: 0.005,
      duration: 0.05,
    },
    nasal: { poleFrequency: 260, notchFrequency: 1_040, q: 4.8, gain: 1 },
    gesture: PHONEMES.m,
  }),
  n: freezeConsonant("n", {
    symbol: "N",
    name: "N",
    manner: "nasal",
    place: "alveolar",
    articulator: "tongue",
    voiced: true,
    constrictionPosition: 0.88,
    oralClosure: PHONEMES.n.oralClosure,
    glottalClosure: 0,
    nasalCoupling: 0.93,
    frication: { frequency: 2_600, q: 1.2, gain: 0 },
    burst: {
      frequency: 2_200,
      q: 1.4,
      gain: 0,
      halfLife: 0.005,
      duration: 0.05,
    },
    nasal: { poleFrequency: 285, notchFrequency: 1_720, q: 5.5, gain: 0.95 },
    gesture: PHONEMES.n,
  }),
  ng: freezeConsonant("ng", {
    symbol: "NG",
    name: "NG",
    manner: "nasal",
    place: "velar",
    articulator: "tongue",
    voiced: true,
    constrictionPosition: 0.14,
    oralClosure: NG_GESTURE.oralClosure,
    glottalClosure: 0,
    nasalCoupling: 0.9,
    frication: { frequency: 2_350, q: 1.1, gain: 0 },
    burst: {
      frequency: 2_100,
      q: 1.5,
      gain: 0,
      halfLife: 0.005,
      duration: 0.055,
    },
    nasal: { poleFrequency: 230, notchFrequency: 2_350, q: 6.2, gain: 0.92 },
    gesture: NG_GESTURE,
  }),
});

export const ARTICULATIONS = Object.freeze({
  ...PHONEMES,
  ...CONSONANTS,
});

const CONSONANT_ALIASES = Object.freeze({
  "ʔ": "glottal",
  "?": "glottal",
  "glottal stop": "glottal",
  "glottal-stop": "glottal",
  "ʃ": "sh",
  "ŋ": "ng",
});

export function consonantKey(value) {
  if (typeof value !== "string") return "";
  const key = value.trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(CONSONANTS, key)) return key;
  return CONSONANT_ALIASES[key] ?? "";
}

export function articulationKey(value) {
  if (typeof value !== "string") return "";
  const key = value.trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(ARTICULATIONS, key)) return key;
  return consonantKey(key);
}

export function consonantVoiceParameters(value, phase = "hold", sampleRate = 48_000) {
  const key = consonantKey(value);
  const consonant = CONSONANTS[key];
  if (!consonant) return null;

  let eventPhase = phase;
  let rate = sampleRate;
  if (typeof phase === "number") {
    eventPhase = "hold";
    rate = phase;
  }
  eventPhase = typeof eventPhase === "string" ? eventPhase.toLowerCase() : "hold";
  if (!["attack", "hold", "release"].includes(eventPhase)) eventPhase = "hold";
  const numericRate = Number(rate);
  const safeSampleRate = Number.isFinite(numericRate)
    ? clamp(numericRate, 8_000, 384_000)
    : 48_000;
  const nyquistLimit = safeSampleRate * 0.45;
  const frequency = (number) => clamp(number, 80, nyquistLimit);
  const sustaining = eventPhase !== "release";
  const sustainScale = eventPhase === "attack" ? 0.72 : sustaining ? 1 : 0;
  const isStop = consonant.manner === "stop";
  const isFricative = consonant.manner === "fricative";
  const isNasal = consonant.manner === "nasal";
  const hasOralReleaseBurst = isStop && consonant.place !== "glottal";

  return {
    id: consonant.id,
    symbol: consonant.symbol,
    name: consonant.name,
    manner: consonant.manner,
    place: consonant.place,
    articulator: consonant.articulator,
    phase: eventPhase,
    voiced: consonant.voiced,
    constrictionPosition: consonant.constrictionPosition,
    oralClosure: sustaining ? consonant.oralClosure : 0,
    glottalClosure: sustaining ? consonant.glottalClosure : 0,
    voicingGain: isNasal ? sustainScale : 0,
    fricationFrequency: frequency(consonant.frication.frequency),
    fricationQ: consonant.frication.q,
    fricationGain: isFricative ? consonant.frication.gain * sustainScale : 0,
    burstFrequency: frequency(consonant.burst.frequency),
    burstQ: consonant.burst.q,
    burstGain: hasOralReleaseBurst && eventPhase === "release"
      ? consonant.burst.gain
      : 0,
    burstHalfLife: consonant.burst.halfLife,
    burstDuration: consonant.burst.duration,
    nasalPoleFrequency: frequency(consonant.nasal.poleFrequency),
    nasalNotchFrequency: frequency(consonant.nasal.notchFrequency),
    nasalQ: consonant.nasal.q,
    nasalCoupling: isNasal ? consonant.nasalCoupling * sustainScale : 0,
    nasalGain: isNasal ? consonant.nasal.gain * sustainScale : 0,
    gesture: consonant.gesture,
  };
}

const KEYBOARD_ARTICULATIONS = Object.freeze({
  a: "a",
  e: "e",
  i: "i",
  o: "o",
  u: "u",
  s: "s",
  k: "k",
  t: "t",
  p: "p",
  f: "f",
  m: "m",
  n: "n",
  q: "glottal",
  x: "sh",
  g: "ng",
});

export function keyboardArticulation(value) {
  if (typeof value !== "string" || value.length !== 1) return "";
  return KEYBOARD_ARTICULATIONS[value.toLowerCase()] ?? "";
}

export function keyboardPhoneme(value) {
  if (typeof value !== "string" || value.length !== 1) return "";
  const key = value.toLowerCase();
  return Object.prototype.hasOwnProperty.call(PHONEMES, key) ? key : "";
}

function defaultThroat(index) {
  return {
    aperture: clamp(0.36 + ((index * 0.19) % 0.38)),
    length: clamp(0.45 + ((index * 0.17) % 0.44)),
    muted: false,
  };
}

export function specimenState(name = "triune") {
  const key = SPECIMENS[name] ? name : "triune";
  const specimen = SPECIMENS[key];
  const throats = Array.from({ length: MAX_THROATS }, (_, index) => ({
    ...defaultThroat(index),
    ...(specimen.throats[index] ?? {}),
    muted: false,
  }));
  return {
    specimen: key,
    throatCount: specimen.throatCount,
    bodyLength: specimen.bodyLength,
    tension: specimen.tension,
    mutation: specimen.mutation,
    coupling: specimen.coupling,
    growl: specimen.growl,
    tongueCount: specimen.tongueCount,
    noseCount: specimen.noseCount,
    oralClosure: specimen.oralClosure,
    wet: specimen.wet,
    dry: specimen.dry,
    spread: specimen.spread,
    exciterPitch: specimen.exciterPitch,
    exciterIntensity: specimen.exciterIntensity,
    exciterTenseness: specimen.exciterTenseness,
    exciterBreath: specimen.exciterBreath,
    exciterVibrato: specimen.exciterVibrato,
    exciterWobble: specimen.exciterWobble,
    throats,
    tongues: specimen.tongues.map((tongue) => ({ ...tongue })),
    noses: specimen.noses.map((nose) => ({ ...nose })),
  };
}

export function glottalCoefficients(tenseness = 0.6) {
  const value = clamp(tenseness);
  const rd = clamp(3 * (1 - value), 0.5, 2.7);
  const ra = -0.01 + 0.048 * rd;
  const rk = 0.224 + 0.118 * rd;
  const rg = ((rk / 4) * (0.5 + 1.2 * rk)) / (0.11 * rd - ra * (0.5 + 1.2 * rk));
  const tp = 1 / (2 * rg);
  const te = tp * (1 + rk);
  const epsilon = 1 / ra;
  const shift = Math.exp(-epsilon * (1 - te));
  const delta = 1 - shift;
  const rhs = ((shift - 1) / epsilon + (1 - te) * shift) / delta;
  const lowerIntegral = -(te - tp) / 2 + rhs;
  const upperIntegral = -lowerIntegral;
  const omega = Math.PI / tp;
  const sineAtClosure = Math.sin(omega * te);
  const logarithmInput = Math.max(
    1e-8,
    (-Math.PI * sineAtClosure * upperIntegral) / (tp * 2),
  );
  const alpha = Math.log(logarithmInput) / (tp / 2 - te);
  const e0 = -1 / (sineAtClosure * Math.exp(alpha * te));
  return { alpha, delta, e0, epsilon, omega, shift, te };
}

export function glottalSample(phase, tenseness = 0.6) {
  const interpolation = ((Number(phase) || 0) % 1 + 1) % 1;
  const coefficients = glottalCoefficients(tenseness);
  return sampleGlottis(interpolation, coefficients);
}

function sampleGlottis(interpolation, coefficients) {
  if (interpolation > coefficients.te) {
    return (
      -Math.exp(-coefficients.epsilon * (interpolation - coefficients.te))
      + coefficients.shift
    ) / coefficients.delta;
  }
  return coefficients.e0
    * Math.exp(coefficients.alpha * interpolation)
    * Math.sin(coefficients.omega * interpolation);
}

export function glottalHarmonics(tenseness = 0.6, harmonicCount = 48, sampleCount = 1024) {
  const harmonics = Math.max(4, Math.min(96, Math.round(harmonicCount)));
  const samples = Math.max(128, Math.min(4096, Math.round(sampleCount)));
  const real = new Float32Array(harmonics + 1);
  const imaginary = new Float32Array(harmonics + 1);
  const coefficients = glottalCoefficients(tenseness);
  const waveform = Float32Array.from(
    { length: samples },
    (_, index) => sampleGlottis(index / samples, coefficients),
  );
  for (let harmonic = 1; harmonic <= harmonics; harmonic += 1) {
    let cosine = 0;
    let sine = 0;
    for (let index = 0; index < samples; index += 1) {
      const phase = index / samples;
      const value = waveform[index];
      const angle = Math.PI * 2 * harmonic * phase;
      cosine += value * Math.cos(angle);
      sine += value * Math.sin(angle);
    }
    real[harmonic] = cosine * 2 / samples;
    imaginary[harmonic] = sine * 2 / samples;
  }
  return { real, imaginary };
}

export function smoothEnvelope(
  previous,
  target,
  deltaMilliseconds,
  attackMilliseconds = 55,
  releaseMilliseconds = 320,
) {
  const from = Math.max(0, Number(previous) || 0);
  const to = Math.max(0, Number(target) || 0);
  const elapsed = Math.max(0, Number(deltaMilliseconds) || 0);
  const time = Math.max(1, to > from ? attackMilliseconds : releaseMilliseconds);
  return from + (to - from) * (1 - Math.exp(-elapsed / time));
}

export function throatSlots(count) {
  const total = Math.round(clamp(count, 1, MAX_THROATS));
  if (total === 1) return [0];
  const spread = total === 2 ? 0.44 : total === 3 ? 0.68 : 0.82;
  return Array.from(
    { length: total },
    (_, index) => -spread + (index / (total - 1)) * spread * 2,
  );
}

function unitVector(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const magnitude = Math.max(0.0001, Math.hypot(dx, dy));
  return { x: dx / magnitude, y: dy / magnitude };
}

function offsetPoint(point, normal, distance) {
  return {
    x: point.x + normal.x * distance,
    y: point.y + normal.y * distance,
  };
}

export function anatomyLayout(width, height, state) {
  const safeWidth = Math.max(320, Number(width) || 320);
  const safeHeight = Math.max(150, Number(height) || 220);
  const shortSide = Math.min(safeWidth, safeHeight);
  const centerY = safeHeight * 0.5;
  const root = { x: safeWidth * 0.105, y: centerY };
  const larynx = {
    x: safeWidth * (0.205 + clamp(state.bodyLength) * 0.055),
    y: centerY,
  };
  const junction = {
    x: safeWidth * (0.36 + clamp(state.bodyLength) * 0.105),
    y: centerY,
  };
  const bodyRadius = shortSide * (0.084 + clamp(state.tension) * 0.016);
  const slots = throatSlots(state.throatCount);
  const branches = slots.map((slot, index) => {
    const throat = state.throats[index] ?? defaultThroat(index);
    const length = clamp(throat.length);
    const aperture = clamp(throat.aperture);
    const mouth = {
      x: safeWidth * (0.78 + length * 0.145),
      y: centerY + slot * safeHeight * 0.355,
    };
    const direction = unitVector(junction, mouth);
    const normal = { x: -direction.y, y: direction.x };
    const outerSign = Math.abs(slot) < 0.001 ? -1 : Math.sign(slot);
    const mutationDirection = index % 2 === 0 ? 1 : -1;
    const bend = {
      x: junction.x + (mouth.x - junction.x) * (0.47 + (length - 0.5) * 0.08),
      y: junction.y + (mouth.y - junction.y) * 0.48
        + mutationDirection * clamp(state.mutation) * shortSide * 0.038,
    };
    const widthAtJunction = shortSide * (0.014 + aperture * 0.015);
    const widthAtBend = shortSide * (0.022 + aperture * 0.069);
    const widthAtMouth = shortSide * (0.009 + aperture * 0.042);
    const handle = offsetPoint(bend, normal, widthAtBend * outerSign);
    const polygon = [
      offsetPoint(junction, normal, widthAtJunction),
      offsetPoint(bend, normal, widthAtBend),
      offsetPoint(mouth, normal, widthAtMouth),
      offsetPoint(mouth, normal, -widthAtMouth),
      offsetPoint(bend, normal, -widthAtBend),
      offsetPoint(junction, normal, -widthAtJunction),
    ];
    return {
      index,
      slot,
      root: junction,
      bend,
      mouth,
      direction,
      normal,
      outerSign,
      handle,
      polygon,
      aperture,
      length,
      muted: Boolean(throat.muted),
    };
  });

  return {
    width: safeWidth,
    height: safeHeight,
    shortSide,
    centerY,
    root,
    larynx,
    junction,
    bodyRadius,
    branches,
  };
}

export function throatVoiceParameters(state, index, sampleRate = 48_000) {
  const count = Math.round(clamp(state.throatCount, 1, MAX_THROATS));
  const voiceIndex = boundedInteger(index, 0, MAX_THROATS - 1);
  const throat = state.throats?.[voiceIndex] ?? defaultThroat(voiceIndex);
  const aperture = clamp(throat.aperture);
  const length = clamp(throat.length);
  const bodyLength = clamp(state.bodyLength);
  const tension = clamp(state.tension);
  const mutation = clamp(state.mutation);
  const growl = clamp(state.growl);
  const rate = Number(sampleRate);
  const safeSampleRate = Number.isFinite(rate) ? clamp(rate, 8_000, 384_000) : 48_000;
  const nyquistLimit = safeSampleRate * 0.45;
  const tongueCount = boundedInteger(state.tongueCount, 1, MAX_TONGUES, 1);
  const voicePosition = count <= 1 ? 0.5 : voiceIndex / (count - 1);
  let tongueIndex = 0;
  let strongestTongueWeight = -1;
  let tongueWeight = 0;
  let strongestLingualContact = 0;
  const tongue = { position: 0, height: 0, curl: 0 };
  for (let index = 0; index < tongueCount; index += 1) {
    const next = normalizeTongue(
      state.tongues?.[index],
      defaultTongue(index),
    );
    const articulatorPosition = tongueCount <= 1 ? 0.5 : index / (tongueCount - 1);
    const distance = Math.abs(voicePosition - articulatorPosition);
    const weight = 0.22 + Math.pow(1 - distance, 2) * 0.78;
    if (weight > strongestTongueWeight) {
      strongestTongueWeight = weight;
      tongueIndex = index;
    }
    tongue.position += next.position * weight;
    tongue.height += next.height * weight;
    tongue.curl += next.curl * weight;
    strongestLingualContact = Math.max(
      strongestLingualContact,
      clamp((next.height * 0.52 + next.curl * 0.7 - 0.48) / 0.68)
        * (0.45 + weight * 0.55),
    );
    tongueWeight += weight;
  }
  tongue.position /= tongueWeight;
  tongue.height /= tongueWeight;
  tongue.curl /= tongueWeight;
  const oralClosure = unitValue(state.oralClosure);
  const tractScale = 0.68 + (1 - bodyLength) * 0.68;
  const mutationSkew = 1 + Math.sin((voiceIndex + 1) * 2.17) * mutation * 0.16;
  const tongueHeightScale = 1.2 - tongue.height * 0.44;
  const tongueFrontShift = (tongue.position - 0.5) * 1_260;
  const first = (
    (170 + aperture * 720)
    * tractScale
    * mutationSkew
    * tongueHeightScale
  );
  const second = (
    610
    + (1 - length) * 1_760
    + voiceIndex * 118
    + tongueFrontShift
    + tongue.height * 150
  ) * tractScale;
  const third = Math.min(
    nyquistLimit,
    (
      1_680
      + aperture * 1_620
      + voiceIndex * 205
      + (tongue.curl - 0.5) * 380
    ) * tractScale * (2 - mutationSkew),
  );
  const fourth = Math.min(
    nyquistLimit,
    (
      3_250
      + length * 2_100
      + voiceIndex * 270
      + tongue.position * 240
    ) * (0.82 + tension * 0.32),
  );
  const resonance = 2.4 + tension * 8.8 + (1 - aperture) * 4.2;
  const pan = count === 1
    ? 0
    : clamp((voiceIndex / (count - 1)) * 2 - 1, -1, 1);
  const lingualContact = clamp(
    (tongue.height * 0.52 + tongue.curl * 0.7 - 0.48) / 0.68,
  );
  const contact = Math.max(oralClosure, lingualContact, strongestLingualContact);
  const oralGain = clamp(
    oralOpening(oralClosure) * (1 - contact * 0.16),
  );
  const turbulenceFrequency = clamp(
    (
      820
      + tongue.position * 7_800
      + tongue.curl * 980
      + tension * 420
    ) * (0.9 + (1 - bodyLength) * 0.18),
    320,
    nyquistLimit,
  );

  return {
    formants: [first, second, third, fourth].map((frequency) => (
      clamp(frequency, 80, nyquistLimit)
    )),
    resonance,
    peakGains: [
      8 + aperture * 6,
      11 - aperture * 2,
      7 + mutation * 5,
      3 + tension * 4,
    ],
    lowpass: clamp(2_200 + aperture * 9_800 + tension * 2_000, 1_600, nyquistLimit),
    highpass: 48 + (1 - aperture) * 190,
    delay: 0.003 + length * 0.028 + voiceIndex * mutation * 0.0017,
    pan,
    ringFrequency: 23 + voiceIndex * 17 + mutation * 83 + tension * 29,
    ringMix: growl * (0.12 + mutation * 0.48),
    normalMix: 1 - growl * 0.42,
    gain: throat.muted ? 0 : 1 / Math.sqrt(count),
    oralGain,
    contact,
    turbulenceFrequency,
    tongueIndex,
  };
}

export function noseVoiceParameters(state, index, sampleRate = 48_000) {
  const noseCount = boundedInteger(state.noseCount, 0, MAX_NOSES, 0);
  const noseIndex = boundedInteger(index, 0, MAX_NOSES - 1);
  const nose = normalizeNose(
    state.noses?.[noseIndex],
    defaultNose(noseIndex),
  );
  const bodyLength = unitValue(state.bodyLength, 0.5);
  const tension = unitValue(state.tension, 0.5);
  const mutation = unitValue(state.mutation);
  const coupling = unitValue(state.coupling, 0.5);
  const spread = unitValue(state.spread, 1);
  const rate = Number(sampleRate);
  const safeSampleRate = Number.isFinite(rate) ? clamp(rate, 8_000, 384_000) : 48_000;
  const nyquistLimit = safeSampleRate * 0.45;
  const nasalScale = 0.72 + (1 - nose.length) * 0.62;
  const poleFrequency = clamp(
    (
      155
      + (1 - bodyLength) * 310
      + noseIndex * 74
      + nose.openness * 95
    ) * nasalScale,
    80,
    Math.min(1_600, nyquistLimit),
  );
  const poleQ = clamp(
    2.1 + nose.resonance * 13.4 + tension * 2.2,
    1,
    24,
  );
  const notchFrequency = clamp(
    (
      690
      + (1 - nose.length) * 1_920
      + noseIndex * 205
      + mutation * 170
    ) * (0.88 + (1 - bodyLength) * 0.18),
    240,
    nyquistLimit,
  );
  const notchQ = clamp(
    1.2 + nose.resonance * 8.8 + (1 - nose.openness) * 2.4,
    0.7,
    16,
  );
  const lowpass = clamp(
    1_650
      + (1 - nose.length) * 5_200
      + nose.openness * 2_250
      + tension * 620,
    600,
    nyquistLimit,
  );
  const active = noseIndex < noseCount;
  const gain = active
    ? clamp(
      nose.openness
        * (0.1 + coupling * 0.5)
        / Math.sqrt(Math.max(1, noseCount)),
    )
    : 0;
  const pan = !active || noseCount <= 1
    ? 0
    : clamp(((noseIndex / (noseCount - 1)) * 2 - 1) * spread, -1, 1);

  return {
    poleFrequency,
    poleQ,
    notchFrequency,
    notchQ,
    lowpass,
    gain,
    pan,
    delay: clamp(0.002 + nose.length * 0.021 + noseIndex * 0.0015, 0.002, 0.03),
  };
}

export function waveformLevel(samples) {
  if (!samples?.length) return { rms: 0, peak: 0 };
  let sum = 0;
  let peak = 0;
  for (const sample of samples) {
    const magnitude = Math.abs(Number(sample) || 0);
    sum += magnitude * magnitude;
    peak = Math.max(peak, magnitude);
  }
  return {
    rms: Math.sqrt(sum / samples.length),
    peak,
  };
}
