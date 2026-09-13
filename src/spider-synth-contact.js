import { createSpiderCollisionBodies, writeSpiderCollisionBodies } from './spider-synth-collision.js';

export function spiderFootNeutralX(geometry) {
  if (!geometry.id.endsWith('_1') || geometry.lengths[0] <= geometry.reach - geometry.lengths[0]) return geometry.neutral[0];
  return Math.sign(geometry.hip[0]) * Math.max(Math.abs(geometry.neutral[0]), Math.abs(geometry.hip[0]) + geometry.radii[0] * 3.5);
}

/** Fixed-size shared toe clearance. Every dimension comes from the active rig;
 * no triangles or rendering objects are needed by the audio-owned planner. */
export function createSpiderFootClearance(profile) {
  return { profile, bodies: createSpiderCollisionBodies(profile), radii: profile.legs.map(leg => leg.radii[3]),
    feet: null, footCount: 8, legIndex: -1, radius: 0, margin: profile.tolerance * 2,
    intervals: new Float64Array(64), planes: null, hipPlane: null, sidePlane: null, outward: { x: 0, y: 0, z: 0, offset: 0 }, side: { x: 0, y: 0, z: 0, offset: 0 }, cells: Array.from({ length: 7 }, () => ({ x: 0, y: 0, z: 0, offset: 0 })), body: { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 } };
}
export function writeSpiderFootClearance(clearance, pose, body, feet = null, legIndex = -1, footCount = 8) {
  writeSpiderCollisionBodies(clearance.profile, pose, body, clearance.bodies);
  clearance.feet = feet; clearance.legIndex = legIndex; clearance.footCount = footCount; clearance.planes = null; clearance.hipPlane = null; clearance.sidePlane = null; clearance.within = null; clearance.reservations = false;
  clearance.radius = clearance.radii[legIndex] || 0;
  return clearance;
}
export function writeSpiderFootOutward(clearance, geometry, body, buffer = 0) {
  const plane = clearance.outward, nx = geometry.neutral[0] - geometry.hip[0], nz = geometry.neutral[2] - geometry.hip[2], length = Math.hypot(nx, nz), c = Math.cos(body.yaw), s = Math.sin(body.yaw);
  plane.x = (nx * c + nz * s) / length; plane.y = 0; plane.z = (nz * c - nx * s) / length;
  const hx = body.x + geometry.hip[0] * c + geometry.hip[2] * s, hz = body.z + geometry.hip[2] * c - geometry.hip[0] * s;
  plane.offset = hx * plane.x + hz * plane.z + geometry.reach * .08 + buffer;
  const side = Math.sign(geometry.hip[0]) || 1, other = clearance.side;
  other.x = side * c; other.y = 0; other.z = -side * s;
  const longFirst = geometry.lengths[0] > geometry.reach - geometry.lengths[0];
  // A first link longer than the remaining chain cannot fold behind its own
  // shoulder. Reserve its measured capsule width outside the attachment;
  // otherwise a reachable toe can still force that rigid link through a palp.
  other.offset = longFirst
    ? hx * other.x + hz * other.z + geometry.radii[0] * 1.3 + buffer
    : body.x * other.x + body.z * other.z + Math.max(.001, geometry.radii[3] * .25) + buffer;
  // Long front femora cannot reach across the face. Rear legs can reach around
  // the abdomen while remaining inside their outward cone; a universal lateral
  // plane would strand a short hind leg on sparse ladder webs.
  clearance.sidePlane = geometry.id.endsWith('_1') ? other : null;
  clearance.hipPlane = plane; return clearance;
}
export function spiderFootFacesOutward(foot, clearance, geometry, body, lateral = true) {
  writeSpiderFootOutward(clearance, geometry, body); const p = clearance.hipPlane;
  const side = clearance.sidePlane;
  return foot.x * p.x + foot.y * p.y + foot.z * p.z >= p.offset - 1e-10 && (!lateral || !side || foot.x * side.x + foot.y * side.y + foot.z * side.z >= side.offset - 1e-10);
}
/** Disjoint local foothold cells leave each leg its own toe-width clearance.
 * They are fixed at touchdown, so a held contact never follows later body sway. */
export function writeSpiderFootCell(clearance, geometry, legIndex, body) {
  const a = geometry[legIndex].neutral, c = Math.cos(body.yaw), s = Math.sin(body.yaw); let count = 0;
  for (let j = 0; j < 8; j++) if (j !== legIndex) {
    const b = geometry[j].neutral, length = Math.hypot(a[0] - b[0], a[2] - b[2]);
    // Only overlapping resting toe neighborhoods need a separating cell.
    // Extending every bisector across the entire web would unnecessarily
    // forbid a short leg's sole reachable strand in a sparse construction.
    const combined = clearance.radii[legIndex] + clearance.radii[j];
    if (length > combined + Math.max(.04, combined * 3)) continue;
    const nx = (a[0] - b[0]) / Math.max(1e-9, length), nz = (a[2] - b[2]) / Math.max(1e-9, length), plane = clearance.cells[count++];
    plane.x = nx * c + nz * s; plane.y = 0; plane.z = nz * c - nx * s;
    plane.offset = plane.x * body.x + plane.z * body.z + nx * (a[0] + b[0]) * .5 + nz * (a[2] + b[2]) * .5 + clearance.radii[legIndex] + clearance.margin + .006 + Math.min(.045, Math.max(clearance.radii[legIndex], clearance.radii[j]) * 1.4);
  }
  clearance.planes = count ? clearance.cells : null; clearance.planeCount = count; return clearance;
}
export function spiderFootClearsBodies(foot, clearance, legIndex = clearance.legIndex) {
  const padding = clearance.radii[legIndex] + clearance.margin;
  for (const body of clearance.bodies) {
    const axes = body.axes, c = body.worldCenter, x = foot.x - c.x, y = foot.y - c.y, z = foot.z - c.z;
    const a = (axes[0] * x + axes[3] * y + axes[6] * z) / (body.radii[0] + padding);
    const b = (axes[1] * x + axes[4] * y + axes[7] * z) / (body.radii[1] + padding);
    const d = (axes[2] * x + axes[5] * y + axes[8] * z) / (body.radii[2] + padding);
    if (a * a + b * b + d * d < 1 - 1e-8) return false;
  }
  return true;
}
export function spiderFeetClear(a, b, clearance, i, j) {
  const radius = clearance.radii[i] + clearance.radii[j] + clearance.margin;
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2 >= radius * radius - 1e-12;
}
