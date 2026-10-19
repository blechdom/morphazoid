import { createDemoHold, createDemoVoices } from '../../families/rig-lab/demo-audio-utils.js';

export function createLatticeDemoAudio(context, destination) {
  const voices = createDemoVoices(context, destination, { maxVoices: 12, seed: 0x1a771ce });
  const hold = createDemoHold(context, destination, 'triangle');
  return {
    pluck(pose, index = pose.selected, at = context.currentTime) {
      voices.hit({ hz: pose.frequencies[index], at, gain: 0.047,
        duration: Math.max(0.15, 0.49 - pose.strain * 0.25),
        pan: pose.nodes[index][0] * 0.52, cutoff: 1500 + pose.strain * 4200,
        noise: 0.065 + pose.strain * 0.1, type: 'triangle' });
    },
    hold(pose) {
      hold.update({ hz: pose.frequencies[pose.selected],
        brightness: 0.2 + pose.strain * 3, pan: pose.nodes[pose.selected][0] * 0.6,
        level: 0.027 + pose.strain * 0.12 });
    },
    silence: () => hold.silence(),
    dispose() { hold.dispose(); voices.dispose(); },
    get activeVoices() { return voices.activeVoices; },
  };
}
