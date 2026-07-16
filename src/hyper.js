/** Pure 4D tesseract projection and hyperplane intersection helpers. */

const EPSILON = 1e-8;

export function buildTesseract(radius = 0.68) {
  const axes = ["x", "y", "z", "w"];
  const vertices = Array.from({ length: 16 }, (_, index) => ({
    x: index & 1 ? radius : -radius,
    y: index & 2 ? radius : -radius,
    z: index & 4 ? radius : -radius,
    w: index & 8 ? radius : -radius,
  }));
  const edges = [];
  for (let index = 0; index < vertices.length; index += 1) {
    for (let axis = 0; axis < axes.length; axis += 1) {
      const neighbor = index ^ (1 << axis);
      if (index < neighbor) edges.push({ a: index, b: neighbor, axis: axes[axis] });
    }
  }
  return { vertices, edges };
}

function rotatePlane(point, first, second, degrees) {
  const angle = degrees * Math.PI / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const result = { ...point };
  result[first] = point[first] * cosine - point[second] * sine;
  result[second] = point[first] * sine + point[second] * cosine;
  return result;
}

export function rotatePoint4(point, rotation = {}) {
  let result = { ...point };
  result = rotatePlane(result, "x", "w", rotation.xw ?? 0);
  result = rotatePlane(result, "y", "w", rotation.yw ?? 0);
  result = rotatePlane(result, "z", "w", rotation.zw ?? 0);
  result = rotatePlane(result, "x", "y", rotation.xy ?? 0);
  result = rotatePlane(result, "y", "z", rotation.yz ?? 0);
  return result;
}

export function projectPoint4(point, distance = 2.7) {
  const factor = distance / Math.max(1.1, distance - point.w);
  return { x: point.x * factor, y: point.y * factor, z: point.z * factor, w: point.w, factor };
}

export function hyperplaneIntersections(tesseract, offset, epsilon = 1e-7) {
  const contacts = [];
  tesseract.edges.forEach(({ a, b, axis }, edgeIndex) => {
    const pointA = tesseract.vertices[a];
    const pointB = tesseract.vertices[b];
    const before = pointA.w - offset;
    const after = pointB.w - offset;
    if (before * after > 0) return;
    const denominator = pointB.w - pointA.w;
    if (Math.abs(denominator) <= epsilon) return;
    const t = Math.max(0, Math.min(1, (offset - pointA.w) / denominator));
    contacts.push({
      x: pointA.x + (pointB.x - pointA.x) * t,
      y: pointA.y + (pointB.y - pointA.y) * t,
      z: pointA.z + (pointB.z - pointA.z) * t,
      w: offset,
      edgeIndex,
      axis,
      t,
      vertexIndex: t <= epsilon ? a : t >= 1 - epsilon ? b : null,
      cornerStrength: Math.exp(-Math.min(t, 1 - t) * 16),
    });
  });
  return contacts;
}

export function hyperplaneOffsetForPhase(phase, radius = 1.25) {
  const wrapped = ((phase % 1) + 1) % 1;
  return (wrapped * 2 - 1) * radius;
}

export function transformedTesseract(rotation) {
  const source = buildTesseract();
  return {
    ...source,
    vertices: source.vertices.map((point) => rotatePoint4(point, rotation)),
  };
}

export function near4(a, b, epsilon = EPSILON) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z, a.w - b.w) <= epsilon;
}
