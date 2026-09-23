import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { parse } from "acorn";

const root = new URL("../", import.meta.url);
const instrumentScripts = [
  "src/instruments/shape-synth/shape-synth-app.js",
  "src/instruments/playhead-paint/playhead-paint-app.js",
  "src/instruments/lattice/lattice-app.js",
  "src/instruments/spiral/spiral-app.js",
  "src/instruments/solid-synth/solid-synth-app.js",
  "src/families/nonorientable/nonorientable-app.js",
  "src/instruments/hyper-synth/hyper-synth-app.js",
  "src/instruments/l-system/l-system-app.js",
  "src/instruments/l-system-drum-machine/l-system-drum-machine-app.js",
  "src/instruments/linear-drums/linear-drums-app.js",
  "src/instruments/recursion/recursion-app.js",
  "src/instruments/julia/julia-app.js",
  "src/instruments/lumber/lumber-app.js",
  "src/instruments/micmic/micmic-app.js",
  "src/instruments/throatazoid/throatazoid-app.js",
  "src/instruments/pink-trombonazoid/pink-trombonazoid-app.js",
  "src/instruments/throat-singing/throat-singing-app.js",
  "src/families/syrinx/syrinx-app.js",
  "src/instruments/monstroid/monstroid-app.js",
  "src/instruments/wave-pool/wave-pool-app.js",
  "src/instruments/quadruped/quadruped-app.js",
  "src/instruments/shepard-risset/shepard-risset-app.js",
  "src/instruments/slippery-resynthesis/slippery-resynthesis-app.js",
  "src/instruments/micromorph/micromorph-app.js",
  "src/instruments/moire-drone/moire-drone-app.js",
  "src/instruments/drum-roll-please/drum-roll-please-app.js",
  "src/instruments/ouroborousel/ouroborousel-app.js",
  "src/instruments/ouroboros/ouroboros-app.js",
  "src/instruments/ouroboros-borealis/ouroboros-borealis-app.js",
  "src/families/barber-delay/barber-delay-app.js",
  "src/instruments/recursive-fm/recursive-fm-app.js",
  "src/instruments/cascading-fm/cascading-fm-app.js",
  "src/instruments/recursive-pm/recursive-pm-app.js",
  "src/instruments/cascading-pm/cascading-pm-app.js",
  "src/instruments/chaotic-fm/chaotic-fm-app.js",
  "src/instruments/chaotic-pm/chaotic-pm-app.js",
  "src/instruments/webgpu-303/webgpu-303-app.js",
  "src/instruments/webgpu-synths/webgpu-synths-app.js",
  "src/instruments/shader-synth-playground/shader-synth-playground-app.js",
  "src/instruments/rubix/rubix-app.js",
  "src/instruments/weierstrass/weierstrass-app.js",
  "src/families/algorithmic-sequencers/algorithmic-sequencers-app.js",
  "src/families/algorithmic-scores/algorithmic-scores-app.js",
  "src/families/physics/physics-app.js",
  "src/instruments/order-tones/order-tones-app.js",
  "src/instruments/bell-square/bell-square-app.js",
  "src/instruments/annealogue/annealogue-app.js",
  "src/instruments/cantor-lock/cantor-lock-app.js",
  "src/instruments/escape-dust/escape-dust-app.js",
  "src/instruments/linebreaker/linebreaker-app.js",
  "src/families/experiments/experiments-app.js",
  "morphazoidical/app.js",
];

test("top-menu Audio status is binary for legacy engines and truthful for lifecycle-aware engines", async () => {
  for (const file of instrumentScripts) {
    const source = await readFile(new URL(file, root), "utf8").catch((error) => {
      if (file === "src/instruments/recursion/recursion-app.js" && error?.code === "ENOENT") return null;
      throw error;
    });
    if (source === null) continue;
    if (source.includes('setAttribute("data-audio-state-owner", "engine")')) {
      const declaration = parse(source, { sourceType: "module", ecmaVersion: "latest" }).body
        .find(node => node.type === "FunctionDeclaration" && node.id.name === "setAudioPresentation");
      assert.ok(declaration, `${file} declares its lifecycle presentation`);
      for (const state of ["off", "starting", "on", "error", "interrupted"]) {
        const nodes = new Map();
        const node = id => {
          if (!nodes.has(id)) nodes.set(id, {
            attributes: {}, textContent: "", setAttribute(key, value) { this.attributes[key] = value; },
          });
          return nodes.get(id);
        };
        vm.runInNewContext(`${source.slice(declaration.start, declaration.end)}; setAudioPresentation(${JSON.stringify(state)});`, {
          $: node, audioButton: node("audioButton"), audioOn: false, audioStatus: "off",
        });
        assert.equal(node("audioButton").attributes["data-audio-state"], state);
        assert.equal(node("audioButton").attributes["aria-pressed"], String(state === "on"));
        assert.equal(node("audioState").textContent, state);
      }
      continue;
    }
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
