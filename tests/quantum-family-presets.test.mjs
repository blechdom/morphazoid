import assert from "node:assert/strict";
import test from "node:test";
import {
  ENTANGLEMENT_DANCE_FULL_PRESETS, ENTANGLEMENT_DANCE_MODEL,
} from "../src/instruments/entanglement-dance/full-presets.js";
import { BELL_SQUARE_FULL_PRESETS, BELL_SQUARE_MODEL } from "../src/instruments/bell-square/full-presets.js";
import {
  SQUARE_DANCE_FULL_PRESETS, SQUARE_DANCE_MODEL, randomizeSquareDancePreset,
} from "../src/instruments/quantum-square-dance/full-presets.js";
import { ANNEALOGUE_FULL_PRESETS, ANNEALOGUE_MODEL } from "../src/instruments/annealogue/full-presets.js";
import {
  ORDER_TONES_FULL_PRESETS, ORDER_TONES_MODEL, randomizeOrderTonesPreset,
} from "../src/instruments/order-tones/full-presets.js";
import { ORDER_TONES_PRESETS } from "../src/instruments/order-tones/order-tones.js";
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

checkParamModelContract(test, {
  name: "Annealogue", model: ANNEALOGUE_MODEL, bank: ANNEALOGUE_FULL_PRESETS,
  sessionState: { ...session, output: 0.2, progress: 0.5, amplitudes: [1], measurement: null },
});
checkParamModelContract(test, {
  name: "Order Tones", model: ORDER_TONES_MODEL, bank: ORDER_TONES_FULL_PRESETS,
  sessionState: { ...session, audio: true, sequenceIndex: 3, shots: [1], receipt: null },
});

test("Order Tones dice keeps base and bin valid for the modulus and register", () => {
  const random = seeded(3);
  const moduli = new Set(), precisions = new Set();
  for (let i = 0; i < 300; i++) {
    const result = randomizeOrderTonesPreset(ORDER_TONES_FULL_PRESETS[0].snapshot, random);
    assert.ok(ORDER_TONES_PRESETS.find(preset => preset.modulus === result.modulus).bases.includes(result.base));
    assert.ok(result.selectedBin < 2 ** result.precision);
    moduli.add(result.modulus); precisions.add(result.precision);
  }
  assert.equal(moduli.size, 3);
  assert.equal(precisions.size, 4);
});
