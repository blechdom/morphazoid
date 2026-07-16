/** Pure wireframe geometry for the Solid instrument. */

const TAU = Math.PI * 2;
const EPSILON = 1e-8;

function edge(a, b) {
  return { a, b };
}

function indexedSolid(type, vertices, pairs) {
  return {
    type,
    vertices,
    edges: pairs.map(([a, b]) => edge(a, b)),
  };
}

function cube() {
  const vertices = [];
  for (const z of [-0.72, 0.72]) {
    for (const y of [-0.72, 0.72]) {
      for (const x of [-0.72, 0.72]) vertices.push({ x, y, z });
    }
  }
  const pairs = [];
  for (let a = 0; a < vertices.length; a += 1) {
    for (let b = a + 1; b < vertices.length; b += 1) {
      const differences = ["x", "y", "z"].filter(
        (axis) => Math.abs(vertices[a][axis] - vertices[b][axis]) > EPSILON,
      );
      if (differences.length === 1) pairs.push([a, b]);
    }
  }
  return indexedSolid("cube", vertices, pairs);
}

function pyramid() {
  return indexedSolid("pyramid", [
    { x: -0.82, y: -0.62, z: -0.82 },
    { x: 0.82, y: -0.62, z: -0.82 },
    { x: 0.82, y: -0.62, z: 0.82 },
    { x: -0.82, y: -0.62, z: 0.82 },
    { x: 0, y: 0.92, z: 0 },
  ], [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [0, 4], [1, 4], [2, 4], [3, 4],
  ]);
}

function cone(segments = 16) {
  const vertices = [{ x: 0, y: 0.95, z: 0 }];
  for (let index = 0; index < segments; index += 1) {
    const angle = index / segments * TAU;
    vertices.push({ x: Math.cos(angle) * 0.78, y: -0.72, z: Math.sin(angle) * 0.78 });
  }
  const pairs = [];
  for (let index = 0; index < segments; index += 1) {
    const current = index + 1;
    const next = (index + 1) % segments + 1;
    pairs.push([current, next], [0, current]);
  }
  return indexedSolid("cone", vertices, pairs);
}

function sphere(longitudes = 12, latitudes = 7) {
  const vertices = [];
  for (let latitude = 0; latitude < latitudes; latitude += 1) {
    const vertical = latitude / (latitudes - 1);
    const polar = vertical * Math.PI;
    const radius = Math.sin(polar) * 0.88;
    const y = Math.cos(polar) * 0.88;
    for (let longitude = 0; longitude < longitudes; longitude += 1) {
      const angle = longitude / longitudes * TAU;
      vertices.push({ x: Math.cos(angle) * radius, y, z: Math.sin(angle) * radius });
    }
  }
  const pairs = [];
  for (let latitude = 0; latitude < latitudes; latitude += 1) {
    for (let longitude = 0; longitude < longitudes; longitude += 1) {
      const current = latitude * longitudes + longitude;
      const nextLongitude = latitude * longitudes + (longitude + 1) % longitudes;
      if (latitude > 0 && latitude < latitudes - 1) pairs.push([current, nextLongitude]);
      if (latitude < latitudes - 1) pairs.push([current, current + longitudes]);
    }
  }
  return indexedSolid("sphere", vertices, pairs);
}

export function buildSolid(type = "cube") {
  if (type === "sphere") return sphere();
  if (type === "cone") return cone();
  if (type === "pyramid") return pyramid();
  return cube();
}

export function planeNormal(yawDegrees = 0, pitchDegrees = 0) {
  const yaw = yawDegrees * Math.PI / 180;
  const pitch = pitchDegrees * Math.PI / 180;
  return {
    x: Math.cos(pitch) * Math.cos(yaw),
    y: Math.sin(pitch),
    z: Math.cos(pitch) * Math.sin(yaw),
  };
}

export function rotatePoint3(point, rotation = {}) {
  const rx = (rotation.x ?? 0) * Math.PI / 180;
  const ry = (rotation.y ?? 0) * Math.PI / 180;
  const rz = (rotation.z ?? 0) * Math.PI / 180;
  let { x, y, z } = point;
  [y, z] = [y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)];
  [x, z] = [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)];
  [x, y] = [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz)];
  return { x, y, z };
}

export function projectPoint3(point, perspective = 3.4) {
  const depth = Math.max(1.2, perspective - point.z);
  const scale = perspective / depth;
  return { x: point.x * scale, y: point.y * scale, z: point.z, scale };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** Intersect the wireframe segments with n·p = offset. */
export function planeIntersections(solid, normal, offset, epsilon = 1e-7) {
  const contacts = [];
  solid.edges.forEach(({ a, b }, edgeIndex) => {
    const pointA = solid.vertices[a];
    const pointB = solid.vertices[b];
    const distanceA = dot(normal, pointA) - offset;
    const distanceB = dot(normal, pointB) - offset;
    if (Math.abs(distanceA) <= epsilon && Math.abs(distanceB) <= epsilon) {
      for (const [vertexIndex, point, t] of [[a, pointA, 0], [b, pointB, 1]]) {
        contacts.push({ ...point, edgeIndex, vertexIndex, t, cornerStrength: 1 });
      }
      return;
    }
    if (distanceA * distanceB > 0) return;
    const denominator = distanceA - distanceB;
    if (Math.abs(denominator) <= epsilon) return;
    const t = Math.max(0, Math.min(1, distanceA / denominator));
    const nearEndpoint = Math.min(t, 1 - t);
    contacts.push({
      x: pointA.x + (pointB.x - pointA.x) * t,
      y: pointA.y + (pointB.y - pointA.y) * t,
      z: pointA.z + (pointB.z - pointA.z) * t,
      edgeIndex,
      vertexIndex: nearEndpoint <= epsilon ? (t < 0.5 ? a : b) : null,
      t,
      cornerStrength: Math.exp(-nearEndpoint * 18),
    });
  });

  contacts.sort((a, b) => a.y - b.y || a.z - b.z || a.x - b.x);
  const deduped = [];
  for (const contact of contacts) {
    const previous = deduped.find((item) => (
      Math.hypot(item.x - contact.x, item.y - contact.y, item.z - contact.z) <= epsilon * 4
    ));
    if (previous) {
      previous.cornerStrength = Math.max(previous.cornerStrength, contact.cornerStrength);
      if (previous.vertexIndex === null) previous.vertexIndex = contact.vertexIndex;
    } else deduped.push(contact);
  }
  return deduped;
}

export function planeOffsetForPhase(phase, radius = 1.05) {
  const wrapped = ((phase % 1) + 1) % 1;
  return (wrapped * 2 - 1) * radius;
}

export function planeBasis(normal) {
  const reference = Math.abs(normal.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const firstLength = Math.hypot(
    reference.y * normal.z - reference.z * normal.y,
    reference.z * normal.x - reference.x * normal.z,
    reference.x * normal.y - reference.y * normal.x,
  ) || 1;
  const u = {
    x: (reference.y * normal.z - reference.z * normal.y) / firstLength,
    y: (reference.z * normal.x - reference.x * normal.z) / firstLength,
    z: (reference.x * normal.y - reference.y * normal.x) / firstLength,
  };
  return {
    u,
    v: {
      x: normal.y * u.z - normal.z * u.y,
      y: normal.z * u.x - normal.x * u.z,
      z: normal.x * u.y - normal.y * u.x,
    },
  };
}
