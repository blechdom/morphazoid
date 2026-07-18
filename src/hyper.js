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

export function buildHyperPyramid(radius = 0.66) {
  const vertices = Array.from({ length: 8 }, (_, index) => ({
    x: index & 1 ? radius : -radius,
    y: index & 2 ? radius : -radius,
    z: index & 4 ? radius : -radius,
    w: -0.48,
  }));
  vertices.push({ x: 0, y: 0, z: 0, w: 1.05 });
  const axes = ["x", "y", "z"];
  const edges = [];
  for (let index = 0; index < 8; index += 1) {
    for (let axis = 0; axis < axes.length; axis += 1) {
      const neighbor = index ^ (1 << axis);
      if (index < neighbor) edges.push({ a: index, b: neighbor, axis: axes[axis] });
    }
    edges.push({ a: index, b: 8, axis: "w" });
  }
  return { vertices, edges };
}

export function buildHypersphere(radius = 0.88, chiSteps = 5, uSteps = 10, vSteps = 8) {
  const vertices = [];
  const indexFor = (chi, u, v) => (chi * uSteps + u) * vSteps + v;
  for (let chi = 0; chi < chiSteps; chi += 1) {
    const chiAngle = (chi + 0.5) / chiSteps * Math.PI / 2;
    for (let u = 0; u < uSteps; u += 1) {
      const uAngle = u / uSteps * Math.PI * 2;
      for (let v = 0; v < vSteps; v += 1) {
        const vAngle = v / vSteps * Math.PI * 2;
        vertices.push({
          x: radius * Math.cos(chiAngle) * Math.cos(uAngle),
          y: radius * Math.cos(chiAngle) * Math.sin(uAngle),
          z: radius * Math.sin(chiAngle) * Math.cos(vAngle),
          w: radius * Math.sin(chiAngle) * Math.sin(vAngle),
        });
      }
    }
  }
  const edges = [];
  for (let chi = 0; chi < chiSteps; chi += 1) {
    for (let u = 0; u < uSteps; u += 1) {
      for (let v = 0; v < vSteps; v += 1) {
        const current = indexFor(chi, u, v);
        edges.push({ a: current, b: indexFor(chi, (u + 1) % uSteps, v), axis: "u" });
        edges.push({ a: current, b: indexFor(chi, u, (v + 1) % vSteps), axis: "v" });
        if (chi + 1 < chiSteps) {
          edges.push({ a: current, b: indexFor(chi + 1, u, v), axis: "w" });
        }
      }
    }
  }
  return { vertices, edges };
}

export function buildKleinBottle(radius = 0.82, uSteps = 20, vSteps = 12) {
  const vertices = [];
  const indexFor = (u, v) => u * vSteps + v;
  for (let u = 0; u < uSteps; u += 1) {
    const uAngle = u / uSteps * Math.PI * 2;
    for (let v = 0; v < vSteps; v += 1) {
      const vAngle = v / vSteps * Math.PI * 2;
      const tube = 1.35 + 0.45 * Math.cos(vAngle);
      vertices.push({
        x: radius * tube * Math.cos(uAngle) / 1.8,
        y: radius * tube * Math.sin(uAngle) / 1.8,
        z: radius * 0.62 * Math.sin(vAngle) * Math.cos(uAngle / 2),
        w: radius * 0.62 * Math.sin(vAngle) * Math.sin(uAngle / 2),
      });
    }
  }
  const edges = [];
  for (let u = 0; u < uSteps; u += 1) {
    for (let v = 0; v < vSteps; v += 1) {
      const current = indexFor(u, v);
      const nextU = u + 1 < uSteps
        ? indexFor(u + 1, v)
        : indexFor(0, (vSteps - v) % vSteps);
      edges.push({ a: current, b: nextU, axis: u + 1 < uSteps ? "u" : "w" });
      edges.push({ a: current, b: indexFor(u, (v + 1) % vSteps), axis: "v" });
    }
  }
  return { vertices, edges };
}

export function buildHyperShape(type = "tesseract") {
  if (type === "hypersphere") return buildHypersphere();
  if (type === "hyperpyramid") return buildHyperPyramid();
  if (type === "klein") return buildKleinBottle();
  return buildTesseract();
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
  return transformedHyperShape("tesseract", rotation);
}

export function transformedHyperShape(type, rotation) {
  const source = buildHyperShape(type);
  return {
    ...source,
    vertices: source.vertices.map((point) => rotatePoint4(point, rotation)),
  };
}

export function near4(a, b, epsilon = EPSILON) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z, a.w - b.w) <= epsilon;
}
