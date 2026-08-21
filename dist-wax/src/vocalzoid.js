import {
  fallbackSpellingPronunciation,
  isSpellingPronunciationVowel,
  spellingPhoneDefinition,
} from "./spelling-pronunciation.js";

export const VOCALZOID_MIN_MIDI = 48;
export const VOCALZOID_MAX_MIDI = 72;
export const VOCALZOID_DEFAULT_WORD = "vocalzoid";

export const VOCALZOID_STYLES = Object.freeze({
  raw: Object.freeze({
    id: "raw",
    name: "KAL · Raw",
    description: "Close, dry diphone joins with the source spectrum left mostly intact.",
    color: "#b7ff5f",
    rootMidi: 43,
    highpass: 55,
    lowpass: 9_800,
    presenceFrequency: 2_200,
    presenceGain: 0.5,
    drive: 1,
    breath: 0,
  }),
  glass: Object.freeze({
    id: "glass",
    name: "KAL · Glass",
    description: "A brighter, lighter synthetic pop color with crisp consonant edges.",
    color: "#70ddff",
    rootMidi: 43,
    highpass: 105,
    lowpass: 12_800,
    presenceFrequency: 3_150,
    presenceGain: 4.2,
    drive: 1.08,
    breath: 0.035,
  }),
  velvet: Object.freeze({
    id: "velvet",
    name: "KAL · Velvet",
    description: "A low, softened voice color with round joins and a little air.",
    color: "#ff9ac8",
    rootMidi: 46,
    highpass: 45,
    lowpass: 5_800,
    presenceFrequency: 1_100,
    presenceGain: 2.8,
    drive: 0.94,
    breath: 0.06,
  }),
});

export const VOCALZOID_MELODY_PRESETS = Object.freeze({
  lift: Object.freeze({ name: "Lift", offsets: Object.freeze([0, 4, 7, 9, 7, 4]) }),
  answer: Object.freeze({ name: "Answer", offsets: Object.freeze([7, 5, 4, 2, 0, -1]) }),
  orbit: Object.freeze({ name: "Orbit", offsets: Object.freeze([0, 7, 3, 10, 5, 0]) }),
});

const SHARP_NAMES = Object.freeze([
  "C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B",
]);

const PHONE_ALIASES = Object.freeze({
  AA: ["aa", "a", "ah"], AE: ["ae", "a"], AH: ["ah", "ax", "uh", "a"],
  AO: ["ao", "aw", "o"], AW: ["aw", "au"], AY: ["ay", "ai"],
  B: ["b"], CH: ["ch", "tS"], D: ["d"], DH: ["dh", "th"],
  EH: ["eh", "e"], ER: ["er", "3"], EY: ["ey", "ei"], F: ["f"],
  G: ["g"], HH: ["hh", "h"], IH: ["ih", "i"], IY: ["iy", "ee", "i"],
  JH: ["jh", "j", "dZ"], K: ["k"], L: ["l"], M: ["m"], N: ["n"],
  NG: ["ng", "N"], OW: ["ow", "oh", "o"], OY: ["oy", "oi"],
  P: ["p"], R: ["r"], S: ["s"], SH: ["sh", "S"], T: ["t"],
  TH: ["th", "T"], UH: ["uh", "u"], UW: ["uw", "oo", "u"],
  V: ["v"], W: ["w"], Y: ["y"], Z: ["z"], ZH: ["zh", "Z"],
});

const WORD_SYLLABLE_OVERRIDES = Object.freeze({
  vocaloid: Object.freeze(["vo", "ca", "loid"]),
  vocalzoid: Object.freeze(["vo", "cal", "zoid"]),
  morphazoid: Object.freeze(["mor", "pha", "zoid"]),
  utau: Object.freeze(["u", "ta", "u"]),
});

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function clampVocalzoid(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, finite(value, minimum)));
}

export function normalizeVocalzoidWord(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[’']/g, "")
    .replace(/[^\p{L}\p{N}-]+/gu, "")
    .slice(0, 32);
}

export function vocalzoidMidiName(value) {
  const midi = Math.round(clampVocalzoid(value, 0, 127));
  return `${SHARP_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

export function vocalzoidMidiFrequency(value) {
  return 440 * (2 ** ((finite(value, 69) - 69) / 12));
}

export function vocalzoidStyle(value) {
  return VOCALZOID_STYLES[value] ?? VOCALZOID_STYLES.raw;
}

export function vocalzoidPronunciation(value) {
  const word = normalizeVocalzoidWord(value).toLowerCase();
  if (word === "vocalzoid") return ["V", "OW", "K", "AH", "L", "Z", "OY", "D"];
  return fallbackSpellingPronunciation(word);
}

export function syllabifyVocalzoidPhones(value) {
  const phones = [...(value ?? [])]
    .map((phone) => String(phone).replace(/\d/g, "").toUpperCase())
    .filter((phone) => spellingPhoneDefinition(phone));
  const vowelIndices = phones.flatMap((phone, index) => (
    isSpellingPronunciationVowel(phone) ? [index] : []
  ));
  if (vowelIndices.length <= 1) return phones.length ? [phones] : [];

  const groups = [];
  let start = 0;
  for (let index = 0; index < vowelIndices.length - 1; index += 1) {
    const currentVowel = vowelIndices[index];
    const nextVowel = vowelIndices[index + 1];
    const between = nextVowel - currentVowel - 1;
    // Keep all but the final intervocalic consonant as the current coda. The
    // last consonant becomes the next onset: AH L | Z OY, OW | K AH.
    const end = Math.max(currentVowel + 1, nextVowel - (between > 0 ? 1 : 0));
    groups.push(phones.slice(start, end));
    start = end;
  }
  groups.push(phones.slice(start));
  return groups.filter((group) => group.length);
}

function roughWrittenSyllables(word) {
  const normalized = normalizeVocalzoidWord(word).toLowerCase();
  if (!normalized) return [];
  if (WORD_SYLLABLE_OVERRIDES[normalized]) return [...WORD_SYLLABLE_OVERRIDES[normalized]];
  const nuclei = [...normalized.matchAll(/[aeiouy]+/g)];
  if (nuclei.length <= 1) return [normalized];
  const boundaries = [];
  for (let index = 0; index < nuclei.length - 1; index += 1) {
    const gapStart = (nuclei[index].index ?? 0) + nuclei[index][0].length;
    const gapEnd = nuclei[index + 1].index ?? gapStart;
    const consonantCount = Math.max(0, gapEnd - gapStart);
    boundaries.push(gapEnd - (consonantCount > 0 ? 1 : 0));
  }
  const syllables = [];
  let start = 0;
  for (const boundary of boundaries) {
    syllables.push(normalized.slice(start, boundary));
    start = boundary;
  }
  syllables.push(normalized.slice(start));
  return syllables.filter(Boolean);
}

function labelsForGroups(word, count) {
  const chunks = roughWrittenSyllables(word);
  if (chunks.length === count) return chunks;
  const normalized = normalizeVocalzoidWord(word).toLowerCase();
  if (count <= 1) return [normalized];
  return Array.from({ length: count }, (_, index) => {
    const start = Math.round(index * normalized.length / count);
    const end = Math.round((index + 1) * normalized.length / count);
    return normalized.slice(start, end) || `·${index + 1}`;
  });
}

export function createVocalzoidSequence(value, {
  phones = vocalzoidPronunciation(value),
  baseMidi = 55,
  beatsPerNote = 2,
  preset = "lift",
} = {}) {
  const word = normalizeVocalzoidWord(value) || VOCALZOID_DEFAULT_WORD;
  const phoneGroups = syllabifyVocalzoidPhones(phones);
  const groups = phoneGroups.length ? phoneGroups : [["AH"]];
  const labels = labelsForGroups(word, groups.length);
  const melody = VOCALZOID_MELODY_PRESETS[preset] ?? VOCALZOID_MELODY_PRESETS.lift;
  return groups.map((group, index) => Object.freeze({
    id: `vz-${index + 1}`,
    lyric: labels[index] ?? group.join(" ").toLowerCase(),
    phones: Object.freeze([...group]),
    alias: "",
    start: index * beatsPerNote,
    duration: beatsPerNote,
    midi: Math.round(clampVocalzoid(
      baseMidi + melody.offsets[index % melody.offsets.length],
      VOCALZOID_MIN_MIDI,
      VOCALZOID_MAX_MIDI,
    )),
  }));
}

export function updateVocalzoidNote(note, changes = {}) {
  return Object.freeze({
    ...note,
    ...changes,
    lyric: String(changes.lyric ?? note.lyric ?? "").slice(0, 18),
    alias: String(changes.alias ?? note.alias ?? "").slice(0, 80),
    start: clampVocalzoid(changes.start ?? note.start, 0, 62),
    duration: clampVocalzoid(changes.duration ?? note.duration, 0.25, 16),
    midi: Math.round(clampVocalzoid(
      changes.midi ?? note.midi,
      VOCALZOID_MIN_MIDI,
      VOCALZOID_MAX_MIDI,
    )),
    phones: Object.freeze([...(changes.phones ?? note.phones ?? [])]),
  });
}

export function applyVocalzoidMelody(notes, preset = "lift", baseMidi = 55) {
  const melody = VOCALZOID_MELODY_PRESETS[preset] ?? VOCALZOID_MELODY_PRESETS.lift;
  return notes.map((note, index) => updateVocalzoidNote(note, {
    midi: baseMidi + melody.offsets[index % melody.offsets.length],
  }));
}

function decodeLine(value) {
  return String(value ?? "").replace(/^\uFEFF/, "").trim();
}

export function parseUtauOto(value, { directory = "" } = {}) {
  const entries = [];
  for (const sourceLine of String(value ?? "").split(/\r?\n/)) {
    const line = decodeLine(sourceLine);
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const equals = line.indexOf("=");
    if (equals <= 0) continue;
    const filename = line.slice(0, equals).trim().replaceAll("\\", "/");
    const fields = line.slice(equals + 1).split(",");
    if (!filename || fields.length < 6) continue;
    const [aliasSource, offset, consonant, cutoff, preutterance, overlap] = fields;
    const alias = decodeLine(aliasSource) || filename.replace(/\.[^.]+$/, "");
    const prefix = String(directory).replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
    entries.push(Object.freeze({
      filename,
      path: prefix ? `${prefix}/${filename}` : filename,
      alias,
      normalizedAlias: normalizeUtauAlias(alias),
      offset: Math.max(0, finite(offset)),
      consonant: Math.max(0, finite(consonant)),
      cutoff: finite(cutoff),
      preutterance: Math.max(0, finite(preutterance)),
      overlap: finite(overlap),
    }));
  }
  return entries;
}

export function parseUtauCharacter(value) {
  const result = {};
  for (const sourceLine of String(value ?? "").split(/\r?\n/)) {
    const line = decodeLine(sourceLine);
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const equals = line.indexOf("=");
    if (equals <= 0) continue;
    const key = line.slice(0, equals).trim().toLowerCase();
    const field = line.slice(equals + 1).trim();
    if (key && field && !(key in result)) result[key] = field;
  }
  return Object.freeze(result);
}

export function decodeUtauText(bytes) {
  if (typeof bytes === "string") return bytes;
  const source = bytes instanceof ArrayBuffer
    ? new Uint8Array(bytes)
    : bytes instanceof Uint8Array ? bytes : new Uint8Array();
  for (const encoding of ["utf-8", "shift-jis"]) {
    try {
      const decoded = new TextDecoder(encoding, { fatal: encoding === "utf-8" }).decode(source);
      if (decoded) return decoded;
    } catch {}
  }
  return new TextDecoder().decode(source);
}

export function parseUtauFrq(value) {
  const bytes = value instanceof ArrayBuffer
    ? new Uint8Array(value)
    : value instanceof Uint8Array ? value : new Uint8Array();
  if (bytes.byteLength < 20) return null;
  const signature = new TextDecoder("ascii").decode(bytes.subarray(0, 8));
  if (signature !== "FREQ0003") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const hopSize = view.getInt32(8, true);
  const averageFrequency = view.getFloat64(12, true);
  if (!(hopSize > 0) || !(averageFrequency > 20 && averageFrequency < 8_000)) return null;
  return Object.freeze({
    hopSize,
    averageFrequency,
    midi: 69 + 12 * Math.log2(averageFrequency / 440),
  });
}

export function normalizeUtauPath(value) {
  return String(value ?? "")
    .replaceAll("\\", "/")
    .replace(/^\.\//, "")
    .replace(/\/{2,}/g, "/")
    .toLowerCase();
}

export function normalizeUtauAlias(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function utauAliasCandidates(note, previousPhone = "-") {
  const explicit = normalizeUtauAlias(note?.alias);
  const phones = [...(note?.phones ?? [])].map((phone) => String(phone).toUpperCase());
  const lyric = normalizeUtauAlias(note?.lyric);
  const vowelContextual = [];
  const internalContextual = [];
  const boundaryContextual = [];
  const vowelSimple = [];
  const simple = [];
  let prior = previousPhone;
  for (let index = 0; index < phones.length; index += 1) {
    const phone = phones[index];
    const aliases = PHONE_ALIASES[phone] ?? [phone.toLowerCase()];
    const previousAliases = prior === "-"
      ? ["-"]
      : (PHONE_ALIASES[prior] ?? [String(prior).toLowerCase()]);
    const simpleTarget = isSpellingPronunciationVowel(phone) ? vowelSimple : simple;
    const contextualTarget = index === 0
      ? boundaryContextual
      : isSpellingPronunciationVowel(phone) ? vowelContextual : internalContextual;
    for (const alias of aliases) {
      simpleTarget.push(alias, `- ${alias}`, `${alias} -`);
      for (const previous of previousAliases) {
        contextualTarget.push(`${previous} ${alias}`, `${previous}-${alias}`);
      }
    }
    prior = phone;
  }
  // A single lightweight note renderer needs the unit that reaches the vowel
  // body before a boundary onset or bare consonant. Exact user aliases and
  // whole-lyric CV aliases still take precedence.
  const candidates = [
    explicit,
    lyric,
    ...vowelContextual,
    ...internalContextual,
    ...boundaryContextual,
    ...vowelSimple,
    ...simple,
  ];
  return [...new Set(candidates.map(normalizeUtauAlias).filter(Boolean))];
}

export function resolveUtauEntry(entries, note, previousPhone = "-") {
  const byAlias = new Map();
  for (const entry of entries ?? []) {
    const alias = entry.normalizedAlias ?? normalizeUtauAlias(entry.alias);
    if (!byAlias.has(alias)) byAlias.set(alias, entry);
  }
  for (const candidate of utauAliasCandidates(note, previousPhone)) {
    if (byAlias.has(candidate)) return byAlias.get(candidate);
  }
  return null;
}

export function vocalzoidBankCoverage(entries, notes) {
  let matched = 0;
  let previousPhone = "-";
  const resolved = notes.map((note) => {
    const entry = resolveUtauEntry(entries, note, previousPhone);
    if (entry) matched += 1;
    const phones = note.phones ?? [];
    if (phones.length) previousPhone = phones[phones.length - 1];
    return entry;
  });
  return Object.freeze({
    matched,
    total: notes.length,
    ratio: notes.length ? matched / notes.length : 0,
    resolved: Object.freeze(resolved),
  });
}

export function vocalzoidRenderPlan(notes, bpm = 108) {
  const beatSeconds = 60 / clampVocalzoid(bpm, 40, 220);
  const plan = [];
  for (const note of notes ?? []) {
    const noteStart = finite(note.start) * beatSeconds;
    const noteDuration = Math.max(0.12, finite(note.duration, 1) * beatSeconds);
    const phones = note.phones?.length ? note.phones : ["AH"];
    const vowelIndex = phones.findIndex(isSpellingPronunciationVowel);
    const leadingCount = vowelIndex < 0 ? Math.max(0, phones.length - 1) : vowelIndex;
    const trailingCount = vowelIndex < 0 ? 0 : phones.length - vowelIndex - 1;
    const leadingSeconds = Math.min(noteDuration * 0.32, leadingCount * 0.085);
    const trailingSeconds = Math.min(noteDuration * 0.24, trailingCount * 0.07);
    const bodyStart = noteStart + leadingSeconds;
    const bodyEnd = noteStart + noteDuration - trailingSeconds;
    phones.forEach((phone, phoneIndex) => {
      let start;
      let duration;
      if (phoneIndex < leadingCount) {
        duration = leadingCount ? leadingSeconds / leadingCount + 0.022 : 0.08;
        start = noteStart + phoneIndex * (leadingSeconds / Math.max(1, leadingCount));
      } else if (phoneIndex === vowelIndex || (vowelIndex < 0 && phoneIndex === phones.length - 1)) {
        start = bodyStart - 0.018;
        duration = Math.max(0.09, bodyEnd - bodyStart + 0.036);
      } else {
        const trailingIndex = phoneIndex - vowelIndex - 1;
        duration = trailingCount ? trailingSeconds / trailingCount + 0.018 : 0.075;
        start = bodyEnd + trailingIndex * (trailingSeconds / Math.max(1, trailingCount)) - 0.018;
      }
      plan.push(Object.freeze({
        noteId: note.id,
        lyric: note.lyric,
        phone,
        midi: note.midi,
        start: Math.max(0, start),
        duration: Math.max(0.04, duration),
        sustain: isSpellingPronunciationVowel(phone),
      }));
    });
  }
  return Object.freeze(plan);
}

export function vocalzoidSequenceBeats(notes) {
  return Math.max(1, ...(notes ?? []).map((note) => finite(note.start) + finite(note.duration)));
}
