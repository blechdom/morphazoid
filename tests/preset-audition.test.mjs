import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import test from "node:test";
import { SHAPE_FULL_PRESETS } from "../src/instruments/shape-synth/full-presets.js";
import { HICCUP_HEAD_FULL_PRESETS } from "../src/instruments/hiccup-head/full-presets.js";
import { HICCUP_HEAD_GROOVE_PATTERNS, HICCUP_HEAD_PATTERNS, HICCUP_HEAD_SOUNDS, clonePattern } from "../src/instruments/hiccup-head/hiccup-head.js";
import { presetStateKey, validateFullPresetBank } from "../src/site/header-presets.js";

const before = JSON.parse(await readFile(new URL("./fixtures/preset-audition-before-20260921.json", import.meta.url)));
const shape = id => SHAPE_FULL_PRESETS.find(p => p.id === id).snapshot.parameters;

test("Velvet wheel uses the original square; only the requested circle preset is removed", () => {
  const original = shape("square-study"), velvet = shape("velvet-wheel");
  for (const key of ["shapeType", "sides", "closedShapeType", "curvature", "starDepth", "aspect", "skew"]) {
    assert.equal(velvet[key], original[key], key);
  }
  assert.equal(SHAPE_FULL_PRESETS.some(p => p.id === "soft-orbit"), false);
  assert.ok(SHAPE_FULL_PRESETS.some(p => p.snapshot.parameters.sides === 1),
    "circle geometry and other distinct multi-reader circle scenes are not deleted");
  for (const old of before.shape) {
    if (old.id === "soft-orbit" || old.id === "hands-on-sketch") continue;
    assert.ok(SHAPE_FULL_PRESETS.some(p => p.id === old.id), `${old.id}: preserve existing scene identity`);
  }
});

test("rotating Shape scenes mix clockwise, counterclockwise and ping-pong rather than one direction", () => {
  const rotating = SHAPE_FULL_PRESETS.filter(p => p.snapshot.parameters.autoRotate).map(p => p.snapshot.parameters);
  const count = { clockwise: 0, counterclockwise: 0, pingpong: 0 };
  for (const p of rotating) {
    count[p.rotationMotionMode === "pingpong" ? "pingpong" : p.rotationDirection < 0 ? "counterclockwise" : "clockwise"]++;
  }
  assert.ok(count.clockwise >= 6);
  assert.ok(count.counterclockwise >= 6);
  assert.ok(count.pingpong >= 8);
  assert.ok(Math.abs(count.clockwise - count.counterclockwise) <= 2);
  for (const id of ["bowed-line", "bowed-line-reel", "bowed-line-rocker"]) {
    assert.equal(shape(id).sides, 2);
    assert.equal(shape(id).playing, true);
    assert.equal(shape(id).autoRotate, true);
  }
  assert.equal(shape("bowed-line").rotationMotionMode, "pingpong");
  assert.equal(shape("bowed-line-reel").rotationDirection, -1);
  assert.equal(shape("bowed-line-reel").rotationMotionMode, "loop");
  assert.ok(shape("bowed-line-rocker").heads > shape("bowed-line-reel").heads);
  validateFullPresetBank(SHAPE_FULL_PRESETS);
});

test("Hiccup swaps Tongue virtuoso and Humming head without changing their settings or other original scenes", () => {
  const oldIds = before.hiccup.map(p => p.id);
  const requested = [...oldIds];
  const tongue = requested.indexOf("tongue-sprint"), humming = requested.indexOf("sweet-humming");
  [requested[tongue], requested[humming]] = [requested[humming], requested[tongue]];
  assert.deepEqual(HICCUP_HEAD_FULL_PRESETS.slice(0, oldIds.length).map(p => p.id), requested);
  for (const old of before.hiccup) {
    const current = HICCUP_HEAD_FULL_PRESETS.find(p => p.id === old.id);
    const sha = createHash("sha256").update(presetStateKey(current.snapshot)).digest("hex");
    assert.equal(sha, old.snapshotCanonicalSha256, `${old.id}: only menu position changes`);
  }
});

test("six new Hiccup main presets also expose their scores in the independent rhythm selector", () => {
  assert.equal(HICCUP_HEAD_GROOVE_PATTERNS.length, 6);
  assert.equal(HICCUP_HEAD_FULL_PRESETS.length, 25);
  assert.equal(HICCUP_HEAD_PATTERNS.length, 25);
  const originalIds = new Set(before.hiccup.map(p => p.id));
  const additions = HICCUP_HEAD_FULL_PRESETS.filter(p => !originalIds.has(p.id));
  assert.equal(additions.length, 6);
  assert.deepEqual(new Set(additions.map(p => p.snapshot.currentPatternId)), new Set(HICCUP_HEAD_GROOVE_PATTERNS.map(p => p.id)));
  for (const preset of additions) {
    const pattern = HICCUP_HEAD_PATTERNS.find(p => p.id === preset.snapshot.currentPatternId);
    assert.deepEqual(preset.snapshot.pattern, clonePattern(pattern));
    assert.equal(preset.snapshot.state.patternId, pattern.id);
    assert.equal(preset.snapshot.sequenceLength, 64);
  }
  assert.ok(new Set(additions.map(p => p.snapshot.state.tempo)).size >= 5);
  assert.ok(new Set(additions.map(p => p.snapshot.currentSoundBankId)).size >= 4);
  assert.ok(new Set(additions.map(p => p.snapshot.visualSkinId)).size >= 4);
  validateFullPresetBank(HICCUP_HEAD_FULL_PRESETS);
});

test("new beats are sparse monophonic two-bar arrangements with rests, accents and variation", () => {
  const identities = new Set(HICCUP_HEAD_SOUNDS.map(sound => sound.id));
  const serializations = new Set();
  for (const groove of HICCUP_HEAD_GROOVE_PATTERNS) {
    assert.ok(Object.isFrozen(groove) && Object.isFrozen(groove.rows));
    let rests = 0, sounded = 0;
    const velocities = new Set(), used = new Set(), score = [];
    for (let step = 0; step < 64; step++) {
      const hits = Object.entries(groove.rows).filter(([, row]) => row[step] > 0);
      assert.ok(hits.length <= 1, `${groove.id} step ${step}: no masked collision`);
      if (!hits.length) { rests++; score.push(null); }
      else {
        const [sound, row] = hits[0];
        assert.ok(identities.has(sound));
        assert.ok(row[step] > 0 && row[step] <= 1);
        sounded++; used.add(sound); velocities.add(row[step]); score.push([sound, row[step]]);
      }
    }
    assert.ok(rests >= 12 && sounded >= 24, `${groove.id}: preserve breathing room and a usable beat`);
    assert.ok(used.size >= 5 && velocities.size >= 6, `${groove.id}: contrasting sounds and ghost/accent levels`);
    assert.notDeepEqual(score.slice(0, 16), score.slice(16, 32), "bar two varies, not just renamed repetition");
    assert.deepEqual(score.slice(0, 32), score.slice(32), "deterministic two-bar loop");
    serializations.add(JSON.stringify(score));
    for (const row of Object.values(groove.rows)) assert.ok(Object.isFrozen(row) && row.length === 64);
  }
  assert.equal(serializations.size, HICCUP_HEAD_GROOVE_PATTERNS.length);
});
