import * as THREE from '../vendor/three/three.module.min.js';
import { GLTFLoader } from '../vendor/three/loaders/GLTFLoader.js';
import { MeshoptDecoder } from '../vendor/meshoptimizer/meshopt_decoder.module.js';

const clamp = (value, low, high) => Math.min(high, Math.max(low, Number(value) || 0));
const AXES = ['x', 'y', 'z'];
const MODEL_URL = new URL('../assets/spider-synth/spider-mobile.glb', import.meta.url);
const RIG_URL = new URL('../assets/spider-synth/rig-manifest.json', import.meta.url);
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_PIXELS = 1_150_000;
const UP = new THREE.Vector3(0, 1, 0);
const finite3 = value => value && AXES.every(axis => Number.isFinite(value[axis]));
let decoderUsers = 0;
function acquireDecoder() {
  if (decoderUsers++ === 0 && typeof Worker === 'function') {
    try { MeshoptDecoder.useWorkers(1); } catch { /* Same bounded decoder without worker. */ }
  }
  return () => { if (--decoderUsers === 0) MeshoptDecoder.useWorkers(0); };
}
function releaseObject(root) {
  const materials = new Set(), textures = new Set(), geometries = new Set(), skeletons = new Set();
  root?.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    if (object.skeleton) skeletons.add(object.skeleton);
    for (const material of [].concat(object.material || [])) {
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  textures.forEach(value => { value.source?.data?.close?.(); value.dispose(); });
  materials.forEach(value => value.dispose()); geometries.forEach(value => value.dispose());
  skeletons.forEach(value => value.dispose());
}

/** GPU-skinned real specimen and shared web contact display. Owns no audio clock. */
export class SpiderSynthViewer {
  constructor({ canvas, onStatus = () => {}, onChange = () => {}, onSelect = () => {},
    onInteract = () => {}, onPluck = () => {}, onMove = () => {} }) {
    if (!canvas?.getContext) throw new TypeError('A canvas is required');
    Object.assign(this, { canvas, onStatus, onChange, onSelect, onInteract, onPluck, onMove });
    this.win = canvas.ownerDocument.defaultView; this.doc = canvas.ownerDocument;
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(0x080d11);
    this.camera = new THREE.PerspectiveCamera(39, 1, .005, 30);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.add(new THREE.HemisphereLight(0xe1e6ec, 0x20202a, .85));
    this.key = new THREE.DirectionalLight(0xfff7e8, 1.85);
    this.key.position.set(-1.3, 2.5, 1.5); this.key.castShadow = true;
    this.key.shadow.mapSize.set(768, 768);
    Object.assign(this.key.shadow.camera, { left: -.9, right: .9, top: .9, bottom: -.9, near: .1, far: 8 });
    this.key.shadow.bias = -.00015; this.key.shadow.normalBias = .0007; this.scene.add(this.key);
    this.fill = new THREE.DirectionalLight(0xcadce5, 1.35); this.scene.add(this.fill, this.fill.target);
    this.rim = new THREE.DirectionalLight(0xa8c3dc, .45); this.rim.position.set(1, 1, -1); this.scene.add(this.rim);
    this.performer = new THREE.Group(); this.scene.add(this.performer);
    this.webRoot = new THREE.Group(); this.scene.add(this.webRoot);
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(1.04, 64), new THREE.ShadowMaterial({ opacity: .2, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2; this.shadow.position.y = -.003;
    this.shadow.receiveShadow = true; this.scene.add(this.shadow);
    this.jointMarkers = new THREE.Group(); this.scene.add(this.jointMarkers); this.jointMarkers.visible = false;
    this.raycaster = new THREE.Raycaster(); this.pointer = new THREE.Vector2();
    this.target = new THREE.Vector3(0, .04, -.03); this.orbit = new THREE.Quaternion();
    this.distance = 1.55; this.view = 'top'; this.side = 'right'; this.axis = 'xy';
    this.touchMode = false; this.moveMode = false; this.showJoints = false; this.offsets = {};
    this.moveCenter = { x: 0, z: 0 };
    this.frameData = { time: 0, body: { x: 0, y: .06, z: 0, yaw: 0, pitch: 0, roll: 0 }, feet: [], pose: new Float32Array(114) };
    this.bones = []; this.legs = []; this.mesh = null; this.model = null; this.rig = null;
    this.selectedBone = null; this.web = null; this.webLines = []; this.recentEvents = [];
    this.audioTime = 0; this.disposed = false; this.contextLost = false; this.loaded = false;
    this.dirty = true; this.frameRequest = 0; this.lastDraw = -Infinity; this.renderCount = 0;
    this.loadSerial = 0; this.gesture = null; this.pointers = new Set(); this.resizeKey = '';
    this.temp = Array.from({ length: 12 }, () => new THREE.Vector3());
    this.turn = new THREE.Quaternion(); this.euler = new THREE.Euler();
    this.parentQuaternion = new THREE.Quaternion(); this.worldQuaternion = new THREE.Quaternion();
    this.bindEvents(); this.resize(); this.setViewPreset('top');
  }

  async load(url = MODEL_URL) {
    const serial = ++this.loadSerial; this.abort?.abort(); this.abort = new AbortController();
    this.onStatus({ state: 'loading', message: 'Loading the spider scan…', progress: 0 });
    let imported = null; let releaseDecoder;
    try {
      const [response, rigResponse] = await Promise.all([
        fetch(url, { signal: this.abort.signal }), fetch(RIG_URL, { signal: this.abort.signal }),
      ]);
      if (!response.ok || !rigResponse.ok) throw new Error('The spider model could not be downloaded.');
      const rig = await rigResponse.json();
      if (rig.joints?.length !== 38 || rig.legs?.length !== 8) throw new Error('The spider rig metadata is invalid.');
      const length = Number(response.headers.get('Content-Length')) || 0;
      if (length > MAX_BYTES) throw new Error('The spider model exceeds its download budget.');
      let buffer;
      if (response.body?.getReader) {
        const reader = response.body.getReader(), chunks = []; let size = 0;
        while (true) {
          const { value, done } = await reader.read(); if (done) break;
          chunks.push(value); size += value.byteLength;
          if (size > MAX_BYTES) { await reader.cancel(); throw new Error('The spider model exceeds its download budget.'); }
          if (serial === this.loadSerial && !this.disposed) this.onStatus({ state: 'loading', message: 'Loading the spider scan…', progress: length ? size / length * .85 : 0 });
        }
        const bytes = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        buffer = bytes.buffer;
      } else buffer = await response.arrayBuffer();
      if (this.disposed || serial !== this.loadSerial) return false;
      const header = new DataView(buffer);
      if (buffer.byteLength < 20 || buffer.byteLength > MAX_BYTES || header.getUint32(0, true) !== 0x46546c67
        || header.getUint32(8, true) !== buffer.byteLength) throw new Error('The spider model is not a valid GLB.');
      releaseDecoder = acquireDecoder();
      const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
      imported = await loader.parseAsync(buffer, '');
      if (this.disposed || serial !== this.loadSerial) { releaseObject(imported.scene); return false; }
      const mesh = []; imported.scene.traverse(object => { if (object.isSkinnedMesh) mesh.push(object); });
      if (mesh.length !== 1 || mesh[0].skeleton.bones.length !== 38) throw new Error('The spider model needs its 38-joint skin.');
      releaseObject(this.model); if (this.model) this.performer.remove(this.model);
      this.model = imported.scene; this.mesh = mesh[0]; this.rig = rig; this.performer.add(this.model);
      this.mesh.castShadow = true; this.mesh.receiveShadow = true; this.mesh.frustumCulled = false;
      this.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2);
      this.mesh.boundingBox = new THREE.Box3(new THREE.Vector3(-2, -2, -2), new THREE.Vector3(2, 2, 2));
      this.bones = rig.joints.map((meta, index) => {
        const bone = this.model.getObjectByName(meta.id);
        if (!bone?.isBone) throw new Error(`Missing spider joint ${meta.id}`);
        return { ...meta, bone, index, rest: bone.quaternion.clone() };
      });
      const sourcePositions = this.mesh.geometry.attributes.position;
      const sourceJoints = this.mesh.geometry.attributes.skinIndex;
      this.bones.forEach(bone => { bone.samples = []; });
      for (let i = 0; i < sourcePositions.count; i += 13) {
        const bone = this.bones[sourceJoints.getX(i)];
        if (bone && bone.samples.length < 100) bone.samples.push(i);
      }
      this.legs = rig.legs.map((leg, index) => ({ ...leg, index,
        chain: leg.jointIds.map(id => this.bones.find(b => b.id === id).bone),
        points: Array.from({ length: 5 }, () => new THREE.Vector3()),
        end: new THREE.Vector3().fromArray(leg.anchors[4]).sub(new THREE.Vector3().fromArray(leg.anchors[3])),
        actual: new THREE.Vector3(), target: new THREE.Vector3(), error: 0,
      }));
      this.buildJointMarkers(); this.loaded = true;
      this.applyFrame(); this.fit(); this.invalidate();
      this.onStatus({ state: 'ready', message: 'Spider ready', progress: 1 }); this.onChange(this.getState());
      return true;
    } catch (error) {
      if (imported?.scene && imported.scene !== this.model) releaseObject(imported.scene);
      if (!this.disposed && serial === this.loadSerial && error.name !== 'AbortError') {
        this.onStatus({ state: 'error', message: `${error.message} Try loading again.`, progress: 0 });
      }
      return false;
    } finally { releaseDecoder?.(); }
  }

  setFrame(frame) {
    if (!frame || this.disposed) return;
    this.frameData.time = Number(frame.time) || 0;
    Object.assign(this.frameData.body, frame.body || {});
    if (frame.pose?.length === 114) for (let i = 0; i < 114; i++) this.frameData.pose[i] = clamp(frame.pose[i], -Math.PI, Math.PI);
    this.frameData.feet = (frame.feet || []).slice(0, 8).map(foot => ({ ...foot }));
    this.invalidate();
  }
  setOffsets(offsets = {}) {
    this.offsets = {};
    for (const [id, value] of Object.entries(offsets)) this.offsets[id] = {
      x: clamp(value?.x, -Math.PI, Math.PI), y: clamp(value?.y, -Math.PI, Math.PI), z: clamp(value?.z, -Math.PI, Math.PI),
    };
  }
  setCenter(center = {}) { this.moveCenter = { x: clamp(center.x, -.55, .55), z: clamp(center.z, -.55, .55) }; }
  setWeb(web) {
    if (!web?.nodes || !web?.segments || web.nodes.length > 1200 || web.segments.length > 2000) return false;
    releaseObject(this.webRoot); this.webRoot.clear(); this.webLines = []; this.web = web;
    for (const kind of ['radial', 'spiral', 'frame']) {
      const segments = web.segments.filter(segment => segment.kind === kind);
      if (!segments.length) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(segments.length * 8 * 3), 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(segments.length * 8 * 3), 3));
      const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: kind === 'spiral' ? .64 : .88 }));
      lines.frustumCulled = false; this.webRoot.add(lines); this.webLines.push({ lines, segments, kind });
    }
    this.updateWeb(); this.invalidate(); return true;
  }
  setEvents(events, audioTime = this.audioTime) {
    this.recentEvents = Array.isArray(events) ? events.slice(-32).map(event => ({ ...event })) : [];
    this.audioTime = Math.max(this.audioTime, Number(audioTime) || 0); this.invalidate();
  }
  setClock(audioTime) {
    const next = Math.max(0, Number(audioTime) || 0);
    if (next < this.audioTime - .5) {
      this.recentEvents = [];
      if (this.prey) this.prey.visible = false;
      this.preyStart = -Infinity;
    }
    this.audioTime = next; this.invalidate();
  }
  updateWeb() {
    if (!this.web) return;
    const now = this.audioTime;
    for (const group of this.webLines) {
      const positions = group.lines.geometry.attributes.position, colors = group.lines.geometry.attributes.color;
      let vertex = 0;
      for (const segment of group.segments) {
        const a = this.web.nodes[segment.a], b = this.web.nodes[segment.b];
        let energy = 0;
        for (const event of this.recentEvents) if (event.segmentId === segment.id) {
          const age = now - (event.audioTime ?? now);
          if (age >= 0 && age < 2) energy += clamp(event.velocity, 0, 1) * Math.exp(-age * 4);
        }
        energy = Math.min(1, energy);
        // A planted foot clamps this short span to the shared Y=0 contact
        // plane. Its energy still flashes; free spans carry the visible wave.
        const supported = this.frameData.feet.some(foot => foot.stance && foot.segmentId === segment.id);
        for (let piece = 0; piece < 4; piece++) for (const u of [piece / 4, (piece + 1) / 4]) {
          const vibration = supported ? 0 : Math.sin(Math.PI * u) * Math.sin(now * 62 + segment.id) * energy * .007;
          positions.setXYZ(vertex, a.x + (b.x - a.x) * u, .0002 + vibration, a.z + (b.z - a.z) * u);
          const base = group.kind === 'spiral' ? .21 : .34;
          colors.setXYZ(vertex, base + energy * .32, base * 1.22 + energy * .55, base * 1.34 + energy * .48); vertex++;
        }
      }
      positions.needsUpdate = true; colors.needsUpdate = true;
    }
    if (this.prey) {
      const age = now - this.preyStart;
      this.prey.visible = age >= 0 && age < 2.2;
      if (this.prey.visible) {
        this.prey.rotation.y = Math.sin(age * 22) * .35 * Math.exp(-age * 1.2);
        for (const wing of this.prey.userData.wings) wing.rotation.z = wing.userData.sign * (.35 + Math.sin(age * 80) * .65 * Math.exp(-age));
        this.prey.scale.setScalar(Math.min(1, Math.max(0, 2.2 - age)));
      }
    }
  }
  showPrey({ segmentId, u = .5 } = {}) {
    const segment = this.web?.segments[segmentId]; if (!segment) return false;
    if (!this.prey) {
      this.prey = new THREE.Group(); this.scene.add(this.prey);
      const body = new THREE.Mesh(new THREE.SphereGeometry(.008, 8, 6), new THREE.MeshStandardMaterial({ color: 0x847461, roughness: .8 }));
      body.scale.set(.7, .65, 1.25); body.position.y = .006; this.prey.add(body);
      this.prey.userData.wings = [-1, 1].map(sign => {
        const wing = new THREE.Mesh(new THREE.CircleGeometry(.013, 8), new THREE.MeshStandardMaterial({ color: 0x93b5bd, transparent: true, opacity: .5, side: THREE.DoubleSide, depthWrite: false }));
        wing.rotation.x = -Math.PI / 2; wing.position.set(sign * .009, .007, 0); wing.scale.y = .5;
        wing.userData.sign = sign; this.prey.add(wing); return wing;
      });
    }
    const a = this.web.nodes[segment.a], b = this.web.nodes[segment.b]; u = clamp(u, 0, 1);
    this.prey.position.set(a.x + (b.x - a.x) * u, .002, a.z + (b.z - a.z) * u);
    this.preyStart = this.audioTime; this.prey.visible = true; this.invalidate(); return true;
  }

  applyFrame() {
    if (!this.loaded) return;
    const body = this.frameData.body;
    this.performer.position.set(clamp(body.x, -.75, .75), clamp(body.y, .025, .25), clamp(body.z, -.75, .75));
    this.performer.rotation.set(clamp(body.pitch, -.7, .7), Number(body.yaw) || 0, clamp(body.roll, -.7, .7), 'YXZ');
    for (const { bone, index, rest } of this.bones) {
      this.euler.set(this.frameData.pose[index * 3], this.frameData.pose[index * 3 + 1], this.frameData.pose[index * 3 + 2], 'XYZ');
      bone.quaternion.copy(rest).multiply(this.turn.setFromEuler(this.euler));
    }
    this.performer.updateMatrixWorld(true);
    for (const leg of this.legs) {
      const target = this.frameData.feet[leg.index];
      if (!finite3(target)) continue;
      leg.target.set(target.x, target.y, target.z); this.solveLeg(leg);
    }
    this.performer.updateMatrixWorld(true); this.mesh.skeleton.update();
    if (this.showJoints) this.bones.forEach(({ bone }, i) => bone.getWorldPosition(this.jointMarkers.children[i].position));
  }
  solveLeg(leg) {
    const { points, chain, lengths, target } = leg;
    chain.forEach((bone, i) => bone.getWorldPosition(points[i]));
    points[4].copy(leg.end).applyMatrix4(chain[3].matrixWorld);
    const root = this.temp[0].copy(points[0]), direction = this.temp[1];
    const reach = lengths.reduce((sum, length) => sum + length, 0);
    const wanted = this.temp[2].copy(target);
    if (root.distanceTo(wanted) >= reach * .999) wanted.copy(root).add(direction.copy(target).sub(root).setLength(reach * .999));
    for (let pass = 0; pass < 14; pass++) {
      points[4].copy(wanted);
      for (let i = 3; i >= 0; i--) {
        direction.subVectors(points[i], points[i + 1]).setLength(lengths[i]);
        points[i].copy(points[i + 1]).add(direction);
      }
      points[0].copy(root);
      for (let i = 0; i < 4; i++) {
        direction.subVectors(points[i + 1], points[i]).setLength(lengths[i]);
        points[i + 1].copy(points[i]).add(direction);
      }
      if (points[4].distanceToSquared(wanted) < 1e-10) break;
    }
    // Align each rest link to the solved chain while preserving its original
    // pose twist. This bends the existing skin; there are no substitute legs.
    const current = this.temp[3], desired = this.temp[4], start = this.temp[5], finish = this.temp[6];
    for (let i = 0; i < 4; i++) {
      const bone = chain[i]; bone.getWorldPosition(start);
      if (i < 3) chain[i + 1].getWorldPosition(finish); else finish.copy(leg.end).applyMatrix4(bone.matrixWorld);
      current.subVectors(finish, start).normalize(); desired.subVectors(points[i + 1], points[i]).normalize();
      bone.getWorldQuaternion(this.worldQuaternion);
      this.turn.setFromUnitVectors(current, desired); this.worldQuaternion.premultiply(this.turn);
      bone.parent.getWorldQuaternion(this.parentQuaternion).invert();
      bone.quaternion.copy(this.parentQuaternion).multiply(this.worldQuaternion).normalize();
      bone.updateWorldMatrix(false, true);
    }
    leg.actual.copy(leg.end).applyMatrix4(chain[3].matrixWorld); leg.error = leg.actual.distanceTo(target);
  }
  buildJointMarkers() {
    releaseObject(this.jointMarkers); this.jointMarkers.clear();
    const geometry = new THREE.SphereGeometry(.004, 8, 6), material = new THREE.MeshBasicMaterial({ color: 0xcffbd8 });
    this.bones.forEach(() => this.jointMarkers.add(new THREE.Mesh(geometry, material)));
    this.jointMarkers.visible = this.showJoints;
  }
  setShowJoints(value) { this.showJoints = !!value; this.jointMarkers.visible = this.showJoints; this.invalidate(); }
  setAxis(value) { if (['xy', 'x', 'y', 'z'].includes(value)) this.axis = value; }
  setTouchMode(value) { this.cancelGesture(); this.touchMode = !!value; this.canvas.style.touchAction = this.touchMode ? 'none' : 'pan-y'; }
  setMoveMode(value) { this.moveMode = !!value; }
  selectJoint(id) {
    const bone = this.bones.find(b => b.id === id); if (!bone) return false;
    this.selectedBone = bone.id;
    this.onSelect({ jointId: bone.id, groupId: bone.groupId, name: bone.name }); this.invalidate(); return true;
  }
  resetPose() { this.offsets = {}; this.frameData.pose.fill(0); this.invalidate(); }
  setViewPreset(view, { side = this.side } = {}) {
    if (!['top', 'side', 'bottom', 'face'].includes(view)) return false;
    this.view = view; this.side = side === 'left' ? 'left' : 'right';
    const direction = this.temp[7];
    this.target.set(0, .045, -.025);
    if (view === 'top') { direction.set(0, 1, .06); this.camera.up.set(0, 0, 1); }
    else if (view === 'bottom') { direction.set(0, -1, .04); this.camera.up.set(0, 0, 1); }
    else if (view === 'face') { direction.set(0, .14, 1); this.camera.up.copy(UP); this.target.set(0, .045, .035); }
    else { direction.set(side === 'left' ? -1 : 1, .23, .12); this.camera.up.copy(UP); }
    this.camera.position.copy(this.target).add(direction.normalize()); this.camera.lookAt(this.target); this.orbit.copy(this.camera.quaternion);
    this.fit(); this.onChange(this.getState()); return true;
  }
  fit() {
    const rect = this.canvas.getBoundingClientRect(), aspect = rect.width / Math.max(1, rect.height);
    const radius = this.view === 'face' ? .105 : .51;
    this.distance = radius / Math.tan(this.camera.fov * Math.PI / 360) / Math.min(1, aspect) * 1.07;
    this.updateCamera(); this.invalidate(); return true;
  }
  zoomBy(factor) {
    if (!Number.isFinite(factor) || factor <= 0 || this.disposed) return false;
    this.distance = clamp(this.distance * factor, .13, 6); this.updateCamera(); this.invalidate(); return true;
  }
  updateCamera() {
    this.camera.position.set(0, 0, this.distance).applyQuaternion(this.orbit).add(this.target);
    this.camera.quaternion.copy(this.orbit); this.camera.updateMatrixWorld(true);
    this.fill.position.copy(this.camera.position); this.fill.target.position.copy(this.target);
    this.fill.intensity = 1.55;
    this.shadow.visible = this.camera.position.y > 0;
  }
  resize() {
    const rect = this.canvas.getBoundingClientRect(), width = Math.max(1, Math.round(rect.width)), height = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(1.5, this.win.devicePixelRatio || 1, Math.sqrt(MAX_PIXELS / (width * height)));
    const key = `${width}:${height}:${dpr}`; if (this.resizeKey === key) return;
    this.resizeKey = key; this.renderer.setPixelRatio(dpr); this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height; this.camera.updateProjectionMatrix(); this.dirty = true;
  }
  invalidate() {
    if (this.disposed) return; this.dirty = true;
    if (!this.frameRequest && !this.doc.hidden && !this.contextLost) this.frameRequest = this.win.requestAnimationFrame(time => this.draw(time));
  }
  draw(time) {
    this.frameRequest = 0; if (this.disposed || this.doc.hidden || this.contextLost) return;
    if (time - this.lastDraw < 49) { this.frameRequest = this.win.requestAnimationFrame(now => this.draw(now)); return; }
    this.resize();
    if (this.dirty) {
      this.applyFrame(); this.updateWeb(); this.renderer.render(this.scene, this.camera);
      this.lastDraw = time; this.renderCount++; this.dirty = false;
    }
  }
  project(point) {
    const rect = this.canvas.getBoundingClientRect(), p = this.temp[8].copy(point).project(this.camera);
    return { x: rect.left + (p.x + 1) * rect.width / 2, y: rect.top + (1 - p.y) * rect.height / 2, visible: p.z >= -1 && p.z <= 1 && Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1 };
  }
  getPartScreenPosition(id) {
    const entry = this.bones.find(b => b.id === id); if (!entry || !this.mesh) return null;
    // Prefer an actual visible source vertex whose ray resolves to this joint.
    for (const index of entry.samples) {
      this.mesh.getVertexPosition(index, this.temp[9]); this.temp[9].applyMatrix4(this.mesh.matrixWorld);
      const p = this.project(this.temp[9]); if (!p.visible) continue;
      const hit = this.pickBody(p.x, p.y); if (hit?.jointId === id) return p;
    }
    return null;
  }
  getSegmentScreenPosition(segmentId, u = .5) {
    const segment = this.web?.segments[segmentId]; if (!segment) return null;
    const a = this.web.nodes[segment.a], b = this.web.nodes[segment.b]; u = clamp(u, 0, 1);
    return this.project(this.temp[9].set(a.x + (b.x - a.x) * u, .001, a.z + (b.z - a.z) * u));
  }
  setRay(x, y) {
    const rect = this.canvas.getBoundingClientRect(); this.pointer.set((x - rect.left) / rect.width * 2 - 1, 1 - (y - rect.top) / rect.height * 2);
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }
  pickBody(x, y) {
    if (!this.mesh) return null; this.setRay(x, y);
    const hit = this.raycaster.intersectObject(this.mesh, false)[0]; if (!hit?.face) return null;
    const indices = this.mesh.geometry.attributes.skinIndex, weights = this.mesh.geometry.attributes.skinWeight;
    const sums = new Float32Array(38);
    for (const vertex of [hit.face.a, hit.face.b, hit.face.c]) for (let axis = 0; axis < 4; axis++) sums[indices.getComponent(vertex, axis)] += weights.getComponent(vertex, axis);
    let best = 0; for (let i = 1; i < 38; i++) if (sums[i] > sums[best]) best = i;
    return { jointId: this.bones[best].id, point: hit.point, distance: hit.distance };
  }
  webPoint(x, y) {
    this.setRay(x, y); const out = this.temp[10];
    return this.raycaster.ray.intersectPlane(new THREE.Plane(UP, 0), out) ? out.clone() : null;
  }
  pickWeb(x, y) {
    if (!this.web) return null; let nearest = null, best = 9;
    for (const segment of this.web.segments) {
      const a = this.getSegmentScreenPosition(segment.id, 0), b = this.getSegmentScreenPosition(segment.id, 1);
      if (!a || !b) continue; const dx = b.x - a.x, dy = b.y - a.y;
      const u = clamp(((x - a.x) * dx + (y - a.y) * dy) / Math.max(.01, dx * dx + dy * dy), 0, 1);
      const distance = Math.hypot(x - a.x - dx * u, y - a.y - dy * u);
      if (distance < best) { best = distance; nearest = { segmentId: segment.id, u, point: this.webPoint(x, y) }; }
    }
    return nearest;
  }
  bindEvents() {
    this.listeners = [];
    const listen = (target, name, callback, options) => { target.addEventListener(name, callback, options); this.listeners.push(() => target.removeEventListener(name, callback, options)); };
    this.canvas.style.touchAction = 'pan-y';
    listen(this.canvas, 'pointerdown', event => {
      if (event.button !== 0 || this.disposed) return;
      this.pointers.add(event.pointerId);
      if (this.pointers.size > 1) { this.cancelGesture(); return; }
      const body = this.pickBody(event.clientX, event.clientY), strand = body ? null : this.pickWeb(event.clientX, event.clientY);
      const touch = event.pointerType === 'touch', pending = touch && !this.touchMode;
      this.gesture = { id: event.pointerId, touch, pending, moved: false, startX: event.clientX, startY: event.clientY,
        x: event.clientX, y: event.clientY, time: event.timeStamp, body, strand, mode: body ? (this.moveMode && body.jointId === 'cephalothorax' ? 'move' : 'joint') : (strand ? 'strand' : 'orbit'),
        origin: { ...this.moveCenter }, plane: this.webPoint(event.clientX, event.clientY) };
      if (!pending) { event.preventDefault(); this.beginGesture(); }
    });
    listen(this.canvas, 'pointermove', event => {
      const g = this.gesture; if (!g || event.pointerId !== g.id) return;
      const totalX = event.clientX - g.startX, totalY = event.clientY - g.startY;
      if (g.pending) {
        if (Math.abs(totalY) > 9 && Math.abs(totalY) > Math.abs(totalX) * 1.1) { this.cancelGesture(); return; }
        if (Math.abs(totalX) < 9) return;
        g.pending = false; this.beginGesture();
      }
      event.preventDefault();
      const dx = event.clientX - g.x, dy = event.clientY - g.y, dt = Math.max(8, event.timeStamp - g.time);
      const velocity = clamp(Math.hypot(dx, dy) / dt / 2, 0, 1);
      if (Math.hypot(totalX, totalY) > 3) g.moved = true;
      if (g.mode === 'joint') {
        const offset = { ...(this.offsets[g.body.jointId] || { x: 0, y: 0, z: 0 }) };
        if (this.axis === 'xy') { offset.x -= dy * .007; offset.y += dx * .007; }
        else offset[this.axis] += (dx - dy) * .007;
        AXES.forEach(axis => { offset[axis] = clamp(offset[axis], -1.25, 1.25); });
        this.offsets[g.body.jointId] = offset;
        this.onInteract({ jointId: g.body.jointId, offset: { ...offset }, active: true, velocity });
      } else if (g.mode === 'move') {
        const point = this.webPoint(event.clientX, event.clientY);
        if (point && g.plane) {
          g.lastMove = { x: clamp(g.origin.x + point.x - g.plane.x, -.55, .55), z: clamp(g.origin.z + point.z - g.plane.z, -.55, .55) };
          this.onMove({ ...g.lastMove, active: true, velocity });
        }
      } else if (g.mode === 'strand') {
        if (g.moved && !g.plucked) { g.plucked = true; this.onPluck({ segmentId: g.strand.segmentId, u: g.strand.u, velocity: Math.max(.25, velocity), angle: Math.atan2(dy, dx) }); }
      } else {
        this.turn.setFromAxisAngle(UP, -dx * .005); this.orbit.premultiply(this.turn);
        this.turn.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -dy * .005); this.orbit.multiply(this.turn).normalize(); this.updateCamera(); this.invalidate();
      }
      g.x = event.clientX; g.y = event.clientY; g.time = event.timeStamp;
    });
    const end = event => {
      this.pointers.delete(event.pointerId); const g = this.gesture; if (!g || g.id !== event.pointerId) return;
      if (event.type === 'pointerup' && g.pending && !g.moved) { g.pending = false; this.beginGesture(); }
      if (event.type === 'pointerup' && g.mode === 'strand' && !g.plucked && !g.pending) this.onPluck({ segmentId: g.strand.segmentId, u: g.strand.u, velocity: .6, angle: Math.PI / 2 });
      this.cancelGesture();
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(this.canvas, type, end);
    listen(this.win, 'pointerup', event => this.pointers.delete(event.pointerId));
    listen(this.canvas, 'keydown', event => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === '+' || event.key === '=') { event.preventDefault(); this.zoomBy(.87); }
      else if (event.key === '-') { event.preventDefault(); this.zoomBy(1.15); }
      else if (event.key === 'Home') { event.preventDefault(); this.fit(); }
      else if (event.key.startsWith('Arrow')) {
        event.preventDefault(); const x = event.key === 'ArrowLeft' ? -.035 : event.key === 'ArrowRight' ? .035 : 0;
        const y = event.key === 'ArrowUp' ? .035 : event.key === 'ArrowDown' ? -.035 : 0;
        if (this.selectedBone && event.shiftKey) {
          const offset = { ...(this.offsets[this.selectedBone] || { x: 0, y: 0, z: 0 }) };
          if (this.axis === 'xy') { offset.x += y; offset.y += x; } else offset[this.axis] += x + y;
          this.offsets[this.selectedBone] = offset;
          this.onInteract({ jointId: this.selectedBone, offset, active: true, velocity: .25 });
          this.onInteract({ jointId: this.selectedBone, offset: { ...offset }, active: false, velocity: 0 });
        } else { this.turn.setFromEuler(this.euler.set(y, x, 0)); this.orbit.multiply(this.turn).normalize(); this.updateCamera(); this.invalidate(); }
      }
    });
    listen(this.doc, 'visibilitychange', () => { if (this.doc.hidden) this.cancelGesture(); else this.invalidate(); });
    listen(this.win, 'blur', () => { this.cancelGesture(); this.pointers.clear(); });
    listen(this.canvas, 'webglcontextlost', event => { event.preventDefault(); this.contextLost = true; this.cancelGesture(); this.onStatus({ state: 'error', message: '3D display paused. Restoring graphics…' }); });
    listen(this.canvas, 'webglcontextrestored', () => { this.contextLost = false; this.resizeKey = ''; this.invalidate(); this.onStatus({ state: this.loaded ? 'ready' : 'loading', message: this.loaded ? 'Spider ready' : 'Loading the spider scan…' }); });
    this.resizeObserver = new this.win.ResizeObserver(() => this.invalidate()); this.resizeObserver.observe(this.canvas);
  }
  beginGesture() {
    const g = this.gesture; if (!g) return;
    try { this.canvas.setPointerCapture(g.id); } catch { /* A native scroll may already own the touch. */ }
    if (g.body) {
      this.selectJoint(g.body.jointId);
      if (g.mode === 'joint') this.onInteract({ jointId: g.body.jointId, offset: { ...(this.offsets[g.body.jointId] || { x: 0, y: 0, z: 0 }) }, active: true, velocity: 0 });
    }
  }
  cancelGesture() {
    const g = this.gesture; this.gesture = null; if (!g) return;
    if (!g.pending && g.mode === 'joint') this.onInteract({ jointId: g.body.jointId, offset: { ...(this.offsets[g.body.jointId] || { x: 0, y: 0, z: 0 }) }, active: false, velocity: 0 });
    if (!g.pending && g.mode === 'move') this.onMove({ ...(g.lastMove || g.origin), active: false, velocity: 0 });
    try { if (this.canvas.hasPointerCapture(g.id)) this.canvas.releasePointerCapture(g.id); } catch { /* Detached pointer. */ }
  }
  getState() {
    return { loaded: this.loaded, bones: this.bones.map(({ id, name, groupId, bone, index }) => ({ id, jointId: id, name, groupId, index,
      quaternion: bone.quaternion.toArray(), position: bone.getWorldPosition(this.temp[11]).toArray(), offset: { ...(this.offsets[id] || { x: 0, y: 0, z: 0 }) } })),
    selectedBone: this.selectedBone, camera: { view: this.view, side: this.side, distance: this.distance, target: this.target.toArray(), quaternion: this.orbit.toArray(), position: this.camera.position.toArray() },
    footPositions: this.legs.map(leg => ({ id: `${leg.id}_tip`, position: leg.actual.toArray(), target: leg.target.toArray(), error: leg.error, stance: !!this.frameData.feet[leg.index]?.stance })),
    contactErrors: this.legs.map(leg => leg.error), renderCount: this.renderCount, axis: this.axis, touchMode: this.touchMode, moveMode: this.moveMode,
    webSegments: this.web?.segments.length ?? 0, skin: this.mesh ? { bones: this.mesh.skeleton.bones.length, vertices: this.mesh.geometry.attributes.position.count, triangles: this.mesh.geometry.index.count / 3 } : null,
    lighting: { key: this.key.intensity, viewingFill: this.fill.intensity }, disposed: this.disposed };
  }
  dispose() {
    if (this.disposed) return; this.cancelGesture(); this.disposed = true; this.abort?.abort(); this.loadSerial++;
    if (this.frameRequest) this.win.cancelAnimationFrame(this.frameRequest);
    this.listeners.forEach(remove => remove()); this.resizeObserver.disconnect(); this.pointers.clear();
    releaseObject(this.scene); this.renderer.dispose(); this.scene.clear(); this.bones = []; this.legs = [];
  }
}
