import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_TONGUE_STATE,
  TONGUE_ANATOMIES,
  applyTongueToDiameter,
  sanitizeTongueState,
  tongueCavityGuides,
  tongueGeometry,
} from "../src/tongue-physics.js";
import { animalState, resolveSourceControls } from "../src/syrinx.js";

test("tongue state sanitation keeps a complete bounded articulator", () => {
  assert.deepEqual(sanitizeTongueState(), DEFAULT_TONGUE_STATE);
  const state = sanitizeTongueState({
    tongueEnabled: 0,
    tongueAnatomy: "not-an-anatomy",
    tonguePosition: Number.POSITIVE_INFINITY,
    tongueHeight: -100,
    tongueShape: 100,
    tongueTip: Number.NaN,
  });
  assert.equal(state.tongueEnabled, false);
  assert.equal(state.tongueAnatomy, "human");
  for (const key of ["tonguePosition", "tongueHeight", "tongueShape", "tongueTip"]) {
    assert.ok(Number.isFinite(state[key]));
    assert.ok(state[key] >= 0 && state[key] <= 1);
  }
});

test("each anatomy produces a finite positive and distinct constriction field", () => {
  const positions = Array.from({ length: 41 }, (_, index) => index / 40);
  const signatures = [];
  for (const anatomyId of Object.keys(TONGUE_ANATOMIES)) {
    const configuration = {
      ...DEFAULT_TONGUE_STATE,
      tongueAnatomy: anatomyId,
      tongueHeight: 0.72,
      tongueTip: 0.64,
    };
    const profile = positions.map((position) => applyTongueToDiameter(position, 1, configuration));
    assert.ok(profile.every((diameter) => Number.isFinite(diameter) && diameter > 0));
    assert.ok(Math.min(...profile) < 0.8, `${anatomyId} needs an audible constriction`);
    signatures.push(profile.map((value) => value.toFixed(5)).join(":"));
  }
  assert.equal(new Set(signatures).size, Object.keys(TONGUE_ANATOMIES).length);
});

test("tongue bypass is identity and higher body position moves the constriction", () => {
  const base = 1.8;
  for (const position of [0, 0.2, 0.5, 0.8, 1]) {
    assert.equal(applyTongueToDiameter(position, base, {
      ...DEFAULT_TONGUE_STATE,
      tongueEnabled: false,
    }), base);
  }

  const back = tongueGeometry({ ...DEFAULT_TONGUE_STATE, tonguePosition: 0.05 });
  const front = tongueGeometry({ ...DEFAULT_TONGUE_STATE, tonguePosition: 0.95 });
  assert.ok(front.center > back.center);
  assert.ok(
    applyTongueToDiameter(front.center, base, { ...DEFAULT_TONGUE_STATE, tonguePosition: 0.95 })
      < applyTongueToDiameter(front.center, base, { ...DEFAULT_TONGUE_STATE, tonguePosition: 0.05 }),
  );
});

test("quarter-wave guides scale with host tract length and remain finite for every Syrinx host", () => {
  for (const animalId of ["lion", "raven", "bullfrog", "mouse", "elephant"]) {
    const host = animalState(animalId);
    const source = resolveSourceControls(host);
    assert.ok(source.frequencyHz > 0);
    const short = tongueCavityGuides(host.tractLengthM, DEFAULT_TONGUE_STATE);
    const long = tongueCavityGuides(host.tractLengthM * 1.5, DEFAULT_TONGUE_STATE);
    assert.ok(Number.isFinite(short.rearQuarterWaveHz));
    assert.ok(Number.isFinite(short.frontQuarterWaveHz));
    assert.ok(long.rearQuarterWaveHz < short.rearQuarterWaveHz);
    assert.ok(long.frontQuarterWaveHz < short.frontQuarterWaveHz);
  }
});

