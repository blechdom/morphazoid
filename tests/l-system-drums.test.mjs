import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { DEFAULT_FM_DRUM_VOICES } from "../src/fm-drums.js";
import {
  L_SYSTEM_PRESETS,
  branchingPlayheadsAtPhase,
  traceLSystem,
} from "../src/l-system.js";
import {
  L_SYSTEM_DRUM_MAPPING_MODES,
  lSystemDrumEventForHead,
  lSystemDrumEventsForPlayheads,
  lSystemDrumSubdivisionCount,
  lSystemDrumVoiceIndex,
  mappedLSystemDrumVoice,
} from "../src/l-system-drums.js";

const root = new URL("../", import.meta.url);

function eventAtPhase(phase = 0.5) {
  const trace = traceLSystem({
    ...L_SYSTEM_PRESETS.find((preset) => preset.id === "pythagorean"),
    iterations: 3,
  });
  const head = branchingPlayheadsAtPhase(trace, phase)[0];
  return lSystemDrumEventForHead({
    ...head,
    iteration: 3,
    sourceTrace: trace,
  }, { subdivisions: 4 });
}

test("L-system drum events quantize branch-head traversal into stable subdivisions", () => {
  assert.equal(lSystemDrumSubdivisionCount(-4), 1);
  assert.equal(lSystemDrumSubdivisionCount(99), 16);
  const event = eventAtPhase(0.42);

  assert.equal(event.iteration, 3);
  assert.equal(event.subdivisions, 4);
  assert.match(event.key, /^l-system:3:\d+:[0-3]$/);
  assert.ok(event.normalizedX >= 0 && event.normalizedX <= 1);
  assert.ok(event.normalizedY >= 0 && event.normalizedY <= 1);

  const same = lSystemDrumEventForHead({
    iteration: 3,
    index: event.segmentIndex,
    progress: event.subdivisionIndex / event.subdivisions + 0.01,
    sourceTrace: { bounds: { minX: 0, maxX: 1, minY: 0, maxY: 1 }, maxForkDepth: 1 },
  }, { subdivisions: event.subdivisions });
  assert.equal(same.key, event.key);
});

test("L-system drum mappings cover depth, position, generation, and playable FM voices", () => {
  const events = lSystemDrumEventsForPlayheads(
    [
      {
        x: -1,
        y: 1,
        iteration: 2,
        index: 4,
        progress: 0.7,
        depth: 2,
        generation: 3,
        turn: Math.PI / 2,
        cumulativeTurn: Math.PI,
        sourceTrace: {
          maxForkDepth: 4,
          bounds: { minX: -2, maxX: 2, minY: -1, maxY: 1 },
        },
      },
    ],
    { subdivisions: 8 },
  );
  assert.equal(events.length, 1);
  for (const mode of L_SYSTEM_DRUM_MAPPING_MODES) {
    const index = lSystemDrumVoiceIndex(events[0], { mode: mode.id });
    assert.ok(index >= 0 && index < DEFAULT_FM_DRUM_VOICES.length);
    const voice = mappedLSystemDrumVoice(DEFAULT_FM_DRUM_VOICES[index], events[0], {
      pitchDepth: 12,
      characterDepth: 1,
      eventCount: events.length,
    });
    assert.ok(voice.frequency >= 20 && voice.frequency <= 12_000);
    assert.ok(voice.level >= 0 && voice.level <= 1);
  }
});

test("bell voices become shorter and quieter L-system percussion", () => {
  const bell = DEFAULT_FM_DRUM_VOICES.find(({ id }) => id === "soft-chime");
  const event = eventAtPhase(0.8);
  const voice = mappedLSystemDrumVoice(bell, event, {
    pitchDepth: 0,
    characterDepth: 0,
    eventCount: 1,
  });
  assert.equal(voice.attack, 0.006);
  assert.equal(voice.decay, 0.58);
  assert.ok(voice.modIndex < bell.modIndex);
  assert.ok(voice.level < bell.level);
  assert.equal(bell.decay, 1.8);
});

test("L-System Drum Machine copies the L-system controls into a compact drum page", async () => {
  const [html, css, app] = await Promise.all([
    readFile(new URL("l-system-drums.html", root), "utf8"),
    readFile(new URL("l-system-drums.css", root), "utf8"),
    readFile(new URL("l-system-drums-app.js", root), "utf8"),
  ]);

  assert.match(html, /L-System Drum Machine/);
  assert.match(html, /id="stage"[\s\S]*aria-describedby="canvasInstructions liveStatus"/);
  assert.match(html, /id="structureMode"[\s\S]*<option value="canon">Canon<\/option>/);
  for (const id of [
    "playButton",
    "position",
    "speed",
    "subdivisions",
    "traversalLoop",
    "traversalPingPong",
    "preset",
    "iterations",
    "angle",
    "turnAsymmetry",
    "lengthScale",
    "mappingMode",
    "pitchDepth",
    "characterDepth",
    "drumMap",
    "mappingReadout",
    "currentDrumReadout",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), `missing ${id}`);
  }
  assert.match(html, /id="mappingMode"[\s\S]*Depth × turn/);
  assert.match(html, /id="subdivisions"[\s\S]*min="1"[\s\S]*max="16"[\s\S]*value="4"/);
  assert.match(html, /class="l-system-mapping-readout"[^>]*aria-label="Latest drum mapping"[^>]*aria-live="off"/);
  assert.match(html, /href="l-system-drums\.html" aria-current="page"/);
  assert.match(html, /src="l-system-drums-app\.js"/);
  assert.doesNotMatch(html, /<h1\b|soundMode|polyphonyReadout|synth-panel/);
  assert.doesNotMatch(html, /<details\b[^>]*\sopen(?:\s|>)/);
  assert.match(css, /\.l-system-drum-map[\s\S]*grid-template-columns: repeat\(4/);
  assert.match(app, /FM_DRUM_STORAGE_KEY/);
  assert.match(app, /new FmDrumAudio\(globalThis\)/);
  assert.match(app, /traceLSystem/);
  assert.match(app, /iterationPlaybackAtPhase/);
  assert.match(app, /lSystemDrumEventsForPlayheads/);
  assert.match(app, /mappedLSystemDrumVoice/);
});
