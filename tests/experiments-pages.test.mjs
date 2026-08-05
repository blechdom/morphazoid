import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

const experimentPages = [
  ["moire-organ.html", "moire", "Moire Organ", "moire-organ"],
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
    "moireFringeSpan",
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
