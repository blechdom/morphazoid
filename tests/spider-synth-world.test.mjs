import test from 'node:test';
import assert from 'node:assert/strict';
import { SpiderSynthWorld, normalizeSpiderWorld, SPIDER_TRAVEL_PATHS } from '../src/spider-synth-world.js';
import { createSpiderWeb, normalizeSpiderMotion, createSpiderFrame, writeSpiderPose, SPIDER_WEB_PRESETS, SPIDER_MOTION_PRESETS, SPIDER_LEG_GEOMETRY } from '../src/spider-synth-model.js';
const graph = createSpiderWeb();
const motion = normalizeSpiderMotion({ preset: 'orb-walk', intensity: .7, tempo: 108, explore: false });
const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) <= e, `${a} != ${b}`);
function sample(world, time, m = motion, web = graph, playing = true, motionTime = time, frame = createSpiderFrame()) { world.sample(time, m, web, frame, writeSpiderPose(motionTime, m), undefined, { playing, motionTime }); return frame; }

test('world normalization is bounded and unchanged updates never restart a route', () => {
  assert.equal(SPIDER_TRAVEL_PATHS.length, 7);
  const malformed = normalizeSpiderWorld({ speed: Infinity, range: 99, joystick: { x: 99, z: NaN } });
  assert.equal(malformed.speed, .65); assert.equal(malformed.range, .58); assert.deepEqual(malformed.joystick, { x: 1, z: 0 });
  const a = new SpiderSynthWorld({ path: 'orbit' }); const b = new SpiderSynthWorld({ path: 'orbit' });
  for (let i = 0; i < 30; i += 1) { sample(a, i / 20); b.update({ ...b.settings }, i / 20); sample(b, i / 20); }
  assert.deepEqual(sample(a, 3).body, sample(b, 3).body); assert.equal(b.travelHistory.length, 1);
});

test('paths and joystick use the same clock at 20 and 200 Hz with stationary stance anchors', () => {
  for (const path of SPIDER_TRAVEL_PATHS) {
    const a = new SpiderSynthWorld({ path: path.id, speed: 1.3, laySilk: true }); const b = new SpiderSynthWorld({ path: path.id, speed: 1.3, laySilk: true });
    let before = null;
    for (let tick = 0; tick <= 400; tick += 1) {
      const frame = sample(a, tick / 200);
      if (before && before.contactEpoch === frame.contactEpoch) for (let i = 0; i < 8; i += 1) if (before.feet[i].stance && frame.feet[i].stance && before.feet[i].step === frame.feet[i].step) for (const key of ['x', 'y', 'z']) near(before.feet[i][key], frame.feet[i][key]);
      before = { contactEpoch: frame.contactEpoch, feet: frame.feet.map(f => ({ ...f })) };
      if (tick % 10 === 0) sample(b, tick / 200);
    }
    assert.deepEqual(sample(a, 2).body, sample(b, 2).body);
    assert.deepEqual(a.silkSegments, b.silkSegments);
    assert.deepEqual(a.events, b.events);
    assert.ok(Math.hypot(a.point.x, a.point.z) <= .55 + 1e-10);
  }
});

test('manual travel moves supported feet and lays silk while Animation stays paused', () => {
  const world = new SpiderSynthWorld({ path: 'orbit', playing: false, laySilk: true });
  const held = normalizeSpiderMotion({ preset: 'none' });
  sample(world, 0, held, graph, false, 0);
  world.update({ joystick: { x: 1, z: .2 } }, 0);
  const first = sample(world, .01, held, graph, false, 0); const last = sample(world, 2, held, graph, false, 0);
  assert.ok(last.body.x > first.body.x + .05); assert.equal(world.settings.playing, false);
  assert.ok(last.motionActive && last.supportCount >= 4); assert.ok(last.feet.some((foot, i) => foot.step > first.feet[i].step));
  assert.ok(world.silkSegments.length > 4); assert.ok(world.state.layingSpeed > 0);
  world.update({ joystick: { x: 0, z: 0 } }, 2);
  sample(world, 4, held, graph, false, 0); assert.equal(world.state.layingSpeed, 0); assert.equal(world.state.active, false);
});

test('selected jump and dance gestures remain selected during automatic roaming', () => {
  for (const id of ['web-jump', 'rollover', 'macarena', 'pushups']) {
    const m = normalizeSpiderMotion({ preset: id, intensity: 1 }); const world = new SpiderSynthWorld({ path: 'orbit' });
    let airborne = false; let roll = 0;
    for (let tick = 0; tick < 120; tick += 1) { const frame = sample(world, tick / 20, m); assert.equal(world._frameMotion.preset, id); airborne ||= frame.airborne; roll = Math.max(roll, Math.abs(frame.body.roll)); }
    if (id === 'web-jump' || id === 'rollover') assert.ok(airborne);
    if (id === 'rollover') assert.ok(roll > Math.PI);
  }
});

test('pausing preserves the selected body, airborne state and exact planted contact phase', () => {
  for (const id of ['orb-walk', 'web-jump', 'rollover']) {
    const m = normalizeSpiderMotion({ preset: id, intensity: 1 }); const world = new SpiderSynthWorld({ path: 'orbit' });
    const time = id === 'orb-walk' ? 1.217 : id === 'web-jump' ? 1.79 : 3.55;
    sample(world, 0, m); const before = sample(world, time, m);
    world.update({ playing: false }, time);
    const paused = sample(world, time + .5, m, graph, false, time);
    assert.equal(paused.airborne, before.airborne); assert.equal(paused.motionActive, false);
    for (const key of ['x', 'y', 'z', 'pitch', 'yaw', 'roll']) near(paused.body[key], before.body[key]);
    for (let i = 0; i < 8; i += 1) { assert.equal(paused.feet[i].stance, before.feet[i].stance); assert.equal(paused.feet[i].step, before.feet[i].step); for (const key of ['x', 'y', 'z']) near(paused.feet[i][key], before.feet[i][key]); }
  }
});

test('finite prey phases settle, hunt only eats by actual proximity, and event IDs are owned', () => {
  const a = new SpiderSynthWorld({ playing: false }); const b = new SpiderSynthWorld({ playing: false });
  sample(a, 0, motion, graph, false, 0); sample(b, 0, motion, graph, false, 0);
  a.command({ type: 'send-prey' }, 0); b.command({ type: 'send-prey' }, 0);
  for (let i = 0; i <= 2200; i += 1) { sample(a, i / 200, motion, graph, false, 0); if (i % 10 === 0) sample(b, i / 200, motion, graph, false, 0); }
  assert.equal(a.prey[0].state, 'trapped'); assert.equal(a.state.preyStruggle, 0); assert.equal(a.state.active, false);
  assert.deepEqual(a.events, b.events); assert.deepEqual(a.prey, b.prey);
  a.command({ type: 'hunt', id: a.prey[0].id }, 11);
  for (let i = 0; i < 320; i += 1) sample(a, 11 + i / 20, motion, graph, false, 0);
  assert.equal(a.prey[0].state, 'eaten'); assert.ok(Math.hypot(a.point.x - a.prey[0].targetX, a.point.z - a.prey[0].targetZ) < .04);
  const serial = a.nextEventId; a.command({ type: 'reset' }, 28); a.command({ type: 'send-prey' }, 28); sample(a, 30, motion, graph, false, 0);
  assert.ok(a.events.every(event => event.serial >= serial));
});

test('snapshot clock rebase preserves manual travel, strand identities and future cadence', () => {
  const a = new SpiderSynthWorld({ playing: false, joystick: { x: .8, z: -.4 }, laySilk: true });
  for (let i = 0; i <= 400; i += 1) sample(a, i / 200, motion, graph, false, .2);
  const b = new SpiderSynthWorld().restore(a.snapshot(), 100.031);
  const af = sample(a, 2.5, motion, graph, false, .2); const bf = sample(b, 102.531, motion, graph, false, .2);
  for (const key of ['x', 'y', 'z']) near(af.body[key], bf.body[key]);
  for (let i = 0; i < 8; i += 1) { assert.equal(af.feet[i].step, bf.feet[i].step); for (const key of ['x', 'y', 'z']) near(af.feet[i][key], bf.feet[i][key]); }
  assert.deepEqual(a.silkSegments.map(s => s.id), b.silkSegments.map(s => s.id));
  for (let i = 0; i < a.silkSegments.length; i += 1) near(a.silkSegments[i].bx, b.silkSegments[i].bx);
});

test('construction changes invalidate prey and deposited strand identities, home only moves home', () => {
  const world = new SpiderSynthWorld({ joystick: { x: 1, z: 0 }, laySilk: true });
  sample(world, 0); world.command({ type: 'send-prey' }, 0); sample(world, 2);
  assert.ok(world.silkSegments.length && world.prey.length);
  world.command({ type: 'home' }, 2); assert.ok(world.silkSegments.length && world.prey.length);
  sample(world, 2.1, motion, createSpiderWeb({ preset: 'dome' }));
  assert.equal(world.prey.length, 0); assert.equal(world.silkSegments.length, 0); assert.equal(world.events.length, 0);
  assert.ok(world.state.graphVersion > 1);
});

test('long-running silk and prey remain bounded and laid strands can be explicitly plucked', () => {
  const world = new SpiderSynthWorld({ path: 'figure8', laySilk: true, speed: 2 });
  sample(world, 0);
  for (let i = 1; i <= 400; i += 1) { if (i % 20 === 0) world.command({ type: 'send-prey' }, i); sample(world, i); }
  assert.ok(world.silkSegments.length <= 256); assert.ok(world.prey.length <= 8); assert.ok(world.events.length <= 64); assert.ok(world.travelHistory.length <= 128);
  assert.equal(new Set(world.silkSegments.map(s => s.id)).size, world.silkSegments.length);
  const strand = world.silkSegments[0]; world.command({ type: 'pluck-silk', silkId: strand.id, velocity: .7, u: .2 }, 400);
  const event = world.events.at(-1); assert.equal(event.type, 'silk-pluck'); assert.equal(event.id, strand.id); assert.equal(event.length, strand.length); assert.equal(event.strength, .7);
});
