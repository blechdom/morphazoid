import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

const experimentPages = [
  ["moire-organ.html", "moire", "RISSET-MOIRE", "moire-organ"],
  ["chladni-plate.html", "chladni", "Chladni Plate", "chladni-plate"],
  ["spring-choir.html", "springs", "Spring Choir", "spring-choir"],
  ["gear-ratio-drums.html", "gears", "Gear Ratio Drums", "gear-ratio-drums"],
  ["cellular-automata.html", "automata", "Cellular Automata", "cellular-automata"],
  ["prime-sieve.html", "primes", "Prime Sieve", "prime-sieve"],
  ["lissajous-orbits.html", "lissajous", "Lissajous Orbits", "lissajous-orbits"],
  ["pendulum-wave.html", "pendulums", "Pendulum Wave", "pendulum-wave"],
  ["double-pendulum.html", "doublependulum", "Double Pendulum", "double-pendulum"],
  ["reaction-diffusion.html", "reaction", "Reaction-Diffusion", "reaction-diffusion"],
  ["atomic-orbitals.html", "orbitals", "Atomic Orbitals", "atomic-orbitals"],
  ["dna-translator.html", "dna", "DNA Translator", "dna-translator"],
  ["neural-pulse.html", "neural", "Neural Pulse", "neural-pulse"],
  ["fourier-epicycles.html", "fourier", "Fourier Epicycles", "fourier-epicycles"],
  ["gravity-lens.html", "lensing", "Gravity Lens", "gravity-lens"],
];

test("experiment pages are native Morphazoid pages with shared controls", async () => {
  for (const [file, mode, title, toolId] of experimentPages) {
    const html = await readFile(new URL(file, root), "utf8");
    assert.match(html, new RegExp(`<body[^>]*data-experiment="${mode}"`));
    assert.match(html, new RegExp(`<h1>${title}`));
    assert.match(html, /<link rel="stylesheet" href="style\.css"/);
    assert.match(html, /<link rel="stylesheet" href="experiments\.css"/);
    assert.match(html, /<script type="module" src="nav\.js"><\/script>/);
    assert.match(html, /<script type="module" src="experiments-app\.js"><\/script>/);
    assert.match(html, /id="audioButton"/);
    assert.match(html, /id="level"/);
    assert.match(html, /id="stageReadout"/);
    assert.match(html, /id="metricPrimary"/);
    assert.match(html, /id="metricSecondary"/);
    assert.match(html, /data-reset-all>Reset all parameters<\/button>/);
    assert.match(html, new RegExp(`href="${file}" aria-current="page"`));
    assert.match(html, new RegExp(`value="${file}" selected`));
    assert.match(html, new RegExp(toolId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
    assert.equal(new Set(ids).size, ids.length, `${file} contains a duplicate id`);
  }
});

test("experiment runtime contains each simulation and audio mapping", async () => {
  const [app, css] = await Promise.all([
    readFile(new URL("experiments-app.js", root), "utf8"),
    readFile(new URL("experiments.css", root), "utf8"),
  ]);
  for (const key of [
    "moire",
    "chladni",
    "springs",
    "gears",
    "automata",
    "primes",
    "lissajous",
    "pendulums",
    "doublependulum",
    "reaction",
    "orbitals",
    "dna",
    "neural",
    "fourier",
    "lensing",
  ]) {
    assert.match(app, new RegExp(`${key}: \\{`));
  }
  for (const name of [
    "moireShepardVoices",
    "moireSpectralWindow",
    "moireAudibleFrequency",
    "moireAngleRate",
    "moireLineIntersection",
    "moireScene",
    "chladniValue",
    "springModeAmplitudes",
    "drawGear",
    "stepAutomataRow",
    "stepPrimeSieve",
    "drawLissajous",
    "pendulumCoherence",
    "doublePendulumAcceleration",
    "stepReactionGrid",
    "associatedLaguerre",
    "codonAmino",
    "fireNeuralInput",
    "fourierCoefficient",
    "lensGeometry",
  ]) {
    assert.match(app, new RegExp(name));
  }
  assert.match(app, /class ExperimentAudio/);
  assert.match(app, /createDynamicsCompressor/);
  assert.match(app, /pagehide/);
  assert.match(css, /\.experiment-title/);
  assert.match(css, /\.experiment-meter-grid/);
});

test("RISSET-MOIRE pairs every line with a counter-moving Shepard oscillator", async () => {
  const [html, app] = await Promise.all([
    readFile(new URL("moire-organ.html", root), "utf8"),
    readFile(new URL("experiments-app.js", root), "utf8"),
  ]);

  assert.match(html, /id="moireInterval"[^>]*min="0\.1"[^>]*max="2"[^>]*step="0\.01"[^>]*value="1"/);
  assert.match(html, /id="moireVoices"[^>]*min="4"[^>]*max="12"[^>]*value="8"/);
  assert.match(html, /id="moireSecondPair" type="checkbox"/);
  assert.match(html, /id="moireLayerOffset"[^>]*max="4"/);
  assert.match(html, /id="moireUpAngle"[^>]*min="0"[^>]*max="30"[^>]*value="4"/);
  assert.match(html, /id="moireDownAngle"[^>]*min="0"[^>]*max="30"[^>]*value="4"/);
  assert.match(html, /id="moireOverlap"[^>]*max="2"/);
  assert.doesNotMatch(html, /id="moireDrift"/);
  assert.match(html, /Green rising and pink falling Shepard voices/);
  assert.match(html, /Each line is one Shepard oscillator/);
  assert.match(app, /const MAX_CONTINUOUS_VOICES = 48;/);
  assert.match(app, /const MOIRE_DEFAULT_VOICES = 8;/);
  assert.match(app, /const MOIRE_OCTAVES_PER_DEGREE_SECOND = 0\.045;/);
  assert.match(app, /const layerCount = state\.moireSecondPair \? 2 : 1;/);
  assert.match(app, /for \(let slot = 0; slot < voiceCount; slot \+= 1\)/);
  assert.match(app, /for \(const direction of \[1, -1\]\)/);
  assert.match(app, /return moireScene\(\)\.voices\.map/);
  assert.match(app, /voice\.gain = bankGain \* voice\.amplitude \* normalization/);
  assert.match(app, /crossing\.strength \* state\.moireOverlap/);
  assert.match(app, /state\.moireUpPhase \+ moireAngleRate\(state\.moireUpAngle\)/);
  assert.match(app, /state\.moireDownPhase - moireAngleRate\(state\.moireDownAngle\)/);
  assert.match(app, /createLinearGradient/);
});
