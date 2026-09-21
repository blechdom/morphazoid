export const MODEL_TIERS = Object.freeze({
  measured: Object.freeze({
    label: "Measured acoustic model",
    short: "MEASURED",
    description: "Published equations, impedance measurements, or laboratory validation support this topology.",
  }),
  established: Object.freeze({
    label: "Established mechanism",
    short: "DOCUMENTED",
    description: "The excitation and resonator mechanism is well documented; the browser model is comparative.",
  }),
  comparative: Object.freeze({
    label: "Comparative reconstruction",
    short: "APPROXIMATION",
    description: "Museum and organological descriptions establish the mechanism, but a dedicated numerical model is sparse.",
  }),
});

export const TOPOLOGIES = Object.freeze({
  stringWind: Object.freeze({
    label: "string-wind",
    path: ["signed lung pressure", "quill valve", "tensioned string", "mouth cavity"],
  }),
  freeReed: Object.freeze({
    label: "free-reed bank",
    path: ["signed lung pressure", "free reed", "pipe resonators", "mouth / chamber"],
  }),
  lipReed: Object.freeze({
    label: "lip-reed bore",
    path: ["exhaled pressure", "lip valve", "air column", "vocal tract impedance"],
  }),
  edgeTone: Object.freeze({
    label: "edge-tone flute",
    path: ["exhaled pressure", "air jet", "edge oscillation", "pipe / vessel"],
  }),
  mouthBow: Object.freeze({
    label: "mouth-resonated string",
    path: ["hand gesture", "tensioned string", "bridge / coupling cord", "mouth cavity"],
  }),
  jawReed: Object.freeze({
    label: "plucked mouth reed",
    path: ["finger pluck", "lamella", "signed breath load", "mouth cavity"],
  }),
});

export const RHYTHM_PATTERNS = Object.freeze([
  Object.freeze({
    id: "quarter-eighths",
    label: "Quarter · eighth · eighth",
    steps: Object.freeze([1, 0, 0.82, 0.72]),
    description: "A long first space followed by two quicker replies.",
  }),
  Object.freeze({
    id: "tresillo",
    label: "Tresillo 3–3–2",
    steps: Object.freeze([1, 0, 0, 0.78, 0, 0, 0.88, 0]),
    description: "Three unevenly spaced impulses across four beats.",
  }),
  Object.freeze({
    id: "two-one",
    label: "Two close · one far",
    steps: Object.freeze([1, 0.7, 0, 0, 0.86, 0, 0, 0]),
    description: "A close double gesture answered after a larger breath-shaped gap.",
  }),
  Object.freeze({
    id: "five-step",
    label: "Five-step lilt",
    steps: Object.freeze([1, 0, 0.62, 0, 0.83]),
    description: "A compact asymmetric loop that continually turns against a four-beat breath.",
  }),
  Object.freeze({
    id: "soft-machine",
    label: "Soft / hard / ghost",
    steps: Object.freeze([0.42, 0, 1, 0, 0.2, 0.72, 0, 0]),
    description: "Velocity variation makes the repetition breathe instead of clicking like a metronome.",
  }),
  Object.freeze({
    id: "sparse-seven",
    label: "Sparse seven",
    steps: Object.freeze([1, 0, 0, 0.58, 0, 0.8, 0]),
    description: "A seven-step loop with unequal rests and three differently weighted gestures.",
  }),
]);

const freezePreset = (preset) => Object.freeze({
  ...preset,
  ratios: Object.freeze([...(preset.ratios ?? [1])]),
  path: Object.freeze([...(preset.path ?? TOPOLOGIES[preset.topology].path)]),
});

export const BREATH_INSTRUMENTS = Object.freeze([
  freezePreset({
    id: "lesiba",
    label: "Lesiba / gora",
    region: "Southern Africa",
    topology: "stringWind",
    tier: "measured",
    breathMode: "both",
    gesture: "none",
    pitchHz: 82,
    lengthM: 1.28,
    damping: 0.34,
    coupling: 0.91,
    brightness: 0.58,
    ratios: [1, 2, 3, 4, 5, 6, 8, 10],
    description: "A flattened quill converts forceful inhalation and exhalation into transverse string motion; the mouth selects harmonics from the sounding string.",
    modelNote: "Signed Bernoulli-style quill forcing drives a lossy harmonic string. Inhalation and exhalation use different quill phase and spectral loading.",
    sourceLabel: "Cambridge / Wits organology",
    sourceUrl: "https://www.cambridge.org/core/books/abs/musical-instruments-of-the-indigenous-people-of-south-africa/gora-a-stringedwind-instrument/9EAD23AB5B57882B3B81658FD5DE06F7",
  }),
  freezePreset({
    id: "harmonica",
    label: "Harmonica",
    region: "Europe / global",
    topology: "freeReed",
    tier: "measured",
    breathMode: "both",
    gesture: "none",
    pitchHz: 261.63,
    lengthM: 0.11,
    damping: 0.46,
    coupling: 0.75,
    brightness: 0.72,
    ratios: [1, 1.26, 1.5, 2, 2.52, 3],
    drawShift: 1.12246,
    description: "Blow and draw pressure select opposing free reeds. The vocal tract feeds a strongly nonlinear, player-controlled acoustic load back to the reeds.",
    modelNote: "Pressure-controlled reed oscillators use a nonlinear opening/flow curve and direction-dependent reed banks.",
    sourceLabel: "Millot free-reed model",
    sourceUrl: "https://www.researchgate.net/publication/281903985_Free_reed_instruments_clues_for_a_physical_model",
  }),
  freezePreset({
    id: "khaen",
    label: "Khaen",
    region: "Laos / Isan",
    topology: "freeReed",
    tier: "measured",
    breathMode: "both",
    gesture: "none",
    pitchHz: 146.83,
    lengthM: 0.92,
    damping: 0.27,
    coupling: 0.84,
    brightness: 0.5,
    ratios: [1, 1.125, 1.25, 1.5, 1.6875, 2, 2.25, 2.5],
    drawShift: 0.998,
    description: "A mouth chamber distributes inhaled or exhaled flow through bamboo pipes whose free reeds sound in either direction.",
    modelNote: "Bidirectional reed valves feed a multi-pipe modal bank; breath direction changes attack and spectral balance without stopping the chord.",
    sourceLabel: "Air-driven free-reed analysis",
    sourceUrl: "https://www.cs.bu.edu/fac/snyder/TablatureWeb/ICA.PDF",
  }),
  freezePreset({
    id: "sheng",
    label: "Sheng",
    region: "China",
    topology: "freeReed",
    tier: "measured",
    breathMode: "both",
    gesture: "none",
    pitchHz: 196,
    lengthM: 0.58,
    damping: 0.3,
    coupling: 0.77,
    brightness: 0.69,
    ratios: [1, 1.189, 1.335, 1.498, 1.682, 2, 2.378, 2.67],
    drawShift: 1.002,
    description: "Metal free reeds mounted in a wind chamber couple to tuned bamboo pipes and respond on both blown and drawn airflow.",
    modelNote: "A bidirectional free-reed bank is coupled to pipe modes; chamber and mouth impedances color the radiated chord.",
    sourceLabel: "Met Museum sheng description",
    sourceUrl: "https://www.metmuseum.org/art/collection/search/503632",
  }),
  freezePreset({
    id: "sho",
    label: "Shō",
    region: "Japan",
    topology: "freeReed",
    tier: "measured",
    breathMode: "both",
    gesture: "none",
    pitchHz: 293.66,
    lengthM: 0.5,
    damping: 0.38,
    coupling: 0.72,
    brightness: 0.78,
    ratios: [1, 1.122, 1.335, 1.498, 1.782, 2, 2.245, 2.67],
    drawShift: 1.001,
    description: "Seventeen slender pipes form sustained aitake tone clusters, maintained through alternating outward and inward breath.",
    modelNote: "Long-attack bidirectional reeds excite a bright, tightly spaced pipe cluster; direction alters the transient more than pitch.",
    sourceLabel: "Met Museum shō description",
    sourceUrl: "https://www.metmuseum.org/art/collection/search/500658",
  }),
  freezePreset({
    id: "hulusi",
    label: "Hulusi",
    region: "Yunnan / Southeast Asia",
    topology: "freeReed",
    tier: "established",
    breathMode: "out",
    gesture: "none",
    pitchHz: 220,
    lengthM: 0.46,
    damping: 0.42,
    coupling: 0.79,
    brightness: 0.42,
    ratios: [1, 1, 2],
    description: "Exhaled air enters a gourd wind chest and drives a melody-pipe free reed plus one or more drone pipes.",
    modelNote: "An outward-pressure reed valve feeds one fingered pipe and two weak drone resonances through a shared chamber.",
    sourceLabel: "Comparative free-reed topology",
    sourceUrl: "https://www.metmuseum.org/art/collection/search/503632",
  }),
  freezePreset({
    id: "bawu",
    label: "Bawu",
    region: "Southwest China",
    topology: "freeReed",
    tier: "established",
    breathMode: "out",
    gesture: "none",
    pitchHz: 196,
    lengthM: 0.54,
    damping: 0.4,
    coupling: 0.7,
    brightness: 0.38,
    ratios: [1],
    description: "A side-blown bamboo pipe uses an enclosed free reed as its pressure valve, with finger holes setting the air-column resonance.",
    modelNote: "One outward-driven reed is impedance-locked to a lossy pipe mode and colored by the mouth cavity upstream.",
    sourceLabel: "Comparative free-reed topology",
    sourceUrl: "https://www.cs.bu.edu/fac/snyder/TablatureWeb/ICA.PDF",
  }),
  freezePreset({
    id: "didgeridoo",
    label: "Didgeridoo / yidaki",
    region: "Northern Australia",
    topology: "lipReed",
    tier: "measured",
    breathMode: "out",
    gesture: "none",
    pitchHz: 69,
    lengthM: 1.47,
    damping: 0.23,
    coupling: 0.94,
    brightness: 0.54,
    ratios: [1, 3, 5, 7, 9, 11],
    description: "Exhaled pressure opens and closes the lips against a long irregular bore while the player's vocal-tract impedance sculpts its spectral peaks.",
    modelNote: "A pressure-driven lip valve feeds odd bore modes; movable vocal-tract impedance notches and glottal pulses reshape the drone.",
    sourceLabel: "Fletcher et al., JASA physical model",
    sourceUrl: "https://phys.unsw.edu.au/jw/reprints/Fletcheretal.pdf",
  }),
  freezePreset({
    id: "pungi",
    label: "Pungi / been",
    region: "South Asia",
    topology: "freeReed",
    tier: "established",
    breathMode: "out",
    gesture: "none",
    pitchHz: 174.61,
    lengthM: 0.43,
    damping: 0.3,
    coupling: 0.88,
    brightness: 0.64,
    ratios: [1, 1, 2],
    description: "Continuous exhalation pressurizes a gourd reservoir that supplies a melody reed and drone reed in parallel pipes.",
    modelNote: "A smoothed reservoir pressure drives paired beating reeds, one fingered and one droning, through gourd resonances.",
    sourceLabel: "Comparative reed-and-reservoir model",
    sourceUrl: "https://www.metmuseum.org/art/collection/search/502900",
  }),
  freezePreset({
    id: "nose-flute",
    label: "Nose flute",
    region: "Pacific Islands",
    topology: "edgeTone",
    tier: "established",
    breathMode: "out",
    gesture: "none",
    pitchHz: 392,
    lengthM: 0.34,
    damping: 0.32,
    coupling: 0.54,
    brightness: 0.61,
    ratios: [1, 2, 3, 4, 5],
    description: "A controlled nasal jet crosses an edge and locks to a bamboo air column; mouth volume can indirectly alter upstream pressure and phrasing.",
    modelNote: "Jet-delay oscillation is approximated by a noisy edge-tone source locked to pipe modes; only exhalation excites it.",
    sourceLabel: "Met Museum Pacific aerophones",
    sourceUrl: "https://www.metmuseum.org/exhibitions/listings/2009/sounding-the-pacific/photo-gallery",
  }),
  freezePreset({
    id: "overtone-flute",
    label: "Overtone flute",
    region: "Eurasia",
    topology: "edgeTone",
    tier: "established",
    breathMode: "out",
    gesture: "none",
    pitchHz: 196,
    lengthM: 0.78,
    damping: 0.26,
    coupling: 0.7,
    brightness: 0.67,
    ratios: [1, 2, 3, 4, 5, 6, 7, 8],
    description: "A narrow end-blown pipe changes register primarily through breath pressure, exposing successive air-column modes without finger holes.",
    modelNote: "Jet speed moves the strongest coupling window upward through a harmonic pipe bank, producing pressure-selected registers.",
    sourceLabel: "Established edge-tone / pipe model",
    sourceUrl: "https://newt.phys.unsw.edu.au/jw/fluteacoustics.html",
  }),
  freezePreset({
    id: "ukeke",
    label: "ʻUkeke",
    region: "Hawaiʻi",
    topology: "mouthBow",
    tier: "comparative",
    breathMode: "resonator",
    gesture: "pluck",
    pitchHz: 164.81,
    lengthM: 0.55,
    damping: 0.5,
    coupling: 0.89,
    brightness: 0.45,
    ratios: [1, 1.122, 1.26],
    description: "Three strings are plucked while the lips and oral cavity act as a moving resonator, silently articulating changes in timbre.",
    modelNote: "A plucked modal string bank decays independently; signed breath changes acoustic loading and turbulence, not the initial excitation.",
    sourceLabel: "Met Museum ʻukeke description",
    sourceUrl: "https://www.metmuseum.org/art/collection/search/501357",
  }),
  freezePreset({
    id: "umrhubhe",
    label: "Umrhubhe",
    region: "Xhosa, South Africa",
    topology: "mouthBow",
    tier: "comparative",
    breathMode: "resonator",
    gesture: "rub",
    pitchHz: 98,
    lengthM: 0.86,
    damping: 0.38,
    coupling: 0.93,
    brightness: 0.35,
    ratios: [1, 2, 3, 4, 5, 6, 8],
    description: "A friction stick excites the bow string while the mouth cavity selects and amplifies harmonics from the sustained vibration.",
    modelNote: "Stick-slip forcing sustains a string modal bank; the mouth resonator supplies the strongest audible spectral movement.",
    sourceLabel: "Smithsonian Xhosa musical bow record",
    sourceUrl: "https://www.si.edu/object/siris_sil_1049837",
  }),
  freezePreset({
    id: "lunku",
    label: "Lunku mouth bow",
    region: "Central Africa",
    topology: "mouthBow",
    tier: "comparative",
    breathMode: "resonator",
    gesture: "pluck",
    pitchHz: 110,
    lengthM: 0.72,
    damping: 0.47,
    coupling: 0.9,
    brightness: 0.41,
    ratios: [1, 2, 3, 4, 5, 6],
    description: "A twanged string supplies a harmonic spectrum while the bow is pressed to the mouth, turning the oral cavity into its resonator.",
    modelNote: "A short pluck excites string modes; jaw, tongue, and lip controls move the radiating formants.",
    sourceLabel: "Smithsonian mouth-bow description",
    sourceUrl: "https://repository.si.edu/server/api/core/bitstreams/b2ca7987-d521-450c-82b9-0b11ee81c2f8/content",
  }),
  freezePreset({
    id: "berimbau-mouth",
    label: "Berimbau-de-boca",
    region: "Brazil",
    topology: "mouthBow",
    tier: "comparative",
    breathMode: "resonator",
    gesture: "pluck",
    pitchHz: 92.5,
    lengthM: 0.94,
    damping: 0.43,
    coupling: 0.91,
    brightness: 0.48,
    ratios: [1, 2, 3, 4, 5, 6, 7],
    description: "Unlike the gourd-resonated capoeira berimbau, this mouth-bow form couples its plucked string directly to a changing oral resonator.",
    modelNote: "Plucked string modes feed a vowel-like impedance filter; breath adds load and aspiration but does not replace the pluck.",
    sourceLabel: "UFPB Brazilian instrument archive",
    sourceUrl: "https://www.ctdr.ufpb.br/labeet/contents/paginas/acervo-brazinst/copy_of_idiofones/berimbau_de_boca",
  }),
  freezePreset({
    id: "kni",
    label: "K’ni",
    region: "Vietnam, Central Highlands",
    topology: "mouthBow",
    tier: "comparative",
    breathMode: "resonator",
    gesture: "bow",
    pitchHz: 146.83,
    lengthM: 0.68,
    damping: 0.3,
    coupling: 0.96,
    brightness: 0.52,
    ratios: [1, 2, 3, 4, 5, 6, 7, 8],
    path: ["bow friction", "tensioned string", "mouth-coupling cord", "oral cavity"],
    description: "A bowed string sends vibration along a cord held at the mouth; the player's oral cavity becomes a highly articulate remote resonator.",
    modelNote: "Bowed stick-slip energy sustains string modes and a coupling cord injects them into movable oral formants.",
    sourceLabel: "Met Museum K’ni description",
    sourceUrl: "https://www.metmuseum.org/art/collection/search/928960",
  }),
  freezePreset({
    id: "makomako",
    label: "Makomako jaw harp",
    region: "Aotearoa New Zealand",
    topology: "jawReed",
    tier: "measured",
    breathMode: "both",
    gesture: "pluck",
    pitchHz: 118,
    lengthM: 0.12,
    damping: 0.53,
    coupling: 0.9,
    brightness: 0.36,
    ratios: [1, 2, 3, 4, 5, 6, 7, 8, 10, 12],
    description: "A split-bamboo lamella is finger-excited at the lips; inhaled and exhaled air load its motion differently while the mouth selects harmonics.",
    modelNote: "A plucked lamella supplies the initial energy and signed pressure sustains, bends, and redistributes its harmonic modes.",
    sourceLabel: "Jaw-harp breath-loading analysis",
    sourceUrl: "https://doi.org/10.1121/1.2935514",
  }),
  freezePreset({
    id: "mukkuri",
    label: "Mukkuri",
    region: "Ainu, Japan",
    topology: "jawReed",
    tier: "established",
    breathMode: "both",
    gesture: "pluck",
    pitchHz: 92,
    lengthM: 0.16,
    damping: 0.49,
    coupling: 0.92,
    brightness: 0.28,
    ratios: [1, 2, 3, 4, 5, 6, 8, 10],
    description: "A cord-plucked bamboo tongue vibrates before the mouth, whose shape and alternating airflow reveal and animate its upper partials.",
    modelNote: "A plucked bamboo lamella is pressure-loaded in both directions and radiated through a movable three-formant cavity.",
    sourceLabel: "Comparative jaw-harp model",
    sourceUrl: "https://doi.org/10.1121/1.2935514",
  }),
  freezePreset({
    id: "dan-moi",
    label: "Đàn môi",
    region: "Vietnam",
    topology: "jawReed",
    tier: "established",
    breathMode: "both",
    gesture: "pluck",
    pitchHz: 132,
    lengthM: 0.1,
    damping: 0.58,
    coupling: 0.94,
    brightness: 0.7,
    ratios: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12],
    description: "A light brass lamella rests against the lips rather than the teeth; pluck, signed airflow, and oral articulation all strongly affect its sound.",
    modelNote: "A bright plucked lamella receives bidirectional aerodynamic sustain and close-coupled vocal-tract filtering.",
    sourceLabel: "Comparative jaw-harp model",
    sourceUrl: "https://doi.org/10.1121/1.2935514",
  }),
]);

export const BREATH_ATLAS_LIMITS = Object.freeze({
  sourcePitchHz: Object.freeze([42, 640]),
  breathPressure: Object.freeze([0, 1]),
  breathRateBpm: Object.freeze([8, 96]),
  breathBalance: Object.freeze([0.25, 0.75]),
  damping: Object.freeze([0.05, 0.92]),
  brightness: Object.freeze([0, 1]),
  coupling: Object.freeze([0, 1]),
  tonguePosition: Object.freeze([0, 1]),
  tongueHeight: Object.freeze([0, 1]),
  jawOpening: Object.freeze([0, 1]),
  lipRounding: Object.freeze([0, 1]),
  glottisOpening: Object.freeze([0, 1]),
  boreLengthM: Object.freeze([0.08, 2.4]),
  gestureForce: Object.freeze([0.05, 1]),
  gestureRateBpm: Object.freeze([30, 220]),
  breathSyncRatio: Object.freeze([0.25, 4]),
  dryResonance: Object.freeze([0, 0.35]),
  outputLevel: Object.freeze([0, 0.82]),
});

export const BREATH_ATLAS_DEFAULTS = Object.freeze({
  instrumentId: "lesiba",
  sourcePitchHz: 82,
  breathPressure: 0.76,
  breathRateBpm: 22,
  breathBalance: 0.46,
  damping: 0.34,
  brightness: 0.58,
  coupling: 0.91,
  tonguePosition: 0.5,
  tongueHeight: 0.35,
  jawOpening: 0.62,
  lipRounding: 0.18,
  glottisOpening: 0.48,
  boreLengthM: 1.28,
  gestureForce: 0.72,
  gestureRateBpm: 92,
  breathSyncRatio: 1,
  dryResonance: 0.08,
  outputLevel: 0.48,
  autoBreath: true,
  autoGesture: true,
  breathLinked: true,
  rhythmId: "quarter-eighths",
});

export function clamp(value, minimum = 0, maximum = 1) {
  const numeric = Number(value);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(numeric) ? numeric : minimum));
}

export function instrumentPreset(id) {
  return BREATH_INSTRUMENTS.find((preset) => preset.id === id) ?? BREATH_INSTRUMENTS[0];
}

export function sanitizeBreathAtlasState(source = {}, fallback = BREATH_ATLAS_DEFAULTS) {
  const candidate = source && typeof source === "object" ? source : {};
  const base = fallback && typeof fallback === "object" ? fallback : BREATH_ATLAS_DEFAULTS;
  const instrumentId = instrumentPreset(candidate.instrumentId ?? base.instrumentId).id;
  const result = { instrumentId };
  for (const [key, [minimum, maximum]] of Object.entries(BREATH_ATLAS_LIMITS)) {
    const value = candidate[key] ?? base[key] ?? BREATH_ATLAS_DEFAULTS[key];
    result[key] = clamp(value, minimum, maximum);
  }
  result.autoBreath = Boolean(candidate.autoBreath ?? base.autoBreath ?? true);
  result.autoGesture = Boolean(candidate.autoGesture ?? base.autoGesture ?? true);
  result.breathLinked = Boolean(candidate.breathLinked ?? base.breathLinked ?? true);
  result.rhythmId = rhythmPattern(candidate.rhythmId ?? base.rhythmId).id;
  return result;
}

export function stateForInstrument(id = "lesiba", overrides = {}) {
  const preset = instrumentPreset(id);
  return sanitizeBreathAtlasState({
    ...BREATH_ATLAS_DEFAULTS,
    instrumentId: preset.id,
    sourcePitchHz: preset.pitchHz,
    boreLengthM: preset.lengthM,
    damping: preset.damping,
    coupling: preset.coupling,
    brightness: preset.brightness,
    ...overrides,
  });
}

export function breathCycleIntervalMs(rateBpm) {
  const rate = clamp(rateBpm, BREATH_ATLAS_LIMITS.breathRateBpm[0], BREATH_ATLAS_LIMITS.breathRateBpm[1]);
  return 60_000 / rate;
}

export function rhythmPattern(id) {
  return RHYTHM_PATTERNS.find((pattern) => pattern.id === id) ?? RHYTHM_PATTERNS[0];
}

export function rhythmStepIntervalMs(rateBpm) {
  const rate = clamp(rateBpm, BREATH_ATLAS_LIMITS.gestureRateBpm[0], BREATH_ATLAS_LIMITS.gestureRateBpm[1]);
  return 30_000 / rate;
}

export function rhythmLoopIntervalMs(source = BREATH_ATLAS_DEFAULTS) {
  const state = sanitizeBreathAtlasState(source);
  return rhythmPattern(state.rhythmId).steps.length * rhythmStepIntervalMs(state.gestureRateBpm);
}

export function linkedBreathRateBpm(source = BREATH_ATLAS_DEFAULTS) {
  const state = sanitizeBreathAtlasState(source);
  return clamp(
    60_000 / rhythmLoopIntervalMs(state) * state.breathSyncRatio,
    BREATH_ATLAS_LIMITS.breathRateBpm[0],
    BREATH_ATLAS_LIMITS.breathRateBpm[1],
  );
}

export function rhythmHit(source = BREATH_ATLAS_DEFAULTS, step = 0) {
  const state = sanitizeBreathAtlasState(source);
  const steps = rhythmPattern(state.rhythmId).steps;
  const index = ((Math.trunc(Number(step) || 0) % steps.length) + steps.length) % steps.length;
  return Object.freeze({ index, velocity: steps[index], active: steps[index] > 0 });
}

export function breathCycleFlow(source = BREATH_ATLAS_DEFAULTS, phase = 0) {
  const state = sanitizeBreathAtlasState(source);
  const preset = instrumentPreset(state.instrumentId);
  const wrapped = ((Number(phase) % 1) + 1) % 1;
  let flow;
  if (wrapped < state.breathBalance) {
    flow = -state.breathPressure * Math.sin(Math.PI * wrapped / state.breathBalance);
  } else {
    flow = state.breathPressure * Math.sin(
      Math.PI * (wrapped - state.breathBalance) / (1 - state.breathBalance),
    );
  }
  if (preset.breathMode === "out") return Math.max(0, flow);
  return flow;
}

export function breathDirectionAllowed(presetOrId, direction) {
  const preset = typeof presetOrId === "string" ? instrumentPreset(presetOrId) : presetOrId;
  if (preset.breathMode === "both" || preset.breathMode === "resonator") return true;
  return Number(direction) >= 0;
}

export function sourceRequiresBreath(presetOrId) {
  const preset = typeof presetOrId === "string" ? instrumentPreset(presetOrId) : presetOrId;
  return preset.topology !== "mouthBow" && preset.topology !== "jawReed";
}

export function sourceNeedsGesture(presetOrId) {
  const preset = typeof presetOrId === "string" ? instrumentPreset(presetOrId) : presetOrId;
  return preset.gesture !== "none";
}

export function mouthFormants(source = BREATH_ATLAS_DEFAULTS) {
  const state = sanitizeBreathAtlasState(source);
  const rear = 1 - state.tonguePosition;
  const low = clamp(
    220 + state.jawOpening * 560 + (1 - state.tongueHeight) * 230 - state.lipRounding * 100,
    170,
    1_050,
  );
  const middle = clamp(
    650 + state.tonguePosition * 1_760 - state.lipRounding * 510 - state.glottisOpening * 80,
    low + 180,
    2_900,
  );
  const high = clamp(
    1_900 + state.tonguePosition * 720 + state.jawOpening * 260 - state.lipRounding * 210,
    middle + 240,
    3_850,
  );
  return Object.freeze({
    frequenciesHz: Object.freeze([low, middle, high]),
    bandwidthsHz: Object.freeze([
      70 + state.jawOpening * 110 + state.glottisOpening * 70,
      100 + rear * 150 + state.glottisOpening * 90,
      160 + state.lipRounding * 150 + state.glottisOpening * 80,
    ]),
  });
}

export function modeFrequencies(source = BREATH_ATLAS_DEFAULTS, direction = 1, count = 16) {
  const state = sanitizeBreathAtlasState(source);
  const preset = instrumentPreset(state.instrumentId);
  const amount = Math.max(1, Math.min(32, Math.round(Number(count) || 16)));
  const directionalShift = direction < 0 ? (preset.drawShift ?? 0.997) : 1;
  const ratios = preset.ratios;
  const modes = [];
  for (let index = 0; index < amount; index += 1) {
    const bank = ratios[index % ratios.length];
    const octave = Math.floor(index / ratios.length);
    let ratio = bank * 2 ** octave;
    if (preset.topology === "lipReed" && index >= ratios.length) ratio = 2 * index + 1;
    modes.push(state.sourcePitchHz * ratio * directionalShift);
  }
  return Object.freeze(modes);
}

export function directionalModeWeight(presetOrId, direction, modeIndex) {
  const preset = typeof presetOrId === "string" ? instrumentPreset(presetOrId) : presetOrId;
  const harmonic = Math.max(1, Math.round(Number(modeIndex) || 0) + 1);
  if (direction < 0) {
    if (preset.topology === "stringWind") return (harmonic % 2 ? 1.2 : 0.54) / harmonic ** 0.62;
    if (preset.topology === "freeReed") return (harmonic % 3 === 0 ? 1.18 : 0.74) / harmonic ** 0.38;
    if (preset.topology === "jawReed") return (harmonic % 2 ? 1.08 : 0.48) / harmonic ** 0.68;
    return 0;
  }
  if (preset.topology === "stringWind") return (harmonic % 2 ? 0.78 : 1.24) / harmonic ** 0.55;
  if (preset.topology === "freeReed") return (harmonic % 2 ? 0.88 : 1.12) / harmonic ** 0.34;
  if (preset.topology === "jawReed") return (harmonic % 2 ? 0.9 : 1.25) / harmonic ** 0.58;
  if (preset.topology === "lipReed") return (harmonic % 2 ? 1 : 0.2) / harmonic ** 0.52;
  if (preset.topology === "edgeTone") return 1 / harmonic ** 0.72;
  return 1 / harmonic ** 0.66;
}

export function excitationGain(source, breathFlow = 0, gestureEnergy = 0) {
  const state = sanitizeBreathAtlasState(source);
  const preset = instrumentPreset(state.instrumentId);
  const flow = breathDirectionAllowed(preset, breathFlow) ? Math.abs(Number(breathFlow) || 0) : 0;
  const gesture = clamp(gestureEnergy);
  if (preset.topology === "mouthBow") return gesture;
  if (preset.topology === "jawReed") return gesture * (0.34 + flow * 0.66);
  const threshold = preset.topology === "lipReed" ? 0.09 : preset.topology === "edgeTone" ? 0.07 : 0.035;
  return clamp((flow - threshold) / Math.max(0.01, 1 - threshold));
}

export function evidenceCounts() {
  return Object.freeze(BREATH_INSTRUMENTS.reduce((counts, preset) => {
    counts[preset.tier] += 1;
    return counts;
  }, { measured: 0, established: 0, comparative: 0 }));
}
