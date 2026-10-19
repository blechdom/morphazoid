/** Sampled grain zones stuck to a fixed-size rolling marble. */
export const SOURCE_COUNT = 8;
export const SLICE_CELLS = 160;
export const MARBLE_RADIUS = 44;
export const PICKUP_REACH = .9;
export const MIN_GRAIN_MS = 40;
export const DEFAULT_GRAIN_MS = 100;
export const MAX_GRAIN_MS = 240;
export const ORBIT_SECONDS = 4.8;
export const MAX_VOICES = 18;
const TAU = 2 * Math.PI;
const FLOOR_WIDTH = 640, FLOOR_LANE = 56;
export const IDENTITY_ORIENTATION = Object.freeze([0, 0, 0, 1]);
const INITIAL_FLOOR_IDS = Object.freeze(Array.from({ length: SOURCE_COUNT }, (_, index) => index));

/** Record and Play use the same marble but different camera projections. */
export const playRadius = (width, height) =>
  Math.min(width * .30, height * .32, MARBLE_RADIUS * 3.9);

export const clamp = (value, low, high) =>
  Number.isFinite(value) ? Math.max(low, Math.min(high, value)) : low;
export const wrap = value => ((Number.isFinite(value) ? value : 0) % 1 + 1) % 1;
/** Each placement is new material: old PCM stays on the ball, but its floor
 * cells don't hide the fresh source's cells. There is no ball-capacity count. */
export function floorRemaining(ribbons, floorIds = INITIAL_FLOOR_IDS) {
  const taken = new Set(ribbons.map(grain => grain.key));
  let remaining = 0;
  for (const floorId of floorIds)
    for (let cell = 0; cell < SLICE_CELLS; cell++)
      if (!taken.has(floorId * SLICE_CELLS + cell)) remaining++;
  return remaining;
}

function hash(step, layer, salt) {
  let x = Math.imul(step + 1, 0x9e3779b1) ^ Math.imul(layer + 11, 0x85ebca6b) ^ salt;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = vector => {
  const length = Math.hypot(...vector);
  return vector.map(value => value / length);
};
export const inverseOrientation = ([x, y, z, w]) => [-x, -y, -z, w];
export function multiplyOrientation([ax, ay, az, aw], [bx, by, bz, bw]) {
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}
export function rotateNormal([x, y, z, w], [vx, vy, vz]) {
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [
    vx + w * tx + y * tz - z * ty,
    vy + w * ty + z * tx - x * tz,
    vz + w * tz + x * ty - y * tx,
  ];
}

/** The table is an X/Z plane. A displacement rotates about its perpendicular,
 * so horizontal and vertical rolls visit different meridians and both poles. */
export function rollOrientation(orientation, dx, dz, radius) {
  const distance = Math.hypot(dx, dz);
  if (!distance) return orientation;
  const turn = distance / radius, sine = Math.sin(turn / 2) / distance;
  return unit(multiplyOrientation(
    [dz * sine, 0, -dx * sine, Math.cos(turn / 2)], orientation,
  ));
}

/** Roll the visible marble under a front-facing tip. Right moves its front
 * paint right (Y axis); down moves it down (X axis). Neither gesture twists
 * around the tip like a flat record. Accumulate segments to retain corners. */
export function rollPlayPose(pose, dx, dy, radius) {
  const distance = Math.hypot(dx, dy);
  if (!Number.isFinite(distance) || !Number.isFinite(radius) || radius <= 0)
    throw new RangeError("Invalid globule play roll.");
  if (!distance) return pose;
  const turn = distance / radius, sine = Math.sin(turn / 2) / distance;
  return unit(multiplyOrientation(
    [dy * sine, dx * sine, 0, Math.cos(turn / 2)], pose,
  ));
}

/** Height 0 and 7 are the real poles, not the edges of an equatorial strip. */
export function normalAt(angle, height) {
  const latitude = Math.PI * clamp(height, 0, 7) / 7;
  const azimuth = TAU * wrap(angle), ring = Math.sin(latitude);
  return [ring * Math.sin(azimuth), Math.cos(latitude), ring * Math.cos(azimuth)];
}
export function coordinatesOf(normal) {
  return {
    angle: wrap(Math.atan2(normal[0], normal[2]) / TAU),
    latitude: Math.acos(clamp(normal[1], -1, 1)) * 7 / Math.PI,
  };
}
const FIXED_TIP = Object.freeze([0, 0, 1]);
/** The motor rolls the marble vertically rather than spinning it like a
 * platter. Sway drifts its rolling axis; a free screen-space pose from manual
 * gestures acts on top. Only the ball moves: the straw stays at the front. */
export function playerOrientation(orientation, phase, height = 3.5, wander = 0,
  playPose = IDENTITY_ORIENTATION) {
  const p = wrap(phase), turn = TAU * p, amount = clamp(wander, 0, 1);
  const tilt = (3.5 - needleLatitudeAt(phase, height, wander)) * Math.PI / 7;
  const sway = amount * (.38 * Math.sin(TAU * 2 * p)
    + .20 * Math.sin(TAU * 5 * p));
  const roll = [Math.sin(turn / 2), 0, 0, Math.cos(turn / 2)];
  const steer = [0, Math.sin(sway / 2), 0, Math.cos(sway / 2)];
  const bias = [Math.sin(tilt / 2), 0, 0, Math.cos(tilt / 2)];
  return multiplyOrientation(playPose, multiplyOrientation(bias,
    multiplyOrientation(steer, multiplyOrientation(roll, orientation))));
}
/** Probe the same fixed point used by the painting, in recorded ball space. */
export const needleNormalAt = (orientation, phase, height, wander = 0,
  playPose = IDENTITY_ORIENTATION) =>
  rotateNormal(inverseOrientation(playerOrientation(orientation, phase, height, wander, playPose)),
    FIXED_TIP);

/** Straight floor waveforms; this row is NOT the grain's address on the ball. */
export function laneAt(index, phase) {
  if (!Number.isInteger(index) || index < 0 || index >= SOURCE_COUNT) return NaN;
  return Number.isFinite(phase) ? index : NaN;
}

/** A newly picked-up cell has a reproducible size, including after Undo.
 * Changing these controls never mutates audio or zones already on the marble. */
export function grainSizeFor(key, grainMs = DEFAULT_GRAIN_MS,
  mode = "fixed", spreadMs = 60) {
  if (!Number.isSafeInteger(key) || key < 0
    || !Number.isFinite(grainMs) || grainMs < MIN_GRAIN_MS || grainMs > MAX_GRAIN_MS
    || !["fixed", "random"].includes(mode)
    || !Number.isFinite(spreadMs) || spreadMs < 0 || spreadMs > 100)
    throw new RangeError("Invalid globule grain size.");
  return mode === "fixed" ? grainMs
    : clamp(Math.round((grainMs + (hash(key, 0, 409) * 2 - 1) * spreadMs) / 10) * 10,
      MIN_GRAIN_MS, MAX_GRAIN_MS);
}

/**
 * Plan one continuous roll. All eight sources are eligible at every step;
 * a source/time cell can stick only once until an undo, reset or new placement.
 * Source and tape position identify the SOUND, not a row on the sphere.
 * Orientation maps ball-local normals to world space; neither axis is fixed
 * to a source or to the player's initial view of the marble.
 */
export function collectSweep(existing, from, to,
  orientation = IDENTITY_ORIENTATION, footprint = PICKUP_REACH,
  grainMs = DEFAULT_GRAIN_MS, floorIds = INITIAL_FLOOR_IDS,
  grainMode = "fixed", grainSpreadMs = 60) {
  if (!Array.isArray(existing) || ![from?.phase, from?.lane, to?.phase, to?.lane,
    footprint, grainMs].every(Number.isFinite)
    || !Array.isArray(orientation) || orientation.length !== 4
    || !orientation.every(Number.isFinite) || Math.abs(Math.hypot(...orientation) - 1) > .0001
    || footprint <= 0 || footprint > 3
    || grainMs < MIN_GRAIN_MS || grainMs > MAX_GRAIN_MS
    || !["fixed", "random"].includes(grainMode)
    || !Number.isFinite(grainSpreadMs) || grainSpreadMs < 0 || grainSpreadMs > 100
    || !Array.isArray(floorIds) || floorIds.length !== SOURCE_COUNT
    || new Set(floorIds).size !== SOURCE_COUNT
    || !floorIds.every(id => Number.isSafeInteger(id) && id >= 0
      && id <= Math.floor(Number.MAX_SAFE_INTEGER / SLICE_CELLS) - 1))
    throw new RangeError("Invalid globule roll.");
  const taken = new Set(existing.map(ribbon => ribbon.key));
  const steps = Math.min(512, Math.max(1,
    Math.ceil(Math.abs(to.phase - from.phase) * SLICE_CELLS * 2),
    Math.ceil(Math.abs(to.lane - from.lane) * 12)));
  const added = [];
  let pose = orientation;
  const dx = (to.phase - from.phase) * FLOOR_WIDTH / steps;
  const dz = (to.lane - from.lane) * FLOOR_LANE / steps;
  for (let step = 0; step <= steps; step++) {
    if (step) pose = rollOrientation(pose, dx, dz, MARBLE_RADIUS);
    const fraction = step / steps;
    const phase = clamp(from.phase + (to.phase - from.phase) * fraction, 0, 1 - 1e-9);
    const lane = clamp(from.lane + (to.lane - from.lane) * fraction, 0, SOURCE_COUNT - 1);
    const cell = Math.min(SLICE_CELLS - 1, Math.floor(phase * SLICE_CELLS));
    for (let index = 0; index < SOURCE_COUNT; index++) {
      const latitude = laneAt(index, phase);
      if (Math.abs(latitude - lane) > footprint) continue;
      const key = floorIds[index] * SLICE_CELLS + cell;
      if (taken.has(key)) continue;
      taken.add(key);
      // Imprint at the underside of the *current* pose. Source displacement and
      // tiny seeded flecks spread a contact into a patch, never a latitude row.
      const offsetX = ((cell + .5) / SLICE_CELLS - phase) * FLOOR_WIDTH / MARBLE_RADIUS;
      const offsetZ = (latitude - lane) * FLOOR_LANE / MARBLE_RADIUS;
      const contact = unit([
        clamp(offsetX * .8 + (hash(key, 0, 17) - .5) * .18, -.9, .9),
        -1,
        clamp(offsetZ * .8 + (hash(key, 0, 47) - .5) * .18, -.9, .9),
      ]);
      const normal = rotateNormal(inverseOrientation(pose), contact);
      const size = grainSizeFor(key, grainMs, grainMode, grainSpreadMs);
      const spread = Math.sqrt(size / DEFAULT_GRAIN_MS);
      added.push({
        key, sourceIndex: index, cell, phase: (cell + .5) / SLICE_CELLS,
        normal, ...coordinatesOf(normal), grainMs: size,
        angularRadius: (.015 + hash(key, 0, 109) * .016) * spread,
        latitudeRadius: (.38 + hash(key, 0, 127) * .42) * spread,
        tilt: (hash(key, 0, 163) - .5) * 1.3,
        shapeSeed: hash(key, 0, 191),
      });
    }
  }
  return { added, orientation: pose };
}

/** Own a copy of the picked-up sound: changing a source later cannot rewrite the ball. */
export function cutRibbon(source, cell, grainMs = DEFAULT_GRAIN_MS) {
  const channels = source?.channels;
  const sampleRate = source?.sampleRate;
  if (!Number.isInteger(cell) || cell < 0 || cell >= SLICE_CELLS
    || !Number.isFinite(grainMs) || grainMs < MIN_GRAIN_MS || grainMs > MAX_GRAIN_MS
    || ![1, 2].includes(channels?.length)
    || !Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 48000
    || !channels.every(channel => channel instanceof Float32Array
      && channel.length === channels[0].length)
    || channels[0].length < sampleRate * .1
    || channels[0].length > sampleRate * 90)
    throw new RangeError("A source ribbon needs bounded decoded mono or stereo audio.");
  const length = channels[0].length;
  const frames = Math.round(sampleRate * grainMs / 1000);
  const start = Math.floor((cell + .5) / SLICE_CELLS * length - frames / 2);
  return { sampleRate, duration: frames / sampleRate,
    channels: channels.map(data => Float32Array.from({ length: frames }, (_, frame) => {
      const sample = data[((start + frame) % length + length) % length];
      return Number.isFinite(sample) ? clamp(sample, -1, 1) : 0;
    })) };
}

/** A continuous ball-tilt path. Sway rolls patches beneath the parked tip. */
export function needleLatitudeAt(phase, height, wander = 0) {
  const p = wrap(phase), amount = clamp(wander, 0, 1);
  const motion = .56 * Math.sin(TAU * 2 * p)
    + .29 * Math.sin(TAU * 5 * p)
    + .15 * Math.sin(TAU * 9 * p);
  return clamp(clamp(height, 0, 7) + 2.75 * amount * motion, 0, 7);
}

/** Angular radius of the parked straw's reading disk, in radians. The width
 * changes how many spots it overlaps, never their stored audio or location. */
export const needleRadius = width => .19 * clamp(width, 0, 100) / 100;

/** The same softly irregular edge is used for collision and the painted spot. */
export function zoneEdge(zone, theta) {
  const seed = zone.shapeSeed ?? 0;
  return .88 + .09 * Math.sin(3 * theta + TAU * seed)
    + .065 * Math.sin(5 * theta - TAU * seed * 1.37);
}

/** The same tangent plane is used to draw each ragged mark and test contact.
 * It is defined at the poles too, where longitude has no physical meaning. */
export function zoneBasis(zone) {
  const center = zone.normal ?? normalAt(zone.angle, zone.latitude);
  const azimuth = TAU * zone.angle;
  const east = [Math.cos(azimuth), 0, -Math.sin(azimuth)];
  const north = [
    center[1] * east[2] - center[2] * east[1],
    center[2] * east[0] - center[0] * east[2],
    center[0] * east[1] - center[1] * east[0],
  ];
  return { center, east, north };
}
export function zoneSurfacePoint(zone, u, v, basis = zoneBasis(zone)) {
  const x = Math.tan(u * TAU * zone.angularRadius);
  const y = Math.tan(v * Math.PI * zone.latitudeRadius / 7);
  return unit(basis.center.map((value, index) =>
    value + basis.east[index] * x + basis.north[index] * y));
}
/** A circular needle footprint must actually overlap the ragged grain zone.
 * The nearest boundary point along the center-to-tip ray is a conservative
 * contact test: no nearby but untouched patch can become a fallback sound. */
export function zoneContainsNormal(zone, probe, contactRadius = 0) {
  if (!Array.isArray(probe) || probe.length !== 3 || !probe.every(Number.isFinite)
    || !Number.isFinite(zone?.angle) || !Number.isFinite(zone?.latitude)
    || !Number.isFinite(zone?.angularRadius) || !Number.isFinite(zone?.latitudeRadius)
    || zone.angularRadius <= 0 || zone.latitudeRadius <= 0
    || !Number.isFinite(contactRadius) || contactRadius < 0) return false;
  const radius = clamp(contactRadius, 0, .25);
  const basis = zoneBasis(zone), facing = dot(probe, basis.center);
  const horizontal = TAU * zone.angularRadius;
  const vertical = Math.PI * zone.latitudeRadius / 7;
  const reach = Math.max(horizontal, vertical) * 1.2 + radius;
  if (facing < Math.cos(reach)) return false;
  const x = Math.atan2(dot(probe, basis.east), facing)
    / horizontal;
  const y = Math.atan2(dot(probe, basis.north), facing)
    / vertical;
  const tilt = zone.tilt ?? 0, cosine = Math.cos(tilt), sine = Math.sin(tilt);
  const u = x * cosine + y * sine, v = y * cosine - x * sine;
  const normalized = Math.hypot(u, v);
  const edge = zoneEdge(zone, Math.atan2(v, u));
  if (normalized <= edge) return true;
  return radius > 0 && Math.hypot(x * horizontal, y * vertical)
    * (1 - edge / normalized) <= radius;
}
export function zoneContains(zone, phase, needle, contactRadius = 0) {
  if (!Number.isFinite(phase) || !Number.isFinite(needle)) return false;
  return zoneContainsNormal(zone, normalAt(phase, needle), contactRadius);
}

/** A contact starts a grain; the zone's source/time never determines its address. */
export function grainHit(zone, wander = 0, strike = 0, direction = 1) {
  const variation = clamp(wander, 0, 1);
  return {
    ribbon: zone,
    reverse: (direction === -1) !== (hash(zone.key, strike, 109) < variation * .35),
    rate: clamp(1 + (hash(zone.key, strike, 433) * 2 - 1) * variation * .28, .72, 1.28),
    pan: clamp((zone.latitude - 3.5) / 3.5 * .62, -.62, .62),
  };
}

export const phaseAt = ({ phase, anchorMs, playing, speed, direction = 1 }, nowMs) =>
  wrap(phase + (playing ? Math.max(0, nowMs - anchorMs) / (1000 * ORBIT_SECONDS)
    * speed * direction : 0));

export const coveredSources = ribbons => new Set(ribbons.map(ribbon => ribbon.sourceIndex)).size;
