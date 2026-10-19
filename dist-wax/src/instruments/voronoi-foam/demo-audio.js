import { createDemoHold, createDemoVoices } from '../../families/rig-lab/demo-audio-utils.js';

export function createFoamDemoAudio(context, destination) {
  const voices = createDemoVoices(context, destination, { maxVoices: 10, seed: 0xf0a4d });
  const hold = createDemoHold(context, destination);
  return {
    hit(cell, at = context.currentTime) {
      if (!cell) return;
      voices.hit({ hz: cell.frequency, at,
        duration: Math.min(0.85, 0.21 + cell.volume * 0.25),
        gain: 0.055, pan: cell.center[0] * 0.58, cutoff: 970 + 1100 / Math.max(cell.volume, 0.25),
        noise: 0.06 });
    },
    hold(cell) {
      if (cell) hold.update({ hz: cell.frequency, brightness: 0.25 + 0.3 / Math.max(cell.volume, 0.3),
        pan: cell.center[0] * 0.6, level: 0.047 });
    },
    silence: () => hold.silence(),
    dispose() { hold.dispose(); voices.dispose(); },
    get activeVoices() { return voices.activeVoices; },
  };
}
