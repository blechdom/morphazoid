/** Bounded solid proxies for authored scan rigs, not a triangle collision engine.
 * Shared pose limits are cheap enough for control-rate audio. Multi-chain
 * clearance runs only in the viewer and keeps strand contacts pinned. */
const finite = (x, fallback = 0) => Number.isFinite(Number(x)) ? Number(x) : fallback;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, finite(x)));
const point = (p = [0, 0, 0]) => ({ x: finite(p.x ?? p[0]), y: finite(p.y ?? p[1]), z: finite(p.z ?? p[2]) });
const copy = (a, b) => { a.x = b.x; a.y = b.y; a.z = b.z; return a; };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const scratchByProfile = new WeakMap();
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function rotation(x, y, z, out) {
  const a = Math.cos(x), b = Math.sin(x), c = Math.cos(y), d = Math.sin(y), e = Math.cos(z), f = Math.sin(z);
  out[0] = c * e; out[1] = -c * f; out[2] = d;
  out[3] = a * f + b * e * d; out[4] = a * e - b * f * d; out[5] = -b * c;
  out[6] = b * f - a * e * d; out[7] = b * e + a * f * d; out[8] = a * c;
  return out;
}
function rotationYXZ(x, y, z, out) {
  const a = Math.cos(x), b = Math.sin(x), c = Math.cos(y), d = Math.sin(y), e = Math.cos(z), f = Math.sin(z);
  out[0] = c * e + d * b * f; out[1] = d * b * e - c * f; out[2] = d * a;
  out[3] = a * f; out[4] = a * e; out[5] = -b;
  out[6] = c * b * f - d * e; out[7] = d * f + c * b * e; out[8] = c * a;
  return out;
}
function multiply(a, b, out) {
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) out[row * 3 + col] = a[row * 3] * b[col] + a[row * 3 + 1] * b[3 + col] + a[row * 3 + 2] * b[6 + col];
  return out;
}
function transform(p, matrix, origin, out) {
  const x = p.x, y = p.y, z = p.z;
  out.x = origin.x + matrix[0] * x + matrix[1] * y + matrix[2] * z;
  out.y = origin.y + matrix[3] * x + matrix[4] * y + matrix[5] * z;
  out.z = origin.z + matrix[6] * x + matrix[7] * y + matrix[8] * z;
  return out;
}

/** Exact closest points of two bounded line segments; reusable output. */
export function spiderSegmentDistance(a, b, c, d, out = {}) {
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
  const vx = d.x - c.x, vy = d.y - c.y, vz = d.z - c.z;
  const wx = a.x - c.x, wy = a.y - c.y, wz = a.z - c.z;
  const aa = ux * ux + uy * uy + uz * uz, bb = ux * vx + uy * vy + uz * vz;
  const cc = vx * vx + vy * vy + vz * vz, dd = ux * wx + uy * wy + uz * wz, ee = vx * wx + vy * wy + vz * wz;
  let s = 0, t = 0;
  if (aa < 1e-16 && cc < 1e-16) { s = 0; t = 0; }
  else if (aa < 1e-16) t = clamp(ee / cc, 0, 1);
  else if (cc < 1e-16) s = clamp(-dd / aa, 0, 1);
  else {
    const denominator = aa * cc - bb * bb;
    s = denominator > 1e-16 ? clamp((bb * ee - cc * dd) / denominator, 0, 1) : 0;
    t = (bb * s + ee) / cc;
    if (t < 0) { t = 0; s = clamp(-dd / aa, 0, 1); }
    else if (t > 1) { t = 1; s = clamp((bb - dd) / aa, 0, 1); }
  }
  out.s = s; out.t = t;
  out.x = a.x + s * ux - c.x - t * vx;
  out.y = a.y + s * uy - c.y - t * vy;
  out.z = a.z + s * uz - c.z - t * vz;
  out.distance = Math.hypot(out.x, out.y, out.z);
  return out;
}

/** Segment against a solid ellipsoid expanded by a link's thickness. */
export function spiderEllipsoidPenetration(a, b, body, radius, out = {}) {
  const axes = body.axes || IDENTITY, center = body.worldCenter || body.center;
  const ax = a.x - center.x, ay = a.y - center.y, az = a.z - center.z;
  const bx = b.x - a.x, by = b.y - a.y, bz = b.z - a.z;
  const rx = body.radii[0] + radius, ry = body.radii[1] + radius, rz = body.radii[2] + radius;
  const x = (axes[0] * ax + axes[3] * ay + axes[6] * az) / rx;
  const y = (axes[1] * ax + axes[4] * ay + axes[7] * az) / ry;
  const z = (axes[2] * ax + axes[5] * ay + axes[8] * az) / rz;
  const dx = (axes[0] * bx + axes[3] * by + axes[6] * bz) / rx;
  const dy = (axes[1] * bx + axes[4] * by + axes[7] * bz) / ry;
  const dz = (axes[2] * bx + axes[5] * by + axes[8] * bz) / rz;
  const denominator = dx * dx + dy * dy + dz * dz;
  const u = denominator > 1e-16 ? clamp(-(x * dx + y * dy + z * dz) / denominator, 0, 1) : 0;
  const px = x + dx * u, py = y + dy * u, pz = z + dz * u;
  const length = Math.hypot(px, py, pz);
  // Distance along the actual gradient supplies a useful world-unit correction.
  const gx = px / rx, gy = py / ry, gz = pz / rz, gradient = Math.hypot(gx, gy, gz);
  const nx = gradient > 1e-10 ? gx / gradient : 0, ny = gradient > 1e-10 ? gy / gradient : 1, nz = gradient > 1e-10 ? gz / gradient : 0;
  out.x = axes[0] * nx + axes[1] * ny + axes[2] * nz;
  out.y = axes[3] * nx + axes[4] * ny + axes[5] * nz;
  out.z = axes[6] * nx + axes[7] * ny + axes[8] * nz;
  out.s = u; out.penetration = length < 1 ? (1 - length) * length / Math.max(1e-10, gradient) : 0;
  if (length < 1e-10) out.penetration = Math.min(rx, ry, rz);
  return out;
}

function bodyProxy(meta, joints) {
  const index = joints.findIndex(j => j.id === meta.jointId);
  if (index < 0) return null;
  const pivot = point(joints[index].pivot), center = point(meta.center);
  const radii = meta.radii.map(x => clamp(x, .0005, .6));
  const order = [0, 1, 2].sort((a, b) => radii[b] - radii[a]);
  const radius = radii[order[1]], extension = Math.max(0, radii[order[0]] - radius);
  const local = { x: center.x - pivot.x, y: center.y - pivot.y, z: center.z - pivot.z };
  const a = { ...local }, b = { ...local }, axis = ['x', 'y', 'z'][order[0]];
  a[axis] -= extension; b[axis] += extension;
  return { jointId: meta.jointId, index, pivot, center, radii, radius, a, b };
}

/** JSON-serializable profile. Dimensions always come from this rig. */
export function createSpiderCollisionProfile(rig) {
  if (rig?.joints?.length !== 38 || rig?.legs?.length !== 8) throw new TypeError('Collision profile requires the specimen’s 38-joint rig.');
  const joints = rig.joints;
  const bodyLength = clamp(rig.bodyLength || .25, .04, .8);
  const hips = rig.legs.map(leg => point(leg.anchors[0]));
  const halfWidth = Math.max(.008, ...hips.map(p => Math.abs(p.x))) * .95;
  const front = Math.max(...hips.map(p => p.z)), back = Math.min(...hips.map(p => p.z));
  const fallback = [
    { jointId: 'cephalothorax', center: [0, -.003, (front + back) / 2], radii: [halfWidth, bodyLength * .09, Math.max(bodyLength * .14, (front - back) * .68)] },
    { jointId: 'abdomen', center: [0, 0, back - bodyLength * .22], radii: [bodyLength * .155, bodyLength * .12, bodyLength * .29] },
    ...joints.slice(2, 6).map((joint, i) => ({ jointId: joint.id, center: [joint.pivot[0], joint.pivot[1] - bodyLength * .018, joint.pivot[2] + bodyLength * (i < 2 ? .09 : .045)], radii: [bodyLength * (i < 2 ? .018 : .014), bodyLength * .018, bodyLength * (i < 2 ? .095 : .05)] })),
  ];
  const metadata = [...(rig.collision?.bodies || [])];
  for (const body of fallback) if (!metadata.some(meta => meta.jointId === body.jointId)) metadata.push(body);
  const bodies = metadata.filter(b => b?.radii?.length === 3 && b?.center?.length === 3).map(meta => bodyProxy(meta, joints)).filter(Boolean).slice(0, 6);
  const legs = rig.legs.map(leg => ({
    id: leg.id, anchors: leg.anchors.map(point), lengths: leg.lengths.map(x => clamp(x, .0001, 1)),
    radii: Array.from({ length: 4 }, (_, i) => clamp(leg.radii?.[i] ?? bodyLength * (.015 - i * .003), .0008, .1)),
  }));
  const underside = Math.min(...bodies.slice(0, 2).map(body => body.center.y - body.radii[1]));
  const clearance = Math.max(bodyLength * .035, finite(rig.neutralBodyHeight ?? rig.bodyHeight, bodyLength * .24) + underside);
  const extent = Math.max(...bodies.slice(0, 2).map(body => Math.abs(body.center.z) + body.radii[2]));
  const profile = { version: 1, species: String(rig.species || 'Spider'), bodies, legs, tolerance: Math.max(.00004, bodyLength * .0005), rootLimits: [clamp(Math.atan2(clearance, extent) / 1.28, .06, .22), .25, clamp(Math.atan2(clearance, halfWidth) / 1.28, .12, .35)], restPenetrations: [], restLegPenetrations: [], restHipPenetrations: [], restLegPairs: [] };
  const scratch = bodyScratch(profile); writeBodies(profile, null, 0, scratch);
  for (let i = 0; i < bodies.length; i++) for (let j = 0; j < i; j++) {
    profile.restPenetrations.push(Math.max(0, bodies[i].radius + bodies[j].radius - spiderSegmentDistance(scratch.bodies[i].a, scratch.bodies[i].b, scratch.bodies[j].a, scratch.bodies[j].b, scratch.distance).distance));
  }
  for (const leg of legs) for (let link = 0; link < 4; link++) for (const body of scratch.bodies) {
    let a = leg.anchors[link];
    if (link === 0 && body.index === 0) {
      const u = Math.min(.55, (body.radius * 1.6 + leg.radii[0]) / Math.max(.001, leg.lengths[0]));
      scratch.relative.x = a.x + (leg.anchors[1].x - a.x) * u; scratch.relative.y = a.y + (leg.anchors[1].y - a.y) * u; scratch.relative.z = a.z + (leg.anchors[1].z - a.z) * u; a = scratch.relative;
    }
    profile.restLegPenetrations.push(spiderEllipsoidPenetration(a, leg.anchors[link + 1], body, leg.radii[link], scratch.distance).penetration);
  }
  for (const leg of legs) for (const body of scratch.bodies) profile.restHipPenetrations.push(spiderEllipsoidPenetration(leg.anchors[0], leg.anchors[0], body, leg.radii[0], scratch.distance).penetration);
  for (let i = 0; i < 8; i++) for (let j = 0; j < i; j++) for (let s = 0; s < 4; s++) for (let t = 0; t < 4; t++) {
    const a = legs[i], b = legs[j];
    const attached = i - j === 1 && Math.floor(i / 4) === Math.floor(j / 4) && s < 2 && t < 2 && (s === 0 || t === 0);
    profile.restLegPairs.push(attached ? Math.max(0, a.radii[s] + b.radii[t] - spiderSegmentDistance(a.anchors[s], a.anchors[s + 1], b.anchors[t], b.anchors[t + 1], scratch.distance).distance) : 0);
  }
  return profile;
}
function bodyScratch(profile) {
  let scratch = scratchByProfile.get(profile);
  if (!scratch) {
    scratch = { bodies: profile.bodies.map(b => ({ a: point(), b: point(), worldCenter: point(), axes: [...IDENTITY], radii: b.radii, radius: b.radius, index: b.index })), matrix: [...IDENTITY], worldMatrix: [...IDENTITY], parentMatrix: [...IDENTITY], origin: point(), distance: {}, pose: new Float64Array(114), relative: point(), guardCache: Array.from({ length: 8 }, () => ({ input: new Float64Array(18), output: new Float64Array(18), age: 0, precision: 0 })), guardEpoch: 0, supportPlanes: new Float64Array(6), supportAngles: new Float64Array(4) };
    scratchByProfile.set(profile, scratch);
  }
  return scratch;
}
function writeBodies(profile, pose, factor, scratch, only = -1) {
  for (let i = 0; i < profile.bodies.length; i++) {
    if (only !== -1 && i !== only) continue;
    const body = profile.bodies[i], offset = body.index * 3, moving = body.index > 0;
    const matrix = moving && pose ? rotation(finite(pose[offset]) * factor, finite(pose[offset + 1]) * factor, finite(pose[offset + 2]) * factor, scratch.matrix) : IDENTITY;
    transform(body.a, matrix, body.pivot, scratch.bodies[i].a); transform(body.b, matrix, body.pivot, scratch.bodies[i].b);
    scratch.relative.x = body.center.x - body.pivot.x; scratch.relative.y = body.center.y - body.pivot.y; scratch.relative.z = body.center.z - body.pivot.z;
    transform(scratch.relative, matrix, body.pivot, scratch.bodies[i].worldCenter);
    for (let j = 0; j < 9; j++) scratch.bodies[i].axes[j] = matrix[j];
  }
}
function segmentMayReachBody(a, b, body, radius) {
  // The expanded ellipsoid fits entirely inside this sphere. Rejecting a
  // disjoint segment is exact and avoids matrix/gradient work for distant hips.
  const size = Math.max(body.radii[0], body.radii[1], body.radii[2]) + radius;
  const x = a.x - body.worldCenter.x, y = a.y - body.worldCenter.y, z = a.z - body.worldCenter.z;
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, length2 = dx * dx + dy * dy + dz * dz;
  const t = length2 > 1e-16 ? Math.max(0, Math.min(1, -(x * dx + y * dy + z * dz) / length2)) : 0;
  return (x + dx * t) ** 2 + (y + dy * t) ** 2 + (z + dz * t) ** 2 <= size * size + 1e-14;
}
function bodyExcess(profile, scratch, only = -1) {
  let maximum = 0, pair = 0;
  for (let i = 0; i < profile.bodies.length; i++) for (let j = 0; j < i; j++, pair++) {
    if (only !== -1 && i !== only && j !== only) continue;
    const a = scratch.bodies[i], b = scratch.bodies[j];
    const penetration = a.radius + b.radius - spiderSegmentDistance(a.a, a.b, b.a, b.b, scratch.distance).distance;
    maximum = Math.max(maximum, penetration - (profile.restPenetrations[pair] || 0));
  }
  if (profile.restHipPenetrations) for (let leg = 0; leg < 8; leg++) for (let body = 1; body < scratch.bodies.length; body++) {
    if (only !== -1 && body !== only) continue;
    const p = profile.legs[leg].anchors[0], shape = scratch.bodies[body], radius = profile.legs[leg].radii[0];
    const penetration = segmentMayReachBody(p, p, shape, radius) ? spiderEllipsoidPenetration(p, p, shape, radius, scratch.distance).penetration : 0;
    maximum = Math.max(maximum, penetration - (profile.restHipPenetrations[leg * scratch.bodies.length + body] || 0));
    if (scratch.bodies[body].index > 1) {
      const end = profile.legs[leg].anchors[1];
      const penetration = segmentMayReachBody(p, end, shape, radius) ? spiderEllipsoidPenetration(p, end, shape, radius, scratch.distance).penetration : 0;
      maximum = Math.max(maximum, penetration - (profile.restLegPenetrations[leg * 4 * scratch.bodies.length + body] || 0));
    }
  }
  return maximum;
}
/** Root-only form for support planning. Preserve the full guard's assignment
 * order (including Float32 rounding); expressive body/face entries are untouched. */
export function constrainSpiderCollisionRoot(pose, profile, out = pose) {
  for (let axis = 0; axis < 3; axis++) out[axis] = finite(pose[axis]);
  if (profile?.rootLimits) {
    let extent = 0;
    for (let axis = 0; axis < 3; axis++) { out[axis] = clamp(out[axis], -profile.rootLimits[axis], profile.rootLimits[axis]); extent += (out[axis] / profile.rootLimits[axis]) ** 2; }
    if (extent > 1) for (let axis = 0; axis < 3; axis++) out[axis] /= Math.sqrt(extent);
  }
  return out;
}
/** Clamp local abdomen/face rotations before audio and visual consume the pose.
 * Authored attachment overlaps are preserved; new solid penetration is refused.
 * World position and contacts remain planner-owned. No mesh traversal occurs. */
export function constrainSpiderCollisionPose(pose, profile, out = pose) {
  if (!profile?.bodies?.length) return out === pose ? pose : (out.set(pose), out);
  const scratch = bodyScratch(profile);
  // Base poses, MIDI composition and forecast poses alternate. A tiny exact
  // LRU avoids repeatedly solving those same boundaries; no temporal rounding
  // is used. Legs always pass through, and output precision is part of the key.
  const precision = out instanceof Float32Array ? 4 : 8, epoch = ++scratch.guardEpoch;
  let record = scratch.guardCache[0];
  for (const entry of scratch.guardCache) {
    if (entry.age < record.age) record = entry;
    if (!entry.age || entry.precision !== precision) continue;
    let sameInput = true, sameOutput = true;
    for (let i = 0; i < 18; i++) {
      const value = finite(pose[i]);
      if (value !== entry.input[i]) sameInput = false;
      if (value !== entry.output[i]) sameOutput = false;
      if (!sameInput && !sameOutput) break;
    }
    if (sameInput || sameOutput) {
      entry.age = epoch;
      for (let i = 0; i < Math.min(pose.length, out.length); i++) out[i] = i < 18 ? entry.output[i] : finite(pose[i]);
      return out;
    }
  }
  record.age = epoch; record.precision = precision;
  for (let i = 0; i < 18; i++) record.input[i] = finite(pose[i]);
  for (let i = 0; i < Math.min(114, pose.length); i++) scratch.pose[i] = finite(pose[i]);
  writeBodies(profile, scratch.pose, 1, scratch);
  const collides = bodyExcess(profile, scratch) > profile.tolerance;
  for (let i = 0; i < Math.min(pose.length, out.length); i++) out[i] = finite(pose[i]);
  constrainSpiderCollisionRoot(out, profile);
  if (collides) {
    // Resolve one part and then one axis at a time. A fang reaching a boundary
    // must not silence an otherwise free abdomen, and blocked sideways motion
    // must not erase a valid lift of that same body part.
    for (const body of profile.bodies) if (body.index > 0) for (let axis = 0; axis < 3; axis++) out[body.index * 3 + axis] = 0;
    writeBodies(profile, out, 1, scratch);
    for (let bodyNumber = 0; bodyNumber < profile.bodies.length; bodyNumber++) {
      const body = profile.bodies[bodyNumber]; if (body.index === 0) continue;
      const offset = body.index * 3;
      for (let axis = 0; axis < 3; axis++) out[offset + axis] = scratch.pose[offset + axis];
      writeBodies(profile, out, 1, scratch, bodyNumber);
      if (bodyExcess(profile, scratch, bodyNumber) <= profile.tolerance) continue;
      for (let axis = 0; axis < 3; axis++) out[offset + axis] = 0;
      for (let axis = 0; axis < 3; axis++) {
        const wanted = scratch.pose[offset + axis]; if (!wanted) continue;
        out[offset + axis] = wanted; writeBodies(profile, out, 1, scratch, bodyNumber);
        if (bodyExcess(profile, scratch, bodyNumber) <= profile.tolerance) continue;
        let lo = 0, hi = 1;
        for (let pass = 0; pass < 8; pass++) {
          const mid = (lo + hi) * .5; out[offset + axis] = wanted * mid; writeBodies(profile, out, 1, scratch, bodyNumber);
          if (bodyExcess(profile, scratch, bodyNumber) > profile.tolerance) hi = mid; else lo = mid;
        }
        out[offset + axis] = wanted * lo;
      }
      writeBodies(profile, out, 1, scratch, bodyNumber);
    }
  }
  for (let i = 0; i < 18; i++) record.output[i] = out[i];
  return out;
}

export function measureSpiderBodyPenetration(pose, profile) {
  const scratch = bodyScratch(profile); writeBodies(profile, pose, 1, scratch); return bodyExcess(profile, scratch);
}

export function createSpiderCollisionBodies(profile) {
  return profile.bodies.map(body => ({ index: body.index, jointId: body.jointId, a: point(), b: point(), worldCenter: point(), axes: [...IDENTITY], radii: [...body.radii], radius: body.radius }));
}

/** The exact body transform used by the viewer, available to foot planning
 * without Three.js. Allocate `out` once with createSpiderCollisionBodies. */
export function writeSpiderCollisionBodies(profile, pose, body, out = createSpiderCollisionBodies(profile)) {
  const scratch = bodyScratch(profile); writeBodies(profile, pose, 1, scratch);
  rotationYXZ(finite(body.pitch), finite(body.yaw), finite(body.roll), scratch.worldMatrix);
  rotation(finite(pose?.[0]), finite(pose?.[1]), finite(pose?.[2]), scratch.matrix);
  multiply(scratch.worldMatrix, scratch.matrix, scratch.parentMatrix);
  scratch.origin.x = finite(body.x); scratch.origin.y = finite(body.y); scratch.origin.z = finite(body.z);
  for (let i = 0; i < scratch.bodies.length; i++) {
    const local = scratch.bodies[i], result = out[i];
    transform(local.a, scratch.parentMatrix, scratch.origin, result.a); transform(local.b, scratch.parentMatrix, scratch.origin, result.b);
    transform(local.worldCenter, scratch.parentMatrix, scratch.origin, result.worldCenter);
    multiply(scratch.parentMatrix, local.axes, result.axes);
  }
  return out;
}

/** Limit performer yaw against the actual composed-root foreleg workspace.
 * Long scan forelegs cannot fold their thick first link medially past the face.
 * All toe coordinates/strand identities and local expressive rotations remain
 * exact. Returns false when no yaw can satisfy the supplied fixed supports. */
function supportYawAllowed(angle, planes, count) {
  const c = Math.cos(angle), s = Math.sin(angle);
  for (let i = 0; i < count; i++) if (planes[i * 3] * c + planes[i * 3 + 1] * s < planes[i * 3 + 2] - 1e-10) return false;
  return true;
}
export function constrainSpiderSupportBody(frame, profile) {
  if (!profile?.legs || frame.airborne || !frame.body || !frame.pose) return true;
  const scratch = bodyScratch(profile), body = frame.body, pose = frame.pose;
  rotationYXZ(finite(body.pitch), 0, finite(body.roll), scratch.worldMatrix);
  rotation(finite(pose[0]), finite(pose[1]), finite(pose[2]), scratch.matrix);
  multiply(scratch.worldMatrix, scratch.matrix, scratch.parentMatrix);
  const matrix = scratch.parentMatrix;
  let pivot = profile.bodies[0].pivot;
  for (const volume of profile.bodies) if (volume.index === 0) { pivot = volume.pivot; break; }
  const offset = finite(pivot.x) - finite(pivot.x) * scratch.matrix[0] - finite(pivot.y) * scratch.matrix[3] - finite(pivot.z) * scratch.matrix[6];
  const planes = scratch.supportPlanes, angles = scratch.supportAngles; let count = 0, angleCount = 0;
  for (let index = 0; index <= 4; index += 4) {
    const leg = profile.legs[index], foot = frame.feet?.[index];
    if (!foot || foot.airborne || !Number.isFinite(foot.x) || !Number.isFinite(foot.y) || !Number.isFinite(foot.z)
      || leg.lengths[0] <= leg.lengths[1] + leg.lengths[2] + leg.lengths[3]) continue;
    const side = Math.sign(leg.anchors[0].x) || 1, dx = foot.x - finite(body.x), dy = foot.y - finite(body.y), dz = foot.z - finite(body.z);
    const a = side * (dx * matrix[0] + dz * matrix[6]), b = side * (dx * matrix[6] - dz * matrix[0]);
    const bound = side * leg.anchors[0].x + leg.radii[0] * 1.3 - side * (dy * matrix[3] + offset), radius = Math.hypot(a, b);
    if (bound > radius + 1e-10) return false;
    if (bound <= -radius) continue;
    const at = count++ * 3; planes[at] = a; planes[at + 1] = b; planes[at + 2] = bound;
    const middle = Math.atan2(b, a), spread = Math.acos(clamp(bound / Math.max(1e-12, radius), -1, 1));
    angles[angleCount++] = middle - spread; angles[angleCount++] = middle + spread;
  }
  const wanted = finite(body.yaw); if (supportYawAllowed(wanted, planes, count)) return true;
  let closest = Infinity, result = wanted;
  for (let i = 0; i < angleCount; i++) {
    const delta = Math.atan2(Math.sin(angles[i] - wanted), Math.cos(angles[i] - wanted));
    const candidate = wanted + delta;
    if (Math.abs(delta) < closest && supportYawAllowed(candidate, planes, count)) { result = candidate; closest = Math.abs(delta); }
  }
  if (!Number.isFinite(closest)) return false;
  body.yaw = result; return true;
}

function movePoint(p, x, y, z, amount) { p.x += x * amount; p.y += y * amount; p.z += z * amount; }
// A joint constrained by its two neighbors moves on a circle, preserving both
// bone lengths. Reusable description also closes the final two links exactly.
function jointCircle(a, b, left, right, preferred, out) {
  const d = dist(a, b); if (d < 1e-10 || d > left + right + 1e-9 || d < Math.abs(left - right) - 1e-9) return false;
  const ux = (b.x - a.x) / d, uy = (b.y - a.y) / d, uz = (b.z - a.z) / d;
  const along = (left * left - right * right + d * d) / (2 * d);
  out.x = a.x + ux * along; out.y = a.y + uy * along; out.z = a.z + uz * along;
  out.radius = Math.sqrt(Math.max(0, left * left - along * along));
  let nx = preferred.x - out.x, ny = preferred.y - out.y, nz = preferred.z - out.z;
  const dot = nx * ux + ny * uy + nz * uz; nx -= dot * ux; ny -= dot * uy; nz -= dot * uz;
  let length = Math.hypot(nx, ny, nz);
  if (length < 1e-10) { nx = -uy; ny = ux; nz = 0; length = Math.hypot(nx, ny); if (length < 1e-10) { nx = 1; length = 1; } }
  out.nx = nx / length; out.ny = ny / length; out.nz = nz / length;
  out.vx = uy * out.nz - uz * out.ny; out.vy = uz * out.nx - ux * out.nz; out.vz = ux * out.ny - uy * out.nx;
  return true;
}
function circlePoint(circle, angle, out) {
  const c = Math.cos(angle) * circle.radius, s = Math.sin(angle) * circle.radius;
  out.x = circle.x + circle.nx * c + circle.vx * s; out.y = circle.y + circle.ny * c + circle.vy * s; out.z = circle.z + circle.nz * c + circle.vz * s;
}
function closeChain(p, lengths, target, circle) {
  // FABRIK can converge slowly near straight configurations. Two analytic
  // sphere intersections remove the remaining error without moving the toe.
  const rest = lengths[1] + lengths[2] + lengths[3], gap = dist(p[1], target);
  if (gap > rest + 1e-9) return false;
  const lo = Math.max(Math.abs(lengths[2] - lengths[3]), Math.abs(gap - lengths[1]));
  const hi = Math.min(lengths[2] + lengths[3], gap + lengths[1]);
  if (lo > hi + 1e-9) return false;
  const tail = clamp(dist(p[2], target), lo, hi);
  if (!jointCircle(p[1], target, lengths[1], tail, p[2], circle)) return false;
  circlePoint(circle, 0, p[2]);
  if (!jointCircle(p[2], target, lengths[2], lengths[3], p[3], circle)) return false;
  circlePoint(circle, 0, p[3]); copy(p[4], target); return true;
}
function linkDistance(points, lengths, root, tip, passes, first = 0) {
  // FABRIK, with both endpoints restored each pass. Endpoints represent shared
  // world contacts; refusing impossible poses must never silently unpin them.
  for (let pass = 0; pass < passes; pass++) {
    copy(points[4], tip);
    for (let j = 3; j >= first; j--) {
      const a = points[j], b = points[j + 1], length = Math.max(1e-10, dist(a, b)), scale = lengths[j] / length;
      a.x = b.x + (a.x - b.x) * scale; a.y = b.y + (a.y - b.y) * scale; a.z = b.z + (a.z - b.z) * scale;
    }
    copy(points[first], root);
    for (let j = first; j < 4; j++) {
      const a = points[j], b = points[j + 1], length = Math.max(1e-10, dist(a, b)), scale = lengths[j] / length;
      b.x = a.x + (b.x - a.x) * scale; b.y = a.y + (b.y - a.y) * scale; b.z = a.z + (b.z - a.z) * scale;
    }
  }
}

/** Viewer-only coupled capsule solver. Each chain is {points:[5], lengths:[4],
 * radii:[4], root, target}. Bodies are world capsules {a,b,radius,index}. */
export function createSpiderCollisionSolver(profile) {
  const distance = {}, circle = {}, trimmed = point(), root = Array.from({ length: 8 }, () => point()), tip = Array.from({ length: 8 }, () => point());
  const saved = Array.from({ length: 8 }, () => Array.from({ length: 5 }, () => point()));
  const stats = { passes: 0, corrections: 0, bodyPenetration: 0, rawBodyOverlap: 0, legPenetration: 0, footError: 0, lengthError: 0, bodyLeg: -1, bodyLink: -1, bodyIndex: -1, legA: -1, linkA: -1, legB: -1, linkB: -1, uA: 0, uB: 0 };
  function capsule(chains, bodies, correct, only = -1) {
    let bodyPenetration = 0, rawBodyOverlap = 0, legPenetration = 0, score = 0;
    for (let i = 0; i < chains.length; i++) {
      if (only !== -1 && i !== only) continue;
      const chain = chains[i], p = chain.points, radii = chain.radii || profile.legs[i].radii;
      for (let s = 0; s < 4; s++) {
        let a = p[s];
        for (let bodyNumber = 0; bodyNumber < bodies.length; bodyNumber++) {
          const body = bodies[bodyNumber];
          let trimStart = 0;
          // Hip joins the front body. Its short attachment volume is expected;
          // distal links and the abdomen have no such exemption.
          if (s === 0 && body.index === 0) {
            const length = dist(p[0], p[1]), u = Math.min(.55, (body.radius * 1.6 + radii[0]) / Math.max(.001, length));
            trimStart = u;
            trimmed.x = p[0].x + (p[1].x - p[0].x) * u; trimmed.y = p[0].y + (p[1].y - p[0].y) * u; trimmed.z = p[0].z + (p[1].z - p[0].z) * u; a = trimmed;
          } else a = p[s];
          const ellipse = !!body.worldCenter;
          if (ellipse) spiderEllipsoidPenetration(a, p[s + 1], body, radii[s], distance);
          else spiderSegmentDistance(a, p[s + 1], body.a, body.b, distance);
          const raw = ellipse ? distance.penetration : radii[s] + body.radius - distance.distance;
          rawBodyOverlap = Math.max(rawBodyOverlap, raw);
          // A straight capsule necessarily overlaps its measured attachment
          // volume. Preserve only that bind-pose allowance on the proximal link;
          // every distal link still has a zero-penetration target.
          const allowance = s === 0 ? profile.restLegPenetrations?.[(i * 4 + s) * profile.bodies.length + bodyNumber] || 0 : 0;
          const penetration = Math.max(0, raw - allowance);
          score += Math.max(0, penetration - profile.tolerance) ** 2 * 4;
          if (penetration > bodyPenetration) { bodyPenetration = penetration; stats.bodyLeg = i; stats.bodyLink = s; stats.bodyIndex = body.index; }
          if (correct && penetration > profile.tolerance) {
            const n = Math.max(1e-9, distance.distance), nx = ellipse ? distance.x : distance.distance > 1e-9 ? distance.x / n : (i < 4 ? -1 : 1), ny = ellipse ? distance.y : distance.distance > 1e-9 ? distance.y / n : .3, nz = ellipse ? distance.z : distance.distance > 1e-9 ? distance.z / n : 0;
            const u = trimStart + distance.s * (1 - trimStart), w0 = s === 0 ? 0 : 1 - u, w1 = s === 3 && chain.pinned !== false ? 0 : u, denom = w0 * w0 + w1 * w1;
            if (denom > 1e-8) { const amount = Math.min(.05, penetration + profile.tolerance) / denom; movePoint(p[s], nx, ny, nz, w0 * amount); movePoint(p[s + 1], nx, ny, nz, w1 * amount); stats.corrections++; }
          }
        }
      }
    }
    for (let i = 0; i < chains.length; i++) for (let j = 0; j < i; j++) {
      if (only !== -1 && i !== only && j !== only) continue;
      const a = chains[i], b = chains[j], ar = a.radii || profile.legs[i].radii, br = b.radii || profile.legs[j].radii;
      for (let s = 0; s < 4; s++) for (let t = 0; t < 4; t++) {
        if (s === 0 && t === 0) continue; // Adjacent coxae share the body rim.
        spiderSegmentDistance(a.points[s], a.points[s + 1], b.points[t], b.points[t + 1], distance);
        const allowance = profile.restLegPairs?.[(i * (i - 1) / 2 + j) * 16 + s * 4 + t] || 0;
        const penetration = ar[s] + br[t] - distance.distance - allowance;
        if (penetration > legPenetration) { legPenetration = penetration; stats.legA = i; stats.linkA = s; stats.legB = j; stats.linkB = t; stats.uA = distance.s; stats.uB = distance.t; }
        score += Math.max(0, penetration - profile.tolerance) ** 2;
        if (correct && penetration > profile.tolerance) {
          const n = Math.max(1e-9, distance.distance), nx = distance.distance > 1e-9 ? distance.x / n : 0, ny = distance.distance > 1e-9 ? distance.y / n : 1, nz = distance.distance > 1e-9 ? distance.z / n : 0;
          const u = distance.s, v = distance.t, wa = s === 0 ? 0 : 1 - u, wb = s === 3 && a.pinned !== false ? 0 : u, wc = t === 0 ? 0 : 1 - v, wd = t === 3 && b.pinned !== false ? 0 : v;
          const denom = wa * wa + wb * wb + wc * wc + wd * wd;
          if (denom > 1e-8) { const amount = Math.min(.03, penetration + profile.tolerance) / denom; movePoint(a.points[s], nx, ny, nz, wa * amount); movePoint(a.points[s + 1], nx, ny, nz, wb * amount); movePoint(b.points[t], nx, ny, nz, -wc * amount); movePoint(b.points[t + 1], nx, ny, nz, -wd * amount); stats.corrections++; }
        }
      }
    }
    stats.bodyPenetration = Math.max(0, bodyPenetration); stats.rawBodyOverlap = Math.max(0, rawBodyOverlap); stats.legPenetration = Math.max(0, legPenetration);
    return score;
  }
  return {
    stats,
    solve(chains, bodies, maxPasses = 12) {
      stats.passes = stats.corrections = stats.footError = stats.lengthError = 0;
      for (let i = 0; i < chains.length; i++) {
        copy(root[i], chains[i].root || chains[i].points[0]); copy(tip[i], chains[i].target || chains[i].points[4]);
        for (let j = 0; j < 5; j++) copy(saved[i][j], chains[i].points[j]);
      }
      // Escaping a deep local fold by twisting the solved chain around its
      // root-to-contact axis preserves every length and both pinned endpoints.
      // A small fixed candidate bank avoids an unbounded optimization loop.
      if (capsule(chains, bodies, false) > 1e-12) for (let sweep = 0; sweep < 2; sweep++) for (let i = 0; i < chains.length; i++) {
        const p = chains[i].points, length = Math.max(1e-10, dist(root[i], tip[i]));
        const ux = (tip[i].x - root[i].x) / length, uy = (tip[i].y - root[i].y) / length, uz = (tip[i].z - root[i].z) / length;
        let best = capsule(chains, bodies, false, i), angle = 0;
        if (best <= 1e-12) continue;
        for (let j = 0; j < 5; j++) copy(saved[i][j], p[j]);
        const turn = radians => {
          const c = Math.cos(radians), s = Math.sin(radians);
          for (let j = 1; j < 4; j++) {
            const q = saved[i][j], x = q.x - root[i].x, y = q.y - root[i].y, z = q.z - root[i].z, dot = ux * x + uy * y + uz * z;
            p[j].x = root[i].x + x * c + (uy * z - uz * y) * s + ux * dot * (1 - c);
            p[j].y = root[i].y + y * c + (uz * x - ux * z) * s + uy * dot * (1 - c);
            p[j].z = root[i].z + z * c + (ux * y - uy * x) * s + uz * dot * (1 - c);
          }
        };
        for (const candidate of [.12, -.12, .25, -.25, .5, -.5, .8, -.8, 1.2, -1.2, 1.6, -1.6, 2.2, -2.2, Math.PI]) {
          turn(candidate); const score = capsule(chains, bodies, false, i);
          if (score < best) { best = score; angle = candidate; }
          if (best <= 1e-12) break;
        }
        turn(angle);
        if (best > 1e-12) {
          // A nearly folded scan can trap FABRIK on the wrong side of its
          // body. Try a bounded bank of outward arcs, retaining the best exact
          // endpoint solution. This is a restart, not stretching the skeleton.
          for (let j = 0; j < 5; j++) copy(saved[i][j], p[j]);
          const reach = chains[i].lengths.reduce((sum, value) => sum + value, 0);
          let nx = -ux * uy, ny = 1 - uy * uy, nz = -uz * uy;
          let normalLength = Math.hypot(nx, ny, nz);
          if (normalLength < .001) { nx = 1; ny = 0; nz = 0; normalLength = 1; }
          nx /= normalLength; ny /= normalLength; nz /= normalLength;
          const vx = uy * nz - uz * ny, vy = uz * nx - ux * nz, vz = ux * ny - uy * nx;
          for (let candidate = 0; candidate < 12; candidate++) {
            const angle = candidate % 6 * Math.PI / 3, amplitude = reach * (candidate < 6 ? .2 : .4);
            const bx = nx * Math.cos(angle) + vx * Math.sin(angle), by = ny * Math.cos(angle) + vy * Math.sin(angle), bz = nz * Math.cos(angle) + vz * Math.sin(angle);
            let along = 0;
            for (let j = 1; j < 4; j++) {
              along += chains[i].lengths[j - 1]; const f = along / reach, lift = Math.sin(Math.PI * f) * amplitude;
              p[j].x = root[i].x + (tip[i].x - root[i].x) * f + bx * lift;
              p[j].y = root[i].y + (tip[i].y - root[i].y) * f + by * lift;
              p[j].z = root[i].z + (tip[i].z - root[i].z) * f + bz * lift;
            }
            linkDistance(p, chains[i].lengths, root[i], tip[i], 28);
            const score = capsule(chains, bodies, false, i);
            if (score < best && dist(p[4], tip[i]) < .00001) { best = score; for (let j = 0; j < 5; j++) copy(saved[i][j], p[j]); }
            if (best <= 1e-12) break;
          }
          for (let j = 0; j < 5; j++) copy(p[j], saved[i][j]);
        }
        if (best > 1e-12 && bodies[0]?.worldCenter) {
          // Thick, short proximal links need a real outward elbow constraint.
          // Keeping that first elbow fixed during the remaining three-link
          // solve prevents ordinary FABRIK from folding it through the thorax.
          spiderEllipsoidPenetration(root[i], root[i], bodies[0], chains[i].radii[0], distance);
          const ox = distance.x, oy = distance.y, oz = distance.z;
          const restReach = chains[i].lengths[1] + chains[i].lengths[2] + chains[i].lengths[3];
          const inner = Math.max(0, Math.max(...chains[i].lengths.slice(1)) * 2 - restReach);
          for (let candidate = 0; candidate < 25; candidate++) {
            let dx = ox, dy = oy, dz = oz;
            if (candidate) {
              const y = 1 - 2 * (candidate - .5) / 24, r = Math.sqrt(1 - y * y), angle = candidate * 2.399963229728653;
              dx = .3 * ox + r * Math.cos(angle); dy = .3 * oy + y; dz = .3 * oz + r * Math.sin(angle);
            }
            const norm = Math.max(1e-10, Math.hypot(dx, dy, dz)), firstLength = chains[i].lengths[0];
            p[1].x = root[i].x + dx / norm * firstLength; p[1].y = root[i].y + dy / norm * firstLength; p[1].z = root[i].z + dz / norm * firstLength;
            const gap = dist(p[1], tip[i]); if (gap > restReach * .998 || gap < inner + .00001) continue;
            copy(trimmed, p[1]);
            for (let j = 2; j < 4; j++) {
              const fraction = chains[i].lengths.slice(1, j).reduce((sum, length) => sum + length, 0) / restReach;
              p[j].x = trimmed.x + (tip[i].x - trimmed.x) * fraction + ox * .02 * Math.sin(fraction * Math.PI);
              p[j].y = trimmed.y + (tip[i].y - trimmed.y) * fraction + oy * .02 * Math.sin(fraction * Math.PI);
              p[j].z = trimmed.z + (tip[i].z - trimmed.z) * fraction + oz * .02 * Math.sin(fraction * Math.PI);
            }
            linkDistance(p, chains[i].lengths, trimmed, tip[i], 28, 1);
            const score = capsule(chains, bodies, false, i);
            if (score < best && dist(p[4], tip[i]) < .00001) { best = score; for (let j = 0; j < 5; j++) copy(saved[i][j], p[j]); }
            if (best <= 1e-12) break;
          }
          for (let j = 0; j < 5; j++) copy(p[j], saved[i][j]);
        }
      }
      capsule(chains, bodies, false);
      if (Math.max(stats.bodyPenetration, stats.legPenetration) > profile.tolerance) for (let pass = 0; pass < Math.min(16, maxPasses); pass++) {
        capsule(chains, bodies, true);
        for (let i = 0; i < chains.length; i++) {
          const chain = chains[i];
          if (chain.pinned === false) {
            // During a leap no web contact exists. Preserve the hip and all
            // lengths while allowing the free toe to follow a safer leg fold.
            copy(chain.points[0], root[i]);
            for (let j = 0; j < 4; j++) {
              const a = chain.points[j], b = chain.points[j + 1], scale = chain.lengths[j] / Math.max(1e-10, dist(a, b));
              b.x = a.x + (b.x - a.x) * scale; b.y = a.y + (b.y - a.y) * scale; b.z = a.z + (b.z - a.z) * scale;
            }
            copy(tip[i], chain.points[4]);
          } else linkDistance(chain.points, chain.lengths, root[i], tip[i], 3);
        }
        stats.passes++;
        capsule(chains, bodies, false);
        if (Math.max(stats.bodyPenetration, stats.legPenetration) <= profile.tolerance) break;
      }
      for (let i = 0; i < chains.length; i++) {
        linkDistance(chains[i].points, chains[i].lengths, root[i], tip[i], 28);
        closeChain(chains[i].points, chains[i].lengths, tip[i], circle);
        stats.footError = Math.max(stats.footError, dist(chains[i].points[4], tip[i]));
        for (let j = 0; j < 4; j++) stats.lengthError = Math.max(stats.lengthError, Math.abs(dist(chains[i].points[j], chains[i].points[j + 1]) - chains[i].lengths[j]));
      }
      // Finish in joint-space. Every candidate is an exact linkage with the
      // same hip and toe, so resolving one crossing cannot introduce stretch
      // or undo a planted contact as positional projection sometimes does.
      if (capsule(chains, bodies, false) > 1e-12) for (let sweep = 0; sweep < 8; sweep++) {
        let changed = false;
        for (let i = 0; i < chains.length; i++) {
          const p = chains[i].points, lengths = chains[i].lengths;
          let best = capsule(chains, bodies, false, i); if (best <= 1e-12) continue;
          for (let joint = 1; joint < 4; joint++) {
            if (!jointCircle(p[joint - 1], p[joint + 1], lengths[joint - 1], lengths[joint], p[joint], circle)) continue;
            let bestAngle = 0;
            for (const angle of [.025, -.025, .06, -.06, .13, -.13, .27, -.27, .55, -.55, 1.1, -1.1, 2.2, -2.2, Math.PI]) {
              circlePoint(circle, angle, p[joint]); const score = capsule(chains, bodies, false, i);
              if (score < best) { best = score; bestAngle = angle; }
              if (best <= 1e-12) break;
            }
            circlePoint(circle, bestAngle, p[joint]); if (bestAngle) changed = true;
          }
        }
        if (!changed || capsule(chains, bodies, false) <= 1e-12) break;
      }
      capsule(chains, bodies, false);
      stats.footError = stats.lengthError = 0;
      for (let i = 0; i < chains.length; i++) {
        stats.footError = Math.max(stats.footError, dist(chains[i].points[4], tip[i]));
        for (let j = 0; j < 4; j++) stats.lengthError = Math.max(stats.lengthError, Math.abs(dist(chains[i].points[j], chains[i].points[j + 1]) - chains[i].lengths[j]));
      }
      return stats;
    },
    measure(chains, bodies) { capsule(chains, bodies, false); return stats; },
  };
}
