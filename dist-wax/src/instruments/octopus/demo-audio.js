import { createDemoHold, createDemoVoices } from '../../families/rig-lab/demo-audio-utils.js';

/** Invented mantle exciter and eight length-dependent pluck resonators. */
export function createOctopusDemoAudio(context, destination) {
  const voices = createDemoVoices(context, destination, { maxVoices: 11, seed: 0x0c70c05 });
  const hold = createDemoHold(context, destination);
  return {
    mantle(pose, at = context.currentTime) {
      voices.hit({ hz: 114 + pose.pressure * 104, gain: 0.063, at,
        duration: 0.49, noise: 0.065, cutoff: 670 + pose.pressure * 2200, type: 'triangle' });
    },
    arm(pose, id = pose.selected, at = context.currentTime) {
      const value = pose.arms[id];
      if (!value) return;
      voices.hit({ hz: value.frequency, gain: 0.051, at,
        duration: Math.min(0.95, 0.19 + value.length * 0.31),
        pan: value.pan, noise: 0.032 + Math.abs(value.curl) * 0.052,
        cutoff: 1150 + Math.abs(value.curl) * 2900 });
    },
    hold(pose) {
      const value = pose.arms[pose.selected];
      hold.update({ hz: value.frequency, pan: value.pan, brightness: Math.abs(value.curl),
        level: 0.023 + pose.pressure * 0.015 });
    },
    silence: () => hold.silence(),
    dispose() { hold.dispose(); voices.dispose(); },
    get activeVoices() { return voices.activeVoices; },
  };
}
