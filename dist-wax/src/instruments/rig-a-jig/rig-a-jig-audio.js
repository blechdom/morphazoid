import { createDemoVoices } from '../../families/rig-lab/demo-audio-utils.js';

const BASE = {
  spider: { hz: 96, type: 'sine', noise: 0.2, cutoff: 900 },
  ant: { hz: 130, type: 'sine', noise: 0.18, cutoff: 1100 },
  centipede: { hz: 85, type: 'sine', noise: 0.22, cutoff: 700 },
  scorpion: { hz: 75, type: 'sine', noise: 0.3, cutoff: 600 },
  fish: { hz: 210, type: 'triangle', noise: 0.08, cutoff: 1600 },
  jellyfish: { hz: 180, type: 'sine', noise: 0.05, cutoff: 1300 },
  octopus: { hz: 140, type: 'triangle', noise: 0.12, cutoff: 1200 },
  crab: { hz: 110, type: 'square', noise: 0.2, cutoff: 1000 },
  bat: { hz: 330, type: 'triangle', noise: 0.1, cutoff: 2600 },
  bird: { hz: 420, type: 'triangle', noise: 0.06, cutoff: 3000 },
  butterfly: { hz: 520, type: 'sine', noise: 0.05, cutoff: 3400 },
  dragonfly: { hz: 640, type: 'sine', noise: 0.04, cutoff: 4000 },
  snake: { hz: 160, type: 'sine', noise: 0.1, cutoff: 1200 },
  caterpillar: { hz: 150, type: 'sine', noise: 0.12, cutoff: 1100 },
  worm: { hz: 120, type: 'sine', noise: 0.14, cutoff: 900 },
  walker: { hz: 120, type: 'sine', noise: 0.18, cutoff: 1000 },
  horse: { hz: 90, type: 'sine', noise: 0.25, cutoff: 800 },
  cat: { hz: 140, type: 'sine', noise: 0.1, cutoff: 1300 },
  dog: { hz: 115, type: 'sine', noise: 0.16, cutoff: 1100 },
  frog: { hz: 200, type: 'triangle', noise: 0.2, cutoff: 1500 },
  kangaroo: { hz: 100, type: 'sine', noise: 0.28, cutoff: 900 },
  crane: { hz: 300, type: 'triangle', noise: 0.08, cutoff: 2000 },
  giraffe: { hz: 110, type: 'sine', noise: 0.12, cutoff: 1000 },
  scorpionTail: { hz: 240, type: 'square', noise: 0.26, cutoff: 1800 },
  whip: { hz: 260, type: 'square', noise: 0.16, cutoff: 2200 },
  random: { hz: 160, type: 'triangle', noise: 0.15, cutoff: 1500 },
  mocap: { hz: 140, type: 'sine', noise: 0.18, cutoff: 1200 },
  striker: { hz: 180, type: 'sine', noise: 0.3, cutoff: 1400 },
};

/** One bounded modal contact voice per rig. Sound comes only from joint
 * contacts/angles — there is no mesh to scrape. */
export function createRigAJigAudio(context, destination) {
  const bus = context.createGain();
  bus.gain.value = 0;
  bus.connect(destination);
  const voices = createDemoVoices(context, bus, { maxVoices: 24 });
  let selected = false, disposed = false;

  function setSelected(value) {
    selected = Boolean(value);
    if (!disposed) bus.gain.setTargetAtTime(selected ? 1 : 0, context.currentTime, 0.02);
  }

  function contact(rigId, settings, {
    index = 0, strength = 0.6, pan = 0, at = context.currentTime,
  } = {}) {
    if (disposed || !selected) return false;
    const base = BASE[rigId] ?? BASE.spider;
    const rate = Math.max(0.05, Number(settings.rate) || 0.3);
    const amp = Math.max(0, Number(settings.amp) || 0.5);
    const spread = 1 + (index % 6) * 0.1;
    return voices.hit({
      hz: base.hz * spread * (0.8 + amp * 0.5),
      at,
      gain: 0.02 + strength * 0.055,
      duration: 0.1 + 0.14 / Math.max(0.1, rate),
      pan,
      noise: base.noise,
      type: base.type,
      cutoff: base.cutoff * (0.7 + amp * 0.7),
    });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    voices.dispose?.();
    bus.disconnect();
  }
  return { setSelected, contact, dispose };
}
