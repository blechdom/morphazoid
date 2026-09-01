import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPOSITION_PRESETS,
  INSTRUMENT_LIBRARY,
  addInstrumentClip,
  cloneCompositionPreset,
  compositionDurationBeats,
  moveTimelineClip,
  projectTimeline,
  resizeTimelineClip,
  validateComposition,
} from "../src/constellation-composer.js";

test("Constellation ships a broad bank of valid multi-section musical presets", () => {
  assert.ok(COMPOSITION_PRESETS.length >= 8);
  assert.ok(INSTRUMENT_LIBRARY.length >= 8);
  for (const preset of COMPOSITION_PRESETS) {
    assert.ok(preset.sections.length >= 3, preset.id);
    assert.equal(validateComposition(preset).valid, true, preset.id);
    assert.ok(compositionDurationBeats(preset) > 0, preset.id);
    for (const section of preset.sections) {
      const projection = projectTimeline(preset, section.id);
      assert.ok(projection.clips.length >= 2, `${preset.id}/${section.id}`);
      assert.ok(projection.durationBeats >= Math.max(...projection.clips.map(({ endBeat }) => endBeat)));
    }
  }
});

test("forked flow branches project into synchronized timeline layers", () => {
  const composition = cloneCompositionPreset("neon-causeway");
  const projection = projectTimeline(composition, "nc-body");
  assert.equal(projection.clips.length, 4);
  assert.equal(projection.clips[0].startBeat, 0);
  assert.equal(projection.clips.at(-1).startBeat, 4);
  assert.deepEqual([...new Set(projection.clips.map(({ lane }) => lane))], [0, 1, 2, 3]);
});

test("timeline editing rewrites graph edge time and clip duration", () => {
  const composition = cloneCompositionPreset("neon-causeway");
  const before = projectTimeline(composition, "nc-intro");
  const clip = before.clips[2];
  const moved = moveTimelineClip(composition, "nc-intro", clip.nodeId, 7.13);
  const resized = resizeTimelineClip(moved, "nc-intro", clip.nodeId, 20.11);
  const after = projectTimeline(resized, "nc-intro").clips.find(({ nodeId }) => nodeId === clip.nodeId);
  assert.equal(after.startBeat, 7.25);
  assert.equal(after.durationBeats, 20);
  assert.equal(projectTimeline(composition, "nc-intro").clips[2].startBeat, 4, "editing is immutable");
});

test("instrument insertion adds a playable branch without mutating the preset", () => {
  const composition = cloneCompositionPreset("slow-orbit");
  const before = projectTimeline(composition, "so-launch");
  const changed = addInstrumentClip(composition, "so-launch", "lattice", { startBeat: 3, durationBeats: 12 });
  const after = projectTimeline(changed, "so-launch");
  assert.equal(after.clips.length, before.clips.length + 1);
  assert.equal(after.clips.at(-1).instrumentId, "lattice");
  assert.equal(after.clips.at(-1).startBeat, 3);
  assert.equal(projectTimeline(composition, "so-launch").clips.length, before.clips.length);
});
