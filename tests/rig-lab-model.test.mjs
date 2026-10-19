import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/three.module.min.js';
import { ANT_DEFAULTS, antFootContacts, antPose, antSettings, chamberTone } from '../src/instruments/ant-farm/demo-model.js';
import { FOAM_DEFAULTS, foamBounds, foamSettings, voronoiCells } from '../src/instruments/voronoi-foam/demo-model.js';
import { LATTICE_DEFAULTS, LATTICE_MAX_DETAIL, latticeSettings, latticePose, latticeStructure, LATTICE_EDGES, REST_NODES } from '../src/instruments/polyhedral-lattice/demo-model.js';
import { OCTOPUS_DEFAULTS, OCTOPUS_SKINS, octopusPose, octopusSettings } from '../src/instruments/octopus/demo-model.js';
import { createOctopusSkins } from '../src/instruments/octopus/demo-skins.js';
import { PANCAKE_DEFAULTS, pancakePose, pancakeSettings, pancakeTransition } from '../src/instruments/pancakes/demo-model.js';
import { MOSQUITO_DEFAULTS, mosquitoPose, mosquitoSettings } from '../src/instruments/mosquito/demo-model.js';
import { MOTH_DEFAULTS, mothPose, mothSettings, mothBrushRidges } from '../src/instruments/moth/demo-model.js';
import { motionClock, motionCycles, rebaseMotion } from '../src/families/rig-lab/demo-motion.js';
import { animatedRigSettings, KITCHEN_SCENE_CONTACTS, pancakeScenePose,
  rigLabScene, rigLabSceneIds, rigLabScenes } from '../src/families/rig-lab/demo-presets.js';
import { cellSurfaceGeometry } from '../src/families/rig-lab/procedural-models.js';

const close = (value, expected, tolerance = 1e-6) =>
  assert.ok(Math.abs(value - expected) < tolerance, `${value} differs from ${expected}`);

test('real clipped Voronoi cells partition a bounded 3D volume before and after edits', () => {
  const original = foamSettings(FOAM_DEFAULTS);
  const movedSeeds = original.seeds.map((seed) => [...seed]);
  movedSeeds[4] = [0.46, 0.1, 0.43];
  const edited = foamSettings({ ...original, seeds: movedSeeds });
  for (const state of [original, edited]) {
    const cells = voronoiCells(state);
    assert.equal(cells.length, 5);
    close(cells.reduce((sum, cell) => sum + cell.volume, 0), 8, 1e-4);
    for (const cell of cells) {
      assert.ok(cell.volume > 0 && Number.isFinite(cell.frequency));
      assert.ok(cell.faces.length >= 4 && cell.faces.some((face) => face.length >= 3));
      for (const face of cell.faces) for (const point of face) {
        assert.ok(point.every((axis) => Number.isFinite(axis) && Math.abs(axis) <= 1 + 1e-5));
        const mine = point.reduce((sum, axis, index) =>
          sum + (axis - state.seeds[cell.id][index]) ** 2, 0);
        for (let other = 0; other < state.seeds.length; other += 1) {
          const theirs = point.reduce((sum, axis, index) =>
            sum + (axis - state.seeds[other][index]) ** 2, 0);
          assert.ok(mine <= theirs + 1e-4);
        }
      }
    }
  }
  const before = voronoiCells(original), after = voronoiCells(edited);
  assert.notEqual(before[4].volume, after[4].volume);
  assert.equal(after[4].volume < before[4].volume, after[4].frequency > before[4].frequency);
  const collided = foamSettings({ ...original, seeds: Array(5).fill([0, 0, 0]) });
  assert.ok(voronoiCells(collided).every((cell) => Number.isFinite(cell.volume)));
});

const signedVolume = (faces) => faces.reduce((sum, face) => {
  const [a] = face;
  return sum + face.slice(1, -1).reduce((partial, b, i) => {
    const c = face[i + 2];
    return partial + (a[0] * (b[1] * c[2] - b[2] * c[1])
      + a[1] * (b[2] * c[0] - b[0] * c[2])
      + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }, 0);
}, 0);

test('cell count and clipping solid change real 3D topology without losing surviving edits', () => {
  for (const shape of ['cube', 'octahedron', 'icosahedron']) {
    for (const count of [2, 5, 12]) {
      const state = foamSettings({ ...FOAM_DEFAULTS, shape, count });
      const cells = voronoiCells(state);
      assert.equal(cells.length, count);
      close(cells.reduce((sum, cell) => sum + cell.volume, 0),
        signedVolume(foamBounds(shape)), 1e-4);
      assert.ok(cells.every((cell) => cell.volume > 0 && Number.isFinite(cell.frequency)));
      assert.ok(state.selected < cells.length);
    }
  }
  const seed = [0.35, 0.21, -0.12];
  const edited = foamSettings({ ...FOAM_DEFAULTS, seeds:
    FOAM_DEFAULTS.seeds.map((item, i) => i === 0 ? seed : item) });
  const larger = foamSettings({ ...edited, count: 12 });
  assert.deepEqual(larger.seeds[0], seed);
  assert.deepEqual(foamSettings({ ...larger, count: 2 }).seeds[0], seed);
  assert.equal(foamSettings({ ...larger, count: 99 }).count, 12);
  const coincident = foamSettings({ count: 12, seeds: Array(12).fill([0, 0, 0]) });
  assert.ok(voronoiCells(coincident).every((cell) => cell.volume > 0));
  for (let i = 0; i < coincident.count; i += 1) for (let j = i + 1; j < coincident.count; j += 1) {
    assert.ok(Math.hypot(...coincident.seeds[i].map((value, axis) =>
      value - coincident.seeds[j][axis])) > 0.2);
  }
  for (const shape of ['octahedron', 'icosahedron']) {
    const outside = foamSettings({ shape, count: 12, seeds: Array(12).fill([0.88, 0.88, 0.88]) });
    const cells = voronoiCells(outside);
    assert.ok(cells.every((cell) => cell.volume > 0), `${shape} must not create empty cells at the edge`);
    close(cells.reduce((sum, cell) => sum + cell.volume, 0), signedVolume(foamBounds(shape)), 1e-4);
  }
});

test('Three.js foam surfaces triangulate the exact sound-cell faces and rebuild on edits', () => {
  const state = foamSettings(FOAM_DEFAULTS);
  const original = voronoiCells(state);
  const surfaces = original.map((cell) => cellSurfaceGeometry(cell.faces));
  assert.ok(surfaces.every(({ surface, outline, vertices, triangles }) =>
    vertices >= 4 && triangles > 0 &&
    surface.getAttribute('position').count === triangles * 3 &&
    outline.getAttribute('position').count >= vertices));
  const edited = foamSettings({ ...state, seeds: state.seeds.map((seed, index) =>
    index === state.selected ? [0.42, -0.13, 0.25] : seed) });
  const next = cellSurfaceGeometry(voronoiCells(edited)[state.selected].faces);
  assert.notDeepEqual(Array.from(surfaces[state.selected].surface.attributes.position.array),
    Array.from(next.surface.attributes.position.array));
  for (const item of [...surfaces, next]) { item.surface.dispose(); item.outline.dispose(); }
});

test('icosahedral struts share joint positions; yield and strain shape the same tone', () => {
  assert.equal(REST_NODES.length, 12);
  assert.equal(LATTICE_EDGES.length, 30);
  assert.equal(latticeStructure(LATTICE_DEFAULTS).triangles.length, 20);
  const neutral = latticePose(LATTICE_DEFAULTS);
  close(neutral.strain, 0);
  const stiff = latticePose(latticeSettings({ ...LATTICE_DEFAULTS, pullX: 0.6, pullY: -0.4, softness: 0 }));
  const soft = latticePose(latticeSettings({ ...LATTICE_DEFAULTS, pullX: 0.6, pullY: -0.4, softness: 0.8 }));
  assert.ok(stiff.strain > 0);
  assert.notEqual(stiff.frequencies[7], neutral.frequencies[7]);
  assert.deepEqual(stiff.nodes[0], REST_NODES[0]);
  assert.notDeepEqual(soft.nodes[3], REST_NODES[3]);
  assert.deepEqual(stiff.nodes[7], soft.nodes[7]);
  assert.equal(latticePose({ selected: Infinity, pullZ: 99 }).selected, 7);
  assert.ok(soft.nodes.flat().every(Number.isFinite));
});

test('solid shape and count rebuild connected playable nodes and the audio traversal', () => {
  for (const [shape, vertices, faces] of [
    ['icosahedron', 12, 20], ['octahedron', 6, 8], ['tetrahedron', 4, 4],
  ]) {
    for (const unitCount of [1, 4]) {
      const structure = latticeStructure({ shape, unitCount });
      assert.equal(structure.restNodes.length, unitCount * vertices);
      assert.equal(structure.triangles.length, unitCount * faces);
      const visited = new Set([0]), pending = [0];
      while (pending.length) {
        const head = pending.shift();
        for (const [a, b] of structure.edges) {
          const other = a === head ? b : b === head ? a : null;
          if (other != null && !visited.has(other)) { visited.add(other); pending.push(other); }
        }
      }
      assert.equal(visited.size, structure.restNodes.length);
      const pose = latticePose({ shape, unitCount }, 2.125, true);
      assert.equal(pose.nodes.length, unitCount * vertices);
      assert.equal(pose.pulseNode, 25 % pose.nodes.length);
      assert.ok(pose.frequencies.every(Number.isFinite));
    }
  }
  assert.equal(latticeSettings({ unitCount: 999, shape: 'impossible', selected: 999 }).unitCount, 4);
  assert.equal(latticeSettings({ unitCount: 1, shape: 'tetrahedron', selected: 999 }).selected, 3);
});

test('on-the-fly geodesic subdivision creates shared playable vertices, not triangle duplicates', () => {
  assert.equal(LATTICE_MAX_DETAIL, 2);
  for (const [shape, counts] of [
    ['icosahedron', [12, 42, 162]], ['octahedron', [6, 18, 66]],
    ['tetrahedron', [4, 10, 34]],
  ]) {
    for (const detail of [0, 1, 2]) {
      const one = latticeStructure({ shape, detail });
      const four = latticeStructure({ shape, detail, unitCount: 4 });
      assert.equal(one.verticesPerUnit, counts[detail]);
      assert.equal(one.restNodes.length, counts[detail]);
      assert.equal(one.triangles.length, latticeStructure({ shape }).triangles.length * 4 ** detail);
      assert.equal(four.restNodes.length, 4 * counts[detail]);
      assert.equal(four.triangles.length, 4 * one.triangles.length);
      assert.ok(four.edges.length > one.edges.length);
      const pose = latticePose({ shape, detail, unitCount: 4, selected: four.restNodes.length - 1,
        pullX: 0.55 });
      assert.equal(pose.nodes.length, pose.frequencies.length);
      assert.equal(pose.edges.length, four.edges.length);
      assert.ok(pose.strain > 0 && pose.frequencies.every((hz) => hz >= 80 && hz <= 620));
      assert.notDeepEqual(pose.nodes.at(-1), four.restNodes.at(-1));
    }
  }
  assert.equal(latticeSettings({ detail: 99 }).detail, 2);
  assert.equal(latticeSettings({ detail: -99 }).detail, 0);
  assert.equal(latticeSettings({ shape: 'icosahedron', detail: 2, unitCount: 4, selected: 999 }).selected, 647);
});

test('three ant identities, guide offsets, gates and chamber size are bounded', () => {
  const a = antPose(ANT_DEFAULTS, 0.14, true);
  assert.deepEqual(a.colony.map((ant) => ant.id), [0, 1, 2]);
  const guide = antSettings({ ...ANT_DEFAULTS, selected: 1, guide: [[0, 0], [0.28, -0.2], [0, 0]] });
  const b = antPose(guide, 0.14, true);
  assert.notDeepEqual(a.colony[1].position, b.colony[1].position);
  assert.deepEqual(a.colony[0].position, b.colony[0].position);
  assert.deepEqual(a.colony[2].position, b.colony[2].position);
  assert.ok(chamberTone(0.3) > chamberTone(0.7));
  const blocked = antPose(antSettings({ ...guide, gateOpen: false, foodX: 1.1 }), 0.14, true);
  assert.notEqual(b.colony[0].position[2], blocked.colony[0].position[2]);
  assert.equal(antSettings({ foodX: Infinity, trail: -9 }).trail, 0);
});

test('octopus has eight separately tunable radial joint chains and a bounded mantle', () => {
  const rest = octopusPose(OCTOPUS_DEFAULTS);
  assert.equal(rest.arms.length, 8);
  assert.ok(rest.arms.every((item) => item.joints.length === 6
    && item.joints.flat().every(Number.isFinite)));
  const lengths = [...OCTOPUS_DEFAULTS.lengths];
  lengths[2] = 0.74;
  const edited = octopusPose(octopusSettings({ ...OCTOPUS_DEFAULTS, lengths, selected: 2, grip: 0.75 }));
  assert.ok(edited.arms[2].frequency > rest.arms[2].frequency);
  close(edited.arms[1].frequency, rest.arms[1].frequency);
  assert.ok(edited.pressure > rest.pressure);
  assert.ok(octopusPose({ grip: 900, current: Infinity }, 2, true).pressure <= 1);
});

test('runtime octopus skins change UV albedo/PBR/glow without replacing mesh geometry or bones', () => {
  assert.deepEqual(OCTOPUS_SKINS, ['reef', 'abyss', 'pearl', 'kelp']);
  assert.equal(octopusSettings({ skin: 'absent', wetness: 10 }).skin, 'reef');
  assert.equal(octopusSettings({ wetness: -1 }).wetness, 0);
  const geometry = new THREE.SphereGeometry(1, 8, 6);
  const original = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide });
  const mesh = { geometry, material: original, skeleton: { bones: Array(128).fill(null) } };
  const skins = createOctopusSkins(original);
  const samples = [];
  for (const skin of OCTOPUS_SKINS) {
    skins.update(mesh, skin, 0.4);
    const state = skins.getState(mesh);
    assert.equal(state.skin, skin);
    assert.equal(state.texture, true);
    assert.equal(state.uv, true);
    assert.equal(state.mapSize, 256);
    assert.equal(state.bones, 128);
    assert.equal(state.geometry, geometry.uuid);
    samples.push(Array.from(mesh.material.map.image.data.subarray(0, 24)));
    assert.equal(Boolean(mesh.material.emissiveMap), skin === 'abyss');
  }
  assert.equal(new Set(samples.map((pixels) => JSON.stringify(pixels))).size, 4);
  skins.update(mesh, 'pearl', 0);
  const dry = skins.getState(mesh);
  skins.update(mesh, 'pearl', 1);
  const wet = skins.getState(mesh);
  assert.ok(wet.roughness < dry.roughness && wet.clearcoat > dry.clearcoat);
  skins.dispose();
  geometry.dispose();
  original.dispose();
});

test('pancake flight lands once in model time and adhesion/sizzle have distinct state', () => {
  const cooking = pancakePose(PANCAKE_DEFAULTS, 0, null, 0, true);
  assert.ok(cooking.sizzle > 0);
  close(pancakePose({ ...PANCAKE_DEFAULTS, butter: 0 }, 0, null, 0, true).sizzle, 0);
  close(pancakePose(PANCAKE_DEFAULTS, 0, null, 0, false).sizzle, 0);
  const airborne = pancakePose(PANCAKE_DEFAULTS, 3.34, 3, 0, false);
  assert.ok(airborne.airborne && airborne.pancakePosition[1] > cooking.pancakePosition[1]);
  assert.equal(pancakePose(PANCAKE_DEFAULTS, 4, 3, 0, true).airborne, false);
  const stuck = pancakePose(pancakeSettings({ syrup: 0.9, attachTo: 'wall' }));
  assert.equal(stuck.attachTo, 'wall');
  assert.notDeepEqual(stuck.pancakePosition, cooking.pancakePosition);
});

test('spatula moves six distinct syrup-bearing cakes into a height-ordered plate stack', () => {
  let scene = pancakeSettings(PANCAKE_DEFAULTS);
  for (let id = 0; id < 6; id += 1) {
    if (id > 0) scene = pancakeTransition(scene, 'pour');
    scene = pancakeSettings({ ...scene, syrup: 0.13 + id * 0.11 });
    scene = pancakeTransition(scene, 'scoop');
    assert.equal(scene.cakes[id].place, 'spatula');
    assert.equal(pancakeTransition(scene, 'pour')?.cakes.length, id < 5 ? id + 2 : undefined);
    scene = pancakeTransition(scene, 'stack');
    const pose = pancakePose(scene);
    assert.equal(pose.stackCount, id + 1);
    assert.equal(pose.cakes[id].layer, id);
    if (id > 0) assert.ok(pose.cakes[id].position[1] > pose.cakes[id - 1].position[1]);
  }
  assert.equal(scene.cakes.length, 6);
  assert.equal(pancakeTransition(scene, 'pour'), null);
  assert.equal(pancakeTransition(scene, 'stack'), null);
  assert.ok(scene.cakes.every((cake, id) => Math.abs(cake.syrup - (0.13 + id * 0.11)) < 1e-6));
  const lifted = pancakeTransition(scene, 'peel');
  assert.equal(lifted.cakes[5].place, 'spatula');
  assert.equal(pancakePose(lifted).stackCount, 5);
  const returned = pancakeTransition(lifted, 'pan');
  assert.equal(returned.cakes[5].place, 'pan');
  assert.equal(pancakePose(returned, 3.34, 3, 0, false, 5).cakes[5].airborne, true);
  assert.equal(pancakeTransition(returned, 'wall').cakes[5].place, 'wall');
});

test('the insects remain separate: mosquito pitch/phase and moth ridge crossings', () => {
  const mosquito = mosquitoPose(MOSQUITO_DEFAULTS, 0.2, 0, true, 0.12);
  const tuned = mosquitoPose(mosquitoSettings({ ...MOSQUITO_DEFAULTS, wingRate: 720 }), 0.2, 0, true, 0.12);
  assert.ok(tuned.pitchHz > mosquito.pitchHz);
  close(tuned.wingPhase, mosquito.wingPhase);
  assert.deepEqual(tuned.position, mosquito.position);
  const moth = mothPose(MOTH_DEFAULTS);
  const pulled = mothPose(mothSettings({ ...MOTH_DEFAULTS, leftFold: 0.91 }));
  assert.ok(pulled.leftHz > moth.leftHz);
  close(pulled.rightHz, moth.rightHz);
  assert.deepEqual(mothBrushRidges(0.01, 0.99), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(mothBrushRidges(0.99, 0.01), [7, 6, 5, 4, 3, 2, 1]);
  assert.deepEqual(mothBrushRidges(0.3, 0.3), []);
});

test('moth clock supplies native-clip phase rather than a synthesized root flap', () => {
  const playing = mothPose(MOTH_DEFAULTS, 2.35, true);
  const paused = mothPose(MOTH_DEFAULTS, 2.35, false);
  close(playing.phase, 0.35);
  close(paused.phase, playing.phase);
  close(mothPose(MOTH_DEFAULTS, -0.1).phase, 0.9);
  assert.equal(playing.leftFlap, 0);
  assert.equal(playing.rightFlap, 0);
  assert.equal(playing.leftTip, paused.leftTip);
});

test('six mosquito leg bends stay independent, bounded and affect air without retuning a held wing', () => {
  const start = mosquitoPose(MOSQUITO_DEFAULTS, 0.28, 1, false);
  const edited = mosquitoSettings({
    ...MOSQUITO_DEFAULTS, selectedLeg: 4,
    legs: [0, 0, 0, 0, 0.85, 0],
  });
  const pose = mosquitoPose(edited, 0.28, 1, false);
  assert.deepEqual(pose.legCurls, [0, 0, 0, 0, 0.85, 0]);
  assert.equal(edited.selectedLeg, 4);
  assert.ok(pose.legTension > 0);
  assert.ok(pose.brightness > start.brightness);
  close(pose.pitchHz, start.pitchHz);
  assert.deepEqual(pose.position, start.position);
  assert.deepEqual(mosquitoSettings({ selectedLeg: 999, legs: [3, -4, NaN] }).legs,
    [1, -1, 0, 0, 0, 0]);
  assert.equal(mosquitoSettings({ selectedLeg: -8 }).selectedLeg, 0);
});

test('rate edits rebase playing phase without teleporting the rig or arming audio', () => {
  const stopped = motionClock();
  assert.equal(stopped.playing, false);
  const playing = rebaseMotion(stopped, 0.5, 10, true);
  close(motionCycles(playing, 0.5, 12), 1);
  const faster = rebaseMotion(playing, 0.5, 12);
  close(motionCycles(faster, 2, 12), 1);
  close(motionCycles(faster, 2, 12.25), 1.5);
  close(motionCycles(rebaseMotion(faster, 2, 12.25, false), 2, 40), 1.5);
});

test('seven rigs/geometries have three complete presets with distinct playable animations', () => {
  assert.equal(rigLabSceneIds.length, 7);
  for (const id of rigLabSceneIds) {
    const scenes = rigLabScenes(id);
    assert.equal(scenes.length, 3, id);
    assert.equal(new Set(scenes.map((scene) => scene.id)).size, 3, id);
    for (const { id: key, label, description } of scenes) {
      const selected = rigLabScene(id, key);
      assert.ok(selected?.settings && selected.animation && description && label, `${id}:${key}`);
      assert.ok(Number.isFinite(selected.settings[{
        'ant-farm': 'travelRate', 'voronoi-foam': 'sweepRate',
        'polyhedral-lattice': 'pulseRate', octopus: 'pulseRate',
        pancakes: 'cookRate', mosquito: 'flightRate', moth: 'flapRate',
      }[id]]));
      assert.strictEqual(animatedRigSettings(id, selected.settings,
        0.35, false, selected.animation), selected.settings);
    }
  }
  assert.equal(rigLabScene('moth', 'absent'), undefined);
  assert.notDeepEqual(rigLabScene('voronoi-foam', 'constellation').settings.seeds,
    rigLabScene('voronoi-foam', 'drift').settings.seeds);
  assert.equal(rigLabScene('voronoi-foam', 'constellation').settings.count, 12);
  assert.equal(rigLabScene('voronoi-foam', 'constellation').settings.shape, 'icosahedron');
  assert.equal(rigLabScene('polyhedral-lattice', 'bridge').settings.unitCount, 4);
  assert.equal(rigLabScene('polyhedral-lattice', 'bridge').settings.detail, 2);
  assert.equal(rigLabScene('octopus', 'choir').settings.skin, 'abyss');
  assert.equal(rigLabScene('octopus', 'undertow').settings.skin, 'pearl');
  assert.equal(rigLabScene('pancakes', 'tower').settings.cakes.length, 5);
});

test('ant bodies, imported joint gait phases and alternating audible contacts share route distance', () => {
  const at = (cycle, id = 0) => antPose(ANT_DEFAULTS, cycle, true).colony[id];
  const first = at(0.11), next = at(0.22);
  assert.equal(first.moving, true);
  close(next.gaitCycles - first.gaitCycles, 2);
  close(next.progress - first.progress, 0.25);
  const arriving = at(0.44), turning = at(0.48), returning = at(0.5);
  close(arriving.gaitCycles, turning.gaitCycles);
  close(turning.gaitCycles, returning.gaitCycles);
  assert.equal(turning.moving, false);
  close(turning.position[0], arriving.position[0]);
  assert.equal(returning.moving, true);
  assert.deepEqual(antFootContacts(0.44, 0.4999, 0), []);
  const contacts = antFootContacts(0.01, 0.43, 0);
  assert.equal(contacts.length, 15);
  assert.deepEqual(contacts.slice(0, 4).map((step) => step.tripod), [1, 0, 1, 0]);
  assert.ok(contacts.every(({ cycle }) => at(cycle).moving));
  assert.equal(antFootContacts(0.44, 0.51, 0)[0].cycle, 0.5);
  assert.equal(antFootContacts(0, 1, 1).length, 32);
  assert.deepEqual(antFootContacts(0, 1, 0, 'dig'), []);
  assert.equal(antPose(ANT_DEFAULTS, 0.3, true, 'dig').colony[0].moving, false);
});

test('rig animation changes the same bounded sound settings that drive the visible source joints', () => {
  for (const id of ['voronoi-foam', 'polyhedral-lattice', 'octopus', 'pancakes',
    'mosquito', 'moth']) {
    const preset = rigLabScene(id, rigLabScenes(id)[1].id);
    const moving = animatedRigSettings(id, preset.settings, 0.25, true, preset.animation);
    assert.notDeepEqual(moving, preset.settings, `${id} must actually animate`);
    const stopped = animatedRigSettings(id, preset.settings, 0.25, false, preset.animation);
    assert.strictEqual(stopped, preset.settings);
    if (id === 'voronoi-foam') assert.ok(voronoiCells(moving)
      .some((cell, index) => Math.abs(cell.frequency -
        voronoiCells(preset.settings)[index].frequency) > 0.05));
  }
  const moth = mothPose(mothSettings({ ...MOTH_DEFAULTS, leftFold: 0.5, rightFold: 0.5 }), 0.25, true);
  close(moth.leftFlap, moth.rightFlap);
  close(moth.leftTip, moth.rightTip);
  close(moth.leftHz, moth.rightHz);
  close(MOTH_DEFAULTS.leftFold, MOTH_DEFAULTS.rightFold);
});

test('scripted pancake, source spatula and scheduled contacts form one continuous, reversible tour', () => {
  const preset = rigLabScene('pancakes', 'flip-stack');
  const pose = (phase) => pancakeScenePose(preset.settings, phase, true, preset.animation);
  const id = preset.settings.cakes.findIndex((cake) => cake.place === 'pan');
  for (const boundary of [0, 0.12, 0.28, 0.36, 0.42, 0.56, 0.6,
    0.68, 0.74, 0.88, 0.94, 1]) {
    const prior = pose(boundary - 1e-5), next = pose(boundary + 1e-5);
    assert.ok(Math.hypot(...prior.cakes[id].position.map((value, axis) =>
      value - next.cakes[id].position[axis])) < 0.03,
    `cake jumped at ${boundary}`);
    assert.ok(Math.hypot(...prior.spatulaPosition.map((value, axis) =>
      value - next.spatulaPosition[axis])) < 0.03,
    `spatula jumped at ${boundary}`);
  }
  assert.deepEqual(KITCHEN_SCENE_CONTACTS.map((contact) => contact.kind),
    ['land', 'scoop', 'stack', 'peel', 'land']);
  assert.equal(pose(0.17).cakes[id].airborne, true);
  assert.equal(pose(0.5).cakes[id].place, 'spatula');
  assert.equal(pose(0.62).cakes[id].place, 'plate');
  assert.equal(pose(0.62).stackCount, 3);
  assert.equal(pose(0.8).cakes[id].place, 'spatula');
  assert.equal(pose(0.96).cakes[id].place, 'pan');
  assert.equal(pose(0.96).stackCount, 2);
  assert.deepEqual(pose(0).cakes[id].position, pose(1).cakes[id].position);
});
