import * as THREE from "../vendor/three/three.module.min.js?v=f72ddf8141de";
import { GLTFLoader } from "../vendor/three/loaders/GLTFLoader.js?v=8a306448a309";

const MODEL_URL = new URL("../assets/models/dentaphone-chomper.glb?v=0cfb9cf42806", import.meta.url);
const TOOTH_ID = /^(upper|lower)-(0[1-9]|1[0-6])$/;
const CHOMP_DURATION_MS = 640;
const REDUCED_CHOMP_DURATION_MS = 220;
const MAX_DEVICE_PIXEL_RATIO = 1.75;
const MAX_RENDER_PIXELS = 1_650_000;

const clamp = (value, minimum = 0, maximum = 1) => Math.min(
  maximum,
  Math.max(minimum, Number.isFinite(Number(value)) ? Number(value) : minimum),
);
const radians = (degrees) => THREE.MathUtils.degToRad(Number(degrees) || 0);
const smoothstep = (value) => {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
};

const TOOTH_VERTEX_SHADER = `
  uniform float uTime;
  uniform float uPulse;
  uniform float uMotion;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;
  varying vec3 vObjectPosition;

  void main() {
    float tremor = sin(uTime * 122.0 + position.y * 0.82 + position.x * 0.37);
    float aftershock = sin(uTime * 67.0 - position.z * 0.74);
    vec3 displaced = position;
    displaced += normal * (tremor * 0.16 + aftershock * 0.07) * uPulse * uMotion;
    displaced.x += tremor * 0.08 * uPulse * uMotion;
    vec4 world = modelMatrix * vec4(displaced, 1.0);
    vWorldPosition = world.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vObjectPosition = position;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const TOOTH_FRAGMENT_SHADER = `
  uniform float uPulse;
  uniform float uHover;
  uniform float uSelected;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;
  varying vec3 vObjectPosition;

  float hash31(vec3 value) {
    return fract(sin(dot(value, vec3(12.9898, 78.233, 41.164))) * 43758.5453);
  }

  void main() {
    vec3 normal = normalize(vWorldNormal);
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    vec3 keyDirection = normalize(vec3(-0.42, 0.78, 0.52));
    vec3 fillDirection = normalize(vec3(0.68, 0.22, 0.66));
    float key = max(dot(normal, keyDirection), 0.0);
    float fill = max(dot(normal, fillDirection), 0.0);
    float rim = pow(1.0 - max(dot(normal, viewDirection), 0.0), 2.35);
    float glint = pow(max(dot(reflect(-keyDirection, normal), viewDirection), 0.0), 34.0);
    float grain = hash31(floor(vObjectPosition * 2.8));
    float fissure = smoothstep(0.82, 0.98, grain) * (0.35 + 0.65 * (1.0 - key));

    vec3 shadow = vec3(0.115, 0.075, 0.042);
    vec3 ivory = vec3(0.79, 0.69, 0.49);
    vec3 enamel = mix(shadow, ivory, 0.22 + key * 0.62 + fill * 0.19);
    enamel = mix(enamel, vec3(0.31, 0.19, 0.09), fissure * 0.22);
    enamel += vec3(1.0, 0.91, 0.68) * glint * 0.62;
    enamel += vec3(0.12, 0.31, 0.29) * rim * 0.35;

    float attention = max(uSelected * 0.72, uHover);
    enamel = mix(enamel, vec3(0.22, 0.86, 0.73), attention * (0.18 + rim * 0.66));
    enamel += vec3(1.0, 0.39, 0.18) * uPulse * (0.33 + rim * 0.8);
    gl_FragColor = vec4(enamel, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const GUM_VERTEX_SHADER = `
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;
  varying vec3 vObjectPosition;

  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPosition = world.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vObjectPosition = position;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const GUM_FRAGMENT_SHADER = `
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;
  varying vec3 vObjectPosition;

  float hash31(vec3 value) {
    return fract(sin(dot(value, vec3(19.19, 73.71, 37.11))) * 41791.733);
  }

  void main() {
    vec3 normal = normalize(vWorldNormal);
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    vec3 lightDirection = normalize(vec3(-0.46, 0.76, 0.48));
    float light = max(dot(normal, lightDirection), 0.0);
    float rim = pow(1.0 - max(dot(normal, viewDirection), 0.0), 2.0);
    float grain = hash31(floor(vObjectPosition * 1.8));
    vec3 dark = vec3(0.075, 0.018, 0.016);
    vec3 warm = vec3(0.34, 0.075, 0.046);
    vec3 color = mix(dark, warm, 0.24 + light * 0.66);
    color += vec3(0.28, 0.10, 0.055) * grain * 0.08;
    color += vec3(0.09, 0.28, 0.24) * rim * 0.24;
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const CAVITY_VERTEX_SHADER = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const CAVITY_FRAGMENT_SHADER = `
  varying vec2 vUv;

  void main() {
    float radius = length((vUv - 0.5) * vec2(1.0, 1.18));
    float edge = smoothstep(0.12, 0.58, radius);
    vec3 center = vec3(0.0015, 0.005, 0.007);
    vec3 depth = vec3(0.003, 0.012, 0.014);
    gl_FragColor = vec4(mix(center, depth, edge * 0.46), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function toothMaterial(reducedMotion) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPulse: { value: 0 },
      uHover: { value: 0 },
      uSelected: { value: 0 },
      uMotion: { value: reducedMotion ? 0 : 1 },
    },
    vertexShader: TOOTH_VERTEX_SHADER,
    fragmentShader: TOOTH_FRAGMENT_SHADER,
    // The anatomical source mesh contains a few surfaces with inconsistent winding.
    // Rendering both sides keeps the complete enamel shell visible from every
    // orbit angle without rewriting the source anatomy.
    side: THREE.DoubleSide,
    toneMapped: true,
  });
}

function gumMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: GUM_VERTEX_SHADER,
    fragmentShader: GUM_FRAGMENT_SHADER,
    side: THREE.DoubleSide,
    toneMapped: true,
  });
}

function cavityMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: CAVITY_VERTEX_SHADER,
    fragmentShader: CAVITY_FRAGMENT_SHADER,
    side: THREE.DoubleSide,
    toneMapped: true,
  });
}

class DentaphoneWebGLRenderer {
  constructor(canvas, artboard, rig) {
    this.canvas = canvas;
    this.artboard = artboard;
    this.rig = rig;
    this.reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)") ?? { matches: false };
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(31, 1, 0.1, 500);
    this.camera.position.set(0, 2.5, 145);
    this.camera.lookAt(0, 0, 0);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.toothMeshes = [];
    this.toothById = new Map();
    this.toothAnchorCandidates = new Map();
    this.toothDetailedAnchorCandidates = new Map();
    this.toothSurfaceAnchors = new Map();
    this.toothAnchorLayoutKey = "";
    this.toothAnchorObservedKey = "";
    this.toothAnchorRefreshAt = 0;
    this.toothAnchorPendingKey = "";
    this.toothAnchorRefreshQueue = [];
    this.pulses = new Map();
    this.frame = 0;
    this.ready = false;
    this.active = false;
    this.disposed = false;
    this.chompStartedAt = -Infinity;
    this.chompKey = "";
    this.chompCycleActive = false;
    this.chompContactDispatched = false;
    this.currentJawOpen = clamp(this.artboard.dataset.jawOpen ?? 0.58);
    this.model = null;
    this.upperPivot = null;
    this.lowerPivot = null;
    this.modelRadius = 48;
    this.modelSize = new THREE.Vector3(72, 64, 64);
    this.cameraTargetY = 0;
    this.resizeObserver = null;
    this.mutationObserver = null;
    this.contextLost = false;
    this.render = this.render.bind(this);
    this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
    this.handleContextLost = this.handleContextLost.bind(this);
    this.handleContextRestored = this.handleContextRestored.bind(this);
    this.handleReducedMotionChange = this.handleReducedMotionChange.bind(this);
  }

  async initialize() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;

    this.canvas.addEventListener("webglcontextlost", this.handleContextLost);
    this.canvas.addEventListener("webglcontextrestored", this.handleContextRestored);

    const gltf = await new GLTFLoader().loadAsync(MODEL_URL.href);
    if (this.disposed) return this;
    this.installModel(gltf.scene);
    this.bindObservers();
    this.resize();
    this.renderer.render(this.scene, this.camera);
    this.ready = true;
    this.artboard.classList.remove("is-webgl-fallback");
    this.artboard.classList.add("is-webgl-ready");
    this.artboard.dataset.dentaphoneMeshCount = String(this.toothMeshes.length);
    this.artboard.dispatchEvent(new CustomEvent("dentaphone-webgl-ready", {
      detail: { toothCount: this.toothMeshes.length },
    }));
    this.setActive(this.artboard.dataset.dentaphoneViewMode === "3d");
    return this;
  }

  installModel(model) {
    this.model = model;
    this.scene.add(model);
    model.updateMatrixWorld(true);

    const upperSource = model.getObjectByName("UpperJaw");
    const lowerSource = model.getObjectByName("LowerJaw");
    if (!upperSource || !lowerSource) throw new Error("Dentaphone GLB is missing jaw groups.");

    const gum = gumMaterial();
    model.traverse((object) => {
      if (!object.isMesh) return;
      if (!object.geometry.attributes.normal) object.geometry.computeVertexNormals();
      if (TOOTH_ID.test(object.name)) {
        object.material = toothMaterial(this.reducedMotion.matches);
        object.userData.toothId = object.name;
        object.geometry.computeBoundingBox();
        object.geometry.computeBoundingSphere();
        this.toothMeshes.push(object);
        this.toothById.set(object.name, object);
        this.toothAnchorCandidates.set(
          object.name,
          this.buildSurfaceAnchorCandidates(object.geometry),
        );
      } else if (object.name.endsWith("-gum")) {
        object.material = gum;
      }
    });
    if (this.toothMeshes.length !== 32) {
      throw new Error(`Dentaphone GLB exposes ${this.toothMeshes.length} teeth instead of 32.`);
    }

    const bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    model.position.sub(center);
    model.updateMatrixWorld(true);
    const centeredBounds = new THREE.Box3().setFromObject(model);
    const centeredSize = centeredBounds.getSize(new THREE.Vector3());
    this.modelSize.copy(centeredSize);
    this.modelRadius = Math.max(centeredSize.x, centeredSize.y) * 0.56;

    const cavity = new THREE.Mesh(
      new THREE.CircleGeometry(centeredSize.x * 0.43, 64),
      cavityMaterial(),
    );
    cavity.name = "DentaphoneOralCavity";
    // Keep the backdrop tucked inside the dental arches. A round, jaw-sized
    // plane reads as a visible disc when the whole mouth is orbited.
    cavity.scale.y = 0.58;
    cavity.position.y = -centeredSize.y * 0.115;
    cavity.position.z = centeredBounds.min.z - 0.75;
    cavity.renderOrder = -1;
    cavity.userData.dentaphonePart = "cavity";
    model.add(cavity);

    const hingeZ = centeredBounds.min.z - Math.max(1.5, size.z * 0.025);
    this.upperPivot = this.wrapJawAtHinge(upperSource, hingeZ, "DentaphoneUpperHinge");
    this.lowerPivot = this.wrapJawAtHinge(lowerSource, hingeZ, "DentaphoneLowerHinge");
    model.updateMatrixWorld(true);

    const distance = this.modelRadius / Math.tan(radians(this.camera.fov * 0.5)) * 1.16;
    this.cameraTargetY = centeredSize.y * 0.035;
    this.camera.position.set(0, this.cameraTargetY, distance);
    this.camera.lookAt(0, 0, 0);
    this.camera.near = Math.max(0.1, distance - centeredSize.z * 2.2);
    this.camera.far = distance + centeredSize.z * 3.2;
    this.camera.updateProjectionMatrix();
  }

  wrapJawAtHinge(jaw, hingeZ, name) {
    const parent = jaw.parent;
    const world = jaw.matrixWorld.clone();
    const pivot = new THREE.Group();
    pivot.name = name;
    pivot.position.set(0, 0, hingeZ);
    parent.add(pivot);
    pivot.updateMatrixWorld(true);
    parent.remove(jaw);
    pivot.add(jaw);
    jaw.matrix.copy(pivot.matrixWorld.clone().invert().multiply(world));
    jaw.matrix.decompose(jaw.position, jaw.quaternion, jaw.scale);
    return pivot;
  }

  bindObservers() {
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.artboard);
    this.mutationObserver = new MutationObserver((records) => this.registerChomp(records));
    this.mutationObserver.observe(this.rig, {
      attributes: true,
      attributeOldValue: true,
      attributeFilter: [
        "class",
        "data-chew-bite",
        "data-chew-food",
        "data-chomp-kind",
        "data-chomp-generation",
        "data-chomp-id",
      ],
    });
    this.registerChomp();
    this.reducedMotion.addEventListener?.("change", this.handleReducedMotionChange);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
  }

  handleContextLost(event) {
    event.preventDefault();
    this.contextLost = true;
    this.ready = false;
    this.active = false;
    this.artboard.classList.remove("is-webgl-ready");
    this.artboard.classList.add("is-webgl-fallback");
    this.artboard.dataset.dentaphoneRenderer = this.artboard.dataset.dentaphoneViewMode === "3d"
      ? "fallback"
      : "image";
    this.artboard.dispatchEvent(new CustomEvent("dentaphone-webgl-context-lost"));
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  handleContextRestored() {
    if (this.disposed) return;
    this.contextLost = false;
    this.ready = true;
    this.artboard.classList.remove("is-webgl-fallback");
    this.artboard.classList.add("is-webgl-ready");
    this.setActive(this.artboard.dataset.dentaphoneViewMode === "3d");
  }

  handleReducedMotionChange() {
    for (const mesh of this.toothMeshes) {
      mesh.material.uniforms.uMotion.value = this.reducedMotion.matches ? 0 : 1;
    }
  }

  resetChompCycle() {
    this.chompStartedAt = -Infinity;
    this.chompKey = "";
    this.chompCycleActive = false;
    this.chompContactDispatched = false;
  }

  registerChomp(records = []) {
    if (!this.rig.classList.contains("is-chomping")) {
      this.resetChompCycle();
      return;
    }
    const key = [
      this.rig.dataset.chewFood ?? "manual",
      this.rig.dataset.chewBite ?? "0",
      this.rig.dataset.chompKind ?? "",
      this.rig.dataset.chompGeneration ?? "",
      this.rig.dataset.chompId ?? "",
    ].join(":");
    const classStarted = records.some((record) => (
      record.attributeName === "class"
      && !String(record.oldValue ?? "").split(/\s+/).includes("is-chomping")
    ));
    if (this.chompCycleActive && !classStarted && key === this.chompKey) return;
    this.chompKey = key;
    this.chompStartedAt = performance.now();
    this.chompCycleActive = true;
    this.chompContactDispatched = false;
  }

  dispatchChompContact(open, time) {
    if (
      !this.chompCycleActive
      || this.chompContactDispatched
      || !this.rig.classList.contains("is-chomping")
      || this.rig.dataset.chompKind !== "empty"
      || this.rig.dataset.chewFood !== undefined
      || open > 0.001
    ) return;
    this.chompContactDispatched = true;
    const detail = { jawOpen: open, time };
    if (this.rig.dataset.chompGeneration !== undefined) {
      detail.chompGeneration = this.rig.dataset.chompGeneration;
    }
    if (this.rig.dataset.chompId !== undefined) detail.chompId = this.rig.dataset.chompId;
    this.artboard.dispatchEvent(new CustomEvent("dentaphone-webgl-chomp-contact", { detail }));
  }

  resize() {
    if (!this.renderer || this.disposed) return;
    const bounds = this.artboard.getBoundingClientRect();
    if (bounds.width < 2 || bounds.height < 2) return;
    const requested = Math.min(MAX_DEVICE_PIXEL_RATIO, globalThis.devicePixelRatio || 1);
    const budgetRatio = Math.sqrt(MAX_RENDER_PIXELS / (bounds.width * bounds.height));
    const ratio = Math.max(0.75, Math.min(requested, budgetRatio));
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(bounds.width, bounds.height, false);
    this.camera.aspect = bounds.width / bounds.height;
    const tangent = Math.tan(radians(this.camera.fov * 0.5));
    const verticalFit = this.modelSize.y * 0.5 / tangent * 1.4;
    const horizontalFit = this.modelSize.x * 0.5 / (tangent * this.camera.aspect) * 1.16;
    const distance = Math.max(verticalFit, horizontalFit);
    this.camera.position.set(0, this.cameraTargetY, distance);
    this.camera.lookAt(0, 0, 0);
    this.camera.near = Math.max(0.1, distance - this.modelSize.z * 2.2);
    this.camera.far = distance + this.modelSize.z * 3.2;
    this.camera.updateProjectionMatrix();
  }

  jawOpenAt(time) {
    const baseOpen = clamp(this.artboard.dataset.jawOpen ?? 0.58);
    if (!this.rig.classList.contains("is-chomping")) return baseOpen;
    const duration = this.reducedMotion.matches ? REDUCED_CHOMP_DURATION_MS : CHOMP_DURATION_MS;
    const progress = clamp((time - this.chompStartedAt) / duration);
    let closure;
    if (progress <= 0.34) closure = smoothstep(progress / 0.34);
    else if (progress <= 0.5) closure = 1;
    else if (progress <= 0.64) closure = 1 - smoothstep((progress - 0.5) / 0.14) * 0.12;
    else closure = 0.88 * (1 - smoothstep((progress - 0.64) / 0.36));
    return THREE.MathUtils.lerp(baseOpen, 0, closure);
  }

  updateTransforms(time) {
    let open = this.jawOpenAt(time);
    const duration = this.reducedMotion.matches ? REDUCED_CHOMP_DURATION_MS : CHOMP_DURATION_MS;
    const chompProgress = this.chompCycleActive
      ? clamp((time - this.chompStartedAt) / duration)
      : 0;
    // A busy frame can jump completely over the short reduced-motion contact
    // plateau. Render one true closed-jaw frame on the first crossing so the
    // contact event and the visible tooth collision can never be skipped.
    if (
      !this.chompContactDispatched
      && this.rig.classList.contains("is-chomping")
      && this.rig.dataset.chompKind === "empty"
      && chompProgress >= 0.34
    ) open = 0;
    this.currentJawOpen = open;
    const lowerAngle = radians(open * 31.5);
    const upperAngle = radians(-open * 4.5);
    this.lowerPivot.rotation.x = lowerAngle;
    this.upperPivot.rotation.x = upperAngle;
    this.lowerPivot.position.y = -open * 1.15;
    this.upperPivot.position.y = open * 0.28;
    this.model.rotation.y = radians(this.artboard.dataset.viewYaw ?? -4);
    this.model.rotation.x = radians(-(this.artboard.dataset.viewPitch ?? 3));
    this.dispatchChompContact(open, time);
  }

  updateMaterials(time) {
    const selected = this.artboard.querySelector(".dentaphone-tooth.is-selected")?.dataset.toothId ?? "";
    const hovered = this.artboard.querySelector(".dentaphone-tooth.is-hovered")?.dataset.toothId ?? "";
    for (const mesh of this.toothMeshes) {
      const uniforms = mesh.material.uniforms;
      const started = this.pulses.get(mesh.userData.toothId) ?? -Infinity;
      const age = Math.max(0, (time - started) / 1000);
      const pulse = age < 0.34 ? Math.exp(-age * 7.5) * (0.65 + Math.abs(Math.sin(age * 58)) * 0.35) : 0;
      if (!pulse && started > -Infinity) this.pulses.delete(mesh.userData.toothId);
      uniforms.uTime.value = time / 1000;
      uniforms.uPulse.value = pulse;
      uniforms.uHover.value = mesh.userData.toothId === hovered ? 1 : 0;
      uniforms.uSelected.value = mesh.userData.toothId === selected ? 1 : 0;
    }
  }

  buildSurfaceAnchorCandidates(geometry, { detailed = false } = {}) {
    const position = geometry.getAttribute("position");
    const index = geometry.getIndex();
    if (!position) return [];
    const count = index?.count ?? position.count;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const candidates = [];
    for (let offset = 0; offset + 2 < count; offset += 3) {
      const aIndex = index ? index.getX(offset) : offset;
      const bIndex = index ? index.getX(offset + 1) : offset + 1;
      const cIndex = index ? index.getX(offset + 2) : offset + 2;
      a.fromBufferAttribute(position, aIndex);
      b.fromBufferAttribute(position, bIndex);
      c.fromBufferAttribute(position, cIndex);
      if (detailed) {
        // Stay just inside each triangle while sampling toward all three
        // corners. This finds the narrow visible slivers on rear molars that
        // a triangle-centroid-only pass can legitimately miss.
        candidates.push(
          new THREE.Vector3(
            (a.x * 4 + b.x + c.x) / 6,
            (a.y * 4 + b.y + c.y) / 6,
            (a.z * 4 + b.z + c.z) / 6,
          ),
          new THREE.Vector3(
            (a.x + b.x * 4 + c.x) / 6,
            (a.y + b.y * 4 + c.y) / 6,
            (a.z + b.z * 4 + c.z) / 6,
          ),
          new THREE.Vector3(
            (a.x + b.x + c.x * 4) / 6,
            (a.y + b.y + c.y * 4) / 6,
            (a.z + b.z + c.z * 4) / 6,
          ),
          new THREE.Vector3(
            a.x * 0.94 + b.x * 0.03 + c.x * 0.03,
            a.y * 0.94 + b.y * 0.03 + c.y * 0.03,
            a.z * 0.94 + b.z * 0.03 + c.z * 0.03,
          ),
          new THREE.Vector3(
            a.x * 0.03 + b.x * 0.94 + c.x * 0.03,
            a.y * 0.03 + b.y * 0.94 + c.y * 0.03,
            a.z * 0.03 + b.z * 0.94 + c.z * 0.03,
          ),
          new THREE.Vector3(
            a.x * 0.03 + b.x * 0.03 + c.x * 0.94,
            a.y * 0.03 + b.y * 0.03 + c.y * 0.94,
            a.z * 0.03 + b.z * 0.03 + c.z * 0.94,
          ),
          new THREE.Vector3(
            a.x * 0.485 + b.x * 0.485 + c.x * 0.03,
            a.y * 0.485 + b.y * 0.485 + c.y * 0.03,
            a.z * 0.485 + b.z * 0.485 + c.z * 0.03,
          ),
          new THREE.Vector3(
            a.x * 0.485 + b.x * 0.03 + c.x * 0.485,
            a.y * 0.485 + b.y * 0.03 + c.y * 0.485,
            a.z * 0.485 + b.z * 0.03 + c.z * 0.485,
          ),
          new THREE.Vector3(
            a.x * 0.03 + b.x * 0.485 + c.x * 0.485,
            a.y * 0.03 + b.y * 0.485 + c.y * 0.485,
            a.z * 0.03 + b.z * 0.485 + c.z * 0.485,
          ),
        );
      } else {
        candidates.push(new THREE.Vector3(
          (a.x + b.x + c.x) / 3,
          (a.y + b.y + c.y) / 3,
          (a.z + b.z + c.z) / 3,
        ));
      }
    }
    return candidates;
  }

  findVisibleSurfaceAnchor(mesh) {
    const nominal = mesh.geometry.boundingSphere.center.clone();
    mesh.localToWorld(nominal);
    nominal.project(this.camera);
    const projected = new THREE.Vector3();
    const findCandidate = (candidates) => {
      const ranked = [];
      for (const localPoint of candidates) {
        projected.copy(localPoint);
        mesh.localToWorld(projected);
        projected.project(this.camera);
        if (
          projected.z < -1 || projected.z > 1
          || Math.abs(projected.x) > 1.08 || Math.abs(projected.y) > 1.08
        ) continue;
        ranked.push({
          x: projected.x,
          y: projected.y,
          depth: projected.z,
          // Prefer the visual center of the tooth. The raycast below rejects
          // a candidate when a nearer tooth covers that surface point.
          score: (projected.x - nominal.x) ** 2 + (projected.y - nominal.y) ** 2,
        });
      }
      // A rear tooth is often exposed only along its camera-nearest rim. Try
      // those surface samples first, then favor the visual center at equal
      // depth; this avoids walking hundreds of occluded central samples.
      ranked.sort((left, right) => left.depth - right.depth || left.score - right.score);
      for (const candidate of ranked) {
        this.pointer.set(candidate.x, candidate.y);
        this.raycaster.setFromCamera(this.pointer, this.camera);
        const hit = this.raycaster.intersectObjects(this.toothMeshes, false)[0];
        if (hit?.object === mesh) return mesh.worldToLocal(hit.point.clone());
      }
      return null;
    };

    const toothId = mesh.userData.toothId;
    const centered = findCandidate(this.toothAnchorCandidates.get(toothId) ?? []);
    if (centered) return centered;
    if (!this.toothDetailedAnchorCandidates.has(toothId)) {
      this.toothDetailedAnchorCandidates.set(
        toothId,
        this.buildSurfaceAnchorCandidates(mesh.geometry, { detailed: true }),
      );
    }
    return findCandidate(this.toothDetailedAnchorCandidates.get(toothId));
  }

  surfaceAnchorStillMatches(mesh, localAnchor) {
    const projected = localAnchor.clone();
    mesh.localToWorld(projected);
    projected.project(this.camera);
    if (
      projected.z < -1 || projected.z > 1
      || Math.abs(projected.x) > 1.08 || Math.abs(projected.y) > 1.08
    ) return false;
    this.pointer.set(projected.x, projected.y);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.intersectObjects(this.toothMeshes, false)[0]?.object === mesh;
  }

  refreshSurfaceAnchors() {
    const layoutKey = [
      this.artboard.dataset.viewYaw,
      this.artboard.dataset.viewPitch,
      this.artboard.dataset.jawOpen,
    ].join(":");
    const now = performance.now();
    if (layoutKey !== this.toothAnchorObservedKey) {
      this.toothAnchorObservedKey = layoutKey;
      this.toothAnchorRefreshAt = now + 90;
      this.toothAnchorPendingKey = "";
      this.toothAnchorRefreshQueue = [];
      if (this.toothSurfaceAnchors.size) return;
    }
    if (
      layoutKey === this.toothAnchorLayoutKey
      || (this.toothSurfaceAnchors.size && now < this.toothAnchorRefreshAt)
    ) return;
    if (this.toothAnchorPendingKey !== layoutKey) {
      this.toothAnchorPendingKey = layoutKey;
      this.toothAnchorRefreshQueue = [...this.toothMeshes];
    }
    const refreshStartedAt = performance.now();
    do {
      const mesh = this.toothAnchorRefreshQueue.shift();
      if (!mesh) break;
      const toothId = mesh.userData.toothId;
      const previous = this.toothSurfaceAnchors.get(toothId);
      const anchor = previous && this.surfaceAnchorStillMatches(mesh, previous)
        ? previous
        : this.findVisibleSurfaceAnchor(mesh);
      if (anchor) this.toothSurfaceAnchors.set(toothId, anchor);
      else this.toothSurfaceAnchors.delete(toothId);
    } while (
      this.toothAnchorRefreshQueue.length
      && performance.now() - refreshStartedAt < 5
    );
    if (!this.toothAnchorRefreshQueue.length) {
      this.toothAnchorLayoutKey = layoutKey;
      this.toothAnchorPendingKey = "";
    }
  }

  layoutHitTargets() {
    const bounds = this.artboard.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    this.refreshSurfaceAnchors();
    const center = new THREE.Vector3();
    const corner = new THREE.Vector3();
    for (const mesh of this.toothMeshes) {
      mesh.updateWorldMatrix(true, false);
      center.copy(
        this.toothSurfaceAnchors.get(mesh.userData.toothId)
        ?? mesh.geometry.boundingSphere.center,
      );
      mesh.localToWorld(center);
      center.project(this.camera);
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      const box = mesh.geometry.boundingBox;
      for (const x of [box.min.x, box.max.x]) {
        for (const y of [box.min.y, box.max.y]) {
          for (const z of [box.min.z, box.max.z]) {
            corner.set(x, y, z);
            mesh.localToWorld(corner);
            corner.project(this.camera);
            minX = Math.min(minX, corner.x);
            maxX = Math.max(maxX, corner.x);
            minY = Math.min(minY, corner.y);
            maxY = Math.max(maxY, corner.y);
          }
        }
      }
      const button = this.artboard.querySelector(`[data-tooth-id="${mesh.userData.toothId}"]`);
      if (!button) continue;
      // The canvas itself raycasts the full visible mesh. These compact DOM
      // targets provide focus/labels without one rear tooth masking its
      // neighbour in the strongly foreshortened arch.
      const width = clamp((maxX - minX) * bounds.width * 0.25, 26, 46);
      const height = clamp((maxY - minY) * bounds.height * 0.25, 28, 48);
      button.style.setProperty("--tooth-x", `${((center.x * 0.5 + 0.5) * 100).toFixed(3)}%`);
      button.style.setProperty("--tooth-y", `${((-center.y * 0.5 + 0.5) * 100).toFixed(3)}%`);
      button.style.setProperty("--tooth-width", `${width.toFixed(2)}px`);
      button.style.setProperty("--tooth-height", `${height.toFixed(2)}px`);
      button.style.setProperty("--tooth-angle", "0deg");
      button.style.setProperty("--tooth-counter-angle", "0deg");
      button.style.zIndex = String(Math.round((1 - center.z) * 10_000));
      button.toggleAttribute(
        "data-webgl-hidden",
        center.z < -1 || center.z > 1 || Math.abs(center.x) > 1.08 || Math.abs(center.y) > 1.08,
      );
    }
  }

  render(time = performance.now()) {
    this.frame = 0;
    if (!this.active || this.disposed || this.contextLost || document.hidden) return;
    this.updateTransforms(time);
    this.updateMaterials(time);
    this.scene.updateMatrixWorld(true);
    this.layoutHitTargets();
    this.renderer.render(this.scene, this.camera);
    this.start();
  }

  start() {
    if (this.active && !this.frame && !this.disposed && !this.contextLost && !document.hidden) {
      this.frame = requestAnimationFrame(this.render);
    }
  }

  setActive(active) {
    this.active = Boolean(active && this.ready && !this.disposed && !this.contextLost);
    if (!this.active) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      if (this.artboard.dataset.dentaphoneViewMode === "2d") {
        this.artboard.dataset.dentaphoneRenderer = "image";
      }
      return false;
    }
    this.artboard.dataset.dentaphoneRenderer = "webgl";
    this.resize();
    this.start();
    return true;
  }

  handleVisibilityChange() {
    if (!document.hidden) this.start();
  }

  pick(clientX, clientY) {
    if (!this.active || !this.ready || this.contextLost) return null;
    const bounds = this.canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return null;
    this.pointer.set(
      ((clientX - bounds.left) / bounds.width) * 2 - 1,
      -((clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    this.scene.updateMatrixWorld(true);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.toothMeshes, false)[0];
    return hit?.object?.userData?.toothId ?? null;
  }

  pulse(toothId) {
    if (this.active && this.toothById.has(toothId)) this.pulses.set(toothId, performance.now());
  }

  snapshot() {
    return Object.freeze({
      ready: this.ready,
      active: this.active,
      renderer: this.artboard.dataset.dentaphoneRenderer ?? "loading",
      toothCount: this.toothMeshes.length,
      triangles: this.renderer?.info?.render?.triangles ?? 0,
      drawCalls: this.renderer?.info?.render?.calls ?? 0,
      jawOpen: this.currentJawOpen,
      upperRotationX: this.upperPivot?.rotation.x ?? 0,
      lowerRotationX: this.lowerPivot?.rotation.x ?? 0,
      yaw: this.model?.rotation.y ?? 0,
      pitch: this.model?.rotation.x ?? 0,
      renderWidth: this.renderer?.domElement?.width ?? 0,
      renderHeight: this.renderer?.domElement?.height ?? 0,
    });
  }

  dispose() {
    this.disposed = true;
    this.ready = false;
    this.active = false;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.resizeObserver?.disconnect();
    this.mutationObserver?.disconnect();
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    this.reducedMotion.removeEventListener?.("change", this.handleReducedMotionChange);
    this.canvas.removeEventListener("webglcontextlost", this.handleContextLost);
    this.canvas.removeEventListener("webglcontextrestored", this.handleContextRestored);
    const geometries = new Set();
    const materials = new Set();
    this.model?.traverse((object) => {
      if (!object.isMesh) return;
      if (object.geometry) geometries.add(object.geometry);
      const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of objectMaterials) if (material) materials.add(material);
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    this.renderer?.dispose();
    this.artboard.classList.remove("is-webgl-ready", "is-webgl-fallback");
    delete this.artboard.dataset.dentaphoneMeshCount;
    this.artboard.dataset.dentaphoneRenderer = this.artboard.dataset.dentaphoneViewMode === "3d"
      ? "loading"
      : "image";
  }
}

let activeRenderer = null;
let initialization = null;

export function initializeDentaphoneWebGL() {
  if (initialization) return initialization;
  const canvas = document.getElementById("dentaphoneWebgl");
  const artboard = document.getElementById("dentaphoneArtboard");
  const rig = document.getElementById("dentaphoneKeyboard");
  if (!canvas || !artboard || !rig) return Promise.resolve(null);
  if (globalThis.matchMedia?.("(forced-colors: active)").matches) {
    artboard.classList.add("is-webgl-fallback");
    artboard.dataset.dentaphoneRenderer = "fallback";
    return Promise.resolve(null);
  }
  artboard.dataset.dentaphoneRenderer = "loading";
  const renderer = new DentaphoneWebGLRenderer(canvas, artboard, rig);
  activeRenderer = renderer;
  let attempt = null;
  attempt = renderer.initialize().catch((error) => {
    if (activeRenderer !== renderer || initialization !== attempt) return null;
    console.warn("Dentaphone WebGL renderer unavailable; using the anatomical plate fallback.", error);
    renderer.dispose();
    activeRenderer = null;
    initialization = null;
    artboard.classList.remove("is-webgl-ready");
    artboard.classList.add("is-webgl-fallback");
    artboard.dataset.dentaphoneRenderer = "fallback";
    artboard.dispatchEvent(new CustomEvent("dentaphone-webgl-error", { detail: { error } }));
    return null;
  });
  initialization = attempt;
  return attempt;
}

export function dentaphoneWebGLToothAtPoint(clientX, clientY) {
  return activeRenderer?.pick(clientX, clientY) ?? null;
}

export function dentaphoneWebGLIsReady() {
  return Boolean(activeRenderer?.ready);
}

export function pulseDentaphoneWebGLTooth(toothId) {
  activeRenderer?.pulse(toothId);
}

export function setDentaphoneWebGLActive(active) {
  return activeRenderer?.setActive(active) ?? false;
}

export function dentaphoneWebGLSnapshot() {
  return activeRenderer?.snapshot() ?? Object.freeze({
    ready: false,
    active: false,
    renderer: "unavailable",
    toothCount: 0,
    triangles: 0,
    drawCalls: 0,
    jawOpen: 0,
    upperRotationX: 0,
    lowerRotationX: 0,
    yaw: 0,
    pitch: 0,
    renderWidth: 0,
    renderHeight: 0,
  });
}

export function disposeDentaphoneWebGL() {
  activeRenderer?.dispose();
  activeRenderer = null;
  initialization = null;
}
