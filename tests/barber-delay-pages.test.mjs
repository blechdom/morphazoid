import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  BARBER_DELAY_PRESETS,
  BarberDelayAudio,
} from "../src/barber-delay.js";

const root = new URL("../", import.meta.url);

const pages = [
  {
    mode: "candy",
    file: "candy-coil-delay.html",
    title: "Candy Coil Delay",
    presetNames: [
      "Dry Coil",
      "Short Echo",
      "Dual Grind",
      "Tape Sustain",
      "Dense Spiral",
      "Tight Comb",
      "Slow Wash",
      "Falling Deep",
      "Fast & Dirty",
      "Frozen Lake",
      "Still Resonance",
      "Long Repeat",
    ],
  },
  {
    mode: "sludge",
    file: "striped-sludge-delay.html",
    title: "Striped Sludge Delay",
    presetNames: [
      "Centered Rise",
      "Centered Fall",
      "Slow Sludge",
      "Thick Tar",
      "Quick Stripe",
      "Mud Churn",
      "Dual Grind",
      "Wide Sweep",
      "Frozen Bog",
      "Tight Wobble",
      "Long Pour",
      "Gentle Ooze",
    ],
  },
  {
    mode: "sandy",
    file: "sandy-syrup-delay.html",
    title: "Sandy Syrup Delay",
    presetNames: [
      "Silk Rise",
      "Silk Fall",
      "Pure Grit",
      "Pure Syrup",
      "Glacial Drift",
      "Robot Grind",
      "Grain Cloud",
      "Silk Glide",
      "Metal Shimmer",
      "Feedback Drone",
      "Full Spectrum",
      "Gentle Blend",
    ],
  },
];

test("all three barber delays are native internal Morphazoid pages", async () => {
  for (const page of pages) {
    const markup = await readFile(new URL(page.file, root), "utf8");
    assert.match(markup, new RegExp(`<body[^>]+data-delay-mode="${page.mode}"`));
    assert.match(markup, new RegExp(page.title));
    assert.match(markup, /<link rel="stylesheet" href="style\.css"/);
    assert.match(markup, /<link rel="stylesheet" href="barber-delay\.css"/);
    assert.match(markup, /<script type="module" src="nav\.js"><\/script>/);
    assert.match(markup, /<script type="module" src="barber-delay-app\.js"><\/script>/);
    assert.match(markup, /id="audioButton"[^>]+aria-pressed="false"/);
    assert.match(markup, /id="audioState">off</);
    assert.doesNotMatch(markup, /id="audioState">listening</i);
    assert.match(markup, /id="sourceSummary">microphone · headphones</);
    assert.match(
      markup,
      /id="sourceChoice"[^>]+aria-describedby="sourceNote"/,
    );
    assert.match(markup, /id="sourceMic"[^>]+aria-pressed="true"/);
    assert.match(markup, /id="sourceFile"[^>]+aria-pressed="false"/);
    assert.match(markup, /id="fileControls"[^>]+hidden/);
    assert.match(markup, /id="filePicker"[^>]+accept="audio\/\*"/);
    assert.match(markup, /id="loopFile"/);
    assert.match(markup, /id="presetGrid"/);
    assert.match(markup, /id="feedback"/);
    assert.match(markup, /id="dryWet"/);
    assert.match(markup, /id="inputGain"/);
    assert.match(markup, /id="outputLevel"/);
    assert.match(markup, /data-reset-all/);
    assert.match(markup, /headphones/i);
    assert.match(markup, /Switch Audio on to allow microphone access/i);
    assert.doesNotMatch(markup, /https?:\/\//i);
    assert.doesNotMatch(markup, /<iframe\b/i);
    assert.doesNotMatch(markup, /target\s*=\s*["']_blank/i);

    const desktop = markup.match(/<nav class="tabs"[\s\S]*?<\/nav>/)?.[0] ?? "";
    const mobile = markup.match(
      /<select class="mobile-instrument-select"[\s\S]*?<\/select>/,
    )?.[0] ?? "";
    assert.equal((desktop.match(/aria-current="page"/g) ?? []).length, 1);
    assert.equal((mobile.match(/\sselected(?:\s|>)/g) ?? []).length, 1);
  }
});

test("Candy keeps tap range and one-to-one lock while Sludge stays centered-hump focused", async () => {
  const [candy, sludge] = await Promise.all([
    readFile(new URL("candy-coil-delay.html", root), "utf8"),
    readFile(new URL("striped-sludge-delay.html", root), "utf8"),
  ]);
  assert.match(candy, /id="tapRange"/);
  assert.match(candy, /id="ratioLock"/);
  assert.match(candy, /range = 1 ÷ speed/);
  assert.doesNotMatch(sludge, /id="tapRange"/);
  assert.doesNotMatch(sludge, /id="ratioLock"/);
  assert.match(sludge, /below → original → above/);
  assert.match(sludge, /crosses the original pitch at its loudest/i);
});

test("Sandy keeps pitch span, history, and grain texture as separate controls", async () => {
  const sandy = await readFile(
    new URL("sandy-syrup-delay.html", root),
    "utf8",
  );
  assert.match(sandy, /data-delay-mode="sandy"/);
  assert.match(sandy, /id="pitchOctaves"[^>]+min="0\.5"[^>]+max="10"/);
  assert.match(sandy, /id="feedbackTime"[^>]+min="0\.1"[^>]+max="15"/);
  assert.match(sandy, /id="grainSize"[^>]+min="0\.005"[^>]+max="0\.5"/);
  assert.match(sandy, /id="blend"[^>]+min="0"[^>]+max="1"/);
  assert.match(sandy, /Sand · held rate/);
  assert.match(sandy, /Syrup · live rate/);
  assert.doesNotMatch(sandy, /id="range"/);
  assert.doesNotMatch(sandy, /id="tapRange"/);
  assert.doesNotMatch(sandy, /id="ratioLock"/);
});

test("the shared app preserves every authoritative built-in preset", () => {
  for (const page of pages) {
    const bank = BARBER_DELAY_PRESETS[page.mode];
    assert.equal(bank.length, 12);
    assert.deepEqual(bank.map((preset) => preset.label), page.presetNames);
    assert.equal(new Set(bank.map((preset) => preset.id)).size, bank.length);
    assert.ok(bank.every((preset) => preset.settings.feedback < 1));
    assert.ok(bank.every((preset) => preset.settings.numVoices <= 12));
  }
});

test("the shared controller keeps audio behind the menu gesture and cleans resources", async () => {
  const [app, css] = await Promise.all([
    readFile(new URL("barber-delay-app.js", root), "utf8"),
    readFile(new URL("barber-delay.css", root), "utf8"),
  ]);

  assert.match(app, /from "\.\/src\/barber-delay\.js"/);
  assert.match(app, /new BarberDelayAudio\(mode, globalThis\)/);
  assert.match(app, /source: "microphone"/);
  assert.match(app, /audioButton"\)\.addEventListener\("click", toggleAudio\)/);
  assert.match(app, /audio\.start\(selectedSource\(\)\)/);
  assert.match(app, /getTimeDomainData\(waveform\)/);
  assert.match(app, /1_000 \/ 30/);
  assert.match(app, /function drawAudioFragment/);
  assert.match(app, /globalCompositeOperation = "destination-in"/);
  assert.doesNotMatch(app, /roundedRectPath|\.(?:arc|arcTo)\(/);
  assert.match(app, /addEventListener\("pagehide"/);
  assert.match(app, /URL\.revokeObjectURL/);
  assert.match(app, /audio\.close\(\)/);
  assert.doesNotMatch(app, /new AudioContext/);
  assert.doesNotMatch(app, /setInterval/);
  assert.match(css, /\.candy-coil-page/);
  assert.match(css, /\.striped-sludge-page/);
  assert.match(css, /\.sandy-syrup-page/);
  assert.match(css, /#c9f04b/i);
  assert.match(css, /#69d9ee/i);
  assert.match(css, /#20ccaa/i);

  const inertAudio = new BarberDelayAudio("candy", {});
  assert.equal(inertAudio.context, null);
  assert.equal(inertAudio.state.initialized, false);
});
