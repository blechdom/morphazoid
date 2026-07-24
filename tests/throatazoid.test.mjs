import assert from "node:assert/strict";
import test from "node:test";

import {
  ARTICULATIONS,
  CONSONANTS,
  LETTER_ARTICULATIONS,
  MAX_MOUTHS,
  MAX_NOSES,
  MAX_PRESSURE_SOURCES,
  MAX_THROATS,
  MAX_TONGUES,
  PHONEMES,
  SPECIMENS,
  VOICE_PRESETS,
  anatomyLayout,
  articulationKey,
  consonantKey,
  consonantVoiceParameters,
  coupleMouthPressures,
  fricationOpening,
  glottalCoefficients,
  glottalHarmonics,
  glottalSample,
  keyboardArticulation,
  keyboardPhoneme,
  mouthCouplingMatrix,
  mouthManifold,
  noseVoiceParameters,
  normalizePressureSources,
  oralOpening,
  routeMouthPressure,
  singingVoiceParameters,
  smoothEnvelope,
  specimenState,
  throatSlots,
  throatVoiceParameters,
  voicePresetState,
  waveformLevel,
} from "../src/throatazoid.js";

test("the mega bank starts with eighteen distinct audition-ready voices", () => {
  assert.deepEqual(Object.keys(VOICE_PRESETS), [
    "clear",
    "deep",
    "bright",
    "warm",
    "alto",
    "mezzo",
    "soprano",
    "airy",
    "bell",
    "coloratura",
    "whisper",
    "reed",
    "nasal",
    "growl",
    "beatbox",
    "singer",
    "choir",
    "alien",
  ]);

  const clear = voicePresetState("clear");
  assert.equal(clear.sourceMode, "glottis");
  assert.equal(clear.phoneme, "a");
  assert.equal(clear.throatCount, 1);
  assert.equal(clear.tongueCount, 1);
  assert.equal(clear.noseCount, 1);
  assert.equal(clear.pressureSourceCount, 1);
  assert.equal(clear.mutation, 0);
  assert.equal(clear.coupling, 0);
  assert.equal(clear.growl, 0);
  assert.equal(clear.wet, 1);
  assert.equal(clear.dry, 0);

  const fingerprints = [];
  for (const [key, preset] of Object.entries(VOICE_PRESETS)) {
    const state = voicePresetState(key);
    assert.equal(state.voicePreset, key);
    assert.equal(state.phoneme, preset.phoneme);
    assert.equal(state.sourceMode, "glottis");
    assert.equal(state.throats.length, MAX_THROATS);
    assert.equal(state.tongues.length, MAX_TONGUES);
    assert.equal(state.noses.length, MAX_NOSES);
    assert.ok(state.throatCount >= 1 && state.throatCount <= MAX_THROATS);
    assert.ok(
      state.pressureSourceCount >= 1
        && state.pressureSourceCount <= MAX_PRESSURE_SOURCES,
    );
    fingerprints.push(JSON.stringify({
      phoneme: state.phoneme,
      throatCount: state.throatCount,
      bodyLength: state.bodyLength,
      mutation: state.mutation,
      coupling: state.coupling,
      growl: state.growl,
      pitch: state.exciterPitch,
      breath: state.exciterBreath,
      voicing: state.articulationVoicing,
      nasal: state.nasalCoupling,
      mode: state.voiceMode,
      intervals: state.voiceIntervals,
    }));
  }
  assert.equal(
    new Set(fingerprints).size,
    Object.keys(VOICE_PRESETS).length,
    "every quick voice needs a meaningfully distinct parameter set",
  );

  const upperVoices = ["alto", "mezzo", "soprano", "airy", "bell", "coloratura"]
    .map((key) => voicePresetState(key));
  assert.equal(Math.min(...upperVoices.map((voice) => voice.exciterPitch)), 175);
  assert.equal(Math.max(...upperVoices.map((voice) => voice.exciterPitch)), 392);
  for (const voice of upperVoices) {
    assert.equal(voice.sourceMode, "glottis");
    assert.equal(voice.throatCount, 1);
    assert.equal(voice.pressureSourceCount, 1);
    assert.ok(voice.exciterPitch <= 420);
  }
});

test("vowels use one calibrated tongue and independent rounded lips", () => {
  const tractCoordinates = Object.fromEntries(
    Object.entries(PHONEMES)
      .filter(([, phoneme]) => phoneme.kind === "vowel")
      .map(([key, phoneme]) => [
        key,
        {
          index: 12.9 + phoneme.tongues[0].position * 17.5,
          diameter: 3.5 - phoneme.tongues[0].height * 1.45,
          lipDiameter: phoneme.lipDiameter,
        },
      ]),
  );

  for (const vowel of Object.values(PHONEMES).filter(
    (phoneme) => phoneme.kind === "vowel",
  )) {
    assert.equal(vowel.tongueCount, 1, `${vowel.name} must use one coherent tongue`);
    assert.equal(vowel.noseCount, 1, `${vowel.name} must start with one closed nose`);
  }

  assert.ok(Math.abs(tractCoordinates.a.index - 13) < 0.15);
  assert.ok(Math.abs(tractCoordinates.a.diameter - 2.4) < 0.03);
  assert.ok(Math.abs(tractCoordinates.e.index - 20) < 0.03);
  assert.ok(Math.abs(tractCoordinates.e.diameter - 3.35) < 0.03);
  assert.ok(Math.abs(tractCoordinates.i.index - 27.4) < 0.03);
  assert.ok(Math.abs(tractCoordinates.i.diameter - 2.25) < 0.03);
  assert.ok(Math.abs(tractCoordinates.o.index - 17.7) < 0.03);
  assert.ok(Math.abs(tractCoordinates.o.diameter - 2.05) < 0.03);
  assert.ok(Math.abs(tractCoordinates.u.index - 23) < 0.03);
  assert.ok(Math.abs(tractCoordinates.u.diameter - 2.1) < 0.03);
  assert.equal(tractCoordinates.a.lipDiameter, 3);
  assert.ok(tractCoordinates.o.lipDiameter < 1.1);
  assert.ok(tractCoordinates.u.lipDiameter < tractCoordinates.o.lipDiameter);

  assert.equal(CONSONANTS.sh.constrictionDiameter, 0.6);
  assert.equal(CONSONANTS.s.constrictionDiameter, 0.6);
  assert.equal(CONSONANTS.f.constrictionDiameter, 0.5);
  for (const key of ["k", "t", "p", "m", "n", "ng"]) {
    assert.equal(CONSONANTS[key].constrictionDiameter, 0);
  }
});

test("Throatazoid specimens produce complete bounded anatomy", () => {
  assert.equal(MAX_THROATS, 7);
  assert.equal(MAX_MOUTHS, MAX_THROATS);
  assert.equal(MAX_TONGUES, 5);
  assert.equal(MAX_NOSES, 3);
  assert.equal(MAX_PRESSURE_SOURCES, 4);
  assert.deepEqual(Object.keys(SPECIMENS), [
    "triune",
    "oracle",
    "hive",
    "hydra",
    "razor",
    "monolith",
    "siren",
    "larva",
    "cathedral",
    "needle",
    "maw",
    "choir",
    "singing",
    "void",
  ]);

  for (const name of Object.keys(SPECIMENS)) {
    const state = specimenState(name);
    assert.equal(state.throats.length, MAX_THROATS);
    assert.equal(state.tongues.length, MAX_TONGUES);
    assert.equal(state.noses.length, MAX_NOSES);
    assert.ok(state.throatCount >= 1 && state.throatCount <= MAX_THROATS);
    assert.ok(state.tongueCount >= 1 && state.tongueCount <= MAX_TONGUES);
    assert.ok(state.noseCount >= 1 && state.noseCount <= MAX_NOSES);
    assert.ok(
      Number.isFinite(state.oralClosure)
        && state.oralClosure >= 0
        && state.oralClosure <= 1,
      `${name}.oralClosure must be a finite unit value`,
    );
    for (const [index, tongue] of state.tongues.entries()) {
      for (const parameter of ["position", "height", "curl"]) {
        assert.ok(
          Number.isFinite(tongue[parameter])
            && tongue[parameter] >= 0
            && tongue[parameter] <= 1,
          `${name}.tongues[${index}].${parameter} must be a finite unit value`,
        );
      }
    }
    for (const [index, nose] of state.noses.entries()) {
      for (const parameter of ["openness", "length", "resonance"]) {
        assert.ok(
          Number.isFinite(nose[parameter])
            && nose[parameter] >= 0
            && nose[parameter] <= 1,
          `${name}.noses[${index}].${parameter} must be a finite unit value`,
        );
      }
    }
    assert.ok(Number.isFinite(state.exciterPitch) && state.exciterPitch > 0);
    for (const parameter of [
      "exciterIntensity",
      "exciterTenseness",
      "exciterBreath",
      "exciterVibrato",
      "exciterWobble",
      "wet",
      "dry",
      "spread",
    ]) {
      assert.ok(
        Number.isFinite(state[parameter]) && state[parameter] >= 0 && state[parameter] <= 1,
        `${name}.${parameter} must be a finite unit value`,
      );
    }
    const layout = anatomyLayout(960, 620, state);
    assert.equal(layout.branches.length, state.throatCount);
    assert.ok(layout.root.x < layout.junction.x);

    for (const branch of layout.branches) {
      assert.equal(branch.polygon.length, 6);
      assert.ok(branch.mouth.x > layout.junction.x);
      assert.ok(branch.handle.x > layout.junction.x);
      assert.ok(branch.handle.x < 960);
      assert.ok(branch.handle.y > 0 && branch.handle.y < 620);
    }
  }

  const states = Object.keys(SPECIMENS).map((name) => specimenState(name));
  const fingerprints = states.map((state) => JSON.stringify({
    throatCount: state.throatCount,
    bodyLength: state.bodyLength,
    tension: state.tension,
    mutation: state.mutation,
    coupling: state.coupling,
    growl: state.growl,
    wet: state.wet,
    dry: state.dry,
    spread: state.spread,
    exciterPitch: state.exciterPitch,
    exciterIntensity: state.exciterIntensity,
    exciterTenseness: state.exciterTenseness,
    exciterBreath: state.exciterBreath,
    exciterVibrato: state.exciterVibrato,
    exciterWobble: state.exciterWobble,
    voiceMode: state.voiceMode,
    voiceIntervals: state.voiceIntervals,
    voiceDetunes: state.voiceDetunes,
    throats: state.throats.slice(0, state.throatCount),
  }));
  assert.equal(new Set(fingerprints).size, 14, "every specimen needs a distinct full voice");
  assert.deepEqual(
    [...new Set(states.map((state) => state.throatCount))].sort(),
    [1, 2, 3, 4, 5, 7],
  );
  assert.ok(Math.max(...states.map((state) => state.exciterPitch)) >= 300);
  assert.ok(Math.min(...states.map((state) => state.exciterPitch)) <= 50);
  assert.ok(Math.max(...states.map((state) => state.exciterBreath)) >= 0.8);
});

test("Singing is an explicit polyphonic specimen with one pitched voice per mouth", () => {
  const specimen = SPECIMENS.singing;
  assert.ok(specimen, "the Singing preset must be independently selectable");
  assert.equal(specimen.name, "Singing");
  assert.equal(specimen.voiceMode, "polyphonic");
  assert.ok(specimen.throatCount >= 3, "Singing needs a real multi-mouth ensemble");
  assert.equal(specimen.voiceIntervals.length, specimen.throatCount);
  assert.equal(specimen.voiceDetunes.length, specimen.throatCount);
  assert.ok(
    new Set(specimen.voiceIntervals).size >= 3,
    "Singing needs at least three distinct musical intervals",
  );
  assert.ok(
    new Set(specimen.voiceDetunes).size >= 3,
    "Singing needs independent micro-detuning rather than cloned oscillators",
  );
  assert.ok(specimen.exciterVibrato > 0, "the sung ensemble needs audible vibrato");

  const state = specimenState("singing");
  assert.equal(state.specimen, "singing");
  assert.equal(state.voiceMode, "polyphonic");
  assert.deepEqual(state.voiceIntervals, specimen.voiceIntervals);
  assert.deepEqual(state.voiceDetunes, specimen.voiceDetunes);

  const voices = Array.from(
    { length: state.throatCount },
    (_, mouthIndex) => singingVoiceParameters(state, mouthIndex),
  );
  assert.ok(
    new Set(voices.map((voice) => voice.frequency.toFixed(4))).size >= 3,
    "Singing must produce independently pitched voices, not one source through many filters",
  );
  assert.ok(
    new Set(voices.map((voice) => voice.detune.toFixed(4))).size >= 3,
    "Singing voices need distinct detunes",
  );
  assert.ok(
    new Set(voices.map((voice) => voice.pan.toFixed(4))).size >= 3,
    "Singing voices should occupy distinct stereo positions",
  );

  for (const [mouthIndex, voice] of voices.entries()) {
    assert.equal(voice.mouthIndex, mouthIndex);
    for (const parameter of ["frequency", "detune", "pan", "gain"]) {
      assert.ok(
        Number.isFinite(voice[parameter]),
        `singing mouth ${mouthIndex} ${parameter} must be finite`,
      );
    }
    assert.ok(voice.frequency >= 20 && voice.frequency <= 20_000);
    assert.ok(voice.detune >= -1_200 && voice.detune <= 1_200);
    assert.ok(voice.pan >= -1 && voice.pan <= 1);
    assert.ok(voice.gain > 0 && voice.gain <= 1);
  }

  state.throats[2].muted = true;
  assert.equal(
    singingVoiceParameters(state, 2).gain,
    0,
    "closing a Singing mouth must silence its assigned voice",
  );
});

test("pressure sources normalize to four bounded virtual root exciters", () => {
  const defaults = normalizePressureSources();
  assert.equal(defaults.pressureSourceCount, 1);
  assert.equal(defaults.pressureSources.length, MAX_PRESSURE_SOURCES);
  assert.deepEqual(defaults.pressureSources[0], {
    index: 0,
    open: true,
    level: 1,
  });
  assert.ok(defaults.pressureSources.slice(1).every(
    (source) => !source.open && source.level === 0,
  ));

  const normalized = normalizePressureSources({
    pressureSourceCount: 99,
    pressureSources: [
      { open: false, level: 8 },
      { open: true, level: -2 },
      { open: 1, level: 0.4 },
      { open: 0, level: Number.NaN },
      { open: true, level: 0.8 },
    ],
  });
  assert.equal(normalized.pressureSourceCount, MAX_PRESSURE_SOURCES);
  assert.deepEqual(
    normalized.pressureSources.map(({ open, level }) => ({ open, level })),
    [
      { open: false, level: 1 },
      { open: true, level: 0 },
      { open: true, level: 0.4 },
      { open: false, level: 1 },
    ],
  );
});

test("legacy throat specimens adapt to one shared mouth manifold", () => {
  const legacy = specimenState("hydra");
  const manifold = mouthManifold(legacy);
  assert.equal(manifold.kind, "mouth-manifold");
  assert.equal(manifold.mouthCount, 7);
  assert.equal(manifold.mouths.length, 7);
  assert.equal(manifold.couplingMatrix.length, 7);
  assert.equal(manifold.pressureSources.length, MAX_PRESSURE_SOURCES);
  assert.ok(Object.values(manifold.root).every(Number.isFinite));

  for (const [index, mouth] of manifold.mouths.entries()) {
    assert.equal(mouth.index, index);
    assert.equal(mouth.aperture, legacy.throats[index].aperture);
    assert.equal(mouth.length, legacy.throats[index].length);
    assert.ok(mouth.effectiveAperture >= 0 && mouth.effectiveAperture <= 1);
    assert.ok(Number.isFinite(mouth.resistance) && mouth.resistance > 0);
    assert.ok(Number.isFinite(mouth.conductance) && mouth.conductance >= 0);
    assert.ok(Number.isInteger(mouth.tongueAssignment));
    assert.ok(
      mouth.tongueAssignment >= 0 && mouth.tongueAssignment < legacy.tongueCount,
    );
    assert.ok(Number.isInteger(mouth.noseAssignment));
    assert.ok(mouth.noseAssignment >= 0 && mouth.noseAssignment < legacy.noseCount);
    assert.equal(mouth.tongueIndex, mouth.tongueAssignment);
    assert.equal(mouth.noseIndex, mouth.noseAssignment);
  }

  const explicit = mouthManifold({
    mouthCount: 2,
    throatCount: 7,
    tongueCount: 3,
    noseCount: 2,
    oralClosure: 0,
    mouths: [
      {
        aperture: 0.8,
        length: 0.3,
        tongueAssignment: 2,
        noseAssignment: 1,
      },
      {
        aperture: 0.4,
        length: 0.9,
        tongueIndex: 0,
        noseIndex: 0,
        closed: true,
      },
    ],
  });
  assert.equal(explicit.mouthCount, 2);
  assert.deepEqual(
    explicit.mouths.map((mouth) => [
      mouth.tongueAssignment,
      mouth.noseAssignment,
    ]),
    [[2, 1], [0, 0]],
  );
  assert.equal(explicit.mouths[1].closed, true);
  assert.equal(explicit.mouths[1].conductance, 0);
});

test("neighbor coupling is symmetric, conservative, and stable through iteration", () => {
  for (let count = 1; count <= MAX_MOUTHS; count += 1) {
    const matrix = mouthCouplingMatrix(count, 1);
    assert.equal(matrix.length, count);
    for (let row = 0; row < count; row += 1) {
      assert.equal(matrix[row].length, count);
      assert.ok(matrix[row].every(
        (weight) => Number.isFinite(weight) && weight >= 0 && weight <= 1,
      ));
      assert.ok(
        Math.abs(matrix[row].reduce((sum, weight) => sum + weight, 0) - 1) < 1e-12,
      );
      for (let column = 0; column < count; column += 1) {
        assert.ok(Math.abs(matrix[row][column] - matrix[column][row]) < 1e-12);
      }
    }
  }

  const initial = [1, 0, 0, 0, 0, 0, 0];
  let coupled = initial;
  let previousRange = 1;
  for (let iteration = 0; iteration < 80; iteration += 1) {
    coupled = coupleMouthPressures(coupled, 1);
    const range = Math.max(...coupled) - Math.min(...coupled);
    assert.ok(coupled.every(
      (pressure) => Number.isFinite(pressure) && pressure >= 0 && pressure <= 1,
    ));
    assert.ok(Math.abs(coupled.reduce((sum, pressure) => sum + pressure, 0) - 1) < 1e-10);
    assert.ok(range <= previousRange + 1e-12);
    previousRange = range;
  }
  assert.ok(previousRange < 0.05, "stable coupling should diffuse a local pressure peak");
  assert.ok(coupleMouthPressures([0.4, 0.4, 0.4], 1).every(
    (pressure) => Math.abs(pressure - 0.4) < 1e-12,
  ));
  assert.deepEqual(coupleMouthPressures([], 1), []);
});

test("closing one mouth redirects shared-root flow into every remaining open mouth", () => {
  const state = specimenState("triune");
  state.oralClosure = 0;
  state.coupling = 0.5;
  for (let index = 0; index < state.throatCount; index += 1) {
    state.throats[index] = {
      aperture: 0.8,
      length: 0.5,
      muted: false,
    };
  }
  const open = routeMouthPressure(state, 1);
  state.throats[0].aperture = 0;
  const redistributed = routeMouthPressure(state, 1);

  assert.equal(redistributed.mouths[0].flow, 0);
  for (let index = 1; index < state.throatCount; index += 1) {
    assert.ok(
      redistributed.mouths[index].flow > open.mouths[index].flow,
      `mouth ${index} should receive more shared-root flow after mouth 0 closes`,
    );
  }
  assert.ok(
    redistributed.root.manifoldPressure > open.root.manifoldPressure,
    "closing a parallel mouth should raise pressure in the common manifold",
  );
  assert.ok(
    Math.abs(
      redistributed.mouths.reduce((sum, mouth) => sum + mouth.share, 0) - 1
    ) < 1e-12,
  );

  for (const throat of state.throats.slice(0, state.throatCount)) {
    throat.aperture = 0;
  }
  const sealed = routeMouthPressure(state, 1);
  assert.equal(sealed.root.totalConductance, 0);
  assert.equal(sealed.root.totalFlow, 0);
  assert.ok(sealed.mouths.every(
    (mouth) => mouth.flow === 0
      && mouth.share === 0
      && Number.isFinite(mouth.pressure),
  ));
  assert.ok(Object.values(sealed.root).every(Number.isFinite));
});

test("only open pressure sources contribute to the shared root", () => {
  const state = specimenState("triune");
  state.oralClosure = 0;
  state.pressureSourceCount = 2;
  state.pressureSources = [
    { open: true, level: 0.8 },
    { open: true, level: 0.4 },
  ];
  const both = routeMouthPressure(state, 2);
  assert.equal(both.root.openSourceCount, 2);
  assert.ok(Math.abs(both.root.sourceLevel - 1.2 / Math.sqrt(2)) < 1e-12);
  assert.ok(Math.abs(both.root.sourcePressure - both.root.sourceLevel * 2) < 1e-12);

  state.pressureSources[1].open = false;
  const one = routeMouthPressure(state, 2);
  assert.equal(one.root.openSourceCount, 1);
  assert.equal(one.root.sourceLevel, 0.8);
  assert.equal(one.root.sourcePressure, 1.6);
  assert.notEqual(one.root.sourcePressure, both.root.sourcePressure);

  state.pressureSources[0].open = false;
  const none = routeMouthPressure(state, 2);
  assert.equal(none.root.openSourceCount, 0);
  assert.equal(none.root.sourceLevel, 0);
  assert.equal(none.root.sourcePressure, 0);
  assert.equal(none.root.manifoldPressure, 0);
  assert.equal(none.root.totalFlow, 0);
  assert.ok(none.mouths.every(
    (mouth) => mouth.flow === 0 && Number.isFinite(mouth.pressure),
  ));
  assert.ok(Object.values(none.root).every(Number.isFinite));
});

test("compact Throatazoid layouts keep every throat handle on the visible stage", () => {
  for (const [width, height] of [[320, 150], [375, 205], [650, 215]]) {
    for (const name of Object.keys(SPECIMENS)) {
      const layout = anatomyLayout(width, height, specimenState(name));
      for (const branch of layout.branches) {
        assert.ok(branch.handle.x >= 0 && branch.handle.x <= width);
        assert.ok(branch.handle.y >= 0 && branch.handle.y <= height);
      }
    }
  }
});

function stateWithPhoneme(phoneme) {
  const state = specimenState("triune");
  const gesture = PHONEMES[phoneme];
  assert.ok(gesture, `missing ${phoneme} gesture`);
  return {
    ...state,
    phoneme,
    tongueCount: gesture.tongueCount,
    noseCount: gesture.noseCount,
    oralClosure: gesture.oralClosure,
    tongues: state.tongues.map((tongue, index) => ({
      ...tongue,
      ...(gesture.tongues[index] ?? {}),
    })),
    noses: state.noses.map((nose, index) => ({
      ...nose,
      ...(gesture.noses[index] ?? {}),
    })),
  };
}

test("phoneme gestures define complete alien vowels and consonants", () => {
  assert.deepEqual(Object.keys(PHONEMES), ["a", "e", "i", "o", "u", "s", "k", "m", "n"]);

  for (const [phoneme, gesture] of Object.entries(PHONEMES)) {
    assert.equal(typeof gesture.name, "string");
    assert.ok(gesture.name.length > 0);
    assert.equal(
      gesture.kind,
      "aeiou".includes(phoneme) ? "vowel" : "consonant",
      `${phoneme} needs the right gesture kind`,
    );
    assert.ok(gesture.tongueCount >= 1 && gesture.tongueCount <= MAX_TONGUES);
    assert.ok(gesture.noseCount >= 1 && gesture.noseCount <= MAX_NOSES);
    assert.ok(gesture.oralClosure >= 0 && gesture.oralClosure <= 1);
    assert.equal(gesture.tongues.length, MAX_TONGUES);
    assert.equal(gesture.noses.length, MAX_NOSES);

    for (const [index, tongue] of gesture.tongues.entries()) {
      for (const parameter of ["position", "height", "curl"]) {
        assert.ok(
          Number.isFinite(tongue[parameter])
            && tongue[parameter] >= 0
            && tongue[parameter] <= 1,
          `${phoneme}.tongues[${index}].${parameter} must be a finite unit value`,
        );
      }
    }
    for (const [index, nose] of gesture.noses.entries()) {
      for (const parameter of ["openness", "length", "resonance"]) {
        assert.ok(
          Number.isFinite(nose[parameter])
            && nose[parameter] >= 0
            && nose[parameter] <= 1,
          `${phoneme}.noses[${index}].${parameter} must be a finite unit value`,
        );
      }
    }
  }
});

test("typing maps only playable letter keys to phoneme gestures", () => {
  for (const phoneme of ["a", "e", "i", "o", "u", "s", "k", "m", "n"]) {
    assert.equal(keyboardPhoneme(phoneme), phoneme);
    assert.equal(keyboardPhoneme(phoneme.toUpperCase()), phoneme);
  }
  for (const invalid of [
    "",
    "g",
    "h",
    "t",
    "p",
    "f",
    "z",
    "sh",
    "ng",
    "Enter",
    1,
    null,
    undefined,
  ]) {
    assert.equal(keyboardPhoneme(invalid), "");
  }
});

test("every alphabet key maps to its own playable approximation", () => {
  assert.deepEqual(
    Object.keys(LETTER_ARTICULATIONS),
    [..."abcdefghijklmnopqrstuvwxyz"],
  );
  for (const [key, articulation] of Object.entries(LETTER_ARTICULATIONS)) {
    assert.equal(articulation, key);
    assert.equal(keyboardArticulation(key), articulation);
    assert.equal(keyboardArticulation(key.toUpperCase()), articulation);
    assert.ok(ARTICULATIONS[articulation]);
  }
  const fingerprints = Object.values(LETTER_ARTICULATIONS).map((id) => {
    const articulation = ARTICULATIONS[id];
    return JSON.stringify({
      kind: articulation.kind,
      manner: articulation.manner,
      place: articulation.place,
      voiced: articulation.voiced,
      position: articulation.constrictionPosition,
      diameter: articulation.constrictionDiameter,
      lipDiameter: articulation.lipDiameter,
      fricationFrequency: articulation.frication?.frequency,
      primaryTongue: articulation.tongues?.[0],
    });
  });
  assert.equal(
    new Set(fingerprints).size,
    26,
    "random alphabet play should reach 26 distinct tract or voicing settings",
  );
  assert.equal(keyboardArticulation("?"), "glottal");
  assert.equal(keyboardArticulation("'"), "glottal");
  for (const invalid of ["", "1", "sh", "ng", "Enter", 1, null, undefined]) {
    assert.equal(keyboardArticulation(invalid), "");
  }
});

test("the articulation registry unifies vowels with rich consonant descriptors", () => {
  assert.ok(Object.isFrozen(ARTICULATIONS));
  for (const vowel of ["a", "e", "i", "o", "u"]) {
    assert.equal(ARTICULATIONS[vowel], PHONEMES[vowel]);
    assert.equal(articulationKey(vowel.toUpperCase()), vowel);
  }
  for (const id of Object.keys(CONSONANTS)) {
    assert.equal(ARTICULATIONS[id], CONSONANTS[id]);
    assert.equal(articulationKey(id.toUpperCase()), id);
  }
  assert.equal(articulationKey("ʔ"), "glottal");
  assert.equal(articulationKey(" glottal-stop "), "glottal");
  assert.equal(articulationKey("ʃ"), "sh");
  assert.equal(articulationKey("ŋ"), "ng");
  for (const invalid of ["", "ch", "xyz", 1, null, undefined]) {
    assert.equal(articulationKey(invalid), "");
  }
});

test("consonant descriptors cover distinct places, manners, and complete gestures", () => {
  assert.deepEqual(
    Object.keys(CONSONANTS),
    [
      "glottal",
      "k",
      "t",
      "p",
      "s",
      "sh",
      "f",
      "m",
      "n",
      "ng",
      "b",
      "c",
      "d",
      "g",
      "h",
      "j",
      "l",
      "q",
      "r",
      "v",
      "w",
      "x",
      "y",
      "z",
    ],
  );

  const manners = new Set([
    "stop",
    "fricative",
    "nasal",
    "affricate",
    "approximant",
  ]);
  const places = new Set([
    "glottal",
    "velar",
    "alveolar",
    "bilabial",
    "postalveolar",
    "labiodental",
  ]);
  for (const [id, consonant] of Object.entries(CONSONANTS)) {
    assert.equal(consonant.id, id);
    assert.ok(manners.has(consonant.manner), `${id} needs a modeled manner`);
    assert.ok(places.has(consonant.place), `${id} needs a modeled place`);
    assert.equal(typeof consonant.articulator, "string");
    assert.ok(consonant.articulator.length > 0);
    for (const parameter of [
      "constrictionPosition",
      "oralClosure",
      "glottalClosure",
      "nasalCoupling",
    ]) {
      assert.ok(
        Number.isFinite(consonant[parameter])
          && consonant[parameter] >= 0
          && consonant[parameter] <= 1,
        `${id}.${parameter} must be a finite unit value`,
      );
    }
    for (const spectrum of ["frication", "burst", "nasal"]) {
      assert.ok(Object.values(consonant[spectrum]).every(Number.isFinite));
      assert.ok(Object.isFrozen(consonant[spectrum]));
    }
    assert.ok(
      consonant.lipDiameter === null
        || (
          Number.isFinite(consonant.lipDiameter)
          && consonant.lipDiameter >= 0.35
          && consonant.lipDiameter <= 3
        ),
      `${id}.lipDiameter must be null or a bounded tract diameter`,
    );
    assert.equal(consonant.gesture.kind, "consonant");
    assert.equal(consonant.gesture.tongues.length, MAX_TONGUES);
    assert.equal(consonant.gesture.noses.length, MAX_NOSES);
    assert.ok(Object.isFrozen(consonant));
    assert.ok(Object.isFrozen(consonant.gesture));
  }
  assert.ok(Object.isFrozen(CONSONANTS));
});

test("alphabet consonants add voiced pairs, affricates, and approximants", () => {
  for (const [voiced, unvoiced] of [
    ["b", "p"],
    ["d", "t"],
    ["g", "k"],
    ["v", "f"],
    ["z", "s"],
  ]) {
    assert.equal(CONSONANTS[voiced].voiced, true);
    assert.equal(CONSONANTS[unvoiced].voiced, false);
    assert.equal(
      CONSONANTS[voiced].place,
      CONSONANTS[unvoiced].place,
      `${voiced}/${unvoiced} should share an articulation place`,
    );
    assert.equal(
      CONSONANTS[voiced].constrictionPosition,
      CONSONANTS[unvoiced].constrictionPosition,
    );
  }

  for (const id of ["c", "j"]) {
    const hold = consonantVoiceParameters(id, "hold");
    const release = consonantVoiceParameters(id, "release");
    assert.equal(hold.manner, "affricate");
    assert.ok(hold.fricationGain > 0);
    assert.ok(release.burstGain > 0);
  }

  for (const id of ["l", "r", "w", "y"]) {
    const hold = consonantVoiceParameters(id, "hold");
    assert.equal(hold.manner, "approximant");
    assert.equal(hold.voiced, true);
    assert.equal(hold.fricationGain, 0);
    assert.equal(hold.burstGain, 0);
    assert.ok(CONSONANTS[id].constrictionDiameter >= 0.7);
  }
  assert.ok(CONSONANTS.q.lipDiameter < 0.7);
  assert.ok(CONSONANTS.w.lipDiameter < 0.7);
  assert.equal(CONSONANTS.h.place, "glottal");
  assert.equal(CONSONANTS.x.manner, "fricative");
});

test("consonant keys normalize readable and IPA aliases without widening keyboard capture", () => {
  for (const id of Object.keys(CONSONANTS)) {
    assert.equal(consonantKey(id), id);
    assert.equal(consonantKey(id.toUpperCase()), id);
  }
  assert.equal(consonantKey("ʔ"), "glottal");
  assert.equal(consonantKey("?"), "glottal");
  assert.equal(consonantKey(" glottal stop "), "glottal");
  assert.equal(consonantKey("ʃ"), "sh");
  assert.equal(consonantKey("ŋ"), "ng");
  for (const invalid of ["", "a", "ch", "xyz", 1, null, undefined]) {
    assert.equal(consonantKey(invalid), "");
  }
  assert.equal(keyboardPhoneme("sh"), "");
  assert.equal(keyboardPhoneme("ng"), "");
});

test("glottal, velar, alveolar, and bilabial stops hold closures then release unique bursts", () => {
  const holds = Object.fromEntries(
    ["glottal", "k", "t", "p"].map((id) => [
      id,
      consonantVoiceParameters(id, "hold", 48_000),
    ]),
  );
  const releases = Object.fromEntries(
    ["glottal", "k", "t", "p"].map((id) => [
      id,
      consonantVoiceParameters(id, "release", 48_000),
    ]),
  );

  assert.equal(holds.glottal.place, "glottal");
  assert.equal(holds.glottal.glottalClosure, 1);
  assert.ok(holds.glottal.oralClosure < 0.1);
  assert.equal(releases.glottal.glottalClosure, 0);
  assert.equal(
    releases.glottal.burstGain,
    0,
    "a glottal stop releases the source gate rather than injecting an oral burst",
  );

  assert.equal(holds.k.place, "velar");
  assert.equal(holds.t.place, "alveolar");
  assert.equal(holds.p.place, "bilabial");
  for (const id of ["k", "t", "p"]) {
    assert.equal(holds[id].oralClosure, 1, `${id} must form a complete oral stop`);
    assert.equal(holds[id].burstGain, 0, `${id} must not burst while held`);
    assert.equal(releases[id].oralClosure, 0);
    assert.ok(releases[id].burstGain >= 0.8, `${id} needs a strong release transient`);
    assert.equal(releases[id].burstHalfLife, 0.005);
    assert.equal(
      releases[id].burstDuration,
      0.2,
      "burst duration is a cleanup window; audible energy follows the short half-life",
    );
  }
  assert.ok(
    releases.p.burstFrequency
      < releases.k.burstFrequency
      && releases.k.burstFrequency
      < releases.t.burstFrequency,
    "lip, velar, and alveolar stops need ascending spectral burst centers",
  );
  assert.ok(
    holds.k.constrictionPosition
      < holds.t.constrictionPosition
      && holds.t.constrictionPosition
      < holds.p.constrictionPosition,
  );
});

test("S, SH, and F sustain place-colored frication without stop bursts", () => {
  const held = Object.fromEntries(
    ["s", "sh", "f"].map((id) => [id, consonantVoiceParameters(id, "hold")]),
  );
  assert.deepEqual(
    [held.s.place, held.sh.place, held.f.place],
    ["alveolar", "postalveolar", "labiodental"],
  );
  for (const id of ["s", "sh", "f"]) {
    assert.equal(held[id].manner, "fricative");
    assert.ok(held[id].oralClosure > 0.3 && held[id].oralClosure < 0.75);
    assert.ok(held[id].fricationGain > 0);
    assert.equal(held[id].burstGain, 0);
    assert.equal(held[id].nasalGain, 0);
    assert.equal(consonantVoiceParameters(id, "release").fricationGain, 0);
  }
  assert.ok(
    held.f.fricationFrequency
      < held.sh.fricationFrequency
      && held.sh.fricationFrequency
      < held.s.fricationFrequency,
    "F, SH, and S need progressively brighter noise bands",
  );
  assert.ok(held.f.fricationQ < held.sh.fricationQ);
  assert.ok(held.sh.fricationQ < held.s.fricationQ);
});

test("M, N, and NG seal different oral places while coupling voiced nasal paths", () => {
  const held = Object.fromEntries(
    ["m", "n", "ng"].map((id) => [id, consonantVoiceParameters(id, "hold")]),
  );
  assert.deepEqual(
    [held.m.place, held.n.place, held.ng.place],
    ["bilabial", "alveolar", "velar"],
  );
  for (const id of ["m", "n", "ng"]) {
    assert.equal(held[id].manner, "nasal");
    assert.equal(held[id].voiced, true);
    assert.equal(held[id].voicingGain, 1);
    assert.equal(held[id].oralClosure, 1);
    assert.ok(held[id].nasalCoupling >= 0.85);
    assert.ok(held[id].nasalGain >= 0.9);
    assert.equal(held[id].fricationGain, 0);
    assert.equal(held[id].burstGain, 0);
    const released = consonantVoiceParameters(id, "release");
    assert.equal(released.oralClosure, 0);
    assert.equal(released.nasalGain, 0);
    assert.equal(released.nasalCoupling, 0);
    assert.equal(released.voicingGain, 0);
  }
  assert.equal(
    new Set(
      Object.values(held).map((voice) => voice.nasalNotchFrequency.toFixed(3)),
    ).size,
    3,
    "nasal antiresonance must change with oral place",
  );
  assert.ok(
    held.ng.constrictionPosition
      < held.n.constrictionPosition
      && held.n.constrictionPosition
      < held.m.constrictionPosition,
  );
});

test("consonant event parameters are phase-aware and sample-rate safe", () => {
  const attack = consonantVoiceParameters("sh", "attack", 48_000);
  const hold = consonantVoiceParameters("sh", "hold", 48_000);
  assert.ok(attack.fricationGain > 0 && attack.fricationGain < hold.fricationGain);
  assert.equal(consonantVoiceParameters("sh", "unknown").phase, "hold");

  const lowRate = consonantVoiceParameters("s", "hold", 8_000);
  assert.ok(lowRate.fricationFrequency <= 3_600);
  assert.ok(lowRate.burstFrequency <= 3_600);
  assert.ok(lowRate.nasalNotchFrequency <= 3_600);
  assert.equal(consonantVoiceParameters("S", 8_000).fricationFrequency, 3_600);
  assert.equal(consonantVoiceParameters("not-a-consonant"), null);
});

test("alien tongue gestures carve a recognizable vowel space", () => {
  const a = throatVoiceParameters(stateWithPhoneme("a"), 0);
  const i = throatVoiceParameters(stateWithPhoneme("i"), 0);
  const u = throatVoiceParameters(stateWithPhoneme("u"), 0);

  assert.ok(
    i.formants[1] > u.formants[1] + 250,
    `front I needs a higher second formant than back U (${i.formants[1]} vs ${u.formants[1]})`,
  );
  assert.ok(
    a.formants[0] > i.formants[0],
    `open A needs a higher first formant than high I (${a.formants[0]} vs ${i.formants[0]})`,
  );
  assert.ok(
    a.formants[0] > u.formants[0],
    `open A needs a higher first formant than high U (${a.formants[0]} vs ${u.formants[0]})`,
  );
});

test("oral closures seal the mouth while nasal branches retain excitation", () => {
  assert.equal(oralOpening(0), 1);
  assert.ok(oralOpening(PHONEMES.s.oralClosure) > 0.5, "S must retain an oral frication path");
  assert.ok(oralOpening(PHONEMES.k.oralClosure) < 0.03, "K must form a near-total stop");
  assert.equal(oralOpening(PHONEMES.m.oralClosure), 0, "M must fully seal the oral path");
  assert.equal(fricationOpening(PHONEMES.s.oralClosure), 1);
  assert.ok(fricationOpening(PHONEMES.k.oralClosure) < 0.06);
  assert.equal(fricationOpening(PHONEMES.m.oralClosure), 0);

  const open = stateWithPhoneme("a");
  const nasal = stateWithPhoneme("m");
  assert.equal(throatVoiceParameters(nasal, 0).oralGain, 0);
  const openNasalGain = Array.from(
    { length: MAX_NOSES },
    (_, index) => noseVoiceParameters(open, index).gain,
  ).reduce((sum, gain) => sum + gain, 0);
  const closedNasalGain = Array.from(
    { length: MAX_NOSES },
    (_, index) => noseVoiceParameters(nasal, index).gain,
  ).reduce((sum, gain) => sum + gain, 0);
  assert.ok(
    closedNasalGain > openNasalGain * 50,
    "closing the mouth for M must leave a strong independent nasal path",
  );
});

test("each alien nose maps to bounded resonator parameters", () => {
  const state = specimenState("triune");
  state.noseCount = MAX_NOSES;
  const voices = Array.from(
    { length: MAX_NOSES },
    (_, index) => noseVoiceParameters(state, index, 48_000),
  );

  for (const [index, voice] of voices.entries()) {
    for (const parameter of [
      "poleFrequency",
      "poleQ",
      "notchFrequency",
      "notchQ",
      "lowpass",
      "delay",
      "gain",
      "pan",
    ]) {
      assert.ok(Number.isFinite(voice[parameter]), `nose ${index} ${parameter} must be finite`);
    }
    assert.ok(voice.poleFrequency >= 80 && voice.poleFrequency <= 21_600);
    assert.ok(voice.notchFrequency >= 80 && voice.notchFrequency <= 21_600);
    assert.ok(voice.lowpass >= 80 && voice.lowpass <= 21_600);
    assert.ok(voice.poleQ > 0 && voice.poleQ <= 30);
    assert.ok(voice.notchQ > 0 && voice.notchQ <= 30);
    assert.ok(voice.delay >= 0 && voice.delay <= 0.1);
    assert.ok(voice.gain >= 0 && voice.gain <= 1);
    assert.ok(voice.pan >= -1 && voice.pan <= 1);
  }
  assert.ok(new Set(voices.map((voice) => voice.poleFrequency.toFixed(3))).size > 1);

  state.noseCount = 1;
  assert.equal(noseVoiceParameters(state, 1).gain, 0);
  assert.equal(noseVoiceParameters(state, 2).gain, 0);
});

test("glottal coefficients and samples stay finite while tenseness changes the waveform", () => {
  const tensions = [0, 0.5, 1];
  const coefficientSets = tensions.map((tenseness) => glottalCoefficients(tenseness));

  for (const coefficients of coefficientSets) {
    assert.ok(Object.values(coefficients).every(Number.isFinite));
    assert.ok(coefficients.te > 0 && coefficients.te < 1);
    assert.ok(coefficients.delta > 0);
  }
  assert.ok(coefficientSets[0].te > coefficientSets[1].te);
  assert.ok(coefficientSets[1].te > coefficientSets[2].te);

  const phases = Array.from({ length: 128 }, (_, index) => index / 128);
  const breathy = phases.map((phase) => glottalSample(phase, 0));
  const pressed = phases.map((phase) => glottalSample(phase, 1));
  assert.ok(breathy.every(Number.isFinite));
  assert.ok(pressed.every(Number.isFinite));
  assert.ok(new Set(breathy.map((sample) => sample.toFixed(6))).size > 64);
  assert.notDeepEqual(breathy, pressed);
  assert.ok(Math.max(...breathy) > 0 && Math.min(...breathy) < 0);
  assert.ok(Math.max(...pressed) > 0 && Math.min(...pressed) < 0);
  assert.ok(Math.abs(glottalSample(-0.25, 0.6) - glottalSample(0.75, 0.6)) < 1e-12);
});

test("glottal harmonics are finite, bounded in size, and vary with tenseness", () => {
  const breathy = glottalHarmonics(0.1, 24, 256);
  const pressed = glottalHarmonics(0.9, 24, 256);

  for (const spectrum of [breathy, pressed]) {
    assert.equal(spectrum.real.length, 25);
    assert.equal(spectrum.imaginary.length, 25);
    assert.ok(Array.from(spectrum.real).every(Number.isFinite));
    assert.ok(Array.from(spectrum.imaginary).every(Number.isFinite));
    assert.equal(spectrum.real[0], 0);
    assert.equal(spectrum.imaginary[0], 0);
    const energy = Array.from(
      spectrum.real,
      (real, index) => real ** 2 + spectrum.imaginary[index] ** 2,
    ).reduce((sum, value) => sum + value, 0);
    assert.ok(energy > 0.01);
  }

  assert.notDeepEqual(Array.from(breathy.real), Array.from(pressed.real));
  assert.notDeepEqual(Array.from(breathy.imaginary), Array.from(pressed.imaginary));
});

test("input envelope smoothing follows attacks faster than releases", () => {
  assert.equal(smoothEnvelope(0.25, 0.75, 0), 0.25);
  const attacked = smoothEnvelope(0, 1, 80, 45, 360);
  const released = smoothEnvelope(1, 0, 80, 45, 360);
  assert.ok(Number.isFinite(attacked) && attacked > 0 && attacked < 1);
  assert.ok(Number.isFinite(released) && released > 0 && released < 1);
  assert.ok(attacked > 1 - released, "attack should traverse more of the gap than release");
  assert.ok(smoothEnvelope(-1, Number.NaN, 16) >= 0);
});

test("throat slots are centered, ordered, and span alien branch space", () => {
  assert.deepEqual(throatSlots(1), [0]);
  for (let count = 2; count <= MAX_THROATS; count += 1) {
    const slots = throatSlots(count);
    assert.equal(slots.length, count);
    assert.ok(slots[0] < 0);
    assert.ok(slots.at(-1) > 0);
    assert.ok(Math.abs(slots[0] + slots.at(-1)) < 1e-9);
    for (let index = 1; index < slots.length; index += 1) {
      assert.ok(slots[index] > slots[index - 1]);
    }
  }
});

test("geometry maps every throat to safe real-time formant parameters", () => {
  const state = specimenState("hive");
  const voices = Array.from(
    { length: state.throatCount },
    (_, index) => throatVoiceParameters(state, index, 48_000),
  );

  for (const voice of voices) {
    assert.equal(voice.formants.length, 4);
    for (const frequency of voice.formants) {
      assert.ok(frequency >= 80 && frequency <= 21_600);
    }
    assert.ok(voice.highpass >= 48);
    assert.ok(voice.lowpass <= 21_600);
    assert.ok(voice.resonance > 2);
    assert.ok(voice.ringMix >= 0 && voice.ringMix < 1);
    assert.ok(voice.gain > 0 && voice.gain <= 1);
    assert.ok(voice.pan >= -1 && voice.pan <= 1);
    assert.ok(voice.oralGain >= 0 && voice.oralGain <= 1);
    assert.ok(voice.contact >= 0 && voice.contact <= 1);
    assert.ok(
      Number.isFinite(voice.turbulenceFrequency)
        && voice.turbulenceFrequency >= 80
        && voice.turbulenceFrequency <= 21_600,
    );
    assert.ok(Number.isInteger(voice.tongueIndex));
    assert.ok(voice.tongueIndex >= 0 && voice.tongueIndex < MAX_TONGUES);
  }

  assert.equal(voices[0].pan, -1);
  assert.equal(voices.at(-1).pan, 1);
  assert.ok(voices.every((voice) => Math.abs(voice.gain - 1 / Math.sqrt(5)) < 1e-9));

  state.throats[2].muted = true;
  assert.equal(throatVoiceParameters(state, 2).gain, 0);
});

test("every active tongue contributes even when tongues outnumber throats", () => {
  const state = specimenState("triune");
  state.throatCount = 1;
  state.tongueCount = MAX_TONGUES;
  const before = throatVoiceParameters(state, 0);
  state.tongues[MAX_TONGUES - 1] = {
    position: 1,
    height: 1,
    curl: 1,
  };
  const after = throatVoiceParameters(state, 0);
  assert.notDeepEqual(after.formants, before.formants);
});

test("longer bodies and local throats lower the primary resonances", () => {
  const short = specimenState("triune");
  short.bodyLength = 0.1;
  short.throats[0].length = 0.1;
  const long = specimenState("triune");
  long.bodyLength = 0.9;
  long.throats[0].length = 0.9;

  const shortVoice = throatVoiceParameters(short, 0);
  const longVoice = throatVoiceParameters(long, 0);
  assert.ok(longVoice.formants[0] < shortVoice.formants[0]);
  assert.ok(longVoice.formants[1] < shortVoice.formants[1]);
});

test("waveform analysis reports RMS and peak without leaking invalid input", () => {
  assert.deepEqual(waveformLevel(new Float32Array()), { rms: 0, peak: 0 });
  const measured = waveformLevel(Float32Array.from([0.5, -0.5, 0.5, -0.5]));
  assert.ok(Math.abs(measured.rms - 0.5) < 1e-9);
  assert.equal(measured.peak, 0.5);
});
