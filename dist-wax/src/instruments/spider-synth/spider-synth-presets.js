import { presetStateKey } from '../../site/header-presets.js';
import { SPIDER_SPECIMENS } from './spider-synth-specimens.js?v=76d726f095e2';
import { SPIDER_MOTION_PRESETS, normalizeSpiderMotion, createRandomSpiderMotion } from './spider-synth-model.js?v=76d726f095e2';
import { SPIDER_SOUND_PRESETS, SPIDER_BODY_GROUPS, normalizeSpiderSound, normalizeSpiderBodyMix, createRandomSpiderSound } from './spider-synth-dsp.js?v=76d726f095e2';
import { SPIDER_WEB_PARAMETERS, normalizeSpiderWeb } from './spider-synth-web.js?v=76d726f095e2';
import { SPIDER_TRAVEL_PATHS, normalizeSpiderWorld } from './spider-synth-world.js?v=76d726f095e2';
import { SPIDER_SPEECH_DEFAULTS, SPIDER_SPEECH_PRESETS } from './spider-synth-speech.js?v=76d726f095e2';

// Output gains, text, transport, devices, clocks and active gestures belong to
// the performer. These snapshots own the editable musical scene only.
export function captureSpiderPreset(state) {
  const { level, voice, ...sound } = normalizeSpiderSound(state.sound);
  const { playing, joystick, hunt, ...worldSettings } = normalizeSpiderWorld(state.worldSettings);
  const groups = value => [...new Set(value ?? [])].filter(id => SPIDER_BODY_GROUPS.some(group => group.id === id)).sort();
  return {
    version: 1, specimen: state.specimenChoice ?? state.specimen,
    motionChoice: state.motionChoice, motion: normalizeSpiderMotion(state.motion),
    webSettings: normalizeSpiderWeb(state.webSettings), worldSettings,
    sound, bodyMix: normalizeSpiderBodyMix(state.bodyMix), muted: groups(state.muted), solo: groups(state.solo),
    speech: { ...state.speech }, metronome: state.metronome === true, flyOnSelect: state.flyOnSelect === true,
  };
}
export function validateSpiderPreset(value) {
  if (value?.version !== 1 || !SPIDER_SPECIMENS.some(p => p.id === value.specimen)
    || ![...SPIDER_MOTION_PRESETS.map(p => p.id), 'random'].includes(value.motionChoice)
    || value.motion?.specimen !== value.specimen
    || !SPIDER_SPEECH_PRESETS.some(p => p.id === value.speech?.preset)
    || !['rate', 'pitch', 'range'].every(key => Number.isFinite(value.speech[key]))) throw new Error('Invalid Spider preset.');
  const normalized = captureSpiderPreset(value);
  if (presetStateKey(normalized) !== presetStateKey(value)) throw new Error('Incomplete or out-of-range Spider preset.');
  return structuredClone(normalized);
}
// Four authored performances per skin. The sound patches retain their actual
// string materials and envelopes. Body motion stays prominent alongside silk.
// Routes are authored separately from the limb choreography: dances can roam.
// path, speed, range, laySilk, flyOnSelect
const SCENES = [
  ['Morning weaver', 'orb-walk', 'orb-silk', 108, 'spiral', 1.2, 0.64, true, false],
  ['Amber harp', 'silk-harp', 'harpist', 76, 'orbit', 0.85, 0.5, false, false],
  ['Tiny tap shoes', 'tap-dance', 'clockwork', 138, 'hold', 0.65, 0.45, false, false],
  ['Wasp waltz', 'web-waltz', 'tiny-bells', 96, 'figure8', 1.1, 0.62, false, true],
  ['Golden hour', 'wave-walk', 'silver-spokes', 84, 'patrol', 1.4, 0.68, false, false],
  ['Sunlit glass', 'spiral-dance', 'glass-orbit', 112, 'spiral', 1.3, 0.62, true, false],
  ['Spiral arpeggio', 'triplet-pluck', 'porcelain', 126, 'orbit', 1.25, 0.74, true, false],
  ['Gilded leap', 'long-leap', 'sliding-crystal', 92, 'radial', 1.1, 0.64, false, false],
  ['Devil at midnight', 'slow-stalk', 'dry-frame', 62, 'patrol', 1.5, 0.62, false, true],
  ['Copper fangs', 'palp-boxing', 'electric-silk', 142, 'hold', 0.65, 0.45, false, false],
  ['Devil disco', 'disco', 'seed-web', 120, 'random', 1.1, 0.64, false, false],
  ['Red thread', 'silk-reel', 'low-courtship', 88, 'radial', 1.4, 0.65, true, false],
  ['Velvet steps', 'tiptoe', 'gut-shadow', 74, 'figure8', 1.5, 0.62, false, false],
  ['Baboon drummer', 'abdomen-drum', 'peacock-percussion', 118, 'hold', 0.65, 0.45, false, false],
  ['Heavy silk', 'pushups', 'thread-bass', 80, 'spiral', 1.25, 0.6, true, false],
  ['Tarantula tango', 'stutter-step', 'tremor-drum', 104, 'patrol', 1.1, 0.62, false, false],
  ['Sideways hunter', 'side-step', 'palp-serenade', 116, 'radial', 1.45, 0.68, true, true],
  ['Eight-arm shuffle', 'macarena', 'night-radio', 128, 'hold', 0.65, 0.45, false, false],
  ['Huntsman sprint', 'radial-run', 'dry-frame', 156, 'radial', 1.8, 0.76, false, true],
  ['Pounce and ring', 'prey-pounce', 'peacock-courtship', 94, 'figure8', 1.1, 0.6, false, true],
  ['Water silk', 'creep-circle', 'silk-river', 82, 'spiral', 1.25, 0.68, true, false],
  ['Raindrop reel', 'cross-pluck', 'rain-on-silk', 106, 'figure8', 1.4, 0.68, true, false],
  ['Silver moonwalk', 'moonwalk', 'sliding-crystal', 110, 'patrol', 1.3, 0.66, false, false],
  ['Fishing for stars', 'tether-bounce', 'tiny-bells', 90, 'orbit', 1.2, 0.62, false, true],
];
export const SPIDER_FULL_PRESETS = Object.freeze(SCENES.map(([label, motionChoice, soundId, tempo, path, speed, range, laySilk, flyOnSelect], index) => {
  const specimen = SPIDER_SPECIMENS[Math.floor(index / 4)].id;
  const patch = SPIDER_SOUND_PRESETS.find(p => p.id === soundId);
  const motionPreset = SPIDER_MOTION_PRESETS.find(p => p.id === motionChoice);
  const snapshot = captureSpiderPreset({
    specimen, motionChoice, motion: normalizeSpiderMotion({ specimen, preset: motionChoice, tempo, intensity: .48 + (index % 4) * .12 }),
    sound: { ...patch.sound, space: Math.min(.55, patch.sound.space) },
    bodyMix: patch.bodyMix.map((row, i) => ({ ...row, level: Math.min(1, row.level * (i < 6 ? 1.5 : 1)) })),
    webSettings: patch.webSettings, worldSettings: { ...motionPreset.world, path, speed, range, laySilk, seed: index + 1 },
    speech: SPIDER_SPEECH_DEFAULTS, muted: [], solo: [], metronome: false, flyOnSelect,
  });
  return Object.freeze({ id: `${specimen}-${index % 4 + 1}`, label, snapshot: validateSpiderPreset(snapshot) });
}));
export function randomizeSpiderPreset(previous, random = Math.random) {
  const r = () => Math.max(0, Math.min(.999999, Number(random()) || 0));
  const pick = list => list[Math.floor(r() * list.length)];
  const seed = Math.floor(r() * 0xffffffff), patch = createRandomSpiderSound(seed);
  const specimen = pick(SPIDER_SPECIMENS).id;
  const motion = normalizeSpiderMotion(createRandomSpiderMotion(seed, {
    specimen, tempo: 55 + Math.round(r() * 140), intensity: .35 + r() * .65,
    center: { x: (r() - .5) * .2, z: (r() - .5) * .2 }, explore: r() > .2,
  }));
  const webSettings = { ...patch.webSettings, tension: .5 + r() * 2 };
  for (const { key, min, max, step } of SPIDER_WEB_PARAMETERS) webSettings[key] = min + Math.round(r() * (max - min) / step) * step;
  const ids = SPIDER_BODY_GROUPS.map(group => group.id);
  const muted = ids.filter(() => r() < .1), solo = r() < .15 ? [pick(ids)] : [];
  // Random mute/solo states must leave at least one audible assignment.
  if (solo.length && muted.includes(solo[0])) muted.splice(muted.indexOf(solo[0]), 1);
  if (muted.length === ids.length) muted.splice(Math.floor(r() * muted.length), 1);
  return validateSpiderPreset(captureSpiderPreset({
    specimen, motionChoice: motion.preset, motion, webSettings,
    worldSettings: { path: pick(SPIDER_TRAVEL_PATHS).id, speed: r() * 2, range: r() * .85, laySilk: r() < .2, seed },
    sound: patch.sound, bodyMix: patch.bodyMix, muted, solo,
    speech: { preset: pick(SPIDER_SPEECH_PRESETS).id, rate: 120 + Math.round(r() * 200), pitch: Math.round(r() * 99), range: Math.round(r() * 99) },
    metronome: r() < .15, flyOnSelect: r() < .25,
  }));
}
