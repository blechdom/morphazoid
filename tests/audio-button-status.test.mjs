import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const instrumentScripts = [
  "app.js",
  "playhead-paint-app.js",
  "lattice-app.js",
  "spiral-app.js",
  "solid-app.js",
  "hyper-app.js",
  "l-system-app.js",
  "l-system-drums-app.js",
  "linear-drums-app.js",
  "recursion-app.js",
  "julia-app.js",
  "lumber-app.js",
  "micmic-app.js",
  "throatazoid-app.js",
  "pink-trombonazoid-app.js",
  "syrinx-app.js",
  "colony-syrinx-app.js",
  "shepard-risset-app.js",
  "slippery-resynthesis-app.js",
  "moire-drone-app.js",
  "drum-roll-please-app.js",
  "ouroborousel-app.js",
  "ouroboros-app.js",
  "ouroboros-borealis-app.js",
  "barber-delay-app.js",
  "recursive-fm-app.js",
  "cascading-fm-app.js",
  "recursive-pm-app.js",
  "cascading-pm-app.js",
  "chaotic-fm-app.js",
  "chaotic-pm-app.js",
  "webgpu-303-app.js",
  "webgpu-synths-app.js",
  "shader-synth-playground-app.js",
  "rubix-app.js",
  "weierstrass-app.js",
  "algorithmic-sequencers-app.js",
  "algorithmic-scores-app.js",
  "physics-app.js",
  "order-tones-app.js",
  "bell-square-app.js",
  "annealogue-app.js",
  "cantor-lock-app.js",
  "escape-dust-app.js",
  "linebreaker-app.js",
  "experiments-app.js",
  "morphazoidical/app.js",
];

test("top-menu Audio status is always the binary on/off state", async () => {
  for (const file of instrumentScripts) {
    const source = await readFile(new URL(file, root), "utf8").catch((error) => {
      if (file === "recursion-app.js" && error?.code === "ENOENT") return null;
      throw error;
    });
    if (source === null) continue;
    const statusLines = source
      .split("\n")
      .filter((line) => (
        line.includes("audioState")
        && !/\.dataset\.audioState|dataset\[["']audioState["']\]/.test(line)
      ));

    assert.ok(statusLines.length, `${file} must update the top Audio status`);
    assert.doesNotMatch(
      statusLines.join("\n"),
      /["'](?:listening|input paused|starting(?:…|\.\.\.)?|unavailable|sine fallback|live|stopping…|allow mic…)["']/i,
      `${file} must keep detailed lifecycle text out of the top Audio button`,
    );
    assert.match(
      source,
      /audioState[^;\n]*(?:"on"|"off")|(?:textContent|setText)[^;\n]*audioState/,
      `${file} must expose a binary on/off Audio status`,
    );
  }
});
