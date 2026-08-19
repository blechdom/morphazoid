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
    assert.equal(
      (html.match(/<details\b[^>]*\sopen(?:\s|>)/g) ?? []).length,
      1,
      `${id} should open only its primary Play disclosure`,
    );
    assert.doesNotMatch(html, /class="[^"]*\bphysics-demo-nav\b/);
    assert.doesNotMatch(html, /class="[^"]*\bphysics-demo-link\b/);
    assert.doesNotMatch(html, /\bid="sceneKicker"|class="[^"]*\bphysics-kicker\b/);
    assert.doesNotMatch(html, /<select\b[^>]*\bid="scale"/);

    const panel = html.match(/<aside\b[^>]*\bclass="[^"]*\bpanel\b[^"]*"[^>]*>[\s\S]*?<\/aside>/)?.[0] ?? "";
    assert.ok(panel, `${id} must retain the standard Morphazoid control panel`);
    const firstSectionTag = panel.match(/<details\b[^>]*>/)?.[0] ?? "";
    assert.match(firstSectionTag, /\bdata-section="play"/, `${id} must put Play first in the panel`);
    assert.match(firstSectionTag, /\sopen(?:\s|>)/, `${id} Play section must be immediately visible`);

    const playSection = panel.match(
      /<details\b(?=[^>]*\bdata-section="play")[^>]*>[\s\S]*?<\/details>/,
    )?.[0] ?? "";
    assert.match(playSection, /<h2 class="group-title">Play<\/h2>/);
    for (const controlId of ["playButton", "resetScene", "primaryAction"]) {
      assert.match(
        playSection,
        new RegExp(`<button\\b(?=[^>]*\\bid="${controlId}")[^>]*>`),
        `${id} must keep ${controlId} inside Play`,
      );
      assert.equal(
        (html.match(new RegExp(`\\bid="${controlId}"`, "g")) ?? []).length,
        1,
        `${id} must expose exactly one ${controlId}`,
      );
    }
  }
});

test("physics shell exposes fixed-step simulation, direct manipulation, and continuous free pitch", async () => {
  const [app, css] = await Promise.all([
    readFile(new URL("physics-app.js", root), "utf8"),
    readFile(new URL("physics.css", root), "utf8"),
  ]);
  assert.match(app, /createFixedStepper/);
  assert.match(app, /new VoicePool\(24\)/);
  assert.match(app, /pointerdown/);
  assert.match(app, /visibilitychange/);
  assert.match(app, /audioState[^;\n]*(?:"on"|"off")/);
  assert.match(app, /scene\.pointerUp\?\.\(payload\)\s*===\s*true/);
  assert.match(app, /shouldStart\s*&&\s*!globalState\.playing\)\s*setPlaying\(true\)/);
  assert.match(
    app,
    /frequency:\s*pitch01ToFrequency\(\s*clamp\(Number\(voice\.pitch01\)\)[\s\S]{0,120}globalState\.baseFrequency[\s\S]{0,80}globalState\.pitchRange[\s\S]{0,20}\)/,
  );
  assert.doesNotMatch(
    app,
    /SCALE_STEPS|quantizedFrequency|globalState\.scale|\$\(\s*["']scale["']\s*\)/,
  );
  assert.match(css, /@media \(max-width: 650px\)/);
});

test("Ricochet keeps its stage title concise without a visible subtitle", async () => {
  const html = await readFile(new URL("ricochet.html", root), "utf8");
  const titleCard = html.match(
    /<header\b[^>]*\bclass="[^"]*\bphysics-title-card\b[^"]*"[^>]*>[\s\S]*?<\/header>/,
  )?.[0] ?? "";

  assert.match(titleCard, /<h1\b[^>]*\bid="sceneTitle"[^>]*>Ricochet<\/h1>/);
  assert.doesNotMatch(titleCard, /<p\b|\bphysics-description\b|\bid="sceneDescription"/);
});
