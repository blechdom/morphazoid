import { colorizeIrisPixels } from '../oculoid/oculoid-model.js';
import { sizeWitchModelTextures } from './witch-model-display.js';

const MODEL = new URL('../../../assets/witch/eye-512.glb', import.meta.url);
const clamp = (value, low, high, fallback = low) => Math.max(low, Math.min(high, Number.isFinite(value) ? value : fallback));

export function witchEyeQuality(value = {}) {
  return { size: Math.round(clamp(value.size, 96, 224, 160)),
    textureSize: Math.round(clamp(value.textureSize, 256, 1024, 512)),
    frameInterval: clamp(value.frameInterval, 33, 100, 50) };
}

/** The same ladle phase drives real yaw/pitch, not a flat sprite rotation.
 * The owner supplies the clock; the snapshot renderer holds its last pose
 * while quiet or under reduced motion. */
export function witchEyePose(state = {}) {
  const angle = Number.isFinite(state.ladleAngle) ? state.ladleAngle : Number.isFinite(state.phase) ? state.phase : 0;
  const energy = Math.sqrt(clamp(state.speed, 0, 1));
  const radius = clamp(state.radius, 0, 1, .5);
  return { yaw: Math.sin(angle) * (.25 + .38 * energy) * (.7 + .3 * radius),
    pitch: Math.cos(angle) * (.13 + .22 * energy),
    roll: Math.sin(angle) * .055 };
}

/** Realistic Human Eye by DEGUIDER, CC BY 4.0. Uses Oculoid's original
 * textured globe and iris, normalization and violet recoloring. No eyelid,
 * wardrobe, tear, full viewer, extra clock or animation loop is loaded. */
export function createWitchEye(doc = document, { quality: initialQuality = {}, onInvalidate = () => {} } = {}) {
  let quality = witchEyeQuality(initialQuality);
  const canvas = doc.createElement('canvas'), surface = doc.createElement('canvas');
  const context = surface.getContext('2d');
  canvas.width = canvas.height = surface.width = surface.height = quality.size;
  const abort = new AbortController();
  let renderer, scene, camera, globe, model, disposed = false, lost = false, loaded = false;
  let dirty = true, lastRender = -Infinity, renderCount = 0, texturePixels = 0, triangles = 0;
  let pose = { yaw: 0, pitch: 0, roll: 0 };

  function releaseModel() {
    const textures = new Set(), materials = new Set(), geometries = new Set();
    (globe ?? model)?.traverse(node => {
      if (node.geometry) geometries.add(node.geometry);
      for (const material of Array.isArray(node.material) ? node.material : node.material ? [node.material] : []) {
        materials.add(material);
        for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      }
    });
    textures.forEach(texture => { texture.source?.data?.close?.(); texture.dispose(); });
    materials.forEach(value => value.dispose()); geometries.forEach(value => value.dispose());
    globe?.removeFromParent(); model = globe = null; loaded = false;
  }
  function tintIris(THREE, material) {
    const original = material.map, image = original?.image;
    if (!image?.width || !image?.height) return;
    const tint = doc.createElement('canvas'); tint.width = image.width; tint.height = image.height;
    const ink = tint.getContext('2d', { willReadFrequently: true }); ink.drawImage(image, 0, 0);
    const pixels = ink.getImageData(0, 0, tint.width, tint.height);
    pixels.data.set(colorizeIrisPixels(pixels.data, 0x9876b8, { width: tint.width, atlas: true, pattern: 'natural' }));
    ink.putImageData(pixels, 0, 0);
    const texture = new THREE.CanvasTexture(tint);
    for (const property of ['flipY', 'wrapS', 'wrapT', 'minFilter', 'magFilter', 'anisotropy', 'colorSpace']) texture[property] = original[property];
    texture.offset.copy(original.offset); texture.repeat.copy(original.repeat);
    texture.center.copy(original.center); texture.rotation = original.rotation;
    material.map = texture; material.color.setRGB(.8828, .8628, .7848); material.needsUpdate = true;
    original.dispose();
  }
  function drawSnapshot() {
    if (!renderer || !loaded || disposed || lost) return null;
    if (canvas.width !== quality.size) renderer.setSize(quality.size, quality.size, false);
    if (surface.width !== quality.size) surface.width = surface.height = quality.size;
    globe.rotation.set(pose.pitch, pose.yaw, pose.roll, 'YXZ');
    renderer.render(scene, camera);
    context.clearRect(0, 0, surface.width, surface.height); context.drawImage(canvas, 0, 0);
    lastRender = performance.now(); renderCount++; dirty = false;
    return surface;
  }
  const ready = (async () => {
    try {
      const [THREE, { GLTFLoader }] = await Promise.all([
        import('../../../vendor/three/three.module.min.js'), import('../../../vendor/three/loaders/GLTFLoader.js'),
      ]);
      if (disposed || !context) return false;
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
      renderer.setPixelRatio(1); renderer.setSize(quality.size, quality.size, false); renderer.setClearColor(0, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.29;
      canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); lost = true; onInvalidate(); }, { signal: abort.signal });
      canvas.addEventListener('webglcontextrestored', () => {
        if (disposed) return; lost = false; dirty = true; drawSnapshot(); onInvalidate();
      }, { signal: abort.signal });
      scene = new THREE.Scene(); globe = new THREE.Group(); scene.add(globe);
      camera = new THREE.PerspectiveCamera(36, 1, .01, 20);
      camera.position.set(0, 0, 3.45); camera.lookAt(0, 0, 0);
      scene.add(new THREE.HemisphereLight(0xf2f0ed, 0x423939, 2.2));
      for (const [color, intensity, x, y, z] of [[0xffeee3, 2.05, -3, 4, 6], [0xe9e6e2, 1.5, 4, -2, 3], [0xf1ebe8, 1.8, -2, 3, -4]]) {
        const light = new THREE.DirectionalLight(color, intensity); light.position.set(x, y, z); scene.add(light);
      }
      const response = await fetch(MODEL.href, { signal: abort.signal });
      if (!response.ok) throw new Error(`Eye model HTTP ${response.status}`);
      const data = await response.arrayBuffer(); if (disposed) return false;
      const gltf = await new GLTFLoader().parseAsync(data, new URL('.', MODEL).href);
      model = gltf.scene;
      if (disposed) { releaseModel(); return false; }
      globe.add(model);
      model.updateMatrixWorld(true);
      let white, iris;
      model.traverse(node => {
        if (!node.isMesh) return;
        triangles += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3;
        if (node.material?.name === 'Iris') iris = node; else white = node;
      });
      if (!white || !iris) throw new Error('Eye model missing its native globe or iris');
      const bounds = new THREE.Box3().setFromObject(white), center = bounds.getCenter(new THREE.Vector3());
      const irisCenter = new THREE.Box3().setFromObject(iris).getCenter(new THREE.Vector3());
      const direction = irisCenter.clone().sub(center).normalize(), radius = bounds.getSize(new THREE.Vector3()).x / 2;
      const face = new THREE.Group(); globe.remove(model); model.position.sub(center);
      face.quaternion.setFromUnitVectors(direction, new THREE.Vector3(0, 0, 1)); face.scale.setScalar(1 / radius);
      face.add(model); globe.add(face);
      texturePixels = sizeWitchModelTextures(model, quality.textureSize, doc).texturePixels;
      // The source has separate atlas maps. Preserve independent ownership if
      // a future equivalent export shares a color texture between both meshes.
      if (iris.material.map === white.material.map) iris.material.map = iris.material.map.clone();
      tintIris(THREE, iris.material);
      const depth = irisCenter.distanceTo(center) / radius + .065;
      const pupil = new THREE.Mesh(new THREE.CircleGeometry(.143, 48),
        new THREE.MeshBasicMaterial({ color: 0x08080d, side: THREE.DoubleSide, depthWrite: false }));
      pupil.position.z = depth + .014; pupil.renderOrder = 3; globe.add(pupil);
      loaded = true; drawSnapshot(); onInvalidate(); return true;
    } catch {
      releaseModel(); renderer?.dispose(); renderer?.forceContextLoss(); renderer = null;
      if (!disposed) onInvalidate(); return false;
    }
  })();
  function render(state = {}) {
    if (!loaded || disposed || !renderer) return null;
    if (lost) return renderCount ? surface : null;
    const next = state.playing && !state.reducedMotion ? witchEyePose(state) : pose;
    const changed = next.yaw !== pose.yaw || next.pitch !== pose.pitch || next.roll !== pose.roll;
    if (!dirty && !changed) return surface;
    if (!dirty && performance.now() - lastRender < quality.frameInterval) return surface;
    pose = next; return drawSnapshot();
  }
  function setQuality(value = {}) {
    const next = witchEyeQuality({ ...quality, ...value });
    // Source textures are downsampled once at load; later display budget
    // changes adjust the tiny framebuffer without decoding/recoloring again.
    next.textureSize = quality.textureSize;
    if (next.size !== quality.size) dirty = true;
    quality = next;
  }
  function dispose() {
    if (disposed) return; disposed = true; abort.abort(); releaseModel();
    renderer?.dispose(); renderer?.forceContextLoss(); renderer = null;
    canvas.width = canvas.height = surface.width = surface.height = 1;
  }
  return { ready, render, setQuality, dispose,
    getMetadata: () => ({ loaded: loaded && !disposed && !lost, source: 'assets/witch/eye-512.glb',
      triangles, texturePixels, quality: { ...quality }, bufferSize: [canvas.width, canvas.height],
      renderCount, pose: { ...pose }, webglContexts: renderer ? 1 : 0 }) };
}
