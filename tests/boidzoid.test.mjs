import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  BOIDZOID_DEFAULTS,
  BOIDZOID_SCALES,
  boidzoidSeed,
  createFlock,
  mapCrossingToVoice,
  minimumImage,
  resolveBoidzoidScale,
  sanitizeBoidzoidSettings,
  skinCellAt,
  stepFlock,
} from "../src/boidzoid.js";
import { sanitizeKarplusStrongSettings } from "../src/karplus-strong.js";

const root = new URL("../", import.meta.url);

function makeBoid(id, x, y, vx, vy, surface = { rows: 4, columns: 4 }) {
  const cell = skinCellAt(x, y, surface);
  return {
    id,
    x,
    y,
    vx,
    vy,
    phase: 0,
    cooldown: 0,
    cellId: cell.id,
    cellRow: cell.row,
    cellColumn: cell.column,
    skinRows: cell.rows,
    skinColumns: cell.columns,
  };
}

const isolatedSettings = Object.freeze({
  rows: 4,
  columns: 4,
  aspect: 1,
  perceptionRadius: 0.5,
  separationRadius: 0.15,
  minSpeed: 0.05,
  maxSpeed: 0.3,
  maxForce: 4,
  alignment: 0,
  cohesion: 0,
  separation: 0,
  wander: 0,
  pointerStrength: 1,
  crossingCooldown: 0.12,
});

test("seed and setting sanitizers are stable and bounded", () => {
  assert.equal(boidzoidSeed(42), 42);
  assert.equal(boidzoidSeed("morphazpod"), boidzoidSeed("morphazpod"));
  assert.notEqual(boidzoidSeed("morphazpod"), boidzoidSeed("morphazpod-2"));

  const settings = sanitizeBoidzoidSettings({
    count: 900,
    rows: 1,
    columns: 900,
    aspect: 0,
    perceptionRadius: 0.04,
    separationRadius: 1,
    alignment: -1,
    cohesion: 9,
    separation: Infinity,
    minSpeed: 0.7,
    maxSpeed: 0.1,
    maxForce: 99,
    crossingCooldown: -3,
  });

  assert.equal(settings.count, 64);
  assert.equal(settings.rows, 2);
  assert.equal(settings.columns, 48);
  assert.equal(settings.aspect, 0.25);
  assert.equal(settings.separationRadius, settings.perceptionRadius);
  assert.equal(settings.alignment, 0);
  assert.equal(settings.cohesion, 4);
  assert.equal(settings.separation, BOIDZOID_DEFAULTS.separation);
  assert.equal(settings.minSpeed, 0.7);
  assert.equal(settings.maxSpeed, 0.7);
  assert.equal(settings.maxForce, 4);
  assert.equal(settings.crossingCooldown, 0);
});

test("minimum-image displacement and snakeskin cells wrap seamlessly", () => {
  assert.ok(Math.abs(minimumImage(0.9) + 0.1) < 1e-12);
  assert.ok(Math.abs(minimumImage(-0.9) - 0.1) < 1e-12);
  assert.equal(minimumImage(0.5), 0.5);
  assert.equal(minimumImage(-0.5), -0.5);
  assert.equal(minimumImage(Number.NaN), 0);

  const even = skinCellAt(0.01, 0.01, { rows: 4, columns: 4 });
  const odd = skinCellAt(0, 0.3, { rows: 4, columns: 4 });
  const wrapped = skinCellAt(1.01, 1.01, { rows: 4, columns: 4 });
  assert.deepEqual([even.row, even.column, even.id], [0, 0, 0]);
  assert.deepEqual([odd.row, odd.column, odd.id], [1, 3, 7]);
  assert.equal(odd.centerX, 0);
  assert.deepEqual(
    [wrapped.row, wrapped.column, wrapped.id],
    [even.row, even.column, even.id],
  );
  assert.ok(even.localX >= 0 && even.localX < 1);
  assert.ok(even.localY >= 0 && even.localY < 1);
});

test("flock creation is seeded, well-formed, and aspect-correct", () => {
  const options = {
    count: 20,
    seed: "skin-seed",
    aspect: 1.7,
    rows: 9,
    columns: 12,
    minSpeed: 0.06,
    maxSpeed: 0.2,
  };
  const first = createFlock(options);
  const second = createFlock(options);
  const different = createFlock({ ...options, seed: "other-skin" });

  assert.deepEqual(first, second);
  assert.notDeepEqual(first, different);
  assert.equal(first.length, 20);
  assert.equal(new Set(first.map(({ id }) => id)).size, first.length);
  for (const boid of first) {
    assert.ok(boid.x >= 0 && boid.x < 1);
    assert.ok(boid.y >= 0 && boid.y < 1);
    const speed = Math.hypot(boid.vx * options.aspect, boid.vy);
    assert.ok(speed >= options.minSpeed - 1e-12);
    assert.ok(speed <= options.maxSpeed + 1e-12);
    assert.equal(boid.cellId, skinCellAt(boid.x, boid.y, options).id);
  }
});

test("fixed flock steps are deterministic, finite, bounded, and speed-limited", () => {
  const settings = {
    count: 14,
    seed: 7123,
    aspect: 1.55,
    rows: 11,
    columns: 9,
    minSpeed: 0.055,
    maxSpeed: 0.17,
  };
  const first = createFlock(settings);
  const second = createFlock(settings);
  const firstEvents = [];
  const secondEvents = [];

  for (let frame = 0; frame < 360; frame += 1) {
    firstEvents.push(...stepFlock(first, 1 / 120, settings));
    secondEvents.push(...stepFlock(second, 1 / 120, settings));
  }

  assert.deepEqual(first, second);
  assert.deepEqual(firstEvents, secondEvents);
  assert.ok(firstEvents.length > 0);
  for (const boid of first) {
    assert.ok([boid.x, boid.y, boid.vx, boid.vy, boid.cooldown].every(Number.isFinite));
    assert.ok(boid.x >= 0 && boid.x < 1);
    assert.ok(boid.y >= 0 && boid.y < 1);
    const speed = Math.hypot(boid.vx * settings.aspect, boid.vy);
    assert.ok(speed >= settings.minSpeed - 1e-12);
    assert.ok(speed <= settings.maxSpeed + 1e-12);
  }
});

test("separation, alignment, and cohesion steer in their Reynolds directions", () => {
  const separated = [
    makeBoid(0, 0.45, 0.5, 0.1, 0),
    makeBoid(1, 0.55, 0.5, 0.1, 0),
  ];
  stepFlock(separated, 0.05, { ...isolatedSettings, separation: 1 });
  assert.ok(separated[0].vx < 0.1, "left boid steers away from its neighbour");
  assert.ok(separated[1].vx > 0.1, "right boid steers away from its neighbour");

  const aligned = [
    makeBoid(0, 0.35, 0.5, 0.15, 0),
    makeBoid(1, 0.65, 0.5, 0, 0.15),
  ];
  stepFlock(aligned, 0.05, { ...isolatedSettings, alignment: 1, separationRadius: 0.01 });
  assert.ok(aligned[0].vy > 0, "horizontal boid turns toward vertical neighbour heading");
  assert.ok(aligned[1].vx > 0, "vertical boid turns toward horizontal neighbour heading");

  const cohesive = [
    makeBoid(0, 0.35, 0.5, 0, 0.1),
    makeBoid(1, 0.65, 0.5, 0, 0.1),
  ];
  stepFlock(cohesive, 0.05, { ...isolatedSettings, cohesion: 1, separationRadius: 0.01 });
  assert.ok(cohesive[0].vx > 0, "left boid steers toward flock center");
  assert.ok(cohesive[1].vx < 0, "right boid steers toward flock center");
});

test("attractors support matching attraction and repulsion forces", () => {
  const attracted = [makeBoid(0, 0.4, 0.5, 0, 0.1)];
  const repelled = [makeBoid(0, 0.4, 0.5, 0, 0.1)];
  const pointer = { active: true, x: 0.55, y: 0.5, radius: 0.4, strength: 1 };
  stepFlock(attracted, 0.05, { ...isolatedSettings, pointer });
  stepFlock(repelled, 0.05, {
    ...isolatedSettings,
    pointer: { ...pointer, mode: "repel" },
  });
  assert.ok(attracted[0].vx > 0);
  assert.ok(repelled[0].vx < 0);
});

test("cell changes emit one crossing and cooldown suppresses boundary chatter", () => {
  const settings = {
    ...isolatedSettings,
    minSpeed: 0.2,
    maxSpeed: 0.2,
    crossingCooldown: 0.12,
  };
  const flock = [makeBoid(7, 0.249, 0.1, 0.2, 0)];
  const first = stepFlock(flock, 0.01, settings);
  assert.equal(first.length, 1);
  assert.equal(first[0].boidId, 7);
  assert.equal(first[0].fromCellId, 0);
  assert.equal(first[0].cellId, 1);
  assert.equal(flock[0].cooldown, settings.crossingCooldown);

  flock[0].vx = -0.2;
  const suppressed = stepFlock(flock, 0.01, settings);
  assert.deepEqual(suppressed, []);
  assert.equal(flock[0].cellId, 0, "the latent cell still follows the playhead");

  flock[0].cooldown = 0;
  flock[0].vx = 0.2;
  const retriggered = stepFlock(flock, 0.01, settings);
  assert.equal(retriggered.length, 1);
  assert.equal(retriggered[0].cellId, 1);
});

test("surface topology changes rebase playheads without a false mass trigger", () => {
  const flock = [makeBoid(0, 0.7, 0.6, 0.1, 0)];
  const crossings = stepFlock(flock, 0, {
    ...isolatedSettings,
    rows: 7,
    columns: 9,
  });
  assert.deepEqual(crossings, []);
  assert.equal(flock[0].skinRows, 7);
  assert.equal(flock[0].skinColumns, 9);
  assert.equal(flock[0].cellId, skinCellAt(flock[0].x, flock[0].y, {
    rows: 7,
    columns: 9,
  }).id);
});

test("scale resolution accepts presets and sanitizes custom pitch classes", () => {
  assert.deepEqual(resolveBoidzoidScale("major"), BOIDZOID_SCALES.major);
  assert.deepEqual(resolveBoidzoidScale("minorPentatonic"), BOIDZOID_SCALES.minorPentatonic);
  assert.deepEqual(resolveBoidzoidScale("majorPentatonic"), BOIDZOID_SCALES.majorPentatonic);
  assert.deepEqual(resolveBoidzoidScale("whole-tone"), BOIDZOID_SCALES.wholeTone);
  assert.deepEqual(resolveBoidzoidScale("pelog"), BOIDZOID_SCALES.pelog);
  assert.deepEqual(resolveBoidzoidScale("unknown"), BOIDZOID_SCALES.dorian);
  assert.deepEqual(resolveBoidzoidScale([12, 7, 0, 3, 7, -2, NaN]), [0, 3, 7]);
  assert.deepEqual(resolveBoidzoidScale([]), BOIDZOID_SCALES.dorian);
});

test("crossing-to-string mapping is deterministic, quantized, and expressive", () => {
  const common = {
    rows: 13,
    columns: 11,
    cellId: 60,
    column: 5,
    x: 0.5,
    vx: 0.1,
    vy: 0,
    speed: 0.15,
    energy: 0.6,
  };
  const bottom = mapCrossingToVoice({ ...common, row: 12 }, {
    rootMidi: 38,
    octaves: 3,
    scale: "dorian",
    seed: "voice-map",
  });
  const top = mapCrossingToVoice({ ...common, row: 0, cellId: 5 }, {
    rootMidi: 38,
    octaves: 3,
    scale: "dorian",
    seed: "voice-map",
  });
  assert.equal(bottom.midi, 38);
  assert.equal(top.midi, 74);
  assert.ok(Math.abs(bottom.frequency - 440 * 2 ** ((bottom.midi - 69) / 12)) < 1e-12);
  assert.deepEqual(bottom, mapCrossingToVoice({ ...common, row: 12 }, {
    rootMidi: 38,
    octaves: 3,
    scale: "dorian",
    seed: "voice-map",
  }));

  const allowed = new Set(BOIDZOID_SCALES.dorian);
  for (let row = 0; row < 13; row += 1) {
    const recipe = mapCrossingToVoice({ ...common, row, cellId: row * 11 + 5 });
    const relativePitchClass = ((recipe.midi - 38) % 12 + 12) % 12;
    assert.ok(allowed.has(relativePitchClass));
  }

  const dark = mapCrossingToVoice({ ...common, row: 6, column: 0, cellId: 55 });
  const bright = mapCrossingToVoice({ ...common, row: 6, column: 10, cellId: 65 });
  assert.ok(bright.settings.brightness > dark.settings.brightness);
  assert.ok(bright.settings.damping < dark.settings.damping);

  const soft = mapCrossingToVoice({ ...common, row: 6, energy: 0 });
  const hard = mapCrossingToVoice({ ...common, row: 6, energy: 1 });
  assert.ok(hard.velocity > soft.velocity);
  assert.ok(hard.settings.hardness > soft.settings.hardness);
  assert.equal(hard.settings.coupling, 0, "the high-rate flock map avoids coupled voice allocation");

  assert.equal(mapCrossingToVoice({ ...common, row: 6, vx: 1, vy: 0 }).pan, 1);
  assert.equal(mapCrossingToVoice({ ...common, row: 6, vx: -1, vy: 0 }).pan, -1);
  assert.ok(Object.values(hard.settings).every(Number.isFinite));
  assert.deepEqual(
    sanitizeKarplusStrongSettings({ ...hard.settings, frequency: hard.frequency }),
    { frequency: hard.frequency, ...hard.settings },
    "the recipe drops into the existing Karplus-Strong engine without further repair",
  );
});

test("Boidzoid page exposes the flock, skin, Karplus, and explicit-audio controls", async () => {
  const [html, css, app] = await Promise.all([
    readFile(new URL("boidzoid.html", root), "utf8"),
    readFile(new URL("boidzoid.css", root), "utf8"),
    readFile(new URL("boidzoid-app.js", root), "utf8"),
  ]);
  assert.match(html, /<h1 id="sceneTitle">boid<span>zoid<\/span><\/h1>/i);
  assert.match(html, /id="flockButton"/);
  assert.match(html, /id="morph"[^>]*type="range"/);
  assert.match(html, /id="skinDensity"[^>]*type="range"/);
  assert.match(html, /id="scaleMode"/);
  assert.match(html, /Karplus karpet/i);
  assert.match(html, /id="audioButton"[^>]*aria-pressed="false"/);
  assert.doesNotMatch(html, /<audio\b|type="file"/);
  assert.match(css, /\.boidzoid-stage-wrap/);
  assert.match(css, /@media \(max-width: 650px\)/);
  assert.match(app, /stepFlock\(/);
  assert.match(app, /mapCrossingToVoice\(/);
  assert.match(app, /new KarplusStrongAudio/);
  assert.match(app, /if \(!state\.audioOn/);
});
