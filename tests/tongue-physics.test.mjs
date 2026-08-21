import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_TONGUE_STATE,
  TONGUE_ANATOMIES,
  applyTongueToDiameter,
  applyTonguesToDiameter,
  sanitizeTongueState,
  tongueAirwayAperture,
  tongueAirwayState,
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

test("multiple tongues add independent bounded constrictions to one tract profile", () => {
  const baseDiameter = 1.8;
  const tongues = [
    { position: 0.06, height: 0.64, curl: 0.12 },
    { position: 0.52, height: 0.82, curl: 0.48 },
    { position: 0.96, height: 0.74, curl: 0.84 },
  ];
  const oneTongue = { tongueEnabled: true, tongueCount: 1, tongues };
  const threeTongues = { tongueEnabled: true, tongueCount: 3, tongues };
  const positions = Array.from({ length: 81 }, (_, index) => index / 80);
  const singleProfile = positions.map((position) => (
    applyTonguesToDiameter(position, baseDiameter, oneTongue)
  ));
  const multipleProfile = positions.map((position) => (
    applyTonguesToDiameter(position, baseDiameter, threeTongues)
  ));

  assert.ok(multipleProfile.every((diameter) => Number.isFinite(diameter) && diameter > 0));
  assert.notDeepEqual(multipleProfile, singleProfile);
  for (const tongue of tongues.slice(1)) {
    const center = tongueGeometry({
      tonguePosition: tongue.position,
      tongueHeight: tongue.height,
      tongueShape: tongue.curl,
      tongueTip: tongue.curl,
      tongueCurl: tongue.curl,
    }).center;
    assert.ok(
      applyTonguesToDiameter(center, baseDiameter, threeTongues)
        < applyTonguesToDiameter(center, baseDiameter, oneTongue),
      `the extra tongue at ${center.toFixed(3)} must add a local constriction`,
    );
  }
  for (const position of positions) {
    assert.equal(
      applyTonguesToDiameter(position, baseDiameter, {
        ...threeTongues,
        tongueEnabled: false,
      }),
      baseDiameter,
    );
  }
  const airway = tongueAirwayState(threeTongues);
  assert.ok(airway.aperture >= 0 && airway.aperture <= 1);
  assert.ok(airway.position >= 0 && airway.position <= 1);
  assert.ok(airway.minimumRatio < 1);
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

test("full tongue contact seals the airway while lateral opening preserves a leak", () => {
  const contact = {
    ...DEFAULT_TONGUE_STATE,
    tonguePosition: 0.85,
    tongueHeight: 1,
    tongueShape: 1,
    tongueTip: 1,
    tongueExtension: 0.2,
    tongueCurl: 1,
    tongueLateral: 0,
  };
  const lateral = { ...contact, tongueLateral: 0.92 };
  const positions = Array.from({ length: 1_001 }, (_, index) => index / 1_000);
  const sealedMinimum = Math.min(
    ...positions.map((position) => applyTongueToDiameter(position, 1, contact)),
  );
  const lateralMinimum = Math.min(
    ...positions.map((position) => applyTongueToDiameter(position, 1, lateral)),
  );

  assert.ok(sealedMinimum < 0.01, `contact gap ${sealedMinimum} must be effectively sealed`);
  assert.equal(tongueAirwayAperture(contact), 0);
  assert.ok(lateralMinimum > 0.2, `lateral gap ${lateralMinimum} must remain open`);
  assert.ok(tongueAirwayAperture(lateral) > 0.8);
  assert.equal(tongueAirwayAperture({ ...contact, tongueEnabled: false }), 1);
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
