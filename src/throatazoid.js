export const MAX_THROATS = 7;
export const MAX_MOUTHS = MAX_THROATS;
export const MAX_TONGUES = 5;
export const MAX_NOSES = 3;
export const MAX_PRESSURE_SOURCES = 4;
export const TRACT_SECTION_COUNT = 44;
export const TONGUE_TRACT_START = 12.9;
export const TONGUE_TRACT_END = 30.4;
export const TONGUE_DIAMETER_INNER = 2.05;
export const TONGUE_DIAMETER_OUTER = 3.5;
const SINGING_INTERVAL_FALLBACKS = Object.freeze([-12, 0, 7, 12, 19, 24, 31]);
const SINGING_DETUNE_FALLBACKS = Object.freeze([-8, 5, -4, 7, -6, 3, -2]);

function defineSpecimen(specimen) {
  const articulation = specimenArticulation(specimen);
  const seed = nameSeed(specimen.name);
  const voiceCount = boundedInteger(specimen.throatCount, 1, MAX_THROATS, 1);
  const voiceMode = specimen.voiceMode === "polyphonic" ? "polyphonic" : "shared";
  const voiceIntervals = Array.from({ length: voiceCount }, (_, index) => {
    const interval = Number(specimen.voiceIntervals?.[index]);
    return Number.isFinite(interval) ? clamp(interval, -48, 48) : 0;
  });
  const voiceDetunes = Array.from({ length: voiceCount }, (_, index) => {
    const detune = Number(specimen.voiceDetunes?.[index]);
    return Number.isFinite(detune) ? clamp(detune, -1_200, 1_200) : 0;
  });
  return Object.freeze({
    ...specimen,
    voiceMode,
    voiceIntervals: Object.freeze(voiceIntervals),
    voiceDetunes: Object.freeze(voiceDetunes),
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
  singing: defineSpecimen({
    name: "Singing",
    description: "five pitched mouths",
    voiceMode: "polyphonic",
    voiceIntervals: [-12, 0, 7, 12, 19],
    voiceDetunes: [-8, 5, -4, 7, -6],
    throatCount: 5,
    bodyLength: 0.58,
    tension: 0.54,
    mutation: 0.19,
    coupling: 0.56,
    growl: 0.03,
    wet: 0.98,
    dry: 0,
    spread: 1,
    exciterPitch: 110,
    exciterIntensity: 0.72,
    exciterTenseness: 0.58,
    exciterBreath: 0.09,
    exciterVibrato: 0.36,
    exciterWobble: 0.08,
    throats: [
      { aperture: 0.58, length: 0.76 },
      { aperture: 0.64, length: 0.65 },
      { aperture: 0.72, length: 0.54 },
      { aperture: 0.62, length: 0.47 },
      { aperture: 0.56, length: 0.4 },
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

export function tongueTractCoordinates(tongue = {}) {
  const position = clamp(tongue.position);
  const height = clamp(tongue.height);
  return {
    index: TONGUE_TRACT_START
      + position * (TONGUE_TRACT_END - TONGUE_TRACT_START),
    diameter: TONGUE_DIAMETER_OUTER
      - height * (TONGUE_DIAMETER_OUTER - TONGUE_DIAMETER_INNER),
  };
}

export function tongueFromTractCoordinates(index, diameter) {
  const lower = TONGUE_TRACT_START;
  const upper = TONGUE_TRACT_END;
  const centre = (lower + upper) * 0.5;
  const controlDiameter = clamp(
    diameter,
    TONGUE_DIAMETER_INNER,
    TONGUE_DIAMETER_OUTER,
  );
  let reach = (
    TONGUE_DIAMETER_OUTER - controlDiameter
  ) / (
    TONGUE_DIAMETER_OUTER - TONGUE_DIAMETER_INNER
  );
  reach = Math.pow(clamp(reach), 0.58) - 0.2 * (reach * reach - reach);
  const halfRange = reach * 0.5 * (upper - lower);
  const constrainedIndex = clamp(
    index,
    centre - halfRange,
    centre + halfRange,
  );
  return {
    position: clamp((constrainedIndex - lower) / (upper - lower)),
    height: clamp(
      (TONGUE_DIAMETER_OUTER - controlDiameter)
        / (TONGUE_DIAMETER_OUTER - TONGUE_DIAMETER_INNER),
    ),
    index: constrainedIndex,
    diameter: controlDiameter,
  };
}

export function roundedAirwayPath(points, iterations = 3) {
  const source = Array.from(points ?? [], (point) => ({
    x: Number.isFinite(Number(point?.x)) ? Number(point.x) : 0,
    y: Number.isFinite(Number(point?.y)) ? Number(point.y) : 0,
  }));
  if (source.length < 2) return source;
  let path = source;
  const passes = Math.round(clamp(iterations, 0, 6));
  for (let pass = 0; pass < passes; pass += 1) {
    const rounded = [path[0]];
    for (let index = 0; index < path.length - 1; index += 1) {
      const from = path[index];
      const to = path[index + 1];
      rounded.push(
        {
          x: from.x * 0.75 + to.x * 0.25,
          y: from.y * 0.75 + to.y * 0.25,
        },
        {
          x: from.x * 0.25 + to.x * 0.75,
          y: from.y * 0.25 + to.y * 0.75,
        },
      );
    }
    rounded.push(path[path.length - 1]);
    path = rounded;
  }
  return path;
}

export function sampleDiameterProfile(profile, index) {
  if (!profile?.length) return 0;
  const position = clamp(index, 0, profile.length - 1);
  const lower = Math.floor(position);
  const upper = Math.min(profile.length - 1, lower + 1);
  const blend = position - lower;
  const from = Number(profile[lower]) || 0;
  const to = Number(profile[upper]) || 0;
  return from + (to - from) * blend;
}

export function applyTractHeightDeformations(
  baseDiameters,
  deformations = [],
  { minimum = 0.001, maximum = 4 } = {},
) {
  const source = Array.from(baseDiameters ?? []);
  const result = Float32Array.from(source, (diameter) => (
    clamp(diameter, minimum, maximum)
  ));
  for (let index = 0; index < result.length; index += 1) {
    let displacement = 0;
    for (const deformation of deformations ?? []) {
      const center = Number(deformation?.center);
      const radius = Math.max(0.0001, Number(deformation?.radius) || 0);
      const height = Number(deformation?.height);
      const strength = Number.isFinite(Number(deformation?.strength))
        ? Number(deformation.strength)
        : 1;
      if (!Number.isFinite(center) || !Number.isFinite(height)) continue;
      const distance = Math.abs(index - center);
      if (distance >= radius) continue;
      const weight = 0.5 * (1 + Math.cos(Math.PI * distance / radius));
      displacement += height * strength * weight;
    }
    result[index] = clamp(result[index] + displacement, minimum, maximum);
  }
  return result;
}

export function alienTongueDeformations(state = {}) {
  const mutation = unitValue(state.mutation);
  if (mutation <= 0.001) return [];
  const tongues = state.tongues ?? [];
  const count = boundedInteger(
    state.tongueCount,
    1,
    MAX_TONGUES,
    tongues.length || 1,
  );
  return Array.from({ length: count }, (_, index) => {
    const tongue = tongues[index] ?? tongues[0] ?? {};
    const control = tongueTractCoordinates(tongue);
    const curl = unitValue(tongue.curl, 0.5);
    const polarity = index % 2 ? 1 : -1;
    return {
      center: clamp(
        control.index + (curl - 0.5) * (2.5 + index * 0.65),
        9,
        37,
      ),
      radius: 2.6 + mutation * 2.4 + index * 0.24,
      height: (
        (curl - 0.5) * 0.58
        + (index > 0 ? polarity * 0.16 : 0)
      ) * mutation,
      strength: 0.72 + index * 0.06,
    };
  });
}

export function smoothTractDiameters(
  currentDiameters,
  targetDiameters,
  deltaMilliseconds,
  {
    movementSpeed = 15,
    noseStart = 17,
    tipStart = 32,
  } = {},
) {
  const target = Array.from(targetDiameters ?? []);
  const current = Array.from(currentDiameters ?? []);
  const elapsed = clamp(deltaMilliseconds, 0, 100) / 1_000;
  const amount = Math.max(0, Number(movementSpeed) || 0) * elapsed;
  return Float32Array.from(target, (requested, index) => {
    const destination = clamp(Number(requested) || 0.001, 0.001, 4);
    const present = clamp(
      Number.isFinite(Number(current[index])) ? Number(current[index]) : destination,
      0.001,
      4,
    );
    const slowReturn = index < noseStart
      ? 0.6
      : index >= tipStart
        ? 1
        : 0.6 + 0.4 * (index - noseStart) / Math.max(1, tipStart - noseStart);
    return present < destination
      ? Math.min(present + slowReturn * amount, destination)
      : Math.max(present - 2 * amount, destination);
  });
}

export const THROATAZOID_OUTPUT_TRIM = 0.82;

export function calibratedOutputGain(level) {
  return Math.sqrt(clamp(level)) * THROATAZOID_OUTPUT_TRIM;
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

  if (specimen.name === "Singing") {
    return {
      tongueCount: 3,
      noseCount: 2,
      oralClosure: 0.02,
      tongues: [
        { position: 0.36, height: 0.12, curl: 0.06 },
        { position: 0.53, height: 0.2, curl: 0.1 },
        { position: 0.7, height: 0.16, curl: 0.08 },
      ],
      noses: [
        { openness: 0.035, length: 0.52, resonance: 0.46 },
        { openness: 0.025, length: 0.7, resonance: 0.58 },
        { openness: 0.01, length: 0.84, resonance: 0.68 },
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
    lipDiameter: clamp(
      Number.isFinite(Number(phoneme.lipDiameter)) ? Number(phoneme.lipDiameter) : 3,
      0.35,
      3,
    ),
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
    tongueCount: 1,
    noseCount: 1,
    oralClosure: 0,
    lipDiameter: 3,
    tongues: [
      // Pink-style /ɑ/: tract index 13, tongue diameter 2.40.
      { position: 0.006, height: 0.759, curl: 0.08 },
    ],
    noses: CLOSED_NOSES,
  }),
  e: freezePhoneme({
    name: "E",
    kind: "vowel",
    tongueCount: 1,
    noseCount: 1,
    oralClosure: 0,
    lipDiameter: 3,
    tongues: [
      // Pink-style /e~ɛ/: tract index 20, tongue diameter 3.35.
      { position: 0.406, height: 0.103, curl: 0.1 },
    ],
    noses: CLOSED_NOSES,
  }),
  i: freezePhoneme({
    name: "I",
    kind: "vowel",
    tongueCount: 1,
    noseCount: 1,
    oralClosure: 0,
    lipDiameter: 3,
    tongues: [
      // Pink-style /i/: tract index 27.4, tongue diameter 2.25.
      { position: 0.829, height: 0.862, curl: 0.12 },
    ],
    noses: CLOSED_NOSES,
  }),
  o: freezePhoneme({
    name: "O",
    kind: "vowel",
    tongueCount: 1,
    noseCount: 1,
    oralClosure: 0,
    lipDiameter: 0.95,
    tongues: [
      // Pink-style /ɔ/: tract index 17.7, tongue diameter 2.05.
      { position: 0.274, height: 1, curl: 0.2 },
    ],
    noses: CLOSED_NOSES,
  }),
  u: freezePhoneme({
    name: "U",
    kind: "vowel",
    tongueCount: 1,
    noseCount: 1,
    oralClosure: 0,
    // Pink's rounded U gesture constricts the lip section to about 0.5 cm.
    lipDiameter: 0.5,
    tongues: [
      // Pink-style /u/: tract index 23, tongue diameter 2.10.
      { position: 0.577, height: 0.966, curl: 0.28 },
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
    constrictionDiameter: clamp(
      Number.isFinite(Number(consonant.constrictionDiameter))
        ? Number(consonant.constrictionDiameter)
        : 0,
      0,
      3,
    ),
    oralClosure: unitValue(consonant.oralClosure),
    glottalClosure: unitValue(consonant.glottalClosure),
    nasalCoupling: unitValue(consonant.nasalCoupling),
    lipDiameter: consonant.lipDiameter == null
      ? null
      : clamp(Number(consonant.lipDiameter), 0.35, 3),
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

const CORE_CONSONANTS = Object.freeze({
  glottal: freezeConsonant("glottal", {
    symbol: "ʔ",
    name: "Glottal stop",
    manner: "stop",
    place: "glottal",
    articulator: "glottis",
    voiced: false,
    constrictionPosition: 0,
    constrictionDiameter: 3,
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
    constrictionDiameter: 0,
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
    constrictionDiameter: 0,
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
    constrictionDiameter: 0,
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
    constrictionDiameter: 0.6,
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
    constrictionDiameter: 0.6,
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
    constrictionDiameter: 0.5,
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
    constrictionDiameter: 0,
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
    constrictionDiameter: 0,
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
    constrictionDiameter: 0,
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

function derivedConsonant(id, baseId, overrides) {
  const base = CORE_CONSONANTS[baseId];
  return freezeConsonant(id, {
    ...base,
    ...overrides,
    frication: { ...base.frication, ...overrides.frication },
    burst: { ...base.burst, ...overrides.burst },
    nasal: { ...base.nasal, ...overrides.nasal },
    gesture: overrides.gesture ?? base.gesture,
  });
}

const LETTER_CONSONANTS = Object.freeze({
  b: derivedConsonant("b", "p", {
    symbol: "B",
    name: "B",
    voiced: true,
    glottalClosure: 0,
    burst: { frequency: 920, q: 0.9, gain: 0.64 },
  }),
  c: derivedConsonant("c", "sh", {
    symbol: "CH",
    name: "C / CH",
    manner: "affricate",
    voiced: false,
    constrictionPosition: 0.72,
    constrictionDiameter: 0.4,
    oralClosure: 0.76,
    frication: { frequency: 3_750, q: 2.9, gain: 0.92 },
    burst: { frequency: 3_350, q: 2.5, gain: 0.76 },
  }),
  d: derivedConsonant("d", "t", {
    symbol: "D",
    name: "D",
    voiced: true,
    glottalClosure: 0,
    burst: { frequency: 4_650, q: 2.8, gain: 0.68 },
  }),
  g: derivedConsonant("g", "k", {
    symbol: "G",
    name: "G",
    voiced: true,
    glottalClosure: 0,
    burst: { frequency: 2_050, q: 2.4, gain: 0.72 },
  }),
  h: derivedConsonant("h", "f", {
    symbol: "H",
    name: "H",
    place: "glottal",
    articulator: "glottis",
    constrictionPosition: 0.02,
    constrictionDiameter: 0.56,
    oralClosure: 0.42,
    frication: { frequency: 1_250, q: 0.62, gain: 0.62 },
    burst: { frequency: 1_050, q: 0.7, gain: 0 },
    gesture: GLOTTAL_GESTURE,
  }),
  j: derivedConsonant("j", "sh", {
    symbol: "J",
    name: "J / DZH",
    manner: "affricate",
    voiced: true,
    constrictionPosition: 0.7,
    constrictionDiameter: 0.42,
    oralClosure: 0.72,
    frication: { frequency: 3_150, q: 2.5, gain: 0.68 },
    burst: { frequency: 2_950, q: 2.2, gain: 0.54 },
  }),
  l: derivedConsonant("l", "n", {
    symbol: "L",
    name: "L",
    manner: "approximant",
    voiced: true,
    nasalCoupling: 0,
    constrictionPosition: 0.86,
    constrictionDiameter: 1.05,
    oralClosure: 0.24,
    frication: { gain: 0 },
    burst: { gain: 0 },
    nasal: { gain: 0 },
    gesture: T_GESTURE,
  }),
  q: derivedConsonant("q", "k", {
    symbol: "Q",
    name: "Q / KW",
    constrictionPosition: 0.13,
    lipDiameter: 0.58,
    burst: { frequency: 1_900, q: 2.2, gain: 1.05 },
  }),
  r: derivedConsonant("r", "sh", {
    symbol: "R",
    name: "R",
    manner: "approximant",
    voiced: true,
    constrictionPosition: 0.66,
    constrictionDiameter: 0.82,
    oralClosure: 0.33,
    frication: { gain: 0 },
    burst: { gain: 0 },
  }),
  v: derivedConsonant("v", "f", {
    symbol: "V",
    name: "V",
    voiced: true,
    frication: { frequency: 1_650, q: 0.78, gain: 0.5 },
  }),
  w: derivedConsonant("w", "k", {
    symbol: "W",
    name: "W",
    manner: "approximant",
    voiced: true,
    constrictionPosition: 0.18,
    constrictionDiameter: 1.15,
    oralClosure: 0.18,
    lipDiameter: 0.55,
    frication: { gain: 0 },
    burst: { gain: 0 },
  }),
  x: derivedConsonant("x", "k", {
    symbol: "X",
    name: "X / KS",
    manner: "fricative",
    voiced: false,
    constrictionPosition: 0.28,
    constrictionDiameter: 0.55,
    oralClosure: 0.6,
    frication: { frequency: 3_250, q: 1.9, gain: 0.96 },
    burst: { frequency: 2_800, q: 1.8, gain: 0 },
  }),
  y: derivedConsonant("y", "sh", {
    symbol: "Y",
    name: "Y",
    manner: "approximant",
    voiced: true,
    constrictionPosition: 0.58,
    constrictionDiameter: 1.1,
    oralClosure: 0.2,
    lipDiameter: 2.4,
    frication: { gain: 0 },
    burst: { gain: 0 },
  }),
  z: derivedConsonant("z", "s", {
    symbol: "Z",
    name: "Z",
    voiced: true,
    frication: { frequency: 7_250, q: 4.4, gain: 0.72 },
  }),
});

export const CONSONANTS = Object.freeze({
  ...CORE_CONSONANTS,
  ...LETTER_CONSONANTS,
});

export const ARTICULATIONS = Object.freeze({
  ...PHONEMES,
  ...CONSONANTS,
});

function defineVoicePreset(preset) {
  return Object.freeze({
    sourceMode: "glottis",
    pressureSourceCount: 1,
    articulationVoicing: 0.94,
    nasalCoupling: 0,
    ...preset,
    parameters: Object.freeze({ ...preset.parameters }),
    throats: Object.freeze(
      (preset.throats ?? []).map((throat) => Object.freeze({ ...throat })),
    ),
    voiceIntervals: preset.voiceIntervals
      ? Object.freeze([...preset.voiceIntervals])
      : undefined,
    voiceDetunes: preset.voiceDetunes
      ? Object.freeze([...preset.voiceDetunes])
      : undefined,
  });
}

// These are immediate, audition-ready voices. The older SPECIMENS remain the
// deeper alien-anatomy bank; this set starts with intelligible one-mouth speech.
export const VOICE_PRESETS = Object.freeze({
  clear: defineVoicePreset({
    name: "Playable default",
    description: "classic 44-section voice",
    specimen: "oracle",
    phoneme: "a",
    parameters: {
      throatCount: 1,
      bodyLength: 0.55,
      tension: 0.56,
      mutation: 0,
      coupling: 0,
      growl: 0,
      wet: 1,
      dry: 0,
      spread: 0,
      exciterPitch: 140,
      exciterIntensity: 1,
      exciterTenseness: 0.6,
      exciterBreath: 0.12,
      exciterVibrato: 0.12,
      exciterWobble: 0.03,
      classicTopology: true,
      voiceMode: "shared",
    },
    throats: [{ aperture: 1, length: 0.56 }],
  }),
  deep: defineVoicePreset({
    name: "Deep",
    description: "low rounded O",
    specimen: "oracle",
    phoneme: "o",
    parameters: {
      throatCount: 1,
      bodyLength: 0.92,
      tension: 0.48,
      mutation: 0,
      coupling: 0,
      growl: 0.04,
      wet: 1,
      dry: 0,
      spread: 0,
      exciterPitch: 72,
      exciterIntensity: 0.84,
      exciterTenseness: 0.56,
      exciterBreath: 0.1,
      exciterVibrato: 0.02,
      exciterWobble: 0.025,
      voiceMode: "shared",
    },
    throats: [{ aperture: 0.92, length: 0.96 }],
  }),
  bright: defineVoicePreset({
    name: "Bright",
    description: "high focused EE",
    specimen: "oracle",
    phoneme: "i",
    parameters: {
      throatCount: 1,
      bodyLength: 0.28,
      tension: 0.76,
      mutation: 0,
      coupling: 0,
      growl: 0,
      wet: 1,
      dry: 0,
      spread: 0,
      exciterPitch: 196,
      exciterIntensity: 0.62,
      exciterTenseness: 0.74,
      exciterBreath: 0.055,
      exciterVibrato: 0.035,
      exciterWobble: 0.01,
      voiceMode: "shared",
    },
    throats: [{ aperture: 0.82, length: 0.3 }],
  }),
  warm: defineVoicePreset({
    name: "Warm",
    description: "soft mid E",
    specimen: "oracle",
    phoneme: "e",
    parameters: {
      throatCount: 1,
      bodyLength: 0.63,
      tension: 0.46,
      mutation: 0.015,
      coupling: 0,
      growl: 0,
      wet: 1,
      dry: 0,
      spread: 0,
      exciterPitch: 138,
      exciterIntensity: 0.72,
      exciterTenseness: 0.5,
      exciterBreath: 0.14,
      exciterVibrato: 0.07,
      exciterWobble: 0.025,
      voiceMode: "shared",
    },
    throats: [{ aperture: 0.9, length: 0.64 }],
  }),
  alto: defineVoicePreset({
    name: "Alto",
    description: "175 Hz velvet E",
    specimen: "oracle",
    phoneme: "e",
    parameters: {
      throatCount: 1,
      bodyLength: 0.53,
      tension: 0.48,
      mutation: 0,
      coupling: 0,
      growl: 0,
      wet: 1,
      dry: 0,
      spread: 0,
      exciterPitch: 175,
      exciterIntensity: 0.72,
      exciterTenseness: 0.52,
      exciterBreath: 0.12,
      exciterVibrato: 0.05,
      exciterWobble: 0.018,
      voiceMode: "shared",
    },
    throats: [{ aperture: 0.9, length: 0.56 }],
  }),
  mezzo: defineVoicePreset({
    name: "Mezzo",
    description: "220 Hz clear A",
    specimen: "oracle",
    phoneme: "a",
    parameters: {
      throatCount: 1,
      bodyLength: 0.42,
      tension: 0.6,
      mutation: 0,
      coupling: 0,
      growl: 0,
      wet: 1,
      dry: 0,
      spread: 0,
      exciterPitch: 220,
      exciterIntensity: 0.67,
      exciterTenseness: 0.64,
      exciterBreath: 0.085,
      exciterVibrato: 0.065,
      exciterWobble: 0.012,
      voiceMode: "shared",
    },
    throats: [{ aperture: 0.86, length: 0.44 }],
  }),
  soprano: defineVoicePreset({
    name: "Soprano",
    description: "262 Hz lyric A",
    specimen: "oracle",
    phoneme: "a",
    parameters: {
      throatCount: 1,
      bodyLength: 0.32,
      tension: 0.7,
      mutation: 0,
      coupling: 0,
      growl: 0,
      wet: 1,
      dry: 0,
      spread: 0,
      exciterPitch: 262,
      exciterIntensity: 0.59,
      exciterTenseness: 0.7,
      exciterBreath: 0.075,
      exciterVibrato: 0.085,
      exciterWobble: 0.01,
      voiceMode: "shared",
    },
    throats: [{ aperture: 0.84, length: 0.34 }],
  }),
  airy: defineVoicePreset({
    name: "Airy",
    description: "247 Hz breathy U",
    specimen: "oracle",
    phoneme: "u",
    articulationVoicing: 0.78,
    parameters: {
      throatCount: 1,
      bodyLength: 0.36,
      tension: 0.32,
      mutation: 0,
      coupling: 0,
      growl: 0,
      wet: 1,
      dry: 0,
      spread: 0,
      exciterPitch: 247,
      exciterIntensity: 0.74,
      exciterTenseness: 0.3,
      exciterBreath: 0.52,
      exciterVibrato: 0.045,
      exciterWobble: 0.022,
      voiceMode: "shared",
    },
    throats: [{ aperture: 0.78, length: 0.39 }],
  }),
  bell: defineVoicePreset({
    name: "Bell",
    description: "330 Hz ringing EE",
    specimen: "oracle",
    phoneme: "i",
    articulationVoicing: 0.98,
    parameters: {
      throatCount: 1,
      bodyLength: 0.24,
      tension: 0.88,
      mutation: 0,
      coupling: 0,
      growl: 0,
      wet: 1,
      dry: 0,
      spread: 0,
      exciterPitch: 330,
      exciterIntensity: 0.52,
      exciterTenseness: 0.86,
      exciterBreath: 0.035,
      exciterVibrato: 0.035,
      exciterWobble: 0.005,
      voiceMode: "shared",
    },
    throats: [{ aperture: 0.74, length: 0.27 }],
  }),
  coloratura: defineVoicePreset({
    name: "Coloratura",
    description: "392 Hz agile E",
    specimen: "oracle",
    phoneme: "e",
    articulationVoicing: 0.96,
    parameters: {
      throatCount: 1,
      bodyLength: 0.2,
      tension: 0.76,
      mutation: 0,
      coupling: 0,
      growl: 0,
      wet: 1,
      dry: 0,
      spread: 0,
      exciterPitch: 392,
      exciterIntensity: 0.48,
      exciterTenseness: 0.74,
      exciterBreath: 0.06,
      exciterVibrato: 0.12,
      exciterWobble: 0.008,
      voiceMode: "shared",
    },
    throats: [{ aperture: 0.82, length: 0.22 }],
  }),
  whisper: defineVoicePreset({
    name: "Whisper",
    description: "air without buzz",
    specimen: "larva",
    phoneme: "a",
    articulationVoicing: 0.06,
    parameters: {
      throatCount: 1,
      bodyLength: 0.53,
      tension: 0.16,
      mutation: 0,
      coupling: 0,
      growl: 0,
      wet: 1,
      dry: 0,
      spread: 0,
      exciterPitch: 146,
      exciterIntensity: 0.88,
      exciterTenseness: 0.08,
      exciterBreath: 1,
      exciterVibrato: 0,
      exciterWobble: 0,
      voiceMode: "shared",
    },
    throats: [{ aperture: 0.8, length: 0.54 }],
  }),
  reed: defineVoicePreset({
    name: "Reed",
    description: "pressed and buzzy",
    specimen: "oracle",
    phoneme: "e",
    parameters: {
      throatCount: 1,
      bodyLength: 0.4,
      tension: 0.9,
      mutation: 0.04,
      coupling: 0,
      growl: 0.13,
      wet: 1,
      dry: 0,
      spread: 0,
      exciterPitch: 164,
      exciterIntensity: 0.68,
      exciterTenseness: 0.93,
      exciterBreath: 0.025,
      exciterVibrato: 0.015,
      exciterWobble: 0.01,
      voiceMode: "shared",
    },
    throats: [{ aperture: 0.7, length: 0.42 }],
  }),
  nasal: defineVoicePreset({
    name: "Nasal",
    description: "open velum",
    specimen: "oracle",
    phoneme: "a",
    nasalCoupling: 0.48,
    parameters: {
      throatCount: 1,
      bodyLength: 0.56,
      tension: 0.58,
      mutation: 0,
      coupling: 0,
      growl: 0,
      wet: 1,
      dry: 0,
      spread: 0,
      exciterPitch: 126,
      exciterIntensity: 0.74,
      exciterTenseness: 0.58,
      exciterBreath: 0.09,
      exciterVibrato: 0.025,
      exciterWobble: 0.015,
      voiceMode: "shared",
    },
    throats: [{ aperture: 0.86, length: 0.58 }],
  }),
  growl: defineVoicePreset({
    name: "Growl",
    description: "rough low O",
    specimen: "maw",
    phoneme: "o",
    parameters: {
      throatCount: 1,
      bodyLength: 0.79,
      tension: 0.68,
      mutation: 0.2,
      coupling: 0,
      growl: 0.82,
      wet: 1,
      dry: 0,
      spread: 0,
      exciterPitch: 86,
      exciterIntensity: 0.9,
      exciterTenseness: 0.77,
      exciterBreath: 0.08,
      exciterVibrato: 0.025,
      exciterWobble: 0.12,
      voiceMode: "shared",
    },
    throats: [{ aperture: 0.92, length: 0.84 }],
  }),
  beatbox: defineVoicePreset({
    name: "Beatbox",
    description: "hard consonant attack",
    specimen: "oracle",
    phoneme: "a",
    parameters: {
      throatCount: 1,
      bodyLength: 0.5,
      tension: 0.72,
      mutation: 0,
      coupling: 0,
      growl: 0,
      wet: 1,
      dry: 0,
      spread: 0,
      exciterPitch: 104,
      exciterIntensity: 0.96,
      exciterTenseness: 0.75,
      exciterBreath: 0.16,
      exciterVibrato: 0,
      exciterWobble: 0,
      voiceMode: "shared",
    },
    throats: [{ aperture: 0.9, length: 0.52 }],
  }),
  singer: defineVoicePreset({
    name: "Singer",
    description: "five-mouth chord",
    specimen: "singing",
    phoneme: "a",
    parameters: {
      mutation: 0.04,
      coupling: 0.38,
      growl: 0,
      wet: 1,
      dry: 0,
      exciterPitch: 110,
      exciterIntensity: 0.72,
      exciterBreath: 0.07,
      voiceMode: "polyphonic",
    },
  }),
  choir: defineVoicePreset({
    name: "Choir",
    description: "wide vowel cluster",
    specimen: "singing",
    phoneme: "u",
    parameters: {
      mutation: 0.1,
      coupling: 0.58,
      growl: 0.01,
      wet: 1,
      dry: 0,
      spread: 1,
      exciterPitch: 123,
      exciterIntensity: 0.68,
      exciterTenseness: 0.52,
      exciterBreath: 0.12,
      exciterVibrato: 0.28,
      exciterWobble: 0.04,
      voiceMode: "polyphonic",
    },
    voiceIntervals: [-12, -5, 0, 7, 12],
    voiceDetunes: [-11, 7, -3, 9, -6],
  }),
  alien: defineVoicePreset({
    name: "Alien",
    description: "three coupled mouths",
    specimen: "triune",
    phoneme: "u",
    pressureSourceCount: 3,
    parameters: {
      throatCount: 3,
      bodyLength: 0.61,
      tension: 0.6,
      mutation: 0.34,
      coupling: 0.5,
      growl: 0.24,
      wet: 1,
      dry: 0,
      spread: 0.92,
      exciterPitch: 96,
      exciterIntensity: 0.82,
      exciterTenseness: 0.64,
      exciterBreath: 0.17,
      exciterVibrato: 0.08,
      exciterWobble: 0.16,
      voiceMode: "shared",
    },
    throats: [
      { aperture: 0.62, length: 0.76 },
      { aperture: 0.82, length: 0.48 },
      { aperture: 0.5, length: 0.9 },
    ],
  }),
});

export function voicePresetState(name = "clear") {
  const key = Object.prototype.hasOwnProperty.call(VOICE_PRESETS, name)
    ? name
    : "clear";
  const preset = VOICE_PRESETS[key];
  const base = specimenState(preset.specimen);
  const phoneme = PHONEMES[preset.phoneme] ?? PHONEMES.a;
  const parameters = preset.parameters;
  const throatCount = boundedInteger(
    parameters.throatCount ?? base.throatCount,
    1,
    MAX_THROATS,
    1,
  );
  const throats = base.throats.map((throat, index) => ({
    ...throat,
    ...(preset.throats[index] ?? {}),
    muted: false,
  }));
  const tongueCount = phoneme.tongueCount;
  const noseCount = phoneme.noseCount;
  const pressureSourceCount = boundedInteger(
    preset.pressureSourceCount,
    1,
    MAX_PRESSURE_SOURCES,
    1,
  );

  return {
    ...base,
    ...parameters,
    voicePreset: key,
    sourceMode: preset.sourceMode,
    phoneme: preset.phoneme,
    throatCount,
    pressureSourceCount,
    pressureSources: Array.from({ length: MAX_PRESSURE_SOURCES }, (_, index) => ({
      open: index < pressureSourceCount,
      level: parameters.classicTopology && index === 0
        ? 1
        : clamp(0.94 - index * 0.1),
    })),
    articulationPlace: phoneme.tongues[0]?.position ?? 0.48,
    articulationAperture: 1,
    articulationVoicing: preset.articulationVoicing,
    articulationManner: "vowel",
    glottalClosure: 0,
    nasalCoupling: preset.nasalCoupling,
    tongueCount,
    noseCount,
    oralClosure: phoneme.oralClosure,
    lipDiameter: phoneme.lipDiameter,
    throats,
    tongues: phoneme.tongues.map((tongue) => ({ ...tongue })),
    noses: phoneme.noses.map((nose) => ({ ...nose })),
    voiceIntervals: preset.voiceIntervals
      ? [...preset.voiceIntervals]
      : [...base.voiceIntervals],
    voiceDetunes: preset.voiceDetunes
      ? [...preset.voiceDetunes]
      : [...base.voiceDetunes],
  };
}

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
  const isAffricate = consonant.manner === "affricate";
  const isStop = consonant.manner === "stop" || isAffricate;
  const isFricative = consonant.manner === "fricative" || isAffricate;
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

export const LETTER_ARTICULATIONS = Object.freeze({
  a: "a",
  b: "b",
  c: "c",
  d: "d",
  e: "e",
  f: "f",
  g: "g",
  h: "h",
  i: "i",
  j: "j",
  k: "k",
  l: "l",
  m: "m",
  n: "n",
  o: "o",
  p: "p",
  q: "q",
  r: "r",
  s: "s",
  t: "t",
  u: "u",
  v: "v",
  w: "w",
  x: "x",
  y: "y",
  z: "z",
});

const KEYBOARD_ARTICULATIONS = Object.freeze({
  ...LETTER_ARTICULATIONS,
  "'": "glottal",
  "?": "glottal",
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

function shortcut(kind, id, name) {
  return Object.freeze({ kind, id, name });
}

export const DIGIT_PRESET_SHORTCUTS = Object.freeze({
  "1": shortcut("specimen", "triune", "Triune"),
  "2": shortcut("specimen", "oracle", "Oracle"),
  "3": shortcut("specimen", "hive", "Hive"),
  "4": shortcut("specimen", "hydra", "Hydra"),
  "5": shortcut("specimen", "razor", "Razor"),
  "6": shortcut("specimen", "monolith", "Monolith"),
  "7": shortcut("specimen", "siren", "Siren"),
  "8": shortcut("specimen", "larva", "Larva"),
  "9": shortcut("specimen", "cathedral", "Cathedral"),
  "0": shortcut("specimen", "singing", "Singing"),
});

export function keyboardPresetShortcut(value, code = "") {
  const suppliedCode = typeof code === "string" ? code : "";
  const codeMatch = /^(?:Digit|Numpad)([0-9])$/.exec(suppliedCode);
  const key = codeMatch?.[1]
    ?? (typeof value === "string" && /^[0-9]$/.test(value) ? value : "");
  return DIGIT_PRESET_SHORTCUTS[key] ?? null;
}

function expression(name, parameters) {
  return Object.freeze({
    name,
    ...parameters,
    motionTargets: Object.freeze([...(parameters.motionTargets ?? [])]),
  });
}

export const CAPITAL_EXPRESSIONS = Object.freeze({
  a: expression("Abyss", {
    pitchRatio: 0.5,
    bodyLength: 0.96,
    mutation: 0.18,
    motionDepth: 0.7,
    motionTargets: ["mouths", "tongues", "noses"],
  }),
  b: expression("Blast", {
    pitchRatio: 0.84,
    pressureSourceCount: 4,
    pressureLevel: 1,
    intensity: 1,
    burstScale: 1.45,
    motionDepth: 0.82,
    motionTargets: ["pressure", "mouths"],
  }),
  c: expression("Chitter", {
    wobble: 0.72,
    mutation: 0.55,
    breath: 0.36,
    motionDepth: 0.86,
    motionTargets: ["tongues", "mouths"],
  }),
  d: expression("Double", {
    pitchRatio: 0.94,
    throatCount: 2,
    coupling: 0.35,
    spread: 0.75,
    motionDepth: 0.68,
    motionTargets: ["mouths"],
  }),
  e: expression("Electric", {
    pitchRatio: 1.5,
    tension: 0.9,
    vibrato: 0.35,
    motionDepth: 0.72,
    motionTargets: ["tongues"],
  }),
  f: expression("Flood", {
    breath: 1,
    intensity: 1,
    mutation: 0.18,
    motionDepth: 0.8,
    motionTargets: ["mouths", "noses"],
  }),
  g: expression("Growl", {
    pitchRatio: 0.75,
    growl: 1,
    mutation: 0.5,
    motionDepth: 0.78,
    motionTargets: ["mouths", "tongues"],
  }),
  h: expression("Hurricane", {
    breath: 1,
    wobble: 0.3,
    motionDepth: 0.9,
    motionTargets: ["pressure", "mouths"],
  }),
  i: expression("Ion", {
    pitchRatio: 2,
    vibrato: 0.4,
    tension: 0.82,
    motionDepth: 0.72,
    motionTargets: ["tongues"],
  }),
  j: expression("Jitter", {
    vibrato: 1,
    wobble: 0.45,
    mutation: 0.35,
    motionDepth: 1,
    motionTargets: ["tongues", "noses"],
  }),
  k: expression("Kick", {
    pitchRatio: 0.8,
    pressureSourceCount: 4,
    pressureLevel: 1,
    intensity: 1,
    burstScale: 1.6,
    motionDepth: 0.9,
    motionTargets: ["pressure"],
  }),
  l: expression("Long", {
    bodyLength: 1,
    mouthLength: 1,
    motionDepth: 0.72,
    motionTargets: ["mouths"],
  }),
  m: expression("Many", {
    throatCount: 3,
    noseCount: 3,
    nasalCoupling: 1,
    noseOpenness: 1,
    coupling: 0.42,
    motionDepth: 0.8,
    motionTargets: ["mouths", "noses"],
  }),
  n: expression("Nose swarm", {
    noseCount: 3,
    nasalCoupling: 1,
    noseOpenness: 1,
    noseResonance: 0.9,
    motionDepth: 0.9,
    motionTargets: ["noses"],
  }),
  o: expression("Orbit", {
    lipDiameter: 0.35,
    wobble: 0.35,
    coupling: 0.2,
    motionDepth: 0.82,
    motionTargets: ["mouths", "tongues"],
  }),
  p: expression("Pressure", {
    pitchRatio: 0.9,
    pressureSourceCount: 4,
    pressureLevel: 1,
    intensity: 1,
    burstScale: 1.7,
    motionDepth: 0.92,
    motionTargets: ["pressure"],
  }),
  q: expression("Quad", {
    throatCount: 4,
    coupling: 0.55,
    spread: 1,
    lipDiameter: 0.48,
    motionDepth: 0.78,
    motionTargets: ["mouths"],
  }),
  r: expression("Rattle", {
    wobble: 1,
    growl: 0.6,
    mutation: 0.3,
    motionDepth: 1,
    motionTargets: ["tongues", "mouths"],
  }),
  s: expression("Scream", {
    pitchRatio: 1.5,
    breath: 0.75,
    intensity: 1,
    motionDepth: 0.78,
    motionTargets: ["tongues"],
  }),
  t: expression("Tense", {
    pitchRatio: 1.2,
    tension: 1,
    intensity: 1,
    burstScale: 1.4,
    motionDepth: 0.82,
    motionTargets: ["pressure", "tongues"],
  }),
  u: expression("Underworld", {
    pitchRatio: 0.5,
    bodyLength: 1,
    lipDiameter: 0.35,
    motionDepth: 0.86,
    motionTargets: ["mouths", "tongues", "noses"],
  }),
  v: expression("Vibrato", {
    vibrato: 1,
    motionDepth: 1,
    motionTargets: ["tongues", "noses"],
  }),
  w: expression("Wobble", {
    wobble: 1,
    motionDepth: 1,
    motionTargets: ["mouths", "noses"],
  }),
  x: expression("Cross-feed", {
    throatCount: 3,
    coupling: 0.72,
    mutation: 0.8,
    spread: 1,
    motionDepth: 0.92,
    motionTargets: ["mouths", "tongues", "noses", "pressure"],
  }),
  y: expression("Yodel", {
    pitchRatio: 2,
    vibrato: 0.65,
    motionDepth: 0.88,
    motionTargets: ["tongues"],
  }),
  z: expression("Zapper", {
    pitchRatio: 1.15,
    tension: 1,
    growl: 0.5,
    mutation: 0.65,
    motionDepth: 0.86,
    motionTargets: ["tongues", "mouths"],
  }),
});

export function capitalExpression(value) {
  if (typeof value !== "string" || value.length !== 1) return null;
  return CAPITAL_EXPRESSIONS[value.toLowerCase()] ?? null;
}

export function capitalizedPerformanceState(baseState, value) {
  const variant = capitalExpression(value);
  if (!variant || !baseState || typeof baseState !== "object") return baseState;
  const next = {
    ...baseState,
    throats: (baseState.throats ?? []).map((throat) => ({ ...throat })),
    tongues: (baseState.tongues ?? []).map((tongue) => ({ ...tongue })),
    noses: (baseState.noses ?? []).map((nose) => ({ ...nose })),
    pressureSources: (baseState.pressureSources ?? []).map((source) => ({ ...source })),
  };
  const scalarFields = {
    bodyLength: "bodyLength",
    tension: "tension",
    mutation: "mutation",
    coupling: "coupling",
    growl: "growl",
    spread: "spread",
    intensity: "exciterIntensity",
    breath: "exciterBreath",
    vibrato: "exciterVibrato",
    wobble: "exciterWobble",
    nasalCoupling: "nasalCoupling",
    lipDiameter: "lipDiameter",
  };
  for (const [expressionField, stateField] of Object.entries(scalarFields)) {
    if (Number.isFinite(variant[expressionField])) {
      next[stateField] = clamp(variant[expressionField]);
    }
  }
  if (Number.isFinite(variant.pitchRatio)) {
    next.exciterPitch = clamp(
      Number(baseState.exciterPitch || 140) * variant.pitchRatio,
      40,
      420,
    );
  }
  if (Number.isFinite(variant.throatCount)) {
    next.throatCount = boundedInteger(variant.throatCount, 1, MAX_THROATS, 1);
    next.classicTopology = next.throatCount === 1 && Boolean(baseState.classicTopology);
    for (let index = 0; index < next.throatCount; index += 1) {
      if (!next.throats[index]) next.throats[index] = defaultThroat(index);
      next.throats[index].muted = false;
    }
  }
  if (Number.isFinite(variant.noseCount)) {
    next.noseCount = boundedInteger(variant.noseCount, 1, MAX_NOSES, 1);
  }
  if (Number.isFinite(variant.tongueCount)) {
    next.tongueCount = boundedInteger(variant.tongueCount, 1, MAX_TONGUES, 1);
  }
  if (Number.isFinite(variant.mouthLength)) {
    for (let index = 0; index < Math.min(next.throatCount, next.throats.length); index += 1) {
      next.throats[index].length = clamp(variant.mouthLength);
    }
  }
  if (Number.isFinite(variant.noseOpenness)) {
    for (let index = 0; index < Math.min(next.noseCount, next.noses.length); index += 1) {
      next.noses[index].openness = clamp(variant.noseOpenness);
    }
  }
  if (Number.isFinite(variant.noseResonance)) {
    for (let index = 0; index < Math.min(next.noseCount, next.noses.length); index += 1) {
      next.noses[index].resonance = clamp(variant.noseResonance);
    }
  }
  if (Number.isFinite(variant.pressureSourceCount)) {
    next.pressureSourceCount = boundedInteger(
      variant.pressureSourceCount,
      1,
      MAX_PRESSURE_SOURCES,
      1,
    );
    while (next.pressureSources.length < MAX_PRESSURE_SOURCES) {
      next.pressureSources.push({ open: false, level: 0 });
    }
    for (let index = 0; index < next.pressureSourceCount; index += 1) {
      next.pressureSources[index].open = true;
      next.pressureSources[index].level = clamp(
        variant.pressureLevel ?? next.pressureSources[index].level ?? 1,
      );
    }
  }
  next.capitalExpression = variant.name;
  next.capitalMotionDepth = clamp(variant.motionDepth);
  next.capitalMotionTargets = [...variant.motionTargets];
  next.burstScale = clamp(variant.burstScale ?? 1, 0, 2);
  return next;
}

export function anatomyMotionPhases(timeMs, motionState = {}, index = 0) {
  const time = Number.isFinite(Number(timeMs)) ? Number(timeMs) : 0;
  const phaseIndex = Number.isFinite(Number(index)) ? Number(index) : 0;
  const depth = clamp(motionState.motionDepth);
  const vibrato = Math.sqrt(clamp(motionState.exciterVibrato));
  const wobble = Math.sqrt(clamp(motionState.exciterWobble));
  const fast = Math.sin(
    time * Math.PI * 2 * 5.2 / 1_000 + phaseIndex * 0.73,
  ) * vibrato * depth;
  const slow = Math.sin(
    time * Math.PI * 2 * 0.43 / 1_000 + phaseIndex * 1.17,
  ) * wobble * depth;
  return Object.freeze({
    fast,
    slow,
    combined: clamp((fast + slow) * 0.5, -1, 1),
  });
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
    lipDiameter: 3,
    wet: specimen.wet,
    dry: specimen.dry,
    spread: specimen.spread,
    exciterPitch: specimen.exciterPitch,
    exciterIntensity: specimen.exciterIntensity,
    exciterTenseness: specimen.exciterTenseness,
    exciterBreath: specimen.exciterBreath,
    exciterVibrato: specimen.exciterVibrato,
    exciterWobble: specimen.exciterWobble,
    voiceMode: specimen.voiceMode,
    voiceIntervals: [...specimen.voiceIntervals],
    voiceDetunes: [...specimen.voiceDetunes],
    throats,
    tongues: specimen.tongues.map((tongue) => ({ ...tongue })),
    noses: specimen.noses.map((nose) => ({ ...nose })),
  };
}

export function singingVoiceParameters(state, index) {
  const count = boundedInteger(state.throatCount, 1, MAX_THROATS, 1);
  const mouthIndex = boundedInteger(index, 0, MAX_THROATS - 1);
  const intervalValue = Number(state.voiceIntervals?.[mouthIndex]);
  const detuneValue = Number(state.voiceDetunes?.[mouthIndex]);
  const interval = Number.isFinite(intervalValue)
    ? clamp(intervalValue, -48, 48)
    : SINGING_INTERVAL_FALLBACKS[mouthIndex];
  const detune = Number.isFinite(detuneValue)
    ? clamp(detuneValue, -1_200, 1_200)
    : SINGING_DETUNE_FALLBACKS[mouthIndex];
  const basePitch = clamp(Number(state.exciterPitch) || 110, 20, 20_000);
  const frequency = clamp(
    basePitch * 2 ** (interval / 12),
    20,
    20_000,
  );
  const throat = state.throats?.[mouthIndex] ?? defaultThroat(mouthIndex);
  const active = mouthIndex < count && !throat.muted;
  const pan = count <= 1
    ? 0
    : clamp((mouthIndex / (count - 1)) * 2 - 1, -1, 1);
  const aperture = unitValue(throat.aperture, 0.5);
  const length = unitValue(throat.length, 0.5);
  const vibrato = unitValue(state.exciterVibrato);
  const tension = unitValue(state.exciterTenseness, state.tension);

  return {
    mouthIndex,
    frequency,
    interval,
    detune,
    pan,
    gain: active ? (0.76 + aperture * 0.24) / Math.sqrt(count) : 0,
    vibratoRate: 4.45 + mouthIndex * 0.29 + length * 0.32,
    vibratoDepth: 4 + vibrato * (15 + mouthIndex * 1.35),
    phaseOffset: (mouthIndex * 0.38196601125 + length * 0.17) % 1,
    timbre: clamp(0.25 + tension * 0.58 + aperture * 0.12),
  };
}

function finiteNonnegative(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : Math.max(0, fallback);
}

function distributedAssignment(index, branchCount, articulatorCount) {
  if (articulatorCount <= 0) return -1;
  if (articulatorCount === 1 || branchCount <= 1) return 0;
  return Math.round((index / (branchCount - 1)) * (articulatorCount - 1));
}

function assignedArticulator(value, fallback, count) {
  if (count <= 0) return -1;
  const number = Number(value);
  return Number.isFinite(number)
    ? boundedInteger(number, 0, count - 1, fallback)
    : fallback;
}

export function normalizePressureSources(state = {}) {
  const pressureSourceCount = boundedInteger(
    state?.pressureSourceCount,
    1,
    MAX_PRESSURE_SOURCES,
    1,
  );
  const configured = Array.isArray(state?.pressureSources)
    ? state.pressureSources
    : [];
  const pressureSources = Array.from(
    { length: MAX_PRESSURE_SOURCES },
    (_, index) => {
      const active = index < pressureSourceCount;
      const source = configured[index] ?? {};
      const open = active && (
        source.open === undefined ? true : Boolean(source.open)
      );
      return {
        index,
        open,
        level: active ? unitValue(source.level, 1) : 0,
      };
    },
  );
  return { pressureSourceCount, pressureSources };
}

export function mouthCouplingMatrix(countOrState = 1, coupling) {
  const state = countOrState && typeof countOrState === "object"
    ? countOrState
    : null;
  const mouthCount = boundedInteger(
    state?.mouthCount ?? state?.throatCount ?? countOrState,
    1,
    MAX_MOUTHS,
    1,
  );
  const amount = unitValue(coupling ?? state?.coupling);
  const neighborCoupling = amount * 0.22;
  const matrix = Array.from(
    { length: mouthCount },
    (_, row) => Array.from({ length: mouthCount }, (_, column) => (
      row === column ? 1 : 0
    )),
  );
  for (let index = 0; index < mouthCount - 1; index += 1) {
    matrix[index][index] -= neighborCoupling;
    matrix[index + 1][index + 1] -= neighborCoupling;
    matrix[index][index + 1] += neighborCoupling;
    matrix[index + 1][index] += neighborCoupling;
  }
  return matrix;
}

export function coupleMouthPressures(pressures, coupling = 0) {
  const count = Math.min(
    MAX_MOUTHS,
    Array.isArray(pressures) || ArrayBuffer.isView(pressures)
      ? pressures.length
      : 0,
  );
  if (count <= 0) return [];
  const values = Array.from(
    { length: count },
    (_, index) => finiteNonnegative(pressures[index]),
  );
  const matrix = mouthCouplingMatrix(count, coupling);
  return matrix.map((row) => row.reduce(
    (sum, weight, index) => sum + weight * values[index],
    0,
  ));
}

export function mouthManifold(state = {}) {
  const mouthCount = boundedInteger(
    state?.mouthCount ?? state?.throatCount,
    1,
    MAX_MOUTHS,
    1,
  );
  const tongueCount = boundedInteger(
    state?.tongueCount,
    1,
    MAX_TONGUES,
    1,
  );
  const noseCount = boundedInteger(
    state?.noseCount,
    0,
    MAX_NOSES,
    0,
  );
  const configuredMouths = Array.isArray(state?.mouths)
    ? state.mouths
    : [];
  const legacyThroats = Array.isArray(state?.throats)
    ? state.throats
    : [];
  const globalClosure = unitValue(state?.oralClosure);
  const mouths = Array.from({ length: mouthCount }, (_, index) => {
    const fallback = defaultThroat(index);
    const configured = configuredMouths[index] ?? legacyThroats[index] ?? fallback;
    const aperture = unitValue(configured.aperture, fallback.aperture);
    const length = unitValue(configured.length, fallback.length);
    const localClosure = unitValue(
      configured.closure ?? configured.oralClosure,
    );
    const closure = Math.max(globalClosure, localClosure);
    const muted = Boolean(configured.muted ?? configured.closed);
    const effectiveAperture = muted
      ? 0
      : aperture * oralOpening(closure);
    const resistance = 0.28 + length * 1.45;
    const conductance = effectiveAperture <= 1e-6
      ? 0
      : effectiveAperture ** 2 / resistance;
    const defaultTongueIndex = distributedAssignment(
      index,
      mouthCount,
      tongueCount,
    );
    const defaultNoseIndex = distributedAssignment(
      index,
      mouthCount,
      noseCount,
    );
    const tongueIndex = assignedArticulator(
      configured.tongueIndex ?? configured.tongueAssignment,
      defaultTongueIndex,
      tongueCount,
    );
    const noseIndex = assignedArticulator(
      configured.noseIndex ?? configured.noseAssignment,
      defaultNoseIndex,
      noseCount,
    );
    return {
      index,
      aperture,
      length,
      closure,
      effectiveAperture,
      resistance,
      conductance,
      muted,
      closed: muted,
      tongueIndex,
      noseIndex,
      tongueAssignment: tongueIndex,
      noseAssignment: noseIndex,
    };
  });
  const bodyLength = unitValue(state?.bodyLength, 0.5);
  const coupling = unitValue(state?.coupling);
  const rootConfiguration = state?.rootAirway ?? {};
  const rootLength = unitValue(rootConfiguration.length, bodyLength);
  const rootArea = clamp(
    Number.isFinite(Number(rootConfiguration.area))
      ? Number(rootConfiguration.area)
      : 0.48 + (1 - bodyLength) * 0.34,
    0.05,
    1,
  );
  const compliance = unitValue(
    rootConfiguration.compliance,
    0.22 + coupling * 0.58,
  );
  const loss = unitValue(
    rootConfiguration.loss,
    0.08 + rootLength * 0.2,
  );
  const pressureState = normalizePressureSources(state);
  return {
    kind: "mouth-manifold",
    mouthCount,
    tongueCount,
    noseCount,
    coupling,
    root: {
      length: rootLength,
      area: rootArea,
      compliance,
      loss,
      resistance: 0.32 + rootLength * 1.08 + loss * 0.4,
    },
    mouths,
    couplingMatrix: mouthCouplingMatrix(mouthCount, coupling),
    ...pressureState,
  };
}

export function mouthOrganRoutes(state = {}) {
  return mouthManifold(state).mouths.map((mouth) => Object.freeze({
    mouthIndex: mouth.index,
    tongueIndex: mouth.tongueAssignment,
    noseIndex: mouth.noseAssignment,
  }));
}

export function routeMouthPressure(state = {}, rootPressure = 1) {
  const manifold = state?.kind === "mouth-manifold"
    && Array.isArray(state.mouths)
    && Array.isArray(state.couplingMatrix)
    && state.root
    ? state
    : mouthManifold(state);
  const normalizedSources = normalizePressureSources(manifold);
  const activeSources = normalizedSources.pressureSources
    .slice(0, normalizedSources.pressureSourceCount)
    .filter((source) => source.open);
  const sourceLevel = activeSources.length
    ? activeSources.reduce((sum, source) => sum + source.level, 0)
      / Math.sqrt(activeSources.length)
    : 0;
  const requestedPressure = finiteNonnegative(rootPressure, 1);
  const sourcePressure = requestedPressure * sourceLevel;
  const conductances = manifold.mouths.map((mouth) => (
    finiteNonnegative(mouth.conductance)
  ));
  const totalConductance = conductances.reduce((sum, value) => sum + value, 0);
  const coupled = manifold.couplingMatrix.map((row) => row.reduce(
    (sum, weight, index) => sum + weight * conductances[index],
    0,
  ));
  const masked = coupled.map((value, index) => (
    conductances[index] > 1e-9 ? finiteNonnegative(value) : 0
  ));
  const maskedTotal = masked.reduce((sum, value) => sum + value, 0);
  const demandScale = maskedTotal > 1e-12
    ? totalConductance / maskedTotal
    : 0;
  const demands = masked.map((value) => value * demandScale);
  const rootResistance = finiteNonnegative(manifold.root.resistance, 1);
  const manifoldPressure = sourcePressure / (
    1 + rootResistance * totalConductance
  );
  const rootArea = finiteNonnegative(manifold.root.area, 0.5);
  const mouths = manifold.mouths.map((mouth, index) => {
    const coupledConductance = demands[index] ?? 0;
    const flow = manifoldPressure * coupledConductance * rootArea;
    return {
      ...mouth,
      coupledConductance,
      pressure: manifoldPressure,
      flow,
      share: totalConductance > 1e-12
        ? coupledConductance / totalConductance
        : 0,
    };
  });
  const totalFlow = mouths.reduce((sum, mouth) => sum + mouth.flow, 0);
  return {
    ...manifold,
    ...normalizedSources,
    root: {
      ...manifold.root,
      requestedPressure,
      sourceLevel,
      openSourceCount: activeSources.length,
      sourcePressure,
      manifoldPressure,
      pressureDrop: sourcePressure - manifoldPressure,
      totalConductance,
      totalFlow,
    },
    mouths,
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
  const lipDiameter = clamp(
    Number.isFinite(Number(state.lipDiameter)) ? Number(state.lipDiameter) : 3,
    0.35,
    3,
  );
  const lipRounding = clamp((1.4 - lipDiameter) / 0.9);
  const tractScale = 0.68 + (1 - bodyLength) * 0.68;
  const mutationSkew = 1 + Math.sin((voiceIndex + 1) * 2.17) * mutation * 0.16;
  const tongueHeightScale = 1.2 - tongue.height * 0.44;
  const tongueFrontShift = (tongue.position - 0.5) * 1_260;
  const first = (
    (170 + aperture * 720)
    * tractScale
    * mutationSkew
    * tongueHeightScale
    * (1 - lipRounding * 0.16)
  );
  const second = (
    610
    + (1 - length) * 1_760
    + voiceIndex * 118
    + tongueFrontShift
    + tongue.height * 150
  ) * tractScale * (1 - lipRounding * 0.32);
  const third = Math.min(
    nyquistLimit,
    (
      1_680
      + aperture * 1_620
      + voiceIndex * 205
      + (tongue.curl - 0.5) * 380
    ) * tractScale * (2 - mutationSkew) * (1 - lipRounding * 0.08),
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
    lowpass: clamp(
      (2_200 + aperture * 9_800 + tension * 2_000) * (1 - lipRounding * 0.24),
      1_600,
      nyquistLimit,
    ),
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
        * (0.28 + coupling * 0.55)
        * (0.85 + nose.resonance * 0.35)
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
