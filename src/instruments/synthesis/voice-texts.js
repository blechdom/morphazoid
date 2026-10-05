// Original audition text, not quotations or recovered historical utterances.
// Sources support the technique/history claim; the playful lines are authored
// demonstrations. Numbers are written out for the English lyric frontend.
const source = (label, url) => Object.freeze({ label, url });
const technique = (label, text, sources, inputText) => Object.freeze({
  label, text, sources: Object.freeze(sources),
  ...(inputText ? { inputText } : {}),
});
const fliteSource = source('Flite project and voice documentation', 'https://github.com/festvox/flite/blob/master/README.md');
const clustergenSource = source('Black, CLUSTERGEN, Interspeech 2006', 'https://www.isca-archive.org/interspeech_2006/black06_interspeech.html');

export const VOICE_TECHNIQUE_TEXTS = Object.freeze({
  'csound-vosim': technique('About VOSIM',
    'VOSIM shapes vowels with bursts of squared sine pulses.', [
      source('Csound VOSIM manual', 'https://csound.com/docs/manual/vosim.html'),
    ]),
  'espeak-klatt': technique('About eSpeak Klatt',
    'Klatt published his cascade and parallel formant synthesizer in nineteen eighty.', [
      source('Klatt, Software for a cascade/parallel formant synthesizer, 1980', 'https://doi.org/10.1121/1.383940'),
      source('eSpeak NG synthesis methods', 'https://github.com/espeak-ng/espeak-ng/blob/master/README.md'),
    ]),
  'csound-fof': technique('About Csound FOF',
    "Csound FOF grows singing vowels from CHANT's grain idea.", [
      source('Csound FOF manual and CHANT lineage', 'https://csound.com/docs/manual/fof.html'),
    ]),
  mea8000: technique('About MEA8000',
    'The MEA eight thousand speech chip shapes sound with four formants and short parameter frames.', [
      source('MAME MEA8000 implementation', 'https://github.com/mamedev/mame/blob/master/src/devices/sound/mea8000.cpp'),
    ]),
  singer: technique('About Singer',
    "Perry Cook's Singer models a mouth with waveguides.", [
      source('Perry Cook, Singing Synthesis, 1989–1996', 'https://www.cs.princeton.edu/~prc/SingingSynth.html'),
    ]),
  gnuspeech: technique('About Gnuspeech',
    'Gnuspeech carries a NeXT computer lineage into speech made with a moving tube model.', [
      source('GnuspeechSA project history and tube model', 'https://github.com/mym-br/gnuspeech_sa/blob/master/README.md'),
    ]),
  espeak: technique('About eSpeak',
    "eSpeak's formant voice began with Speak on Acorn computers in nineteen ninety five.", [
      source('eSpeak NG project history', 'https://github.com/espeak-ng/espeak-ng/blob/master/README.md#history'),
    ]),
  'stk-voicform': technique('About STK VoicForm',
    "Cook and Scavone's VoicForm sings through four formants.", [
      source('STK VoicForm implementation and authors', 'https://github.com/thestk/stk/blob/master/include/VoicForm.h'),
    ]),
  'flite-kal': technique('About Flite KAL',
    "Flite's KAL voice joins recorded diphones, linking one speech sound to the next.", [fliteSource]),
  'flite-kal16': technique('About Flite KAL16',
    'KAL sixteen uses the same diphone voice lineage at a higher sample rate.', [fliteSource]),
  vizsn: technique('About Vizsn',
    "Viznut's tiny Vizsn voice maps letters to electronic sounds, not full English speech.", [
      source('SoLoud Vizsn documentation', 'https://solhsa.com/soloud/vizsn.html'),
      source('Original Vizsn algorithm and letter map', 'https://github.com/jarikomppa/soloud/blob/master/src/audiosource/vizsn/soloud_vizsn.cpp'),
    ]),
  'flite-awb': technique('About Flite AWB',
    "Clustergen, published in two thousand six, predicts speech parameters for Flite's AWB voice.", [clustergenSource, fliteSource]),
  'flite-rms': technique('About Flite RMS',
    "Flite's RMS voice uses Clustergen to turn predicted acoustic trajectories into speech.", [clustergenSource, fliteSource]),
  'flite-slt': technique('About Flite SLT',
    "Flite's SLT is another Clustergen voice model, not a separate synthesis technique.", [clustergenSource, fliteSource]),
  'sample-bank': technique('About sample-bank singing',
    'Sample singers join recorded voice pieces at new pitches.', [
      source('OpenUtau classic sample-based synthesis workflow', 'https://github.com/openutau/OpenUtau/wiki'),
      fliteSource,
    ]),
  pico: technique('About Pico',
    "Pico brought compact text to speech to Android's source tree in two thousand nine.", [
      source('Android Pico source, August 2009', 'https://android.googlesource.com/platform/external/svox/+/refs/heads/donut-release2'),
    ]),
  sinsy: technique('About Sinsy',
    'Sinsy sings a score with a hidden Markov model.', [
      source('Sinsy 0.92, HMM singing and Japanese input', 'https://sinsy.sourceforge.net/'),
    ], 'がくふからうたをつくる'),
  hts: technique('About HTS',
    'The HTS engine generates speech from hidden Markov models, with a Flite frontend for English text.', [
      source('HTS engine API and Flite frontend', 'https://hts-engine.sourceforge.net/'),
    ]),
});

const line = (id, label, text) => Object.freeze({ id, label, text });

// Keep even the nonsense vowel-bearing and brief: FOF/VOSIM render vowels,
// while Singer/STK expand consonants into separate native note fragments.
export const VOICE_PLAY_TEXTS = Object.freeze([
  line('filter-confession', 'Filter confession', 'My filter has feelings about phase.'),
  line('sample-clock', 'Sample clock', 'The sample clock has perfect attendance.'),
  line('vowel-bits', 'Vowels in bits', 'These vowels are made of moving numbers.'),
  line('phoneme-party', 'Phoneme party', 'Every phoneme brought its own oscillator.'),
  line('fourier-mouth', 'Fourier mouth', 'My mouth is a Fourier series in disguise.'),
  line('buffer-love', 'Buffer love', 'I saved you a place in my ring buffer.'),
  line('resonant-committee', 'Resonant committee', 'Three formants walk into a feedback loop.'),
  line('nyquist-nap', 'Nyquist nap', 'The Nyquist limit needs a little nap.'),
  line('lip-bits', 'Lip bits', 'puh buh ppnpbpbpb bah bop boo'),
  line('shush-machine', 'Shush machine', 'shshsh sha shu shih so oh'),
  line('vowel-orbit', 'Vowel orbit', 'so o o o oh oh oh ohoh'),
  line('keyboard-mouth', 'Keyboard mouth', 'plaskdjflkjp pla ska da flup oh'),
  line('broken-printer', 'Broken printer', 'weokrjlkj vj vj vj va vu oh'),
  line('tongue-packets', 'Tongue packets', 'tik taka tik tok prr rah ka poo'),
  line('nasal-bubbles', 'Nasal bubbles', 'mm na ng oo bum buh mm oh'),
  line('velvet-static', 'Velvet static', 'zzz zhah vvv vah fff foo ah'),
]);

// Sinsy 0.92 is a Japanese score frontend. These are literal kana inputs, not
// automatic translations. The first means "make a song from a score"; the
// remaining lines are short original syllabic/percussive demonstrations.
const SINSY_PLAY_TEXTS = Object.freeze([
  line('kana-pulse', 'Pa ba pulse', 'ぱ ば ぱ ぶ ぱ ぼ ぷ ぷ'),
  line('kana-shush', 'Sha shu texture', 'しゃ しゅ しょ しゃ す そ お'),
  line('kana-vowels', 'So o o orbit', 'そ お お お お お お'),
  line('kana-packets', 'Ka ta packet', 'か た か た き て こ と'),
  line('kana-nasal', 'Nasal bubbles', 'む ま ん な ぬ の う お'),
  line('kana-robot', 'A computer sings', 'こんぴゅうたがうたう'),
]);

function techniqueFor(engine) {
  if (!Object.hasOwn(VOICE_TECHNIQUE_TEXTS, engine)) throw new TypeError('Choose a known voice engine.');
  return VOICE_TECHNIQUE_TEXTS[engine];
}

/** Audition input, with native kana for Sinsy. The English explanation remains
 * in VOICE_TECHNIQUE_TEXTS.sinsy.text. MEA8000 has no text frontend: its caller
 * may display the explanation, but must retain the native chip-frame input.
 */
export function voiceTextForEngine(engine) {
  const entry = techniqueFor(engine);
  return entry.inputText ?? entry.text;
}

export function voiceTextOptions(engine) {
  const entry = techniqueFor(engine);
  return Object.freeze([
    line(`technique-${engine}`, entry.label, voiceTextForEngine(engine)),
    ...(engine === 'sinsy' ? SINSY_PLAY_TEXTS : VOICE_PLAY_TEXTS),
  ]);
}

/** Injectable randomness makes factory tests deterministic; hostile samples
 * clamp to a valid short option instead of producing missing text.
 */
export function randomVoiceText(engine, random = Math.random) {
  const options = voiceTextOptions(engine), value = random();
  const unit = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  return options[Math.min(options.length - 1, Math.floor(unit * options.length))].text;
}
