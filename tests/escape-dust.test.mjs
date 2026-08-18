import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ESCAPE_DUST_DEFAULTS,
  applyClosedTriadicBaker,
  applyPartitionedBaker,
  classicalPhaseSpaceDensity,
  classicalSurvivalRatio,
  complexEnergy,
  createClassicalEnsemble,
  createEscapeDustSimulation,
  createGaussianWavePacket,
  createSeededRandom,
  deriveEscapeDustSound,
  openingBounds,
  openingPartition,
  projectWaveOpening,
  stepClassicalEnsemble,
  stepEscapeDustSimulation,
  stepOpenWave,
  unitaryDft,
  wavePositionDensity,
  windowedFourierDensity,
} from "../src/escape-dust.js";

const root = new URL("../", import.meta.url);
const TOLERANCE = 1e-10;

function close(actual, expected, tolerance = TOLERANCE, message = "") {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    message || `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

test("the seeded classical packet is deterministic without collapsing to one point", () => {
  const first = createClassicalEnsemble({
    classicalCount: 64,
    seed: "dust-seed",
    packetPosition: 0.27,
    packetMomentum: 0.71,
    packetSpread: 0.05,
  });
  const second = createClassicalEnsemble({
    classicalCount: 64,
    seed: "dust-seed",
    packetPosition: 0.27,
    packetMomentum: 0.71,
    packetSpread: 0.05,
  });
  const different = createClassicalEnsemble({
    classicalCount: 64,
    seed: "another-seed",
    packetPosition: 0.27,
    packetMomentum: 0.71,
    packetSpread: 0.05,
  });
  assert.deepEqual(first, second);
  assert.notDeepEqual(first.points.slice(0, 4), different.points.slice(0, 4));
  assert.ok(new Set(first.points.map((point) => point.q.toFixed(8))).size > 40);
  assert.equal(first.survivors, 64);
  close(classicalSurvivalRatio(first), 1);

  const randomA = createSeededRandom(91);
  const randomB = createSeededRandom(91);
  assert.deepEqual(Array.from({ length: 20 }, randomA), Array.from({ length: 20 }, randomB));
});

test("one-third opening performs the exact two surviving triadic baker branches", () => {
  const ensemble = {
    points: [
      { id: 0, q: 0.1, p: 0.6, alive: true, escapedAt: null },
      { id: 1, q: 0.5, p: 0.2, alive: true, escapedAt: null },
      { id: 2, q: 0.9, p: 0.6, alive: true, escapedAt: null },
    ],
    step: 0,
    initialCount: 3,
    survivors: 3,
    escapedThisStep: 0,
    totalEscaped: 0,
  };
  const stepped = stepClassicalEnsemble(ensemble, { openingWidth: 1 / 3 });
  close(stepped.points[0].q, 0.3);
  close(stepped.points[0].p, 0.2);
  assert.equal(stepped.points[1].alive, false);
  assert.equal(stepped.points[1].escapedAt, 1);
  close(stepped.points[2].q, 0.7);
  close(stepped.points[2].p, 13 / 15);
  assert.equal(stepped.survivors, 2);
  assert.equal(stepped.escapedThisStep, 1);
  assert.equal(stepped.totalEscaped, 1);
  assert.equal(ensemble.points.every((point) => point.alive), true, "the input stays immutable");
});

test("a ternary Cantor-cycle trajectory survives while a middle point escapes", () => {
  let ensemble = {
    points: [
      { id: 0, q: 0.25, p: 0.42, alive: true, escapedAt: null },
      { id: 1, q: 0.5, p: 0.42, alive: true, escapedAt: null },
    ],
    step: 0,
    initialCount: 2,
    survivors: 2,
  };
  for (let index = 0; index < 12; index += 1) {
    ensemble = stepClassicalEnsemble(ensemble, { openingWidth: 1 / 3 });
  }
  assert.equal(ensemble.points[0].alive, true);
  assert.equal(ensemble.points[1].alive, false);
  assert.equal(ensemble.points[1].escapedAt, 1);
  assert.equal(ensemble.survivors, 1);
  assert.equal(ensemble.totalEscaped, 1);
});

test("classical survivor accounting never respawns an escaped point", () => {
  let ensemble = createClassicalEnsemble({ classicalCount: 300, seed: 8, packetSpread: 0.2 });
  let previous = ensemble.survivors;
  for (let index = 0; index < 16; index += 1) {
    ensemble = stepClassicalEnsemble(ensemble, { openingWidth: 1 / 3 });
    assert.ok(ensemble.survivors <= previous);
    assert.equal(ensemble.survivors + ensemble.totalEscaped, ensemble.initialCount);
    assert.equal(
      ensemble.points.filter((point) => point.alive).length,
      ensemble.survivors,
    );
    previous = ensemble.survivors;
  }
});

test("the finite DFT round-trips complex data and preserves energy", () => {
  const input = new Float64Array(18);
  for (let index = 0; index < input.length; index += 1) {
    input[index] = Math.sin(index * 0.77) + Math.cos(index * 0.19) * 0.3;
  }
  const transformed = unitaryDft(input);
  const restored = unitaryDft(transformed, true);
  close(complexEnergy(transformed), complexEnergy(input), 1e-9);
  for (let index = 0; index < input.length; index += 1) {
    close(restored[index], input[index], 1e-9);
  }
});

test("the closed triadic baker is unitary before the opening is applied", () => {
  const input = createGaussianWavePacket({
    waveSize: 81,
    packetPosition: 0.22,
    packetMomentum: 0.63,
    packetSpread: 0.08,
  }).amplitudes;
  const output = applyClosedTriadicBaker(input);
  close(complexEnergy(output), complexEnergy(input), 1e-9);
  assert.equal(output.length, input.length);
  assert.throws(
    () => applyClosedTriadicBaker(new Float64Array(10)),
    /dimension divisible by 3/,
  );
});

test("off-default apertures use matching grid-snapped classical and wave blocks", () => {
  const source = createGaussianWavePacket({ waveSize: 81, seed: 9 }).amplitudes;
  for (const requestedWidth of [0.18, 0.46]) {
    const partition = openingPartition(81, requestedWidth);
    assert.equal(partition.blockSizes.reduce((sum, value) => sum + value, 0), 81);
    assert.equal(partition.blockSizes[0], partition.blockSizes[2]);
    close(partition.width, partition.openingCells / 81);
    close((1 - partition.width) / 2, partition.branchCells / 81);
    const transformed = applyPartitionedBaker(source, requestedWidth);
    close(complexEnergy(transformed), complexEnergy(source), 1e-9);
    const projected = projectWaveOpening(source, requestedWidth);
    const projectedCells = Array.from({ length: 81 }, (_, index) => (
      projected[index * 2] === 0 && projected[index * 2 + 1] === 0
    )).filter(Boolean).length;
    assert.equal(projectedCells, partition.openingCells);

    const simulation = createEscapeDustSimulation({ openingWidth: requestedWidth, waveSize: 81 });
    close(simulation.settings.openingWidth, partition.width);
    const next = stepEscapeDustSimulation(simulation);
    close(next.settings.openingWidth, partition.width);
  }
});

test("the open wave propagator leaks monotonically and never restores norm", () => {
  let wave = createGaussianWavePacket({
    waveSize: 81,
    packetPosition: 0.31,
    packetMomentum: 0.7,
    packetSpread: 0.09,
  });
  let previous = wave.norm;
  for (let index = 0; index < 18; index += 1) {
    wave = stepOpenWave(wave, { openingWidth: 1 / 3 });
    assert.ok(wave.norm <= previous + 1e-11, `${wave.norm} must not exceed ${previous}`);
    assert.ok(wave.norm >= -1e-12);
    close(wave.totalLeak, 1 - wave.norm, 1e-9);
    previous = wave.norm;
  }
  assert.ok(wave.norm < 0.2, "repeated openings should remove substantial wave energy");
});

test("one wave step loses exactly the energy projected into the opening", () => {
  const wave = createGaussianWavePacket({
    waveSize: 81,
    packetPosition: 0.5,
    packetMomentum: 0.2,
    packetSpread: 0.055,
  });
  const projected = projectWaveOpening(wave.amplitudes, 1 / 3);
  const next = stepOpenWave(wave, { openingWidth: 1 / 3 });
  close(next.norm, complexEnergy(projected), 1e-9);
  close(next.escapedThisStep, wave.norm - next.norm, 1e-9);
  assert.ok(next.norm < 0.02, "a packet centered in the hole should mostly escape");

  const bounds = openingBounds(1 / 3);
  close(bounds.start, 1 / 3);
  close(bounds.end, 2 / 3);
});

test("phase-space and position displays conserve their reported finite totals", () => {
  const simulation = createEscapeDustSimulation({ classicalCount: 243, seed: 22 });
  const classical = classicalPhaseSpaceDensity(simulation.classical, 17);
  const wavePosition = wavePositionDensity(simulation.wave);
  const windowed = windowedFourierDensity(simulation.wave, 17);
  assert.equal(classical.size, 17);
  assert.equal(classical.values.reduce((sum, value) => sum + value, 0), 243);
  close(wavePosition.reduce((sum, value) => sum + value, 0), simulation.wave.norm);
  close(windowed.values.reduce((sum, value) => sum + value, 0), simulation.wave.norm, 1e-9);
  assert.ok([...windowed.values].every((value) => Number.isFinite(value) && value >= 0));
});

test("combined classical and wave stepping is deterministic and synchronized", () => {
  let first = createEscapeDustSimulation({ seed: 311, packetPosition: 0.29 });
  let second = createEscapeDustSimulation({ seed: 311, packetPosition: 0.29 });
  for (let index = 0; index < 7; index += 1) {
    first = stepEscapeDustSimulation(first);
    second = stepEscapeDustSimulation(second);
  }
  assert.deepEqual(first, second);
  assert.equal(first.step, 7);
  assert.equal(first.classical.step, first.wave.step);
  close(first.waveDensity.total, first.wave.norm, 1e-9);
});

test("the sound contract maps state to bounded, deterministic, perceivable dimensions", () => {
  const lowQ = createEscapeDustSimulation({
    packetPosition: 0.1,
    packetMomentum: 0.2,
    packetSpread: 0.035,
    seed: 4,
  });
  const highQ = createEscapeDustSimulation({
    packetPosition: 0.8,
    packetMomentum: 0.2,
    packetSpread: 0.035,
    seed: 4,
  });
  const lowSound = deriveEscapeDustSound(lowQ);
  const repeated = deriveEscapeDustSound(lowQ);
  const highSound = deriveEscapeDustSound(highQ);
  assert.deepEqual(lowSound, repeated);
  assert.ok(highSound.telemetry.rootMidi > lowSound.telemetry.rootMidi + 8);
  assert.ok(lowSound.waveVoices.length >= 2);
  assert.equal(lowSound.classicalClicks.length, 2);
  assert.ok(lowSound.waveVoices.every((voice) => (
    voice.frequency >= 24
    && voice.frequency <= 12_000
    && voice.gain >= 0
    && voice.gain <= 1
    && voice.pan >= -1
    && voice.pan <= 1
    && voice.mode === "pm"
  )));

  const narrow = deriveEscapeDustSound({
    ...lowQ,
    settings: { ...lowQ.settings, openingWidth: 0.18 },
  });
  const wide = deriveEscapeDustSound({
    ...lowQ,
    settings: { ...lowQ.settings, openingWidth: 0.46 },
  });
  assert.ok(wide.telemetry.voiceCount <= narrow.telemetry.voiceCount);
  assert.ok(wide.telemetry.restStride <= narrow.telemetry.restStride);
});

test("escape flux creates an amber accent and shrinking norm thins orchestration", () => {
  let simulation = createEscapeDustSimulation({
    packetPosition: 0.5,
    packetSpread: 0.065,
    seed: 12,
  });
  const initial = deriveEscapeDustSound(simulation);
  simulation = stepEscapeDustSimulation(simulation);
  const escaped = deriveEscapeDustSound(simulation);
  assert.equal(initial.escapeAccent.gain, 0);
  assert.ok(escaped.escapeAccent.gain > 0);
  assert.ok(escaped.classicalEscapeAccent.flux >= 0);
  assert.ok(escaped.waveEscapeAccent.flux >= 0);
  close(
    escaped.escapeAccent.flux,
    Math.min(1, escaped.classicalEscapeAccent.flux + escaped.waveEscapeAccent.flux),
  );
  assert.ok(escaped.telemetry.escapeFlux > 0);
  assert.ok(escaped.telemetry.waveNorm < initial.telemetry.waveNorm);
  assert.ok(escaped.telemetry.voiceCount <= initial.telemetry.voiceCount);
});

test("near-total wave loss becomes near-silent instead of keeping a fixed chord floor", () => {
  const simulation = createEscapeDustSimulation({ seed: 41 });
  const full = deriveEscapeDustSound(simulation);
  const amplitudeScale = 0.01;
  const quietSimulation = {
    ...simulation,
    wave: {
      ...simulation.wave,
      amplitudes: Float64Array.from(
        simulation.wave.amplitudes,
        (value) => value * amplitudeScale,
      ),
      norm: simulation.wave.norm * amplitudeScale ** 2,
    },
  };
  const quiet = deriveEscapeDustSound(quietSimulation);
  const fullGain = full.waveVoices.reduce((sum, voice) => sum + voice.gain, 0);
  const quietGain = quiet.waveVoices.reduce((sum, voice) => sum + voice.gain, 0);
  assert.ok(quietGain < fullGain * 0.03);
});

test("Escape Dust markup exposes all layers, controls, mappings, and scientific guardrails", async () => {
  const html = await readFile(new URL("escape-dust.html", root), "utf8");
  assert.match(html, /<link rel="stylesheet" href="style\.css"/);
  assert.match(html, /<link rel="stylesheet" href="fractal-uncertainty\.css"/);
  assert.match(html, /<body class="fractal-uncertainty-page escape-dust-page">/);
  assert.match(html, /<main class="shell fractal-uncertainty-shell" id="escapeDust">/);
  assert.match(html, /FRACTAL UNCERTAINTY · 02/);
  assert.match(html, /<h1 id="escapeDustTitle">Escape Dust<\/h1>/);
  assert.match(html, /FINITE CLASSICAL FOURIER MODEL · NOT A PROOF · NOT QPU OUTPUT/);
  assert.match(html, /open-map analogy/i);
  assert.match(html, /not a claim of uniform equidistribution/i);
  assert.match(html, /href="https:\/\/annals\.math\.princeton\.edu\/2018\/187-3\/p05" target="_blank" rel="noopener"/);
  assert.match(html, /href="https:\/\/annals\.math\.princeton\.edu\/2025\/202-1\/p04" target="_blank" rel="noopener"/);

  for (const route of ["./", "cantor-lock.html", "escape-dust.html", "linebreaker.html"]) {
    assert.match(html, new RegExp(`(?:href|value)="${route.replace(".", "\\.")}"`));
  }
  for (const id of [
    "stage", "stageReadout", "liveStatus", "audioButton", "audioState", "audioError",
    "playButton", "stepButton", "restartButton", "viewModeButtons", "packetPosition",
    "packetMomentum", "packetSpread", "openingWidth", "seed", "stepRate", "level",
    "survivorReadout", "waveNormReadout", "waveLeakReadout", "soundSummary",
    "melodyMapping", "harmonyMapping", "textureMapping", "dynamicsMapping",
    "rhythmMapping", "phraseMapping", "accentMapping", "resetEscapeDust",
    "escapeSoundAnatomy", "escapeSoundAnatomyTitle", "soundAnatomyState",
    "soundCoordinates", "soundPitch", "soundVoiceCount", "escapeVoiceListTitle",
    "soundVoices", "soundClock",
    "soundDynamics", "soundTexture", "soundSpatial", "soundClassical",
    "soundAccent", "soundLayers", "soundDiagnosis", "escapeControlGuideTitle",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), `${id} must exist`);
  }
  for (const view of ["classical", "wave", "overlay"]) {
    assert.match(html, new RegExp(`data-view="${view}"`));
  }
});

test("Escape Dust explains the live sound anatomy and every perceptual control", async () => {
  const html = await readFile(new URL("escape-dust.html", root), "utf8");
  assert.match(html, /class="sound-anatomy"[\s\S]+data-sound-anatomy[\s\S]+data-current-view="overlay"/);
  assert.match(html, /class="sound-anatomy-head"/);
  assert.match(html, /class="sound-anatomy-state"[\s\S]+aria-live="polite"[\s\S]+aria-atomic="true"/);
  assert.match(html, /class="sound-anatomy-grid"[\s\S]+aria-label="Live Escape Dust sound anatomy"/);
  assert.match(html, /class="sound-anatomy-voices" aria-labelledby="escapeVoiceListTitle"/);
  assert.match(html, /<output id="soundVoices">/);
  assert.match(html, /class="sound-anatomy-diagnosis" data-sound-diagnosis/);
  assert.match(html, /<details class="sound-control-guide" open>/);
  assert.match(html, /<summary id="escapeControlGuideTitle">What each control should change<\/summary>/);

  for (const dimension of [
    "coordinates", "pitch", "voices", "clock", "dynamics", "texture",
    "space", "classical", "escape", "layers",
  ]) {
    assert.match(html, new RegExp(`data-sound-dimension="${dimension}"`));
  }
  for (const control of [
    "Position q", "Momentum p", "Packet spread σ", "Middle opening", "Point seed",
    "Map rate", "Classical / Wave / Overlay", "Master level",
  ]) {
    assert.match(html, new RegExp(`<dt>${control.replaceAll("/", "\\/")}<\\/dt>`));
  }
  assert.match(html, /held between map steps[\s\S]+read as a drone/i);
  assert.match(html, /does not create chord progression or goal-directed melody/i);
  assert.match(html, /survivors move, their centroid can also shift the wave-chord root/i);
});

test("Escape Dust markup has unique ids and labels every adjustable control", async () => {
  const html = await readFile(new URL("escape-dust.html", root), "utf8");
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const control of [
    "level", "stepRate", "packetPosition", "packetMomentum", "packetSpread",
    "openingWidth", "seed",
  ]) {
    assert.match(html, new RegExp(`<label[^>]*for="${control}"`), `${control} needs a label`);
  }
  assert.match(html, /id="stage"[\s\S]+tabindex="0"[\s\S]+role="img"/);
  assert.match(html, /aria-describedby="escapeDustDescription canvasInstructions liveStatus"/);
  assert.match(html, /id="audioState">off<\/small>/);
  assert.match(html, /id="audioButton"[^>]+aria-pressed="false"/);
});

test("Escape Dust app uses bounded VoicePool layers, stable mappings, shortcuts, and BFCache cleanup", async () => {
  const app = await readFile(new URL("escape-dust-app.js", root), "utf8");
  assert.match(app, /new VoicePool\(12/);
  assert.match(app, /deriveEscapeDustSound\(simulation\)/);
  assert.match(app, /voices\.setVoices\(sound\.waveVoices/);
  assert.match(app, /sound\.classicalClicks/);
  assert.match(app, /sound\.classicalEscapeAccent/);
  assert.match(app, /sound\.waveEscapeAccent/);
  assert.match(app, /voices\.strike\(accent/);
  assert.match(app, /attackNoise: accent\.attackNoise/);
  assert.match(app, /event\.key === " "/);
  assert.match(app, /event\.key === "ArrowRight"/);
  assert.match(app, /event\.key\.toLowerCase\(\) === "v"/);
  assert.match(app, /pointerdown/);
  assert.match(app, /visibilitychange/);
  assert.match(app, /pagehide/);
  assert.match(app, /event\.persisted/);
  assert.match(app, /pageshow/);
  assert.match(app, /voices\.disable\(\)/);
  assert.match(app, /voices\.close\(\)/);
});

test("Escape Dust sound anatomy reports computed synth targets rather than generic prose", async () => {
  const app = await readFile(new URL("escape-dust-app.js", root), "utf8");
  assert.match(app, /function livingCentroid\(\)/);
  assert.match(app, /sound\.waveVoices\.map/);
  assert.match(app, /sound\.waveVoices\.reduce/);
  assert.match(app, /sound\.classicalClicks\.map/);
  assert.match(app, /selectedEscapeAccent\(\)/);
  assert.match(app, /telemetry\.rootFrequency/);
  assert.match(app, /telemetry\.phaseSlope/);
  assert.match(app, /telemetry\.phraseShape/);
  assert.match(app, /telemetry\.waveNorm/);
  assert.match(app, /telemetry\.entropy/);
  assert.match(app, /telemetry\.leftFraction/);
  assert.match(app, /audibleAccent\.attackNoise/);
  assert.match(app, /anatomy\.dataset\.currentView = state\.view/);
  assert.match(app, /The root and one of five pitch offsets are quantized/);
  assert.match(app, /Main worklet: sine-carrier PM/);
  assert.match(app, /Native fallback:/);
  assert.match(app, /const cents = Math\.round\(\(midi - nearest\) \* 100\)/);
  assert.match(app, /const transportState = state\.playing \? "running" : "paused"/);
  assert.match(app, /Last-step target:/);
  assert.match(app, /function togglePlaying\(\)[\s\S]*?updateSoundLedger\(\)/);

  for (const id of [
    "soundAnatomyState", "soundCoordinates", "soundPitch", "soundVoiceCount", "soundVoices",
    "soundClock", "soundDynamics", "soundTexture", "soundSpatial",
    "soundClassical", "soundAccent", "soundLayers", "soundDiagnosis",
  ]) {
    assert.match(app, new RegExp(`\\$\\("${id}"\\)\\.textContent`), `${id} must update live`);
  }
});

test("Escape Dust defaults remain the disclosed triadic setup", () => {
  assert.equal(ESCAPE_DUST_DEFAULTS.waveSize % 3, 0);
  close(ESCAPE_DUST_DEFAULTS.openingWidth, 1 / 3);
  assert.ok(ESCAPE_DUST_DEFAULTS.classicalCount >= 243);
});
