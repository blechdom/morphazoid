import assert from "node:assert/strict";
import test from "node:test";
import {
  ADAPTIVE_POLYPHONY_HARD_LIMITS,
  AdaptivePolyphonyController,
} from "../src/adaptive-polyphony.js";

function observe(controller, overrides = {}) {
  return controller.observe({
    mode: "sine",
    averageLoad: 0.2,
    peakLoad: 0.3,
    activeVoices: 128,
    requestedVoices: 512,
    source: "test",
    ...overrides,
  });
}

test("adaptive polyphony grows only under real demand and sustained headroom", () => {
  const controller = new AdaptivePolyphonyController({ initialVoices: 128 });
  controller.setDemand("sine", 512);
  assert.equal(observe(controller).limit, 128);
  assert.equal(observe(controller).limit, 128);
  const trial = observe(controller);
  assert.equal(trial.limit, 160);
  assert.equal(trial.stableLimit, 128);
  assert.equal(trial.status, "probing");

  const noDemand = new AdaptivePolyphonyController({ initialVoices: 128 });
  noDemand.setDemand("sine", 80);
  for (let index = 0; index < 8; index += 1) {
    observe(noDemand, { activeVoices: 80, requestedVoices: 80 });
  }
  assert.equal(noDemand.limitFor("sine"), 128);
});

test("overload rolls a trial back and underruns make an emergency reduction", () => {
  const controller = new AdaptivePolyphonyController({ initialVoices: 128 });
  controller.setDemand("sine", 512);
  for (let index = 0; index < 3; index += 1) observe(controller);
  assert.equal(controller.limitFor("sine"), 160);

  observe(controller, { activeVoices: 160, averageLoad: 0.72, peakLoad: 0.9 });
  const rolledBack = observe(controller, {
    activeVoices: 160,
    averageLoad: 0.72,
    peakLoad: 0.9,
  });
  assert.equal(rolledBack.limit, 128);
  assert.equal(rolledBack.status, "capped");

  const emergency = observe(controller, {
    activeVoices: rolledBack.limit,
    averageLoad: 0.4,
    peakLoad: 0.6,
    underrunRatio: 0.01,
  });
  assert.ok(emergency.limit < rolledBack.limit);
});

test("each synthesis mode learns independently and respects its hard guard", () => {
  const controller = new AdaptivePolyphonyController({
    initialVoices: 128,
    hardLimits: { ...ADAPTIVE_POLYPHONY_HARD_LIMITS, sine: 144 },
  });
  controller.setDemand("sine", 1_000);
  for (let index = 0; index < 3; index += 1) observe(controller);
  assert.equal(controller.limitFor("sine"), 144);
  assert.equal(controller.limitFor("fm"), 128);
  assert.equal(controller.limitFor("pm"), 128);
  assert.equal(controller.limitFor("shepard"), 128);
});

test("missing renderer telemetry stays at the conservative fallback", () => {
  const controller = new AdaptivePolyphonyController({ initialVoices: 128 });
  controller.setDemand("sine", 4_096);
  controller.setTelemetryUnavailable("test-fallback");
  assert.deepEqual(
    {
      limit: controller.decision("sine").limit,
      status: controller.decision("sine").status,
      source: controller.decision("sine").source,
    },
    { limit: 128, status: "fallback", source: "test-fallback" },
  );
});

test("silencing during a trial clears probe state and restores the stable limit", () => {
  const controller = new AdaptivePolyphonyController({ initialVoices: 128 });
  controller.setDemand("sine", 512);
  for (let index = 0; index < 3; index += 1) observe(controller);
  assert.equal(controller.decision("sine").status, "probing");
  const silent = controller.setDemand("sine", 0);
  assert.equal(silent.limit, 128);
  assert.notEqual(silent.status, "probing");
  assert.notEqual(silent.status, "capped");
});

test("small adaptive pools never exceed their requested hard limit", () => {
  const controller = new AdaptivePolyphonyController({
    initialVoices: 2,
    hardLimits: { sine: 2, fm: 2, pm: 2, shepard: 2 },
  });
  assert.equal(controller.limitFor("sine"), 2);
  assert.equal(controller.decision("sine").hardLimit, 2);
});
