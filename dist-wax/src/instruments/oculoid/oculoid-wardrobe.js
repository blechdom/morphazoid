import * as THREE from "../../../vendor/three/three.module.min.js";
import {
  clampEye, globeHullDepth, hexEyeColor, lashPoint, lidEdge, lidLipPoint,
  lidSurfaceDepth, LID_SHELL_RADIUS,
} from "./oculoid-model.js";

// These are visual performance props, not musical presets or added model assets.
export const OCULOID_WARDROBE_DEFAULTS = Object.freeze({
  sunglasses: false, groucho: false, cigar: false, mustache: false, coat: false, scarf: false,
  lipstick: false, teeth: false, tongue: false, lipstickColor: "#bb476c",
  hat: "none", hatSize: 1, catEars: false, humanEars: false,
  bowTie: false, bowTieColor: "#9c3457", tail: false,
  headband: false, hair: "none",
});
export const OCULOID_HATS = Object.freeze(["none", "top", "cowboy", "frosting", "cherry", "cat"]);
export const OCULOID_HAIRCUTS = Object.freeze(["none", "mullet", "mom-bob"]);

export function eyewearPose(blink, lowerLid, lidsVisible = true) {
  return [-0.31, 0.31].map(x => {
    // With lids, the frames ride above the upper margin even through a full
    // blink, but leave room for their bridge at the top of the canvas.
    // Without lids, rest them over the exposed globe instead of following
    // the hidden (fully retracted) margin into empty space.
    const y = lidsVisible
      ? Math.min(Math.sqrt(LID_SHELL_RADIUS ** 2 - x * x) - 0.06,
        lidEdge(x, true, blink, lowerLid) + 0.26)
      : 0.40;
    const depth = lidsVisible ? lidSurfaceDepth(x, y - 0.13) : globeHullDepth(x, y - 0.13);
    return { x, y, z: depth + (lidsVisible ? 0.10 : 0.13) };
  });
}

export function scarfPose(blink, lowerLid) {
  const y = clampEye(Math.min(-0.91, lidEdge(0, false, blink, lowerLid) - 0.16),
    -1.035, -0.91);
  return { y, radius: Math.sqrt(LID_SHELL_RADIUS ** 2 - y * y) + 0.10 };
}

function rod(start, end, radius, material) {
  const difference = new THREE.Vector3().subVectors(end, start);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 1, 10), material);
  mesh.position.copy(start).addScaledVector(difference, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), difference.clone().normalize());
  mesh.scale.y = difference.length();
  return mesh;
}

function span(mesh, start, end) {
  const difference = new THREE.Vector3().subVectors(end, start);
  mesh.position.copy(start).addScaledVector(difference, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), difference.clone().normalize());
  mesh.scale.y = difference.length();
}

const COAT_RADIUS = LID_SHELL_RADIUS + 0.08;
const COAT_TOP = 0.04, COAT_BOTTOM = -0.98;
const COAT_ROWS = 32, COAT_SLICES = 56, LAPEL_ROWS = 20, LAPEL_SLICES = 8;
const coatOpening = t => 0.56 + 0.33 * (1 - t) ** 2;
function coatPoint(t, phi, blink, lowerLid, offset = 0) {
  // Raise the shoulders at the sides/back but tuck the front neckline below
  // the lower lashes. It follows the moving bottom lid rather than cutting
  // across it when the wearer opens their "mouth".
  const front = clampEye((Math.cos(phi) - 0.12) / 0.48, 0, 1);
  const frontBlend = front * front * (3 - 2 * front);
  const neckline = clampEye(Math.min(-0.55,
    lidEdge(0.7, false, blink, lowerLid) - 0.385), -0.97, -0.55);
  const top = COAT_TOP + (neckline - COAT_TOP) * frontBlend;
  const y = top + (COAT_BOTTOM - top) * t;
  // A tiny flared hem, staggered pleats and woven highlights prevent the
  // garment from reading as a rigid, perfectly concentric brown cylinder.
  const radius = Math.sqrt(COAT_RADIUS ** 2 - y * y) + offset
    + 0.025 * t * t + 0.011 * t * Math.sin(9 * phi + 4 * t);
  return new THREE.Vector3(
    radius * Math.sin(phi), y, radius * Math.cos(phi),
  );
}

/** Two independent, draped cloth panels retain an open V and a split hem. */
function makeCoatShell(material) {
  const stride = COAT_SLICES + 1, half = (COAT_ROWS + 1) * stride;
  const positions = new Float32Array(half * 2 * 3), colors = new Float32Array(positions.length);
  const indices = [];
  for (const [index, side] of [-1, 1].entries()) {
    const offset = index * half;
    for (let row = 0; row <= COAT_ROWS; row++) {
      const t = row / COAT_ROWS;
      for (let slice = 0; slice <= COAT_SLICES; slice++) {
        const phi = side * (coatOpening(t) + (Math.PI - 0.22 - coatOpening(t))
          * slice / COAT_SLICES);
        const v = offset + row * stride + slice;
        const shading = 0.85 + 0.13 * Math.sin(12 * phi + 3 * t) ** 2;
        colors.set([shading, shading * 0.97, shading * 0.92], v * 3);
        if (row < COAT_ROWS && slice < COAT_SLICES) {
          const a = v, b = a + stride;
          indices.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "Coat shell with open lapels";
  mesh.frustumCulled = false;
  writeCoatShell(mesh, 0.04, 0);
  return mesh;
}

function writeCoatShell(mesh, blink, lowerLid) {
  const positions = mesh.geometry.getAttribute("position");
  const half = (COAT_ROWS + 1) * (COAT_SLICES + 1);
  for (const [index, side] of [-1, 1].entries()) for (let row = 0; row <= COAT_ROWS; row++) {
    const t = row / COAT_ROWS;
    for (let slice = 0; slice <= COAT_SLICES; slice++) {
      const phi = side * (coatOpening(t) + (Math.PI - 0.22 - coatOpening(t))
        * slice / COAT_SLICES);
      const point = coatPoint(t, phi, blink, lowerLid);
      positions.setXYZ(index * half + row * (COAT_SLICES + 1) + slice,
        point.x, point.y, point.z);
    }
  }
  positions.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
}

function makeCoatLapel(side, material) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(
    new Float32Array((LAPEL_ROWS + 1) * (LAPEL_SLICES + 1) * 3), 3));
  const indices = [];
  for (let row = 0; row < LAPEL_ROWS; row++) for (let col = 0; col < LAPEL_SLICES; col++) {
    const a = row * (LAPEL_SLICES + 1) + col, b = a + LAPEL_SLICES + 1;
    indices.push(a, b, a + 1, a + 1, b, b + 1);
  }
  geometry.setIndex(indices);
  const lapel = new THREE.Mesh(geometry, material);
  lapel.name = side < 0 ? "Left folded trench lapel" : "Right folded trench lapel";
  lapel.frustumCulled = false;
  writeCoatLapel(lapel, side, 0.04, 0);
  return lapel;
}

function writeCoatLapel(lapel, side, blink, lowerLid) {
  const positions = lapel.geometry.getAttribute("position");
  for (let row = 0; row <= LAPEL_ROWS; row++) {
    const t = row / LAPEL_ROWS * 0.68;
    const width = (0.08 + 0.17 * Math.sin(Math.PI * row / LAPEL_ROWS)) * (1 - 0.45 * t);
    for (let col = 0; col <= LAPEL_SLICES; col++) {
      const phi = side * (coatOpening(t) + 0.014 + width * col / LAPEL_SLICES);
      const point = coatPoint(t, phi, blink, lowerLid, 0.023);
      positions.setXYZ(row * (LAPEL_SLICES + 1) + col, point.x, point.y, point.z);
    }
  }
  positions.needsUpdate = true;
  lapel.geometry.computeVertexNormals();
}

function makeCoatSeam(side, sample, count, material) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  const line = new THREE.Line(geometry, material);
  line.name = "Tailored coat seam";
  line.frustumCulled = false;
  const update = (blink, lowerLid) => {
    const positions = geometry.getAttribute("position");
    for (let i = 0; i < count; i++) {
      const [t, phi] = sample(i / (count - 1));
      const point = coatPoint(t, side * phi, blink, lowerLid, 0.043);
      positions.setXYZ(i, point.x, point.y, point.z);
    }
    positions.needsUpdate = true;
  };
  update(0.04, 0);
  return { line, update };
}

const SCARF_ROWS = 8, SCARF_SLICES = 72;
function makeScarfWrap(material) {
  const geometry = new THREE.BufferGeometry(), stride = SCARF_SLICES + 1;
  const count = (SCARF_ROWS + 1) * stride, index = [];
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  for (let row = 0; row < SCARF_ROWS; row++) for (let slice = 0; slice < SCARF_SLICES; slice++) {
    const a = row * stride + slice, b = a + stride;
    index.push(a, b, a + 1, a + 1, b, b + 1);
  }
  geometry.setIndex(index);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "Woven scarf wrapped around the neck";
  mesh.frustumCulled = false;
  return mesh;
}

function writeScarfWrap(mesh, pose, overCoat) {
  const position = mesh.geometry.getAttribute("position");
  const color = mesh.geometry.getAttribute("color");
  const extra = overCoat ? 0.085 : 0;
  for (let row = 0; row <= SCARF_ROWS; row++) {
    const v = row / SCARF_ROWS, offset = (v - 0.5) * 0.22;
    for (let slice = 0; slice <= SCARF_SLICES; slice++) {
      const u = slice / SCARF_SLICES, phi = u * Math.PI * 2;
      const fold = 0.018 * Math.cos(phi * 3 + v * 6) + 0.009 * Math.cos(phi * 12 - v * 4);
      const y = pose.y + offset + 0.022 * Math.sin(phi + v * 2);
      const radius = Math.sqrt(Math.max(0, LID_SHELL_RADIUS ** 2 - y * y))
        + 0.1 + extra + fold;
      const i = row * (SCARF_SLICES + 1) + slice;
      position.setXYZ(i, radius * Math.cos(phi), y, radius * Math.sin(phi));
      const weave = (row + slice) % 2 ? 0.9 : 1;
      const selvedge = row === 0 || row === SCARF_ROWS ? 0.74 : 1;
      color.setXYZ(i, weave * selvedge, (0.86 + 0.08 * Math.sin(phi * 8)) * selvedge,
        (0.83 + 0.1 * Math.sin(phi * 4 + v * 7)) * selvedge);
    }
  }
  position.needsUpdate = color.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
}

function makeScarfEnd(side, material, fringeMaterial) {
  const group = new THREE.Group();
  group.name = side < 0 ? "Long draped scarf end" : "Short draped scarf end";
  const rows = 12, columns = 4, length = side < 0 ? 0.48 : 0.36;
  const geometry = new THREE.BufferGeometry(), positions = [], shades = [], index = [];
  for (let row = 0; row <= rows; row++) for (let col = 0; col <= columns; col++) {
    const t = row / rows, u = col / columns - 0.5;
    positions.push(u * 0.23 + 0.09 * side * t + 0.025 * Math.sin(6 * t),
      -length * t, 0.035 * Math.sin(t * Math.PI) + 0.012 * Math.cos(20 * u + 5 * t));
    const dye = (row + col) % 2 ? 0.88 : 1;
    shades.push(dye, 0.89 * dye, (0.88 + 0.06 * Math.sin(9 * t)) * dye);
    if (row < rows && col < columns) {
      const a = row * (columns + 1) + col, b = a + columns + 1;
      index.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(shades, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const end = new THREE.Mesh(geometry, material);
  end.name = "Folded scarf fabric";
  group.add(end);
  for (let fringe = 0; fringe < 7; fringe++) {
    const x = (fringe / 6 - 0.5) * 0.23 + side * 0.09 + 0.025 * Math.sin(6);
    group.add(rod(new THREE.Vector3(x, -length, 0.01),
      new THREE.Vector3(x + 0.012 * Math.sin(fringe * 3), -length - 0.07, 0.018),
      0.004, fringeMaterial));
  }
  return group;
}

const SUNGLASS_OUTLINE = [
  [-0.235, 0.065], [0.075, 0.103], [0.25, 0.168], [0.247, 0.025],
  [0.167, -0.101], [0.067, -0.13], [-0.17, -0.108], [-0.235, -0.032],
];

function makeSunglassLens(shade, frame, glint) {
  const shape = new THREE.Shape();
  shape.moveTo(...SUNGLASS_OUTLINE[0]);
  for (const point of SUNGLASS_OUTLINE.slice(1)) shape.lineTo(...point);
  shape.closePath();
  const lens = new THREE.Group();
  const glass = new THREE.Mesh(new THREE.ShapeGeometry(shape), shade);
  glass.name = "Angular smoked lens";
  glass.renderOrder = 7;
  lens.add(glass);
  const rim = new THREE.Mesh(new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3(SUNGLASS_OUTLINE.map(([x, y]) =>
      new THREE.Vector3(x, y, 0.017)), true), 48, 0.018, 6, true,
  ), frame);
  rim.name = "Continuous cat-eye rim";
  rim.renderOrder = 8;
  lens.add(rim);
  const shine = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.13, 0.035, 0.023), new THREE.Vector3(-0.02, 0.061, 0.023),
    new THREE.Vector3(0.12, 0.078, 0.023),
  ]), 12, 0.006, 5), glint);
  shine.renderOrder = 9;
  lens.add(shine);
  return lens;
}

const TONGUE_ROWS = 18, TONGUE_COLS = 8;
function makeTongueGeometry() {
  const geometry = new THREE.BufferGeometry();
  const stride = TONGUE_COLS + 1, half = (TONGUE_ROWS + 1) * stride;
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(half * 6), 3));
  const indices = [];
  for (let row = 0; row < TONGUE_ROWS; row++) for (let col = 0; col < TONGUE_COLS; col++) {
    const a = row * stride + col, b = a + stride;
    indices.push(a, b, a + 1, a + 1, b, b + 1);
    indices.push(half + a, half + a + 1, half + b,
      half + a + 1, half + b + 1, half + b);
  }
  for (let row = 0; row < TONGUE_ROWS; row++) for (const col of [0, TONGUE_COLS]) {
    const a = row * stride + col, b = a + stride, c = half + a, d = half + b;
    indices.push(a, c, b, b, c, d);
  }
  for (const row of [0, TONGUE_ROWS]) for (let col = 0; col < TONGUE_COLS; col++) {
    const a = row * stride + col, b = a + 1;
    indices.push(a, b, half + a, b, half + b, half + a);
  }
  geometry.setIndex(indices);
  return geometry;
}

function tongueWidth(t, open) {
  return 0.16 * open * (0.72 + 0.28 * Math.sin(Math.PI * t)) * (1 - 0.25 * t);
}

function tongueSurface(t, u, pose) {
  const x = tongueWidth(t, pose.open) * u;
  // Round the tip across its width, rather than ending in a straight cut.
  const y = (pose.tipY - pose.y) * t + 0.058 * pose.open * t ** 8 * u * u;
  // The tongue is rotated and wagged with the eyelid. Calculate clearance
  // at its *transformed* point, not at the unstirred center of the sphere.
  const worldX = pose.x + x * pose.cosTilt - y * pose.sinTilt;
  const worldY = pose.y + x * pose.sinTilt + y * pose.cosTilt;
  // Start inside the opening, then drape *over* the rounded lower lip before
  // reaching the skin below it. The old late rise (13–33% of the length)
  // left two rows below the lip and made the tongue pierce the moving lid.
  const outside = Math.max(lidSurfaceDepth(worldX, worldY) + 0.48,
    pose.rimZ + 0.03 - 0.1 * t);
  // The root stays behind the lip, but the ribbon reaches the *front* of
  // the lash fan before crossing the lower edge of the opening.
  const smooth = clampEye(t / 0.12, 0, 1);
  const grown = smooth * smooth * (3 - 2 * smooth);
  const z = pose.z + (outside - pose.z) * grown
    + 0.018 * (1 - u * u) * Math.sin(Math.PI * t);
  return [x, y, z - pose.z];
}

function writeTongue(body, groove, pose) {
  const positions = body.geometry.getAttribute("position");
  const stride = TONGUE_COLS + 1, half = (TONGUE_ROWS + 1) * stride;
  for (let row = 0; row <= TONGUE_ROWS; row++) {
    const t = row / TONGUE_ROWS;
    for (let col = 0; col <= TONGUE_COLS; col++) {
      const u = 2 * col / TONGUE_COLS - 1;
      const point = tongueSurface(t, u, pose), index = row * stride + col;
      positions.setXYZ(index, ...point);
      positions.setXYZ(half + index, point[0], point[1],
        point[2] - 0.018 - 0.02 * Math.sin(Math.PI * t));
    }
  }
  positions.needsUpdate = true;
  body.geometry.computeVertexNormals();
  body.geometry.computeBoundingSphere();
  const crease = groove.geometry.getAttribute("position");
  for (let row = 0; row <= 12; row++) {
    const t = 0.34 + 0.55 * row / 12;
    for (const [i, u] of [[0, -0.05], [1, 0.05]]) {
      const [x, y, z] = tongueSurface(t, u, pose);
      crease.setXYZ(2 * row + i, x, y, z + 0.009);
    }
  }
  crease.needsUpdate = true;
  groove.geometry.computeBoundingSphere();
}

/** Tapered overlapping hair strands rather than a flat cartoon silhouette.
 * A single batched mesh keeps the moving mustache cheap during flutter. */
function makeMustache() {
  const positions = [], colors = [], indices = [];
  for (const side of [-1, 1]) for (let layer = 0; layer < 3; layer++)
    for (let hair = 0; hair < 24; hair++) {
      const f = hair / 23;
      const originX = 0.014 + 0.19 * f;
      const length = 0.11 + 0.08 * (1 - f) + 0.012 * Math.sin(hair * 4 + layer);
      const startY = 0.018 + layer * 0.018 + 0.008 * Math.sin(hair * 8.2);
      const base = positions.length / 3;
      for (let step = 0; step <= 6; step++) {
        const t = step / 6, arch = t * t * (3 - 2 * t);
        const x = side * (originX + length * t);
        const y = startY + 0.075 * Math.sin(Math.PI * t) + 0.052 * arch
          - 0.04 * f * arch;
        const z = 0.012 + 0.034 * Math.sin(Math.PI * t) + layer * 0.003;
        const width = 0.007 * (1 - t) + 0.00035;
        for (let face = 0; face < 3; face++) {
          const angle = face * Math.PI * 2 / 3;
          positions.push(x + width * Math.cos(angle), y, z + width * Math.sin(angle));
          const shade = 0.69 + 0.25 * Math.sin(hair * 19.3 + layer * 4.1) ** 2;
          colors.push(shade, shade * 0.86, shade * 0.77);
          if (step < 6) {
            const a = base + step * 3 + face, b = base + (step + 1) * 3 + face;
            const c = base + step * 3 + (face + 1) % 3;
            const d = base + (step + 1) * 3 + (face + 1) % 3;
            indices.push(a, b, c, c, b, d);
          }
        }
      }
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const hairMaterial = new THREE.MeshStandardMaterial({
    color: 0x33251e, roughness: 0.94, metalness: 0,
    vertexColors: true, side: THREE.DoubleSide,
  });
  const mustache = new THREE.Group();
  mustache.name = "Mustache on the upper lashes";
  const strands = new THREE.Mesh(geometry, hairMaterial);
  strands.name = "Individual tapered mustache hairs";
  strands.renderOrder = 7; // above skin (5), below the moving lashes (8)
  mustache.add(strands);
  return mustache;
}

function makeGrouchoDisguise() {
  const costume = new THREE.Group();
  costume.name = "Groucho glasses, nose and mustache";
  const black = new THREE.MeshStandardMaterial({
    color: 0x211c1c, metalness: 0.1, roughness: 0.7,
  });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xb5bbad, transparent: true, opacity: 0.32,
    depthWrite: false, roughness: 0.18, side: THREE.DoubleSide,
  });
  const rubber = new THREE.MeshStandardMaterial({
    color: 0xa96f55, roughness: 0.78,
  });
  const nostril = new THREE.MeshStandardMaterial({ color: 0x4e302d, roughness: 0.94 });
  const frames = [-1, 1].map(side => {
    const lens = new THREE.Group();
    lens.name = side < 0 ? "Left Groucho frame" : "Right Groucho frame";
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.031, 10, 48), black);
    rim.scale.y = 0.82;
    lens.add(rim);
    const window = new THREE.Mesh(new THREE.CircleGeometry(0.2, 48), glass);
    window.scale.y = 0.82;
    window.position.z = -0.007;
    lens.add(window);
    costume.add(lens);
    return lens;
  });
  const bridge = [0, 1].map(() => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 1, 12), black);
    mesh.name = "Groucho glasses bridge";
    costume.add(mesh);
    return mesh;
  });
  const nose = new THREE.Group();
  nose.name = "Groucho disguise nose";
  const bridgeNose = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 16), rubber);
  bridgeNose.scale.set(0.077, 0.16, 0.08);
  bridgeNose.position.set(0, 0.09, -0.04);
  nose.add(bridgeNose);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), rubber);
  tip.scale.set(0.16, 0.105, 0.14);
  tip.position.set(0, -0.055, 0.045);
  nose.add(tip);
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), rubber);
    wing.scale.set(0.067, 0.045, 0.07);
    wing.position.set(side * 0.117, -0.092, 0.03);
    nose.add(wing);
    const cavity = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), nostril);
    cavity.scale.set(0.032, 0.013, 0.018);
    cavity.position.set(side * 0.087, -0.128, 0.076);
    nose.add(cavity);
  }
  costume.add(nose);
  const mustache = makeMustache();
  mustache.name = "Bushy Groucho disguise mustache";
  mustache.scale.set(1.4, 1.25, 1);
  mustache.getObjectByName("Individual tapered mustache hairs").material.color.setHex(0x211819);
  costume.add(mustache);
  return { costume, frames, bridge, nose, mustache };
}

function makeTopHat() {
  // Black-on-black stage needs a plum edge to keep the crown readable.
  const felt = new THREE.MeshStandardMaterial({ color: 0x3d3545, roughness: 0.8 });
  const ribbon = new THREE.MeshStandardMaterial({ color: 0x9d4d66, roughness: 0.66 });
  const trim = new THREE.MeshStandardMaterial({ color: 0xd6b48b, metalness: 0.62, roughness: 0.3 });
  const hat = new THREE.Group();
  hat.name = "Top hat";
  hat.position.set(0, 1.08, 0.09);
  hat.rotation.z = -0.07;
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.57, 0.57, 0.047, 48), felt);
  brim.scale.z = 0.8;
  brim.name = "Top hat brim";
  hat.add(brim);
  const edge = new THREE.Mesh(new THREE.TorusGeometry(0.57, 0.009, 6, 48), trim);
  edge.rotation.x = Math.PI / 2;
  hat.add(edge);
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.405, 0.47, 40), felt);
  crown.position.y = 0.25;
  crown.name = "Top hat crown";
  hat.add(crown);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.402, 0.406, 0.09, 40), ribbon);
  band.position.y = 0.072;
  hat.add(band);
  const badge = new THREE.Mesh(new THREE.BoxGeometry(0.084, 0.08, 0.012), trim);
  badge.position.set(0.18, 0.073, 0.365);
  hat.add(badge);
  return hat;
}

function makeCowboyHat() {
  const leather = new THREE.MeshStandardMaterial({
    color: 0x9c7151, roughness: 0.83, side: THREE.DoubleSide,
  });
  const band = new THREE.MeshStandardMaterial({ color: 0x453138, roughness: 0.82 });
  const trim = new THREE.MeshStandardMaterial({ color: 0xe5b681, roughness: 0.66 });
  const hat = new THREE.Group();
  hat.name = "Cowboy hat";
  hat.position.set(0, 1.075, 0.06);
  hat.rotation.z = 0.075;
  // Front and back dip while the wide sides curl up: a flat disk reads as
  // a fedora, not a cowboy hat, especially from an oblique viewpoint.
  const positions = [], indices = [], columns = 64;
  for (let ring = 0; ring <= 8; ring++) for (let slice = 0; slice <= columns; slice++) {
    const angle = slice * Math.PI * 2 / columns;
    const radius = 0.29 + ring / 8 * 0.51;
    positions.push(radius * Math.cos(angle),
      0.012 + 0.17 * (ring / 8) ** 2 * Math.abs(Math.cos(angle)) ** 3,
      radius * 0.86 * Math.sin(angle));
    if (ring < 8 && slice < columns) {
      const a = ring * (columns + 1) + slice, b = a + columns + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const brim = new THREE.Mesh(geometry, leather);
  brim.name = "Curled cowboy brim";
  hat.add(brim);
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.275, 0.32, 0.39, 40), leather);
  crown.position.y = 0.215;
  crown.scale.z = 0.9;
  hat.add(crown);
  const darkBand = new THREE.Mesh(new THREE.CylinderGeometry(0.317, 0.321, 0.075, 40), band);
  darkBand.position.y = 0.057;
  darkBand.scale.z = 0.91;
  hat.add(darkBand);
  const brimEdge = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(
    Array.from({ length: 32 }, (_, i) => {
      const angle = i * Math.PI * 2 / 32;
      return new THREE.Vector3(0.8 * Math.cos(angle),
        0.012 + 0.17 * Math.abs(Math.cos(angle)) ** 3, 0.688 * Math.sin(angle));
    }), true), 64, 0.022, 6, true), trim);
  hat.add(brimEdge);
  return hat;
}

function makeFrostingHat() {
  const pastry = new THREE.MeshStandardMaterial({ color: 0xe0b5b0, roughness: 0.86 });
  const cream = new THREE.MeshStandardMaterial({ color: 0xf9dddb, roughness: 0.64 });
  const sprinkle = [
    new THREE.MeshStandardMaterial({ color: 0x7eaaae, roughness: 0.68 }),
    new THREE.MeshStandardMaterial({ color: 0xeac086, roughness: 0.68 }),
    new THREE.MeshStandardMaterial({ color: 0xbd7093, roughness: 0.68 }),
  ];
  const hat = new THREE.Group();
  hat.name = "Cupcake frosting hat";
  hat.position.set(0, 1.08, 0.06);
  const liner = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.38, 0.17, 48), pastry);
  liner.position.y = 0.07;
  hat.add(liner);
  const swirl = new THREE.CatmullRomCurve3(Array.from({ length: 100 }, (_, i) => {
    const t = i / 99, angle = t * 6.5 * Math.PI;
    const radius = 0.37 * (1 - t) ** 0.76;
    return new THREE.Vector3(radius * Math.cos(angle),
      0.17 + 0.53 * t, radius * Math.sin(angle) + 0.12);
  }));
  const body = new THREE.Mesh(new THREE.TubeGeometry(swirl, 180, 0.095, 10), cream);
  body.name = "Piped spiral of frosting";
  hat.add(body);
  for (let i = 0; i < 27; i++) {
    const t = 0.07 + (i + 0.5) / 29 * 0.82, point = swirl.getPoint(t);
    const start = point.clone().add(new THREE.Vector3(0.014, 0.085, 0.037));
    hat.add(rod(start, start.clone().add(new THREE.Vector3(0.043, 0.013, 0.016)),
      0.009, sprinkle[i % sprinkle.length]));
  }
  return hat;
}

function makeCherryHat() {
  const red = new THREE.MeshPhysicalMaterial({
    color: 0xbb1d28, roughness: 0.21, clearcoat: 0.95, clearcoatRoughness: 0.13,
  });
  const green = new THREE.MeshStandardMaterial({
    color: 0x47723d, roughness: 0.84, side: THREE.DoubleSide,
  });
  const hat = new THREE.Group();
  hat.name = "Cherry hat";
  hat.position.set(0, 1.075, 0.1);
  const cherryGeometry = new THREE.SphereGeometry(0.27, 32, 20);
  const positions = cherryGeometry.getAttribute("position");
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    if (y < 0.2) continue;
    positions.setY(i, y - 0.07 * Math.exp(-(x * x + z * z) / 0.012));
  }
  positions.needsUpdate = true; cherryGeometry.computeVertexNormals();
  const fruit = new THREE.Mesh(cherryGeometry, red);
  fruit.position.y = 0.31;
  fruit.name = "Glossy indented cherry";
  hat.add(fruit);
  const stem = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.53, 0), new THREE.Vector3(0.025, 0.68, -0.035),
    new THREE.Vector3(0.12, 0.82, -0.04),
  ]), 16, 0.015, 7), green);
  hat.add(stem);
  const leaf = new THREE.Shape();
  leaf.moveTo(0, 0); leaf.quadraticCurveTo(0.14, 0.09, 0.29, 0.045);
  leaf.quadraticCurveTo(0.15, -0.09, 0, 0);
  const foliage = new THREE.Mesh(new THREE.ShapeGeometry(leaf, 12), green);
  foliage.position.set(0.08, 0.69, 0.015);
  foliage.rotation.z = 0.25;
  hat.add(foliage);
  return hat;
}

function makeCatHat() {
  const fur = new THREE.MeshStandardMaterial({ color: 0x9a7c59, roughness: 0.97 });
  const pale = new THREE.MeshStandardMaterial({ color: 0xc5a887, roughness: 0.96 });
  const pink = new THREE.MeshStandardMaterial({ color: 0xba7775, roughness: 0.85 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x302927, roughness: 0.6 });
  const hat = new THREE.Group();
  hat.name = "Cat sitting on the head";
  hat.position.set(0, 1.085, 0.07);
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), fur);
  body.scale.set(0.32, 0.25, 0.24);
  body.position.set(-0.05, 0.25, -0.06);
  body.name = "Seated cat body";
  hat.add(body);
  const chest = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), pale);
  chest.scale.set(0.16, 0.17, 0.07);
  chest.position.set(0.035, 0.27, 0.17);
  hat.add(chest);
  const head = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), fur);
  head.scale.set(0.23, 0.2, 0.2);
  head.position.set(0.075, 0.57, 0.12);
  head.name = "Round cat face";
  hat.add(head);
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.083, 0.19, 4), fur);
    ear.position.set(0.075 + side * 0.145, 0.78, 0.11);
    ear.rotation.z = side * -0.19;
    hat.add(ear);
    const inner = new THREE.Mesh(new THREE.ConeGeometry(0.043, 0.108, 4), pink);
    inner.position.set(0.075 + side * 0.145, 0.79, 0.17);
    hat.add(inner);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.034, 10, 8), dark);
    eye.position.set(0.075 + side * 0.085, 0.60, 0.308);
    hat.add(eye);
    const paw = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), pale);
    paw.scale.set(0.087, 0.07, 0.1);
    paw.position.set(0.02 + side * 0.19, 0.08, 0.18);
    hat.add(paw);
    for (const whisker of [-1, 0, 1]) {
      hat.add(rod(new THREE.Vector3(0.075 + side * 0.055, 0.505, 0.31),
        new THREE.Vector3(0.075 + side * (0.30 + whisker * 0.02),
          0.505 + whisker * 0.055, 0.335),
        0.0025, dark));
    }
  }
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.026, 10, 8), pink);
  nose.position.set(0.075, 0.53, 0.316);
  hat.add(nose);
  const tail = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.32, 0.12, -0.18), new THREE.Vector3(-0.51, 0.1, -0.11),
    new THREE.Vector3(-0.55, 0.37, 0), new THREE.Vector3(-0.45, 0.4, 0.02),
  ]), 26, 0.065, 8), fur);
  tail.name = "Cat's curled tail";
  hat.add(tail);
  return hat;
}

function makeCatEars() {
  const velvet = new THREE.MeshStandardMaterial({
    color: 0x544137, roughness: 0.96, side: THREE.DoubleSide,
  });
  const inside = new THREE.MeshStandardMaterial({
    color: 0xb77779, roughness: 0.96, side: THREE.DoubleSide,
  });
  const ears = new THREE.Group();
  ears.name = "Cat ears";
  for (const side of [-1, 1]) {
    const ear = new THREE.Group();
    ear.position.set(side * 0.63, 0.82, 0);
    ear.rotation.z = -side * 0.11;
    ear.name = side < 0 ? "Left cat ear" : "Right cat ear";
    const outer = new THREE.Shape();
    outer.moveTo(-0.23, 0.015);
    outer.quadraticCurveTo(-0.23, 0.18, -0.17, 0.43);
    outer.quadraticCurveTo(-0.13, 0.55, -0.06, 0.51);
    outer.quadraticCurveTo(0.11, 0.34, 0.22, 0.012);
    outer.closePath();
    const geometry = new THREE.ExtrudeGeometry(outer, {
      depth: 0.065, bevelEnabled: true, bevelSize: 0.016,
      bevelThickness: 0.012, bevelSegments: 3, curveSegments: 12,
    });
    const surfaceZ = (x, y) => lidSurfaceDepth(side * 0.63 + x, 0.82 + y);
    const position = geometry.getAttribute("position");
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i), y = position.getY(i);
      position.setZ(i, surfaceZ(x, y) + 0.065 + position.getZ(i));
    }
    position.needsUpdate = true;
    geometry.computeVertexNormals();
    const outerEar = new THREE.Mesh(geometry, velvet);
    outerEar.name = "Sculpted fur ear";
    ear.add(outerEar);
    const inner = new THREE.Shape();
    inner.moveTo(-0.14, 0.073);
    inner.quadraticCurveTo(-0.13, 0.24, -0.09, 0.38);
    inner.quadraticCurveTo(-0.045, 0.4, -0.01, 0.35);
    inner.quadraticCurveTo(0.07, 0.2, 0.13, 0.076);
    inner.closePath();
    const liningGeometry = new THREE.ShapeGeometry(inner, 12);
    const liningPosition = liningGeometry.getAttribute("position");
    for (let i = 0; i < liningPosition.count; i++) {
      const x = liningPosition.getX(i), y = liningPosition.getY(i);
      liningPosition.setZ(i, surfaceZ(x, y) + 0.149
        - 0.014 * Math.sin(Math.PI * y / 0.46));
    }
    liningPosition.needsUpdate = true;
    liningGeometry.computeVertexNormals();
    const lining = new THREE.Mesh(liningGeometry, inside);
    lining.name = "Recessed ear lining";
    ear.add(lining);
    for (let hair = 0; hair < 9; hair++) {
      const x = (hair / 8 - 0.5) * 0.27, y = 0.072 + 0.015 * Math.sin(hair * 4);
      const start = new THREE.Vector3(x, y, surfaceZ(x, y) + 0.16);
      const end = start.clone().add(new THREE.Vector3(
        x * 0.35, 0.07 + 0.03 * Math.sin(hair * 5) ** 2, 0.024));
      ear.add(rod(start, end, 0.0028, velvet));
    }
    ears.add(ear);
  }
  return ears;
}

function makeHumanEars() {
  const skin = new THREE.MeshStandardMaterial({
    color: 0x885b46, roughness: 0.89, side: THREE.DoubleSide,
  });
  const fold = new THREE.MeshStandardMaterial({
    color: 0x4e302e, roughness: 0.98, side: THREE.DoubleSide,
  });
  const helix = new THREE.MeshStandardMaterial({
    color: 0xa37559, roughness: 0.9,
  });
  const ears = new THREE.Group();
  ears.name = "Human ears outside the shell";
  for (const side of [-1, 1]) {
    const ear = new THREE.Group();
    ear.name = side < 0 ? "Left human ear" : "Right human ear";
    ear.position.set(side * 1.005, 0.04, 0.52);
    ear.rotation.y = side * 0.25;
    ear.scale.x = side;
    const outline = new THREE.Shape();
    outline.moveTo(-0.025, -0.13);
    outline.bezierCurveTo(-0.04, -0.27, 0.12, -0.30, 0.18, -0.18);
    outline.bezierCurveTo(0.24, -0.14, 0.18, -0.06, 0.24, 0.01);
    outline.bezierCurveTo(0.39, 0.17, 0.22, 0.3, 0.13, 0.28);
    outline.bezierCurveTo(0.025, 0.26, 0.05, 0.13, -0.04, 0.075);
    outline.closePath();
    const outer = new THREE.Mesh(new THREE.ExtrudeGeometry(outline, {
      depth: 0.065, bevelEnabled: true, bevelThickness: 0.02,
      bevelSize: 0.019, bevelSegments: 3, curveSegments: 12,
    }), skin);
    outer.name = "Fleshy pinna and lobe";
    ear.add(outer);
    const concha = new THREE.Shape();
    concha.moveTo(0.075, -0.085);
    concha.bezierCurveTo(0.12, -0.21, 0.21, -0.14, 0.17, -0.06);
    concha.bezierCurveTo(0.3, 0.065, 0.26, 0.205, 0.13, 0.20);
    concha.bezierCurveTo(0.06, 0.17, 0.075, 0.06, 0.075, -0.085);
    const recess = new THREE.Mesh(new THREE.ShapeGeometry(concha, 12), fold);
    recess.position.z = 0.091;
    recess.name = "Recessed concha";
    ear.add(recess);
    const ridge = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.02, -0.17, 0.12), new THREE.Vector3(0.13, -0.23, 0.12),
      new THREE.Vector3(0.23, -0.1, 0.12), new THREE.Vector3(0.30, 0.14, 0.12),
      new THREE.Vector3(0.14, 0.26, 0.12), new THREE.Vector3(0.06, 0.10, 0.12),
    ]), 32, 0.022, 7), helix);
    ridge.name = "Rolled outer helix";
    ear.add(ridge);
    ear.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.08, -0.07, 0.15), new THREE.Vector3(0.17, 0.015, 0.15),
      new THREE.Vector3(0.17, 0.12, 0.15), new THREE.Vector3(0.12, 0.16, 0.15),
    ]), 16, 0.019, 6), skin));
    const tragus = new THREE.Mesh(new THREE.SphereGeometry(0.041, 12, 9), skin);
    tragus.position.set(0.06, -0.105, 0.14);
    ear.add(tragus);
    ears.add(ear);
  }
  return ears;
}

function makeHeadband() {
  const geometry = new THREE.BufferGeometry();
  const columns = 56, rows = 6, stride = rows + 1, count = (columns + 1) * stride;
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  const index = [];
  for (let col = 0; col < columns; col++) for (let row = 0; row < rows; row++) {
    const a = col * stride + row, b = a + stride;
    index.push(a, b, a + 1, a + 1, b, b + 1);
  }
  geometry.setIndex(index);
  const band = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    color: 0x3e5862, roughness: 0.98, vertexColors: true, side: THREE.DoubleSide,
  }));
  band.name = "Sweatband across the forehead";
  band.frustumCulled = false;
  band.renderOrder = 6;
  return band;
}

function writeHeadband(band, blink, lowerLid) {
  const position = band.geometry.getAttribute("position");
  const color = band.geometry.getAttribute("color");
  for (let col = 0; col <= 56; col++) {
    const x = (col / 56 * 2 - 1) * 0.9;
    const limit = Math.sqrt(LID_SHELL_RADIUS ** 2 - x * x);
    const center = Math.min(limit - 0.09, Math.max(
      limit - 0.37, lidEdge(x, true, blink, lowerLid) + 0.24));
    for (let row = 0; row <= 6; row++) {
      const t = row / 6;
      const y = Math.min(limit - 0.025, center + (t - 0.5) * 0.18);
      const index = col * 7 + row;
      position.setXYZ(index, x, y, lidSurfaceDepth(x, y) + 0.052);
      const woven = (col + row) % 2 ? 0.86 : 1;
      const stripe = row === 2 || row === 3 ? 1 : 0.72;
      color.setXYZ(index, woven * stripe, woven * stripe, woven * (row === 3 ? 0.65 : 0.94));
    }
  }
  position.needsUpdate = color.needsUpdate = true;
  band.geometry.computeVertexNormals();
}

function makeHaircut(style) {
  const mullet = style === "mullet", hair = new THREE.Group();
  hair.name = mullet ? "Uneven mullet haircut" : "Mom bob haircut";
  const dye = new THREE.MeshStandardMaterial({
    color: mullet ? 0x543a2a : 0x85684b, roughness: 0.97,
    vertexColors: true, side: THREE.DoubleSide,
  });
  const radius = LID_SHELL_RADIUS + 0.085;
  const slices = 96, rows = 24, strands = 84, strandSteps = 12;
  const edgeY = (phi, upperTips) => {
    const facing = Math.max(0, Math.sin(phi));
    const rear = Math.max(0, -Math.sin(phi));
    const side = Math.max(0, 1 - facing - rear);
    const shape = mullet ? 0.76 * facing - 0.42 * rear + 0.27 * side
      : 0.82 * facing - 0.26 * rear + 0.27 * side;
    const waved = shape + (mullet ? 0.037 : 0.018)
      * Math.sin(phi * (mullet ? 13 : 21) + 0.4);
    // Neither cap nor bangs can conceal the upper lid and lashes. Lift their
    // hairline with the moving crest, but leave the nape/side locks draped.
    const guessX = Math.cos(phi);
    const tipY = upperTips.reduce((maximum, [x, y]) =>
      Math.abs(x - guessX) < 0.2 ? Math.max(maximum, y) : maximum, -1);
    return Math.min(radius - 0.03, Math.max(waved,
      facing > 0.1 ? tipY + 0.085 : waved));
  };
  const cap = new THREE.BufferGeometry();
  const positions = new Float32Array((rows + 1) * (slices + 1) * 3);
  const colors = new Float32Array(positions.length), index = [];
  cap.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  cap.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  for (let row = 0; row <= rows; row++) for (let slice = 0; slice <= slices; slice++) {
    const t = row / rows, phi = slice * Math.PI * 2 / slices;
    const streak = 0.75 + 0.22 * Math.sin(phi * 37 + t * 8) ** 2;
    colors.set([streak, streak * 0.94, streak * 0.86], 3 * (row * (slices + 1) + slice));
    if (row < rows && slice < slices) {
      const a = row * (slices + 1) + slice, b = a + slices + 1;
      index.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  cap.setIndex(index);
  const shell = new THREE.Mesh(cap, dye);
  shell.name = mullet ? "Short uneven crown with long nape" : "Blunt round bob cap";
  shell.frustumCulled = false;
  hair.add(shell);

  // Tapered, curved overlapping ribbons add hair grain without dozens of
  // detached straight cylinders or a rigid fringe drawn across the eye.
  const fibers = new THREE.BufferGeometry(), strandsAt = new Float32Array(
    strands * (strandSteps + 1) * 2 * 3);
  const strandsColor = new Float32Array(strandsAt.length), faces = [];
  fibers.setAttribute("position", new THREE.BufferAttribute(strandsAt, 3));
  fibers.setAttribute("color", new THREE.BufferAttribute(strandsColor, 3));
  for (let strand = 0; strand < strands; strand++) {
    const tone = 0.61 + 0.36 * Math.sin(strand * 19.37) ** 2;
    for (let step = 0; step <= strandSteps; step++) {
      const a = strand * (strandSteps + 1) * 2 + step * 2;
      for (const v of [a, a + 1])
        strandsColor.set([tone, tone * 0.92, tone * 0.82], v * 3);
      if (step < strandSteps)
        faces.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  fibers.setIndex(faces);
  const locks = new THREE.Mesh(fibers, dye);
  locks.name = "Layered tapered hair locks";
  locks.frustumCulled = false;
  hair.add(locks);

  const update = (blink, lowerLid) => {
    const upperTips = Array.from({ length: 80 }, (_, index) =>
      lashPoint((index + 0.5) / 80, 1, true, blink, lowerLid));
    const hemAtSlice = Array.from({ length: slices + 1 }, (_, slice) =>
      edgeY(slice * Math.PI * 2 / slices, upperTips));
    const capVertices = cap.getAttribute("position");
    for (let row = 0; row <= rows; row++) for (let slice = 0; slice <= slices; slice++) {
      const t = row / rows, phi = slice * Math.PI * 2 / slices;
      const y = radius + (hemAtSlice[slice] - radius) * t;
      const section = Math.sqrt(Math.max(0, radius ** 2 - y * y))
        + 0.006 * t * t * Math.sin(phi * 23 + t * 7);
      capVertices.setXYZ(row * (slices + 1) + slice,
        section * Math.cos(phi), y, section * Math.sin(phi));
    }
    capVertices.needsUpdate = true;
    cap.computeVertexNormals();
    const lockVertices = fibers.getAttribute("position");
    for (let strand = 0; strand < strands; strand++) {
      const phi = (strand + 0.37) * Math.PI * 2 / strands;
      const front = Math.sin(phi) > 0.23;
      const hem = edgeY(phi, upperTips);
      const nape = mullet ? 0.26 + 0.12 * Math.sin(strand * 2.9) ** 2
        : 0.16 + 0.04 * Math.sin(strand * 1.7) ** 2;
      const finish = front ? hem + 0.012 : hem - nape;
      for (let step = 0; step <= strandSteps; step++) {
        const t = step / strandSteps, swung = phi
          + (mullet ? 0.032 : 0.017) * Math.sin(strand * 3.3) * t * t;
        const y = radius - 0.045 + (finish - radius + 0.045) * t;
        const section = Math.sqrt(Math.max(0, radius ** 2 - y * y)) + 0.013
          + 0.028 * t * t;
        const width = 0.014 * (1 - t) ** 0.6 + 0.0005;
        const base = strand * (strandSteps + 1) * 2 + step * 2;
        for (const side of [-1, 1]) {
          const x = section * Math.cos(swung) - side * width * Math.sin(swung);
          const z = section * Math.sin(swung) + side * width * Math.cos(swung);
          lockVertices.setXYZ(base + (side + 1) / 2, x, y, z);
        }
      }
    }
    lockVertices.needsUpdate = true;
    fibers.computeVertexNormals();
  };
  update(0.04, 0);
  return { hair, update };
}

function makeBowTie() {
  const silk = new THREE.MeshStandardMaterial({
    color: 0x9c3457, roughness: 0.48, metalness: 0.08,
  });
  const seam = new THREE.MeshStandardMaterial({ color: 0xe5a3a1, roughness: 0.59 });
  const tie = new THREE.Group();
  tie.name = "Bow tie";
  tie.position.set(0, -1.105, 0.72);
  for (const side of [-1, 1]) {
    const lobe = new THREE.Shape();
    lobe.moveTo(0.015, 0);
    lobe.bezierCurveTo(0.18, 0.16, 0.37, 0.18, 0.42, 0.12);
    lobe.lineTo(0.42, -0.12);
    lobe.bezierCurveTo(0.32, -0.19, 0.16, -0.14, 0.015, 0);
    const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(lobe, {
      depth: 0.038, bevelEnabled: true, bevelSize: 0.015,
      bevelThickness: 0.012, bevelSegments: 2, curveSegments: 10,
    }), silk);
    mesh.scale.x = side;
    tie.add(mesh);
    tie.add(rod(new THREE.Vector3(side * 0.17, 0.074, 0.064),
      new THREE.Vector3(side * 0.34, 0.09, 0.066), 0.008, seam));
  }
  const knot = new THREE.Mesh(new THREE.SphereGeometry(0.087, 16, 12), silk);
  knot.scale.set(0.8, 1.05, 0.7);
  knot.position.z = 0.047;
  tie.add(knot);
  return { tie, silk };
}

function makeCatTail() {
  const fur = new THREE.MeshStandardMaterial({
    color: 0x94745c, roughness: 0.97, vertexColors: true,
  });
  const stray = new THREE.LineBasicMaterial({
    color: 0xa79277, transparent: true, opacity: 0.78,
  });
  const tail = new THREE.Group();
  tail.name = "Curled cat tail";
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.83, -0.59, -0.4), new THREE.Vector3(1.07, -0.82, -0.39),
    new THREE.Vector3(1.34, -1.09, -0.19), new THREE.Vector3(1.48, -0.94, -0.05),
    new THREE.Vector3(1.43, -0.66, 0.03), new THREE.Vector3(1.3, -0.51, 0.06),
  ]);
  const segments = 70, radial = 12;
  const geometry = new THREE.TubeGeometry(curve, segments, 1, radial, false);
  const position = geometry.getAttribute("position");
  const color = new THREE.Float32BufferAttribute(new Float32Array(position.count * 3), 3);
  const radius = t => (0.078 + 0.042 * Math.sin(Math.PI * t))
    * (1 - 0.83 * t ** 8);
  for (let ring = 0; ring <= segments; ring++) {
    const t = ring / segments, center = curve.getPointAt(t);
    const band = Math.cos(t * Math.PI * 14) > 0.25 ? 0.72 : 1;
    for (let side = 0; side <= radial; side++) {
      const index = ring * (radial + 1) + side;
      const vertex = new THREE.Vector3().fromBufferAttribute(position, index);
      vertex.sub(center).multiplyScalar(radius(t)).add(center);
      position.setXYZ(index, vertex.x, vertex.y, vertex.z);
      const grain = 0.91 + 0.09 * Math.sin(ring * 12.3 + side * 3.1);
      color.setXYZ(index, band * grain, band * grain * 0.91, band * grain * 0.78);
    }
  }
  geometry.setAttribute("color", color);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, fur);
  mesh.name = "Tail arch behind the eye";
  tail.add(mesh);
  // Sparse guard hairs break up the perfectly smooth tube silhouette without
  // adding an opaque fur sleeve or hundreds of separate draw calls.
  const hairs = [];
  for (let i = 3; i < segments; i += 2) for (const side of [0, 1, 2]) {
    const t = i / segments, angle = (i * 7.31 + side * 2.094) % (Math.PI * 2);
    const direction = geometry.normals[i].clone().multiplyScalar(Math.cos(angle))
      .addScaledVector(geometry.binormals[i], Math.sin(angle));
    const start = curve.getPointAt(t).addScaledVector(direction, radius(t) * 0.96);
    const end = start.clone().addScaledVector(direction, 0.014 + 0.019 * (i % 5) / 5);
    hairs.push(...start.toArray(), ...end.toArray());
  }
  const fuzz = new THREE.BufferGeometry();
  fuzz.setAttribute("position", new THREE.Float32BufferAttribute(hairs, 3));
  const fibers = new THREE.LineSegments(fuzz, stray);
  fibers.name = "Short fur along tapered tail";
  tail.add(fibers);
  return tail;
}

/** Tooth roots start *inside* the opening, never on the outer skin. The
 * fronts clear the globe at their tips but remain behind the rolled lips. */
export function toothPose(x, upper, blink, lowerLid) {
  const gap = lidEdge(x, true, blink, lowerLid) - lidEdge(x, false, blink, lowerLid);
  const open = clampEye((gap - 0.15) / 0.16, 0, 1);
  const edge = lidEdge(x, upper, blink, lowerLid);
  const inward = upper ? -1 : 1;
  const halfHeight = 0.07 * open;
  const y = edge + inward * 0.086 * open;
  const tipY = y + inward * halfHeight;
  const lipZ = lidLipPoint(x, 0.5, upper, blink, lowerLid)[2];
  return {
    x, y, z: Math.min(lipZ - 0.04, globeHullDepth(x, tipY) + 0.045) - 0.03,
    open, halfHeight,
  };
}

export function tonguePose(blink, lowerLid, beat = 0, moving = false) {
  const top = lidEdge(0, true, blink, lowerLid);
  const bottom = lidEdge(0, false, blink, lowerLid);
  const open = clampEye((top - bottom - 0.22) / 0.18, 0, 1);
  const sway = moving ? Math.sin(beat * Math.PI + 0.45) : 0;
  const rimZ = lidLipPoint(0, 0.5, false, blink, lowerLid)[2];
  const y = bottom + 0.12 * open;
  const length = (0.52 + (moving ? 0.025 * Math.sin(beat * Math.PI * 2) : 0)) * open;
  const tilt = 0.12 * sway;
  return {
    x: 0.065 * sway, y, z: rimZ + 0.05 - 0.135 * open, tipY: y - length,
    rimY: bottom, rimZ, open, tilt, sinTilt: Math.sin(tilt), cosTilt: Math.cos(tilt),
  };
}

export function createOculoidWardrobe(lidCover, iris, rimMaterial, lidPatches,
  assembly = lidCover, liningMaterial = rimMaterial) {
  const brass = new THREE.MeshStandardMaterial({ color: 0xc5a67f, metalness: 0.65, roughness: 0.27 });
  const frame = new THREE.MeshStandardMaterial({
    color: 0x292533, metalness: 0.72, roughness: 0.22,
  });
  const shade = new THREE.MeshPhysicalMaterial({
    color: 0x183d4c, metalness: 0.35, roughness: 0.12, clearcoat: 1,
    transparent: true, opacity: 0.93, depthWrite: false, side: THREE.DoubleSide,
  });
  const sunglassGlint = new THREE.MeshBasicMaterial({ color: 0xaccfce, transparent: true, opacity: 0.63 });
  const sunglasses = new THREE.Group();
  sunglasses.name = "Sunglasses above the upper lid";
  const lenses = [-1, 1].map(side => {
    const lens = makeSunglassLens(shade, frame, sunglassGlint);
    lens.name = side < 0 ? "Left sunglass lens" : "Right sunglass lens";
    lens.scale.x = side;
    sunglasses.add(lens);
    return { lens, side };
  });
  const bridges = [0, 1].map(() => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 1, 10), frame);
    mesh.name = "Connected brow bridge";
    sunglasses.add(mesh);
    return mesh;
  });
  const temples = [0, 1].map(() => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1, 10), frame);
    mesh.name = "Swept sunglass temple";
    sunglasses.add(mesh);
    return mesh;
  });
  // Keep a small shared brow bridge even with the imported mesh: its dark
  // original bridge vanishes against the black stage at this scale.
  const fallbackFrames = [...lenses.map(({ lens }) => lens), ...temples];
  const importedGlasses = new THREE.Group();
  importedGlasses.name = "Imported CC BY aviator sunglasses";
  importedGlasses.visible = false;
  sunglasses.add(importedGlasses);
  // The lenses are positioned against the moving lid by updatePose, but
  // cannot be children of the hideable shell: they dress the bare eye too.
  assembly.add(sunglasses);

  const coat = new THREE.Group();
  coat.name = "Trench coat halfway up the shell";
  const coatMaterial = new THREE.MeshStandardMaterial({
    color: 0x78644d, roughness: 0.97, metalness: 0,
    vertexColors: true, side: THREE.DoubleSide,
  });
  const lining = new THREE.MeshStandardMaterial({
    color: 0xaf9475, roughness: 0.95, side: THREE.DoubleSide,
  });
  const stitching = new THREE.LineBasicMaterial({
    color: 0xdbc4a3, transparent: true, opacity: 0.48,
  });
  const coatBody = makeCoatShell(coatMaterial);
  coatBody.renderOrder = 6;
  coat.add(coatBody);
  const coatLapels = [], coatSeams = [], coatButtons = [];
  for (const side of [-1, 1]) {
    const fold = makeCoatLapel(side, lining);
    coatLapels.push({ fold, side });
    coat.add(fold);
    for (const seam of [
      makeCoatSeam(side, t => [t, coatOpening(t)], 33, stitching),
      makeCoatSeam(side, s => [1, coatOpening(1)
        + (Math.PI - 0.22 - coatOpening(1)) * s], 56, stitching),
      makeCoatSeam(side, s => [0.68 * s,
        coatOpening(0.68 * s) + 0.08 + 0.17 * Math.sin(Math.PI * s)], 24, stitching),
    ]) {
      coatSeams.push(seam);
      coat.add(seam.line);
    }
  }
  for (const side of [-1, 1]) for (const t of [0.44, 0.77]) {
    const button = new THREE.Mesh(new THREE.SphereGeometry(0.025, 16, 12), brass);
    button.name = "Small trench coat button";
    coat.add(button);
    coatButtons.push({ button, side, t });
  }
  function writeCoat(blink, lowerLid) {
    writeCoatShell(coatBody, blink, lowerLid);
    for (const { fold, side } of coatLapels) writeCoatLapel(fold, side, blink, lowerLid);
    for (const seam of coatSeams) seam.update(blink, lowerLid);
    for (const { button, side, t } of coatButtons)
      button.position.copy(coatPoint(t, side * (coatOpening(t) + 0.25),
        blink, lowerLid, 0.065));
  }
  writeCoat(0.04, 0);
  lidCover.add(coat);

  const scarf = new THREE.Group();
  scarf.name = "Scarf wrapped below the lower lid";
  const cloth = new THREE.MeshStandardMaterial({
    color: 0x98614e, roughness: 0.98, metalness: 0, vertexColors: true,
    side: THREE.DoubleSide,
  });
  const stitch = new THREE.MeshStandardMaterial({
    color: 0xcfac8f, roughness: 0.99, side: THREE.DoubleSide,
  });
  const wrap = makeScarfWrap(cloth);
  const scarfEnds = [-1, 1].map(side => {
    const end = makeScarfEnd(side, cloth, stitch);
    scarf.add(end);
    return end;
  });
  const scarfKnot = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 14), stitch);
  scarfKnot.name = "Soft overlapping scarf knot";
  scarfKnot.scale.set(0.16, 0.11, 0.07);
  scarf.add(wrap, scarfKnot);
  lidCover.add(scarf);

  const cigar = new THREE.Group();
  cigar.name = "Cigar held by the lower lid";
  const paper = new THREE.MeshStandardMaterial({ color: 0x73412d, roughness: 0.83 });
  const band = new THREE.MeshStandardMaterial({ color: 0xc5a06d, metalness: 0.4, roughness: 0.36 });
  const ember = new THREE.MeshStandardMaterial({
    color: 0x53261f, emissive: 0xb4401f, emissiveIntensity: 0.65, roughness: 0.91,
  });
  const start = new THREE.Vector3(0, 0, 0.025), end = new THREE.Vector3(0.52, -0.13, 0.25);
  cigar.add(rod(start, end, 0.046, paper));
  cigar.add(rod(new THREE.Vector3(0.09, -0.02, 0.063),
    new THREE.Vector3(0.14, -0.035, 0.088), 0.049, band));
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.037, 12, 8), ember);
  tip.position.copy(end);
  cigar.add(tip);
  lidCover.add(cigar);
  const mustache = makeMustache();
  lidCover.add(mustache);

  const lipstickMaterial = new THREE.MeshStandardMaterial({
    color: OCULOID_WARDROBE_DEFAULTS.lipstickColor, roughness: 0.34, metalness: 0.12,
    side: THREE.DoubleSide,
  });
  const enamel = new THREE.MeshPhysicalMaterial({
    color: 0xf6e8da, roughness: 0.28, clearcoat: 0.62, clearcoatRoughness: 0.25,
  });
  const teeth = new THREE.Group();
  teeth.name = "Teeth behind the eyelid lips";
  const toothGeometry = new THREE.SphereGeometry(1, 14, 12);
  const toothRows = [
    { upper: true, positions: [-0.43, -0.31, -0.19, -0.065, 0.065, 0.19, 0.31, 0.43] },
    { upper: false, positions: [-0.35, -0.21, -0.07, 0.07, 0.21, 0.35] },
  ].flatMap(({ upper, positions }) => positions.map((x, index) => {
    const mesh = new THREE.Mesh(toothGeometry, enamel);
    mesh.name = upper ? "Upper tooth" : "Lower tooth";
    mesh.renderOrder = 3; // lips still occlude the root
    teeth.add(mesh);
    return { mesh, x, upper, width: index === 0 || index === positions.length - 1 ? 0.049 : 0.054 };
  }));
  lidCover.add(teeth);

  const tongue = new THREE.Group();
  tongue.name = "Hanging tongue from the lower lip";
  const tongueMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xc85f81, roughness: 0.42, clearcoat: 0.45, clearcoatRoughness: 0.34,
    side: THREE.DoubleSide,
  });
  const tongueBody = new THREE.Mesh(makeTongueGeometry(), tongueMaterial);
  tongueBody.name = "Tongue body";
  tongueBody.frustumCulled = false;
  tongueBody.renderOrder = 9; // in front of the lashes (8), still depth-tested against the lip
  tongue.add(tongueBody);
  const creaseGeometry = new THREE.BufferGeometry();
  creaseGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(13 * 2 * 3), 3));
  creaseGeometry.setIndex(Array.from({ length: 12 }, (_, row) => [
    2 * row, 2 * row + 2, 2 * row + 1,
    2 * row + 1, 2 * row + 2, 2 * row + 3,
  ]).flat());
  const groove = new THREE.Mesh(creaseGeometry,
    new THREE.MeshBasicMaterial({ color: 0x923651, side: THREE.DoubleSide }));
  groove.name = "Tongue groove";
  groove.frustumCulled = false;
  groove.renderOrder = 9;
  tongue.add(groove);
  lidCover.add(tongue);

  // Headwear, hair and ears turn with the rig and survive a bare globe. Mouth
  // props and the athletic band instead belong to the hideable eyelid shell.
  const hats = new Map([
    ["top", makeTopHat()], ["cowboy", makeCowboyHat()],
    ["frosting", makeFrostingHat()], ["cherry", makeCherryHat()],
    ["cat", makeCatHat()],
  ]);
  const catEars = makeCatEars(), humanEars = makeHumanEars();
  const { tie: bowTie, silk: bowTieMaterial } = makeBowTie();
  const catTail = makeCatTail(), headband = makeHeadband();
  const { hair: mulletHair, update: updateMullet } = makeHaircut("mullet");
  const { hair: momBobHair, update: updateMomBob } = makeHaircut("mom-bob");
  const groucho = makeGrouchoDisguise();
  assembly.add(...hats.values(), catEars, humanEars, bowTie, catTail, groucho.costume,
    mulletHair, momBobHair);
  lidCover.add(headband);

  let outfit = OCULOID_WARDROBE_DEFAULTS, shellVisible = true;
  let lastCoatBlink = NaN, lastCoatLowerLid = NaN;
  let lastHairBlink = NaN, lastHairLowerLid = NaN;
  const lensPoint = ({ lens, side }, x, y) => new THREE.Vector3(side * x, y, 0.017)
    .applyQuaternion(lens.quaternion).add(lens.position);
  function updatePose(blink, lowerLid, beat = 0, moving = false) {
    if (coat.visible && (!Number.isFinite(lastCoatBlink)
      || Math.abs(blink - lastCoatBlink) > 0.0001
      || Math.abs(lowerLid - lastCoatLowerLid) > 0.0001)) {
      writeCoat(blink, lowerLid);
      lastCoatBlink = blink;
      lastCoatLowerLid = lowerLid;
    }
    const hairBlink = shellVisible ? blink : 0.04;
    const hairLowerLid = shellVisible ? lowerLid : 0;
    if ((mulletHair.visible || momBobHair.visible)
      && (!Number.isFinite(lastHairBlink)
        || Math.abs(hairBlink - lastHairBlink) > 0.0001
        || Math.abs(hairLowerLid - lastHairLowerLid) > 0.0001)) {
      if (mulletHair.visible) updateMullet(hairBlink, hairLowerLid);
      else updateMomBob(hairBlink, hairLowerLid);
      lastHairBlink = hairBlink;
      lastHairLowerLid = hairLowerLid;
    }
    if (mustache.visible) {
      const [, lashY, lashZ] = lashPoint(0.5, 0, true, blink, lowerLid);
      // Rest against the upper lip *behind* the lash roots. Anchoring at the
      // mid-length lash tip floated the hairs far in front of the skin.
      mustache.position.set(0, lashY + 0.03,
        Math.max(lidSurfaceDepth(0, lashY + 0.03) + 0.055, lashZ - 0.055));
      mustache.rotation.x = -0.16;
    }
    if (cigar.visible) {
      const [x, y, z] = lidLipPoint(0.24, 0.52, false, blink, lowerLid);
      cigar.position.set(x, y + 0.048, z + 0.037);
    }
    if (headband.visible) writeHeadband(headband, blink, lowerLid);
    if (sunglasses.visible) {
      const positions = eyewearPose(blink, lowerLid, shellVisible);
      positions.forEach(({ x, y, z }, i) => {
        const side = lenses[i].side;
        lenses[i].lens.position.set(x, y, z);
        lenses[i].lens.rotation.set(0, side * 0.15, 0);
        const temple = lensPoint(lenses[i], 0.25, 0.168);
        const anchorY = Math.min(0.69, y - 0.06), anchorX = side * 0.88;
        span(temples[i], temple, new THREE.Vector3(
          anchorX, anchorY, (shellVisible ? lidSurfaceDepth : globeHullDepth)(anchorX, anchorY) + 0.045,
        ));
      });
      // Connect the inner edges of the *raised* frames instead of arching
      // above their upper corners, which cropped the bridge off the stage.
      const left = lensPoint(lenses[0], -0.235, 0.015);
      const right = lensPoint(lenses[1], -0.235, 0.015);
      const arch = left.clone().add(right).multiplyScalar(0.5);
      arch.y += 0.035;
      arch.z += 0.025;
      span(bridges[0], left, arch);
      span(bridges[1], arch, right);
      importedGlasses.position.set(0, (positions[0].y + positions[1].y) / 2 + 0.03,
        Math.max(positions[0].z, positions[1].z) + 0.1);
    }
    if (groucho.costume.visible) {
      const eyewear = eyewearPose(blink, lowerLid, shellVisible);
      eyewear.forEach(({ x, y, z }, index) =>
        groucho.frames[index].position.set(x, y, z + 0.03));
      const left = groucho.frames[0].position.clone().add(new THREE.Vector3(0.21, 0.025, 0));
      const right = groucho.frames[1].position.clone().add(new THREE.Vector3(-0.21, 0.025, 0));
      const arch = left.clone().add(right).multiplyScalar(0.5);
      arch.y += 0.075;
      span(groucho.bridge[0], left, arch);
      span(groucho.bridge[1], arch, right);
      const bridgeY = (left.y + right.y) / 2;
      const noseY = bridgeY - 0.2;
      groucho.nose.position.set(0, noseY,
        Math.max(lidSurfaceDepth(0, noseY) + 0.12, arch.z + 0.10));
      const [, lashY, lashZ] = lashPoint(0.5, 0, true, blink, lowerLid);
      const hairY = shellVisible ? lashY + 0.09 : bridgeY - 0.29;
      groucho.mustache.position.set(0, hairY,
        Math.max((shellVisible ? lidSurfaceDepth : globeHullDepth)(0, hairY) + 0.07,
          shellVisible ? lashZ - 0.035 : groucho.nose.position.z + 0.01));
      groucho.mustache.rotation.x = -0.16;
    }
    if (scarf.visible) {
      const pose = scarfPose(blink, lowerLid);
      writeScarfWrap(wrap, pose, coat.visible);
      const front = pose.radius + (coat.visible ? 0.085 : 0);
      scarfKnot.position.set(0.07, pose.y - 0.025, front + 0.08);
      scarfEnds.forEach((end, index) => end.position.set(
        index ? 0.24 : -0.15, pose.y - 0.04, front + 0.12));
    }
    if (teeth.visible) for (const { mesh, x, upper, width } of toothRows) {
      const { y, z, open, halfHeight } = toothPose(x, upper, blink, lowerLid);
      mesh.visible = open > 0.001;
      mesh.position.set(x, y, z);
      // The lid gap varies across a tooth's width (especially near the
      // canthi). Shrink the whole tooth into its own opening as it closes;
      // otherwise its outside edge pokes through the curved lip first.
      mesh.scale.set(width * open, halfHeight, 0.03 * open);
    }
    if (shellVisible && outfit.tongue === true) {
      const pose = tonguePose(blink, lowerLid, beat, moving);
      tongue.visible = pose.open > 0.001;
      if (tongue.visible) {
        tongue.position.set(pose.x, pose.y, pose.z);
        tongue.rotation.z = pose.tilt;
        writeTongue(tongueBody, groove, pose);
      }
    }
  }
  function set(value = OCULOID_WARDROBE_DEFAULTS, lidsVisible = true) {
    outfit = value;
    shellVisible = lidsVisible;
    sunglasses.visible = outfit.sunglasses === true && outfit.groucho !== true;
    groucho.costume.visible = outfit.groucho === true;
    coat.visible = shellVisible && outfit.coat === true;
    if (coat.visible) lastCoatBlink = NaN;
    scarf.visible = shellVisible && outfit.scarf === true;
    teeth.visible = shellVisible && outfit.teeth === true;
    tongue.visible = shellVisible && outfit.tongue === true;
    cigar.visible = shellVisible && outfit.cigar === true;
    mustache.visible = shellVisible && outfit.mustache === true && outfit.groucho !== true;
    headband.visible = shellVisible && outfit.headband === true;
    const hatSize = clampEye(Number(outfit.hatSize), 0.75, 1.5, 1);
    for (const [style, hat] of hats) {
      hat.visible = outfit.hat === style;
      hat.scale.setScalar(hatSize);
    }
    catEars.visible = outfit.catEars === true;
    humanEars.visible = outfit.humanEars === true;
    bowTie.visible = outfit.bowTie === true;
    catTail.visible = outfit.tail === true;
    mulletHair.visible = outfit.hair === "mullet";
    momBobHair.visible = outfit.hair === "mom-bob";
    if (mulletHair.visible || momBobHair.visible) lastHairBlink = NaN;
    lipstickMaterial.color.set(hexEyeColor(outfit.lipstickColor, OCULOID_WARDROBE_DEFAULTS.lipstickColor));
    bowTieMaterial.color.set(hexEyeColor(outfit.bowTieColor, OCULOID_WARDROBE_DEFAULTS.bowTieColor));
    for (const patch of lidPatches) {
      patch.mesh.material[0] = shellVisible && outfit.lipstick === true
        ? lipstickMaterial : liningMaterial;
      patch.mesh.material[1] = shellVisible && outfit.lipstick === true
        ? lipstickMaterial : rimMaterial;
    }
  }
  function setSunglassModel(model) {
    if (!model?.isObject3D) return false;
    // The GLB's nested Sketchfab/FBX transforms already turn its source
    // Z-up axes into Y-up scene coordinates. Rotating the entire GLB again
    // points its lenses toward the ceiling and stands its long temples up.
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    if (!Number.isFinite(size.x) || size.x <= 0 || !Number.isFinite(size.y)
      || size.y <= 0 || !Number.isFinite(size.z) || size.z <= 0) return false;
    const center = bounds.getCenter(new THREE.Vector3());
    model.position.sub(new THREE.Vector3(center.x, center.y, bounds.max.z));
    model.traverse(item => {
      if (!item.isMesh || !/Glass_tinted/i.test(item.material?.name ?? "")) return;
      item.material.color.setHex(0x2b353b);
      item.material.opacity = 0.82;
      item.material.depthWrite = false;
      item.material.needsUpdate = true;
    });
    const scale = 1.33 / size.x;
    importedGlasses.scale.set(scale, scale, scale * 0.29);
    importedGlasses.add(model);
    importedGlasses.visible = true;
    for (const framePart of fallbackFrames) framePart.visible = false;
    for (const bridge of bridges) bridge.material = brass;
    return true;
  }
  function occluders() {
    return shellVisible
      ? [...(coat.visible ? [coatBody] : []),
        ...(cigar.visible ? cigar.children.filter(child => child.isMesh) : []),
        ...(teeth.visible ? toothRows.map(({ mesh }) => mesh).filter(mesh => mesh.visible) : []),
        ...(tongue.visible ? [tongueBody] : [])]
      : [];
  }
  function frameRadius() {
    const hatSize = clampEye(Number(outfit.hatSize), 0.75, 1.5, 1);
    const hatHeight = { top: 0.8, cowboy: 0.7, frosting: 0.9, cherry: 1,
      cat: 1.03 }[outfit.hat] ?? 0;
    return Math.max(LID_SHELL_RADIUS, hatHeight ? 1.08 + hatSize * hatHeight : 0,
      catEars.visible ? 1.65 : 0, humanEars.visible ? 1.47 : 0,
      bowTie.visible ? 1.38 : 0, catTail.visible ? 1.88 : 0,
      scarf.visible ? 1.55 : 0, mulletHair.visible || momBobHair.visible ? 1.3 : 0);
  }
  set();
  return { set, updatePose, setSunglassModel, occluders, frameRadius, lipstickMaterial };
}
