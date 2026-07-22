import assert from "node:assert/strict";
import test from "node:test";
import { MicBranchEngine } from "../src/mic-branch-engine.js";

function branch(index) {
  return { key: `branch:${index}`, rate: 1, gain: 0.01, pan: 0, depth: 0 };
}

test("microphone branch engine separates its safe start from its worklet guard", () => {
  const engine = new MicBranchEngine(128, { adaptive: true, maxVoices: 4_096 });
  const requested = Array.from({ length: 512 }, (_, index) => branch(index));
  engine.setVoices(requested, { requestedVoiceCount: requested.length });
  assert.equal(engine.voiceLimit, 128);
  assert.equal(engine.maxVoices, 4_096);
  assert.equal(engine.pendingVoices.length, 128);

  for (let index = 0; index < 3; index += 1) {
    engine.observePolyphony({
      averageLoad: 0.2,
      peakLoad: 0.3,
      activeVoices: 128,
      requestedVoices: requested.length,
      source: "test",
    });
  }
  assert.equal(engine.voiceLimit, 160);
  engine.setVoices(requested, { requestedVoiceCount: requested.length });
  assert.equal(engine.pendingVoices.length, 160);
});

test("microphone branch engine returns to 128 when measurement is unavailable", () => {
  const engine = new MicBranchEngine(128, { adaptive: true, maxVoices: 4_096 });
  engine.setVoiceDemand(2_000);
  engine.useAdaptiveFallback("test-fallback");
  assert.equal(engine.voiceLimit, 128);
  assert.equal(engine.polyphonyStatus.status, "fallback");
});
