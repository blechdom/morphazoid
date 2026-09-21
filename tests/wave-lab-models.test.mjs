import { test } from "node:test";
import assert from "node:assert/strict";

import {
  INVOLUTIONS, involutionById, isOneSided, lapsPerPeriod, cutBand, compositePeriod, headState,
} from "../src/instruments/crab-loom/crab-loom.js";
import {
  createLattice, participationRatio, findThreshold, siteFrequency, neighbours, MAX_SIDE,
} from "../src/instruments/freeze-point/freeze-point.js";
import {
  createScatterers, paths, renderImpulseResponse, refocusQuality, reverseChannel, MAX_IR_SECONDS,
} from "../src/instruments/scatter-ghost/scatter-ghost.js";
import { eigenmodes, responseToPerturbation, proximity, decaySeconds } from "../src/instruments/exceptional/exceptional.js";

test("crab loom: every listed transform is an involution in name and count", () => {
  assert.ok(INVOLUTIONS.length >= 5);
  for (const inv of INVOLUTIONS) {
    assert.equal(involutionById(inv.id).id, inv.id);
    assert.ok(inv.note.length > 0, `${inv.id} needs an explanatory note`);
  }
  assert.equal(involutionById("nonsense").id, INVOLUTIONS[0].id, "unknown ids fall back, never throw");
});

test("crab loom: odd half twists are one-sided and double the period", () => {
  for (const h of [1, 3, 5]) {
    assert.equal(isOneSided(h), true, `${h} half twists should be one-sided`);
    assert.equal(lapsPerPeriod(h), 2);
  }
  for (const h of [0, 2, 4]) {
    assert.equal(isOneSided(h), false);
    assert.equal(lapsPerPeriod(h), 1);
  }
});

test("crab loom: a centre cut through a one-sided band does not halve it", () => {
  const result = cutBand(1, 0);
  assert.equal(result.pieces.length, 1, "one band, not two");
  assert.equal(result.pieces[0].lengthRatio, 2, "and it is twice as long");
  assert.equal(isOneSided(result.pieces[0].halfTwists), false, "the result is two-sided");
});

test("crab loom: an off-centre cut yields two linked bands of different lengths", () => {
  const result = cutBand(1, 0.33);
  assert.equal(result.pieces.length, 2);
  assert.equal(result.linked, true);
  const lengths = result.pieces.map((p) => p.lengthRatio).sort();
  assert.deepEqual(lengths, [1, 2], "a 2:1 ratio the performer did not choose");
  assert.equal(compositePeriod(result.pieces), 2);
});

test("crab loom: a two-sided centre cut does halve into two equal bands", () => {
  const result = cutBand(0, 0);
  assert.equal(result.pieces.length, 2);
  assert.deepEqual(result.pieces.map((p) => p.lengthRatio), [1, 1]);
  assert.equal(result.linked, false);
});

test("crab loom: head state reports the flipped face only on a one-sided band", () => {
  assert.equal(headState(0.2, 0, 0).stage, 0);
  assert.equal(headState(0.2, 0, 1).stage, 0, "first lap reads the unflipped face");
  assert.equal(headState(1.2, 0, 1).stage, 1, "second lap reads the flipped face");
  const s = headState(0.5, 0.25, 1);
  assert.ok(s.read01 >= 0 && s.read01 < 1, "read position stays normalised");
});

test("freeze point: lattice is deterministic for a fixed seed and bounded in size", () => {
  const a = createLattice({ side: 6, seed: 3 });
  const b = createLattice({ side: 6, seed: 3 });
  assert.deepEqual(a.sites.map((s) => s.offset), b.sites.map((s) => s.offset));
  assert.equal(createLattice({ side: 999 }).side, MAX_SIDE, "side is clamped");
  for (const site of a.sites) assert.ok(Number.isFinite(site.baseHz) && site.baseHz > 0);
});

test("freeze point: raising disorder monotonically shrinks how far energy spreads", () => {
  const lattice = createLattice({ side: 8, seed: 11 });
  const origin = 27;
  const ratios = [0, 0.5, 1.2, 2, 3].map((d) => participationRatio(lattice, origin, d, 0.55));
  for (let i = 1; i < ratios.length; i += 1) {
    assert.ok(ratios[i] <= ratios[i - 1] + 1e-6, `spread should not grow with disorder: ${ratios}`);
  }
  assert.ok(ratios[0] > ratios.at(-1) * 2, "there must be a real collapse, not a slight dulling");
  for (const r of ratios) assert.ok(Number.isFinite(r) && r >= 1);
});

test("freeze point: a threshold exists between the extended and localized regimes", () => {
  const lattice = createLattice({ side: 8, seed: 11 });
  const threshold = findThreshold(lattice, 27, 0.55);
  assert.ok(threshold > 0 && threshold < 3, `threshold should sit inside the control range, got ${threshold}`);
  const below = participationRatio(lattice, 27, threshold * 0.5, 0.55);
  const above = participationRatio(lattice, 27, Math.min(3, threshold * 1.8), 0.55);
  assert.ok(below > above, "below the threshold energy reaches further than above it");
});

test("freeze point: site frequency and neighbours stay well formed", () => {
  const lattice = createLattice({ side: 5, seed: 2 });
  for (const site of lattice.sites) {
    assert.ok(Number.isFinite(siteFrequency(site, 2.5)) && siteFrequency(site, 2.5) > 0);
  }
  assert.deepEqual(neighbours(lattice, 0).sort(), [1, 5]);
  assert.equal(neighbours(lattice, 12).length, 4, "an interior site has four neighbours");
});

test("scatter ghost: path sets are ordered, finite and bounded in delay", () => {
  const sc = createScatterers(20, 7);
  const set = paths({ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }, sc, 6);
  assert.ok(set.length > 1, "the direct path plus scattered paths");
  for (let i = 1; i < set.length; i += 1) assert.ok(set[i].delay >= set[i - 1].delay);
  for (const p of set) {
    assert.ok(Number.isFinite(p.delay) && p.delay >= 0 && p.delay <= MAX_IR_SECONDS);
    assert.ok(Number.isFinite(p.gain) && p.gain > 0);
  }
});

test("scatter ghost: impulse responses are finite, normalised and reversible", () => {
  const sc = createScatterers(12, 4);
  const set = paths({ x: 0.2, y: 0.4 }, { x: 0.7, y: 0.6 }, sc, 6);
  for (const reversed of [false, true]) {
    const ir = renderImpulseResponse(set, 48000, { reversed });
    let peak = 0;
    for (const v of ir.data) { assert.ok(Number.isFinite(v)); peak = Math.max(peak, Math.abs(v)); }
    assert.ok(peak > 0 && peak <= 0.9001, `peak should be normalised, got ${peak}`);
    assert.ok(ir.seconds <= MAX_IR_SECONDS);
  }
});

test("scatter ghost: refocus quality falls when the medium is perturbed after recording", () => {
  const sc = createScatterers(16, 9);
  const source = { x: 0.2, y: 0.5 }, focus = { x: 0.8, y: 0.5 };
  const recorded = paths(source, focus, sc, 6);
  assert.equal(refocusQuality(recorded, recorded), 1, "an unchanged medium refocuses perfectly");
  const moved = sc.map((s, i) => (i === 0 ? { ...s, x: Math.min(0.95, s.x + 0.3) } : s));
  const after = refocusQuality(recorded, paths(source, focus, moved, 6));
  assert.ok(after < 1, `moving one scatterer must degrade the refocus, got ${after}`);
  assert.ok(after >= 0);
});

test("scatter ghost: reversing a channel is its own inverse", () => {
  const input = Float32Array.from([0.1, -0.2, 0.3, -0.4, 0.5]);
  const once = reverseChannel(input);
  assert.deepEqual(Array.from(reverseChannel(once)), Array.from(input));
  assert.deepEqual(Array.from(once), [0.5, -0.4, 0.3, -0.2, 0.1].map((v) => Math.fround(v)));
});

test("exceptional: modes split below the point, coalesce at it, and break beyond it", () => {
  const below = eigenmodes(400, 40, 10);
  assert.equal(below.broken, false);
  assert.ok(below.modes[1].hz > below.modes[0].hz, "two distinct frequencies");

  const at = eigenmodes(400, 40, 40);
  assert.equal(at.atEP, true);
  assert.equal(at.split, 0);
  assert.equal(at.modes[0].hz, at.modes[1].hz, "the two modes have coalesced");

  const beyond = eigenmodes(400, 40, 70);
  assert.equal(beyond.broken, true);
  assert.equal(beyond.modes[0].hz, beyond.modes[1].hz, "one frequency");
  assert.ok(beyond.modes[1].growth > 0 && beyond.modes[0].growth < 0, "two different decay rates");
});

test("exceptional: the split narrows monotonically as balance approaches coupling", () => {
  const splits = [0, 10, 20, 30, 39].map((g) => eigenmodes(400, 40, g).split);
  for (let i = 1; i < splits.length; i += 1) assert.ok(splits[i] < splits[i - 1]);
});

test("exceptional: response to a fixed nudge grows sharply near the point", () => {
  const far = responseToPerturbation(40, 0, 1);
  const near = responseToPerturbation(40, 39.999, 1);
  assert.ok(near > far * 2, `sensitivity must rise approaching the EP: far ${far}, near ${near}`);
  for (const v of [far, near]) assert.ok(Number.isFinite(v) && v >= 0);
});

test("exceptional: proximity is bounded and peaks exactly on the point", () => {
  assert.equal(proximity(40, 40), 1);
  assert.ok(proximity(40, 0) < 0.05);
  for (const g of [-5, 0, 40, 400]) {
    const p = proximity(40, g);
    assert.ok(p >= 0 && p <= 1, `proximity out of range for gamma ${g}: ${p}`);
  }
});

test("exceptional: decay stays inside its declared bounds for hostile growth", () => {
  for (const growth of [-100, 0, 4, 8, 1e6]) {
    const d = decaySeconds(growth);
    assert.ok(Number.isFinite(d) && d >= 0.05 && d <= 12, `decay out of bounds for ${growth}: ${d}`);
  }
});
