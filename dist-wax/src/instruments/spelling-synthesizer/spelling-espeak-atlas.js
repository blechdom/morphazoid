import { sustainPoints } from '../../families/speech/vowel-loop.js';
import { SPELLING_DIPHONE_CLIPS } from './spelling-diphone-atlas.js';

// eSpeak ASCII phone mnemonics, keyed by Spelling's existing English gestures.
export const ESPEAK_PHONES = Object.freeze({
  a:'a', b:'b', c:'k', d:'d', e:'E', f:'f', g:'g', h:'h', i:"'I", j:'dZ',
  k:'k', l:'l', m:'m', n:'n', ng:'N', o:'A:', p:'p', q:'kw', r:'r', s:'s',
  sh:'S', t:'t', th:'T', dh:'D', u:'V', v:'v', w:'w', x:'ks', y:'j', z:'z',
  ch:'tS', ai:'eI', au:'O:', ei:'eI', oi:'OI', ou:'aU', ee:'i:', oo:'u:',
  oa:'oU', ay:'aI', er:'3:', uh:'U', zh:'Z',
});

/** Called only in the voice worker, after its local eSpeak engine is ready. */
export function renderEspeakAtlas(voice, { voiceName = 'en-us' } = {}) {
  const sampleRate = voice.samplerate;
  if (!(sampleRate > 0 && sampleRate <= 96000)) throw new Error('Invalid eSpeak sample rate.');
  if (voice.set_voice(voiceName) !== 0) throw new Error('eSpeak English voice is unavailable.');
  voice.set_rate(140); voice.set_pitch(43); voice.set_range(0);
  const clips = {}, pieces = [];
  const gap = Math.round(sampleRate * .012);
  let total = gap;
  for (const [key, phone] of Object.entries(ESPEAK_PHONES)) {
    // Voiced stops need an opening, and US /r/ is omitted without a following
    // vowel. Keep their contextual release plus 12 ms of transition, using
    // eSpeak's own phoneme clock; discard the rest of the helper schwa.
    const contextual = ['b', 'd', 'g', 'r'].includes(phone);
    const chunks = [], events = [];
    let length = 0;
    voice.synthesize(`[[${phone}${contextual ? '@' : ''}]]`, (pcm, phonemes) => {
      events.push(...phonemes);
      length += pcm.length;
      if (length > sampleRate * 3) throw new Error('eSpeak phone exceeded the voice limit.');
      chunks.push(Float32Array.from(pcm, value => value / 32768));
      return false;
    });
    let rendered = new Float32Array(length);
    let offset = 0;
    for (const chunk of chunks) { rendered.set(chunk, offset); offset += chunk.length; }
    if (contextual) {
      const vowel = events.find(event => event.type === 'phoneme' && event.id?.includes('ə'));
      if (!vowel || !Number.isFinite(vowel.audio_position)) throw new Error(`Missing ${key} release timing.`);
      rendered = rendered.slice(0, Math.round((vowel.audio_position + 12) * sampleRate / 1000));
    }
    const first = rendered.findIndex(value => Math.abs(value) > .001);
    let last = rendered.length - 1;
    while (last > first && Math.abs(rendered[last]) <= .001) last--;
    if (first < 0 || last <= first) throw new Error(`eSpeak could not render the ${key} sound.`);
    const pad = Math.round(sampleRate * .008);
    const samples = rendered.slice(Math.max(0, first - pad), Math.min(rendered.length, last + pad + 1));
    const kind = SPELLING_DIPHONE_CLIPS[key].kind;
    const fade = Math.min(Math.round(sampleRate * .003), Math.floor(samples.length / 4));
    for (let i = 0; i < fade; i++) {
      samples[i] *= i / fade;
      samples[samples.length - 1 - i] *= i / fade;
    }
    clips[key] = { offset: total / sampleRate, duration: samples.length / sampleRate,
      kind, phone: SPELLING_DIPHONE_CLIPS[key].phone,
      gain: kind === 'consonant' || kind === 'cluster' ? 1.8 : 1,
      ...(kind === 'vowel' ? sustainPoints(samples, sampleRate) : { sustainStart: 0, sustainEnd: 0 }) };
    pieces.push({ samples, offset: total });
    total += samples.length + gap;
  }
  const samples = new Float32Array(total);
  for (const piece of pieces) samples.set(piece.samples, piece.offset);
  return { samples, sampleRate, clips };
}
