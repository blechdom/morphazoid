import { createDemoVoices, makeNoise } from '../../families/rig-lab/demo-audio-utils.js';

/** Procedural skillet sizzle, impact and adhesive peel: no kitchen recordings. */
export function createPancakeDemoAudio(context, destination) {
  const voices = createDemoVoices(context, destination, { maxVoices: 10, seed: 0xc001cae });
  const sizzle = context.createBufferSource();
  sizzle.buffer = makeNoise(context, 0.43, 0xb077e1);
  sizzle.loop = true;
  const filter = context.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 0.65;
  const level = context.createGain();
  level.gain.value = 0;
  sizzle.connect(filter).connect(level).connect(destination);
  sizzle.start();
  let disposed = false;
  function update(pose) {
    if (disposed) return;
    filter.frequency.setTargetAtTime(650 + pose.heat * 4100, context.currentTime, 0.06);
    level.gain.setTargetAtTime(pose.sizzle * 0.065, context.currentTime, 0.04);
  }
  function silence() {
    if (!disposed) level.gain.setTargetAtTime(0, context.currentTime, 0.03);
  }
  return {
    update, silence,
    land({ at = context.currentTime, syrup = 0, speed = 0.6 } = {}) {
      const strength = Math.min(1, Math.max(0.15, speed));
      voices.hit({ hz: 115 - syrup * 34, at, gain: (0.045 + strength * 0.032) * (1 - syrup * 0.27),
        duration: 0.21 + syrup * 0.18, noise: 0.06, cutoff: 2100 - syrup * 1100, type: 'triangle' });
      voices.hit({ hz: 261 - syrup * 70, at: at + 0.006, gain: 0.025 * strength,
        duration: 0.28, noise: 0.03, cutoff: 1600 });
    },
    stack({ at = context.currentTime, syrup = 0, layer = 0 } = {}) {
      voices.hit({ hz: 195 - Math.min(5, layer) * 14, at,
        gain: 0.041 * (1 - syrup * 0.24), duration: 0.17 + syrup * 0.12,
        noise: 0.047, cutoff: 1700 - syrup * 500, type: 'triangle' });
    },
    scoop({ at = context.currentTime } = {}) {
      voices.hit({ hz: 375, at, gain: 0.022, duration: 0.16, noise: 0.085, cutoff: 2600 });
    },
    scrape(tilt) {
      voices.hit({ hz: 345 + Math.abs(tilt) * 6, gain: 0.018, duration: 0.13,
        noise: 0.11, cutoff: 1750 + Math.abs(tilt) * 80 });
    },
    peel(syrup, at = context.currentTime) {
      voices.hit({ hz: 155 + syrup * 95, at, gain: 0.045, duration: 0.22 + syrup * 0.32,
        noise: 0.1, cutoff: 1100 + syrup * 800 });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      try { sizzle.stop(); } catch { /* Already stopped. */ }
      sizzle.disconnect(); filter.disconnect(); level.disconnect();
      voices.dispose();
    },
    get activeVoices() { return voices.activeVoices; },
  };
}
