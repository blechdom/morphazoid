import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  PLASMA_DEFAULTS,
  clamp,
  wrapAngle,
  closestGlassPoint,
  createPlasmaBolts,
  stepPlasmaBolts,
  plasmaBoltPath,
  plasmaVoiceSpecs,
} from "../src/plasma-ball.js";

const root = new URL("../", import.meta.url);
const TAU = Math.PI * 2;

function closeTo(actual, expected, tolerance = 1e-9, message = "") {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    message || `${actual} should be within ${tolerance} of ${expected}`,
  );
}

function assertFinitePoint(point, message) {
  assert.ok(point && typeof point === "object", `${message} must be a point`);
  assert.ok(Number.isFinite(point.x), `${message}.x must be finite`);
  assert.ok(Number.isFinite(point.y), `${message}.y must be finite`);
  assert.ok(Number.isFinite(point.z), `${message}.z must be finite`);
}

function assertBoundedBolt(bolt, message) {
  assert.ok(
    (typeof bolt.id === "string" && bolt.id.length > 0) || Number.isFinite(bolt.id),
    `${message}.id must be a stable scalar`,
  );
  for (const key of [
    "angle",
    "latitude",
    "targetAngle",
    "targetLatitude",
    "velocity",
    "phase",
    "energy",
    "seed",
    "age",
    "lifetime",
    "cycle",
    "gate",
    "affinity",
    "rate",
  ]) {
    assert.ok(Number.isFinite(bolt[key]), `${message}.${key} must be finite`);
  }
  assert.ok(bolt.angle >= 0 && bolt.angle < TAU, `${message}.angle must wrap to one turn`);
  assert.ok(
    bolt.targetAngle >= 0 && bolt.targetAngle < TAU,
    `${message}.targetAngle must wrap to one turn`,
  );
  assert.ok(
    bolt.latitude >= -Math.PI / 2 && bolt.latitude <= Math.PI / 2,
    `${message}.latitude must stay on the sphere`,
  );
  assert.ok(
    bolt.targetLatitude >= -Math.PI / 2 && bolt.targetLatitude <= Math.PI / 2,
    `${message}.targetLatitude must stay on the sphere`,
  );
  assert.ok(bolt.phase >= 0 && bolt.phase < TAU, `${message}.phase must wrap to one turn`);
  assert.ok(bolt.energy >= 0 && bolt.energy <= 1.25, `${message}.energy must remain bounded`);
  assert.ok(Math.abs(bolt.velocity) <= 20, `${message}.velocity must remain bounded`);
  assert.ok(bolt.age >= 0 && bolt.age <= bolt.lifetime + 1e-6, `${message}.age must stay in its cycle`);
  assert.ok(bolt.lifetime > 0 && bolt.lifetime <= 30, `${message}.lifetime must be positive and bounded`);
  assert.ok(Number.isInteger(bolt.cycle) && bolt.cycle >= 0, `${message}.cycle must count whole bursts`);
  assert.ok(bolt.gate >= 0 && bolt.gate <= 1, `${message}.gate must be normalized`);
  assert.ok(bolt.affinity >= 0 && bolt.affinity <= 1, `${message}.affinity must be normalized`);
  assert.ok(bolt.rate >= 0.08 && bolt.rate <= 4, `${message}.rate must stay bounded`);
}

function pointDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

test("Plasma Ball numeric helpers clamp safely and project touches onto the glass", () => {
  assert.equal(clamp(-2, 0, 1), 0);
  assert.equal(clamp(0.4, 0, 1), 0.4);
  assert.equal(clamp(3, 0, 1), 1);
  closeTo(wrapAngle(-Math.PI / 2), Math.PI * 1.5);
  closeTo(wrapAngle(TAU + 0.25), 0.25);

  const glassPoint = closestGlassPoint({ x: 2, y: -1, z: 2 }, 0.9);
  closeTo(glassPoint.x, 0.6);
  closeTo(glassPoint.y, -0.3);
  closeTo(glassPoint.z, 0.6);
  closeTo(Math.hypot(glassPoint.x, glassPoint.y, glassPoint.z), 0.9);

  const centerFallback = closestGlassPoint({ x: 0, y: 0, z: 0 }, 0.8);
  assertFinitePoint(centerFallback, "center projection");
  closeTo(Math.hypot(centerFallback.x, centerFallback.y, centerFallback.z), 0.8);
});

test("bolt creation is seeded, deterministic, unique, and bounded", () => {
  assert.ok(PLASMA_DEFAULTS && typeof PLASMA_DEFAULTS === "object");
  const first = createPlasmaBolts(9, 0x51a7);
  const repeat = createPlasmaBolts(9, 0x51a7);
  const otherSeed = createPlasmaBolts(9, 0x51a8);

  assert.equal(first.length, 9);
  assert.deepEqual(first, repeat);
  assert.notDeepEqual(first, otherSeed);
  assert.equal(new Set(first.map(({ id }) => id)).size, first.length);
  first.forEach((bolt, index) => assertBoundedBolt(bolt, `bolt ${index}`));
  assert.ok(
    new Set(first.map(({ latitude }) => latitude.toFixed(4))).size > first.length / 2,
    "seeded filaments must begin across several depths of the globe",
  );
  assert.ok(
    new Set(first.map(({ lifetime }) => lifetime.toFixed(3))).size > first.length / 2,
    "static bursts need asynchronous lifetimes rather than a shared cycle",
  );
  assert.equal(createPlasmaBolts(10_000, 1).length, 24, "visual and audio polyphony must stay bounded");
});

test("speed and intensity scales a simultaneous field of slow and fast filaments", () => {
  const bolts = createPlasmaBolts(16, 0x51eed);
  const rates = bolts.map(({ rate }) => rate);
  assert.ok(Math.min(...rates) < 0.35, "the field needs distinctly slow filaments");
  assert.ok(Math.max(...rates) > 2.4, "the field needs distinctly fast filaments");
  assert.ok(
    new Set(rates.map((rate) => rate.toFixed(3))).size >= 12,
    "filaments should not collapse into one or two shared rates",
  );

  const synchronized = bolts.map((bolt) => ({ ...bolt, age: 0, lifetime: 10, cycle: 0 }));
  const defaultStep = stepPlasmaBolts(synchronized, { dt: 0.01, time: 0, speed: 0.72 });
  const slowestIndex = rates.indexOf(Math.min(...rates));
  const fastestIndex = rates.indexOf(Math.max(...rates));
  assert.ok(
    defaultStep[fastestIndex].age > defaultStep[slowestIndex].age * 6,
    "independent rates must remain visibly separated under one slider setting",
  );

  const lowIntensity = stepPlasmaBolts(synchronized, { dt: 0.01, time: 0, speed: 0.1 });
  const highIntensity = stepPlasmaBolts(synchronized, { dt: 0.01, time: 0, speed: 1 });
  assert.ok(
    highIntensity[fastestIndex].age > lowIntensity[fastestIndex].age * 6,
    "the slider must strongly scale the whole mixed-rate field",
  );
});

test("fixed stepping returns fresh deterministic state and stays bounded over time", () => {
  const options = {
    dt: 1 / 120,
    time: 0,
    speed: 1,
    attraction: 0.72,
    pointer: null,
  };
  const original = createPlasmaBolts(12, 7201);
  const firstStep = stepPlasmaBolts(original, options);
  const repeatStep = stepPlasmaBolts(original, options);

  assert.notEqual(firstStep, original, "stepping must not mutate the bolt array in place");
  assert.notEqual(firstStep[0], original[0], "stepping must return fresh bolt records");
  assert.deepEqual(firstStep, repeatStep, "the same state and options must give the same step");
  assert.deepEqual(original, createPlasmaBolts(12, 7201), "the input state must remain untouched");

  let bolts = original;
  for (let frame = 0; frame < 4_800; frame += 1) {
    bolts = stepPlasmaBolts(bolts, {
      ...options,
      time: frame / 120,
      pointer: frame % 480 < 240
        ? { x: -0.52, y: 0.28, z: 0.806, active: true }
        : null,
    });
  }
  assert.equal(bolts.length, original.length);
  bolts.forEach((bolt, index) => assertBoundedBolt(bolt, `long-running bolt ${index}`));
});

test("static bursts cycle irregularly instead of holding every filament open", () => {
  let bolts = createPlasmaBolts(16, 0x57a71c);
  const gateRanges = bolts.map(() => ({ minimum: 1, maximum: 0 }));
  const energyRanges = bolts.map(() => ({ minimum: Infinity, maximum: -Infinity }));
  const partialFrames = [];

  for (let frame = 0; frame < 2_400; frame += 1) {
    bolts = stepPlasmaBolts(bolts, {
      dt: 1 / 120,
      time: frame / 120,
      speed: 1,
      attraction: 0.8,
      pointer: null,
    });
    if (frame % 12 !== 0) continue;
    let open = 0;
    bolts.forEach((bolt, index) => {
      gateRanges[index].minimum = Math.min(gateRanges[index].minimum, bolt.gate);
      gateRanges[index].maximum = Math.max(gateRanges[index].maximum, bolt.gate);
      energyRanges[index].minimum = Math.min(energyRanges[index].minimum, bolt.energy);
      energyRanges[index].maximum = Math.max(energyRanges[index].maximum, bolt.energy);
      if (bolt.gate > 0.35) open += 1;
    });
    partialFrames.push(open > 0 && open < bolts.length);
  }

  assert.ok(bolts.some(({ cycle }) => cycle >= 2), "filaments must be reborn across a long run");
  assert.ok(
    new Set(bolts.map(({ cycle }) => cycle)).size > 1,
    "independent static lifetimes must not cycle in lockstep",
  );
  assert.ok(
    gateRanges.filter(({ minimum, maximum }) => minimum < 0.12 && maximum > 0.65).length >= bolts.length / 2,
    "most filaments need both clearly off and clearly conducting phases",
  );
  assert.ok(
    energyRanges.some(({ minimum, maximum }) => maximum - minimum > 0.45),
    "discharge energy needs sharp irregular changes rather than a steady drone",
  );
  assert.ok(
    partialFrames.filter(Boolean).length > partialFrames.length * 0.7,
    "the field should usually contain a mixture of lit and dormant filaments",
  );
});

test("a front-glass touch focuses only a minority while the rest keep reaching elsewhere", () => {
  const radius = 1;
  const pointer = closestGlassPoint({ x: 0.58, y: -0.24, z: 0.78 }, radius);
  pointer.active = true;
  let idle = createPlasmaBolts(20, 0xf1e1d);
  let touched = createPlasmaBolts(20, 0xf1e1d);

  for (let frame = 0; frame < 480; frame += 1) {
    const shared = { dt: 1 / 120, time: frame / 120, speed: 0.7, attraction: 1 };
    idle = stepPlasmaBolts(idle, { ...shared, pointer: null });
    touched = stepPlasmaBolts(touched, { ...shared, pointer });
  }

  const pathOptions = { radius, time: 4, jitter: 0, branching: 0 };
  const idleEndpoints = idle.map((bolt) => plasmaBoltPath(bolt, pathOptions).trunk.at(-1));
  const touchedEndpoints = touched.map((bolt) => plasmaBoltPath(bolt, pathOptions).trunk.at(-1));
  const idleDistances = idleEndpoints.map((endpoint) => pointDistance(endpoint, pointer));
  const touchedDistances = touchedEndpoints.map((endpoint) => pointDistance(endpoint, pointer));
  const stronglyFocused = touchedDistances.filter((distance) => distance < 0.48).length;
  const stillRoaming = touchedDistances.filter((distance) => distance > 0.9).length;

  assert.ok(
    touchedDistances.some((distance, index) => distance + 0.15 < idleDistances[index]),
    "contact must strongly pull at least one eligible spark toward the finger",
  );
  assert.ok(stronglyFocused >= 1, "some sparks must visibly focus at the contact");
  assert.ok(
    stronglyFocused < touched.length / 2,
    "touch must not collapse most of the field into one flat radial bundle",
  );
  assert.ok(
    stillRoaming >= touched.length / 4,
    "several nonfocused sparks must continue reaching distant parts of the sphere",
  );
  const roaming = touchedEndpoints.filter((_, index) => touchedDistances[index] > 0.9);
  const maximumSpread = roaming.reduce((maximum, point, index) => (
    Math.max(maximum, ...roaming.slice(index + 1).map((other) => pointDistance(point, other)), 0)
  ), 0);
  assert.ok(maximumSpread > 0.9, "nonfocused endpoints must remain meaningfully spread in 3D");
});

test("plasma paths reach the glass and keep all trunk and branch geometry finite", () => {
  const radius = 0.86;
  const bolts = createPlasmaBolts(10, 0xb017);
  let branchCount = 0;

  for (const bolt of bolts) {
    const options = { radius, time: 1.25, jitter: 0.12, branching: 0.7 };
    const path = plasmaBoltPath(bolt, options);
    assert.deepEqual(path, plasmaBoltPath(bolt, options), "path geometry must be deterministic per frame");
    assert.ok(Array.isArray(path.trunk) && path.trunk.length >= 3, "each bolt needs a visible trunk");
    assert.ok(Array.isArray(path.branches), "branch geometry must be an array");
    assert.ok(path.trunk.length <= 256, "trunk tessellation must stay bounded");
    assert.ok(path.branches.length <= 24, "branch count must stay bounded");

    path.trunk.forEach((point, index) => {
      assertFinitePoint(point, `${bolt.id} trunk ${index}`);
      assert.ok(
        Math.hypot(point.x, point.y, point.z) <= radius + 0.05,
        "trunk must remain inside the 3D glass",
      );
    });
    const endpoint = path.trunk.at(-1);
    closeTo(
      Math.hypot(endpoint.x, endpoint.y, endpoint.z),
      radius,
      1e-6,
      "every main discharge must terminate exactly on the spherical glass",
    );

    for (const [branchIndex, branch] of path.branches.entries()) {
      assert.ok(Array.isArray(branch) && branch.length >= 2, "branches need at least two points");
      assert.ok(branch.length <= 128, "branch tessellation must stay bounded");
      branch.forEach((point, pointIndex) => {
        assertFinitePoint(point, `${bolt.id} branch ${branchIndex}:${pointIndex}`);
        assert.ok(
          Math.hypot(point.x, point.y, point.z) <= radius + 0.05,
          "branches must remain inside the 3D glass",
        );
      });
      assert.ok(
        pointDistance(branch[0], branch.at(-1)) > radius * 0.025,
        "a branch must have visible spatial length",
      );
    }
    branchCount += path.branches.length;
  }
  assert.ok(branchCount > 0, "the plasma field must visibly fork into secondary branches");
  const endpointDepths = bolts.map((bolt) => plasmaBoltPath(bolt, {
    radius,
    time: 1.25,
    jitter: 0,
    branching: 0,
  }).trunk.at(-1).z);
  assert.ok(
    Math.max(...endpointDepths) - Math.min(...endpointDepths) > radius * 0.75,
    "filaments must occupy foreground and background depths, not a flat disc",
  );
});

test("each gated bolt maps to a moderate, depth-aware, free-pitch synth voice", () => {
  assert.ok(
    PLASMA_DEFAULTS.level >= 0.3 && PLASMA_DEFAULTS.level <= 0.4,
    "the instrument must open at a moderate master level",
  );
  let bolts = createPlasmaBolts(18, 0xa0d10);
  for (let frame = 0; frame < 90; frame += 1) {
    bolts = stepPlasmaBolts(bolts, { dt: 1 / 120, time: frame / 120 });
  }
  const voices = plasmaVoiceSpecs(bolts, { radius: 0.86, pointer: null });
  assert.equal(voices.length, bolts.length);
  assert.equal(new Set(voices.map(({ key }) => key)).size, bolts.length);

  for (const [index, voice] of voices.entries()) {
    assert.equal(typeof voice.key, "string");
    assert.ok(Number.isFinite(voice.pitch01), `voice ${index} pitch must be finite`);
    assert.ok(voice.pitch01 >= 0 && voice.pitch01 <= 1, `voice ${index} pitch must be normalized`);
    assert.ok(Number.isFinite(voice.gain), `voice ${index} gain must be finite`);
    assert.ok(voice.gain >= 0 && voice.gain <= 0.055, `voice ${index} gain must preserve soft headroom`);
    assert.ok(Number.isFinite(voice.pan), `voice ${index} pan must be finite`);
    assert.ok(voice.pan >= -1 && voice.pan <= 1, `voice ${index} pan must be normalized`);
    assert.ok(Number.isFinite(voice.depth), `voice ${index} needs a finite depth coordinate`);
    assert.ok(voice.depth >= -1 && voice.depth <= 1, `voice ${index} depth must be normalized`);
    assert.match(voice.waveform, /^(?:sine|triangle|sawtooth|square)$/);
  }
  assert.ok(
    voices.reduce((sum, voice) => sum + voice.gain, 0) <= 0.42,
    "the full field must leave generous mix headroom",
  );
  assert.ok(
    Math.max(...voices.map(({ depth }) => depth)) - Math.min(...voices.map(({ depth }) => depth)) > 0.7,
    "voice coordinates must span the acoustic foreground and background",
  );

  const inactiveBolt = { ...bolts[0], gate: 0, energy: 0.15 };
  const conductingBolt = { ...bolts[0], gate: 1, energy: 1 };
  const inactiveVoice = plasmaVoiceSpecs([inactiveBolt])[0];
  const conductingVoice = plasmaVoiceSpecs([conductingBolt])[0];
  assert.ok(inactiveVoice.gain <= 0.004, "a closed static gate must be effectively silent");
  assert.ok(
    conductingVoice.gain > inactiveVoice.gain * 4,
    "a discharge should sound like an event rather than an always-open oscillator",
  );

  const baseBolt = { ...bolts[0], angle: 1.1 };
  const nearbyBolt = { ...baseBolt, angle: 1.101, latitude: baseBolt.latitude + 0.0007 };
  const basePitch = plasmaVoiceSpecs([baseBolt])[0].pitch01;
  const nearbyPitch = plasmaVoiceSpecs([nearbyBolt])[0].pitch01;
  assert.notEqual(nearbyPitch, basePitch, "sub-degree motion must not be pitch-quantized");
  assert.ok(Math.abs(nearbyPitch - basePitch) < 0.01, "nearby endpoints must produce nearby pitches");

  const beforeSeam = plasmaVoiceSpecs([{ ...baseBolt, angle: TAU - 0.0001 }])[0].pitch01;
  const afterSeam = plasmaVoiceSpecs([{ ...baseBolt, angle: 0.0001 }])[0].pitch01;
  assert.ok(
    Math.abs(beforeSeam - afterSeam) < 0.001,
    "crossing the glass angle seam must not jump through the full pitch span",
  );
});

test("Plasma Ball is a labelled, keyboard-accessible Morphazoid instrument", async () => {
  const html = await readFile(new URL("plasma-ball.html", root), "utf8");
  assert.match(html, /<title>Plasma Ball (?:—|\|) Morphazoid<\/title>/);
  assert.match(html, /href="style\.css"/);
  assert.match(html, /href="plasma-ball\.css"/);
  assert.match(html, /<h1\b[^>]*>Plasma Ball<\/h1>/);
  assert.match(html, /<script type="module" src="nav\.js"><\/script>/);
  assert.match(html, /<script type="module" src="plasma-ball-app\.js"><\/script>/);
  assert.match(html, /<canvas\b[^>]*\bid="stage"[^>]*\btabindex="0"/);
  assert.match(html, /\bid="stage"[^>]*\baria-(?:label|labelledby)="[^"]+"/);
  assert.match(html, /\bid="audioButton"[^>]*\baria-pressed="false"/);
  assert.match(html, /\bid="audioState"[^>]*>off<\/small>/);
  assert.match(html, /\bid="playButton"/);
  assert.match(html, /\bid="resetButton"/);
  assert.match(html, /mouse|pointer|touch/i);
  assert.match(html, /intermittent|static/i, "the interaction copy must describe event-like discharges");
  assert.match(html, /three-dimensional|3D/i, "the accessible copy must identify the globe as 3D");

  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "markup ids must be unique");
  for (const controlId of [
    "boltCount", "attraction", "motion", "baseFrequency", "pitchRange", "level",
  ]) {
    assert.match(html, new RegExp(`<label\\b[^>]*\\bfor="${controlId}"`), `${controlId} needs a label`);
    assert.match(html, new RegExp(`\\bid="${controlId}"`), `${controlId} needs a control`);
  }
  assert.doesNotMatch(html, /pentatonic|chromatic|major scale|minor scale/i);
  assert.match(html, /Speed \/ intensity/);
  assert.match(html, /id="level"[\s\S]*?max="0\.64"[\s\S]*?value="0\.32"/);
  assert.doesNotMatch(html, /https?:\/\//, "the instrument must not depend on remote runtime assets");
});

test("browser controller uses bounded shared audio, direct glass gestures, and lifecycle cleanup", async () => {
  const [app, core] = await Promise.all([
    readFile(new URL("plasma-ball-app.js", root), "utf8"),
    readFile(new URL("src/plasma-ball.js", root), "utf8"),
  ]);
  assert.match(app, /new VoicePool\(/);
  const poolArgument = app.match(/new VoicePool\((\d+|[A-Z][A-Z0-9_]*)\)/)?.[1] ?? "";
  const poolSize = /^\d+$/.test(poolArgument)
    ? Number(poolArgument)
    : Number(app.match(new RegExp(`(?:const|let)\\s+${poolArgument}\\s*=\\s*(\\d+)`))?.[1]);
  assert.ok(Number.isInteger(poolSize) && poolSize >= 1 && poolSize <= 24, "VoicePool must be explicitly bounded");
  assert.match(app, /plasmaVoiceSpecs/);
  assert.match(app, /pitch01ToFrequency/);
  assert.match(app, /function projectPoint\(/, "3D points must be projected into the canvas view");
  assert.match(app, /voice\.depth/, "spark depth must influence the synthesis, not visuals alone");
  assert.match(app, /\.strike\(/, "static discharges need short transient strikes");
  assert.match(app, /attackNoise\s*:\s*(?:0\.)?[1-9]\d*/, "strikes need a noise component");
  assert.match(app, /bolt\.rate/, "audio transients must retain each filament's independent rate");
  assert.match(app, /requestAnimationFrame/);
  assert.match(app, /pointerdown/);
  assert.match(app, /pointermove/);
  assert.match(app, /pointerup/);
  assert.match(app, /pointercancel/);
  assert.match(app, /setPointerCapture/);
  assert.match(app, /releasePointerCapture/);
  assert.match(app, /pointerleave/);
  assert.match(app, /prefers-reduced-motion: reduce/);
  assert.match(app, /visibilitychange/);
  assert.match(app, /addEventListener\("pagehide"/);
  assert.match(app, /\.close\(\)/);
  assert.doesNotMatch(app, /pentatonic|chromatic|quantiz|SCALE_STEPS/i);
  assert.doesNotMatch(app, /new AudioContext|webkitAudioContext/, "audio must stay inside the shared VoicePool");
  assert.doesNotMatch(core, /\bdocument\b|\bwindow\b|AudioContext|requestAnimationFrame/);
});
