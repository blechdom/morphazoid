import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SPIDER_JOINTS, SPIDER_LEG_GEOMETRY, SPIDER_MOTION_DEFAULTS, SPIDER_MOTION_PRESETS, SPIDER_STATIC_POSES,
  normalizeSpiderMotion, createRandomSpiderMotion, createSpiderStaticPose, createSpiderWeb,
  projectSpiderWebPoint, createSpiderFrame, writeSpiderPose, writeSpiderFrame,
  constrainSpiderPose, spiderStringFrequency, applySpiderSpeechPose,
} from '../src/spider-synth-model.js';

const close = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const web = createSpiderWeb();

test('38 stable rig identities and measured asymmetric chains preserve the short third legs', () => {
  assert.equal(SPIDER_JOINTS.length, 38);
  assert.equal(new Set(SPIDER_JOINTS.map(joint => joint.id)).size, 38);
  assert.deepEqual(SPIDER_JOINTS.slice(0, 6).map(joint => joint.id), ['cephalothorax', 'abdomen', 'pedipalp_left', 'pedipalp_right', 'chelicera_left', 'chelicera_right']);
  for (const joint of SPIDER_JOINTS) { assert.equal(joint.id, joint.jointId); assert.ok(joint.name && joint.groupId); }
  for (let leg = 0; leg < 8; leg += 1) {
    assert.equal(SPIDER_JOINTS[6 + leg * 4].id, `${SPIDER_LEG_GEOMETRY[leg].id}_hip`);
    close(SPIDER_LEG_GEOMETRY[leg].reach, SPIDER_LEG_GEOMETRY[leg].lengths.reduce((a, b) => a + b));
    assert.ok(SPIDER_LEG_GEOMETRY[leg].reach > .26 && SPIDER_LEG_GEOMETRY[leg].reach < .47);
  }
  assert.ok(SPIDER_LEG_GEOMETRY[2].reach < .29 && SPIDER_LEG_GEOMETRY[6].reach < .29);
});

test('preset definitions are deeply immutable and retain 24 original routines and add 16 bounded nonflying routines', () => {
  assert.equal(SPIDER_MOTION_PRESETS.length, 40);
  assert.equal(new Set(SPIDER_MOTION_PRESETS.map(item => item.id)).size, 40);
  assert.ok(SPIDER_MOTION_PRESETS.every(item => !/fly|flight/.test(item.mode)));
  assert.throws(() => { SPIDER_MOTION_PRESETS[0].period = 999; }, TypeError);
  assert.throws(() => { SPIDER_MOTION_DEFAULTS.center.x = 1; }, TypeError);
  assert.throws(() => { SPIDER_LEG_GEOMETRY[0].lengths[0] = 1; }, TypeError);
});

test('normalization bounds malformed settings and clones only known pose offsets', () => {
  const motion = normalizeSpiderMotion({ tempo: Infinity, intensity: -5, preset: 'missing', seed: -1, center: { x: 999, z: NaN }, yaw: 999, offsets: { unknown: { x: 9 }, abdomen: { x: 8, y: NaN, z: -.3 } } });
  assert.equal(motion.preset, SPIDER_MOTION_DEFAULTS.preset);
  assert.equal(motion.tempo, 108); assert.equal(motion.intensity, 0);
  assert.deepEqual(motion.center, { x: .42, z: 0 }); assert.equal(motion.yaw, Math.PI);
  assert.deepEqual(motion.offsets, { abdomen: { x: .4, y: 0, z: -.3 } });
  assert.equal(normalizeSpiderMotion({ preset: 'none' }).preset, 'none');
});

test('web graph is connected, deterministic, finite and bounded at topology extremes', () => {
  for (const options of [{}, { spokes: 8, rings: 3 }, { spokes: 999, rings: 999, tension: 999, seed: 42 }]) {
    const graph = createSpiderWeb(options);
    assert.deepEqual(graph, createSpiderWeb(options));
    assert.ok(graph.nodes.length <= 1200); assert.ok(graph.segments.length <= 2400);
    const visited = new Set([0]);
    for (let pass = 0; pass < graph.nodes.length; pass += 1) for (const s of graph.segments) {
      assert.equal(s.id, graph.segments.indexOf(s)); assert.ok(s.length > 0 && Number.isFinite(s.angle));
      if (visited.has(s.a) || visited.has(s.b)) { visited.add(s.a); visited.add(s.b); }
    }
    assert.equal(visited.size, graph.nodes.length);
    for (const node of graph.nodes) { assert.equal(node.y, 0); assert.ok(Math.abs(node.x) < 1.5 && Math.abs(node.z) < 1.5); }
  }
  assert.notDeepEqual(createSpiderWeb({ seed: 1 }), createSpiderWeb({ seed: 2 }));
});

test('nearest web projection lies exactly on its finite segment and chooses the closest distance', () => {
  for (const [x, z] of [[0, 0], [.213, -.151], [.7, .9], [20, -40]]) {
    const point = projectSpiderWebPoint(web, x, z); const s = web.segments[point.segmentId]; const a = web.nodes[s.a]; const b = web.nodes[s.b];
    assert.ok(point.u >= 0 && point.u <= 1); assert.equal(point.y, 0);
    close(point.x, a.x + (b.x - a.x) * point.u); close(point.z, a.z + (b.z - a.z) * point.u);
    close(point.distance, Math.hypot(point.x - x, point.z - z));
    for (const other of web.segments) { const start = web.nodes[other.a]; const end = web.nodes[other.b]; const dx = end.x - start.x; const dz = end.z - start.z; const u = Math.max(0, Math.min(1, ((x - start.x) * dx + (z - start.z) * dz) / (dx * dx + dz * dz))); assert.ok(point.distance <= Math.hypot(x - start.x - dx * u, z - start.z - dz * u) + 1e-10); }
  }
});

test('string mode follows inverse substring length and square-root tension with bounded extremes', () => {
  close(spiderStringFrequency(.2), 2 * spiderStringFrequency(.4));
  close(spiderStringFrequency(.4, 4), 2 * spiderStringFrequency(.4, 1));
  close(spiderStringFrequency(.4, 1, .25), 2 * spiderStringFrequency(.4, 1, .5));
  close(spiderStringFrequency(.4, 1, .25), spiderStringFrequency(.4, 1, .75));
  for (const length of [NaN, -4, 0, .001, 1e8]) for (const tension of [-9, Infinity, 0, 50]) for (const u of [-9, 0, .5, 1, 50]) { const hz = spiderStringFrequency(length, tension, u); assert.ok(hz >= 45 && hz <= 6000); }
});

test('all 24 routines have exact silk support, bounded reachable toes and finite poses across extremes', () => {
  const frame = createSpiderFrame();
  for (const preset of SPIDER_MOTION_PRESETS.slice(0, 24)) for (const tempo of [20, 300]) for (const intensity of [0, .65, 1]) for (const explore of [false, true]) {
    const motion = normalizeSpiderMotion({ preset: preset.id, tempo, intensity, explore, center: { x: .42, z: .42 } });
    for (let tick = 0; tick < 96; tick += 1) {
      writeSpiderFrame((tick + .173) * .25 * 60 / tempo, motion, web, frame);
      assert.ok(frame.supportCount >= 4, `${preset.id}: supports ${frame.supportCount}`);
      for (const value of frame.pose) assert.ok(Number.isFinite(value) && Math.abs(value) <= .75);
      for (let index = 0; index < 8; index += 1) {
        const foot = frame.feet[index]; const s = web.segments[foot.segmentId];
        assert.ok(s, `${preset.id}: missing contact segment`); assert.ok(Number.isInteger(foot.step));
        for (const key of ['x', 'y', 'z', 'u', 'impact', 'speed', 'angle']) assert.ok(Number.isFinite(foot[key]), `${preset.id}: ${key}`);
        if (foot.stance) { assert.equal(foot.y, 0); close(foot.x, web.nodes[s.a].x + (web.nodes[s.b].x - web.nodes[s.a].x) * foot.u); close(foot.z, web.nodes[s.a].z + (web.nodes[s.b].z - web.nodes[s.a].z) * foot.u); }
        else assert.ok(foot.y > 0);
        const leg = SPIDER_LEG_GEOMETRY[index]; const c = Math.cos(frame.body.yaw); const sn = Math.sin(frame.body.yaw);
        const hx = frame.body.x + leg.hip[0] * c + leg.hip[2] * sn; const hz = frame.body.z + leg.hip[2] * c - leg.hip[0] * sn;
        const distance = Math.hypot(foot.x - hx, foot.y - frame.body.y - leg.hip[1], foot.z - hz);
        assert.ok(distance < leg.reach * .98, `${preset.id} leg ${index}: reach ${distance}/${leg.reach}`);
        assert.ok(Math.abs(foot.x) < 1.5 && Math.abs(foot.z) < 1.5);
      }
    }
  }
});

test('stance anchors do not slide with animation, including constant manual joint offsets', () => {
  const frame = createSpiderFrame();
  for (const preset of SPIDER_MOTION_PRESETS.slice(0, 24)) {
    const motion = normalizeSpiderMotion({ preset: preset.id, offsets: { leg_left_3_knee: { x: .2, y: -.1, z: .1 } } });
    const previous = Array.from({ length: 8 }, () => null);
    for (let tick = 0; tick < 240; tick += 1) {
      writeSpiderFrame(tick / 30, motion, web, frame);
      for (let leg = 0; leg < 8; leg += 1) {
        const foot = frame.feet[leg]; const before = previous[leg];
        if (before?.stance && foot.stance && before.step === foot.step) { close(foot.x, before.x, 5e-9); close(foot.z, before.z, 5e-9); }
        previous[leg] = { ...foot };
      }
    }
  }
});

test('landing serials, lift and projection remain continuous at actual tempo-grid touchdown', () => {
  const before = createSpiderFrame(); const after = createSpiderFrame();
  for (const item of SPIDER_MOTION_PRESETS.slice(0, 24)) if (item.mask && item.duty < 1) {
    const motion = normalizeSpiderMotion({ preset: item.id, tempo: 120 });
    for (let index = 0; index < 8; index += 1) if (item.mask & (1 << index)) {
      const offset = item.gait === 'ripple' ? index % 4 / 4 : ((index < 4 ? index : index + 1) & 1) * .5;
      const landingBeat = (3 - offset) * item.period; const time = landingBeat / 2;
      writeSpiderFrame(time - 1e-6, motion, web, before); writeSpiderFrame(time + 1e-6, motion, web, after);
      assert.equal(before.feet[index].stance, false); assert.equal(after.feet[index].stance, true);
      assert.equal(after.feet[index].step, before.feet[index].step + 1);
      assert.ok(Math.hypot(before.feet[index].x - after.feet[index].x, before.feet[index].z - after.feet[index].z) < 1e-5);
      assert.ok(before.feet[index].y < 1e-5 && after.feet[index].y === 0);
      assert.ok(after.feet[index].impact > 0);
    }
  }
});

test('contact crossing angle follows toe travel and is distinct from the strand tangent', () => {
  const frame = createSpiderFrame(); let crosswise = 0;
  for (const preset of ['orb-walk', 'cross-pluck', 'radial-run', 'silk-harp']) {
    const motion = normalizeSpiderMotion({ preset });
    for (let tick = 0; tick < 16; tick += 1) {
      writeSpiderFrame(tick / 3, motion, web, frame);
      for (const foot of frame.feet) if (foot.impact > 0 && Math.abs(Math.sin(foot.angle - web.segments[foot.segmentId].angle)) > .1) crosswise += 1;
    }
  }
  assert.ok(crosswise > 24, `Only ${crosswise} distinct crossing directions`);
});

test('coarse and dense webs retain reachable support under seeded manual postures', () => {
  const frame = createSpiderFrame();
  for (const graph of [createSpiderWeb({ spokes: 8, rings: 3 }), createSpiderWeb({ spokes: 24, rings: 16 })]) for (let seed = 0; seed < 24; seed += 1) {
    const motion = createRandomSpiderMotion(seed, { intensity: 1, center: { x: -.42, z: .42 }, tempo: 300 }); motion.preset = SPIDER_MOTION_PRESETS[seed].id;
    for (let tick = 0; tick < 48; tick += 1) {
      writeSpiderFrame(tick * .131, motion, graph, frame);
      assert.ok(frame.supportCount >= 4);
      for (let index = 0; index < 8; index += 1) {
        const foot = frame.feet[index]; const leg = SPIDER_LEG_GEOMETRY[index]; const c = Math.cos(frame.body.yaw); const s = Math.sin(frame.body.yaw);
        const hx = frame.body.x + leg.hip[0] * c + leg.hip[2] * s; const hz = frame.body.z + leg.hip[2] * c - leg.hip[0] * s;
        assert.ok(graph.segments[foot.segmentId]);
        assert.ok(Math.hypot(foot.x - hx, foot.y - frame.body.y - leg.hip[1], foot.z - hz) < leg.reach * .98);
      }
    }
  }
});

test('direct time sampling matches dense or interrupted rendering exactly and reuses frame storage', () => {
  const dense = createSpiderFrame(); const direct = createSpiderFrame(); const feet = dense.feet; const pose = dense.pose; const body = dense.body;
  const motion = createRandomSpiderMotion(97);
  for (let tick = 0; tick < 1000; tick += 1) writeSpiderFrame(tick / 200, motion, web, dense);
  writeSpiderFrame(999 / 200, motion, web, direct); assert.deepEqual(dense, direct);
  assert.equal(dense.feet, feet); assert.equal(dense.pose, pose); assert.equal(dense.body, body);
  writeSpiderFrame(400, motion, web, dense); writeSpiderFrame(.173, motion, web, dense); writeSpiderFrame(.173, motion, web, direct); assert.deepEqual(dense, direct);
});

test('zero intensity and manual mode have no generated contact events or incidental joint animation', () => {
  const frame = createSpiderFrame();
  for (const motion of [normalizeSpiderMotion({ intensity: 0 }), normalizeSpiderMotion({ preset: 'none' })]) {
    writeSpiderFrame(900, motion, web, frame);
    assert.equal(frame.supportCount, 8); assert.ok(frame.feet.every(foot => foot.step === 0 && foot.impact === 0 && foot.speed === 0));
    assert.ok(frame.pose.every(value => value === 0));
  }
});

test('all XYZ axes of every leg joint move only that leg contact at a frozen clock', () => {
  const motion = normalizeSpiderMotion({ preset: 'none' }); const baseline = createSpiderFrame(); const frame = createSpiderFrame(); const pose = new Float32Array(114);
  writeSpiderFrame(0, motion, web, baseline);
  for (let joint = 6; joint < 38; joint += 1) for (let axis = 0; axis < 3; axis += 1) {
    pose.fill(0); pose[joint * 3 + axis] = .3; writeSpiderFrame(0, motion, web, frame, pose);
    const leg = Math.floor((joint - 6) / 4); assert.ok(Math.hypot(frame.feet[leg].x - baseline.feet[leg].x, frame.feet[leg].z - baseline.feet[leg].z) > 1e-5, `${SPIDER_JOINTS[joint].id} ${axis}`);
    for (let other = 0; other < 8; other += 1) if (other !== leg) assert.deepEqual(frame.feet[other], baseline.feet[other]);
    assert.equal(frame.feet[leg].step, 0); assert.equal(frame.feet[leg].stance, true);
  }
});

test('body pose rocks the fused front body while all web support anchors stay fixed', () => {
  const motion = normalizeSpiderMotion({ preset: 'none' }); const baseline = createSpiderFrame(); const frame = createSpiderFrame(); const pose = new Float32Array(114);
  writeSpiderFrame(0, motion, web, baseline); pose[0] = .2; pose[1] = -.2; pose[2] = .15; writeSpiderFrame(0, motion, web, frame, pose);
  assert.notDeepEqual(frame.body, baseline.body); assert.deepEqual(frame.feet, baseline.feet);
  // Solid-body limits may reduce a combined tilt, while retaining its direction
  // and keeping all caller-owned support anchors and unrelated joints exact.
  for (let axis = 0; axis < 3; axis++) {
    assert.equal(Math.sign(frame.pose[axis]), Math.sign(pose[axis]));
    assert.ok(Math.abs(frame.pose[axis]) <= Math.abs(pose[axis]));
  }
  assert.deepEqual(frame.pose.slice(3), pose.slice(3));
});

test('radian constraints keep malformed and extreme overlays finite and respect reordered joint metadata', () => {
  const pose = new Float32Array(114); for (let i = 0; i < 114; i += 1) pose[i] = i % 3 === 0 ? NaN : i % 3 === 1 ? 900 : -900;
  assert.equal(constrainSpiderPose(pose), pose); assert.ok(pose.every(value => Number.isFinite(value) && Math.abs(value) <= .75000001));
  const reordered = [{ id: 'abdomen' }, { id: 'chelicera_left' }]; const values = new Float32Array(6).fill(9); constrainSpiderPose(values, reordered);
  close(values[0], .4, 1e-7); close(values[3], .48, 1e-7);
});

test('24 routines and 16 held pose choices are reproducible and meaningfully varied', () => {
  const signatures = new Set();
  for (const item of SPIDER_MOTION_PRESETS) { const motion = normalizeSpiderMotion({ preset: item.id }); const frame = createSpiderFrame(); writeSpiderFrame(1.173, motion, web, frame); signatures.add(JSON.stringify([...frame.pose, ...frame.feet.flatMap(foot => [foot.x, foot.y, foot.z])])); }
  assert.equal(signatures.size, 40);
  for (const item of SPIDER_STATIC_POSES) { assert.deepEqual(createSpiderStaticPose(item.id, 17), createSpiderStaticPose(item.id, 17)); const pose = writeSpiderPose(20, normalizeSpiderMotion({ preset: 'none', offsets: createSpiderStaticPose(item.id, 17) })); assert.ok(pose.every(value => Number.isFinite(value) && Math.abs(value) <= .75)); }
  assert.deepEqual(createRandomSpiderMotion(97), createRandomSpiderMotion(97)); assert.notDeepEqual(createRandomSpiderMotion(97), createRandomSpiderMotion(98));
  assert.deepEqual(createSpiderStaticPose('neutral'), {});
});

test('speech gesture is additive, bounded, zero-exact and cannot move legs or abdomen', () => {
  const motion = normalizeSpiderMotion({ preset: 'none', offsets: createSpiderStaticPose('random', 19) }); const base = writeSpiderPose(0, motion); const saved = base.slice();
  assert.equal(applySpiderSpeechPose(17, 0, base), base); assert.deepEqual(base, saved);
  const first = saved.slice(); const second = saved.slice(); applySpiderSpeechPose(1.23, .8, first); applySpiderSpeechPose(1.23, .8, second); assert.deepEqual(first, second);
  assert.notDeepEqual(first.slice(0, 3), saved.slice(0, 3)); assert.deepEqual(first.slice(3, 6), saved.slice(3, 6)); assert.deepEqual(first.slice(18), saved.slice(18)); assert.deepEqual(base, saved);
  const before = createSpiderFrame(); const after = createSpiderFrame(); writeSpiderFrame(0, motion, web, before, saved); writeSpiderFrame(0, motion, web, after, first); assert.deepEqual(before.feet, after.feet);
  for (let index = 0; index < 100; index += 1) applySpiderSpeechPose(index / 8, 9, first); assert.ok(first.every(value => Number.isFinite(value) && Math.abs(value) <= .75));
});

test('explicit pre-clamp overlays keep saturated held poses planted across all routines', () => {
  const frame = createSpiderFrame(); const pose = new Float32Array(114); const overlay = new Float64Array(114);
  for (const sign of [-1, 1]) for (const preset of SPIDER_MOTION_PRESETS.slice(0, 24)) {
    const motion = normalizeSpiderMotion({ preset: preset.id, intensity: 1, offsets: createSpiderStaticPose('random', 19) });
    for (let i = 18; i < 114; i += 1) overlay[i] = sign * (.52 + (i % 3) * .13);
    const previous = Array.from({ length: 8 }, () => null);
    for (let tick = 0; tick < 200; tick += 1) {
      const time = tick / 40; writeSpiderPose(time, motion, pose);
      for (let i = 0; i < 114; i += 1) pose[i] += overlay[i]; constrainSpiderPose(pose);
      writeSpiderFrame(time, motion, web, frame, pose, overlay);
      assert.ok(frame.supportCount >= 4);
      for (let leg = 0; leg < 8; leg += 1) {
        const foot = frame.feet[leg]; const before = previous[leg];
        if (before?.stance && foot.stance && before.step === foot.step) { assert.equal(foot.x, before.x); assert.equal(foot.z, before.z); assert.equal(foot.segmentId, before.segmentId); assert.equal(foot.u, before.u); }
        previous[leg] = { ...foot };
      }
    }
  }
});

test('explicit zero overlay preserves normal frames and facial speech cannot perturb support', () => {
  const original = createSpiderFrame(); const explicit = createSpiderFrame(); const overlay = new Float64Array(114); const pose = new Float32Array(114);
  for (const preset of SPIDER_MOTION_PRESETS.slice(0, 24)) {
    const motion = normalizeSpiderMotion({ preset: preset.id });
    for (const time of [0, .178, 2.371]) {
      writeSpiderPose(time, motion, pose); writeSpiderFrame(time, motion, web, original, pose); writeSpiderFrame(time, motion, web, explicit, pose, overlay);
      assert.deepEqual(explicit, original);
      applySpiderSpeechPose(time + 2, .9, pose); writeSpiderFrame(time, motion, web, explicit, pose, overlay); assert.deepEqual(explicit.feet, original.feet);
    }
  }
});

test('explicit overlay keeps all leg component axes and clamps held limit drags', () => {
  const original = createSpiderFrame(); const explicit = createSpiderFrame(); const base = createSpiderFrame(); const overlay = new Float64Array(114); const pose = new Float32Array(114);
  const motion = normalizeSpiderMotion({ preset: 'none' }); writeSpiderFrame(0, motion, web, base);
  for (let joint = 6; joint < 38; joint += 1) for (let axis = 0; axis < 3; axis += 1) {
    pose.fill(0); overlay.fill(0); overlay[joint * 3 + axis] = .3; pose[joint * 3 + axis] = .3;
    writeSpiderFrame(0, motion, web, original, pose); writeSpiderFrame(0, motion, web, explicit, pose, overlay);
    const leg = Math.floor((joint - 6) / 4);
    assert.ok(Math.hypot(explicit.feet[leg].x - base.feet[leg].x, explicit.feet[leg].z - base.feet[leg].z) > 1e-5);
    close(explicit.feet[leg].x, original.feet[leg].x, 1e-9); close(explicit.feet[leg].z, original.feet[leg].z, 1e-9);
    for (let other = 0; other < 8; other += 1) if (other !== leg) assert.deepEqual(explicit.feet[other], base.feet[other]);
  }
  overlay.fill(0); overlay[18] = 2; pose.fill(0); pose[18] = .65;
  writeSpiderFrame(0, motion, web, original, pose, overlay); overlay[18] = 10; writeSpiderFrame(0, motion, web, explicit, pose, overlay);
  assert.deepEqual(explicit.feet, original.feet);
});

test('touchdown overlay reproduces separate manual and MIDI clamps, including opposing controls', () => {
  const original = createSpiderFrame(); const explicit = createSpiderFrame(); const pose = new Float32Array(114); const overlay = new Float64Array(114);
  const joint = 'leg_left_1_hip';
  for (const sign of [-1, 1]) for (const amount of [0, -.3 * sign, .4 * sign]) {
    const motion = normalizeSpiderMotion({ preset: 'orb-walk', intensity: 1, offsets: { [joint]: { x: .65 * sign, y: .7 * sign, z: .65 * sign } } });
    const time = 4 * 60 / motion.tempo; // L1 touchdown, so old and new anchor bases coincide.
    writeSpiderPose(time, motion, pose); overlay.fill(0);
    for (let axis = 0; axis < 3; axis += 1) { overlay[18 + axis] = amount; pose[18 + axis] += amount; }
    constrainSpiderPose(pose); writeSpiderFrame(time, motion, web, original, pose); writeSpiderFrame(time, motion, web, explicit, pose, overlay);
    assert.equal(explicit.feet[0].x, original.feet[0].x); assert.equal(explicit.feet[0].z, original.feet[0].z);
  }
});

test('new gait families keep explicit support exceptions and tempo-grid landings at intensity extremes', () => {
  const before = createSpiderFrame(); const after = createSpiderFrame();
  for (const item of SPIDER_MOTION_PRESETS.slice(24)) for (const tempo of [20, 300]) for (const intensity of [0, .3, 1]) {
    const motion = normalizeSpiderMotion({ preset: item.id, tempo, intensity });
    for (let tick = 0; tick < 64; tick += 1) {
      writeSpiderFrame((tick + .23) * item.period / 16 * 60 / tempo, motion, web, after);
      assert.ok(after.supportCount >= 4 || item.support && after.airborne);
      assert.ok(after.pose.every(v => Number.isFinite(v) && Math.abs(v) <= .75));
      if (!intensity) { assert.equal(after.supportCount, 8); assert.ok(after.feet.every(f => f.impact === 0 && f.step === 0)); }
    }
    if (!intensity || !item.mask || item.duty === 1) continue;
    for (let index = 0; index < 8; index += 1) if (item.mask & 1 << index) {
      const offset = item.gait === 'together' ? 0 : item.gait === 'wave' ? index / 8 : item.gait === 'ripple' ? index % 4 / 4 : ((index < 4 ? index : index + 1) & 1) * .5;
      const landing = (3 - offset) * item.period * 60 / tempo;
      writeSpiderFrame(landing - 1e-7, motion, web, before); writeSpiderFrame(landing + 1e-7, motion, web, after);
      assert.equal(before.feet[index].stance, false); assert.equal(after.feet[index].stance, true);
      assert.equal(after.feet[index].step, before.feet[index].step + 1);
      assert.ok(Math.hypot(before.feet[index].x - after.feet[index].x, before.feet[index].y - after.feet[index].y, before.feet[index].z - after.feet[index].z) < 1e-5);
      if (item.mode === 'roll') { close(Math.cos(before.body.roll), Math.cos(after.body.roll), 1e-5); close(Math.sin(before.body.roll), Math.sin(after.body.roll), 1e-5); }
    }
  }
});

test('Circle patrol completes a full yaw turn with fixed supported toes and reachable short legs', () => {
  const item = SPIDER_MOTION_PRESETS.find(p => p.id === 'circle-patrol');
  for (const tempo of [20, 300]) for (const intensity of [.1, 1]) {
    const motion = normalizeSpiderMotion({ preset: item.id, tempo, intensity, center: { x: .42, z: .42 } });
    const frame = createSpiderFrame(); let previous = null; let turn = 0;
    for (let tick = 0; tick <= 480; tick += 1) {
      writeSpiderFrame(tick / 480 * item.loopBeats * 60 / tempo, motion, web, frame);
      assert.ok(frame.supportCount >= 4 && !frame.airborne);
      if (previous) turn += Math.atan2(Math.sin(frame.body.yaw - previous.yaw), Math.cos(frame.body.yaw - previous.yaw));
      for (let i = 0; i < 8; i += 1) {
        const foot = frame.feet[i]; const before = previous?.feet[i];
        if (before?.stance && foot.stance && before.step === foot.step) for (const axis of ['x', 'y', 'z']) close(foot[axis], before[axis]);
        const leg = SPIDER_LEG_GEOMETRY[i]; const c = Math.cos(frame.body.yaw); const s = Math.sin(frame.body.yaw);
        const distance = Math.hypot(foot.x - frame.body.x - leg.hip[0] * c - leg.hip[2] * s, foot.y - frame.body.y - leg.hip[1], foot.z - frame.body.z - leg.hip[2] * c + leg.hip[0] * s);
        assert.ok(distance < leg.reach * .98, `${i}: ${distance / leg.reach}`);
      }
      previous = { yaw: frame.body.yaw, feet: frame.feet.map(f => ({ ...f })) };
    }
    close(turn, Math.PI * 2, 1e-7);
  }
});

test('motion profiles preserve all IDs, stationary intent, ripple default and deterministic random travel', () => {
  const normal = SPIDER_MOTION_PRESETS.find(p => p.id === 'orb-walk'); assert.equal(normal.gait, 'ripple');
  for (const item of SPIDER_MOTION_PRESETS) { assert.ok(['forward', 'backward', 'sideways'].includes(item.direction)); assert.ok(item.world.speed >= 0 && item.world.speed <= 2); assert.ok(item.world.range <= .85); assert.ok(Object.isFrozen(item.world)); }
  assert.equal(SPIDER_MOTION_PRESETS.find(p => p.id === 'palp-talk').world.path, 'hold');
  assert.equal(SPIDER_MOTION_PRESETS.find(p => p.id === 'backpedal').direction, 'backward');
  const a = createRandomSpiderMotion(72); assert.deepEqual(a, createRandomSpiderMotion(72)); assert.ok(a.world); assert.notDeepEqual(a, createRandomSpiderMotion(73));
  for (const g of SPIDER_LEG_GEOMETRY) close(g.innerReach, Math.max(0, Math.max(...g.lengths) * 2 - g.reach));
});
