import * as THREE from "../../../vendor/three/three.module.min.js";
import { GLTFLoader } from "../../../vendor/three/loaders/GLTFLoader.js";
import {
  boundedEyeTurn, boundedOculoidStretch, canthusRecessPoint, clampEye, colorizeIrisPixels,
  eyeClusterLayout, eyeEnsemblePose, normalizeOculoidEnsemble, OCULOID_EYE_COUNTS,
  GLOBE_HULL_RADIUS, GLOBE_SQUASH, hexEyeColor, lashPoint, lidCameraDistance, lidEdge, lidLipPoint,
  lidOuterY, lidPatchPoint, lidShellNormal, lidSurfaceDepth, LID_PATCH_X, LID_SHELL_RADIUS,
  normalizeOculoidLighting, oculoidPokeContact, oculoidPokeDisplacement,
  oculoidStretchWeight,
  OCULOID_SURFACE_DEFAULTS,
  OCULOID_SURFACE_RANGES,
  oculoidFlashlightExposure, oculoidLitPupil,
  OCULOID_APPEARANCE_DEFAULTS, OCULOID_EYE_LOOKS, OCULOID_IRIS_COLORS,
  OCULOID_IRIS_PATTERNS, OCULOID_LIGHT_DEFAULTS, OCULOID_SCLERA_COLORS,
  OCULOID_SCLERA_PATTERNS,
  OCULOID_SKIN_FINISHES, oculoidLightPosition,
  TEAR_DROP_SCALE, TEAR_TIP_HEIGHT, tearDropPose,
} from "./oculoid-model.js";
import { createOculoidWardrobe, OCULOID_WARDROBE_DEFAULTS } from "./oculoid-wardrobe.js";

const SLICES = 112, CAP_SLICES = 8, RINGS = 28, LIP_RINGS = 10, LINING_RINGS = 2, BACK_RINGS = 52;
const RECESS_SLICES = 20, RECESS_RINGS = 8;
const LASH_STEPS = 6, LASH_SIDES = 3;
const EYE_URL = new URL("../../../assets/oculoid/eye.glb", import.meta.url);
const DROP_URL = new URL("../../../assets/oculoid/drop.glb", import.meta.url);
const GLASSES_URL = new URL("../../../assets/oculoid/aviator-sunglasses.glb", import.meta.url);
const mix = (a, b, t) => a + (b - a) * t;

function createSkinTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d");
  const data = ctx.createImageData(256, 256);
  let seed = 0x410ffe01;
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const pore = (seed >>> 26) % 47 === 0 ? -15 : 0;
    // Fine stochastic bump only; sampled rings/UV stripes looked like tiles.
    const value = clampEye(127 + (seed & 15) - 8 + pore, 0, 255);
    const offset = (y * 256 + x) * 4;
    data.data[offset] = data.data[offset + 1] = data.data[offset + 2] = value;
    data.data[offset + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 3);
  return texture;
}

export function createStudioReflection() {
  // Broad, feathered studio reflections instead of rectangular softboxes or
  // a painted dark stripe. Keep some ambient reflection at the equator so
  // the spherical chrome stays visible when turned against the black stage.
  const canvas = document.createElement("canvas");
  canvas.width = 1024; canvas.height = 512;
  const ctx = canvas.getContext("2d");
  const dark = ctx.createLinearGradient(0, 0, 0, canvas.height);
  dark.addColorStop(0, "#454241");
  dark.addColorStop(0.43, "#393736");
  dark.addColorStop(0.57, "#373534");
  dark.addColorStop(1, "#403d3c");
  ctx.fillStyle = dark;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const [x, y, width, height, core, halo] of [
    [197, 245, 155, 236, "rgba(255,250,243,.9)", "rgba(252,239,226,.25)"],
    [610, 212, 188, 177, "rgba(250,250,251,.72)", "rgba(243,244,249,.2)"],
    [861, 257, 84, 201, "rgba(251,249,246,.58)", "rgba(248,247,245,.16)"],
  ]) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(width, height);
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    glow.addColorStop(0, core);
    glow.addColorStop(0.38, halo);
    glow.addColorStop(1, "rgba(244,240,237,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Evaluate patterns per pixel, rather than interpolating a color assigned to
// each (widely spaced) vertex. Derivative-based edges stay smooth even across
// the moving lid lip, side caps, and the loaded multi-eye globe.
const SPHERE_PATTERN_GLSL = `
const float ocPi = 3.141592653589793;
float ocBand(float wave, float threshold) {
  float width = max(fwidth(wave), 0.001);
  return 1.0 - smoothstep(threshold - width, threshold + width, wave);
}
float ocSpherePattern(vec3 point, float mode) {
  if (mode < 0.5) return 0.0;
  vec3 direction = normalize(point);
  float latitude = atan(direction.y, length(direction.xz));
  float longitude = atan(direction.z, direction.x);
  if (mode < 1.5) {
    float row = floor(latitude * 16.0 / ocPi + 8.5);
    float nearest = 4.0;
    for (int step = -1; step <= 1; step++) {
      float id = clamp(row + float(step), 0.0, 16.0);
      float center = (id - 8.0) * ocPi / 16.0;
      float count = max(4.0, floor(30.0 * cos(center) + 0.5));
      float turns = longitude * count / (2.0 * ocPi) - mod(id, 2.0) * 0.5;
      float delta = (fract(turns + 0.5) - 0.5) * 2.0 * ocPi / count;
      float chord = 2.0 - 2.0 * (sin(latitude) * sin(center)
        + cos(latitude) * cos(center) * cos(delta));
      nearest = min(nearest, chord);
    }
    float edge = max(fwidth(nearest), 0.00002);
    return 1.0 - smoothstep(0.004 - edge, 0.004 + edge, nearest);
  }
  float stripe = ocBand(cos(12.0 * longitude), 0.08);
  if (mode < 2.5) return stripe;
  if (mode < 3.5) {
    float crossStripe = ocBand(cos(16.0 * latitude), 0.36);
    return 1.0 - (1.0 - stripe * 0.68) * (1.0 - crossStripe * 0.68);
  }
  return ocBand(cos(12.0 * longitude) * cos(12.0 * latitude), 0.0);
}
float ocLumps(vec3 point) {
  vec3 p = normalize(point);
  float wave = sin(13.0 * p.x + 2.0 * sin(8.0 * p.y))
    * sin(11.0 * p.y - 3.0 * p.z) + 0.35 * sin(23.0 * p.z + 7.0 * p.x);
  return smoothstep(-0.45, 0.85, wave);
}
`;
const SPHERE_PATTERN_MODES = Object.freeze({
  solid: 0, dots: 1, stripes: 2, plaid: 3, checker: 4,
});

function createLightGobo(pattern) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#1d1d1d";
  ctx.fillRect(0, 0, 512, 512);
  ctx.fillStyle = "#fffaf0";
  if (pattern === "checker") {
    const cell = 512 / 12;
    for (let row = 0; row < 12; row++) for (let col = 0; col < 12; col++)
      if ((row + col) % 2 === 0) ctx.fillRect(col * cell, row * cell, cell, cell);
  } else if (pattern === "dots") {
    const cell = 512 / 13;
    for (let row = 0; row < 13; row++) for (let col = 0; col < 13; col++) {
      ctx.beginPath();
      ctx.arc((col + 0.5) * cell, (row + 0.5) * cell, cell * 0.19, 0, 2 * Math.PI);
      ctx.fill();
    }
  } else if (pattern === "stripes") {
    ctx.save();
    ctx.translate(256, 256);
    ctx.rotate(-Math.PI / 7);
    for (let x = -750; x < 750; x += 66) ctx.fillRect(x, -750, 28, 1500);
    ctx.restore();
  } else if (pattern === "ripples") {
    ctx.strokeStyle = "#fffaf0";
    ctx.lineWidth = 18;
    for (let radius = 38; radius < 440; radius += 55) {
      ctx.beginPath();
      ctx.arc(256, 256, radius, 0, 2 * Math.PI);
      ctx.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Push the bulb clear of the spherical lip, but keep its projected centerline
 * directly below the corner. Compensate X for the forward Z shift in the
 * perspective camera; neither the apex nor its screen position moves. */
export function bendTearAwayFromLid(geometry, tipY, sx, sy, sz, aspect = 1,
  viewDistance = lidCameraDistance(aspect)) {
  const positions = geometry.getAttribute("position");
  const original = geometry.userData.tearOriginalPositions ??= positions.array.slice();
  const { x: cornerX, z: cornerZ } = tearDropPose(0.04, 0, 0);
  const depth = viewDistance - cornerZ;
  for (let i = 0; i < positions.count; i++) {
    const x = original[i * 3], y = original[i * 3 + 1], z = original[i * 3 + 2];
    const belowTip = Math.max(0, tipY - y) * sy;
    // Clear the rounded lip near the narrow neck without pushing the entire
    // grown bulb a long way toward the camera.
    const forward = 2 * Math.min(belowTip, 0.3) + 0.88 * Math.max(0, belowTip - 0.3);
    const relativeZ = z * sz + forward;
    positions.setXYZ(i,
      x - cornerX * relativeZ / (depth * sx),
      y,
      z + forward / sz);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export function createFallbackTearGeometry(aspect = 1) {
  const geometry = new THREE.SphereGeometry(1, 20, 12);
  const points = geometry.getAttribute("position");
  for (let i = 0; i < points.count; i++) {
    const y = points.getY(i);
    if (y <= 0) continue;
    const taper = (1 - y) ** 0.8;
    points.setXYZ(i, points.getX(i) * taper, y, points.getZ(i) * taper);
  }
  return bendTearAwayFromLid(geometry, 1,
    0.08 * TEAR_DROP_SCALE, TEAR_TIP_HEIGHT, 0.09 * TEAR_DROP_SCALE, aspect);
}

/** Only the outer shell and rounded lip change finish. The socket/canthi stay
 * unlit black; the licensed eyeball retains its own materials. */
export function setOculoidSkinFinish({ front, back, rim, lining }, finish,
  keyBrightness = OCULOID_LIGHT_DEFAULTS.keyBrightness,
  color = OCULOID_LIGHT_DEFAULTS.color,
  reflection = OCULOID_LIGHT_DEFAULTS.reflection) {
  const choice = OCULOID_SKIN_FINISHES.find(item => item.id === finish)
    ?? OCULOID_SKIN_FINISHES[0];
  const tint = hexEyeColor(color, OCULOID_LIGHT_DEFAULTS.color);
  const brightness = clampEye(keyBrightness, 0, 2, OCULOID_LIGHT_DEFAULTS.keyBrightness);
  const reflect = clampEye(reflection, 0, 2, OCULOID_LIGHT_DEFAULTS.reflection);
  for (const material of [front, back, rim, lining]) {
    const previousClearcoat = material.clearcoat ?? 0;
    material.color.set(tint);
    material.metalness = Number(choice.metal);
    material.roughness = choice.id === "chrome" ? (material === lining ? 0.17 : 0.11)
      : choice.id === "wet" ? 0.21 : choice.id === "gooey" ? 0.33
        : choice.id === "clumpy" ? 0.79 : 0.99;
    material.envMapIntensity = choice.id === "chrome" ? (0.55 + 1.1 * brightness) * reflect
      : choice.id === "wet" || choice.id === "gooey" ? (0.28 + 0.5 * brightness) * reflect : 0;
    material.bumpScale = material === lining || choice.id === "chrome" ? 0
      : choice.id === "clumpy" ? 0.022 : choice.id === "gooey" ? 0.012 : 0.001;
    if ("clearcoat" in material) {
      material.clearcoat = choice.id === "wet" ? 1
        : choice.id === "gooey" ? 0.95 : choice.id === "clumpy" ? 0.18 : 0;
      material.clearcoatRoughness = choice.id === "wet" ? 0.06
        : choice.id === "gooey" ? 0.16 : 0.6;
      if (Boolean(previousClearcoat) !== Boolean(material.clearcoat)) material.needsUpdate = true;
    }
  }
  lining.emissive.set(choice.metal ? 0x000000 : tint);
  lining.emissiveIntensity = choice.metal ? 0 : choice.id === "wet" ? 0.18 : 0.65;
}

/** The un-deformed coordinates travel with each eye through gaze, Poke and
 * Stretch. The GPU interpolates them per pixel; only the globe gets these
 * attributes, never the separate iris mesh or the source bitmap atlas. */
export function bindEyeballPatternCoordinates(geometry, spherePositions) {
  const positions = geometry.getAttribute("position");
  if (!positions || spherePositions?.length !== positions.count * 3) return;
  const original = new Float32Array(spherePositions.length);
  for (let i = 0; i < positions.count; i++) {
    original[3 * i] = positions.getX(i);
    original[3 * i + 1] = positions.getY(i);
    original[3 * i + 2] = positions.getZ(i);
  }
  geometry.setAttribute("oculoidSphere", new THREE.BufferAttribute(
    Float32Array.from(spherePositions), 3,
  ));
  geometry.setAttribute("oculoidOriginal", new THREE.BufferAttribute(original, 3));
}

export function buildSkinPatch(upper, skinMaterial, liningMaterial, socketMaterial, rimMaterial) {
  const bands = RINGS + LIP_RINGS;
  const geometry = new THREE.BufferGeometry(), count = (SLICES + 1) * (bands + 1);
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  const triangles = [];
  // The rounded edge takes the selected finish on both sides, but the
  // shell's inward face stays unlit black at every light position.
  let shellStart = 0;
  for (const [start, end, materialIndex] of [
    [0, LINING_RINGS, 0], [LINING_RINGS, LIP_RINGS, 1], [LIP_RINGS, bands, 2],
  ]) {
    const groupStart = triangles.length;
    if (start === LIP_RINGS) shellStart = groupStart;
    for (let slice = 0; slice < SLICES; slice++) for (let ring = start; ring < end; ring++) {
      const a = slice * (bands + 1) + ring, b = a + bands + 1;
      if (upper) triangles.push(a, b, a + 1, a + 1, b, b + 1);
      else triangles.push(a, a + 1, b, a + 1, b + 1, b);
    }
    geometry.addGroup(groupStart, triangles.length - groupStart, materialIndex);
  }
  geometry.setIndex(triangles);
  const mesh = new THREE.Mesh(geometry, [liningMaterial, rimMaterial, skinMaterial]);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  const insideGeometry = new THREE.BufferGeometry();
  insideGeometry.setAttribute("position", geometry.getAttribute("position"));
  insideGeometry.setIndex(triangles.slice(shellStart));
  const inside = new THREE.Mesh(insideGeometry, socketMaterial);
  inside.frustumCulled = false;
  inside.renderOrder = 4;
  return { mesh, inside, upper };
}

export function writeSkinPatch({ mesh, upper }, blink, lowerLid) {
  const { position, uv } = mesh.geometry.attributes;
  const bands = RINGS + LIP_RINGS;
  const initialize = !mesh.userData.skinAttributesInitialized;
  for (let slice = 0; slice <= SLICES; slice++) {
    const x = mix(-LID_PATCH_X, LID_PATCH_X, slice / SLICES);
    // All outer bands share one moving margin and pole. Recomputing the
    // canthus and arch for every vertex made continuous flutter expensive.
    const [, margin] = lidPatchPoint(x, 0, upper, blink, lowerLid);
    const outer = lidOuterY(x, upper);
    for (let ring = 0; ring <= bands; ring++) {
      const lip = ring < LIP_RINGS;
      const r = Math.max(0, (ring - LIP_RINGS) / RINGS);
      const offset = slice * (bands + 1) + ring;
      let py, pz;
      if (lip) {
        [, py, pz] = lidLipPoint(x, ring / LIP_RINGS, upper, blink, lowerLid);
      } else {
        py = margin + (outer - margin) * r;
        pz = lidSurfaceDepth(x, py);
      }
      position.setXYZ(offset, x, py, pz);
      if (initialize) uv.setXY(offset, slice / SLICES, ring / bands);
    }
  }
  if (initialize) {
    mesh.userData.skinAttributesInitialized = true;
    uv.needsUpdate = true;
  }
  position.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  // Triangle spacing becomes uneven at the equator. Exact shell normals at
  // every exposed vertex let the front and back shade seamlessly even while
  // the lips deform; keep computed normals only on the sculpted lip itself.
  const normals = mesh.geometry.getAttribute("normal");
  for (let slice = 0; slice <= SLICES; slice++) for (let ring = LIP_RINGS; ring <= bands; ring++) {
    const index = slice * (bands + 1) + ring;
    normals.setXYZ(index, ...lidShellNormal(
      position.getX(index), position.getY(index), position.getZ(index),
    ));
  }
  normals.needsUpdate = true;
}

/** Beyond the canthus there is no opening to divide into upper and lower
 * lids. One continuous front cap per side bridges the moving patches to
 * the back hemisphere, with a black inward face like the rest of the shell. */
export function buildLidSideCap(side, skinMaterial, socketMaterial) {
  const geometry = new THREE.BufferGeometry(), stride = 2 * RINGS + 1;
  const count = (CAP_SLICES + 1) * stride;
  const position = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
  const normal = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
  const uv = new THREE.BufferAttribute(new Float32Array(count * 2), 2);
  const indices = [];
  for (let slice = 0; slice <= CAP_SLICES; slice++) {
    const x = (side < 0 ? -1 : 1) * mix(LID_PATCH_X, LID_SHELL_RADIUS, slice / CAP_SLICES);
    const [, midpoint] = lidPatchPoint(x, 0, true, 0, 0);
    const outer = lidOuterY(x, true);
    for (let ring = 0; ring < stride; ring++) {
      const y = ring <= RINGS
        ? mix(outer, midpoint, ring / RINGS)
        : mix(midpoint, -outer, (ring - RINGS) / RINGS);
      const z = lidSurfaceDepth(x, y), index = slice * stride + ring;
      position.setXYZ(index, x, y, z);
      normal.setXYZ(index, ...lidShellNormal(x, y, z));
      uv.setXY(index, slice / CAP_SLICES, ring / (2 * RINGS));
    }
  }
  for (let slice = 0; slice < CAP_SLICES; slice++) for (let ring = 0; ring < 2 * RINGS; ring++) {
    const a = slice * stride + ring, b = a + stride;
    if (side < 0) indices.push(a, b, a + 1, a + 1, b, b + 1);
    else indices.push(a, a + 1, b, a + 1, b + 1, b);
  }
  geometry.setAttribute("position", position);
  geometry.setAttribute("normal", normal);
  geometry.setAttribute("uv", uv);
  geometry.setIndex(indices);
  const mesh = new THREE.Mesh(geometry, skinMaterial);
  const inside = new THREE.Mesh(geometry, socketMaterial);
  mesh.frustumCulled = inside.frustumCulled = false;
  mesh.renderOrder = 5;
  inside.renderOrder = 4;
  return { mesh, inside };
}

/** Match the front patches and both caps' *same* x-slices and equator
 * vertices, rather than joining their chords to a differently subdivided sphere. */
export function buildBackShellGeometry() {
  const geometry = new THREE.BufferGeometry(), stride = BACK_RINGS + 1;
  const slices = SLICES + 2 * CAP_SLICES;
  const count = (slices + 1) * stride;
  const position = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
  const normal = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
  const uv = new THREE.BufferAttribute(new Float32Array(count * 2), 2);
  for (let slice = 0; slice <= slices; slice++) {
    const x = slice < CAP_SLICES
      ? mix(-LID_SHELL_RADIUS, -LID_PATCH_X, slice / CAP_SLICES)
      : slice <= CAP_SLICES + SLICES
        ? mix(-LID_PATCH_X, LID_PATCH_X, (slice - CAP_SLICES) / SLICES)
        : mix(LID_PATCH_X, LID_SHELL_RADIUS, (slice - CAP_SLICES - SLICES) / CAP_SLICES);
    const section = Math.sqrt(Math.max(0, LID_SHELL_RADIUS ** 2 - x * x));
    for (let ring = 0; ring <= BACK_RINGS; ring++) {
      const angle = Math.PI * ring / BACK_RINGS, index = slice * stride + ring;
      const y = section * Math.cos(angle), z = -GLOBE_SQUASH * section * Math.sin(angle);
      position.setXYZ(index, x, y, z);
      normal.setXYZ(index, ...lidShellNormal(x, y, z));
      uv.setXY(index, slice / slices, ring / BACK_RINGS);
    }
  }
  const index = [];
  for (let slice = 0; slice < slices; slice++) for (let ring = 0; ring < BACK_RINGS; ring++) {
    const a = slice * stride + ring, b = a + stride;
    index.push(a, b, a + 1, a + 1, b, b + 1);
  }
  geometry.setAttribute("position", position);
  geometry.setAttribute("normal", normal);
  geometry.setAttribute("uv", uv);
  geometry.setIndex(index);
  return geometry;
}

export function buildCanthusRecess(side, socketMaterial) {
  const geometry = new THREE.BufferGeometry(), stride = RECESS_RINGS + 1;
  geometry.setAttribute("position", new THREE.BufferAttribute(
    new Float32Array((RECESS_SLICES + 1) * stride * 3), 3,
  ));
  const indices = [];
  for (let slice = 0; slice < RECESS_SLICES; slice++) for (let ring = 0; ring < RECESS_RINGS; ring++) {
    const a = slice * stride + ring, b = a + stride;
    indices.push(a, b, a + 1, a + 1, b, b + 1);
  }
  geometry.setIndex(indices);
  const mesh = new THREE.Mesh(geometry, socketMaterial);
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  return { mesh, side };
}

export function writeCanthusRecess({ mesh, side }, blink, lowerLid) {
  const position = mesh.geometry.getAttribute("position");
  for (let slice = 0; slice <= RECESS_SLICES; slice++) {
    const fraction = slice / RECESS_SLICES;
    for (let ring = 0; ring <= RECESS_RINGS; ring++) {
      position.setXYZ(slice * (RECESS_RINGS + 1) + ring,
        ...canthusRecessPoint(side, fraction, ring / RECESS_RINGS, blink, lowerLid));
    }
  }
  position.needsUpdate = true;
}

function buildLashes(upper) {
  const count = upper ? 75 : 31;
  const vertices = count * (LASH_STEPS + 1) * LASH_SIDES;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(vertices * 3), 3));
  const indices = [];
  for (let hair = 0; hair < count; hair++) for (let step = 0; step < LASH_STEPS; step++) {
    const base = hair * (LASH_STEPS + 1) * LASH_SIDES + step * LASH_SIDES;
    for (let side = 0; side < LASH_SIDES; side++) {
      const next = (side + 1) % LASH_SIDES;
      indices.push(base + side, base + next, base + LASH_SIDES + side,
        base + next, base + LASH_SIDES + next, base + LASH_SIDES + side);
    }
  }
  geometry.setIndex(indices);
  geometry.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(vertices * 3), 3));
  const material = new THREE.MeshStandardMaterial({
    color: 0x271b20, roughness: 0.82, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 8;
  return { mesh, count, upper };
}

function writeLashes(item, blink, lowerLid) {
  const { count, upper, mesh } = item;
  const positions = mesh.geometry.attributes.position;
  for (let hair = 0; hair < count; hair++) {
    const fraction = (hair + 0.5 + 0.14 * Math.sin(hair * 9.23)) / count;
    const variation = 0.88 + 0.24 * Math.sin(hair * 15.1) ** 2;
    for (let step = 0; step <= LASH_STEPS; step++) {
      const t = step / LASH_STEPS;
      const [px, py, pz] = lashPoint(fraction, t, upper, blink, lowerLid, variation);
      const width = 0.006 * (1 - t) + 0.00025;
      for (let side = 0; side < LASH_SIDES; side++) {
        const angle = side * Math.PI * 2 / LASH_SIDES;
        const index = (hair * (LASH_STEPS + 1) * LASH_SIDES + step * LASH_SIDES + side);
        positions.setXYZ(index, px + width * Math.cos(angle), py, pz + width * Math.sin(angle));
      }
    }
  }
  positions.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
}

function createVeins() {
  const points = [], index = [];
  let seed = 0x902a4b;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  // Surface vessels stop before the limbus; no veins are painted on the cornea.
  for (let vessel = 0; vessel < 36; vessel++) {
    const angle = (vessel + random() * 0.55) * Math.PI * 2 / 36;
    const reach = 0.51 + random() * 0.17, segments = 8;
    for (let step = 0; step <= segments; step++) {
      const t = step / segments, r = mix(0.96, reach, t);
      const sway = Math.sin(t * 9 + vessel * 5.3) * 0.016 * t + (random() - 0.5) * 0.008;
      const x = r * Math.cos(angle + sway), y = r * Math.sin(angle + sway);
      // Veins follow the unsquashed globe, 0.008 units above the sclera.
      const z = Math.sqrt(Math.max(0, 1 - x * x - y * y)) + 0.008;
      points.push(x, y, z);
      if (step) index.push(vessel * (segments + 1) + step - 1, vessel * (segments + 1) + step);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  geometry.setIndex(index);
  const material = new THREE.LineBasicMaterial({
    color: 0xae627b, transparent: true, opacity: 0.3, depthWrite: false,
  });
  return new THREE.LineSegments(geometry, material);
}

/** Deform the *loaded* globe, iris and overlaid details without changing the
 * licensed model on disk or its texture UVs. Cache bind coordinates in globe
 * space once; every frame reconstructs from those, so moving the contact
 * cannot accumulate drift and a released eye restores its exact normals. */
export function createOculoidPokeDeformer(mesh, globe) {
  globe.updateMatrixWorld(true);
  const localToGlobe = new THREE.Matrix4().copy(globe.matrixWorld).invert().multiply(mesh.matrixWorld);
  const globeToLocal = localToGlobe.clone().invert();
  const geometry = mesh.geometry, position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const base = new Float32Array(position.count * 3);
  const eyePoints = new Float32Array(base.length);
  const baseNormals = normal ? new Float32Array(normal.array) : null;
  const strength = normal ? new Float32Array(position.count) : null;
  const vertex = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    const j = i * 3;
    base[j] = position.getX(i); base[j + 1] = position.getY(i); base[j + 2] = position.getZ(i);
    vertex.set(base[j], base[j + 1], base[j + 2]).applyMatrix4(localToGlobe);
    eyePoints[j] = vertex.x; eyePoints[j + 1] = vertex.y; eyePoints[j + 2] = vertex.z;
  }
  let active = false, lastDepth = 0, lastContact = null, lastDiameter = 0;
  return {
    update(contact, depth, { diameter = OCULOID_SURFACE_DEFAULTS.pokeDiameter,
      stretch = null } = {}) {
      const { x: sx, y: sy } = boundedOculoidStretch(stretch?.x, stretch?.y);
      const stretching = Boolean(stretch?.contact) && Math.hypot(sx, sy) >= 0.0001;
      if (Math.abs(depth) < 0.0001 && !stretching) {
        if (!active) return;
        position.array.set(base);
        position.needsUpdate = true;
        if (normal && baseNormals) {
          normal.array.set(baseNormals);
          normal.needsUpdate = true;
        }
        active = false;
        return;
      }
      if (active && !stretching && depth === lastDepth
        && lastContact === contact && lastDiameter === diameter) return;
      const direction = oculoidPokeContact(contact);
      const stretchAmount = Math.hypot(sx, sy);
      for (let i = 0; i < position.count; i++) {
        const j = i * 3;
        const x = eyePoints[j], y = eyePoints[j + 1], z = eyePoints[j + 2];
        const delta = oculoidPokeDisplacement(x, y, z, direction, depth, diameter);
        const pull = stretching ? oculoidStretchWeight(x, y, z, stretch.contact) : 0;
        if (strength) strength[i] = Math.min(1,
          (Math.abs(delta) + stretchAmount * pull) / 0.012);
        vertex.set(x + direction.x * delta + sx * pull,
          y + direction.y * delta + sy * pull,
          z + direction.z * delta + 0.14 * stretchAmount * pull)
          .applyMatrix4(globeToLocal);
        position.setXYZ(i, vertex.x, vertex.y, vertex.z);
      }
      position.needsUpdate = true;
      if (mesh.isMesh && !mesh.material.isMeshBasicMaterial && normal) {
        geometry.computeVertexNormals();
        // The imported globe has hand-authored vertex normals. Recalculating
        // all of them changes its entire highlight; only replace normals in
        // the dent, tapering back to the exact source outside its footprint.
        for (let i = 0; i < position.count; i++) {
          const j = i * 3, amount = strength[i];
          if (amount === 0) {
            normal.setXYZ(i, baseNormals[j], baseNormals[j + 1], baseNormals[j + 2]);
          } else if (amount < 1) {
            vertex.set(baseNormals[j] * (1 - amount) + normal.getX(i) * amount,
              baseNormals[j + 1] * (1 - amount) + normal.getY(i) * amount,
              baseNormals[j + 2] * (1 - amount) + normal.getZ(i) * amount).normalize();
            normal.setXYZ(i, vertex.x, vertex.y, vertex.z);
          }
        }
        normal.needsUpdate = true;
      }
      active = true;
      lastDepth = depth;
      lastContact = contact;
      lastDiameter = diameter;
    },
  };
}

function disposeObject(object, extraMaterials = []) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  const disposeMaterial = mat => {
    if (!mat || materials.has(mat)) return;
    materials.add(mat);
    for (const value of Object.values(mat)) {
      if (value?.isTexture && !textures.has(value)) {
        textures.add(value);
        value.dispose();
      }
    }
    mat.dispose();
  };
  object.traverse(item => {
    if (item.geometry && !geometries.has(item.geometry)) {
      geometries.add(item.geometry);
      item.geometry.dispose();
    }
    for (const mat of Array.isArray(item.material) ? item.material : item.material ? [item.material] : [])
      disposeMaterial(mat);
  });
  for (const mat of extraMaterials) disposeMaterial(mat);
}

export function createOculoidViewer(canvas, { onStatus = () => {} } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "low-power" });
  const gl = renderer.getContext(), rendererInfo = gl.getExtension("WEBGL_debug_renderer_info");
  const rendererName = gl.getParameter(rendererInfo?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER);
  // Software WebGL rasterizes every lit pixel on the CPU. Preserve the full
  // detailed model when still, but keep moving frames cheap enough for input
  // and the independent AudioWorklet clock to remain responsive.
  const softwareRendering = /swiftshader|llvmpipe|softpipe|software rasterizer/i.test(rendererName);
  renderer.setClearColor(0x000000);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.29;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(36, 1, 0.01, 30);
  scene.add(new THREE.HemisphereLight(0xf2f0ed, 0x423939, 2.2));
  const key = new THREE.DirectionalLight(0xffeee3, 2.05);
  key.position.set(-3, 4, 6); scene.add(key);
  // A real projected studio light: the cookie falls on the whole eye and
  // follows K on the light pad. It is off (and has no texture) by default.
  const patternedKey = new THREE.SpotLight(0xffeee3, 9, 0, 0.4, 0.4, 0);
  patternedKey.visible = false;
  scene.add(patternedKey, patternedKey.target);
  const lightGobos = new Map();
  const fill = new THREE.DirectionalLight(0xe9e6e2, 1.5);
  fill.position.set(4, -2, 3); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xf1ebe8, 1.8);
  rim.position.set(-2, 3, -4); scene.add(rim);
  // Unlike the orbiting studio lights, this small movable beam responds to
  // where the performer shines it. No shadows or extra render pass.
  const flashlight = new THREE.SpotLight(0xffebce, 7, 0, 0.12, 0.86, 0);
  flashlight.visible = false;
  scene.add(flashlight, flashlight.target);

  // A separate pivot turns the entire surround for inspection. Gaze still
  // rotates only the globe inside its socket; the lights and camera stay put.
  const assembly = new THREE.Group(), eye = new THREE.Group(), globe = new THREE.Group();
  const lidCover = new THREE.Group();
  scene.add(assembly);
  eye.scale.z = GLOBE_SQUASH;
  assembly.add(eye, lidCover); eye.add(globe);
  const scleralVeins = createVeins();
  globe.add(scleralVeins);
  const iris = new THREE.Group();
  globe.add(iris);
  const pupil = new THREE.Mesh(new THREE.CircleGeometry(1, 64),
    new THREE.MeshBasicMaterial({ color: 0x08080d, side: THREE.DoubleSide, depthWrite: false }));
  pupil.renderOrder = 3;
  iris.add(pupil);
  const limbus = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.012, 6, 96),
    new THREE.MeshStandardMaterial({ color: 0x192225, roughness: 0.62, transparent: true, opacity: 0.55 }));
  iris.add(limbus);
  const fibers = [];
  for (let i = 0; i < 110; i++) {
    const a = i * Math.PI * 2 / 110, outer = 0.36 + Math.sin(i * 4.6) * 0.038;
    fibers.push(Math.cos(a) * 0.21, Math.sin(a) * 0.21, 0.008 / GLOBE_SQUASH,
      Math.cos(a + 0.028) * outer, Math.sin(a + 0.028) * outer, 0.008 / GLOBE_SQUASH);
  }
  const fiberGeometry = new THREE.BufferGeometry();
  fiberGeometry.setAttribute("position", new THREE.Float32BufferAttribute(fibers, 3));
  const fiberMesh = new THREE.LineSegments(fiberGeometry, new THREE.LineBasicMaterial({
    color: 0xa7a995, transparent: true, opacity: 0.2, depthWrite: false,
  }));
  iris.add(fiberMesh);
  let source = null, irisMaterial = null, globeMaterial = null, pupilBaseZ = 0.73;
  let globeMesh = null, irisMesh = null, pokeDeformers = [];
  let originalIrisMap = null, tintedIrisMap = null, originalIrisPixels = null, tintedContext = null;
  let irisColorId = OCULOID_APPEARANCE_DEFAULTS.irisColor;
  let irisPatternId = OCULOID_APPEARANCE_DEFAULTS.irisPattern;
  let irisHex = `#${OCULOID_IRIS_COLORS.find(item => item.id === irisColorId).swatch.toString(16).padStart(6, "0")}`;
  let scleraColorId = OCULOID_APPEARANCE_DEFAULTS.scleraColor;
  let scleraPatternId = OCULOID_APPEARANCE_DEFAULTS.scleraPattern;
  let scleraHex = "#e2e6eb";
  let scleraPatternHex = OCULOID_APPEARANCE_DEFAULTS.scleraPatternColor;
  const globeUniforms = {
    ocGlobeTint: { value: new THREE.Color(scleraHex) },
    ocGlobePattern: { value: 0 },
    ocGlobePatternColor: { value: new THREE.Color(scleraPatternHex) },
  };
  let eyeLook = OCULOID_APPEARANCE_DEFAULTS.eyeLook;
  // Reuse the same loaded, deformable sphere in both appearances. Swapping
  // only its materials keeps gaze, whole-eye turns, raycasts and surface tools
  // in the same 3D rig as the sparse black loading eye.
  const inkGlobeMaterial = new THREE.MeshStandardMaterial({
    color: 0x07080a, emissive: 0x08080c, roughness: 0.95,
  });
  // The iris sits behind the imported cornea. Cut out only its projected
  // silhouette: a cornea-sized hole left a strip of black stage around the
  // iris, especially at the bottom with the lids removed. Object-space
  // coordinates keep the window on the eye through gaze and multi-eye turns.
  inkGlobeMaterial.onBeforeCompile = shader => {
    const varying = "varying vec3 vInkCorneaPosition;";
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${varying}`)
      .replace("#include <begin_vertex>",
        "#include <begin_vertex>\nvInkCorneaPosition = position;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${varying}`)
      .replace("#include <alphatest_fragment>", `#include <alphatest_fragment>
        if (vInkCorneaPosition.z > 0.75 &&
          dot(vInkCorneaPosition.xy, vInkCorneaPosition.xy) < 0.44 * 0.44) discard;`);
  };
  const inkIrisMaterial = new THREE.MeshStandardMaterial({
    color: 0x121215, emissive: 0x08080c, roughness: 0.92,
    side: THREE.DoubleSide,
  });
  function setEyeLook(value) {
    eyeLook = OCULOID_EYE_LOOKS.includes(value) ? value : OCULOID_APPEARANCE_DEFAULTS.eyeLook;
    for (const unit of eyeUnits) {
      if (unit.globeMesh) unit.globeMesh.material = eyeLook === "ink" ? inkGlobeMaterial : globeMaterial;
      if (unit.irisMesh) unit.irisMesh.material = eyeLook === "ink" ? inkIrisMaterial : irisMaterial;
    }
  }

  function setIrisColor(value, customColor) {
    const choice = OCULOID_IRIS_COLORS.find(item => item.id === value)
      ?? OCULOID_IRIS_COLORS.find(item => item.id === OCULOID_APPEARANCE_DEFAULTS.irisColor);
    irisColorId = value === "custom" ? "custom" : choice.id;
    irisHex = irisColorId === "custom"
      ? hexEyeColor(customColor, irisHex)
      : `#${choice.swatch.toString(16).padStart(6, "0")}`;
    if (!irisMaterial?.map) return;
    originalIrisMap ??= irisMaterial.map;
    if (irisColorId === "original" && irisPatternId === "natural") {
      if (irisMaterial.map !== originalIrisMap) {
        irisMaterial.map = originalIrisMap;
        irisMaterial.needsUpdate = true;
      }
      return;
    }
    if (!tintedIrisMap) {
      const image = originalIrisMap.image;
      if (!image?.width || !image?.height) return;
      const canvas = document.createElement("canvas");
      canvas.width = image.width; canvas.height = image.height;
      tintedContext = canvas.getContext("2d", { willReadFrequently: true });
      tintedContext.drawImage(image, 0, 0);
      originalIrisPixels = tintedContext.getImageData(0, 0, canvas.width, canvas.height).data;
      tintedIrisMap = new THREE.CanvasTexture(canvas);
      for (const property of ["flipY", "wrapS", "wrapT", "minFilter", "magFilter", "anisotropy", "colorSpace"]) {
        tintedIrisMap[property] = originalIrisMap[property];
      }
      tintedIrisMap.offset.copy(originalIrisMap.offset);
      tintedIrisMap.repeat.copy(originalIrisMap.repeat);
      tintedIrisMap.center.copy(originalIrisMap.center);
      tintedIrisMap.rotation = originalIrisMap.rotation;
    }
    const canvas = tintedIrisMap.image;
    const pixels = tintedContext.createImageData(canvas.width, canvas.height);
    pixels.data.set(colorizeIrisPixels(originalIrisPixels, Number.parseInt(irisHex.slice(1), 16),
      { width: canvas.width, atlas: true, pattern: irisPatternId }));
    tintedContext.putImageData(pixels, 0, 0);
    tintedIrisMap.needsUpdate = true;
    if (irisMaterial.map !== tintedIrisMap) {
      irisMaterial.map = tintedIrisMap;
      irisMaterial.needsUpdate = true;
    }
  }

  function setIrisPattern(value) {
    irisPatternId = OCULOID_IRIS_PATTERNS.includes(value)
      ? value : OCULOID_APPEARANCE_DEFAULTS.irisPattern;
    setIrisColor(irisColorId, irisHex);
  }

  function setScleraColor(value, customColor) {
    const choice = OCULOID_SCLERA_COLORS.find(item => item.id === value)
      ?? OCULOID_SCLERA_COLORS.find(item => item.id === OCULOID_APPEARANCE_DEFAULTS.scleraColor);
    scleraColorId = value === "custom" ? "custom" : choice.id;
    scleraHex = scleraColorId === "custom"
      ? hexEyeColor(customColor, scleraHex)
      : `#${choice.tint.toString(16).padStart(6, "0")}`;
    // The corneal window must not inherit the eyeball tint: it transmits
    // light to the separate iris and its independent recolored texture.
    globeUniforms.ocGlobeTint.value.set(scleraHex);
  }
  function setScleraPattern(value) {
    scleraPatternId = OCULOID_SCLERA_PATTERNS.includes(value)
      ? value : OCULOID_APPEARANCE_DEFAULTS.scleraPattern;
    globeUniforms.ocGlobePattern.value = SPHERE_PATTERN_MODES[scleraPatternId];
  }
  function setScleraPatternColor(value) {
    scleraPatternHex = hexEyeColor(value, OCULOID_APPEARANCE_DEFAULTS.scleraPatternColor);
    globeUniforms.ocGlobePatternColor.value.set(scleraPatternHex);
  }

  const skinTexture = createSkinTexture();
  const studioReflection = createStudioReflection();
  const skinMaterial = new THREE.MeshPhysicalMaterial({
    // One material for both front patches and the matched back hemisphere.
    // The studio map only touches the skin; the eyeball is unchanged.
    color: 0x704b33, roughness: 0.99, metalness: 0,
    bumpMap: skinTexture, bumpScale: 0.001,
    envMap: studioReflection,
    side: THREE.FrontSide,
  });
  const backSkinMaterial = skinMaterial.clone();
  const rimMaterial = skinMaterial.clone();
  rimMaterial.side = THREE.DoubleSide;
  const liningMaterial = rimMaterial.clone();
  const skinMaterials = { front: skinMaterial, back: backSkinMaterial, rim: rimMaterial, lining: liningMaterial };
  const skinUniforms = { ocSkinPattern: { value: 0 }, ocSkinSurface: { value: 0 } };
  for (const material of Object.values(skinMaterials)) {
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, skinUniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vOcSkin;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvOcSkin = position;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>
          varying vec3 vOcSkin;
          uniform float ocSkinPattern;
          uniform float ocSkinSurface;
          ${SPHERE_PATTERN_GLSL}`)
        .replace("#include <color_fragment>", `#include <color_fragment>
          diffuseColor.rgb *= 1.0 - 0.82 * ocSpherePattern(vOcSkin, ocSkinPattern);
          if (ocSkinSurface > 0.5) {
            float lumps = ocLumps(vOcSkin);
            diffuseColor.rgb *= ocSkinSurface > 1.5
              ? mix(0.58, 1.12, lumps) : mix(0.83, 1.13, lumps);
          }`)
        .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
          if (ocSkinSurface > 0.5)
            roughnessFactor = clamp(roughnessFactor * mix(0.7, 1.35, ocLumps(vOcSkin)), 0.18, 1.0);`);
    };
    material.customProgramCacheKey = () => "oculoid-sphere-shell-v1";
  }
  // The posterior shell has the same exterior finish, but is dark inside at every gaze
  // angle, including straight ahead. Depth testing hides the recess behind
  // the globe and shiny lid rims; it only shows through real socket gaps.
  const backGeometry = buildBackShellGeometry();
  const backShell = new THREE.Mesh(backGeometry, backSkinMaterial);
  const socketMaterial = new THREE.MeshBasicMaterial({
    color: 0x030306, toneMapped: false, side: THREE.BackSide,
  });
  const innerSocket = new THREE.Mesh(backGeometry, socketMaterial);
  backShell.renderOrder = innerSocket.renderOrder = -1;
  lidCover.add(backShell, innerSocket);
  // The opened front still has a spherical *interior* behind its eye. At an
  // oblique viewpoint the eye's smaller globe cannot fill the shell's entire
  // projected circumference; without this near-black liner, the side opening
  // vanishes into the black stage and makes the surround appear vertically
  // stretched. Draw the liner before the globe without writing depth so it
  // never paints over the sclera or creates a black frame along the lid lips.
  const socketLinerMaterial = socketMaterial.clone();
  socketLinerMaterial.side = THREE.FrontSide;
  socketLinerMaterial.color.setHex(0x131316);
  socketLinerMaterial.depthWrite = false;
  const socketLiner = new THREE.Mesh(
    new THREE.SphereGeometry(LID_SHELL_RADIUS - 0.012, 64, 48), socketLinerMaterial,
  );
  socketLiner.renderOrder = -0.5;
  lidCover.add(socketLiner);
  const upperSkin = buildSkinPatch(true, skinMaterial, liningMaterial, socketMaterial, rimMaterial);
  const lowerSkin = buildSkinPatch(false, skinMaterial, liningMaterial, socketMaterial, rimMaterial);
  const leftCap = buildLidSideCap(-1, skinMaterial, socketMaterial);
  const rightCap = buildLidSideCap(1, skinMaterial, socketMaterial);
  lidCover.add(leftCap.inside, rightCap.inside, upperSkin.inside, lowerSkin.inside,
    leftCap.mesh, rightCap.mesh, upperSkin.mesh, lowerSkin.mesh);
  const recessMaterial = socketMaterial.clone();
  recessMaterial.side = THREE.DoubleSide;
  const leftRecess = buildCanthusRecess(-1, recessMaterial);
  const rightRecess = buildCanthusRecess(1, recessMaterial);
  lidCover.add(leftRecess.mesh, rightRecess.mesh);
  const upperLashes = buildLashes(true), lowerLashes = buildLashes(false);
  lidCover.add(upperLashes.mesh, lowerLashes.mesh);
  const wardrobe = createOculoidWardrobe(lidCover, iris, rimMaterial,
    [upperSkin, lowerSkin], assembly, liningMaterial);
  let wardrobeState = OCULOID_WARDROBE_DEFAULTS;

  // One large drop grows from the canthus, then falls free.
  const drop = new THREE.Mesh(createFallbackTearGeometry(),
    new THREE.MeshPhysicalMaterial({
      color: 0xc3e0e7, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.07,
      transparent: true, opacity: 0.86, depthWrite: false,
    }));
  drop.renderOrder = 10;
  lidCover.add(drop);
  let detailedDrop = false, dropUnavailable = false;
  function alignTearToCamera() {
    bendTearAwayFromLid(drop.geometry, detailedDrop
      ? TEAR_TIP_HEIGHT / (0.2 * TEAR_DROP_SCALE) : 1,
    detailedDrop ? 0.15 * TEAR_DROP_SCALE : 0.08 * TEAR_DROP_SCALE,
    detailedDrop ? 0.2 * TEAR_DROP_SCALE : TEAR_TIP_HEIGHT,
    detailedDrop ? 0.192 * TEAR_DROP_SCALE : 0.09 * TEAR_DROP_SCALE,
    camera.aspect, camera.position.z);
  }

  const glintGroup = new THREE.Group();
  for (const [x, y, w, h, alpha] of [
    [-0.27, 0.27, 0.065, 0.1, 0.4], [0.19, 0.34, 0.036, 0.055, 0.65],
  ]) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: alpha, depthWrite: false }));
    mesh.scale.set(w, h, 0.008 / GLOBE_SQUASH);
    mesh.position.set(x, y, 0);
    glintGroup.add(mesh);
  }
  globe.add(glintGroup);

  // The full-size eye stays the original rig. Extra copies are made only if
  // requested, with independent geometry for physical dents and shared
  // textures/materials for recoloring without additional downloads.
  const eyeUnits = [{ globe, iris, pupil, globeMesh: null, irisMesh: null, deformers: [] }];
  let eyeCount = 1, ensembleStyle = "banter";
  function makeExtraEyes(requiredCount) {
    for (let index = eyeUnits.length; index < requiredCount; index++) {
      const copy = globe.clone(true);
      copy.traverse(item => { if (item.geometry) item.geometry = item.geometry.clone(); });
      const veins = copy.children[0], detail = copy.children[1], glints = copy.children[2];
      const face = copy.children[3];
      // A look switch may already have replaced both GLB materials with ink.
      // Mesh names, unlike materials, still identify the two loaded surfaces.
      const white = face.getObjectByName(globeMesh.name);
      const colored = face.getObjectByName(irisMesh.name);
      eye.add(copy);
      copy.updateMatrixWorld(true);
      const unit = {
        globe: copy, iris: detail, pupil: detail.children[0],
        globeMesh: white, irisMesh: colored,
        deformers: [white, colored, veins, detail.children[1], detail.children[2],
          ...glints.children].map(mesh => createOculoidPokeDeformer(mesh, copy)),
      };
      eyeUnits.push(unit);
      copy.visible = false;
    }
    setEyeLook(eyeLook);
  }
  function setEyeCount(count) {
    const next = OCULOID_EYE_COUNTS.includes(Number(count)) ? Number(count) : 1;
    if (next !== eyeCount) resetFlashlight();
    eyeCount = next;
    if (!modelLoaded) return;
    if (eyeCount > eyeUnits.length) {
      // If the previous gesture is still rebounding, clone the exact bind
      // mesh instead of copying a permanent dent into a new eyeball.
      for (const deformer of pokeDeformers) deformer.update(null, 0);
      makeExtraEyes(eyeCount);
    }
    eyeClusterLayout(eyeCount).forEach(({ x, y, z, scale }, index) => {
      const unit = eyeUnits[index];
      unit.globe.position.set(x, y, z);
      unit.globe.scale.setScalar(scale);
      unit.globe.visible = true;
    });
    for (let index = eyeCount; index < eyeUnits.length; index++) eyeUnits[index].globe.visible = false;
  }
  function setEyeEnsemble(style) { ensembleStyle = normalizeOculoidEnsemble(style); }

  let dead = false, width = 0, height = 0, lastBlink = -1, lastLowerLid = NaN, modelLoaded = false;
  let lastPose = null, lastFlashFrame = 0;
  const flashExposures = Array(OCULOID_EYE_COUNTS.at(-1)).fill(0);
  function setLidsHidden(hidden) {
    lidCover.visible = hidden !== true;
    wardrobe.set(wardrobeState, lidCover.visible);
  }
  function setWardrobe(value) {
    wardrobeState = value;
    wardrobe.set(wardrobeState, lidCover.visible);
  }
  function setLighting(value) {
    if (dead) return;
    const lights = normalizeOculoidLighting(value);
    setOculoidSkinFinish(skinMaterials, lights.finish, lights.keyBrightness,
      lights.color, lights.reflection);
    skinUniforms.ocSkinPattern.value = SPHERE_PATTERN_MODES[lights.pattern];
    skinUniforms.ocSkinSurface.value = lights.finish === "clumpy" ? 2
      : lights.finish === "gooey" ? 1 : 0;
    if (lights.lightPattern === "none") {
      patternedKey.visible = false;
      patternedKey.map = null;
    } else {
      if (!lightGobos.has(lights.lightPattern))
        lightGobos.set(lights.lightPattern, createLightGobo(lights.lightPattern));
      patternedKey.map = lightGobos.get(lights.lightPattern);
      patternedKey.visible = lights.keyBrightness > 0;
    }
    key.intensity = 2.05 * lights.keyBrightness * (lights.lightPattern === "none" ? 1 : 0.55);
    key.position.set(...oculoidLightPosition(lights.keyAzimuth, lights.keyElevation));
    patternedKey.intensity = 9 * lights.keyBrightness;
    patternedKey.position.copy(key.position);
    fill.position.set(...oculoidLightPosition(lights.fillAzimuth, lights.fillElevation));
    // Rotate the *reflected* softboxes with the key, not the background or
    // globe. A direction change is cheap: no new PMREM or texture per drag.
    const pitch = (lights.keyElevation - OCULOID_LIGHT_DEFAULTS.keyElevation) * Math.PI / 180;
    const yaw = (lights.keyAzimuth - OCULOID_LIGHT_DEFAULTS.keyAzimuth) * Math.PI / 180;
    for (const material of Object.values(skinMaterials)) {
      material.envMapRotation.set(pitch, yaw, 0, "YXZ");
    }
  }
  setLighting(OCULOID_LIGHT_DEFAULTS);
  const updateSkin = (blink, lowerLid) => {
    if (Math.abs(lastBlink - blink) < 0.0001 && Math.abs(lastLowerLid - lowerLid) < 0.0001) return;
    lastBlink = blink;
    lastLowerLid = lowerLid;
    writeSkinPatch(upperSkin, blink, lowerLid);
    writeSkinPatch(lowerSkin, blink, lowerLid);
    writeCanthusRecess(leftRecess, blink, lowerLid);
    writeCanthusRecess(rightRecess, blink, lowerLid);
    writeLashes(upperLashes, blink, lowerLid);
    writeLashes(lowerLashes, blink, lowerLid);
  };
  updateSkin(0.04, 0);

  function updateTears(blink, lowerLid, wetness, tear) {
    const { x, y, z, size } = tearDropPose(blink, lowerLid, wetness,
      tear?.beat ?? 0, tear?.active === true, camera.aspect, camera.position.z);
    drop.visible = lidCover.visible && size > 0.001;
    if (!drop.visible) return;
    drop.position.set(x, y, z);
    if (detailedDrop) {
      // The GLB's +Z tip rotates to +Y. Scale both meshes alike so that tip
      // stays at the exterior anchor as the bulb grows and falls.
      drop.scale.set(0.15 * TEAR_DROP_SCALE * size, 0.2 * TEAR_DROP_SCALE * size,
        0.192 * TEAR_DROP_SCALE * size);
    } else {
      // Continue crying even if the optional model has not loaded yet.
      drop.scale.set(0.08 * TEAR_DROP_SCALE * size, TEAR_TIP_HEIGHT * size,
        0.09 * TEAR_DROP_SCALE * size);
    }
  }

  const loader = new GLTFLoader();
  const eyeRequest = new AbortController();
  const reportReady = () => onStatus({
    state: "ready",
    message: dropUnavailable ? "Using a procedural tear fallback." : "",
  });
  loader.load(DROP_URL.href, gltf => {
    if (dead) { disposeObject(gltf.scene); return; }
    const mesh = gltf.scene.getObjectByName("Drops_Drops_0");
    if (!mesh?.isMesh || mesh.geometry.getAttribute("position")?.count !== 526) {
      disposeObject(gltf.scene);
      dropUnavailable = true;
      if (modelLoaded) reportReady();
      return;
    }
    const geometry = mesh.geometry.clone();
    geometry.rotateX(-Math.PI / 2);
    disposeObject(gltf.scene);
    drop.geometry.dispose();
    drop.geometry = geometry;
    detailedDrop = true;
    alignTearToCamera();
    if (lastPose) draw(lastPose.pose, lastPose.config, lastPose.beat, lastPose.moving,
      lastPose.poke, lastPose.flash, lastPose.surface, lastPose.tear);
  }, undefined, () => {
    if (dead) return;
    dropUnavailable = true;
    if (modelLoaded) reportReady();
  });
  fetch(GLASSES_URL.href, { signal: eyeRequest.signal })
    .then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.arrayBuffer();
    })
    .then(data => {
      if (dead) return;
      loader.parse(data, new URL(".", GLASSES_URL).href, gltf => {
        if (dead || !wardrobe.setSunglassModel(gltf.scene)) {
          disposeObject(gltf.scene);
          return;
        }
        if (lastPose) draw(lastPose.pose, lastPose.config, lastPose.beat, lastPose.moving,
          lastPose.poke, lastPose.flash, lastPose.surface, lastPose.tear);
      }, () => {}); // The authored fallback frames still work without this optional asset.
    })
    .catch(() => {});
  const acceptEye = gltf => {
    if (dead) { disposeObject(gltf.scene); return; }
    source = gltf.scene;
    source.updateMatrixWorld(true);
    source.traverse(item => {
      if (!item.isMesh) return;
      if (item.material?.name === "Iris") irisMesh = item;
      else globeMesh = item;
    });
    if (!globeMesh || !irisMesh) {
      disposeObject(source); source = null;
      onStatus({ state: "error", message: "Eye model is missing its separate globe or iris." });
      return;
    }
    const world = new THREE.Box3().setFromObject(globeMesh);
    const center = world.getCenter(new THREE.Vector3());
    const irisCenter = new THREE.Box3().setFromObject(irisMesh).getCenter(new THREE.Vector3());
    const direction = irisCenter.clone().sub(center).normalize();
    const radius = world.getSize(new THREE.Vector3()).x / 2;
    const faceTurn = new THREE.Group();
    source.position.sub(center);
    faceTurn.quaternion.setFromUnitVectors(direction, new THREE.Vector3(0, 0, 1));
    faceTurn.scale.setScalar(1 / radius);
    faceTurn.add(source);
    globe.add(faceTurn);
    pupilBaseZ = irisCenter.distanceTo(center) / radius * GLOBE_SQUASH + 0.065;
    iris.position.z = pupilBaseZ / GLOBE_SQUASH;
    glintGroup.position.z = (pupilBaseZ + 0.024) / GLOBE_SQUASH;
    globe.updateMatrixWorld(true);
    pokeDeformers = [globeMesh, irisMesh, scleralVeins, limbus, fiberMesh,
      ...glintGroup.children].map(mesh => createOculoidPokeDeformer(mesh, globe));
    Object.assign(eyeUnits[0], { globeMesh, irisMesh, deformers: pokeDeformers });
    irisMaterial = irisMesh.material;
    globeMaterial = globeMesh.material;
    // Keep the iris atlas independently owned for color/pattern changes and
    // disposal without affecting the globe's shared source texture.
    if (irisMaterial.map && irisMaterial.map === globeMaterial.map) {
      irisMaterial.map = irisMaterial.map.clone();
      irisMaterial.needsUpdate = true;
    }
    const position = globeMesh.geometry.getAttribute("position");
    const toGlobe = new THREE.Matrix4().copy(globe.matrixWorld).invert().multiply(globeMesh.matrixWorld);
    const vertex = new THREE.Vector3();
    const globePatternPositions = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      vertex.fromBufferAttribute(position, i).applyMatrix4(toGlobe).normalize();
      globePatternPositions.set(vertex.toArray(), i * 3);
    }
    bindEyeballPatternCoordinates(globeMesh.geometry, globePatternPositions);
    globeMaterial.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, globeUniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>
          attribute vec3 oculoidSphere;
          attribute vec3 oculoidOriginal;
          varying vec3 vOcSphere;
          varying vec3 vOcOriginal;`)
        .replace("#include <begin_vertex>", `#include <begin_vertex>
          vOcSphere = oculoidSphere;
          vOcOriginal = oculoidOriginal;`);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>
          varying vec3 vOcSphere;
          varying vec3 vOcOriginal;
          uniform vec3 ocGlobeTint;
          uniform vec3 ocGlobePatternColor;
          uniform float ocGlobePattern;
          ${SPHERE_PATTERN_GLSL}`)
        .replace("#include <color_fragment>", `#include <color_fragment>
          // Leave the iris untouched, but feather the tint into the sclera
          // instead of drawing a darker circular boundary on the eye.
          float cornea = smoothstep(0.60, 0.84, vOcOriginal.z)
            * (1.0 - smoothstep(0.43, 0.62, length(vOcOriginal.xy)));
          float mark = ocSpherePattern(vOcSphere, ocGlobePattern);
          float textureLight = dot(diffuseColor.rgb, vec3(0.21, 0.72, 0.07));
          vec3 patterned = mix(diffuseColor.rgb * ocGlobeTint,
            ocGlobePatternColor * (0.68 + 0.3 * textureLight), mark * 0.94);
          diffuseColor.rgb = mix(patterned, diffuseColor.rgb, cornea);`);
    };
    globeMaterial.customProgramCacheKey = () => "oculoid-independent-globe-v1";
    globeMaterial.needsUpdate = true;
    setScleraPattern(scleraPatternId);
    setIrisColor(irisColorId, irisHex);
    setScleraColor(scleraColorId, scleraHex);
    setScleraPatternColor(scleraPatternHex);
    setEyeLook(eyeLook);
    modelLoaded = true;
    setEyeCount(eyeCount);
    reportReady();
    if (lastPose) draw(lastPose.pose, lastPose.config, lastPose.beat, lastPose.moving,
      lastPose.poke, lastPose.flash, lastPose.surface, lastPose.tear);
  };
  const reportEyeError = error => {
    if (!dead) onStatus({ state: "error",
      message: `The 3D model could not load: ${error?.message || "unknown error"}.` });
  };
  // FileLoader wraps its streaming fetch in a second Response. Chromium can
  // flag the 2.7 MB source request as aborted even after GLTFLoader parsed the
  // whole eye. Read the actual response to completion before parsing instead.
  fetch(EYE_URL.href, { signal: eyeRequest.signal })
    .then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.arrayBuffer();
    })
    .then(data => {
      if (!dead) loader.parse(data, new URL(".", EYE_URL).href, acceptEye, reportEyeError);
    })
    .catch(reportEyeError);

  let lastPixelRatio = 0, lastFrameRadius = 0, pixelBudget = 1200000;
  function resize(mode) {
    if (dead) return;
    const bounds = canvas.getBoundingClientRect();
    const w = Math.max(1, bounds.width), h = Math.max(1, bounds.height);
    // A full-resolution still eye keeps its detail. Manual surface animation
    // uses a middle budget so repeated raycasts, mesh deformation and WebGL
    // draws do not stall touch or audio on a software renderer. Picking must
    // retain the current budget rather than resizing the framebuffer on every
    // pointermove, alternating between full and interactive resolutions.
    if (mode !== undefined) pixelBudget = mode === "motion"
      ? (softwareRendering ? 24000 : 500000)
      : mode === "surface" ? (softwareRendering ? 85000 : 600000) : 1200000;
    const pixelRatio = Math.min(1.7, window.devicePixelRatio || 1,
      Math.sqrt(pixelBudget / (w * h)));
    const frameRadius = wardrobe.frameRadius(), previousFrameRadius = lastFrameRadius;
    if (Math.abs(w - width) < 0.5 && Math.abs(h - height) < 0.5
      && Math.abs(pixelRatio - lastPixelRatio) < 0.001
      && frameRadius === lastFrameRadius) return;
    width = w; height = h;
    lastPixelRatio = pixelRatio;
    lastFrameRadius = frameRadius;
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(w, h, false);
    const previousAspect = camera.aspect;
    camera.aspect = w / h;
    camera.position.set(0, 0, lidCameraDistance(camera.aspect, camera.fov)
      * frameRadius / LID_SHELL_RADIUS);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    if (Math.abs(previousAspect - camera.aspect) > 0.0001
      || frameRadius !== previousFrameRadius) alignTearToCamera();
  }

  function stagePoint(event) {
    const rect = canvas.getBoundingClientRect();
    const nx = (event.clientX - rect.left) * 2 / Math.max(1, rect.width) - 1;
    const ny = 1 - (event.clientY - rect.top) * 2 / Math.max(1, rect.height);
    const span = Math.tan(camera.fov * Math.PI / 360) * (camera.position.z - 1.02);
    return { x: nx * span * camera.aspect, y: ny * span };
  }

  function setTurn(yaw, pitch) {
    const bounded = boundedEyeTurn(yaw, pitch);
    // YXZ keeps the globe's forward axis within the front hemisphere even
    // when both independent turns reach their ±90° limits.
    assembly.rotation.set(-bounded.pitch * Math.PI / 180,
      bounded.yaw * Math.PI / 180, 0, "YXZ");
  }

  function surfacePoint(event) {
    resize();
    camera.updateMatrixWorld();
    assembly.updateMatrixWorld(true);
    const rect = canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      (event.clientX - rect.left) * 2 / Math.max(1, rect.width) - 1,
      1 - (event.clientY - rect.top) * 2 / Math.max(1, rect.height),
    );
    const picker = new THREE.Raycaster();
    picker.setFromCamera(pointer, camera);
    if (!lidCover.visible && eyeCount > 1 && modelLoaded) {
      // Without a sheath, the gaps between small globes really are empty
      // stage: dragging there should turn the cluster, not steer its gaze.
      const targets = eyeUnits.slice(0, eyeCount).flatMap(unit => [unit.globeMesh, unit.irisMesh]);
      const hit = picker.intersectObjects(targets, false)[0];
      if (!hit) return null;
      const point = assembly.worldToLocal(hit.point.clone());
      return { x: point.x, y: point.y, z: point.z };
    }
    // Pick the rotated spherical skin, not a fixed screen-space circle.
    // Its center opening also counts as "on the eye" for iris drags.
    const ray = picker.ray.clone().applyMatrix4(assembly.matrixWorld.clone().invert());
    const { origin: o, direction: d } = ray;
    const a = d.lengthSq();
    const b = 2 * o.dot(d);
    const radius = lidCover.visible ? LID_SHELL_RADIUS : GLOBE_HULL_RADIUS;
    const c = o.lengthSq() - radius ** 2;
    const discriminant = b ** 2 - 4 * a * c;
    if (discriminant < 0) return null;
    const distance = (-b - Math.sqrt(discriminant)) / (2 * a);
    if (distance < 0) return null;
    const hit = ray.at(distance, new THREE.Vector3());
    return { x: hit.x, y: hit.y, z: hit.z };
  }

  function pokePoint(event, irisOnly = false) {
    if (!modelLoaded || !globeMesh || !irisMesh) return null;
    resize();
    camera.updateMatrixWorld();
    assembly.updateMatrixWorld(true);
    const rect = canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      (event.clientX - rect.left) * 2 / Math.max(1, rect.width) - 1,
      1 - (event.clientY - rect.top) * 2 / Math.max(1, rect.height),
    );
    const picker = new THREE.Raycaster();
    picker.setFromCamera(pointer, camera);
    // A near eyelid or cap wins the depth test: never poke *through* chrome
    // or across the black socket, even with gaze/whole-eye turns applied.
    const blockers = lidCover.visible
      ? [upperSkin.mesh, lowerSkin.mesh, leftCap.mesh, rightCap.mesh, ...wardrobe.occluders()] : [];
    const targets = eyeUnits.slice(0, eyeCount).flatMap(unit => [unit.globeMesh, unit.irisMesh]);
    const hit = picker.intersectObjects([...blockers, ...targets], false)[0];
    const index = eyeUnits.slice(0, eyeCount).findIndex(unit =>
      hit?.object === unit.globeMesh || hit?.object === unit.irisMesh);
    if (index < 0) return null;
    const point = eyeUnits[index].globe.worldToLocal(hit.point.clone());
    if (point.z <= 0.03) return null;
    const contact = oculoidPokeContact(point);
    // Part of the licensed iris atlas sits on the globe polygon, rather
    // than always exposing a separate iris triangle to the raycaster.
    // The nearest lid has already won the depth test above.
    return irisOnly && Math.hypot(contact.x, contact.y) > 0.47
      ? null : { ...contact, eyeIndex: index };
  }

  function projectContact(contact, eyeIndex = 0) {
    camera.updateMatrixWorld();
    assembly.updateMatrixWorld(true);
    const unit = eyeUnits[Math.min(eyeCount - 1, Math.max(0, eyeIndex))];
    const point = unit.globe.localToWorld(new THREE.Vector3(contact.x, contact.y, contact.z)
      .multiplyScalar(1.073)).project(camera);
    return { x: 50 + point.x * 50, y: 50 - point.y * 50, visible: point.z < 1 };
  }

  function shine(flash = null) {
    const power = clampEye(flash?.power, 0, 1, 0), active = flash?.active === true && power > 0;
    flashlight.visible = active;
    const targetsByEye = Array(eyeCount).fill(0);
    if (active) {
      const diameter = clampEye(flash?.diameter, ...OCULOID_SURFACE_RANGES.flashDiameter,
        OCULOID_SURFACE_DEFAULTS.flashDiameter);
      camera.updateMatrixWorld();
      assembly.updateMatrixWorld(true);
      const picker = new THREE.Raycaster();
      const aimX = clampEye(flash?.x, -1, 1, 0), aimY = clampEye(flash?.y, -1, 1, 0);
      const targets = [
        ...(lidCover.visible
          ? [upperSkin.mesh, lowerSkin.mesh, leftCap.mesh, rightCap.mesh, ...wardrobe.occluders()] : []),
        ...(modelLoaded ? eyeUnits.slice(0, eyeCount)
          .flatMap(unit => [unit.globeMesh, unit.irisMesh]) : []),
      ];
      const hitAt = (x, y) => {
        picker.setFromCamera(new THREE.Vector2(x, y), camera);
        return picker.intersectObjects(targets, false)[0];
      };
      const hit = hitAt(aimX, aimY);
      const aim = hit?.point ?? picker.ray.at(camera.position.z, new THREE.Vector3());
      flashlight.position.set(-0.36, 0.31, camera.position.z - 0.2);
      flashlight.target.position.copy(aim);
      flashlight.angle = Math.atan(diameter / Math.max(0.2, camera.position.z - 1));
      flashlight.intensity = 7 * power;
      const illuminate = (candidate, strength) => {
        const index = eyeUnits.slice(0, eyeCount).findIndex(unit =>
          candidate?.object === unit.globeMesh || candidate?.object === unit.irisMesh);
        if (index < 0) return;
        targetsByEye[index] = Math.max(targetsByEye[index],
          strength * oculoidFlashlightExposure(
            eyeUnits[index].globe.worldToLocal(candidate.point.clone())));
      };
      illuminate(hit, power);
      if (diameter > OCULOID_SURFACE_DEFAULTS.flashDiameter + 0.05 && modelLoaded) {
        // For a wide beam, an off-center *visible* patch of iris can respond.
        // Each sampled ray still stops at the first eyelid; the default small
        // beam keeps its original single-ray, budget-friendly behavior.
        const span = Math.tan(camera.fov * Math.PI / 360) * (camera.position.z - 1);
        const dx = 0.68 * diameter / (span * camera.aspect);
        const dy = 0.68 * diameter / span;
        for (const [x, y] of [[aimX + dx, aimY], [aimX - dx, aimY],
          [aimX, aimY + dy], [aimX, aimY - dy]]) {
          if (Math.abs(x) <= 1 && Math.abs(y) <= 1) {
            illuminate(hitAt(x, y), 0.86 * power);
          }
        }
      }
    }
    const now = performance.now();
    const dt = lastFlashFrame ? clampEye((now - lastFlashFrame) / 1000, 0, 0.12, 1 / 60) : 1 / 60;
    lastFlashFrame = now;
    let settling = false;
    for (let index = 0; index < eyeCount; index++) {
      flashExposures[index] += (targetsByEye[index] - flashExposures[index])
        * (1 - Math.exp(-dt / 0.11));
      if (Math.abs(targetsByEye[index] - flashExposures[index]) < 0.003)
        flashExposures[index] = targetsByEye[index];
      else settling = true;
    }
    return {
      exposure: Math.max(...flashExposures.slice(0, eyeCount)),
      exposures: flashExposures, settling,
    };
  }

  function resetFlashlight() {
    flashlight.visible = false;
    flashExposures.fill(0);
    lastFlashFrame = 0;
  }

  function draw(pose, config, beat = 0, moving = false, poke = null, flash = null,
    surface = null, tear = null) {
    if (dead) return;
    const depth = clampEye(poke?.depth, -0.12, 1.08, 0);
    const contact = oculoidPokeContact(poke?.contact);
    const activeSurface = Math.abs(depth) > 0.0001 || Math.abs(surface?.stretch?.x ?? 0) > 0.0001
      || Math.abs(surface?.stretch?.y ?? 0) > 0.0001;
    resize(moving ? "motion" : activeSurface ? "surface" : "still");
    lastPose = { pose, config, beat, moving, poke, flash, surface, tear };
    const blink = clampEye(pose?.blink, -1, 1);
    const lowerLid = clampEye(pose?.lowerLid, -1, 1, 0);
    // Deliberately superhuman: each iris can travel behind the fixed lids.
    const motionPlaying = surface?.motionPlaying ?? moving;
    const individual = eyeUnits.slice(0, eyeCount).map((unit, index) => {
      const own = eyeEnsemblePose(pose, config, beat, index, eyeCount,
        ensembleStyle, motionPlaying);
      unit.globe.rotation.set(-own.gazeY * 1.22, own.gazeX * 1.43, 0);
      return own;
    });
    if (lidCover.visible) updateSkin(blink, lowerLid);
    wardrobe.updatePose(blink, lowerLid, beat, motionPlaying);
    const light = shine(flash);
    const diameter = clampEye(poke?.diameter, ...OCULOID_SURFACE_RANGES.pokeDiameter,
      OCULOID_SURFACE_DEFAULTS.pokeDiameter);
    const stretch = surface?.stretch;
    const touched = Math.min(eyeCount - 1, Math.max(0, poke?.eyeIndex ?? surface?.eyeIndex ?? 0));
    eyeUnits.slice(0, eyeCount).forEach((unit, index) => {
      const pressed = index === touched;
      for (const deformer of unit.deformers) deformer.update(contact, pressed ? depth : 0,
        { diameter, stretch: pressed ? stretch : null });
      unit.pupil.scale.setScalar(0.038
        + oculoidLitPupil(individual[index].pupil, light.exposures[index]) * 0.25);
      unit.pupil.position.z = 0.014 / GLOBE_SQUASH
        + (pressed ? oculoidPokeDisplacement(0, 0, pupilBaseZ, contact, depth, diameter)
          + 0.14 * Math.hypot(stretch?.x ?? 0, stretch?.y ?? 0)
            * oculoidStretchWeight(0, 0, pupilBaseZ, stretch?.contact) : 0);
      unit.pupil.position.x = pressed ? (stretch?.x ?? 0)
        * oculoidStretchWeight(0, 0, pupilBaseZ, stretch?.contact) : 0;
      unit.pupil.position.y = pressed ? (stretch?.y ?? 0)
        * oculoidStretchWeight(0, 0, pupilBaseZ, stretch?.contact) : 0;
    });
    const tint = clampEye(config?.irisTint, 0, 1, 0.46);
    if (irisMaterial?.color) irisMaterial.color.setRGB(0.8 + tint * 0.18, 0.78 + tint * 0.18, 0.61 + tint * 0.38);
    if (eyeLook === "ink") {
      fiberMesh.material.color.setHex(0xaaa0ad);
      fiberMesh.material.opacity = 0.44;
      limbus.material.color.setHex(0x555967);
    } else {
      fiberMesh.material.color.setRGB(0.95 - tint * 0.52, 0.65 + tint * 0.29, 0.38 + tint * 0.5);
      fiberMesh.material.opacity = irisColorId === "black" && irisPatternId === "natural" ? 0 : 0.2;
      limbus.material.color.setHex(0x192225);
    }
    scleralVeins.material.opacity = 0.05 + clampEye(config?.veins, 0, 1) * 0.54;
    const wetness = clampEye(config?.wetness, 0, 1, 0.5);
    glintGroup.children.forEach((item, i) => {
      item.material.opacity = (i ? 0.45 : 0.29) * (0.35 + wetness * 0.65);
    });
    updateTears(blink, lowerLid, wetness, tear);
    renderer.render(scene, camera);
    return light;
  }

  function dispose() {
    if (dead) return;
    dead = true;
    eyeRequest.abort();
    // The inactive original or tinted map is not reachable through a mesh,
    // so dispose it explicitly before traversing the currently selected one.
    if (originalIrisMap && irisMaterial?.map !== originalIrisMap) originalIrisMap.dispose();
    if (tintedIrisMap && irisMaterial?.map !== tintedIrisMap) tintedIrisMap.dispose();
    for (const texture of lightGobos.values()) texture.dispose();
    disposeObject(scene, [globeMaterial, irisMaterial, inkGlobeMaterial, inkIrisMaterial,
      rimMaterial, wardrobe.lipstickMaterial]);
    renderer.dispose();
    renderer.forceContextLoss();
  }

  return { draw, resize, stagePoint, surfacePoint, pokePoint, projectContact, setTurn, setLighting,
    resetFlashlight, setLidsHidden, setWardrobe, setEyeCount, setEyeEnsemble,
    setEyeLook, setIrisColor, setIrisPattern, setScleraColor, setScleraPattern,
    setScleraPatternColor,
    dispose, softwareRendering,
    get loaded() { return modelLoaded; },
    get irisDepth() { return pupilBaseZ; } };
}
