import * as THREE from '../vendor/three/three.module.min.js';
import { GLTFLoader } from '../vendor/three/loaders/GLTFLoader.js';
import { MeshoptDecoder } from '../vendor/meshoptimizer/meshopt_decoder.module.js';
import { articulateRoachWings, updateRoachWingFans, roachWingDisplayPoints } from './roach-synth-wings.js?v=291f01aef669';

const MAX_BYTES = 64 * 1024 * 1024;
const MESHOPT = 'EXT_meshopt_compression';
const MAX_DECODED_BYTES = 64 * 1024 * 1024;
const MAX_VERTICES = 1_000_000;
const MAX_NODES = 2048;
const MAX_BONES = 512;
const MAX_RENDER_PIXELS = 1_650_000;
const RAD = Math.PI / 180;
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const finiteArray = (values) => values.every(Number.isFinite);
let decoderLoads = 0;
let decoderWorker = false;

// One temporary worker keeps decompression away from touch and audio controls.
// Overlapping replacement loads share it until every parse has settled.
function acquireDecoder() {
  if (decoderLoads++ === 0 && typeof Worker === 'function') {
    try { MeshoptDecoder.useWorkers(1); decoderWorker = true; }
    catch { decoderWorker = false; } // Environments without blob workers use the same bounded WASM decoder.
  }
  return () => {
    if (--decoderLoads === 0 && decoderWorker) { MeshoptDecoder.useWorkers(0); decoderWorker = false; }
  };
}

/** Validate before decoding images or constructing a graph. Imports stay self-contained. */
export function inspectRoachGlb(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 20 || buffer.byteLength > MAX_BYTES) {
    throw new Error('Choose a self-contained GLB file smaller than 64 MB.');
  }
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2
    || view.getUint32(8, true) !== buffer.byteLength) throw new Error('This file is not a valid GLB 2.0 model.');
  let json = null;
  let binaryBytes = 0;
  for (let offset = 12; offset < buffer.byteLength;) {
    if (offset + 8 > buffer.byteLength) throw new Error('The GLB contains an incomplete chunk.');
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    if (length % 4 || offset + 8 + length > buffer.byteLength) throw new Error('The GLB chunk length is invalid.');
    if (type === 0x4e4f534a) {
      if (json || offset !== 12 || length > 8 * 1024 * 1024) throw new Error('The GLB metadata is invalid or too large.');
      try { json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, offset + 8, length))); }
      catch { throw new Error('The GLB metadata could not be read.'); }
    } else if (type === 0x004e4942) {
      if (binaryBytes) throw new Error('The GLB contains multiple binary chunks.');
      binaryBytes = length;
    }
    offset += 8 + length;
  }
  if (!json || json.asset?.version !== '2.0') throw new Error('The GLB must use glTF 2.0.');
  const buffers = json.buffers ?? [];
  const compressed = (json.extensionsRequired ?? []).includes(MESHOPT);
  if (buffers.length > (compressed ? 2 : 1) || buffers.some((item) => item.uri != null)
    || (json.images ?? []).some((item) => item.uri != null || !Number.isInteger(item.bufferView))) {
    throw new Error('Export one GLB with all buffers and textures embedded; external resources are not supported.');
  }
  if ((buffers[0]?.byteLength ?? 0) > binaryBytes) throw new Error('The GLB binary data is incomplete.');
  if (buffers.length === 2 && (buffers[1].extensions?.[MESHOPT]?.fallback !== true
    || !Number.isSafeInteger(buffers[1].byteLength) || buffers[1].byteLength < 0 || buffers[1].byteLength > MAX_DECODED_BYTES)) {
    throw new Error('The GLB has an invalid or oversized decompression buffer.');
  }
  if ((json.nodes?.length ?? 0) > MAX_NODES || (json.images?.length ?? 0) > 96
    || (json.animations?.length ?? 0) > 128 || (json.materials?.length ?? 0) > 256) {
    throw new Error('This model exceeds the viewer’s scene or texture budget.');
  }
  const views = json.bufferViews ?? [];
  let decodedBytes = 0;
  const range = (offset, length, limit) => Number.isSafeInteger(offset) && offset >= 0
    && Number.isSafeInteger(length) && length >= 0 && offset + length <= limit;
  for (const item of views) {
    if (item.extensions?.KHR_meshopt_compression) throw new Error('This GLB uses an unsupported compressed buffer extension.');
    const packed = item.extensions?.[MESHOPT];
    const target = item.buffer ?? 0;
    const limit = target === 0 ? binaryBytes : buffers[1]?.byteLength ?? 0;
    if ((target !== 0 && !(target === 1 && compressed && packed))
      || !range(item.byteOffset ?? 0, item.byteLength, limit)) throw new Error('The GLB has an invalid buffer range.');
    if (packed) {
      const stride = packed.byteStride;
      const attributes = packed.mode === 'ATTRIBUTES' && stride >= 4 && stride <= 256 && stride % 4 === 0;
      const indices = ['INDICES', 'TRIANGLES'].includes(packed.mode) && [2, 4].includes(stride);
      if (packed.buffer !== 0 || !range(packed.byteOffset ?? 0, packed.byteLength, binaryBytes) || packed.byteLength === 0
        || !Number.isSafeInteger(packed.count) || packed.count <= 0 || !Number.isSafeInteger(stride)
        || !(attributes || indices) || (packed.filter ?? 'NONE') !== 'NONE'
        || (packed.mode === 'TRIANGLES' && packed.count % 3 !== 0)
        || packed.count * stride !== item.byteLength || (item.byteStride != null && item.byteStride !== stride)) {
        throw new Error('The GLB has an invalid compressed buffer.');
      }
      decodedBytes += item.byteLength;
      if (decodedBytes > MAX_DECODED_BYTES) throw new Error('The GLB exceeds the decompression budget.');
    }
  }
  const widths = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
  let accessorValues = 0;
  for (const accessor of json.accessors ?? []) {
    if (!Number.isInteger(accessor.count) || accessor.count < 0 || accessor.count > 6_000_000
      || !widths[accessor.type]) throw new Error('The GLB contains an invalid or oversized accessor.');
    accessorValues += accessor.count * widths[accessor.type];
  }
  if (accessorValues > 64_000_000) throw new Error('This model exceeds the viewer’s geometry and animation budget.');
  let vertices = 0;
  let primitives = 0;
  for (const mesh of json.meshes ?? []) for (const primitive of mesh.primitives ?? []) {
    vertices += json.accessors?.[primitive.attributes?.POSITION]?.count ?? 0;
    primitives += 1;
    if ((primitive.targets?.length ?? 0) > 64) throw new Error('This model contains too many morph targets.');
  }
  if (vertices > MAX_VERTICES || primitives > 512) throw new Error('Use a model with at most one million vertices and 512 mesh primitives.');
  const joints = new Set((json.skins ?? []).flatMap((skin) => skin.joints ?? []));
  (json.nodes ?? []).forEach((node, index) => { if (node.extras?.roachJoint === true) joints.add(index); });
  if (joints.size > MAX_BONES) throw new Error('Use a model with at most 512 skeleton joints.');
  const nodes = json.nodes ?? [];
  const marks = new Uint8Array(nodes.length);
  const parents = new Int32Array(nodes.length).fill(-1);
  function visit(index, depth = 0) {
    if (!Number.isInteger(index) || index < 0 || index >= nodes.length || marks[index] === 1 || depth > 128) {
      throw new Error('The GLB node hierarchy is invalid or too deep.');
    }
    if (marks[index] === 2) return;
    marks[index] = 1;
    for (const child of nodes[index].children ?? []) {
      if (parents[child] !== -1) throw new Error('The GLB node hierarchy has multiple parents.');
      parents[child] = index;
      visit(child, depth + 1);
    }
    marks[index] = 2;
  }
  nodes.forEach((_, index) => visit(index));
  return { json, vertices, joints: joints.size, bytes: buffer.byteLength };
}

function disposeObject(root) {
  if (!root) return;
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  const skeletons = new Set();
  root.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    if (object.skeleton) skeletons.add(object.skeleton);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!material || materials.has(material)) continue;
      materials.add(material);
      Object.values(material).forEach((value) => { if (value?.isTexture) textures.add(value); });
    }
  });
  textures.forEach((texture) => { texture.source?.data?.close?.(); texture.dispose(); });
  materials.forEach((material) => material.dispose());
  geometries.forEach((geometry) => geometry.dispose());
  skeletons.forEach((skeleton) => skeleton.dispose());
}

/** Owns WebGL and model manipulation only; no audio or page controls. */
export function createRoachViewer({ canvas, onStatus = () => {}, onRig = () => {}, onSelect = () => {},
  onPoseChange = () => {}, onInteraction = () => {} }) {
  if (!canvas?.getContext) throw new TypeError('A canvas is required.');
  const doc = canvas.ownerDocument;
  const win = doc.defaultView;
  const motionQuery = win.matchMedia('(prefers-reduced-motion: reduce)');
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x090d12);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.86;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const ambientLight = new THREE.HemisphereLight(0xd7dbe0, 0x11100f, 0.536);
  scene.add(ambientLight);
  const keyLight = new THREE.DirectionalLight(0xfff8f1, 1.68);
  keyLight.position.set(-3, 5, 4);
  scene.add(keyLight);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1024, 1024);
  Object.assign(keyLight.shadow.camera, { left: -3.7, right: 3.7, top: 3.7, bottom: -3.7, near: 0.1, far: 18 });
  keyLight.shadow.bias = -0.00018;
  keyLight.shadow.normalBias = 0.002;
  const edgeLight = new THREE.DirectionalLight(0xc2cbd7, 0.44);
  edgeLight.position.set(4, 2, -3);
  scene.add(edgeLight);
  const fillLight = new THREE.DirectionalLight(0xc3c5c7, 0.168);
  fillLight.position.set(0, -3, 1);
  scene.add(fillLight);
  const bottomLight = new THREE.DirectionalLight(0xe0e6ec, 2.04);
  scene.add(bottomLight, bottomLight.target);

  // The normalized specimen is articulated inside this world-space performer
  // group, so standing, landing and jumping retain one fixed ground plane.
  const performer = new THREE.Group();
  const content = new THREE.Group();
  performer.add(content);
  scene.add(performer);
  const groundRoot = new THREE.Group();
  const groundTextureData = new Uint8Array(128 * 128 * 4);
  let groundSeed = 917;
  for (let i = 0; i < 128 * 128; i += 1) {
    groundSeed = (Math.imul(groundSeed, 1664525) + 1013904223) >>> 0;
    const grain = 65 + (groundSeed >>> 27) + (i % 128 === 0 || i < 128 ? 12 : 0);
    groundTextureData.set([grain + 5, grain + 2, grain, 255], i * 4);
  }
  const groundTexture = new THREE.DataTexture(groundTextureData, 128, 128);
  groundTexture.colorSpace = THREE.SRGBColorSpace;
  groundTexture.wrapS = groundTexture.wrapT = THREE.RepeatWrapping;
  groundTexture.repeat.set(28, 28);
  groundTexture.needsUpdate = true;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshStandardMaterial({
    color: 0x59514a, map: groundTexture, roughness: 0.96, metalness: 0, side: THREE.FrontSide,
  }));
  ground.receiveShadow = true;
  groundRoot.add(ground);
  const contactShade = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { opacity: { value: 0.3 } },
    vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: 'varying vec2 vUv; uniform float opacity; void main(){float r=length((vUv-.5)*2.0);gl_FragColor=vec4(0.0,0.0,0.0,pow(max(0.0,1.0-r),2.0)*opacity);}',
  }));
  contactShade.position.z = 0.001;
  groundRoot.add(contactShade);
  const footContacts = Array.from({ length: 6 }, () => {
    const mark = new THREE.Mesh(new THREE.RingGeometry(0.015, 0.026, 12), new THREE.MeshBasicMaterial({
      color: 0x8e7053, transparent: true, opacity: 0, depthWrite: false,
    }));
    mark.position.z = 0.002;
    groundRoot.add(mark);
    return mark;
  });
  groundRoot.visible = false;
  scene.add(groundRoot);
  const target = new THREE.Vector3();
  const orbitQuaternion = new THREE.Quaternion();
  const turn = new THREE.Quaternion();
  const axisX = new THREE.Vector3(1, 0, 0);
  const axisY = new THREE.Vector3(0, 1, 0);
  const baseOffset = new THREE.Vector3();
  const euler = new THREE.Euler();
  const deltaRotation = new THREE.Quaternion();
  const projected = new THREE.Vector3();
  const selectedMarker = new THREE.Mesh(
    new THREE.SphereGeometry(0.018, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0xeeff99, depthTest: false, transparent: true, opacity: 0.92 }),
  );
  selectedMarker.visible = false;
  selectedMarker.renderOrder = 10;
  scene.add(selectedMarker);
  let distance = 4.5;
  let viewPreset = 'side';
  let viewSide = 'left';
  let anatomy = null;
  let sceneState = null;
  let groundHeight = 0;
  let groundingOffset = 0;
  let contactEvidence = [];
  let footJoints = [];
  let externalPose = null;
  let renderFps = 60;
  let renderPixelRatio = 1.75;
  let lastRenderTime = null;
  let renderCount = 0;
  let model = null;
  let wingRig = null;
  let mixer = null;
  let action = null;
  let bones = [];
  let clips = [];
  let restNodes = [];
  let skeletonHelper = null;
  let skeletonVisible = false;
  let jointPoints = null;
  let jointLinks = null;
  let selectedBone = null;
  let clipIndex = -1;
  let speed = 1;
  let playing = false;
  let motionTime = 0;
  let modelName = '';
  let loadSerial = 0;
  let loadAbort = null;
  let disposed = false;
  let contextLost = false;
  let frame = 0;
  let lastTime = null;
  let dirty = true;
  let size = '';
  let pointerMoved = false;
  let dragAxis = 'xy';
  let touchInteraction = false;
  let gesture = null;
  const pointers = new Map();
  const cleanups = [];
  const previousTouchAction = canvas.style.touchAction;
  canvas.style.touchAction = 'pan-y';

  function listen(element, type, handler, options) {
    element.addEventListener(type, handler, options);
    cleanups.push(() => element.removeEventListener(type, handler, options));
  }
  function boneState(item) {
    const rect = canvas.getBoundingClientRect();
    const point = item.meshCenter?.clone().applyMatrix4(item.bone.matrixWorld) ?? item.bone.getWorldPosition(new THREE.Vector3());
    point.project(camera);
    return { id: item.id, name: item.bone.userData.displayName || item.bone.name || `Joint ${item.index + 1}`,
      group: item.bone.userData.jointGroup ?? 'Skeleton', parent: item.parent,
      jointId: item.bone.userData.jointId ?? null,
      suggestedRotationLimitDegrees: item.bone.userData.suggestedRotationLimitDegrees ?? null,
      kinematics: item.kinematics ?? null,
      restOffset: item.restOffset ? { ...item.restOffset } : { x: 0, y: 0, z: 0 },
      gaitPose: item.gaitPose ? Object.fromEntries(Object.entries(item.gaitPose).map(([key, angles]) => [key, [...angles]])) : null,
      wingOpenSign: item.bone.userData.wingOpenSign ?? null,
      wingLayer: item.bone.userData.wingLayer ?? null,
      authoredReconstruction: !!item.bone.userData.authoredReconstruction,
      poseLimits: item.poseLimits ?? null, collisionSamples: item.collisionSamples ?? null,
      bodyEllipsoid: item.bodyEllipsoid ?? null,
      screenPosition: { x: rect.left + (point.x + 1) * rect.width / 2,
        y: rect.top + (1 - point.y) * rect.height / 2, inFrame: Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1 && Math.abs(point.z) <= 1 },
      offset: { ...item.offset }, motion: { ...item.motion }, quaternion: item.bone.quaternion.toArray() };
  }
  function getPlaybackState() {
    return { time: action?.time ?? 0, duration: clips[clipIndex]?.duration ?? 0, playing, speed, motionTime, clipIndex };
  }
  function getState() {
    return { loaded: !!model, modelName, bones: bones.map(boneState), selectedBone,
      clips: clips.map((clip) => ({ name: clip.name || 'Animation', duration: clip.duration })),
      clipIndex, time: action?.time ?? 0, playing, speed, motionTime,
      skeletonVisible, reducedMotion: motionQuery.matches,
      camera: { position: camera.position.toArray(), quaternion: camera.quaternion.toArray(),
        target: target.toArray(), distance, viewPreset, side: viewSide },
      externalPoseActive: externalPose !== null, renderBudget: { fps: renderFps, pixelRatio: renderPixelRatio }, renderCount,
      interaction: { dragAxis, touchInteraction, touchAction: canvas.style.touchAction, pointerCount: pointers.size,
        active: gesture ? { kind: gesture.kind, jointId: gesture.id ?? null, committed: gesture.committed } : null },
      lighting: { exposure: renderer.toneMappingExposure, ambient: ambientLight.intensity,
        key: keyLight.intensity, bottomFill: bottomLight.intensity, selfShadow: renderer.shadowMap.enabled, shadowSize: keyLight.shadow.mapSize.x },
      wings: wingRig ? { independent: 4, reconstructedHindwings: 2, splitTexturedCovers: 2,
        originalPairedMeshRemoved: true, sourceTriangles: wingRig.sourceTriangles, coverTriangles: wingRig.coverTriangles,
        fanOpen: wingRig.fans.map((fan) => fan.membrane.morphTargetInfluences[0]) } : null,
      ground: { visible: groundRoot.visible, receivesShadow: ground.receiveShadow, height: groundHeight,
        bodyLength: anatomy?.bodyLength ?? 0, bellyHeight: anatomy?.bellyHeight ?? 0,
        normal: anatomy?.dorsal.toArray() ?? [0, 1, 0],
        offset: sceneState?.groundOffset ?? 0, groundingOffset, contacts: contactEvidence.map((foot) => ({ ...foot })),
        body: sceneState?.body ? { ...sceneState.body } : null },
      renderSize: { width: canvas.width, height: canvas.height }, disposed };
  }
  function announce() { if (!disposed) onRig(getState()); }
  function updateCamera() {
    camera.position.copy(baseOffset.set(0, 0, distance).applyQuaternion(orbitQuaternion)).add(target);
    camera.quaternion.copy(orbitQuaternion);
    camera.updateMatrixWorld();
    // The same camera-relative fill keeps every view as readable as the underside.
    bottomLight.position.copy(camera.position).addScaledVector(new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion), distance * .35);
    bottomLight.target.position.copy(target);
  }
  function invalidate() {
    dirty = true;
    if (!frame && !disposed && !doc.hidden && !contextLost) frame = win.requestAnimationFrame(render);
  }
  function captureAnatomy() {
    content.updateMatrixWorld(true);
    const jointObjects = new Set(bones.map((item) => item.bone));
    const bounds = new THREE.Box3().setFromObject(content);
    // Eight corners per rendered part give a tighter fit than one large world
    // box, without scanning vertices when switching views or resizing.
    const fitPoints = [];
    content.traverse((object) => {
      if (!object.geometry) return;
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
      const box = object.boundingBox ?? object.geometry.boundingBox;
      if (box.isEmpty()) return;
      for (let mask = 0; mask < 8; mask += 1) {
        fitPoints.push(new THREE.Vector3(
          mask & 1 ? box.max.x : box.min.x,
          mask & 2 ? box.max.y : box.min.y,
          mask & 4 ? box.max.z : box.min.z,
        ).applyMatrix4(object.matrixWorld));
      }
    });
    const find = (id, pattern) => bones.find((item) => item.bone.userData.jointId === id)
      ?? bones.find((item) => pattern.test(item.bone.userData.displayName || item.bone.name));
    function ownBounds(item) {
      const result = new THREE.Box3();
      if (!item) return result;
      item.bone.traverse((object) => {
        if (!object.geometry) return;
        let parent = object;
        while (parent && !jointObjects.has(parent)) parent = parent.parent;
        if (parent !== item.bone && !(item.bone.userData.jointId === 'wings' && object.userData.splitPhotogrammetryCover)) return;
        if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
        result.union(object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld));
      });
      return result;
    }
    const headItem = find('head', /^head$/i);
    const bodyItem = find('body', /body|thorax/i);
    const wingsItem = find('wings', /wing/i);
    const neckBounds = ownBounds(find('neck', /neck|pronotum/i));
    const abdomenBounds = ownBounds(find('abdomen', /abdomen/i));
    const headBounds = ownBounds(headItem);
    const bodyBounds = ownBounds(bodyItem);
    const wingBounds = ownBounds(wingsItem);
    const center = bounds.getCenter(new THREE.Vector3());
    const bodyCenter = bodyBounds.isEmpty() ? center.clone() : bodyBounds.getCenter(new THREE.Vector3());
    const headCenter = headBounds.isEmpty() ? center.clone().add(new THREE.Vector3(0, 0.8, 0)) : headBounds.getCenter(new THREE.Vector3());
    const faceForward = headCenter.clone().sub(bodyCenter).normalize();
    const forward = !neckBounds.isEmpty() && !abdomenBounds.isEmpty()
      ? neckBounds.getCenter(new THREE.Vector3()).sub(abdomenBounds.getCenter(new THREE.Vector3())).normalize()
      : faceForward.clone();
    if (forward.lengthSq() < 0.5) forward.set(0, 1, 0);
    const dorsal = wingBounds.isEmpty() ? new THREE.Vector3(0, 0, -1) : wingBounds.getCenter(new THREE.Vector3()).sub(bodyCenter);
    dorsal.addScaledVector(forward, -dorsal.dot(forward)).normalize();
    if (dorsal.lengthSq() < 0.5) dorsal.set(0, 0, -1);
    const left = new THREE.Vector3().crossVectors(dorsal, forward).normalize();
    const leftLeg = find('front_left_proximal', /front left.*proximal/i);
    const rightLeg = find('front_right_proximal', /front right.*proximal/i);
    if (leftLeg && rightLeg) {
      const measuredLeft = leftLeg.bone.getWorldPosition(new THREE.Vector3()).sub(rightLeg.bone.getWorldPosition(new THREE.Vector3()));
      if (left.dot(measuredLeft) < 0) left.negate();
    }
    if (headBounds.isEmpty()) headBounds.copy(bounds);
    const bodyLength = Math.max(0.35, neckBounds.isEmpty() || abdomenBounds.isEmpty()
      ? bounds.getSize(new THREE.Vector3()).length() * 0.55
      : headCenter.distanceTo(abdomenBounds.getCenter(new THREE.Vector3())) * 1.35);
    const bellySamples = [];
    find('abdomen', /abdomen/i)?.bone.traverse((object) => {
      if (!object.geometry?.attributes?.position) return;
      const positions = object.geometry.attributes.position;
      const vertex = new THREE.Vector3();
      for (let i = 0; i < positions.count; i += 1) bellySamples.push(vertex.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld).dot(dorsal));
    });
    bellySamples.sort((a, b) => a - b);
    const bellyHeight = bellySamples[Math.floor(bellySamples.length * .025)] ?? bodyCenter.dot(dorsal);
    anatomy = { bounds, fitPoints, headBounds, center, bodyCenter, headCenter, forward, faceForward, dorsal, left, bodyLength, bellyHeight };
    captureFeet();
    // Lower the authored support posture by moving the grounded foot targets
    // toward the belly; do not push the rendered body through a fixed floor.
    groundHeight = bellyHeight - bodyLength * 0.12;
    calibrateStance();
    captureCollisionBounds();
    performer.updateMatrixWorld(true);
    anatomy.bounds.setFromObject(content);
    anatomy.center.copy(anatomy.bounds.getCenter(new THREE.Vector3()));
    anatomy.fitPoints.length = 0;
    content.traverse((object) => {
      const box = object.boundingBox ?? object.geometry?.boundingBox;
      if (!box || box.isEmpty()) return;
      for (let mask = 0; mask < 8; mask += 1) anatomy.fitPoints.push(new THREE.Vector3(
        mask & 1 ? box.max.x : box.min.x, mask & 2 ? box.max.y : box.min.y, mask & 4 ? box.max.z : box.min.z,
      ).applyMatrix4(object.matrixWorld));
    });
    const points = footJoints.length ? footJoints.map((item) => item.tip.clone().applyMatrix4(item.bone.matrixWorld)) : fitPoints;
    groundHeight = Math.min(...points.map((point) => point.dot(dorsal))) - 0.006;
    groundRoot.position.copy(dorsal).multiplyScalar(groundHeight);
    // Plane local +Y is the travel direction; +Z is the dorsal/up direction.
    const planeRight = new THREE.Vector3().crossVectors(forward, dorsal).normalize();
    groundRoot.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(planeRight, forward, dorsal));
    contactShade.scale.set(bodyLength * 0.9, bodyLength * 1.65, 1);
    groundRoot.visible = true;
    keyLight.position.copy(bodyCenter).addScaledVector(dorsal, 5).addScaledVector(left, 3).addScaledVector(forward, 2);
    keyLight.target.position.copy(bodyCenter);
    scene.add(keyLight.target);
    edgeLight.position.copy(bodyCenter).addScaledVector(dorsal, 1.4).addScaledVector(left, -3).addScaledVector(forward, -2);
    fillLight.position.copy(bodyCenter).addScaledVector(dorsal, -2);
    ambientLight.position.copy(dorsal);
  }
  function captureFeet() {
    const terminalIds = ['front_left_distal', 'front_right_distal', 'middle_left_distal', 'middle_right_distal', 'hind_left_foot', 'hind_right_foot'];
    const jointObjects = new Set(bones.map((item) => item.bone));
    footJoints = [];
    for (const item of bones) {
      const parent = bones.find((other) => other.id === item.parent);
      const parentWorld = parent ? parent.bone.matrixWorld : item.bone.parent?.matrixWorld ?? new THREE.Matrix4();
      const relative = parentWorld.clone().invert().multiply(item.bone.matrixWorld);
      const position = new THREE.Vector3();
      const quaternion = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      relative.decompose(position, quaternion, scale);
      item.kinematics = { position: position.toArray(), quaternion: quaternion.toArray(), scale: scale.toArray(),
        parentMatrix: parent ? null : parentWorld.toArray(), footTip: null };
      item.restWorldQuaternion = item.bone.getWorldQuaternion(new THREE.Quaternion());
      item.meshSamples = [];
      const meshBounds = new THREE.Box3();
      const toJoint = item.bone.matrixWorld.clone().invert();
      item.bone.traverse((object) => {
        if (!object.geometry?.attributes?.position) return;
        let owner = object;
        while (owner && !jointObjects.has(owner)) owner = owner.parent;
        if (owner !== item.bone) return;
        const relativeMesh = toJoint.clone().multiply(object.matrixWorld);
        if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
        meshBounds.union(object.geometry.boundingBox.clone().applyMatrix4(relativeMesh));
        const vertices = object.geometry.attributes.position;
        for (let i = 0; i < vertices.count; i += Math.max(1, Math.ceil(vertices.count / 32))) {
          item.meshSamples.push(new THREE.Vector3().fromBufferAttribute(vertices, i).applyMatrix4(relativeMesh));
        }
      });
      item.meshCenter = meshBounds.isEmpty() ? null : meshBounds.getCenter(new THREE.Vector3());
      if (item.meshCenter) item.meshSamples.unshift(item.meshCenter);
      const footIndex = terminalIds.indexOf(item.bone.userData.jointId);
      if (footIndex < 0) continue;
      const inverseJoint = item.bone.matrixWorld.clone().invert();
      const tip = new THREE.Vector3();
      const vertex = new THREE.Vector3();
      let farthest = -1;
      item.bone.traverse((object) => {
        if (!object.geometry?.attributes?.position) return;
        let owner = object;
        while (owner && !jointObjects.has(owner)) owner = owner.parent;
        if (owner !== item.bone) return;
        const vertices = object.geometry.attributes.position;
        const relativeMesh = inverseJoint.clone().multiply(object.matrixWorld);
        for (let i = 0; i < vertices.count; i += 1) {
          vertex.fromBufferAttribute(vertices, i).applyMatrix4(relativeMesh);
          if (vertex.lengthSq() > farthest) { farthest = vertex.lengthSq(); tip.copy(vertex); }
        }
      });
      item.kinematics.footTip = tip.toArray();
      footJoints.push({ id: terminalIds[footIndex].replace(/_(distal|foot)$/, ''), index: footIndex, bone: item.bone, tip });
    }
    footJoints.sort((a, b) => a.index - b.index);
  }
  function captureCollisionBounds() {
    const body = bones.find((item) => item.bone.userData.jointId === 'body');
    const abdomen = bones.find((item) => item.bone.userData.jointId === 'abdomen');
    if (body && abdomen) {
      const box = new THREE.Box3();
      const inverse = body.bone.matrixWorld.clone().invert();
      abdomen.bone.traverse((object) => {
        if (!object.geometry?.boundingBox) return;
        box.union(object.geometry.boundingBox.clone().applyMatrix4(inverse.clone().multiply(object.matrixWorld)));
      });
      if (!box.isEmpty()) body.bodyEllipsoid = { jointId: body.id,
        center: box.getCenter(new THREE.Vector3()).toArray(),
        radii: box.getSize(new THREE.Vector3()).multiplyScalar(.425).toArray() };
    }
    for (const item of bones) {
      const id = item.bone.userData.jointId ?? '';
      let limit = /antenna/.test(id) ? 75 : id === 'head' ? 35 : id === 'neck' ? 18 : id === 'abdomen' ? 12 : 65;
      if (/_(left|right)_proximal$/.test(id)) limit = 55;
      else if (/_(left|right)_middle$/.test(id)) limit = 70;
      item.poseLimits = { x: [-limit, limit], y: [-limit, limit], z: [-limit, limit] };
      if (id === 'wings') item.poseLimits = { x: [-8, 8], y: [-10, 10], z: [-8, 8] };
      if (item.bone.userData.wingLayer) {
        const sign = item.bone.userData.wingOpenSign;
        item.poseLimits = { x: [-18, 18], y: sign > 0 ? [0, 65] : [-65, 0], z: sign > 0 ? [0, 110] : [-110, 0] };
      }
      const samples = (item.meshSamples ?? []).slice(1).sort((a, b) => b.lengthSq() - a.lengthSq());
      const outer = samples.slice(0, Math.max(8, Math.ceil(samples.length * .65)));
      item.collisionSamples = Array.from({ length: Math.min(8, outer.length) }, (_, i) => outer[Math.floor(i * outer.length / Math.min(8, outer.length))].toArray());
    }
  }
  function calibrateStance() {
    if (footJoints.length !== 6) return;
    const { bodyLength, bodyCenter, dorsal, forward, left } = anatomy;
    const pivot = new THREE.Vector3();
    const endpoint = new THREE.Vector3();
    const targetPoint = new THREE.Vector3();
    const currentDirection = new THREE.Vector3();
    const desiredDirection = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const parentRotation = new THREE.Quaternion();
    const localRotation = new THREE.Quaternion();
    function chainFor(foot) {
      const chain = [];
      let bone = foot.bone;
      while (bone && bone.userData.jointId !== 'body') {
        if (bone.userData.roachJoint) chain.push(bone);
        bone = bone.parent;
      }
      return chain;
    }
    function solve(foot, target, chain, steps = 52) {
      for (let iteration = 0; iteration < steps; iteration += 1) {
        endpoint.copy(foot.tip).applyMatrix4(foot.bone.matrixWorld);
        if (endpoint.distanceToSquared(target) < 0.000016) break;
        for (const joint of chain) {
          joint.getWorldPosition(pivot);
          endpoint.copy(foot.tip).applyMatrix4(foot.bone.matrixWorld);
          currentDirection.copy(endpoint).sub(pivot).normalize();
          desiredDirection.copy(target).sub(pivot).normalize();
          rotation.setFromUnitVectors(currentDirection, desiredDirection);
          const angle = 2 * Math.acos(Math.min(1, Math.abs(rotation.w)));
          if (angle > 0.36) rotation.slerp(new THREE.Quaternion(), 1 - 0.36 / angle);
          joint.parent.getWorldQuaternion(parentRotation);
          localRotation.copy(parentRotation).invert().multiply(rotation).multiply(parentRotation);
          joint.quaternion.premultiply(localRotation).normalize();
          performer.updateMatrixWorld(true);
        }
      }
    }
    function readOffset(item) {
      const rest = new THREE.Euler().setFromQuaternion(item.baseQuaternion.clone().invert().multiply(item.bone.quaternion), 'XYZ');
      return { x: rest.x / RAD, y: rest.y / RAD, z: rest.z / RAD };
    }
    function groundedLeg(foot, target, preserveBranch = false) {
      const chain = chainFor(foot);
      const femur = chain.find((joint) => /_(left|right)_middle$/.test(joint.userData.jointId));
      const tibia = chain.find((joint) => /_(left|right)_distal$/.test(joint.userData.jointId));
      if (!femur || !tibia) { solve(foot, target, chain); return; }
      const hipPoint = femur.getWorldPosition(new THREE.Vector3());
      const kneePoint = tibia.getWorldPosition(new THREE.Vector3());
      const tipPoint = foot.tip.clone().applyMatrix4(foot.bone.matrixWorld);
      const firstLength = hipPoint.distanceTo(kneePoint), secondLength = kneePoint.distanceTo(tipPoint);
      const direction = target.clone().sub(hipPoint);
      const distance = Math.max(.0001, direction.length()); direction.normalize();
      const cosine = clamp((firstLength ** 2 + distance ** 2 - secondLength ** 2) / (2 * firstLength * distance), -1, 1);
      const sign = foot.id.endsWith('left') ? 1 : -1;
      const verticalPole = dorsal.clone().addScaledVector(direction, -dorsal.dot(direction)).normalize();
      const lateralPole = new THREE.Vector3().crossVectors(direction, verticalPole).normalize();
      const bend = firstLength * Math.sqrt(Math.max(0, 1 - cosine ** 2));
      // Choose the IK branch on a horizontal knee-height plane. Merely aiming
      // toward an outward hint can flip a long rear femur above the back.
      const kneeHeight = anatomy.bellyHeight;
      const verticalAmount = clamp((kneeHeight - hipPoint.dot(dorsal) - firstLength * cosine * direction.dot(dorsal))
        / Math.max(.00001, bend * verticalPole.dot(dorsal)), -1, 1);
      // Keep the neutral knee branch through the whole stride. Choosing the
      // outward-X sign again can flip a front knee as its target crosses the hip.
      const branch = preserveBranch
        ? (kneePoint.clone().sub(hipPoint).dot(lateralPole) >= 0 ? 1 : -1)
        : (lateralPole.dot(left) * sign >= 0 ? 1 : -1);
      const pole = verticalPole.multiplyScalar(verticalAmount).addScaledVector(lateralPole,
        Math.sqrt(Math.max(0, 1 - verticalAmount ** 2)) * branch);
      const desiredKnee = hipPoint.clone().addScaledVector(direction, firstLength * cosine)
        .addScaledVector(pole, bend);
      function align(joint, from, to) {
        rotation.setFromUnitVectors(from.normalize(), to.normalize());
        joint.parent.getWorldQuaternion(parentRotation);
        localRotation.copy(parentRotation).invert().multiply(rotation).multiply(parentRotation);
        joint.quaternion.premultiply(localRotation).normalize();
        performer.updateMatrixWorld(true);
      }
      align(femur, kneePoint.sub(hipPoint), desiredKnee.clone().sub(hipPoint));
      tibia.getWorldPosition(pivot);
      endpoint.copy(foot.tip).applyMatrix4(foot.bone.matrixWorld);
      align(tibia, endpoint.sub(pivot), target.clone().sub(pivot));
    }
    for (const foot of footJoints) {
      const sign = foot.id.endsWith('left') ? 1 : -1;
      const rank = foot.index >> 1;
      targetPoint.copy(bodyCenter).addScaledVector(left, sign * bodyLength * [0.46, 0.59, 0.53][rank])
        .addScaledVector(forward, bodyLength * [0.28, -0.02, -0.38][rank]);
      targetPoint.addScaledVector(dorsal, groundHeight - targetPoint.dot(dorsal));
      groundedLeg(foot, targetPoint);
      foot.target = targetPoint.clone();
    }
    for (const item of bones) item.restOffset = readOffset(item);
    // Four load-time target solves per foot make a small, shared gait table.
    // The audio worklet and the display interpolate the same joint angles;
    // no display-only inverse kinematics can drift away from the sound.
    const corners = [['back', -1, 0], ['front', 1, 0], ['raisedBack', -1, 1], ['raisedFront', 1, 1]];
    for (const foot of footJoints) {
      const chain = chainFor(foot);
      const items = chain.map((joint) => bones.find((item) => item.bone === joint));
      const neutral = chain.map((joint) => joint.quaternion.clone());
      for (const item of items) item.gaitPose = {};
      for (const [key, stride, lift] of corners) {
        chain.forEach((joint, i) => joint.quaternion.copy(neutral[i]));
        performer.updateMatrixWorld(true);
        // Small strides stay inside calibrated joint limits and interpolate
        // near the ground instead of stretching the scanned legs straight.
        targetPoint.copy(foot.target).addScaledVector(forward, stride * bodyLength * 0.04).addScaledVector(dorsal, lift * bodyLength * 0.1);
        groundedLeg(foot, targetPoint, true);
        for (const item of items) {
          const offset = readOffset(item);
          item.gaitPose[key] = [offset.x, offset.y, offset.z];
        }
      }
      chain.forEach((joint, i) => joint.quaternion.copy(neutral[i]));
      performer.updateMatrixWorld(true);
    }
  }

  function frameView() {
    if (!anatomy) {
      distance = 4.5;
      target.set(0, 0, 0);
      orbitQuaternion.setFromEuler(euler.set(-0.3, Math.PI + 0.32, 0, 'YXZ'));
      updateCamera();
      return;
    }
    const { forward, dorsal, left } = anatomy;
    const direction = new THREE.Vector3();
    const up = new THREE.Vector3();
    const viewBounds = (viewPreset === 'face' ? anatomy.headBounds : anatomy.bounds).clone();
    target.copy(viewPreset === 'face' ? anatomy.headCenter : anatomy.center).applyMatrix4(performer.matrixWorld);
    if (viewPreset === 'side') {
      direction.copy(left).multiplyScalar(viewSide === 'left' ? 1 : -1).addScaledVector(dorsal, 0.24).normalize();
      up.copy(dorsal);
    } else if (viewPreset === 'top') {
      direction.copy(dorsal); up.copy(forward);
    } else if (viewPreset === 'bottom') {
      direction.copy(dorsal).negate(); up.copy(forward);
    } else {
      direction.copy(anatomy.faceForward).addScaledVector(dorsal, -0.65).normalize();
      up.copy(dorsal);
      viewBounds.expandByScalar(viewBounds.getSize(new THREE.Vector3()).length() * 0.16);
    }
    camera.position.copy(target).add(direction);
    camera.up.copy(up);
    camera.lookAt(target);
    orbitQuaternion.copy(camera.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(orbitQuaternion);
    const cameraUp = new THREE.Vector3(0, 1, 0).applyQuaternion(orbitQuaternion);
    const rect = canvas.getBoundingClientRect();
    const aspect = Math.max(0.1, rect.width / Math.max(1, rect.height));
    const tangent = Math.tan(camera.fov * RAD / 2);
    const corner = new THREE.Vector3();
    distance = 0.3;
    const pointCount = viewPreset === 'face' ? 8 : anatomy.fitPoints.length;
    for (let mask = 0; mask < pointCount; mask += 1) {
      if (viewPreset === 'face') {
        corner.set(mask & 1 ? viewBounds.max.x : viewBounds.min.x,
          mask & 2 ? viewBounds.max.y : viewBounds.min.y,
          mask & 4 ? viewBounds.max.z : viewBounds.min.z).applyMatrix4(performer.matrixWorld).sub(target);
      } else corner.copy(anatomy.fitPoints[mask]).applyMatrix4(performer.matrixWorld).sub(target);
      const depth = corner.dot(direction);
      distance = Math.max(distance, depth + Math.abs(corner.dot(right)) / (tangent * aspect), depth + Math.abs(corner.dot(cameraUp)) / tangent);
    }
    if (viewPreset !== 'face' && wingRig?.unfolded > .12) {
      for (const point of roachWingDisplayPoints(wingRig)) {
        corner.copy(point).sub(target);
        const depth = corner.dot(direction);
        distance = Math.max(distance, depth + Math.abs(corner.dot(right)) / (tangent * aspect), depth + Math.abs(corner.dot(cameraUp)) / tangent);
      }
    }
    distance = clamp(distance * 1.1, 0.3, 16);
    updateCamera();
  }
  function setViewPreset(view, { side = viewSide } = {}) {
    if (!['side', 'top', 'bottom', 'face'].includes(view)) return false;
    viewPreset = view;
    viewSide = side === 'right' ? 'right' : 'left';
    frameView();
    invalidate();
    return true;
  }
  function resetCamera() { setViewPreset(viewPreset, { side: viewSide }); }
  function orbit(dx, dy) {
    turn.setFromAxisAngle(axisY, -dx);
    orbitQuaternion.multiply(turn);
    turn.setFromAxisAngle(axisX, -dy);
    orbitQuaternion.multiply(turn).normalize();
    updateCamera();
    invalidate();
  }
  function zoom(factor) {
    if (!Number.isFinite(factor) || factor <= 0 || disposed) return false;
    distance = clamp(distance * factor, 0.15, 16);
    updateCamera();
    invalidate();
    return true;
  }
  function resize() {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const ratio = Math.min(renderPixelRatio, win.devicePixelRatio || 1, Math.sqrt(MAX_RENDER_PIXELS / (width * height)));
    const key = `${width}:${height}:${ratio}`;
    if (key === size) return;
    size = key;
    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    // A resize changes the projection aspect, never the chosen camera distance.
    // Framing belongs to initial load and explicit view/reset actions.
    dirty = true;
  }
  function restoreAnimationBase() {
    for (const item of bones) item.bone.quaternion.copy(item.baseQuaternion);
  }
  function applyPose(delta = 0) {
    performer.position.set(0, 0, 0);
    performer.quaternion.identity();
    restoreAnimationBase();
    if (mixer) mixer.update(delta);
    for (const item of bones) {
      item.baseQuaternion.copy(item.bone.quaternion);
      let x = item.offset.x + (item.restOffset?.x ?? 0);
      let y = item.offset.y + (item.restOffset?.y ?? 0);
      let z = item.offset.z + (item.restOffset?.z ?? 0);
      if (externalPose) {
        x = externalPose[item.index * 3];
        y = externalPose[item.index * 3 + 1];
        z = externalPose[item.index * 3 + 2];
      } else if (item.motion.enabled) {
        const value = Math.sin(motionTime * Math.PI * 2 * item.motion.speed) * item.motion.amplitude;
        if (item.motion.axis === 'x') x += value;
        else if (item.motion.axis === 'y') y += value;
        else z += value;
      }
      deltaRotation.setFromEuler(euler.set(x * RAD, y * RAD, z * RAD, 'XYZ'));
      item.bone.quaternion.multiply(deltaRotation).normalize();
    }
    performer.updateMatrixWorld(true);
    updateRoachWingFans(wingRig);
    applyScenePose();
    const selected = bones.find((item) => item.id === selectedBone);
    selectedMarker.visible = skeletonVisible && !!selected;
    if (skeletonVisible && jointPoints) {
      const pointPositions = jointPoints.geometry.attributes.position;
      const linePositions = jointLinks.geometry.attributes.position;
      let edge = 0;
      for (const item of bones) {
        item.bone.getWorldPosition(projected);
        pointPositions.setXYZ(item.index, projected.x, projected.y, projected.z);
        const parent = bones.find((candidate) => candidate.id === item.parent);
        if (parent) {
          linePositions.setXYZ(edge++, projected.x, projected.y, projected.z);
          parent.bone.getWorldPosition(projected);
          linePositions.setXYZ(edge++, projected.x, projected.y, projected.z);
        }
      }
      pointPositions.needsUpdate = true;
      linePositions.needsUpdate = true;
    }
    if (selected) {
      selected.bone.getWorldPosition(selectedMarker.position);
      selectedMarker.scale.setScalar(Math.max(0.5, distance / 4.5));
    }
  }
  const worldFoot = new THREE.Vector3();
  const shadeCenter = new THREE.Vector3();
  const sceneTurn = new THREE.Quaternion();
  function applyScenePose() {
    if (!anatomy) return;
    const { bodyCenter, bodyLength, dorsal, forward, left } = anatomy;
    const body = sceneState?.body;
    performer.quaternion.setFromAxisAngle(left, -(body?.pitch ?? 0) * RAD);
    sceneTurn.setFromAxisAngle(forward, (body?.roll ?? 0) * RAD);
    performer.quaternion.multiply(sceneTurn);
    sceneTurn.setFromAxisAngle(dorsal, (body?.yaw ?? 0) * RAD);
    performer.quaternion.multiply(sceneTurn);
    performer.position.copy(bodyCenter).sub(projected.copy(bodyCenter).applyQuaternion(performer.quaternion));
    performer.updateMatrixWorld(true);
    let lowest = Infinity;
    for (const foot of footJoints) {
      worldFoot.copy(foot.tip).applyMatrix4(foot.bone.matrixWorld);
      lowest = Math.min(lowest, worldFoot.dot(dorsal));
    }
    groundingOffset = Number.isFinite(lowest) ? groundHeight - lowest + 0.006 : 0;
    performer.position.addScaledVector(dorsal, groundingOffset + (body?.lift ?? 0) * bodyLength);
    performer.updateMatrixWorld(true);
    shadeCenter.copy(bodyCenter).applyMatrix4(performer.matrixWorld);
    groundRoot.worldToLocal(shadeCenter);
    contactShade.position.set(shadeCenter.x, shadeCenter.y, 0.001);
    contactShade.material.uniforms.opacity.value = 0.34 / (1 + Math.max(0, body?.lift ?? 0) * 7);
    groundTexture.offset.y = ((sceneState?.groundOffset ?? 0) * bodyLength * 28 / 12) % 1;
    contactEvidence.length = 0;
    for (const foot of footJoints) {
      const state = sceneState?.feet?.[foot.index];
      worldFoot.copy(foot.tip).applyMatrix4(foot.bone.matrixWorld);
      const gap = worldFoot.dot(dorsal) - groundHeight;
      groundRoot.worldToLocal(worldFoot);
      const mark = footContacts[foot.index];
      mark.position.set(worldFoot.x, worldFoot.y, 0.002);
      const impact = clamp(state?.impact ?? 0, 0, 1);
      mark.material.opacity = skeletonVisible && state?.stance && gap < bodyLength * 0.04 ? impact * 0.7 : 0;
      mark.scale.setScalar(1 + (1 - impact) * 2);
      contactEvidence.push({ id: foot.id, stance: !!state?.stance, gap, impact,
        // This is a designed gait contact projected onto the floor, not IK.
        x: worldFoot.x, y: worldFoot.y });
    }
  }
  function render(timestamp) {
    frame = 0;
    if (disposed || doc.hidden || contextLost) { lastTime = null; return; }
    if (lastRenderTime !== null && timestamp - lastRenderTime < 1000 / renderFps - 0.5) {
      frame = win.requestAnimationFrame(render);
      return;
    }
    resize();
    const delta = lastTime == null ? 0 : Math.min(0.1, (timestamp - lastTime) / 1000);
    lastTime = timestamp;
    if (playing) { motionTime += delta * speed; dirty = true; }
    if (dirty) {
      applyPose(playing ? delta * speed : 0);
      renderer.render(scene, camera);
      renderCount += 1;
      lastRenderTime = timestamp;
      dirty = false;
    }
    if (playing) frame = win.requestAnimationFrame(render);
    else lastTime = null;
  }
  function clearModel() {
    if (mixer) { mixer.stopAllAction(); mixer.uncacheRoot(model); }
    if (skeletonHelper) { scene.remove(skeletonHelper); disposeObject(skeletonHelper); skeletonHelper = null; }
    jointPoints = null;
    jointLinks = null;
    if (model) { content.remove(model); disposeObject(model); }
    model = null;
    wingRig = null;
    mixer = null;
    action = null;
    bones = [];
    clips = [];
    restNodes = [];
    selectedBone = null;
    selectedMarker.visible = false;
    externalPose = null;
    anatomy = null;
    sceneState = null;
    footJoints = [];
    contactEvidence = [];
    groundRoot.visible = false;
    performer.position.set(0, 0, 0);
    performer.quaternion.identity();
  }
  function selectBone(id) {
    const item = bones.find((candidate) => candidate.id === id);
    selectedBone = item?.id ?? null;
    onSelect(item ? boneState(item) : null);
    invalidate();
    return item ? boneState(item) : null;
  }
  function setBoneOffset(id, offset) {
    const item = bones.find((candidate) => candidate.id === id);
    if (!item) return false;
    for (const axis of ['x', 'y', 'z']) if (offset[axis] != null) item.offset[axis] = clamp(offset[axis], -180, 180);
    invalidate();
    return true;
  }
  function setBoneMotion(id, options) {
    const item = bones.find((candidate) => candidate.id === id);
    if (!item) return false;
    if ('enabled' in options) item.motion.enabled = !!options.enabled;
    if (['x', 'y', 'z'].includes(options.axis)) item.motion.axis = options.axis;
    if ('amplitude' in options) item.motion.amplitude = clamp(options.amplitude, 0, 90);
    if ('speed' in options) item.motion.speed = clamp(options.speed, 0.05, 8);
    invalidate();
    return true;
  }
  function setClip(index) {
    const next = Number.isInteger(Number(index)) && clips[Number(index)] ? Number(index) : -1;
    restoreAnimationBase();
    mixer?.stopAllAction();
    for (const item of restNodes) {
      item.node.position.copy(item.position);
      item.node.quaternion.copy(item.quaternion);
      item.node.scale.copy(item.scale);
      if (item.morphs) item.node.morphTargetInfluences.splice(0, item.morphs.length, ...item.morphs);
    }
    for (const item of bones) item.baseQuaternion.copy(item.bone.quaternion);
    clipIndex = next;
    action = next >= 0 ? mixer.clipAction(clips[next]).reset().play() : null;
    applyPose(0);
    invalidate();
    announce();
  }
  function setPlaying(value) {
    playing = !!value && !!model;
    lastTime = null;
    invalidate();
    announce();
  }
  function setSpeed(value) { speed = clamp(value, 0.05, 4); announce(); }
  function setTime(value) {
    if (!action) return;
    restoreAnimationBase();
    action.time = clamp(value, 0, Math.max(0, clips[clipIndex].duration - 0.000001));
    mixer.update(0);
    for (const item of bones) item.baseQuaternion.copy(item.bone.quaternion);
    invalidate();
  }
  function resetPose() {
    externalPose = null;
    playing = false;
    motionTime = 0;
    for (const item of bones) {
      item.offset = { x: 0, y: 0, z: 0 };
      item.motion.enabled = false;
    }
    setClip(-1);
    const selected = bones.find((item) => item.id === selectedBone);
    if (selected) onSelect(boneState(selected));
  }
  function setExternalPose(degreesArray) {
    if (degreesArray === null) externalPose = null;
    else {
      if (!degreesArray || degreesArray.length !== bones.length * 3) throw new RangeError('External pose needs three degree values per joint.');
      if (!externalPose || externalPose.length !== degreesArray.length) externalPose = new Float32Array(degreesArray.length);
      for (let i = 0; i < degreesArray.length; i += 1) externalPose[i] = clamp(degreesArray[i], -180, 180);
    }
    invalidate();
  }
  function setSceneState(value) {
    if (value == null) sceneState = null;
    else {
      if (!sceneState) sceneState = { body: { lift: 0, pitch: 0, roll: 0, yaw: 0 }, groundOffset: 0,
        feet: Array.from({ length: 6 }, () => ({ stance: false, impact: 0, lift: 0, stride: 0 })) };
      sceneState.body.lift = clamp(value.body?.lift, 0, 2);
      for (const axis of ['pitch', 'roll', 'yaw']) sceneState.body[axis] = clamp(value.body?.[axis], -180, 180);
      sceneState.groundOffset = clamp(value.groundOffset, -1e8, 1e8);
      for (let i = 0; i < 6; i += 1) {
        const foot = value.feet?.[i];
        Object.assign(sceneState.feet[i], { stance: !!foot?.stance, impact: clamp(foot?.impact, 0, 1),
          lift: clamp(foot?.lift, 0, 1), stride: clamp(foot?.stride, -1, 1) });
      }
    }
    invalidate();
  }
  function setRenderBudget({ fps = renderFps, pixelRatio = renderPixelRatio } = {}) {
    renderFps = clamp(fps, 15, 60);
    renderPixelRatio = clamp(pixelRatio, 0.5, 1.75);
    size = '';
    invalidate();
  }
  function setSkeletonVisible(value) {
    skeletonVisible = !!value;
    if (skeletonHelper) skeletonHelper.visible = skeletonVisible;
    invalidate();
  }
  async function parseModel(buffer, name, serial) {
    let imported = null;
    try {
      const inspected = inspectRoachGlb(buffer);
      const manager = new THREE.LoadingManager();
      manager.setURLModifier((url) => {
        if (!url.startsWith('blob:')) throw new Error('The GLB attempted to load a non-embedded resource.');
        return url;
      });
      const loader = new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder);
      const releaseDecoder = inspected.json.bufferViews?.some(view => view.extensions?.[MESHOPT]) ? acquireDecoder() : () => {};
      try { imported = await loader.parseAsync(buffer, ''); }
      finally { releaseDecoder(); }
      if (disposed || serial !== loadSerial) { disposeObject(imported.scene); return false; }
      const nextModel = imported.scene;
      nextModel.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(nextModel);
      const center = bounds.getCenter(new THREE.Vector3());
      const span = bounds.getSize(new THREE.Vector3());
      const longest = Math.max(span.x, span.y, span.z);
      if (!finiteArray([...center.toArray(), ...span.toArray()]) || longest < 0.000001 || longest > 1e12) {
        throw new Error('The model has empty or invalid geometry bounds.');
      }
      const uniqueBones = new Set();
      // Keep the original 27 joint IDs stable for existing routes and patches;
      // newly articulated wings append after the source joints.
      nextModel.traverse((object) => {
        if (object.userData.roachJoint === true) uniqueBones.add(object);
        if (object.isSkinnedMesh) object.skeleton.bones.forEach((bone) => { if (bone.isBone) uniqueBones.add(bone); });
      });
      const nextWingRig = articulateRoachWings(nextModel);
      let actualVertices = 0;
      let actualNodes = 0;
      let oversizedTexture = false;
      let texturePixels = 0;
      const textureImages = new Set();
      const textures = new Set();
      const preparedMaterials = new Set();
      nextModel.traverse((object) => {
        actualNodes += 1;
        actualVertices += object.geometry?.attributes?.position?.count ?? 0;
        if (object.isMesh) { object.castShadow = !object.userData.noCastShadow; object.receiveShadow = true; }
        if (object.userData.roachJoint === true) uniqueBones.add(object);
        if (object.isSkinnedMesh) object.skeleton.bones.forEach((bone) => { if (bone.isBone) uniqueBones.add(bone); });
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          if (!material) continue;
          if (material.isMeshStandardMaterial && !preparedMaterials.has(material)) {
            preparedMaterials.add(material);
            material.color.multiply(new THREE.Color().setRGB(0.8, 0.63, 0.58));
            material.metalness = 0;
            material.roughness = Math.max(0.72, material.roughness);
            material.aoMapIntensity = 1.15;
            material.shadowSide = THREE.FrontSide;
          }
          for (const value of Object.values(material)) if (value?.isTexture) {
            textures.add(value);
            const source = value.source?.data;
            if ((source?.width ?? 0) > 8192 || (source?.height ?? 0) > 8192) oversizedTexture = true;
            if (source && !textureImages.has(source)) {
              textureImages.add(source);
              texturePixels += (source.width ?? 0) * (source.height ?? 0);
            }
          }
        }
      });
      if (actualVertices > MAX_VERTICES || actualNodes > MAX_NODES || uniqueBones.size > MAX_BONES || oversizedTexture || texturePixels > 128_000_000) {
        throw new Error('The decoded model exceeds the viewer’s geometry, skeleton, or 8K texture budget.');
      }
      // Upload in short batches before revealing the specimen, yielding to
      // sound controls between batches. Avoid Three's uncancellable shader
      // warmup polling, which can outlive disposal or context restoration.
      let batchStart = win.performance.now();
      for (const texture of textures) {
        if (disposed || serial !== loadSerial) { disposeObject(imported.scene); return false; }
        renderer.initTexture(texture);
        if (win.performance.now() - batchStart > 6) {
          await new Promise(resolve => win.setTimeout(resolve, 0));
          batchStart = win.performance.now();
        }
      }
      if (disposed || serial !== loadSerial) { disposeObject(imported.scene); return false; }
      // Commit only after the replacement has parsed and passed validation.
      const parsedClips = imported.animations ?? [];
      clearModel();
      model = nextModel;
      wingRig = nextWingRig;
      imported = null;
      content.scale.setScalar(2.7 / longest);
      content.position.copy(center).multiplyScalar(-2.7 / longest);
      content.add(model);
      modelName = name;
      clips = parsedClips;
      mixer = new THREE.AnimationMixer(model);
      model.traverse((node) => {
        restNodes.push({ node, position: node.position.clone(), quaternion: node.quaternion.clone(),
          scale: node.scale.clone(), morphs: node.morphTargetInfluences?.slice() });
      });
      bones = [...uniqueBones].map((bone, index) => ({ bone, index, id: `bone-${index}`, parent: null,
        baseQuaternion: bone.quaternion.clone(), offset: { x: 0, y: 0, z: 0 },
        motion: { enabled: false, axis: bone.userData.roachJoint === true ? 'y' : 'x',
          amplitude: Math.min(12, Number(bone.userData.suggestedRotationLimitDegrees) || 12), speed: 0.5 } }));
      const boneIds = new Map(bones.map((item) => [item.bone, item.id]));
      bones.forEach((item) => {
        let parent = item.bone.parent;
        while (parent && !boneIds.has(parent)) parent = parent.parent;
        item.parent = boneIds.get(parent) ?? null;
      });
      const pointGeometry = new THREE.BufferGeometry();
      pointGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bones.length * 3), 3));
      jointPoints = new THREE.Points(pointGeometry, new THREE.PointsMaterial({
        color: 0x99eacc, size: 0.026, depthTest: false, transparent: true, opacity: 0.85,
      }));
      jointPoints.frustumCulled = false;
      jointPoints.renderOrder = 9;
      const lineGeometry = new THREE.BufferGeometry();
      lineGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bones.filter((item) => item.parent).length * 6), 3));
      jointLinks = new THREE.LineSegments(lineGeometry, new THREE.LineBasicMaterial({
        color: 0x72a793, depthTest: false, transparent: true, opacity: 0.65,
      }));
      jointLinks.frustumCulled = false;
      jointLinks.renderOrder = 8;
      skeletonHelper = new THREE.Group();
      skeletonHelper.add(jointLinks, jointPoints);
      skeletonHelper.visible = skeletonVisible;
      scene.add(skeletonHelper);
      clipIndex = -1;
      playing = false;
      motionTime = 0;
      captureAnatomy();
      applyPose();
      resetCamera();
      announce();
      selectBone(bones[0]?.id);
      onStatus(`${name}: ${bones.length} joints · ${clips.length} animation clips`);
      return true;
    } catch (error) {
      if (imported) disposeObject(imported.scene);
      if (serial !== loadSerial || disposed) return false;
      onStatus(error.message || 'The model could not be loaded.');
      throw error;
    }
  }
  async function loadArrayBuffer(buffer, { name = 'Imported cockroach' } = {}) {
    const serial = ++loadSerial;
    loadAbort?.abort();
    loadAbort = null;
    onStatus(`Loading ${name}…`);
    return parseModel(buffer, name, serial);
  }
  async function loadUrl(url, { name = 'Cockroach' } = {}) {
    const serial = ++loadSerial;
    loadAbort?.abort();
    const abort = new AbortController();
    loadAbort = abort;
    onStatus(`Loading ${name}…`);
    try {
      const response = await fetch(url, { signal: abort.signal });
      if (!response.ok) throw new Error(`Model download failed (${response.status}).`);
      if (Number(response.headers.get('content-length')) > MAX_BYTES) {
        abort.abort();
        throw new Error('The model exceeds the 64 MB limit.');
      }
      // Consume the native response so browser diagnostics observe completion.
      // This URL serves the bundled model; imported models use local File data.
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > MAX_BYTES) throw new Error('The model exceeds the 64 MB limit.');
      if (disposed || serial !== loadSerial) return false;
      return await parseModel(buffer, name, serial);
    } catch (error) {
      if (serial !== loadSerial || disposed || error.name === 'AbortError') return false;
      onStatus(error.message || 'The model could not be loaded.');
      throw error;
    } finally { if (loadAbort === abort) loadAbort = null; }
  }

  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  function hitJoint(event) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    pointerNdc.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointerNdc, camera);
    if (model) {
      const hit = raycaster.intersectObject(model, true).find((intersection) => {
        if (!intersection.object.isMesh) return false;
        for (let object = intersection.object; object; object = object.parent) if (!object.visible) return false;
        return true;
      });
      let object = hit?.object;
      while (object) {
        const match = bones.find((item) => item.bone === object);
        if (match) return match;
        object = object.parent;
      }
    }
    if (!skeletonVisible) return null;
    let closest = null;
    let closestDistance = 22;
    for (const item of bones) {
      item.bone.getWorldPosition(projected).project(camera);
      if (projected.z < -1 || projected.z > 1) continue;
      const dx = (projected.x + 1) * rect.width / 2 - (event.clientX - rect.left);
      const dy = (-projected.y + 1) * rect.height / 2 - (event.clientY - rect.top);
      const distanceToPointer = Math.hypot(dx, dy);
      if (distanceToPointer < closestDistance) { closest = item; closestDistance = distanceToPointer; }
    }
    return closest;
  }
  /** Read-only, occasional inspection: return an actually pickable visible
   * surface point. No vertex scanning or ray casting runs in the render loop. */
  function getPartScreenPosition(id) {
    const item = bones.find((candidate) => candidate.id === id || candidate.bone.userData.jointId === id);
    if (!item) return null;
    const rect = canvas.getBoundingClientRect();
    const point = new THREE.Vector3();
    for (const sample of item.meshSamples ?? []) {
      point.copy(sample).applyMatrix4(item.bone.matrixWorld).project(camera);
      if (Math.abs(point.x) > 0.98 || Math.abs(point.y) > 0.98 || Math.abs(point.z) > 1) continue;
      const position = { x: rect.left + (point.x + 1) * rect.width / 2, y: rect.top + (1 - point.y) * rect.height / 2 };
      if (hitJoint({ clientX: position.x, clientY: position.y })?.id === item.id) return { ...position, id: item.id };
    }
    return null;
  }
  /** Head-local offsets, published back into the shared motion/audio state by
   * the app. Rendering never adds a hidden gaze rotation behind the DSP. */
  function getGazeOffset() {
    const head = bones.find((item) => item.bone.userData.jointId === 'head');
    if (!head || !anatomy) return { x: 0, y: 0, z: 0 };
    const inverse = head.restWorldQuaternion.clone().invert();
    const facing = anatomy.faceForward.clone().applyQuaternion(inverse).normalize();
    const desired = camera.position.clone().sub(head.bone.getWorldPosition(new THREE.Vector3())).applyQuaternion(inverse).normalize();
    const rotation = new THREE.Quaternion().setFromUnitVectors(facing, desired);
    const gaze = new THREE.Euler().setFromQuaternion(rotation, 'XYZ');
    return { x: clamp(gaze.x / RAD, -22, 22), y: clamp(gaze.y / RAD, -22, 22), z: clamp(gaze.z / RAD, -22, 22) };
  }
  function setDragAxis(value) {
    if (!['xy', 'x', 'y', 'z'].includes(value)) return false;
    dragAxis = value;
    return true;
  }
  function setTouchInteraction(value) {
    cancelPointers();
    touchInteraction = !!value;
    canvas.style.touchAction = touchInteraction ? 'none' : 'pan-y';
  }
  function interaction(phase, velocity = 0) {
    if (!gesture?.committed) return;
    onInteraction({ kind: gesture.kind, phase, id: gesture.id ?? null, jointId: gesture.id ?? null,
      axis: dragAxis, velocity, active: phase === 'start' || phase === 'change' });
  }
  function commitGesture(event) {
    if (!gesture || gesture.committed) return;
    gesture.committed = true;
    canvas.setPointerCapture?.(event.pointerId);
    canvas.style.cursor = gesture.kind === 'joint' ? 'move' : 'grabbing';
    interaction('start');
  }
  function cancelPointers() {
    interaction('cancel');
    gesture = null;
    const ids = [...pointers.keys()];
    pointers.clear();
    for (const id of ids) if (canvas.hasPointerCapture?.(id)) canvas.releasePointerCapture(id);
    canvas.style.cursor = 'grab';
  }
  function editJoint(item, offset, velocity = 0, phase = 'change') {
    setBoneOffset(item.id, offset);
    onPoseChange({ id: item.id, jointId: item.bone.userData.jointId ?? item.id,
      offset: { ...item.offset }, axis: dragAxis, phase, velocity });
  }
  listen(canvas, 'pointerdown', (event) => {
    if (event.button !== 0 && event.pointerType !== 'touch') return;
    const scrollTouch = event.pointerType === 'touch' && !touchInteraction;
    // Do not prevent the native vertical pan. The browser may cancel this
    // candidate gesture at any point in favour of scrolling the document.
    if (!scrollTouch) event.preventDefault();
    canvas.focus({ preventScroll: true });
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size > 1) {
      // A second finger cancels direct manipulation. Keep every held pointer
      // tracked until release, so finger churn cannot restart a drag midway.
      // Zoom is available only through the explicit API/buttons and +/- keys.
      interaction('cancel');
      gesture = null;
      pointerMoved = true;
      canvas.style.cursor = 'grab';
      // Retain capture only to receive every up/cancel, even outside the canvas.
      canvas.setPointerCapture?.(event.pointerId);
      return;
    }
    pointerMoved = false;
    const item = hitJoint(event);
    if (item) selectBone(item.id);
    gesture = { kind: item ? 'joint' : 'orbit', id: item?.id, offset: item ? { ...item.offset } : null,
      x: event.clientX, y: event.clientY, time: event.timeStamp, committed: false, scrollTouch };
    if (!scrollTouch) commitGesture(event);
  });
  listen(canvas, 'pointermove', (event) => {
    const previous = pointers.get(event.pointerId);
    if (!previous || !gesture) return;
    const dx = event.clientX - previous.x;
    const dy = event.clientY - previous.y;
    const totalX = event.clientX - gesture.x;
    const totalY = event.clientY - gesture.y;
    if (!gesture.committed) {
      if (Math.abs(totalY) > 7 && Math.abs(totalY) > Math.abs(totalX)) { cancelPointers(); return; }
      if (Math.abs(totalX) < 7) return;
      commitGesture(event);
    }
    event.preventDefault();
    if (Math.hypot(dx, dy) > 1) pointerMoved = true;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 1 && gesture.kind === 'joint') {
      const item = bones.find((candidate) => candidate.id === gesture.id);
      if (!item) return;
      const offset = { ...gesture.offset };
      const axis = event.altKey ? 'z' : dragAxis;
      const touchY = gesture.scrollTouch ? 0 : totalY;
      if (axis === 'xy') {
        offset.y += totalX * 0.38;
        offset.x -= touchY * 0.38;
      } else offset[axis] += (totalX - (axis === 'x' ? touchY : 0)) * 0.38;
      for (const component of ['x', 'y', 'z']) offset[component] = clamp(offset[component], -90, 90);
      const velocity = clamp(Math.hypot(dx, dy) / Math.max(8, event.timeStamp - gesture.time) / 1.7, 0.04, 1);
      editJoint(item, offset, velocity);
      interaction('change', velocity);
    } else if (pointers.size === 1) {
      orbit(dx * 0.006, (gesture.scrollTouch ? 0 : dy) * 0.006);
      interaction('change');
    }
    gesture.time = event.timeStamp;
  }, { passive: false });
  function pointerEnd(event) {
    if (!pointers.has(event.pointerId)) return;
    if (!gesture?.committed && event.type === 'pointerup' && !pointerMoved && gesture?.kind === 'joint') {
      // A touch tap selects/strikes without taking away vertical scrolling.
      gesture.committed = true;
      interaction('start', 0.15);
    }
    interaction(event.type === 'pointerup' ? 'end' : 'cancel');
    gesture = null;
    pointers.delete(event.pointerId);
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    canvas.style.cursor = 'grab';
  }
  listen(canvas, 'pointerup', pointerEnd);
  listen(canvas, 'pointercancel', pointerEnd);
  listen(canvas, 'lostpointercapture', (event) => { if (gesture && pointers.has(event.pointerId)) cancelPointers(); });
  listen(canvas, 'wheel', (event) => {
    // Trackpad pinch arrives as Ctrl+wheel. Suppress that implicit zoom over
    // the instrument; ordinary wheel scrolling still belongs to the page.
    if (event.ctrlKey) event.preventDefault();
  }, { passive: false });
  listen(canvas, 'keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const keys = { ArrowLeft: [-0.14, 0], ArrowRight: [0.14, 0], ArrowUp: [0, -0.14], ArrowDown: [0, 0.14] };
    const item = bones.find((candidate) => candidate.id === selectedBone);
    if (keys[event.key] && event.shiftKey && item) {
      const offset = { ...item.offset };
      const axis = dragAxis === 'xy' ? (event.key === 'ArrowUp' || event.key === 'ArrowDown' ? 'x' : 'y') : dragAxis;
      offset[axis] = clamp(offset[axis] + (event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -3 : 3), -90, 90);
      editJoint(item, offset, 0.25);
      onInteraction({ kind: 'joint', phase: 'change', id: item.id, jointId: item.id, axis, velocity: 0.25, active: true });
      onInteraction({ kind: 'joint', phase: 'end', id: item.id, jointId: item.id, axis, velocity: 0, active: false });
    } else if (keys[event.key]) orbit(...keys[event.key]);
    else if (['x', 'y', 'z'].includes(event.key.toLowerCase())) setDragAxis(event.key.toLowerCase());
    else if (event.key === '+' || event.key === '=') zoom(0.87);
    else if (event.key === '-' || event.key === '_') zoom(1.15);
    else if (event.key === 'Home' || event.key.toLowerCase() === 'r') resetCamera();
    else return;
    event.preventDefault();
  });
  listen(doc, 'visibilitychange', () => {
    lastTime = null;
    if (doc.hidden) { if (frame) win.cancelAnimationFrame(frame); frame = 0; cancelPointers(); }
    else invalidate();
  });
  listen(motionQuery, 'change', () => {
    if (motionQuery.matches) setPlaying(false);
    announce();
  });
  listen(canvas, 'webglcontextlost', (event) => {
    event.preventDefault();
    contextLost = true;
    if (frame) win.cancelAnimationFrame(frame);
    frame = 0;
    cancelPointers();
    onStatus('3D graphics paused: waiting for the graphics context to recover.');
  });
  listen(canvas, 'webglcontextrestored', () => {
    contextLost = false;
    lastTime = null;
    onStatus(model ? `${modelName}: graphics restored.` : 'Graphics restored. Load a cockroach model.');
    invalidate();
  });
  const resizeObserver = new win.ResizeObserver(invalidate);
  resizeObserver.observe(canvas);
  resetCamera();

  function dispose() {
    if (disposed) return;
    disposed = true;
    loadSerial += 1;
    loadAbort?.abort();
    if (frame) win.cancelAnimationFrame(frame);
    frame = 0;
    resizeObserver.disconnect();
    cleanups.forEach((cleanup) => cleanup());
    pointers.forEach((_, id) => { if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id); });
    pointers.clear();
    canvas.style.touchAction = previousTouchAction;
    clearModel();
    disposeObject(selectedMarker);
    disposeObject(groundRoot);
    renderer.dispose();
  }
  return { loadUrl, loadArrayBuffer, getState, getPlaybackState, selectBone, setBoneOffset, setBoneMotion,
    setClip, setPlaying, setSpeed, setTime, resetPose, resetCamera, setViewPreset, zoom,
    setExternalPose, setSceneState, setDragAxis, setTouchInteraction, getPartScreenPosition, getGazeOffset,
    setRenderBudget, setSkeletonVisible, dispose };
}
