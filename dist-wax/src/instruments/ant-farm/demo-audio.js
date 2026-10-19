import { createDemoVoices } from '../../families/rig-lab/demo-audio-utils.js';
import { chamberTone } from './demo-model.js';

/** Amplified imaginary substrate contacts; no animal recording. */
export function createAntDemoAudio(context, destination) {
  const voices = createDemoVoices(context, destination, { maxVoices: 12, seed: 0xa171d });
  return {
    foot(id, ant, at) {
      voices.hit({ hz: 265 + id * 49, at, gain: 0.012, duration: 0.077,
        pan: ant.position[0] * 0.55, cutoff: 1750, noise: 0.055, type: 'triangle' });
    },
    chamber(id, size, at = context.currentTime) {
      voices.hit({ hz: chamberTone(size, id), at, gain: 0.063, duration: 0.63,
        pan: id ? 0.45 : -0.45, noise: 0.045, cutoff: 2150, type: 'sine' });
    },
    gate() {
      voices.hit({ hz: 480, gain: 0.027, duration: 0.085, noise: 0.09, cutoff: 2350 });
    },
    silence() {},
    dispose: () => voices.dispose(),
    get activeVoices() { return voices.activeVoices; },
  };
}
