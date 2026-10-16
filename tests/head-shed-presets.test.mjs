import assert from "node:assert/strict";
import test from "node:test";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";
import {
  HEAD_SHED_FULL_PRESETS, captureHeadShedPreset, randomizeHeadShedPreset, validateHeadShedPreset,
} from "../src/instruments/head-shed/full-presets.js";

const seed = value => () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x100000000);
const distinct = values => new Set(values).size;

test("Head Shed bank is complete, valid, distinct and never wipes the tape", () => {
  validateFullPresetBank(HEAD_SHED_FULL_PRESETS);
  for (const preset of HEAD_SHED_FULL_PRESETS) {
    assert.equal(validateHeadShedPreset(preset.snapshot), preset.snapshot);
    assert.deepEqual(captureHeadShedPreset(preset.snapshot), preset.snapshot);
    assert.ok(preset.snapshot.heads.some(head => head.kind === "play"));
    assert.ok(preset.snapshot.heads.every(head => head.kind !== "erase"));
  }
  assert.throws(() => validateHeadShedPreset({ ...HEAD_SHED_FULL_PRESETS[0].snapshot, heads: [] }), TypeError);
  assert.throws(() => validateHeadShedPreset({ ...HEAD_SHED_FULL_PRESETS[0].snapshot, speed: 9 }), TypeError);
});

test("Head Shed capture ignores head identity and drops nothing a preset owns", () => {
  const live = [{ id: 7, kind: "play", pos01: 0.2, level: 0.5, pan: -0.1 }, { id: 9, kind: "erase", pos01: 0.9, level: 1, pan: 0 }];
  const captured = captureHeadShedPreset({ speed: 1.5, retain: 0.5, genLoss: 0.3, rotorOnly: true, dry: 0.1, heads: live });
  assert.deepEqual(captured.heads.map(head => head.kind), ["play", "erase"]);
  assert.equal("dry" in captured, false);
  assert.equal("id" in captured.heads[0], false);
});

test("Head Shed dice is pure, seedable, new and varies every owned field", () => {
  const initial = HEAD_SHED_FULL_PRESETS[0].snapshot, before = structuredClone(initial);
  assert.deepEqual(randomizeHeadShedPreset(initial, seed(6)), randomizeHeadShedPreset(HEAD_SHED_FULL_PRESETS[4].snapshot, seed(6)));
  assert.deepEqual(initial, before);
  const known = new Set(HEAD_SHED_FULL_PRESETS.map(preset => presetStateKey(preset.snapshot)));
  const random = seed(77), seen = { speed: [], retain: [], genLoss: [], rotor: [], count: [], pos: [], level: [], pan: [], kinds: [] };
  for (let i = 0; i < 80; i++) {
    const result = validateHeadShedPreset(randomizeHeadShedPreset(initial, random));
    assert.equal(known.has(presetStateKey(result)), false);
    assert.ok(result.heads[0].kind === "play" && result.heads.every(head => head.kind !== "erase"));
    if (result.rotorOnly) assert.ok(result.heads.filter(head => head.kind === "play").length >= 3);
    seen.speed.push(result.speed); seen.retain.push(result.retain); seen.genLoss.push(result.genLoss); seen.rotor.push(result.rotorOnly);
    seen.count.push(result.heads.length);
    for (const head of result.heads) { seen.pos.push(head.pos01); seen.level.push(head.level); seen.pan.push(head.pan); seen.kinds.push(head.kind); }
  }
  for (const [key, values] of Object.entries(seen)) assert.ok(distinct(values) > (["rotor", "kinds"].includes(key) ? 1 : key === "count" ? 4 : key === "retain" ? 15 : 25), `${key} stays frozen`);
});
