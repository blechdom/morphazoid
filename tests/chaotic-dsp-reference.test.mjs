import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CHAOTIC_DSP_REFERENCE_IDS,
  CHAOTIC_DSP_REFERENCES,
  chaoticDspReferenceForId,
  renderChaoticDspReferences,
} from "../src/chaotic-dsp-reference.js";

const ROOT = new URL("../", import.meta.url);
const SYNTH_PAGES = Object.freeze([
  "recursive-fm",
  "recursive-pm",
  "chaotic-fm",
  "chaotic-pm",
  "cascading-fm",
  "cascading-pm",
  "weierstrass",
]);

function referenceText(id) {
  return JSON.stringify(chaoticDspReferenceForId(id));
}

test("the Chaos Synth DSP reference set covers seven instruments and excludes Plasma Ball", () => {
  assert.deepEqual(CHAOTIC_DSP_REFERENCE_IDS, SYNTH_PAGES);
  assert.equal(CHAOTIC_DSP_REFERENCES.length, 7);
  assert.equal(chaoticDspReferenceForId("plasma-ball"), null);
  assert.equal(renderChaoticDspReferences(undefined), 0);

  for (const reference of CHAOTIC_DSP_REFERENCES) {
    assert.ok(reference.label);
    assert.ok(reference.engine);
    assert.ok(reference.topology);
    assert.equal(reference.algorithm.title, "Algorithm flow");
    assert.equal(reference.audio.title, "DSP / audio path");
    assert.ok(reference.algorithm.sections.length > 0);
    assert.ok(reference.audio.sections.length > 0);
    assert.ok(reference.algorithm.ariaLabel.length > 60);
    assert.ok(reference.audio.ariaLabel.length > 60);
  }
});

test("reference definitions retain the implementation-specific signal paths", () => {
  for (const snippet of [
    "12 OscillatorNodes",
    "offset + M/2 + carrier x M/2",
    "8 ms crossfade",
    "Fixed 0.82",
  ]) assert.match(referenceText("recursive-fm"), new RegExp(snippet.replace(/[+()[\]]/g, "\\$&")));

  for (const snippet of [
    "sin(2pi x (phasor[n] + signal[n-1] x I[n]))",
    "max 64",
    "Crossfade adjacent operator outputs",
    "Persistent phases; per-sample parameter smoothing",
  ]) assert.ok(referenceText("recursive-pm").includes(snippet));

  for (const snippet of [
    "nonlinearityHz x tanh(previous x A[n])",
    "clamp(previous x A[n], -64, +64)",
    "18 Hz high-pass",
    "WaveShaper with 2x oversampling",
  ]) assert.ok(referenceText("chaotic-fm").includes(snippet));

  for (const snippet of [
    "Both transfer banks render continuously",
    "I[radians]",
    "I[cycles]",
    "% 1",
    "Frequency-squared drive",
    "Depth, drive and discontinuity-pressure trim",
  ]) assert.ok(referenceText("chaotic-pm").includes(snippet));

  for (const snippet of [
    "osc[i] x D[i] -> osc[i+1].frequency",
    "modDepth x depthTaper^i",
    "12 preallocated OscillatorNodes",
    "clamp(1 / sqrt(stages), 0.25, 1)",
  ]) assert.ok(referenceText("cascading-fm").includes(snippet));

  for (const snippet of [
    "signal[i] = sin(phase[i] + signal[i-1] x I[i-1])",
    "0.4 x sampleRate",
    "0.45 x sampleRate",
    "no allocation in process()",
    "bounded to [-1, +1]",
  ]) assert.ok(referenceText("cascading-pm").includes(snippet));

  for (const snippet of [
    "48-term bank with Wave, FM and PM branches",
    "a^n x taper",
    "Anti-alias taper",
    "W x bankGain x bankScale",
    "Mode signal x active ramp x 0.48",
    "512-point analysis buffer",
  ]) assert.ok(referenceText("weierstrass").includes(snippet));
});

test("only Recursive FM and PM link to explicitly archival comparison charts", () => {
  const archived = CHAOTIC_DSP_REFERENCES.filter(({ archive }) => archive);
  assert.deepEqual(archived.map(({ id }) => id), ["recursive-fm", "recursive-pm"]);
  for (const reference of archived) {
    assert.match(reference.archive.label, /Archived 2023 flowchart - comparison only/);
    assert.match(reference.archive.href, /blechdom\/recursive-sound/);
    assert.match(reference.archive.href, new RegExp(`${reference.id === "recursive-fm" ? "recursiveFM" : "recursivePM"}\\.png$`));
  }
});

test("all seven pages attach the shared reference after controls and before reset", async () => {
  for (const id of SYNTH_PAGES) {
    const markup = await readFile(new URL(`${id}.html`, ROOT), "utf8");
    assert.equal((markup.match(/data-chaos-dsp-reference="/g) ?? []).length, 1);
    assert.match(markup, new RegExp(`data-chaos-dsp-reference="${id}"`));
    assert.match(markup, /id="dsp-reference"/);
    assert.match(markup, /data-chaos-dsp-reference-body/);
    assert.match(markup, />DSP reference</);
    assert.match(markup, /src="src\/chaotic-dsp-reference\.js"/);
    assert.ok(
      markup.indexOf(`data-chaos-dsp-reference="${id}"`) < markup.indexOf("class=\"reset-all-row\""),
      `${id} should place its reference directly above the reset row`,
    );
  }

  const plasmaMarkup = await readFile(new URL("plasma-ball.html", ROOT), "utf8");
  assert.doesNotMatch(plasmaMarkup, /chaotic-dsp-reference|data-chaos-dsp-reference/);
});

test("the dedicated page renders an unconstrained selectable reference", async () => {
  const [markup, app, stylesheet] = await Promise.all([
    readFile(new URL("chaotic-dsp-reference.html", ROOT), "utf8"),
    readFile(new URL("chaotic-dsp-reference-page.js", ROOT), "utf8"),
    readFile(new URL("chaotic-dsp-reference.css", ROOT), "utf8"),
  ]);

  assert.match(markup, /data-chaos-dsp-reference-page/);
  assert.match(markup, /data-chaos-dsp-full-page/);
  assert.match(markup, /id="dspSynthSelect"/);
  assert.equal((markup.match(/<option value="(?:recursive|chaotic|cascading|weierstrass)/g) ?? []).length, 7);
  assert.match(markup, /src="chaotic-dsp-reference-page\.js"/);
  assert.match(app, /searchParams\.get\("synth"\)/);
  assert.match(app, /renderChaoticDspReference\(root, reference, document\)/);
  assert.match(app, /instrumentLink\.href = `\$\{reference\.id\}\.html#dsp-reference`/);
  assert.match(stylesheet, /\.chaos-dsp-full-body\s*\{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/s);
  assert.match(stylesheet, /@media \(max-width: 900px\)[\s\S]*?\.chaos-dsp-full-body\s*\{[^}]*grid-template-columns: 1fr;/);
  assert.doesNotMatch(stylesheet, /max-height:/);
});

test("the renderer uses semantic DOM and responsive, bounded flowchart nodes", async () => {
  const [moduleSource, stylesheet] = await Promise.all([
    readFile(new URL("src/chaotic-dsp-reference.js", ROOT), "utf8"),
    readFile(new URL("chaotic-synth-ui.css", ROOT), "utf8"),
  ]);

  assert.match(moduleSource, /documentObject\.createElement\("figure"\)/);
  assert.match(moduleSource, /setAttribute\("role", "img"\)/);
  assert.match(moduleSource, /setAttribute\("aria-label", definition\.ariaLabel\)/);
  assert.match(moduleSource, /"Open full diagram"/);
  assert.match(moduleSource, /chaotic-dsp-reference\.html\?synth=/);
  assert.match(moduleSource, /locationObject\?\.hash === `#\$\{root\.id\}`/);
  assert.doesNotMatch(moduleSource, /\.innerHTML\s*=/);
  assert.match(stylesheet, /\.chaos-dsp-step\s*\{[^}]*min-width: 0;/s);
  assert.match(stylesheet, /\.chaos-dsp-step-detail\s*\{[^}]*overflow-wrap: anywhere;/s);
  assert.match(stylesheet, /\.chaos-dsp-step\s*\{[^}]*border-radius: 4px;/s);
  assert.match(stylesheet, /@media \(max-width: 390px\)/);
  assert.match(stylesheet, /\.chaos-dsp-branches\s*\{[^}]*minmax\(132px, 1fr\)/s);
});
