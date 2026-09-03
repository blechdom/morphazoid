import assert from "node:assert/strict";
import test from "node:test";

const registeredProcessors = new Map();

globalThis.sampleRate = 48_000;
globalThis.currentFrame = 0;
globalThis.AudioWorkletProcessor = class {
  constructor() {
    const messages = [];
    this.port = {
      messages,
      onmessage: null,
      postMessage(message) {
        messages.push(message);
      },
    };
  }
};
globalThis.registerProcessor = (name, Processor) => {
  registeredProcessors.set(name, Processor);
};

const { CreaturazoidPhysicalProcessor } = await import(
  "../src/creaturazoid-processor.js?creaturazoid-processor-test=1"
);
const {
  CREATURAZOID_BODY_PRESETS,
  creaturazoidBodyPreset,
  creaturazoidBodyLevelTrim,
  creaturazoidLevelMakeup,
  creaturazoidSound,
  creaturazoidState,
  resolveCreaturazoidEventState,
} = await import("../src/creaturazoid.js?creaturazoid-processor-integration-test=1");
const {
  ANIMALS,
  clamp: clampSyrinx,
  resolveSourceControls,
  resolveSyrinxPresetGain,
} = await import("../src/syrinx.js?creaturazoid-processor-integration-test=1");
const { tongueAirwayAperture } = await import(
  "../src/tongue-physics.js?creaturazoid-processor-integration-test=1"
);

const FAMILY_OUTPUT_TRIM = Object.freeze({
  mammal: 1,
  bird: 0.82,
  frog: 0.88,
  rodent: 0.72,
});

function configuration(pressure, voiceCount = 7) {
  return {
    source: {
      model: "syrinx",
      pressure,
      frequencyHz: 720,
      voiceCount,
    },
    tract: {
      animalId: "raven",
      model: "syrinx",
      tractLengthM: 0.17,
      mouthOpening: 0.52,
      cavityCoupling: 0.34,
    },
  };
}

function processor(initialConfiguration = configuration(0, 1)) {
  return new CreaturazoidPhysicalProcessor({
    processorOptions: {
      configuration: initialConfiguration,
    },
  });
}

function render(instance, frame) {
  globalThis.currentFrame = frame;
  const output = [new Float32Array(128), new Float32Array(128)];
  assert.equal(instance.process([], [output], {}), true);
  for (const channel of output) {
    assert.ok(channel.every(Number.isFinite));
  }
  return output;
}

function contact(kind = "hoof") {
  return {
    kind,
    soundId: `test-${kind}`,
    durationMs: 240,
    bodyScale: 1.2,
    bodyRoundness: 0.55,
    tractLengthM: 0.32,
    cavityFrequencyHz: 180,
    gain: 1.1,
    brightness: 0.24,
    scrapeRateHz: 0,
    scrapeGain: [[0, 0], [1, 0]],
    strikes: [{ phase: 0, gain: 1, modeRatio: 0.7, noiseMix: 0.42, decayMs: 180, pan: -0.2 }],
  };
}

function rms(channel) {
  return Math.sqrt(channel.reduce((sum, sample) => sum + sample * sample, 0) / channel.length);
}

function rhythmicConfiguration(soundId, bodyPresetId, velocity = 1) {
  const sound = creaturazoidSound(soundId);
  const state = creaturazoidState(bodyPresetId);
  const body = creaturazoidBodyPreset(bodyPresetId);
  const performanceState = resolveCreaturazoidEventState(sound, {
    state,
    phase: 0,
    elapsedSeconds: 0,
    velocity,
    sequenced: true,
  });
  const animal = ANIMALS[performanceState.animalId];
  const articulation = performanceState.articulation ?? {};
  const articulationGate = clampSyrinx(articulation.airwayGate ?? 1);
  const tongueAperture = tongueAirwayAperture(performanceState.tongue);
  const tongueGateDepth = articulation.motion === "lap" || articulation.motion === "crunch"
    ? 0.78
    : articulation.motion === "pant" || performanceState.sourceFamily === "bird"
      ? 0.34
      : 0.16;
  const tongueGate = 1 - (1 - tongueAperture) * tongueGateDepth;
  const effectiveAirwayGate = Math.min(articulationGate, tongueGate);
  return {
    sound,
    configuration: {
      source: {
        ...resolveSourceControls(performanceState),
        outputGain: clampSyrinx(0.82
          * (FAMILY_OUTPUT_TRIM[animal.model] ?? 0.82)
          * resolveSyrinxPresetGain(performanceState)
          * clampSyrinx(articulation.sourceGain ?? 1, 0, 1.5), 0, 1.5),
        voiceCount: 1,
        voiceSpreadCents: 0,
      },
      tract: {
        animalId: animal.id,
        model: animal.model,
        tractLengthM: performanceState.tractLengthM,
        tractDiameterProfile: performanceState.tractDiameterProfile
          ?? state.tractDiameterProfile
          ?? body.tractDiameterProfile,
        tractDiameterScale: performanceState.tractDiameterScale
          ?? state.tractDiameterScale
          ?? body.tractDiameterScale,
        mouthOpening: performanceState.mouthOpening,
        cavityCoupling: performanceState.cavityCoupling,
        cavityFrequencyHz: performanceState.cavityFrequencyHz
          ?? state.cavityFrequencyHz
          ?? body.cavityFrequencyHz,
        cavityBranches: 2,
        ...performanceState.tongue,
        earSpread: state.earSpread,
        airwayGate: effectiveAirwayGate,
        lateralBypass: 0,
        turbulence: clampSyrinx(
          performanceState.roughness * 0.16 + (articulation.turbulence ?? 0),
          0,
          1.5,
        ),
        articulationVoicing: clampSyrinx(articulation.voicing ?? 1),
        articulationPressure: performanceState.active
          ? performanceState.pressure * clampSyrinx(articulation.pressure ?? 1)
          : 0,
        burstGain: clampSyrinx(articulation.burstGain ?? 0, 0, 1.5),
        burstFrequencyHz: clampSyrinx(articulation.burstFrequencyHz ?? 1_050, 80, 12_000),
        onsetBurstPrime: performanceState.sequenced
          && performanceState.gesturePhase <= 0.0001
          && effectiveAirwayGate >= 0.2
          ? clampSyrinx(
            Math.sqrt(clampSyrinx(articulation.pressure ?? 0))
              * clampSyrinx(articulation.burstGain ?? 0, 0, 1.5)
              * (0.24 + clampSyrinx(performanceState.velocity ?? 1) * 0.76)
              * 0.78,
            0,
            1.1,
          )
          : 0,
        flowDirection: Number(articulation.flowDirection) < 0 ? -1 : 1,
        flutterHz: Math.max(
          clampSyrinx(articulation.flutterHz ?? 0, 0, 60),
          body.modulationTarget === "beak" ? state.modulationRateHz : 0,
        ),
        flutterDepth: Math.max(
          clampSyrinx(articulation.flutterDepth ?? 0),
          body.modulationTarget === "beak" ? state.modulationDepth * 0.16 : 0,
        ),
        sourceBalance: performanceState.sourceBalance * 2 - 1,
        asymmetry: performanceState.asymmetry,
      },
      resetTract: false,
    },
  };
}

function renderContactBlocks(
  profile,
  blockCount = 1,
  soundId = "test-contact",
  velocity = 1,
  makeupGain = 1,
) {
  const instance = processor();
  instance._handleCreatureMessage({
    type: "schedule",
    events: [{
      frame: 0,
      serial: 90,
      begin: true,
      soundId,
      velocity,
      makeupGain,
      contact: profile,
      configuration: configuration(0, 1),
    }],
  });
  const samples = [];
  for (let block = 0; block < blockCount; block += 1) {
    samples.push(...render(instance, block * 128)[0]);
  }
  return { instance, samples };
}

test("resolved tongue motion reaches the inherited Hybrinx tract configuration", () => {
  for (const soundId of ["growl", "chirp", "lapping", "crunching"]) {
    const { configuration: eventConfiguration } = rhythmicConfiguration(soundId, "dense-squat");
    assert.equal(eventConfiguration.tract.tongueEnabled, true);
    assert.equal(eventConfiguration.tract.tongueAnatomy, "canine");
    for (const field of [
      "tonguePosition", "tongueHeight", "tongueShape", "tongueTip",
      "tongueExtension", "tongueCurl", "tongueLateral",
    ]) {
      assert.ok(eventConfiguration.tract[field] >= 0 && eventConfiguration.tract[field] <= 1);
    }

    const instance = processor();
    instance._applyCreatureEvent({
      frame: 0,
      serial: 1,
      begin: true,
      soundId,
      velocity: 1,
      makeupGain: 1,
      bodyGainTrim: 1,
      configuration: eventConfiguration,
    });
    assert.equal(instance.configuration.tongueEnabled, true);
    assert.equal(instance.configuration.tonguePosition, eventConfiguration.tract.tonguePosition);
    assert.equal(instance.configuration.tongueHeight, eventConfiguration.tract.tongueHeight);
  }
});

test("ear width uses matched all-pass paths, preserves mono, and creates a bounded side field", () => {
  const wideConfiguration = configuration(0, 1);
  wideConfiguration.tract = { ...wideConfiguration.tract, earSpread: 1 };
  const wide = processor(wideConfiguration);
  const leftPathLengths = [
    wide.creatureEarLeftA.length,
    wide.creatureEarLeftB.length,
    wide.creatureEarLeftC.length,
  ];
  const rightPathLengths = [
    wide.creatureEarRightA.length,
    wide.creatureEarRightB.length,
    wide.creatureEarRightC.length,
  ];
  assert.notDeepEqual(leftPathLengths, rightPathLengths);
  assert.equal(
    leftPathLengths.reduce((sum, length) => sum + length, 0),
    rightPathLengths.reduce((sum, length) => sum + length, 0),
    "neither ear may receive a shorter total path",
  );

  const input = Float32Array.from(
    { length: 2_048 },
    (_, index) => Math.sin(index * 0.17) * 0.3 + Math.sin(index * 0.047) * 0.17,
  );
  const output = [Float32Array.from(input), Float32Array.from(input)];
  wide.creatureEarAmount = 1;
  wide._applyCreatureEarWidth(output);
  let monoError = 0;
  let sideSquareSum = 0;
  for (let index = 0; index < input.length; index += 1) {
    const midpoint = (output[0][index] + output[1][index]) * 0.5;
    const side = (output[0][index] - output[1][index]) * 0.5;
    monoError = Math.max(monoError, Math.abs(midpoint - input[index]));
    sideSquareSum += side * side;
  }
  assert.ok(monoError < 2e-7, `ear field changed the mono center by ${monoError}`);
  assert.ok(Math.sqrt(sideSquareSum / input.length) > 0.02);
  assert.ok(output.flatMap((channel) => [...channel]).every(Number.isFinite));

  const closed = processor(configuration(0, 1));
  const closedOutput = [Float32Array.from(input), Float32Array.from(input)];
  closed._applyCreatureEarWidth(closedOutput);
  assert.deepEqual(closedOutput[0], input);
  assert.deepEqual(closedOutput[1], input);
});

test("retargeting keeps the active call's terminal release and rejects stale serials", () => {
  const instance = processor();
  instance._handleCreatureMessage({
    type: "schedule",
    events: [
      { frame: 100, serial: 1, begin: true, configuration: configuration(0.8) },
      { frame: 200, serial: 1, configuration: configuration(0.6) },
      { frame: 300, serial: 1, configuration: configuration(0) },
      { frame: 400, serial: 2, begin: true, configuration: configuration(0.7) },
      { frame: 500, serial: 2, configuration: configuration(0) },
    ],
  });

  render(instance, 0);
  assert.equal(instance.activeCreatureSerial, 1);

  instance._handleCreatureMessage({
    type: "retarget",
    serial: 1,
    source: configuration(0.33).source,
    tract: configuration(0.33).tract,
  });
  assert.deepEqual(
    instance.creatureQueue.map(({ frame, serial, begin }) => ({ frame, serial, begin })),
    [
      { frame: 300, serial: 1, begin: false },
      { frame: 400, serial: 2, begin: true },
      { frame: 500, serial: 2, begin: false },
    ],
  );
  assert.equal(instance.sources[0].target.pressure, 0.33);
  assert.equal(instance.configuration.voiceCount, 1);

  instance._handleCreatureMessage({
    type: "retarget",
    serial: 0,
    source: configuration(0.99).source,
    tract: configuration(0.99).tract,
  });
  assert.equal(instance.sources[0].target.pressure, 0.33);
  assert.deepEqual(instance.creatureQueue.map(({ frame }) => frame), [300, 400, 500]);

  instance._handleCreatureMessage({
    type: "retarget",
    serial: 2,
    source: configuration(0.99).source,
    tract: configuration(0.99).tract,
  });
  assert.equal(instance.sources[0].target.pressure, 0.33);
  assert.deepEqual(instance.creatureQueue.map(({ frame }) => frame), [300, 400, 500]);

  render(instance, 256);
  assert.equal(instance.sources[0].target.pressure, 0);
  assert.equal(instance.configuration.voiceCount, 1);
});

test("a newer onset prunes the displaced tail and every applied event stays single-voice", () => {
  const instance = processor();
  instance._handleCreatureMessage({
    type: "schedule",
    events: [
      { frame: 100, serial: 10, begin: true, configuration: configuration(0.85) },
      { frame: 220, serial: 10, configuration: configuration(0.7) },
      { frame: 460, serial: 10, configuration: configuration(0) },
    ],
  });
  instance._handleCreatureMessage({
    type: "schedule",
    events: [
      { frame: 300, serial: 11, begin: true, configuration: configuration(0.5) },
      { frame: 420, serial: 11, configuration: configuration(0) },
    ],
  });

  assert.deepEqual(
    instance.creatureQueue.map(({ frame, serial }) => ({ frame, serial })),
    [
      { frame: 100, serial: 10 },
      { frame: 220, serial: 10 },
      { frame: 300, serial: 11 },
      { frame: 420, serial: 11 },
    ],
  );

  render(instance, 0);
  instance._handleCreatureMessage({
    type: "retarget",
    serial: 10,
    source: configuration(0.31).source,
    tract: configuration(0.31).tract,
  });
  assert.deepEqual(
    instance.creatureQueue.map(({ frame, serial }) => ({ frame, serial })),
    [
      { frame: 300, serial: 11 },
      { frame: 420, serial: 11 },
    ],
  );
  render(instance, 128);
  assert.equal(instance.sources[0].target.pressure, 0.31);
  render(instance, 256);
  assert.equal(instance.activeCreatureSerial, 11);
  assert.equal(instance.configuration.voiceCount, 1);
  assert.deepEqual(Array.from(instance.voiceTargetGains), [1, 0, 0, 0, 0, 0, 0]);

  render(instance, 384);
  assert.equal(instance.sources[0].target.pressure, 0);
});

test("silence invalidates queued calls and leaves the physical source at rest", () => {
  const instance = processor();
  instance._handleCreatureMessage({
    type: "schedule",
    events: [
      { frame: 100, serial: 20, begin: true, configuration: configuration(0.9) },
      { frame: 300, serial: 20, configuration: configuration(0) },
    ],
  });
  instance._handleCreatureMessage({
    type: "silence",
    serial: 21,
    source: configuration(0.9).source,
    tract: configuration(0.9).tract,
  });

  assert.deepEqual(instance.creatureQueue, []);
  assert.equal(instance.activeCreatureSerial, 21);
  assert.equal(instance.sources[0].target.pressure, 0);
  assert.equal(instance.creatureContact, null);
  assert.equal(instance.configuration.voiceCount, 1);
  assert.deepEqual(instance.port.messages.at(-1), {
    type: "creature-event",
    active: false,
    serial: 21,
  });
});

test("silence de-clicks a boosted live tail without turning attenuation upward", () => {
  const boosted = processor();
  boosted.creatureMakeupGain = 7;
  boosted.creatureMakeupTarget = 7;
  boosted._handleCreatureMessage({
    type: "silence",
    serial: 22,
    source: configuration(0.8, 1).source,
    tract: configuration(0.8, 1).tract,
  });
  assert.equal(boosted.creatureMakeupGain, 7);
  assert.equal(boosted.creatureMakeupTarget, 1);
  assert.equal(boosted.creatureMakeupRampRemaining, Math.round(48_000 * 0.0005));
  render(boosted, 0);
  assert.equal(boosted.creatureMakeupGain, 1);

  const attenuated = processor();
  attenuated.creatureMakeupGain = 0.36;
  attenuated.creatureMakeupTarget = 0.36;
  attenuated._handleCreatureMessage({
    type: "silence",
    serial: 23,
    source: configuration(0.8, 1).source,
    tract: configuration(0.8, 1).tract,
  });
  assert.equal(attenuated.creatureMakeupGain, 0.36);
  assert.equal(attenuated.creatureMakeupTarget, 0.36);
  assert.equal(attenuated.creatureMakeupRampRemaining, 0);
});

test("body-contact gestures render deterministically inside the single physical node", () => {
  const renderContact = () => {
    const instance = processor();
    instance._handleCreatureMessage({
      type: "schedule",
      events: [{
        frame: 0,
        serial: 30,
        begin: true,
        soundId: "hoof-stomp",
        contact: contact(),
        configuration: configuration(0, 1),
      }],
    });
    const output = render(instance, 0);
    assert.ok(instance.creatureContact);
    assert.equal(instance.configuration.voiceCount, 1);
    assert.ok(output[0].some((sample) => Math.abs(sample) > 0.00001));
    return [...output[0]];
  };

  assert.deepEqual(renderContact(), renderContact());
});

test("body-contact excitation follows sequencer velocity", () => {
  const quiet = renderContactBlocks(contact(), 1, "hoof-stomp", 0.25).samples;
  const loud = renderContactBlocks(contact(), 1, "hoof-stomp", 1).samples;
  const scrape = {
    ...contact("feather"),
    strikes: [],
    scrapeGain: [[0, 1], [1, 1]],
  };
  const quietScrape = renderContactBlocks(scrape, 1, "feather-ruffle", 0.25).samples;
  const loudScrape = renderContactBlocks(scrape, 1, "feather-ruffle", 1).samples;

  assert.ok(rms(loud) > rms(quiet) * 2.2);
  assert.ok(rms(loudScrape) > rms(quietScrape) * 2.2);
});

test("calibrated makeup raises quiet complete gestures before telemetry", () => {
  const scrape = {
    ...contact("feather"),
    gain: 0.34,
    strikes: [],
    scrapeRateHz: 19,
    scrapeGain: [[0, 1], [1, 1]],
  };
  const reference = renderContactBlocks(scrape, 20, "feather-ruffle", 1, 1);
  const lifted = renderContactBlocks(scrape, 20, "feather-ruffle", 1, 4.14);

  assert.equal(lifted.instance.creatureMakeupTarget, 4.14);
  assert.ok(lifted.instance.creatureMakeupGain > 4.13);
  assert.ok(rms(lifted.samples) > rms(reference.samples) * 3.3);
  assert.ok(
    lifted.instance.port.messages.filter((message) => message.type === "telemetry").at(-1).rms
      > reference.instance.port.messages.filter((message) => message.type === "telemetry").at(-1).rms * 3,
  );
});

test("every onset latches its own makeup without inheriting the previous sound", () => {
  const instance = processor();
  const begin = (serial, makeupGain) => instance._applyCreatureEvent({
    frame: 0,
    serial,
    begin: true,
    sequenced: true,
    soundId: `gain-${makeupGain}`,
    label: "GAIN",
    velocity: 1,
    makeupGain,
    contact: null,
    configuration: configuration(0.72, 1),
  });

  begin(80, 7);
  assert.equal(instance.creatureMakeupGain, 1);
  assert.equal(instance.creatureMakeupRampRemaining, Math.round(48_000 * 0.0005));
  render(instance, 0);
  assert.equal(instance.creatureMakeupGain, 7);
  begin(81, 0.36);
  assert.equal(instance.creatureMakeupGain, 0.36);
  assert.equal(instance.creatureMakeupRampRemaining, 0);
  begin(82, 7);
  assert.equal(instance.creatureMakeupGain, 0.36);
  assert.equal(instance.creatureMakeupRampRemaining, Math.round(48_000 * 0.0005));
  render(instance, 128);
  assert.equal(instance.creatureMakeupGain, 7);
  assert.equal(instance.creatureMakeupTarget, 7);
});

test("body-resonance correction has a separate bounded gain stage", () => {
  const instance = processor();
  instance._handleCreatureMessage({
    type: "schedule",
    events: [{
      frame: 0,
      serial: 83,
      begin: true,
      sequenced: true,
      soundId: "purr",
      velocity: 1,
      makeupGain: 6.8,
      bodyGainTrim: 3.75,
      contact: null,
      configuration: configuration(0, 1),
    }],
  });
  render(instance, 0);

  assert.equal(instance.creatureMakeupTarget, 25.5);
  assert.equal(instance.creatureMakeupGain, 25.5);

  const clamped = processor();
  clamped._handleCreatureMessage({
    type: "schedule",
    events: [{
      frame: 0,
      serial: 84,
      begin: true,
      soundId: "bounded",
      velocity: 1,
      makeupGain: 99,
      bodyGainTrim: 99,
      contact: null,
      configuration: configuration(0, 1),
    }],
  });
  render(clamped, 0);
  assert.equal(clamped.creatureMakeupTarget, 7 * 3.75);

  const attenuated = processor();
  attenuated._handleCreatureMessage({
    type: "schedule",
    events: [{
      frame: 0,
      serial: 85,
      begin: true,
      soundId: "attenuated-body",
      velocity: 1,
      makeupGain: 1,
      bodyGainTrim: -99,
      contact: null,
      configuration: configuration(0, 1),
    }],
  });
  render(attenuated, 0);
  assert.equal(attenuated.creatureMakeupTarget, 0.36);
  assert.equal(attenuated.creatureMakeupGain, 0.36);
});

test("a large body correction cannot amplify the displaced gesture tail", () => {
  const bodyId = "pocket-needle";
  const first = rhythmicConfiguration("yip", bodyId);
  const next = rhythmicConfiguration("purr", bodyId);
  const instance = processor({
    ...first.configuration,
    source: { ...first.configuration.source, pressure: 0 },
  });
  instance._applyCreatureEvent({
    frame: 0,
    serial: 85,
    begin: true,
    sequenced: true,
    soundId: first.sound.id,
    label: first.sound.label,
    velocity: 1,
    makeupGain: creaturazoidLevelMakeup(first.sound),
    bodyGainTrim: creaturazoidBodyLevelTrim(first.sound, bodyId),
    contact: null,
    configuration: first.configuration,
  });
  const priorSamples = [];
  for (let block = 0; block < 24; block += 1) {
    priorSamples.push(...render(instance, block * 128)[0]);
  }
  assert.ok(rms(priorSamples.slice(-512)) > 0.01, "first gesture must leave an audible tail");

  instance._applyCreatureEvent({
    frame: 24 * 128,
    serial: 86,
    begin: true,
    sequenced: true,
    soundId: next.sound.id,
    label: next.sound.label,
    velocity: 1,
    makeupGain: creaturazoidLevelMakeup(next.sound),
    bodyGainTrim: creaturazoidBodyLevelTrim(next.sound, bodyId),
    contact: null,
    configuration: next.configuration,
  });
  assert.equal(instance.creatureMakeupTarget, 25.5);
  assert.equal(instance.creatureMakeupDelayRemaining, Math.round(48_000 * 0.002));
  assert.equal(instance.transitionRemaining, Math.round(48_000 * 0.002));

  const onsetSamples = [];
  for (let block = 24; block < 28; block += 1) {
    onsetSamples.push(...render(instance, block * 128)[0]);
  }
  const onsetRms = rms(onsetSamples);
  const onsetPeak = Math.max(...onsetSamples.map(Math.abs));
  assert.ok(onsetRms < 0.4, `corrected purr transition RMS spiked to ${onsetRms}`);
  assert.ok(onsetPeak < 1, `corrected purr transition peaked at ${onsetPeak}`);
  assert.equal(instance.creatureMakeupGain, 25.5);
});

test("cropped contacts skip discarded strikes and fire an edge strike immediately", () => {
  const cropped = {
    ...contact("tail"),
    durationMs: 1_000,
    startPhase: 0.7,
    strikes: [
      { phase: 0.2, gain: 1, modeRatio: 1, noiseMix: 0.5, decayMs: 80 },
      { phase: 0.7, gain: 1, modeRatio: 8, noiseMix: 0.9, decayMs: 40 },
    ],
  };
  const instance = processor();
  instance._handleCreatureMessage({
    type: "schedule",
    events: [{
      frame: 0,
      serial: 91,
      begin: true,
      soundId: "tail-whip",
      velocity: 1,
      contact: cropped,
      configuration: configuration(0, 1),
    }],
  });
  render(instance, 0);

  assert.equal(instance.creatureContact.nextStrike, 2);
  assert.ok(instance.creatureContactVoices.length > 0);
  assert.ok(instance.creatureContactVoices.every(({ incrementOne }) => incrementOne > 0.02));
  assert.ok(instance.creatureContact.age >= Math.round(0.7 * 48_000) + 128);
});

test("sequenced crops land source pressure on the exact scheduled frame", () => {
  const instance = processor();
  instance.sources[0].current.outputGain = 0;
  instance.sources[0].target.outputGain = 0;
  instance._handleCreatureMessage({
    type: "schedule",
    events: [{
      frame: 0,
      serial: 92,
      begin: true,
      sequenced: true,
      soundId: "rumble",
      velocity: 1,
      makeupGain: 2.2,
      configuration: {
        ...configuration(0.73, 1),
        source: { ...configuration(0.73, 1).source, outputGain: 0.82 },
      },
    }],
  });
  render(instance, 0);

  assert.equal(instance.sources[0].target.pressure, 0.73);
  assert.equal(instance.sources[0].current.pressure, 0.73);
  assert.equal(instance.sources[0].current.outputGain, 0.82);
  assert.equal(instance.creatureMakeupTarget, 2.2);
  assert.equal(instance.creatureMakeupGain, 2.2);
});

test("sequenced cross-family crops bypass the inherited slow model crossfade", () => {
  const instance = processor();
  instance._applyCreatureEvent({
    frame: 0,
    serial: 93,
    begin: true,
    sequenced: true,
    soundId: "roar",
    label: "ROAR",
    velocity: 1,
    makeupGain: 1,
    contact: null,
    configuration: {
      source: {
        model: "twoMass",
        pressure: 0.78,
        frequencyHz: 118,
        outputGain: 0.82,
        voiceCount: 1,
      },
      tract: {
        animalId: "lion",
        model: "mammal",
        tractLengthM: 0.34,
        mouthOpening: 0.58,
        cavityCoupling: 0.4,
      },
    },
  });

  assert.equal(instance.configuration.model, "twoMass");
  assert.equal(instance.transitionRemaining, Math.round(48_000 * 0.002));
  assert.ok(instance.transitionRemaining < instance.transitionLength);
  assert.equal(instance.sources[0].current.pressure, 0.78);
  assert.equal(instance.sources[0].current.outputGain, 0.82);
});

test("cropped release primes are normalized before quiet-call makeup", () => {
  const { sound, configuration: eventConfiguration } = rhythmicConfiguration(
    "caw",
    "colossal-barrel",
  );
  const rawPrime = eventConfiguration.tract.onsetBurstPrime;
  const makeupGain = creaturazoidLevelMakeup(sound);
  assert.ok(rawPrime > 0.2);
  assert.ok(makeupGain > 1);

  const instance = processor(eventConfiguration);
  instance.creatureMakeupGain = makeupGain;
  instance.creatureMakeupTarget = makeupGain;
  instance.previousAirwayGate = 0.02;
  instance.currentAirwayGate = 0.02;
  instance._applyCreatureEvent({
    frame: 0,
    serial: 940,
    begin: true,
    sequenced: true,
    soundId: sound.id,
    label: sound.label,
    velocity: 1,
    makeupGain,
    bodyGainTrim: 1,
    contact: null,
    configuration: eventConfiguration,
  });

  assert.ok(instance.transientStrength > 0);
  assert.ok(instance.transientStrength <= rawPrime / makeupGain + 1e-12);
  assert.ok(instance.transientStrength < rawPrime * 0.2);

  const primedStrength = instance.transientStrength;
  instance._propagate(0);
  assert.equal(instance.transientStrength, primedStrength);
  assert.ok(instance.transientAge > 0);
});

test("cropped release primes preserve sequencer step dynamics", () => {
  const lowVelocity = 0.42;
  const low = rhythmicConfiguration("snap-bark", "dense-squat", lowVelocity);
  const high = rhythmicConfiguration("snap-bark", "dense-squat", 1);
  const expectedRatio = 0.24 + lowVelocity * 0.76;

  assert.ok(high.configuration.tract.onsetBurstPrime > 0);
  assert.ok(Math.abs(
    low.configuration.tract.onsetBurstPrime
      / high.configuration.tract.onsetBurstPrime
      - expectedRatio,
  ) < 1e-12);

  const applyPrime = ({ sound, configuration: eventConfiguration }, velocity, serial) => {
    const makeupGain = creaturazoidLevelMakeup(sound);
    const instance = processor(eventConfiguration);
    instance.creatureMakeupGain = makeupGain;
    instance.creatureMakeupTarget = makeupGain;
    instance.previousAirwayGate = 0.02;
    instance.currentAirwayGate = 0.02;
    instance._applyCreatureEvent({
      frame: 0,
      serial,
      begin: true,
      sequenced: true,
      soundId: sound.id,
      label: sound.label,
      velocity,
      makeupGain,
      bodyGainTrim: 1,
      contact: null,
      configuration: eventConfiguration,
    });
    instance._propagate(0);
    return instance.transientStrength;
  };

  const lowStrength = applyPrime(low, lowVelocity, 941);
  const highStrength = applyPrime(high, 1, 942);
  assert.ok(highStrength > lowStrength * 1.7);
});

test("scheduled caw onsets stay audible and bounded under their full makeup across every body", () => {
  const measurements = [];
  for (const [bodyIndex, body] of CREATURAZOID_BODY_PRESETS.entries()) {
    const { sound, configuration: eventConfiguration } = rhythmicConfiguration("caw", body.id);
    const makeupGain = creaturazoidLevelMakeup(sound);
    assert.equal(makeupGain, 7);
    const instance = processor(eventConfiguration);
    instance._handleCreatureMessage({
      type: "schedule",
      events: [{
        frame: 0,
        serial: 950 + bodyIndex,
        begin: true,
        sequenced: true,
        soundId: sound.id,
        label: sound.label,
        velocity: 1,
        makeupGain,
        bodyGainTrim: creaturazoidBodyLevelTrim(sound, body.id),
        contact: null,
        configuration: eventConfiguration,
      }],
    });
    const samples = [];
    for (let block = 0; block < 4; block += 1) {
      const output = render(instance, block * 128);
      samples.push(...output[0], ...output[1]);
    }
    measurements.push({
      id: body.id,
      rms: rms(samples),
      peak: Math.max(...samples.map(Math.abs)),
    });
  }

  const summary = Object.fromEntries(measurements.map(({ id, rms: onsetRms, peak }) => [id, { rms: onsetRms, peak }]));
  const quietest = measurements.reduce((left, right) => left.rms < right.rms ? left : right);
  const loudest = measurements.reduce((left, right) => left.rms > right.rms ? left : right);
  const sharpest = measurements.reduce((left, right) => left.peak > right.peak ? left : right);
  assert.ok(quietest.rms > 0.012, `${quietest.id} caw onset RMS was ${quietest.rms}; ${JSON.stringify(summary)}`);
  assert.ok(loudest.rms < 0.45, `${loudest.id} caw onset RMS spiked to ${loudest.rms}; ${JSON.stringify(summary)}`);
  assert.ok(sharpest.peak < 0.95, `${sharpest.id} caw onset peaked at ${sharpest.peak}; ${JSON.stringify(summary)}`);
});

test("cropped mouse whistles put useful energy on the beat without level spikes", () => {
  const measurements = [];
  for (const body of CREATURAZOID_BODY_PRESETS) {
    for (const soundId of ["sweep", "ticks"]) {
      const { sound, configuration: eventConfiguration } = rhythmicConfiguration(soundId, body.id);
      const instance = processor({
        ...eventConfiguration,
        source: {
          ...eventConfiguration.source,
          model: "twoMass",
          pressure: 0,
          frequencyHz: 110,
        },
      });
      instance._handleCreatureMessage({
        type: "schedule",
        events: [{
          frame: 0,
          serial: 94,
          begin: true,
          sequenced: true,
          soundId,
          label: sound.label,
          velocity: 1,
          makeupGain: creaturazoidLevelMakeup(sound),
          bodyGainTrim: creaturazoidBodyLevelTrim(sound, body.id),
          contact: null,
          configuration: eventConfiguration,
        }],
      });
      const samples = [];
      for (let block = 0; block < 4; block += 1) {
        samples.push(...render(instance, block * 128)[0]);
      }

      const onsetRms = rms(samples);
      const onsetPeak = Math.max(...samples.map(Math.abs));
      measurements.push({
        id: `${body.id}/${soundId}`,
        rms: onsetRms,
        peak: onsetPeak,
        amplitude: instance.sources[0].whistleAmplitude,
      });
    }
  }
  const summary = Object.fromEntries(measurements.map(({ id, rms: onsetRms }) => [id, onsetRms]));
  const quietest = measurements.reduce((left, right) => left.rms < right.rms ? left : right);
  const loudest = measurements.reduce((left, right) => left.rms > right.rms ? left : right);
  const sharpest = measurements.reduce((left, right) => left.peak > right.peak ? left : right);
  assert.ok(measurements.every(({ amplitude }) => amplitude >= 0.08));
  assert.ok(quietest.rms > 0.02, `${quietest.id} first 10.7 ms RMS was ${quietest.rms}; ${JSON.stringify(summary)}`);
  assert.ok(loudest.rms < 0.18, `${loudest.id} first 10.7 ms RMS spiked to ${loudest.rms}; ${JSON.stringify(summary)}`);
  assert.ok(sharpest.peak < 0.5, `${sharpest.id} first 10.7 ms peaked at ${sharpest.peak}`);
});

test("cropped pant and feather gestures put voiced body energy on their beat edge", () => {
  const measurements = [];
  for (const body of CREATURAZOID_BODY_PRESETS) {
    for (const soundId of ["panting", "feather-ruffle"]) {
      const { sound, configuration: eventConfiguration } = rhythmicConfiguration(soundId, body.id);
      const instance = processor({
        ...eventConfiguration,
        source: { ...eventConfiguration.source, pressure: 0 },
      });
      instance._handleCreatureMessage({
        type: "schedule",
        events: [{
          frame: 0,
          serial: 95,
          begin: true,
          sequenced: true,
          soundId,
          label: sound.label,
          velocity: 1,
          makeupGain: creaturazoidLevelMakeup(sound),
          bodyGainTrim: creaturazoidBodyLevelTrim(sound, body.id),
          contact: null,
          configuration: eventConfiguration,
        }],
      });
      const samples = [];
      for (let block = 0; block < 4; block += 1) {
        samples.push(...render(instance, block * 128)[0]);
      }
      measurements.push({
        id: `${body.id}/${soundId}`,
        rms: rms(samples),
        peak: Math.max(...samples.map(Math.abs)),
      });
    }
  }
  const summary = Object.fromEntries(measurements.map(({ id, rms: onsetRms }) => [id, onsetRms]));
  const quietest = measurements.reduce((left, right) => left.rms < right.rms ? left : right);
  const loudest = measurements.reduce((left, right) => left.rms > right.rms ? left : right);
  const sharpest = measurements.reduce((left, right) => left.peak > right.peak ? left : right);
  assert.ok(quietest.rms > 0.012, `${quietest.id} first 10.7 ms RMS was ${quietest.rms}; ${JSON.stringify(summary)}`);
  assert.ok(loudest.rms < 0.38, `${loudest.id} first 10.7 ms RMS spiked to ${loudest.rms}; ${JSON.stringify(summary)}`);
  assert.ok(sharpest.peak < 0.9, `${sharpest.id} first 10.7 ms peaked at ${sharpest.peak}`);
});

test("continuous scrape and rustle excitation is filtered by the current body and cavity", () => {
  const scrape = {
    ...contact("claw"),
    gain: 0.8,
    brightness: 0.52,
    scrapeRateHz: 13,
    scrapeGain: [[0, 1], [1, 0.72]],
    strikes: [],
  };
  const small = renderContactBlocks({
    ...scrape,
    bodyScale: 0.5,
    bodyRoundness: -0.7,
    tractLengthM: 0.07,
    cavityFrequencyHz: 940,
  }, 18, "clawing").samples;
  const large = renderContactBlocks({
    ...scrape,
    bodyScale: 1.55,
    bodyRoundness: 0.85,
    tractLengthM: 0.52,
    cavityFrequencyHz: 135,
  }, 18, "clawing").samples;
  const meanDifference = small.reduce((sum, sample, index) => (
    sum + Math.abs(sample - large[index])
  ), 0) / small.length;

  assert.ok(rms(small) > 0.001);
  assert.ok(rms(large) > 0.001);
  assert.ok(meanDifference > 0.002);
});

test("worklet telemetry meters contact excitation after it is mixed", () => {
  const { instance } = renderContactBlocks(contact(), 12, "hoof-stomp");
  const telemetry = instance.port.messages.filter((message) => message.type === "telemetry").at(-1);

  assert.ok(telemetry);
  assert.ok(telemetry.peak > 0.001);
  assert.ok(telemetry.rms > 0.001);
});

test("a newer vocal onset immediately displaces an active contact exciter", () => {
  const instance = processor();
  instance._handleCreatureMessage({
    type: "schedule",
    events: [{
      frame: 0,
      serial: 40,
      begin: true,
      soundId: "clawing",
      contact: { ...contact("claw"), scrapeRateHz: 17, scrapeGain: [[0, 1], [1, 0.5]] },
      configuration: configuration(0, 1),
    }],
  });
  render(instance, 0);
  assert.ok(instance.creatureContact);

  instance._handleCreatureMessage({
    type: "schedule",
    events: [{
      frame: 128,
      serial: 41,
      begin: true,
      soundId: "roar",
      contact: null,
      configuration: configuration(0.8, 1),
    }],
  });
  render(instance, 128);
  assert.equal(instance.activeCreatureSerial, 41);
  assert.equal(instance.creatureContact, null);
});

test("the worklet registers both its inherited Syrinx model and Creaturazoid wrapper", () => {
  assert.ok(registeredProcessors.has("syrinx-physical-model"));
  assert.equal(
    registeredProcessors.get("creaturazoid-physical-model"),
    CreaturazoidPhysicalProcessor,
  );
});
