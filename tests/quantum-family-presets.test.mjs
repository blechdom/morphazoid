import assert from "node:assert/strict";
import test from "node:test";
import {
  ENTANGLEMENT_DANCE_FULL_PRESETS, ENTANGLEMENT_DANCE_MODEL,
} from "../src/instruments/entanglement-dance/full-presets.js";
import { BELL_SQUARE_FULL_PRESETS, BELL_SQUARE_MODEL } from "../src/instruments/bell-square/full-presets.js";
import {
  SQUARE_DANCE_FULL_PRESETS, SQUARE_DANCE_MODEL, randomizeSquareDancePreset,
} from "../src/instruments/quantum-square-dance/full-presets.js";
import { checkParamModelContract, seeded } from "./preset-kit-checks.mjs";

const session = { playing: true, audioOn: true, audioStarting: false, level: 0.3, globalPhase: 1.2, lastOutcome: "01" };

checkParamModelContract(test, {
  name: "Entanglement Dance", model: ENTANGLEMENT_DANCE_MODEL, bank: ENTANGLEMENT_DANCE_FULL_PRESETS, sessionState: session,
});
checkParamModelContract(test, {
  name: "Bell Square", model: BELL_SQUARE_MODEL, bank: BELL_SQUARE_FULL_PRESETS, sessionState: session,
});
checkParamModelContract(test, {
  name: "Quantum Square Dance", model: SQUARE_DANCE_MODEL, bank: SQUARE_DANCE_FULL_PRESETS,
  sessionState: { ...session, clockTurns: 0.4, sampleSerial: 3 },
});

test("Quantum Square Dance dice keeps scene-dependent values valid", () => {
  const random = seeded(11);
  const scenes = new Set();
  for (let i = 0; i < 200; i++) {
    const result = randomizeSquareDancePreset(SQUARE_DANCE_FULL_PRESETS[0].snapshot, random);
    scenes.add(result.scene);
    if (result.scene === "hold-half-swap") assert.deepEqual([result.phaseDegrees, result.pairCount], [90, 1]);
    if (result.scene === "one-pair") assert.equal(result.pairCount, 1);
    if (result.scene === "whole-floor") assert.ok(result.pairCount >= 8);
  }
  assert.equal(scenes.size, 3);
});
