import assert from "node:assert/strict";
import test from "node:test";

import { PHYSICAL_SOUND_PRESETS } from "../src/physical-sounds.js";

const SAMPLE_RATE = 48_000;
const BLOCK_SIZE = 128;

let ProcessorConstructor;
let processorName = "";

globalThis.sampleRate = SAMPLE_RATE;
globalThis.AudioWorkletProcessor = class {
  constructor() {
    this.postedMessages = [];
    this.port = {
      onmessage: null,
      postMessage: (message) => this.postedMessages.push(message),
    };
  }
};
globalThis.registerProcessor = (name, constructor) => {
  processorName = name;
  ProcessorConstructor = constructor;
};

await import(`../src/physical-sounds-processor.js?test=${Date.now()}`);

function createProcessor(kind, configuration = {}, processorOptions = {}) {
  return new ProcessorConstructor({
    processorOptions: { kind, configuration, ...processorOptions },
  });
}

function createProcessorAtSampleRate(kind, configuration, rate) {
  const previousRate = globalThis.sampleRate;
  globalThis.sampleRate = rate;
  try {
    return createProcessor(kind, configuration);
  } finally {
    globalThis.sampleRate = previousRate;
  }
}

function send(processor, data) {
  assert.equal(typeof processor.port.onmessage, "function");
  processor.port.onmessage({ data });
}

function render(processor, blockCount = 1) {
  const left = new Float32Array(blockCount * BLOCK_SIZE);
  const right = new Float32Array(blockCount * BLOCK_SIZE);
  let peak = 0;
  let leftPower = 0;
  let rightPower = 0;
  let stereoDifference = 0;

  for (let block = 0; block < blockCount; block += 1) {
    const blockLeft = new Float32Array(BLOCK_SIZE);
    const blockRight = new Float32Array(BLOCK_SIZE);
    assert.equal(processor.process([], [[blockLeft, blockRight]]), true);
    left.set(blockLeft, block * BLOCK_SIZE);
    right.set(blockRight, block * BLOCK_SIZE);
    for (let frame = 0; frame < BLOCK_SIZE; frame += 1) {
      const leftSample = blockLeft[frame];
      const rightSample = blockRight[frame];
      assert.ok(Number.isFinite(leftSample), "left output must stay finite");
      assert.ok(Number.isFinite(rightSample), "right output must stay finite");
      assert.ok(Math.abs(leftSample) <= 1, "left output must stay soft-clipped");
      assert.ok(Math.abs(rightSample) <= 1, "right output must stay soft-clipped");
      peak = Math.max(peak, Math.abs(leftSample), Math.abs(rightSample));
      leftPower += leftSample * leftSample;
      rightPower += rightSample * rightSample;
      stereoDifference += Math.abs(leftSample - rightSample);
    }
  }

  const sampleCount = Math.max(1, left.length);
  return {
    left,
    right,
    peak,
    leftRms: Math.sqrt(leftPower / sampleCount),
    rightRms: Math.sqrt(rightPower / sampleCount),
    stereoDifference,
  };
}

function assertAudibleStereo(rendered, label) {
  assert.ok(rendered.peak > 1e-7, `${label} should produce an audible signal`);
  assert.ok(rendered.leftRms > 1e-8, `${label} should reach the left channel`);
  assert.ok(rendered.rightRms > 1e-8, `${label} should reach the right channel`);
}

function sampleStats(samples, start = 0) {
  let peak = 0;
  let square = 0;
  let derivativeSquare = 0;
  let hotSamples = 0;
  let previous = samples[Math.max(0, start - 1)] ?? 0;
  const count = Math.max(1, samples.length - start);
  for (let index = start; index < samples.length; index += 1) {
    const sample = samples[index];
    const derivative = sample - previous;
    peak = Math.max(peak, Math.abs(sample));
    if (Math.abs(sample) > 0.8) hotSamples += 1;
    square += sample * sample;
    derivativeSquare += derivative * derivative;
    previous = sample;
  }
  const rms = Math.sqrt(square / count);
  return {
    peak,
    rms,
    crest: peak / Math.max(1e-12, rms),
    brightness: Math.sqrt(derivativeSquare / count) / Math.max(1e-12, rms),
    hotFraction: hotSamples / count,
  };
}

function blocksForSeconds(seconds) {
  return Math.ceil(seconds * SAMPLE_RATE / BLOCK_SIZE);
}

test("the physical sound worklet registers its shared processor", () => {
  assert.equal(processorName, "morphazoid-physical-sounds");
  assert.equal(typeof ProcessorConstructor, "function");
});

test("the worklet preserves a Dentaphone fundamental override across body size", () => {
  const configuration = {
    ...PHYSICAL_SOUND_PRESETS["object-forge"][0].settings,
    size: 4,
    baseFrequencyHz: 1_108.73,
  };
  const processor = createProcessor("object-forge", configuration, {
    fundamentalOverrideHz: 1_108.73,
  });
  assert.ok(Math.abs(processor.fundamentalHz - 1_108.73) < 0.01);
  send(processor, {
    type: "configure",
    configuration: { size: 0.25 },
    fundamentalOverrideHz: 1_108.73,
  });
  assert.ok(Math.abs(processor.fundamentalHz - 1_108.73) < 0.01);
  send(processor, {
    type: "configure",
    configuration: { size: 4 },
    fundamentalOverrideHz: null,
  });
  assert.ok(processor.fundamentalHz < 300);
});

test("all five physical model families produce finite bounded stereo", () => {
  const cases = [
    {
      kind: "particle-cabinet",
      begin(processor) {
        send(processor, {
          type: "gate",
          action: "shake",
          active: true,
          strength: 1,
          position: 0.31,
          hardness: 0.8,
        });
      },
      blocks: 120,
    },
    {
      kind: "impact-ecology",
      begin(processor) {
        send(processor, {
          type: "excite",
          eventType: "strike",
          strength: 1,
          position: 0.37,
          hardness: 0.8,
        });
      },
      blocks: 24,
    },
    {
      kind: "object-forge",
      begin(processor) {
        send(processor, {
          type: "excite",
          eventType: "strike",
          strength: 1,
          position: 0.29,
          hardness: 0.72,
        });
      },
      blocks: 24,
    },
    {
      kind: "bowed-things",
      begin(processor) {
        send(processor, {
          type: "gate",
          action: "bow",
          active: true,
          strength: 0.9,
          position: 0.31,
          hardness: 0.65,
        });
      },
      blocks: 72,
    },
    {
      kind: "airflow-objects",
      begin(processor) {
        send(processor, {
          type: "gate",
          action: "gust",
          active: true,
          strength: 0.9,
          position: 0.5,
          hardness: 0.5,
        });
      },
      blocks: 72,
    },
  ];

  for (const fixture of cases) {
    const processor = createProcessor(fixture.kind);
    assert.ok(processor.modeCount > 0, `${fixture.kind} should install a modal body`);
    fixture.begin(processor);
    assertAudibleStereo(render(processor, fixture.blocks), fixture.kind);
    if (fixture.kind === "particle-cabinet") {
      assert.ok(processor.eventCount > 0, "the shake gate should generate PhISEM collisions");
    }
  }
});

test("Particle Cabinet presets clear a practical loudness floor and sound materially distinct", () => {
  const measurements = new Map();
  for (const preset of PHYSICAL_SOUND_PRESETS["particle-cabinet"]) {
    const configuration = { ...preset.settings, presetId: preset.id };
    const shaker = createProcessor("particle-cabinet", configuration);
    send(shaker, {
      type: "gate",
      action: "shake",
      active: true,
      strength: 1,
      position: 0.43,
      hardness: configuration.roughness,
    });
    const rendered = render(shaker, blocksForSeconds(1.5));
    const stats = sampleStats(rendered.left, Math.floor(SAMPLE_RATE * 0.25));
    assert.ok(stats.rms >= 0.12, `${preset.id} shake should clear a practical output floor`);
    assert.ok(stats.peak >= 0.35, `${preset.id} shake should produce clear transients`);
    assert.ok(stats.peak < 0.9, `${preset.id} shake should retain soft-clip headroom`);
    assert.ok(stats.crest > 2.2, `${preset.id} should retain impact dynamics`);

    const knocker = createProcessor("particle-cabinet", configuration);
    send(knocker, {
      type: "excite",
      eventType: "strike",
      strength: 1,
      position: 0.43,
      hardness: configuration.brightness,
    });
    const knock = render(knocker, blocksForSeconds(0.25));
    assert.ok(knock.peak >= 0.14, `${preset.id} Knock should be immediately audible`);
    render(knocker, blocksForSeconds(0.75));
    assert.equal(knocker.eventCount, 1, `${preset.id} Knock should remain one contact`);
    measurements.set(preset.id, {
      ...stats,
      events: shaker.eventCount,
      fundamentalHz: shaker.fundamentalHz,
    });
  }

  const gourd = measurements.get("gourd-maraca");
  const cabasa = measurements.get("steel-cabasa");
  const coin = measurements.get("coin-tin");
  const rainstick = measurements.get("bamboo-rainstick");
  assert.ok(cabasa.events > coin.events * 8, "cabasa should chatter much faster than coins");
  assert.ok(rainstick.events > coin.events * 10, "rainstick should be a dense granular stream");
  assert.ok(cabasa.brightness > gourd.brightness * 3, "steel contacts should be brighter than seeds");
  assert.equal(
    new Set([...measurements.values()].map(({ fundamentalHz }) => Math.round(fundamentalHz))).size,
    measurements.size,
    "every cabinet should expose a distinct modal fundamental",
  );
  const entries = [...measurements.entries()];
  for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
      const [leftId, left] = entries[leftIndex];
      const [rightId, right] = entries[rightIndex];
      const featureDistance = Math.hypot(
        Math.log2((left.events + 1) / (right.events + 1)),
        Math.log2(left.fundamentalHz / right.fundamentalHz),
        Math.log2(left.brightness / right.brightness),
      );
      assert.ok(
        featureDistance > 0.75,
        `${leftId} and ${rightId} should differ materially in rate, pitch, or contact color`,
      );
    }
  }
});

test("Particle size trades collision density for heavier individual contacts", () => {
  const renderSize = (particleSize) => {
    const preset = PHYSICAL_SOUND_PRESETS["particle-cabinet"][0];
    const processor = createProcessor("particle-cabinet", {
      ...preset.settings,
      presetId: preset.id,
      particleSize,
    });
    send(processor, {
      type: "gate",
      action: "shake",
      active: true,
      strength: 1,
      position: 0.43,
      hardness: 0.6,
    });
    const rendered = render(processor, blocksForSeconds(2));
    return {
      events: processor.eventCount,
      ...sampleStats(rendered.left, Math.floor(SAMPLE_RATE * 0.25)),
    };
  };

  const small = renderSize(0.05);
  const large = renderSize(0.95);
  assert.ok(small.events > large.events * 2, "small particles should collide more often");
  assert.ok(large.rms > small.rms * 1.7, "large particles should transfer more energy per contact");
  assert.ok(large.peak > small.peak * 1.4, "large particles should create heavier peaks");
});

test("Particle count changes collision density without becoming a hidden volume control", () => {
  const renderCount = (objectCount) => {
    const preset = PHYSICAL_SOUND_PRESETS["particle-cabinet"][0];
    const processor = createProcessor("particle-cabinet", {
      ...preset.settings,
      presetId: preset.id,
      objectCount,
    });
    send(processor, {
      type: "gate",
      action: "shake",
      active: true,
      strength: 1,
      position: 0.43,
      hardness: 0.6,
    });
    const rendered = render(processor, blocksForSeconds(4));
    return {
      events: processor.eventCount,
      ...sampleStats(rendered.left, Math.floor(SAMPLE_RATE * 0.5)),
    };
  };

  const one = renderCount(1);
  const many = renderCount(512);
  assert.ok(many.events > one.events * 10, "more objects should create a denser event stream");
  assert.ok(many.rms < one.rms * 2, "count should not create a large unintended level jump");
  assert.ok(one.rms < many.rms * 2, "sparse settings should retain audible individual contacts");
});

test("glass and bell cabinets keep long tails while the gourd settles quickly", () => {
  const tailRms = (presetId) => {
    const preset = PHYSICAL_SOUND_PRESETS["particle-cabinet"]
      .find((entry) => entry.id === presetId);
    const processor = createProcessor("particle-cabinet", {
      ...preset.settings,
      presetId,
    });
    send(processor, {
      type: "gate",
      action: "shake",
      active: true,
      strength: 1,
      position: 0.43,
      hardness: preset.settings.roughness,
    });
    render(processor, blocksForSeconds(0.75));
    send(processor, { type: "gate", action: "shake", active: false });
    const tail = render(processor, blocksForSeconds(0.8));
    return sampleStats(tail.left, Math.floor(SAMPLE_RATE * 0.4)).rms;
  };

  const gourd = tailRms("gourd-maraca");
  const glass = tailRms("pebbles-in-glass");
  const bells = tailRms("sleigh-bells");
  assert.ok(gourd < 0.001, "the damped gourd should settle rather than ring");
  assert.ok(glass > 0.02, "the glass vessel should retain a clear tail");
  assert.ok(bells > 0.02, "sleigh bell modes should continue ringing");
});

test("material system decay lets a rainstick cascade after a dry gourd stops", () => {
  const releaseEvents = (presetId) => {
    const preset = PHYSICAL_SOUND_PRESETS["particle-cabinet"]
      .find((entry) => entry.id === presetId);
    const processor = createProcessor("particle-cabinet", {
      ...preset.settings,
      presetId,
    });
    send(processor, {
      type: "gate",
      action: "shake",
      active: true,
      strength: 1,
      position: 0.43,
      hardness: preset.settings.roughness,
    });
    render(processor, blocksForSeconds(0.75));
    const beforeRelease = processor.eventCount;
    send(processor, { type: "gate", action: "shake", active: false });
    render(processor, blocksForSeconds(0.6));
    return processor.eventCount - beforeRelease;
  };

  const gourd = releaseEvents("gourd-maraca");
  const rainstick = releaseEvents("bamboo-rainstick");
  assert.ok(rainstick > 10, "the rainstick should retain a visible cascade");
  assert.ok(rainstick > gourd * 5, "the rainstick should settle much later than the gourd");
});

test("Particle envelopes and rendered behavior remain stable across sample rates", () => {
  const preset = PHYSICAL_SOUND_PRESETS["particle-cabinet"][0];
  const measurements = new Map();
  for (const rate of [44_100, 48_000, 96_000]) {
    const processor = createProcessorAtSampleRate("particle-cabinet", {
      ...preset.settings,
      presetId: preset.id,
    }, rate);
    send(processor, {
      type: "gate",
      action: "shake",
      active: true,
      strength: 1,
      position: 0.43,
      hardness: preset.settings.roughness,
    });
    const rendered = render(processor, Math.ceil(rate * 4 / BLOCK_SIZE));
    const stats = sampleStats(rendered.left, Math.floor(rate * 0.5));
    const contactFilterTimeSeconds = -1
      / (rate * Math.log(1 - processor.particleNoiseCoefficient));
    measurements.set(rate, {
      eventRate: processor.eventCount / 4,
      rms: stats.rms,
      contactFilterTimeSeconds,
    });
  }

  const reference = measurements.get(48_000);
  for (const [rate, measurement] of measurements) {
    assert.ok(
      Math.abs(measurement.eventRate / reference.eventRate - 1) < 0.2,
      `${rate} Hz should preserve physical collision rate`,
    );
    assert.ok(
      Math.abs(measurement.rms / reference.rms - 1) < 0.3,
      `${rate} Hz should preserve rendered level`,
    );
    assert.ok(
      Math.abs(
        measurement.contactFilterTimeSeconds / reference.contactFilterTimeSeconds - 1,
      ) < 1e-8,
      `${rate} Hz should preserve the contact-filter time constant`,
    );
  }
});

test("every Particle Cabinet preset retains dynamics in high-load legal corners", () => {
  for (const preset of PHYSICAL_SOUND_PRESETS["particle-cabinet"]) {
    const corners = [
      { label: "maximum density and mass", objectCount: 512, particleSize: 1 },
      {
        label: "maximum resonance at reference density",
        objectCount: preset.settings.objectCount,
        particleSize: 0.75,
      },
    ];
    for (const corner of corners) {
      const processor = createProcessor("particle-cabinet", {
        ...preset.settings,
        presetId: preset.id,
        size: 4,
        damping: 0,
        objectCount: corner.objectCount,
        particleSize: corner.particleSize,
        roughness: 1,
        gravity: 2,
        energy: 1,
      });
      send(processor, {
        type: "gate",
        action: "shake",
        active: true,
        strength: 1.5,
        position: 0.43,
        hardness: 1,
      });
      const rendered = render(processor, blocksForSeconds(5));
      const stats = sampleStats(rendered.left, Math.floor(SAMPLE_RATE * 0.5));
      const label = `${preset.id} (${corner.label})`;
      assert.ok(stats.peak < 0.9, `${label} should retain transient headroom`);
      assert.ok(stats.rms < 0.45, `${label} should not pin the output near saturation`);
      assert.ok(stats.hotFraction < 0.01, `${label} should rarely live above 0.8 full scale`);
      assert.ok(processor.eventCount > 20, `${label} should keep producing collisions`);
    }
  }
});

test("live Particle preset changes replace both cabinet modes and contact profile", () => {
  const processor = createProcessor("particle-cabinet", { presetId: "gourd-maraca" });
  const gourdSeed = processor.randomState;
  const gourdNoiseCoefficient = processor.particleNoiseCoefficient;
  assert.ok(Math.abs(processor.fundamentalHz - 315) < 1e-3);

  send(processor, { type: "configure", configuration: { presetId: "sleigh-bells" } });
  assert.ok(Math.abs(processor.fundamentalHz - 820) < 1e-3);
  assert.notEqual(processor.particleNoiseCoefficient, gourdNoiseCoefficient);
  assert.notEqual(processor.randomState, gourdSeed);
  assert.equal(processor.installedPresetId, "sleigh-bells");
});

test("live Particle preset changes smooth the output boundary instead of clicking", () => {
  const preset = PHYSICAL_SOUND_PRESETS["particle-cabinet"][0];
  const processor = createProcessor("particle-cabinet", {
    ...preset.settings,
    presetId: preset.id,
  });
  send(processor, {
    type: "gate",
    action: "shake",
    active: true,
    strength: 1,
    position: 0.43,
    hardness: 0.7,
  });
  let previousSample = 0;
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const block = render(processor);
    previousSample = block.left.at(-1);
    if (Math.abs(previousSample) > 0.04) break;
  }
  assert.ok(Math.abs(previousSample) > 0.04, "fixture should switch during audible output");

  send(processor, { type: "configure", configuration: { presetId: "sleigh-bells" } });
  const transitionLeft = new Float32Array(processor.particleTransitionLength + 1);
  const transitionRight = new Float32Array(processor.particleTransitionLength + 1);
  processor.process([], [[transitionLeft, transitionRight]]);
  assert.ok(
    Math.abs(transitionLeft[0] - previousSample) < 0.01,
    "the first sample after a preset change should continue smoothly",
  );
  assert.ok(
    Math.abs(
      transitionLeft[processor.particleTransitionLength]
        - transitionLeft[processor.particleTransitionLength - 1],
    ) < 0.04,
    "the end of the preset crossfade should not introduce a second click",
  );
  assert.equal(processor.particleTransitionRemaining, 0);
});

test("live Airflow preset changes also crossfade their resonant state", () => {
  const preset = PHYSICAL_SOUND_PRESETS["airflow-objects"]
    .find(({ id }) => id === "roof-wire");
  const processor = createProcessor("airflow-objects", {
    ...preset.settings,
    presetId: preset.id,
  });
  send(processor, {
    type: "gate",
    action: "gust",
    active: true,
    strength: 1,
    position: 0.5,
    hardness: preset.settings.turbulence,
  });
  render(processor, blocksForSeconds(0.5));
  const previousSample = processor.lastOutputLeft;
  assert.ok(Math.abs(previousSample) > 0.04, "fixture should switch during audible output");

  send(processor, { type: "configure", configuration: { presetId: "chimney-tone" } });
  const transitionLeft = new Float32Array(processor.particleTransitionLength + 1);
  const transitionRight = new Float32Array(processor.particleTransitionLength + 1);
  processor.process([], [[transitionLeft, transitionRight]]);
  assert.ok(
    Math.abs(transitionLeft[0] - previousSample) < 0.01,
    "the first Airflow sample after a preset change should continue smoothly",
  );
  assert.ok(
    Math.abs(
      transitionLeft[processor.particleTransitionLength]
        - transitionLeft[processor.particleTransitionLength - 1],
    ) < 0.04,
    "the Airflow preset crossfade should end without a second click",
  );
  assert.equal(processor.particleTransitionRemaining, 0);
});

test("live custom modal structure changes crossfade instead of reinterpreting ringing state", () => {
  const processor = createProcessor("object-forge", { presetId: "wood-bar" });
  const exciteUntilAudibleBoundary = () => {
    send(processor, {
      type: "excite",
      eventType: "strike",
      strength: 1,
      position: 0.37,
      hardness: 0.72,
    });
    for (let attempt = 0; attempt < 500; attempt += 1) {
      render(processor);
      if (Math.abs(processor.lastOutputLeft) > 0.04) return processor.lastOutputLeft;
    }
    assert.fail("fixture should reach an audible custom-bank switch boundary");
  };
  const switchAndAssert = (configuration, label) => {
    const previousSample = exciteUntilAudibleBoundary();
    send(processor, { type: "configure", configuration });
    const transitionLeft = new Float32Array(processor.particleTransitionLength + 1);
    const transitionRight = new Float32Array(processor.particleTransitionLength + 1);
    processor.process([], [[transitionLeft, transitionRight]]);
    assert.ok(
      Math.abs(transitionLeft[0] - previousSample) < 0.01,
      `${label} should continue from the previous audible sample`,
    );
    assert.equal(processor.particleTransitionRemaining, 0);
  };

  const customJson = JSON.stringify({
    name: "single ringing mode",
    modes: [{ ratio: 1, decay: 2.4, gain: 1 }],
  });
  switchAndAssert({ modalJson: customJson, modeCount: 1 }, "preset-to-custom transition");
  switchAndAssert({ modalJson: "", modeCount: 8 }, "custom-to-preset transition");
});

test("Impact Ecology renders a single strike and every scheduled event family", () => {
  const eventTypes = ["bounce", "shatter", "crumple", "roll", "scrape"];

  const strike = createProcessor("impact-ecology");
  send(strike, {
    type: "excite",
    eventType: "strike",
    strength: 0.9,
    position: 0.4,
    hardness: 0.75,
  });
  const struck = render(strike, 16);
  assertAudibleStereo(struck, "single strike");
  assert.equal(strike.eventCount, 1, "one strike should inject one modal event");

  for (const eventType of eventTypes) {
    const processor = createProcessor("impact-ecology");
    send(processor, {
      type: "configure",
      configuration: {
        eventType,
        eventDensity: 180,
        restitution: 0.78,
        hardness: 0.82,
        chaos: 0.64,
      },
    });
    send(processor, {
      type: "excite",
      eventType,
      strength: 1,
      position: 0.36,
      hardness: 0.82,
    });
    const rendered = render(processor, eventType === "bounce" ? 20 : 96);
    assertAudibleStereo(rendered, eventType);
    assert.ok(processor.eventCount > 0, `${eventType} should schedule modal impacts`);
    assert.equal(processor.impactMode, eventType);
  }
});

test("Impact, Object, and Bowed showcase presets clear practical output floors", () => {
  for (const preset of PHYSICAL_SOUND_PRESETS["impact-ecology"]) {
    const processor = createProcessor("impact-ecology", {
      ...preset.settings,
      presetId: preset.id,
    });
    send(processor, {
      type: "excite",
      eventType: preset.settings.eventType,
      strength: 1,
      position: 0.43,
      hardness: preset.settings.hardness,
    });
    const stats = sampleStats(render(processor, blocksForSeconds(1)).left);
    assert.ok(stats.peak >= 0.32, `${preset.id} should produce a clear impact peak`);
  }

  for (const preset of PHYSICAL_SOUND_PRESETS["object-forge"]) {
    const processor = createProcessor("object-forge", {
      ...preset.settings,
      presetId: preset.id,
    });
    send(processor, {
      type: "excite",
      eventType: "strike",
      strength: 1,
      position: 0.43,
      hardness: preset.settings.brightness,
    });
    const stats = sampleStats(render(processor, blocksForSeconds(1)).left);
    assert.ok(stats.peak >= 0.22, `${preset.id} should produce a clear strike peak`);
  }

  for (const preset of PHYSICAL_SOUND_PRESETS["bowed-things"]) {
    const processor = createProcessor("bowed-things", {
      ...preset.settings,
      presetId: preset.id,
    });
    send(processor, {
      type: "gate",
      action: "bow",
      active: true,
      strength: 1,
      position: preset.settings.bowPosition,
      hardness: preset.settings.rosin,
    });
    const stats = sampleStats(
      render(processor, blocksForSeconds(3)).left,
      Math.floor(SAMPLE_RATE * 0.5),
    );
    assert.ok(stats.rms >= 0.09, `${preset.id} bow should sustain above the output floor`);
    assert.ok(stats.peak >= 0.18, `${preset.id} bow should retain audible motion`);
  }
});

test("the shared output guard retains headroom at sustained legal extremes", () => {
  for (const [kind, presetId, action] of [
    ["bowed-things", "singing-bowl", "bow"],
    ["airflow-objects", "chimney-tone", "gust"],
  ]) {
    const preset = PHYSICAL_SOUND_PRESETS[kind].find(({ id }) => id === presetId);
    const processor = createProcessor(kind, {
      ...preset.settings,
      presetId,
      size: 4,
      damping: 0,
      brightness: 1,
      energy: 1,
      airSpeed: 80,
    });
    send(processor, {
      type: "gate",
      action,
      active: true,
      strength: 1.5,
      position: 0.5,
      hardness: 1,
    });
    const stats = sampleStats(
      render(processor, blocksForSeconds(3)).left,
      Math.floor(SAMPLE_RATE * 0.5),
    );
    assert.ok(stats.peak <= 0.751, `${presetId} should retain limiter headroom`);
    assert.equal(stats.hotFraction, 0, `${presetId} should not live at the soft-clip ceiling`);
    assert.ok(stats.rms > 0.1, `${presetId} should remain audible under protection`);
  }
});

test("Impact Ecology honors the full public restitution range", () => {
  for (const restitution of [0.02, 0.18, 0.94, 0.98]) {
    const processor = createProcessor("impact-ecology", { restitution });
    send(processor, {
      type: "excite",
      eventType: "bounce",
      strength: 1,
      position: 0.5,
      hardness: 0.5,
    });
    assert.equal(
      processor.impactVoiceRestitution[processor.impactLastVoice],
      restitution,
    );
  }

  const bounce = createProcessor("impact-ecology", {
    restitution: 0.5,
    eventDensity: 1,
  });
  send(bounce, {
    type: "excite",
    eventType: "bounce",
    strength: 1,
    position: 0.5,
    hardness: 0.5,
  });
  const voice = bounce.impactLastVoice;
  const firstFlight = bounce.impactVoiceInterval[voice];
  bounce._impactExcitation();
  assert.equal(bounce.impactVoiceInterval[voice], firstFlight * 0.5);
});

test("Impact Ecology retriggers layer independent voices inside a fixed pool", () => {
  const processor = createProcessor("impact-ecology", {
    eventDensity: 110,
    restitution: 0.86,
    hardness: 0.78,
    chaos: 0.52,
  });
  const trigger = (eventType, position = 0.4) => send(processor, {
    type: "excite",
    eventType,
    strength: 0.82,
    position,
    hardness: 0.78,
  });

  trigger("bounce", 0.25);
  render(processor, 4);
  const firstVoice = processor.impactVoiceActive.findIndex(Boolean);
  const firstAge = processor.impactVoiceAge[firstVoice];
  assert.ok(firstAge > 0);

  trigger("bounce", 0.72);
  assert.equal(processor.activeImpactVoiceCount, 2, "a retrigger must not overwrite its tail");
  const layeredVoices = Array.from(
    processor.impactVoiceActive,
    (active, index) => active ? index : -1,
  ).filter((index) => index >= 0);
  assert.equal(layeredVoices.length, 2);
  const secondVoice = layeredVoices.find((voice) => voice !== firstVoice);
  assert.equal(processor.impactVoiceAge[secondVoice], 0);

  const layered = render(processor, 4);
  assertAudibleStereo(layered, "layered impact retrigger");
  assert.ok(processor.impactVoiceAge[firstVoice] > processor.impactVoiceAge[secondVoice]);

  for (let triggerIndex = 0; triggerIndex < 20; triggerIndex += 1) {
    trigger(["shatter", "crumple", "roll", "scrape"][triggerIndex % 4], triggerIndex / 20);
  }
  assert.equal(processor.impactVoiceActive.length, 8, "the real-time voice pool must be fixed");
  assert.equal(processor.activeImpactVoiceCount, 8, "the pool should steal rather than grow");
  const saturated = render(processor, 120);
  assertAudibleStereo(saturated, "saturated impact voice pool");
  assert.ok(processor.activeImpactVoiceCount <= 8);
  const telemetry = processor.postedMessages.findLast(({ type }) => type === "telemetry");
  assert.ok(telemetry.impactVoiceCount > 1 && telemetry.impactVoiceCount <= 8);
});

test("shake, bow, and gust gates ramp on and release without non-finite output", () => {
  const fixtures = [
    ["particle-cabinet", "shake", 160],
    ["bowed-things", "bow", 64],
    ["airflow-objects", "gust", 64],
  ];

  for (const [kind, action, attackBlocks] of fixtures) {
    const processor = createProcessor(kind);
    send(processor, {
      type: "gate",
      action,
      active: true,
      strength: 0.88,
      position: 0.42,
      hardness: 0.62,
    });
    const sounding = render(processor, attackBlocks);
    assertAudibleStereo(sounding, `${kind} ${action} gate`);
    const activeLevel = processor.driveGate;
    assert.ok(activeLevel > 0.1, `${action} should ramp its drive gate on`);

    send(processor, { type: "gate", action, active: false });
    render(processor, 256);
    assert.ok(
      processor.driveGate < activeLevel * 0.05,
      `${action} should release its drive gate after note-off`,
    );
  }
});

test("Bowed Things friction phase follows the size-adjusted modal fundamental", () => {
  const processor = createProcessor("bowed-things", {
    baseFrequencyHz: 440,
    size: 2,
    bowPressure: 0.6,
    bowVelocity: 0.5,
  });
  processor.driveGate = 1;
  processor._bowExcitation();
  assert.ok(Math.abs(processor.modeFrequency[0] - 220) < 1e-3);
  const expectedPhase = Math.PI * 2 * processor.modeFrequency[0]
    * (0.93 + processor.configuration.bowVelocity * 0.14) / SAMPLE_RATE;
  assert.ok(Math.abs(processor.bowPhase - expectedPhase) < 1e-12);
});

test("Particle Cabinet preserves the model's full zero-to-two-g gravity range", () => {
  const earthGravity = createProcessor("particle-cabinet", { gravity: 1 });
  const highGravity = createProcessor("particle-cabinet", { gravity: 2 });
  for (const processor of [earthGravity, highGravity]) {
    send(processor, {
      type: "gate",
      action: "shake",
      active: true,
      strength: 0.9,
      position: 0.4,
      hardness: 0.65,
    });
  }
  const earthRender = render(earthGravity, 160);
  const highRender = render(highGravity, 160);
  assert.ok(earthGravity.eventCount > 0 && highGravity.eventCount > 0);
  assert.ok(
    highRender.leftRms > earthRender.leftRms,
    "two-g collisions should carry more energy than otherwise-identical one-g collisions",
  );
});

test("zero source energy silences particle, impact, and airflow exciters", () => {
  const fixtures = [
    ["particle-cabinet", { type: "gate", action: "shake", active: true, strength: 1 }],
    ["impact-ecology", { type: "excite", eventType: "shatter", strength: 1 }],
    ["airflow-objects", { type: "gate", action: "gust", active: true, strength: 1 }],
  ];
  for (const [kind, message] of fixtures) {
    const processor = createProcessor(kind, { energy: 0, airSpeed: 70, eventDensity: 180 });
    send(processor, message);
    const rendered = render(processor, 96);
    assert.equal(rendered.peak, 0, `${kind} must be silent at zero energy`);
  }
});

test("Particle Cabinet becomes exactly silent when Energy reaches zero live", () => {
  const preset = PHYSICAL_SOUND_PRESETS["particle-cabinet"][0];
  const processor = createProcessor("particle-cabinet", {
    ...preset.settings,
    presetId: preset.id,
  });
  send(processor, {
    type: "gate",
    action: "shake",
    active: true,
    strength: 1,
    position: 0.4,
    hardness: 0.7,
  });
  assert.ok(render(processor, blocksForSeconds(0.5)).peak > 0.1);
  const eventCount = processor.eventCount;

  send(processor, { type: "configure", configuration: { energy: 0 } });
  const mutedShake = render(processor, blocksForSeconds(0.25));
  assert.equal(mutedShake.peak, 0);
  assert.equal(processor.eventCount, eventCount);

  send(processor, {
    type: "excite",
    eventType: "strike",
    strength: 1,
    position: 0.4,
    hardness: 0.7,
  });
  const mutedKnock = render(processor, blocksForSeconds(0.25));
  assert.equal(mutedKnock.peak, 0);
  assert.equal(processor.eventCount, eventCount);
});

test("Airflow Objects has a pressure onset and a real overblown register", () => {
  function sustain(airSpeed, blockCount = 120) {
    const processor = createProcessor("airflow-objects", {
      airflowMode: "cavity",
      airSpeed,
      aperture: 0.32,
      turbulence: 0.55,
    });
    send(processor, {
      type: "gate",
      action: "gust",
      active: true,
      strength: 1,
      position: 0.5,
      hardness: 0.5,
    });
    return { processor, rendered: render(processor, blockCount) };
  }

  const belowOnset = sustain(2);
  assert.equal(belowOnset.processor.airRegime, "noise");
  assert.ok(belowOnset.processor.airEnvelope < 1e-4);
  assert.ok(belowOnset.processor.airRegister < 1e-4);

  const fundamental = sustain(15);
  assert.equal(fundamental.processor.airRegime, "fundamental");
  assert.ok(fundamental.processor.airEnvelope > 0.25);
  assert.ok(fundamental.processor.airRegister < 0.05);
  assert.ok(Math.abs(fundamental.processor.airBodyFeedback) > 1e-8);
  assert.ok(
    fundamental.rendered.leftRms > belowOnset.rendered.leftRms * 4,
    "crossing the onset threshold should establish a voiced oscillation",
  );

  const overblown = sustain(70);
  assert.equal(overblown.processor.airRegime, "overblown");
  assert.ok(overblown.processor.airRegister > 0.8);
  assert.ok(
    overblown.processor._airFrequency() > overblown.processor.modeFrequency[0] * 2,
    "high flow should move a cavity into its next odd register",
  );
  assert.ok(Math.abs(overblown.processor.airBodyFeedback) > 1e-8);
  assertAudibleStereo(overblown.rendered, "overblown airflow");

  const telemetry = overblown.processor.postedMessages.findLast(
    ({ type }) => type === "telemetry",
  );
  assert.equal(telemetry.airRegime, "overblown");
  assert.ok(telemetry.airRegister > 0.8);
});

test("every Airflow preset stays strong through its playable register", () => {
  for (const preset of PHYSICAL_SOUND_PRESETS["airflow-objects"]) {
    const sustain = (airSpeed) => {
      const processor = createProcessor("airflow-objects", {
        ...preset.settings,
        presetId: preset.id,
        airSpeed,
      });
      send(processor, {
        type: "gate",
        action: "gust",
        active: true,
        strength: 1,
        position: 0.5,
        hardness: preset.settings.turbulence,
      });
      return sampleStats(
        render(processor, blocksForSeconds(3)).left,
        Math.floor(SAMPLE_RATE * 0.5),
      );
    };

    const authored = sustain(preset.settings.airSpeed);
    assert.ok(authored.rms >= 0.12, `${preset.id} should clear a practical output floor`);
    assert.ok(authored.peak >= 0.18, `${preset.id} should have a clearly audible peak`);

    if (preset.settings.airflowMode !== "aeolian") {
      const overblown = sustain(70);
      assert.ok(overblown.rms >= 0.1, `${preset.id} overblown register should remain audible`);
      assert.ok(
        overblown.rms >= authored.rms * 0.4,
        `${preset.id} should crossfade registers without a deep level hole`,
      );
    }
  }
});

test("Aeolian vortex frequency does not acquire a second pipe-style register", () => {
  const processor = createProcessor("airflow-objects", {
    presetId: "roof-wire",
    airflowMode: "aeolian",
    airSpeed: 70,
    turbulence: 0.4,
  });
  send(processor, {
    type: "gate",
    action: "gust",
    active: true,
    strength: 1,
    position: 0.5,
    hardness: 0.5,
  });
  render(processor, 160);
  assert.equal(processor.airRegime, "vortex tone");
  assert.ok(processor.airRegister < 1e-6);
  assert.equal(processor._airFrequency(), processor.modeFrequency[0]);
});

test("silence clears resonator and generator state, then a new strike can restart it", () => {
  const processor = createProcessor("object-forge");
  send(processor, {
    type: "excite",
    eventType: "strike",
    strength: 1,
    position: 0.28,
    hardness: 0.78,
  });
  assertAudibleStereo(render(processor, 8), "pre-silence object");
  assert.ok(processor.modeReal.some((sample) => sample !== 0));

  send(processor, { type: "silence" });
  assert.equal(processor.stopped, true);
  assert.equal(processor.driveGate, 0);
  assert.equal(processor.driveTarget, 0);
  assert.equal(processor.impactEnergy, 0);
  assert.ok(processor.modeReal.every((sample) => sample === 0));
  assert.ok(processor.modeImaginary.every((sample) => sample === 0));
  const silent = render(processor, 4);
  assert.equal(silent.peak, 0, "silence should produce exact zeroes");

  send(processor, {
    type: "excite",
    eventType: "strike",
    strength: 0.8,
    position: 0.62,
    hardness: 0.52,
  });
  assert.equal(processor.stopped, false);
  assertAudibleStereo(render(processor, 8), "restarted object");
});

test("Object Forge accepts signed custom modal gains, weights, and authored pans", () => {
  function customProcessor({ gain = 0.6, strikeWeight = 1, pan = 0 } = {}) {
    const processor = createProcessor("object-forge");
    send(processor, {
      type: "custom-bank",
      bank: {
        frequenciesHz: [173],
        t60Seconds: [0.72],
        gains: [gain],
        pans: [pan],
        strikeWeights: [strikeWeight],
      },
    });
    send(processor, {
      type: "excite",
      eventType: "strike",
      strength: 0.8,
      position: 0.5,
      hardness: 0.65,
    });
    return processor;
  }

  const positive = customProcessor();
  const negativeGain = customProcessor({ gain: -0.6 });
  const negativeWeight = customProcessor({ strikeWeight: -1 });
  assert.equal(negativeGain.modeGain[0], -0.6);
  assert.equal(negativeWeight.modeStrikeWeight[0], -1);
  assert.equal(positive.postedMessages.at(-1)?.type, "custom-bank-loaded");

  const positiveRender = render(positive, 12);
  const negativeGainRender = render(negativeGain, 12);
  const negativeWeightRender = render(negativeWeight, 12);
  assertAudibleStereo(positiveRender, "custom modal bank");
  for (let frame = 0; frame < positiveRender.left.length; frame += 1) {
    assert.ok(
      Math.abs(positiveRender.left[frame] + negativeGainRender.left[frame]) < 2e-7,
      "a signed pickup gain should invert, not disappear through squaring",
    );
    assert.ok(
      Math.abs(positiveRender.left[frame] + negativeWeightRender.left[frame]) < 2e-7,
      "a signed strike weight should invert the modal excitation",
    );
  }

  const hardLeft = customProcessor({ pan: -1 });
  const hardRight = customProcessor({ pan: 1 });
  const leftRender = render(hardLeft, 8);
  const rightRender = render(hardRight, 8);
  assert.ok(leftRender.leftRms > 1e-8);
  assert.equal(leftRender.rightRms, 0, "an authored hard-left pan should not leak right");
  assert.equal(rightRender.leftRms, 0, "an authored hard-right pan should not leak left");
  assert.ok(rightRender.rightRms > 1e-8);
});

test("the worklet preserves the builder modal domain and reference frequency", () => {
  const low = createProcessor("object-forge", {
    presetId: "wood-bar",
    baseFrequencyHz: 20,
    size: 4,
  });
  assert.equal(low.modeFrequency[0], 8);

  send(low, {
    type: "custom-bank",
    bank: {
      fundamentalHz: 310,
      frequenciesHz: [8, SAMPLE_RATE * 0.474],
      t60Seconds: [0.012, 30],
      gains: [1, 0.2],
      pans: [0, 0],
      strikeWeights: [1, 1],
    },
  });
  assert.equal(low.modeFrequency[0], 8);
  assert.equal(low.modeFrequency[1], SAMPLE_RATE * 0.474);
  assert.ok(Math.abs(low.modeDecay[0] - Math.exp(Math.log(0.001) / (0.012 * SAMPLE_RATE))) < 1e-12);
  assert.equal(low.fundamentalHz, 310);

  const bell = createProcessor("object-forge", { presetId: "bronze-bell" });
  assert.ok(Math.abs(bell.modeFrequency[0] - bell.fundamentalHz * 0.5) < 0.001);
  render(bell, 12);
  const telemetry = bell.postedMessages.findLast(({ type }) => type === "telemetry");
  assert.ok(Math.abs(telemetry.fundamentalHz - bell.fundamentalHz) < 0.001);
});

test("telemetry reports finite level, event, gate, and modal data", () => {
  for (const [kind, action] of [
    ["bowed-things", "bow"],
    ["airflow-objects", "gust"],
  ]) {
    const processor = createProcessor(kind);
    send(processor, {
      type: "gate",
      action,
      active: true,
      strength: 0.8,
      position: 0.5,
      hardness: 0.4,
    });
    render(processor, 24);

    const messages = processor.postedMessages.filter(({ type }) => type === "telemetry");
    assert.ok(messages.length >= 2);
    for (const message of messages) {
      assert.equal(message.kind, kind);
      assert.ok(message.modeCount > 0);
      for (const key of [
        "peak",
        "rms",
        "activity",
        "eventCount",
        "eventRate",
        "gateLevel",
        "impactIntervalMs",
        "lastEventStrength",
        "fundamentalHz",
      ]) {
        assert.ok(Number.isFinite(message[key]), `${key} telemetry must stay finite`);
      }
      assert.ok(message.peak >= 0 && message.peak <= 1);
      assert.ok(message.rms >= 0 && message.rms <= 1);
      assert.ok(message.activity > 0, `${action} should register as active in telemetry`);
      assert.ok(message.gateLevel > 0);
      assert.ok(message.fundamentalHz > 0);
    }
  }
});
