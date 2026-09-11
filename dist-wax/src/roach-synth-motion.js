/**
 * Audio-clock articulation and a shared, stylized six-foot support model.
 * The dried scan has rigid curled limbs: these are designed gait contacts,
 * not an inverse-kinematics or validated collision/locomotion simulation.
 * Rotations are degrees; scene distances are fractions of body length.
 */
const TAU = Math.PI * 2;
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const positiveMod = (value, modulus) => ((value % modulus) + modulus) % modulus;
const smooth = (value) => value * value * (3 - 2 * value);
const safeTime = (time) => clamp(finite(time), 0, 1_000_000_000);
const beatsAt = (time, settings) => safeTime(time) * clamp(finite(settings?.tempo, 108), 30, 240) / 60;
export const ROACH_SEQUENCE_STEPS = 16;
export const ROACH_MAX_JOINT_TRACKS = 81;
export const ROACH_FOOT_IDS = Object.freeze(['front_left', 'front_right', 'middle_left', 'middle_right', 'hind_left', 'hind_right']);
const preset = (id, label, category, mode, soundFlavor, gaitRate, groundSpeed, rootPosture, description) => Object.freeze({
  id, label, category, mode, soundFlavor, gaitRate, groundSpeed, rootPosture, description,
  loopBeats: 8, lookAtViewer: category === 'Face',
});
export const ROACH_MOTION_PRESETS = Object.freeze([
  preset('side_walk', 'Scuttle', 'Scuttle', 0, 'scuttle', 1.25, .28, 'low', 'Alternating tripod steps with quick returning feet.'),
  preset('side_run', 'Nervous run', 'Scuttle', 1, 'pitter', 3, .62, 'low', 'Fast tripod steps, fluttering feelers and a low body.'),
  preset('side_jump', 'Pogo jump', 'Dance', 2, 'stomp', .25, .03, 'jump', 'Crouch, lift all six feet, then land together every four beats.'),
  preset('top_wing_fan', 'Wing rustle', 'Wings', 3, 'wing', .25, 0, 'low', 'Paired wing covers open and flutter over a shifting stance.'),
  preset('top_body_wave', 'Carapace wave', 'Dance', 4, 'growl', .5, 0, 'low', 'A slow rolling wave crosses the shell and six legs.'),
  preset('top_flight', 'Takeoff flutter', 'Wings', 5, 'wing', .25, .05, 'flight', 'A repeating supported takeoff mime with tucked legs and moving covers.'),
  preset('bottom_wiggle', 'Leg noodles', 'Dance', 6, 'scrape', .75, 0, 'low', 'Six staggered loose curls and an abdomen wiggle.'),
  preset('bottom_shuffle', 'Side shuffle', 'Dance', 7, 'pitter', 1.5, .09, 'low', 'Quick side steps and a rocking shell.'),
  preset('bottom_rave', 'Bug rave', 'Dance', 8, 'metal', 2, 0, 'low', 'Syncopated leg fans with a fast body shimmy.'),
  preset('face_curious', "Who's there?", 'Face', 9, 'creak', .125, 0, 'low', 'Looks toward the viewer with asymmetric head tilts and searching feelers.'),
  preset('face_chatter', 'Kitchen gossip', 'Face', 10, 'voice', .25, 0, 'low', 'Syllabic head and neck nods with busy antennae.'),
  preset('face_sing', 'Crooner', 'Face', 11, 'voice', .25, 0, 'low', 'Long head bows with short nods and antenna flourishes.'),
  preset('side_skitter', 'Stop / go skitter', 'Scuttle', 12, 'scuttle', 1.5, .32, 'low', 'Nervous bursts accelerate into little rests without resetting phase.'),
  preset('side_tiptoe', 'Pitter patter', 'Scuttle', 13, 'pitter', 1, .14, 'low', 'Six individually staggered toe taps and a raised head.'),
  preset('side_backpedal', 'Reverse gear', 'Scuttle', 14, 'scrape', 1.25, -.23, 'low', 'Backwards tripod travel with backward-looking head turns.'),
  preset('side_zigzag', 'Zigzag panic', 'Scuttle', 15, 'scuttle', 2.25, .46, 'low', 'Rapid scuttles and sharp alternating body turns.'),
  preset('dance_upright', 'Back-leg boogie', 'Dance', 16, 'stomp', 1, 0, 'upright', 'Stands on the rear pair, stepping while four arms wave.'),
  preset('dance_boxer', 'Tiny shadow boxer', 'Dance', 17, 'growl', 1.5, 0, 'upright', 'Rear-leg footwork and alternating front-leg punches.'),
  preset('dance_can_can', 'Six-leg can-can', 'Dance', 18, 'metal', 1, 0, 'upright', 'High alternating kicks and a jaunty shell sway.'),
  preset('dance_robot', 'Broken robot', 'Dance', 19, 'metal', 1, 0, 'low', 'Rounded mechanical ticks, held poses and quick antenna snaps.'),
  preset('dance_waltz', 'Kitchen waltz', 'Dance', 20, 'pitter', .75, .04, 'upright', 'Six-beat rear-foot waltz with sweeping front arms.'),
  preset('wings_alarm', 'Alarm flutter', 'Wings', 21, 'wing', 2, .1, 'low', 'Rapid wing-cover tremolo over a frightened scuttle.'),
  preset('face_growl', 'Tiny house monster', 'Face', 22, 'growl', .25, 0, 'low', 'A low shell growl, threatening head dips and spiky feelers.'),
  preset('face_serenade', 'Antenna serenade', 'Face', 23, 'voice', .125, 0, 'low', 'Direct-address head phrases and wide fluttering antenna arcs.'),
]);
const POSE_ONLY = preset('none', 'Pose / joint score only', 'Pose', -1, 'creak', 0, 0, 'low', 'Manual offsets, enabled joint oscillators and the joint score.');
const PRESETS_BY_ID = new Map(ROACH_MOTION_PRESETS.map((item) => [item.id, item]));
const EMPTY_TRACKS = Object.freeze([]);
export const ROACH_MOTION_DEFAULTS = Object.freeze({
  presetId: 'side_walk', tempo: 108, intensity: 1, antennae: true,
  sequenceEnabled: false, tracks: EMPTY_TRACKS, stepBeats: .25, gaze: Object.freeze({ x: 0, y: 0, z: 0 }),
});

export function createRoachJointTrack(jointId, axis = 'x', steps = []) {
  return {
    jointId: String(jointId ?? '').slice(0, 120),
    axis: ['x', 'y', 'z'].includes(axis) ? axis : 'x',
    steps: Array.from({ length: ROACH_SEQUENCE_STEPS }, (_, i) => clamp(finite(steps?.[i]), -90, 90)),
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
    tracks.push(track);
  }
  return {
    presetId: source.presetId === 'none' || PRESETS_BY_ID.has(source.presetId) ? source.presetId : ROACH_MOTION_DEFAULTS.presetId,
    tempo: clamp(finite(source.tempo, 108), 30, 240),
    intensity: clamp(finite(source.intensity, 1), 0, 2),
    antennae: source.antennae !== false,
    sequenceEnabled: source.sequenceEnabled === true,
    tracks,
    stepBeats: clamp(finite(source.stepBeats, .25), 1 / 16, 4),
    gaze: { x: clamp(finite(source.gaze?.x), -22, 22), y: clamp(finite(source.gaze?.y), -22, 22), z: clamp(finite(source.gaze?.z), -22, 22) },
  };
}
/** Camera changes never select or sequence an animation. */
export function activeRoachPreset(_timeSeconds, settings = ROACH_MOTION_DEFAULTS) {
  return settings?.presetId === 'none' ? POSE_ONLY : PRESETS_BY_ID.get(settings?.presetId) ?? ROACH_MOTION_PRESETS[0];
}
export function roachSequencePosition(timeSeconds, settings = ROACH_MOTION_DEFAULTS) {
  const position = beatsAt(timeSeconds, settings) / clamp(finite(settings?.stepBeats, .25), 1 / 16, 4);
  return { step: Math.floor(position) % ROACH_SEQUENCE_STEPS, fraction: position % 1, length: ROACH_SEQUENCE_STEPS };
}
function scoreValue(track, position) {
  const step = Math.floor(position) % ROACH_SEQUENCE_STEPS;
  const mix = smooth(position % 1);
  const from = clamp(finite(track.steps?.[step]), -90, 90);
  return from + (clamp(finite(track.steps?.[(step + 1) % ROACH_SEQUENCE_STEPS]), -90, 90) - from) * mix;
}
const JOINT_METADATA = new WeakMap();
function metadata(joint) {
  let item = JOINT_METADATA.get(joint);
  if (item) return item;
  const name = String(joint.jointId || joint.name || '').toLowerCase();
  const leg = /front/.test(name) ? 0 : /hind/.test(name) ? 2 : 1;
  const side = /right/.test(name) ? -1 : 1;
  const isLeg = /leg|proximal|distal|middle_|front_|hind_/.test(name) && !/body|abdomen/.test(name);
  const kind = /antenna/.test(name) ? 'antenna' : isLeg ? 'leg' : /wing/.test(name) ? 'wings'
    : /abdomen/.test(name) ? 'abdomen' : /neck|pronotum/.test(name) ? 'neck' : /head/.test(name) ? 'head'
      : /body|thorax/.test(name) ? 'body' : 'other';
  item = { kind, side, leg, footIndex: leg * 2 + (side < 0 ? 1 : 0),
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
const TRIPOD_PHASES = Object.freeze([0, .5, .5, 0, 0, .5]);
const SCORE_FOOT_VALUES = Array.from({ length: 6 }, () => new Float64Array(ROACH_SEQUENCE_STEPS));
function writeScoreFeet(beats, controls, joints, out, intensity) {
  for (const values of SCORE_FOOT_VALUES) values.fill(0);
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
    const values = SCORE_FOOT_VALUES[item.footIndex];
    for (let step = 0; step < ROACH_SEQUENCE_STEPS; step += 1) values[step] += clamp(finite(track.steps?.[step]), -90, 90);
  }
  if (!any) return;
  const position = beats / clamp(finite(controls.stepBeats, .25), 1 / 16, 4);
  const lap = Math.floor(position / ROACH_SEQUENCE_STEPS);
  const local = positiveMod(position, ROACH_SEQUENCE_STEPS);
  const step = Math.floor(local);
  for (let footIndex = 0; footIndex < 6; footIndex += 1) {
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
    body.roll = Math.sin(phase * (mode === 1 ? 1.5 : .5)) * (mode === 8 ? 7 : mode === 7 ? 5 : 1.2) * intensity;
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
    foot.lift = foot.stance ? 0 : Math.sin(swing * Math.PI);
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
function addPreset(beats, item, mode, amount, out, index, antennae, scene) {
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
    if (mode === 3) { y = 8 * (1 - Math.cos(phase * .5)); x = Math.sin(phase * 4) * 3; }
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
    } else if (mode === 22) { x = 4 + Math.sin(phase * .5) * 10; y = Math.sin(phase * .25) * 13; z = Math.sin(phase * 4) * 2; }
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
    else addPreset(positiveMod(beats, 8), item, current.mode, intensity, out, index, antennae, scene);
    // Camera-derived gaze is published as motion state, so DSP receives the same head pose.
    if (item.kind === 'head') {
      out[index] += clamp(finite(controls.gaze?.x), -22, 22);
      out[index + 1] += clamp(finite(controls.gaze?.y), -22, 22);
      out[index + 2] += clamp(finite(controls.gaze?.z), -22, 22);
    }
    for (let trackIndex = 0; trackIndex < Math.min(tracks.length, ROACH_MAX_JOINT_TRACKS); trackIndex += 1) {
      const track = tracks[trackIndex];
      if (!track || track.enabled === false || (track.jointId !== joint.id && track.jointId !== joint.jointId)) continue;
      const axis = track.axis === 'y' ? 1 : track.axis === 'z' ? 2 : 0;
      out[index + axis] += scoreValue(track, scorePosition);
    }
    out[index] = clamp(out[index], -180, 180); out[index + 1] = clamp(out[index + 1], -180, 180); out[index + 2] = clamp(out[index + 2], -180, 180);
  }
  return out;
}
