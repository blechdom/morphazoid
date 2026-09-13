import { writeSpiderFrame, SPIDER_MOTION_PRESETS } from './spider-synth-model.js?v=74d232932f0e';
import { projectSpiderWebInto, spiderWebHeight } from './spider-synth-web.js?v=74d232932f0e';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const finite = (v, d = 0) => Number.isFinite(Number(v)) ? Number(v) : d;
const clockOf = t => clamp(finite(t), 0, 1e9);
const MOTIONS = Object.fromEntries(SPIDER_MOTION_PRESETS.map(item => [item.id, item]));
const PATHS = ['hold', 'orbit', 'figure8', 'spiral', 'radial', 'patrol', 'random'];
export const SPIDER_TRAVEL_PATHS = Object.freeze(PATHS.map(id => Object.freeze({ id, label: ({ hold: 'Stay here', orbit: 'Orbit', figure8: 'Figure eight', spiral: 'Spiral route', radial: 'Out and back', patrol: 'Patrol', random: 'Seeded wander' })[id] })));
export function normalizeSpiderWorld(s = {}) {
  return { path: PATHS.includes(s.path) ? s.path : 'hold', speed: clamp(finite(s.speed, .65), 0, 2), range: clamp(finite(s.range, .45), 0, .58), joystick: { x: clamp(finite(s.joystick?.x), -1, 1), z: clamp(finite(s.joystick?.z), -1, 1) }, laySilk: s.laySilk === true, hunt: s.hunt === true, playing: s.playing !== false, seed: finite(s.seed, 1) >>> 0 };
}
function point() { return { x: 0, y: 0, z: 0, yaw: 0 }; }
function boundPoint(out) { const r = Math.hypot(out.x, out.z); if (r > .55) { out.x *= .55 / r; out.z *= .55 / r; } return out; }
function webKey(web) { return [web.preset, web.spokes, web.rings, web.seed, web.asymmetry, web.twist, web.irregularity, web.depth, web.stabilimentum].join(':'); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }

/** Analytic command history gives exactly the same travel at touchdown in a
 * 20 Hz renderer and 200 Hz worklet. Only silk deposition samples a fixed 8 Hz
 * grid; a long seek retains at most 256 newest samples instead of unbounded work.
 * Commands/configuration and snapshots may allocate. Repeated sample calls use
 * pooled records, points and frame storage. All sound scheduling stays outside. */
export class SpiderSynthWorld {
  constructor(settings = {}) {
    this.settings = normalizeSpiderWorld(settings); this.clock = 0; this.gridOrigin = 0; this.webKey = ''; this.web = null;
    this.motionScale = 1; this._motionKey = ''; this.travelHistory = [{ time: 0, x: 0, z: 0, settings: this.settings, target: null, scale: 1 }];
    this.prey = []; this.silkSegments = []; this.events = [];
    this._silkPool = Array.from({ length: 256 }, () => ({ id: 0, ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, born: 0, length: 0, angle: 0 }));
    this._eventPool = Array.from({ length: 64 }, () => ({ serial: 0, type: '', time: 0, id: 0, strength: 0, segmentId: -1, u: .5, length: 0, angle: 0 }));
    this._silkCursor = 0; this._eventCursor = 0; this.nextPreyId = 1; this.nextEventId = 1; this.lastSilkTick = 0; this.lastWorldTick = -1;
    this.point = point(); this.modelPoint = point(); this._before = point(); this._after = point(); this._samplePoint = point(); this._silkPoint = point(); this._anchor = null; this._projection = { x: 0, y: 0, z: 0, segmentId: 0, u: .5, distance: 0 };
    this._activeSilk = { ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, progress: 0 };
    this.frameClockOffset = 0; this.queryClock = null; this.contactItem = null; this.contactBeat = 0; this.contactTempo = 108; this.contactClockOffset = 0; this.playing = false; this._contactMode = ''; this._contactEpoch = 0;
    this._frameMotion = {}; this._frozenContact = { valid: false, id: '', tempo: 108, clockOffset: 0, motionOffset: 0, motionTime: 0, preset: '', motionTempo: 108, travel: false }; this.contactIntensity = 0; this.anchorMotionAdvances = false; this.anchorQuery = false; this.anchorCutoff = Infinity; this._lastModeTime = 0;
    this.state = { time: 0, version: 0, graphVersion: 0, webKey: '', active: false, travelSpeed: 0, layingSpeed: 0, preyBuzz: 0, preyStruggle: 0, eating: 0, prey: this.prey, silkSegments: this.silkSegments, events: this.events, activeSilk: null, contactEpoch: 0 };
  }

  _entry(time, cutoff = Infinity) {
    for (let i = this.travelHistory.length - 1; i >= 0; i -= 1) if (this.travelHistory[i].time <= time && this.travelHistory[i].time < cutoff) return this.travelHistory[i];
    return this.travelHistory[0];
  }

  writeTravel(time, out, cutoff = Infinity) {
    const entry = this._entry(time, cutoff); const s = entry.settings; const age = Math.max(0, time - entry.time); const phase = age * s.speed * .22 * (entry.scale ?? 1); const r = s.range;
    let x = entry.x; let z = entry.z;
    if (entry.target) {
      const dx = entry.target.x - x; const dz = entry.target.z - z; const distance = Math.hypot(dx, dz); const f = Math.min(1, age * Math.max(.04, s.speed * .09) * (entry.scale ?? 1) / Math.max(.001, distance));
      x += dx * f; z += dz * f;
    } else if (Math.abs(s.joystick.x) + Math.abs(s.joystick.z) > 1e-6) {
      const magnitude = Math.max(1, Math.hypot(s.joystick.x, s.joystick.z));
      x += s.joystick.x / magnitude * age * s.speed * .08 * (entry.scale ?? 1); z += s.joystick.z / magnitude * age * s.speed * .08 * (entry.scale ?? 1);
    } else if (s.playing && s.path !== 'hold') {
      if (s.path === 'orbit') { x += r * Math.sin(phase); z += r * (Math.cos(phase) - 1) * .5; }
      if (s.path === 'figure8') { x += r * Math.sin(phase); z += r * Math.sin(phase * 2) * .45; }
      if (s.path === 'spiral') { const radius = r * (.35 + .3 * Math.sin(phase * .31)); x += radius * Math.sin(phase); z += radius * (Math.cos(phase) - 1) * .5; }
      if (s.path === 'radial') z += r * Math.sin(phase);
      if (s.path === 'patrol') { x += r * Math.sin(phase) * .8; z += r * Math.sin(phase * .5) * .55; }
      if (s.path === 'random') { const seed = (s.seed % 101) / 101; x += r * (Math.sin(phase * 1.13 + seed) - Math.sin(seed)) * .6; z += r * (Math.sin(phase * .73 + seed * 3) - Math.sin(seed * 3)) * .6; }
    }
    out.x = x; out.z = z; out.y = 0; out.yaw = 0; return boundPoint(out);
  }

  update(settings = {}, time = this.clock) {
    const t = clockOf(time); this.writeTravel(t, this._samplePoint);
    const next = normalizeSpiderWorld({ ...this.settings, ...settings, joystick: settings.joystick || this.settings.joystick });
    if (JSON.stringify(next) === JSON.stringify(this.settings)) { this.clock = t; return this; }
    if (this.settings.playing && !next.playing) this._frozenContact.cutoff = t;
    this.settings = next;
    this._record(t, this._samplePoint.x, this._samplePoint.z, null);
    this.clock = t; this.state.version += 1; return this;
  }
  _record(time, x, z, target) {
    if (this.travelHistory.length >= 128) this.travelHistory.shift();
    this.travelHistory.push({ time, x, z, settings: this.settings, target, scale: this.motionScale });
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
    if (type === 'home') { this.settings = normalizeSpiderWorld({ ...this.settings, joystick: { x: 0, z: 0 } }); this._record(t, 0, 0, null); this._contactEpoch += 1; }
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
    this.state.version += 1; return this;
  }

  _acceptWeb(web, time) {
    if (this.web === web) return;
    const key = webKey(web); if (key !== this.webKey) {
      if (this.webKey) { this.prey.length = 0; this.silkSegments.length = 0; this.events.length = 0; }
      this.webKey = key; this.state.webKey = key; this.state.graphVersion += 1; this._contactEpoch += 1; this._anchor = null; this.lastSilkTick = Math.floor((time - this.gridOrigin) * 8); this.lastWorldTick = Math.floor((time - this.gridOrigin) * 24) - 1;
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
      this.writeTravel(t, this._silkPoint); this._silkPoint.z -= .095; this._silkPoint.y = spiderWebHeight(web, this._silkPoint.x, this._silkPoint.z) + .035;
      if (!this._anchor) { this._anchor = { x: this._silkPoint.x, y: this._silkPoint.y, z: this._silkPoint.z }; continue; }
      const a = this._anchor; const b = this._silkPoint; const length = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z); if (length < .002) continue;
      const strand = this._silkPool[this._silkCursor++ % 256]; if (this.silkSegments.length === 256) this.silkSegments.shift();
      strand.id = tick; strand.ax = a.x; strand.ay = a.y; strand.az = a.z; strand.bx = b.x; strand.by = b.y; strand.bz = b.z; strand.born = t; strand.length = length; strand.angle = Math.atan2(b.z - a.z, b.x - a.x); this.silkSegments.push(strand);
      a.x = b.x; a.y = b.y; a.z = b.z;
      this._emit('silk-laid', t, strand.id, clamp(length * 12, 0, 1), -1, .5, length, strand.angle); this.state.version += 1;
    }
    this.lastSilkTick = Math.max(this.lastSilkTick, end); this.state.activeSilk = null;
    if (this.settings.laySilk && this._anchor && this.state.travelSpeed > .0001) {
      const a = this._anchor; const b = this._activeSilk; b.ax = a.x; b.ay = a.y; b.az = a.z; b.bx = this.point.x; b.bz = this.point.z - .095; b.by = spiderWebHeight(web, b.bx, b.bz) + .035; b.progress = 1; this.state.activeSilk = b;
    }
    this.state.layingSpeed = this.settings.laySilk ? this.state.travelSpeed : 0;
  }

  sample(clock, motion, web, frame, pose, midiOffsets, options = {}) {
    const time = clockOf(clock); const motionTime = clockOf(options.motionTime === undefined ? time : options.motionTime); const playing = options.playing === undefined ? this.settings.playing : options.playing === true;
    const motionKey = motion.preset + ':' + motion.tempo + ':' + playing + ':' + this.settings.speed + ':' + this.settings.range;
    if (motionKey !== this._motionKey) {
      const selected = MOTIONS[motion.preset]; const maximum = this.settings.speed * Math.max(.09, this.settings.range * .6);
      const scale = playing && selected?.support ? Math.min(1, .025 / Math.max(.001, selected.period * 60 / (motion.tempo || 108) * selected.duty * maximum)) : 1;
      if (scale !== this.motionScale) { this.writeTravel(time, this._samplePoint); this.motionScale = scale; this._record(time, this._samplePoint.x, this._samplePoint.z, this._entry(time).target); }
      this._motionKey = motionKey;
    }
    if (playing !== this.settings.playing) this.update({ playing }, time);
    this._acceptWeb(web, time);
    const endTick = Math.floor((time - this.gridOrigin) * 24 + 1e-9); const startTick = Math.max(this.lastWorldTick + 1, endTick - 767);
    for (let tick = startTick; tick <= endTick; tick += 1) { this._writePrey(this.gridOrigin + tick / 24, web, true); this._writeSilk(this.gridOrigin + tick / 24, web); }
    this.lastWorldTick = Math.max(this.lastWorldTick, endTick); this._writePrey(time, web, false);
    this.writeTravel(time, this.point); this.writeTravel(time - .002, this._before); this.writeTravel(time + .002, this._after);
    this.state.travelSpeed = Math.min(.4, Math.hypot(this._after.x - this._before.x, this._after.z - this._before.z) / .004);
    const entry = this._entry(time); const travelIntent = this.settings.speed > 0 && (this.settings.playing && this.settings.path !== 'hold' && this.settings.range > 1e-6 || Math.hypot(this.settings.joystick.x, this.settings.joystick.z) > 1e-6 || entry.target && Math.hypot(entry.target.x - this.point.x, entry.target.z - this.point.z) > .0001);
    const traveling = !!travelIntent;
    const contactMode = (traveling ? 'travel' : playing ? 'animation' : 'held') + ':' + motion.preset + ':' + motion.tempo + ':' + this.settings.speed + ':' + this.settings.range;
    if (contactMode !== this._contactMode) { this._contactMode = contactMode; this._contactEpoch += 1; this._lastModeTime = time; }
    const m = this._frameMotion;
    m.preset = motion.preset; m.tempo = motion.tempo; m.intensity = motion.intensity;
    m.seed = motion.seed; m.center = motion.center; m.yaw = motion.yaw; m.offsets = motion.offsets; m.explore = traveling ? false : motion.explore;
    const frameTime = motionTime; this.frameClockOffset = time - frameTime; this.queryClock = time; this.playing = playing;
    const selected = MOTIONS[motion.preset];
    this.contactItem = traveling ? (playing && selected?.mask === 255 ? selected : MOTIONS['low-sprint']) : null;
    this.contactTempo = this.contactItem ? (selected?.support && playing ? motion.tempo : (motion.tempo || 108) * Math.max(1, Math.ceil(this.contactItem.period * 60 / (motion.tempo || 108) * Math.max(this.settings.speed * .09, this.settings.speed * this.settings.range * .5) / .035))) : motion.tempo;
    if (!playing) this.contactTempo = Math.max(108, this.contactTempo);
    this.contactBeat = (playing ? motionTime : time - this.gridOrigin) * this.contactTempo / 60; this.contactClockOffset = playing ? time - motionTime : this.gridOrigin;
    this.anchorCutoff = Infinity; this.anchorQuery = false;
    this.contactIntensity = traveling ? Math.max(.4, motion.intensity || 0) : motion.intensity; this.anchorMotionAdvances = playing;
    const frozen = this._frozenContact;
    if (playing) {
      if (!this.contactItem && selected) { this.contactItem = selected; this.contactTempo = motion.tempo; this.contactBeat = motionTime * motion.tempo / 60; this.contactClockOffset = time - motionTime; }
      frozen.valid = !!this.contactItem; frozen.id = this.contactItem?.id || ''; frozen.tempo = this.contactTempo; frozen.clockOffset = this.contactClockOffset; frozen.motionOffset = this.frameClockOffset; frozen.motionTime = motionTime; frozen.preset = motion.preset; frozen.motionTempo = motion.tempo; frozen.travel = traveling; frozen.cutoff = null;
    } else if (traveling) frozen.valid = false;
    else if (frozen.valid && frozen.preset === motion.preset && frozen.motionTempo === motion.tempo) {
      this.anchorCutoff = frozen.cutoff === null || frozen.cutoff === undefined ? Infinity : frozen.cutoff; m.explore = frozen.travel ? false : motion.explore; this.contactItem = MOTIONS[frozen.id]; this.contactTempo = frozen.tempo; this.contactBeat = motionTime * frozen.tempo / 60; this.contactClockOffset = frozen.clockOffset; this.frameClockOffset = frozen.motionOffset; this.anchorMotionAdvances = true; this.contactIntensity = frozen.travel ? Math.max(.4, motion.intensity || 0) : motion.intensity;
    }
    if (!playing && !frozen.valid) this.frameClockOffset = time - motionTime;
    writeSpiderFrame(frameTime, m, web, frame, pose, midiOffsets, this);
    frame.motionActive = playing || traveling; frame.contactEpoch = this._contactEpoch;
    this._writeSilk(time, web); this.clock = time; this.state.time = time; this.state.contactEpoch = this._contactEpoch;
    this.state.active = traveling || this.state.preyBuzz > 0 || this.state.preyStruggle > 0 || this.state.eating > 0 || this.state.activeSilk !== null;
    return this.state;
  }

  snapshot() {
    return clone({ version: 1, clock: this.clock, gridOrigin: this.gridOrigin, settings: this.settings, travelHistory: this.travelHistory, prey: this.prey, silkSegments: this.silkSegments, events: this.events, nextPreyId: this.nextPreyId, nextEventId: this.nextEventId, lastSilkTick: this.lastSilkTick, lastWorldTick: this.lastWorldTick, webKey: this.webKey, anchor: this._anchor, contactEpoch: this._contactEpoch, contactMode: this._contactMode, graphVersion: this.state.graphVersion, stateVersion: this.state.version, motionScale: this.motionScale, motionKey: this._motionKey, frozenContact: this._frozenContact });
  }
  restore(snapshot = {}, timeOffset = 0) {
    if (snapshot.version !== 1) return this;
    const delta = finite(timeOffset); this.clock = clockOf(finite(snapshot.clock) + delta); this.gridOrigin = finite(snapshot.gridOrigin) + delta; this.settings = normalizeSpiderWorld(snapshot.settings);
    this.travelHistory = (snapshot.travelHistory || []).slice(-128).map(e => ({ time: finite(e.time) + delta, x: clamp(finite(e.x), -.55, .55), z: clamp(finite(e.z), -.55, .55), settings: normalizeSpiderWorld(e.settings), scale: clamp(finite(e.scale, 1), 0, 1), target: e.target ? { x: clamp(finite(e.target.x), -.55, .55), z: clamp(finite(e.target.z), -.55, .55), preyId: finite(e.target.preyId) } : null }));
    if (!this.travelHistory.length) this.travelHistory.push({ time: this.clock, x: 0, z: 0, settings: this.settings, target: null });
    this.prey.length = 0;
    for (const record of (snapshot.prey || []).slice(-8)) { const prey = { ...record }; for (const key of ['born', 'trappedAt', 'huntAt', 'eatenAt']) if (prey[key] !== null && Number.isFinite(prey[key])) prey[key] += delta; this.prey.push(prey); }
    this.silkSegments.length = 0; this._silkCursor = 0;
    for (const record of (snapshot.silkSegments || []).slice(-256)) { const strand = this._silkPool[this._silkCursor++]; Object.assign(strand, record); strand.born += delta; this.silkSegments.push(strand); }
    this.events.length = 0; this._eventCursor = 0;
    for (const record of (snapshot.events || []).slice(-64)) { const event = this._eventPool[this._eventCursor++]; Object.assign(event, record); event.time += delta; this.events.push(event); }
    this.nextPreyId = Math.max(1, finite(snapshot.nextPreyId, 1)); this.nextEventId = Math.max(1, finite(snapshot.nextEventId, 1)); this.lastSilkTick = Math.floor(finite(snapshot.lastSilkTick)); this.lastWorldTick = Math.floor(finite(snapshot.lastWorldTick)); this.webKey = String(snapshot.webKey || ''); this.state.webKey = this.webKey;
    this.motionScale = clamp(finite(snapshot.motionScale, 1), 0, 1); this._motionKey = String(snapshot.motionKey || ''); if (snapshot.frozenContact) { Object.assign(this._frozenContact, snapshot.frozenContact); this._frozenContact.clockOffset += delta; this._frozenContact.motionOffset += delta; if (this._frozenContact.cutoff !== null && this._frozenContact.cutoff !== undefined) this._frozenContact.cutoff += delta; } this._anchor = snapshot.anchor ? { ...snapshot.anchor } : null; this._contactEpoch = finite(snapshot.contactEpoch); this._contactMode = snapshot.contactMode || ''; this.state.graphVersion = finite(snapshot.graphVersion); this.state.version = finite(snapshot.stateVersion); return this;
  }
}
export const createSpiderWorld = settings => new SpiderSynthWorld(settings);
