import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("Wheel of Organs keeps its stable route inside Signal & Voice", async () => {
  const html = await readFile(new URL("image-to-instrument-3.html", root), "utf8");
  assert.match(html, /data-image-instrument="3"/);
  assert.match(html, /<title>Wheel of Organs \| Morphazoid<\/title>/);
  assert.match(html, /id="stage"[^>]*tabindex="0"/);
  assert.match(html, /aria-describedby="canvasInstructions liveStatus"/);
  assert.match(html, /id="audioButton"[^>]*aria-pressed="false"/);
  assert.match(html, /id="transportButton"[^>]*aria-pressed="false"/);
  assert.match(html, /class="play-button wheel-play-button" id="transportButton"/);
  assert.match(html, /class="transport-spin"/);
  assert.match(html, /<span>spin wheel<\/span>/i);
  assert.doesNotMatch(html, /transport-(?:play|pause)|play word loop/i);
  assert.match(html, /id="mapWordButton"[^>]*>set letter wheel<\/button>/i);
  assert.match(html, /signal → voice/);
  assert.match(html, /SIGNAL \/ VOICE/);
  assert.doesNotMatch(html, /image → instrument/);
  assert.doesNotMatch(html, /III \/ III/);
  assert.match(html, /id="petalButtons"/);
  assert.match(html, /id="aperture"[^>]*type="range"/);
  assert.match(html, /id="tongue"[^>]*type="range"/);
  assert.match(html, /id="emphasis"[^>]*type="range"/);
  assert.match(html, /id="pinch"[^>]*type="range"/);
  assert.match(html, /id="push"[^>]*type="range"/);
  assert.match(html, /id="nasality"[^>]*type="range"/);
  assert.match(html, /id="screech"[^>]*type="range"/);
  assert.match(html, /id="legato"[^>]*type="range"/);
  assert.match(html, /id="pulseRate"[^>]*max="720"[^>]*value="250"/);
  assert.match(html, /spin force<\/b><output id="pulseRateOut"[^>]*>6\+ turns<\/output>/i);
  assert.match(html, /crossing bloom<\/b><output id="legatoOut"/i);
  assert.match(html, /3 o'clock organ reader/i);
  assert.match(html, /accelerate → coast → brake/i);
  assert.match(html, /final organ holds 1\.6s, fades 2\.4s, then unlocks/i);
  assert.match(html, /quiet and still at rest/i);
  assert.match(html, /data-reset-all[^>]*>reset organism<\/button>/);
  assert.match(html, /<script type="module" src="nav\.js"><\/script>/);
  assert.match(html, /<script type="module" src="image-to-instrument-app\.js"><\/script>/);

  for (const index of [1, 2]) {
    await assert.rejects(
      readFile(new URL(`image-to-instrument-${index}.html`, root), "utf8"),
      (error) => error?.code === "ENOENT",
    );
  }
});

test("Wheel of Organs explains its causal reading of the reference organism", async () => {
  const wheel = await readFile(new URL("image-to-instrument-3.html", root), "utf8");
  assert.match(wheel, /one typed-letter occurrence/);
  assert.match(wheel, /growth \+ stretch \+ pitch \+ screech/);
  assert.match(wheel, /pull past ring = grow \/ shriek/);
  assert.match(wheel, /id="wordInput"[^>]*value="ORGANISM"/);
  assert.match(wheel, /id="mouthLetter"/);
  assert.match(wheel, /typing grows \/ shrinks the ring/);
  assert.doesNotMatch(wheel, /id="(?:add|remove)Mouth"/);
  assert.match(wheel, /id="glottis"[^>]*type="range"/);
  assert.match(wheel, /id="mouthSize"[^>]*type="range"/);
  assert.match(wheel, /id="stretch"[^>]*type="range"/);
  assert.match(wheel, /id="tongueOut"[^>]*type="range"/);
  assert.match(wheel, /every typed letter grows a mouth/i);
  assert.match(wheel, /mouth sounds only as it crosses the fixed three-o'clock organ reader/i);
  assert.match(wheel, /final organ holds for 1\.6 seconds and fades for 2\.4 seconds before another spin is allowed/i);
  assert.ok(
    wheel.indexOf("wheel-translation-card") > wheel.indexOf("image-panel-actions"),
    "the explanatory mapping belongs at the bottom of the control panel",
  );
});

test("Wheel of Organs exposes the original patch and several lower-noise presets", async () => {
  const wheel = await readFile(new URL("image-to-instrument-3.html", root), "utf8");
  const presetButtons = [...wheel.matchAll(/data-wheel-preset="([^"]+)"/g)]
    .map((match) => match[1]);
  assert.deepEqual(presetButtons, [
    "original",
    "clear",
    "velvet",
    "hum",
    "glass",
    "speech",
    "giant",
  ]);
  assert.match(wheel, /Wet organism/);
  assert.match(wheel, /very low noise/);
  assert.match(wheel, /nasal, nearly no hiss/);
  assert.ok(
    wheel.indexOf("wheel-word-card") < wheel.indexOf("wheel-preset-card"),
    "spin controls should lead the panel before preset and explanatory content",
  );
});

test("the stable image-to-instrument route delegates to the internal Wheel runtime", async () => {
  const [app, css] = await Promise.all([
    readFile(new URL("image-to-instrument-app.js", root), "utf8"),
    readFile(new URL("image-to-instrument.css", root), "utf8"),
  ]);
  assert.match(app, /mountWheelOfOrgans/);
  assert.match(app, /audio\.disable\(\)/);
  assert.match(app, /audio\.close\(\)/);
  assert.doesNotMatch(app, /getUserMedia|MediaStream|FileReader/);
  assert.match(css, /@media \(max-width: 960px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /touch-action: none/);
  assert.match(css, /\.wheel-spin-legend/);
  assert.match(css, /\.wheel-word-actions button:disabled/);
  assert.match(css, /\.wheel-play-button\[aria-pressed="true"\]:disabled/);
});

test("Wheel of Organs uses a dedicated formant runtime without external input", async () => {
  const [app, audio] = await Promise.all([
    readFile(new URL("wheel-of-organs-app.js", root), "utf8"),
    readFile(new URL("src/wheel-of-organs-audio.js", root), "utf8"),
  ]);
  assert.match(app, /compileWheelWord/);
  assert.match(app, /mapWheelPullGesture/);
  assert.match(app, /pinchGesture/);
  assert.match(app, /event\.shiftKey/);
  assert.match(app, /event\.pressure/);
  assert.match(app, /WheelOfOrgansAudio/);
  assert.match(audio, /glottalHarmonics/);
  assert.match(audio, /createPeriodicWave/);
  assert.match(audio, /createBiquadFilter/);
  assert.doesNotMatch(app + audio, /getUserMedia|MediaStream|FileReader/);
});
