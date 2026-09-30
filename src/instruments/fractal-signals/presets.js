import { USER_PRESET_RECORDS } from './user-presets.js';
import { targetsForMode, MODULATOR_SHAPES, modulatorTargetAvailable } from './modulators.js';
import { PARAMS, ENGINE_OPTIONS, createDefaultState, sanitizeState, generateStructure } from './model.js';

const scene = (mode, id, label, description, values) => Object.freeze({
  id: `${mode}-${id}`, label, description,
  snapshot: Object.freeze(sanitizeState({ ...createDefaultState(mode), ...values, mode })),
});

// Stable mixing keeps the menu varied without moving entries on every visit.
function presetOrderKey(id) {
  let hash = 2166136261 ^ 17491;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  hash = Math.imul(hash ^ (hash >>> 16), 2246822507);
  hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
  return (hash ^ (hash >>> 16)) >>> 0;
}

export const FACTORY_PRESETS = Object.freeze([
  ...USER_PRESET_RECORDS.map(record => scene(record.snapshot.mode, `user-${record.id}`, record.label, 'A complete sound and phrase setting.', record.snapshot)),
  scene('wander', 'thread-plucks', 'Thread plucks', 'Clear midrange plucks, a few quick answers, then space.', { engine: 'pluck', seed: 17491, base: 440, rate: 4.5, phrase: 8, span: 1.3, index: 1.4, ratio: 1.37, depth: 5, roughness: .45, branch: .72, memory: .08, attack: .002, decay: .035, sustain: .04, release: .045, glide: 0, chaos: .08, space: .28, x: .45, y: .55, direction: 1, synthesis: 'pm' }),
  scene('wander', 'glass-needles', 'Glass needles', 'High additive pinpricks thread through irregular fast phrases.', { engine: 'additive', seed: 67319, base: 980, rate: 7.7, phrase: 11, span: 1.9, index: .7, ratio: 2.61, depth: 7, roughness: .63, branch: .86, memory: .05, attack: .0006, decay: .024, sustain: .02, release: .033, glide: .002, chaos: .21, space: .48, x: .82, y: .64, direction: -1, synthesis: 'pm' }),
  scene('wander', 'bent-wire', 'Bent wire', 'Short voiced bends cross a winding path, with clear breaths between calls.', { engine: 'cascade', seed: 59021, base: 375, rate: 2.8, phrase: 9, span: 2.7, index: 3.7, ratio: 1.13, depth: 6, roughness: .28, branch: .38, memory: .23, attack: .025, decay: .15, sustain: .35, release: .14, glide: .18, chaos: .46, space: .43, x: .29, y: .84, direction: 1, synthesis: 'pm' }),
  scene('wander', 'broken-ruler', 'Broken ruler', 'Stretched additive fragments rattle in a fast, off-center phrase.', { engine: 'additive', seed: 31583, base: 910, rate: 13.3, phrase: 19, span: 3.2, index: 1.9, ratio: 5.27, depth: 11, roughness: 1.28, branch: 1.41, memory: .03, attack: .0002, decay: .011, sustain: 0, release: .017, glide: .004, chaos: .91, space: .74, x: .66, y: .91, direction: 1, synthesis: 'fm' }),
  scene('wander', 'copper-zip', 'Copper zip', 'Very fast FM scraps tear across a wide frequency path.', { engine: 'cascade', seed: 19763, base: 320, rate: 28, phrase: 13, span: 3.7, index: 9.2, ratio: 2.73, depth: 12, roughness: 1.53, branch: 1.8, memory: .01, attack: .0002, decay: .005, sustain: .01, release: .008, glide: .002, chaos: 1.25, space: .39, x: .87, y: .94, direction: 1, synthesis: 'fm' }),

  scene('grammar', 'twig-talk', 'Twig talk', 'Dry plucked generations answer their parent from left to right.', { engine: 'pluck', seed: 17713, base: 390, rate: 5.2, depth: 6, branch: .86, turns: 1.25, generationLoss: .18, span: 1.7, index: 1.8, ratio: 1.37, roughness: .3, memory: .12, attack: .001, decay: .04, sustain: .08, release: .06, phrase: 8, space: .31, x: .58, y: .56, direction: 1, synthesis: 'pm' }),
  scene('grammar', 'tangled-bells', 'Tangled bells', 'Wide forks ring with inharmonic tails and strong upper generations.', { engine: 'bell', seed: 61603, base: 662, rate: 6.6, depth: 8, branch: 1.39, turns: 2.7, generationLoss: .08, span: 2.85, index: 3.4, ratio: 2.83, roughness: .49, memory: .46, attack: .001, decay: .32, sustain: .1, release: .52, phrase: 19, space: .76, x: .95, y: .66, direction: -1, synthesis: 'fm' }),
  scene('grammar', 'reed-switches', 'Reed switches', 'Quick high plucks follow many fine, curling branches.', { engine: 'pluck', seed: 26731, base: 1190, rate: 24, depth: 12, branch: 2.2, turns: 7.7, generationLoss: .06, span: 3.1, index: 6.2, ratio: 1.91, roughness: 1.32, memory: .04, attack: .0004, decay: .008, sustain: .03, release: .013, phrase: 23, space: .5, x: .68, y: .72, direction: 1, synthesis: 'pm' }),

  scene('grains', 'tin-swarm', 'Tin swarm', 'Source grains excite ringing metallic clusters.', { engine: 'resonant', seed: 19661, base: 447, rate: 6.9, span: 2.6, index: 4.2, ratio: 3.79, depth: 7, roughness: .87, branch: 1.37, grainSize: .23, spray: .61, scan: .56, memory: .58, attack: .002, decay: .14, sustain: .18, release: .27, phrase: 11, space: .66, x: .73, y: .91, direction: -1, synthesis: 'fm' }),
  scene('grains', 'needle-scan', 'Needle scan', 'High short fragments pick a narrow region of the source.', { engine: 'sample', seed: 77849, base: 1280, rate: 23, span: 1.8, index: 2.6, ratio: 2.11, depth: 8, roughness: 1.08, branch: 1.65, grainSize: .012, spray: .07, scan: .88, memory: .03, attack: .0002, decay: .004, sustain: 0, release: .007, phrase: 17, space: .37, x: .24, y: .65, direction: 1, synthesis: 'pm' }),

  scene('waveform', 'folded-bass', 'Folded bass', 'A bent low partial family makes springy articulated shapes.', { engine: 'folded', seed: 24371, base: 133, rate: 3.4, span: 1.7, index: 1.1, ratio: 1.73, depth: 6, roughness: .62, branch: .7, partialRatio: 1.73, fold: 1.7, memory: .3, attack: .002, decay: .07, sustain: .12, release: .13, phrase: 8, space: .25, x: .35, y: .58, direction: 1, synthesis: 'pm' }),
  scene('waveform', 'hollow-ribbon', 'Hollow ribbon', 'Alternate partial levels make a clean contour with short breathy swells.', { engine: 'hollow', seed: 60919, base: 647, rate: 1.72, span: .92, index: .32, ratio: .51, depth: 7, roughness: .31, branch: .28, partialRatio: 1.52, fold: .3, memory: .28, attack: .04, decay: .15, sustain: .3, release: .24, phrase: 12, space: .7, x: .16, y: .36, direction: 1, synthesis: 'pm' }),
  scene('waveform', 'rubber-coil', 'Rubber coil', 'Geometrically stretched partials bend through rounded phase-modulated pulses.', { engine: 'self-affine', seed: 44701, base: 374, rate: 5.3, span: 2.1, index: 3.65, ratio: 1.19, depth: 8, roughness: .91, branch: 1.05, partialRatio: 1.91, fold: 1.1, memory: .22, attack: .006, decay: .06, sustain: .19, release: .09, phrase: 15, space: .48, x: .69, y: .62, direction: -1, synthesis: 'pm' }),
  scene('waveform', 'wide-comb', 'Wide comb', 'Exposed high partials stretch apart in a brisk asymmetric score.', { engine: 'self-affine', seed: 73463, base: 1120, rate: 9.4, span: 1.6, index: .9, ratio: 3.13, depth: 10, roughness: 1.17, branch: 1.22, partialRatio: 2.73, fold: 2.2, memory: .04, attack: .0006, decay: .018, sustain: .05, release: .028, phrase: 13, space: .62, x: .8, y: .76, direction: 1, synthesis: 'fm' }),

  scene('echoes', 'spiral-steps', 'Spiral steps', 'Wrapped pitch and geometric repetitions make open ascending gestures.', { engine: 'shepard', seed: 17293, base: 440, rate: 3.2, span: 2.6, index: 1.4, ratio: 1.41, depth: 6, roughness: .42, branch: .6, echoTime: .21, echoRatio: 1.37, sweepRate: .32, memory: .54, attack: .002, decay: .08, sustain: .12, release: .13, phrase: 8, space: .45, x: .55, y: .61, direction: 1, synthesis: 'pm' }),
  scene('echoes', 'falling-stairs', 'Falling stairs', 'Bright downward registers feed a crowded accelerating echo pattern.', { engine: 'shepard', seed: 80173, base: 769, rate: 7.8, span: 4.6, index: 4.3, ratio: 2.71, depth: 10, roughness: 1.08, branch: 1.4, echoTime: .53, echoRatio: .69, sweepRate: 1.37, memory: .69, attack: .0005, decay: .032, sustain: .08, release: .06, phrase: 11, space: .67, x: .2, y: .83, direction: -1, synthesis: 'fm' }),
  scene('echoes', 'glass-taps', 'Glass taps', 'High clear impacts travel through spacious, uneven repetitions.', { engine: 'strikes', seed: 47717, base: 1540, rate: 2.7, span: 1.8, index: 1.1, ratio: 4.31, depth: 7, roughness: .28, branch: .36, echoTime: .32, echoRatio: 1.19, sweepRate: .19, memory: .47, attack: .0004, decay: .025, sustain: .02, release: .07, phrase: 13, space: .74, x: .69, y: .44, direction: 1, synthesis: 'pm' }),
  scene('echoes', 'ringing-spiral', 'Ringing spiral', 'A thick resonant field folds very fast register motion into long taps.', { engine: 'resonant', seed: 99367, base: 570, rate: 6.3, span: 5.8, index: 6.8, ratio: 2.13, depth: 12, roughness: 1.21, branch: 1.78, echoTime: .14, echoRatio: 1.61, sweepRate: 2.8, memory: .83, attack: .003, decay: .23, sustain: .28, release: .38, phrase: 19, space: .91, x: .9, y: .86, direction: -1, synthesis: 'fm' }),

  scene('texture', 'paper-rain', 'Paper rain', 'Measured broad bands animate a gently articulated noise field.', { engine: 'noise', seed: 42617, base: 410, rate: 4, span: 1.7, index: .7, ratio: 1.37, depth: 5, roughness: .76, branch: .77, bandQ: 2.4, tilt: -.2, profileMemory: .22, memory: .3, attack: .003, decay: .09, sustain: .2, release: .08, phrase: 8, space: .38, x: .42, y: .64, direction: 1, synthesis: 'pm' }),
  scene('texture', 'gravel-static', 'Gravel static', 'Fast rough noise leans into bright upper bands and short attacks.', { engine: 'noise', seed: 89759, base: 162, rate: 18.1, span: 4.7, index: 9.7, ratio: 3.17, depth: 10, roughness: 1.6, branch: 1.86, bandQ: .7, tilt: 1.8, profileMemory: .035, memory: .06, attack: .0002, decay: .007, sustain: .02, release: .012, phrase: 5, space: .26, x: .89, y: .93, direction: -1, synthesis: 'fm' }),
  scene('texture', 'felt-air', 'Felt air', 'Slow source grains soften a darker spectral profile.', { engine: 'hybrid', seed: 11971, base: 598, rate: 1.34, span: .79, index: .21, ratio: .89, depth: 3, roughness: .16, branch: .29, bandQ: 1.2, tilt: -1.7, profileMemory: 1.4, grainSize: .46, spray: .21, scan: .18, memory: .48, attack: .05, decay: .22, sustain: .35, release: .27, phrase: 14, space: .8, x: .15, y: .27, direction: 1, synthesis: 'pm' }),
  scene('texture', 'whistling-mesh', 'Whistling mesh', 'Narrow high resonances pick out measured spectral ridges.', { engine: 'resonant', seed: 80513, base: 1350, rate: 3.1, span: 1.4, index: 1.2, ratio: .63, depth: 7, roughness: .37, branch: .46, bandQ: 21, tilt: 2.3, profileMemory: .8, memory: .39, attack: .014, decay: .2, sustain: .3, release: .16, phrase: 11, space: .76, x: .26, y: .61, direction: 1, synthesis: 'pm' }),
  scene('texture', 'fabric-shards', 'Fabric shards', 'Short source grains collide with a quick changing spectral field.', { engine: 'hybrid', seed: 35291, base: 870, rate: 14.9, span: 3.5, index: 5.3, ratio: 4.27, depth: 11, roughness: 1.3, branch: 2.1, bandQ: 5.7, tilt: -.7, profileMemory: .06, grainSize: .038, spray: .86, scan: .82, memory: .13, attack: .0005, decay: .014, sustain: .05, release: .025, phrase: 23, space: .69, x: .81, y: .43, direction: -1, synthesis: 'fm' }),
].sort((a, b) => presetOrderKey(a.id) - presetOrderKey(b.id) || a.id.localeCompare(b.id)));

const OPENING_PRESET_IDS = Object.freeze({
  wander: 'wander-thread-plucks', grammar: 'grammar-twig-talk', grains: 'grains-needle-scan',
  waveform: 'waveform-folded-bass', echoes: 'echoes-spiral-steps', texture: 'texture-paper-rain',
});
export function openingPreset(mode) {
  return FACTORY_PRESETS.find(preset => preset.id === OPENING_PRESET_IDS[mode]);
}

const PLAYABLE_RANGES = {
  base: [45, 2600, 'log'], rate: [.2, 32, 'log'], span: [.12, 6.8], index: [.08, 23], ratio: [.07, 17, 'log'],
  roughness: [.025, 2.9], branch: [.03, 63.8], memory: [.01, .88], attack: [.0003, .5, 'log'], decay: [.004, 1.7, 'log'], sustain: [0, .76], release: [.008, 2.4, 'log'],
  space: [.03, .94], x: [.01, .99], y: [.01, .99], glide: [0, .6], chaos: [.01, 1.9], turns: [.29, 31.7], generationLoss: [.01, .7],
  grainSize: [.008, 1.1, 'log'], spray: [.01, .97], scan: [.005, .995], partialRatio: [1.12, 2.95], fold: [.05, 5.7],
  echoTime: [.021, 2.4, 'log'], echoRatio: [.39, 2.3], sweepRate: [.021, 3.6, 'log'], bandQ: [.45, 22, 'log'], tilt: [-2.8, 2.8], profileMemory: [.015, 2.7, 'log'],
  inputMix: [.05, 1], inputGain: [.15, 2.7],
  timingBend: [-.8, .8], shapeToMod: [-14, 14], stereoWidth: [.1, 1.9],
};
// Echoes reserve events for each generation. Deep scores therefore retain
// fewer full-strength source attacks: independent phrase/tempo rolls can leave
// minutes between them. Bound random audition gaps using the actual retained
// anchors, including timing bend and the two reflected terminal margins.
function echoAnchorGap(state) {
  const anchors = generateStructure(state).events.filter(event => event.depth === 0);
  let gap = anchors[0].phase + 1 - anchors.at(-1).phase;
  for (let i = 1; i < anchors.length; i++) gap = Math.max(gap, anchors[i].phase - anchors[i - 1].phase);
  if (state.pingPong) gap = Math.max(gap, anchors[0].phase * 2, (1 - anchors.at(-1).phase) * 2);
  return gap * state.phrase / state.rate;
}
function playableRandomEchoes(state) {
  // A complete Shepard register bank avoids a single partial dwelling at its
  // window's zero. Manual settings and authored presets keep their full range.
  if (state.engine === 'shepard') state.depth = Math.max(7, state.depth);
  state.rate = Math.max(1, state.rate);
  for (let attempt = 0; attempt < 6; attempt++) {
    const gap = echoAnchorGap(state);
    if (gap <= 1.25) break;
    state.phrase = Math.max(1, Math.floor(state.phrase * 1.25 / gap));
  }
  if (echoAnchorGap(state) > 1.25) {
    // Tiny anchor counts and integer phrase lengths can prevent convergence.
    // A short complete round trip bounds even their reflected empty margins.
    state.rate = Math.max(1.6, state.rate);
    state.phrase = Math.max(1, Math.min(state.phrase, Math.floor(state.rate * .625)));
  }
  // An attack longer than the score gate released before reaching useful level.
  state.attack = Math.min(state.attack, (.12 + state.memory * .32) / state.rate * .6);
  return state;
}

/** Complete musical scene randomization. Audio, Play, device permission and master level are external. */
export function randomizeState(current, random = Math.random) {
  const state = sanitizeState(current), next = { mode: state.mode };
  const roll = () => { const n = random(); return typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(1 - Number.EPSILON, n)) : .5; };
  for (const [key, descriptor] of Object.entries(PARAMS)) {
    const r = roll();
    if (key === 'direction') next[key] = r < .5 ? -1 : 1;
    else if (key === 'seed' || key === 'depth' || key === 'phrase') next[key] = descriptor.min + Math.floor(r * (descriptor.max - descriptor.min + 1));
    else {
      let [lo, hi, scaling] = PLAYABLE_RANGES[key] || [descriptor.min, descriptor.max];
      if (state.mode === 'wander' && key === 'base') { lo = 300; hi = 2100; }
      if (state.mode === 'wander' && key === 'release') { lo = .008; hi = .35; }
      if (state.mode === 'wander' && key === 'attack') { lo = .0003; hi = .045; }
      next[key] = scaling === 'log' ? lo * (hi / lo) ** r : lo + (hi - lo) * r;
    }
  }
  next.engine = ENGINE_OPTIONS[state.mode][Math.floor(roll() * ENGINE_OPTIONS[state.mode].length)].value;
  next.loop = roll() >= .18;
  next.pingPong = roll() < .5;
  next.pitchInvert = roll() < .5;
  next.stereoFlip = roll() < .5;
  for (let i = 1; i <= 2; i++) {
    const targets = targetsForMode(state.mode).filter(([key]) => modulatorTargetAvailable({ mode: state.mode, engine: next.engine }, key));
    next[`lfo${i}On`] = roll() >= .7;
    next[`lfo${i}Target`] = targets[Math.floor(roll() * targets.length)][0];
    next[`lfo${i}Shape`] = MODULATOR_SHAPES[Math.floor(roll() * MODULATOR_SHAPES.length)];
  }
  for (const prefix of ['Branch', 'Angle', 'Root', 'Index', 'Turns', 'Scan']) next[`motion${prefix}On`] = roll() >= .7;
  next.synthesis = roll() < .5 ? 'fm' : 'pm';
  return sanitizeState(state.mode === 'echoes' ? playableRandomEchoes(next) : next);
}
