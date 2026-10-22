import * as THREE from '../../../vendor/three/three.module.min.js';
import { RIG_FACTORIES, createRandom } from './rig-a-jig-rigs.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const PALETTE = {
  cyan: 0x4fe3ff, magenta: 0xff5fd0, lime: 0x9dff70, amber: 0xffc45f,
  violet: 0xb78cff, teal: 0x5ff2c8, red: 0xff7a6b, blue: 0x6fb7ff,
};
const RIG_COLORS = {
  spider: 'lime', ant: 'amber', centipede: 'lime', scorpion: 'red',
  fish: 'cyan', jellyfish: 'violet', octopus: 'magenta', crab: 'amber',
  bat: 'violet', bird: 'cyan', butterfly: 'magenta', dragonfly: 'teal',
  snake: 'lime', caterpillar: 'lime', worm: 'amber',
  walker: 'blue', horse: 'amber', cat: 'violet', dog: 'amber', frog: 'lime', kangaroo: 'amber',
  crane: 'cyan', giraffe: 'amber', scorpionTail: 'red',
  whip: 'red', striker: 'blue',
};
const color = (rig) => PALETTE[RIG_COLORS[rig] ?? 'cyan'];

/* A soft radial glow sprite drawn once on a canvas — this is the "laser"
 * joint. No texture file; it is generated in memory. */
function glowSprite(hex) {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  const c = new THREE.Color(hex);
  const rgb = `${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)}`;
  gradient.addColorStop(0, `rgba(255,255,255,0.9)`);
  gradient.addColorStop(0.18, `rgba(${rgb},0.7)`);
  gradient.addColorStop(0.42, `rgba(${rgb},0.14)`);
  gradient.addColorStop(0.75, `rgba(${rgb},0)`);
  gradient.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({
    map: texture, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  });
  return { texture, material };
}

class RigFigure {
  constructor(rig, rigId, rootGroup) {
    this.rig = rig;
    this.rigId = rigId;
    this.base = color(rigId);
    this.root = new THREE.Group();
    this.root.add(rig.joints[0]);
    rootGroup.add(this.root);

    // Joints as additive glow sprites + tiny diamond cores.
    const { texture, material } = glowSprite(this.base);
    this.glowTexture = texture;
    this.jointSprites = rig.joints.map((joint, index) => {
      const sprite = new THREE.Sprite(material.clone());
      sprite.scale.setScalar(0.09);
      sprite.userData.pick = { kind: 'joint', index };
      sprite.userData.joint = joint;
      this.root.add(sprite);
      return sprite;
    });
    const coreGeometry = new THREE.OctahedronGeometry(0.011);
    this.jointCores = rig.joints.map((joint, index) => {
      const mesh = new THREE.Mesh(coreGeometry,
        new THREE.MeshBasicMaterial({ color: 0xffffff }));
      mesh.userData.pick = { kind: 'joint', index };
      this.root.add(mesh);
      return mesh;
    });

    // Bone vectors as additive lines (glow) — reusing one LineSegments.
    const edges = rig.joints.filter((joint) => joint.parent?.isBone);
    this.edges = edges;
    this.linePositions = new Float32Array(edges.length * 6);
    this.lineGeometry = new THREE.BufferGeometry();
    this.lineGeometry.setAttribute('position', new THREE.BufferAttribute(this.linePositions, 3));
    this.line = new THREE.LineSegments(this.lineGeometry,
      new THREE.LineBasicMaterial({
        color: this.base, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.55,
      }));
    this.line.frustumCulled = false;
    this.root.add(this.line);

    // Contact markers (endpoints that strike sound).
    this.contactSprites = rig.contacts.map((contactItem) => {
      const { material: cm } = glowSprite(0xffffff);
      const sprite = new THREE.Sprite(cm);
      sprite.scale.setScalar(0.06);
      this.root.add(sprite);
      return sprite;
    });

    // Spring state per joint (tendon-like settle).
    this.spring = rig.joints.map(() => ({ offset: new THREE.Vector3(), velocity: new THREE.Vector3() }));
    this.ik = null; // { chain: [bones], target: Vector3 }
    this.action = null; // { name, start, duration }
    this.selected = 0;
    this._a = new THREE.Vector3(); this._b = new THREE.Vector3();
    this.refreshSelection();
  }

  refreshSelection() {
    this.jointSprites.forEach((sprite, index) => {
      const selected = index === this.selected;
      sprite.scale.setScalar(selected ? 0.16 : 0.09);
      sprite.material.color.setHex(selected ? 0xffffff : this.base);
      this.jointCores[index].scale.setScalar(selected ? 1.45 : 1);
    });
  }

  setSelected(index) {
    this.selected = clamp(index, 0, this.rig.joints.length - 1);
    this.refreshSelection();
  }

  /* Build an IK chain from a joint up to the first branching/leaf ancestor. */
  chainTo(index) {
    const chain = [];
    let node = this.rig.joints[index];
    while (node?.isBone) { chain.unshift(node); node = node.parent; }
    // Use at most the last 3 bones for a snappy reach (shoulder-elbow-hand).
    return chain.slice(-3);
  }

  grab(index, worldTarget) {
    this.ik = { chain: this.chainTo(index), target: worldTarget.clone(), index };
    this.setSelected(index);
  }

  dragTo(worldTarget) {
    if (this.ik) this.ik.target.copy(worldTarget);
  }

  release() { this.ik = null; }

  setAction(name, time) {
    if (!name) { this.action = null; return; }
    const durations = { jump: 0.9, karate: 1.4, dance: 3.2, stomp: 0.7 };
    this.action = { name, start: time, duration: durations[name] ?? 1 };
  }

  /* CCD IK step + spring tendons + action overlay. */
  update(pose, time) {
    const rig = this.rig;
    const rootJoint = rig.joints[0];

    // 1. Base procedural motion.
    rig.update(pose, time);

    // 2. Snapshot every joint's procedural pose, layer the action on top,
    // then ALWAYS restore the snapshot afterwards — otherwise the action's
    // position/rotation offsets accumulate every frame and the creature drifts
    // (flies into the sky). Only run the overlay while the action is active.
    let snapshot = null;
    if (this.action) {
      const t = (time - this.action.start) / this.action.duration;
      if (t >= 1) this.action = null;
      else {
        snapshot = rig.joints.map((joint) => ({
          px: joint.position.x, py: joint.position.y, pz: joint.position.z,
          rx: joint.rotation.x, ry: joint.rotation.y, rz: joint.rotation.z,
        }));
        this.applyAction(this.action.name, t, pose);
      }
    }

    // 3. IK: pull the grabbed joint toward the world target (CCD).
    if (this.ik) {
      const { chain, target } = this.ik;
      const end = chain[chain.length - 1];
      const jointPos = this._a, endPos = this._b;
      const toEnd = new THREE.Vector3(), toTarget = new THREE.Vector3();
      const worldQuat = new THREE.Quaternion(), parentQuat = new THREE.Quaternion();
      const delta = new THREE.Quaternion(), local = new THREE.Quaternion();
      for (let iteration = 0; iteration < 8; iteration += 1) {
        for (let i = chain.length - 2; i >= 0; i -= 1) {
          const joint = chain[i];
          this.root.updateMatrixWorld(true);
          joint.getWorldPosition(jointPos);
          end.getWorldPosition(endPos);
          toEnd.copy(endPos).sub(jointPos);
          toTarget.copy(target).sub(jointPos);
          if (toEnd.lengthSq() < 1e-6 || toTarget.lengthSq() < 1e-6) continue;
          // World-space rotation that swings the end effector toward the target.
          worldQuat.setFromUnitVectors(toEnd.normalize(), toTarget.normalize());
          // Bring into the joint's parent frame: local = parentWorld^-1 * worldDelta * parentWorld.
          joint.parent.getWorldQuaternion(parentQuat);
          local.copy(parentQuat).invert().multiply(worldQuat).multiply(parentQuat);
          joint.quaternion.premultiply(local);
        }
      }
    }

    // 4. Tendon springs: each joint eases back to rest with slight overshoot.
    for (let i = 0; i < rig.joints.length; i += 1) {
      const spring = this.spring[i];
      spring.velocity.addScaledVector(spring.offset, -0.16); // stiffness
      spring.velocity.multiplyScalar(0.82); // damping
      spring.offset.add(spring.velocity);
      rig.joints[i].position.add(spring.offset);
    }

    // 5. Restore the full procedural pose before reading world positions, so
    // the action was only a transient overlay this frame.
    if (snapshot) {
      for (let i = 0; i < rig.joints.length; i += 1) {
        const joint = rig.joints[i], snap = snapshot[i];
        joint.position.set(snap.px, snap.py, snap.pz);
        joint.rotation.set(snap.rx, snap.ry, snap.rz);
      }
    }
    this.root.updateMatrixWorld(true);
    for (let i = 0; i < this.jointSprites.length; i += 1) {
      this.rig.joints[i].getWorldPosition(this.jointSprites[i].position);
      this.jointCores[i].position.copy(this.jointSprites[i].position);
    }
    for (let i = 0; i < this.edges.length; i += 1) {
      const joint = this.edges[i];
      joint.getWorldPosition(this._a);
      joint.parent.getWorldPosition(this._b);
      this.linePositions[i * 6 + 0] = this._a.x;
      this.linePositions[i * 6 + 1] = this._a.y;
      this.linePositions[i * 6 + 2] = this._a.z;
      this.linePositions[i * 6 + 3] = this._b.x;
      this.linePositions[i * 6 + 4] = this._b.y;
      this.linePositions[i * 6 + 5] = this._b.z;
    }
    this.lineGeometry.attributes.position.needsUpdate = true;
    this.rig.contacts.forEach((contactItem, i) => {
      contactItem.joint.getWorldPosition(this.contactSprites[i].position);
      const phase = contactItem.joint.userData.phase ?? 0;
      const active = phase > 0.86 || phase < 0.06;
      this.contactSprites[i].scale.setScalar(active ? 0.11 : 0.06);
    });

    // 6. Undo spring offsets so the next procedural frame starts clean.
    for (let i = 0; i < rig.joints.length; i += 1) {
      rig.joints[i].position.sub(this.spring[i].offset);
    }
  }

  applyAction(name, t, pose) {
    const rig = this.rig;
    const rootJoint = rig.joints[0];
    if (name === 'jump') {
      const arc = Math.sin(t * Math.PI);
      rootJoint.position.y += arc * 0.7 * (pose.amp + 0.3);
      for (const joint of rig.joints) {
        if (joint.name.includes('knee') || joint.name.includes('Knee') || joint.name.includes('shin')) {
          joint.rotation.x += arc * 1.1;
        }
      }
    } else if (name === 'karate') {
      // A high kick then a strike.
      const kick = t < 0.45 ? Math.sin(t / 0.45 * Math.PI) : 0;
      const strike = t >= 0.45 ? Math.sin((t - 0.45) / 0.55 * Math.PI) : 0;
      for (const joint of rig.joints) {
        if (/hip|thigh/i.test(joint.name)) joint.rotation.x -= kick * 1.4;
        if (/knee|shin/i.test(joint.name)) joint.rotation.x += kick * 1.8;
        if (/shoulder|arm|claw|neck/i.test(joint.name)) joint.rotation.z += strike * 0.9;
      }
      rootJoint.rotation.y += strike * 0.4;
    } else if (name === 'dance') {
      const beat = t * 4; // four grooves across the action
      const energy = Math.min(0.75, pose.amp + 0.15); // cap vertical bounce
      rootJoint.rotation.y += Math.sin(beat * Math.PI) * 0.5;
      rootJoint.position.y += Math.abs(Math.sin(beat * Math.PI * 2)) * 0.14 * energy;
      let index = 0;
      for (const joint of rig.joints) {
        if (/shoulder|arm|claw|neck|tail/i.test(joint.name)) {
          joint.rotation.z += Math.sin(beat * Math.PI * 2 + index * 0.7) * 0.7;
          index += 1;
        }
      }
    } else if (name === 'stomp') {
      const drop = Math.sin(t * Math.PI);
      rootJoint.position.y -= drop * 0.12;
      for (const joint of rig.joints) {
        if (/hip|thigh|shoulder/i.test(joint.name)) joint.rotation.x += drop * 0.5;
      }
    }
  }

  nearestJoint(camera, ndc, canvasRect) {
    let best = -1, bestDistance = Infinity;
    const v = new THREE.Vector3();
    for (let i = 0; i < this.rig.joints.length; i += 1) {
      this.rig.joints[i].getWorldPosition(v).project(camera);
      if (v.z > 1) continue;
      const x = (v.x + 1) / 2 * canvasRect.width;
      const y = (1 - v.y) / 2 * canvasRect.height;
      const sx = (ndc.x + 1) / 2 * canvasRect.width;
      const sy = (1 - ndc.y) / 2 * canvasRect.height;
      const distance = Math.hypot(x - sx, y - sy);
      if (distance < bestDistance) { bestDistance = distance; best = i; }
    }
    return bestDistance < 44 ? best : -1;
  }

  jointWorld(index, target) {
    return this.rig.joints[index].getWorldPosition(target);
  }

  impulse(index, strength = 0.4) {
    const spring = this.spring[index];
    if (spring) spring.velocity.set(
      (Math.random() - 0.5) * strength, strength, (Math.random() - 0.5) * strength);
  }

  dispose(rootGroup) {
    this.glowTexture.dispose();
    rootGroup.remove(this.root);
  }
}

export function createRigAJigViewer(canvas, {
  onJointGrab = () => {}, onOrbit = () => {}, onFinish = () => {},
} = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x05080c, 1);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x05080c, 9, 24);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 60);

  // Floor grid + a faint starfield of points for depth (all unlit, no materials).
  const grid = new THREE.GridHelper(7, 14, 0x1e3f52, 0x101d28);
  grid.position.y = -0.001;
  scene.add(grid);
  const starGeometry = new THREE.BufferGeometry();
  const starPositions = new Float32Array(240 * 3);
  for (let i = 0; i < 240; i += 1) {
    starPositions[i * 3] = (Math.random() - 0.5) * 24;
    starPositions[i * 3 + 1] = Math.random() * 9;
    starPositions[i * 3 + 2] = (Math.random() - 0.5) * 24;
  }
  starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  const stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({
    color: 0x2a4a5f, size: 0.035, transparent: true, opacity: 0.7,
  }));
  scene.add(stars);
  const figureRoot = new THREE.Group();
  scene.add(figureRoot);

  let figure = null, rigId = null;
  let yaw = 0.45, pitch = 0.28, zoom = 3.4, lookY = 0.35;
  let width = 1, height = 1, disposed = false, frames = 0;
  const ndc = new THREE.Vector2();
  const abort = new AbortController(), signal = abort.signal;
  let drag = null;
  const dragPlane = new THREE.Plane();
  const raycaster = new THREE.Raycaster();

  function updateCamera() {
    const distance = zoom * Math.max(1, 1.05 / camera.aspect);
    camera.position.set(distance * Math.sin(yaw) * Math.cos(pitch),
      lookY + distance * Math.sin(pitch), distance * Math.cos(yaw) * Math.cos(pitch));
    camera.lookAt(0, lookY, 0);
    camera.updateMatrixWorld();
  }
  function resize() {
    if (disposed) return;
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 1.6,
      Math.sqrt(1_100_000 / (width * height)));
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    updateCamera();
  }
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  observer?.observe(canvas);
  if (!observer) window.addEventListener('resize', resize, { signal });
  resize();

  function setRig(next, options = {}) {
    if (disposed || (next !== 'random' && !RIG_FACTORIES[next])) return;
    if (figure) figure.dispose(figureRoot);
    rigId = next;
    const rig = next === 'random' ? createRandom(options) : RIG_FACTORIES[next](options);
    figure = new RigFigure(rig, next, figureRoot);
    figure.update({ rate: 0.3, amp: 0.5, sway: 0.3, fold: 0.5 }, 0);
  }

  function pointerNdc(event) {
    const rect = canvas.getBoundingClientRect();
    ndc.set((event.clientX - rect.left) / rect.width * 2 - 1,
      -(event.clientY - rect.top) / rect.height * 2 + 1);
    return ndc;
  }
  function worldOnPlane(event, planePoint) {
    pointerNdc(event);
    raycaster.setFromCamera(ndc, camera);
    dragPlane.setFromNormalAndCoplanarPoint(
      camera.getWorldDirection(new THREE.Vector3()).negate(), planePoint);
    const out = new THREE.Vector3();
    raycaster.ray.intersectPlane(dragPlane, out);
    return out;
  }

  function down(event) {
    if (disposed || drag || event.button !== 0) return;
    const rect = canvas.getBoundingClientRect();
    pointerNdc(event);
    const jointIndex = figure?.nearestJoint(camera, ndc, rect) ?? -1;
    drag = {
      id: event.pointerId, x: event.clientX, y: event.clientY,
      yaw, pitch, joint: jointIndex, moved: false,
    };
    try { canvas.setPointerCapture(event.pointerId); } catch { drag = null; return; }
    canvas.classList.add('is-dragging');
    if (jointIndex >= 0 && figure) {
      const target = figure.jointWorld(jointIndex, new THREE.Vector3());
      figure.grab(jointIndex, target);
      onJointGrab({ rig: rigId, joint: jointIndex });
    }
    event.preventDefault();
  }
  function move(event) {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (Math.hypot(dx, dy) > 3) drag.moved = true;
    if (drag.joint < 0) {
      yaw = drag.yaw - dx / Math.max(width, 1) * Math.PI * 1.5;
      pitch = clamp(drag.pitch - dy / Math.max(height, 1) * Math.PI, -1.05, 1.05);
      updateCamera();
      onOrbit({ yaw, pitch });
    } else if (figure) {
      const planePoint = figure.jointWorld(drag.joint, new THREE.Vector3());
      const target = worldOnPlane(event, planePoint);
      if (target) figure.dragTo(target);
    }
    event.preventDefault();
  }
  function finish(event, cancelled = false) {
    if (!drag || event.pointerId !== drag.id) return;
    if (cancelled && drag.joint < 0) { yaw = drag.yaw; pitch = drag.pitch; updateCamera(); }
    if (figure) {
      if (drag.joint >= 0 && !cancelled) figure.impulse(drag.joint, 0.5);
      figure.release();
    }
    onFinish({ rig: rigId, joint: drag.joint, moved: drag.moved, cancelled });
    try {
      if (canvas.hasPointerCapture(drag.id)) canvas.releasePointerCapture(drag.id);
    } catch { /* lost */ }
    drag = null;
    canvas.classList.remove('is-dragging');
  }
  canvas.addEventListener('pointerdown', down, { signal });
  canvas.addEventListener('pointermove', move, { signal });
  canvas.addEventListener('pointerup', (e) => finish(e), { signal });
  canvas.addEventListener('pointercancel', (e) => finish(e, true), { signal });
  canvas.addEventListener('lostpointercapture', (e) => finish(e, true), { signal });
  canvas.addEventListener('wheel', (event) => {
    if (event.ctrlKey) return;
    zoom = clamp(zoom * (event.deltaY > 0 ? 1.09 : 0.92), 1.6, 7.5);
    updateCamera();
    event.preventDefault();
  }, { signal, passive: false });

  function draw(pose, time) {
    if (disposed || !figure) return;
    figure.update(pose, time);
    renderer.render(scene, camera);
    frames += 1;
  }
  function setSelected(index) { figure?.setSelected(index); }
  function setAction(name, time) { figure?.setAction(name, time); }
  function impulse(index, strength) { figure?.impulse(index, strength); }
  function setView(view) {
    if (view === 'front') { yaw = 0; pitch = 0.16; }
    if (view === 'side') { yaw = Math.PI * 0.45; pitch = 0.22; }
    if (view === 'top') { pitch = 1.02; }
    updateCamera();
  }
  function zoomBy(factor) { zoom = clamp(zoom * factor, 1.6, 7.5); updateCamera(); }
  function dispose() {
    if (disposed) return;
    disposed = true;
    abort.abort();
    observer?.disconnect();
    figure?.dispose(figureRoot);
    renderer.dispose();
  }
  function rootJointY() {
    if (!figure) return null;
    return figure.jointWorld(0, new THREE.Vector3()).y;
  }
  function jointSpriteScale() {
    if (!figure) return null;
    return figure.jointSprites[0]?.scale.x ?? null;
  }
  function screenPoint(index) {
    if (!figure) return null;
    const rect = canvas.getBoundingClientRect();
    const v = figure.jointWorld(index, new THREE.Vector3()).project(camera);
    return {
      x: rect.left + (v.x + 1) / 2 * rect.width,
      y: rect.top + (1 - v.y) / 2 * rect.height,
    };
  }
  function sceneStats() {
    const stats = { skinnedMeshes: 0, litMaterials: 0, textures: 0,
      bones: 0, lineSegments: 0, sprites: 0, jointCores: 0, points: 0 };
    scene.traverse((object) => {
      if (object.isSkinnedMesh) stats.skinnedMeshes += 1;
      if (object.isBone) stats.bones += 1;
      if (object.isLineSegments) stats.lineSegments += 1;
      if (object.isSprite) stats.sprites += 1;
      if (object.isPoints) stats.points += 1;
      if (object.isMesh && object.userData?.pick?.kind === 'joint') stats.jointCores += 1;
      const materials = Array.isArray(object.material) ? object.material : (object.material ? [object.material] : []);
      for (const material of materials) {
        if (material.map?.isTexture && !material.map.isCanvasTexture) stats.textures += 1;
        if (material.isMeshStandardMaterial || material.isMeshPhongMaterial || material.isMeshPhysicalMaterial) stats.litMaterials += 1;
      }
    });
    return stats;
  }
  setRig('spider');
  return {
    draw, setRig, setSelected, setAction, impulse, setView, zoomBy, screenPoint, sceneStats, dispose,
    rootJointY, jointSpriteScale,
    getState: () => ({ rig: rigId, frames, yaw, pitch, zoom, dragging: Boolean(drag),
      joints: figure ? figure.rig.joints.length : 0,
      contacts: figure ? figure.rig.contacts.length : 0 }),
  };
}
