import * as THREE from '../../../vendor/three/three.module.min.js';
import { createDownloadedModels } from './downloaded-models.js';
import { createProceduralModels } from './procedural-models.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const views = {
  'ant-farm': { yaw: 0.3, pitch: 0.17, zoom: 4.3, lookY: 0, background: 0x0c1b1b },
  'voronoi-foam': { yaw: 0.42, pitch: 0.29, zoom: 5.2, lookY: 0, background: 0x111b26 },
  'polyhedral-lattice': { yaw: 0.35, pitch: 0.27, zoom: 5.3, lookY: 0, background: 0x171922 },
  octopus: { yaw: 0.3, pitch: 0.36, zoom: 5.8, lookY: 0, background: 0x241a1b },
  pancakes: { yaw: 0.18, pitch: 0.46, zoom: 6.2, lookY: -0.08, background: 0x201b18 },
  mosquito: { yaw: 0.38, pitch: 0.39, zoom: 4.85, lookY: 0, background: 0x0b1215 },
  // The downloaded moth's dorsal wing faces +Y. A low front camera looks
  // beneath it; use an elevated view so its textured, top-lit wings are shown.
  moth: { yaw: 0.12, pitch: 0.82, zoom: 5.6, lookY: 0, background: 0x1d1a1c },
};

/** Licensed animal/kitchen rigs and editable mathematical surfaces share a
 * camera; invisible hit areas never enter its render layer. */
export function createRigLabViewer(canvas, {
  onStart = () => {}, onEdit = () => {}, onBrush = () => {},
  onFinish = () => {}, onKeyboard = () => {}, onAssetStatus = () => {},
} = {}) {
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, powerPreference: 'low-power',
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.33;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 80);
  const ambient = new THREE.HemisphereLight(0xd9e8f0, 0x251d27, 1.45);
  const key = new THREE.DirectionalLight(0xffe1c7, 2.7);
  key.position.set(-3.6, 5.3, 6);
  const fill = new THREE.DirectionalLight(0xc0e0ec, 1.8);
  fill.position.set(3.8, 3, 5.1);
  const rim = new THREE.DirectionalLight(0xffceaa, 1.15);
  rim.position.set(-0.8, 4, -4.8);
  scene.add(ambient, key, fill, rim);

  // The two math stages have their own live meshes; downloaded model stages
  // stay empty until their licensed GLB has loaded and attached.
  const rigs = Object.fromEntries(Object.keys(views).map((name) => [name, {
    root: new THREE.Group(), pickTargets: [],
  }]));
  for (const [name, rig] of Object.entries(rigs)) {
    rig.root.visible = name === 'ant-farm';
    scene.add(rig.root);
  }
  const downloaded = createDownloadedModels(rigs, onAssetStatus);
  const procedural = createProceduralModels(rigs);
  const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2();
  // Layer 1 contains interaction volumes, but the camera sees only layer 0.
  raycaster.layers.enable(1);
  const abort = new AbortController(), signal = abort.signal;
  let model = 'ant-farm', drag = null, brushMode = false;
  let { yaw, pitch, zoom } = views[model];
  let width = 1, height = 1, disposed = false, frames = 0;
  function updateCamera() {
    const target = views[model].lookY;
    // Preserve the complete imported subject when the stage becomes narrow.
    const distance = zoom * Math.max(1, 1.1 / camera.aspect);
    camera.position.set(distance * Math.sin(yaw) * Math.cos(pitch),
      target + distance * Math.sin(pitch), distance * Math.cos(yaw) * Math.cos(pitch));
    camera.lookAt(0, target, 0);
    camera.updateMatrixWorld();
  }
  function resize() {
    if (disposed) return;
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 1.6,
      Math.sqrt(1_250_000 / (width * height)));
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

  function hitsAt(event) {
    const rect = canvas.getBoundingClientRect();
    ndc.set((event.clientX - rect.left) / rect.width * 2 - 1,
      -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    return raycaster.intersectObjects(rigs[model].pickTargets.filter((object) => {
      for (let node = object; node; node = node.parent) if (!node.visible) return false;
      return true;
    }), false);
  }
  function brushU(hit) {
    if (!hit) return null;
    const { offset = 0, imported, extent = 1 } = hit.object.userData.pick ?? {};
    const local = hit.object.worldToLocal(hit.point.clone());
    return imported ? clamp(Math.abs(local.x) / extent, 0, 1)
      : clamp((offset + Math.max(0, local.x)) / 1.48, 0, 1);
  }
  function down(event) {
    if (disposed || drag || event.button !== 0) return;
    const hits = hitsAt(event);
    const hit = hits[0];
    const part = hit?.object.userData.pick;
    const kind = part?.kind === 'wing' && brushMode && model === 'moth'
      ? 'brush' : part?.kind ?? 'orbit';
    drag = {
      id: event.pointerId, kind, side: part?.side ?? null,
      index: part?.index ?? null, x: event.clientX, y: event.clientY,
      yaw, pitch, moved: false, lastU: kind === 'brush' ? brushU(hit) : null,
    };
    drag.startU = drag.lastU;
    try { canvas.setPointerCapture(event.pointerId); } catch { drag = null; return; }
    canvas.classList.add('is-dragging');
    onStart({ model, kind, side: drag.side, index: drag.index });
    event.preventDefault();
  }
  function move(event) {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (Math.hypot(dx, dy) > 3) drag.moved = true;
    if (drag.kind === 'orbit') {
      yaw = drag.yaw - dx / Math.max(width, 1) * Math.PI * 1.5;
      pitch = clamp(drag.pitch - dy / Math.max(height, 1) * Math.PI, -1.1, 1.1);
      updateCamera();
    } else if (drag.kind === 'brush') {
      const hit = hitsAt(event).find((item) =>
        item.object.userData.pick?.side === drag.side);
      const u = hit ? brushU(hit) : clamp((drag.startU ?? 0.5)
        + dx / Math.max(width, 1) * (drag.side === 'left' ? -1.7 : 1.7), 0, 1);
      onBrush({ model, side: drag.side, from: drag.lastU, to: u });
      drag.lastU = u;
    } else {
      onEdit({ model, kind: drag.kind, side: drag.side, index: drag.index,
        dx: dx / Math.max(width, 1), dy: dy / Math.max(height, 1) });
    }
    event.preventDefault();
  }
  function finish(event, cancelled = false) {
    if (!drag || event.pointerId !== drag.id) return;
    if (cancelled && drag.kind === 'orbit') {
      yaw = drag.yaw; pitch = drag.pitch; updateCamera();
    }
    let dropKind = null, dropIndex = null;
    if (!cancelled && model === 'pancakes' && drag.kind === 'spatula') {
      const hits = hitsAt(event);
      const plate = screenPoint('plate');
      const overPlate = plate && Math.hypot(event.clientX - plate.x, event.clientY - plate.y)
        < Math.min(width, height) * 0.19;
      const drop = overPlate ? { kind: 'plate' }
        : hits.map((hit) => hit.object.userData.pick)
          .find((pick) => pick?.kind === 'plate' || pick?.kind === 'pan' ||
            pick?.kind === 'pancake' && pick.index !== drag.index);
      dropKind = drop?.kind ?? null;
      dropIndex = drop?.index ?? null;
    }
    onFinish({ model, kind: drag.kind, side: drag.side, index: drag.index,
      dx: (event.clientX - drag.x || 0) / Math.max(width, 1),
      dy: (event.clientY - drag.y || 0) / Math.max(height, 1),
      moved: drag.moved, cancelled, dropKind, dropIndex });
    try {
      if (canvas.hasPointerCapture(drag.id)) canvas.releasePointerCapture(drag.id);
    } catch { /* Capture was lost. */ }
    drag = null;
    canvas.classList.remove('is-dragging');
  }
  canvas.addEventListener('pointerdown', down, { signal });
  canvas.addEventListener('pointermove', move, { signal });
  canvas.addEventListener('pointerup', (event) => finish(event), { signal });
  canvas.addEventListener('pointercancel', (event) => finish(event, true), { signal });
  canvas.addEventListener('lostpointercapture', (event) => finish(event, true), { signal });
  canvas.addEventListener('keydown', (event) => onKeyboard(event), { signal });
  canvas.addEventListener('wheel', (event) => {
    if (event.ctrlKey) return;
    zoom = clamp(zoom * (event.deltaY > 0 ? 1.09 : 0.92), 3.2, 8.2);
    updateCamera();
    event.preventDefault();
  }, { signal, passive: false });

  function setModel(next) {
    if (!rigs[next] || disposed) return;
    if (drag) finish({ pointerId: drag.id, clientX: drag.x, clientY: drag.y }, true);
    model = next;
    for (const [name, rig] of Object.entries(rigs)) rig.root.visible = name === next;
    ({ yaw, pitch, zoom } = views[next]);
    renderer.setClearColor(views[next].background, 1);
    // The original textured shell is markedly darker than the other assets.
    renderer.toneMappingExposure = next === 'mosquito' ? 1.72 : 1.33;
    updateCamera();
    if (next === 'voronoi-foam') {
      downloaded.deactivate();
      onAssetStatus('Live Three.js Voronoi cells: drag seeds to reshape real 3D faces and sound volumes; choose a clipping solid and cell count.', 'ready');
    } else if (next === 'polyhedral-lattice') {
      downloaded.deactivate();
      onAssetStatus('Live Three.js lattice: choose a solid and subdivision detail, add connected units, then pull any generated joint.', 'ready');
    } else void downloaded.activate(next);
  }
  function setView(view) {
    if (view === 'front') { yaw = 0; pitch = model === 'moth' ? views.moth.pitch : 0.08; }
    if (view === 'side') { yaw = Math.PI * 0.45; pitch = model === 'moth' ? 0.62 : 0.18; }
    updateCamera();
  }
  function zoomBy(factor) {
    zoom = clamp(zoom * factor, 3.2, 8.2);
    updateCamera();
  }
  function draw(pose, seconds) {
    if (disposed) return;
    if (model === 'voronoi-foam' || model === 'polyhedral-lattice') {
      procedural.update(model, pose);
    } else downloaded.update(pose, seconds);
    renderer.render(scene, camera);
    frames += 1;
  }
  function screenPoint(kind, index = null) {
    const target = rigs[model].pickTargets.find((object) => {
      const pick = object.userData.pick;
      if (pick?.kind !== kind ||
          index != null && pick.index !== index && pick.side !== index) return false;
      for (let node = object; node; node = node.parent) if (!node.visible) return false;
      return true;
    });
    if (!target) return null;
    scene.updateMatrixWorld(true);
    const rect = canvas.getBoundingClientRect();
    const screen = (point) => ({
      x: rect.left + (point.x + 1) * rect.width / 2,
      y: rect.top + (1 - point.y) * rect.height / 2,
    });
    if (target.isSkinnedMesh) {
      // A skinned limb's geometry bounds do not include its bone pose, and a
      // wing's bounding-box centre can lie *outside* its thin membrane. Find
      // a genuinely exposed surface triangle. Never return its bounding
      // sphere's centre if every tested point is occluded: that would turn a
      // promised wing/leg grab into camera orbit instead.
      const geometry = target.geometry, positions = geometry.getAttribute('position');
      const elements = geometry.index, triangles = Math.floor((elements?.count ?? positions.count) / 3);
      const samples = Math.min(288, triangles);
      const sample = new THREE.Vector3(), position = new THREE.Vector3();
      for (let step = 0; step < samples; step += 1) {
        const triangle = Math.floor((step + 0.5) * triangles / samples);
        position.set(0, 0, 0);
        for (let corner = 0; corner < 3; corner += 1) {
          const vertex = elements ? elements.getX(triangle * 3 + corner) : triangle * 3 + corner;
          sample.fromBufferAttribute(positions, vertex);
          target.applyBoneTransform(vertex, sample);
          position.add(sample);
        }
        const projected = target.localToWorld(position.multiplyScalar(1 / 3)).project(camera);
        if (Math.abs(projected.x) > 0.97 || Math.abs(projected.y) > 0.97) continue;
        ndc.set(projected.x, projected.y);
        raycaster.setFromCamera(ndc, camera);
        const hit = raycaster.intersectObjects(rigs[model].pickTargets.filter((object) => {
          for (let node = object; node; node = node.parent) if (!node.visible) return false;
          return true;
        }), false)[0];
        if (hit?.object === target) return screen(projected);
      }
      return null;
    }
    target.geometry.computeBoundingSphere();
    const point = target.localToWorld(target.geometry.boundingSphere.center.clone()).project(camera);
    return screen(point);
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    abort.abort();
    observer?.disconnect();
    downloaded.dispose();
    procedural.dispose();
    renderer.dispose();
  }
  function renderedSurfaces() {
    const surfaces = { imported: 0, authored: 0 };
    scene.traverse((object) => {
      if (!(object.isMesh || object.isLine || object.isPoints) ||
          !camera.layers.test(object.layers)) return;
      for (let parent = object; parent; parent = parent.parent) if (!parent.visible) return;
      surfaces[object.userData.rigLabAsset ? 'imported' : 'authored'] += 1;
    });
    return surfaces;
  }
  setModel(model);
  return {
    draw, setModel, setBrushMode(value) { brushMode = Boolean(value); },
    setView, zoomBy, screenPoint, flashWing: downloaded.flashWing,
    setAntStyle: downloaded.setAntStyle,
    dispose, getState: () => ({
      model, frames, yaw, pitch, zoom, dragging: Boolean(drag),
      downloaded: downloaded.getState(), procedural: procedural.getState(),
      renderedSurfaces: renderedSurfaces(),
    }),
  };
}
