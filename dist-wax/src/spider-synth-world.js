import { getSpiderSpecimen } from './spider-synth-specimens.js?v=ba050afc7c8e';
import { constrainSpiderSupportBody } from './spider-synth-collision.js?v=ba050afc7c8e';
import { writeSpiderFrame, writeSpiderFrameBody, writeSpiderBody, writeSpiderSupportBody, writeSpiderPose, writeSpiderLegOffset, createSpiderFrame, constrainSpiderBodyPose, SPIDER_JOINTS, SPIDER_MOTION_PRESETS } from './spider-synth-model.js?v=ba050afc7c8e';
import { projectSpiderWebInto, spiderWebHeight, spiderWebGeometryKey } from './spider-synth-web.js?v=ba050afc7c8e';
import { createSpiderFootClearance, writeSpiderFootClearance, writeSpiderFootOutward, spiderFootFacesOutward, spiderFootNeutralX, spiderFootClearsBodies, spiderFeetClear } from './spider-synth-contact.js?v=ba050afc7c8e';

const TAU = Math.PI * 2;
const WAVE_ORDER = Object.freeze([0, 4, 1, 5, 2, 6, 3, 7]);
const ease = t => t * t * (3 - 2 * t);
const angleDelta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const footRecord = () => {
  const foot = { x: 0, y: 0, z: 0, space: 0, segmentId: 0, u: .5, step: 0, touchPhase: 0, touchTime: 0, touchBeat: 0, yaw: 0, hx: 0, hy: 0, hz: 0 };
  Object.defineProperty(foot, '_projectionCache', { value: { web: null, specimen: null, qx: 0, qz: 0, x: 0, y: 0, z: 0, yaw: 0, hx: 0, hy: 0, hz: 0, space: 0, px: 0, py: 0, pz: 0, segmentId: -1, u: .5 } });
  return foot;
};
const strideRecord = () => ({ serial: 0, a: 0, b: 0, ax: 0, ay: .06, az: 0, ayaw: 0, bx: 0, by: .06, bz: 0, byaw: 0, mask: 0, lift: .03, accepted: 0, eventEpoch: -1, from: Array.from({ length: 8 }, footRecord), to: Array.from({ length: 8 }, footRecord) });
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const finite = (v, d = 0) => Number.isFinite(Number(v)) ? Number(v) : d;
const clockOf = t => clamp(finite(t), 0, 1e9);
const MOTIONS = Object.fromEntries(SPIDER_MOTION_PRESETS.map(item => [item.id, item]));
const PATHS = ['hold', 'orbit', 'figure8', 'spiral', 'radial', 'patrol', 'random'];
export const SPIDER_TRAVEL_PATHS = Object.freeze(PATHS.map(id => Object.freeze({ id, label: ({ hold: 'Stay here', orbit: 'Orbit', figure8: 'Figure eight', spiral: 'Spiral route', radial: 'Out and back', patrol: 'Patrol', random: 'Seeded wander' })[id] })));
export function normalizeSpiderWorld(s = {}) {
  return { path: PATHS.includes(s.path) ? s.path : 'hold', speed: clamp(finite(s.speed, .65), 0, 2), range: clamp(finite(s.range, .45), 0, .85), joystick: { x: clamp(finite(s.joystick?.x), -1, 1), z: clamp(finite(s.joystick?.z), -1, 1) }, laySilk: s.laySilk === true, hunt: s.hunt === true, playing: s.playing !== false, seed: finite(s.seed, 1) >>> 0 };
}
function point() { return { x: 0, y: 0, z: 0, yaw: 0 }; }
function boundPoint(out) { const r = Math.hypot(out.x, out.z); if (r > .78) { out.x *= .78 / r; out.z *= .78 / r; } return out; }
const webKey = spiderWebGeometryKey;
function clone(value) { return JSON.parse(JSON.stringify(value)); }

/** Beat-indexed, reach-constrained strides give the same travel at touchdown in a
 * 20 Hz renderer and 200 Hz worklet. Only silk deposition samples a fixed 8 Hz
 * grid; a long seek retains at most 256 newest samples instead of unbounded work.
 * Commands/configuration and snapshots may allocate. Repeated sample calls use
 * pooled records, points and frame storage. All sound scheduling stays outside. */
export class SpiderSynthWorld {
  constructor(settings = {}) {
    this.settings = normalizeSpiderWorld(settings); this.clock = 0; this.gridOrigin = 0; this.webKey = ''; this.web = null;
    this.specimen = getSpiderSpecimen('argiope');
    this._clearance = createSpiderFootClearance(this.specimen.collisionProfile);
    this._clearancePose = new Float32Array(114);
    this._bodyCacheStamp = 0; this._bodyCacheCursor = 0;
    this._bodyCache = Array.from({ length: 32 }, () => ({ stamp: -1, time: -1, height: 0, pitch: 0, roll: 0, pose: new Float32Array(114) }));
    this._writePlannedFrame = writeSpiderFrameBody;
    this.motionScale = 1; this._motionKey = ''; this.travelHistory = [{ time: 0, x: 0, z: 0, settings: this.settings, target: null, scale: 1 }];
    this.prey = []; this.silkSegments = []; this.events = [];
    this._silkPool = Array.from({ length: 256 }, () => ({ id: 0, ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, born: 0, length: 0, angle: 0 }));
    this._eventPool = Array.from({ length: 64 }, () => ({ serial: 0, type: '', time: 0, id: 0, strength: 0, segmentId: -1, u: .5, length: 0, angle: 0 }));
    this._silkCursor = 0; this._eventCursor = 0; this.nextPreyId = 1; this.nextEventId = 1; this.lastSilkTick = 0; this.lastWorldTick = -1;
    this.point = point(); this.modelPoint = point(); this._before = point(); this._after = point(); this._samplePoint = point(); this._silkPoint = point(); this._anchor = null; this._silkAnchor = point(); this._projection = { x: 0, y: 0, z: 0, segmentId: 0, u: .5, distance: 0 };
    this._activeSilk = { ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, progress: 0 };
    this.frameClockOffset = 0; this.queryClock = null; this.contactItem = null; this.contactBeat = 0; this.contactTempo = 108; this.contactClockOffset = 0; this.playing = false; this._contactMode = ''; this._contactEpoch = 0;
    this._frameMotion = {}; this._stationaryCenter = { x: 0, z: 0 }; this._frozenContact = { valid: false, id: '', tempo: 108, clockOffset: 0, motionOffset: 0, motionTime: 0, preset: '', motionTempo: 108, travel: false }; this.contactIntensity = 0; this.anchorMotionAdvances = false; this.anchorQuery = false; this.anchorCutoff = Infinity; this._lastModeTime = 0;
    this.state = { time: 0, version: 0, graphVersion: 0, webKey: '', active: false, travelSpeed: 0, layingSpeed: 0, preyBuzz: 0, preyStruggle: 0, eating: 0, prey: this.prey, silkSegments: this.silkSegments, events: this.events, activeSilk: null, contactEpoch: 0 };
    this._phaseHistory = [{ time: 0, phase: 0, rate: 0 }]; this._tempo = 108; this._plannerReady = false; this._plannerEnabled = false;
    this._stridePool = Array.from({ length: 64 }, strideRecord); this._strideHistory = []; this._strideCursor = 0; this._strideSerial = 0; this._strideEnd = 0;
    this._strideFeet = Array.from({ length: 8 }, footRecord); this._supportFeet = Array.from({ length: 8 }, footRecord); this._targetFeet = Array.from({ length: 8 }, footRecord); this._swingFeet = Array.from({ length: 8 }, point); this._strideBody = point(); this._candidate = point(); this._aim = point(); this._overlay = point(); this._overlayScratch = new Float32Array(12);
    this._supportFrame = { body: this._clearance.body, pose: this._clearancePose, feet: this._swingFeet, airborne: false };
    this._overlayScale = 1; this._gestureFrom = [footRecord(), footRecord()]; this._gestureTo = [footRecord(), footRecord()];
    this._motionBeatOffset = 0; this._lastMotion = null; this._lastPose = null; this._lastMidi = null; this._forecastFrame = createSpiderFrame(); this._forecastKey = -Infinity; this._forecastConfig = { initialized: false, preset: '', tempo: 0, intensity: 0, playing: false, seed: 0, yaw: 0, cx: 0, cz: 0 }; this._previousFrameValid = false; this._previousFeet = Array.from({ length: 8 }, footRecord); this._epochTime = 0; this._overlayValues = new Float64Array(228); this._projectedFoot = footRecord(); this._forecastA = footRecord(); this._forecastB = footRecord();
    this._footEvents = []; this._footEventPool = Array.from({ length: 64 }, () => ({ serial: 0, epoch: 0, time: 0, legIndex: 0, kind: 'contact', manual: false, segmentId: -1, u: .5, impulse: 0, force: 0, speed: 0, angle: 0 })); this._footEventCursor = 0; this._nextFootSerial = 1;
    this.state.footEvents = this._footEvents; this.state.nextFootEventTime = Infinity; this.state.nextFootPlanTime = Infinity; this.state.strideLength = 0; this.state.stridePhase = 0; this.state.heading = 0;
  }

  _phaseAt(time) {
    for (let i = this._phaseHistory.length - 1; i >= 0; i -= 1) {
      const r = this._phaseHistory[i]; if (r.time <= time) return r.phase + (time - r.time) * r.rate;
    }
    return this._phaseHistory[0].phase;
  }
  _timeAtPhase(phase) {
    for (let i = this._phaseHistory.length - 1; i >= 0; i -= 1) {
      const r = this._phaseHistory[i];
      if (r.rate > 0 && phase >= r.phase - 1e-9) return r.time + (phase - r.phase) / r.rate;
    }
    return this._phaseHistory[0].time;
  }
  _setRate(time, rate) {
    const previous = this._phaseHistory[this._phaseHistory.length - 1]; if (previous.rate === rate) return;
    const phase = this._phaseAt(time); if (this._phaseHistory.length === 128) this._phaseHistory.shift();
    this._phaseHistory.push({ time, phase, rate }); this._invalidateContacts(time);
  }
  _invalidateContacts(time) { this._contactEpoch += 1; this._footEvents.length = 0; this._forecastKey = -Infinity; this._epochTime = time; }
  _manualTravel(time) { const e = this._entry(time); return Math.hypot(this.settings.joystick.x, this.settings.joystick.z) > 1e-6 || !!e.target; }
  _travelWanted(time) {
    if (this.settings.speed <= 0) return false;
    const e = this._entry(time);
    return !!(Math.hypot(this.settings.joystick.x, this.settings.joystick.z) > 1e-6 || e.target && Math.hypot(e.target.x - this.point.x, e.target.z - this.point.z) > .004 || this.settings.playing && (!this._lastMotion || this._lastMotion.intensity > 0) && this.settings.path !== 'hold' && this.settings.range > 1e-6);
  }
  _initPlanner(frame, phase) {
    this._strideHistory.length = 0; this._strideCursor = 0; this._strideSerial = 0; this._strideEnd = phase;
    this._strideBody.x = this.point.x; this._strideBody.z = this.point.z; this._strideBody.y = spiderWebHeight(this.web, this.point.x, this.point.z) + this.specimen.bodyHeight; this._strideBody.yaw = frame.body.yaw;
    for (const foot of this._strideFeet) foot.space = 0;
    writeSpiderFootClearance(this._clearance, frame.pose, this._strideBody, this._strideFeet);
    for (let i = 0; i < 8; i += 1) {
      const g = this.specimen.legs[i]; const c = Math.cos(this._strideBody.yaw); const s = Math.sin(this._strideBody.yaw); const f = this._strideFeet[i];
      const hx = this.point.x + g.hip[0] * c + g.hip[2] * s; const hz = this.point.z + g.hip[2] * c - g.hip[0] * s;
      this._clearance.legIndex = i; this._clearance.radius = this._clearance.radii[i]; this._clearance.footCount = i;
      writeSpiderFootOutward(this._clearance, g, this._strideBody, .012);
      const nx = spiderFootNeutralX(g);
      projectSpiderWebInto(this.web, this.point.x + nx * c + g.neutral[2] * s, this.point.z + g.neutral[2] * c - nx * s, f, hx, hz, g.reach * .72, this._strideBody.y + g.hip[1], true, g.innerReach + g.reachMargin, this._clearance);
      f.step = 0; f.touchPhase = phase; f.touchTime = this._lastMotionTime; f.touchBeat = this._lastMotionTime * this._tempo / 60; f.yaw = this._strideBody.yaw; f.hx = hx; f.hy = this._strideBody.y + g.hip[1]; f.hz = hz;
    }
    for (let i = 0; i < 8; i++) this._reserveFoot(this._strideFeet, i);
    this._plannerReady = true;
  }
  _reserveFoot(feet, index) {
    const foot = feet[index], radius = this._clearance.radii[index]; let space = .055;
    for (let i = 0; i < 8; i++) if (i !== index && feet[i].segmentId >= 0) {
      const other = feet[i], free = Math.hypot(foot.x - other.x, foot.y - other.y, foot.z - other.z) - radius - this._clearance.radii[i] - this._clearance.margin - (other.space || 0);
      space = Math.min(space, free * .45);
    }
    for (const body of this._clearance.bodies) {
      const axes = body.axes, center = body.worldCenter, x = foot.x - center.x, y = foot.y - center.y, z = foot.z - center.z;
      const rx = body.radii[0] + radius + this._clearance.margin, ry = body.radii[1] + radius + this._clearance.margin, rz = body.radii[2] + radius + this._clearance.margin;
      const distance = Math.hypot((axes[0] * x + axes[3] * y + axes[6] * z) / rx, (axes[1] * x + axes[4] * y + axes[7] * z) / ry, (axes[2] * x + axes[5] * y + axes[8] * z) / rz);
      space = Math.min(space, Math.min(rx, ry, rz) * (distance - 1));
    }
    foot.space = Math.max(0, space);
  }
  _routeTarget(phase, out) {
    const time = this._timeAtPhase(phase); const e = this._entry(Number.isFinite(time) ? time : this.clock); const s = e.settings;
    if (e.target) { out.x = e.target.x; out.z = e.target.z; return out; }
    const magnitude = Math.hypot(s.joystick.x, s.joystick.z);
    if (magnitude > 1e-6) { out.x = this._strideBody.x + s.joystick.x / magnitude * .3; out.z = this._strideBody.z + s.joystick.z / magnitude * .3; return boundPoint(out); }
    const age = Math.max(0, phase - finite(e.phase)); const p = age * s.speed * .3; const r = s.range;
    let x = e.x; let z = e.z;
    if (s.path === 'orbit') { x += r * Math.sin(p); z += r * (Math.cos(p) - 1) * .5; }
    if (s.path === 'figure8') { x += r * Math.sin(p); z += r * Math.sin(p * 2) * .45; }
    if (s.path === 'spiral') { const radius = r * (.35 + .3 * Math.sin(p * .31)); x += radius * Math.sin(p); z += radius * (Math.cos(p) - 1) * .5; }
    if (s.path === 'radial') z += r * Math.sin(p);
    if (s.path === 'patrol') { x += r * Math.sin(p) * .8; z += r * Math.sin(p * .5) * .55; }
    if (s.path === 'random') { const seed = s.seed % 101 / 101; x += r * (Math.sin(p * 1.13 + seed) - Math.sin(seed)) * .6; z += r * (Math.sin(p * .73 + seed * 3) - Math.sin(seed * 3)) * .6; }
    out.x = x; out.z = z; return boundPoint(out);
  }
  _supportFits(x, y, z, yaw, mask) {
    const c = Math.cos(yaw); const s = Math.sin(yaw);
    const body = this._clearance.body; body.x = x; body.y = y; body.z = z; body.yaw = yaw;
    writeSpiderFootClearance(this._clearance, this._lastPose, body);
    for (let i = 0; i < 8; i += 1) if (!(mask & 1 << i)) {
      const g = this.specimen.legs[i]; const f = this._supportFeet[i];
      const hx = x + g.hip[0] * c + g.hip[2] * s; const hz = z + g.hip[2] * c - g.hip[0] * s;
      const distance = Math.hypot(f.x - hx, f.y - y - g.hip[1], f.z - hz);
      if (distance > g.reach * .85 || distance < g.innerReach + g.reachMargin || !spiderFootClearsBodies(f, this._clearance, i) || !spiderFootFacesOutward(f, this._clearance, g, body, false)) return false;
    }
    return true;
  }
  _clearanceAt(phase, x, y, z, yaw) {
    const time = this.settings.playing ? Math.max(0, (phase + this._motionBeatOffset) * 60 / this._tempo) : this._lastMotionTime, pose = this._clearancePose;
    const body = this._clearance.body;
    let sample = null;
    for (const record of this._bodyCache) if (record.stamp === this._bodyCacheStamp && record.time === time) { sample = record; break; }
    if (!sample) {
      sample = this._bodyCache[this._bodyCacheCursor++ % 32];
      writeSpiderPose(time, this._lastMotion, pose);
      if (this._lastMidi) { for (let i = 0; i < 18; i++) pose[i] += finite(this._lastMidi[i]); constrainSpiderBodyPose(pose, this._lastMotion); }
      writeSpiderBody(time, this._lastMotion, this.web, body, pose);
      sample.stamp = this._bodyCacheStamp; sample.time = time; sample.pose.set(pose);
      sample.height = body.y - spiderWebHeight(this.web, body.x, body.z) - this.specimen.bodyHeight;
      sample.pitch = body.pitch; sample.roll = body.roll;
    } else pose.set(sample.pose);
    // Candidate retries change placement, not these nine exact clocked body
    // samples. Reuse the guarded local pose before applying each candidate's
    // independent translation/yaw; no interpolation or event-time quantization.
    body.y = y + sample.height; body.pitch = sample.pitch; body.roll = sample.roll;
    body.x = x; body.z = z; body.yaw = yaw + pose[1] * .2;
    return writeSpiderFootClearance(this._clearance, pose, body);
  }
  _planStride() {
    const selected = MOTIONS[this._lastMotion.preset] || MOTIONS['radial-run'];
    const item = selected.support || !selected.mask ? MOTIONS['radial-run'] : selected;
    const groups = item.gait === 'wave' ? 8 : item.gait === 'ripple' ? 4 : 2;
    const interval = Math.max(.1, item.period / groups); const index = this._strideSerial++;
    const phase = this._strideEnd; const end = phase + interval; const p = this._stridePool[this._strideCursor++ % 64];
    if (this._strideHistory.length === 64) this._strideHistory.shift(); this._strideHistory.push(p);
    const order = selected.direction === 'backward' ? groups - 1 - index % groups : index % groups;
    const mask = groups === 8 ? 1 << WAVE_ORDER[order] : groups === 4 ? (1 << order) | (1 << (4 + (order + 1) % 4)) : order ? 0x5a : 0xa5;
    for (let i = 0; i < 8; i += 1) this._projectAnchor(i, this._strideFeet[i], this._lastMotion, this._lastPose, this._lastMidi, this._supportFeet[i]);
    const body = this._strideBody;
    p.serial = index; p.a = phase; p.b = end; p.ax = body.x; p.ay = body.y; p.az = body.z; p.ayaw = body.yaw; p.mask = mask; p.lift = Math.max(.012, Math.min(.055, item.lift || .025)) * Math.max(.35, this._lastMotion.intensity || 0); p.eventEpoch = -1;
    this._routeTarget(end + interval * .5, this._aim);
    let dx = this._aim.x - body.x; let dz = this._aim.z - body.z; const distance = Math.hypot(dx, dz);
    const intensity = this._manualTravel(this.clock) ? Math.max(.5, this._lastMotion.intensity || 0) : this._lastMotion.intensity || 0;
    const stride = (.035 + .15 * Math.pow(this.settings.speed / 2, .8)) * intensity / groups;
    const amount = Math.min(1, stride / Math.max(1e-9, distance)); dx *= amount; dz *= amount;
    let targetYaw = distance > .001 ? Math.atan2(dx, dz) : body.yaw;
    if (selected.direction === 'backward') targetYaw += Math.PI;
    if (selected.direction === 'sideways') targetYaw += Math.PI / 2;
    if (selected.turnsPerLoop) targetYaw = TAU * (end + this._motionBeatOffset) / selected.loopBeats;
    let turn = clamp(angleDelta(targetYaw, body.yaw), -.28, .28);
    let feasible = false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
    let lo = 0; let hi = 1;
    for (let iteration = 0; iteration < 9; iteration += 1) {
      const f = (lo + hi) / 2; const x = body.x + dx * f; const z = body.z + dz * f; const y = spiderWebHeight(this.web, x, z) + this.specimen.bodyHeight;
      let valid = this._supportFits(x, y, z, body.yaw + turn * f, mask);
      if (valid) valid = this._supportFits(body.x + dx * f * .5, spiderWebHeight(this.web, body.x + dx * f * .5, body.z + dz * f * .5) + this.specimen.bodyHeight, body.z + dz * f * .5, body.yaw + turn * f * .5, mask);
      if (valid) lo = f; else hi = f;
    }
    feasible = false;
    for (let retry = 0; retry < 9 && !feasible; retry += 1) {
      p.bx = body.x + dx * lo; p.bz = body.z + dz * lo; p.by = spiderWebHeight(this.web, p.bx, p.bz) + this.specimen.bodyHeight; p.byaw = body.yaw + turn * lo; p.accepted = Math.hypot(dx * lo, dz * lo);
      const c = Math.cos(p.byaw); const s = Math.sin(p.byaw); feasible = true;
      // If support limits the turn, swing feet can prepare the next heading
      // before the body advances. Otherwise a long front pair can hold each
      // other at the shoulder boundary forever while the target is behind us.
      const footYaw = p.byaw + turn * (1 - lo) * .75, fc = Math.cos(footYaw), fs = Math.sin(footYaw);
      for (let i = 0; i < 8; i++) { Object.assign(p.from[i], this._strideFeet[i]); Object.assign(p.to[i], this._strideFeet[i]); }
      const targetBody = this._clearance.body; targetBody.x = p.bx; targetBody.y = p.by; targetBody.z = p.bz; targetBody.yaw = p.byaw;
      writeSpiderFootClearance(this._clearance, this._lastPose, targetBody, p.to);
      this._clearance.reservations = true;
      for (let i = 0; i < 8; i += 1) {
        const current = this._strideFeet[i];
        if (mask & 1 << i) {
          const g = this.specimen.legs[i]; const f = p.to[i]; const hx = p.bx + g.hip[0] * c + g.hip[2] * s; const hz = p.bz + g.hip[2] * c - g.hip[0] * s;
          this._clearance.legIndex = i; this._clearance.radius = this._clearance.radii[i];
          writeSpiderFootOutward(this._clearance, g, targetBody, .012);
          const nx = spiderFootNeutralX(g);
          projectSpiderWebInto(this.web, p.bx + nx * fc + g.neutral[2] * fs + dx * lo * .45, p.bz + g.neutral[2] * fc - nx * fs + dz * lo * .45, f, hx, hz, g.reach * .69, p.by + g.hip[1], true, g.innerReach + g.reachMargin, this._clearance);
          if (f.segmentId < 0) { feasible = false; break; }
          this._reserveFoot(p.to, i);
          f.step = current.step + 1; f.touchPhase = phase + interval * .88; f.touchTime = Math.max(0, (f.touchPhase + this._motionBeatOffset) * 60 / this._tempo); f.touchBeat = f.touchPhase + this._motionBeatOffset; f.yaw = p.byaw; f.hx = hx; f.hy = p.by + g.hip[1]; f.hz = hz;
        }
      }
      if (feasible) for (let i = 0; i < 8; i += 1) this._projectAnchor(i, p.to[i], this._lastMotion, this._lastPose, this._lastMidi, this._targetFeet[i]);
      // Check both the departing tip and new target during the whole swing.
      // Sparse holes cannot make a failed projection silently reuse a far toe.
      if (feasible) for (let k = 0; k <= 8 && feasible; k += 1) {
        const q = k / 8, f = ease(q), yaw = p.ayaw + (p.byaw - p.ayaw) * f, c = Math.cos(yaw), s = Math.sin(yaw);
        const x = p.ax + (p.bx - p.ax) * f, y = p.ay + (p.by - p.ay) * f, z = p.az + (p.bz - p.az) * f;
        this._clearanceAt(p.a + (p.b - p.a) * q, x, y, z, yaw);
        for (let i = 0; i < 8; i += 1) {
          const g = this.specimen.legs[i], a = this._supportFeet[i], b = this._targetFeet[i], qf = mask & 1 << i ? clamp((q - .12) / .76, 0, 1) : 0, f = ease(qf);
          const tx = a.x + (b.x - a.x) * f, ty = a.y + (b.y - a.y) * f + p.lift * Math.sin(Math.PI * qf), tz = a.z + (b.z - a.z) * f;
          const foot = this._swingFeet[i]; foot.x = tx; foot.y = ty; foot.z = tz;
          const distance = Math.hypot(tx - x - g.hip[0] * c - g.hip[2] * s, ty - y - g.hip[1], tz - z - g.hip[2] * c + g.hip[0] * s);
          if (distance > g.reach * .9 || distance < g.innerReach + g.reachMargin || !spiderFootFacesOutward(foot, this._clearance, g, this._clearance.body, false)) { feasible = false; break; }
        }
        if (feasible) for (let i = 0; i < 8 && feasible; i++) for (let j = 0; j < i; j++) if (!spiderFeetClear(this._swingFeet[i], this._swingFeet[j], this._clearance, i, j)) { feasible = false; break; }
        // Accept the support pair only if a complete root transform exists.
        // A yaw-only check would reject playable MIDI turns; ignoring this
        // interval feasibility would commit an impossible pair of forefeet.
        if (feasible) {
          this._supportFrame.body = this._clearance.body;
          feasible = constrainSpiderSupportBody(this._supportFrame, this.specimen.collisionProfile);
          if (feasible) {
            writeSpiderFootClearance(this._clearance, this._clearancePose, this._supportFrame.body);
            for (let i = 0; i < 8; i++) if (!spiderFootClearsBodies(this._swingFeet[i], this._clearance, i)) { feasible = false; break; }
          }
        }
      }
      if (!feasible) lo *= .5;
    }
      if (feasible && p.accepted > .0001) break;
      const radius = Math.hypot(body.x, body.z);
      if (attempt || radius < .35) break;
      // At an edge, a tangent turn can trap a stance against its inner reach
      // limit. One short supported backstep makes room; it is planned with the
      // same exact toe trajectories and produces its own actual contacts.
      dx = -body.x / radius * .035 * intensity; dz = -body.z / radius * .035 * intensity; turn = 0;
    }
    if (!feasible) {
      p.bx = p.ax; p.by = p.ay; p.bz = p.az; p.byaw = p.ayaw; p.accepted = 0; p.mask = 0;
      for (let i = 0; i < 8; i += 1) { Object.assign(p.from[i], this._strideFeet[i]); Object.assign(p.to[i], this._strideFeet[i]); }
    }
    for (let i = 0; i < 8; i += 1) Object.assign(this._strideFeet[i], p.to[i]);
    body.x = p.bx; body.y = p.by; body.z = p.bz; body.yaw = p.byaw; this._strideEnd = end; return p;
  }
  _planTo(phase) {
    if (!this._plannerReady) return;
    let iterations = 0;
    while (phase >= this._strideEnd - 1e-10 && iterations++ < 128) { const p = this._planStride(); this._forecastStride(p, Math.max(p.a, this._phaseAt(this._epochTime))); }
  }
  _strideAt(phase) {
    for (let i = this._strideHistory.length - 1; i >= 0; i -= 1) if (this._strideHistory[i].a <= phase + 1e-10) return this._strideHistory[i];
    return this._strideHistory[0];
  }
  _writeStridePoint(phase, out) {
    const p = this._strideAt(phase); if (!p) { Object.assign(out, this._strideBody); return out; }
    const f = ease(clamp((phase - p.a) / (p.b - p.a), 0, 1));
    out.x = p.ax + (p.bx - p.ax) * f; out.y = p.ay + (p.by - p.ay) * f; out.z = p.az + (p.bz - p.az) * f; out.yaw = p.ayaw + (p.byaw - p.ayaw) * f; return out;
  }
  _projectAnchor(i, anchor, motion, pose, midiOffsets, out) {
    Object.assign(out, anchor);
    writeSpiderLegOffset(i, finite(anchor.touchBeat, anchor.touchTime * this._tempo / 60) * 60 / this._tempo, motion, pose, midiOffsets, this._overlay, this._overlayScratch);
    this._overlay.x *= this._overlayScale; this._overlay.z *= this._overlayScale;
    if (this._overlay.x || this._overlay.z) {
      // Every planted target reserves a bounded, disjoint manipulation region.
      // A performer can bend a joint against its boundary without moving a
      // neighbor or changing the identity/timing of an established contact.
      if (anchor.space <= 1e-9) return out;
      const c = Math.cos(anchor.yaw); const s = Math.sin(anchor.yaw);
      const qx = anchor.x + this._overlay.x * c + this._overlay.z * s, qz = anchor.z + this._overlay.z * c - this._overlay.x * s, cache = anchor._projectionCache;
      if (cache && cache.web === this.web && cache.specimen === this.specimen && cache.qx === qx && cache.qz === qz && cache.x === anchor.x && cache.y === anchor.y && cache.z === anchor.z && cache.yaw === anchor.yaw && cache.hx === anchor.hx && cache.hy === anchor.hy && cache.hz === anchor.hz && cache.space === anchor.space) {
        if (cache.segmentId >= 0) { out.x = cache.px; out.y = cache.py; out.z = cache.pz; out.segmentId = cache.segmentId; out.u = cache.u; }
        return out;
      }
      const clearance = this._clearance;
      clearance.within = anchor; clearance.planes = null; clearance.feet = null;
      const geometry = this.specimen.legs[i], body = clearance.body;
      body.x = anchor.hx - geometry.hip[0] * c - geometry.hip[2] * s; body.y = anchor.hy - geometry.hip[1]; body.z = anchor.hz - geometry.hip[2] * c + geometry.hip[0] * s; body.yaw = anchor.yaw;
      writeSpiderFootOutward(clearance, geometry, body);
      const bodies = clearance.bodies; clearance.bodies = null;
      projectSpiderWebInto(this.web, qx, qz, this._projection, anchor.hx, anchor.hz, this.specimen.legs[i].reach * .9, anchor.hy, true, this.specimen.legs[i].innerReach + this.specimen.legs[i].reachMargin, clearance);
      clearance.bodies = bodies; clearance.within = null;
      if (cache) {
        cache.web = this.web; cache.specimen = this.specimen; cache.qx = qx; cache.qz = qz; cache.x = anchor.x; cache.y = anchor.y; cache.z = anchor.z; cache.yaw = anchor.yaw; cache.hx = anchor.hx; cache.hy = anchor.hy; cache.hz = anchor.hz; cache.space = anchor.space;
        cache.px = this._projection.x; cache.py = this._projection.y; cache.pz = this._projection.z; cache.segmentId = this._projection.segmentId; cache.u = this._projection.u;
      }
      if (this._projection.segmentId >= 0) { out.x = this._projection.x; out.y = this._projection.y; out.z = this._projection.z; out.segmentId = this._projection.segmentId; out.u = this._projection.u; }
    }
    return out;
  }
  _fitCurrentGesture(phase) {
    const p = this._strideAt(phase); if (!p) return;
    const legs = this.specimen.collisionProfile.legs;
    // The exact yaw interval guard has no constraints for these anatomies.
    // Their disjoint foot reservations already bound every joint overlay.
    if (legs[0].lengths[0] <= legs[0].lengths[1] + legs[0].lengths[2] + legs[0].lengths[3] && legs[4].lengths[0] <= legs[4].lengths[1] + legs[4].lengths[2] + legs[4].lengths[3]) { this._overlayScale = 1; return; }
    const start = clamp((phase - p.a) / (p.b - p.a), 0, 1);
    for (let attempt = 0; attempt < 5; attempt++) {
      this._overlayScale = attempt === 4 ? 0 : 2 ** -attempt;
      for (let n = 0; n < 2; n++) {
        const i = n * 4;
        this._projectAnchor(i, p.from[i], this._lastMotion, this._lastPose, this._lastMidi, this._gestureFrom[n]);
        this._projectAnchor(i, p.to[i], this._lastMotion, this._lastPose, this._lastMidi, this._gestureTo[n]);
      }
      let valid = true;
      for (let k = 0; k <= 8 && valid; k++) {
        const q = start + (1 - start) * k / 8, f = ease(q);
        const time = this.settings.playing ? Math.max(0, (p.a + (p.b - p.a) * q + this._motionBeatOffset) * 60 / this._tempo) : this._lastMotionTime;
        const body = this._clearance.body;
        writeSpiderSupportBody(time, this._lastMotion, this.web, body, this._clearancePose, this._lastMidi);
        const height = body.y - spiderWebHeight(this.web, body.x, body.z) - this.specimen.bodyHeight;
        body.x = p.ax + (p.bx - p.ax) * f; body.y = p.ay + (p.by - p.ay) * f + height; body.z = p.az + (p.bz - p.az) * f; body.yaw = p.ayaw + (p.byaw - p.ayaw) * f + this._clearancePose[1] * .2;
        for (let n = 0; n < 2; n++) {
          const i = n * 4, a = this._gestureFrom[n], b = this._gestureTo[n], qf = p.mask & 1 << i ? clamp((q - .12) / .76, 0, 1) : 0, amount = ease(qf), foot = this._swingFeet[i];
          foot.x = a.x + (b.x - a.x) * amount; foot.y = a.y + (b.y - a.y) * amount + p.lift * Math.sin(Math.PI * qf); foot.z = a.z + (b.z - a.z) * amount;
        }
        this._supportFrame.body = this._clearance.body;
        valid = constrainSpiderSupportBody(this._supportFrame, this.specimen.collisionProfile);
      }
      if (valid) return;
    }
  }
  _emitFootAt(time, kind, legIndex, f, impulse, speed, angle, manual = false) {
    if (!Number.isFinite(time) || f.segmentId < 0) return;
    const event = this._footEventPool[this._footEventCursor++ % 64]; if (this._footEvents.length === 64) this._footEvents.shift();
    event.serial = this._nextFootSerial++; event.epoch = this._contactEpoch; event.time = time; event.legIndex = legIndex; event.kind = kind; event.manual = manual === true; event.segmentId = f.segmentId; event.u = f.u; event.impulse = impulse; event.force = impulse; event.speed = speed; event.angle = angle; this._footEvents.push(event);
  }
  _footEvent(kind, phase, legIndex, f, impulse, speed, angle) {
    this._projectAnchor(legIndex, f, this._lastMotion, this._lastPose, this._lastMidi, this._projectedFoot);
    this._emitFootAt(this._timeAtPhase(phase), kind, legIndex, this._projectedFoot, impulse, speed, angle);
  }
  _strikeEvent(kind, p, phase, i, duration) {
    const a = this._projectAnchor(i, p.from[i], this._lastMotion, this._lastPose, this._lastMidi, this._forecastA);
    const b = this._projectAnchor(i, p.to[i], this._lastMotion, this._lastPose, this._lastMidi, this._forecastB);
    const dx = b.x - a.x, dz = b.z - a.z; const speed = Math.hypot(dx, b.y - a.y, dz, p.lift * 2) / (duration * .76);
    const angle = Math.hypot(dx, dz) > 1e-8 ? Math.atan2(dz, dx) : (this.web.segments[b.segmentId]?.angle || 0) + Math.PI / 2;
    this._emitFootAt(this._timeAtPhase(phase), kind, i, kind === 'contact' ? b : a, kind === 'contact' ? clamp(.15 + speed * .7, .1, .8) : .1, speed, angle);
  }
  _forecastStride(p, phase) {
    if (!p || p.eventEpoch === this._contactEpoch) return; p.eventEpoch = this._contactEpoch;
    const item = MOTIONS[this._lastMotion.preset];
    if (item?.support && this.settings.playing && this._lastMotion.intensity > 0) {
      // Airborne routines own body lift-off/landing. Ordinary step forecasts
      // cannot create a foot strike while the silk tether carries the body.
      const begin = p.a + this._motionBeatOffset, end = p.b + this._motionBeatOffset;
      for (let cycle = Math.floor(begin / item.period); cycle <= Math.floor(end / item.period); cycle += 1) {
        for (let edge = 0; edge < 2; edge += 1) {
          const beat = (cycle + (edge ? 1 : item.duty)) * item.period; const at = beat - this._motionBeatOffset;
          if (at < phase - 1e-9 || at < p.a - 1e-9 || at >= p.b - 1e-9) continue;
          writeSpiderFrame((beat + (edge ? 1e-8 : -1e-8)) * 60 / this._tempo, this._lastMotion, this.web, this._forecastFrame, undefined, this._lastMidi);
          this._writeLocomotionFrame(at, this._lastMotion, this._forecastFrame, undefined, this._lastMidi);
          for (let i = 0; i < 8; i += 1) { const f = this._forecastFrame.feet[i]; if (f.stance) this._emitFootAt(this._timeAtPhase(at), edge ? 'contact' : 'release', i, f, edge ? .45 * this._lastMotion.intensity : .1, f.speed, f.angle); }
        }
      }
      return;
    }
    const rate = this._phaseHistory.at(-1).rate; const duration = (p.b - p.a) / Math.max(.01, rate); const speed = p.accepted / duration;
    const angle = Math.atan2(p.bz - p.az, p.bx - p.ax); const release = p.a + (p.b - p.a) * .12; const landing = p.a + (p.b - p.a) * .88;
    for (let i = 0; i < 8; i += 1) if (p.mask & 1 << i) {
      if (release >= phase - 1e-9) this._strikeEvent('release', p, release, i, duration);
    }
    // Load is shared by actual planted legs, biased to the trailing feet.
    if (p.accepted > .0001) for (let i = 0; i < 8; i += 1) if (!(p.mask & 1 << i) && (p.a + p.b) / 2 >= phase - 1e-9) this._footEvent('pull', (p.a + p.b) / 2, i, p.from[i], clamp(p.accepted * (i % 4 + 1) * .3, 0, .2), speed, angle);
    for (let i = 0; i < 8; i += 1) if (p.mask & 1 << i && landing >= phase - 1e-9) this._strikeEvent('contact', p, landing, i, duration);
  }
  _forecastStationary(time, motionTime, motion, web, midiOffsets, playing) {
    const item = MOTIONS[motion.preset]; if (!playing || !item || !item.mask || item.duty >= 1 || !(motion.intensity > 0)) return;
    const beat = motionTime * this._tempo / 60; const cycle = Math.floor(beat / item.period);
    if (cycle === this._forecastKey) return; this._forecastKey = cycle;
    for (let i = 0; i < 8; i += 1) if (item.mask & 1 << i) {
      const offset = item.gait === 'together' ? 0 : item.gait === 'wave' ? i / 8 : item.gait === 'ripple' ? i % 4 / 4 : ((i < 4 ? i : i + 1) & 1) * .5;
      const landing = (Math.floor(beat / item.period + offset) + 1 - offset) * item.period;
      const release = landing - (1 - item.duty) * item.period;
      if (release >= beat) {
        writeSpiderFrame((release - 1e-8) * 60 / this._tempo, motion, web, this._forecastFrame, undefined, midiOffsets);
        const f = this._forecastFrame.feet[i];
        this._emitFootAt(time + (release - beat) * 60 / this._tempo, 'release', i, f, .1 * motion.intensity, f.speed, f.angle);
      }
      writeSpiderFrame((landing + 1e-8) * 60 / this._tempo, motion, web, this._forecastFrame, undefined, midiOffsets);
      const f = this._forecastFrame.feet[i];
      this._emitFootAt(time + (landing - beat) * 60 / this._tempo, 'contact', i, f, f.impact, f.speed, f.angle);
    }
  }
  _controlsChanged(motion, midiOffsets) {
    let changed = false;
    for (let j = 0; j < 38; j += 1) {
      const offset = motion.offsets?.[SPIDER_JOINTS[j].id];
      for (let axis = 0; axis < 3; axis += 1) {
        const i = j * 3 + axis; const value = finite(offset?.[axis === 0 ? 'x' : axis === 1 ? 'y' : 'z']); const midi = finite(midiOffsets?.[i]);
        if (this._overlayValues[i] !== value || this._overlayValues[114 + i] !== midi) changed = true;
        this._overlayValues[i] = value; this._overlayValues[114 + i] = midi;
      }
    }
    return changed;
  }
  _writeLocomotionFrame(phase, motion, frame, pose, midiOffsets) {
    const p = this._strideAt(phase); if (!p) return;
    this._writeStridePoint(phase, this.point); const q = clamp((phase - p.a) / (p.b - p.a), 0, 1);
    const localHeight = frame.body.y - spiderWebHeight(this.web, frame.body.x, frame.body.z) - this.specimen.bodyHeight;
    frame.body.x = this.point.x; frame.body.z = this.point.z; frame.body.y = this.point.y + localHeight;
    frame.body.yaw = this.point.yaw + frame.pose[1] * .2; frame.supportCount = 0;
    const rate = this._phaseHistory.at(-1).rate; const duration = (p.b - p.a) / Math.max(.01, rate); const moving = (p.mask & 255) !== 0;
    for (let i = 0; i < 8; i += 1) {
      const foot = frame.feet[i]; const a = p.from[i]; const b = p.to[i]; const active = moving && (p.mask & 1 << i) !== 0; const swing = active && q > .12 && q < .88;
      const progress = active ? clamp((q - .12) / .76, 0, 1) : 0; const f = ease(progress); const anchor = active && q >= .88 ? b : a;
      foot.x = progress >= 1 ? b.x : progress <= 0 ? a.x : a.x + (b.x - a.x) * f; foot.y = (progress >= 1 ? b.y : progress <= 0 ? a.y : a.y + (b.y - a.y) * f) + (swing ? p.lift * Math.sin(Math.PI * progress) : 0); foot.z = progress >= 1 ? b.z : progress <= 0 ? a.z : a.z + (b.z - a.z) * f;
      foot.stance = !swing && !frame.airborne; foot.airborne = frame.airborne; foot.step = anchor.step; foot.segmentId = anchor.segmentId; foot.u = anchor.u;
      this._projectAnchor(i, a, motion, pose, midiOffsets, this._projectedFoot);
      const ax = this._projectedFoot.x, ay = this._projectedFoot.y, az = this._projectedFoot.z;
      if (progress < 1) { foot.segmentId = this._projectedFoot.segmentId; foot.u = this._projectedFoot.u; }
      this._projectAnchor(i, b, motion, pose, midiOffsets, this._projectedFoot);
      if (progress >= 1) { foot.segmentId = this._projectedFoot.segmentId; foot.u = this._projectedFoot.u; }
      foot.x = progress <= 0 ? ax : progress >= 1 ? this._projectedFoot.x : ax + (this._projectedFoot.x - ax) * f;
      foot.y = (progress <= 0 ? ay : progress >= 1 ? this._projectedFoot.y : ay + (this._projectedFoot.y - ay) * f) + (swing ? p.lift * Math.sin(Math.PI * progress) : 0);
      foot.z = progress <= 0 ? az : progress >= 1 ? this._projectedFoot.z : az + (this._projectedFoot.z - az) * f;
      foot.speed = rate ? Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z, p.lift * 2) / (duration * .76) : 0;
      foot.impact = foot.airborne || !active ? 0 : clamp(.15 + foot.speed * .7, .1, .8);
      foot.angle = Math.hypot(b.x - a.x, b.z - a.z) > 1e-8 ? Math.atan2(b.z - a.z, b.x - a.x) : (this.web.segments[foot.segmentId]?.angle || 0) + Math.PI / 2;
      foot.force = foot.stance ? clamp(p.accepted * (i % 4 + 1) * .3 * Math.sin(Math.PI * q), 0, .2) : 0; foot.pull = foot.force; foot.pullAngle = Math.atan2(p.bz - p.az, p.bx - p.ax); foot.contactTime = this._timeAtPhase(anchor.touchPhase);
      if (foot.stance) frame.supportCount += 1;
    }
    this.state.strideLength = p.accepted; this.state.stridePhase = q; this.state.heading = this.point.yaw;
    constrainSpiderSupportBody(frame, this.specimen.collisionProfile);
  }

  _entry(time, cutoff = Infinity) {
    for (let i = this.travelHistory.length - 1; i >= 0; i -= 1) if (this.travelHistory[i].time <= time && this.travelHistory[i].time < cutoff) return this.travelHistory[i];
    return this.travelHistory[0];
  }

  writeTravel(time, out, cutoff = Infinity) {
    if (this._plannerReady) return this._writeStridePoint(this._phaseAt(time), out);
    const entry = this._entry(time, cutoff);
    out.x = entry.x; out.z = entry.z; out.y = this.web ? spiderWebHeight(this.web, out.x, out.z) + this.specimen.bodyHeight : this.specimen.bodyHeight; out.yaw = finite(entry.yaw); return out;
  }

  update(settings = {}, time = this.clock) {
    const t = clockOf(time); if (this._plannerReady && this._lastMotion) this._planTo(this._phaseAt(t)); this.writeTravel(t, this._samplePoint);
    const next = normalizeSpiderWorld({ ...this.settings, ...settings, joystick: settings.joystick || this.settings.joystick });
    if (JSON.stringify(next) === JSON.stringify(this.settings)) { this.clock = t; return this; }
    if (this.settings.playing && !next.playing) this._frozenContact.cutoff = t;
    this.settings = next;
    this._record(t, this._samplePoint.x, this._samplePoint.z, null);
    Object.assign(this.point, this._samplePoint); this._setRate(t, this._travelWanted(t) ? this._tempo / 60 : 0);
    this.clock = t; this.state.version += 1; return this;
  }
  _record(time, x, z, target) {
    if (this.travelHistory.length >= 128) this.travelHistory.shift();
    this.travelHistory.push({ time, x, z, yaw: this.point.yaw, settings: this.settings, target, scale: 1, phase: this._phaseAt(time) });
  }
  _emit(type, time, id, strength = 1, segmentId = -1, u = .5, length = .1, angle = 0) {
    const event = this._eventPool[this._eventCursor++ % 64];
    if (this.events.length === 64) this.events.shift();
    event.serial = this.nextEventId++; event.type = type; event.time = time; event.id = id; event.strength = strength; event.segmentId = segmentId; event.u = u; event.length = length; event.angle = angle;
    this.events.push(event);
  }

  command(command = {}, time = this.clock) {
    const t = clockOf(time); const type = command.type; this.clock = t;
    if (type === 'clear-silk') { this.silkSegments.length = 0; this._anchor = null; this.lastSilkTick = Math.floor((t - this.gridOrigin) * 8); }
    if (type === 'home') { this._plannerReady = false; this._plannerEnabled = false; this._strideHistory.length = 0; this.settings = normalizeSpiderWorld({ ...this.settings, joystick: { x: 0, z: 0 } }); const hub = this.web?.nodes.find(node => node.role === 'hub'); const x = hub?.x || 0; const z = hub?.z || 0; this.point.x = x; this.point.z = z; this._record(t, x, z, null); this._invalidateContacts(t); }
    if (type === 'reset') { this.prey.length = 0; this.silkSegments.length = 0; this.events.length = 0; this._anchor = null; this.lastSilkTick = Math.floor((t - this.gridOrigin) * 8); this.command({ type: 'home' }, t); }
    if (type === 'send-prey') {
      if (this.prey.length >= 8) this.prey.shift();
      const id = this.nextPreyId++; const angle = id * 2.399963229728653 + this.settings.seed * .17;
      const radius = .28 + ((id * 37 + this.settings.seed) % 19) / 19 * .2;
      this.prey.push({ id, state: 'flying', born: t, trappedAt: t + 1.1, eatenAt: null, huntAt: null, x: Math.sin(angle) * 1.1, y: .45, z: Math.cos(angle) * 1.1, targetX: Math.sin(angle) * radius, targetY: 0, targetZ: Math.cos(angle) * radius, segmentId: -1, u: .5, struggle: 0, trappedEmitted: false, eatenEmitted: false, struggleStep: -1 });
    }
    if (type === 'move') {
      this.writeTravel(t, this._samplePoint); const target = boundPoint({ x: finite(command.x), z: finite(command.z) }); this._record(t, this._samplePoint.x, this._samplePoint.z, target);
    }
    if (type === 'hunt') {
      let prey = null;
      for (let i = this.prey.length - 1; i >= 0; i -= 1) if (this.prey[i].state !== 'eaten' && (command.id === undefined || this.prey[i].id === command.id)) { prey = this.prey[i]; break; }
      if (prey) {
        this.writeTravel(t, this._samplePoint); prey.huntAt = t;
        this._record(t, this._samplePoint.x, this._samplePoint.z, { x: prey.targetX, z: prey.targetZ, preyId: prey.id });
        prey.eatenAt = null;
      }
    }
    if (type === 'pluck-silk') {
      const strand = this.silkSegments.find(item => item.id === (command.id ?? command.silkId));
      if (strand) this._emit('silk-pluck', t, strand.id, clamp(finite(command.strength ?? command.velocity, .6), 0, 1), -1, clamp(finite(command.u, .5), .025, .975), strand.length, finite(command.angle, strand.angle + Math.PI / 2));
    }
    this._setRate(t, this._travelWanted(t) ? this._tempo / 60 : 0); this.state.version += 1; return this;
  }

  _acceptWeb(web, time) {
    if (this.web === web) return;
    const key = webKey(web); if (key !== this.webKey) {
      this._bodyCacheStamp++;
      if (this.webKey) { this.prey.length = 0; this.silkSegments.length = 0; this.events.length = 0; }
      this._plannerReady = false; this._plannerEnabled = false; this._strideHistory.length = 0; this._footEvents.length = 0; this.webKey = key; this.state.webKey = key; this.state.graphVersion += 1; this._contactEpoch += 1; this._anchor = null; this.lastSilkTick = Math.floor((time - this.gridOrigin) * 8); this.lastWorldTick = Math.floor((time - this.gridOrigin) * 24) - 1;
    }
    this.web = web;
  }
  _writePrey(time, web, emit = true) {
    this.state.preyBuzz = 0; this.state.preyStruggle = 0; this.state.eating = 0;
    for (const prey of this.prey) {
      if (prey.segmentId < 0) { projectSpiderWebInto(web, prey.targetX, prey.targetZ, this._projection); prey.targetX = this._projection.x; prey.targetY = this._projection.y; prey.targetZ = this._projection.z; prey.segmentId = this._projection.segmentId; prey.u = this._projection.u; }
      const age = time - prey.born; const flight = clamp(age / 1.1, 0, 1); const angle = prey.id * 2.399963229728653 + this.settings.seed * .17;
      if (time < prey.trappedAt) {
        prey.state = 'flying'; prey.x = prey.targetX + Math.sin(angle) * (1 - flight); prey.z = prey.targetZ + Math.cos(angle) * (1 - flight); prey.y = prey.targetY + .4 * (1 - flight) + .04 * Math.sin(flight * Math.PI); prey.struggle = 0; this.state.preyBuzz += .35;
      } else {
        const ageTrapped = time - prey.trappedAt;
        if (emit && !prey.trappedEmitted) { this._emit('prey-trapped', prey.trappedAt, prey.id, .8, prey.segmentId, prey.u, web.segments[prey.segmentId]?.length || .1); prey.trappedEmitted = true; }
        if (emit && prey.huntAt !== null && prey.eatenAt === null) { this.writeTravel(time, this._samplePoint); if (Math.hypot(this._samplePoint.x - prey.targetX, this._samplePoint.z - prey.targetZ) < .035) prey.eatenAt = time + .8; }
        prey.state = prey.eatenAt !== null && time >= prey.eatenAt ? 'eaten' : prey.eatenAt !== null && time >= prey.eatenAt - .8 ? 'eating' : prey.huntAt !== null ? 'hunting' : 'trapped';
        prey.x = prey.targetX; prey.y = prey.targetY + .006; prey.z = prey.targetZ;
        prey.struggle = prey.state === 'eaten' ? 0 : Math.max(0, 1 - ageTrapped / 8) * (.5 + .5 * Math.sin(ageTrapped * 19 + prey.id));
        if (prey.state === 'eaten') { if (emit && !prey.eatenEmitted) { this._emit('prey-eaten', prey.eatenAt, prey.id, .5, prey.segmentId, prey.u); prey.eatenEmitted = true; } }
        else if (prey.state === 'eating') this.state.eating = Math.max(this.state.eating, .7);
        else {
          this.state.preyStruggle += prey.struggle * .15;
          const step = Math.floor(ageTrapped * 3);
          if (emit && ageTrapped < 8 && step > prey.struggleStep) { this._emit('prey-struggle', prey.trappedAt + step / 3, prey.id, .15 + prey.struggle * .2, prey.segmentId, prey.u, web.segments[prey.segmentId]?.length || .1); prey.struggleStep = step; }
        }
        if (emit && this.settings.hunt && prey.huntAt === null && prey.state === 'trapped') this.command({ type: 'hunt', id: prey.id }, prey.trappedAt);
      }
    }
    this.state.preyBuzz = Math.min(1, this.state.preyBuzz); this.state.preyStruggle = Math.min(1, this.state.preyStruggle);
  }

  _writeSilk(time, web) {
    const end = Math.floor((time - this.gridOrigin) * 8 + 1e-9); const start = Math.max(this.lastSilkTick + 1, end - 255);
    for (let tick = start; tick <= end; tick += 1) {
      const t = this.gridOrigin + tick / 8; const settings = this._entry(t).settings;
      if (!settings.laySilk) { this._anchor = null; continue; }
      this.writeTravel(t, this._silkPoint); this._silkPoint.x -= Math.sin(this._silkPoint.yaw) * .095; this._silkPoint.z -= Math.cos(this._silkPoint.yaw) * .095; this._silkPoint.y = spiderWebHeight(web, this._silkPoint.x, this._silkPoint.z) + .035;
      if (!this._anchor) { Object.assign(this._silkAnchor, this._silkPoint); this._anchor = this._silkAnchor; continue; }
      const a = this._anchor; const b = this._silkPoint; const length = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z); if (length < .002) continue;
      const strand = this._silkPool[this._silkCursor++ % 256]; if (this.silkSegments.length === 256) this.silkSegments.shift();
      strand.id = tick; strand.ax = a.x; strand.ay = a.y; strand.az = a.z; strand.bx = b.x; strand.by = b.y; strand.bz = b.z; strand.born = t; strand.length = length; strand.angle = Math.atan2(b.z - a.z, b.x - a.x); this.silkSegments.push(strand);
      a.x = b.x; a.y = b.y; a.z = b.z;
      this._emit('silk-laid', t, strand.id, clamp(length * 12, 0, 1), -1, .5, length, strand.angle); this.state.version += 1;
    }
    this.lastSilkTick = Math.max(this.lastSilkTick, end); this.state.activeSilk = null;
    if (this.settings.laySilk && this._anchor && this.state.travelSpeed > .0001) {
      const a = this._anchor; const b = this._activeSilk; b.ax = a.x; b.ay = a.y; b.az = a.z; b.bx = this.point.x - Math.sin(this.point.yaw) * .095; b.bz = this.point.z - Math.cos(this.point.yaw) * .095; b.by = spiderWebHeight(web, b.bx, b.bz) + .035; b.progress = 1; this.state.activeSilk = b;
    }
    this.state.layingSpeed = this.settings.laySilk ? this.state.travelSpeed : 0;
  }

  sample(clock, motion, web, frame, pose, midiOffsets, options = {}) {
    const time = clockOf(clock); const motionTime = clockOf(options.motionTime === undefined ? time : options.motionTime); const playing = options.playing === undefined ? this.settings.playing : options.playing === true;
    if (playing !== this.settings.playing) this.update({ playing }, time);
    this._acceptWeb(web, time);
    const specimen = getSpiderSpecimen(motion.specimen);
    const specimenChanged = specimen !== this.specimen;
    if (specimenChanged) {
      // Keep the current body location/beat; only the old anatomy's support
      // plan becomes invalid. The next stride uses the new leg measurements.
      if (this._plannerReady) this.writeTravel(time, this.point);
      this._record(time, this.point.x, this.point.z, this._entry(time).target);
      this.specimen = specimen; this._plannerReady = false; this._plannerEnabled = false;
      this._overlayScale = 1;
      this._clearance = createSpiderFootClearance(specimen.collisionProfile);
      this._strideHistory.length = 0; this._previousFrameValid = false; this._invalidateContacts(time);
    }
    if (pose) constrainSpiderBodyPose(pose, motion);
    const phaseBefore = this._phaseAt(time); this._tempo = clamp(finite(motion.tempo, 108), 20, 300); this._lastMotion = motion; this._lastMotionTime = motionTime; this._lastPose = pose; this._lastMidi = midiOffsets;
    const config = this._forecastConfig; const yaw = finite(motion.yaw), cx = finite(motion.center?.x), cz = finite(motion.center?.z);
    const configChanged = !config.initialized || config.specimen !== specimen.id || config.preset !== motion.preset || config.tempo !== this._tempo || config.intensity !== motion.intensity || config.playing !== playing || config.seed !== motion.seed || config.yaw !== yaw || config.cx !== cx || config.cz !== cz;
    config.initialized = true; config.specimen = specimen.id; config.preset = motion.preset; config.tempo = this._tempo; config.intensity = motion.intensity; config.playing = playing; config.seed = motion.seed; config.yaw = yaw; config.cx = cx; config.cz = cz;
    const controlsChanged = this._controlsChanged(motion, midiOffsets);
    if (configChanged || controlsChanged) { this._bodyCacheStamp++; this._invalidateContacts(time); }
    this._motionBeatOffset = motionTime * this._tempo / 60 - phaseBefore;
    if (this._plannerReady) this.writeTravel(time, this.point);
    const wanted = this._travelWanted(time); const rate = wanted ? this._tempo / 60 : 0;
    this._setRate(time, rate); const phase = this._phaseAt(time);
    if (controlsChanged && this._plannerReady) this._fitCurrentGesture(phase);
    if (!wanted && playing) this._plannerEnabled = false;
    this.writeTravel(time, this.point);
    this._stationaryCenter.x = this.point.x + finite(motion.center?.x); this._stationaryCenter.z = this.point.z + finite(motion.center?.z);
    const m = this._frameMotion; m.specimen = specimen.id; m.preset = motion.preset; m.tempo = motion.tempo; m.intensity = motion.intensity; m.seed = motion.seed; m.center = this._plannerEnabled || wanted ? motion.center : this._stationaryCenter; m.yaw = finite(motion.yaw) + (!this._plannerEnabled && !wanted ? this.point.yaw : 0); m.offsets = motion.offsets; m.explore = this._plannerEnabled || wanted ? false : motion.explore;
    if (this._plannerReady && (this._plannerEnabled || wanted)) this._writePlannedFrame(motionTime, m, web, frame, pose, midiOffsets);
    else writeSpiderFrame(motionTime, m, web, frame, pose, midiOffsets);
    if (wanted && !this._plannerReady) this._initPlanner(frame, specimenChanged ? phase : this._phaseHistory.at(-1).phase);
    if (wanted) { this._plannerEnabled = true; this._planTo(phase); }
    if (this._plannerEnabled && this._plannerReady) {
      this._writeLocomotionFrame(phase, m, frame, pose, midiOffsets);
      const p = this._strideAt(phase); if (wanted) this._forecastStride(p, phase);
    } else { this._forecastStationary(time, motionTime, m, web, midiOffsets, playing); }
    this.writeTravel(time, this.point); this.writeTravel(time - .001, this._before); this.writeTravel(time + .001, this._after);
    this.state.travelSpeed = wanted ? Math.hypot(this._after.x - this._before.x, this._after.z - this._before.z) / .002 : 0;
    const endTick = Math.floor((time - this.gridOrigin) * 24 + 1e-9); const startTick = Math.max(this.lastWorldTick + 1, endTick - 767);
    for (let tick = startTick; tick <= endTick; tick += 1) { this._writePrey(this.gridOrigin + tick / 24, web, true); this._writeSilk(this.gridOrigin + tick / 24, web); }
    this.lastWorldTick = Math.max(this.lastWorldTick, endTick); this._writePrey(time, web, false); this._writeSilk(time, web);
    let manualPull = false;
    if ((controlsChanged || configChanged && !playing) && this._previousFrameValid) for (let i = 0; i < 8; i += 1) {
      const f = frame.feet[i], before = this._previousFeet[i]; const distance = Math.hypot(f.x - before.x, f.y - before.y, f.z - before.z);
      if (f.stance && distance > 1e-5) { manualPull = true; this._emitFootAt(time, 'pull', i, f, Math.min(.7, distance * 20), distance / Math.max(.005, time - this.clock), Math.atan2(f.z - before.z, f.x - before.x), true); }
    }
    for (let i = 0; i < 8; i += 1) Object.assign(this._previousFeet[i], frame.feet[i]); this._previousFrameValid = true;
    frame.motionActive = playing || wanted || manualPull; frame.contactEpoch = this._contactEpoch;
    let planTime = wanted ? this._timeAtPhase(this._strideEnd) : Infinity;
    const stationary = MOTIONS[m.preset];
    if (!wanted && !this._plannerEnabled && playing && m.intensity > 0 && stationary?.mask && stationary.duty < 1) {
      const beat = motionTime * this._tempo / 60;
      const nextCycle = (Math.floor(beat / stationary.period + 1e-10) + 1) * stationary.period;
      planTime = time + (nextCycle - beat) * 60 / this._tempo;
    }
    this.state.nextFootPlanTime = planTime;
    let next = planTime;
    for (const event of this._footEvents) if (event.epoch === this._contactEpoch && event.time > time + 1e-9) next = Math.min(next, event.time);
    this.state.nextFootEventTime = next; this.clock = time; this.state.time = time; this.state.contactEpoch = this._contactEpoch;
    this.state.active = wanted || this.state.preyBuzz > 0 || this.state.preyStruggle > 0 || this.state.eating > 0 || this.state.activeSilk !== null;
    return this.state;
  }

  snapshot() {
    return clone({ version: 1, specimen: this.specimen.id, clock: this.clock, gridOrigin: this.gridOrigin, settings: this.settings, travelHistory: this.travelHistory, prey: this.prey, silkSegments: this.silkSegments, events: this.events, nextPreyId: this.nextPreyId, nextEventId: this.nextEventId, lastSilkTick: this.lastSilkTick, lastWorldTick: this.lastWorldTick, webKey: this.webKey, anchor: this._anchor, contactEpoch: this._contactEpoch, contactMode: this._contactMode, graphVersion: this.state.graphVersion, stateVersion: this.state.version, motionScale: this.motionScale, motionKey: this._motionKey, frozenContact: this._frozenContact, locomotion: { overlayScale: this._overlayScale, phaseHistory: this._phaseHistory, tempo: this._tempo, ready: this._plannerReady, enabled: this._plannerEnabled, cursor: this._strideCursor, serial: this._strideSerial, end: this._strideEnd, body: this._strideBody, feet: this._strideFeet, strides: this._strideHistory.slice(-8), nextFootSerial: this._nextFootSerial, footEvents: this._footEvents, motionBeatOffset: this._motionBeatOffset, forecastKey: this._forecastKey, forecastConfig: this._forecastConfig, epochTime: this._epochTime, overlayValues: Array.from(this._overlayValues) } });
  }
  restore(snapshot = {}, timeOffset = 0) {
    if (snapshot.version !== 1) return this;
    this.specimen = getSpiderSpecimen(snapshot.specimen);
    this._clearance = createSpiderFootClearance(this.specimen.collisionProfile);
    const delta = finite(timeOffset); this.clock = clockOf(finite(snapshot.clock) + delta); this.gridOrigin = finite(snapshot.gridOrigin) + delta; this.settings = normalizeSpiderWorld(snapshot.settings);
    this.travelHistory = (snapshot.travelHistory || []).slice(-128).map(e => ({ time: finite(e.time) + delta, x: clamp(finite(e.x), -.78, .78), z: clamp(finite(e.z), -.78, .78), yaw: finite(e.yaw), phase: finite(e.phase), settings: normalizeSpiderWorld(e.settings), scale: clamp(finite(e.scale, 1), 0, 1), target: e.target ? { x: clamp(finite(e.target.x), -.78, .78), z: clamp(finite(e.target.z), -.78, .78), preyId: finite(e.target.preyId) } : null }));
    if (!this.travelHistory.length) this.travelHistory.push({ time: this.clock, x: 0, z: 0, settings: this.settings, target: null });
    this.prey.length = 0;
    for (const record of (snapshot.prey || []).slice(-8)) { const prey = { ...record }; for (const key of ['born', 'trappedAt', 'huntAt', 'eatenAt']) if (prey[key] !== null && Number.isFinite(prey[key])) prey[key] += delta; this.prey.push(prey); }
    this.silkSegments.length = 0; this._silkCursor = 0;
    for (const record of (snapshot.silkSegments || []).slice(-256)) { const strand = this._silkPool[this._silkCursor++]; Object.assign(strand, record); strand.born += delta; this.silkSegments.push(strand); }
    this.events.length = 0; this._eventCursor = 0;
    for (const record of (snapshot.events || []).slice(-64)) { const event = this._eventPool[this._eventCursor++]; Object.assign(event, record); event.time += delta; this.events.push(event); }
    this.nextPreyId = Math.max(1, finite(snapshot.nextPreyId, 1)); this.nextEventId = Math.max(1, finite(snapshot.nextEventId, 1)); this.lastSilkTick = Math.floor(finite(snapshot.lastSilkTick)); this.lastWorldTick = Math.floor(finite(snapshot.lastWorldTick)); this.webKey = String(snapshot.webKey || ''); this.state.webKey = this.webKey;
    this.motionScale = clamp(finite(snapshot.motionScale, 1), 0, 1); this._motionKey = String(snapshot.motionKey || ''); if (snapshot.frozenContact) { Object.assign(this._frozenContact, snapshot.frozenContact); this._frozenContact.clockOffset += delta; this._frozenContact.motionOffset += delta; if (this._frozenContact.cutoff !== null && this._frozenContact.cutoff !== undefined) this._frozenContact.cutoff += delta; } this._anchor = snapshot.anchor ? Object.assign(this._silkAnchor, snapshot.anchor) : null; this._contactEpoch = finite(snapshot.contactEpoch); this._contactMode = snapshot.contactMode || ''; this.state.graphVersion = finite(snapshot.graphVersion); this.state.version = finite(snapshot.stateVersion);
    const loc = snapshot.locomotion;
    if (loc) {
      this._overlayScale = clamp(finite(loc.overlayScale, 1), 0, 1);
      this._phaseHistory = (loc.phaseHistory || []).slice(-128).map(r => ({ time: finite(r.time) + delta, phase: finite(r.phase), rate: clamp(finite(r.rate), 0, 5) }));
      if (!this._phaseHistory.length) this._phaseHistory.push({ time: this.clock, phase: 0, rate: 0 });
      this._tempo = clamp(finite(loc.tempo, 108), 20, 300); this._plannerReady = loc.ready === true; this._plannerEnabled = loc.enabled === true; this._strideSerial = finite(loc.serial); this._strideEnd = finite(loc.end); Object.assign(this._strideBody, loc.body);
      for (let i = 0; i < 8; i += 1) if (loc.feet?.[i]) Object.assign(this._strideFeet[i], loc.feet[i]);
      this._strideHistory.length = 0; this._strideCursor = 0;
      for (const source of (loc.strides || []).slice(-8)) { const p = this._stridePool[this._strideCursor++]; for (const key of ['serial','a','b','ax','ay','az','ayaw','bx','by','bz','byaw','mask','lift','accepted','eventEpoch']) p[key] = finite(source[key]); for (let i = 0; i < 8; i += 1) { Object.assign(p.from[i], source.from[i]); Object.assign(p.to[i], source.to[i]); } this._strideHistory.push(p); }
      this._footEvents.length = 0; this._footEventCursor = 0;
      for (const source of (loc.footEvents || []).slice(-64)) { const e = this._footEventPool[this._footEventCursor++]; Object.assign(e, source); e.manual = source.manual === true; e.time += delta; this._footEvents.push(e); }
      this._nextFootSerial = Math.max(1, finite(loc.nextFootSerial, 1)); this._motionBeatOffset = finite(loc.motionBeatOffset); this._forecastKey = Number.isFinite(loc.forecastKey) ? loc.forecastKey : -Infinity; if (loc.forecastConfig && typeof loc.forecastConfig === 'object') Object.assign(this._forecastConfig, loc.forecastConfig); this._epochTime = finite(loc.epochTime) + delta; this._overlayValues.set((loc.overlayValues || []).slice(0, 228));
    }
    return this;
  }
}
export const createSpiderWorld = settings => new SpiderSynthWorld(settings);
