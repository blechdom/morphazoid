import { ROACH_BODY_GROUPS, getRoachJointBodyGroup } from './roach-synth-body.js?v=093c2b188c19';
import { constrainRoachPose } from './roach-synth-motion.js?v=093c2b188c19';

const AXES = ['x', 'y', 'z'];
const MAX_SCOPES = 64;
export const ROACH_MIDI_MAX_VOICES = 24;
export const ROACH_MIDI_ROOT_NOTE = 60;
export const ROACH_MIDI_TARGETS = Object.freeze([
  ['left_legs', 0, -1], ['right_legs', 0, 1], ['left_cover', 1, -1], ['right_cover', 1, 1],
  ['left_hindwing', 2, -1], ['right_hindwing', 2, 1], ['thorax', 3, 0], ['abdomen', 4, 0],
  ['neck', 5, 0], ['head', 6, 0], ['left_antenna', 7, -1], ['right_antenna', 7, 1],
].map(([id, group, side]) => Object.freeze({ id, group, groupId: ROACH_BODY_GROUPS[group].id, side })));
export const ROACH_MIDI_GESTURES = Object.freeze(ROACH_MIDI_TARGETS.map((target, index) => Object.freeze({ ...target,
  label: ['Left legs', 'Right legs', 'Left cover', 'Right cover', 'Left hind wing', 'Right hind wing', 'Thorax', 'Abdomen', 'Neck', 'Head', 'Left antenna', 'Right antenna'][index],
})));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, low, high, fallback = low) => Math.max(low, Math.min(high, finite(value, fallback)));
const smooth = value => value * value * (3 - 2 * value);
const clock = value => clamp(value, -1e12, 1e12);
const source = value => String(value ?? 'midi').slice(0, 128);
const groupIndex = value => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 8
  ? value : ROACH_BODY_GROUPS.findIndex(group => group.id === value);
const axisIndex = value => typeof value === 'number' ? (Number.isInteger(value) && value >= 0 && value < 3 ? value : -1) : AXES.indexOf(value);

/** Event-boundary normalization; no hardware/DOM/audio permission ownership. */
export function normalizeRoachMidiMessage(input) {
  if (!input || typeof input !== 'object') return null;
  const type = input.type === 'noteOn' && finite(input.velocity) <= 0 ? 'noteOff' : input.type;
  if (!['noteOn', 'noteOff', 'controlChange', 'pitchBend', 'polyPressure', 'channelPressure'].includes(type)) return null;
  const out = { type, sourceId: source(input.sourceId), channel: Math.round(clamp(input.channel, 0, 15)) };
  if (type === 'noteOn' || type === 'noteOff' || type === 'polyPressure') out.note = Math.round(clamp(input.note, 0, 127, 60));
  if (type === 'noteOn' || type === 'noteOff') {
    out.velocity = Math.round(clamp(input.velocity, type === 'noteOn' ? 1 : 0, 127));
    out.kind = input.kind === 'dance' ? 'dance' : 'body';
    if (out.kind === 'dance') out.danceIndex = Math.round(clamp(input.danceIndex, 0, 23));
  }
  if (type === 'controlChange') { out.controller = Math.round(clamp(input.controller, 0, 127)); out.value = Math.round(clamp(input.value, 0, 127)); }
  if (type === 'pitchBend') out.normalized = clamp(input.normalized, -1, 1, 0);
  if (type === 'polyPressure' || type === 'channelPressure') out.pressure = Math.round(clamp(input.pressure, 0, 127));
  if (input.synthetic === true) { out.synthetic = true; out.reason = String(input.reason ?? '').slice(0, 80); }
  if (input.logical?.type === 'macro') out.logical = { type: 'macro', index: Math.round(clamp(input.logical.index, 0, 7)) };
  return out;
}

function makeVoice() {
  return { active: false, sourceId: '', channel: 0, note: 60, count: 0, held: false, sustained: false,
    kind: 'body', danceIndex: 0, target: 0, group: 0, velocity: 0, pressure: 0, order: 0,
    started: 0, startGain: 0, released: false, releaseTime: 0, releaseGain: 0, scope: -1 };
}
function makeScope() { return { active: false, sourceId: '', channel: 0, sustain: false, expression: 1, bend: 0, pressure: 0, order: 0 }; }
function makeControl() { return { from: 0, target: 0, started: 0, duration: .035, sourceId: '', channel: 0, owned: false }; }
function voiceEnvelope(voice, time, attack, release) {
  if (!voice.active) return 0;
  if (voice.released) return voice.releaseGain * (1 - smooth(clamp((time - voice.releaseTime) / release, 0, 1)));
  return voice.startGain + (1 - voice.startGain) * smooth(clamp((time - voice.started) / attack, 0, 1));
}
function controlValue(control, time) {
  return control.from + (control.target - control.from) * smooth(clamp((time - control.started) / control.duration, 0, 1));
}
function matchesScope(item, scope) {
  return (!scope || scope.sourceId === undefined || item.sourceId === source(scope.sourceId))
    && (!scope || scope.channel === undefined || item.channel === Math.round(clamp(scope.channel, 0, 15)));
}

/**
 * A clock-driven overlay: notes never start Audio or the factory transport.
 * Call setJoints on structural rig changes, then sample/applyPose without allocations.
 * Held keys select static postures; only attack/release and CC ramps move them.
 * Feed matching absolute timestamps to the UI and worklet copies. Mutation and
 * serialization are event-boundary operations; getState is for UI diagnostics.
 */
export class RoachMidiPerformance {
  constructor({ attack = .012, release = .16, maxVoices = ROACH_MIDI_MAX_VOICES } = {}) {
    this.attack = clamp(attack, .004, .2, .012); this.release = clamp(release, .025, 1, .16);
    this.maxVoices = Math.round(clamp(maxVoices, 1, ROACH_MIDI_MAX_VOICES, ROACH_MIDI_MAX_VOICES));
    this.voices = Array.from({ length: this.maxVoices }, makeVoice);
    this.scopes = Array.from({ length: MAX_SCOPES }, makeScope);
    this.controls = Array.from({ length: 24 }, makeControl);
    this.now = 0; this.phaseOrigin = 0; this.sequence = 0; this.scopeSequence = 0;
    this.groupSerials = new Uint32Array(8);
    this.targetVoices = new Int16Array(12); this.targetVoices.fill(-1);
    this.groupVoices = new Int16Array(8); this.groupVoices.fill(-1);
    this.targetGains = new Float64Array(12); this.controlValues = new Float64Array(24);
    this.output = { gates: new Float64Array(8), frequencies: new Float64Array(8), pitchRatios: new Float64Array(8),
      velocities: new Float64Array(8), expressions: new Float64Array(8), movement: new Float64Array(8),
      pans: new Float64Array(8), notes: new Int16Array(8), serials: this.groupSerials,
      onsetTimes: new Float64Array(8), held: new Uint8Array(8), pressures: new Float64Array(8), hasActivity: false, hasPose: false };
    this.joints = null; this.jointTargets = new Int16Array(0); this.jointGroups = new Uint8Array(0);
    this.jointPhases = new Float64Array(0); this.jointScales = new Float64Array(0); this.jointSides = new Int8Array(0);
    this.latestDance = -1;
    this.sample(0);
  }
  scopeFor(message) {
    let available = -1; let oldest = 0;
    for (let i = 0; i < this.scopes.length; i += 1) {
      const scope = this.scopes[i];
      if (scope.active && scope.sourceId === message.sourceId && scope.channel === message.channel) return i;
      if (!scope.active && available < 0) available = i;
      if (scope.order < this.scopes[oldest].order) oldest = i;
    }
    const index = available < 0 ? oldest : available;
    if (this.scopes[index].active) {
      for (const voice of this.voices) if (voice.active && voice.scope === index) voice.active = false;
    }
    Object.assign(this.scopes[index], makeScope(), { active: true, sourceId: message.sourceId, channel: message.channel, order: ++this.scopeSequence });
    return index;
  }
  releaseVoice(voice, time, immediate = false) {
    voice.count = 0; voice.held = false; voice.sustained = false;
    if (immediate) { voice.active = false; return; }
    if (voice.released) return;
    voice.releaseGain = voiceEnvelope(voice, time, this.attack, this.release);
    voice.releaseTime = time; voice.released = true;
  }
  handle(input, now = this.now) {
    const message = normalizeRoachMidiMessage(input);
    if (!message) return false;
    this.now = clock(now);
    if (message.type === 'controlChange' && message.synthetic && message.controller === 120) {
      this.reset(this.now, message.sourceId === 'web-midi:manager' ? undefined : { sourceId: message.sourceId });
      return true;
    }
    const scopeIndex = this.scopeFor(message); const scope = this.scopes[scopeIndex];
    if (message.type === 'noteOn') {
      let voice = null; let available = null; let oldest = this.voices[0];
      for (const candidate of this.voices) {
        if (candidate.active && candidate.sourceId === message.sourceId && candidate.channel === message.channel && candidate.note === message.note) voice = candidate;
        if ((!candidate.active || voiceEnvelope(candidate, this.now, this.attack, this.release) === 0 && candidate.released) && !available) available = candidate;
        if (candidate.order < oldest.order) oldest = candidate;
      }
      const existing = Boolean(voice); voice ??= available ?? oldest;
      const gain = existing ? voiceEnvelope(voice, this.now, this.attack, this.release) : 0;
      const count = existing && voice.held ? Math.min(127, voice.count + 1) : 1;
      Object.assign(voice, { active: true, sourceId: message.sourceId, channel: message.channel, note: message.note,
        count, held: true, sustained: false, kind: message.kind, danceIndex: message.danceIndex ?? 0,
        target: message.note % 12, group: ROACH_MIDI_TARGETS[message.note % 12].group, velocity: message.velocity / 127,
        pressure: 0, order: ++this.sequence, started: this.now, startGain: gain, released: false, scope: scopeIndex });
      if (voice.kind === 'body') this.groupSerials[voice.group] += 1;
    } else if (message.type === 'noteOff') {
      for (const voice of this.voices) {
        if (!voice.active || voice.sourceId !== message.sourceId || voice.channel !== message.channel || voice.note !== message.note) continue;
        if (message.synthetic) { this.releaseVoice(voice, this.now); continue; }
        voice.count = Math.max(0, voice.count - 1); voice.held = voice.count > 0;
        if (!voice.held) { if (scope.sustain) voice.sustained = true; else this.releaseVoice(voice, this.now); }
      }
    } else if (message.type === 'pitchBend') scope.bend = message.normalized;
    else if (message.type === 'channelPressure') scope.pressure = message.pressure / 127;
    else if (message.type === 'polyPressure') {
      for (const voice of this.voices) if (voice.active && voice.scope === scopeIndex && voice.note === message.note) voice.pressure = message.pressure / 127;
    } else if (message.type === 'controlChange') {
      // Physical profile macros override overlapping standard controller meanings.
      if (message.logical?.type === 'macro') return false;
      if (message.controller === 11) scope.expression = message.value / 127;
      else if (message.controller === 64) {
        scope.sustain = message.value >= 64;
        if (!scope.sustain) for (const voice of this.voices) if (voice.active && voice.scope === scopeIndex && !voice.held) this.releaseVoice(voice, this.now);
      } else if (message.controller === 120) {
        for (const voice of this.voices) if (voice.active && voice.scope === scopeIndex) this.releaseVoice(voice, this.now, true);
      } else if (message.controller === 123) {
        for (const voice of this.voices) if (voice.active && voice.scope === scopeIndex) {
          voice.count = 0; voice.held = false;
          if (scope.sustain) voice.sustained = true; else this.releaseVoice(voice, this.now);
        }
      } else if (message.controller === 121) {
        scope.sustain = false; scope.expression = 1; scope.bend = 0; scope.pressure = 0;
        for (const voice of this.voices) if (voice.active && voice.scope === scopeIndex) {
          voice.pressure = 0; if (!voice.held) this.releaseVoice(voice, this.now);
        }
        for (let i = 0; i < this.controls.length; i += 1) {
          const control = this.controls[i];
          if (control.owned && matchesScope(control, message)) this.moveControl(i, 0, this.now);
        }
      } else return false;
    }
    return true;
  }
  moveControl(index, value, now) {
    const control = this.controls[index]; const current = controlValue(control, now);
    control.from = current; control.target = value; control.started = now;
    control.duration = Math.abs(value) < Math.abs(current) ? .09 : .035;
  }
  setControl(groupId, axis, normalized, now = this.now, scopeMessage = null) {
    const group = groupIndex(groupId); const component = axisIndex(axis);
    if (group < 0 || component < 0) return false;
    this.now = clock(now); const index = group * 3 + component;
    this.moveControl(index, clamp(normalized, -1, 1, 0), this.now);
    const control = this.controls[index]; control.owned = scopeMessage != null;
    control.sourceId = source(scopeMessage?.sourceId); control.channel = Math.round(clamp(scopeMessage?.channel, 0, 15));
    return true;
  }
  reset(now = this.now, scope = undefined) {
    this.now = clock(now);
    for (const voice of this.voices) if (matchesScope(voice, scope)) this.releaseVoice(voice, this.now, true);
    for (const current of this.scopes) if (matchesScope(current, scope)) current.active = false;
    for (const control of this.controls) if (!scope || control.owned && matchesScope(control, scope)) {
      control.from = 0; control.target = 0; control.started = this.now; control.owned = false;
    }
    this.sample(this.now);
  }
  precedes(voice, previous) {
    const held = voice.held || voice.sustained; const wasHeld = previous.held || previous.sustained;
    return held !== wasHeld ? held : voice.order > previous.order;
  }
  sample(now = this.now, tempo = 120) {
    this.now = clock(now); const out = this.output;
    out.gates.fill(0); out.velocities.fill(0); out.expressions.fill(1); out.movement.fill(0); out.pans.fill(0);
    out.frequencies.fill(140); out.pitchRatios.fill(1); out.notes.fill(-1); out.onsetTimes.fill(-1); out.held.fill(0); out.pressures.fill(0);
    this.targetVoices.fill(-1); this.groupVoices.fill(-1); this.targetGains.fill(0); this.latestDance = -1;
    for (let i = 0; i < this.voices.length; i += 1) {
      const voice = this.voices[i]; if (!voice.active) continue;
      const envelope = voiceEnvelope(voice, this.now, this.attack, this.release);
      if (voice.released && envelope <= 0) { voice.active = false; continue; }
      if (voice.kind === 'dance') {
        if ((voice.held || voice.sustained) && (this.latestDance < 0 || voice.order > this.voices[this.latestDance].order)) this.latestDance = i;
        continue;
      }
      const previous = this.targetVoices[voice.target]; const previousGroup = this.groupVoices[voice.group];
      if (previous < 0 || this.precedes(voice, this.voices[previous])) this.targetVoices[voice.target] = i;
      if (previousGroup < 0 || this.precedes(voice, this.voices[previousGroup])) this.groupVoices[voice.group] = i;
    }
    for (let target = 0; target < 12; target += 1) {
      const index = this.targetVoices[target]; if (index < 0) continue;
      const voice = this.voices[index]; const scope = this.scopes[voice.scope];
      const envelope = voiceEnvelope(voice, this.now, this.attack, this.release);
      this.targetGains[target] = envelope * voice.velocity * scope.expression * (1 + .35 * Math.max(scope.pressure, voice.pressure));
    }
    for (let group = 0; group < 8; group += 1) {
      const index = this.groupVoices[group]; if (index < 0) continue;
      const voice = this.voices[index]; const scope = this.scopes[voice.scope];
      out.gates[group] = voiceEnvelope(voice, this.now, this.attack, this.release);
      out.velocities[group] = voice.velocity; out.expressions[group] = scope.expression;
      out.notes[group] = voice.note; out.onsetTimes[group] = voice.started; out.held[group] = voice.held || voice.sustained ? 1 : 0;
      out.pressures[group] = Math.max(scope.pressure, voice.pressure); out.pans[group] = ROACH_MIDI_TARGETS[voice.target].side * .6;
      out.frequencies[group] = 440 * 2 ** ((voice.note - 69 + scope.bend * 2) / 12);
      out.pitchRatios[group] = 2 ** ((voice.note - ROACH_MIDI_ROOT_NOTE + scope.bend * 2) / 12);
      const ramp = voice.released
        ? clamp((this.now - voice.releaseTime) / this.release, 0, 1)
        : clamp((this.now - voice.started) / this.attack, 0, 1);
      out.movement[group] = Math.min(1, voice.velocity * scope.expression * 6 * ramp * (1 - ramp));
    }
    for (let i = 0; i < this.controls.length; i += 1) {
      const control = this.controls[i]; this.controlValues[i] = controlValue(control, this.now);
      const phase = clamp((this.now - control.started) / control.duration, 0, 1);
      out.movement[Math.floor(i / 3)] = Math.min(1, out.movement[Math.floor(i / 3)] + Math.abs(control.target - control.from) * 6 * phase * (1 - phase));
    }
    out.hasActivity = this.hasActivity(this.now); out.hasPose = false;
    for (let i = 0; i < 12; i += 1) if (this.targetGains[i] !== 0) out.hasPose = true;
    for (let i = 0; i < 24; i += 1) if (this.controlValues[i] !== 0) out.hasPose = true;
    return out;
  }
  setJoints(joints) {
    if (!Array.isArray(joints) || joints.length > 128) throw new RangeError('MIDI pose needs at most 128 joints.');
    this.joints = joints; const count = joints.length;
    this.jointTargets = new Int16Array(count); this.jointTargets.fill(-1);
    this.jointGroups = new Uint8Array(count); this.jointPhases = new Float64Array(count);
    this.jointScales = new Float64Array(count); this.jointSides = new Int8Array(count);
    const neutral = new Float64Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      const joint = joints[i]; const name = `${joint.jointId ?? ''} ${joint.name ?? ''}`.toLowerCase();
      const group = getRoachJointBodyGroup(joint); const side = /left/.test(name) ? -1 : /right/.test(name) ? 1 : 0;
      this.jointGroups[i] = group; this.jointSides[i] = side;
      const target = group === 0 ? (side < 0 ? 0 : side > 0 ? 1 : -1)
        : group === 1 ? (side < 0 ? 2 : side > 0 ? 3 : -1)
          : group === 2 ? (side < 0 ? 4 : side > 0 ? 5 : -1)
            : group === 7 ? (side < 0 ? 10 : side > 0 ? 11 : -1) : group + 3;
      this.jointTargets[i] = target;
      this.jointPhases[i] = /front_/.test(name) ? 0 : /middle_/.test(name) ? Math.PI : /hind_/.test(name) ? Math.PI * .5 : 0;
      this.jointScales[i] = /proximal/.test(name) ? .65 : /foot|distal/.test(name) ? .5 : 1;
      for (let axis = 0; axis < 3; axis += 1) neutral[i * 3 + axis] = finite(joint.restOffset?.[AXES[axis]]);
    }
    // Allocate the existing shared constraint cache at the structural boundary.
    constrainRoachPose(neutral, joints, neutral);
    return this;
  }
  applyPose(pose, joints, now = this.now, tempo = 120, intensity = 1) {
    if (joints !== this.joints) this.setJoints(joints);
    if (!pose || pose.length < joints.length * 3) throw new RangeError('MIDI pose needs XYZ values for every joint.');
    this.sample(now, tempo);
    const strength = clamp(intensity, 0, 2, 1);
    if (!this.output.hasPose || strength === 0) return pose;
    for (let i = 0; i < joints.length; i += 1) {
      const group = this.jointGroups[i]; const target = this.jointTargets[i]; const k = i * 3; const c = group * 3;
      const side = this.jointSides[i]; const sign = side < 0 ? 1 : side > 0 ? -1 : 1;
      const amount = target >= 0 ? this.targetGains[target] * strength : 0;
      const voiceIndex = target >= 0 ? this.targetVoices[target] : -1;
      const note = voiceIndex >= 0 ? this.voices[voiceIndex].note : ROACH_MIDI_ROOT_NOTE;
      // A key is a held posture, never another animation transport. Octaves
      // offer alternate reaches/tilts while retaining the same anatomical owner.
      const octave = Math.floor(note / 12) - 5;
      const phase = .7 + octave * .83 + this.jointPhases[i];
      const sine = Math.sin(phase); const cosine = Math.cos(phase);
      let x = 0; let y = 0; let z = 0;
      if (group === 0) { x = sine * 7; y = Math.sin(phase + .65) * 10 * sign; z = cosine * 8 * sign; }
      else if (group === 1 || group === 2) { x = sine * 3; y = (8 + cosine * 5) * sign; z = (28 + sine * 18) * sign; }
      else if (group === 3) { x = sine * 4; y = cosine * 3; z = Math.sin(phase * .5) * 4; }
      else if (group === 4) { x = sine * 6; y = cosine * 3; z = sine * 3; }
      else if (group === 5) { x = sine * 8; y = cosine * 5; z = sine * 4; }
      else if (group === 6) { x = sine * 12; y = cosine * 9; z = Math.sin(phase * .5) * 7; }
      else { x = Math.sin(phase * 2) * 18; y = cosine * 20 * sign; z = Math.sin(phase + .5) * 15 * sign; }
      const scale = amount * this.jointScales[i];
      const controlScale = group === 0 ? 20 : group === 1 ? 45 : group === 2 ? 60 : group === 3 ? 10 : group === 4 ? 12 : group === 5 ? 18 : group === 6 ? 28 : 40;
      // The aggregate wing joint stays put: independent leaves own both notes and CC.
      const controlAmount = (group === 1 || group === 2) && target < 0 ? 0 : controlScale * strength;
      pose[k] += x * scale + this.controlValues[c] * controlAmount;
      pose[k + 1] += y * scale + this.controlValues[c + 1] * controlAmount * (group === 1 || group === 2 ? sign : 1);
      pose[k + 2] += z * scale + this.controlValues[c + 2] * controlAmount * (group === 1 || group === 2 ? sign : 1);
    }
    return constrainRoachPose(pose, joints, pose);
  }
  getState(now = this.now) {
    this.sample(now); const heldNotes = []; let activeCount = 0;
    for (const voice of this.voices) if (voice.active) {
      activeCount += 1;
      if (voice.held || voice.sustained) heldNotes.push({ key: `${voice.sourceId}:${voice.channel}:${voice.note}`, sourceId: voice.sourceId,
        channel: voice.channel, note: voice.note, velocity: Math.round(voice.velocity * 127), kind: voice.kind, sustained: voice.sustained });
    }
    const dance = this.latestDance < 0 ? null : this.voices[this.latestDance];
    return { activeCount, heldCount: heldNotes.length, notes: heldNotes, heldNotes, latestDance: dance ? { index: dance.danceIndex, danceIndex: dance.danceIndex, note: dance.note,
      velocity: Math.round(dance.velocity * 127), key: `${dance.sourceId}:${dance.channel}:${dance.note}` } : null,
    gates: Array.from(this.output.gates), frequencies: Array.from(this.output.frequencies), controls: Array.from(this.controlValues) };
  }
  hasActivity(now = this.now) {
    const time = clock(now);
    for (let i = 0; i < this.voices.length; i += 1) {
      const voice = this.voices[i];
      if (voice.active && (voice.released ? time < voice.releaseTime + this.release : time < voice.started + this.attack)) return true;
    }
    for (let i = 0; i < this.controls.length; i += 1) {
      const control = this.controls[i];
      if (control.from !== control.target && time < control.started + control.duration) return true;
    }
    return false;
  }
  rebaseTime(delta) {
    const shift = clock(delta); this.now = clock(this.now + shift); this.phaseOrigin += shift;
    for (const voice of this.voices) { voice.started += shift; voice.releaseTime += shift; }
    for (const control of this.controls) control.started += shift;
    return this;
  }
  serialize() {
    return { version: 1, now: this.now, phaseOrigin: this.phaseOrigin, attack: this.attack, release: this.release, sequence: this.sequence, scopeSequence: this.scopeSequence,
      voices: this.voices.map(voice => ({ ...voice })), scopes: this.scopes.map(scope => ({ ...scope })),
      controls: this.controls.map(control => ({ ...control })), serials: Array.from(this.groupSerials) };
  }
  restore(snapshot, { timeOffset = 0 } = {}) {
    if (snapshot?.version !== 1) return false;
    this.reset(0); this.attack = clamp(snapshot.attack, .004, .2, .012); this.release = clamp(snapshot.release, .025, 1, .16);
    this.now = clock(snapshot.now); this.phaseOrigin = clock(snapshot.phaseOrigin); this.sequence = clamp(snapshot.sequence, 0, Number.MAX_SAFE_INTEGER); this.scopeSequence = clamp(snapshot.scopeSequence, 0, Number.MAX_SAFE_INTEGER);
    for (let i = 0; i < this.scopes.length; i += 1) {
      const value = snapshot.scopes?.[i]; if (!value) continue;
      Object.assign(this.scopes[i], { active: value.active === true, sourceId: source(value.sourceId), channel: Math.round(clamp(value.channel, 0, 15)),
        sustain: value.sustain === true, expression: clamp(value.expression, 0, 1, 1), bend: clamp(value.bend, -1, 1, 0),
        pressure: clamp(value.pressure, 0, 1), order: clamp(value.order, 0, Number.MAX_SAFE_INTEGER) });
    }
    for (let i = 0; i < this.voices.length; i += 1) {
      const value = snapshot.voices?.[i]; if (!value) continue;
      const scope = Math.round(clamp(value.scope, 0, MAX_SCOPES - 1)); const note = Math.round(clamp(value.note, 0, 127, 60));
      Object.assign(this.voices[i], { active: value.active === true && this.scopes[scope].active, sourceId: source(value.sourceId), channel: Math.round(clamp(value.channel, 0, 15)),
        note, count: Math.round(clamp(value.count, 0, 127)), held: value.held === true, sustained: value.sustained === true,
        kind: value.kind === 'dance' ? 'dance' : 'body', danceIndex: Math.round(clamp(value.danceIndex, 0, 23)), target: note % 12,
        group: ROACH_MIDI_TARGETS[note % 12].group, velocity: clamp(value.velocity, 0, 1), pressure: clamp(value.pressure, 0, 1),
        order: clamp(value.order, 0, Number.MAX_SAFE_INTEGER), started: clock(value.started), startGain: clamp(value.startGain, 0, 1),
        released: value.released === true, releaseTime: clock(value.releaseTime), releaseGain: clamp(value.releaseGain, 0, 1), scope });
    }
    for (let i = 0; i < this.controls.length; i += 1) {
      const value = snapshot.controls?.[i]; if (!value) continue;
      Object.assign(this.controls[i], { from: clamp(value.from, -1, 1, 0), target: clamp(value.target, -1, 1, 0), started: clock(value.started),
        duration: clamp(value.duration, .004, 1, .035), sourceId: source(value.sourceId), channel: Math.round(clamp(value.channel, 0, 15)), owned: value.owned === true });
    }
    for (let i = 0; i < 8; i += 1) this.groupSerials[i] = clamp(snapshot.serials?.[i], 0, 0xffffffff);
    this.rebaseTime(timeOffset); this.sample(this.now); return true;
  }
}
