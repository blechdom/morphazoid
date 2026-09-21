const NOTE_NAMES = Object.freeze([
  "C", "C♯", "D", "D♯", "E", "F",
  "F♯", "G", "G♯", "A", "A♯", "B",
]);

const ARCH_TOOTH_ORDER = Object.freeze([
  ["third-molar", "Third molar"],
  ["second-molar", "Second molar"],
  ["first-molar", "First molar"],
  ["second-premolar", "Second premolar"],
  ["first-premolar", "First premolar"],
  ["canine", "Canine"],
  ["lateral-incisor", "Lateral incisor"],
  ["central-incisor", "Central incisor"],
  ["central-incisor", "Central incisor"],
  ["lateral-incisor", "Lateral incisor"],
  ["canine", "Canine"],
  ["first-premolar", "First premolar"],
  ["second-premolar", "Second premolar"],
  ["first-molar", "First molar"],
  ["second-molar", "Second molar"],
  ["third-molar", "Third molar"],
]);

// Pixel-measured crown regions in the 1536 × 1024 Dentaphone artwork.
// Keeping the image and controls in one 3:2 artboard makes these bounds a
// direct, one-to-one map instead of an approximation of a dental arch.
const IMAGE_TOOTH_REGIONS = Object.freeze({
  upper: Object.freeze([
    [.3223, .4618, 5.60, 6.54, -2],
    [.3251, .3854, 6.45, 9.38, -5],
    [.3375, .3047, 6.32, 9.08, -8],
    [.3509, .2375, 5.53, 6.74, -15],
    [.3679, .1836, 5.21, 7.23, -23],
    [.3904, .1285, 4.82, 8.30, -28],
    [.4265, .0896, 4.49, 8.50, -18],
    [.4747, .0717, 5.60, 9.47, -3],
    [.5292, .0714, 5.53, 9.38, 3],
    [.5760, .0890, 4.49, 8.40, 18],
    [.6105, .1293, 4.75, 8.30, 28],
    [.6334, .1839, 5.27, 7.23, 23],
    [.6497, .2376, 5.60, 6.74, 15],
    [.6627, .3050, 6.45, 9.18, 8],
    [.6748, .3862, 6.45, 9.38, 5],
    [.6765, .4616, 5.60, 6.54, 2],
  ]),
  lower: Object.freeze([
    [.3259, .5811, 5.86, 8.30, 0],
    [.3380, .6572, 6.05, 9.08, -4],
    [.3557, .7225, 5.14, 6.84, -8],
    [.3717, .7747, 4.62, 6.64, -14],
    [.3931, .8244, 4.04, 6.93, -24],
    [.4210, .8611, 3.65, 7.52, -24],
    [.4512, .8816, 3.52, 7.42, -12],
    [.4836, .8912, 3.39, 7.23, -3],
    [.5159, .8854, 3.52, 7.42, 3],
    [.5484, .8816, 3.52, 7.42, 12],
    [.5791, .8605, 3.71, 7.42, 24],
    [.6069, .8235, 3.97, 6.93, 24],
    [.6283, .7748, 4.69, 6.64, 14],
    [.6447, .7224, 5.14, 6.64, 8],
    [.6626, .6575, 6.12, 9.08, 4],
    [.6749, .5813, 5.86, 8.30, 0],
  ]),
});

const buildArch = (arch) => ARCH_TOOTH_ORDER.map(([type, anatomicalName], archIndex) => {
  const side = archIndex < 8 ? "right" : "left";
  const [x, y, width, height, rotation] = IMAGE_TOOTH_REGIONS[arch][archIndex];
  const universalNumber = arch === "upper" ? archIndex + 1 : 32 - archIndex;
  const toothIndex = arch === "upper" ? archIndex : archIndex + 16;
  return Object.freeze({
    id: `${arch}-${String(archIndex + 1).padStart(2, "0")}`,
    arch,
    archIndex,
    type,
    anatomicalName,
    side,
    universalNumber,
    x,
    y,
    width,
    height,
    rotation,
    // Each crown has its own modal excitation point as well as its own pitch.
    // The inset avoids exact string/plate nodes at zero and one.
    strikePosition: 0.075 + (toothIndex / 31) * 0.85,
  });
});

export const DENTAPHONE_TEETH = Object.freeze([
  ...buildArch("upper"),
  ...buildArch("lower"),
]);

const buildBrushSweep = (arch) => {
  const forward = DENTAPHONE_TEETH
    .filter((tooth) => tooth.arch === arch)
    .map((tooth) => tooth.id);
  return [...forward, ...forward.slice(0, -1).reverse()];
};

// One automatic cycle travels to the far molar and back across each complete
// arch. Endpoints are not repeated at the turn, keeping the rhythm even while
// still making the toothbrush visibly reverse direction.
export const DENTAPHONE_BRUSH_ROUTE = Object.freeze([
  ...buildBrushSweep("upper"),
  ...buildBrushSweep("lower"),
]);

export const DENTAPHONE_PITCH_LAYOUTS = Object.freeze([
  Object.freeze({ id: "marimba-split", label: "Marimba split" }),
  Object.freeze({ id: "paired-chromatic", label: "Paired chromatic" }),
  Object.freeze({ id: "twin-diatonic", label: "Twin diatonic" }),
  Object.freeze({ id: "opposed-arches", label: "Opposed arches" }),
]);

export const DENTAPHONE_DEFAULT_PITCH_STATE = Object.freeze({
  layout: "paired-chromatic",
  root: 0,
  octave: 3,
});

const clampInteger = (value, minimum, maximum, fallback) => {
  const numeric = Math.round(Number(value));
  return Number.isFinite(numeric)
    ? Math.min(maximum, Math.max(minimum, numeric))
    : fallback;
};

const patternSequence = (baseMidi, pattern, count) => Array.from({ length: count }, (_, index) => (
  baseMidi + pattern[index % pattern.length] + Math.floor(index / pattern.length) * 12
));

const reverseAscending = (notes) => [...notes].reverse();

const fitMidiRange = (notes, minimum = 24, maximum = 107) => {
  const lowest = Math.min(...notes);
  const highest = Math.max(...notes);
  let offset = highest > maximum ? maximum - highest : 0;
  if (lowest + offset < minimum) offset += minimum - (lowest + offset);
  return notes.map((note) => note + offset);
};

export function dentaphoneNoteName(midiNote) {
  const note = clampInteger(midiNote, 0, 127, 60);
  return `${NOTE_NAMES[note % 12]}${Math.floor(note / 12) - 1}`;
}

export function sanitizeDentaphonePitchState(candidate = {}, fallback = DENTAPHONE_DEFAULT_PITCH_STATE) {
  const layouts = new Set(DENTAPHONE_PITCH_LAYOUTS.map(({ id }) => id));
  return Object.freeze({
    layout: layouts.has(candidate.layout) ? candidate.layout : fallback.layout,
    root: clampInteger(candidate.root, 0, 11, fallback.root),
    octave: clampInteger(candidate.octave, 1, 3, fallback.octave),
  });
}

export function buildDentaphonePitchMap(candidate = {}) {
  const settings = sanitizeDentaphonePitchState(candidate);
  const baseMidi = (settings.octave + 1) * 12 + settings.root;
  const diatonic = [0, 2, 4, 5, 7, 9, 11];
  const accidentals = [1, 3, 6, 8, 10];
  let lower;
  let upper;

  if (settings.layout === "paired-chromatic") {
    lower = Array.from({ length: 16 }, (_, index) => baseMidi + index);
    upper = Array.from({ length: 16 }, (_, index) => baseMidi + 12 + index);
  } else if (settings.layout === "twin-diatonic") {
    lower = patternSequence(baseMidi, diatonic, 16);
    upper = patternSequence(baseMidi + 12, diatonic, 16);
  } else if (settings.layout === "opposed-arches") {
    lower = patternSequence(baseMidi, diatonic, 16);
    upper = reverseAscending(patternSequence(baseMidi + 12, diatonic, 16));
  } else {
    lower = patternSequence(baseMidi, diatonic, 16);
    upper = patternSequence(baseMidi, accidentals, 16);
  }

  // Shift each complete layer as a unit at the MIDI boundaries. Clamping
  // individual notes would turn the last few teeth into duplicate pitches.
  lower = fitMidiRange(lower);
  upper = fitMidiRange(upper);

  return Object.freeze(DENTAPHONE_TEETH.map((tooth) => {
    const note = (tooth.arch === "upper" ? upper : lower)[tooth.archIndex];
    const midi = clampInteger(note, 24, 107, 60);
    return Object.freeze({
      ...tooth,
      midi,
      note: dentaphoneNoteName(midi),
    });
  }));
}

export function dentaphonePitchRange(pitchMap, arch) {
  const notes = pitchMap.filter((tooth) => tooth.arch === arch).map(({ midi }) => midi);
  if (!notes.length) return "—";
  return `${dentaphoneNoteName(notes[0])}–${dentaphoneNoteName(notes.at(-1))}`;
}

export function dentaphoneToothLabel(tooth, material = "modal body") {
  const archName = tooth.arch === "upper" ? "Upper" : "Lower";
  return `${archName} ${tooth.side} ${tooth.anatomicalName.toLowerCase()}, tooth ${tooth.universalNumber}, ${tooth.note}, ${material}`;
}
