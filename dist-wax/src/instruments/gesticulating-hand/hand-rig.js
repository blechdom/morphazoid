import * as THREE from '../../../vendor/three/three.module.min.js';
import { sampleSourceGrasp, SOURCE_BONE_NAMES, SOURCE_ANCESTOR_NAMES,
  SOURCE_OPEN_ROTATIONS, SOURCE_OPEN_ANCESTOR_ROTATIONS } from './hand-source-motion.js';

const RAD = Math.PI / 180;
const DIGITS = ['thumb', 'index', 'middle', 'ring', 'pinky'];
const KEYS = ['mcp', 'pip', 'dip'];
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const vector = value => new THREE.Vector3().fromArray(value);
const quat = value => new THREE.Quaternion().fromArray(value);

/** Calibrate the artist's weighted hand rig against its original Open/Close
 * animation. The caller owns materials, imported lights/cameras, and disposal
 * of the GLTF's geometry/textures; this helper owns only the animation mixer. */
export function createHandRig(gltf, report) {
  const group = new THREE.Group(), orientation = new THREE.Group();
  const model = gltf.scene;
  group.add(orientation);
  orientation.add(model);
  const bones = [], meshes = [], deformMap = new Map(), calibration = new Map();
  const inverse = new THREE.Quaternion(), restNormal = new THREE.Vector3(0, 0, 1);
  const rotation = new THREE.Quaternion(), sourceRotation = new THREE.Quaternion();
  let sourceSample, disposed = false;

  model.traverse(object => {
    if (object.isBone) bones.push(object);
    if (object.isMesh) {
      meshes.push(object);
      object.frustumCulled = false;
    }
  });
  function findBone(prefix) {
    return bones.find(bone => bone.name.startsWith(prefix) && !bone.name.includes('Ctrl') && !bone.name.includes('_end'));
  }
  if (!meshes.some(mesh => mesh.isSkinnedMesh) || bones.length < 20) {
    throw new Error('The hand is missing its skinning rig.');
  }
  const mixer = new THREE.AnimationMixer(model);
  if (gltf.animations[0]) {
    mixer.clipAction(gltf.animations[0]).play();
    mixer.setTime(0);
  }
  model.updateMatrixWorld(true);
  for (const mesh of meshes) mesh.skeleton?.update();
  for (const entry of report.deformBones) {
    const bone = bones.find(bone => bone.name === entry.threeName);
    if (!bone) continue;
    deformMap.set(bone.name, bone);
    const axis = vector(entry.openToClosed.axis);
    if (axis.lengthSq() < .01) axis.set(0, 0, 1);
    calibration.set(bone.name, {
      open: quat(entry.sampledLocal.open.rotation), axis,
      closeAngle: entry.openToClosed.angleRadians,
      spreadAxis: new THREE.Vector3(1, 0, 0),
    });
  }
  const wrist = findBone('handR_02'), palm = findBone('handR001') ?? wrist;
  const wristPoint = wrist.getWorldPosition(new THREE.Vector3());
  const middle = findBone('middle_01').getWorldPosition(new THREE.Vector3());
  const across = findBone('index_01').getWorldPosition(new THREE.Vector3())
    .sub(findBone('pinky_01').getWorldPosition(new THREE.Vector3())).normalize();
  const up = middle.sub(wristPoint).normalize();
  const normal = new THREE.Vector3().crossVectors(across, up).normalize();
  const right = new THREE.Vector3().crossVectors(up, normal).normalize();
  orientation.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, normal)).invert();
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model, true);
  const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
  const scale = 2.85 / size.y;
  group.scale.setScalar(scale);
  group.position.copy(center).multiplyScalar(-scale);
  group.updateMatrixWorld(true);
  const bounds = size.multiplyScalar(scale);
  for (const [name, entry] of calibration) {
    const bone = deformMap.get(name);
    bone.getWorldQuaternion(inverse).invert();
    entry.spreadAxis.copy(restNormal).applyQuaternion(inverse).normalize();
  }
  const palmRest = palm.quaternion.clone(), wristRest = wrist.quaternion.clone();
  wrist.getWorldQuaternion(inverse).invert();
  wrist.userData.flexAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(inverse).normalize();
  wrist.userData.sideAxis = new THREE.Vector3(0, 0, 1).applyQuaternion(inverse).normalize();
  wrist.userData.twistAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(inverse).normalize();
  const tips = [];
  const digits = DIGITS.map(digit => {
    const tip = bones.find(bone => bone.name.startsWith(digit + '_03R_end'));
    if (tip) tips.push(tip);
    return KEYS.map((key, joint) => ({
      key,
      bone: findBone(`${digit}_0${joint + 1}`),
      end: joint < 2 ? findBone(`${digit}_0${joint + 2}`) : tip,
    }));
  });

  function setPose(pose) {
    if (disposed || !pose) return;
    // Preserve the original open bind transforms and change only joint rotations.
    for (const [name, entry] of calibration) {
      const bone = deformMap.get(name);
      if (bone) bone.quaternion.copy(entry.open);
    }
    if (palm && palmRest) palm.quaternion.copy(palmRest);
    if (pose.source) {
      sourceSample = sampleSourceGrasp(pose.source.phase, sourceSample);
      for (let i = 0; i < SOURCE_BONE_NAMES.length; i++) {
        const bone = deformMap.get(SOURCE_BONE_NAMES[i]);
        if (bone) bone.quaternion.fromArray(SOURCE_OPEN_ROTATIONS[i])
          .slerp(sourceRotation.fromArray(sourceSample.rotations[i]), pose.source.amount);
      }
      for (let i = 0; i < SOURCE_ANCESTOR_NAMES.length; i++) {
        const bone = bones.find(bone => bone.name === SOURCE_ANCESTOR_NAMES[i]);
        if (bone) bone.quaternion.fromArray(SOURCE_OPEN_ANCESTOR_ROTATIONS[i])
          .slerp(sourceRotation.fromArray(sourceSample.ancestorRotations[i]), pose.source.amount);
      }
    }
    for (let f = 0; f < 5; f++) {
      const digit = pose.fingers[f];
      for (let j = 0; j < 3; j++) {
        const bone = findBone(`${DIGITS[f]}_0${j + 1}`), entry = bone && calibration.get(bone.name);
        if (!entry) continue;
        if (!pose.source) bone.quaternion.copy(entry.open);
        const offset = pose.source?.offsets[f][KEYS[j]] ?? 0;
        bone.quaternion.multiply(rotation.setFromAxisAngle(entry.axis, (digit[KEYS[j]] - offset) * RAD));
        if (j === 0) {
          // Splay is around the palm normal expressed in this joint's local frame.
          bone.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(entry.spreadAxis, digit.spread * RAD));
        }
      }
      const base = findBone(`${DIGITS[f]}_base`), baseEntry = base && calibration.get(base.name);
      if (baseEntry && !pose.source) {
        const close = clamp((digit.mcp + digit.pip + digit.dip) / 220, 0, 1);
        base.quaternion.copy(baseEntry.open)
          .multiply(new THREE.Quaternion().setFromAxisAngle(baseEntry.axis, baseEntry.closeAngle * close));
      }
    }
    if (wrist && wristRest) {
      wrist.quaternion.copy(wristRest)
        .multiply(new THREE.Quaternion().setFromAxisAngle(wrist.userData.flexAxis, pose.wrist.flex * RAD))
        .multiply(new THREE.Quaternion().setFromAxisAngle(wrist.userData.sideAxis, pose.wrist.side * RAD))
        .multiply(new THREE.Quaternion().setFromAxisAngle(wrist.userData.twistAxis, pose.wrist.twist * RAD));
    }
    group.updateMatrixWorld(true);
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    mixer.stopAllAction();
    mixer.uncacheRoot(model);
  }
  return { group, meshes, bones, deformMap, bounds, wrist, digits, tips, setPose, dispose };
}
