import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  normalizeSharedProfile,
  sharedProfilePoints,
} from "../src/shapes-profile.js";
import { buildProfilePrism, buildSolid } from "../src/solid.js";
import { buildHyperShape, buildProfileHyperprism } from "../src/hyper.js";
import {
  installShapesNativeBridge,
  SHAPES_BRIDGE_PROPERTY,
  SHAPES_BRIDGE_READY_EVENT,
} from "../src/shapes-native-bridge.js";

const EPSILON = 1e-12;

function assertClose(actual, expected, message) {
  assert.ok(
    Math.abs(actual - expected) <= EPSILON,
    `${message}: expected ${expected}, received ${actual}`,
  );
}

function assertSameProfileShape(actual, expected, message) {
  assert.equal(actual.length, expected.length, `${message} point count`);
  const actualMaximum = Math.max(...actual.map(({ x, y }) => Math.hypot(x, y)));
  const expectedMaximum = Math.max(...expected.map(({ x, y }) => Math.hypot(x, y)));
  actual.forEach((point, index) => {
    const reference = expected[index];
    assertClose(
      Math.atan2(point.y, point.x),
      Math.atan2(reference.y, reference.x),
      `${message} point ${index} angle`,
    );
    assertClose(
      Math.hypot(point.x, point.y) / actualMaximum,
      Math.hypot(reference.x, reference.y) / expectedMaximum,
      `${message} point ${index} relative radius`,
    );
  });
}

test("a 2D triangle is preserved as a 3D triangular prism and 4D triangular hyperprism", () => {
  const requested = { sides: 3, kind: "polygon", starDepth: 0.41 };
  const polygon = sharedProfilePoints(requested);
  const prism = buildProfilePrism(requested);
  const hyperprism = buildProfileHyperprism(requested);

  assert.deepEqual(
    { sides: polygon.sides, kind: polygon.kind, starDepth: polygon.starDepth },
    normalizeSharedProfile(requested),
  );
  assert.equal(polygon.points.length, 3);
  assert.equal(prism.vertices.length, 6);
  assert.equal(prism.edges.length, 9);
  assert.equal(hyperprism.vertices.length, 12);
  assert.equal(hyperprism.edges.length, 24);

  assert.deepEqual(prism.profile, polygon);
  assert.deepEqual(prism.vertices.slice(0, 3).map(({ x, y }) => ({ x, y })), polygon.points);
  assert.deepEqual(prism.vertices.slice(3).map(({ x, y }) => ({ x, y })), polygon.points);

  for (let slice = 0; slice < 4; slice += 1) {
    assert.deepEqual(
      hyperprism.vertices.slice(slice * 3, slice * 3 + 3).map(({ x, y }) => ({ x, y })),
      hyperprism.profile.points,
    );
  }
  assertSameProfileShape(hyperprism.profile.points, polygon.points, "4D triangle profile");
  assert.deepEqual(
    Object.fromEntries(["u", "z", "w"].map((axis) => [
      axis,
      hyperprism.edges.filter((edge) => edge.axis === axis).length,
    ])),
    { u: 12, z: 6, w: 6 },
  );

  assert.deepEqual(buildSolid("profile", { profile: requested }), prism);
  assert.deepEqual(buildHyperShape("profile", { profile: requested }), hyperprism);
});

test("star vertices and inset depth survive each dimensional extrusion", () => {
  const requested = { sides: 5, kind: "star", starDepth: 0.37 };
  const star = sharedProfilePoints(requested);
  const prism = buildSolid("profile", { profile: requested });
  const hyperprism = buildHyperShape("profile", { profile: requested });

  assert.equal(star.points.length, 10);
  assert.equal(prism.profile.kind, "star");
  assert.equal(hyperprism.profile.kind, "star");
  assert.equal(prism.profile.sides, 5);
  assert.equal(hyperprism.profile.sides, 5);
  assert.equal(prism.profile.starDepth, 0.37);
  assert.equal(hyperprism.profile.starDepth, 0.37);
  assert.equal(prism.vertices.length, 20);
  assert.equal(prism.edges.length, 30);
  assert.equal(hyperprism.vertices.length, 40);
  assert.equal(hyperprism.edges.length, 80);

  const outerRadius = Math.hypot(star.points[0].x, star.points[0].y);
  for (let index = 0; index < star.points.length; index += 1) {
    const expectedRatio = index % 2 === 0 ? 1 : 1 - requested.starDepth;
    assertClose(
      Math.hypot(star.points[index].x, star.points[index].y) / outerRadius,
      expectedRatio,
      `2D star point ${index} radius`,
    );
  }

  assertSameProfileShape(prism.profile.points, star.points, "3D star profile");
  assertSameProfileShape(hyperprism.profile.points, star.points, "4D star profile");
  for (let slice = 0; slice < 4; slice += 1) {
    assert.deepEqual(
      hyperprism.vertices.slice(slice * 10, slice * 10 + 10).map(({ x, y }) => ({ x, y })),
      hyperprism.profile.points,
    );
  }
});

test("the native Shapes bridge binds engine methods and advertises readiness", async () => {
  class FakeCustomEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.detail = options.detail;
    }
  }

  const events = [];
  const runtime = {
    CustomEvent: FakeCustomEvent,
    dispatchEvent(event) {
      events.push(event);
      return true;
    },
  };
  const calls = [];
  const adapter = {
    geometry: "solid",
    sound: "synth",
    capabilities: { continuousPosition: true, bankReset: true },
    captureState() {
      assert.equal(this, adapter);
      calls.push(["capture"]);
      return { playback: { playing: true, continuousPosition: 2.25 } };
    },
    applyState(state) {
      assert.equal(this, adapter);
      calls.push(["apply", state]);
    },
    async prepareAudio(options) {
      assert.equal(this, adapter);
      calls.push(["prepare", options]);
      return "prepared";
    },
    setHostGain(gain, milliseconds) {
      assert.equal(this, adapter);
      calls.push(["gain", gain, milliseconds]);
    },
    parkAudio() {
      assert.equal(this, adapter);
      calls.push(["park"]);
    },
    disableAudio() {
      assert.equal(this, adapter);
      calls.push(["disable"]);
    },
    resetBank(bank) {
      assert.equal(this, adapter);
      calls.push(["reset", bank]);
      return bank === "play";
    },
  };

  const bridge = installShapesNativeBridge(adapter, runtime);
  assert.equal(runtime[SHAPES_BRIDGE_PROPERTY], bridge);
  assert.equal(Object.getOwnPropertyDescriptor(runtime, SHAPES_BRIDGE_PROPERTY)?.configurable, true);
  assert.ok(Object.isFrozen(bridge));
  assert.ok(Object.isFrozen(bridge.capabilities));
  assert.deepEqual(
    events.map(({ type, detail }) => ({ type, detail })),
    [{
      type: SHAPES_BRIDGE_READY_EVENT,
      detail: { geometry: "solid", sound: "synth", version: 1 },
    }],
  );

  const snapshot = bridge.captureState();
  bridge.applyState(snapshot);
  assert.equal(await bridge.prepareAudio({ gain: 0 }), "prepared");
  bridge.setHostGain(1, 90);
  bridge.parkAudio();
  bridge.disableAudio();
  assert.equal(bridge.resetBank("play"), true);
  assert.deepEqual(calls, [
    ["capture"],
    ["apply", snapshot],
    ["prepare", { gain: 0 }],
    ["gain", 1, 90],
    ["park"],
    ["disable"],
    ["reset", "play"],
  ]);

  adapter.capabilities.continuousPosition = false;
  assert.equal(bridge.capabilities.continuousPosition, true, "capabilities are snapshotted");
});

test("the native Shapes bridge has safe defaults and can replace a prior adapter", async () => {
  const runtime = {};
  const initial = installShapesNativeBridge({}, runtime);
  assert.deepEqual(initial.captureState(), {});
  assert.equal(initial.applyState({}), undefined);
  assert.equal(await initial.prepareAudio(), undefined);
  assert.equal(initial.setHostGain(0), undefined);
  assert.equal(initial.parkAudio(), undefined);
  assert.equal(initial.disableAudio(), undefined);
  assert.equal(initial.resetBank("form"), false);

  const replacement = installShapesNativeBridge({ geometry: "hyper", sound: "drums" }, runtime);
  assert.notEqual(replacement, initial);
  assert.equal(runtime[SHAPES_BRIDGE_PROPERTY], replacement);
  assert.equal(replacement.geometry, "hyper");
  assert.equal(replacement.sound, "drums");
});

test("the Shapes host prepares the target before crossfading and parks the source afterward", async () => {
  const source = await readFile(new URL("../combo-app.js", import.meta.url), "utf8");
  const start = source.indexOf("async function activateInstrument");
  const end = source.indexOf("\nconst initialFrame", start);
  assert.ok(start >= 0 && end > start, "the host exposes an asynchronous dimension handoff");
  const handoff = source.slice(start, end);

  const targetReady = handoff.indexOf("await whenNativeBridgeReady(frame)");
  const capture = handoff.indexOf("outgoingBridge.captureState()");
  const apply = handoff.indexOf("incomingBridge.applyState(", capture);
  const prepare = handoff.indexOf("incomingBridge.prepareAudio(", apply);
  const finalApply = handoff.indexOf("incomingBridge.applyState(stateForHandoff", prepare);
  const reveal = handoff.indexOf("frame.hidden = false", capture);
  const fadeOut = handoff.indexOf("outgoingBridge.setHostGain(0, HANDOFF_MILLISECONDS)");
  const fadeIn = handoff.indexOf("incomingBridge.setHostGain(1, HANDOFF_MILLISECONDS)");
  const fadeWait = handoff.indexOf("await waitMilliseconds(HANDOFF_MILLISECONDS)", fadeOut);
  const park = handoff.indexOf("outgoingBridge.parkAudio()", fadeWait);
  const hide = handoff.indexOf("previousFrame.hidden = true", park);

  for (const [label, position] of Object.entries({
    targetReady, capture, apply, prepare, finalApply, reveal, fadeOut, fadeIn, fadeWait, park, hide,
  })) {
    assert.ok(position >= 0, `handoff includes ${label}`);
  }
  assert.ok(targetReady < capture, "the playing source remains active while the target frame loads");
  assert.ok(capture < apply, "source state is captured before target state is applied");
  assert.ok(apply < prepare, "target state is installed before its audio engine is prepared");
  assert.ok(prepare < finalApply && finalApply < reveal, "the prepared target receives an updated continuous phase before reveal");
  assert.ok(fadeOut < fadeWait && fadeIn < fadeWait, "both gain ramps begin before the handoff wait");
  assert.ok(fadeWait < park && park < hide, "the source is parked and hidden only after the crossfade");
  assert.match(
    source,
    /setTimeout\(\(\) => \{[\s\S]*Object\.values\(COMBO_NATIVE_INSTRUMENTS\)[\s\S]*instrumentFrame\(instrument\)/,
    "all dimension/system frames are preloaded for subsequent switches",
  );
});

test("a missing native bridge never commits a stopped replacement over the playing source", async () => {
  const source = await readFile(new URL("../combo-app.js", import.meta.url), "utf8");
  const start = source.indexOf("if (!outgoingBridge || !incomingBridge)");
  const end = source.indexOf("\n  try {", start);
  assert.ok(start >= 0 && end > start, "the host handles an unavailable bridge explicitly");
  const unavailable = source.slice(start, end);
  assert.match(unavailable, /restoreAfterFailedHandoff\(frame, previousFrame, instrument, previousInstrument\)/);
  assert.doesNotMatch(unavailable, /silenceFrame|previousFrame\.hidden = true|commitInstrumentSelection/);

  const restoreStart = source.indexOf("function restoreAfterFailedHandoff");
  const restoreEnd = source.indexOf("\nasync function activateInstrument", restoreStart);
  const restore = source.slice(restoreStart, restoreEnd);
  assert.match(restore, /frame\.hidden = true/);
  assert.match(restore, /previousFrame\.hidden = false/);
  assert.match(restore, /is still playing/);
});

test("rapid handoffs clean up only frames still owned by the superseded request", async () => {
  const source = await readFile(new URL("../combo-app.js", import.meta.url), "utf8");
  assert.match(source, /const frameTransitionOwners = new WeakMap\(\)/);
  assert.match(source, /frameTransitionOwners\.set\(frame, requestId\)/);
  assert.match(source, /frameTransitionOwners\.get\(frame\) === requestId/);
  assert.match(source, /frame\.dataset\.instrument === activeInstrument\.id/);
  assert.match(source, /sourceCanRetire\(previousFrame, requestId\)/);
  assert.match(source, /const targetIsCommitted = committed \|\| activeInstrument\.id === instrument\.id/);
});

test("parking an inactive native frame preserves its play and rotation intent", async () => {
  for (const file of [
    "app.js",
    "shape-drums-app.js",
    "solid-app.js",
    "solid-drums-app.js",
    "hyper-app.js",
    "hyper-drums-app.js",
  ]) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    const match = source.match(/parkAudio:\s*\(\) => \{([\s\S]*?)\n\s*\},\n\s*disableAudio:/);
    assert.ok(match, `${file} exposes a bounded parkAudio implementation`);
    assert.doesNotMatch(match[1], /playing\s*=\s*false|setPlaying\(false\)|Playing`?\]?\s*=\s*false/);
    assert.match(match[1], /shapesHostParked = true/);
    assert.match(source, /function scheduleFrame\(\) \{\s*if \(shapesHostParked\) return;/);
    assert.match(source, /applyState:\s*\(snapshot = \{\}\) => \{\s*shapesHostParked = false;/);
  }
});

test("3D and 4D PM handoffs invert the native 0.7 depth projection", async () => {
  for (const file of ["solid-app.js", "hyper-app.js"]) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(source, /pmIndex:\s*state\.fmIndex \* 0\.7/);
    assert.match(source, /synth\.mode === "pm" \? Number\(synth\.pmIndex\) \/ 0\.7 : synth\.fmIndex/);
  }
});

test("the compatible five-node synth envelope is shared across dimensions", async () => {
  const shape = await readFile(new URL("../app.js", import.meta.url), "utf8");
  assert.match(shape, /envelope:\s*\{[\s\S]*enabled:\s*state\.amplitudeEnvelopeEnabled[\s\S]*points:\s*state\.amplitudeEnvelopePoints\.map/);
  assert.match(shape, /state\.amplitudeEnvelopePoints = sanitizeAmplitudeEnvelope\(synth\.envelope\.points\)/);
  for (const file of ["solid-app.js", "hyper-app.js"]) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(source, /envelope:\s*amplitudeControl\.captureState\(\)/);
    assert.match(source, /amplitudeControl\.applyState\(synth\.envelope\)/);
  }
});

test("shared controls move while each dimension keeps a private form and rotation snapshot", async () => {
  const host = await readFile(new URL("../combo-app.js", import.meta.url), "utf8");
  assert.match(host, /const dimensionInstrumentState = \{\}/);
  assert.match(host, /mergeSharedState\(outgoingBridge\.captureState\(\), previousInstrument\.geometry\)/);
  assert.match(host, /stateForHandoff\(instrument\.geometry\)/);
  assert.match(host, /snapshot\.dimension = cloneStateValue\(dimensionInstrumentState\[targetGeometry\]\)/);

  for (const file of [
    "app.js",
    "shape-drums-app.js",
    "solid-app.js",
    "solid-drums-app.js",
    "hyper-app.js",
    "hyper-drums-app.js",
  ]) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(source, /dimension:\s*\w+DimensionState\(\)/, `${file} exports private dimension state`);
    assert.match(source, /apply\w+DimensionState\(snapshot\.dimension \?\? \{\}\)/, `${file} restores it`);
  }

  for (const file of ["solid-app.js", "solid-drums-app.js", "hyper-app.js", "hyper-drums-app.js"]) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(source, /lift:\s*"local"/, `${file} distinguishes dimension-local topology`);
    assert.match(source, /profile\.lift === "local"/, `${file} does not coerce local forms`);
  }
});
