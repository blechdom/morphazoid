import { branchFrame, branchPitch, branchShape, wrapDegrees } from './branch-geometry.js';
export { branchFrame, branchPitch, branchShape, wrapDegrees } from './branch-geometry.js';

import { sanitizeModulatorState } from './modulators.js';
import { sanitizeMotionState } from './motions.js';
/** Deterministic geometric scores; continuous frequencies, with explicit visual/audio budgets. */
const TAU = Math.PI * 2;
const NOISE_OCTAVES = 24;
export const MAX_POINTS = 768;
export const MAX_EVENTS = 384;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const unit = n => clamp(n, 0, 1);
const fract = n => n - Math.floor(n);
const number = (n, fallback) => typeof n === 'number' && Number.isFinite(n) ? n : fallback;

export const MODES = Object.freeze([
  { id: 'wander', label: 'paths', shortLabel: 'paths', description: 'A path combines related changes at several time scales. Its height sets continuous pitch; marked points become separately articulated events, with gaps between them. Cascade, plucked and additive engines read the same path differently. Roughness shifts detail toward shorter scales, while the gesture changes the path’s speed and excursion.', accent: '#c5ff6b', gesture: { x: 'Time folding', y: 'Excursion' } },
  { id: 'grammar', label: 'branches', shortLabel: 'branches', description: 'An L-system rewrites growing tips into a stem and new tips. The trunk begins on the left and each generation advances right. Branch height and direction determine pitch; descendants inherit shorter gates and can lose energy each generation. At high recursion, the drawing keeps representatives of every generation instead of discarding the trunk.', accent: '#ffbc66', gesture: { x: 'Branch spread', y: 'Child length' } },
  { id: 'grains', label: 'grains', shortLabel: 'grains', description: 'A grain spawns shorter descendants, producing clusters within clusters. Grain size sets their time scale, spray scatters their timing and positions, and scan chooses a region of the source. The sample, resonant and cloud engines use the original source, a local recording or explicitly enabled live input as different starting material.', accent: '#ed99ef', gesture: { x: 'Cluster spread', y: 'Fan rotation' } },
  { id: 'waveform', label: 'waves', shortLabel: 'waves', description: 'Successive partials have geometrically related frequencies. A partial ratio of two gives octave detail; continuous ratios create inharmonic families. The self-affine engine sums the partials, folded bends the sum through repeated folds, and hollow retains alternate levels. The drawing shows the source curve; modulation and the output frequency limit further shape the sound.', accent: '#82c5ff', gesture: { x: 'Detail phase', y: 'Pitch lift' } },
  { id: 'echoes', label: 'echoes', shortLabel: 'echoes', description: 'Repeated events and delay taps follow a geometric time ratio. Ratios below one crowd the repetitions; ratios above one spread them out. A wrapped Shepard register can continue rising or falling, while strikes and resonant engines give the delay network more percussive material. Delay time is bounded to the instrument’s eight-second memory.', accent: '#ff858f', gesture: { x: 'Spiral opening', y: 'Spiral turn' } },
  { id: 'texture', label: 'textures', shortLabel: 'textures', description: 'Measured energy across sixteen frequency bands and a changing amplitude envelope guide a new texture. Filtered noise, band oscillators and a noise-plus-grains engine interpret that profile differently. Band Q focuses the noise filters, tilt redistributes low and high energy, and Analysis release sets how quickly measured input energy decays. This is a statistical interpretation of the source, rather than an exact reconstruction.', accent: '#7ce5cb', gesture: { x: 'Band drift', y: 'Grain contrast' } },
]);
const spec = (label, min, max, step, fallback, unit, group) => Object.freeze({ label, min, max, step, default: fallback, unit, group });
export const PARAMS = Object.freeze({
  motionBranchTempo: spec('Motion tempo', -120, 120, .1, 6, 'BPM', 'Motion'),
  motionAngleTempo: spec('Motion tempo', -120, 120, .1, 6, 'BPM', 'Motion'),
  motionRootTempo: spec('Motion tempo', -120, 120, .1, 6, 'BPM', 'Motion'),
  motionIndexTempo: spec('Motion tempo', -120, 120, .1, 6, 'BPM', 'Motion'),
  motionTurnsTempo: spec('Motion tempo', -120, 120, .1, 6, 'BPM', 'Motion'),
  motionScanTempo: spec('Motion tempo', -120, 120, .1, 6, 'BPM', 'Motion'),
  lfo1Rate: spec('Rate', .01, 20, .01, .2, 'Hz', 'Modulators'),
  lfo1Depth: spec('Depth', 0, 1, .01, .25, '', 'Modulators'),
  lfo2Rate: spec('Rate', .01, 20, .01, .13, 'Hz', 'Modulators'),
  lfo2Depth: spec('Depth', 0, 1, .01, .25, '', 'Modulators'),
  base: spec('Root', 20, 8000, 1, 440, 'Hz', 'Frequency'),
  span: spec('Pitch span', 0, 8, .01, 1.35, 'oct', 'Frequency'),
  timingBend: spec('Timing bend', -1, 1, .01, 0, '', 'Mapping'),
  shapeToMod: spec('Shape → modulation', -16, 16, .01, 0, '', 'Mapping'),
  stereoWidth: spec('Stereo width', 0, 2, .01, 1, '×', 'Mapping'),
  ratio: spec('Mod ratio', .03125, 32, .005, 1.37, '×', 'Frequency'),
  index: spec('Mod amount', 0, 32, .01, 1.8, '', 'Timbre'),
  roughness: spec('Roughness', .01, 3, .01, .48, '', 'Timbre'),
  depth: spec('Recursion', 1, 48, 1, 5, '', 'Structure'),
  branch: spec('Branching', 0, 64, .01, .65, '', 'Structure'),
  rate: spec('Pulse rate', .0625, 64, .025, 4, '/s', 'Rhythm'),
  phrase: spec('Phrase', 1, 512, 1, 8, 'beats', 'Phrasing'),
  attack: spec('Attack', .0002, 4, .0001, .004, 's', 'Envelope'),
  decay: spec('Decay', .001, 8, .001, .18, 's', 'Envelope'),
  sustain: spec('Sustain', 0, 1, .01, .3, '', 'Envelope'),
  release: spec('Release', .005, 16, .005, .09, 's', 'Envelope'),
  memory: spec('Decay / feedback', 0, .96, .01, .22, '', 'Phrasing'),
  space: spec('Stereo delay', 0, 1, .01, .25, '', 'Timbre'),
  seed: spec('Seed', 1, 999999, 1, 17491, '', 'Structure'),
  x: spec('Gesture X', 0, 1, .01, .45, '', 'Structure'),
  y: spec('Gesture Y', 0, 1, .01, .55, '', 'Structure'),
  direction: spec('Direction', -1, 1, 2, 1, '', 'Rhythm'),
  glide: spec('Glide', 0, 2, .001, .008, 's', 'Paths'),
  chaos: spec('Chaos', 0, 2, .01, .18, '', 'Paths'),
  branchAngle: spec('Branch angle', 0, 360, .1, 0, '°', 'Branches'),
  turns: spec('Turns', 0, 32, .01, 1.25, '', 'Branches'),
  generationLoss: spec('Generation loss', 0, 1, .01, .18, '', 'Branches'),
  grainSize: spec('Grain size', .005, 1.5, .001, .12, 's', 'Grains'),
  spray: spec('Spray', 0, 1, .01, .28, '', 'Grains'),
  scan: spec('Source scan', 0, 1, .01, .35, '', 'Grains'),
  partialRatio: spec('Partial ratio', 1.1, 3, .001, 2, '×', 'Waves'),
  fold: spec('Fold', 0, 6, .01, 1.2, '', 'Waves'),
  echoTime: spec('Echo time', .015, 3, .001, .21, 's', 'Echoes'),
  echoRatio: spec('Echo ratio', .35, 2.5, .001, 1.37, '×', 'Echoes'),
  sweepRate: spec('Sweep rate', .01, 4, .01, .32, 'oct/s', 'Echoes'),
  bandQ: spec('Band Q', .3, 24, .1, 2.4, '', 'Textures'),
  tilt: spec('Spectral tilt', -3, 3, .01, 0, '', 'Textures'),
  profileMemory: spec('Analysis release', .01, 3, .01, .22, 's', 'Textures'),
  inputMix: spec('Input mix', 0, 1, .01, 1, '', 'Input'),
  inputGain: spec('Input gain', 0, 4, .01, 1, '×', 'Input'),
});
export const MODE_PARAMETERS = Object.freeze({
  wander: Object.freeze(['glide', 'chaos']), grammar: Object.freeze(['branchAngle', 'turns', 'generationLoss']),
  grains: Object.freeze(['grainSize', 'spray', 'scan']), waveform: Object.freeze(['partialRatio', 'fold']),
  echoes: Object.freeze(['echoTime', 'echoRatio', 'sweepRate']), texture: Object.freeze(['bandQ', 'tilt', 'profileMemory', 'grainSize', 'spray', 'scan']),
});
const option = (value, label, description) => Object.freeze({ value, label, description });
export const ENGINE_OPTIONS = Object.freeze({
  wander: Object.freeze([option('cascade', 'Modulation cascade', 'Cascaded frequency or phase modulation follows each articulated path event.'), option('pluck', 'Plucked string', 'A short excitation produces a decaying pitched event with a sharp onset.'), option('additive', 'Additive partials', 'A bank of partials follows the path with a more exposed spectral shape.')]),
  grammar: Object.freeze([option('cascade', 'Modulation cascade', 'Branch events excite a cascading FM or PM voice.'), option('pluck', 'Plucked string', 'Each branch becomes a short plucked event.'), option('bell', 'Bell partials', 'Inharmonic decaying partials give individual branches ringing tails.')]),
  grains: Object.freeze([option('sample', 'Sample grains', 'Windowed fragments read the original, loaded or live source.'), option('resonant', 'Resonant grains', 'Source fragments excite damped pitched resonances.'), option('cloud', 'Grain cloud', 'Overlapping fragments widen each recursive grain cluster.')]),
  waveform: Object.freeze([option('self-affine', 'Geometric partials', 'Geometrically spaced partials sum into a detailed source curve.'), option('folded', 'Wavefolded partials', 'A repeated sine fold bends the partial sum and adds upper spectral detail.'), option('hollow', 'Alternate partials', 'Alternate recursion levels remain, with quieter upper partials.')]),
  echoes: Object.freeze([option('shepard', 'Shepard tones', 'Overlapping wrapped registers supply a rising or falling source for the echoes.'), option('strikes', 'Sine strikes', 'Short pitched strikes make the delay intervals explicit.'), option('resonant', 'Bell partials', 'Ringing voices feed the geometric delay network.')]),
  texture: Object.freeze([option('noise', 'Filtered noise', 'Measured band energy shapes fresh filtered noise.'), option('resonant', 'Band oscillators', 'Sine oscillators at the band frequencies follow the measured spectral energy.'), option('hybrid', 'Noise + grains', 'The measured spectral texture combines with source grains.')]),
});
export const PARAM_HELP = Object.freeze({
  motionBranchTempo: 'Speed of automatic Branching travel. One beat is a complete up-and-down trip; negative tempo reverses the motion. Play and Pause beside Branching control it independently of phrase playback.',
  motionAngleTempo: 'Speed of automatic Branch angle rotation. One beat is one complete turn; negative tempo reverses the rotation. Its own Pause button holds the current angle.',
  motionRootTempo: 'Speed of automatic Root travel through its frequency range. One beat is a complete up-and-down trip, with equal travel for equal frequency ratios; negative tempo reverses the motion.',
  motionScanTempo: 'Speed of automatic Source scan. One beat scans the complete source and wraps to the beginning; negative tempo scans backward. Its own Pause button holds the current position.',
  motionTurnsTempo: 'Speed of automatic Turns motion through the circular 0–32 range. One beat makes a complete cycle; negative tempo reverses travel. Its own Pause button holds the current value.',
  motionIndexTempo: 'Speed of automatic Mod amount travel. One beat is a complete up-and-down trip through the range; negative tempo reverses motion. Its own Pause button holds the current amount.',
  lfo1Rate: 'Modulator speed in cycles per second. Pause freezes its cycle; Restart returns to the beginning.',
  lfo2Rate: 'Modulator speed in cycles per second. Pause freezes its cycle; Restart returns to the beginning.',
  lfo1Depth: 'Amount of movement around the destination knob’s manual value. Zero retains that value; full depth spans one turn for Branch angle.',
  lfo2Depth: 'Amount of movement around the destination knob’s manual value. Two modulators sent to the same parameter add together.',
  base: 'Reference frequency in hertz. The geometry multiplies this frequency continuously; no scale or note quantization is applied.',
  pitchInvert: 'Reflect geometric event pitches around Root. Shepard tones reverse their register contour; textures mirror their frequency bands around the spectrum’s logarithmic center and reverse pitch movement. Timing and stereo direction are unchanged.',
  timingBend: 'Bend the timing of the whole geometric score while retaining event order and phrase length. Positive values crowd attacks toward the beginning; negative values crowd them toward the end. Zero keeps the original timing.',
  shapeToMod: 'Add the vertical shape position to modulation amount. Positive values give lower graphic positions more modulation; negative values reverse that relationship. Zero keeps the fixed Mod amount. The result stays between zero and 32.',
  stereoWidth: 'Width of the finished stereo signal, including live input and delay tails. Zero sums both channels to mono, 100% keeps the original image, and 200% doubles the side signal. Output peak protection remains active.',
  stereoFlip: 'Swap the finished left and right channels, including live microphone processing and delay tails. This is independent of forward or reverse score playback. At zero Stereo width both channels are identical.',
  span: 'Pitch excursion in octaves. Larger values turn the same geometric height differences into wider frequency ratios.',
  ratio: 'Frequency ratio inside the FM or PM cascade. Fractional and irrational-looking ratios produce different sideband spacing and inharmonic color.',
  index: 'Depth of frequency or phase modulation. Increasing it adds spectral sidebands and more extreme motion inside each event.',
  roughness: 'Relative weight of fine detail. Values above one let smaller-scale structure dominate. Above 1.8, grain families also gain extra fine timing and angle variation.',
  depth: 'Number of recursive generations or spectral levels. Higher values add descendants, fine motion or upper partials. Dense graphs retain representatives of every generation; noise layers beyond 24 add seeded detail at the finest retained scale, and partials above the output frequency limit are omitted.',
  branch: 'Density of descendants and event opportunities. Zero gives the sparsest structure; larger values add clustered branches or subdivisions without extending the phrase. Above full texture density, additional subdivisions fold the band clocks into the phrase.',
  rate: 'Clock speed in beats per second. A phrase lasts Phrase divided by Pulse rate seconds; generations and subdivisions can create several attacks within one beat.',
  phrase: 'Length of one complete traversal in beats. Changing it changes the time available to the score without restarting the live playhead.',
  attack: 'Time from an event’s onset to its peak level. Very short attacks click or strike; longer attacks soften the entrance.',
  decay: 'Time for an event to fall from its attack peak toward its sustain level.',
  sustain: 'Level held after decay while the event’s gate remains open. Zero produces a transient; higher values maintain more body before release.',
  release: 'Time for the event to fall to silence after its gate closes. Longer values let adjacent gestures overlap.',
  memory: 'How much energy or continuity is retained across related events. It lengthens inherited shapes and strengthens feedback in the echo network.',
  space: 'Stereo spread and spatial tail level. Increasing it separates the position of related events and opens the surrounding field.',
  seed: 'Deterministic starting number for the structure. Returning to the same complete state reproduces its geometry and event ordering.',
  x: 'Horizontal gesture. Its meaning changes with the current mode and is shown by the mode’s horizontal gesture label.',
  y: 'Vertical gesture. Its meaning changes with the current mode and is shown by the mode’s vertical gesture label.',
  loop: 'Repeat the phrase. With Loop off, playback stops after one pass, or after an out-and-back trip when Ping-pong is on.',
  pingPong: 'Travel back along the score after reaching the far end. Direction chooses the initial orientation; each phrase is one leg.',
  direction: 'Forward or reverse traversal of the existing event score. In source and echo engines it also reverses the relevant reading or sweep direction.',
  glide: 'Time taken by a path voice to approach the next event’s target frequency. Zero keeps the attacks separate in pitch; longer times join them with bends.',
  chaos: 'Amount of bounded chaotic motion reaching the deepest path modulation stage. It also perturbs the geometric pitch path; zero leaves the correlated fractal path.',
  branchAngle: 'Rotate every branch bearing through a complete circle. Height and direction change together, shifting continuous pitch and Shape → modulation while preserving the branch family and its event times. The angle wraps smoothly after 360 degrees.',
  turns: 'Number of directional curls distributed across branch generations. It changes branch bearings, vertical displacement and the resulting continuous pitch relationships.',
  generationLoss: 'Energy removed at each branch generation. Zero retains the parent strength; one silences descendants after the first generation.',
  grainSize: 'Duration in seconds of a parent grain. Descendants inherit shorter windows, so changing this expands or contracts the whole grain family.',
  spray: 'Scatter around grain timing and position. Zero keeps clusters close to their deterministic skeleton; higher values spread their attacks and source detail.',
  scan: 'Position through the original, loaded or live source from which grain fragments begin. The cluster rotates to show the changed source region.',
  partialRatio: 'Multiplier between successive partial frequencies. Two gives octaves; other continuous values stretch or compress the spectral family.',
  fold: 'Number and strength of bends applied by the folded wave engine. It changes the source curve and creates upper spectral detail. It also bends live microphone input in the wave engines when that input is enabled.',
  echoTime: 'First delay interval in seconds. Later taps multiply it by Echo ratio, up to a maximum of 7.9 seconds per tap.',
  echoRatio: 'Multiplier from one delay interval to the next. Values below one crowd taps together; values above one spread them apart.',
  sweepRate: 'Speed in octaves per second of the continuously wrapped echo register. Direction chooses rising or falling motion.',
  bandQ: 'Focus of the texture noise filters. Low Q makes broad noisy bands; high Q makes narrow, more ringing bands. The Band oscillators engine does not use these filters.',
  tilt: 'Spectral balance from low to high bands. Positive values emphasize upper bands; negative values emphasize lower bands.',
  profileMemory: 'Time for measured live microphone energy to fade from the analysis. New attacks register quickly; longer memory retains the recent spectral character after they pass. Static source-file profiles are unchanged.',
  inputMix: 'Amount of live microphone input blended into the current engine’s musical process. The microphone must be enabled separately; this control does not enable a device, change Audio or alter loaded source files.',
  inputGain: 'Gain applied to live microphone input before its musical processing. It is independent of loaded source files and the instrument’s master output level.',
  engine: 'Selects a different synthesis mechanism while keeping the current geometric score, playhead and controls.',
  synthesis: 'FM changes oscillator frequency; PM changes oscillator phase. The same ratio and depth values therefore create different motion and sidebands.',
});
export function getParameterInfo(key, mode = 'wander') {
  const descriptor = PARAMS[key] || { label: { engine: 'Sound engine', synthesis: 'Modulation', pitchInvert: 'Invert pitch', stereoFlip: 'Flip L/R' }[key] || key, unit: '', group: ['pitchInvert', 'stereoFlip'].includes(key) ? 'Mapping' : 'Timbre' };
  const info = MODES.find(item => item.id === mode) || MODES[0];
  const label = key === 'x' ? info.gesture.x : key === 'y' ? info.gesture.y : descriptor.label;
  return { ...descriptor, label, description: PARAM_HELP[key] || '' };
}
const MODE_DEFAULTS = {
  wander: {},
  grammar: { base: 390, rate: 5.2, depth: 6, branch: .86, index: 2.5, roughness: .36, release: .12, memory: .16, x: .58, y: .56 },
  grains: { base: 320, rate: 4.7, branch: .85, depth: 5, attack: .001, decay: .04, sustain: .12, release: .045, roughness: .7, span: 2.3, x: .62, y: .48 },
  waveform: { base: 330, rate: 3.5, depth: 6, roughness: .6, index: 1.1, release: .16, ratio: 1.73, x: .35, y: .58 },
  echoes: { base: 440, rate: 3.2, depth: 6, memory: .54, span: 2.6, release: .13, ratio: 1.41, x: .55, y: .61 },
  texture: { base: 410, rate: 4, depth: 5, roughness: .76, branch: .77, index: .7, attack: .003, decay: .09, sustain: .2, release: .08, x: .42, y: .64 },
};
export function createDefaultState(mode = 'wander') {
  const chosen = Object.hasOwn(MODE_DEFAULTS, mode) ? mode : 'wander';
  return { mode: chosen, ...Object.fromEntries(Object.entries(PARAMS).map(([key, descriptor]) => [key, descriptor.default])), ...MODE_DEFAULTS[chosen], engine: ENGINE_OPTIONS[chosen][0].value, synthesis: 'pm', ...sanitizeModulatorState({}, chosen), ...sanitizeMotionState({}), pitchInvert: false, stereoFlip: false, loop: true, pingPong: false };
}
export function sanitizeState(value = {}) {
  const input = value && typeof value === 'object' ? value : {}, state = createDefaultState(input.mode);
  for (const [key, descriptor] of Object.entries(PARAMS)) {
    let n = key === 'branchAngle' ? wrapDegrees(number(input[key], state[key])) : clamp(number(input[key], state[key]), descriptor.min, descriptor.max);
    if (key === 'direction') n = n < 0 ? -1 : 1;
    else if (key === 'seed' || key === 'depth' || key === 'phrase') n = Math.round(n);
    state[key] = n;
  }
  Object.assign(state, sanitizeModulatorState(input, state.mode), sanitizeMotionState(input));
  state.pitchInvert = input.pitchInvert === true;
  state.stereoFlip = input.stereoFlip === true;
  state.loop = input.loop !== false;
  state.pingPong = input.pingPong === true;
  state.synthesis = input.synthesis === 'fm' ? 'fm' : 'pm';
  state.engine = ENGINE_OPTIONS[state.mode].some(item => item.value === input.engine) ? input.engine : ENGINE_OPTIONS[state.mode][0].value;
  return state;
}
function hash(index, seed) {
  let h = Math.imul(index | 0, 374761393) ^ Math.imul(seed | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise(t, seed) {
  const cell = Math.floor(t), f = fract(t), smooth = f * f * (3 - 2 * f);
  return (hash(cell, seed) * (1 - smooth) + hash(cell + 1, seed) * smooth) * 2 - 1;
}
export function fractalValue(t, seed = 1, roughness = .5, depth = 5) {
  const time = number(t, 0) % 1048576, levels = Math.round(clamp(number(depth, 5), 1, 48));
  const gain = .18 + .76 * clamp(number(roughness, .5), .01, 3);
  let total = 0, weight = 1, weights = 0;
  for (let level = 0; level < levels; level++) {
    // Beyond the retained octave scale, add independently seeded detail layers.
    // Ever-larger binary lattice coordinates collapse on the finite drawing grid.
    total += weight * noise(time * 2 ** Math.min(level, NOISE_OCTAVES - 1), number(seed, 1) + level * 1009);
    weights += weight; weight *= gain;
  }
  return clamp(total / weights, -1, 1);
}
/** Representative partial sum; a continuous partial ratio need not give a periodic one-cycle curve. */
export function waveformValue(t, state, maxHarmonic = Infinity) {
  let total = 0, weights = 0;
  for (let level = 0; level < state.depth; level++) {
    const harmonic = (state.partialRatio ?? 2) ** level;
    if (harmonic > maxHarmonic) break;
    if (state.engine === 'hollow' && level % 2) continue;
    const weight = (.20 + .68 * state.roughness) ** level / (state.engine === 'hollow' ? 1 + .45 * level : 1);
    const phase = level === 0 ? 0 : (state.x - .5) * level * 1.7 + state.index * .12 * Math.sin(level * state.ratio) + (state.seed % 97) / 97 * level * .4;
    total += weight * Math.sin(TAU * t * harmonic + phase); weights += weight;
  }
  const raw = weights ? total / weights : 0;
  return state.engine === 'folded' ? Math.asin(Math.sin(raw * (1 + state.fold * 2) * Math.PI / 2)) * 2 / Math.PI : raw;
}
function phaseFor(state, phase) {
  // A ping-pong leg has two distinct endpoints; its reverse origin cannot wrap.
  const mapped = state.timingBend ? clamp(phase, 0, .999999) ** (2 ** (2 * state.timingBend)) : phase;
  if (state.pingPong && state.direction < 0) return clamp(1 - mapped, 0, 1);
  return state.direction < 0 ? fract(1 - mapped) : clamp(mapped, 0, state.timingBend ? .9999999999 : .999999);
}
function pushPoint(out, x, y, depth = 0, phase = 0, parent = -1) {
  if (out.points.length >= MAX_POINTS) return -1;
  const id = out.points.length;
  out.points.push({ x: unit(x), y: unit(y), depth, phase: unit(phase) });
  if (parent >= 0 && parent < id) out.edges.push([parent, id]);
  return id;
}
function event(out, state, point, phase, pitch, amp = .7, duration = .1) {
  if (point < 0 || out.events.length >= MAX_EVENTS) return;
  const p = out.points[point], playedPhase = phaseFor(state, clamp(phase, 0, .999999));
  p.phase = playedPhase;
  out.events.push({ phase: playedPhase, freq: clamp(state.base * 2 ** ((state.pitchInvert ? -pitch : pitch) * state.span), 20, 20000), amp: unit(amp), duration: clamp(duration, .001, 16), pan: clamp((p.x - .5) * 2 * (.35 + state.space * .65), -1, 1), depth: p.depth, point });
}
function phraseGain(phase, state) { return .4 + .6 * (.5 + .5 * Math.cos(TAU * phase * (1 + Math.floor(state.phrase / 12)) + state.y * 2)); }
function selectedIndices(count, limit = MAX_EVENTS) {
  return new Set(Array.from({ length: Math.min(count, limit) }, (_, i) => count <= limit ? i : Math.round(i * (count - 1) / (limit - 1))));
}
function evenlyKeep(items, limit) {
  if (items.length <= limit) return items;
  return Array.from(selectedIndices(items.length, limit), index => items[index]);
}
function expandedPointCount(state, count, slots) {
  // Dense new-range scores keep a distinct graphic point for each selected
  // event. Existing ranges retain their original point grids and exact sounds.
  const expanded = state.depth > 24 || state.branch > 8 || state.roughness > 1.8 || state.turns > 12 || state.phrase > 128;
  return expanded ? Math.max(count, Math.min(MAX_POINTS, slots + 1)) : count;
}
function wander(state, out) {
  const requestedSlots = Math.max(2, Math.round(state.phrase * (1 + state.branch * 1.6)));
  const count = expandedPointCount(state, clamp(Math.round(state.phrase * 3 + state.depth * 22), 96, MAX_POINTS), requestedSlots);
  const travel = 1.5 + state.x * 9;
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const smooth = fractalValue(t * travel, state.seed, state.roughness, state.depth);
    const curl = Math.sin(TAU * t * (2.2 + state.x * 3.1) + smooth * 3) * state.chaos * .12;
    const value = clamp(smooth + curl, -1, 1);
    pushPoint(out, .06 + .88 * t, .5 + value * (.16 + state.y * .29), Math.min(state.depth, 1 + i % state.depth), phaseFor(state, t), i - 1);
  }
  const slots = state.branch <= 2.5 ? Math.min(requestedSlots, MAX_EVENTS) : requestedSlots;
  const density = clamp(.3 + state.branch * .25, .3, .9);
  for (const slot of selectedIndices(slots)) {
    // Deterministic missing attacks create actual rests, not merely a quieter continuous carrier.
    if (slot && hash(slot, state.seed + 601) > density) continue;
    const t = slot / slots, fast = fractalValue(t * travel * 3, state.seed + 41, state.roughness, state.depth);
    const phase = clamp(t + fast * .24 / slots * Math.min(state.branch, 1.5), 0, .999999);
    const point = Math.min(count - 1, Math.round(t * (count - 1)));
    const value = (out.points[point].y - .5) / (.16 + state.y * .29);
    event(out, state, point, phase, value * (.3 + state.y * .8), phraseGain(t, state) * (.62 + .18 * fast), (.16 + .27 * state.memory) / (state.rate * (1 + state.branch * .4)));
  }
}
function grammar(state, out, { turnsGeometry = false } = {}) {
  const prepareTurns = turnsGeometry || state.motionTurnsOn;
  const turnsPoints = prepareTurns ? [{ parent: -1, length: 0, bearingSlope: 0, bearingOffset: 0 }] : null;
  const raw = [{ x: 0, y: 0, yCos: 0, depth: 0, parent: -1, phase: 0, bearing: 0 }];
  let buds = [{ parent: 0, y: 0, yCos: 0, bearing: 0, token: 1 }];
  if (prepareTurns) Object.assign(buds[0], { bearingSlope: 0, bearingOffset: 0 });
  const contraction = .62 + state.y * .38;
  const steps = Array.from({ length: state.depth }, (_, d) => contraction ** d);
  const width = steps.reduce((a, b) => a + b, 0);
  let advance = 0;
  // Parallel graph form of X -> F[+X][-X]X. Retain F; rewrite only live X tips.
  // Reserve a budget for every remaining generation, then select tips evenly across the frontier.
  for (let generation = 1; generation <= state.depth; generation++) {
    const budget = Math.max(1, Math.floor((MAX_POINTS - raw.length) / (state.depth - generation + 1)));
    buds = evenlyKeep(buds, budget);
    const next = [];
    advance += steps[generation - 1];
    buds.forEach((bud, j) => {
      const bend = Math.sin(bud.bearing) * steps[generation - 1] * (.22 + state.x * .7);
      const y = bud.y + bend;
      const yCos = bud.yCos + Math.cos(bud.bearing) * steps[generation - 1] * (.22 + state.x * .7);
      const phase = (generation - 1 + .72 * j / Math.max(1, buds.length)) / state.depth;
      const parent = raw.length;
      raw.push({ x: advance / width, y, yCos, depth: generation, parent: bud.parent, phase, bearing: bud.bearing });
      if (prepareTurns) turnsPoints.push({ parent: bud.parent, length: steps[generation - 1] * (.22 + state.x * .7), bearingSlope: bud.bearingSlope, bearingOffset: bud.bearingOffset });
      // No unseen child frontier is needed after the final expanded generation.
      if (state.branch > 16 && generation === state.depth) return;
      // Radix 67 covers all 65 children above 16; old ranges keep their exact lineage.
      const children = 1 + Math.floor(state.branch) + (hash(bud.token, state.seed) < fract(state.branch) ? 1 : 0);
      for (let child = 0; child < children; child++) {
        const side = child === 0 ? 0 : child % 2 ? 1 : -1;
        const turn = TAU * state.turns / state.depth * (.3 + state.x * .7);
        const jitter = (hash(bud.token + child * 61, state.seed + 7) - .5) * state.roughness * .23;
        const nextBud = { parent, y, yCos, bearing: bud.bearing * .55 + turn * (side || .22) + jitter, token: (Math.imul(bud.token, state.branch > 16 ? 67 : state.branch > 8 ? 19 : state.branch > 2.5 ? 11 : 5) + child + 1) >>> 0 };
        if (prepareTurns) Object.assign(nextBud, {
          bearingSlope: bud.bearingSlope * .55 + TAU / state.depth * (.3 + state.x * .7) * (side || .22),
          bearingOffset: bud.bearingOffset * .55 + jitter,
        });
        next.push(nextBud);
      }
    });
    buds = next;
  }
  if (prepareTurns) out.branchTurns = { turns: state.turns, points: turnsPoints };
  out.branchGeometry = raw.map(p => ({ ySin: p.y, yCos: p.yCos, bearingSin: Math.sin(p.bearing), bearingCos: Math.cos(p.bearing) }));
  const frame = branchFrame(out.branchGeometry, state.branchAngle);
  const chosen = selectedIndices(raw.length - 1);
  raw.forEach((p, i) => {
    const x = .06 + p.x * .88, y = branchShape(out.branchGeometry, i, frame);
    const point = pushPoint(out, x, y, p.depth, phaseFor(state, p.phase), p.parent);
    if (i && chosen.has(i - 1)) {
      const amp = .78 * (1 - state.generationLoss) ** Math.max(0, p.depth - 1) * phraseGain(p.phase, state);
      event(out, state, point, p.phase, branchPitch(out.branchGeometry, i, frame), amp, (.18 + .7 * contraction ** p.depth) / state.rate);
    }
  });
}
function grains(state, out) {
  const extraRoughness = Math.max(0, state.roughness - 1.8);
  const nodes = [{ x: .5, y: .5, depth: 0, phase: 0, parent: -1, radius: .33, angle: (state.y + state.scan) * TAU, token: 1 }];
  let frontier = [0];
  for (let generation = 1; generation <= state.depth && state.branch > 0; generation++) {
    const candidates = [];
    for (const parent of frontier) {
      const node = nodes[parent], children = 1 + Math.floor(state.branch * 1.4) + (hash(node.token, state.seed) < fract(state.branch * 1.4) ? 1 : 0);
      for (let j = 0; j < children; j++) {
        // Up to 91 grain children need distinct digits before the bounded 32-bit hash.
        const radix = state.branch > 16 ? 97 : state.branch > 8 ? 29 : state.branch > 2.5 ? 17 : 7;
        const token = (Math.imul(node.token, radix) + j + 1) >>> 0;
        const random = hash(token - 1, state.seed + 17);
        let angle = node.angle + (j - (children - 1) / 2) * (1 + state.y * 2.5) + (random - .5) * state.spray * 3;
        if (extraRoughness) angle += (random - .5) * extraRoughness * .8;
        const radius = node.radius * (.7 + random * state.spray);
        let phase = fract(node.phase + (.03 + .25 * state.x) * (j + .5 + (random - .5) * state.spray) * .57 ** node.depth);
        if (extraRoughness) phase = fract(phase + (random - .5) * extraRoughness * .08 * .57 ** node.depth);
        candidates.push({ x: unit(node.x + Math.cos(angle) * radius), y: unit(node.y + Math.sin(angle) * radius), depth: generation, parent, radius: node.radius * (.32 + .27 * state.y), angle, token, phase });
      }
    }
    const budget = Math.max(1, Math.floor((MAX_POINTS - nodes.length) / (state.depth - generation + 1)));
    frontier = [];
    for (const child of evenlyKeep(candidates, budget)) { frontier.push(nodes.length); nodes.push(child); }
  }
  const chosen = selectedIndices(nodes.length);
  nodes.forEach((node, i) => {
    const point = pushPoint(out, node.x, node.y, node.depth, phaseFor(state, node.phase), node.parent);
    if (chosen.has(i)) event(out, state, point, node.phase, (node.y - .5) * 1.8 + (state.y - .5) * .4 + node.depth * .045, (.56 + .18 * hash(i, state.seed)) * (.82 + state.memory * .17) ** node.depth, state.grainSize * (.55 + state.memory * .27) ** node.depth);
  });
}
function waveform(state, out) {
  const requestedSlots = Math.max(2, Math.round(state.phrase * (1 + state.branch * 1.7)));
  const count = expandedPointCount(state, Math.min(MAX_POINTS, 384 + state.depth * 32), requestedSlots), maxHarmonic = Math.min((count - 1) / 2, 20000 / state.base);
  out.waveform = Array.from({ length: count }, (_, i) => waveformValue(i / (count - 1), state, maxHarmonic));
  out.waveform.forEach((value, i) => pushPoint(out, .055 + .89 * i / (count - 1), .5 + value * .34 + (state.y - .5) * .1, 1 + i % state.depth, phaseFor(state, i / count), i - 1));
  const slots = state.branch <= 2.5 ? Math.min(requestedSlots, MAX_EVENTS) : requestedSlots;
  for (const i of selectedIndices(slots)) {
    const phase = i / slots, point = Math.min(count - 1, Math.round(phase * (count - 1)));
    if (i && hash(i, state.seed + 91) > .5 + Math.min(.45, state.branch * .22)) continue;
    event(out, state, point, phase, out.waveform[point] * .65 + state.y - .5, .68 * phraseGain(phase, state), (.17 + state.memory * .32) / state.rate);
  }
}
function echoes(state, out) {
  const anchorLimit = Math.max(1, Math.floor(MAX_EVENTS / (state.depth + 1)));
  const requestedAnchors = Math.max(1, Math.ceil(state.phrase * (.3 + state.branch * .25)));
  const anchors = state.branch <= 2.5 ? Math.min(requestedAnchors, anchorLimit) : requestedAnchors;
  const seconds = state.phrase / state.rate;
  for (const anchor of selectedIndices(anchors, anchorLimit)) {
    let parent = -1;
    for (let d = 0; d <= state.depth; d++) {
      const delay = d ? clamp(state.echoTime * state.echoRatio ** (d - 1), .002, 7.9) : 0;
      const forwardPhase = fract(anchor / anchors + delay / seconds);
      const angle = state.direction * ((anchor / anchors) * TAU + d * (.3 + state.y * 1.6)) + state.seed % 31 * .1;
      const radius = .44 * (.57 + state.memory * .34) ** (d / (1.5 + state.x * 3));
      const point = pushPoint(out, .5 + radius * Math.cos(angle), .5 + radius * Math.sin(angle), d, phaseFor(state, forwardPhase), parent);
      const register = fract((anchor / anchors * seconds + delay) * state.sweepRate * state.direction / Math.max(.125, state.span) + state.y);
      event(out, state, point, forwardPhase, (register - .5) * 1.7, .74 * (.22 + .78 * Math.sin(Math.PI * register) ** 2) * (.53 + state.memory * .46) ** d, (.12 + state.memory * .32) / state.rate);
      parent = point;
    }
  }
}
function texture(state, out) {
  const bands = 16, columns = clamp(12 + state.depth * 2, 12, 48);
  // Once every grid cell can trigger, more branching folds finer time divisions
  // into the same bounded score instead of increasing the voice/event budgets.
  const subdivisions = 1 + Math.max(0, state.branch - 2.5);
  const candidates = [];
  for (let band = 0; band < bands; band++) {
    for (let i = 0; i < columns; i++) {
      const t = i / columns, value = fractalValue(t * subdivisions * (1 + state.x * 7), state.seed + band * 83, state.roughness, state.depth);
      const y = .08 + .84 * (band + .5) / bands + value * .026 * (.25 + state.y) / (1 + state.bandQ * .08);
      const phase = fract(t * subdivisions + band * (.004 + .013 * state.x));
      const point = pushPoint(out, .06 + .88 * i / (columns - 1), y, 1 + band % state.depth, phaseFor(state, phase), i ? out.points.length - 1 : -1);
      if ((i + band) % Math.max(1, Math.round(4 - state.branch)) === 0) candidates.push({ point, phase, band, value });
    }
  }
  for (const item of evenlyKeep(candidates, MAX_EVENTS)) {
    const energy = (.55 + item.value * .4) ** (1.7 - state.y), tilt = 2 ** (state.tilt * (item.band / 15 - .5));
    event(out, state, item.point, item.phase, (item.band / 15 - .5) * 1.7 + item.value * .12, Math.min(.9, energy * .48 * tilt), (.065 + state.memory * .24) / state.rate);
  }
}
const GENERATORS = { wander, grammar, grains, waveform, echoes, texture };
export function generateStructure(input, options = {}) {
  const state = sanitizeState(input), out = { points: [], edges: [], events: [] };
  GENERATORS[state.mode](state, out, options);
  out.events.sort((a, b) => a.phase - b.phase || a.point - b.point);
  if (state.pingPong && out.events.length) {
    // The first and last retained attacks own the two turns. Reflecting at an
    // empty phrase margin would sound the terminal attack a second time.
    const first = out.events[0].phase, span = out.events.at(-1).phase - first;
    const position = phase => span > 0 ? clamp((phase - first) / span, 0, 1) : 0;
    for (const point of out.points) point.phase = position(point.phase);
    for (const event of out.events) event.phase = position(event.phase);
  }
  return out;
}

function fft(real, imaginary) {
  const size = real.length;
  for (let i = 1, j = 0; i < size; i++) {
    let bit = size >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [real[i], real[j]] = [real[j], real[i]]; [imaginary[i], imaginary[j]] = [imaginary[j], imaginary[i]]; }
  }
  for (let width = 2; width <= size; width *= 2) {
    const angle = -TAU / width, wr = Math.cos(angle), wi = Math.sin(angle);
    for (let start = 0; start < size; start += width) {
      let xr = 1, xi = 0;
      for (let j = 0; j < width / 2; j++) {
        const a = start + j, b = a + width / 2;
        const tr = xr * real[b] - xi * imaginary[b], ti = xr * imaginary[b] + xi * real[b];
        real[b] = real[a] - tr; imaginary[b] = imaginary[a] - ti;
        real[a] += tr; imaginary[a] += ti;
        const nextR = xr * wr - xi * wi; xi = xr * wi + xi * wr; xr = nextR;
      }
    }
  }
}
/** Measured short-time spectrum/envelope, used as a synthesis guide, not a source reconstruction.
 * Bands are energy sums around 16 log-spaced 40..12000 Hz centers. Slope fits power density.
 * At most 24 FFT windows and 64*1024 envelope samples bound long-file analysis work.
 */
export function analyzeTexture(samples, sampleRate = 48000) {
  const length = Math.max(0, Math.floor(number(samples?.length, 0)));
  const sr = clamp(number(sampleRate, 48000), 1000, 384000);
  const bands = Array(16).fill(0), envelope = Array(64).fill(0), counts = Array(16).fill(0);
  const empty = () => ({ bands, envelope, slope: 0, roughness: .5 });
  if (length < 2) return empty();
  const sample = i => clamp(number(samples[Math.min(length - 1, Math.max(0, i))], 0), -8, 8);
  for (let cell = 0; cell < 64; cell++) {
    const begin = Math.floor(cell * length / 64), end = Math.max(begin + 1, Math.floor((cell + 1) * length / 64));
    const step = Math.max(1, Math.floor((end - begin) / 1024));
    let sum = 0, n = 0;
    for (let i = begin; i < end; i += step) { sum += sample(i) ** 2; n++; }
    envelope[cell] = Math.sqrt(sum / Math.max(1, n));
  }
  const peakEnvelope = Math.max(...envelope);
  if (peakEnvelope < 1e-12) return empty();
  for (let i = 0; i < 64; i++) envelope[i] /= peakEnvelope;
  const size = Math.min(4096, 2 ** Math.max(5, Math.floor(Math.log2(length))));
  const frames = Math.min(24, Math.max(1, Math.ceil(length / size)));
  const centers = Array.from({ length: 16 }, (_, i) => 40 * (12000 / 40) ** (i / 15));
  const lower = centers[0] / Math.sqrt(centers[1] / centers[0]);
  const upper = centers[15] * Math.sqrt(centers[1] / centers[0]);
  for (let frame = 0; frame < frames; frame++) {
    const start = Math.round((length - Math.min(size, length)) * frame / Math.max(1, frames - 1));
    const real = new Float64Array(size), imaginary = new Float64Array(size);
    for (let i = 0; i < size; i++) real[i] = (start + i < length ? sample(start + i) : 0) * (.5 - .5 * Math.cos(TAU * i / (size - 1)));
    fft(real, imaginary);
    for (let bin = 1; bin < size / 2; bin++) {
      const freq = bin * sr / size;
      if (freq < lower || freq > upper) continue;
      const band = clamp(Math.round(Math.log(freq / 40) / Math.log(300) * 15), 0, 15);
      bands[band] += real[bin] ** 2 + imaginary[bin] ** 2; counts[band]++;
    }
  }
  const maximum = Math.max(...bands);
  if (maximum < 1e-20) return { bands: bands.map(() => 0), envelope, slope: 0, roughness: .5 };
  let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0;
  for (let i = 0; i < 16; i++) {
    if (!counts[i]) continue;
    const x = Math.log(centers[i]), y = Math.log(Math.max(bands[i] / counts[i], maximum * 1e-12));
    sx += x; sy += y; sxx += x * x; sxy += x * y; n++;
  }
  const denominator = n * sxx - sx * sx;
  const slope = clamp(denominator ? (n * sxy - sx * sy) / denominator : 0, -4, 4);
  return { bands: bands.map(energy => energy / maximum), envelope, slope, roughness: clamp(.5 + slope * .16, .05, .95) };
}
