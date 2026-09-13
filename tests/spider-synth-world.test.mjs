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
  assert.equal(malformed.speed, .65); assert.equal(malformed.range, .85); assert.deepEqual(malformed.joystick, { x: 1, z: 0 });
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

test('tempo scales the complete stride path while distinct movement profiles span stalking to sprinting', () => {
  const endpoints = [];
  for (const tempo of [60, 120, 300]) {
    const m = normalizeSpiderMotion({ preset: 'low-sprint', tempo, intensity: 1, explore: false });
    const world = new SpiderSynthWorld({ path: 'radial', speed: 2, range: .85 }); let frame;
    for (let tick = 0; tick <= 800; tick += 1) frame = sample(world, tick / 200 * 120 / tempo, m);
    endpoints.push(frame);
  }
  for (let i = 1; i < endpoints.length; i += 1) { for (const key of ['x', 'y', 'z', 'yaw']) near(endpoints[0].body[key], endpoints[i].body[key], 1e-8); for (let leg = 0; leg < 8; leg += 1) near(endpoints[0].feet[leg].x, endpoints[i].feet[leg].x, 1e-8); }
  const speeds = {};
  for (const preset of ['slow-stalk', 'orb-walk', 'low-sprint']) {
    const m = normalizeSpiderMotion({ preset, tempo: 300, intensity: 1, explore: false }); const world = new SpiderSynthWorld({ path: 'hold', joystick: { x: 0, z: 1 }, speed: 2 });
    let distance = 0, z = 0;
    for (let i = 0; i <= 200; i += 1) { const f = sample(world, i / 200, m); distance += Math.abs(f.body.z - z); z = f.body.z; }
    speeds[preset] = distance;
  }
  assert.ok(speeds['low-sprint'] > speeds['orb-walk'] * 2); assert.ok(speeds['orb-walk'] > speeds['slow-stalk'] * 2); assert.ok(speeds['low-sprint'] > .65);
});

test('fast travel respects all eight physical chains and actual walking strands across every construction', () => {
  for (const preset of SPIDER_WEB_PRESETS) {
    const web = createSpiderWeb(preset.settings); const m = normalizeSpiderMotion({ preset: 'low-sprint', tempo: 300, intensity: 1, explore: false });
    const world = new SpiderSynthWorld({ path: 'hold', speed: 2, range: .85, joystick: { x: 0, z: 1 } });
    let previous;
    for (let tick = 0; tick <= 400; tick += 1) {
      const time = tick / 200;
      if (tick === 150) world.update({ joystick: { x: 1, z: 0 } }, time);
      if (tick === 300) world.update({ joystick: { x: -1, z: -1 } }, time);
      const f = sample(world, time, m, web); assert.ok(f.supportCount >= 4); assert.ok(Math.hypot(f.body.x, f.body.z) <= .78 + 1e-8);
      const c = Math.cos(f.body.yaw), s = Math.sin(f.body.yaw);
      for (let leg = 0; leg < 8; leg += 1) {
        const foot = f.feet[leg], g = SPIDER_LEG_GEOMETRY[leg];
        const reach = Math.hypot(foot.x - f.body.x - g.hip[0] * c - g.hip[2] * s, foot.y - f.body.y - g.hip[1], foot.z - f.body.z - g.hip[2] * c + g.hip[0] * s);
        assert.ok(reach < g.reach * .95, `${preset.id}/${time}/${leg}: ${reach / g.reach}`);
        if (foot.stance) {
          const segment = web.segments[foot.segmentId]; assert.ok(segment && segment.walkable !== false);
          for (const axis of ['x', 'y', 'z']) near(foot[axis], web.nodes[segment.a][axis] + (web.nodes[segment.b][axis] - web.nodes[segment.a][axis]) * foot.u);
          const prior = previous?.feet[leg]; if (prior?.stance && prior.step === foot.step) for (const axis of ['x', 'y', 'z']) near(foot[axis], prior[axis]);
        }
      }
      previous = f;
    }
  }
});

test('projected stride ledger uses the exact visible contact and departing strand, including held overlays', () => {
  for (const preset of ['orb-walk', 'low-sprint', 'wave-walk']) {
    const m = normalizeSpiderMotion({ preset, tempo: 240, intensity: 1, explore: false, offsets: { leg_left_1_hip: { x: .5, y: .6, z: .4 } } });
    const midi = new Float32Array(114).fill(.7, 18); const world = new SpiderSynthWorld({ path: 'radial', speed: 1.5 });
    const frame = createSpiderFrame(); world.sample(0, m, graph, frame, writeSpiderPose(0, m), midi, { playing: true, motionTime: 0 });
    const snapshot = world.snapshot(), events = world.state.footEvents.map(e => ({ ...e })); assert.ok(events.some(e => e.kind === 'contact'));
    for (const event of events) {
      const check = new SpiderSynthWorld().restore(snapshot); const at = event.time + (event.kind === 'release' ? -1e-7 : 1e-7); const f = createSpiderFrame();
      check.sample(at, m, graph, f, writeSpiderPose(at, m), midi, { playing: true, motionTime: at });
      const foot = f.feet[event.legIndex]; assert.equal(foot.stance, true, `${preset}/${event.kind}`); assert.equal(event.segmentId, foot.segmentId); near(event.u, foot.u, 1e-8);
      if (event.kind === 'pull') assert.ok(foot.pull > 0);
    }
  }
});

test('event forecast and serial identity do not depend on 20 versus 200 Hz sampling', () => {
  const m = normalizeSpiderMotion({ preset: 'low-sprint', tempo: 300, intensity: 1, explore: false });
  const collect = hz => {
    const world = new SpiderSynthWorld({ path: 'radial', speed: 2 }); const map = new Map();
    for (let i = 0; i <= hz * 2; i += 1) { sample(world, i / hz, m); for (const event of world.state.footEvents) map.set(event.serial, { ...event }); }
    return [...map.values()];
  };
  const a = collect(20), b = collect(200); assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i += 1) { assert.equal(a[i].serial, b[i].serial); assert.equal(a[i].kind, b[i].kind); assert.equal(a[i].segmentId, b[i].segmentId); near(a[i].time, b[i].time); near(a[i].u, b[i].u); }
});

test('stationary forecasts cancel on pause, tempo, and pose edits even without travel', () => {
  const world = new SpiderSynthWorld({ path: 'hold' }); const m = normalizeSpiderMotion({ preset: 'silk-harp', tempo: 120, intensity: 1, explore: false });
  sample(world, 0, m); const epoch = world.state.contactEpoch; assert.ok(world.state.footEvents.length);
  sample(world, .1, m, graph, false, .1); assert.ok(world.state.contactEpoch > epoch); assert.equal(world.state.footEvents.length, 0);
  sample(world, .2, m, graph, true, .1); const resumed = world.state.contactEpoch; assert.ok(world.state.footEvents.every(e => e.time >= .2));
  const faster = normalizeSpiderMotion({ ...m, tempo: 240 }); sample(world, .3, faster, graph, true, .1); assert.ok(world.state.contactEpoch > resumed);
  const edited = normalizeSpiderMotion({ ...faster, offsets: { leg_left_1_hip: { x: .4 } } }); const oldEpoch = world.state.contactEpoch;
  sample(world, .31, edited, graph, true, .11); assert.ok(world.state.contactEpoch > oldEpoch);
});

test('paused direct movement owns finite pull events and a held pose never retriggers them', () => {
  const world = new SpiderSynthWorld({ playing: false }); const m = normalizeSpiderMotion({ preset: 'none' }); sample(world, 0, m, graph, false, 0);
  const edited = normalizeSpiderMotion({ ...m, offsets: { leg_left_1_hip: { x: .5, y: .3, z: .4 } } });
  const f = sample(world, .05, edited, graph, false, 0); const serial = world._nextFootSerial;
  assert.ok(world.state.footEvents.some(e => e.kind === 'pull' && e.legIndex === 0)); assert.equal(f.motionActive, true);
  for (let i = 1; i < 30; i += 1) sample(world, .05 + i / 20, edited, graph, false, 0);
  assert.equal(world._nextFootSerial, serial); assert.equal(world.state.active, false);
});

test('zero Movement disables automatic travel while independent manual steering still works', () => {
  const m = normalizeSpiderMotion({ preset: 'low-sprint', tempo: 300, intensity: 0, explore: false }); const w = new SpiderSynthWorld({ path: 'orbit', speed: 2 });
  const before = sample(w, 0, m); const after = sample(w, 1, m); assert.deepEqual(before.body, after.body); assert.equal(w.state.footEvents.length, 0);
  w.update({ joystick: { x: 0, z: 1 } }, 1); const steered = sample(w, 1.5, m); assert.ok(steered.body.z > .1); assert.ok(w.state.footEvents.some(e => e.kind === 'contact'));
});

test('outer-web snapshots retain route targets, projected events and exact clock rebasing', () => {
  const m = normalizeSpiderMotion({ preset: 'low-sprint', tempo: 300, intensity: 1, explore: false }); const a = new SpiderSynthWorld({ speed: 2, playing: false });
  sample(a, 0, m, graph, false, .1); a.command({ type: 'move', x: .76, z: 0 }, 0);
  for (let i = 0; i <= 140; i += 1) sample(a, i / 200, m, graph, false, .1);
  const snap = a.snapshot(); const b = new SpiderSynthWorld().restore(snap, 10.123); near(b.travelHistory.at(-1).target.x, .76);
  const af = sample(a, .8, m, graph, false, .1), bf = sample(b, 10.923, m, graph, false, .1);
  for (const axis of ['x', 'y', 'z']) near(af.body[axis], bf.body[axis]);
  assert.equal(a.state.footEvents.length, b.state.footEvents.length); for (let i = 0; i < a.state.footEvents.length; i += 1) { near(a.state.footEvents[i].time + 10.123, b.state.footEvents[i].time); assert.equal(a.state.footEvents[i].serial, b.state.footEvents[i].serial); }
});

test('silk emerges behind the heading and Home uses the actual eccentric hub', () => {
  const world = new SpiderSynthWorld({ path: 'hold', joystick: { x: 1, z: 0 }, speed: 2, laySilk: true });
  const m = normalizeSpiderMotion({ preset: 'low-sprint', tempo: 200, intensity: 1, explore: false });
  for (let i = 0; i <= 80; i += 1) sample(world, i / 200, m);
  sample(world, .407, m);
  const silk = world.state.activeSilk; assert.ok(silk); near(silk.bx, world.point.x - Math.sin(world.point.yaw) * .095); near(silk.bz, world.point.z - Math.cos(world.point.yaw) * .095);
  for (const segment of world.silkSegments) { const p = {}; world.writeTravel(segment.born, p); near(segment.bx, p.x - Math.sin(p.yaw) * .095); near(segment.bz, p.z - Math.cos(p.yaw) * .095); }
  world.command({ type: 'home' }, .407); const hub = graph.nodes.find(node => node.role === 'hub'); const home = sample(world, .407, normalizeSpiderMotion({ preset: 'none' }), graph, false, 0); near(home.body.x, hub.x); near(home.body.z, hub.z);
});

test('switching from travel to a stationary routine performs that routine at the reached location', () => {
  const w = new SpiderSynthWorld({ path: 'radial', speed: 2 }); const walk = normalizeSpiderMotion({ preset: 'radial-run', tempo: 160, intensity: 1, explore: false });
  for (let i = 0; i <= 80; i += 1) sample(w, i / 200, walk);
  const before = sample(w, .4, walk); w.update({ path: 'hold' }, .4);
  const dance = normalizeSpiderMotion({ ...walk, preset: 'macarena' }); const after = sample(w, .4, dance);
  near(before.body.x, after.body.x); near(before.body.z, after.body.z); assert.equal(w._plannerEnabled, false);
  const later = sample(w, .8, dance); assert.notDeepEqual(after.pose, later.pose); assert.notDeepEqual(after.feet, later.feet); near(after.body.x, later.body.x);
});

test('a paused accepted center or heading edit owns pulls but a fixed center stays silent', () => {
  const w = new SpiderSynthWorld({ playing: false }); const m = normalizeSpiderMotion({ preset: 'listen', explore: false }); sample(w, 0, m, graph, false, 0);
  const next = normalizeSpiderMotion({ ...m, center: { x: .2, z: .1 } }); sample(w, .1, next, graph, false, 0);
  assert.ok(w.state.footEvents.some(e => e.kind === 'pull')); const serial = w._nextFootSerial;
  sample(w, .2, next, graph, false, 0); assert.equal(w._nextFootSerial, serial);
});

test('manual steering can leave a web edge through a supported backstep without Home', () => {
  for (const next of [{ x: 0, z: -1 }, { x: 0, z: 1 }, { x: 1, z: 0 }]) {
    const world = new SpiderSynthWorld({ playing: false, speed: .75 });
    const m = normalizeSpiderMotion({ preset: 'low-sprint', tempo: 300, intensity: .65, explore: false });
    sample(world, 0, m, graph, false, 11.464); world.command({ type: 'home' }, 0); world.update({ joystick: { x: -1, z: 0 } }, 0);
    let reached, last, outerToe;
    for (let i = 0; i <= 520; i += 1) {
      const t = i / 200;
      if (i === 260) { reached = { ...last.body }; outerToe = Math.min(...last.feet.filter(foot => foot.stance).map(foot => foot.x)); world.update({ joystick: next }, t); }
      const f = sample(world, t, m, graph, false, 11.464); assert.ok(f.supportCount >= 4);
      const c = Math.cos(f.body.yaw), s = Math.sin(f.body.yaw);
      for (let j = 0; j < 8; j += 1) {
        const foot = f.feet[j], g = SPIDER_LEG_GEOMETRY[j];
        const reach = Math.hypot(foot.x - f.body.x - g.hip[0] * c - g.hip[2] * s, foot.y - f.body.y - g.hip[1], foot.z - f.body.z - g.hip[2] * c + g.hip[0] * s);
        assert.ok(reach < g.reach && reach > g.innerReach);
        if (foot.stance && last?.feet[j].stance && foot.step === last.feet[j].step) for (const axis of ['x', 'y', 'z']) near(foot[axis], last.feet[j][axis]);
      }
      last = f;
    }
    // The long first foreleg links now stay outside the face. The body must
    // stop before the old x=-.6 fixture (which folded those links through a
    // palp); an outer supported toe still reaches the last capture mesh cell.
    const edge = Math.min(...graph.nodes.filter(node => node.role === 'capture-junction').map(node => node.x));
    const captureLengths = graph.segments.filter(segment => segment.stage === 'capture').map(segment => segment.length).sort((a, b) => a - b);
    const meshSpan = captureLengths[Math.floor(captureLengths.length / 2)];
    assert.ok(outerToe <= edge + meshSpan); assert.ok(reached.x < 0);
    assert.ok(Math.hypot(last.body.x - reached.x, last.body.z - reached.z) > .5);
    assert.equal(world.settings.playing, false); assert.ok(Math.abs(last.body.yaw - reached.yaw) > .5);
  }
});

test('direct-control pulls are explicitly distinguished from propulsion through forecast and snapshot reuse', () => {
  const world = new SpiderSynthWorld({ path: 'radial', speed: 2 });
  const motion = normalizeSpiderMotion({ preset: 'orb-walk', tempo: 120, intensity: 1, explore: false });
  sample(world, 0, motion);
  const edited = normalizeSpiderMotion({ ...motion, offsets: { leg_left_1_hip: { x: .4, y: .3 } } });
  sample(world, .01, edited);
  const manual = world.state.footEvents.filter(e => e.manual);
  const physical = world.state.footEvents.filter(e => !e.manual);
  assert.ok(manual.length > 0); assert.ok(manual.every(e => e.kind === 'pull' && e.legIndex === 0 && e.time === .01));
  assert.ok(physical.some(e => e.kind === 'pull')); assert.ok(physical.some(e => e.kind === 'contact'));
  assert.ok(physical.every(e => e.manual === false));
  const snapshot = world.snapshot(), restored = new SpiderSynthWorld().restore(snapshot, 12);
  assert.deepEqual(restored.state.footEvents.map(e => e.manual), world.state.footEvents.map(e => e.manual));
  for (const event of snapshot.locomotion.footEvents) delete event.manual;
  restored.restore(snapshot);
  assert.ok(restored.state.footEvents.every(e => e.manual === false), 'Old snapshots must not retain flags from recycled pooled records');
});

test('planning boundaries are distinct from audible onsets and commit fast releases before their sample deadline', () => {
  const m = normalizeSpiderMotion({ preset: 'low-sprint', tempo: 300, intensity: 1, explore: false });
  const world = new SpiderSynthWorld({ path: 'radial', speed: 2 }); sample(world, 0, m);
  near(world.state.nextFootPlanTime, .04);
  assert.ok(world.state.nextFootEventTime < world.state.nextFootPlanTime);
  const firstPlan = world.state.nextFootPlanTime;
  const firstContact = world.state.footEvents.find(e => e.kind === 'contact').time;
  sample(world, firstContact - 1 / 48000, m);
  near(world.state.nextFootPlanTime, firstPlan);
  sample(world, firstPlan + 1e-10, m);
  near(world.state.nextFootPlanTime, .08);
  const release = world.state.footEvents.find(e => e.kind === 'release' && e.time > firstPlan);
  assert.ok(release); near(release.time - firstPlan, .0048);
  assert.ok(release.time < firstPlan + .005, 'The next 200 Hz poll would be too late');
  assert.ok(world.state.nextFootEventTime <= release.time);
  const still = new SpiderSynthWorld({ path: 'hold' }); const harp = normalizeSpiderMotion({ preset: 'silk-harp', tempo: 300, intensity: 1 });
  sample(still, 0, harp); near(still.state.nextFootPlanTime, .8);
  sample(still, .8 + 1e-10, harp); near(still.state.nextFootPlanTime, 1.6);
  sample(still, 1, harp, graph, false, .8); assert.equal(still.state.nextFootPlanTime, Infinity); assert.equal(still.state.nextFootEventTime, Infinity);
});
