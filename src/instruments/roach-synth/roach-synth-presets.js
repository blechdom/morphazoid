import { normalizeRoachMotion, ROACH_MOTION_PRESETS, createRandomRoachMotion } from './roach-synth-motion.js';
import { normalizeRoachSound, getRoachMotionSound, createRandomRoachSound } from './roach-synth-dsp.js';
import { clonePresetData, presetRandom } from '../../site/preset-random.js';

// Gaze, output levels, Audio, Sound Play, devices and clocks belong to the live
// performance. Joint offsets and complete motion curves belong to the scene.
export function captureRoachPreset(state, soundPreset) {
  const { gaze, ...motion } = normalizeRoachMotion(state.motion);
  const { level, voice, ...sound } = normalizeRoachSound(state.sound);
  return clonePresetData({
    playing: state.playing, motionChoice: state.motionChoice, motionPrepared: state.motionPrepared,
    posePreset: state.posePreset, motion, soundPreset, sound,
    joints: state.joints.map(({ id, offset, motion }) => ({ id, offset, motion })),
    bodyMix: state.bodyMix, muted: [...state.muted].sort(), solo: [...state.solo].sort(),
  });
}

export function createRoachFullPresets(joints) {
  const rest = joints.map(joint => ({ ...joint, offset: { x: 0, y: 0, z: 0 }, motion: { ...joint.motion, enabled: false } }));
  return ROACH_MOTION_PRESETS.map(item => {
    const patch = getRoachMotionSound(item.id);
    return { id: item.id, label: item.label, description: item.description,
      snapshot: captureRoachPreset({ playing: true, motionChoice: item.id, motionPrepared: true,
        posePreset: 'custom', motion: normalizeRoachMotion({ presetId: item.id, antennae: true }),
        joints: rest, sound: patch.sound, bodyMix: patch.bodyMix, muted: new Set(), solo: new Set(),
      }, `motion:${item.id}`),
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
  return next;
}
