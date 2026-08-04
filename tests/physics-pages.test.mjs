import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const pages = Object.freeze([
  ["gravity-walk", "Gravity Walk"],
  ["ricochet", "Ricochet"],
  ["rigidity", "Rigidity"],
  ["rolling-measure", "Rolling Measure"],
  ["falling-forms", "Falling Forms"],
  ["charge-garden", "Charge Garden"],
  ["packing-pressure", "Packing Pressure"],
  ["geodesic-drift", "Geodesic Drift"],
  ["kinetic-hull", "Kinetic Hull"],
]);

test("every geometric-physics demo is a first-class Morphazoid page", async () => {
  const documents = await Promise.all(pages.map(([id]) => readFile(new URL(`${id}.html`, root), "utf8")));
  for (let index = 0; index < pages.length; index += 1) {
    const [id, title] = pages[index];
    const html = documents[index];
    assert.match(html, new RegExp(`<title>${title} — Morphazoid<\\/title>`));
    assert.match(html, new RegExp(`class="physics-page" data-physics-scene="${id}"`));
    assert.match(html, /href="style\.css"/);
    assert.match(html, /href="physics\.css"/);
    assert.match(html, /<script type="module" src="nav\.js"><\/script>/);
    assert.match(html, /<script type="module" src="physics-app\.js"><\/script>/);
    assert.match(html, /<canvas id="stage"[^>]*tabindex="0"[^>]*aria-describedby="sceneInstruction sceneLesson"/);
    assert.match(html, /id="audioState">off<\/small>/);
    assert.match(html, /data-reset-all data-reset-in-place/);
    assert.doesNotMatch(html, /<details\b[^>]*\sopen(?:\s|>)/);
    assert.equal((html.match(/class="physics-demo-link"/g) ?? []).length, pages.length);
    const demoNavigation = html.match(/<nav class="physics-demo-nav"[\s\S]*?<\/nav>/)?.[0] ?? "";
    assert.match(
      demoNavigation,
      new RegExp(`href="${id}\\.html" aria-current="page"`),
      `${id} must identify itself in the physics collection`,
    );
  }
});

test("physics shell exposes fixed-step simulation, direct manipulation, and shared audio", async () => {
  const [app, css] = await Promise.all([
    readFile(new URL("physics-app.js", root), "utf8"),
    readFile(new URL("physics.css", root), "utf8"),
  ]);
  assert.match(app, /createFixedStepper/);
  assert.match(app, /new VoicePool\(24\)/);
  assert.match(app, /pointerdown/);
  assert.match(app, /visibilitychange/);
  assert.match(app, /audioState[^;\n]*(?:"on"|"off")/);
  assert.match(css, /\.physics-demo-nav/);
  assert.match(css, /@media \(max-width: 650px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});
