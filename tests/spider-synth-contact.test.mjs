import test from 'node:test';
import assert from 'node:assert/strict';
import { SPIDER_SPECIMENS } from '../src/spider-synth-specimens.js';
import { createSpiderWeb, createSpiderFrame, normalizeSpiderMotion, writeSpiderPose, writeSpiderFrame, writeSpiderBody, writeSpiderSupportBody, constrainSpiderBodyPose, SPIDER_MOTION_PRESETS } from '../src/spider-synth-model.js';
import { projectSpiderWebInto } from '../src/spider-synth-web.js';
import { SpiderSynthWorld } from '../src/spider-synth-world.js';
import { constrainSpiderSupportBody } from '../src/spider-synth-collision.js';
import { createSpiderFootClearance, writeSpiderFootClearance, spiderFootClearsBodies, spiderFeetClear } from '../src/spider-synth-contact.js';

test('support-only future body samples match full collision-guarded composition across every specimen and motion', () => {
  const web = createSpiderWeb({ preset: 'argiope', seed: 3 });
  const full = new Float32Array(114), root = new Float32Array(114), midi = new Float32Array(114), a = {}, b = {};
  for (const specimen of SPIDER_SPECIMENS) for (const preset of SPIDER_MOTION_PRESETS) for (let sample = 0; sample < 8; sample++) {
    const time = sample * .173;
    const motion = normalizeSpiderMotion({ specimen: specimen.id, preset: preset.id, tempo: 300, intensity: sample ? 1 : 0, offsets: { cephalothorax: { x: .3 * Math.sin(sample), y: .48 * Math.cos(sample), z: .28 * Math.sin(sample * 1.3) }, abdomen: { x: .4, y: -.3 }, pedipalp_left: { x: .7, y: .6 } } });
    for (let i = 0; i < 18; i++) midi[i] = sample % 3 ? .7 * Math.sin(sample * .9 + i * 1.7) : 0;
    writeSpiderPose(time, motion, full);
    for (let i = 0; i < 18; i++) full[i] += midi[i];
    constrainSpiderBodyPose(full, motion); writeSpiderBody(time, motion, web, a, full);
    writeSpiderSupportBody(time, motion, web, b, root, midi);
    assert.deepEqual(Array.from(root.subarray(0, 3)), Array.from(full.subarray(0, 3)), `${specimen.id}/${preset.id}/${sample}: identical root angles`);
    assert.deepEqual(b, a, `${specimen.id}/${preset.id}/${sample}: identical body transform`);
  }
});

test('prepared locomotion frames and event ledgers exactly match forced full stationary composition', () => {
  const web = createSpiderWeb({ preset: 'argiope', spokes: 24, rings: 18, seed: 3 });
  for (const specimen of SPIDER_SPECIMENS) {
    const settings = { playing: true, path: 'figure8', speed: 2, range: .58, laySilk: true };
    const fast = new SpiderSynthWorld(settings), full = new SpiderSynthWorld(settings);
    full._writePlannedFrame = writeSpiderFrame;
    const a = createSpiderFrame(), b = createSpiderFrame(), pose = new Float32Array(114), midi = new Float32Array(114);
    let motionTime = 0;
    for (let tick = 0; tick < 160; tick++) {
      const time = tick / 40, playing = tick < 70 || tick >= 90;
      if (playing) motionTime += 1 / 40;
      const item = tick < 40 ? SPIDER_MOTION_PRESETS.find(p => p.id === 'low-sprint') : tick < 100 ? SPIDER_MOTION_PRESETS.find(p => p.mode === 'leap') : SPIDER_MOTION_PRESETS.find(p => p.mode === 'roll');
      const motion = normalizeSpiderMotion({ specimen: specimen.id, preset: item.id, tempo: 300, intensity: 1 });
      for (let i = 0; i < 114; i++) midi[i] = .4 * Math.sin(tick * .11 + i * 1.73);
      if (tick === 110 || tick === 130) for (const world of [fast, full]) world.update({ path: tick === 110 ? 'hold' : 'figure8' }, time);
      writeSpiderPose(motionTime, motion, pose); for (let i = 0; i < 114; i++) pose[i] += midi[i];
      fast.sample(time, motion, web, a, pose, midi, { playing, motionTime });
      writeSpiderPose(motionTime, motion, pose); for (let i = 0; i < 114; i++) pose[i] += midi[i];
      full.sample(time, motion, web, b, pose, midi, { playing, motionTime });
      assert.deepEqual(a, b, `${specimen.id}/${tick}: exact composed frame`);
      assert.deepEqual(fast.state, full.state, `${specimen.id}/${tick}: exact event ledger and world state`);
    }
    assert.deepEqual(fast.snapshot(), full.snapshot(), `${specimen.id}: exact reusable snapshot`);
  }
});

test('clearance keeps the nearest surviving strand interval through overlapping body and toe boundaries', () => {
  const web = { nodes: [{ x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }], segments: [{ id: 0, a: 0, b: 1 }] };
  const clearance = { radius: .02, margin: 0, intervals: new Float64Array(64), bodies: [{ worldCenter: { x: 0, y: 0, z: 0 }, radii: [.08, .08, .08], axes: [1, 0, 0, 0, 1, 0, 0, 0, 1] }], feet: [{ x: .14, y: 0, z: 0, segmentId: 0 }], radii: [.06], legIndex: -1 };
  const out = projectSpiderWebInto(web, .03, 0, {}, 0, 0, .8, 0, true, 0, clearance);
  assert.equal(out.segmentId, 0); assert.ok(Math.abs(out.x + .1) < 1e-12);
  assert.ok(Math.abs(out.x - (-1 + 2 * out.u)) < 1e-12);
  clearance.within = { x: .15, y: 0, z: 0, space: .12 };
  projectSpiderWebInto(web, .03, 0, out, 0, 0, .8, 0, true, 0, clearance);
  assert.ok(Math.abs(out.x - .22) < 1e-12, 'searches the valid right interval when the left one is outside the reserved manipulation ball');
});

test('all six specimens keep solid toe clearance during fast locomotion, stationary dances and simultaneous MIDI gestures', () => {
  const web = createSpiderWeb({ preset: 'argiope', seed: 1 });
  for (const specimen of SPIDER_SPECIMENS) for (const preset of ['orb-walk', 'low-sprint', 'macarena', 'pushups']) for (const manual of [false, true]) {
    const motion = normalizeSpiderMotion({ specimen: specimen.id, preset, tempo: 300, intensity: 1 });
    const world = new SpiderSynthWorld({ playing: true, path: preset === 'low-sprint' ? 'figure8' : 'hold', speed: 2, range: .85 });
    const frame = createSpiderFrame(), pose = new Float32Array(114), midi = manual ? new Float32Array(114) : null;
    const clearance = createSpiderFootClearance(specimen.collisionProfile);
    // Include the exact unmodulated Macarena t=3s regression: its left middle
    // toes formerly overlapped although a continuously changing MIDI probe did
    // not happen to place them at the same corner of the Argiope web.
    for (let tick = 0; tick <= 80; tick++) {
      const time = tick / 20; writeSpiderPose(time, motion, pose);
      if (midi) for (let i = 18; i < 114; i++) { midi[i] = .7 * Math.sin(tick * .08 + i * 1.714); pose[i] += midi[i]; }
      world.sample(time, motion, web, frame, pose, midi, { playing: true, motionTime: time });
      assert.ok(constrainSpiderSupportBody(frame, specimen.collisionProfile), `${specimen.id}/${preset}/${manual}/${time}: forefeet admit a solid-safe composed root heading`);
      writeSpiderFootClearance(clearance, frame.pose, frame.body);
      for (let i = 0; i < 8; i++) {
        const foot = frame.feet[i], label = `${specimen.id}/${preset}/${manual}/${time}/${i}`;
        assert.ok(foot.segmentId >= 0, `${label}: strand exists`);
        assert.ok(spiderFootClearsBodies(foot, clearance, i), `${label}: toe outside expanded body`);
        for (let j = 0; j < i; j++) assert.ok(spiderFeetClear(foot, frame.feet[j], clearance, i, j), `${label}: clears toe ${j}`);
        if (foot.stance) {
          const strand = web.segments[foot.segmentId], a = web.nodes[strand.a], b = web.nodes[strand.b];
          assert.ok(Math.hypot(foot.x - a.x - (b.x - a.x) * foot.u, foot.y - a.y - (b.y - a.y) * foot.u, foot.z - a.z - (b.z - a.z) * foot.u) < 1e-9, `${label}: exact shared strand/u`);
        }
      }
    }
  }
});
