import test from "node:test";
import assert from "node:assert/strict";
import {
  LINE_AXES, MOTION_MODES, PITCH_SOURCES, PLAYBACK_MODES, arclength, collectContacts, crossedAxes, headDirection, headGuide, headOffsets, headPhase, lineAxisForHead,
  pitchValue, pointAlong, radarCenter, radarReach, stitchSegments,
} from "../src/instruments/graphonic-calculator/readers.js";
import { buildGeometry } from "../src/instruments/graphonic-calculator/geometry.js";
import { DEFAULT_SETTINGS, analyzeState, applySnapshot, ensureSliders } from "../src/instruments/graphonic-calculator/model.js";

const WIDTH = 800, HEIGHT = 500;
const VIEW = { xMin: -5, xMax: 5, yMin: -3, yMax: 3 };
const close = (actual, expected, tolerance = 1e-6, message = `${actual} != ${expected}`) => assert.ok(Math.abs(actual - expected) < tolerance, message);
const settings = (overrides = {}) => ({ ...DEFAULT_SETTINGS, ...overrides });

function scene(texts, view = VIEW) {
  const snapshot = { rows: texts.map((text) => ({ text, color: "#61e9ce", visible: true, slider: null, range: null })), view, settings: DEFAULT_SETTINGS };
  let state = applySnapshot(snapshot);
  state = ensureSliders(state, analyzeState(state));
  const analysis = analyzeState(state);
  return { state, analysis, geometry: buildGeometry(analysis, state, view, WIDTH, HEIGHT) };
}

test("stitching joins shared endpoints into polylines and closes loops", () => {
  const square = [Float64Array.of(0, 0, 1, 0), Float64Array.of(1, 1, 0, 1), Float64Array.of(1, 0, 1, 1), Float64Array.of(0, 1, 0, 0)];
  const stitched = stitchSegments(square);
  assert.equal(stitched.length, 1);
  assert.equal(stitched[0].length, 10, "four pieces become one closed five-point loop");
  assert.deepEqual([stitched[0][0], stitched[0][1]], [stitched[0][8], stitched[0][9]]);
  const open = [Float64Array.of(2, 0, 3, 0), Float64Array.of(0, 0, 1, 0), Float64Array.of(1, 0, 2, 0)];
  const chain = stitchSegments(open);
  assert.equal(chain.length, 1);
  assert.deepEqual(Array.from(chain[0]), [0, 0, 1, 0, 2, 0, 3, 0]);
  const reversedMiddle = [Float64Array.of(2, 0, 1, 0), Float64Array.of(0, 0, 1, 0), Float64Array.of(2, 0, 3, 0)];
  const xs = Array.from(stitchSegments(reversedMiddle)[0]).filter((_, index) => index % 2 === 0);
  assert.deepEqual(xs, [...xs].sort((a, b) => a - b).length === xs.length && (xs[0] < xs.at(-1)) ? xs : xs.reverse());
  assert.equal(stitchSegments([Float64Array.of(0, 0, 1, 1), Float64Array.of(5, 5, 6, 6)]).length, 2);
  assert.deepEqual(stitchSegments([]), []);
  const { geometry } = scene(["x^2 + y^2 = 4"]);
  assert.equal(geometry[0].segments.length, 1, "a marching-squares circle stitches into one polyline");
  const circle = geometry[0].segments[0];
  close(circle[0], circle[circle.length - 2], 1e-9); close(circle[1], circle[circle.length - 1], 1e-9);
});

test("arclength travel follows a curve at constant speed and spans every branch", () => {
  const { geometry } = scene(["y = x", "1/x"]);
  const [line, hyperbola] = geometry;
  const length = arclength(line);
  close(length.total, Math.hypot(10, 10), 1e-6, "y = x is sampled across the full x-range, including off-screen heights");
  const start = pointAlong(line, 0), middle = pointAlong(line, 0.5), end = pointAlong(line, 1);
  close(start.x, -5, 1e-6); close(middle.x, 0, 1e-6); close(end.x, 5, 1e-6);
  close(middle.y, middle.x, 1e-9);
  assert.ok(arclength(hyperbola).runs.length === 2, "two branches");
  const early = pointAlong(hyperbola, 0.1), late = pointAlong(hyperbola, 0.9);
  assert.ok(early.x < 0 && late.x > 0, "travel crosses from the left branch to the right branch");
  assert.equal(pointAlong({ segments: [] }, 0.5), null);
});

test("head offsets, phases and guides match Shape's reader vocabulary", () => {
  assert.deepEqual(headOffsets(settings({ heads: 4 })), [0, 0.25, 0.5, 0.75]);
  assert.deepEqual(headOffsets(settings({ heads: 3, headOffsets: [0, 0.1, 0.7] })), [0, 0.1, 0.7]);
  assert.deepEqual([0, 1, 2, 3].map((head) => lineAxisForHead(settings({ headAxes: crossedAxes(4) }), head)), ["vertical", "horizontal", "vertical", "horizontal"]);
  assert.equal(headDirection(settings({ playback: "radar", headDirections: [1, -1] }), 1), -1);
  assert.equal(headDirection(settings({ playback: "line", headDirections: [-1] }), 0), 1, "scan lines ignore per-head reversal");
  close(headPhase(1.25, 0, "loop"), 0.25); close(headPhase(1.25, 0, "pingpong"), 0.75); close(headPhase(0.1, 0.5, "loop"), 0.6);
  const vertical = headGuide(settings({ playback: "line" }), VIEW, 0, 0.5);
  assert.equal(vertical.kind, "line"); assert.equal(vertical.axis, "vertical"); close(vertical.coordinate, 0);
  const horizontal = headGuide(settings({ playback: "line", headAxes: ["horizontal"] }), VIEW, 0, 0);
  close(horizontal.coordinate, VIEW.yMax, 1e-9, "horizontal lines start at the top like Shape's y-down bounds");
  const ray = headGuide(settings({ playback: "radar" }), VIEW, 0, 0);
  assert.equal(ray.kind, "ray"); close(ray.angle, Math.PI / 2); assert.deepEqual(ray.center, { x: 0, y: 0 });
  close(headGuide(settings({ playback: "radar" }), VIEW, 0, 0.25).angle, 0, 1e-9, "a quarter turn later the ray points right: clockwise on screen");
  assert.deepEqual(radarCenter({ xMin: 2, xMax: 6, yMin: 1, yMax: 5 }), { x: 4, y: 3 });
  close(radarReach(VIEW, { x: 0, y: 0 }), Math.hypot(5, 3));
  assert.equal(headGuide(settings({ playback: "points" }), VIEW, 0, 0.3).kind, "points");
  assert.deepEqual([PLAYBACK_MODES, MOTION_MODES, LINE_AXES, PITCH_SOURCES].map((list) => list.length), [3, 2, 2, 3]);
});

test("contacts come from every head in every mode and skip discrete points", () => {
  const { geometry } = scene(["y = x^2", "x^2 + y^2 = 4", "(1, 2)"]);
  const line = collectContacts(geometry, settings({ playback: "line", heads: 2 }), VIEW, 0.5);
  assert.equal(line.heads.length, 2);
  close(line.heads[0].phase, 0.5); close(line.heads[1].phase, 0);
  const headZero = line.contacts.filter((contact) => contact.head === 0);
  assert.ok(headZero.some((contact) => contact.id === geometry[0].id), "the parabola is met at x = 0");
  assert.ok(headZero.every((contact) => Math.abs(contact.x) < 1e-9));
  assert.equal(headZero.filter((contact) => contact.id === geometry[1].id).length, 2, "both circle branches at x = 0");
  assert.ok(line.contacts.every((contact) => contact.id !== geometry[2].id), "points are not probe contacts");
  const offscreen = collectContacts(geometry, settings({ playback: "line" }), VIEW, 0.1);
  assert.ok(offscreen.contacts.every((contact) => contact.id !== geometry[0].id), "the parabola at x = -4 is above the view, so it is not a contact");
  const reversed = collectContacts(geometry, settings({ playback: "line" }), VIEW, -0.1);
  close(reversed.heads[0].phase, 0.9, 1e-9, "negative travel runs the sweep backwards");
  const radar = collectContacts(geometry, settings({ playback: "radar" }), VIEW, 0.125);
  const circleHit = radar.contacts.find((contact) => contact.id === geometry[1].id);
  close(Math.hypot(circleHit.x, circleHit.y), 2, 0.06);
  assert.ok(circleHit.x > 0 && circleHit.y > 0, "an eighth of a turn from 12 o'clock points up-right");
  const points = collectContacts(geometry, settings({ playback: "points", heads: 3 }), VIEW, 0);
  assert.equal(points.contacts.length, 6, "three heads on two single-branch curves");
  const branched = collectContacts(scene(["1/x"]).geometry, settings({ playback: "points", heads: 2 }), VIEW, 0.25);
  assert.equal(branched.contacts.length, 4, "every branch carries every head");
  assert.deepEqual([...new Set(branched.contacts.map((contact) => contact.branch))].sort(), [0, 1]);
  const reversedHead = collectContacts(geometry, settings({ playback: "points", heads: 2, headDirections: [1, -1] }), VIEW, 0.2);
  close(reversedHead.heads[1].phase, 0.3, 1e-9, "a reversed head runs backwards from its offset");
  const parabolaStart = points.contacts.find((contact) => contact.head === 0 && contact.id === geometry[0].id);
  close(parabolaStart.x, VIEW.xMin, 1e-6, "point heads start where the sampled curve starts");
  const pingpong = collectContacts(geometry, settings({ playback: "points", motion: "pingpong" }), VIEW, 1.5);
  close(pingpong.heads[0].phase, 0.5);
});

test("pitch sources normalise height, width and radius over the view", () => {
  const contact = { x: 2.5, y: 0 };
  close(pitchValue(contact, "height", VIEW), 0.5);
  close(pitchValue(contact, "width", VIEW), 0.75);
  close(pitchValue(contact, "radius", VIEW), 2.5 / Math.hypot(5, 3));
  close(pitchValue({ x: VIEW.xMin, y: VIEW.yMax }, "height", VIEW), 1);
});

test("the play region bounds line sweeps, pins the radar centre, clips point travel and silences the outside", async () => {
  const { clipSegments, fitRegion, readerRegion, regionCenter } = await import("../src/instruments/graphonic-calculator/readers.js");
  const { traceVoiceTarget } = await import("../src/instruments/graphonic-calculator/audio.js");
  const { sanitizeRegion } = await import("../src/instruments/graphonic-calculator/model.js");
  const region = { xMin: 1, xMax: 3, yMin: 0, yMax: 2 };
  const boxed = settings({ region });
  assert.deepEqual(readerRegion(boxed, VIEW), region);
  assert.deepEqual(readerRegion(settings(), VIEW), VIEW);
  const vertical = headGuide(boxed, VIEW, 0, 0.5);
  close(vertical.coordinate, 2); assert.deepEqual(vertical.span, [0, 2]); close(vertical.probe.length, 2);
  const horizontal = headGuide(settings({ region, headAxes: ["horizontal"] }), VIEW, 0, 0);
  close(horizontal.coordinate, 2); close(horizontal.probe.x0, 1); close(horizontal.probe.length, 2);
  assert.deepEqual(regionCenter(boxed, VIEW), { x: 2, y: 1 }, "a positive-only box turns about its own centre, not the origin");
  assert.deepEqual(regionCenter(settings(), VIEW), { x: 0, y: 0 });
  const ray = headGuide(settings({ region, playback: "radar" }), VIEW, 0, 0);
  assert.deepEqual(ray.center, { x: 2, y: 1 }); close(ray.probe.length, Math.hypot(1, 1));
  close(pitchValue({ x: 3, y: 1 }, "radius", region, { x: 2, y: 1 }), 1 / Math.SQRT2);
  close(pitchValue({ x: 2, y: 2 }, "height", region), 1); close(pitchValue({ x: 1.5, y: 0 }, "width", region), 0.25);
  const clipped = clipSegments([Float64Array.of(0, 1, 4, 1), Float64Array.of(2, -1, 2, 1, 2, 3), Float64Array.of(5, 5, 6, 6)], region);
  assert.equal(clipped.length, 2);
  assert.deepEqual(Array.from(clipped[0]), [1, 1, 3, 1]);
  assert.deepEqual(Array.from(clipped[1]), [2, 0, 2, 1, 2, 2]);
  const { geometry } = scene(["y = x^2"]);
  const points = collectContacts(geometry, settings({ region: { xMin: 0, xMax: 2, yMin: 0, yMax: 3 }, playback: "points" }), VIEW, 0);
  close(points.contacts[0].x, 0, 1e-6, "point heads start where the curve enters the box");
  assert.deepEqual(points.region, { xMin: 0, xMax: 2, yMin: 0, yMax: 3 });
  const outside = collectContacts(geometry, boxed, VIEW, 0.5);
  assert.ok(outside.contacts.every((contact) => contact.y >= 0 && contact.y <= 2), "line contacts stay inside the box");
  assert.equal(traceVoiceTarget({ x: 0, y: 0, view: region, center: { x: 2, y: 1 } }).gain, 0, "outside the box is silent");
  assert.equal(traceVoiceTarget({ x: 2, y: 1, view: region, center: { x: 2, y: 1 } }).gain, 1);
  const fitted = fitRegion(scene(["y = x^2"], { xMin: -2, xMax: 2, yMin: -1, yMax: 5 }).geometry, { xMin: -2, xMax: 2, yMin: -1, yMax: 5 });
  assert.ok(fitted.yMin <= 0 && fitted.yMin > -0.5 && fitted.yMax <= 5 && fitted.xMin >= -2 && fitted.xMax <= 2);
  assert.equal(fitRegion([], VIEW), null);
  assert.deepEqual(sanitizeRegion({ xMin: "1", xMax: 3, yMin: 0, yMax: 2 }), region);
  assert.equal(sanitizeRegion({ xMin: 3, xMax: 1, yMin: 0, yMax: 2 }), null);
  assert.equal(sanitizeRegion(null), null);
  assert.equal(DEFAULT_SETTINGS.region, null);
});
