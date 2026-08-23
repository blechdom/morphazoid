import assert from "node:assert/strict";
import test from "node:test";

import { fallbackSpellingPronunciation } from "../src/spelling-pronunciation.js";
import {
  DEFAULT_PINK_TROMBONAZOID_PRESET,
  DEFAULT_PINK_TROMBONAZOID_VOICE_PRESET,
  PINK_TROMBONAZOID_LANES,
  PINK_TROMBONAZOID_PHONE_CATALOG,
  PINK_TROMBONAZOID_PRESETS,
  PINK_TROMBONAZOID_VOICE_HARMONIES,
  PINK_TROMBONAZOID_VOICE_PRESETS,
  addPinkTrombonazoidKeyframe,
  applyPinkTrombonazoidModulation,
  compilePinkTrombonazoid,
  insertPinkTrombonazoidPhone,
  movePinkTrombonazoidPhone,
  normalizePinkTrombonazoidVoice,
  pinkTrombonazoidAudioEvent,
  pinkTrombonazoidSequenceDuration,
  pinkTrombonazoidVoicePerformance,
  removePinkTrombonazoidKeyframe,
  removePinkTrombonazoidPhone,
  replacePinkTrombonazoidPhone,
  retimePinkTrombonazoidSequence,
  samplePinkTrombonazoidAutomation,
  samplePinkTrombonazoidLfo,
  updatePinkTrombonazoidKeyframe,
  updatePinkTrombonazoidSegment,
} from "../src/pink-trombonazoid.js";

const closeTo = (actual, expected, epsilon = 1e-9) => {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `${actual} should be within ${epsilon} of ${expected}`,
  );
};

function laneKeys(sequence, segmentId, laneId) {
  return sequence.articulationSegments
    .find(({ id }) => id === segmentId)
    ?.laneKeyframes?.[laneId] ?? [];
}

test("Pink Trombonazoid exposes four playable, immutable text presets", () => {
  assert.equal(DEFAULT_PINK_TROMBONAZOID_PRESET, "hello");
  assert.deepEqual(Object.keys(PINK_TROMBONAZOID_PRESETS), [
    "hello",
    "pink-trombone",
    "morphazoid",
    "sequencer",
  ]);
  assert.deepEqual(
    Object.values(PINK_TROMBONAZOID_PRESETS).map(({ text }) => text),
    ["hello", "pink trombone", "morphazoid", "sequencer"],
  );
  for (const preset of Object.values(PINK_TROMBONAZOID_PRESETS)) {
    assert.equal(Object.isFrozen(preset), true);
    assert.ok(preset.speechRate > 0);
  }

  const defaultSequence = compilePinkTrombonazoid();
  const pinkTrombone = compilePinkTrombonazoid({ preset: "pink-trombone" });
  assert.equal(defaultSequence.text, "hello");
  assert.equal(pinkTrombone.text, "pink trombone");
  assert.equal(pinkTrombone.words.length, 2);
});

test("the pronunciation picker catalog exposes all 39 immutable CMU phones", () => {
  assert.equal(PINK_TROMBONAZOID_PHONE_CATALOG.length, 39);
  assert.equal(new Set(PINK_TROMBONAZOID_PHONE_CATALOG.map(({ id }) => id)).size, 39);
  assert.equal(PINK_TROMBONAZOID_PHONE_CATALOG.filter(({ vowel }) => vowel).length, 15);
  assert.deepEqual(
    PINK_TROMBONAZOID_PHONE_CATALOG.filter(({ gliding }) => gliding).map(({ id }) => id),
    ["AW", "AY", "ER", "EY", "OW", "OY"],
  );
  for (const phone of PINK_TROMBONAZOID_PHONE_CATALOG) {
    assert.equal(Object.isFrozen(phone), true);
    assert.equal(Object.isFrozen(phone.gestures), true);
    assert.match(phone.label, new RegExp(`^${phone.id} · /`));
  }
  for (const phone of PINK_TROMBONAZOID_PHONE_CATALOG.filter(({ vowel, gliding }) => (
    vowel && !gliding
  ))) {
    const sequence = compilePinkTrombonazoid([{
      type: "word",
      source: phone.id.toLowerCase(),
      start: 0,
      end: phone.id.length,
      phones: [{ id: phone.id, stress: 1 }],
    }]);
    assert.equal(sequence.phoneSegments.length, 1, `${phone.id} must remain one phone`);
    assert.equal(sequence.articulationSegments.length, 1, `${phone.id} must trigger one gesture`);
  }
});

test("Pink Trombonazoid exposes bounded immutable solo, register, texture, and ensemble voices", () => {
  assert.equal(DEFAULT_PINK_TROMBONAZOID_VOICE_PRESET, "clear");
  assert.equal(Object.keys(PINK_TROMBONAZOID_VOICE_PRESETS).length, 18);
  assert.deepEqual(
    [...new Set(Object.values(PINK_TROMBONAZOID_VOICE_PRESETS).map(({ group }) => group))],
    ["core", "register", "texture", "ensemble"],
  );
  assert.deepEqual(Object.keys(PINK_TROMBONAZOID_VOICE_HARMONIES), [
    "shared",
    "unison",
    "fifths",
    "choir",
  ]);
  for (const preset of Object.values(PINK_TROMBONAZOID_VOICE_PRESETS)) {
    assert.equal(Object.isFrozen(preset), true);
    assert.equal(Object.isFrozen(preset.voice), true);
    assert.ok(preset.voice.throatCount >= 1 && preset.voice.throatCount <= 7);
  }

  const bounded = normalizePinkTrombonazoidVoice({
    preset: "choir",
    throatCount: 99,
    harmony: "unknown",
    registerSemitones: -90,
    detuneCents: 500,
    bodyLengthOffset: 2,
    tensionOffset: -2,
    coupling: 5,
    spread: -4,
  });
  assert.deepEqual(bounded, {
    preset: "choir",
    throatCount: 7,
    harmony: "shared",
    registerSemitones: -12,
    detuneCents: 30,
    bodyLengthOffset: 0.22,
    tensionOffset: -0.25,
    mouthVariation: 0.32,
    coupling: 0.72,
    spread: 0,
  });
  assert.equal(Object.isFrozen(bounded), true);
});

test("a supplied CMU-style HELLO pronunciation compiles to word, phone, and articulation segments", () => {
  const pronunciations = new Map([
    ["hello", ["HH", "EH", "L", "OW"]],
  ]);
  const sequence = compilePinkTrombonazoid("HELLO", {
    pronunciations,
    sampleCount: 17,
    personality: "clear",
  });

  assert.deepEqual(sequence.phoneSegments.map(({ phone }) => phone), ["HH", "EH", "L", "OW"]);
  assert.deepEqual(
    sequence.articulationSegments.map(({ articulation }) => articulation),
    ["h", "e", "l", "ao", "uw"],
    "the OW phone retains its two spelling-synthesizer tract gestures",
  );
  assert.deepEqual(
    sequence.wordSegments[0].phones.map(({ label }) => label),
    ["HH", "EH", "L", "OW"],
  );
  assert.equal(sequence.wordSegments[0].source, "HELLO");
  assert.equal(sequence.wordSegments[0].type, "word");
  assert.equal(sequence.phoneSegments[0].type, "phone");
  assert.equal(sequence.articulationSegments[0].type, "articulation");

  const h = sequence.articulationSegments[0];
  const l = sequence.articulationSegments.find(({ phone }) => phone === "L");
  const finalGlide = sequence.articulationSegments.at(-1);
  const owArticulations = sequence.phoneSegments.at(-1).articulations;
  assert.equal(h.phoneLabel, "HH");
  assert.equal(h.articulationLabel, "H");
  assert.equal(h.activeCarrierVowel, "e", "initial H borrows the next vowel's tract color");
  assert.equal(l.activeCarrierVowel, "ao", "L anticipates the opening carrier of OW");
  assert.equal(finalGlide.carrierVowel, "uw");
  assert.ok(owArticulations[0].sampleKey, "the first OW gesture owns its fallback sample");
  assert.equal(owArticulations[1].sampleKey, "", "the joined fallback sample is not retriggered");
  closeTo(
    owArticulations.reduce((total, segment) => total + segment.durationMs, 0),
    sequence.phoneSegments.at(-1).durationMs,
  );
  assert.deepEqual(h.word.phones.map(({ id }) => id), ["HH", "EH", "L", "OW"]);
  const lEvent = pinkTrombonazoidAudioEvent(l);
  assert.deepEqual(
    lEvent.carrierPerformance.tongues[0],
    l.carrierPerformance.tongues[0],
    "audio conversion preserves the carrier release target",
  );

  for (const segment of sequence.articulationSegments) {
    assert.ok(segment.performance);
    assert.ok(segment.carrierPerformance);
    assert.ok(segment.dynamics);
    assert.equal(segment.wordSpeech, true);
    assert.equal(segment.sustain, false);
    assert.equal(typeof segment.personality, "string");
    assert.equal(typeof segment.carrierVowel, "string");
    closeTo(segment.start, segment.startMs / 1_000);
    closeTo(segment.end, segment.endMs / 1_000);
    closeTo(segment.duration, segment.durationMs / 1_000);
  }
});

test("fallback spelling pronunciation still produces a deterministic playable speech timeline", () => {
  const expected = fallbackSpellingPronunciation("blorfquazzle");
  const first = compilePinkTrombonazoid("blorfquazzle", { sampleCount: 23 });
  const repeat = compilePinkTrombonazoid("blorfquazzle", { sampleCount: 23 });

  assert.deepEqual(first.phoneSegments.map(({ phone }) => phone), expected);
  assert.ok(first.articulationSegments.length >= expected.length);
  assert.equal(first.durationMs, repeat.durationMs);
  assert.deepEqual(first.automation.pitch.samples, repeat.automation.pitch.samples);
  assert.equal(pinkTrombonazoidSequenceDuration(first), first.durationMs);
  assert.equal(
    pinkTrombonazoidSequenceDuration(first.segments),
    first.durationMs,
  );
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.segments), true);
  assert.equal(Object.isFrozen(first.articulationSegments[0].performance), true);
});

test("speech timing distinguishes compact stops, unstressed vowels, and stressed vowels", () => {
  const sequence = compilePinkTrombonazoid("potato", {
    pronunciations: new Map([
      ["potato", ["P", "AH", "T", "EY", "T", "OW"]],
    ]),
  });
  const phones = sequence.phoneSegments;
  assert.deepEqual(phones.map(({ phone }) => phone), ["P", "AH", "T", "EY", "T", "OW"]);
  assert.deepEqual(phones.map(({ stress }) => stress), [0, 0, 0, 1, 0, 0]);

  const stop = phones.find(({ phone }) => phone === "P");
  const unstressed = phones.find(({ phone }) => phone === "AH");
  const stressed = phones.find(({ phone }) => phone === "EY");
  assert.ok(stop.durationMs < unstressed.durationMs);
  assert.ok(unstressed.durationMs < stressed.durationMs);
  assert.ok(stressed.articulations[0].dynamics.emphasis > unstressed.articulations[0].dynamics.emphasis);
  assert.ok(stressed.articulations[0].performance.exciterPitch > unstressed.articulations[0].performance.exciterPitch);

  for (let index = 1; index < sequence.segments.length; index += 1) {
    closeTo(sequence.segments[index].startMs, sequence.segments[index - 1].endMs);
  }
  closeTo(sequence.durationMs, sequence.segments.at(-1).endMs);
});

test("all automation lanes share bounded, normalized, immutable samples and editable segment keys", () => {
  const sampleCount = 31;
  const sequence = compilePinkTrombonazoid("pink trombone", { sampleCount });
  const expectedLaneIds = [
    "pitch",
    "intensity",
    "breath",
    "tonguePosition",
    "tongueHeight",
    "lipOpening",
    "nasalCoupling",
    "mutation",
  ];
  assert.deepEqual(PINK_TROMBONAZOID_LANES.map(({ id }) => id), expectedLaneIds);
  assert.deepEqual(Object.keys(sequence.automation), expectedLaneIds);
  assert.equal(sequence.sampleTimesMs.length, sampleCount);
  assert.equal(sequence.automationLanes.length, expectedLaneIds.length);

  for (const id of expectedLaneIds) {
    const lane = sequence.automation[id];
    assert.equal(lane.samples.length, sampleCount);
    assert.equal(lane.sampleCount, sampleCount);
    const editableKeyCount = sequence.articulationSegments.reduce(
      (total, segment) => total + laneKeys(sequence, segment.id, id).length,
      0,
    );
    const pausePointCount = sequence.boundarySegments
      .filter(({ durationMs }) => durationMs > 0)
      .length;
    assert.equal(lane.points.length, editableKeyCount + pausePointCount);
    assert.equal(Object.isFrozen(lane.samples), true);
    for (const value of lane.samples) {
      assert.equal(Number.isFinite(value), true);
      assert.ok(value >= 0 && value <= 1, `${id} samples must be normalized`);
    }
    for (const segment of sequence.articulationSegments) {
      assert.ok(segment.laneValues[id] >= 0 && segment.laneValues[id] <= 1);
      for (const keyframe of laneKeys(sequence, segment.id, id)) {
        assert.ok(
          lane.points.some((point) => (
            point.segmentId === segment.id
              && point.keyframeId === keyframe.id
              && point.localPhase === keyframe.phase
              && point.value === keyframe.value
          )),
          `${id} automation must expose authored key ${keyframe.id}`,
        );
      }
    }
    const mid = samplePinkTrombonazoidAutomation(sequence, id, 0.5);
    assert.ok(mid >= 0 && mid <= 1);
  }
});

test("articulation lanes expose frozen stable keys that can be added, moved in time, and removed", () => {
  const source = compilePinkTrombonazoid("a", {
    pronunciations: new Map([["a", ["AH"]]]),
    sampleCount: 101,
  });
  const segment = source.articulationSegments[0];
  const sourceSnapshot = JSON.stringify(source);
  const timingSnapshot = source.segments.map(({ startMs, endMs, durationMs }) => ({
    startMs,
    endMs,
    durationMs,
  }));

  assert.equal(Object.isFrozen(segment.laneKeyframes), true);
  for (const { id } of PINK_TROMBONAZOID_LANES) {
    const keys = laneKeys(source, segment.id, id);
    assert.equal(keys.length, 1, `${id} starts with one editable key`);
    assert.equal(Object.isFrozen(keys), true);
    assert.equal(Object.isFrozen(keys[0]), true);
    assert.equal(keys[0].phase, 0.5);
    closeTo(keys[0].value, segment.laneValues[id]);
    assert.equal(typeof keys[0].id, "string");
    assert.ok(keys[0].id.length > 0);
  }

  const defaultKeyId = laneKeys(source, segment.id, "pitch")[0].id;
  const withEarly = addPinkTrombonazoidKeyframe(
    source,
    segment.id,
    "pitch",
    { phase: 0.2, value: 0.15 },
  );
  const earlyKey = laneKeys(withEarly, segment.id, "pitch")
    .find(({ id }) => id !== defaultKeyId);
  assert.ok(earlyKey, "adding a key creates a stable identity");

  const withBoth = addPinkTrombonazoidKeyframe(
    withEarly,
    segment.id,
    "pitch",
    { phase: 0.8, value: 0.85 },
  );
  const addedKeys = laneKeys(withBoth, segment.id, "pitch");
  const lateKey = addedKeys.find(({ id }) => (
    id !== defaultKeyId && id !== earlyKey.id
  ));
  assert.ok(lateKey);
  assert.equal(addedKeys.length, 3);
  assert.equal(new Set(addedKeys.map(({ id }) => id)).size, addedKeys.length);

  const movedInTime = updatePinkTrombonazoidKeyframe(
    withBoth,
    segment.id,
    "pitch",
    earlyKey.id,
    { phase: 0.35 },
  );
  let movedKey = laneKeys(movedInTime, segment.id, "pitch")
    .find(({ id }) => id === earlyKey.id);
  closeTo(movedKey.phase, 0.35);
  closeTo(movedKey.value, 0.15, 1e-12);

  const movedInValue = updatePinkTrombonazoidKeyframe(
    movedInTime,
    segment.id,
    "pitch",
    earlyKey.id,
    { value: 0.27 },
  );
  movedKey = laneKeys(movedInValue, segment.id, "pitch")
    .find(({ id }) => id === earlyKey.id);
  closeTo(movedKey.phase, 0.35);
  closeTo(movedKey.value, 0.27);

  const movedByAbsoluteTime = updatePinkTrombonazoidKeyframe(
    movedInValue,
    segment.id,
    "pitch",
    earlyKey.id,
    { timeMs: segment.startMs + segment.durationMs * 0.4 },
  );
  movedKey = laneKeys(movedByAbsoluteTime, segment.id, "pitch")
    .find(({ id }) => id === earlyKey.id);
  closeTo(movedKey.phase, 0.4);
  closeTo(movedKey.value, 0.27);

  const clamped = updatePinkTrombonazoidKeyframe(
    movedByAbsoluteTime,
    segment.id,
    "pitch",
    earlyKey.id,
    { phase: 99, value: -99 },
  );
  const clampedKeys = laneKeys(clamped, segment.id, "pitch");
  movedKey = clampedKeys.find(({ id }) => id === earlyKey.id);
  assert.equal(movedKey.value, 0);
  assert.equal(clampedKeys.every(({ phase, value }) => (
    Number.isFinite(phase) && phase >= 0 && phase <= 1
      && Number.isFinite(value) && value >= 0 && value <= 1
  )), true);
  for (let index = 1; index < clampedKeys.length; index += 1) {
    assert.ok(
      clampedKeys[index].phase > clampedKeys[index - 1].phase,
      "horizontal edits keep keyframe phases strictly ordered",
    );
  }

  const removed = removePinkTrombonazoidKeyframe(
    clamped,
    segment.id,
    "pitch",
    lateKey.id,
  );
  assert.equal(laneKeys(removed, segment.id, "pitch").length, 2);
  assert.equal(
    laneKeys(removed, segment.id, "pitch").some(({ id }) => id === lateKey.id),
    false,
  );
  assert.deepEqual(
    removed.phoneSegments.map(({ phone }) => phone),
    source.phoneSegments.map(({ phone }) => phone),
    "automation editing cannot alter pronunciation",
  );
  assert.deepEqual(
    removed.segments.map(({ startMs, endMs, durationMs }) => ({ startMs, endMs, durationMs })),
    timingSnapshot,
    "automation editing cannot retime phonemes",
  );
  assert.equal(JSON.stringify(source), sourceSnapshot, "all mutations leave the source immutable");
  assert.equal(
    addPinkTrombonazoidKeyframe(source, "missing", "pitch", { phase: 0.4 }),
    source,
  );
  assert.equal(
    updatePinkTrombonazoidKeyframe(source, segment.id, "missing", defaultKeyId, {}),
    source,
  );
  assert.equal(
    removePinkTrombonazoidKeyframe(source, segment.id, "pitch", "missing"),
    source,
  );
});

test("multiple keyframes interpolate at authored times and feed the physical-tract audio event", () => {
  const source = compilePinkTrombonazoid("a", {
    pronunciations: new Map([["a", ["AH"]]]),
    sampleCount: 17,
  });
  const segment = source.articulationSegments[0];
  const defaultKey = laneKeys(source, segment.id, "pitch")[0];
  let edited = updatePinkTrombonazoidKeyframe(
    source,
    segment.id,
    "pitch",
    defaultKey.id,
    { phase: 0.5, value: 0.5 },
  );
  edited = addPinkTrombonazoidKeyframe(
    edited,
    segment.id,
    "pitch",
    { phase: 0.25, value: 0.2 },
  );
  edited = addPinkTrombonazoidKeyframe(
    edited,
    segment.id,
    "pitch",
    { phase: 0.75, value: 0.8 },
  );

  closeTo(samplePinkTrombonazoidAutomation(edited, "pitch", 0.25), 0.2);
  closeTo(samplePinkTrombonazoidAutomation(edited, "pitch", 0.5), 0.5);
  closeTo(samplePinkTrombonazoidAutomation(edited, "pitch", 0.75), 0.8);
  const between = samplePinkTrombonazoidAutomation(edited, "pitch", 0.375);
  closeTo(between, 0.35);

  const editedSegment = edited.articulationSegments[0];
  const laneValues = Object.fromEntries(PINK_TROMBONAZOID_LANES.map(({ id }) => [
    id,
    samplePinkTrombonazoidAutomation(edited, id, 0.375),
  ]));
  const event = pinkTrombonazoidAudioEvent(editedSegment, { laneValues });
  closeTo(event.laneValues.pitch, 0.35);
  closeTo(event.performance.exciterPitch, 40 + 0.35 * 480);
  assert.equal(event.wordPhone, "AH");
  assert.equal(Object.isFrozen(event), true);
});

test("untouched automation keeps each phoneme tract exact at articulation onset", () => {
  const sequence = compilePinkTrombonazoid("tap", {
    pronunciations: new Map([["tap", ["T", "AE", "P"]]]),
    sampleCount: 17,
  });
  const onsetSafeLanes = [
    "pitch",
    "breath",
    "tonguePosition",
    "tongueHeight",
    "lipOpening",
    "nasalCoupling",
    "mutation",
  ];

  for (const segment of sequence.articulationSegments) {
    const phase = segment.startMs / sequence.durationMs;
    const laneValues = Object.fromEntries(PINK_TROMBONAZOID_LANES.map(({ id }) => [
      id,
      samplePinkTrombonazoidAutomation(sequence, id, phase),
    ]));
    for (const laneId of onsetSafeLanes) {
      closeTo(
        laneValues[laneId],
        segment.laneValues[laneId],
        1e-9,
      );
    }

    const event = pinkTrombonazoidAudioEvent(segment, { laneValues });
    assert.equal(event.performance.phoneme, segment.performance.phoneme);
    assert.equal(event.performance.articulationManner, segment.performance.articulationManner);
    assert.equal(event.performance.oralClosure, segment.performance.oralClosure);
    assert.equal(event.performance.glottalClosure, segment.performance.glottalClosure);
    assert.deepEqual(event.performance.tongues, segment.performance.tongues);
    closeTo(event.performance.lipDiameter, segment.performance.lipDiameter);
    closeTo(event.performance.nasalCoupling, segment.performance.nasalCoupling);
  }
});

test("authored keyframes survive segment edits and whole-sequence retiming", () => {
  const source = compilePinkTrombonazoid("tap", {
    pronunciations: new Map([["tap", ["T", "AE", "P"]]]),
    sampleCount: 41,
  });
  const vowel = source.articulationSegments.find(({ phone }) => phone === "AE");
  let authored = addPinkTrombonazoidKeyframe(
    source,
    vowel.id,
    "pitch",
    { phase: 0.22, value: 0.28 },
  );
  authored = addPinkTrombonazoidKeyframe(
    authored,
    vowel.id,
    "pitch",
    { phase: 0.78, value: 0.74 },
  );
  const authoredKeys = laneKeys(authored, vowel.id, "pitch");
  const authoredSnapshot = JSON.stringify(authored);

  const segmentEdited = updatePinkTrombonazoidSegment(authored, vowel.id, {
    durationMs: vowel.durationMs + 80,
    lanes: { intensity: 0.64 },
  });
  assert.deepEqual(laneKeys(segmentEdited, vowel.id, "pitch"), authoredKeys);
  assert.deepEqual(
    segmentEdited.phoneSegments.map(({ phone }) => phone),
    source.phoneSegments.map(({ phone }) => phone),
  );

  const retimed = retimePinkTrombonazoidSequence(segmentEdited, { scale: 1.5 });
  assert.deepEqual(laneKeys(retimed, vowel.id, "pitch"), authoredKeys);
  assert.equal(new Set(laneKeys(retimed, vowel.id, "pitch").map(({ id }) => id)).size, 3);
  assert.equal(JSON.stringify(authored), authoredSnapshot);
});

test("segment edits recompute lane-backed performance, dynamics, and all following times immutably", () => {
  const source = compilePinkTrombonazoid("tap", {
    pronunciations: new Map([["tap", ["T", "AE", "P"]]]),
    sampleCount: 19,
  });
  const target = source.articulationSegments[1];
  const followingBefore = source.segments[target.sequenceIndex + 1].startMs;
  const edited = updatePinkTrombonazoidSegment(source, target.id, {
    durationMs: target.durationMs + 75,
    lanes: {
      pitch: 0.9,
      intensity: 0.72,
      breath: 0.31,
      tonguePosition: 0.22,
      tongueHeight: 0.81,
      lipOpening: 0.44,
      nasalCoupling: 0.27,
      mutation: 0.63,
    },
  });
  const changed = edited.segments[target.sequenceIndex];

  assert.notEqual(edited, source);
  assert.equal(source.segments[target.sequenceIndex].durationMs, target.durationMs);
  assert.equal(changed.durationMs, target.durationMs + 75);
  assert.equal(changed.dynamics.durationMs, changed.durationMs);
  assert.equal(edited.segments[target.sequenceIndex + 1].startMs, followingBefore + 75);
  assert.deepEqual(changed.laneValues, {
    pitch: 0.9,
    intensity: 0.72,
    breath: 0.31,
    tonguePosition: 0.22,
    tongueHeight: 0.81,
    lipOpening: 0.44,
    nasalCoupling: 0.27,
    mutation: 0.63,
  });
  closeTo(changed.performance.exciterPitch, 40 + 0.9 * 480);
  closeTo(changed.performance.tongues[0].position, 0.22);
  closeTo(changed.performance.tongues[0].height, 0.81);
  closeTo(changed.performance.lipDiameter, 0.44 * 4);
  closeTo(changed.performance.nasalCoupling, 0.27);
  closeTo(changed.performance.mutation, 0.63);
  assert.equal(Object.isFrozen(changed.laneOverrides), true);

  const event = pinkTrombonazoidAudioEvent(changed);
  assert.equal(event.articulation, changed.articulation);
  assert.equal(event.wordPhone, changed.phone);
  assert.equal(event.wordSpeech, true);
  assert.equal(event.performance.exciterPitch, changed.performance.exciterPitch);
  assert.equal(event.dynamics.durationMs, changed.durationMs);
  assert.equal(Object.isFrozen(event), true);
});

test("consonant tract edits do not overwrite their anticipated vowel release anatomy", () => {
  const source = compilePinkTrombonazoid("tap", {
    pronunciations: new Map([["tap", ["T", "AE", "P"]]]),
  });
  const consonant = source.articulationSegments[0];
  const edited = updatePinkTrombonazoidSegment(source, consonant.id, {
    lanes: {
      pitch: 0.82,
      tonguePosition: 0.03,
      tongueHeight: 0.97,
      lipOpening: 0.04,
      nasalCoupling: 0.88,
    },
  }).articulationSegments[0];

  closeTo(edited.performance.tongues[0].position, 0.03);
  closeTo(edited.performance.tongues[0].height, 0.97);
  closeTo(edited.performance.lipDiameter, 0.04 * 4);
  closeTo(edited.performance.nasalCoupling, 0.88);
  closeTo(
    edited.carrierPerformance.tongues[0].position,
    consonant.carrierPerformance.tongues[0].position,
  );
  closeTo(
    edited.carrierPerformance.tongues[0].height,
    consonant.carrierPerformance.tongues[0].height,
  );
  closeTo(edited.carrierPerformance.lipDiameter, consonant.carrierPerformance.lipDiameter);
  closeTo(
    edited.carrierPerformance.nasalCoupling,
    consonant.carrierPerformance.nasalCoupling,
  );
  closeTo(edited.carrierPerformance.exciterPitch, 40 + 0.82 * 480);
});

test("voice shaping changes source and resonators without changing the authored pronunciation", () => {
  const sequence = compilePinkTrombonazoid("tap", {
    pronunciations: new Map([["tap", ["T", "AE", "P"]]]),
  });
  const segment = sequence.articulationSegments[0];
  const sourcePerformance = segment.performance;
  const plain = pinkTrombonazoidAudioEvent(segment);
  const voice = {
    preset: "choir",
    throatCount: 5,
    harmony: "choir",
    registerSemitones: -3,
    detuneCents: 14,
    bodyLengthOffset: 0.08,
    tensionOffset: -0.06,
    mouthVariation: 0.46,
    coupling: 0.52,
    spread: 0.94,
  };
  const shaped = pinkTrombonazoidAudioEvent(segment, { voice });
  const pronunciationFields = [
    "phoneme",
    "articulationManner",
    "articulationPlace",
    "articulationAperture",
    "articulationVoicing",
    "oralClosure",
    "glottalClosure",
    "lipDiameter",
    "nasalCoupling",
    "mutation",
    "tongueCount",
    "noseCount",
  ];

  for (const target of ["performance", "carrierPerformance"]) {
    for (const field of pronunciationFields) {
      assert.deepEqual(shaped[target][field], plain[target][field], `${target}.${field}`);
    }
    assert.deepEqual(shaped[target].tongues, plain[target].tongues);
    assert.deepEqual(shaped[target].noses, plain[target].noses);
    assert.deepEqual(shaped[target].pressureSources, plain[target].pressureSources);
    assert.equal(shaped[target].throatCount, 5);
    assert.equal(shaped[target].voiceMode, "polyphonic");
    assert.deepEqual(shaped[target].voiceIntervals, [-12, -5, 0, 7, 12, 19, 24]);
    assert.equal(shaped[target].coupling, 0.52);
    assert.equal(shaped[target].spread, 0.94);
    assert.notEqual(shaped[target].exciterPitch, plain[target].exciterPitch);
    assert.equal(Object.isFrozen(shaped[target]), true);
    assert.equal(Object.isFrozen(shaped[target].throats), true);
  }
  assert.equal(shaped.dynamics.durationMs, plain.dynamics.durationMs);
  assert.equal(shaped.segmentId, plain.segmentId);
  assert.equal(segment.performance, sourcePerformance, "the timeline state is not mutated");
  assert.equal(shaped.voiceSettings.preset, "choir");
  assert.equal(Object.isFrozen(shaped.voiceSettings), true);

  const direct = pinkTrombonazoidVoicePerformance(sourcePerformance, voice);
  assert.equal(direct.phoneme, sourcePerformance.phoneme);
  assert.deepEqual(direct.tongues, sourcePerformance.tongues);
});

test("replacing a vowel with a diphthong updates the whole phone while preserving timing and expression", () => {
  const source = compilePinkTrombonazoid("tap", {
    pronunciations: new Map([["tap", ["T", "AE", "P"]]]),
    sampleCount: 19,
  });
  const ae = source.phoneSegments[1];
  const authored = updatePinkTrombonazoidSegment(source, ae.articulations[0].id, {
    durationMs: ae.durationMs + 42,
    lanes: {
      pitch: 0.83,
      intensity: 0.71,
      breath: 0.24,
      mutation: 0.36,
      tonguePosition: 0.02,
      tongueHeight: 0.98,
      lipOpening: 0.06,
      nasalCoupling: 0.9,
    },
  });
  const authoredPhone = authored.phoneSegments[1];
  const followingStart = authored.phoneSegments[2].startMs;
  const changed = replacePinkTrombonazoidPhone(
    authored,
    authoredPhone.articulations[0].id,
    "OY",
  );
  const oy = changed.phoneSegments[1];

  assert.notEqual(changed, authored);
  assert.deepEqual(changed.phoneSegments.map(({ phone }) => phone), ["T", "OY", "P"]);
  assert.deepEqual(oy.articulations.map(({ articulation }) => articulation), ["ao", "iy"]);
  closeTo(oy.durationMs, authoredPhone.durationMs);
  closeTo(changed.phoneSegments[2].startMs, followingStart);
  closeTo(changed.durationMs, authored.durationMs);
  assert.equal(oy.id, authoredPhone.id, "the stable phone identity survives replacement");
  assert.ok(oy.articulations[0].sampleKey);
  assert.equal(oy.articulations[1].sampleKey, "");
  assert.deepEqual(changed.tokens[0].phones.map(({ id }) => id), ["T", "OY", "P"]);
  assert.deepEqual(changed.words[0].phones.map(({ phone }) => phone), ["T", "OY", "P"]);
  assert.deepEqual(changed.articulationSegments[0].word.phones.map(({ id }) => id), ["T", "OY", "P"]);
  assert.equal(changed.articulationSegments[0].activeCarrierVowel, "ao");
  for (const articulation of oy.articulations) {
    assert.deepEqual(articulation.laneOverrides, {
      pitch: 0.83,
      intensity: 0.71,
      breath: 0.24,
      mutation: 0.36,
    });
  }
  assert.equal(Object.isFrozen(changed), true);
  assert.equal(Object.isFrozen(changed.tokens), true);
  assert.equal(source.phoneSegments[1].phone, "AE", "the original sequence remains unchanged");
});

test("replacing a diphthong with a steady vowel collapses both linked gestures", () => {
  const source = compilePinkTrombonazoid("go", {
    pronunciations: new Map([["go", ["G", "OW"]]]),
  });
  const ow = source.phoneSegments[1];
  const changed = replacePinkTrombonazoidPhone(
    source,
    ow.articulations[1].id,
    "EH",
  );
  const eh = changed.phoneSegments[1];

  assert.equal(eh.phone, "EH");
  assert.deepEqual(eh.articulations.map(({ articulation }) => articulation), ["e"]);
  closeTo(eh.durationMs, ow.durationMs);
  closeTo(changed.durationMs, source.durationMs);
  assert.equal(changed.tokens[0].phones[1].id, "EH");
  assert.equal(replacePinkTrombonazoidPhone(changed, eh.id, "EH"), changed);
  assert.equal(replacePinkTrombonazoidPhone(changed, "missing-phone", "UW"), changed);
  assert.equal(replacePinkTrombonazoidPhone(changed, eh.id, "NOPE"), changed);
});

test("removing a complete phone closes its timeline gap and preserves later edits", () => {
  const source = compilePinkTrombonazoid("tap", {
    pronunciations: new Map([["tap", ["T", "AE", "P"]]]),
  });
  const authored = updatePinkTrombonazoidSegment(
    source,
    source.phoneSegments[2].articulations[0].id,
    { durationMs: 133, lanes: { pitch: 0.84, intensity: 0.63 } },
  );
  const removed = authored.phoneSegments[1];
  const following = authored.phoneSegments[2];
  const changed = removePinkTrombonazoidPhone(authored, removed.id);

  assert.deepEqual(changed.phoneSegments.map(({ phone }) => phone), ["T", "P"]);
  closeTo(changed.phoneSegments[1].startMs, removed.startMs);
  closeTo(changed.phoneSegments[1].durationMs, following.durationMs);
  closeTo(changed.durationMs, authored.durationMs - removed.durationMs);
  assert.deepEqual(changed.phoneSegments[1].articulations[0].laneOverrides, {
    pitch: 0.84,
    intensity: 0.63,
  });
  assert.deepEqual(changed.tokens[0].phones.map(({ id }) => id), ["T", "P"]);
  assert.equal(Object.isFrozen(changed), true);
  assert.equal(removePinkTrombonazoidPhone(changed, "missing-phone"), changed);
  assert.deepEqual(source.phoneSegments.map(({ phone }) => phone), ["T", "AE", "P"]);

  const single = compilePinkTrombonazoid("a", {
    pronunciations: new Map([["a", ["AH"]]]),
  });
  const empty = removePinkTrombonazoidPhone(single, single.phoneSegments[0].id);
  assert.equal(empty.durationMs, 0);
  assert.equal(empty.segments.length, 0);
  assert.equal(empty.phoneSegments.length, 0);
});

test("inserting a phone opens one timeline slot and preserves every authored neighbor", () => {
  const source = compilePinkTrombonazoid("tap", {
    pronunciations: new Map([["tap", ["T", "AE", "P"]]]),
  });
  const authored = updatePinkTrombonazoidSegment(
    source,
    source.phoneSegments[1].articulations[0].id,
    { durationMs: 247, lanes: { pitch: 0.82, intensity: 0.61 } },
  );
  const inserted = insertPinkTrombonazoidPhone(
    authored,
    authored.phoneSegments[0].id,
    "OY",
  );

  assert.deepEqual(inserted.phoneSegments.map(({ phone }) => phone), ["T", "OY", "AE", "P"]);
  assert.deepEqual(
    inserted.phoneSegments[1].articulations.map(({ articulation }) => articulation),
    ["ao", "iy"],
  );
  closeTo(inserted.phoneSegments[2].durationMs, 247);
  assert.deepEqual(inserted.phoneSegments[2].articulations[0].laneOverrides, {
    pitch: 0.82,
    intensity: 0.61,
  });
  closeTo(inserted.durationMs, authored.durationMs + inserted.phoneSegments[1].durationMs);
  assert.deepEqual(inserted.tokens[0].phones.map(({ id }) => id), ["T", "OY", "AE", "P"]);
  assert.equal(Object.isFrozen(inserted), true);
  assert.equal(insertPinkTrombonazoidPhone(inserted, inserted.phoneSegments[0].id, "NOPE"), inserted);
});

test("an empty pronunciation can recover with plus and reordered phones keep their identity", () => {
  const single = compilePinkTrombonazoid("a", {
    pronunciations: new Map([["a", ["AH"]]]),
  });
  const empty = removePinkTrombonazoidPhone(single, single.phoneSegments[0].id);
  const restored = insertPinkTrombonazoidPhone(empty, null, "EH");
  assert.deepEqual(restored.phoneSegments.map(({ phone }) => phone), ["EH"]);

  const source = compilePinkTrombonazoid("mama", {
    pronunciations: new Map([["mama", ["M", "AE", "M", "AH"]]]),
  });
  const secondM = source.phoneSegments[2];
  const authored = updatePinkTrombonazoidSegment(
    source,
    secondM.articulations[0].id,
    { durationMs: 167, lanes: { mutation: 0.77 } },
  );
  const moved = movePinkTrombonazoidPhone(authored, authored.phoneSegments[2].id, 0);
  assert.deepEqual(moved.phoneSegments.map(({ phone }) => phone), ["M", "M", "AE", "AH"]);
  closeTo(moved.phoneSegments[0].durationMs, 167);
  assert.deepEqual(moved.phoneSegments[0].articulations[0].laneOverrides, { mutation: 0.77 });
  assert.deepEqual(moved.phoneSegments[1].articulations[0].laneOverrides, {});
  closeTo(moved.durationMs, authored.durationMs);
  assert.deepEqual(moved.tokens[0].phones.map(({ id }) => id), ["M", "M", "AE", "AH"]);
  assert.equal(Object.isFrozen(moved), true);
  assert.equal(movePinkTrombonazoidPhone(moved, moved.phoneSegments[0].id, 0), moved);

  const twoWords = compilePinkTrombonazoid("hi there", {
    pronunciations: new Map([
      ["hi", ["HH", "AY"]],
      ["there", ["DH", "EH", "R"]],
    ]),
  });
  assert.equal(
    movePinkTrombonazoidPhone(twoWords, twoWords.phoneSegments[0].id, 3),
    twoWords,
    "word boundaries stay fixed",
  );
});

test("whole-sequence retiming preserves content and rescales articulation and pause timing", () => {
  const source = compilePinkTrombonazoid("hello, sequencer", { sampleCount: 11 });
  const doubled = retimePinkTrombonazoidSequence(source, { scale: 2 });
  closeTo(doubled.durationMs, source.durationMs * 2);
  assert.deepEqual(
    doubled.phoneSegments.map(({ phone }) => phone),
    source.phoneSegments.map(({ phone }) => phone),
  );
  source.segments.forEach((segment, index) => {
    closeTo(doubled.segments[index].durationMs, segment.durationMs * 2);
  });

  const restored = retimePinkTrombonazoidSequence(doubled, source.durationMs);
  closeTo(restored.durationMs, source.durationMs);
  assert.equal(restored.automation.pitch.samples.length, source.sampleCount);
});

test("LFO sampling has stable shapes and deterministic sample-and-hold buckets", () => {
  closeTo(samplePinkTrombonazoidLfo("sine", 0), 0);
  closeTo(samplePinkTrombonazoidLfo("sine", 0.25), 1);
  closeTo(samplePinkTrombonazoidLfo("sine", 0.5), 0);
  closeTo(samplePinkTrombonazoidLfo("triangle", 0), -1);
  closeTo(samplePinkTrombonazoidLfo("triangle", 0.5), 1);
  assert.equal(samplePinkTrombonazoidLfo("square", 0.2), 1);
  assert.equal(samplePinkTrombonazoidLfo("square", 0.7), -1);
  closeTo(
    samplePinkTrombonazoidLfo("unknown", 0.25),
    samplePinkTrombonazoidLfo("sine", 0.25),
  );

  const held = samplePinkTrombonazoidLfo("sample-hold", 3.1, 17);
  assert.equal(samplePinkTrombonazoidLfo("sample-hold", 3.99, 17), held);
  assert.equal(samplePinkTrombonazoidLfo("sample-hold", 3.1, 17), held);
  assert.notEqual(samplePinkTrombonazoidLfo("sample-hold", 4.1, 17), held);
  assert.ok(held >= -1 && held <= 1);
});

test("modulation combines deterministic bipolar LFOs with normalized lane bounds", () => {
  const lanes = Object.fromEntries(PINK_TROMBONAZOID_LANES.map(({ id }) => [id, 0.5]));
  const modulators = [
    { target: "pitch", shape: "sine", rateHz: 1, depth: 0.4 },
    { target: "breath", shape: "square", rateHz: 2, depth: 0.8 },
    { target: "mutation", shape: "sample-hold", rateHz: 3, depth: 0.3, seed: 9 },
  ];
  const first = applyPinkTrombonazoidModulation(lanes, modulators, 0.25);
  const repeat = applyPinkTrombonazoidModulation(lanes, modulators, 0.25);
  assert.deepEqual(first, repeat);
  assert.equal(first.pitch, 0.9);
  assert.equal(first.breath, 0);
  assert.equal(Object.isFrozen(first), true);
  for (const value of Object.values(first)) assert.ok(value >= 0 && value <= 1);
});
