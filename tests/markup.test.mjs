import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("the mobile instrument markup exposes the complete compact control surface", async () => {
  const [html, css, app, packageJson] = await Promise.all([
    readFile(new URL("index.html", root), "utf8"),
    readFile(new URL("style.css", root), "utf8"),
    readFile(new URL("app.js", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
  ]);

  assert.match(html, /<script\s+type="module"\s+src="app\.js"><\/script>/);
  assert.match(html, /<canvas[\s\S]+?id="stage"/);
  assert.doesNotMatch(html, /Shape Player/i);

  const openingTag = (id) => {
    const match = html.match(new RegExp(`<[^>]+\\bid="${id}"[^>]*>`));
    assert.ok(match, `missing opening tag for #${id}`);
    return match[0];
  };

  const sectionIds = ["playSection", "formSection", "soundSection", "mappingSection", "outputSection"];
  const sectionPositions = sectionIds.map((id) => html.indexOf(`id="${id}"`));
  assert.ok(sectionPositions.every((position) => position >= 0));
  assert.deepEqual(sectionPositions, [...sectionPositions].sort((a, b) => a - b));
  for (const id of sectionIds) {
    assert.match(openingTag(id), /^<details\b/);
    assert.doesNotMatch(openingTag(id), /\sopen(?:\s|>)/, `${id} should start collapsed`);
  }
  for (const title of ["Play", "Form", "Sound", "Mapping", "Output"]) {
    assert.match(html, new RegExp(`<h2[^>]*>${title}<\\/h2>`));
  }
  assert.doesNotMatch(html, />\s*Advanced\s*</i);
  assert.equal((html.match(/class="group-summary"/g) ?? []).length, sectionIds.length);

  const assertDefaultLeftChoice = (groupId, selectedId, selectedLabel, otherId) => {
    const groupStart = html.indexOf(`id="${groupId}"`);
    const selectedStart = html.indexOf(`id="${selectedId}"`, groupStart);
    const otherStart = html.indexOf(`id="${otherId}"`, groupStart);
    assert.ok(groupStart >= 0 && selectedStart > groupStart && otherStart > selectedStart);
    assert.match(openingTag(selectedId), /aria-pressed="true"/);
    assert.match(openingTag(otherId), /aria-pressed="false"/);
    assert.match(html.slice(selectedStart, otherStart), new RegExp(`>${selectedLabel}<\\/button>`));
  };

  // Immediate binary choices are left-defaulting rocker controls, not faux tabs.
  assertDefaultLeftChoice("playMethod", "traceMode", "Points", "scanMode");
  assertDefaultLeftChoice("scanMotion", "loopScan", "Loop", "pingPongScan");
  assertDefaultLeftChoice("curvatureDirection", "curvatureOutward", "Out", "curvatureIn");
  assertDefaultLeftChoice("shapeType", "polygonShape", "Polygon", "starShape");
  assert.equal((html.match(/class="choice-switch/g) ?? []).length, 5);

  // Points start at the contour midpoint; conditional line controls remain hidden.
  assert.match(openingTag("position"), /value="0\.5"/);
  assert.doesNotMatch(openingTag("headsControl"), /\bhidden\b/);
  assert.match(openingTag("lineCountControl"), /\bhidden\b/);
  assert.match(openingTag("lineLayoutControl"), /\bhidden\b/);
  assert.match(openingTag("scanMotionControl"), /\bhidden\b/);

  // Each transport owns one compact direction toggle, shown only while it runs.
  assert.match(openingTag("traversalDirection"), /\bhidden\b/);
  assert.match(openingTag("rotationDirection"), /\bhidden\b/);
  assert.doesNotMatch(html, /id="(?:traversal|rotation)(?:Forward|Reverse)"/);
  assert.match(app, /const SPEED_MAX = 4;/);
  assert.match(openingTag("rotationSpeed"), /max="4"/);

  // The playhead phase editor is compact, draggable, keyboard-operable, and resettable.
  assert.ok(html.includes('id="headLayoutTrack"'));
  assert.ok(html.includes('id="resetHeadSpacing"'));
  for (const id of ["playheadStepper", "removePlayhead", "playheadCountOut", "addPlayhead"]) {
    assert.ok(html.includes(`id="${id}"`), `missing compact playhead control #${id}`);
  }
  assert.match(openingTag("addPlayhead"), /aria-label="Add one playhead"/);
  const markers = [...html.matchAll(/id="headMarker(\d+)"/g)].map((match) => Number(match[1]));
  assert.deepEqual(markers, Array.from({ length: 12 }, (_, index) => index));
  assert.match(openingTag("headMarker0"), /aria-valuenow="0\.5"/);
  assert.doesNotMatch(openingTag("headMarker0"), /\bhidden\b/);
  assert.match(openingTag("headMarker1"), /\bhidden\b/);

  // Form supports polygon/star topology and bounded asymmetrical transforms.
  assert.match(openingTag("starDepthControl"), /\bhidden\b/);
  assert.match(openingTag("starDepth"), /min="0\.05"[^>]*max="0\.82"/);
  assert.match(openingTag("curvature"), /min="0"[^>]*max="1"/);
  assert.match(openingTag("aspect"), /min="-1"[^>]*max="1"/);
  assert.match(openingTag("skew"), /min="-0\.8"[^>]*max="0\.8"/);
  assert.match(openingTag("asymmetry"), /min="0"[^>]*max="1"/);

  const soundSelect = html.match(/<select\s+id="soundMode"[^>]*>([\s\S]*?)<\/select>/);
  assert.ok(soundSelect, "missing sound mode select");
  assert.match(soundSelect[1], /<option\s+value="sine">Sine\b/);
  assert.match(soundSelect[1], /<option\s+value="percussion">Percussion\b/);
  assert.match(soundSelect[1], /<option\s+value="shepard">Shepard\b/);
  assert.match(soundSelect[1], /<option\s+value="fm"\s+selected>FM\b/);
  assert.match(soundSelect[1], /<option\s+value="pm">PM\b/);
  assert.match(openingTag("sineArticulation"), /\bhidden\b/);
  assert.match(openingTag("percussionArticulation"), /\bhidden\b/);
  assert.match(openingTag("shepardArticulation"), /\bhidden\b/);
  assert.doesNotMatch(openingTag("fmArticulation"), /\bhidden\b/);
  assert.match(openingTag("pmArticulation"), /\bhidden\b/);
  assert.match(openingTag("cornerDecay"), /min="15"[^>]*max="2000"[^>]*value="90"/);

  // Mapping names the coordinate frame and transfer curves explicitly.
  for (const id of [
    "mappingFrame", "pitchSource", "pitchCurve", "hitLevelSource", "hitLevelCurve",
    "synthSource", "shepardCycles", "shepardDirection", "shepardWidth",
    "fmIndex", "fmRatio", "pmIndex", "pmRatio",
  ]) assert.ok(html.includes(`id="${id}"`));
  assert.match(html, /Stage axes[^<]*fixed/);
  assert.match(html, /Shape axes[^<]*rotate with form/);
  assert.match(html, /value="exponential">Expand high values/);
  assert.match(html, /value="logarithmic">Expand low values/);

  // Output is a realtime marks dashboard with clearly future-facing external routes.
  for (const id of [
    "markPhaseOut", "markPositionOut", "markTurnOut", "markDistanceOut",
    "markIncidenceOut", "markTangentOut", "markPitchValueOut", "markFrequencyOut",
    "markGainOut", "markPanOut", "markSynthDriveOut", "markSynthValueOut",
    "markDecayOut", "markRotationOut", "contactStream",
  ]) assert.ok(html.includes(`id="${id}"`), `missing output #${id}`);
  assert.match(html, /Web MIDI · planned/);
  assert.match(html, /OSC · planned/);
  assert.match(html, /JSON stream · planned/);

  // On narrow screens the stage stays put while the parameter panel owns scrolling.
  assert.match(css, /@media\s*\(max-width:\s*960px\)[\s\S]*?\.stage\s*\{[\s\S]*?position:\s*sticky;/);
  assert.match(css, /@media\s*\(max-width:\s*960px\)[\s\S]*?\.panel\s*\{[\s\S]*?overflow-y:\s*auto;/);
  assert.match(css, /@media\s*\(max-width:\s*960px\)\s*and\s*\(max-height:\s*560px\)/);
  assert.match(css, /\.head-layout-track\.is-crossed[\s\S]*?height:\s*64px/);

  assert.ok(html.indexOf('id="audioButton"') < html.indexOf('id="playSection"'));
  assert.ok(html.indexOf('id="level"') < html.indexOf("<main"));
  assert.doesNotMatch(html, /id="restartButton"|id="displayTitle"|id="guidesToggle"|id="verticesToggle"|id="trailsToggle"/);

  const htmlIds = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(htmlIds).size, htmlIds.length, "HTML ids must be unique");

  const referencedIds = new Set(
    [...app.matchAll(/\$\("([^"]+)"\)/g)].map((match) => match[1]),
  );
  for (const match of app.matchAll(/bindRange\("([^"]+)"/g)) {
    referencedIds.add(match[1]);
    referencedIds.add(`${match[1]}Out`);
  }
  const idSet = new Set(htmlIds);
  const missing = [...referencedIds].filter((id) => !idSet.has(id));
  assert.deepEqual(missing, [], `app.js references missing ids: ${missing.join(", ")}`);

  const manifest = JSON.parse(packageJson);
  assert.equal(manifest.name, "morphazoid");
  assert.equal(manifest.type, "module");
  assert.equal(manifest.dependencies, undefined);
  assert.equal(manifest.devDependencies, undefined);
  assert.doesNotMatch(packageJson, /next|react|typescript/i);
});
