import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DEVICE_LIBRARY,
  PRIMITIVE_LIBRARY,
  SIGNAL_TYPES,
  devicePresets,
} from "../src/constellation-composer.js";

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

test("Morphazoid Composer describes one recursive typed patch through three synchronized views", async () => {
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
  assert.match(html, /<title>Morphazoid Composer<\/title>/);
  assert.match(html, /<h1>Morphazoid Composer<\/h1>/);
  assert.match(html, /RECURSIVE SIGNAL GRAPH WORKSTATION/);
  assert.match(html, /Clock, MIDI, control, and audio flow/i);
  assert.match(html, /graphs inside graphs/i);
  assert.match(html, /Double-click any graph node to enter its signal-flow subgraph\./i);
  assert.match(html, /Predictable trigger, control, and MIDI events unfolded from the graph\./i);
  assert.match(html, /Devices &amp; Graphs/);
  assert.match(html, /GOLD → TRIGGER/);
  assert.match(html, /CYAN → AUDIO/);
  assert.match(html, /VIOLET → CONTROL/);
  assert.match(html, /GREEN → MIDI/);
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

test("Composer exposes shared MIDI, spatial output, and stereo or stem recording controls", async () => {
  const html = await readFile(new URL("constellation.html", root), "utf8");
  for (const id of [
    "midiButton", "midiState",
    "outputRouteButton", "spatialState",
    "recordMode", "recordButton", "recordState", "recordingDownloads",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`), id);
  }

  assert.match(html, /Composer synchronization, output, and recording/);
  assert.match(html, /One transport · many clocks/);
  assert.match(html, /MIDI I\/O/);
  assert.match(html, /SPATIAL OUTPUT/);
  assert.match(html, /stereo, surround, or virtual preview/i);
  assert.match(html, /<option value="mix">Stereo mix<\/option>/);
  assert.match(html, /<option value="stems">Individual stems<\/option>/);
  assert.match(html, /class="composer-record-button"[^>]*aria-pressed="false"/);
});

test("Composer model exposes MIDI and preset-selectable instrument, spatial, observer, and converter modules", () => {
  assert.deepEqual([...SIGNAL_TYPES], ["trigger", "audio", "control", "midi"]);

  const devices = new Map(DEVICE_LIBRARY.map((device) => [device.id, device]));
  for (const id of [
    "midi-input", "midi-clock", "midi-router", "midi-output",
    "hiccup-head", "webgpu-303",
    "surround-output", "stereo-recorder", "stem-recorder",
    "scope", "level-meter", "spectrum", "frequency-tracker", "control-display",
    "frequency-to-midi", "midi-to-frequency", "midi-to-control",
    "amplitude-to-midi", "audio-to-fft-bands",
  ]) {
    assert.ok(devices.has(id), `device ${id}`);
  }

  assert.equal(devices.get("hiccup-head").href, "hiccup-head.html");
  assert.equal(devices.get("webgpu-303").href, "webgpu-303.html");
  assert.equal(devicePresets("hiccup-head").length, 16);
  assert.equal(devicePresets("webgpu-303").length, 12);
  assert.ok(devicePresets("hiccup-head").some(({ id }) => id === "rubber-face"));
  assert.ok(devicePresets("webgpu-303").some(({ id }) => id === "source-acid-synth"));
  assert.ok(devicePresets("surround-output").some(({ id }) => id === "7-4-1"));
  assert.ok(devicePresets("stereo-recorder").some(({ id }) => id === "stereo-mix"));
  assert.ok(devicePresets("stem-recorder").some(({ id }) => id === "stereo-stem"));

  assert.equal(PRIMITIVE_LIBRARY.scope.runtime.kind, "monitor");
  assert.equal(PRIMITIVE_LIBRARY["level-meter"].runtime.passThrough, true);
  assert.equal(PRIMITIVE_LIBRARY["frequency-to-midi"].runtime.kind, "converter");
  assert.equal(PRIMITIVE_LIBRARY["audio-to-fft-bands"].runtime.analysis, "fft-bands");
  assert.ok(PRIMITIVE_LIBRARY["midi-output"].ports.some(({ signal }) => signal === "midi"));
});

test("Composer app binds recursive navigation, presets, MIDI, recording, spatial output, and live observers", async () => {
  const app = await readFile(new URL("constellation-app.js", root), "utf8");
  for (const symbol of [
    "addConnection",
    "addDeviceNode",
    "applyDevicePreset",
    "devicePresets",
    "graphBreadcrumbs",
    "moveGraphNode",
    "moveProjectedEvent",
    "portsForNode",
    "projectGraphEvents",
    "projectTimeline",
    "selectGraph",
    "performanceEventsForWindow",
    "ConstellationAudio",
    "getSharedMidiManager",
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
    "data-monitor-node-id",
    "data-monitor-analysis",
  ]) {
    assert.match(app, new RegExp(semanticAttribute), semanticAttribute);
  }

  assert.match(app, /renderDeviceGraph\(dom\.constellationCanvas,\s*\{\s*live:\s*false\s*\}\)/);
  assert.match(app, /renderDeviceGraph\(dom\.flowCanvas,\s*\{\s*live:\s*true\s*\}\)/);
  assert.match(app, /Layout is deliberately independent from musical time and audio topology\./);
  assert.match(app, /devicePresets\(node\.deviceId\)/);
  assert.match(app, /applyDevicePreset\(state\.patch, graph\.id, node\.id, input\.value\)/);
  assert.match(app, /function appendNodeTelemetry\(/);
  assert.match(app, /function updateMonitorVisuals\(/);
  assert.match(app, /\["monitor", "converter"\]\.includes/);
  assert.match(app, /audio\.getMonitorSnapshot\?\.\(\)/);
  assert.match(app, /audio\.drainRuntimeEvents\?\.\(/);
  assert.match(app, /function routeLiveEvent\(/);
  assert.match(app, /conversion === "midi-to-frequency"/);
  assert.match(app, /conversion === "midi-to-control"/);
  assert.match(app, /conversion === "frequency-to-midi"/);
  assert.match(app, /audio\.outputCapabilities\?\.\(\)/);
  assert.match(app, /midi\.registerClient\(\{/);
  assert.match(app, /Only explicit MIDI Output nodes send to hardware\./);
  assert.match(app, /audio\.startRecording\?\.\(\{ mode \}\)/);
  assert.match(app, /audio\.stopRecording\?\.\(\)/);
  assert.match(app, /audio\.cancelRecording\?\.\(\)/);
  assert.match(app, /function renderRecordingTakes\(/);
  assert.doesNotMatch(app, /\b(?:addInstrumentClip|currentSection|moveSectionNode|moveTimelineClip|selectSection)\b/);
  assert.doesNotMatch(app, /getUserMedia|microphone/i);
});

test("Composer styles recursive devices, all four signal kinds, live observers, I/O, and responsive layouts", async () => {
  const css = await readFile(new URL("constellation.css", root), "utf8");
  for (const selector of [
    /\.composer-io-bar/,
    /\.composer-midi-button/,
    /\.composer-output-summary/,
    /\.composer-record-button/,
    /\.graph-breadcrumb\s*\{/,
    /\.constellation-device-graph/,
    /\.constellation-flow-node/,
    /\.constellation-subgraph-inner/,
    /\.constellation-typed-edge/,
    /\.constellation-port/,
    /\.constellation-signal-legend/,
    /\.constellation-event/,
    /\.constellation-flow-ledger/,
    /\.constellation-monitor-readout/,
    /\.constellation-monitor-wave/,
    /\.constellation-monitor-spectrum/,
    /\.constellation-monitor-meter/,
    /\.constellation-data-value/,
  ]) {
    assert.match(css, selector);
  }
  for (const signal of ["trigger", "audio", "control", "midi"]) {
    assert.match(css, new RegExp(`\\.is-${signal}\\b`), signal);
  }
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(css, /prefers-reduced-motion/);
});

test("Composer catalogue copy presents preset modules, observation, surround, and recording rather than a song arranger", async () => {
  const catalog = await readFile(new URL("src/instrument-catalog.js", root), "utf8");
  const start = catalog.indexOf("  constellation: define(");
  const end = catalog.indexOf("\n  \"sliding-puzzle\":", start);
  assert.ok(start >= 0 && end > start, "Constellation catalogue entry");
  const entry = catalog.slice(start, end);
  for (const phrase of [
    /Morphazoid Composer/i,
    /clock, MIDI, control, and audio graphs/i,
    /preset instruments/i,
    /effects/i,
    /converters/i,
    /observers/i,
    /surround outputs/i,
    /recorders/i,
    /nested graph/i,
    /device preset/i,
    /stereo mix/i,
    /individual stems/i,
  ]) {
    assert.match(entry, phrase);
  }
  assert.doesNotMatch(entry, /larger musical forms|connected sections|edit its sections/i);
});
