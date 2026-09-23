import { closestPointOnSegment, convexHull, pointInPolygon } from "../../families/physics/physics-common.js";

const DEGREES_PER_SPAN = 240;
const wrapDegrees = value => ((value + 180) % 360 + 360) % 360 - 180;

/** Pick against the body's projected outer outline, not the larger reader quad. */
export function pickShapes3dDragTarget(point, projectedVertices, tolerance = 12) {
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return "shape";
  const hull = convexHull((projectedVertices ?? []).filter(vertex => Number.isFinite(vertex?.x) && Number.isFinite(vertex?.y)));
  const padding = Number.isFinite(tolerance) ? Math.max(0, tolerance) : 12;
  const inside = hull.length >= 3 && pointInPolygon(point, hull);
  const onOutline = hull.some((a, index) => closestPointOnSegment(point, a, hull[(index + 1) % hull.length]).distance <= padding);
  return inside || onOutline ? "reader" : "shape";
}

/** Capture a drag and pause only the two axes owned by that gesture. */
export function beginShapes3dRotation(state, target) {
  if (state.selection.dimension !== "3d") return null;
  if (target !== "shape" && target !== "reader") throw new TypeError("Unknown 3D drag target");
  const local = state.dimension["3d"];
  if (target === "reader") {
    local.rotationMotion.readerYaw.running = false;
    local.rotationMotion.readerPitch.running = false;
    return Object.freeze({ target, yaw: local.readerYaw, pitch: local.readerPitch });
  }
  local.rotationRunning = false;
  local.rotationMotion.x.running = false;
  local.rotationMotion.y.running = false;
  return Object.freeze({ target, yaw: local.rotation.y, pitch: local.rotation.x });
}

/** Drag fractions are measured against the canvas size captured on pointerdown. */
export function updateShapes3dRotation(state, start, horizontal, vertical) {
  if (state.selection.dimension !== "3d" || !start || !["shape", "reader"].includes(start.target)) return false;
  const yaw = start.yaw + horizontal * DEGREES_PER_SPAN;
  const pitch = start.pitch - vertical * DEGREES_PER_SPAN;
  if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return false;
  const local = state.dimension["3d"];
  if (start.target === "reader") {
    local.readerYaw = wrapDegrees(yaw);
    local.readerPitch = wrapDegrees(pitch);
  } else {
    local.rotation.y = wrapDegrees(yaw);
    local.rotation.x = wrapDegrees(pitch);
  }
  return true;
}
