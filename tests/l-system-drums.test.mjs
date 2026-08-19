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
  L_SYSTEM_DRUM_STYLES,
  advanceLSystemDrumTraversal,
  groupedLSystemDrumEvents,
  lSystemDrumEventForHead,
  lSystemDrumEventsForPlayheads,
  lSystemDrumEventsForTraversal,
  lSystemDrumSubdivisionCount,
  lSystemDrumTraversalStepSize,
  lSystemDrumVoiceIndex,
  mappedLSystemDrumVoice,
  styledLSystemDrumVoice,
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

test("simultaneous branches share one audible hit per mapped drum", () => {
  const shared = {
    generation: 2,
    subdivisionIndex: 1,
    subdivisions: 4,
    transportSampleIndex: 7,
  };
  const grouped = groupedLSystemDrumEvents([
    { ...shared, key: "quiet", turn: 0.1 },
    { ...shared, key: "angle", turn: 1.2 },
    { ...shared, key: "reflection", turn: 0.2, transportSampleIndex: 8 },
  ], { mode: "generation-phase" });

  assert.equal(grouped.length, 2);
  assert.equal(grouped[0].event.key, "angle");
  assert.equal(grouped[0].eventCount, 1);
  assert.equal(grouped[1].event.key, "reflection");
});

test("dense sequential grammars stay inside an audible per-frame budget", () => {
  const events = Array.from({ length: 20 }, (_, index) => ({
    generation: index % 4,
    subdivisionIndex: index % 4,
    subdivisions: 4,
    transportSampleIndex: index,
    turn: index / 20,
    transportBoundary: index === 19 ? "wrap" : null,
  }));
  const grouped = groupedLSystemDrumEvents(events, {
    mode: "generation-phase",
    maxEvents: 4,
  });

  assert.equal(grouped.length, 4);
  assert.equal(grouped.at(-1).event.transportBoundary, "wrap");
  assert.ok(grouped.every(({ event }, index) => (
    index === 0 || event.transportSampleIndex > grouped[index - 1].event.transportSampleIndex
  )));
});

test("every bundled grammar produces bounded L-system drum events", () => {
  for (const preset of L_SYSTEM_PRESETS) {
    const trace = {
      ...traceLSystem(preset),
      iteration: preset.iterations,
    };
    const traces = [trace];
    const traversal = advanceLSystemDrumTraversal(0, 1, 0.02, {
      behavior: "loop",
      maxPhaseStep: lSystemDrumTraversalStepSize(traces, 4, "final"),
    });
    const swept = lSystemDrumEventsForTraversal(traces, traversal.samples, {
      subdivisions: 4,
    });
    const grouped = groupedLSystemDrumEvents(swept.events, { maxEvents: 4 });

    assert.ok(grouped.length > 0, `${preset.name} should produce a drum hit`);
    assert.ok(grouped.length <= 4, `${preset.name} should honor the hit budget`);
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

test("signed turn angles add scalable pitch and character", () => {
  const base = DEFAULT_FM_DRUM_VOICES.find(({ id }) => id === "low-tom");
  const event = {
    normalizedY: 0.5,
    turn: Math.PI / 4,
    depth: 0,
    maxForkDepth: 1,
  };
  const positive = mappedLSystemDrumVoice(base, event, {
    pitchDepth: 0,
    anglePitchDepth: 12,
    angleRange: 45,
    characterDepth: 1,
  });
  const negative = mappedLSystemDrumVoice(base, { ...event, turn: -Math.PI / 4 }, {
    pitchDepth: 0,
    anglePitchDepth: 12,
    angleRange: 45,
    characterDepth: 1,
  });
  const wide = mappedLSystemDrumVoice(base, event, {
    pitchDepth: 0,
    anglePitchDepth: 12,
    angleRange: 180,
    characterDepth: 1,
  });

  assert.ok(Math.abs(positive.frequency - base.frequency * 2) < 1e-8);
  assert.ok(Math.abs(negative.frequency - base.frequency / 2) < 1e-8);
  assert.ok(Math.abs(wide.frequency - base.frequency * (2 ** 0.25)) < 1e-8);
  assert.ok(positive.modIndex > wide.modIndex);
});

test("percussion palettes preserve angle pitch while changing synthesis character", () => {
  const base = DEFAULT_FM_DRUM_VOICES.find(({ id }) => id === "low-tom");
  const angled = mappedLSystemDrumVoice(base, {
    normalizedY: 0.5,
    turn: Math.PI / 3,
    depth: 1,
    maxForkDepth: 3,
  }, {
    pitchDepth: 0,
    anglePitchDepth: 18,
    angleRange: 60,
    characterDepth: 0.8,
  });

  assert.deepEqual(
    L_SYSTEM_DRUM_STYLES.map(({ id }) => id),
    ["drum-bank", "circuit", "rattlesnake", "resonant-metal"],
  );
  for (const style of L_SYSTEM_DRUM_STYLES) {
    const voice = styledLSystemDrumVoice(angled, { style: style.id });
    assert.equal(voice.frequency, angled.frequency, `${style.label} should preserve angle pitch`);
    assert.ok(voice.attack >= 0.001 && voice.attack <= 0.25);
    assert.ok(voice.decay >= 0.035 && voice.decay <= 3);
    assert.ok(voice.noise >= 0 && voice.noise <= 1);
    assert.ok(voice.level >= 0 && voice.level <= 1);
  }
  const rattle = styledLSystemDrumVoice(angled, { style: "rattlesnake" });
  assert.equal(rattle.family, "rattle");
  assert.match(rattle.name, /^Rattle /);
  assert.ok(rattle.noise > angled.noise);
  assert.equal(base.family, "tom", "palette transforms must not mutate the drum bank");
});

function linearDrumTrace() {
  return {
    ...traceLSystem({ axiom: "F+F+F", angle: 90 }),
    iteration: 1,
  };
}

function sweepTrace(trace, {
  position,
  direction,
  distance,
  behavior = "loop",
  activeEventKeys = new Set(),
} = {}) {
  const traces = [trace];
  const traversal = advanceLSystemDrumTraversal(position, direction, distance, {
    behavior,
    maxPhaseStep: lSystemDrumTraversalStepSize(traces, 4, "final"),
  });
  const result = lSystemDrumEventsForTraversal(traces, traversal.samples, {
    subdivisions: 4,
    activeEventKeys,
  });
  return { traversal, ...result };
}

test("swept L-system drums do not skip turns or subdivisions during long frames", () => {
  const trace = linearDrumTrace();
  const forward = sweepTrace(trace, {
    position: 0,
    direction: 1,
    distance: 0.99,
  });
  const reverse = sweepTrace(trace, {
    position: 0.99,
    direction: -1,
    distance: 0.98,
  });

  assert.equal(new Set(forward.events.map(({ key }) => key)).size, 12);
  assert.equal(new Set(reverse.events.map(({ key }) => key)).size, 12);
  assert.deepEqual(new Set(forward.events.map(({ segmentIndex }) => segmentIndex)), new Set([0, 1, 2]));
  assert.deepEqual(new Set(reverse.events.map(({ segmentIndex }) => segmentIndex)), new Set([0, 1, 2]));
  assert.ok(forward.events.every(({ direction }) => direction === 1));
  assert.ok(reverse.events.every(({ direction }) => direction === -1));
});

test("L-system drum catch-up work stays bounded after a stalled frame", () => {
  const traversal = advanceLSystemDrumTraversal(0, 1, 4, {
    behavior: "loop",
    maxPhaseStep: 1e-9,
  });

  assert.ok(traversal.samples.length <= 64);
  assert.equal(traversal.position, 0);
  assert.equal(traversal.direction, 1);
});

test("ping-pong L-system drums strike the endpoint once and continue in reverse", () => {
  const trace = linearDrumTrace();
  const { traversal, events } = sweepTrace(trace, {
    position: 0.85,
    direction: 1,
    distance: 0.4,
    behavior: "ping-pong",
  });
  const terminalKey = "l-system:1:2:3";

  assert.equal(traversal.direction, -1);
  assert.ok(traversal.samples.some(({ boundary }) => boundary === "reflection"));
  assert.ok(events.every(({ transportSampleIndex }) => Number.isInteger(transportSampleIndex)));
  const terminalEvents = events.filter(({ key }) => key === terminalKey);
  assert.equal(terminalEvents.length, 1, "the reflected endpoint must not double-trigger");
  assert.equal(terminalEvents[0].direction, 1);
  assert.ok(events.some(({ direction }) => direction === -1));
});

test("looping L-system drums re-arm the first hit after wraparound", () => {
  const trace = linearDrumTrace();
  const seeded = lSystemDrumEventsForTraversal(
    [trace],
    [{ position: 0.9, direction: 1, boundary: null }],
    { subdivisions: 4 },
  );
  const { traversal, events } = sweepTrace(trace, {
    position: 0.9,
    direction: 1,
    distance: 0.2,
    activeEventKeys: seeded.activeEventKeys,
  });

  assert.ok(traversal.samples.some(({ boundary }) => boundary === "wrap"));
  assert.ok(events.some(({ key }) => key === "l-system:1:0:0"));
});

test("L-System Drum Machine copies the L-system controls into a compact drum page", async () => {
  const [html, css, app] = await Promise.all([
    readFile(new URL("l-system-drums.html", root), "utf8"),
    readFile(new URL("l-system-drums.css", root), "utf8"),
    readFile(new URL("l-system-drums-app.js", root), "utf8"),
  ]);

  assert.match(html, /L-System Drum Machine/);
  assert.match(html, /id="resetAll"[^>]*data-reset-all[^>]*data-reset-in-place/);
  assert.match(html, /id="stage"[\s\S]*aria-describedby="canvasInstructions liveStatus"/);
  assert.match(html, /id="structureMode"[\s\S]*<option value="canon">Canon<\/option>/);
  for (const id of [
    "playButton",
    "position",
    "speed",
    "subdivisions",
    "playheadMotion",
    "traversalDirection",
    "loopMotion",
    "pingPongMotion",
    "preset",
    "iterations",
    "angle",
    "turnAsymmetry",
    "lengthScale",
    "mappingMode",
    "percussionStyle",
    "pitchDepth",
    "anglePitchDepth",
    "angleRange",
    "characterDepth",
    "drumMap",
    "mappingReadout",
    "currentDrumReadout",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), `missing ${id}`);
  }
  assert.match(html, /id="mappingMode"[\s\S]*Depth × turn/);
  assert.match(html, /id="percussionStyle"[\s\S]*Rattlesnake[\s\S]*Resonant metal/);
  assert.ok(
    html.indexOf('id="systemSection"') < html.indexOf('id="structureSection"'),
    "System should appear above Structure",
  );
  assert.match(html, /id="subdivisions"[\s\S]*min="1"[\s\S]*max="16"[\s\S]*value="4"/);
  assert.match(html, /id="anglePitchDepth"[\s\S]*max="36"[\s\S]*value="12"/);
  assert.match(html, /id="angleRange"[\s\S]*min="15"[\s\S]*max="360"[\s\S]*value="90"/);
  assert.match(html, /class="l-system-mapping-readout"[^>]*aria-label="Latest drum mapping"[^>]*aria-live="off"/);
  assert.match(html, /href="l-system-drums\.html" aria-current="page"/);
  assert.match(html, /src="l-system-drums-app\.js"/);
  assert.doesNotMatch(html, /<h1\b|soundMode|polyphonyReadout|synth-panel/);
  assert.match(html, /<details\b[^>]*data-section="play"[^>]*\sopen(?:\s|>)/);
  assert.equal((html.match(/<details\b[^>]*\sopen(?:\s|>)/g) ?? []).length, 1);
  assert.match(css, /\.l-system-drum-map[\s\S]*grid-template-columns: repeat\(4/);
  assert.match(app, /FM_DRUM_STORAGE_KEY/);
  assert.match(app, /new FmDrumAudio\(globalThis\)/);
  assert.match(app, /traceLSystem/);
  assert.match(app, /iterationPlaybackAtPhase/);
  assert.match(app, /lSystemDrumEventsForTraversal/);
  assert.match(app, /lSystemDrumTraversalStepSize/);
  assert.match(app, /groupedLSystemDrumEvents/);
  assert.match(app, /mappedLSystemDrumVoice/);
  assert.match(app, /styledLSystemDrumVoice/);
  assert.match(app, /anglePitchDepth: state\.anglePitchDepth/);
  assert.match(app, /angleRange: state\.angleRange/);
  assert.match(app, /state\.audio && audio\.context\?\.state === "running"/);
  assert.match(app, /pagehide[\s\S]+setAudioUi\(false\)[\s\S]+audio\.close\(\)/);
  assert.match(app, /pageshow[\s\S]+event\.persisted[\s\S]+setAudioUi\(false\)/);
});
