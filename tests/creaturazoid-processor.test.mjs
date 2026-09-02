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

function processor() {
  return new CreaturazoidPhysicalProcessor({
    processorOptions: {
      configuration: configuration(0, 1),
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

function renderContactBlocks(profile, blockCount = 1, soundId = "test-contact", velocity = 1) {
  const instance = processor();
  instance._handleCreatureMessage({
    type: "schedule",
    events: [{
      frame: 0,
      serial: 90,
      begin: true,
      soundId,
      velocity,
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
