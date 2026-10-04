import {
  NATIVE_METHODS, defaultScene, defaultsFor, methodsForVoiceMode, presetsForVoiceMode, randomize,
  validateScene, voiceModeForEngine,
} from '../voicesaurus/native-model.js';

export const isVoiceInput = id => id === 'speech' || id === 'singing';
const clone = value => structuredClone(value);
const defaultText = 'Hello. This is Synthesaurus.';

export function voiceModeForInput(id) {
  if (!isVoiceInput(id)) throw new TypeError('Choose speech or singing synthesis.');
  return id === 'speech' ? 'speaking' : 'singing';
}

export function createVoiceInputState(id) {
  const mode = voiceModeForInput(id);
  const scene = id === 'singing'
    ? clone(presetsForVoiceMode(mode).find(preset => preset.snapshot.engine === 'singer').snapshot)
    : defaultScene('espeak');
  return { version: 1, scene, text: defaultText };
}

/** Presets contain musical state only; native finite values retain their range. */
export function sanitizeVoiceInputState(value, id) {
  const mode = voiceModeForInput(id);
  try {
    if (!value || value.version !== 1 || voiceModeForEngine(value.scene?.engine) !== mode) throw new TypeError('Invalid voice input state.');
    const scene = validateScene(value.scene);
    if (typeof value.text !== 'string' || value.text.length > 1000) throw new TypeError('Use up to 1000 characters of speech.');
    return { version: 1, scene, text: value.text };
  } catch {
    return createVoiceInputState(id);
  }
}

export function voicePresetsForInput(id) {
  return presetsForVoiceMode(voiceModeForInput(id)).map(preset => ({
    id: preset.id, label: `${preset.label.replace(`${NATIVE_METHODS[preset.snapshot.engine].name} · `, '')} · ${NATIVE_METHODS[preset.snapshot.engine].name}`,
    state: { version: 1, scene: clone(preset.snapshot), text: defaultText },
  }));
}

// The native exact-entry domains include experimental/unstable combinations.
// Dice uses a playable subset; manual edits and authored scenes stay untouched.
const singerDicePhones = ['ahh', 'aah', 'ehh', 'eee', 'ooo', 'uhh', 'nng', 'pipe1', 'rolledr'];
function playableRandomScene(scene, rng, { preserveInput = false } = {}) {
  const r = () => Math.min(.999999, Math.max(0, Number(rng()) || 0));
  const span = (lo, hi) => Number((lo + (hi - lo) * r()).toFixed(6));
  const values = scene.values;
  if (scene.engine === 'espeak' || scene.engine === 'espeak-klatt') {
    values.rate = Math.round(span(120, 260)); values.wordGap = Math.round(span(0, 8));
    values.volume = Math.round(span(75, 110));
  }
  if (scene.engine === 'hts' || scene.engine === 'sinsy') {
    Object.assign(values, { speed: span(.6, 1.8), semitones: span(-8, 8), beta: span(0, .5),
      voicingThreshold: span(.3, .7), gvWeight: span(.6, 1.2), alpha: span(.45, .68), volumeDb: span(-6, 0) });
    if (scene.engine === 'hts') {
      values.f0GvWeight = span(.5, 1.5);
      values.sampleRate = [22050, 32000, 44100, 48000][Math.floor(r() * 4)];
      values.framePeriod = Math.round(values.sampleRate * span(.004, .0075));
    }
  }
  if (scene.engine === 'csound-fof') {
    const ranges = { pitch: [60, 700], amplitude: [.08, .24], duration: [.2, 1.5], attack: [.005, .08], release: [.02, .2],
      formant1: [180, 1400], formant2: [650, 4200], formant3: [1700, 8500],
      gain1: [.4, 1.2], gain2: [.15, .8], gain3: [.06, .55], vibrato: [0, .04], vibratoRate: [2, 9],
      bandwidth1: [30, 160], bandwidth2: [45, 240], bandwidth3: [70, 350], octave: [0, 1.5],
      grainRise: [.0006, .004], grainDuration: [.018, .065], grainDecay: [.002, .015], phase: [0, 1] };
    for (const [key, range] of Object.entries(ranges)) values[key] = span(...range);
    // FOF compensates its exponential bandwidth decay during the rise. The
    // product must stay small; independently random wide ranges can overflow.
    fitFofGrain(values);
  }
  if (scene.engine === 'singer') {
    if (!preserveInput) scene.input.phone = singerDicePhones[Math.floor(r() * singerDicePhones.length)];
    const base = defaultsFor('singer', scene.input);
    const ranges = { pitch: [80, 650], duration: [.25, 1.2], amplitude: [.4, 1], attack: [.005, .04],
      decay: [.04, .15], sustain: [.6, 1], release: [.03, .2], voiced: [.45, .9], noise: [.05, .4],
      vibrato: [.002, .05], vibratoRate: [3.5, 7.5], jitter: [.001, .03], jitterRate: [3, 25],
      transition: [.99, .999], tongueHumpPole: [.99, .999], tongueTipPole: [.99, .999], tractScale: [.95, 1.03],
      glottalReflection: [.5, .75], fricationGain: [0, .01], fricationFrequency1: [1000, 4000],
      fricationFrequency2: [2000, 6500], fricationRadius1: [.3, .65], fricationRadius2: [.3, .65],
      velum: [0, .2], glottisA: [.48, .68], glottisTransition: [.005, .08] };
    for (const [key, range] of Object.entries(ranges)) values[key] = span(...range);
    for (let n = 1; n <= 8; n++) values[`radius${n}`] = Math.max(.25, Math.min(1.8, base[`radius${n}`] * span(.9, 1.1)));
    // The lip feedback includes mouth radius and tract scale. Randomize their
    // product as a bounded negative feedback, not three independent gains.
    values.lipReflection = -span(.15, .35) / (values.radius8 * values.tractScale);
    values.glottisB = values.glottisA + span(.025, .1);
    values.fricationPosition = 1 + Math.floor(r() * 7); values.glottisHarmonics = 3 + Math.floor(r() * 38);
    values.customShape = r() < .5; values.customGlottis = r() < .5; values.pitchSweep = r() < .5;
    const destinations = ['hold', ...singerDicePhones]; values.destination = destinations[Math.floor(r() * destinations.length)];
    fitSingerTiming(values, r);
  }
  return scene;
}

function fitFofGrain(values) {
  values.grainDuration = Math.min(values.grainDuration, values.duration * .8);
  values.grainRise = Math.min(values.grainRise, .7 / Math.max(values.bandwidth1, values.bandwidth2, values.bandwidth3), values.grainDuration * .25);
  values.grainDecay = Math.min(values.grainDecay, values.grainDuration * .45);
}
function fitSingerTiming(values, rng) {
  values.changeTime = values.duration * (.1 + .6 * rng());
  values.destinationPitch = values.pitch * (.75 + .5 * rng());
}

function randomForMethod(scene, mode, rng) {
  const engines = Object.keys(methodsForVoiceMode(mode));
  let first = true;
  const generated = randomize(scene, () => {
    if (first) { first = false; return (engines.indexOf(scene.engine) + .5) / engines.length; }
    return rng();
  }, { mode });
  generated.input = clone(scene.input);
  return playableRandomScene(generated, rng, { preserveInput: true });
}

/** The local dice explores the current voice while retaining authored words and melody. */
export function randomizeVoiceMethodState(previous, id, rng = Math.random) {
  const next = sanitizeVoiceInputState(previous, id), mode = voiceModeForInput(id);
  const r = () => Math.min(.999999, Math.max(0, Number(rng()) || 0));
  const generated = randomForMethod(next.scene, mode, r);
  const musical = id === 'singing' && next.scene.engine !== 'sinsy';
  const performance = new Set(musical ? ['pitch', 'duration'] : []);
  for (const [key, value] of Object.entries(generated.values)) {
    if (!performance.has(key)) next.scene.values[key] = value;
  }
  if (next.scene.engine === 'singer') fitSingerTiming(next.scene.values, r);
  if (next.scene.engine === 'csound-fof') fitFofGrain(next.scene.values);
  for (const note of next.scene.input.phrase?.notes ?? []) {
    const sound = randomForMethod({ ...next.scene, input: note.input ?? next.scene.input }, mode, r).values;
    note.voiceOverrides = Object.keys(sound).filter(key => !performance.has(key));
    for (const key of note.voiceOverrides) note.values[key] = sound[key];
    if (next.scene.engine === 'singer') fitSingerTiming(note.values, r);
    if (next.scene.engine === 'csound-fof') fitFofGrain(note.values);
  }
  return { ...next, scene: validateScene(next.scene) };
}

/** Full-scene dice chooses a native method and generates its complete parameters. */
export function randomizeVoiceInputState(previous, id, rng = Math.random) {
  const next = sanitizeVoiceInputState(previous, id);
  const r = () => Math.min(.999999, Math.max(0, Number(rng()) || 0));
  const scene = playableRandomScene(randomize(next.scene, r, { mode: voiceModeForInput(id) }), r);
  if (id === 'singing' && scene.engine !== 'sinsy') {
    const tempo = 60 + 140 * r(), count = 3 + Math.floor(5 * r());
    const input = clone(scene.input);
    scene.input.phrase = { tempo, pitchPortamento: r() < .5 ? 0 : .25 * r(), vowelPortamento: r() < .5 ? 0 : .25 * r(),
      notes: Array.from({ length: count }, (_, index) => ({
        rest: index > 0 && r() < .15, input: clone(input),
        values: { ...scene.values, pitch: scene.values.pitch * (.65 + .85 * r()),
          duration: scene.engine === 'singer' && input.phone === 'open' ? scene.values.duration : .2 + 1.2 * r() },
        voiceOverrides: [],
      })),
    };
    if (scene.engine === 'singer') for (const note of scene.input.phrase.notes) fitSingerTiming(note.values, r);
  }
  return { ...next, scene: validateScene(scene) };
}
