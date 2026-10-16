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
import { CANTOR_LOCK_FULL_PRESETS, CANTOR_LOCK_MODEL, randomizeCantorLockPreset } from "../src/instruments/cantor-lock/full-presets.js";
import {
  ESCAPE_DUST_FULL_PRESETS, ESCAPE_DUST_MODEL, captureEscapeDustPreset, openingCellsFromWidth, openingWidthFromCells,
} from "../src/instruments/escape-dust/full-presets.js";
import { createEscapeDustSimulation } from "../src/instruments/escape-dust/escape-dust.js";
import {
  LINEBREAKER_FULL_PRESETS, LINEBREAKER_MODEL, captureLinebreakerPreset,
} from "../src/instruments/linebreaker/full-presets.js";
import { PLASMA_BALL_FULL_PRESETS, PLASMA_BALL_MODEL } from "../src/instruments/plasma-ball/full-presets.js";
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

checkParamModelContract(test, {
  name: "Cantor Lock", model: CANTOR_LOCK_MODEL, bank: CANTOR_LOCK_FULL_PRESETS,
  sessionState: { ...session, audio: true, audioChanging: false, hoverCell: 4 },
});
checkParamModelContract(test, {
  name: "Escape Dust", model: ESCAPE_DUST_MODEL, bank: ESCAPE_DUST_FULL_PRESETS,
  sessionState: { ...session, openingWidth: 27 / 81 },
});
checkParamModelContract(test, {
  name: "Linebreaker", model: LINEBREAKER_MODEL, bank: LINEBREAKER_FULL_PRESETS,
  sessionState: { ...session, scanning: true, audio: true, audioChanging: false },
});
checkParamModelContract(test, {
  name: "Plasma Ball", model: PLASMA_BALL_MODEL, bank: PLASMA_BALL_FULL_PRESETS,
  sessionState: { ...session, bolts: [], pointer: {}, time: 4, surge: 1 },
});

test("Cantor Lock dice keeps the offset inside the 3^depth grid", () => {
  const random = seeded(8);
  const depths = new Set();
  for (let i = 0; i < 300; i++) {
    const result = randomizeCantorLockPreset(CANTOR_LOCK_FULL_PRESETS[0].snapshot, random);
    assert.ok(result.offset < 3 ** result.depth);
    depths.add(result.depth);
  }
  assert.equal(depths.size, 4);
});

test("Escape Dust opening cells round-trip through the simulation's snapped width", () => {
  for (const preset of ESCAPE_DUST_FULL_PRESETS) {
    const simulation = createEscapeDustSimulation({ openingWidth: openingWidthFromCells(preset.snapshot.openingCells) });
    assert.equal(simulation.settings.openingWidth, openingWidthFromCells(preset.snapshot.openingCells));
    assert.equal(openingCellsFromWidth(simulation.settings.openingWidth), preset.snapshot.openingCells);
  }
  const state = { ...ESCAPE_DUST_FULL_PRESETS[0].snapshot, openingWidth: 1 / 3 };
  assert.equal(captureEscapeDustPreset(state).openingCells, 27);
});

test("Linebreaker capture folds a scanning probe angle onto the integer slider grid", () => {
  const state = { ...LINEBREAKER_FULL_PRESETS[0].snapshot, angle: 44.6 };
  assert.equal(captureLinebreakerPreset(state).angle, 45);
  assert.equal(captureLinebreakerPreset({ ...state, angle: 179.7 }).angle, 0);
});
