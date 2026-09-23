import assert from "node:assert/strict";
import test from "node:test";
import { TapeWorm } from "../src/families/starting-instruments/tape-worm.js";
import { LoopSoup } from "../src/families/starting-instruments/loop-soup.js";
import { MAX_LOOPS, MAX_ROUTES } from "../src/families/starting-instruments/loop-network.js";

function run(c, seconds, input = 0) {
  let peak = 0, power = 0;
  for (let i = 0; i < Math.round(c.rate * seconds); i++) {
    const out = c.tick(typeof input === "function" ? input(i) : input);
    for (const v of out) { assert.ok(Number.isFinite(v)); peak = Math.max(peak, Math.abs(v)); power += v * v; }
  }
  return { peak, rms: Math.sqrt(power / Math.max(1, 2 * Math.round(c.rate * seconds))) };
}
for (const C of [TapeWorm, LoopSoup]) {
  test(`${C.name}: bounded loop editing, stable identities and incident-route cleanup`, () => {
    const c = new C(12000); c.playing = true;
    const original = c.buffers.map((b) => b);
    while (c.loops.length < MAX_LOOPS) c.command({ type: "add-loop", seconds: 0.5, connect: C === TapeWorm });
    assert.equal(c.loops.length, 8);
    const ids = c.loops.map((l) => l.id), last = ids.at(-1);
    c.command({ type: "add-loop" }); assert.equal(c.loops.length, 8);
    c.command({ type: "move-loop", loopId: ids[0], x: 650, y: 450 });
    assert.equal(c.loops[0].x, 650); assert.equal(c.loops[0].y, 450);
    original.forEach((b, i) => assert.equal(c.buffers[i], b));
    c.command({ type: "connect", from: ids[0], to: last });
    c.command({ type: "connect", from: last, to: ids[1] });
    const unrelated = c.routes.filter((r) => r.from !== ids[1] && r.to !== ids[1]).map((r) => r.id);
    c.command({ type: "remove-loop", loopId: ids[1] });
    assert.equal(c.loops.length, 7); assert.equal(c.loops[1].id, ids[2]);
    assert.ok(c.routes.every((r) => r.from !== ids[1] && r.to !== ids[1]));
    assert.deepEqual(c.routes.map((r) => r.id), unrelated);
    c.command({ type: "add-loop" }); assert.equal(c.loops.at(-1).label, "I");
    assert.equal(c.buffers[0], original[0]); assert.equal(c.playing, true);
    run(c, 0.5);
    while (c.loops.length > 1) c.command({ type: "remove-loop", loopId: c.loops.at(-1).id });
    c.command({ type: "remove-loop", loopId: c.loops[0].id }); assert.equal(c.loops.length, 1);
    run(c, 0.2);
  });
  test(`${C.name}: route limits, duplicate handling and live parameter editing`, () => {
    const c = new C(12000);
    while (c.loops.length < 8) c.addLoop(0.25);
    for (const a of c.loops) for (const b of c.loops) c.command({ type: "connect", from: a.id, to: b.id });
    assert.equal(c.routes.length, MAX_ROUTES);
    assert.ok(c.routes.every((r) => r.from !== r.to));
    assert.equal(new Set(c.routes.map((r) => r.from + ":" + r.to)).size, MAX_ROUTES);
    const r = c.routes[0], buffer = c.buffers[0];
    c.command({ type: "route", routeId: r.id, values: { gain: 900, tone: -10, fade: 9, departure: NaN, enabled: false } });
    assert.equal(r.gain, 1); assert.equal(r.tone, 0); assert.equal(r.fade, 0.15); assert.equal(r.enabled, false);
    assert.ok(Number.isFinite(r.departure)); assert.equal(c.buffers[0], buffer);
    c.command({ type: "disconnect", routeId: r.id }); assert.equal(c.routes.length, 23);
  });
  test(`${C.name}: initial Audio handoff preserves edits, modes, audio and route settings`, () => {
    const c = new C(12000); c.addLoop(0.5);
    const id = c.loops.at(-1).id;
    c.command({ type: "move-loop", loopId: id, x: 840, y: 625 });
    c.command({ type: "loop", loopId: id, values: { paused: true, solo: true, level: 0.4, pan: -0.55 } });
    c.command({ type: "connect", from: c.loops[0].id, to: id, values: { gain: 0.3, departure: 0.22, landing: 0.34, tone: 0.5 } });
    c.command({ type: "clear", loopId: c.loops[0].id });
    const other = new C(24000); other.restore({ ...c.snapshot(), tapeData: c.buffers });
    assert.deepEqual(other.loops, c.loops);
    assert.equal(other.buffers.at(-1).length, c.buffers.at(-1).length * 2);
    assert.ok(other.buffers[0].every((x) => x === 0));
    assert.deepEqual(other.metadata().routes, c.metadata().routes);
    other.command({ type: "remove-loop", loopId: id }); run(other, 0.1);
  });
  test(`${C.name}: capture pauses, survives graph editing, and cannot land in a removed loop`, () => {
    const c = new C(12000), id = c.loops[0].id, original = c.buffers[0];
    c.command({ type: "record", loopId: id }); run(c, 0.2, 0.4);
    c.command({ type: "loop", loopId: id, values: { paused: true } });
    const count = c.recording.count; run(c, 0.2, 0.4); assert.equal(c.recording.count, count);
    c.command({ type: "add-loop" }); c.command({ type: "move-loop", loopId: id, x: 350, y: 600 });
    assert.equal(c.buffers[0], original);
    c.command({ type: "loop", loopId: id, values: { paused: false } }); run(c, 0.2, 0.4);
    c.command({ type: "finish-record" }); assert.equal(c.buffers[0].length, 4800);
    assert.equal(c.lastRecording.accepted, true);
    if (C === LoopSoup) assert.equal(c.modes[0], "hold");
    c.command({ type: "record", loopId: id }); run(c, 0.1, 0.2);
    c.command({ type: "remove-loop", loopId: id });
    const remaining = c.buffers[0];
    c.command({ type: "finish-record" }); assert.equal(c.buffers[0], remaining);
    c.command({ type: "load", loopId: id, samples: new Float32Array(2400).fill(0.5) });
    assert.equal(c.buffers[0], remaining); assert.equal(c.recording, null);
  });
}

test("Tape: independent route endpoints, crossfade, bypass and paused targets", () => {
  const c = new TapeWorm(12000); c.addLoop(1, true);
  c.routes = []; c.compile();
  c.addRoute(c.loops[0].id, c.loops[2].id, { departure: 0.25, landing: 0.4, fade: 0.1 });
  c.playing = true;
  c.advance(0.501);
  assert.equal(c.tape, 2); assert.ok(c.phase >= 0.4 && c.phase < 0.402);
  assert.equal(c.fadeLength, 1200);
  c.command({ type: "jump", index: 0, phase: 0 });
  c.command({ type: "loop", index: 2, values: { paused: true } });
  c.advance(0.7); assert.equal(c.tape, 0);
  const phase = c.phase; c.command({ type: "loop", index: 0, values: { paused: true } });
  c.advance(0.5); assert.equal(c.phase, phase);
  c.command({ type: "loop", index: 0, values: { paused: false, muted: true } });
  run(c, 1); assert.ok(run(c, 0.1).peak < 1e-7);
});

test("Soup: audio routes actually feed destinations; gain, tone, Hold, mute and solo matter", () => {
  const make = () => {
    const c = new LoopSoup(12000);
    c.routes = []; c.addRoute(c.loops[0].id, c.loops[1].id);
    c.buffers[0].fill(0.25); c.buffers[1].fill(0); c.buffers[2].fill(0);
    c.command({ type: "mode", index: 0, value: "hold" }); c.command({ type: "mode", index: 2, value: "hold" });
    c.set({ feed: 0, demo: 0, retention: 0, spill: 0.7 }); c.playing = true; return c;
  };
  const c = make(); run(c, 1.3);
  assert.ok(c.buffers[1].some((v) => v > 0.05));
  const zero = make(); zero.command({ type: "route", routeId: zero.routes[0].id, values: { gain: 0 } }); run(zero, 1.3);
  assert.ok(zero.buffers[1].every((v) => v === 0));
  const hold = make(); hold.command({ type: "mode", index: 1, value: "hold" }); run(hold, 1.3);
  assert.ok(hold.buffers[1].every((v) => v === 0));
  const muted = make(); muted.command({ type: "loop", index: 0, values: { muted: true } }); run(muted, 1.3);
  assert.ok(muted.buffers[1].every((v) => v === 0));
  const solo = make(); solo.command({ type: "loop", index: 1, values: { solo: true } }); run(solo, 1.3);
  assert.deepEqual(solo.buffers[1], c.buffers[1], "solo is monitoring only, not a routing edit");
  const bright = make(), dark = make();
  for (const core of [bright, dark]) for (let i = 0; i < core.buffers[0].length; i++) core.buffers[0][i] = i % 2 ? 0.3 : -0.3;
  dark.command({ type: "route", routeId: dark.routes[0].id, values: { tone: 0 } });
  run(bright, 1.3); run(dark, 1.3);
  assert.notDeepEqual(bright.buffers[1], dark.buffers[1]);
});

test("Soup: maximum feedback network and edits remain finite and bounded", () => {
  const c = new LoopSoup(12000);
  while (c.loops.length < 8) c.addLoop(0.25, true);
  for (const a of c.loops) for (const b of c.loops) c.addRoute(a.id, b.id);
  c.set({ retention: 1, feed: 0.9, spill: 0.7 }); c.playing = true;
  assert.ok(run(c, 3, 20).peak < 1);
  for (const buffer of c.buffers) assert.ok(buffer.every((v) => Math.abs(v) <= 0.901));
  c.command({ type: "remove-loop", index: 3 }); assert.ok(run(c, 1, -20).peak < 1);
});
