/**
 * Audio-clock articulation and a shared, stylized six-foot support model.
 * The dried scan has rigid curled limbs: these are designed gait contacts,
 * not an inverse-kinematics or validated collision/locomotion simulation.
 * Rotations are degrees; scene distances are fractions of body length.
 */
const TAU = Math.PI * 2;
const XYZ_AXES = Object.freeze(['x', 'y', 'z']);
const BODY_AXES = Object.freeze(['lift', 'pitch', 'roll', 'yaw']);
const ENERGY_KEYS = Object.freeze(['scuttle', 'wing', 'growl', 'voice']);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const positiveMod = (value, modulus) => ((value % modulus) + modulus) % modulus;
const smooth = (value) => value * value * (3 - 2 * value);
const safeTime = (time) => clamp(finite(time), 0, 1_000_000_000);
const beatsAt = (time, settings) => safeTime(time) * clamp(finite(settings?.tempo, 108), 30, 240) / 60;
export const ROACH_SEQUENCE_STEPS = 16;
export const ROACH_MAX_JOINT_TRACKS = 384;
export const ROACH_TRACK_SUBSTEPS = 4;
export const ROACH_FOOT_IDS = Object.freeze(['front_left', 'front_right', 'middle_left', 'middle_right', 'hind_left', 'hind_right']);
const preset = (id, label, category, mode, soundFlavor, gaitRate, groundSpeed, rootPosture, description) => Object.freeze({
  id, label, category, mode, soundFlavor, gaitRate, groundSpeed, rootPosture, description,
  loopBeats: 8, lookAtViewer: category === 'Face',
});
export const ROACH_MOTION_PRESETS = Object.freeze([
  preset('side_walk', 'Floor creep', 'Scuttle', 0, 'scuttle', 1.25, .28, 'low', 'Low tripod crawl with close-to-floor returning feet.'),
  preset('top_wing_fan', 'Wing twitter', 'Wings', 3, 'wing', .25, 0, 'low', 'Asymmetric cover twitches and rapid hindwing twitter over a shifting stance.'),
  preset('dance_upright', 'Back-leg boogie', 'Dance', 16, 'stomp', 1, 0, 'upright', 'Stands on the rear pair, stepping while four arms wave.'),
  preset('face_curious', "Who's there?", 'Face', 9, 'creak', .125, 0, 'low', 'Looks toward the viewer with asymmetric head tilts and searching feelers.'),
  preset('side_run', 'Panic sprint', 'Scuttle', 1, 'pitter', 3, .62, 'low', 'Fast tripod steps, fluttering feelers and a low body.'),
  preset('top_body_wave', 'Rock and roach', 'Dance', 4, 'growl', .5, 0, 'low', 'Rocking shell rolls and head bobs over a low six-leg groove.'),
  preset('face_chatter', 'Kitchen gossip', 'Face', 10, 'voice', .25, 0, 'low', 'Syllabic head and neck nods with busy antennae.'),
  preset('top_flight', 'Flutter flight', 'Wings', 5, 'wing', .25, .05, 'flight', 'A repeating supported takeoff mime with tucked legs and moving covers.'),
  preset('side_skitter', 'Dash and freeze', 'Scuttle', 12, 'scuttle', 1.5, .32, 'low', 'Nervous bursts accelerate into little rests without resetting phase.'),
  preset('dance_boxer', 'Tiny shadow boxer', 'Dance', 17, 'growl', 1.5, 0, 'upright', 'Rear-leg footwork and alternating front-leg punches.'),
  preset('face_sing', 'Crooner', 'Face', 11, 'voice', .25, 0, 'low', 'Long head bows with short nods and antenna flourishes.'),
  preset('bottom_wiggle', 'Leg noodles', 'Dance', 6, 'scrape', .75, 0, 'low', 'Six staggered loose curls and an abdomen wiggle.'),
  preset('side_tiptoe', 'Quiet sneak', 'Scuttle', 13, 'pitter', 1, .14, 'low', 'Six individually staggered toe taps and a raised head.'),
  preset('wings_alarm', 'Wing alarm', 'Wings', 21, 'wing', 2, .1, 'low', 'Rapid wing-cover tremolo over a frightened scuttle.'),
  preset('dance_can_can', 'Six-leg can-can', 'Dance', 18, 'metal', 1, 0, 'upright', 'High alternating kicks and a jaunty shell sway.'),
  preset('face_growl', 'Tiny house monster', 'Face', 22, 'growl', .25, 0, 'low', 'A low shell growl, threatening head dips and spiky feelers.'),
  preset('side_zigzag', 'Zigzag panic', 'Scuttle', 15, 'scuttle', 2.25, .46, 'low', 'Rapid scuttles and sharp alternating body turns.'),
  preset('bottom_rave', 'Bug rave', 'Dance', 8, 'metal', 2, 0, 'low', 'Syncopated leg fans with a fast body shimmy.'),
  preset('face_serenade', 'Antenna serenade', 'Face', 23, 'voice', .125, 0, 'low', 'Direct-address head phrases and wide fluttering antenna arcs.'),
  preset('dance_waltz', 'Cupboard waltz', 'Dance', 20, 'pitter', .75, .04, 'upright', 'Six-beat rear-foot waltz with sweeping front arms.'),
  preset('side_backpedal', 'Reverse gear', 'Scuttle', 14, 'scrape', 1.25, -.23, 'low', 'Backwards tripod travel with backward-looking head turns.'),
  preset('dance_robot', 'Broken robot', 'Dance', 19, 'metal', 1, 0, 'low', 'Rounded mechanical ticks, held poses and quick antenna snaps.'),
  preset('side_jump', 'Pogo jump', 'Dance', 2, 'stomp', .25, .03, 'jump', 'Crouch, lift all six feet, then land together every four beats.'),
  preset('bottom_shuffle', 'Side shuffle', 'Dance', 7, 'pitter', 1.5, .09, 'low', 'Quick side steps and a rocking shell.'),
]);
const POSE_ONLY = preset('none', 'Held pose', 'Pose', -1, 'creak', 0, 0, 'low', 'Manual offsets and enabled independent joint motion.');
const PRESETS_BY_ID = new Map(ROACH_MOTION_PRESETS.map((item) => [item.id, item]));
const EMPTY_TRACKS = Object.freeze([]);
export const ROACH_MOTION_DEFAULTS = Object.freeze({
  presetId: 'side_walk', tempo: 108, intensity: 1, antennae: true,
  sequenceEnabled: false, tracks: EMPTY_TRACKS, stepBeats: .25, gaze: Object.freeze({ x: 0, y: 0, z: 0 }),
  trackMode: 'add', sceneFrames: null, sceneTravelPerLoop: 0, sceneContactCounts: null, staticScene: null,
});

export function createRoachJointTrack(jointId, axis = 'x', steps = []) {
  return {
    jointId: String(jointId ?? '').slice(0, 120),
    axis: ['x', 'y', 'z'].includes(axis) ? axis : 'x',
    steps: Array.from({ length: ROACH_SEQUENCE_STEPS }, (_, i) => clamp(finite(steps?.[i]), -180, 180) || 0),
    enabled: true,
  };
}
export function normalizeRoachMotion(settings = {}) {
  const source = settings && typeof settings === 'object' ? settings : {};
  const tracks = [];
  const seen = new Set();
  for (const value of (Array.isArray(source.tracks) ? source.tracks : []).slice(0, ROACH_MAX_JOINT_TRACKS)) {
    if (!value || typeof value !== 'object') continue;
    const track = createRoachJointTrack(value.jointId, value.axis, value.steps);
    const key = `${track.jointId}:${track.axis}`;
    if (!track.jointId || seen.has(key)) continue;
    seen.add(key);
    track.enabled = value.enabled !== false;
    if (value.samples?.length === ROACH_SEQUENCE_STEPS * ROACH_TRACK_SUBSTEPS && value.sourceSteps?.length === ROACH_SEQUENCE_STEPS) {
      track.samples = Array.from(value.samples, (sample) => clamp(finite(sample), -180, 180) || 0);
      track.sourceSteps = Array.from(value.sourceSteps, (sample) => clamp(finite(sample), -180, 180) || 0);
    }
    tracks.push(track);
  }
  const normalized = {
    presetId: source.presetId === 'none' || PRESETS_BY_ID.has(source.presetId) ? source.presetId : ROACH_MOTION_DEFAULTS.presetId,
    tempo: clamp(finite(source.tempo, 108), 30, 240),
    intensity: clamp(finite(source.intensity, 1), 0, 2),
    antennae: source.antennae !== false,
    sequenceEnabled: source.sequenceEnabled === true,
    tracks,
    stepBeats: clamp(finite(source.stepBeats, .25), 1 / 16, 4),
    gaze: { x: clamp(finite(source.gaze?.x), -22, 22), y: clamp(finite(source.gaze?.y), -22, 22), z: clamp(finite(source.gaze?.z), -22, 22) },
    trackMode: source.trackMode === 'replace' ? 'replace' : 'add',
    sceneFrames: Array.isArray(source.sceneFrames) && source.sceneFrames.length === 64 ? source.sceneFrames.map((frame) => normalizeSceneSnapshot(frame)) : null,
    sceneTravelPerLoop: clamp(finite(source.sceneTravelPerLoop), -100, 100),
    sceneContactCounts: source.sceneContactCounts?.length === 6 ? Array.from(source.sceneContactCounts, (count) => clamp(Math.floor(finite(count)), 0, 1024)) : null,
    staticScene: source.staticScene && typeof source.staticScene === 'object' ? normalizeSceneSnapshot(source.staticScene, true) : null,
  };
  if (source.randomSeed != null && Number.isFinite(Number(source.randomSeed))) {
    normalized.randomSeed = Math.floor(Number(source.randomSeed)) >>> 0;
    normalized.randomSourceId = PRESETS_BY_ID.has(source.randomSourceId) ? source.randomSourceId : normalized.presetId;
    normalized.randomBlend = clamp(finite(source.randomBlend, .5), 0, 1);
    normalized.randomLabel = String(source.randomLabel ?? 'Random motion').slice(0, 120);
  }
  return normalized;
}
/** Camera changes never select or sequence an animation. */
export function activeRoachPreset(_timeSeconds, settings = ROACH_MOTION_DEFAULTS) {
  return settings?.presetId === 'none' ? POSE_ONLY : PRESETS_BY_ID.get(settings?.presetId) ?? ROACH_MOTION_PRESETS[0];
}
export function roachSequencePosition(timeSeconds, settings = ROACH_MOTION_DEFAULTS) {
  const position = beatsAt(timeSeconds, settings) / clamp(finite(settings?.stepBeats, .25), 1 / 16, 4);
  return { step: Math.floor(position) % ROACH_SEQUENCE_STEPS, fraction: position % 1, length: ROACH_SEQUENCE_STEPS };
}
/** Position is measured in editable steps (0..16), not seconds. */
export function evaluateRoachTrack(track, position) {
  const local = positiveMod(finite(position), ROACH_SEQUENCE_STEPS);
  const step = Math.floor(local);
  const mix = smooth(local % 1);
  const next = (step + 1) % ROACH_SEQUENCE_STEPS;
  const from = clamp(finite(track?.steps?.[step]), -180, 180);
  const to = clamp(finite(track?.steps?.[next]), -180, 180);
  if (track?.samples?.length === 64 && track?.sourceSteps?.length === 16) {
    const fine = local * ROACH_TRACK_SUBSTEPS;
    const sample = Math.floor(fine);
    const fineMix = smooth(fine % 1);
    const a = finite(track.samples[sample]);
    const b = finite(track.samples[(sample + 1) % 64]);
    const correctionA = from - finite(track.sourceSteps[step]);
    const correctionB = to - finite(track.sourceSteps[next]);
    return clamp(a + (b - a) * fineMix + correctionA + (correctionB - correctionA) * mix, -180, 180);
  }
  return from + (to - from) * mix;
}
const JOINT_METADATA = new WeakMap();
function metadata(joint) {
  let item = JOINT_METADATA.get(joint);
  if (item) return item;
  const name = String(joint.jointId || joint.name || '').toLowerCase();
  const leg = /front/.test(name) ? 0 : /hind/.test(name) ? 2 : 1;
  const side = /right/.test(name) ? -1 : 1;
  const isLeg = /leg|proximal|distal|middle_|front_|hind_/.test(name) && !/body|abdomen/.test(name);
  const kind = /antenna/.test(name) ? 'antenna' : /wing/.test(name) ? 'wings' : isLeg ? 'leg'
    : /abdomen/.test(name) ? 'abdomen' : /neck|pronotum/.test(name) ? 'neck' : /head/.test(name) ? 'head'
      : /body|thorax/.test(name) ? 'body' : 'other';
  item = { kind, side, leg, wingKind: /wing_hind/.test(name) ? 'hind' : /wing_cover/.test(name) ? 'cover' : 'aggregate',
    footIndex: leg * 2 + (side < 0 ? 1 : 0),
    segment: /proximal/.test(name) ? 0 : /distal/.test(name) ? 2 : /foot/.test(name) ? 3 : 1 };
  JOINT_METADATA.set(joint, item);
  return item;
}

export function createRoachSceneState() {
  return { presetId: 'none', beat: 0, loopBeat: 0, groundOffset: 0, groundSpeed: 0,
    body: { lift: 0, pitch: 0, roll: 0, yaw: 0 },
    feet: ROACH_FOOT_IDS.map((id) => ({ id, stance: true, lift: 0, stride: 0, contactCount: 0, impact: 0, phase: 0 })),
    energy: { scuttle: 0, wing: 0, growl: 0, voice: 0 },
  };
}
function copySceneSnapshot(value, out, isStatic = false) {
  out.presetId = String(value?.presetId ?? 'none').slice(0, 120);
  out.beat = isStatic ? 0 : clamp(finite(value?.beat), 0, 1e9);
  out.loopBeat = isStatic ? 0 : clamp(finite(value?.loopBeat), 0, 1024);
  out.groundOffset = isStatic ? 0 : clamp(finite(value?.groundOffset), -1e8, 1e8);
  out.groundSpeed = isStatic ? 0 : clamp(finite(value?.groundSpeed), -10, 10);
  out.body.lift = isStatic ? 0 : clamp(finite(value?.body?.lift), 0, 1);
  out.body.pitch = clamp(finite(value?.body?.pitch), -120, 120);
  out.body.roll = clamp(finite(value?.body?.roll), -90, 90);
  out.body.yaw = clamp(finite(value?.body?.yaw), -180, 180);
  for (let i = 0; i < 6; i += 1) {
    const foot = value?.feet?.[i]; const target = out.feet[i];
    target.stance = foot?.stance !== false;
    target.lift = clamp(finite(foot?.lift), 0, 1);
    target.stride = clamp(finite(foot?.stride), -1, 1);
    target.phase = clamp(finite(foot?.phase), 0, 1);
    target.contactCount = isStatic ? 0 : clamp(Math.floor(finite(foot?.contactCount)), 0, 1e9);
    target.impact = isStatic ? 0 : clamp(finite(foot?.impact), 0, 1);
  }
  for (const key of ENERGY_KEYS) out.energy[key] = clamp(finite(value?.energy?.[key]), 0, 1);
  return out;
}
function normalizeSceneSnapshot(value, isStatic = false) {
  const out = copySceneSnapshot(value, createRoachSceneState(), isStatic);
  const round = (number) => Math.round(number * 10000) / 10000 || 0;
  out.groundOffset = round(out.groundOffset); out.groundSpeed = round(out.groundSpeed);
  for (const axis of BODY_AXES) out.body[axis] = round(out.body[axis]);
  for (const key of ENERGY_KEYS) out.energy[key] = round(out.energy[key]);
  for (let i = 0; i < 6; i += 1) {
    const foot = out.feet[i];
    foot.lift = round(foot.lift); foot.stride = round(foot.stride); foot.phase = round(foot.phase); foot.impact = round(foot.impact);
  }
  return out;
}
function writeBakedScene(beats, controls, out) {
  const stepBeats = clamp(finite(controls.stepBeats, .5), 1 / 16, 4);
  const intensity = clamp(finite(controls.intensity, 1), 0, 2);
  const editPosition = beats / stepBeats;
  const lap = Math.floor(editPosition / ROACH_SEQUENCE_STEPS);
  const local = positiveMod(editPosition, ROACH_SEQUENCE_STEPS);
  const fine = local * ROACH_TRACK_SUBSTEPS;
  const index = Math.floor(fine);
  const nextIndex = (index + 1) % 64;
  const mix = smooth(fine % 1);
  const a = controls.sceneFrames[index]; const b = controls.sceneFrames[nextIndex];
  const travel = clamp(finite(controls.sceneTravelPerLoop), -100, 100);
  out.presetId = String(controls.presetId ?? 'none'); out.beat = beats; out.loopBeat = local * stepBeats;
  out.groundOffset = lap * travel + finite(a.groundOffset) + (finite(b.groundOffset) + (nextIndex === 0 ? travel : 0) - finite(a.groundOffset)) * mix;
  out.groundSpeed = finite(a.groundSpeed) + (finite(b.groundSpeed) - finite(a.groundSpeed)) * mix;
  for (const axis of BODY_AXES) out.body[axis] = finite(a.body?.[axis]) + (finite(b.body?.[axis]) - finite(a.body?.[axis])) * mix;
  for (const key of ENERGY_KEYS) out.energy[key] = finite(a.energy?.[key]) + (finite(b.energy?.[key]) - finite(a.energy?.[key])) * mix;
  for (let i = 0; i < 6; i += 1) {
    const first = a.feet[i]; const second = b.feet[i]; const foot = out.feet[i];
    foot.lift = finite(first.lift) + (finite(second.lift) - finite(first.lift)) * mix;
    foot.stride = finite(first.stride) + (finite(second.stride) - finite(first.stride)) * mix;
    foot.phase = finite(first.phase);
    // Contact states use the same discrete frame as the cumulative ledger.
    // Interpolating toward the next swing must not erase this frame's landing.
    foot.stance = first.stance === true;
    foot.impact = foot.stance ? finite(first.impact) : 0;
    foot.contactCount = lap * Math.max(0, Math.floor(finite(controls.sceneContactCounts?.[i]))) + finite(first.contactCount);
  }
  out.groundOffset *= intensity; out.groundSpeed *= intensity;
  for (const axis of BODY_AXES) out.body[axis] *= intensity;
  for (const key of ENERGY_KEYS) out.energy[key] = clamp(out.energy[key] * intensity, 0, 1);
  for (let i = 0; i < 6; i += 1) {
    out.feet[i].lift = clamp(out.feet[i].lift * intensity, 0, 1);
    out.feet[i].stride = clamp(out.feet[i].stride * intensity, -1, 1);
    out.feet[i].impact = clamp(out.feet[i].impact * intensity, 0, 1);
  }
  return out;
}
const TRIPOD_PHASES = Object.freeze([0, .5, .5, 0, 0, .5]);
const SCORE_FOOT_VALUES = Array.from({ length: 6 }, () => new Float64Array(ROACH_SEQUENCE_STEPS));
const SCORE_FOOT_PRESENT = new Uint8Array(6);
function writeScoreFeet(beats, controls, joints, out, intensity) {
  for (const values of SCORE_FOOT_VALUES) values.fill(0);
  SCORE_FOOT_PRESENT.fill(0);
  let any = false;
  const tracks = Array.isArray(controls.tracks) ? controls.tracks : EMPTY_TRACKS;
  for (let trackIndex = 0; trackIndex < Math.min(tracks.length, ROACH_MAX_JOINT_TRACKS); trackIndex += 1) {
    const track = tracks[trackIndex];
    if (!track || track.enabled === false) continue;
    let joint;
    for (let i = 0; i < joints.length; i += 1) {
      if (joints[i].id === track.jointId || joints[i].jointId === track.jointId) { joint = joints[i]; break; }
    }
    if (!joint) continue;
    const item = metadata(joint);
    if (item.kind !== 'leg') continue;
    any = true;
    SCORE_FOOT_PRESENT[item.footIndex] = 1;
    const values = SCORE_FOOT_VALUES[item.footIndex];
    for (let step = 0; step < ROACH_SEQUENCE_STEPS; step += 1) values[step] += clamp(finite(track.steps?.[step]), -180, 180);
  }
  if (!any) return;
  const position = beats / clamp(finite(controls.stepBeats, .25), 1 / 16, 4);
  const lap = Math.floor(position / ROACH_SEQUENCE_STEPS);
  const local = positiveMod(position, ROACH_SEQUENCE_STEPS);
  const step = Math.floor(local);
  for (let footIndex = 0; footIndex < 6; footIndex += 1) {
    if (!SCORE_FOOT_PRESENT[footIndex]) continue;
    const values = SCORE_FOOT_VALUES[footIndex];
    const from = values[step];
    const to = values[(step + 1) % ROACH_SEQUENCE_STEPS];
    const value = from + (to - from) * smooth(local % 1);
    const foot = out.feet[footIndex];
    foot.lift = clamp(value / 45, 0, 1);
    foot.stride = clamp(value / 60, -1, 1);
    foot.stance = value <= 1e-9;
    foot.phase = local / ROACH_SEQUENCE_STEPS;
    let crossings = 0;
    let passed = 0;
    let strength = 0;
    for (let i = 0; i < ROACH_SEQUENCE_STEPS; i += 1) {
      const a = values[i];
      const b = values[(i + 1) % ROACH_SEQUENCE_STEPS];
      if (a <= 0 || b > 0) continue;
      // Invert the smoothstep crossing; bounded work, independent of sample cadence.
      const target = a / (a - b);
      let low = 0; let high = 1;
      for (let j = 0; j < 18; j += 1) {
        const middle = (low + high) * .5;
        if (smooth(middle) < target) low = middle; else high = middle;
      }
      const crossing = i + (low + high) * .5;
      crossings += 1;
      if (crossing <= local + 1e-6) passed += 1;
      strength = Math.max(strength, clamp((a - b) / 60, .15, 1));
    }
    foot.contactCount = lap * crossings + passed;
    foot.impact = crossings ? clamp(strength * intensity, 0, 1) : 0;
  }
}
/** Caller-owned result makes this safe for the audio worklet's control cadence. */
export function writeRoachSceneState(timeSeconds, settings, out, joints = []) {
  const controls = settings ?? ROACH_MOTION_DEFAULTS;
  const current = activeRoachPreset(timeSeconds, controls);
  const beats = beatsAt(timeSeconds, controls);
  if (controls.staticScene) {
    copySceneSnapshot(controls.staticScene, out, true);
    if (controls.sequenceEnabled) {
      writeScoreFeet(beats, controls, joints, out, clamp(finite(controls.intensity, 1), 0, 2));
      for (let i = 0; i < 6; i += 1) if (out.feet[i].impact > 0) out.energy.scuttle = .4;
    }
    return out;
  }
  if (controls.sequenceEnabled && controls.trackMode === 'replace' && controls.sceneFrames?.length === 64) {
    writeBakedScene(beats, controls, out);
    return writeEditedBakedFeet(beats, controls, joints, out);
  }
  const loopBeat = positiveMod(beats, 8);
  const phase = loopBeat * TAU;
  const intensity = clamp(finite(controls.intensity, 1), 0, 2);
  const mode = current.mode;
  const upright = current.rootPosture === 'upright';
  const body = out.body;
  out.presetId = current.id; out.beat = beats; out.loopBeat = loopBeat;
  body.lift = 0; body.pitch = 0; body.roll = 0; body.yaw = 0;
  const motionBeats = mode === 12 ? beats + Math.sin(phase * .5) * .28 : beats;
  const direction = mode === 14 ? -1 : 1;
  const cadence = motionBeats * current.gaitRate;
  out.groundOffset = motionBeats * current.groundSpeed * intensity;
  out.groundSpeed = current.groundSpeed * intensity * (mode === 12 ? 1 + .28 * Math.PI * Math.cos(phase * .5) : 1);
  let airborne = false;
  let flightPhase = 0;
  if (mode === 2 || mode === 5) {
    flightPhase = positiveMod(beats, 4) / 4;
    const launch = mode === 2 ? .3 : .2;
    const land = mode === 2 ? .72 : .8;
    airborne = flightPhase > launch && flightPhase < land;
    if (airborne) body.lift = Math.sin((flightPhase - launch) / (land - launch) * Math.PI) * (mode === 2 ? .22 : .3) * intensity;
    body.pitch = Math.sin(flightPhase * TAU) * (mode === 2 ? 12 : 7) * intensity;
  }
  if (upright) {
    body.pitch = (mode === 17 ? 51 : mode === 18 ? 59 : 57) * intensity;
    // The renderer grounds the rotated rear feet; additional lift would float them.
    body.lift = 0;
    body.roll = Math.sin(phase * .75) * (mode === 20 ? 9 : 5) * intensity;
  } else if (mode >= 0) {
    body.roll = Math.sin(phase * (mode === 1 ? 1.5 : mode === 4 ? .25 : .5)) * (mode === 4 ? 8 : mode === 8 ? 7 : mode === 7 ? 5 : 1.2) * intensity;
    if (mode === 15) body.yaw = Math.sin(phase * .5) * 18 * intensity;
    else if (mode === 7) body.yaw = Math.sin(phase * .5) * 9 * intensity;
    else if (mode === 4) body.pitch = Math.sin(phase * .25) * 5 * intensity;
  }
  for (let i = 0; i < 6; i += 1) {
    const foot = out.feet[i];
    const offset = mode === 13 || mode === 6 ? i / 6 : TRIPOD_PHASES[i];
    const total = cadence + offset;
    const legPhase = positiveMod(total, 1);
    const duty = mode === 1 || mode === 15 || mode === 21 ? .54 : mode === 13 ? .8 : .66;
    const swing = clamp((legPhase - duty) / (1 - duty), 0, 1);
    foot.phase = legPhase;
    foot.stance = legPhase < duty;
    foot.lift = foot.stance ? 0 : Math.sin(swing * Math.PI) * (mode === 0 || mode === 12 || mode === 14 ? .38 : mode === 1 || mode === 15 ? .52 : 1);
    foot.stride = direction * (foot.stance ? 1 - 2 * legPhase / duty : -1 + 2 * smooth(swing));
    foot.contactCount = Math.floor(total);
    foot.impact = clamp((mode === 1 ? .45 : mode === 13 ? .27 : .55) * intensity * (i >= 4 ? 1 : .8), 0, 1);
    if (mode < 0 || intensity === 0 || (upright && i < 4)) {
      foot.stance = !upright; foot.lift = upright ? .8 : 0; foot.stride = 0; foot.impact = 0; foot.contactCount = 0;
    }
    if (mode === 2 || mode === 5) {
      foot.stance = !airborne; foot.lift = airborne ? Math.sin((flightPhase - (mode === 2 ? .3 : .2)) / (mode === 2 ? .42 : .6) * Math.PI) : 0;
      foot.stride = 0;
      foot.contactCount = Math.floor(beats / 4) + (flightPhase >= (mode === 2 ? .72 : .8) ? 1 : 0);
      foot.impact = intensity === 0 || airborne ? 0 : mode === 2 ? .7 : .32;
    }
    if (intensity === 0) { foot.stance = true; foot.lift = 0; foot.stride = 0; foot.impact = 0; foot.contactCount = 0; }
  }
  if (mode < 0 && controls.sequenceEnabled) writeScoreFeet(beats, controls, joints, out, intensity);
  let keyedScuttle = 0;
  for (let i = 0; i < 6; i += 1) if (out.feet[i].impact > 0) keyedScuttle = .4;
  out.energy.scuttle = mode < 0 ? keyedScuttle : clamp(current.gaitRate / 3, 0, 1) * intensity;
  out.energy.wing = clamp((mode === 5 ? .9 : mode === 21 ? .75 : mode === 3 ? .55 : mode === 23 ? .08 : 0) * intensity, 0, 1);
  out.energy.growl = clamp((current.soundFlavor === 'growl' ? .75 : current.soundFlavor === 'creak' ? .24 : .03) * intensity, 0, 1);
  out.energy.voice = clamp((current.soundFlavor === 'voice' ? .7 : 0) * intensity, 0, 1);
  return out;
}

const POSE_SCENE = createRoachSceneState();
function hasGaitPose(joint) {
  const gait = joint.gaitPose;
  return gait && gait.back?.length === 3 && gait.front?.length === 3 && gait.raisedBack?.length === 3 && gait.raisedFront?.length === 3;
}
function addCalibratedGait(joint, item, mode, amount, phase, scene, out, index) {
  const foot = scene.feet[item.footIndex];
  const along = (foot.stride + 1) * .5;
  const lift = foot.lift;
  const gait = joint.gaitPose;
  for (let axis = 0; axis < 3; axis += 1) {
    const lower = finite(gait.back[axis]) + (finite(gait.front[axis]) - finite(gait.back[axis])) * along;
    const upper = finite(gait.raisedBack[axis]) + (finite(gait.raisedFront[axis]) - finite(gait.raisedBack[axis])) * along;
    const base = axis === 0 ? finite(joint.restOffset?.x) : axis === 1 ? finite(joint.restOffset?.y) : finite(joint.restOffset?.z);
    out[index + axis] += (lower + (upper - lower) * lift - clamp(base, -145, 145)) * amount;
  }
  // Small dance ornaments preserve the calibrated floor contact at normal intensity.
  const liftAmount = lift * amount;
  if (mode === 4) out[index + 1] += Math.sin(phase * .5 - item.leg * .8 - item.segment * .5) * 2.5 * liftAmount;
  else if (mode === 6) out[index + 1] += Math.sin(phase + item.leg + item.side - item.segment) * 3 * liftAmount;
  else if (mode === 8) out[index] += item.side * Math.sin(phase * 3) * 2.5 * liftAmount;
  else if (mode === 19) out[index + 2] += Math.tanh(Math.sin(phase + item.side) * 4) * 3 * liftAmount;
}
function addPreset(beats, item, mode, amount, out, index, antennae, scene, independentWings = false) {
  if (mode < 0) return;
  const phase = beats * TAU;
  const side = item.side;
  const beat = Math.sin(phase);
  const slow = Math.sin(phase * .25);
  let x = 0; let y = 0; let z = 0;
  if (item.kind === 'leg') {
    const foot = scene.feet[item.footIndex];
    const segment = item.segment;
    const curl = Math.sin(phase + item.leg * 1.7 + side * .8 - segment * .7);
    // The base gait uses the exact stance/swing state consumed by sound and ground.
    y = foot.stride * (segment === 0 ? 15 : segment === 1 ? 12 : 7);
    x = side * foot.lift * (segment === 0 ? 9 : segment === 1 ? -12 : -5);
    z = side * foot.stride * 2;
    if (mode === 1 || mode === 15) { y *= 1.25; x *= 1.3; }
    else if (mode === 2) { y = (segment === 0 ? -15 : segment === 1 ? 23 : -14) * (.3 + .7 * foot.lift); x = side * foot.lift * 8; }
    else if (mode === 3) y *= .3;
    else if (mode === 4) { y += Math.sin(phase * .5 - item.leg * .8 - segment * .5) * 7; z += side * slow * 5; }
    else if (mode === 5) { y = (segment === 0 ? -9 : segment === 1 ? 19 : -12) * foot.lift + y * .3; x = side * foot.lift * 5; }
    else if (mode === 6) { y += curl * (segment === 0 ? 13 : 19); x += side * Math.sin(phase * .5 + item.leg) * 6; }
    else if (mode === 7) z += side * Math.sin(phase * .5 + side) * 8;
    else if (mode === 8) { y += Math.sin(phase * 3 - segment) * 8; x += side * beat * 8; }
    else if (mode === 9 || mode === 10 || mode === 11 || mode === 22 || mode === 23) { y *= .3; x *= .3; }
    else if (mode === 13) { x *= 1.6; y *= .75; }
    else if (mode >= 16 && mode <= 20) {
      if (item.leg < 2) {
        const arm = Math.sin(phase * (mode === 17 ? 2 : mode === 20 ? .75 : 1) + (side < 0 ? Math.PI : 0));
        y = (segment === 0 ? -24 : segment === 1 ? 20 : -7) + arm * (mode === 18 ? 28 : mode === 17 ? 23 : 17);
        x = side * (segment === 0 ? 19 : -12) + Math.cos(phase + item.leg + side) * 10;
        z = side * arm * 14;
      }
      if (mode === 19) {
        const tick = Math.tanh(Math.sin(phase + side) * 4);
        y = tick * (segment === 0 ? 19 : -15); x = side * Math.tanh(Math.sin(phase * .5) * 4) * 8;
      }
    } else if (mode === 21) y += Math.sin(phase * 4 + side) * 4;
  } else if (item.kind === 'body') {
    x = Math.sin(phase * (mode === 1 ? 2 : .5)) * (mode === 8 ? 4 : 1.5);
    z = Math.sin(phase * .5) * (mode === 6 ? 4 : 1);
    if (mode === 19) { x = Math.tanh(Math.sin(phase) * 5) * 6; y = Math.tanh(Math.sin(phase * .5) * 5) * 7; }
  } else if (item.kind === 'abdomen') {
    y = Math.sin(phase * (mode === 8 ? 2 : .5) - .7) * (mode === 4 || mode === 6 ? 8 : 3);
    x = mode === 22 ? Math.sin(phase * .25) * 6 : mode === 5 ? -3 + beat : 0;
  } else if (item.kind === 'wings') {
    if (item.wingKind !== 'aggregate') {
      const opening = .5 - .5 * Math.cos(phase * .25);
      const twitter = .55 + .45 * Math.sin(phase * 2.5 + side * .7);
      const wingMode = mode === 3 || mode === 5 || mode === 21;
      const hind = item.wingKind === 'hind';
      const maximum = hind ? (mode === 5 ? 75 : mode === 21 ? 60 : 48) : 38;
      const spread = wingMode ? (mode === 21 ? .55 + .45 * Math.sin(phase * .5) : mode === 3 ? opening * (.65 + twitter * .35) : opening) : mode === 18 ? .16 : 0;
      z = side * spread * maximum;
      y = side * spread * (hind ? (mode === 3 ? 23 : 25) : 7) * (1 + Math.sin(phase * (mode === 5 ? 3.5 : mode === 21 ? 3 : 2.5) + (hind ? side * .4 : 0)));
      x = hind ? Math.sin(phase * .5 + side) * spread * 3 : 0;
    } else if (independentWings) {
      // The original parent remains a collective manual control. Leaf hinges
      // own automatic spread/flap, avoiding a second parent-level rotation.
      x = 0; y = 0; z = 0;
    } else if (mode === 3) { y = 8 * (1 - Math.cos(phase * .5)); x = Math.sin(phase * 4) * 3; }
    else if (mode === 5 || mode === 21) { y = 8 + Math.sin(phase * (mode === 5 ? 6 : 8)) * 8; z = Math.cos(phase * 4) * 3; }
    else if (mode === 4) y = Math.sin(phase * .5 - 1) * 4;
    else if (mode === 8 || mode === 18) y = beat * 4;
  } else if (item.kind === 'head' || item.kind === 'neck') {
    const scale = item.kind === 'neck' ? .45 : 1;
    if (mode === 9) { y = Math.sin(phase * .25) * 15; z = Math.sin(phase * .375 + .7) * 10; x = -3 + Math.sin(phase * .5) * 4; }
    else if (mode === 10) { x = Math.sin(phase * 2) * 10 + Math.sin(phase * 3) * 3; y = Math.sin(phase * .5) * 7; }
    else if (mode === 11 || mode === 23) {
      const phrase = .5 - .5 * Math.cos(phase * .25);
      x = Math.sin(phase * (mode === 23 ? 1.5 : 1)) * (4 + phrase * 10);
      y = Math.sin(phase * .5) * (mode === 23 ? 12 : 8); z = slow * 6;
    } else if (mode === 4) { x = Math.sin(phase) * 8; z = Math.sin(phase * .25) * 7; }
    else if (mode === 22) { x = 4 + Math.sin(phase * .5) * 10; y = Math.sin(phase * .25) * 13; z = Math.sin(phase * 4) * 2; }
    else { y = Math.sin(phase * .5 + .3) * (mode === 14 ? 13 : mode === 15 ? 8 : 3); x = mode === 13 ? -5 : 0; }
    x *= scale; y *= scale; z *= scale;
  } else if (item.kind === 'antenna' && antennae) {
    const facial = mode === 9 || mode === 10 || mode === 11 || mode === 22 || mode === 23;
    y = Math.sin(phase * (mode === 10 ? 2 : .5) + side * .65) * (facial ? 11 : 5);
    x = side * Math.cos(phase * .375 + .5) * (facial ? 6 : 3);
  }
  out[index] += x * amount; out[index + 1] += y * amount; out[index + 2] += z * amount;
}
/** Fill caller-owned XYZ degree rotations, including manual and score offsets. */
export function writeRoachPose(timeSeconds, settings, joints, out) {
  if (!out || out.length < joints.length * 3) throw new RangeError('A pose buffer needs three values per joint.');
  const controls = settings ?? ROACH_MOTION_DEFAULTS;
  const time = safeTime(timeSeconds);
  const beats = beatsAt(time, controls);
  const phase = positiveMod(beats, 8) * TAU;
  const intensity = clamp(finite(controls.intensity, 1), 0, 2);
  const antennae = controls.antennae !== false;
  const current = activeRoachPreset(time, controls);
  const scene = writeRoachSceneState(time, controls, POSE_SCENE, joints);
  let independentWings = false;
  for (let i = 0; i < joints.length; i += 1) {
    const item = metadata(joints[i]);
    if (item.kind === 'wings' && item.wingKind !== 'aggregate') { independentWings = true; break; }
  }
  const tracks = controls.sequenceEnabled && Array.isArray(controls.tracks) ? controls.tracks : EMPTY_TRACKS;
  const scorePosition = beats / clamp(finite(controls.stepBeats, .25), 1 / 16, 4);
  for (let i = 0; i < joints.length; i += 1) {
    const joint = joints[i]; const item = metadata(joint); const index = i * 3;
    out[index] = clamp(finite(joint.restOffset?.x), -145, 145) + finite(joint.offset?.x);
    out[index + 1] = clamp(finite(joint.restOffset?.y), -145, 145) + finite(joint.offset?.y);
    out[index + 2] = clamp(finite(joint.restOffset?.z), -145, 145) + finite(joint.offset?.z);
    if (joint.motion?.enabled) {
      const axis = joint.motion.axis === 'y' ? 1 : joint.motion.axis === 'z' ? 2 : 0;
      out[index + axis] += Math.sin(time * TAU * clamp(finite(joint.motion.speed, .5), .05, 8)) * clamp(finite(joint.motion.amplitude, 12), 0, 90);
    }
    if (item.kind === 'antenna' && antennae) {
      out[index] += (Math.sin(phase * .375 + item.side * .8) * 7 + Math.sin(phase * 3 + item.side) * 2.5) * intensity;
      out[index + 1] += (Math.sin(phase * .625 + item.side * 1.1) * 15 + Math.sin(phase * 5 + item.side) * 3) * intensity;
      out[index + 2] += Math.cos(phase * 1.875 + item.side) * item.side * 5 * intensity;
    }
    const calibrated = item.kind === 'leg' && hasGaitPose(joint) && current.mode >= 0
      && current.rootPosture === 'low';
    if (calibrated) addCalibratedGait(joint, item, current.mode, intensity, phase, scene, out, index);
    else addPreset(positiveMod(beats, 8), item, current.mode, intensity, out, index, antennae, scene, independentWings);
    for (let trackIndex = 0; trackIndex < Math.min(tracks.length, ROACH_MAX_JOINT_TRACKS); trackIndex += 1) {
      const track = tracks[trackIndex];
      if (!track || track.enabled === false || (track.jointId !== joint.id && track.jointId !== joint.jointId)) continue;
      if (item.kind === 'antenna' && !antennae && controls.trackMode === 'replace' && track.samples?.length === 64 && track.sourceSteps?.length === 16) continue;
      const axis = track.axis === 'y' ? 1 : track.axis === 'z' ? 2 : 0;
      const value = evaluateRoachTrack(track, scorePosition);
      if (controls.trackMode === 'replace') {
        const name = axis === 0 ? 'x' : axis === 1 ? 'y' : 'z';
        const extraMotion = joint.motion?.enabled && (joint.motion.axis === name || (!['x', 'y', 'z'].includes(joint.motion.axis) && axis === 0))
          ? Math.sin(time * TAU * clamp(finite(joint.motion.speed, .5), .05, 8)) * clamp(finite(joint.motion.amplitude, 12), 0, 90) : 0;
        out[index + axis] = clamp(finite(joint.restOffset?.[name]), -145, 145) + finite(joint.offset?.[name]) + extraMotion + value * intensity;
      } else out[index + axis] += value;
    }
    // Apply camera gaze once after track composition; sound and graphics share it.
    if (item.kind === 'head') {
      out[index] += clamp(finite(controls.gaze?.x), -22, 22);
      out[index + 1] += clamp(finite(controls.gaze?.y), -22, 22);
      out[index + 2] += clamp(finite(controls.gaze?.z), -22, 22);
    }
    out[index] = clamp(out[index], -180, 180); out[index + 1] = clamp(out[index + 1], -180, 180); out[index + 2] = clamp(out[index + 2], -180, 180);
  }
  return constrainRoachPose(out, joints, out);
}

/** Unit-intensity factory motion, authored as 16 editable knots plus 64 samples. */
export function bakeRoachPresetTracks(presetId, joints, options = {}) {
  const rig = cleanFactoryJoints(joints);
  const settings = normalizeRoachMotion({ presetId, tempo: options.tempo ?? 108, intensity: 1,
    antennae: options.antennae !== false, sequenceEnabled: false, tracks: [], staticScene: null, gaze: { x: 0, y: 0, z: 0 } });
  const output = new Float32Array(rig.length * 3);
  const tracks = [];
  for (let i = 0; i < rig.length; i += 1) for (const axis of ['x', 'y', 'z']) {
    const track = createRoachJointTrack(rig[i].id ?? rig[i].jointId ?? String(i), axis);
    track.samples = new Array(64); track.sourceSteps = new Array(16);
    tracks.push(track);
  }
  const frames = [];
  const secondsPerBeat = 60 / settings.tempo;
  for (let sample = 0; sample < 64; sample += 1) {
    const time = sample / 8 * secondsPerBeat;
    writeRoachPose(time, settings, rig, output);
    frames.push(writeRoachSceneState(time, settings, createRoachSceneState(), rig));
    for (let trackIndex = 0; trackIndex < tracks.length; trackIndex += 1) {
      const joint = rig[Math.floor(trackIndex / 3)]; const track = tracks[trackIndex];
      const value = Math.round(clamp(output[trackIndex] - finite(joint.restOffset?.[track.axis]), -180, 180) * 10000) / 10000 || 0;
      track.samples[sample] = value;
      if (sample % 4 === 0) track.steps[sample / 4] = track.sourceSteps[sample / 4] = value;
    }
  }
  const end = writeRoachSceneState(8 * secondsPerBeat, settings, createRoachSceneState(), rig);
  return normalizeRoachMotion({ ...settings, intensity: options.intensity ?? 1, stepBeats: .5,
    sequenceEnabled: true, trackMode: 'replace', tracks, sceneFrames: frames,
    sceneTravelPerLoop: end.groundOffset - frames[0].groundOffset,
    sceneContactCounts: end.feet.map((foot, i) => foot.contactCount - frames[0].feet[i].contactCount),
    staticScene: null,
  });
}
/** Seeded variation keeps one complete support gait and blends only independent
 * upper-body curves. Foot phases/counts and torso motion remain the base patch,
 * so random wings or expressions cannot invent or erase ground contacts. */
export function createRandomRoachMotion(seed, joints, options = {}) {
  const safeSeed = Math.floor(finite(seed, 1)) >>> 0;
  const random = randomGenerator(safeSeed ^ 0x9e3779b9);
  // Mix the seed before selecting: adjacent UI seeds should not all pick the
  // first factory patch because their first xorshift outputs are very small.
  random(); random(); random();
  const base = ROACH_MOTION_PRESETS[Math.floor(random() * ROACH_MOTION_PRESETS.length)];
  const compatible = ROACH_MOTION_PRESETS.filter((item) => item.id !== base.id
    && (item.rootPosture === base.rootPosture || item.category === 'Wings' || item.category === 'Face'));
  const donor = compatible[Math.floor(random() * compatible.length)];
  const mix = .3 + random() * .4;
  const shift = Math.floor(random() * 8) * 8;
  const result = bakeRoachPresetTracks(base.id, joints, options);
  const alternate = bakeRoachPresetTracks(donor.id, joints, options);
  const rig = cleanFactoryJoints(joints);
  const round = (value) => Math.round(clamp(value, -180, 180) * 10000) / 10000 || 0;
  for (let jointIndex = 0; jointIndex < rig.length; jointIndex += 1) {
    const item = metadata(rig[jointIndex]);
    if (!['head', 'neck', 'antenna', 'wings', 'abdomen'].includes(item.kind)) continue;
    const wobble = item.kind === 'antenna' ? 2 + random() * 4 : 0;
    const phase = random() * TAU;
    for (let axis = 0; axis < 3; axis += 1) {
      const track = result.tracks[jointIndex * 3 + axis];
      const other = alternate.tracks[jointIndex * 3 + axis];
      for (let sample = 0; sample < 64; sample += 1) {
        const value = track.samples[sample] * (1 - mix) + other.samples[(sample + shift) % 64] * mix
          + wobble * Math.sin(sample / 64 * TAU * (axis + 2) + phase);
        track.samples[sample] = round(value);
        if (sample % 4 === 0) track.steps[sample / 4] = track.sourceSteps[sample / 4] = track.samples[sample];
      }
    }
  }
  for (let sample = 0; sample < 64; sample += 1) {
    for (const key of ['wing', 'growl', 'voice']) result.sceneFrames[sample].energy[key]
      = result.sceneFrames[sample].energy[key] * (1 - mix) + alternate.sceneFrames[(sample + shift) % 64].energy[key] * mix;
  }
  return normalizeRoachMotion({ ...result, randomSeed: safeSeed, randomSourceId: donor.id,
    randomBlend: mix, randomLabel: `${base.label} / ${donor.label}` });
}
function cleanFactoryJoints(joints) {
  return (Array.isArray(joints) ? joints : []).slice(0, 128).map((joint) => ({ ...joint,
    offset: { x: 0, y: 0, z: 0 }, motion: { enabled: false, axis: 'x', amplitude: 0, speed: 1 } }));
}
const staticPose = (id, label, presetId, beat, adjustment = '') => Object.freeze({ id, label, presetId, beat, adjustment });
export const ROACH_STATIC_POSES = Object.freeze([
  staticPose('neutral', 'Grounded neutral', 'none', 0),
  staticPose('ready_crouch', 'Ready to pounce', 'side_jump', 1),
  staticPose('frozen_scuttle', 'Caught scuttling', 'side_walk', .28),
  staticPose('peek_left', 'Peeking left', 'face_curious', 1),
  staticPose('peek_right', 'Peeking right', 'face_curious', 3),
  staticPose('little_bow', 'A little bow', 'face_sing', 2, 'bow'),
  staticPose('standing_tall', 'Standing tall', 'dance_upright', .5),
  staticPose('boxer_guard', 'Tiny boxer', 'dance_boxer', .3),
  staticPose('high_kick', 'High kick', 'dance_can_can', .25),
  staticPose('noodle_legs', 'Noodle legs', 'bottom_wiggle', .5),
  staticPose('low_prowl', 'Low prowl', 'side_tiptoe', .5),
  staticPose('listening', 'Listening closely', 'face_curious', 0, 'listening'),
  staticPose('antenna_v', 'Antenna victory', 'none', 0, 'antenna_v'),
  staticPose('wings_spread', 'Wings spread', 'top_flight', 2, 'wings_spread'),
  staticPose('wings_half', 'Half-open wings', 'top_wing_fan', 1),
  staticPose('wing_left', 'Left wing salute', 'none', 0, 'wing_left'),
  staticPose('wing_right', 'Right wing salute', 'none', 0, 'wing_right'),
  staticPose('hindwing_display', 'Hindwing display', 'none', 0, 'hindwing_display'),
  staticPose('tucked', 'Tucked little bug', 'top_flight', 1.5, 'tucked'),
  staticPose('salute', 'Kitchen salute', 'dance_boxer', .25, 'salute'),
  staticPose('lean_left', 'Leaning left', 'dance_waltz', 1, 'lean_left'),
  staticPose('lean_right', 'Leaning right', 'dance_waltz', 2, 'lean_right'),
  staticPose('house_monster', 'House monster', 'face_growl', 2),
  staticPose('sleeping', 'Sleeping in the cupboard', 'none', 0, 'sleeping'),
]);
const STATIC_POSES_BY_ID = new Map(ROACH_STATIC_POSES.map((item) => [item.id, item]));
function randomGenerator(seed) {
  let value = (Math.floor(finite(seed, 1)) >>> 0) || 0x91e10da5;
  return () => { value ^= value << 13; value ^= value >>> 17; value ^= value << 5; return (value >>> 0) / 4294967296; };
}
/** A snapshot has no internal clock. Offsets are relative to calibrated rest. */
export function getRoachStaticPose(poseId, joints, options = {}) {
  const random = randomGenerator(options.seed ?? 1);
  const randomized = poseId === 'random';
  const selected = randomized ? ROACH_STATIC_POSES[1 + Math.floor(random() * (ROACH_STATIC_POSES.length - 1))]
    : STATIC_POSES_BY_ID.get(poseId) ?? ROACH_STATIC_POSES[0];
  const rig = cleanFactoryJoints(joints);
  if (selected.id === 'neutral' && !randomized) {
    return { id: 'neutral', label: selected.label, sourcePresetId: 'none', seed: Math.floor(finite(options.seed, 1)),
      offsets: rig.map((joint, i) => ({ jointId: String(joint.id ?? joint.jointId ?? i), x: 0, y: 0, z: 0 })),
      scene: createRoachSceneState() };
  }
  const settings = normalizeRoachMotion({ presetId: selected.presetId, tempo: 120, intensity: 1,
    antennae: selected.presetId !== 'none', sequenceEnabled: false, tracks: [] });
  const time = selected.beat * .5;
  const output = writeRoachPose(time, settings, rig, new Float32Array(rig.length * 3));
  const scene = normalizeSceneSnapshot(writeRoachSceneState(time, settings, createRoachSceneState(), rig), true);
  if (selected.adjustment === 'lean_left') scene.body.roll = -16;
  if (selected.adjustment === 'lean_right') scene.body.roll = 16;
  if (selected.adjustment === 'tucked') scene.body.pitch = 8;
  if (randomized) {
    scene.body.roll = clamp(scene.body.roll + (random() * 2 - 1) * 9, -24, 24);
    scene.body.yaw = (random() * 2 - 1) * 25;
  }
  for (let i = 0; i < rig.length; i += 1) {
    const item = metadata(rig[i]); const k = i * 3; const adjustment = selected.adjustment;
    if (adjustment === 'bow' && item.kind === 'head') output[k] += 16;
    if ((adjustment === 'listening' || adjustment === 'antenna_v') && item.kind === 'antenna') {
      output[k] = 10 * item.side; output[k + 1] = 35 * item.side; output[k + 2] = -10 * item.side;
    }
    if (adjustment === 'sleeping') {
      if (item.kind === 'antenna') output[k + 1] = item.side * -18;
      if (item.kind === 'head') output[k] = 15;
      if (item.kind === 'leg') output[k + 1] += item.segment === 0 ? -7 : 10;
    }
    if (adjustment === 'salute' && item.kind === 'leg' && item.side > 0 && item.leg === 0) output[k + 1] -= 22;
    if (item.kind === 'wings' && item.wingKind !== 'aggregate') {
      const sideSelected = adjustment === 'wing_left' ? item.side > 0 : adjustment === 'wing_right' ? item.side < 0 : true;
      if (adjustment === 'wing_left' || adjustment === 'wing_right' || adjustment === 'hindwing_display' || adjustment === 'wings_spread') {
        output[k] = 0;
        output[k + 1] = sideSelected ? item.side * (item.wingKind === 'hind' ? 15 : 6) : 0;
        output[k + 2] = sideSelected ? item.side * (item.wingKind === 'hind' ? 75 : 38) : 0;
      }
      if (adjustment === 'tucked') { output[k] = 0; output[k + 1] = 0; output[k + 2] = 0; }
    }
    if (randomized) {
      const range = item.kind === 'leg' ? 7 : item.kind === 'antenna' ? 24 : item.kind === 'head' ? 16 : item.kind === 'wings' ? 13 : 4;
      for (let axis = 0; axis < 3; axis += 1) output[k + axis] += (random() * 2 - 1) * range;
    }
  }
  constrainRoachPose(output, rig, output);
  const offsets = rig.map((joint, i) => ({ jointId: String(joint.id ?? joint.jointId ?? i),
    x: clamp(output[i * 3] - finite(joint.restOffset?.x), -180, 180),
    y: clamp(output[i * 3 + 1] - finite(joint.restOffset?.y), -180, 180),
    z: clamp(output[i * 3 + 2] - finite(joint.restOffset?.z), -180, 180),
  }));
  return { id: randomized ? 'random' : selected.id, label: randomized ? 'Random static pose' : selected.label,
    sourcePresetId: selected.presetId, seed: Math.floor(finite(options.seed, 1)), offsets, scene };
}

// Conservative body-core exclusion shared by graphics and sound. Each tested
// limb point must remain outside an ellipsoid derived from the scan's abdomen.
// Neutral insertion points inside that core are exempt; this is not mesh CCD.
const CONSTRAINT_RIGS = new WeakMap();
const IDENTITY_MATRIX = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
function multiplyMatrix(a, ai, b, bi, out, oi) {
  for (let column = 0; column < 4; column += 1) {
    const x = b[bi + column * 4]; const y = b[bi + column * 4 + 1];
    const z = b[bi + column * 4 + 2]; const w = b[bi + column * 4 + 3];
    for (let row = 0; row < 4; row += 1) out[oi + column * 4 + row] = a[ai + row] * x + a[ai + 4 + row] * y + a[ai + 8 + row] * z + a[ai + 12 + row] * w;
  }
}
function composeJoint(matrix, joint, x, y, z) {
  const k = joint.kinematics;
  const hx = x * Math.PI / 360; const hy = y * Math.PI / 360; const hz = z * Math.PI / 360;
  const cx = Math.cos(hx); const cy = Math.cos(hy); const cz = Math.cos(hz);
  const sx = Math.sin(hx); const sy = Math.sin(hy); const sz = Math.sin(hz);
  const ox = sx * cy * cz + cx * sy * sz; const oy = cx * sy * cz - sx * cy * sz;
  const oz = cx * cy * sz + sx * sy * cz; const ow = cx * cy * cz - sx * sy * sz;
  const q = k?.quaternion;
  const bx = finite(q?.[0]); const by = finite(q?.[1]); const bz = finite(q?.[2]); const bw = finite(q?.[3], 1);
  const qx = bx * ow + bw * ox + by * oz - bz * oy;
  const qy = by * ow + bw * oy + bz * ox - bx * oz;
  const qz = bz * ow + bw * oz + bx * oy - by * ox;
  const qw = bw * ow - bx * ox - by * oy - bz * oz;
  const x2 = qx + qx; const y2 = qy + qy; const z2 = qz + qz;
  const xx = qx * x2; const xy = qx * y2; const xz = qx * z2;
  const yy = qy * y2; const yz = qy * z2; const zz = qz * z2;
  const wx = qw * x2; const wy = qw * y2; const wz = qw * z2;
  const scaleX = finite(k?.scale?.[0], 1); const scaleY = finite(k?.scale?.[1], 1); const scaleZ = finite(k?.scale?.[2], 1);
  matrix[0] = (1 - yy - zz) * scaleX; matrix[1] = (xy + wz) * scaleX; matrix[2] = (xz - wy) * scaleX; matrix[3] = 0;
  matrix[4] = (xy - wz) * scaleY; matrix[5] = (1 - xx - zz) * scaleY; matrix[6] = (yz + wx) * scaleY; matrix[7] = 0;
  matrix[8] = (xz + wy) * scaleZ; matrix[9] = (yz - wx) * scaleZ; matrix[10] = (1 - xx - yy) * scaleZ; matrix[11] = 0;
  matrix[12] = finite(k?.position?.[0]); matrix[13] = finite(k?.position?.[1]); matrix[14] = finite(k?.position?.[2]); matrix[15] = 1;
}
function forwardKinematics(rig, pose, joints) {
  for (let order = 0; order < rig.order.length; order += 1) {
    const i = rig.order[order]; const p = i * 3;
    composeJoint(rig.local, joints[i], pose[p], pose[p + 1], pose[p + 2]);
    const parent = rig.parents[i];
    if (parent >= 0) multiplyMatrix(rig.world, parent * 16, rig.local, 0, rig.world, i * 16);
    else multiplyMatrix(joints[i].kinematics?.parentMatrix ?? IDENTITY_MATRIX, 0, rig.local, 0, rig.world, i * 16);
  }
  const a = rig.world; const o = rig.body * 16; const inverse = rig.inverse;
  const aa = a[o]; const ab = a[o + 4]; const ac = a[o + 8];
  const ba = a[o + 1]; const bb = a[o + 5]; const bc = a[o + 9];
  const ca = a[o + 2]; const cb = a[o + 6]; const cc = a[o + 10];
  const determinant = aa * (bb * cc - bc * cb) - ab * (ba * cc - bc * ca) + ac * (ba * cb - bb * ca);
  if (Math.abs(determinant) < 1e-15) { rig.valid = false; return; }
  const d = 1 / determinant;
  inverse[0] = (bb * cc - bc * cb) * d; inverse[1] = (ac * cb - ab * cc) * d; inverse[2] = (ab * bc - ac * bb) * d;
  inverse[3] = (bc * ca - ba * cc) * d; inverse[4] = (aa * cc - ac * ca) * d; inverse[5] = (ac * ba - aa * bc) * d;
  inverse[6] = (ba * cb - bb * ca) * d; inverse[7] = (ab * ca - aa * cb) * d; inverse[8] = (aa * bb - ab * ba) * d;
  inverse[9] = a[o + 12]; inverse[10] = a[o + 13]; inverse[11] = a[o + 14];
  rig.valid = true;
}
function coreDistance(rig, jointIndex, pointIndex) {
  const point = rig.samples[jointIndex]; const offset = pointIndex * 3; const matrix = rig.world; const m = jointIndex * 16;
  const x = point[offset]; const y = point[offset + 1]; const z = point[offset + 2]; const inv = rig.inverse;
  const wx = matrix[m] * x + matrix[m + 4] * y + matrix[m + 8] * z + matrix[m + 12] - inv[9];
  const wy = matrix[m + 1] * x + matrix[m + 5] * y + matrix[m + 9] * z + matrix[m + 13] - inv[10];
  const wz = matrix[m + 2] * x + matrix[m + 6] * y + matrix[m + 10] * z + matrix[m + 14] - inv[11];
  const bx = (inv[0] * wx + inv[1] * wy + inv[2] * wz - rig.center[0]) / rig.radii[0];
  const by = (inv[3] * wx + inv[4] * wy + inv[5] * wz - rig.center[1]) / rig.radii[1];
  const bz = (inv[6] * wx + inv[7] * wy + inv[8] * wz - rig.center[2]) / rig.radii[2];
  return bx * bx + by * by + bz * bz;
}
function collisionBranch(rig, branch = -1) {
  if (!rig.valid) return -1;
  for (let i = 0; i < rig.samples.length; i += 1) {
    if (i === rig.body || (branch >= 0 && rig.branches[i] !== branch)) continue;
    const active = rig.active[i];
    for (let j = 0; j < active.length; j += 1) if (active[j] && coreDistance(rig, i, j) < .99999) return rig.branches[i];
  }
  return -1;
}
function constraintRig(joints) {
  let body = -1;
  for (let i = 0; i < joints.length; i += 1) if (joints[i].bodyEllipsoid) { body = i; break; }
  if (body < 0 || joints.length > 128) return null;
  let rig = CONSTRAINT_RIGS.get(joints);
  if (rig && rig.refs.length === joints.length && rig.ellipsoidRef === joints[body].bodyEllipsoid) {
    let same = true;
    for (let i = 0; i < joints.length; i += 1) {
      if (rig.refs[i] !== joints[i].kinematics || rig.sampleRefs[i] !== joints[i].collisionSamples || rig.restRefs[i] !== joints[i].restOffset) { same = false; break; }
    }
    if (same) return rig;
  }
  const count = joints.length;
  const parents = new Int16Array(count); parents.fill(-1);
  for (let i = 0; i < count; i += 1) for (let j = 0; j < count; j += 1) if (joints[i].parent === joints[j].id && i !== j) parents[i] = j;
  const order = []; const done = new Uint8Array(count);
  for (let pass = 0; pass < count; pass += 1) for (let i = 0; i < count; i += 1) {
    if (!done[i] && (parents[i] < 0 || done[parents[i]])) { order.push(i); done[i] = 1; }
  }
  if (order.length !== count) return null;
  const branches = new Int16Array(count);
  for (let i = 0; i < count; i += 1) {
    let ancestor = i;
    for (let depth = 0; depth < count && parents[ancestor] >= 0 && parents[ancestor] !== body; depth += 1) ancestor = parents[ancestor];
    branches[i] = ancestor;
  }
  const ellipsoid = joints[body].bodyEllipsoid;
  rig = { body, order, parents, branches, ellipsoidRef: ellipsoid, world: new Float64Array(count * 16), local: new Float64Array(16), inverse: new Float64Array(12),
    neutral: new Float64Array(count * 3), target: new Float64Array(count * 3), samples: [], active: [], valid: true,
    center: Array.from({ length: 3 }, (_, i) => finite(ellipsoid.center?.[i])),
    radii: Array.from({ length: 3 }, (_, i) => Math.max(1e-5, Math.abs(finite(ellipsoid.radii?.[i], 1)))),
    refs: joints.map((joint) => joint.kinematics), sampleRefs: joints.map((joint) => joint.collisionSamples), restRefs: joints.map((joint) => joint.restOffset),
  };
  for (let i = 0; i < count; i += 1) {
    for (let axis = 0; axis < 3; axis += 1) rig.neutral[i * 3 + axis] = clamp(finite(joints[i].restOffset?.[XYZ_AXES[axis]]), -145, 145);
    const source = Array.isArray(joints[i].collisionSamples) ? joints[i].collisionSamples.slice(0, 8) : [];
    const samples = new Float64Array(source.length * 9);
    for (let j = 0; j < source.length; j += 1) for (let section = 0; section < 3; section += 1) for (let axis = 0; axis < 3; axis += 1) {
      samples[j * 9 + section * 3 + axis] = finite(source[j]?.[axis]) * (.5 + section * .25);
    }
    rig.samples.push(samples); rig.active.push(new Uint8Array(source.length * 3));
  }
  forwardKinematics(rig, rig.neutral, joints);
  for (let i = 0; i < count; i += 1) for (let j = 0; j < rig.active[i].length; j += 1) rig.active[i][j] = coreDistance(rig, i, j) >= 1.001 ? 1 : 0;
  CONSTRAINT_RIGS.set(joints, rig);
  return rig;
}
/** Degree output is clamped to joint limits and the conservative body core. */
export function constrainRoachPose(target, joints, out = target) {
  if (!out || out.length < joints.length * 3) throw new RangeError('A pose buffer needs three values per joint.');
  for (let i = 0; i < joints.length; i += 1) for (let axis = 0; axis < 3; axis += 1) {
    const name = XYZ_AXES[axis]; const limits = joints[i].poseLimits?.[name];
    const rest = clamp(finite(joints[i].restOffset?.[name]), -145, 145);
    const min = limits?.length === 2 ? Math.max(-180, rest + finite(limits[0], -180)) : -180;
    const max = limits?.length === 2 ? Math.min(180, rest + finite(limits[1], 180)) : 180;
    out[i * 3 + axis] = clamp(finite(target[i * 3 + axis]), Math.min(min, max), Math.max(min, max));
  }
  const rig = constraintRig(joints);
  if (!rig) return out;
  forwardKinematics(rig, out, joints);
  let branch = collisionBranch(rig);
  if (branch < 0) return out;
  for (let i = 0; i < joints.length * 3; i += 1) rig.target[i] = out[i];
  for (let attempt = 0; attempt < 8 && branch >= 0; attempt += 1) {
    let low = 0; let high = 1;
    for (let iteration = 0; iteration < 8; iteration += 1) {
      const fraction = (low + high) * .5;
      for (let i = 0; i < joints.length; i += 1) if (rig.branches[i] === branch && i !== rig.body) {
        for (let axis = 0; axis < 3; axis += 1) { const k = i * 3 + axis; out[k] = rig.neutral[k] + (rig.target[k] - rig.neutral[k]) * fraction; }
      }
      forwardKinematics(rig, out, joints);
      if (collisionBranch(rig, branch) < 0) low = fraction; else high = fraction;
    }
    for (let i = 0; i < joints.length; i += 1) if (rig.branches[i] === branch && i !== rig.body) {
      for (let axis = 0; axis < 3; axis += 1) { const k = i * 3 + axis; out[k] = rig.neutral[k] + (rig.target[k] - rig.neutral[k]) * low; }
    }
    forwardKinematics(rig, out, joints);
    branch = collisionBranch(rig);
  }
  if (branch >= 0) {
    // Bounded fallback for an unusually crowded imported hierarchy.
    for (let i = 0; i < joints.length; i += 1) if (i !== rig.body) for (let axis = 0; axis < 3; axis += 1) out[i * 3 + axis] = rig.neutral[i * 3 + axis];
  }
  return out;
}

const EDITED_FOOT_CACHES = new WeakMap();
function editedFootCache(controls, joints) {
  const tracks = controls.tracks;
  let cache = EDITED_FOOT_CACHES.get(controls);
  let rebuild = !cache || cache.tracks !== tracks || cache.joints !== joints;
  if (!rebuild) for (let i = 0; i < Math.min(tracks.length, ROACH_MAX_JOINT_TRACKS); i += 1) {
    if (cache.trackRefs[i] !== tracks[i]) { rebuild = true; break; }
  }
  if (rebuild) {
    const count = Math.min(tracks.length, ROACH_MAX_JOINT_TRACKS);
    const jointIndices = new Int16Array(count); jointIndices.fill(-1);
    const footIndices = new Int8Array(count); footIndices.fill(-1);
    for (let i = 0; i < count; i += 1) {
      const track = tracks[i];
      for (let j = 0; j < joints.length; j += 1) if (track.jointId === joints[j].id || track.jointId === joints[j].jointId) {
        jointIndices[i] = j;
        const item = metadata(joints[j]);
        if (item.kind === 'leg') footIndices[i] = item.footIndex;
        break;
      }
    }
    cache = { tracks, joints, jointIndices, footIndices, trackRefs: tracks.slice(0, count), hash: null,
      edited: new Uint8Array(6), scratchEdited: new Uint8Array(6), lifts: Array.from({ length: 6 }, () => new Float64Array(64)),
      crossings: Array.from({ length: 6 }, () => []), strengths: new Float64Array(6), moving: new Uint8Array(6) };
    EDITED_FOOT_CACHES.set(controls, cache);
  }
  let hash = 2166136261;
  const edited = cache.scratchEdited; edited.fill(0);
  for (let i = 0; i < cache.trackRefs.length; i += 1) {
    const foot = cache.footIndices[i]; if (foot < 0) continue;
    const track = tracks[i];
    const detailed = track.samples?.length === 64 && track.sourceSteps?.length === 16;
    let changed = !detailed;
    hash = Math.imul(hash ^ (track.enabled === false ? 7 : detailed ? 13 : 29), 16777619);
    for (let j = 0; j < 16; j += 1) {
      const value = finite(track.steps[j]);
      hash = Math.imul(hash ^ Math.round(value * 10000), 16777619);
      if (detailed && Math.abs(value - finite(track.sourceSteps[j])) > .00001) changed = true;
    }
    if (changed && track.enabled !== false) edited[foot] = 1;
  }
  if (cache.hash === hash) return cache;
  cache.hash = hash; cache.edited.set(edited); cache.moving.fill(0);
  for (let footIndex = 0; footIndex < 6; footIndex += 1) {
    cache.crossings[footIndex].length = 0; cache.strengths[footIndex] = 0;
    if (!edited[footIndex]) continue;
    const lifts = cache.lifts[footIndex];
    let hasMotion = false;
    for (let trackIndex = 0; trackIndex < cache.trackRefs.length; trackIndex += 1) {
      if (cache.footIndices[trackIndex] !== footIndex || tracks[trackIndex].enabled === false) continue;
      let min = Infinity; let max = -Infinity;
      for (let sample = 0; sample < 64; sample += 1) {
        const value = evaluateRoachTrack(tracks[trackIndex], sample / 4);
        min = Math.min(min, value); max = Math.max(max, value);
      }
      if (max - min > .0001) hasMotion = true;
    }
    cache.moving[footIndex] = hasMotion ? 1 : 0;
    for (let sample = 0; sample < 64; sample += 1) {
      const frame = controls.sceneFrames[sample]; const foot = frame.feet[footIndex];
      let projection = 0; let energy = 0;
      for (let trackIndex = 0; trackIndex < cache.trackRefs.length; trackIndex += 1) {
        if (cache.footIndices[trackIndex] !== footIndex || tracks[trackIndex].enabled === false) continue;
        const track = tracks[trackIndex]; const joint = joints[cache.jointIndices[trackIndex]]; const item = metadata(joint);
        const axis = track.axis === 'y' ? 1 : track.axis === 'z' ? 2 : 0;
        const along = (finite(foot.stride) + 1) * .5;
        let liftAngle; let factoryAngle;
        if (hasGaitPose(joint)) {
          const gait = joint.gaitPose;
          const lower = finite(gait.back[axis]) + (finite(gait.front[axis]) - finite(gait.back[axis])) * along;
          const upper = finite(gait.raisedBack[axis]) + (finite(gait.raisedFront[axis]) - finite(gait.raisedBack[axis])) * along;
          liftAngle = upper - lower;
          factoryAngle = lower + liftAngle * finite(foot.lift) - finite(joint.restOffset?.[track.axis]);
        } else {
          liftAngle = axis === 0 ? item.side * (item.segment === 0 ? 9 : item.segment === 1 ? -12 : -5) : axis === 1 ? 2 : 0;
          const run = controls.presetId === 'side_run' || controls.presetId === 'side_zigzag';
          factoryAngle = axis === 0 ? liftAngle * finite(foot.lift) * (run ? 1.3 : 1)
            : axis === 1 ? finite(foot.stride) * (item.segment === 0 ? 15 : item.segment === 1 ? 12 : 7) * (run ? 1.25 : 1)
              : item.side * finite(foot.stride) * 2;
        }
        const baseline = track.samples?.length === 64 ? finite(track.samples[sample]) : factoryAngle;
        const value = evaluateRoachTrack(track, sample / 4);
        projection += (value - baseline) * liftAngle;
        energy += liftAngle * liftAngle;
      }
      // The body itself can land even when every joint contour is held still.
      const rootLift = finite(frame.body.lift) * 10;
      lifts[sample] = hasMotion ? clamp(finite(foot.lift) + (energy > .00001 ? projection / energy : 0) + rootLift, -2, 3) : rootLift;
      cache.strengths[footIndex] = Math.max(cache.strengths[footIndex], finite(foot.impact));
    }
    const threshold = .03;
    for (let i = 0; i < 64; i += 1) {
      const a = lifts[i]; const b = lifts[(i + 1) % 64];
      if (a <= threshold || b > threshold) continue;
      const target = (a - threshold) / (a - b);
      let low = 0; let high = 1;
      for (let j = 0; j < 16; j += 1) { const middle = (low + high) * .5; if (smooth(middle) < target) low = middle; else high = middle; }
      cache.crossings[footIndex].push(i + (low + high) * .5);
    }
  }
  return cache;
}
function writeEditedBakedFeet(beats, controls, joints, out) {
  if (!Array.isArray(controls.tracks) || !controls.tracks.length || !joints.length) return out;
  const cache = editedFootCache(controls, joints);
  const position = beats / clamp(finite(controls.stepBeats, .5), 1 / 16, 4);
  const lap = Math.floor(position / 16); const fine = positiveMod(position, 16) * 4;
  const index = Math.floor(fine); const mix = smooth(fine % 1);
  const intensity = clamp(finite(controls.intensity, 1), 0, 2);
  for (let i = 0; i < 6; i += 1) {
    if (!cache.edited[i]) continue;
    const values = cache.lifts[i];
    const value = values[index] + (values[(index + 1) % 64] - values[index]) * mix;
    const foot = out.feet[i];
    foot.lift = clamp(value * intensity, 0, 1);
    foot.stance = value <= .03 || intensity === 0;
    if (!cache.moving[i]) foot.stride = 0;
    const crossings = cache.crossings[i];
    let count = lap * crossings.length;
    for (let j = 0; j < crossings.length; j += 1) if (crossings[j] <= fine + 1e-7) count += 1;
    foot.contactCount = count;
    foot.impact = foot.stance && crossings.length ? clamp(cache.strengths[i] * intensity, 0, 1) : 0;
  }
  return out;
}
