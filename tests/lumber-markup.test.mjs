import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("Lumber keeps a traditional looper surface with optional advanced playback", async () => {
  const [html, app, css, packageJson] = await Promise.all([
    readFile(new URL("lumber.html", root), "utf8"),
    readFile(new URL("lumber-app.js", root), "utf8"),
    readFile(new URL("style.css", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
  ]);

  assert.match(html, /<body class="lumber-page"/);
  assert.match(html, /data-lumber-mode="expanded"/);
  assert.equal((html.match(/<canvas\b/g) ?? []).length, 1);
  for (const id of [
    "recordButton", "playButton", "replaceRing", "ringList",
    "clearAllRings", "circlePreset", "trianglePreset",
    "squarePreset", "removeVertex", "addVertex", "vertexCountOut",
    "rotateLeft", "rotateRight", "backingOff", "backingOn", "timeNative",
    "timeLocal", "timeStretch", "pitchShift", "advancedSummary", "viewFlat",
    "viewThreeD", "viewTilt", "viewYaw", "ringDepth", "spreadDepth",
  ]) assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  for (const section of [
    "loopSection", "ringSection", "shapeSection", "advancedSection", "depthSection",
  ]) {
    assert.match(html, new RegExp(`<details[^>]*id="${section}"`));
  }
  assert.doesNotMatch(html, /<details\b[^>]*\sopen(?:\s|>)/);
  assert.doesNotMatch(
    html,
    /id="(?:playbackSection|shapeMapping|ringTiming|ringLength)"/,
  );
  assert.match(html, /Record creates a new outer ring/);
  assert.match(html, /push or pull them radially/i);

  assert.match(app, /getUserMedia/);
  assert.match(app, /createScriptProcessor/);
  assert.match(app, /createOuterRing/);
  assert.match(app, /mode: replace \? "replace" : "new"/);
  assert.match(app, /source\.playbackRate\.setValueAtTime\(ringPlaybackRate\(ring\),/);
  assert.match(app, /moveVertex/);
  assert.match(app, /nearestProjectedContourPhase/);
  assert.match(app, /RING_COLORS/);
  assert.match(app, /playScrubGrain/);
  assert.match(app, /toggleRingSolo/);
  assert.match(app, /data-ring-action="solo"/);
  assert.match(app, /timeStretchLoopSamples/);
  assert.match(app, /ringCycleDuration/);
  assert.match(app, /expandedMode/);
  assert.match(app, /const rotation = -currentPhase\(ring\) \* TAU/);
  assert.match(app, /radialOffsets/);
  assert.match(app, /radialPointAt/);
  assert.match(app, /setThreeDView/);

  assert.match(css, /\.lumber-page\s+#loopSection\s*\{/);
  assert.match(css, /\.lumber-page\s+#ringSection\s*\{/);
  assert.match(css, /\.lumber-page\s+#shapeSection\s*\{/);
  assert.match(css, /\.lumber-page\s+#advancedSection\s*\{/);
  assert.match(css, /\.lumber-page\s+#depthSection\s*\{/);
  assert.match(css, /\.lumber-page #loopSection\s*\{\s*--accent:\s*#e8c46b;/);
  assert.match(css, /\.lumber-page #ringSection\s*\{\s*--accent:\s*#5fe8c4;/);
  assert.match(css, /\.lumber-page #shapeSection\s*\{\s*--accent:\s*#c79bff;/);
  assert.match(css, /\.lumber-page #advancedSection\s*\{\s*--accent:\s*#7db4ff;/);
  assert.match(css, /\.lumber-page #depthSection\s*\{\s*--accent:\s*#ffb86b;/);
  for (const section of ["loopSection", "ringSection", "shapeSection", "advancedSection", "depthSection"]) {
    assert.match(
      css,
      new RegExp(`\\.lumber-page #${section}\\s*\\{[\\s\\S]*?--accent-glow:`),
      `${section} needs its own matching heading background`,
    );
  }
  assert.doesNotMatch(css, /--section-(?:accent|wash)/);
  assert.match(JSON.parse(packageJson).scripts.check, /(?:lumber-app\.js|\*-app\.js)/);
});

test("Lumber markup has unique ids and complete labels", async () => {
  const html = await readFile(new URL("lumber.html", root), "utf8");
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  assert.match(html, /<label[^>]*for="level"/);
  assert.match(html, /<input id="level"[^>]*aria-label="Loop volume"/);
  assert.match(html, /id="stage"[\s\S]*aria-describedby="canvasInstructions liveStatus"/);
});
