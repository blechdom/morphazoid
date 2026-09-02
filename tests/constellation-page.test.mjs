import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

function visibleCopy(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[\s\S]*?<\/style>/giu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&amp;/gu, "&")
    .replace(/\s+/gu, " ")
    .trim();
}

test("Constellation describes one recursive typed patch through three synchronized views", async () => {
  const html = await readFile(new URL("constellation.html", root), "utf8");
  for (const id of [
    "constellationView", "constellationCanvas",
    "flowView", "flowCanvas",
    "timelineView", "timelineCanvas",
    "graphBreadcrumb", "sectionTitle",
    "instrumentBrowser", "inspector",
    "playButton", "audioButton", "presetSelect",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`), id);
  }

  assert.match(html, /data-primary-transport/);
  assert.match(html, /role="tablist"/);
  assert.match(html, /Graphs contain graphs\./i);
  assert.match(html, /Trigger flow creates time; audio and control shape sound\./i);
  assert.match(html, /Double-click any graph node to enter its signal-flow subgraph\./i);
  assert.match(html, /Upcoming trigger and control events predicted from the graph\./i);
  assert.match(html, /Devices &amp; Graphs/);
  assert.match(html, /GOLD → TRIGGER/);
  assert.match(html, /CYAN → AUDIO/);
  assert.match(html, /VIOLET → CONTROL/);
  assert.match(html, /constellation-app\.js/);

  const copy = visibleCopy(html);
  for (const stalePhrase of [
    /whole-work form/i,
    /connected musical sections/i,
    /selected section/i,
    /each star is a section/i,
    /composition preset/i,
    /forks launch layers/i,
    /joins wait/i,
  ]) {
    assert.doesNotMatch(copy, stalePhrase);
  }
});

test("Constellation app binds recursive graph navigation, typed topology, projection, editing, and audio", async () => {
  const app = await readFile(new URL("constellation-app.js", root), "utf8");
  for (const symbol of [
    "addConnection",
    "addDeviceNode",
    "graphBreadcrumbs",
    "moveGraphNode",
    "moveProjectedEvent",
    "portsForNode",
    "projectGraphEvents",
    "projectTimeline",
    "selectGraph",
    "performanceEventsForWindow",
    "ConstellationAudio",
  ]) {
    assert.match(app, new RegExp(`\\b${symbol}\\b`), symbol);
  }

  for (const semanticAttribute of [
    "data-graph-path",
    "data-device-node-id",
    "data-node-kind",
    "data-signal-type",
    "data-port-kind",
    "data-projected-event-id",
  ]) {
    assert.match(app, new RegExp(semanticAttribute), semanticAttribute);
  }

  assert.match(app, /renderDeviceGraph\(dom\.constellationCanvas,\s*\{\s*live:\s*false\s*\}\)/);
  assert.match(app, /renderDeviceGraph\(dom\.flowCanvas,\s*\{\s*live:\s*true\s*\}\)/);
  assert.match(app, /Layout is deliberately independent from musical time and audio topology\./);
  assert.doesNotMatch(app, /\b(?:addInstrumentClip|currentSection|moveSectionNode|moveTimelineClip|selectSection)\b/);
  assert.doesNotMatch(app, /getUserMedia|microphone/i);
});

test("Constellation styles recursive devices, all signal kinds, projected events, and responsive layouts", async () => {
  const css = await readFile(new URL("constellation.css", root), "utf8");
  for (const selector of [
    /\.graph-breadcrumb\s*\{/,
    /\.constellation-device-graph/,
    /\.constellation-flow-node/,
    /\.constellation-subgraph-inner/,
    /\.constellation-typed-edge/,
    /\.constellation-port/,
    /\.constellation-signal-legend/,
    /\.constellation-event/,
    /\.constellation-flow-ledger/,
  ]) {
    assert.match(css, selector);
  }
  for (const signal of ["trigger", "audio", "control"]) {
    assert.match(css, new RegExp(`\\.is-${signal}\\b`), signal);
  }
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(css, /prefers-reduced-motion/);
});

test("Constellation catalogue copy presents a recursive signal patcher rather than a song arranger", async () => {
  const catalog = await readFile(new URL("src/instrument-catalog.js", root), "utf8");
  const start = catalog.indexOf("  constellation: define(");
  const end = catalog.indexOf("\n  \"sliding-puzzle\":", start);
  assert.ok(start >= 0 && end > start, "Constellation catalogue entry");
  const entry = catalog.slice(start, end);
  assert.match(entry, /graph|subgraph/i);
  assert.match(entry, /trigger/i);
  assert.match(entry, /audio/i);
  assert.match(entry, /control/i);
  assert.doesNotMatch(entry, /larger musical forms|connected sections|edit its sections/i);
});
