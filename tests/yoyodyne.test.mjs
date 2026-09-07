import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  YOYODYNE_LIMITS,
  YOYODYNE_VOICE_ROLES,
  createYoyodynePhrase,
  formatYoyodynePitch,
  midiToFrequency,
  planYoyodyneAudioWindow,
  restoreYoyodyneNote,
  sanitizeYoyodyneNotes,
  updateYoyodyneNote,
  yoyodyneBeatWithinLoop,
  yoyodyneMaximumPolyphony,
  yoyodyneNoteAtBeat,
  yoyodyneNotesAtBeat,
  yoyodyneOccurrenceAtOrdinal,
  yoyodyneScoreBeatAtAudioTime,
} from "../src/yoyodyne.js";
import {
  YOYODYNE_AUDIO_LIMITS,
  YOYODYNE_RELAY_VOICES,
  deriveYoyodyneTrigger,
  yoyodyneScoreGainScale,
} from "../src/yoyodyne-audio.js";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("Yoyodyne opens on a deterministic, immutable, bounded four-bar phrase", () => {
  const first = createYoyodynePhrase();
  const second = createYoyodynePhrase();

  assert.deepEqual(first, second);
  assert.notStrictEqual(first, second);
  assert.equal(first.length, 16);
  assert.ok(Object.isFrozen(first));
  assert.deepEqual(
    YOYODYNE_VOICE_ROLES.map((role) => first.filter((note) => note.voiceRole === role).length),
    [4, 4, 8],
  );
  for (const note of first) {
    assert.ok(Object.isFrozen(note));
    assert.ok(Object.isFrozen(note.bendCents));
    assert.match(note.id, /^sig-\d{2}$/);
    assert.ok(note.startBeat >= 0);
    assert.ok(note.startBeat < YOYODYNE_LIMITS.loopBeats);
    assert.ok(note.durationBeats >= YOYODYNE_LIMITS.minimumDurationBeats);
    assert.ok(note.startBeat + note.durationBeats <= YOYODYNE_LIMITS.loopBeats);
    assert.ok(note.pitch >= YOYODYNE_LIMITS.minimumPitch);
    assert.ok(note.pitch <= YOYODYNE_LIMITS.maximumPitch);
    assert.ok(note.bendCents.every(Number.isFinite));
    assert.ok(YOYODYNE_VOICE_ROLES.includes(note.voiceRole));
  }
});

test("note edits are immutable and snap only the field being edited", () => {
  const notes = createYoyodynePhrase();
  const original = notes.find((note) => note.id === "sig-01");
  const pitchEdit = updateYoyodyneNote(notes, "sig-01", { pitch: 61.44 }, {
    pitchSnap: "chromatic",
    timeSnap: "eighth",
  });
  const pitched = pitchEdit.find((note) => note.id === "sig-01");

  assert.equal(original.pitch, 48);
  assert.equal(pitched.pitch, 61);
  assert.equal(pitched.durationBeats, original.durationBeats);
  assert.equal(pitched.voiceRole, "throat");
  assert.notStrictEqual(pitchEdit, notes);

  const timeEdit = updateYoyodyneNote(pitchEdit, "sig-01", { startBeat: 2.24 }, {
    pitchSnap: "chromatic",
    timeSnap: "eighth",
  });
  const timed = timeEdit.find((note) => note.id === "sig-01");
  assert.equal(timed.startBeat, 2);
  assert.equal(timed.pitch, 61);
  assert.equal(timed.durationBeats, original.durationBeats);

  const freeEdit = updateYoyodyneNote(timeEdit, "sig-01", {
    pitch: 61.37,
    startBeat: 2.17,
    durationBeats: 0.73,
  }, {
    pitchSnap: "free",
    timeSnap: "free",
  });
  const free = freeEdit.find((note) => note.id === "sig-01");
  assert.equal(free.pitch, 61.37);
  assert.equal(free.startBeat, 2.17);
  assert.equal(free.durationBeats, 0.73);
});

test("hostile note values clamp, deduplicate, sort, and stay finite", () => {
  const hostile = Array.from({ length: 40 }, (_, index) => ({
    id: index < 2 ? "duplicate" : `hostile-${index}`,
    startBeat: index % 2 ? Infinity : -100,
    durationBeats: index % 3 ? Number.NaN : 100,
    pitch: index % 2 ? -Infinity : 99_999,
    bendCents: [Infinity, -Infinity, Number.NaN],
    energy: 99,
  }));
  const notes = sanitizeYoyodyneNotes(hostile);

  assert.ok(notes.length <= YOYODYNE_LIMITS.maximumNotes);
  assert.equal(new Set(notes.map((note) => note.id)).size, notes.length);
  assert.deepEqual(notes, [...notes].sort((left, right) => (
    left.startBeat - right.startBeat || left.pitch - right.pitch || left.id.localeCompare(right.id)
  )));
  for (const note of notes) {
    assert.ok([
      note.startBeat,
      note.durationBeats,
      note.pitch,
      note.energy,
      ...note.bendCents,
    ].every(Number.isFinite));
    assert.ok(note.startBeat + note.durationBeats <= YOYODYNE_LIMITS.loopBeats);
    assert.ok(YOYODYNE_VOICE_ROLES.includes(note.voiceRole));
  }
});

test("pitch names, frequency, lookup, and recall remain semantic", () => {
  assert.equal(formatYoyodynePitch(60), "C4");
  assert.equal(formatYoyodynePitch(60.25), "C4 +25¢");
  assert.ok(Math.abs(midiToFrequency(69) - 440) < 1e-9);
  assert.ok(Math.abs(midiToFrequency(81) - 880) < 1e-9);
  assert.equal(yoyodyneBeatWithinLoop(16.5), 0.5);

  const notes = createYoyodynePhrase();
  assert.equal(yoyodyneNoteAtBeat(notes, 0.2)?.id, "sig-01");
  assert.equal(yoyodyneNoteAtBeat(notes, 3.75), null);
  const edited = updateYoyodyneNote(notes, "sig-01", {
    pitch: 74,
    startBeat: 2,
    durationBeats: 1,
    bendCents: [40, -30, 20],
    energy: 0.2,
    voiceRole: "halo",
  });
  const restored = restoreYoyodyneNote(edited, "sig-01", notes);
  assert.deepEqual(
    restored.find((note) => note.id === "sig-01"),
    notes.find((note) => note.id === "sig-01"),
  );
  assert.deepEqual(restoreYoyodyneNote(restored, "sig-01", notes), restored);
});

test("the opening relay choir is intentionally and repeatedly polyphonic", () => {
  const notes = createYoyodynePhrase();
  for (const beat of [0.1, 4.1, 8.1, 12.1]) {
    const active = yoyodyneNotesAtBeat(notes, beat);
    assert.deepEqual(active.map(({ voiceRole }) => voiceRole), ["throat", "mouth", "halo"]);
    assert.equal(active.length, 3);
  }
  assert.equal(yoyodyneMaximumPolyphony(notes), 3);
  assert.equal(yoyodyneNoteAtBeat(notes, 0.1)?.id, "sig-01");

  const sampledBeats = Array.from({ length: 64 }, (_, index) => index / 4);
  const polyphonicCoverage = sampledBeats.filter((beat) => (
    yoyodyneNotesAtBeat(notes, beat).length >= 2
  )).length / sampledBeats.length;
  assert.ok(polyphonicCoverage >= 0.75);
});

test("AudioContext mapping and occurrence planning use tempo and absolute time", () => {
  const notes = createYoyodynePhrase();
  assert.equal(yoyodyneScoreBeatAtAudioTime({
    scoreAnchorBeat: 4,
    audioAnchorTime: 10,
    audioTime: 11.5,
    tempo: 120,
  }), 7);

  const first = yoyodyneOccurrenceAtOrdinal({
    notes,
    ordinal: 0,
    tempo: 120,
    scoreAnchorBeat: 0,
    audioAnchorTime: 10,
  });
  assert.equal(first.note.id, "sig-01");
  assert.equal(first.startAt, 10);
  assert.ok(Math.abs(first.durationSeconds - 1.75) < 1e-9);

  const nextCycle = yoyodyneOccurrenceAtOrdinal({
    notes,
    ordinal: notes.length,
    tempo: 120,
    scoreAnchorBeat: 0,
    audioAnchorTime: 10,
  });
  assert.equal(nextCycle.note.id, "sig-01");
  assert.equal(nextCycle.startBeat, 16);
  assert.equal(nextCycle.startAt, 18);
});

test("lookahead planner skips stale attacks instead of replaying a burst", () => {
  const notes = createYoyodynePhrase();
  const plan = planYoyodyneAudioWindow({
    notes,
    nextEventOrdinal: 0,
    tempo: 60,
    scoreAnchorBeat: 0,
    audioAnchorTime: 0,
    nowAudioTime: 5.5,
    lookaheadSeconds: 1,
    minimumLeadSeconds: 0,
  });

  assert.ok(plan.skippedCount >= 7);
  assert.equal(plan.entries[0].note.id, "sig-08");
  assert.equal(plan.entries[0].startAt, 6.25);
  assert.ok(plan.entries.every((entry) => entry.startAt >= 5.5 && entry.startAt <= 6.5));

  const invalid = planYoyodyneAudioWindow({
    notes: [],
    nextEventOrdinal: -99,
    nowAudioTime: Number.NaN,
  });
  assert.deepEqual(invalid.entries, []);
  assert.equal(invalid.nextEventOrdinal, 0);
});

test("derived relay voices preserve pitch, separate roles, and remain bounded", () => {
  const note = createYoyodynePhrase()[0];
  const clear = deriveYoyodyneTrigger(note, { tempo: 96, character: 0 });
  const charged = deriveYoyodyneTrigger(note, { tempo: 96, character: 1 });
  const octave = deriveYoyodyneTrigger({ ...note, pitch: note.pitch + 12, durationBeats: 99 });
  const preview = deriveYoyodyneTrigger(note, { preview: true });

  assert.ok(Math.abs(octave.voice.frequency / clear.voice.frequency - 2) < 1e-9);
  assert.equal(clear.voice.voiceRole, "throat");
  assert.equal(clear.voice.waveform, "sawtooth");
  assert.equal(clear.voice.resonancePeaks.length, 2);
  assert.ok(Object.isFrozen(YOYODYNE_RELAY_VOICES.throat.peaks));
  assert.ok(charged.voice.modulationIndex > clear.voice.modulationIndex);
  assert.ok(charged.voice.brightness > clear.voice.brightness);
  assert.ok(charged.voice.resonancePeaks[0].frequency > clear.voice.resonancePeaks[0].frequency);
  assert.ok(charged.voice.resonancePeaks[0].q > clear.voice.resonancePeaks[0].q);
  assert.ok(charged.voice.dryMix < clear.voice.dryMix);
  assert.ok(charged.voice.modulationIndex <= YOYODYNE_AUDIO_LIMITS.maximumModulationIndex);
  assert.ok(octave.voice.durationSeconds <= YOYODYNE_AUDIO_LIMITS.maximumDurationSeconds);
  assert.equal(preview.voice.durationSeconds, YOYODYNE_AUDIO_LIMITS.previewDurationSeconds);
  for (const trigger of [clear, charged, octave, preview]) {
    assert.ok(Object.values(trigger.envelope).every(Number.isFinite));
    assert.ok(trigger.voice.frequencyEnvelope.every(({ time, value }) => (
      Number.isFinite(time) && Number.isFinite(value) && value > 0
    )));
    assert.ok(trigger.voice.resonancePeaks.every(({ frequency, q, weight }) => (
      [frequency, q, weight].every(Number.isFinite)
    )));
  }

  const samePitchRoles = YOYODYNE_VOICE_ROLES.map((voiceRole) => (
    deriveYoyodyneTrigger({ ...note, pitch: 60, voiceRole }, { character: 0.42 }).voice
  ));
  assert.deepEqual(samePitchRoles.map(({ voiceRole }) => voiceRole), YOYODYNE_VOICE_ROLES);
  assert.equal(new Set(samePitchRoles.map(({ resonancePeaks }) => (
    resonancePeaks.map(({ frequency }) => Math.round(frequency)).join(":")
  ))).size, YOYODYNE_VOICE_ROLES.length);
  assert.ok(samePitchRoles.every(({ resonancePeaks }) => resonancePeaks.length === 2));
});

test("score-level headroom leaves ordinary phrases intact and bounds stacked edits", () => {
  const ordinary = createYoyodynePhrase();
  assert.equal(yoyodyneScoreGainScale(ordinary), 1);

  const stacked = Array.from({ length: YOYODYNE_LIMITS.maximumNotes }, (_, index) => ({
    ...ordinary[index % ordinary.length],
    id: `stack-${String(index + 1).padStart(2, "0")}`,
    startBeat: 0,
    durationBeats: 4,
    pitch: 84,
  }));
  const gainScale = yoyodyneScoreGainScale(stacked);
  const gainSum = stacked.reduce((sum, note) => (
    sum + deriveYoyodyneTrigger(note, { gainScale }).voice.gain
  ), 0);
  assert.equal(yoyodyneMaximumPolyphony(stacked), YOYODYNE_LIMITS.maximumNotes);
  assert.ok(gainScale > 0 && gainScale < 1);
  assert.ok(gainSum <= YOYODYNE_AUDIO_LIMITS.maximumScoreGainSum + 1e-12);
});

test("page exposes the authored Audio, transport, reset, Canvas, and truth boundary", async () => {
  const [html, app, css] = await Promise.all([
    source("yoyodyne.html"),
    source("yoyodyne-app.js"),
    source("yoyodyne.css"),
  ]);

  assert.match(html, /data-tool-id="yoyodyne"/);
  assert.match(html, /id="audioButton"[\s\S]*aria-pressed="false"/);
  assert.match(html, /id="playButton"[\s\S]*data-primary-transport/);
  assert.match(html, /id="resetAll"[\s\S]*data-reset-all/);
  assert.match(html, /id="noteStage"[\s\S]*tabindex="0"[\s\S]*role="application"/);
  assert.match(html, /does not analyze, separate, retune, or time-stretch recorded audio/i);
  assert.match(html, /generated polyphonic Web Audio relay choir/i);
  assert.match(html, /throat, mouth, and halo/i);
  assert.match(html, /aria-keyshortcuts="[^"]*PageUp[^"]*PageDown[^"]*"/);
  assert.match(html, /1\/8 note \(½ beat\)/);
  assert.match(html, /Page Up\/Down cycles every cell/);
  assert.match(html, /<option value="yoyodyne\.html" selected>/);
  assert.doesNotMatch(html, /wax-host-bootstrap|wax-universal-adapter/i);
  assert.match(app, /new YoyodyneAudio\(globalThis\)/);
  assert.match(app, /emitMidiOutputPreview/);
  assert.match(app, /yoyodyneScoreGainScale/);
  assert.match(app, /planYoyodyneAudioWindow/);
  assert.match(app, /pointercancel/);
  assert.match(app, /dataset\.activeIds/);
  assert.match(app, /dataset\.activeRoles/);
  assert.match(app, /dataset\.maxPolyphony/);
  assert.match(app, /dataset\.characterVisual/);
  assert.match(app, /getOutputTimestamp/);
  assert.match(app, /document\.hidden/);
  assert.match(app, /pagehide/);
  assert.match(app, /Audio is off — turn it on to hear playback/);
  assert.match(css, /#noteStage:focus-visible/);
  assert.match(css, /@media \(pointer: coarse\)/);
  assert.match(css, /overscroll-behavior: contain/);
  assert.match(css, /touch-action: none/);
});

test("catalogue icon is an authored WebP asset", async () => {
  const icon = await readFile(new URL("assets/instruments/yoyodyne.webp", root));
  assert.ok(icon.length > 1_000);
  assert.equal(icon.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(icon.subarray(8, 12).toString("ascii"), "WEBP");
});

test("catalogue, MIDI requirement, and release builder include Yoyodyne", async () => {
  const [nav, catalogue, midi, build] = await Promise.all([
    source("nav.js"),
    source("src/instrument-catalog.js"),
    source("src/instrument-midi-capabilities.js"),
    source("scripts/build-site.sh"),
  ]);

  assert.match(nav, /id: "yoyodyne", label: "Yoyodyne", href: "yoyodyne\.html"/);
  assert.match(catalogue, /yoyodyne: define\([\s\S]*?"Polyphonic pitch\/time synth"/);
  assert.match(midi, /sequence:[\s\S]*?"yoyodyne"/);
  assert.match(midi, /NO_GENERIC_NOTE_KEYBOARD_IDS[\s\S]*?"yoyodyne"/);
  for (const path of [
    "yoyodyne.html",
    "yoyodyne.css",
    "yoyodyne-app.js",
    "src/yoyodyne.js",
    "src/yoyodyne-audio.js",
    "assets/instruments/yoyodyne.webp",
  ]) {
    assert.match(build, new RegExp(path.replaceAll("/", "\\/")));
  }
});
