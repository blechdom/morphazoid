import {
  VOCALZOID_DEFAULT_WORD, VOCALZOID_MAX_MIDI, VOCALZOID_MIN_MIDI, VOCALZOID_STYLES, createRandomVocalzoidScore,
  createVocalzoidSequence, normalizeVocalzoidWord, updateVocalzoidNote, vocalzoidSequenceBeats,
} from "./vocalzoid.js";
import { spellingPhoneDefinition } from "../spelling-synthesizer/spelling-pronunciation.js";
import { presetStateKey } from "../../site/header-presets.js";
import { presetRandom } from "../../site/preset-random.js";

const NOTE_KEYS = Object.freeze(["id", "lyric", "phones", "alias", "start", "duration", "midi"]);
const MAX_NOTES = 64;
const SCALES = Object.freeze([
  [0, 2, 4, 5, 7, 9, 11], [0, 2, 3, 5, 7, 8, 10], [0, 2, 4, 7, 9], [0, 3, 5, 7, 10],
  [0, 2, 3, 5, 7, 9, 10], [0, 2, 4, 6, 8, 10], [0, 1, 4, 5, 7, 8, 11],
]);

// Output level, Loop and the melody-template shortcut are not scene content; pitches live in the notes.
export function captureVocalzoidPreset({ word, style, bpm, vibrato, glide, scoreBeats, randomScore, notes }) {
  const plain = [...notes].sort((a, b) => a.start - b.start).map(note => {
    const edited = updateVocalzoidNote(note);
    return {
      ...Object.fromEntries(NOTE_KEYS.map(key => [key, key === "phones" ? [...edited.phones] : edited[key]])),
      ...(note.phonesEdited ? { phonesEdited: true } : {}),
    };
  });
  return {
    word: normalizeVocalzoidWord(word) || VOCALZOID_DEFAULT_WORD,
    style: style in VOCALZOID_STYLES ? style : "raw",
    bpm: Math.min(220, Math.max(40, Number(bpm))),
    vibrato: Math.min(80, Math.max(0, Number(vibrato))),
    glide: Math.min(240, Math.max(0, Number(glide))),
    scoreBeats: Math.max(4, Number(scoreBeats), Math.ceil(vocalzoidSequenceBeats(plain) + 1)),
    randomScore: Boolean(randomScore),
    notes: plain,
  };
}

export function validateVocalzoidPreset(snapshot) {
  presetStateKey(snapshot);
  const notes = snapshot?.notes;
  if (!Array.isArray(notes) || notes.length > MAX_NOTES || new Set(notes.map(note => note?.id)).size !== notes.length
    || notes.some(note => !note?.phones?.length || note.phones.some(phone => !spellingPhoneDefinition(phone) || phone !== String(phone).toUpperCase()))
    || typeof snapshot.randomScore !== "boolean"
    || presetStateKey(captureVocalzoidPreset(snapshot)) !== presetStateKey(snapshot)) {
    throw new TypeError("Invalid complete Vocalzoid preset");
  }
  return snapshot;
}

const note = (lyric, phones, start, duration, midi) => ({ lyric, phones: phones.split(" "), start, duration, midi });
const phrase = (id, label, { word, style = "raw", bpm = 108, vibrato = 22, glide = 65 }, notes) => {
  const snapshot = captureVocalzoidPreset({
    word, style, bpm, vibrato, glide, scoreBeats: 0, randomScore: false,
    notes: notes.map((entry, index) => ({ id: `vz-${index + 1}`, alias: "", ...entry })),
  });
  validateVocalzoidPreset(snapshot);
  return Object.freeze({ id, label, snapshot: Object.freeze(snapshot) });
};
const run = (syllables, midis, step = 1, start = 0) => syllables.map(([lyric, phones], index) => (
  note(lyric, phones, start + index * step, step, midis[index % midis.length])
));

export const VOCALZOID_FULL_PRESETS = Object.freeze([
  phrase("vocalzoid-lift", "Vocalzoid · Lift", { word: "vocalzoid" }, createVocalzoidSequence("vocalzoid").map(({ lyric, phones, start, duration, midi }) => (
    { lyric, phones: [...phones], start, duration, midi }
  ))),
  phrase("glass-anthem", "Glass anthem", { word: "vocalzoid", style: "glass", bpm: 132, vibrato: 12, glide: 20 }, [
    note("vo", "V OW", 0, 1, 64), note("cal", "K AH L", 1, 1, 67), note("zoid", "Z OY D", 2, 2, 72),
    note("vo", "V OW", 4, 1, 71), note("cal", "K AH L", 5, 1, 67), note("zoid", "Z OY D", 6, 2, 64),
  ]),
  phrase("velvet-ooh-pad", "Velvet ooh pad", { word: "ooh", style: "velvet", bpm: 58, vibrato: 44, glide: 140 }, [
    note("ooh", "UW", 0, 4, 55), note("oh", "OW", 4, 4, 59), note("ah", "AA", 8, 4, 62), note("ooh", "UW", 12, 4, 57),
  ]),
  phrase("staccato-pop", "Staccato pop", { word: "bada", style: "glass", bpm: 152, vibrato: 0, glide: 0 }, [
    ...run([["ba", "B AA"], ["da", "D AA"], ["ka", "K AA"], ["ta", "T AA"]], [60, 64, 62, 67], 0.5),
    ...run([["bi", "B IY"], ["di", "D IY"], ["ki", "K IY"], ["ti", "T IY"]], [72, 69, 67, 64], 0.5, 2.5),
  ]),
  phrase("solfege-climb", "Solfege climb", { word: "doremi", bpm: 96, vibrato: 18, glide: 50 }, [
    note("do", "D OW", 0, 1, 55), note("re", "R EY", 1, 1, 57), note("mi", "M IY", 2, 1, 59),
    note("fa", "F AA", 3, 1, 60), note("sol", "S OW L", 4, 1, 62), note("la", "L AA", 5, 1, 64),
    note("ti", "T IY", 6, 1, 66), note("do", "D OW", 7, 3, 67),
  ]),
  phrase("siren-leaps", "Siren leaps", { word: "ahh", bpm: 84, vibrato: 70, glide: 240 }, [
    note("ah", "AA", 0, 2, 48), note("ah", "AA", 2, 2, 72), note("ah", "AA", 4, 2, 53), note("ah", "AA", 6, 2, 68), note("ah", "AA", 8, 4, 60),
  ]),
  phrase("robot-count", "Robot count", { word: "counting", style: "glass", bpm: 120, vibrato: 0, glide: 10 }, [
    note("one", "W AH N", 0, 1, 57), note("two", "T UW", 1, 1, 57), note("three", "TH R IY", 2, 1, 60),
    note("four", "F AO R", 3, 1, 60), note("five", "F AY V", 4, 2, 64), note("six", "S IH K S", 6, 1, 62), note("go", "G OW", 7, 2, 55),
  ]),
  phrase("kyrie-chant", "Kyrie chant", { word: "kyrie", style: "velvet", bpm: 70, vibrato: 30, glide: 90 }, [
    note("ky", "K IH R", 0, 2, 55), note("ri", "R IY", 2, 1, 57), note("e", "EH", 3, 3, 55),
    note("e", "EH", 6, 1, 57), note("lei", "L EY", 7, 1, 59), note("son", "S AA N", 8, 4, 57),
  ]),
  phrase("thunder-rumble", "Thunder rumble", { word: "thunder", bpm: 66, vibrato: 8, glide: 190 }, [
    note("thun", "TH AH N", 0, 3, 48), note("der", "D ER", 3, 3, 50), note("rum", "R AH M", 6, 3, 49), note("ble", "B AH L", 9, 4, 48),
  ]),
  phrase("birdsong-flurry", "Birdsong flurry", { word: "tweet", style: "glass", bpm: 176, vibrato: 62, glide: 30 }, [
    ...run([["tee", "T IY"], ["tee", "T IY"], ["ti", "T IH"], ["tee", "T IY"]], [72, 71, 69, 72], 0.5),
    ...run([["pit", "P IH T"], ["pi", "P IY"], ["tit", "T IH T"]], [67, 69, 66], 0.5, 2.25),
  ]),
  phrase("mm-drone", "Mm drone", { word: "mmm", style: "velvet", bpm: 48, vibrato: 36, glide: 200 }, [
    note("mm", "M UW M", 0, 6, 48), note("mm", "M AH M", 6, 6, 55), note("mm", "M UW M", 12, 6, 52),
  ]),
  phrase("fizz-and-hiss", "Fizz and hiss", { word: "zshzsh", bpm: 140, vibrato: 4, glide: 15 }, [
    note("zah", "Z AA", 0, 0.5, 60), note("shee", "SH IY", 0.5, 0.5, 63), note("jaw", "JH AO", 1, 0.5, 60),
    note("zhuh", "ZH AH", 1.5, 0.5, 67), note("chee", "CH IY", 2, 1, 65), note("fuz", "F AH Z", 3, 0.5, 63), note("sing", "S IH NG", 3.5, 1.5, 60),
  ]),
  phrase("question-answer", "Question and answer", { word: "yeah", style: "velvet", bpm: 100, vibrato: 26, glide: 110 }, [
    note("oh", "OW", 0, 1, 60), note("yeah", "Y EH", 1, 1, 64), note("oh", "OW", 2, 2, 67),
    note("yeah", "Y EH", 5, 1, 64), note("oh", "OW", 6, 1, 60), note("no", "N OW", 7, 3, 55),
  ]),
  phrase("moonlight-waltz", "Moonlight waltz", { word: "moonlight", style: "velvet", bpm: 88, vibrato: 34, glide: 80 }, [
    note("moon", "M UW N", 0, 3, 59), note("light", "L AY T", 3, 1.5, 62), note("wal", "W AO L", 4.5, 1.5, 64),
    note("tz", "T S", 6, 0.5, 64), note("on", "AO N", 6.5, 2.5, 62), note("air", "EH R", 9, 3, 59),
  ]),
]);

export function randomizeVocalzoidPreset(current, random = Math.random) {
  validateVocalzoidPreset(current);
  const rng = presetRandom(random);
  const score = createRandomVocalzoidScore(rng.unit);
  const scale = rng.pick(SCALES), root = rng.integer(0, 11);
  const snap = midi => {
    let best = midi, bestDistance = Infinity;
    for (let candidate = VOCALZOID_MIN_MIDI; candidate <= VOCALZOID_MAX_MIDI; candidate++) {
      if (!scale.includes(((candidate - root) % 12 + 12) % 12)) continue;
      const distance = Math.abs(candidate - midi);
      if (distance < bestDistance) [best, bestDistance] = [candidate, distance];
    }
    return best;
  };
  let start = 0;
  const notes = score.notes.map(entry => {
    if (rng.unit() < 0.3) start += rng.integer(1, 4) * 0.25;
    const placed = { ...entry, phones: [...entry.phones], midi: snap(entry.midi), start };
    start += entry.duration;
    return placed;
  });
  return validateVocalzoidPreset(captureVocalzoidPreset({
    word: current.word, style: score.style, bpm: score.bpm, vibrato: score.vibrato, glide: score.glide,
    scoreBeats: Math.max(8, Math.ceil(start + 1)), randomScore: true, notes,
  }));
}
