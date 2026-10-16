import test from "node:test";
import assert from "node:assert/strict";
import { DRUM_DEFAULTS, DRUM_PLACEMENTS, DRUM_VOICES, arcFractionAt, crossedTriggers, rowTriggers, sanitizeDrum, triggerPhase, triggerVoice } from "../src/instruments/graphonic-calculator/triggers.js";
import { buildGeometry } from "../src/instruments/graphonic-calculator/geometry.js";
import { collectContacts } from "../src/instruments/graphonic-calculator/readers.js";
import { DEFAULT_SETTINGS, PRESETS, analyzeState, applySnapshot, ensureSliders, snapshotOf } from "../src/instruments/graphonic-calculator/model.js";

const VIEW = { xMin: 0, xMax: 8, yMin: -2, yMax: 2 };
const close = (actual, expected, tolerance = 1e-6, message = `${actual} != ${expected}`) => assert.ok(Math.abs(actual - expected) < tolerance, message);
const settings = (overrides = {}) => ({ ...DEFAULT_SETTINGS, ...overrides });
function scene(texts, view = VIEW) {
  let state = applySnapshot({ rows: texts.map((text) => ({ text, color: "#61e9ce", visible: true, slider: null, range: null })), view, settings: DEFAULT_SETTINGS });
  state = ensureSliders(state, analyzeState(state));
  return { state, geometry: buildGeometry(analyzeState(state), state, view, 800, 400) };
}

test("drum settings sanitize and rows carry their role through snapshots", () => {
  assert.deepEqual(sanitizeDrum(null), DRUM_DEFAULTS);
  assert.deepEqual(sanitizeDrum({ placement: "diagonal", count: 999, voice: "nope", pitch: -3 }), { placement: "x", count: 64, voice: DRUM_VOICES[0].id, pitch: 0 });
  assert.deepEqual(DRUM_PLACEMENTS, ["x", "y", "xy", "equidistant"]);
  const state = applySnapshot({ rows: [{ text: "y = x", role: "drums", drum: { placement: "equidistant", count: 3, voice: "open-hat", pitch: 5 } }, { text: "y = 1", role: "contour", drum: { count: 2 } }], view: VIEW, settings: DEFAULT_SETTINGS });
  assert.equal(state.rows[0].role, "drums"); assert.deepEqual(state.rows[0].drum, { placement: "equidistant", count: 3, voice: "open-hat", pitch: 5 });
  assert.equal(state.rows[1].role, "contour"); assert.equal(state.rows[1].drum, null);
  assert.deepEqual(snapshotOf(state).rows.map((row) => [row.role, row.drum?.count ?? null]), [["drums", 3], ["contour", null]]);
  for (const id of ["drum-grid", "polyrhythm-curves"]) {
    const preset = PRESETS.find((entry) => entry.id === id);
    assert.ok(preset.snapshot.rows.some((row) => row.role === "drums") && preset.snapshot.rows.some((row) => row.role === "contour"), `${id} mixes drum and contour rows`);
  }
});

test("triggers sit on grid crossings or equidistant arclength and keep their branch fraction", () => {
  const { geometry } = scene(["y = 0.5x - 2"]);
  const [line] = geometry;
  const gridX = rowTriggers(line, sanitizeDrum({ placement: "x", count: 4 }), settings(), VIEW);
  assert.deepEqual(gridX.map((trigger) => trigger.x), [0, 2, 4, 6]);
  for (const trigger of gridX) close(trigger.y, 0.5 * trigger.x - 2, 1e-6);
  assert.ok(gridX.every((trigger, index) => index === 0 || trigger.s > gridX[index - 1].s), "fractions grow along the curve");
  const gridY = rowTriggers(line, sanitizeDrum({ placement: "y", count: 4 }), settings(), VIEW);
  assert.deepEqual(gridY.map((trigger) => Number(trigger.y.toFixed(6))), [2, 1, 0, -1]);
  const both = rowTriggers(line, sanitizeDrum({ placement: "xy", count: 4 }), settings(), VIEW);
  assert.equal(both.length, gridX.length + gridY.length);
  const even = rowTriggers(line, sanitizeDrum({ placement: "equidistant", count: 4 }), settings(), VIEW);
  assert.deepEqual(even.map((trigger) => trigger.s), [0.125, 0.375, 0.625, 0.875]);
  assert.ok(even.every((trigger) => trigger.branch === 0));
  const along = arcFractionAt(line, 4, 0);
  close(along.s, 0.5, 1e-6);
  const boxed = rowTriggers(line, sanitizeDrum({ placement: "x", count: 4 }), settings({ region: { xMin: 2, xMax: 6, yMin: -2, yMax: 2 } }), VIEW);
  assert.deepEqual(boxed.map((trigger) => trigger.x), [2, 3, 4, 5], "grid subdivisions follow the play region");
  const hyperbola = scene(["1/x"], { xMin: -4, xMax: 4, yMin: -4, yMax: 4 }).geometry[0];
  const branches = rowTriggers(hyperbola, sanitizeDrum({ placement: "equidistant", count: 2 }), settings(), { xMin: -4, xMax: 4, yMin: -4, yMax: 4 });
  assert.deepEqual([...new Set(branches.map((trigger) => trigger.branch))].sort(), [0, 1], "every branch gets its own equidistant triggers");
});

test("heads fire triggers exactly once per crossing in every reader mode and both motions", () => {
  const { geometry } = scene(["y = 0.5x - 2"]);
  const [line] = geometry;
  const drum = sanitizeDrum({ placement: "x", count: 4 });
  const list = rowTriggers(line, drum, settings(), VIEW);
  const read = (overrides, travel) => collectContacts(geometry, settings(overrides), VIEW, travel).heads;
  const lineHeads = (travel) => read({ playback: "line" }, travel);
  assert.deepEqual(crossedTriggers(list, settings(), VIEW, lineHeads(0.1), lineHeads(0.3)).map((fire) => fire.trigger.x), [2], "x = 2 is phase 0.25");
  assert.deepEqual(crossedTriggers(list, settings(), VIEW, lineHeads(0.9), lineHeads(1.1)).map((fire) => fire.trigger.x), [0], "the wrap crosses the first grid line once");
  assert.deepEqual(crossedTriggers(list, settings(), VIEW, lineHeads(0.3), lineHeads(0.3)), []);
  const pingpong = settings({ motion: "pingpong" });
  const pp = (travel) => collectContacts(geometry, pingpong, VIEW, travel).heads;
  assert.deepEqual(crossedTriggers(list, pingpong, VIEW, pp(0.9), pp(1.1)).map((fire) => fire.trigger.x), [], "ping-pong turns around at the end instead of wrapping");
  assert.deepEqual(crossedTriggers(list, pingpong, VIEW, pp(1.2), pp(1.3)).map((fire) => fire.trigger.x), [6], "coming back it meets x = 6 (phase 0.75) again");
  const horizontal = settings({ headAxes: ["horizontal"] });
  const hz = (travel) => collectContacts(geometry, horizontal, VIEW, travel).heads;
  const gridY = rowTriggers(line, sanitizeDrum({ placement: "y", count: 4 }), horizontal, VIEW);
  close(triggerPhase(gridY[1], horizontal, VIEW, hz(0)[0]), 0.25, 1e-9, "y = 1 is a quarter of the way down");
  assert.deepEqual(crossedTriggers(gridY, horizontal, VIEW, hz(0.2), hz(0.3)).map((fire) => fire.trigger.y.toFixed(3)), ["1.000"]);
  const points = settings({ playback: "points" });
  const pts = (travel) => collectContacts(geometry, points, VIEW, travel).heads;
  const even = rowTriggers(line, sanitizeDrum({ placement: "equidistant", count: 4 }), points, VIEW);
  assert.deepEqual(crossedTriggers(even, points, VIEW, pts(0.3), pts(0.4)).map((fire) => fire.trigger.s), [0.375]);
  const radarView = { xMin: -4, xMax: 4, yMin: -4, yMax: 4 };
  const circle = scene(["x^2 + y^2 = 4"], radarView).geometry[0];
  const radar = settings({ playback: "radar" });
  const even8 = rowTriggers(circle, sanitizeDrum({ placement: "equidistant", count: 8 }), radar, radarView);
  const radarHeads = (travel) => collectContacts([circle], radar, radarView, travel).heads;
  const phases = even8.map((trigger) => triggerPhase(trigger, radar, radarView, radarHeads(0)[0]));
  assert.ok(phases.every((phase) => phase >= 0 && phase < 1));
  const firedAround = crossedTriggers(even8, radar, radarView, radarHeads(0), radarHeads(1)).length;
  assert.equal(firedAround, 8, "one full turn of the ray meets every trigger once");
  const twoHeads = settings({ heads: 2 });
  const th = (travel) => collectContacts(geometry, twoHeads, VIEW, travel).heads;
  assert.deepEqual(crossedTriggers(list, twoHeads, VIEW, th(0.2), th(0.3)).map((fire) => [fire.head, fire.trigger.x]), [[0, 2], [1, 6]], "each head reports its own crossing");
  assert.deepEqual(crossedTriggers(list, settings(), VIEW, null, lineHeads(0.5)), []);
});

test("trigger voices come from the shared FM kit and bend with height when asked", () => {
  const trigger = { x: 1, y: 2 };
  const flat = triggerVoice(sanitizeDrum({ voice: "snap-snare" }), trigger, settings(), VIEW);
  assert.equal(flat.name, "Snap Snare"); assert.equal(flat.frequency, DRUM_VOICES.find((voice) => voice.id === "snap-snare").frequency);
  const bent = triggerVoice(sanitizeDrum({ voice: "snap-snare", pitch: 12 }), trigger, settings(), VIEW);
  close(bent.frequency, flat.frequency * 2, 1e-6, "top of the box is an octave up with a 12-semitone range");
  const low = triggerVoice(sanitizeDrum({ voice: "snap-snare", pitch: 12 }), { x: 1, y: -2 }, settings(), VIEW);
  close(low.frequency, flat.frequency / 2, 1e-6);
});

test("pitched strike voices are accepted, follow height over the pitch range, and rows keep their own wave voice", async () => {
  const { PITCHED_VOICES, TRIGGER_VOICE_GROUPS, isPitchedVoice, pitchedTriggerFrequency } = await import("../src/instruments/graphonic-calculator/triggers.js");
  assert.deepEqual(PITCHED_VOICES.map((voice) => voice.id), ["pluck", "rattle", "bar", "chime-fm", "zap"]);
  assert.equal(TRIGGER_VOICE_GROUPS[1].voices, DRUM_VOICES);
  assert.equal(sanitizeDrum({ voice: "rattle" }).voice, "rattle");
  assert.ok(isPitchedVoice("pluck") && !isPitchedVoice("sub-kick"));
  close(pitchedTriggerFrequency({ x: 0, y: VIEW.yMin }, settings({ traceOctaves: 2 }), VIEW), 220);
  close(pitchedTriggerFrequency({ x: 0, y: VIEW.yMax }, settings({ traceOctaves: 2 }), VIEW), 880);
  close(pitchedTriggerFrequency({ x: 0, y: 0 }, settings({ traceOctaves: 3 }), VIEW), 220 * 2 ** 1.5);
  const state = applySnapshot({ rows: [{ text: "y = x", voice: "saw" }, { text: "y = 1", voice: "kazoo" }], view: VIEW, settings: DEFAULT_SETTINGS });
  assert.deepEqual(state.rows.map((row) => row.voice), ["saw", null]);
  assert.deepEqual(snapshotOf(state).rows.map((row) => row.voice), ["saw", null]);
  const geometry = buildGeometry(analyzeState(state), state, VIEW, 800, 400);
  assert.equal(geometry[0].voice, "saw");
  const contacts = collectContacts(geometry, settings(), VIEW, 0.2).contacts;
  assert.deepEqual([...new Set(contacts.map((contact) => contact.voice))].sort(), [null, "saw"].sort());
});
