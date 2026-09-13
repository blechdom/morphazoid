import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SPIDER_SPECIMENS, getSpiderSpecimen } from '../src/spider-synth-specimens.js';
import { createSpiderWeb, SPIDER_WEB_PRESETS, createSpiderFrame, normalizeSpiderMotion, writeSpiderPose, writeSpiderFrame } from '../src/spider-synth-model.js';
import { SpiderSynthWorld } from '../src/spider-synth-world.js';

test('six specimen profiles match their actual rig geometry before any GLB load', async () => {
  assert.deepEqual(SPIDER_SPECIMENS.map(item => item.id), ['argiope', 'golden', 'devil', 'tarantula', 'huntsman', 'fishing']);
  const signatures = new Set();
  for (const specimen of SPIDER_SPECIMENS) {
    const rig = JSON.parse(await readFile(new URL(specimen.rigPath, new URL('../src/', import.meta.url))));
    assert.equal(specimen.bodyHeight, rig.neutralBodyHeight ?? rig.bodyHeight);
    assert.equal(specimen.species, rig.species);
    assert.equal(specimen.legs.length, 8);
    assert.equal(specimen.collisionProfile.bodies.length, 6);
    for (let i = 0; i < 8; i++) {
      const leg = specimen.legs[i];
      assert.deepEqual(leg.hip, rig.legs[i].anchors[0]);
      assert.deepEqual(leg.tip, rig.legs[i].anchors[4]);
      assert.deepEqual(leg.lengths, rig.legs[i].lengths);
      assert.ok(leg.innerReach < leg.reach);
    }
    signatures.add(JSON.stringify(specimen.legs));
    assert.equal(normalizeSpiderMotion({ specimen: specimen.id }).specimen, specimen.id);
  }
  assert.equal(signatures.size, 6);
  assert.equal(getSpiderSpecimen('unknown').id, 'argiope');
});

test('every specimen has finite reachable strand contacts across all web constructions', () => {
  const frame = createSpiderFrame(), pose = new Float32Array(114);
  for (const specimen of SPIDER_SPECIMENS) for (const construction of SPIDER_WEB_PRESETS) {
    const web = createSpiderWeb({ ...construction.settings, seed: 13 });
    const motion = normalizeSpiderMotion({ specimen: specimen.id, preset: 'orb-walk', tempo: 300, intensity: 1 });
    const world = new SpiderSynthWorld({ playing: true, path: 'figure8', speed: 2, range: .85 });
    for (let tick = 0; tick < 80; tick++) {
      const time = tick / 20;
      writeSpiderPose(time, motion, pose);
      world.sample(time, motion, web, frame, pose, null, { playing: true, motionTime: time });
      assert.ok(frame.supportCount >= 4, `${specimen.id}/${construction.id} supports`);
      assert.ok(frame.pose.every(Number.isFinite));
      for (const foot of frame.feet) if (foot.stance) {
        const segment = web.segments[foot.segmentId], a = web.nodes[segment.a], b = web.nodes[segment.b];
        assert.ok(Math.hypot(foot.x - a.x - (b.x - a.x) * foot.u, foot.y - a.y - (b.y - a.y) * foot.u, foot.z - a.z - (b.z - a.z) * foot.u) < 1e-8,
          `${specimen.id}/${construction.id} foot ${foot.legIndex} on strand`);
        const leg = specimen.legs[foot.legIndex], yaw = world.point.yaw, c = Math.cos(yaw), s = Math.sin(yaw);
        const distance = Math.hypot(foot.x - frame.body.x - leg.hip[0] * c - leg.hip[2] * s,
          foot.y - frame.body.y - leg.hip[1], foot.z - frame.body.z - leg.hip[2] * c + leg.hip[0] * s);
        assert.ok(distance < leg.reach, `${specimen.id}/${construction.id} foot ${foot.legIndex} outer reach ${distance}/${leg.reach}`);
        assert.ok(distance >= leg.innerReach, `${specimen.id}/${construction.id} foot ${foot.legIndex} inner reach`);
      }
    }
  }
});

test('changing specimen replants its anatomy at the traveled location without rewinding the beat', () => {
  const web = createSpiderWeb(), world = new SpiderSynthWorld({ playing: true, path: 'figure8', speed: 1, range: .5 });
  const frame = createSpiderFrame(), pose = new Float32Array(114);
  let motion = normalizeSpiderMotion({ preset: 'orb-walk', tempo: 147 });
  for (let tick = 0; tick <= 80; tick++) {
    const time = tick / 20; writeSpiderPose(time, motion, pose);
    world.sample(time, motion, web, frame, pose, null, { playing: true, motionTime: time });
  }
  const location = { ...world.point }, beat = frame.beat, settings = structuredClone(world.settings);
  assert.ok(Math.hypot(location.x, location.z) > .03);
  for (const specimen of SPIDER_SPECIMENS.slice(1)) {
    motion = normalizeSpiderMotion({ ...motion, specimen: specimen.id });
    writeSpiderPose(4, motion, pose); world.sample(4, motion, web, frame, pose, null, { playing: true, motionTime: 4 });
    assert.ok(Math.hypot(world.point.x - location.x, world.point.z - location.z) < 1e-8, specimen.id);
    assert.equal(frame.beat, beat); assert.deepEqual(world.settings, settings);
    const restored = new SpiderSynthWorld().restore(world.snapshot()), other = createSpiderFrame();
    restored.sample(4, motion, web, other, pose, null, { playing: true, motionTime: 4 });
    assert.equal(restored.specimen.id, specimen.id);
    assert.ok(Math.hypot(other.body.x - frame.body.x, other.body.z - frame.body.z) < 1e-8);
  }
});
