/** Pure gesture and fictional vocal controls. Frequencies are synthesis choices,
 * not measurements of a human voice. No pitch scale or note quantizer is used. */
import { WITCH_CAT_GAITS } from './witch-cat-model.js';
export { WITCH_CAT_GAITS };
import { createHandPose, evaluateHandPose, setHandEffectiveTempo } from '../gesticulating-hand/hand-model.js';

export const WITCH_TAU = Math.PI * 2;
export const WITCH_VOICES = Object.freeze(['mutter', 'whisper', 'creak', 'cackle', 'sing', 'wail', 'chatter']);
export const WITCH_VOCAL_EFFECTS = Object.freeze(['cackle', 'moan', 'howl', 'ghost', 'bat']);
export const WITCH_FLIGHT_EFFECTS = Object.freeze(['moon', 'bat', 'ghost', 'spark', 'gust', 'launch']);
export const WITCH_LAUNCH_DURATION = 1.86;
export const WITCH_FINGER_SOURCES = Object.freeze(['glass', 'reed', 'wire', 'metal', 'marimba']);
export const WITCH_HAND_MOTIONS = Object.freeze(['finger-roll','claw-pulse','spider-walk','finger-drumming','flourish-spiral','finger-swarm','frantic-orbit','polyrhythmic-tangle','scatter','flick','wrist-turn','opposition-walk','pinch-ladder','figure-eight','source-grasp','beckon']);
export const WITCH_HAND_SOUNDS = Object.freeze([
  ['glass-and-wire','Glass and wire',['glass','reed','wire','metal','marimba'],91,.12,.14,.035,.28],
  ['rusted-strings','Rusted strings',['bowed','wire','metal','bowed','reed'],61,.78,.23,.07,.48],
  ['bone-glass','Bone glass',['glass','metal','glass','marimba','wire'],137,.46,.32,.008,.4],
  ['insect-static','Insect static',['pulse','air','wire','pulse','metal'],113,.91,.08,.006,.12],
  ['iron-claws','Iron claws',['metal','wire','bowed','metal','pulse'],73,.83,.19,.012,.23],
  ['bowed-shadows','Bowed shadows',['bowed','reed','bowed','wire','air'],47,.64,.38,.11,.62],
  ['hollow-reeds','Hollow reeds',['reed','air','wire','reed','bowed'],83,.52,.26,.04,.35],
  ['clockwork-teeth','Clockwork teeth',['marimba','pulse','metal','wire','glass'],169,.62,.11,.004,.16],
  ['shattered-bells','Shattered bells',['glass','metal','wire','glass','metal'],211,.88,.43,.007,.56],
  ['buried-wires','Buried wires',['wire','bowed','air','metal','wire'],39,.94,.3,.025,.51],
].map(([id,label,sources,rootHz,roughness,space,attack,release])=>Object.freeze({id,label,sources:Object.freeze(sources),rootHz,roughness,space,attack,release})));
// Stable trigger IDs keep saved controls usable. Every visible shelf object is
// an actual catalogue instrument; former organic ingredients now hold voices.
const miniature = (entry, location = 'shelf') => {
  const [id,instrumentId,name,icon=instrumentId] = entry;
  return Object.freeze({id,instrumentId,name,kind:`drop-${id}`,imageHref:`assets/instruments/${icon}.webp`,
    presetId:`shelf-${instrumentId}`,location,phraseDuration:location==='tree'?3.2:0,flightDuration:1.5});
};
export const WITCH_SHELF = Object.freeze([
  ['glass','alien-larynx','Alien Larynx'], ['hyper-rubix','hyper-rubix','Hyper Rubix'],
  ['earwax','digestazoid','Digestazoid'], ['hair','hybrinx','Hybrinx'],
  ['roach','roach-synth','Roach Synth'], ['oculoid','fm-drums','FM Drums'],
  ['rubix','rubix','Rubix Cube Sequencer'], ['hiccup','hiccup-head','Hiccup Head'],
  ['gesticules','gesticulating-hand','Gesticules'], ['marimba','linear-drums','Rattlesnake'],
  ['chiptune','simd-chiptune','SIMD Chiptune'], ['julie-saw','julie-saw','Julie Saw'],
  ['puggler','puggler','Puggler the Punk Rock Jugger'], ['fractal','fractal-signals','Fractal Synthesis'],
  ['synthesaurus','synthesis','Synthesaurus'], ['jaw-harp','jaw-harp','Jaw Harp'],
  ['harmonicazoid','harmonica','Harmonicazoid'], ['dentaphone','object-forge','Dentaphone','dentaphone'],
].map(entry=>miniature(entry)));
export const WITCH_TREE_OBJECTS = Object.freeze([
  ['blech','blech-midi','BLECH MIDI'], ['syrinx','syrinx','Syrinx'], ['eyeball','creaturazoid','Creaturazoid'],
].map(entry=>miniature(entry,'tree')));
export const WITCH_CUPBOARD_TOP = Object.freeze([
  ['quadruped','quadruped','Quadruped'], ['monstroid','monstroid','Monstroid','colony-syrinx'],
  ['candy-coil','candy-coil-delay','Candy Coil Delay'],
  ['acid-303','simd-303','SIMD 303'],
].map(entry=>miniature(entry,'cupboard-top')));
export const WITCH_WEB_OBJECTS = Object.freeze([
  miniature(['spider','spider-synth','Spider Synth'],'web'),
]);
export const WITCH_INGREDIENTS = Object.freeze([...WITCH_SHELF,...WITCH_TREE_OBJECTS,...WITCH_CUPBOARD_TOP,...WITCH_WEB_OBJECTS]);
export const WITCH_DROP_EFFECTS = Object.freeze([...new Set([
  ...WITCH_INGREDIENTS.map(item=>item.kind),
  // Old sound IDs stay valid for existing saved/test integrations.
  ...['choir','tail','newt','spider','blowhole','throat-singing','cat','mouse','lizard'].map(id=>`drop-${id}`),
])]);
export const WITCH_SCENE_EFFECTS = Object.freeze(['spider-groan','eye-shock','fabric-wind','blech-frenzy','ghost-scream','unicorn-escape','tree-l-system','dice-charm','shape-charm','mushroom-gloop',...Array.from({length:7},(_,i)=>`web-${i}`)]);
export const WITCH_EFFECTS = Object.freeze([...new Set([...WITCH_VOCAL_EFFECTS, ...WITCH_FLIGHT_EFFECTS, ...WITCH_DROP_EFFECTS, ...WITCH_SCENE_EFFECTS, 'meow'])]);
export const WITCH_DEFAULTS = Object.freeze({
  speed: 0, flightSpeed: .4, radius: .5, direction: 1, gate: false, brewEnabled: true, handEnabled: true, backingEnabled: true, mode: 'brew', voice: 'mutter', stirAuto: true, stirring: false,
  ghostTempo: 72, ghostGate: false,
  handMotion: 'finger-roll', handRate: 1, handDepth: .66, handAuto: true, handSound: 'glass-and-wire', spellBalance: .5,
  catCaptured: false, catSpeed: 1, catGait: 'cat-prowl', fabricX: .5, fabricY: .5, fabricPull: 0, fabricVelocity: 0,
  trailPull: .5, trailTwist: .5, trailFeedback: .55, trailSpace: .5,
  treeSpread: .5, treeCurl: .5,
  fingers: Object.freeze([.5, .5, .5, .5, .5]), fingerMask: 0, manualFingerMask: 0, handFocus: 0,
  nose: .5, hat: .5, spoonHeight: .5, spoonAuto: false, altitude: .5, flightX: .5, tone: .5, glass: 0, hair: 0, volume: .6,
});
export const witchClamp = (value, min = 0, max = 1, fallback = min) => (
  Math.min(max, Math.max(min, Number.isFinite(Number(value)) ? Number(value) : fallback))
);

export function normalizeWitchControls(value = {}) {
  const input = value && typeof value === 'object' ? value : {};
  const result = {};
  for (const name of ['speed', 'flightSpeed', 'radius', 'altitude', 'flightX', 'tone', 'glass', 'hair', 'nose', 'hat', 'spoonHeight', 'volume', 'handDepth', 'spellBalance', 'fabricX', 'fabricY', 'fabricPull', 'fabricVelocity', 'trailPull', 'trailTwist', 'trailFeedback', 'trailSpace', 'treeSpread', 'treeCurl']) {
    result[name] = witchClamp(input[name], 0, 1, WITCH_DEFAULTS[name]);
  }
  result.direction = Number(input.direction) < 0 ? -1 : 1;
  result.gate = input.gate === true;
  result.stirring = input.stirring === true;
  for (const name of ['stirAuto', 'handAuto', 'brewEnabled', 'handEnabled', 'backingEnabled']) result[name] = typeof input[name] === 'boolean' ? input[name] : WITCH_DEFAULTS[name];
  result.ghostGate = input.ghostGate === true;
  result.ghostTempo = witchClamp(input.ghostTempo, 36, 180, WITCH_DEFAULTS.ghostTempo);
  result.handMotion = WITCH_HAND_MOTIONS.includes(input.handMotion) ? input.handMotion : WITCH_DEFAULTS.handMotion;
  result.handRate = witchClamp(input.handRate, .25, 6, WITCH_DEFAULTS.handRate);
  result.handSound = WITCH_HAND_SOUNDS.some(sound=>sound.id===input.handSound) ? input.handSound : WITCH_DEFAULTS.handSound;
  result.catCaptured = input.catCaptured === true;
  result.catGait = WITCH_CAT_GAITS.includes(input.catGait) ? input.catGait : WITCH_DEFAULTS.catGait;
  result.catSpeed = witchClamp(input.catSpeed, .5, 2, WITCH_DEFAULTS.catSpeed);
  result.spoonAuto = input.spoonAuto === true;
  result.mode = ['brew', 'fingers', 'flight'].includes(input.mode) ? input.mode : 'brew';
  result.handFocus = witchClamp(input.handFocus, 0, 1, result.mode === 'fingers' ? 1 : 0);
  result.voice = WITCH_VOICES.includes(input.voice) ? input.voice : 'mutter';
  result.fingers = Array.from({ length: 5 }, (_, i) => witchClamp(input.fingers?.[i], 0, 1, .5));
  result.fingerMask = Math.round(witchClamp(input.fingerMask, 0, 31));
  result.manualFingerMask = Math.round(witchClamp(input.manualFingerMask, 0, 31));
  return result;
}

export const witchSpoonHeight = seconds => .5 + .48 * Math.sin(witchClamp(seconds, 0, 1e9) * .62);
export const witchVoiceAtHeight = height => WITCH_VOICES[Math.min(WITCH_VOICES.length - 1, Math.floor(witchClamp(height) * WITCH_VOICES.length))];

const GHOST_BEATS = Object.freeze([
  Object.freeze([1, 0, 0, .48, 1, 0, .6, 0]),
  Object.freeze([0, .65, 1, 0, 0, .55, 1, 0]),
  Object.freeze([0, 0, 0, 1, 0, .52, 0, 1]),
]);
const ghostSmooth = value => { const x = witchClamp(value); return x * x * (3 - 2 * x); };

/** One audio-owned beat clock for the three distant visitors: Creaturazoid,
 * Monstrozoid, Hiccup Head. Each has twelve visible beats in a twenty-four-beat
 * mist cycle. Both the sound and drawing use these same staggered arrivals and
 * half-beat accents; changing tempo changes the slope, never the position. */
export function witchGhostFrame(phase = 0, index = 0, out = {}) {
  const beats = witchClamp(phase, 0, 1e12), ghost = Math.round(witchClamp(index, 0, 2));
  const visit = ((beats - ghost * 8) % 24 + 24) % 24;
  out.presence = visit < 12 ? ghostSmooth(visit / 2) * ghostSmooth((12 - visit) / 2) : 0;
  const subdivisions = beats * 2, step = Math.floor(subdivisions), fraction = subdivisions - step;
  out.step = step; out.beatAge = fraction * .5;
  out.pulse = out.presence * GHOST_BEATS[ghost][step % 8]
    * ghostSmooth(fraction / .07) * Math.exp(-fraction * 5.8) * ghostSmooth((.9 - fraction) / .15) * 1.35;
  return out;
}

/** The two hands use authored Gesticules choreography, with different timing
 * and a low starting curl that keeps the elongated fingers legible. */
export function witchHandConfig(state = {}, handIndex = 0) {
  const bank=WITCH_HAND_SOUNDS.find(sound=>sound.id===state.handSound)||WITCH_HAND_SOUNDS[0];
  return {
    motion: setHandEffectiveTempo({ id: state.handAuto === false ? 'still' : WITCH_HAND_MOTIONS.includes(state.handMotion) ? state.handMotion : (handIndex ? 'claw-pulse' : 'finger-roll'), amount: state.handAuto === false ? 0 : witchClamp(state.handDepth,0,1,.66)*(handIndex?.72:1) }, 62*witchClamp(state.handRate,.25,6,1)),
    tremor: { amount: 0 },
    pose: { fingers: Array.from({ length: 5 }, (_, index) => {
      const bend = witchClamp(state.fingers?.[index], 0, 1, .5);
      return index ? { mcp: bend * 38, pip: bend * 44, dip: bend * 30, spread: 0 }
        : { mcp: bend * 50 - 12, pip: bend * 24, dip: bend * 36 - 6, spread: -18 * (1 - bend) };
    }), wrist: { flex: 0, side: 0, twist: 0 } },
    sound: { rhythm: 'continuous', rootHz: bank.rootHz, pitchSpread: 1.25, brightness: witchClamp(state.tone, 0, 1, .5),
      roughness: bank.roughness, space: bank.space, rotationFx: 0, attack: bank.attack, release: bank.release },
    voices: bank.sources.map((source, index) => ({ source, level: index > 2 ? .9 : .76 })),
  };
}

/** Directly held digits retain their complete bend while the other fingers
 * continue their incantation. Manual presets retain those bends after release.
 * The second, ladle-side hand is independently offset. */
export function applyWitchManualFingers(state, pose, handIndex = 0) {
  const mask = handIndex ? 0 : state.handAuto === false ? 31 : Math.round(witchClamp(state.manualFingerMask, 0, 31));
  for (let index = 0; index < 5; index++) if (mask & (1 << index)) {
    const bend = witchClamp(state.fingers?.[index], 0, 1, .5), f = pose.fingers[index];
    f.mcp = index ? bend * 70 : bend * 80 - 10;
    f.pip = bend * (index ? 85 : 65); f.dip = index ? bend * 60 : bend * 65 - 5;
    f.spread = index ? 0 : -18 * (1 - bend);
  }
  return pose;
}

/** Time is seconds of the audio-owned hand transport. Passing the same time
 * freezes the pose without resetting it; reduced motion suppresses wrist flourishes. */
export function evaluateWitchHandPose(state = {}, seconds = 0, handIndex = 0, out = createHandPose()) {
  evaluateHandPose(witchHandConfig(state, handIndex), witchClamp(seconds, 0, 1e9) + (handIndex ? .73 : 0), out);
  applyWitchManualFingers(state, out, handIndex);
  if (state.reducedMotion) out.wrist.flex = out.wrist.side = out.wrist.twist = 0;
  return out;
}

export function createStirState() {
  return { angle: 0, time: null, radius: .5, speed: 0, velocity: 0, direction: 1, gate: false, phase: 0 };
}

/** Angles are radians, radius is 0..1, and monotonic input time is seconds. */
export function updateStir(state, { angle, radius, time } = {}) {
  const next = { ...state, gate: true };
  const a = witchClamp(angle, -1e9, 1e9, next.angle);
  const t = witchClamp(time, 0, 1e12, next.time ?? 0);
  next.radius = witchClamp(radius, 0, 1, next.radius);
  if (next.time !== null && t > next.time) {
    const dt = Math.max(.004, t - next.time);
    const delta = Math.atan2(Math.sin(a - next.angle), Math.cos(a - next.angle));
    const velocity = witchClamp(delta / dt, -18, 18);
    const blend = 1 - Math.exp(-dt / .045);
    // A real reversal changes direction immediately; smoothing its magnitude
    // avoids an old clockwise velocity hiding a counterclockwise gesture.
    if (Math.abs(velocity) > .03) next.direction = Math.sign(velocity);
    next.velocity += (Math.abs(velocity) - next.velocity) * blend;
    next.speed = witchClamp(next.velocity / 12);
    next.phase = ((next.phase + delta) % WITCH_TAU + WITCH_TAU) % WITCH_TAU;
  }
  next.angle = a; next.time = t;
  return next;
}

export function releaseStir(state) { return { ...state, gate: false, time: null }; }

/** Exact exponential coast gives the same result at different display rates. */
export function advanceStir(state, seconds) {
  const dt = witchClamp(seconds, 0, 60);
  const next = { ...state };
  const decay = next.gate ? 1 : Math.exp(-dt / 1.3);
  const distance = next.gate ? next.velocity * dt : next.velocity * 1.3 * (1 - decay);
  next.phase = ((next.phase + next.direction * distance) % WITCH_TAU + WITCH_TAU) % WITCH_TAU;
  next.velocity *= decay; next.speed = witchClamp(next.velocity / 12);
  return next;
}

// Eight intentionally asymmetric vowel/pitch destinations make reversal
// observable. The source traverses them continuously, never as a tuned scale.
export const WITCH_SYLLABLES = Object.freeze([
  [310, 2230, 2900, .32, .92], [540, 1710, 2600, .67, 1.09],
  [790, 1140, 2460, .94, .97], [430, 850, 2280, .46, .84],
  [290, 690, 2170, .24, 1.16], [650, 1550, 2730, .78, 1.04],
  [810, 1460, 2830, .9, .95], [380, 1950, 3080, .43, 1.12],
].map(Object.freeze));

// Wail holds open vowels through long continuous swoops. Chatter skips between
// smaller, uneven syllables with broken accents. These are fictional phrases,
// never words, recorded speech, or destinations on a musical pitch scale.
const WAIL_SYLLABLES = Object.freeze([
  [360, 790, 2420, .62, .68], [690, 1110, 2650, .95, 1.28],
  [830, 1350, 2830, 1, 1.72], [570, 910, 2580, .84, 1.09],
  [310, 670, 2370, .51, .59], [460, 980, 2490, .73, .83],
].map(Object.freeze));
const CHATTER_SYLLABLES = Object.freeze([
  [290, 2310, 3180, .26, .83], [720, 1520, 2820, .81, 1.19],
  [350, 1960, 2990, .38, .92], [810, 1260, 2570, .92, 1.37],
  [270, 880, 2390, .22, .74], [590, 1780, 2910, .67, 1.04],
  [390, 2150, 3120, .31, 1.28], [760, 1080, 2490, .88, .87],
  [320, 1840, 2790, .29, 1.12], [470, 960, 2280, .54, .71],
].map(Object.freeze));
const CHATTER_ACCENTS = Object.freeze([1, .72, 1, .22, .9, .65, .08, 1, .55, .16]);

/** phase is measured in syllables. Negative direction traverses the same
 * continuous vowel path backward. An optional output object avoids DSP garbage. */
export function sampleChant(phase, direction = 1, radius = .5, out = {}, voice = 'mutter') {
  const syllables = voice === 'wail' ? WAIL_SYLLABLES : voice === 'chatter' ? CHATTER_SYLLABLES : WITCH_SYLLABLES;
  const length = syllables.length;
  const p = ((witchClamp(phase, -1e12, 1e12) * (direction < 0 ? -1 : 1)) % length + length) % length;
  const index = Math.floor(p), fraction = p - index;
  const travel = voice === 'chatter' ? witchClamp((fraction - .08) / .58) : fraction;
  const blend = travel * travel * (3 - 2 * travel);
  const a = syllables[index], b = syllables[(index + 1) % length];
  const opening = witchClamp(radius, 0, 1, .5);
  out.index = index; out.fraction = fraction;
  out.f1 = (a[0] + (b[0] - a[0]) * blend) * (.65 + opening * .75);
  out.f2 = (a[1] + (b[1] - a[1]) * blend) * (1.13 - opening * .2);
  out.f3 = a[2] + (b[2] - a[2]) * blend;
  out.mouth = (a[3] + (b[3] - a[3]) * blend) * (.28 + opening * .72);
  out.pitch = a[4] + (b[4] - a[4]) * blend;
  out.articulation = voice === 'wail' ? .72 + .28 * Math.sin(Math.PI * p / length) ** 2
    : voice === 'chatter' ? .025 + .975 * CHATTER_ACCENTS[index] * Math.sin(Math.PI * fraction) ** 5
      : .22 + .78 * Math.sin(Math.PI * fraction) ** 2;
  if (voice === 'chatter') out.mouth *= .2 + .8 * out.articulation;
  return out;
}
