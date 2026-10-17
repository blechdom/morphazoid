import { normalizeRoachMotion, ROACH_ANIMATION_PRESETS, createRandomRoachMotion } from './roach-synth-motion.js';
import { normalizeRoachSound, getRoachMotionSound, createRandomRoachSound } from './roach-synth-dsp.js';
import { clonePresetData, presetRandom } from '../../site/preset-random.js';

// Output levels, Audio, Drone Play, devices and clocks stay live. Camera,
// words, joint offsets, motion curves and sonification belong to the full scene.
export function captureRoachPreset(state, soundPreset) {
  const { gaze, ...motion } = normalizeRoachMotion(state.motion);
  const { level, voice, ...sound } = normalizeRoachSound(state.sound);
  return clonePresetData({
    playing: state.playing, motionChoice: state.motionChoice, motionPrepared: state.motionPrepared,
    posePreset: state.posePreset, motion, soundPreset, sound,
    view: ['side', 'top', 'bottom', 'face'].includes(state.view) ? state.view : 'side',
    side: state.side === 'right' ? 'right' : 'left', camera: state.camera ?? null,
    phrase: String(state.phrase ?? "hi, I'm a cockroach and I live in your house").slice(0, 96),
    joints: state.joints.map(({ id, offset, motion }) => ({ id, offset, motion })),
    bodyMix: state.bodyMix, muted: [...state.muted].sort(), solo: [...state.solo].sort(),
  });
}

export function createRoachFullPresets(joints) {
  const rest = joints.map(joint => ({ ...joint, offset: { x: 0, y: 0, z: 0 }, motion: { ...joint.motion, enabled: false } }));
  return ROACH_ANIMATION_PRESETS.map(item => {
    const soundId = item.sourcePresetId ?? item.id;
    const patch = getRoachMotionSound(soundId);
    return { id: item.id, label: item.label, description: item.description,
      snapshot: captureRoachPreset({ playing: true, motionChoice: item.id, motionPrepared: true,
        posePreset: 'custom', motion: normalizeRoachMotion({ presetId: item.id, antennae: true }),
        joints: rest, sound: patch.sound, bodyMix: patch.bodyMix, muted: new Set(), solo: new Set(),
        view: item.category === 'Face' ? 'face' : /wing/.test(item.id) ? 'top' : item.id.startsWith('bottom_') ? 'bottom' : 'side',
        side: 'left',
      }, `motion:${soundId}`),
    };
  });
}

export function randomizeRoachPreset(current, joints, random = Math.random) {
  const rng = presetRandom(random), seed = rng.integer(1, 0xffffffff);
  const patch = createRandomRoachSound(seed);
  const next = clonePresetData(current);
  next.playing = true; next.motionChoice = 'random'; next.motionPrepared = true; next.posePreset = 'custom';
  const { gaze, ...motion } = createRandomRoachMotion(seed, joints, {
    tempo: rng.integer(35, 240), intensity: rng.between(.35, 1.5), antennae: true,
  });
  next.motion = motion;
  const { level, voice, ...sound } = patch.sound;
  for (const key of ['hiss', 'shell', 'wing', 'feet', 'growl', 'drone', 'zing', 'samples']) sound[key] = rng.between(.08, .8);
  next.sound = sound; next.soundPreset = 'custom'; next.bodyMix = patch.bodyMix;
  next.joints = next.joints.map(joint => ({ ...joint, offset: { x: 0, y: 0, z: 0 }, motion: { ...joint.motion, enabled: false } }));
  next.muted = []; next.solo = [];
  next.view = rng.pick(['side', 'top', 'bottom', 'face']); next.side = rng.pick(['left', 'right']);
  next.camera = null;
  next.phrase = rng.pick(['I live behind your cupboard.', 'Six feet, four wings, one tiny voice.',
    'The kitchen is mine tonight.', 'I heard a crumb calling my name.', 'You cannot catch this little roach.']);
  return next;
}
