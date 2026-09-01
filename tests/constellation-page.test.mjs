import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("Constellation exposes the three synchronized composition views", async () => {
  const html = await readFile(new URL("constellation.html", root), "utf8");
  for (const id of [
    "timelineView", "timelineCanvas",
    "flowView", "flowCanvas",
    "constellationView", "constellationCanvas",
    "instrumentBrowser", "inspector",
    "playButton", "audioButton", "presetSelect",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`), id);
  }
  assert.match(html, /data-primary-transport/);
  assert.match(html, /role="tablist"/);
  assert.match(html, /constellation-app\.js/);
});

test("Constellation app connects graph projection, editing, insertion, and sound", async () => {
  const app = await readFile(new URL("constellation-app.js", root), "utf8");
  assert.match(app, /projectTimeline/);
  assert.match(app, /moveTimelineClip/);
  assert.match(app, /addInstrumentClip/);
  assert.match(app, /performanceEventsForWindow/);
  assert.match(app, /ConstellationAudio/);
  assert.doesNotMatch(app, /getUserMedia|microphone/i);
});

test("Constellation workspace styles timeline clips, flow nodes, sections, and responsive layouts", async () => {
  const css = await readFile(new URL("constellation.css", root), "utf8");
  assert.match(css, /\.constellation-clip\s*\{/);
  assert.match(css, /\.constellation-flow-node\s*\{/);
  assert.match(css, /\.constellation-section-node\s*\{/);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(css, /prefers-reduced-motion/);
});
