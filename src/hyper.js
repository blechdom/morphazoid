/** Pure 4D tesseract projection and hyperplane intersection helpers. */

import { sharedProfilePoints } from "./shapes-profile.js";

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

export function buildHypersphere(radius = 0.88, chiSteps = 3, uSteps = 6, vSteps = 6) {
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

export function buildKleinBottle(radius = 0.82, uSteps = 12, vSteps = 8) {
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

export function buildProfileHyperprism(profile = {}) {
  const shared = sharedProfilePoints(profile, 0.7);
  const count = shared.points.length;
  const vertices = [];
  for (const z of [-0.56, 0.56]) {
    for (const w of [-0.56, 0.56]) {
      for (const point of shared.points) vertices.push({ ...point, z, w });
    }
  }
  const at = (zIndex, wIndex, pointIndex) => (
    (zIndex * 2 + wIndex) * count + pointIndex
  );
  const edges = [];
  for (let zIndex = 0; zIndex < 2; zIndex += 1) {
    for (let wIndex = 0; wIndex < 2; wIndex += 1) {
      for (let index = 0; index < count; index += 1) {
        if (shared.closed || index + 1 < count) {
          const next = shared.closed ? (index + 1) % count : index + 1;
          edges.push({
            a: at(zIndex, wIndex, index),
            b: at(zIndex, wIndex, next),
            axis: "u",
          });
        }
        if (zIndex === 0) {
          edges.push({
            a: at(0, wIndex, index),
            b: at(1, wIndex, index),
            axis: "z",
          });
        }
        if (wIndex === 0) {
          edges.push({
            a: at(zIndex, 0, index),
            b: at(zIndex, 1, index),
            axis: "w",
          });
        }
      }
    }
  }
  return { type: "profile", profile: shared, vertices, edges };
}

export function buildHyperShape(type = "tesseract", options = {}) {
  if (type === "profile") return buildProfileHyperprism(options.profile ?? options);
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

export function hyperplaneWRange(shape = {}) {
  const values = Array.isArray(shape?.vertices)
    ? shape.vertices
      .map(({ w }) => Number(w))
      .filter(Number.isFinite)
    : [];
  if (!values.length) return { minW: 0, maxW: 0, span: 0 };
  const minW = Math.min(...values);
  const maxW = Math.max(...values);
  return { minW, maxW, span: maxW - minW };
}

/**
 * Move a looping W-plane across exactly the occupied extent of a transformed
 * shape. Rotation can make that extent narrower, wider, or asymmetric, so a
 * fixed radius would introduce silent travel or miss the shape's extremes.
 */
export function hyperplaneOffsetForShapePhase(shape, phase) {
  const wrapped = ((Number(phase) % 1) + 1) % 1;
  const { minW, maxW } = hyperplaneWRange(shape);
  return minW + (maxW - minW) * wrapped;
}

export function crossedHyperplaneLoop(previousPhase, nextPhase) {
  const previous = Number(previousPhase);
  const next = Number(nextPhase);
  if (!Number.isFinite(previous) || !Number.isFinite(next)) return false;
  return Math.floor(previous) !== Math.floor(next);
}

export function crossedHyperplaneVertex(previousDistance, nextDistance, epsilon = 1e-7) {
  const previous = Number(previousDistance);
  const next = Number(nextDistance);
  if (!Number.isFinite(previous) || !Number.isFinite(next)) return false;
  const threshold = Math.max(EPSILON, Math.abs(Number(epsilon) || 0));
  if (Math.abs(next) <= threshold) return false;
  if (Math.abs(previous) <= threshold) return true;
  return previous * next < 0;
}

export function transformedTesseract(rotation) {
  return transformedHyperShape("tesseract", rotation);
}

export function transformedHyperShape(type, rotation, form = {}) {
  const source = buildHyperShape(type, form.profile ?? {});
  const scale = {
    x: Math.max(0.4, Math.min(1.6, Number(form.x) || 1)),
    y: Math.max(0.4, Math.min(1.6, Number(form.y) || 1)),
    z: Math.max(0.4, Math.min(1.6, Number(form.z) || 1)),
    w: Math.max(0.4, Math.min(1.6, Number(form.w) || 1)),
  };
  return {
    ...source,
    vertices: source.vertices.map((point) => rotatePoint4({
      x: point.x * scale.x,
      y: point.y * scale.y,
      z: point.z * scale.z,
      w: point.w * scale.w,
    }, rotation)),
  };
}

export function near4(a, b, epsilon = EPSILON) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z, a.w - b.w) <= epsilon;
}
