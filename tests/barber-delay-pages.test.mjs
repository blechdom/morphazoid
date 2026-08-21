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
      "Centered Rise",
      "Centered Fall",
      "Slow Coil",
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

test("both barber delays are native internal Morphazoid pages", async () => {
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
    assert.match(
      markup,
      /id="speed"[\s\S]*?min="0"[\s\S]*?max="1"[\s\S]*?data-value-min="0"[\s\S]*?data-value-max="5"[\s\S]*?data-curve="2"[\s\S]*?aria-valuetext=/,
    );
    assert.match(
      markup,
      /id="feedbackTime"[\s\S]*?min="0"[\s\S]*?max="1"[\s\S]*?data-curve="2"[\s\S]*?aria-valuetext="\d+ ms"/,
    );
    assert.match(markup, /class="group control-section barber-delay-analysis"/);
    assert.match(markup, /id="pitchRelationshipSummary"/);
    assert.ok(
      markup.indexOf("barber-delay-analysis")
      > markup.indexOf("barber-delay-sound"),
      `${page.file} keeps pitch relationships in the bottom section`,
    );
    const motionSection = markup.match(
      /class="group control-section barber-delay-motion"[\s\S]*?<\/details>/,
    )?.[0] ?? "";
    assert.doesNotMatch(motionSection, /barber-rate-card/);
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

test("Candy combines tap and one-to-one controls with the centered-hump sweep", async () => {
  const candy = await readFile(
    new URL("candy-coil-delay.html", root),
    "utf8",
  );
  assert.match(candy, /id="tapRange"/);
  assert.match(candy, /id="ratioLock"/);
  assert.match(candy, /range = 1 ÷ speed/);
  assert.match(
    candy,
    /id="range"[\s\S]*?data-value-min="0\.1"[\s\S]*?data-value-max="10"[\s\S]*?data-value-step="0\.001"[\s\S]*?data-curve="3"/,
  );
  assert.match(candy, /id="rangeOut"[^>]*>2000 ms</);
  assert.match(candy, /id="feedbackTimeOut"[^>]*>1000 ms</);
  assert.match(candy, /below → original → above/);
  assert.match(candy, /unboxed live oscilloscopes/i);
  assert.match(candy, /white on red and red on white/i);
  assert.match(candy, /CANDY SCOPE FIELD/);
  assert.match(candy, /LIVE SCOPES · IDLE/);
  assert.match(candy, /With centered window tilt/i);
  assert.match(candy, /crosses the original pitch at its loudest/i);
});

test("Candy restores its original red-and-white catalogue logo", async () => {
  const [liveLogo, currentLogo, pinnedLogo, originalLogo] = await Promise.all([
    readFile(new URL("assets/instruments/candy-coil-delay.webp", root)),
    readFile(new URL(
      "artwork/instrument-icon-variants/candy-coil-delay/catalogue-current.webp",
      root,
    )),
    readFile(new URL(
      "artwork/instrument-icon-variants/candy-coil-delay/round-2-v1.webp",
      root,
    )),
    readFile(new URL(
      "artwork/instrument-icons-round-2/candy-coil-delay.webp",
      root,
    )),
  ]);
  assert.deepEqual(liveLogo, originalLogo);
  assert.deepEqual(currentLogo, originalLogo);
  assert.deepEqual(pinnedLogo, originalLogo);
});

test("the retired centered-hump route is removed", async () => {
  await assert.rejects(
    readFile(new URL("striped-sludge-delay.html", root), "utf8"),
    { code: "ENOENT" },
  );
});

test("Sandy keeps pitch span, history, and grain texture as separate controls", async () => {
  const sandy = await readFile(
    new URL("sandy-syrup-delay.html", root),
    "utf8",
  );
  assert.match(sandy, /data-delay-mode="sandy"/);
  assert.match(sandy, /id="pitchOctaves"[^>]+min="0\.5"[^>]+max="10"/);
  assert.match(
    sandy,
    /id="feedbackTime"[\s\S]*?data-value-min="0\.1"[\s\S]*?data-value-max="15"[\s\S]*?data-value-step="0\.01"[\s\S]*?data-curve="2"/,
  );
  assert.match(
    sandy,
    /id="grainSize"[\s\S]*?data-value-min="0\.005"[\s\S]*?data-value-max="0\.5"[\s\S]*?data-value-step="0\.001"[\s\S]*?data-curve="2"/,
  );
  assert.match(sandy, /id="feedbackTimeOut"[^>]*>4000 ms</);
  assert.match(sandy, /id="grainSizeOut"[^>]*>50 ms</);
  assert.match(sandy, /id="blend"[^>]+min="0"[^>]+max="1"/);
  assert.match(sandy, /Sand · held rate/);
  assert.match(sandy, /Syrup · live rate/);
  assert.match(sandy, /INFINITE HEAD LOOP · HANN FADE/);
  assert.match(
    sandy,
    /Tape heads cycle endlessly through a Shepard–Risset loop/,
  );
  assert.doesNotMatch(sandy, /BARBER SHOP POLES · 04/);
  assert.doesNotMatch(sandy, /sample-and-hold sand ↔ continuous syrup/);
  assert.doesNotMatch(sandy, /liquid grain stripes/i);
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
  assert.match(app, /barberDelaySliderPosition/);
  assert.match(app, /barberDelaySliderValue/);
  assert.match(app, /function formatMilliseconds/);
  assert.doesNotMatch(app, /function formatSeconds/);
  assert.doesNotMatch(app, /toFixed\([^)]*\) s history|toFixed\([^)]*\) S HISTORY/);
  assert.match(app, /new BarberDelayAudio\(mode, globalThis\)/);
  assert.match(app, /source: "microphone"/);
  assert.match(app, /audioButton"\)\.addEventListener\("click", toggleAudio\)/);
  assert.match(app, /audio\.start\(selectedSource\(\)\)/);
  assert.match(app, /getTimeDomainData\(waveform\)/);
  assert.match(app, /1_000 \/ 30/);
  assert.match(app, /function drawCandyOscilloscope/);
  assert.doesNotMatch(app, /function drawAudioFragment/);
  assert.match(app, /sandySyrupTargetRate/);
  assert.match(app, /sandySyrupBaseDelay/);
  assert.match(app, /audio\.reseedSandyGrains\(\)/);
  assert.match(app, /globalCompositeOperation = "destination-in"/);
  assert.doesNotMatch(app, /roundedRectPath|\.(?:arc|arcTo)\(/);
  assert.match(app, /addEventListener\("pagehide"/);
  assert.match(app, /URL\.revokeObjectURL/);
  assert.match(app, /audio\.close\(\)/);
  assert.doesNotMatch(app, /new AudioContext/);
  assert.doesNotMatch(app, /setInterval/);
  assert.match(css, /\.candy-coil-page/);
  assert.doesNotMatch(css, /\.striped-sludge-page/);
  assert.match(css, /\.sandy-syrup-page/);
  assert.match(css, /#dc2f3f/i);
  assert.match(css, /#fff7ea/i);
  assert.match(css, /repeating-linear-gradient/i);
  assert.doesNotMatch(css, /#9cad45/i);
  assert.match(css, /#20ccaa/i);
  assert.doesNotMatch(app, /drawSludgeField/);

  const candyScope = app.match(
    /function drawCandyOscilloscope\([\s\S]*?\n}\n\nfunction drawCandyField/,
  )?.[0] ?? "";
  assert.match(candyScope, /head\.back/);
  assert.match(candyScope, /head\.ink/);
  assert.match(candyScope, /head\.angle \+ Math\.PI \* 0\.5/);
  assert.match(candyScope, /scope\.compact \? 10 : 15/);
  assert.match(candyScope, /: 0;/);
  assert.doesNotMatch(candyScope, /fillRect|strokeRect|\.rect\(/);

  assert.doesNotMatch(app, /const visualDirection/);
  assert.match(app, /state\.visualPhase[\s\S]*?\+ elapsed \* state\.settings\.speed/);

  const inertAudio = new BarberDelayAudio("candy", {});
  assert.equal(inertAudio.context, null);
  assert.equal(inertAudio.state.initialized, false);
});
