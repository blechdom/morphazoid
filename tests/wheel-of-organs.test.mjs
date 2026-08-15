import assert from "node:assert/strict";
import test from "node:test";

import { editableWheelWord } from "../wheel-of-organs-app.js";

import {
  ALPHABET,
  WHEEL_DENTAL_ARTICULATIONS,
  WHEEL_MORPH_LIMITS,
  WHEEL_MOUTH_LIMITS,
  assignWheelMouthLetter,
  compileWheelWord,
  createWheelState,
  hitTestWheelMouth,
  mapWheelMorphGesture,
  mapWheelPullGesture,
  nearestWheelMouthForLetter,
  nextWheelSoundingEvent,
  normalizeWheelWord,
  resizeWheelMouths,
  sanitizeWheelState,
  wheelMouthLayout,
  wheelStateForWord,
  wheelVocalParameters,
} from "../src/wheel-of-organs.js";

test("wheel defaults spell ORGANISM across eight stable, independent mouths", () => {
  assert.deepEqual(WHEEL_MOUTH_LIMITS, { minimum: 0, default: 8, maximum: 32 });
  assert.equal(Object.isFrozen(WHEEL_MOUTH_LIMITS), true);
  assert.deepEqual(WHEEL_MORPH_LIMITS, {
    size: { minimum: 0.2, default: 1, maximum: 2.6 },
    stretch: { minimum: 0.35, default: 1, maximum: 2.8 },
    tongueOut: { minimum: 0, default: 0.38, maximum: 1 },
  });
  assert.equal(Object.isFrozen(WHEEL_MORPH_LIMITS), true);
  assert.deepEqual(ALPHABET, [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"]);
  assert.equal(Object.isFrozen(ALPHABET), true);

  const first = createWheelState();
  const repeated = createWheelState();
  assert.equal(first.word, "ORGANISM");
  assert.equal(first.rootMidi, 48);
  assert.equal(first.mouths.length, 8);
  assert.equal(first.mouths.map(({ letter }) => letter).join(""), "ORGANISM");
  assert.equal(new Set(first.mouths.map(({ id }) => id)).size, 8);
  assert.equal(new Set(first.mouths.map(({ letter }) => letter)).size, 8);
  assert.notEqual(first.mouths, repeated.mouths);
  assert.notEqual(first.mouths[0], repeated.mouths[0]);
  for (const mouth of first.mouths) {
    assert.deepEqual(Object.keys(mouth), [
      "id",
      "active",
      "letter",
      "pull",
      "tongue",
      "tongueOut",
      "aperture",
      "glottalTension",
      "breath",
      "pinch",
      "push",
      "nasality",
      "screech",
      "size",
      "stretch",
      "interval",
    ]);
    assert.ok(mouth.nasality >= 0.65 && mouth.nasality <= 0.8);
    assert.ok(mouth.screech >= 0.3 && mouth.screech <= 0.45);
    assert.ok(mouth.size >= 0.2 && mouth.size <= 2.6);
    assert.ok(mouth.stretch >= 0.35 && mouth.stretch <= 2.8);
    assert.ok(mouth.tongueOut >= 0 && mouth.tongueOut <= 1);
  }
});

test("state sanitation clamps hostile input, repairs ids, and preserves duplicate letters", () => {
  const safe = sanitizeWheelState({
    word: "  Mörph!!   mouth  ",
    rootMidi: 999,
    mouthCount: 99,
    mouths: [
      {
        id: "same",
        active: 0,
        letter: "q",
        pull: -4,
        tongue: 9,
        tongueOut: 9,
        aperture: Infinity,
        glottalTension: -2,
        breath: 8,
        pinch: -3,
        push: 4,
        nasality: 9,
        screech: -2,
        size: -10,
        stretch: 99,
        interval: -999,
      },
      {
        id: "same",
        letter: "Q",
        glottis: 0.77,
        constriction: 0.66,
        pressure: 0.71,
        nasal: 0.74,
        edge: 0.39,
        protrusion: 0.73,
        scale: 1.9,
        elongation: 2.2,
      },
    ],
  });
  assert.equal(safe.word, "MORPH MOUTH");
  assert.equal(safe.rootMidi, 84);
  assert.equal(safe.mouths.length, 32);
  assert.equal(new Set(safe.mouths.map(({ id }) => id)).size, 32);
  assert.equal(safe.mouths[0].id, "same");
  assert.notEqual(safe.mouths[1].id, "same");
  assert.equal(safe.mouths[1].letter, "Q", "duplicate letter assignments are valid");
  assert.equal(safe.mouths[0].active, false);
  assert.equal(safe.mouths[0].letter, "Q");
  assert.equal(safe.mouths[0].pull, 0);
  assert.equal(safe.mouths[0].tongue, 1);
  assert.equal(safe.mouths[0].tongueOut, 1);
  assert.ok(safe.mouths[0].aperture >= 0 && safe.mouths[0].aperture <= 1);
  assert.equal(safe.mouths[0].glottalTension, 0);
  assert.equal(safe.mouths[0].breath, 1);
  assert.equal(safe.mouths[0].pinch, 0);
  assert.equal(safe.mouths[0].push, 1);
  assert.equal(safe.mouths[0].nasality, 1);
  assert.equal(safe.mouths[0].screech, 0);
  assert.equal(safe.mouths[0].size, 0.2);
  assert.equal(safe.mouths[0].stretch, 2.8);
  assert.equal(safe.mouths[0].interval, -36);
  assert.equal(safe.mouths[1].glottalTension, 0.77);
  assert.equal(safe.mouths[1].pinch, 0.66);
  assert.equal(safe.mouths[1].push, 0.71);
  assert.equal(safe.mouths[1].nasality, 0.74);
  assert.equal(safe.mouths[1].screech, 0.39);
  assert.equal(safe.mouths[1].tongueOut, 0.73);
  assert.equal(safe.mouths[1].size, 1.9);
  assert.equal(safe.mouths[1].stretch, 2.2);

  assert.equal(sanitizeWheelState({ mouthCount: -8 }).mouths.length, 0);
  assert.equal(sanitizeWheelState({ word: "", mouths: [] }).mouths.length, 0);
  assert.equal(createWheelState(0).mouths.length, 0);
  assert.equal(sanitizeWheelState(null).mouths.length, 8);
});

test("mouth resizing preserves retained ids, duplicate letters, and anatomy", () => {
  const original = createWheelState();
  original.mouths[2].tongue = 0.91;
  original.mouths[2].pinch = 0.82;
  original.mouths[2].push = 0.77;
  original.mouths[2].nasality = 0.93;
  original.mouths[2].screech = 0.88;
  original.mouths[2].size = 2.3;
  original.mouths[2].stretch = 2.1;
  original.mouths[2].tongueOut = 0.96;
  const small = resizeWheelMouths(original, 3);
  assert.equal(small.mouths.length, 3);
  assert.deepEqual(
    small.mouths.map(({ id }) => id),
    original.mouths.slice(0, 3).map(({ id }) => id),
  );
  assert.equal(small.mouths[2].tongue, 0.91);
  assert.equal(small.mouths[2].pinch, 0.82);
  assert.equal(small.mouths[2].push, 0.77);
  assert.equal(small.mouths[2].nasality, 0.93);
  assert.equal(small.mouths[2].screech, 0.88);
  assert.equal(small.mouths[2].size, 2.3);
  assert.equal(small.mouths[2].stretch, 2.1);
  assert.equal(small.mouths[2].tongueOut, 0.96);

  const large = resizeWheelMouths(small, 99);
  assert.equal(large.mouths.length, 32);
  assert.deepEqual(
    large.mouths.slice(0, 3).map(({ id }) => id),
    small.mouths.map(({ id }) => id),
  );
  assert.equal(new Set(large.mouths.map(({ id }) => id)).size, 32);
  assert.equal(resizeWheelMouths(large, -2).mouths.length, 0);
});

test("letter assignment changes only one mouth and deliberately allows duplicates", () => {
  const original = createWheelState();
  const ids = original.mouths.map(({ id }) => id);
  const changed = assignWheelMouthLetter(original, 0, "m");
  assert.equal(changed.mouths[0].letter, "M");
  assert.equal(changed.mouths[7].letter, "M");
  assert.deepEqual(changed.mouths.map(({ id }) => id), ids);
  assert.deepEqual(
    changed.mouths.slice(1).map(({ letter }) => letter),
    original.mouths.slice(1).map(({ letter }) => letter),
  );
  assert.equal(original.mouths[0].letter, "O");

  const byId = assignWheelMouthLetter(changed, changed.mouths[1].id, "x");
  assert.equal(byId.mouths[1].letter, "X");
  assert.deepEqual(
    assignWheelMouthLetter(byId, "missing-id", "A"),
    sanitizeWheelState(byId),
  );
});

test("word state and compilation create one positional mouth for every occurrence", () => {
  assert.equal(normalizeWheelWord("  Möm... m\tX!  "), "MOM M X");
  assert.equal(normalizeWheelWord("A".repeat(40)), "A".repeat(32));
  const state = wheelStateForWord("MOM M X");
  assert.deepEqual(state.mouths.map(({ letter }) => letter), ["M", "O", "M", "M", "X"]);
  assert.equal(new Set(state.mouths.map(({ id }) => id)).size, 5);
  const compiled = compileWheelWord("MOM M X", state);
  assert.equal(compiled.word, "MOM M X");
  assert.deepEqual(compiled.events.map(({ type }) => type), [
    "mouth", "mouth", "mouth", "space", "mouth", "space", "mouth",
  ]);
  assert.deepEqual(
    compiled.events.map(({ mouthIndex }) => mouthIndex),
    [0, 1, 2, null, 3, null, 4],
  );
  const mEvents = compiled.events.filter(({ letter }) => letter === "M");
  assert.equal(new Set(mEvents.map(({ mouthId }) => mouthId)).size, 3);
  assert.equal(new Set(mEvents.map(({ mouthIndex }) => mouthIndex)).size, 3);
  assert.deepEqual(compiled.missingLetters, []);
  const empty = wheelStateForWord("...", state);
  assert.equal(empty.word, "");
  assert.deepEqual(empty.mouths, []);
  assert.deepEqual(compileWheelWord("   ", empty), {
    word: "",
    events: [],
    missingLetters: [],
  });
});

test("word remapping preserves each repeated occurrence before positional fallbacks", () => {
  const original = wheelStateForWord("MOM");
  original.mouths[0].push = 0.11;
  original.mouths[1].push = 0.22;
  original.mouths[2].push = 0.33;
  original.mouths[2].size = 2.4;
  const ids = original.mouths.map(({ id }) => id);

  const spaced = wheelStateForWord("M M", original);
  assert.deepEqual(spaced.mouths.map(({ id }) => id), [ids[0], ids[2]]);
  assert.deepEqual(spaced.mouths.map(({ push }) => push), [0.11, 0.33]);
  assert.equal(spaced.mouths[1].size, 2.4);

  const reordered = wheelStateForWord("OMM", original);
  assert.deepEqual(reordered.mouths.map(({ id }) => id), [ids[1], ids[0], ids[2]]);
  assert.deepEqual(reordered.mouths.map(({ push }) => push), [0.22, 0.11, 0.33]);

  const replaced = wheelStateForWord("MUM", original);
  assert.deepEqual(replaced.mouths.map(({ id }) => id), ids);
  assert.deepEqual(replaced.mouths.map(({ push }) => push), [0.11, 0.22, 0.33]);
  assert.deepEqual(replaced.mouths.map(({ letter }) => letter), ["M", "U", "M"]);

  const inserted = wheelStateForWord("SMOM", original);
  assert.deepEqual(inserted.mouths.slice(1).map(({ id }) => id), ids);
  assert.equal(new Set(inserted.mouths.map(({ id }) => id)).size, 4);
  assert.equal(original.word, "MOM", "the prior state is never mutated");
});

test("the editable word draft preserves a space until map or playback normalization", () => {
  assert.equal(editableWheelWord("hello "), "HELLO ");
  assert.equal(editableWheelWord("héllo   weird!"), "HELLO   WEIRD");
  assert.equal(normalizeWheelWord(editableWheelWord("hello   world ")), "HELLO WORLD");
});

test("word compilation adds speech-lite digraphs, soft consonants, and vowel carriers", () => {
  const state = createWheelState(12);
  const sheep = compileWheelWord("SHEEP", state).events;
  assert.equal(sheep[0].articulation, "sh");
  assert.equal(sheep[0].carrierLetter, "IY");
  assert.equal(sheep[1].silent, true);
  assert.equal(sheep[2].articulation, "i");
  assert.equal(sheep[2].carrierLetter, "IY");
  assert.equal(sheep[3].silent, true);
  assert.ok(sheep[2].durationScale > sheep[4].durationScale);

  const consonants = compileWheelWord("CAT CITY", state).events;
  assert.equal(consonants[0].articulation, "k");
  assert.equal(consonants[4].articulation, "s");
  assert.equal(consonants.at(-1).articulation, "i");
  assert.equal(consonants.at(-1).carrierLetter, "IY");
});

test("sole final vowels survive while X and diphthongs expose compact stage sequences", () => {
  const state = createWheelState(12);
  const she = compileWheelWord("SHE", state).events;
  assert.deepEqual(
    she.filter(({ silent }) => !silent).map(({ character }) => character),
    ["S", "E"],
  );
  assert.equal(she[0].articulation, "sh");
  assert.equal(she[0].carrierLetter, "IY");
  assert.equal(she[2].articulation, "i");
  assert.equal(she[2].carrierLetter, "IY");

  const the = compileWheelWord("THE", state).events;
  assert.equal(the[0].articulation, "dh");
  assert.equal(the[1].silent, true);
  assert.equal(the[2].silent, false);
  assert.equal(the[2].carrierLetter, "AX");

  const mouth = compileWheelWord("MOUTH", state).events;
  assert.deepEqual(mouth[1].articulationSequence, ["a", "u"]);
  assert.deepEqual(mouth[1].carrierSequence, ["AH", "UW"]);
  assert.deepEqual(mouth[1].sequenceWeights, [0.46, 0.54]);
  assert.equal(mouth[2].silent, true);
  assert.equal(mouth[3].articulation, "th");
  assert.equal(mouth[3].carrierLetter, "UW");

  const x = compileWheelWord("X", state).events[0];
  assert.equal(x.articulation, "k", "the scalar fallback is the first stage");
  assert.equal(x.carrierLetter, x.carrierSequence[0]);
  assert.deepEqual(x.articulationSequence, ["k", "s"]);
  assert.deepEqual(x.sequenceWeights, [0.38, 0.62]);
  assert.ok(Math.abs(x.sequenceWeights.reduce((sum, weight) => sum + weight, 0) - 1) < 1e-12);

  const space = compileWheelWord("A A", state).events[1];
  assert.deepEqual(space.articulationSequence, []);
  assert.deepEqual(space.carrierSequence, []);
  assert.deepEqual(space.sequenceWeights, []);
  assert.ok(space.durationScale < 0.5);
});

test("dental fricatives are distinct voiced and unvoiced model articulations", () => {
  assert.equal(WHEEL_DENTAL_ARTICULATIONS.th.voiced, false);
  assert.equal(WHEEL_DENTAL_ARTICULATIONS.dh.voiced, true);
  assert.equal(WHEEL_DENTAL_ARTICULATIONS.th.place, "dental");
  assert.ok(Object.isFrozen(WHEEL_DENTAL_ARTICULATIONS));

  const mouth = createWheelState().mouths[0];
  const unvoiced = wheelVocalParameters(mouth, { articulation: "th" });
  const voiced = wheelVocalParameters(mouth, { articulation: "dh" });
  assert.equal(unvoiced.articulation, "th");
  assert.equal(unvoiced.manner, "fricative");
  assert.equal(unvoiced.voiced, false);
  assert.equal(unvoiced.voicing, 0);
  assert.ok(unvoiced.noiseGain > 0);
  assert.equal(voiced.articulation, "dh");
  assert.equal(voiced.voiced, true);
  assert.ok(voiced.voicing > 0);
  assert.ok(voiced.noiseGain > 0);
});

test("missing letters borrow the nearest active physical spoke and remain visible to lookahead", () => {
  const state = createWheelState(3);
  const nearest = nearestWheelMouthForLetter("X", state);
  assert.equal(nearest.mouthIndex, 0);
  assert.equal(nearest.mouthId, state.mouths[0].id);
  assert.equal(nearest.mouthLetter, state.mouths[0].letter);
  assert.ok(nearest.angularDistance >= 0 && nearest.angularDistance <= Math.PI);

  const compilation = compileWheelWord("SH X", resizeWheelMouths(state, 1));
  const x = compilation.events.at(-1);
  assert.equal(x.type, "missing");
  assert.equal(x.borrowed, true);
  assert.equal(x.mouthIndex, 0);
  assert.equal(x.mouthId, state.mouths[0].id);
  assert.equal(x.borrowedFromLetter, state.mouths[0].letter);
  assert.deepEqual(compilation.missingLetters, ["X"]);
  assert.equal(nextWheelSoundingEvent(compilation, -1).character, "S");
  assert.equal(
    nextWheelSoundingEvent(compilation.events, 0).character,
    "X",
    "silent borrowed H and the space are skipped, but audible missing X is retained",
  );

  state.mouths[0].active = false;
  assert.notEqual(nearestWheelMouthForLetter("X", state).mouthIndex, 0);
  assert.equal(nearestWheelMouthForLetter("?", state), null);
  assert.equal(nextWheelSoundingEvent([], 0), null);
});

test("dynamic layout follows pull and hit testing respects rotated mouth ellipses", () => {
  const state = createWheelState(12);
  state.mouths[0].pull = 0;
  state.mouths[1].pull = 1;
  const layout = wheelMouthLayout(640, 480, state);
  assert.equal(layout.count, 12);
  assert.equal(layout.mouths.length, 12);
  assert.equal(new Set(layout.mouths.map(({ angle }) => angle)).size, 12);
  assert.ok(layout.mouths[1].radius > layout.mouths[0].radius);
  for (const mouth of layout.mouths) {
    assert.equal(hitTestWheelMouth({ x: mouth.x, y: mouth.y }, layout), mouth.index);
  }
  assert.equal(hitTestWheelMouth({ x: -50_000, y: 50_000 }, layout), null);

  const three = wheelMouthLayout(300, 300, createWheelState(3));
  assert.equal(three.count, 3);
  assert.ok(three.tangentialRadius > 0);
  const solo = wheelMouthLayout(300, 300, createWheelState(1));
  assert.equal(solo.count, 1);
  assert.ok(solo.tangentialRadius >= three.tangentialRadius);
  const empty = wheelMouthLayout(300, 300, createWheelState(0));
  assert.equal(empty.count, 0);
  assert.deepEqual(empty.mouths, []);
});

test("layout applies independent size and outward radial stretch per mouth", () => {
  const state = createWheelState(4);
  state.mouths[0] = { ...state.mouths[0], size: 0.3, stretch: 1 };
  state.mouths[1] = { ...state.mouths[1], size: 2.4, stretch: 1 };
  state.mouths[2] = { ...state.mouths[2], size: 1, stretch: 0.4 };
  state.mouths[3] = { ...state.mouths[3], size: 1, stretch: 2.8 };
  const layout = wheelMouthLayout(600, 600, state);
  assert.ok(layout.mouths[1].radialRadius > layout.mouths[0].radialRadius * 5);
  assert.ok(layout.mouths[1].tangentialRadius > layout.mouths[0].tangentialRadius * 5);
  assert.ok(layout.mouths[3].radialRadius > layout.mouths[2].radialRadius);
  assert.ok(layout.mouths[3].tangentialRadius < layout.mouths[2].tangentialRadius);
  assert.equal(layout.mouths[3].stretch, 2.8);
  assert.equal(layout.mouths[1].size, 2.4);
});

test("free radial gestures expose coupled pitch and inverse-formant pull", () => {
  const layout = wheelMouthLayout(500, 500, createWheelState());
  const mouth = layout.mouths[0];
  const inward = mapWheelPullGesture({
    x: layout.centerX + Math.cos(mouth.angle) * layout.innerRadius,
    y: layout.centerY + Math.sin(mouth.angle) * layout.innerRadius,
  }, layout, mouth.id);
  const outward = mapWheelPullGesture({
    x: layout.centerX + Math.cos(mouth.angle) * layout.outerRadius,
    y: layout.centerY + Math.sin(mouth.angle) * layout.outerRadius,
  }, layout, mouth.index);
  assert.equal(inward.pull, 0);
  assert.equal(inward.pitchSemitones, 0);
  assert.equal(inward.formantScale, 1);
  assert.ok(Math.abs(outward.pull - 1) < 1e-12);
  assert.ok(Math.abs(outward.pitchSemitones - 18) < 1e-12);
  assert.ok(Math.abs(outward.formantScale - 2 ** (-5 / 12)) < 1e-12);
  assert.ok(outward.formantScale < inward.formantScale);
  assert.equal(mapWheelPullGesture({}, {}, 0), null);
});

test("one- and two-pointer morph gestures expose bounded push and pinch", () => {
  const layout = wheelMouthLayout(500, 500, createWheelState());
  const mouth = layout.mouths[0];
  const tangent = { x: -Math.sin(mouth.angle), y: Math.cos(mouth.angle) };
  const open = mapWheelMorphGesture([
    {
      x: mouth.centerX + tangent.x * mouth.tangentialRadius,
      y: mouth.centerY + tangent.y * mouth.tangentialRadius,
      pressure: 0.2,
    },
    {
      x: mouth.centerX - tangent.x * mouth.tangentialRadius,
      y: mouth.centerY - tangent.y * mouth.tangentialRadius,
      pressure: 0.6,
    },
  ], layout, mouth.id);
  assert.equal(open.pointerCount, 2);
  assert.ok(open.pinch < 1e-12);
  assert.ok(Math.abs(open.push - 0.4) < 1e-12);
  assert.ok(Math.abs(open.spanNormalized - 1) < 1e-12);

  const closed = mapWheelMorphGesture([
    { x: mouth.centerX, y: mouth.centerY, pressure: 1 },
    { x: mouth.centerX, y: mouth.centerY, pressure: 1 },
  ], layout, mouth.index);
  assert.equal(closed.pinch, 1);
  assert.equal(closed.push, 1);
  assert.deepEqual(closed.centroid, { x: mouth.centerX, y: mouth.centerY });

  const single = mapWheelMorphGesture(
    { x: mouth.centerX, y: mouth.centerY, pressure: 0.75 },
    layout,
    mouth.index,
    { pinch: 0.37 },
  );
  assert.equal(single.pointerCount, 1);
  assert.equal(single.pinch, 0.37);
  assert.equal(single.push, 0.75);
  assert.equal(mapWheelMorphGesture([], layout, mouth.index), null);
});

function assertFiniteBounds(parameters) {
  assert.ok(parameters.f0 >= 40 && parameters.f0 <= 1_400);
  assert.equal(parameters.frequency, parameters.f0);
  assert.equal(parameters.fundamentalHz, parameters.f0);
  assert.equal(parameters.formants.length, 3);
  assert.equal(parameters.bandwidths.length, 3);
  assert.equal(parameters.formantGains.length, 3);
  assert.ok(parameters.formants.every((value) => Number.isFinite(value) && value >= 120 && value <= 8_000));
  assert.ok(parameters.bandwidths.every((value) => Number.isFinite(value) && value >= 35 && value <= 900));
  assert.ok(parameters.formantGains.every((value) => Number.isFinite(value) && value >= 0 && value <= 1));
  for (const value of [
    parameters.gain,
    parameters.voicing,
    parameters.noise.gain,
    parameters.burst.gain,
    parameters.nasal.gain,
    parameters.nasal.coupling,
    parameters.oralClosure,
    parameters.glottalClosure,
    parameters.pinch,
    parameters.push,
    parameters.nasality,
    parameters.screech,
    parameters.tongueOut,
    parameters.tongueExtension,
    parameters.tenseness,
    parameters.edge,
    parameters.pressure,
    parameters.airPressure,
    parameters.aspiration,
    parameters.aspirationGain,
    parameters.roughness,
    parameters.resonance,
    parameters.spectralTilt,
    parameters.nasalWetness,
    parameters.constriction,
    parameters.effectiveAperture,
    parameters.throatDrive,
    parameters.timbre.drive,
    parameters.timbre.brightness,
    parameters.timbre.constriction,
    parameters.timbre.pressure,
    parameters.timbre.aspiration,
    parameters.timbre.roughness,
    parameters.timbre.resonance,
    parameters.timbre.nasalWetness,
    parameters.timbre.spectralTilt,
  ]) assert.ok(Number.isFinite(value) && value >= 0 && value <= 1);
  assert.ok(parameters.size >= WHEEL_MORPH_LIMITS.size.minimum
    && parameters.size <= WHEEL_MORPH_LIMITS.size.maximum);
  assert.ok(parameters.stretch >= WHEEL_MORPH_LIMITS.stretch.minimum
    && parameters.stretch <= WHEEL_MORPH_LIMITS.stretch.maximum);
  assert.ok(parameters.pan >= -1 && parameters.pan <= 1);
  assert.ok(parameters.highpass >= 20 && parameters.highpass <= 1_800);
  assert.ok(parameters.lowpass >= 800 && parameters.lowpass <= 18_000);
  assert.ok(parameters.lowpass >= parameters.highpass);
  for (const value of [
    parameters.pitchSemitones,
    parameters.tensionSemitones,
    parameters.pressureSemitones,
    parameters.anatomySemitones,
    parameters.totalPitchSemitones,
  ]) assert.ok(Number.isFinite(value));
  assert.equal(parameters.noise.gain, parameters.noiseGain);
  assert.equal(parameters.noise.aspiration, parameters.aspirationGain);
  assert.equal(parameters.noise.roughness, parameters.roughness);
  assert.equal(parameters.burst.gain, parameters.burstGain);
  assert.equal(parameters.nasal.gain, parameters.nasalGain);
  assert.equal(parameters.nasal.wetness, parameters.nasalWetness);
  assert.equal(parameters.timbre.drive, parameters.timbreDrive);
  assert.equal(parameters.timbre.brightness, parameters.brightness);
  assert.equal(parameters.airPressure, parameters.pressure);
  assert.equal(parameters.aspiration, parameters.aspirationGain);
  assert.equal(parameters.constriction, parameters.oralClosure);
  assert.equal(parameters.highpass, parameters.highpassFrequency);
  assert.equal(parameters.lowpass, parameters.lowpassFrequency);
  assert.equal(parameters.throatDrive, parameters.timbreDrive);
  assert.equal(parameters.tongueExtension, parameters.tongueOut);
  assert.equal(parameters.tenseness, parameters.glottalTension);
  assert.equal(parameters.edge, parameters.screech);
}

test("all alphabet mouths create bounded vocal targets with articulation metadata", () => {
  for (const letter of ALPHABET) {
    const parameters = wheelVocalParameters({
      ...createWheelState().mouths[0],
      letter,
      interval: 999,
      breath: 999,
    }, { rootMidi: 999, pan: 999, sampleRate: 16_000 });
    assertFiniteBounds(parameters);
    assert.equal(parameters.letter, letter);
    assert.ok(parameters.articulation);
    assert.ok(parameters.manner);
  }

  const hiss = wheelVocalParameters({ ...createWheelState().mouths[0], letter: "S" });
  assert.equal(hiss.manner, "fricative");
  assert.ok(hiss.noise.gain > 0);
  const releasedStop = wheelVocalParameters(
    { ...createWheelState().mouths[0], letter: "P" },
    { phase: "release" },
  );
  assert.ok(releasedStop.burst.gain > 0);
  const nasal = wheelVocalParameters({ ...createWheelState().mouths[0], letter: "M" });
  assert.equal(nasal.manner, "nasal");
  assert.ok(nasal.nasal.gain > 0);
});

test("pinch, push, nasality, and screech cause independent bounded vocal changes", () => {
  const base = {
    ...createWheelState().mouths[0],
    letter: "A",
    pull: 0.2,
    tongue: 0.5,
    aperture: 0.72,
    glottalTension: 0.58,
    breath: 0.12,
    pinch: 0,
    push: 0,
    nasality: 0,
    screech: 0,
  };
  const neutral = wheelVocalParameters(base, { rootMidi: 48 });
  const pinched = wheelVocalParameters({ ...base, pinch: 1 }, { rootMidi: 48 });
  assert.ok(pinched.oralClosure > neutral.oralClosure);
  assert.ok(pinched.effectiveAperture < neutral.effectiveAperture);
  assert.ok(pinched.formants[0] < neutral.formants[0]);

  const pushed = wheelVocalParameters({ ...base, push: 1 }, { rootMidi: 48 });
  assert.ok(pushed.pressure > neutral.pressure);
  assert.ok(pushed.gain > neutral.gain);
  assert.ok(pushed.timbreDrive > neutral.timbreDrive);
  assert.notEqual(pushed.f0, neutral.f0);

  const nasal = wheelVocalParameters({ ...base, nasality: 1 }, { rootMidi: 48 });
  assert.equal(nasal.nasality, 1);
  assert.ok(nasal.nasalWetness > 0.95);
  assert.ok(nasal.nasalGain - neutral.nasalGain > 0.7);
  assert.ok(nasal.nasalCoupling - neutral.nasalCoupling > 0.8);

  const screech = wheelVocalParameters({ ...base, screech: 1 }, { rootMidi: 48 });
  assert.ok(screech.noiseFrequency > neutral.noiseFrequency);
  assert.ok(screech.brightness > neutral.brightness);
  assert.ok(screech.timbreDrive > neutral.timbreDrive);
});

test("every visible anatomy control has a dramatic independent vocal contrast", () => {
  const base = {
    ...createWheelState().mouths[0],
    letter: "A",
    interval: 0,
    pull: 0.25,
    push: 0.5,
    pinch: 0,
    aperture: 0.5,
    tongue: 0.5,
    tongueOut: 0,
    size: 1,
    stretch: 1,
    nasality: 0,
    screech: 0,
    glottalTension: 0.5,
    breath: 0,
  };
  const contrasted = [];
  const extremes = (property, low, high) => {
    const pair = [
      wheelVocalParameters({ ...base, [property]: low }, { rootMidi: 48 }),
      wheelVocalParameters({ ...base, [property]: high }, { rootMidi: 48 }),
    ];
    contrasted.push(...pair);
    return pair;
  };

  const [pulledIn, pulledOut] = extremes("pull", 0, 1);
  assert.ok(pulledOut.f0 / pulledIn.f0 > 2.8);
  assert.ok(pulledOut.formants[1] / pulledIn.formants[1] < 0.76);

  const [unpressurized, pushed] = extremes("push", 0, 1);
  assert.ok(pushed.pressure - unpressurized.pressure > 0.95);
  assert.ok(pushed.gain - unpressurized.gain > 0.35);
  assert.ok(pushed.f0 / unpressurized.f0 > 1.25);

  const [openLips, pinched] = extremes("pinch", 0, 1);
  assert.ok(pinched.oralClosure - openLips.oralClosure > 0.9);
  assert.ok(pinched.highpass - openLips.highpass > 600);
  assert.ok(pinched.lowpass / openLips.lowpass < 0.5);
  assert.ok(pinched.noiseGain - openLips.noiseGain > 0.2);

  const [closedAperture, wideAperture] = extremes("aperture", 0.04, 1);
  assert.ok(wideAperture.formants[0] / closedAperture.formants[0] > 1.6);
  assert.ok(wideAperture.gain - closedAperture.gain > 0.5);
  assert.ok(wideAperture.lowpass - closedAperture.lowpass > 8_000);

  const [backTongue, frontTongue] = extremes("tongue", 0, 1);
  assert.ok(frontTongue.formants[1] / backTongue.formants[1] > 1.9);
  assert.ok(frontTongue.noiseFrequency / backTongue.noiseFrequency > 2.2);

  const [retractedTongue, protrudedTongue] = extremes("tongueOut", 0, 1);
  assert.ok(protrudedTongue.formants[1] / retractedTongue.formants[1] > 1.3);
  assert.ok(protrudedTongue.noiseGain - retractedTongue.noiseGain > 0.18);
  assert.ok(protrudedTongue.noiseFrequency / retractedTongue.noiseFrequency > 1.4);

  const [tiny, huge] = extremes("size", 0.2, 2.6);
  assert.ok(tiny.f0 / huge.f0 > 2.8);
  assert.ok(tiny.formants[0] / huge.formants[0] > 2);

  const [short, elongated] = extremes("stretch", 0.35, 2.8);
  assert.ok(short.f0 / elongated.f0 > 1.95);
  assert.ok(short.formants[1] / elongated.formants[1] > 1.8);

  const [oral, nasal] = extremes("nasality", 0, 1);
  assert.ok(nasal.nasalGain - oral.nasalGain > 0.7);
  assert.ok(nasal.nasalCoupling - oral.nasalCoupling > 0.8);

  const [smooth, screeching] = extremes("screech", 0, 1);
  assert.ok(screeching.noiseGain - smooth.noiseGain > 0.4);
  assert.ok(screeching.noiseFrequency / smooth.noiseFrequency > 1.75);
  assert.ok(screeching.formants[2] / smooth.formants[2] > 1.35);
  assert.ok(screeching.roughness - smooth.roughness > 0.45);

  const [slack, tense] = extremes("glottalTension", 0, 1);
  assert.ok(tense.f0 / slack.f0 > 1.75);
  assert.ok(tense.voicing - slack.voicing > 0.55);
  assert.ok(tense.glottalClosure - slack.glottalClosure > 0.7);

  const [dry, breathy] = extremes("breath", 0, 1);
  assert.ok(breathy.bandwidths[0] / dry.bandwidths[0] > 3.4);
  assert.ok(breathy.aspirationGain - dry.aspirationGain > 0.7);
  assert.ok(breathy.noiseGain - dry.noiseGain > 0.7);
  assert.ok(dry.voicing - breathy.voicing > 0.28);

  contrasted.forEach(assertFiniteBounds);
});

test("size, radial stretch, and tongue protrusion independently reshape the voice", () => {
  const base = {
    ...createWheelState().mouths[0],
    letter: "A",
    size: 1,
    stretch: 1,
    tongueOut: 0,
    pinch: 0,
    push: 0.5,
    screech: 0,
    breath: 0.1,
  };
  const neutral = wheelVocalParameters(base, { rootMidi: 48 });
  const large = wheelVocalParameters({ ...base, size: 2.4 }, { rootMidi: 48 });
  assert.ok(large.f0 < neutral.f0);
  assert.ok(large.formants[0] < neutral.formants[0]);
  assert.notEqual(large.noiseFrequency, neutral.noiseFrequency);

  const stretched = wheelVocalParameters({ ...base, stretch: 2.5 }, { rootMidi: 48 });
  assert.ok(stretched.f0 < neutral.f0);
  assert.ok(stretched.formants[1] < neutral.formants[1]);
  assert.notEqual(stretched.noiseGain, neutral.noiseGain);

  const protruded = wheelVocalParameters({ ...base, tongueOut: 1 }, { rootMidi: 48 });
  assert.ok(protruded.f0 > neutral.f0);
  assert.ok(protruded.formants[1] > neutral.formants[1]);
  assert.ok(protruded.noiseGain > neutral.noiseGain);
  assert.ok(protruded.noiseFrequency > neutral.noiseFrequency);
});

test("outward pull raises F0 by 18 semitones while lowering every formant by five", () => {
  const base = {
    ...createWheelState().mouths[0],
    letter: "A",
    interval: 0,
    glottalTension: 0.5,
    tongue: 0.5,
    aperture: 0.5,
  };
  const inward = wheelVocalParameters({ ...base, pull: 0 }, { rootMidi: 48 });
  const outward = wheelVocalParameters({ ...base, pull: 1 }, { rootMidi: 48 });
  assert.ok(Math.abs(outward.f0 / inward.f0 - 2 ** (18 / 12)) < 1e-12);
  for (let index = 0; index < 3; index += 1) {
    assert.ok(Math.abs(outward.formants[index] / inward.formants[index] - 2 ** (-5 / 12)) < 1e-12);
  }
  const muted = wheelVocalParameters({ ...base, active: false });
  assert.equal(muted.gain, 0);
  assert.equal(muted.voicing, 0);
});
