import * as THREE from '../../../vendor/three/three.module.min.js';
import { GLTFLoader } from '../../../vendor/three/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from '../../../vendor/three/utils/SkeletonUtils.js';
import { OCTOPUS_DEFAULTS } from '../../instruments/octopus/demo-model.js';
import { createOctopusSkins } from '../../instruments/octopus/demo-skins.js';

// Licensed Sketchfab animal/kitchen downloads. The mosquito is a skinned
// derivative; the geometry stages are owned by procedural-models.js instead.
const files = Object.freeze({
  antVfx: 'ant-vfx.glb',
  workerAnt: 'worker-ant.glb',
  mosquito: 'mosquito-rig.glb',
  moth: 'peacock-moth.glb',
  octopus: 'octopus-rig.glb',
  pan: 'pancake-pan.glb',
  stack: 'pancake-stack.glb',
  spatula: 'spatula.glb',
  butter: 'butter.glb',
});
const requirements = Object.freeze({
  'ant-farm': ['antVfx', 'workerAnt'],
  octopus: ['octopus'],
  pancakes: ['pan', 'stack', 'spatula', 'butter'],
  mosquito: ['mosquito'],
  moth: ['moth'],
});
const loadedMessage = {
  'ant-farm': 'Downloaded ants only: the Worker plays its source Walk/dig clips; the VFX source clip is not a walk, so its six imported leg chains follow a separate gait. No visible habitat is drawn.',
  octopus: 'Downloaded Dirk.z skinned creature, with four selectable UV-mapped artistic skins and adjustable PBR sheen. Its six long chains and two shorter appendages remain unchanged.',
  pancakes: 'Only downloaded pan, cakes, plate, spatula, syrup and butter are shown. Four source cakes are reused for a six-cake stack.',
  mosquito: 'Downloaded adarshktk textured mosquito only, skinned to 21 independently editable bones.',
  moth: 'Downloaded Osian CG moth only. Play samples its original full-body wing clip; fold, brush and span are independent overlays on that source animation.',
};

const proxyMaterial = new THREE.MeshBasicMaterial({
  colorWrite: false, depthWrite: false, side: THREE.DoubleSide,
});
const proxyGeometry = new THREE.SphereGeometry(1, 10, 8);
const boundsOf = (object) => {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty() || !Number.isFinite(box.min.x)) {
    throw new Error('Downloaded model has no usable mesh bounds');
  }
  return box;
};
const meshes = (root) => {
  const result = [];
  root.traverse((object) => { if (object.isMesh) result.push(object); });
  return result;
};

// GLBs may mirror a skeleton with a negative-scale ancestor. A local quaternion
// then rotates in the opposite world-space direction; account for that parity
// before converting the desired world hinge axis into the bone's rest frame.
function localHingeAxis(bone, worldDirection) {
  const basis = new THREE.Matrix3().setFromMatrix4(bone.matrixWorld);
  return worldDirection.clone().applyMatrix3(basis.invert())
    .multiplyScalar(Math.sign(bone.matrixWorld.determinant())).normalize();
}

function fittedScene(scene, longest, { ground = false } = {}) {
  // SkeletonUtils.clone is essential: ordinary Group.clone shares the *source*
  // bone objects between the three independently animated ant instances.
  const instance = cloneSkeleton(scene);
  instance.traverse((object) => {
    if (object.isLight || object.isCamera) object.visible = false;
  });
  const box = boundsOf(instance), size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scale = longest / Math.max(size.x, size.y, size.z);
  const adjustment = new THREE.Group();
  adjustment.scale.setScalar(scale);
  adjustment.position.set(-center.x * scale,
    ground ? -box.min.y * scale - 0.16 : -center.y * scale,
    -center.z * scale);
  adjustment.add(instance);
  const root = new THREE.Group();
  root.add(adjustment);
  return { root, instance, adjustment };
}

function hitArea(rig, parent, pick, position = [0, 0, 0], size = [0.2, 0.2, 0.2]) {
  // An interaction volume follows the imported anatomy; it is NEVER drawn.
  // Layer 1 is used by the raycaster and excluded from the camera.
  const object = new THREE.Mesh(proxyGeometry, proxyMaterial);
  object.layers.set(1);
  object.position.set(...position);
  object.scale.set(...size);
  object.userData.pick = pick;
  parent.add(object);
  rig.pickTargets.push(object);
  return object;
}

function bakeMesh(object) {
  object.updateWorldMatrix(true, false);
  const geometry = object.geometry.clone();
  geometry.applyMatrix4(object.matrixWorld);
  const mesh = new THREE.Mesh(geometry, object.material);
  mesh.userData.rigLabAsset = object.userData.rigLabAsset;
  return mesh;
}

function centerFlatMesh(object, diameter) {
  const box = boundsOf(object), size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  object.geometry.translate(-center.x, -center.y, -center.z);
  object.scale.setScalar(diameter / Math.max(size.x, size.z));
  return object;
}

function sourceMesh(scene, match) {
  const found = meshes(scene).find((object) => match(object.name));
  if (!found) throw new Error('Required separate mesh is missing from a downloaded model');
  return found;
}

function useAnts(rig, vfx, worker, currentStyle) {
  if (!vfx.animations.length || !worker.animations.some((clip) => clip.name === 'Walk')) {
    throw new Error('The downloaded ant pose and Worker walk clips are missing');
  }
  const hipIndices = [2, 9, 16, 23, 30, 37];
  const tripod = [0, 1, 0, 1, 0, 1];
  const turn = new THREE.Quaternion();
  const antPairs = Array.from({ length: 3 }, (_, index) => {
    const actor = new THREE.Group();
    rig.root.add(actor);
    hitArea(rig, actor, { kind: 'ant', index }, [0, 0, 0], [0.32, 0.23, 0.24]);
    const build = (gltf, clips) => {
      const fitted = fittedScene(gltf.scene, 0.88, { ground: true });
      fitted.root.rotation.y = Math.PI / 2; // source long axis +Z -> tunnel +X
      actor.add(fitted.root);
      const mixer = new THREE.AnimationMixer(fitted.instance);
      const actions = Object.fromEntries(clips.map((clip) =>
        [clip.name, mixer.clipAction(clip)]));
      const action = actions.Walk ?? Object.values(actions)[0];
      action.play();
      return { ...fitted, mixer, actions, action };
    };
    const vfxActor = build(vfx, [vfx.animations[0]]);
    // This downloaded 0.7-second clip changes the VFX model's pose; it is NOT
    // a walk. Hold it as an animated rest shape and actuate its *source* six
    // hip/knee chains directly rather than sliding a static mesh along a path.
    vfxActor.mixer.setTime(0.22);
    vfxActor.instance.updateWorldMatrix(true, true);
    const sourceBones = [];
    vfxActor.instance.traverse((object) => { if (object.isBone) sourceBones.push(object); });
    if (sourceBones.length !== 82) throw new Error('The downloaded VFX ant has lost its leg skeleton');
    vfxActor.legs = hipIndices.map((boneIndex, legIndex) => {
      const hip = sourceBones[boneIndex], knee = sourceBones[boneIndex + 1];
      if (knee.parent !== hip) throw new Error('The VFX ant hip/knee hierarchy has changed');
      const side = legIndex < 3 ? 1 : -1;
      return {
        hip, knee, side, tripod: tripod[legIndex],
        hipRest: hip.quaternion.clone(), kneeRest: knee.quaternion.clone(),
        swingAxis: localHingeAxis(hip, new THREE.Vector3(0, 1, 0)),
        liftAxis: localHingeAxis(knee, new THREE.Vector3(-side, 0, 0)),
      };
    });
    return {
      actor,
      vfx: vfxActor,
      worker: build(worker, ['Walk', 'dig'].map((name) =>
        worker.animations.find((clip) => clip.name === name)).filter(Boolean)),
    };
  });
  const applyStyle = (style) => antPairs.forEach((pair, index) => {
    pair.vfx.root.visible = style === 'vfx' || style === 'mixed' && index !== 1;
    pair.worker.root.visible = style === 'worker' || style === 'mixed' && index === 1;
  });
  applyStyle(currentStyle());
  return {
    bones: 82 * 3 + 53 * 3,
    setAntStyle: applyStyle,
    antActors: () => antPairs.map(({ actor, vfx: source, worker: walker }) => ({
      position: actor.position.toArray(),
      variant: walker.root.visible ? 'worker' : 'vfx',
      activeClip: walker.root.visible ? walker.action.getClip().name : 'procedural source leg joints',
      hips: source.legs.map(({ hip }) => hip.quaternion.toArray()),
      knees: source.legs.map(({ knee }) => knee.quaternion.toArray()),
      clipTime: walker.action.time,
    })),
    update(pose) {
      antPairs.forEach((pair, index) => {
        const ant = pose.colony[index];
        pair.actor.position.set(...ant.position);
        pair.actor.rotation.y = ant.heading;
        pair.actor.scale.setScalar(index === pose.selected ? 1.05 : 0.85);
        if (pair.worker.root.visible) {
          const walker = pair.worker;
          const desired = pose.motion === 'dig' && walker.actions.dig ? 'dig' : 'Walk';
          if (walker.action !== walker.actions[desired]) {
            walker.action.stop();
            walker.action = walker.actions[desired].reset().play();
          }
          // The source Walk clip contains THREE strides. Each modeled gait
          // cycle is one stride (and two audible tripod contacts), including
          // the stationary frames held at both turning points.
          const clip = walker.action.getClip();
          const timeline = desired === 'dig' ? ant.actionPhase * clip.duration
            : ant.gaitCycles / 3 * clip.duration;
          walker.mixer.setTime(timeline);
        } else {
          const source = pair.vfx;
          source.mixer.setTime(0.22 + (pose.motion === 'dig' ?
            0.045 * Math.sin(ant.actionPhase * Math.PI * 4) : 0));
          for (const leg of source.legs) {
            const phase = Math.PI * 2 * (ant.gaitCycles + leg.tripod * 0.5);
            const swing = pose.motion === 'dig'
              ? 0.07 * Math.sin(ant.actionPhase * Math.PI * 4 + leg.tripod * Math.PI)
              : Math.cos(phase) * 0.26;
            const lift = pose.motion === 'dig'
              ? 0.065 : Math.max(0, -Math.sin(phase)) * 0.31;
            leg.hip.quaternion.copy(leg.hipRest).multiply(
              turn.setFromAxisAngle(leg.swingAxis, leg.side * swing));
            leg.knee.quaternion.copy(leg.kneeRest).multiply(
              turn.setFromAxisAngle(leg.liftAxis, lift));
          }
        }
      });
    },
    dispose() {
      antPairs.forEach((pair) => {
        for (const variant of [pair.vfx, pair.worker]) {
          variant.mixer.stopAllAction();
          variant.mixer.uncacheRoot(variant.instance);
          variant.root.removeFromParent();
        }
        pair.actor.removeFromParent();
      });
      rig.pickTargets.length = 0;
    },
  };
}

function useMoth(rig, gltf) {
  const clip = gltf.animations.find((animation) => animation.name === 'Animation');
  if (!clip || !clip.tracks.length || !(clip.duration > 0)) {
    throw new Error('The downloaded Peacock moth animation is missing');
  }
  const model = fittedScene(gltf.scene, 2.9);
  // Object_102 inherits a mirrored (-X) parent: its exported normals point
  // into the wing instead of toward its dorsal (+Y) face. Object_9 already
  // has outward-facing normals. Correct only the mirrored copy's normals so
  // both imported membranes receive the overhead lights on their top sides;
  // retain the source textures, tangents, bones and GLB unchanged.
  const mirroredSurface = sourceMesh(model.instance, (name) => name === 'Object_102');
  const correctedGeometry = mirroredSurface.geometry.clone();
  const normals = correctedGeometry.getAttribute('normal');
  if (!normals) throw new Error('The downloaded moth wing has no shading normals');
  for (let i = 0; i < normals.count; i += 1) {
    normals.setXYZ(i, -normals.getX(i), -normals.getY(i), -normals.getZ(i));
  }
  normals.needsUpdate = true;
  mirroredSurface.geometry = correctedGeometry;
  // Sample the exported animation on this clone, not the loader's shared
  // scene. Its wing tips, feelers and torso all have authored keyframes.
  const mixer = new THREE.AnimationMixer(model.instance);
  mixer.clipAction(clip).play();
  mixer.setTime(0);
  model.instance.updateWorldMatrix(true, true);
  const bones = [];
  model.instance.traverse((object) => {
    if (object.isBone) bones.push(object);
  });
  const pair = (prefix) => bones.filter((bone) => bone.name.startsWith(prefix))
    .sort((a, b) => a.getWorldPosition(new THREE.Vector3()).x -
      b.getWorldPosition(new THREE.Vector3()).x);
  const fore = pair('Wing_F_1_R_'), hind = pair('Wing_HF_1_R_');
  const distal = pair('Wing_M_3_R_');
  if (fore.length !== 2 || hind.length !== 2 || distal.length !== 2 ||
      meshes(model.instance).filter((mesh) =>
    mesh.isSkinnedMesh).length < 2) {
    throw new Error('Peacock moth needs two independently skinned fore-/hindwing pairs');
  }
  const wings = [0, 1].map((index) => ({
    fore: { bone: fore[index], source: fore[index].quaternion.clone() },
    hind: { bone: hind[index], source: hind[index].quaternion.clone() },
  }));
  rig.root.add(model.root);
  model.root.updateWorldMatrix(true, true);
  wings.forEach(({ fore: front, hind: rear }, index) => {
    // Both wings fold toward the same depth and both flap upward. Convert the
    // mirrored side through its negative-determinant ancestor, not by
    // assuming identical local quaternion signs.
    const side = index === 0 ? 1 : -1;
    for (const part of [front, rear]) {
      part.foldAxis = localHingeAxis(part.bone, new THREE.Vector3(0, side, 0));
      part.flapAxis = localHingeAxis(part.bone, new THREE.Vector3(0, 0, -side));
    }
    front.tip = front.bone.children.find((child) => child.isBone)
      ?.children.find((child) => child.isBone) ?? front.bone;
    rear.tip = rear.bone.children.find((child) => child.isBone) ?? rear.bone;
  });
  const wingMeshes = meshes(model.instance).filter((object) =>
    object.isSkinnedMesh && !object.name.startsWith('Object_8'))
    .sort((a, b) => boundsOf(a).getCenter(new THREE.Vector3()).x -
      boundsOf(b).getCenter(new THREE.Vector3()).x);
  if (wingMeshes.length !== 2) {
    throw new Error('The imported moth has no separate pickable wing surfaces');
  }
  wingMeshes.forEach((mesh, index) => {
    mesh.userData.pick = {
      kind: 'wing', side: index === 0 ? 'left' : 'right',
      imported: true, extent: 0.52,
    };
    rig.pickTargets.push(mesh);
  });
  // Add musician-controlled folds to the authored base pose AFTER sampling
  // every track. Never replace the root quaternions or distal keyed joints.
  const foldTurn = new THREE.Quaternion(), flapTurn = new THREE.Quaternion();
  const flashes = { left: 0, right: 0 };
  let phase = 0;
  return {
    bones: bones.length,
    sourceAnimation: () => ({
      clip: clip.name, tracks: clip.tracks.length, duration: clip.duration, phase,
      distal: distal.map((bone) => bone.quaternion.toArray()),
    }),
    wingTips() {
      model.root.updateWorldMatrix(true, true);
      return wings.map(({ fore: front, hind: rear }) => ({
        fore: front.tip.getWorldPosition(new THREE.Vector3()).toArray(),
        hind: rear.tip.getWorldPosition(new THREE.Vector3()).toArray(),
      }));
    },
    flashWing(side) { if (side in flashes) flashes[side] = 0.32; },
    update(pose) {
      phase = pose.phase;
      // AnimationMixer omits writes for unchanged keyed values. Restore the
      // last sampled root poses first, or a held/paused phase would accumulate
      // the musician's additive fold on every display frame.
      for (const { fore: front, hind: rear } of wings) {
        for (const part of [front, rear]) part.bone.quaternion.copy(part.source);
      }
      mixer.setTime(phase * clip.duration);
      wings.forEach(({ fore: front, hind: rear }, index) => {
        const left = index === 0, side = left ? 'left' : 'right';
        const fold = left ? pose.leftFold : pose.rightFold;
        const flap = (left ? pose.leftFlap : pose.rightFlap) + flashes[side];
        for (const [part, amount] of [[front, 1], [rear, 0.72]]) {
          part.source.copy(part.bone.quaternion);
          foldTurn.setFromAxisAngle(part.foldAxis, fold * amount * 1.1);
          flapTurn.setFromAxisAngle(part.flapAxis, flap * amount);
          part.bone.quaternion.multiply(foldTurn).multiply(flapTurn);
        }
        flashes[side] *= 0.82;
      });
      model.root.scale.x = pose.span;
    },
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(model.instance);
      correctedGeometry.dispose();
      rig.pickTargets.length = 0;
      model.root.removeFromParent();
    },
  };
}

function useMosquito(rig, gltf) {
  const model = fittedScene(gltf.scene, 3.15);
  const sourceScale = model.adjustment.scale.x;
  // Fit around the source *thorax*, not the end of its long abdomen. Its
  // physical wing roots then coincide with the musical wing handles.
  model.adjustment.position.set(0, -0.55 * sourceScale, 0.55 * sourceScale);
  const bones = new Map();
  model.instance.traverse((object) => {
    if (object.isBone) bones.set(object.name, object);
  });
  const parts = meshes(model.instance);
  const part = (name) => parts.find((object) => object.name === name);
  const wingMeshes = [part('wing_left_surface'), part('wing_right_surface')];
  const legMeshes = [
    part('leg_left_front'), part('leg_right_front'),
    part('leg_left_middle'), part('leg_right_middle'),
    part('leg_left_rear'), part('leg_right_rear'),
  ];
  const required = [
    'thorax', 'head', 'abdomen', 'probe', 'wing_left', 'wing_right',
    ...['left', 'right'].flatMap((side) => ['front', 'middle', 'rear']
      .flatMap((section) => [`leg_${side}_${section}_hip`, `leg_${side}_${section}_knee`])),
  ];
  const missingBones = required.filter((name) => !bones.has(name));
  const missingSurfaces = ['wing_left_surface', 'wing_right_surface', 'body_shell', 'proboscis',
    'head_shell', 'leg_left_front', 'leg_right_front', 'leg_left_middle', 'leg_right_middle',
    'leg_left_rear', 'leg_right_rear'].filter((name) => !part(name)?.isSkinnedMesh);
  if (bones.size < 21 || missingBones.length || missingSurfaces.length) {
    throw new Error(`Mosquito rig is missing joints/surfaces: ${[
      ...missingBones, ...missingSurfaces, ...(bones.size < 21 ? [`${bones.size} of 21 bones`] : []),
    ].join(', ')}`);
  }
  rig.root.add(model.root);
  model.instance.updateMatrixWorld(true);

  const bind = (name, axis) => {
    const bone = bones.get(name);
    const world = bone.getWorldQuaternion(new THREE.Quaternion());
    return {
      bone,
      rest: bone.quaternion.clone(),
      axis: axis.clone().applyQuaternion(world.invert()).normalize(),
    };
  };
  const x = new THREE.Vector3(1, 0, 0), z = new THREE.Vector3(0, 0, 1);
  const wings = [bind('wing_left', z), bind('wing_right', z)];
  const probe = bind('probe', x), abdomen = bind('abdomen', x);
  const legs = [0, 1, 2, 3, 4, 5].map((index) => {
    const section = ['front', 'middle', 'rear'][Math.floor(index / 2)];
    const side = index % 2 ? 'right' : 'left';
    return {
      hip: bind(`leg_${side}_${section}_hip`, z),
      knee: bind(`leg_${side}_${section}_knee`, x),
    };
  });
  const turn = new THREE.Quaternion();
  const poseBone = (joint, radians) =>
    joint.bone.quaternion.copy(joint.rest).multiply(
      turn.setFromAxisAngle(joint.axis, radians));

  // Only the imported skinned surfaces are raycast targets. No substitute
  // mosquito is constructed during loading or when the download is missing.
  const targets = [
    { mesh: part('body_shell'), kind: 'body' },
    { mesh: part('head_shell'), kind: 'body' },
    { mesh: part('proboscis'), kind: 'probe' },
    ...wingMeshes.map((mesh, index) => ({
      mesh, kind: 'wing', side: index ? 'right' : 'left',
    })),
    ...legMeshes.map((mesh, index) => ({ mesh, kind: 'leg', index })),
  ];
  for (const target of targets) {
    target.mesh.userData.pick = { kind: target.kind, side: target.side, index: target.index,
      imported: true };
  }
  rig.pickTargets.unshift(...targets.map(({ mesh }) => mesh));
  return {
    bones: bones.size,
    jointPose() {
      return {
        wings: wings.map(({ bone }) => bone.quaternion.toArray()),
        probe: probe.bone.quaternion.toArray(),
        legs: legs.map(({ hip, knee }) => [
          hip.bone.quaternion.toArray(), knee.bone.quaternion.toArray(),
        ]),
      };
    },
    update(pose, seconds) {
      rig.root.position.set(pose.position.x, pose.position.y, pose.position.z);
      model.root.rotation.y = pose.bodyYaw;
      model.root.rotation.z = -pose.position.x * 0.09;
      poseBone(wings[0], pose.leftWing);
      poseBone(wings[1], pose.rightWing);
      poseBone(probe, pose.probe);
      poseBone(abdomen, pose.abdomen);
      legs.forEach(({ hip, knee }, index) => {
        const sign = index % 2 ? 1 : -1;
        const bend = pose.legCurls[index];
        const flutter = pose.flight ? 0.075 * Math.sin(seconds * 6 + index * 1.3) : 0;
        poseBone(hip, sign * (bend * 0.45 + flutter));
        poseBone(knee, bend * 0.37 + flutter * 0.4);
      });
    },
    dispose() {
      rig.pickTargets.length = 0;
      model.root.removeFromParent();
    },
  };
}

function useOctopus(rig, gltf) {
  const model = fittedScene(gltf.scene, 3.25);
  const names = ['001', '019', '037', '055', '073', '091', '112', '114'];
  const roots = names.map((name) => {
    let found;
    model.instance.traverse((object) => {
      // Three.js sanitizes punctuation in downloaded glTF node names.
      if (object.isBone && object.name.startsWith(`Bone${name}_`)) found = object;
    });
    return found;
  });
  const sourceMeshes = meshes(model.instance);
  const skinMesh = sourceMeshes[0];
  if (roots.some((root) => !root) || sourceMeshes.length !== 1 ||
      !skinMesh.isSkinnedMesh || !skinMesh.geometry.getAttribute('uv') ||
      !skinMesh.material?.isMeshStandardMaterial) {
    throw new Error('Octopus source lacks the expected UV-mapped skinned branches');
  }
  const skins = createOctopusSkins(skinMesh.material);
  // Asset status may be read before the first animation frame. Apply the
  // default material immediately so inspection never sees an untextured
  // source material or tries to read a missing map.
  skins.update(skinMesh, OCTOPUS_DEFAULTS.skin, OCTOPUS_DEFAULTS.wetness);
  const center = roots.slice(0, 6).reduce((sum, bone) =>
    sum.add(bone.getWorldPosition(new THREE.Vector3())), new THREE.Vector3()).divideScalar(6);
  const remaining = new Set(Array.from({ length: 8 }, (_, index) => index));
  const branches = roots.map((root) => {
    const point = root.getWorldPosition(new THREE.Vector3()).sub(center);
    const angle = Math.atan2(point.z, point.x);
    const index = [...remaining].sort((a, b) =>
      Math.abs(Math.atan2(Math.sin(angle - a * Math.PI / 4),
        Math.cos(angle - a * Math.PI / 4))) -
      Math.abs(Math.atan2(Math.sin(angle - b * Math.PI / 4),
        Math.cos(angle - b * Math.PI / 4))))[0];
    remaining.delete(index);
    const chain = [];
    let bone = root;
    while (bone?.isBone && chain.length < 6) {
      chain.push({ bone, rest: bone.quaternion.clone(), size: bone.scale.clone() });
      bone = bone.children.find((child) => child.isBone);
    }
    return { index, chain };
  });
  const mantle = model.instance.getObjectByName('Bone_02');
  const mantleRest = mantle?.scale.clone();
  rig.root.add(model.root);
  const mantleHit = hitArea(rig, rig.root, { kind: 'mantle' },
    [0, 0.36, 0], [0.37, 0.32, 0.37]);
  const tips = branches.map(({ index, chain }) => ({
    bone: chain.at(-1).bone,
    hit: hitArea(rig, rig.root, { kind: 'arm', index },
      [0, 0, 0], [0.19, 0.19, 0.19]),
  }));
  const q = new THREE.Quaternion(), axis = new THREE.Vector3(0, 0, 1);
  const world = new THREE.Vector3();
  return {
    bones: 128,
    skinState: () => skins.getState(skinMesh),
    // The download has SIX long chains, not eight: the last two controls
    // manipulate short appendages, never fictitious "imported octopus arms".
    update(pose) {
      skins.update(skinMesh, pose.skin, pose.wetness);
      for (const { index, chain } of branches) {
        const { curl, length } = pose.arms[index];
        const stretch = length / OCTOPUS_DEFAULTS.lengths[index];
        chain.forEach(({ bone, rest, size }, part) => {
          const bend = (curl - OCTOPUS_DEFAULTS.curls[index]) * (0.2 + 0.07 * part)
            + pose.current * 0.06;
          bone.quaternion.copy(rest).multiply(q.setFromAxisAngle(axis, bend));
          if (part === 0) bone.scale.copy(size).multiplyScalar(stretch);
        });
      }
      if (mantle && mantleRest) {
        mantle.scale.copy(mantleRest);
        mantle.scale.y *= 1 - (pose.pressure - OCTOPUS_DEFAULTS.grip) * 0.28;
      }
      rig.root.updateWorldMatrix(true, true);
      if (mantle) mantleHit.position.copy(rig.root.worldToLocal(
        mantle.getWorldPosition(world)));
      for (const { bone, hit } of tips) {
        hit.position.copy(rig.root.worldToLocal(bone.getWorldPosition(world)));
      }
    },
    dispose() {
      model.root.removeFromParent();
      mantleHit.removeFromParent();
      for (const { hit } of tips) hit.removeFromParent();
      rig.pickTargets.length = 0;
      skins.dispose();
    },
  };
}

function usePancakes(rig, panAsset, stackAsset, spatulaAsset, butterAsset) {
  const sourceCakes = ['001', '002', '003', '004'].map((part) =>
    sourceMesh(stackAsset.scene, (name) =>
      name.startsWith(`Cylinder${part}_Material`)));
  // The downloaded stack contains four physically distinct cake meshes,
  // plus separable plate, butter and syrup. Reuse its cakes for up to six.
  const sourcePlate = sourceMesh(stackAsset.scene, (name) => name.includes('Cylinder_Plate'));
  const sourceSyrup = sourceMesh(stackAsset.scene, (name) => name.includes('MapleSyrup'));
  const pan = new THREE.Group(), spatula = new THREE.Group();
  pan.position.y = -0.42;
  rig.root.add(pan, spatula);
  const realPan = bakeMesh(sourceMesh(panAsset.scene, () => true));
  const panBounds = boundsOf(realPan).getSize(new THREE.Vector3());
  realPan.scale.setScalar(2.65 / Math.max(panBounds.x, panBounds.z));
  realPan.rotation.y = -Math.PI / 2; // source handle +Z -> playable +X
  realPan.position.y = -0.08;
  realPan.userData.pick = { kind: 'pan' };
  pan.add(realPan);
  // The downloaded handle has a narrow projected silhouette; an invisible
  // grab volume makes the *real* handle usable without drawing a second one.
  const handleHit = hitArea(rig, pan, { kind: 'pan' },
    [1.42, 0.05, 0], [0.4, 0.18, 0.18]);
  rig.pickTargets.push(realPan);

  const realPlate = centerFlatMesh(bakeMesh(sourcePlate), 1.62);
  realPlate.position.set(-1.58, -0.48, 0);
  realPlate.userData.pick = { kind: 'plate' };
  rig.root.add(realPlate);
  rig.pickTargets.push(realPlate);
  const tools = fittedScene(spatulaAsset.scene, 1.2);
  tools.root.rotation.y = Math.PI;
  tools.root.position.set(0.08, -0.13, 0);
  spatula.add(tools.root);
  const toolMeshes = meshes(tools.instance);
  if (!toolMeshes.length) throw new Error('Downloaded spatula has no separate tool meshes');
  for (const mesh of toolMeshes) {
    mesh.userData.pick = { kind: 'spatula' };
    rig.pickTargets.push(mesh);
  }

  const butterSource = sourceMesh(butterAsset.scene, () => true);
  const realButter = centerFlatMesh(bakeMesh(butterSource), 0.24);
  const butterScale = realButter.scale.y;
  realButter.position.set(0.44, 0.14, -0.3);
  realButter.userData.pick = { kind: 'butter' };
  pan.add(realButter);
  rig.pickTargets.push(realButter);
  const plateButter = realButter.clone();
  rig.root.add(plateButter);
  const realCakes = Array.from({ length: 6 }, (_, index) => {
    const group = new THREE.Group();
    rig.root.add(group);
    const cake = centerFlatMesh(bakeMesh(sourceCakes[index % 4]), 1.15);
    cake.userData.pick = { kind: 'pancake', index };
    group.add(cake);
    rig.pickTargets.push(cake);
    const syrup = centerFlatMesh(bakeMesh(sourceSyrup), 0.82);
    syrup.position.y = 0.064;
    group.add(syrup);
    return { group, cake, syrup };
  });
  return {
    bones: 0,
    update(pose, seconds) {
      pan.rotation.z = pose.tilt;
      spatula.position.set(...pose.spatulaPosition);
      spatula.rotation.z = pose.cakes.some((cake) => cake.place === 'spatula') ? 0
        : pose.airborne ? -0.23 : 0.07 * Math.sin(seconds * 0.7);
      realButter.visible = pose.butter > 0.03;
      realButter.scale.y = butterScale * Math.max(0.3, 1 - pose.heat * 0.42)
        * (0.55 + pose.butter * 0.7);
      plateButter.visible = pose.stackCount > 0 && pose.butter > 0.03;
      plateButter.position.set(-1.58, -0.32 + (pose.stackCount - 1) * 0.11, 0);
      plateButter.scale.copy(realButter.scale);
      realCakes.forEach(({ group, syrup }, index) => {
        const state = pose.cakes[index];
        group.visible = Boolean(state);
        if (!state) return;
        group.position.set(...state.position);
        group.rotation.set(...state.rotation);
        const coverage = state.syrup;
        syrup.visible = coverage > 0.03;
        syrup.scale.setScalar(0.35 + coverage * 0.65);
      });
    },
    dispose() {
      for (const object of [realPan, realPlate, realButter, ...realCakes.flatMap((cake) =>
        [cake.cake, cake.syrup])]) object.geometry.dispose();
      pan.removeFromParent();
      spatula.removeFromParent();
      realPlate.removeFromParent();
      plateButter.removeFromParent();
      for (const { group } of realCakes) group.removeFromParent();
      handleHit.removeFromParent();
      rig.pickTargets.length = 0;
    },
  };
}

/** Lazily load animal/kitchen downloads; failed imports leave their stage empty. */
export function createDownloadedModels(rigs, onStatus = () => {}) {
  const loader = new GLTFLoader();
  const requests = new Map(), drivers = new Map(), state = new Map();
  let active = null, disposed = false, antStyle = 'mixed';
  for (const id of Object.keys(requirements)) state.set(id, { status: 'idle', bones: 0 });
  function setStatus(id, status, note = '') {
    state.set(id, { status, bones: drivers.get(id)?.bones ?? 0 });
    if (!disposed && active === id) onStatus(note, status);
  }
  function load(key) {
    if (!requests.has(key)) {
      const url = new URL(`../../../assets/rig-lab/${files[key]}`, import.meta.url);
      requests.set(key, loader.loadAsync(url.href).then((gltf) => {
        gltf.scene.traverse((object) => {
          if (!object.isMesh) return;
          object.userData.rigLabAsset = key;
          // Preserve every original color/normal map. A few source materials
          // are near-perfect mirrors, which erase their form under moving
          // lights; limit only those extremes on the imported PBR material.
          if (key === 'workerAnt') for (const material of [object.material].flat()) {
            if (material?.isMeshStandardMaterial) {
              material.roughness = Math.max(0.36, material.roughness);
              material.metalness = Math.min(0.3, material.metalness);
            }
          }
        });
        return gltf;
      }));
    }
    return requests.get(key);
  }
  function attach(id, assets) {
    switch (id) {
      case 'ant-farm': return useAnts(rigs[id], assets[0], assets[1], () => antStyle);
      case 'mosquito': return useMosquito(rigs[id], assets[0]);
      case 'moth': return useMoth(rigs[id], assets[0]);
      case 'octopus': return useOctopus(rigs[id], assets[0]);
      case 'pancakes': return usePancakes(rigs[id], ...assets);
      default: return null;
    }
  }
  async function activate(id) {
    active = id;
    if (drivers.has(id)) {
      onStatus(loadedMessage[id], 'ready');
      return;
    }
    if (state.get(id)?.status === 'loading') {
      onStatus(`Loading downloaded ${id.replaceAll('-', ' ')} meshes…`, 'loading');
      return;
    }
    setStatus(id, 'loading', `Loading downloaded ${id.replaceAll('-', ' ')} meshes…`);
    try {
      const assets = await Promise.all(requirements[id].map(load));
      if (disposed) return;
      const driver = attach(id, assets);
      drivers.set(id, driver);
      setStatus(id, 'ready', loadedMessage[id]);
    } catch (error) {
      // Import validation can fail after some children were attached. Never
      // expose a partial download as a playable replacement or a fallback.
      rigs[id].root.clear();
      rigs[id].pickTargets.length = 0;
      console.warn(`Rig Lab: ${id} model import failed`, error);
      setStatus(id, 'error', `Downloaded model could not be loaded: ${error.message}. The 3D stage is empty; labelled sound controls still work. No substitute model is shown.`);
    }
  }
  return {
    activate,
    deactivate() { active = null; },
    update(pose, seconds) { drivers.get(active)?.update(pose, seconds); },
    setAntStyle(style) {
      antStyle = ['mixed', 'vfx', 'worker'].includes(style) ? style : 'mixed';
      drivers.get('ant-farm')?.setAntStyle?.(antStyle);
    },
    flashWing(side) { drivers.get('moth')?.flashWing?.(side); },
    getState() {
      return {
        antStyle,
        models: Object.fromEntries(state),
        activeDownloaded: state.get(active)?.status === 'ready',
        antActors: drivers.get('ant-farm')?.antActors?.() ?? null,
        mothWingTips: drivers.get('moth')?.wingTips?.() ?? null,
        mothSource: drivers.get('moth')?.sourceAnimation?.() ?? null,
        mosquitoJoints: drivers.get('mosquito')?.jointPose?.() ?? null,
        octopusSkin: drivers.get('octopus')?.skinState?.() ?? null,
      };
    },
    dispose() {
      disposed = true;
      for (const driver of drivers.values()) driver.dispose();
      // Each loaded GLB owns its geometry, material and embedded texture maps;
      // skinned ant instances share them and must be disposed only once.
      const geometry = new Set(), material = new Set(), texture = new Set();
      for (const request of requests.values()) {
        void request.then(({ scene }) => scene.traverse((object) => {
          if (object.geometry) geometry.add(object.geometry);
          for (const item of [object.material].flat().filter(Boolean)) material.add(item);
        })).then(() => {
          for (const item of material) {
            for (const value of Object.values(item)) if (value?.isTexture) texture.add(value);
          }
          geometry.forEach((item) => item.dispose());
          material.forEach((item) => item.dispose());
          texture.forEach((item) => item.dispose());
        }).catch(() => {});
      }
      proxyMaterial.dispose();
      proxyGeometry.dispose();
    },
  };
}
