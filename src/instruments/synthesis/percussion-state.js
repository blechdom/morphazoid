/**
 * Original percussion technique studies, not circuit/ROM/hardware emulations.
 * Dates identify the reference instruments, not the invention of a DSP method.
 * PCM voices use original procedurally authored one-shots; no factory samples.
 * This module owns musical snapshots only: never Audio, transport or devices.
 */
export const PERCUSSION_LANES = Object.freeze([
  'Kick', 'Snare', 'Closed hat', 'Open hat', 'Low tom', 'High tom', 'Clap', 'Metal',
]);
export const PERCUSSION_STEP_COUNT = 16;
export const PERCUSSION_VOICE_RANGES = Object.freeze(Object.fromEntries(Object.entries({
  model: [0, 5], frequency: [20, 8000], decay: [.03, 3], tone: [0, 1], noise: [0, 1],
  sweep: [-24, 48], ratio: [.125, 16], index: [0, 20], level: [0, 1], pan: [-1, 1],
}).map(([key, bounds]) => [key, Object.freeze(bounds)])));

const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
const finite = (value, fallback) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value === 'string' && value.trim() && value.length < 64) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return fallback;
};
const bound = (value, lo, hi, fallback) => Math.min(hi, Math.max(lo, finite(value, fallback)));
const rounded = value => Number(value.toFixed(6));
const voice = ([model, frequency, decay, tone, noise, sweep = 0, ratio = 1, index = 0, level = .65, pan = 0]) =>
  ({ model, frequency, decay, tone, noise, sweep, ratio, index, level, pan });
const kit = (id, label, voices) => ({ id, label, voices });
const vary = (voices, changes) => voices.map((value, lane) => ({ ...value, ...changes(value, lane) }));
const rhythm = (id, label, rows) => ({ id, label, lanes: Array.from({ length: 8 }, (_, lane) =>
  Array.from({ length: 16 }, (_, step) => ({ X: .95, x: .72, '+': .48, o: .28 }[rows[lane]?.[step]] ?? 0))) });
const source = (label, url) => ({ label, url });

const analog = [
  [0, 52, .48, .38, .015, 8, 1, 0, .86, 0],
  [0, 178, .19, .6, .74, 2, 1.47, 0, .66, 0],
  [1, 4900, .055, .88, .36, 0, 1.48, 0, .37, -.16],
  [1, 4500, .31, .8, .28, 0, 1.48, 0, .34, .18],
  [0, 105, .24, .39, .035, 4, 1, 0, .66, -.24],
  [0, 167, .19, .48, .035, 4, 1, 0, .59, .25],
  [1, 1400, .12, .64, .95, 0, 1, 0, .46, .05],
  [1, 560, .2, .68, .08, 0, 1.48, 0, .43, .28],
].map(voice);
const pcm = [
  [5, 62, .27, .56, .1, 0, 1, 0, .82, 0],
  [5, 205, .19, .68, .68, 0, 1, 0, .65, 0],
  [5, 5400, .055, .77, .82, 0, 1, 0, .34, -.18],
  [5, 5100, .27, .7, .8, 0, 1, 0, .31, -.12],
  [5, 112, .29, .49, .08, 0, 1, 0, .67, -.27],
  [5, 178, .23, .56, .08, 0, 1, 0, .61, .28],
  [5, 1250, .14, .71, .88, 0, 1, 0, .47, .12],
  [5, 810, .38, .73, .22, 0, 1, 0, .42, .3],
].map(voice);
const swept = [
  [2, 58, .3, .4, .12, 19, 1, 0, .8, 0],
  [2, 186, .19, .67, .68, 8, 1, 0, .66, 0],
  [1, 4800, .055, .83, .8, 0, 1.7, 0, .32, -.14],
  [1, 4100, .24, .76, .7, 0, 1.7, 0, .31, .15],
  [2, 102, .38, .37, .14, 21, 1, 0, .7, -.3],
  [2, 170, .3, .49, .1, 24, 1, 0, .64, .3],
  [2, 340, .14, .79, .94, 2, 1, 0, .46, .1],
  [2, 480, .28, .56, .2, 32, 1, 0, .4, -.15],
].map(voice);
const hybrid = [
  [0, 57, .32, .7, .06, 13, 1, 0, .84, 0],
  [0, 190, .18, .75, .77, 4, 1.8, 0, .64, 0],
  [5, 6100, .06, .85, .75, 0, 1, 0, .32, -.14],
  [5, 5600, .33, .78, .68, 0, 1, 0, .31, -.08],
  [0, 117, .26, .57, .03, 6, 1, 0, .66, -.25],
  [0, 190, .19, .68, .03, 7, 1, 0, .6, .25],
  [1, 1600, .14, .8, .94, 0, 1, 0, .43, .1],
  [5, 1180, .56, .77, .2, 0, 1, 0, .36, .24],
].map(voice);
const modal = [
  [4, 65, .42, .26, .16, 0, 1.59, 0, .8, 0],
  [4, 206, .26, .58, .48, 0, 1.59, 0, .64, 0],
  [4, 1730, .07, .91, .32, 0, 2.76, 0, .32, -.2],
  [4, 1250, .44, .8, .21, 0, 2.76, 0, .34, .15],
  [4, 119, .5, .36, .12, 0, 1.59, 0, .65, -.25],
  [4, 193, .38, .48, .09, 0, 1.59, 0, .59, .25],
  [4, 570, .12, .68, .6, 0, 2.3, 0, .45, .12],
  [4, 411, .95, .85, .045, 0, 2.76, 0, .41, -.12],
].map(voice);
const fm = [
  [3, 54, .32, .49, .01, 11, 1, 3.8, .8, 0],
  [3, 188, .21, .61, .39, 2, 1.71, 7.1, .64, 0],
  [3, 1760, .06, .88, .13, 0, 3.47, 9.5, .31, -.18],
  [3, 1470, .32, .79, .09, 0, 2.71, 8.8, .31, .16],
  [3, 108, .37, .41, .01, 7, 1.38, 3.2, .64, -.25],
  [3, 177, .27, .5, .01, 9, 1.62, 4.1, .58, .25],
  [3, 370, .13, .77, .58, 1, 3.3, 8.7, .43, .1],
  [3, 631, .66, .75, .015, 0, 2.76, 5.6, .4, -.12],
].map(voice);

export const PERCUSSION_METHODS = freeze([
  {
    id: 'analog808', label: 'Analog rhythm composer · TR-808', date: '1980',
    description: 'Roland introduced the TR-808 in 1980 with synthesized percussion and step programming. This original study combines decaying oscillators, pitch transients and filtered noise; it is not a circuit-accurate TR-808 emulation. Its kits and rhythm patterns are newly authored.',
    sources: [source('Roland — The TR-808 Story', 'https://www.roland.com/uk/promos/roland_tr-808/')],
    controls: ['frequency', 'decay', 'tone', 'noise', 'sweep', 'level', 'pan'],
    kits: [
      kit('compact-circuit', 'Compact circuit', analog),
      kit('sub-and-cowbell', 'Sub and cowbell', vary(analog, (v, lane) => ({
        frequency: v.frequency * (lane === 0 ? .79 : lane === 7 ? .88 : 1.07),
        decay: v.decay * (lane === 0 ? 2.7 : lane === 7 ? 2.1 : .76), tone: v.tone * .8,
        level: lane === 7 ? .57 : v.level,
      }))),
      kit('dry-tin-miniatures', 'Dry tin miniatures', vary(analog, (v, lane) => ({
        frequency: Math.min(7600, v.frequency * (lane < 2 ? 1.44 : 1.21)),
        decay: Math.max(.035, v.decay * .4), tone: Math.min(.98, v.tone + .16),
        sweep: lane === 0 || lane === 4 || lane === 5 ? 2 : 0, noise: Math.min(.98, v.noise + .12),
      }))),
    ],
    rhythms: [
      rhythm('electro-syncopation', 'Electro syncopation', ['X.....x...x.....', '....X.......X...', 'x.x.+.x.x.x.+.x.', '.......x.......x', '............x...', '..............x.', '....+.......+...', '...+......+.....']),
      rhythm('sub-half-time', 'Sub half-time', ['X.........x..+..', '........X.......', 'x.+.x.+.x.+.x.+.', '......x.......x.', '...............x', '.............+..', '........+.......', '...x.......+....']),
      rhythm('clave-machinery', 'Clave machinery', ['X...+...X...+...', '....x.......x...', 'x...x...x...x...', '..+.......+.....', '......+.......+.', '.......+.......+', '....+.......+...', 'X..x..x...x.x...']),
    ],
  },
  {
    id: 'pcm-lm1', label: 'PCM drum computer · LM-1', date: '1980',
    description: 'Roger Linn released the LM-1 in 1980 after demonstrating its prototype in 1979. It sequenced short digital drum recordings. This study plays original procedurally authored one-shots from PCM buffers, not Linn factory samples, with tuning, decay and playback tone controls.',
    sources: [source('Roger Linn — LM-1 development and release', 'https://www.rogerlinndesign.com/about/roger-faq')],
    controls: ['frequency', 'decay', 'tone', 'level', 'pan'],
    kits: [
      kit('short-room-one-shots', 'Short room one-shots', pcm),
      kit('low-clock-studio', 'Low-clock studio', vary(pcm, (v, lane) => ({
        frequency: v.frequency * (lane < 2 ? .72 : .79), decay: v.decay * 1.65,
        tone: v.tone * .63,
      }))),
      kit('clipped-pocket-kit', 'Clipped pocket kit', vary(pcm, (v, lane) => ({
        frequency: Math.min(7800, v.frequency * (lane === 4 || lane === 5 ? 1.6 : 1.12)),
        decay: Math.max(.035, v.decay * .38), tone: Math.min(.98, v.tone + .19),
      }))),
    ],
    rhythms: [
      rhythm('studio-backbeat', 'Studio backbeat', ['X.......X.x.....', '....X.......X...', 'x.+.x.+.x.+.x.+.', '...............+', '..............+.', '.............+..', '....+.......+...', '................']),
      rhythm('ghost-pocket', 'Ghost-note pocket', ['X.....+...X.....', '...oX..o...oX.+.', 'x+x+x+x+x+x+x+x+', '..............x.', '...............+', '......+.........', '............+...', '..+.......+.....']),
      rhythm('tom-turnaround', 'Tom turnaround', ['X.......x.......', '....X.......+...', 'x.x.x.x.x.x.....', '..........x.....', '............X.x.', '.............x.x', '....+...........', '.......+........']),
    ],
  },
  {
    id: 'swept-sdsv', label: 'Swept electronic pads · SDS-V', date: '1981',
    description: 'The 1981 Simmons SDS-V paired playable pads with modular electronic drum voices. Pitch bend, noise/tone balance and decay made its toms distinctive; the historical system also offered sampled cymbal tones. This original oscillator/noise study does not reproduce its circuitry or cymbal ROMs.',
    sources: [source('Simmons — SDS-V (1981)', 'https://simmonsdrums.net/sound-library-electronic-kits'),
      source('Simmons SDS-V original operating manual', 'https://www.manualslib.com/manual/4355803/Simmons-Sds-V.html')],
    controls: ['frequency', 'decay', 'sweep', 'noise', 'tone', 'level', 'pan'],
    kits: [
      kit('hexagonal-thumps', 'Hexagonal thumps', swept),
      kit('long-laser-toms', 'Long laser toms', vary(swept, (v, lane) => ({
        decay: v.decay * (lane === 4 || lane === 5 || lane === 7 ? 2.5 : .82),
        sweep: v.model === 2 ? Math.min(46, v.sweep * 1.65 + 4) : 0,
        noise: v.model === 2 ? v.noise * .32 : v.noise, tone: v.tone * .85,
      }))),
      kit('reverse-rubber', 'Reverse rubber', vary(swept, (v, lane) => ({
        frequency: v.frequency * (lane === 4 || lane === 5 ? 1.34 : .89),
        sweep: v.model === 2 ? -(4 + v.sweep * .43) : 0,
        decay: Math.max(.04, v.decay * .58), noise: v.noise * .6,
      }))),
    ],
    rhythms: [
      rhythm('alternating-pads', 'Alternating pads', ['X.......X.......', '....x.......x...', 'x...+...x...+...', '......+.......+.', '..x.......x.....', '...x.......x....', '............+...', '.......+.......+']),
      rhythm('tom-cascade', 'Tom cascade', ['X.......+.......', '....x...........', 'x...x...x.......', '................', '......x...x...X.', '.......x...x...X', '............+...', '..+.............']),
      rhythm('offbeat-zaps', 'Offbeat zaps', ['X.....x...X.....', '....+.......x...', 'x.x.x.x.x.x.x.x.', '.......+.......+', '...x.......x....', '.....+.......+..', '............+...', '.x.......x......']),
    ],
  },
  {
    id: 'hybrid909', label: 'Analog / PCM rhythm · TR-909', date: '1983',
    description: 'Roland introduced the TR-909 in 1983, combining analog drum voices with digitally sampled hi-hats and cymbals. This original hybrid study likewise separates oscillator/noise drums from PCM metal one-shots. Its recordings are procedurally authored, not Roland samples; the circuit and sequencer are not exact emulations.',
    sources: [source('Roland — The TR-909 Story', 'https://www.roland.com/uk/promos/roland_tr-909/')],
    controls: ['frequency', 'decay', 'tone', 'noise', 'sweep', 'level', 'pan'],
    kits: [
      kit('short-machine-punch', 'Short machine punch', hybrid),
      kit('ringing-metal-tails', 'Ringing metal tails', vary(hybrid, (v, lane) => ({
        decay: v.decay * (v.model === 5 ? 2.7 : .72),
        frequency: v.frequency * (v.model === 5 ? .81 : 1.06),
        tone: lane === 0 ? .84 : v.tone, level: v.model === 5 ? v.level * .84 : v.level,
      }))),
      kit('low-tom-pressure', 'Low tom pressure', vary(hybrid, (v, lane) => ({
        frequency: v.frequency * (lane === 4 || lane === 5 ? .66 : .91),
        decay: v.decay * (lane === 4 || lane === 5 ? 2.2 : .65),
        sweep: lane === 0 || lane === 4 || lane === 5 ? 16 : v.sweep,
        level: lane === 4 || lane === 5 ? .73 : v.level,
      }))),
    ],
    rhythms: [
      rhythm('four-to-the-floor', 'Four to the floor', ['X...X...X...X...', '....x.......x...', 'x.x.x.x.x.x.x.x.', '..+...+...+...+.', '..............+.', '...............+', '....+.......+...', 'x.......+.......']),
      rhythm('shuffle-machine', 'Shuffle machine', ['X...+...X.....x.', '....X.......X...', 'x+x+x+x+x+x+x+x+', '......x.......x.', '.......+........', '...............+', '....+.......+...', '..+.......+.....']),
      rhythm('broken-machine', 'Broken machine', ['X..+..X...x..+..', '....X......+X...', 'x.x.+.x.x.+.x.x.', '.......x.......x', '..+.......+.....', '..............x.', '....+.......+...', '.....+.......+..']),
    ],
  },
  {
    id: 'modal-wavedrum', label: 'Modeled percussion · Wavedrum lineage', date: '1994',
    description: 'The original Korg Wavedrum debuted in 1994 and explored expressive electronic percussion. This independent modal study uses decaying partials with a separate noise transient for membrane, wood and metal-like bodies. It is not the Wavedrum DSP, its acoustic pickup system, or its later PCM library; 1994 dates the reference instrument, not modal synthesis.',
    sources: [source('Korg — Wavedrum history', 'https://www.korg.com/se/products/drums/wavedrum_global_edition/'),
      source('Korg — head, rim and pressure interaction', 'https://www.korg.com/sg/products/drums/wavedrum_global_edition/page_1.php')],
    controls: ['frequency', 'decay', 'tone', 'noise', 'level', 'pan'],
    kits: [
      kit('taut-membranes', 'Taut membranes', modal),
      kit('wooden-knuckles', 'Wooden knuckles', vary(modal, (v, lane) => ({
        frequency: v.frequency * (lane < 2 ? 2.2 : 1.31),
        decay: Math.max(.035, v.decay * .23), tone: v.tone * .45,
        noise: v.noise * .5,
      }))),
      kit('bronze-and-bowls', 'Bronze and bowls', vary(modal, (v, lane) => ({
        frequency: v.frequency * (lane < 2 ? 1.23 : .74),
        decay: Math.min(2.8, v.decay * 2.6), tone: Math.min(.98, v.tone + .25),
        noise: v.noise * .27,
        level: v.level * .84,
      }))),
    ],
    rhythms: [
      rhythm('head-rim-exchange', 'Low / high exchange', ['X.....x...x.....', '...+.....+.....+', '....+.......+...', '.......+........', '..x.......x.....', '.....+.......+..', '............+...', '........x.......']),
      rhythm('spaced-resonances', 'Spaced resonances', ['X...............', '........+.......', '................', '......+.........', '....x...........', '.............+..', '...........o....', '..x.......+.....']),
      rhythm('wooden-interlock', 'Wooden interlock', ['X.......x.......', '....+.......+...', 'x..x..x..x..x...', '..............+.', '..x....x....x...', '.....x....x....x', '...+.......+....', '......+.......+.']),
    ],
  },
  {
    id: 'fm-cycles', label: 'FM percussion machines · Model:Cycles lineage', date: '2020',
    description: 'Elektron introduced Model:Cycles in 2020 with six FM-based percussive and melodic machines. This independent FM/noise study exposes carrier pitch, modulator ratio, index and decay rather than reproducing those proprietary machines or factory presets. FM synthesis predates this instrument by decades.',
    sources: [source('Elektron — Model:Cycles launch, 26 February 2020', 'https://www.elektronauts.com/t/model-cycles/122478'),
      source('Elektron — Model:Cycles user manual', 'https://www.elektron.se/wp-content/uploads/2024/10/Model-Cycles-User-Manual_ENG_OS1.13_241030.pdf')],
    controls: ['frequency', 'decay', 'ratio', 'index', 'sweep', 'tone', 'noise', 'level', 'pan'],
    kits: [
      kit('rubber-operators', 'Rubber operators', fm),
      kit('glass-components', 'Glass components', vary(fm, (v, lane) => ({
        frequency: v.frequency * (lane < 2 ? 1.45 : .86), ratio: lane < 2 ? 2.76 : 3.37,
        index: v.index * .48, decay: Math.min(2.4, v.decay * 2.4),
        noise: v.noise * .16, sweep: 0, tone: Math.min(.98, v.tone + .13),
      }))),
      kit('fractured-metal', 'Fractured metal', vary(fm, (v, lane) => ({
        frequency: v.frequency * (lane < 2 ? .84 : 1.29), ratio: 1.43 + lane * .37,
        index: Math.min(16, v.index * 1.5 + 2), decay: Math.max(.04, v.decay * .57),
        noise: Math.min(.72, v.noise + .17), sweep: lane < 2 ? 17 : -3,
      }))),
    ],
    rhythms: [
      rhythm('operator-displacement', 'Operator displacement', ['X.....x...X.....', '....x.......x...', 'x.x.x.x.x.x.x.x.', '.......+.......+', '...x.....x......', '......+......+..', '............+...', '..+..+.....+..+.']),
      rhythm('metal-gaps', 'Metal gaps', ['X.........x.....', '......+.....x...', 'x..x..x..x..x..x', '..............+.', '....+...........', '...........+....', '........+.......', '..x.....x....x..']),
      rhythm('bell-displacement', 'Bell displacement', ['X.......+.......', '....+.......+...', 'x...x...x...x...', '................', '..x....x....x...', '.....x....x....x', '..........+.....', 'x..+..x..+..x..+']),
    ],
  },
]);

/** Unknown methods recover to the first playable family. */
export function getPercussionMethod(id) {
  return PERCUSSION_METHODS.find(method => method.id === id) || PERCUSSION_METHODS[0];
}

function sanitizeVoice(value, fallback) {
  const candidate = value && typeof value === 'object' ? value : {};
  return Object.fromEntries(Object.entries(PERCUSSION_VOICE_RANGES).map(([key, [lo, hi]]) => {
    const number = bound(candidate[key], lo, hi, fallback[key]);
    return [key, key === 'model' ? Math.round(number) : number];
  }));
}

/** Always detached, dense, bounded, and limited to serializable musical state. */
export function sanitizePercussionState(value = {}) {
  const raw = value && typeof value === 'object' ? value : {};
  const method = getPercussionMethod(raw.methodId);
  const chosenKit = method.kits.find(item => item.id === raw.kitId) || method.kits[0];
  const chosenRhythm = method.rhythms.find(item => item.id === raw.rhythmId) || method.rhythms[0];
  return {
    version: 1, methodId: method.id,
    kitId: raw.kitId === 'custom' ? 'custom' : chosenKit.id,
    rhythmId: raw.rhythmId === 'custom' ? 'custom' : chosenRhythm.id,
    voices: Array.from({ length: 8 }, (_, lane) => sanitizeVoice(raw.voices?.[lane], chosenKit.voices[lane])),
    steps: Array.from({ length: 8 }, (_, lane) => Array.from({ length: 16 }, (_, step) =>
      bound(raw.steps?.[lane]?.[step], 0, 1, chosenRhythm.lanes[lane][step]))),
    swing: bound(raw.swing, 0, .45, 0),
    selectedLane: Math.round(bound(raw.selectedLane, 0, 7, 0)),
  };
}

export function createPercussionState(methodId = PERCUSSION_METHODS[0].id) {
  return sanitizePercussionState({ methodId });
}

/** Sound recall never overwrites an edited beat or its swing. */
export function applyPercussionKit(state, id) {
  const current = sanitizePercussionState(state);
  const selected = getPercussionMethod(current.methodId).kits.find(item => item.id === id);
  return selected ? sanitizePercussionState({ ...current, kitId: selected.id, voices: selected.voices }) : current;
}

/** Rhythm recall never overwrites an edited kit or its spatial balance. */
export function applyPercussionRhythm(state, id) {
  const current = sanitizePercussionState(state);
  const selected = getPercussionMethod(current.methodId).rhythms.find(item => item.id === id);
  return selected ? sanitizePercussionState({ ...current, rhythmId: selected.id, steps: selected.lanes }) : current;
}

const randomSource = rng => () => bound(typeof rng === 'function' ? rng() : Math.random(), 0, .999999999, .5);

/** Generate a fresh playable parameter set inside the selected technique.
 * Fixed model IDs preserve the method's synthesis identity; every exposed
 * voice parameter is generated, not a random choice among factory kits.
 */
export function randomizePercussionKit(state, rng = Math.random) {
  const current = sanitizePercussionState(state), method = getPercussionMethod(current.methodId);
  const random = randomSource(rng), span = (lo, hi) => rounded(lo + (hi - lo) * random());
  const logSpan = (lo, hi) => rounded(lo * (hi / lo) ** random());
  const registers = [[38, 90], [120, 310], [1900, 7000], [1600, 6100], [68, 170], [130, 320], [600, 2200], [300, 1800]];
  const decays = [[.16, .95], [.07, .32], [.035, .095], [.13, .62], [.1, .62], [.08, .48], [.055, .23], [.14, .9]];
  const voices = method.kits[0].voices.map((base, lane) => {
    const next = { ...base };
    for (const key of method.controls) {
      if (key === 'frequency') next.frequency = logSpan(...registers[lane]);
      if (key === 'decay') next.decay = logSpan(...decays[lane]);
      if (key === 'tone') next.tone = span(lane === 0 ? .2 : .3, lane === 0 ? .72 : .92);
      if (key === 'noise') next.noise = lane === 1 || lane === 6 ? span(.35, .88) : lane === 2 || lane === 3 ? span(.15, .7) : span(.015, .2);
      if (key === 'sweep') next.sweep = method.id === 'swept-sdsv' ? span(-12, 36) : lane === 0 || lane === 4 || lane === 5 ? span(1, 18) : span(-2, 5);
      if (key === 'ratio') next.ratio = span(lane === 0 ? .75 : 1.1, lane === 0 ? 1.9 : 4.8);
      if (key === 'index') next.index = span(lane === 0 ? .6 : 1.6, lane === 0 ? 5.5 : 10.5);
      if (key === 'level') next.level = lane === 0 ? span(.67, .9) : lane === 1 || lane === 4 || lane === 5 ? span(.45, .7) : span(.25, .46);
      if (key === 'pan') next.pan = lane < 2 ? span(-.05, .05) : span(-.55, .55);
    }
    if (next.model === 3) {
      // Keep both operators and useful index below the conservative 44.1 kHz
      // band edge. Manual controls retain the wider, protected DSP ranges.
      next.frequency = Math.min(2800, next.frequency);
      next.ratio = Math.min(next.ratio, 16000 / next.frequency);
      next.index = Math.min(next.index, 16000 / next.frequency - 1);
    }
    return next;
  });
  return sanitizePercussionState({ ...current, kitId: 'custom', voices });
}

/** Generate voices-independent beats with a low/high anchor and real rests.
 * Even a broken/constant RNG cannot produce an empty or all-on grid.
 */
export function randomizePercussionRhythm(state, rng = Math.random) {
  const current = sanitizePercussionState(state), random = randomSource(rng);
  const chance = [.22, .15, .55, .1, .12, .12, .11, .16];
  const steps = Array.from({ length: 8 }, (_, lane) => Array.from({ length: 16 }, (_, step) => {
    const probability = chance[lane] * (step % 2 ? .7 : 1.2);
    return random() < probability ? rounded(.35 + random() * .48) : 0;
  }));
  // Stable low-frequency and backbeat anchors keep dice immediately audible.
  steps[0][0] = .9;
  steps[1][8 + Math.floor(random() * 2) * 4] = .8;
  steps[2][2] = .62; steps[2][10] = .53;
  for (let step = 0; step < 16; step++) {
    // Do not ask open and closed hi-hats to attack simultaneously.
    if (steps[2][step] > 0 && steps[3][step] > 0) steps[3][step] = 0;
    // Limit composite accents to four voices, prioritizing the drum skeleton.
    let count = 0;
    for (const lane of [0, 1, 2, 3, 4, 5, 6, 7]) {
      if (steps[lane][step] > 0 && ++count > 4) steps[lane][step] = 0;
    }
  }
  // Forced breathing spaces are in upper lanes, never the low/backbeat anchors.
  for (let lane = 2; lane < 8; lane++) for (let step = 1; step < 16; step += 4) steps[lane][step] = 0;
  return sanitizePercussionState({ ...current, rhythmId: 'custom', steps, swing: rounded(random() * .3) });
}

/** Immutable four-beat event grid; timing is in beats, not wall-clock time.
 * Odd sixteenths move later by swing × .25 beats; paired lengths remain .5.
 * The audio owner schedules these events from its persistent audio clock.
 */
export function compilePercussionSequence(state, tempo = 120) {
  const current = sanitizePercussionState(state), stepBeats = .25;
  const steps = Array.from({ length: 16 }, (_, index) => {
    const atBeats = index * stepBeats + (index % 2 ? current.swing * stepBeats : 0);
    const durationBeats = stepBeats * (index % 2 ? 1 - current.swing : 1 + current.swing);
    return {
      index, atBeats, durationBeats, at: atBeats, duration: durationBeats,
      notes: current.steps.flatMap((lane, laneIndex) => lane[index] > 0 ? [{ lane: laneIndex, ratio: 1, velocity: lane[index], gate: 1 }] : []),
    };
  });
  return freeze({ studyId: `percussion-${current.methodId}`, archetype: 'drum-grid', tempo: bound(tempo, 10, 1200, 120), lengthBeats: 4, stepBeats, steps });
}
