import * as THREE from '../vendor/three/three.module.min.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** Clip, rather than duplicate, triangles along a sagittal plane. UVs, normal
 * vectors, tangents and material groups travel with the original surface. */
export function splitRoachWingGeometry(source, { slope = 0, intercept = 0, matrix = new THREE.Matrix4() } = {}) {
  const geometry = source.clone().applyMatrix4(matrix);
  const attributes = Object.entries(geometry.attributes);
  const position = geometry.attributes.position;
  const index = geometry.index;
  const count = index?.count ?? position.count;
  const sourceGroups = geometry.groups.length ? geometry.groups : [{ start: 0, count, materialIndex: 0 }];
  const cached = new Map();
  function vertex(id) {
    if (cached.has(id)) return cached.get(id);
    const values = attributes.map(([, attribute]) => Array.from({ length: attribute.itemSize }, (_, c) => attribute.getComponent(id, c)));
    const point = new THREE.Vector3().fromBufferAttribute(position, id);
    const result = { key: `v${id}`, values, distance: point.x - slope * point.y - intercept };
    cached.set(id, result);
    return result;
  }
  function crossing(a, b) {
    const t = a.distance / (a.distance - b.distance);
    return { key: a.key < b.key ? `${a.key}/${b.key}` : `${b.key}/${a.key}`, distance: 0,
      values: a.values.map((values, attribute) => values.map((value, component) => value + (b.values[attribute][component] - value) * t)) };
  }
  const result = [1, -1].map((sign) => {
    const arrays = attributes.map(() => []);
    const vertices = new Map();
    const indices = [];
    const groups = [];
    function append(value) {
      if (vertices.has(value.key)) return vertices.get(value.key);
      const next = vertices.size;
      vertices.set(value.key, next);
      value.values.forEach((values, attribute) => arrays[attribute].push(...values));
      return next;
    }
    for (const group of sourceGroups) {
      const start = indices.length;
      for (let i = group.start; i < Math.min(count, group.start + group.count); i += 3) {
        const triangle = [0, 1, 2].map((corner) => vertex(index ? index.getX(i + corner) : i + corner));
        const polygon = [];
        for (let edge = 0; edge < 3; edge += 1) {
          const a = triangle[edge], b = triangle[(edge + 1) % 3];
          const insideA = a.distance * sign >= 0, insideB = b.distance * sign >= 0;
          if (insideA) polygon.push(a);
          if (insideA !== insideB) polygon.push(crossing(a, b));
        }
        for (let corner = 1; corner < polygon.length - 1; corner += 1) indices.push(append(polygon[0]), append(polygon[corner]), append(polygon[corner + 1]));
      }
      if (indices.length > start) groups.push({ start, count: indices.length - start, materialIndex: group.materialIndex });
    }
    const half = new THREE.BufferGeometry();
    attributes.forEach(([name, attribute], i) => half.setAttribute(name, new THREE.Float32BufferAttribute(arrays[i], attribute.itemSize)));
    half.setIndex(indices);
    half.groups = groups;
    half.normalizeNormals();
    half.computeBoundingBox();
    half.computeBoundingSphere();
    return half;
  });
  geometry.dispose();
  return result;
}

function authoredHindwing(length, sign) {
  const positions = [], unfolded = [], indices = [], veins = [], openVeins = [];
  const rays = 12, rows = 5;
  function vertex(ray, row, open) {
    const angle = -.06 + ray / rays * 1.18;
    const radius = length * (.82 + .18 * Math.cos((angle - .12) * 1.6)) * row / rows;
    return [sign * radius * Math.sin(angle) * (open ? 1 : .09), -radius * Math.cos(angle),
      Math.sin(angle * 8) * radius * .008];
  }
  for (let ray = 0; ray <= rays; ray += 1) for (let row = 0; row <= rows; row += 1) {
    positions.push(...vertex(ray, row, false)); unfolded.push(...vertex(ray, row, true));
    if (ray < rays && row < rows) {
      const a = ray * (rows + 1) + row, b = a + rows + 1;
      indices.push(a, a + 1, b + 1, a, b + 1, b);
    }
    if (row < rows) { veins.push(...vertex(ray, row, false), ...vertex(ray, row + 1, false)); openVeins.push(...vertex(ray, row, true), ...vertex(ray, row + 1, true)); }
    if (ray < rays && row > 1) { veins.push(...vertex(ray, row, false), ...vertex(ray + 1, row, false)); openVeins.push(...vertex(ray, row, true), ...vertex(ray + 1, row, true)); }
  }
  function morphGeometry(closed, open) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(closed, 3));
    geometry.morphAttributes.position = [new THREE.Float32BufferAttribute(open, 3)];
    // Closed wings fit the resting specimen. Expanded bounds are evaluated
    // from the current morph during framing; the fans are never culled early.
    geometry.boundingBox = new THREE.Box3().setFromBufferAttribute(geometry.attributes.position);
    geometry.computeBoundingSphere();
    return geometry;
  }
  const membraneGeometry = morphGeometry(positions, unfolded);
  membraneGeometry.setIndex(indices);
  membraneGeometry.computeVertexNormals();
  const membrane = new THREE.Mesh(membraneGeometry, new THREE.MeshStandardMaterial({
    color: 0xa27b4e, transparent: true, opacity: .48, roughness: .76,
    metalness: 0, side: THREE.DoubleSide, depthWrite: false,
  }));
  membrane.name = 'Reconstructed veined hindwing membrane';
  membrane.userData.authoredHindwing = true;
  membrane.userData.noCastShadow = true;
  membrane.frustumCulled = false;
  const veinLines = new THREE.LineSegments(morphGeometry(veins, openVeins), new THREE.LineBasicMaterial({
    color: 0x46301e, transparent: true, opacity: .9, depthWrite: false,
  }));
  veinLines.frustumCulled = false;
  veinLines.userData.noCastShadow = true;
  return { membrane, veinLines };
}

/** Adapt only the known paired-cover rig. Original GLB bytes stay untouched.
 * Hindwing membranes are authored reconstructions, absent from the scan. */
export function articulateRoachWings(model) {
  let parent = null;
  model.traverse((object) => { if (object.userData.jointId === 'wings') parent = object; });
  if (!parent || parent.userData.fourWings) return null;
  const originals = [];
  parent.traverse((object) => { if (object.isMesh && !object.isSkinnedMesh && object.geometry?.attributes?.position) originals.push(object); });
  if (originals.length !== 1) return null;
  model.updateMatrixWorld(true);
  const original = originals[0];
  const matrix = parent.matrixWorld.clone().invert().multiply(original.matrixWorld);
  const temporary = original.geometry.clone().applyMatrix4(matrix);
  temporary.computeBoundingBox();
  const bounds = temporary.boundingBox;
  const span = bounds.getSize(new THREE.Vector3());
  const positions = temporary.attributes.position;
  const bins = Array.from({ length: 20 }, () => ({ min: Infinity, max: -Infinity, y: 0, count: 0 }));
  const frontZ = [];
  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i), y = positions.getY(i);
    const bin = bins[Math.min(19, Math.floor((y - bounds.min.y) / span.y * 20))];
    bin.min = Math.min(bin.min, x); bin.max = Math.max(bin.max, x); bin.y += y; bin.count += 1;
    if (y > bounds.max.y - span.y * .14) frontZ.push(positions.getZ(i));
  }
  const samples = bins.slice(2, 18).filter((bin) => bin.count).map((bin) => [(bin.min + bin.max) / 2, bin.y / bin.count]);
  const mx = samples.reduce((sum, point) => sum + point[0], 0) / samples.length;
  const my = samples.reduce((sum, point) => sum + point[1], 0) / samples.length;
  const slope = samples.reduce((sum, point) => sum + (point[0] - mx) * (point[1] - my), 0)
    / Math.max(1e-8, samples.reduce((sum, point) => sum + (point[1] - my) ** 2, 0));
  const intercept = mx - slope * my;
  const halves = splitRoachWingGeometry(original.geometry, { matrix, slope, intercept });
  const hingeY = bounds.max.y - span.y * .09;
  const centerX = slope * hingeY + intercept;
  frontZ.sort((a, b) => a - b);
  const hingeZ = frontZ[Math.floor(frontZ.length / 2)] ?? bounds.min.z;
  const leaves = [];
  const fans = [];
  for (const [side, sign, index] of [['left', 1, 0], ['right', -1, 1]]) {
    for (const type of ['cover', 'hind']) {
      const joint = new THREE.Group();
      joint.name = `roach_joint_wing_${type}_${side}`;
      joint.position.set(centerX + sign * span.x * .13, hingeY - (type === 'hind' ? span.y * .04 : 0), hingeZ + (type === 'hind' ? span.z * .11 : 0));
      joint.userData = { roachJoint: true, jointId: `wing_${type}_${side}`, displayName: `${side === 'left' ? 'Left' : 'Right'} ${type === 'cover' ? 'wing cover' : 'hindwing'}`,
        jointGroup: type === 'cover' ? 'Wing covers' : 'Hindwings', suggestedRotationLimitDegrees: 90,
        wingOpenSign: sign, wingLayer: type, authoredReconstruction: type === 'hind' };
      parent.add(joint);
      leaves.push(joint);
      if (type === 'cover') {
        halves[index].translate(-joint.position.x, -joint.position.y, -joint.position.z);
        const mesh = new THREE.Mesh(halves[index], original.material);
        mesh.name = `${side} split photogrammetry wing cover`;
        mesh.userData.splitPhotogrammetryCover = true;
        joint.add(mesh);
      } else {
        const fan = authoredHindwing(span.y * .8, sign);
        joint.add(fan.membrane, fan.veinLines);
        fans.push({ joint, ...fan });
      }
    }
  }
  original.removeFromParent();
  // This geometry was unique to the removed paired mesh; materials/textures
  // are still shared by the two replacement covers and must stay alive.
  let shared = false;
  model.traverse((object) => { if (object.geometry === original.geometry) shared = true; });
  if (!shared) original.geometry.dispose();
  temporary.dispose();
  parent.userData.fourWings = true;
  parent.userData.displayName = 'All four wings';
  return { parent, leaves, fans, sourceTriangles: (original.geometry.index?.count ?? positions.count) / 3,
    coverTriangles: halves.reduce((sum, geometry) => sum + geometry.index.count / 3, 0), unfolded: 0 };
}

export function updateRoachWingFans(rig) {
  if (!rig) return 0;
  let openness = 0;
  for (const joint of rig.leaves) {
    const angle = 2 * Math.acos(clamp(Math.abs(joint.quaternion.w), 0, 1));
    openness = Math.max(openness, angle);
  }
  for (const fan of rig.fans) {
    const angle = 2 * Math.acos(clamp(Math.abs(fan.joint.quaternion.w), 0, 1));
    const amount = clamp(angle / (Math.PI * .32), 0, 1);
    fan.membrane.morphTargetInfluences[0] = amount;
    fan.veinLines.morphTargetInfluences[0] = amount;
    fan.membrane.visible = amount > .015;
    fan.veinLines.visible = amount > .015;
    fan.membrane.material.opacity = .48 * clamp(amount / .2, 0, 1);
  }
  rig.unfolded = openness;
  return openness;
}

export function roachWingDisplayPoints(rig) {
  if (!rig) return [];
  const result = [];
  const point = new THREE.Vector3();
  for (const joint of rig.leaves) joint.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const box = new THREE.Box3();
    if (mesh.geometry.morphAttributes.position?.length) {
      for (let i = 0; i < mesh.geometry.attributes.position.count; i += 1) { mesh.getVertexPosition(i, point); box.expandByPoint(point); }
    } else box.copy(mesh.geometry.boundingBox);
    for (let mask = 0; mask < 8; mask += 1) result.push(new THREE.Vector3(mask & 1 ? box.max.x : box.min.x,
      mask & 2 ? box.max.y : box.min.y, mask & 4 ? box.max.z : box.min.z).applyMatrix4(mesh.matrixWorld));
  });
  return result;
}
