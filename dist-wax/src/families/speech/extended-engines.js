// Shared, data-only registration. Musical models use authored English gestures;
// the upstream DSP is identified separately from our articulation adapter.
const knob = (label, min, value, max, unit = '') => ({ label, min, value, max, unit });
const choice = (label, choices, value) => ({ label, choices, value });
const pitch = () => knob('Pitch', 60, 180, 440, 'Hz');
const musical = {
  pitch: pitch(), breath: knob('Noise', .1, 1, 3, '×'),
  vibrato: knob('Vibrato', 0, .015, .12), vibratoRate: knob('Vibrato rate', .5, 5.3, 10, 'Hz'),
  jitter: knob('Jitter', 0, .005, .05), transition: knob('Articulation', .005, .03, .15, 's'),
};
export const EXTENDED_ENGINES = Object.freeze({
  hts: {
    name:'HTS HMM voice', shortName:'HTS', color:'#f1c791',
    family:'Hidden Markov model synthesis', date:'2016 integrated voice release',
    detail:'The actual HTS engine predicts duration and acoustic trajectories from hidden Markov models, then synthesizes them with its vocoder. Uses the CMU ARCTIC SLT model.',
    history:'The integrated HTS SLT model and Flite frontend were released in 2016. HMM speech synthesis is older. Readback joins phones extracted using the model’s own timing; this is distinct from Flite Clustergen.',
    source:'https://hts-engine.sourceforge.net/',
    controls:{pitch:knob('Pitch offset',-12,0,12,'st'),rate:knob('Articulation rate',.5,.5,1.3,'×'),tilt:knob('Postfilter',0,0,1),bandwidth:knob('Global variance',0,1,2),breath:knob('Voicing threshold',.2,.5,.8)},
    examples:[['HMM speech',{}],['Low HMM',{pitch:-9}],['High HMM',{pitch:9}],['Fast HMM',{rate:1.1}],['Crisp postfilter',{tilt:.6}],['Soft variance',{bandwidth:.25}],['Expanded variance',{bandwidth:1.7}],['Breathy prediction',{breath:.7}]],
  },
  gnuspeech: {
    name: 'Gnuspeech', shortName: 'Gnuspeech', color: '#e5a2ff',
    family: 'Articulatory synthesis', date: '1992 Trillium milestone',
    detail: 'Gnuspeech’s original tube-resonance model and English articulatory rules, compiled to WebAssembly.',
    history: 'The Trillium project began in 1992; its descendant Gnuspeech became a GNU project in 2002. Readback here joins locally generated phones.',
    source: 'https://www.gnu.org/software/gnuspeech/',
    controls: {
      character: choice('Vocal tract', ['male','female','large_child','small_child','baby'], 'male'),
      pitch: knob('Pitch offset', -24, 0, 24, 'st'), formant: knob('Tract length', 7, 17.5, 22, 'cm'),
      breath: knob('Breathiness', 0, 2, 10), nasal: knob('Nasal radius', .45, 1, 2, '×'),
      rise: knob('Pulse rise', 10, 40, 60, '%'), fall: knob('Pulse fall', 5, 16, 35, '%'), rate: knob('Articulation rate', .5, 1, 2, '×'),
    },
    examples: [ ['Trillium voice',{}], ['Small tract',{character:'small_child',formant:11,pitch:8}], ['Long tract',{formant:21,pitch:-9}], ['Air through the tube',{breath:8}], ['Nasal passage',{nasal:1.8}], ['Sharp glottis',{rise:15,fall:8}], ['Round glottis',{rise:55,fall:28}], ['Slow articulation',{rate:.6,breath:4}] ],
  },
  singer: {
    name: 'Perry Cook’s Singer', shortName: 'Singer', color: '#ffa4ca',
    family: 'Articulatory singing synthesis', date: '1989 ICMC paper',
    detail: 'Cook’s Singer model: glottal excitation, a nine-section vocal tract, six nasal sections and changing articulation. Ported from the Snd translation.',
    history: 'Cook’s 1989 ICMC paper documents the physical-model lineage. This port uses the original Singer tables with authored English gesture sequences; it is not a general text-to-speech engine.',
    source: 'https://www.cs.princeton.edu/~prc/SingingSynth.html',
    controls: {...musical, character: choice('Glottis', ['test','loud','soft','wide4','wide5','greekdefault','lowbass'], 'greekdefault'), formant: knob('Tract radius', .5, 1, 1, '×'), nasal: choice('Velum', ['original',0,.1,.25,.5,.75,1], 'original')},
    examples: [['Cook’s singing tract',{}], ['Low bass',{pitch:82,character:'lowbass'}], ['Soft glottis',{character:'soft',vibrato:.025}], ['Wide glottis',{character:'wide4',pitch:250}], ['Nasal song',{nasal:.75}], ['Narrow tract',{formant:.65,pitch:300}], ['Operatic wobble',{vibrato:.06,vibratoRate:5.8}], ['Unsteady creature',{jitter:.045,transition:.1,pitch:115}]],
  },
  'stk-voicform': {
    name: 'STK VoicForm', shortName: 'VoicForm', color: '#ffd48b',
    family: 'Parallel formant singing', date: '1996 STK release',
    detail: 'The actual STK VoicForm instrument: four swept resonances excited by SingWave and noise, using STK’s original phoneme table.',
    history: 'Cook and Scavone released STK in 1996. Our English gesture adapter sequences its musical phoneme model; STK itself supplies no text frontend.',
    source: 'https://ccrma.stanford.edu/software/stk/classstk_1_1VoicForm.html',
    controls: {...musical, formant: knob('Formant scale', .65, 1, 1.5, '×'), tilt: knob('Spectral tilt', -.95, .5, .95), rate: knob('Pitch glide', .001, .03, .15)},
    examples: [['Four resonances',{}], ['Bass formants',{pitch:85,formant:.8}], ['Soprano formants',{pitch:350,formant:1.3}], ['Breathy articulation',{breath:2.5}], ['Reed-like vowels',{tilt:-.6}], ['Dark vowels',{tilt:.9}], ['Wide vibrato',{vibrato:.07}], ['Slow sweeps',{transition:.13,rate:.01}]],
  },
  vizsn: {
    name: 'Vizsn', shortName: 'Vizsn', color: '#b9ff83',
    family: 'Compact formant synthesis', date: '2004 source credit',
    detail: 'Viznut’s tiny speech synthesizer from SoLoud, running its original integer DSP. Excitation and pitch produce strongly electronic voices.',
    history: 'The source credits Viznut’s 2004 implementation. Twenty native sounds are mapped to approximate English gestures here; this is not a complete English phoneme inventory.',
    source: 'https://solhsa.com/soloud/vizsn.html',
    controls: { pitch: knob('Pitch', 40, 98, 400, 'Hz'), character: choice('Excitation', [0,1,2,3,5,6,7,8,9], 6) },
    examples: [['Viznut’s voice',{}], ['Low circuit',{pitch:50}], ['High circuit',{pitch:280}], ['Excitation zero',{character:0}], ['Excitation two',{character:2}], ['Excitation five',{character:5}], ['Excitation seven',{character:7}], ['Excitation nine',{character:9}]],
  },
  mea8000: {
    name: 'MEA8000', shortName: 'MEA8000', color: '#ffb781',
    family: 'Quantized formant speech chip', date: '1986 datasheet',
    detail: 'The MEA8000’s integer excitation and four resonators, ported from MAME. Formants, bandwidth and frame duration follow the chip’s discrete tables.',
    history: 'The cited Philips datasheet is dated 1986, a documented-by bound. These are newly authored English-like frame gestures, not recovered speech ROMs.',
    source: 'https://www.alldatasheet.com/datasheet-pdf/pdf/146906/PHILIPS/MEA8000.html',
    controls: {pitch:knob('Pitch',40,120,500,'Hz'),formant:knob('Formant targets',.65,1,1.5,'×'),bandwidth:choice('Bandwidth',[50,125,309,726],125),rate:choice('Frame length',[8,16,32,64],32)},
    examples: [['Four chip resonators',{}], ['Low robot',{pitch:60}], ['High robot',{pitch:300}], ['Narrow resonances',{bandwidth:50}], ['Broad resonances',{bandwidth:726}], ['Small formants',{formant:.7}], ['Fast frames',{rate:8}], ['Slow frames',{rate:64}]],
  },
  'csound-fof': {
    name: 'Csound FOF', shortName: 'FOF', color: '#96e9ef',
    family: 'Formant-wave-function synthesis', date: '1984 CHANT account',
    detail: 'Csound’s actual fof opcode adds overlapping, enveloped sinusoidal grains to construct vocal formants.',
    history: 'Rodet, Potard and Barrière described CHANT in 1984. These authored English-like formant targets demonstrate FOF; they are not IRCAM’s original voice database.',
    source: 'https://csound.com/docs/manual/fof.html',
    controls: {pitch:knob('Pitch',60,145,440,'Hz'),formant:knob('Formant scale',.65,1,1.6,'×'),bandwidth:knob('Bandwidth',.4,1,3,'×'),breath:knob('Breath',0,.025,.4),vibrato:knob('Vibrato',0,.015,.12)},
    examples: [['FOF singing grains',{}], ['Bass grains',{pitch:75,formant:.8}], ['Soprano grains',{pitch:330,formant:1.3}], ['Narrow formants',{bandwidth:.45}], ['Broad formants',{bandwidth:2.6}], ['Breathy grains',{breath:.25}], ['Wide vibrato',{vibrato:.075}], ['Tiny singing tract',{pitch:420,formant:1.55}]],
  },
  'csound-vosim': {
    name: 'Csound VOSIM', shortName: 'VOSIM', color: '#a9baff',
    family: 'Vocal pulse-train synthesis', date: '1978 publication',
    detail: 'Csound’s actual vosim opcode forms vowels from decaying groups of squared-sine pulses. Pulse count and decay change the spectral envelope.',
    history: 'Kaegi and Tempelaars published VOSIM in 1978. Our formant/noise gestures demonstrate the pulse method, with no historical speech corpus.',
    source: 'https://csound.com/docs/manual/vosim.html',
    controls: {pitch:knob('Pitch',60,145,440,'Hz'),formant:knob('Formant scale',.65,1,1.6,'×'),pulses:choice('Pulses',[1,2,3,4,5,6,7,8],3),decay:knob('Pulse decay',.2,.65,.95),breath:knob('Breath',0,.025,.4),vibrato:knob('Vibrato',0,.015,.12)},
    examples: [['VOSIM pulse voice',{}], ['One pulse',{pulses:1}], ['Eight pulses',{pulses:8}], ['Fast decay',{decay:.22}], ['Slow decay',{decay:.92}], ['Bass pulse groups',{pitch:70,formant:.75}], ['Bright pulse groups',{pitch:290,formant:1.35}], ['Breathy pulse groups',{breath:.2,vibrato:.045}]],
  },
  pico: {
    name: 'SVOX Pico', shortName: 'Pico', color: '#a7e9bd',
    family: 'Compact parametric text-to-speech', date: '2009 Android source',
    detail: 'The original compact SVOX Pico engine and English models, synthesized locally in WebAssembly. Choose American or British English.',
    history: 'Pico entered Android’s open-source tree in 2009. These two model sets share one engine. Readback here joins generated phones rather than using Pico’s native sentence prosody.',
    source: 'https://android.googlesource.com/platform/external/svox/',
    controls: {character:choice('English model',['en-US','en-GB'],'en-US'),pitch:knob('Pitch',.5,1,2,'×'),rate:knob('Articulation rate',.4,.8,2,'×')},
    examples: [['Pico American English',{}], ['Pico British English',{character:'en-GB'}], ['Low Pico',{pitch:.6}], ['High Pico',{pitch:1.6}], ['Deliberate Pico',{rate:.45}], ['Quick Pico',{rate:1.4}], ['Low British Pico',{character:'en-GB',pitch:.7}], ['Bright British Pico',{character:'en-GB',pitch:1.3,rate:1.1}]],
  },
});

export const NATIVE_FIELDS = Object.freeze(['pitch','character','formant','breath','nasal','rise','fall','rate','vibrato','vibratoRate','jitter','transition','tilt','bandwidth','pulses','decay']);
export const nativeField = key => `voice${key[0].toUpperCase()}${key.slice(1)}`;
export const NATIVE_DEFAULTS = Object.freeze(Object.fromEntries(NATIVE_FIELDS.map(key => [nativeField(key), .5])));
export function parameterValue(rule, normalized) {
  if (!Number.isFinite(normalized)) return rule.value;
  const x = Math.min(1, Math.max(0, normalized));
  return rule.choices ? rule.choices[Math.round(x * (rule.choices.length - 1))] : rule.min + (rule.max - rule.min) * x;
}
export function nativeSnapshot(engine, values = {}) {
  const result = {...NATIVE_DEFAULTS};
  const controls = EXTENDED_ENGINES[engine]?.controls ?? {};
  for (const key of Object.keys(values)) if (!controls[key]) throw new Error(`Unknown ${engine} control: ${key}`);
  for (const [key, rule] of Object.entries(controls)) {
    const value = values[key] ?? rule.value;
    const min = rule.choices ? 0 : rule.min, max = rule.choices ? rule.choices.length - 1 : rule.max;
    const x = rule.choices ? rule.choices.indexOf(value) : value;
    if (x < min || x > max) throw new Error(`Out-of-range ${engine} preset control: ${key}`);
    result[nativeField(key)] = (x - min) / (max - min);
  }
  return result;
}
export function nativeValues(engine, state = {}) {
  return Object.fromEntries(Object.entries(EXTENDED_ENGINES[engine]?.controls ?? {}).map(([key, rule]) => [key, parameterValue(rule, state[nativeField(key)])]));
}

// Spelling keeps only additions with native English text/phone frontends.
export const SPELLING_NATIVE_ENGINES=Object.freeze(Object.fromEntries(Object.entries(EXTENDED_ENGINES).filter(([id])=>["gnuspeech","pico","hts"].includes(id))));
