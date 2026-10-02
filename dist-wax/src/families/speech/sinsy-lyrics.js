import { JAPANESE_SYLLABLE_GROUPS } from './japanese-syllables.js';

// The shipped Sinsy 0.92 Japanese dictionary is the authority for these
// spellings and phonemes. Romaji is a reading aid, not a text-to-speech engine:
// no kanji reading, translation, particle substitution, or word guessing occurs.
const choices = JAPANESE_SYLLABLE_GROUPS.flatMap(group => group.syllables);
const kana = new Map(choices.map(choice => [choice.kana, choice]));
const romaji = new Map();
for (const choice of choices) {
  // Ordinary ji / zu / wo choose じ / ず / を deterministically.
  if (!romaji.has(choice.romaji)) romaji.set(choice.romaji, choice);
}
for (const choice of choices) {
  // Native loanword di / du must win over the aliases for ぢ / づ.
  for (const alias of choice.aliases || []) if (!romaji.has(alias)) romaji.set(alias, choice);
}

// These additional kana complete the native table after katakana folding.
// In particular, native ゔゃ / ゔゅ / ゔょ use by, not an invented vy sound.
for (const [spelling, phonemes] of [
  ['くゎ', 'k w a'], ['ぐゎ', 'g w a'],
  ['ゔょ', 'by o'], ['ゔゅ', 'by u'], ['ゔゃ', 'by a'],
  ['ゑ', 'e'], ['ゐ', 'i'], ['ゎ', 'w a'],
  ['ょ', 'y o'], ['ゅ', 'y u'], ['ゃ', 'y a'], ['っ', 'cl'],
  ['しぃ', 's i'], ['ぉ', 'o'], ['ぇ', 'e'], ['ぅ', 'u'], ['ぃ', 'i'], ['ぁ', 'a'],
]) {
  const equivalent = choices.find(choice => choice.phonemes === phonemes);
  kana.set(spelling, {kana: spelling, romaji: equivalent?.romaji || 'closure', phonemes});
}
for (const spelling of ['xtsu', 'xtu', 'ltsu', 'ltu']) romaji.set(spelling, kana.get('っ'));
const kanaKeys = [...kana.keys()].sort((a, b) => b.length - a.length);
const romajiKeys = [...romaji.keys()].sort((a, b) => b.length - a.length);
const longVowels = {ā:'a', ī:'i', ū:'u', ē:'e', ō:'o', â:'a', î:'i', û:'u', ê:'e', ô:'o'};
const separator = /[\s.,!?;:、。・，．！？；：「」『』（）()[\]{}〈〉《》【】“”"'‘…\/\\\-–—]/u;

function normalizeLyrics(text) {
  if (typeof text !== 'string') throw new TypeError('Sinsy lyrics must be text.');
  return text.normalize('NFKC').toLowerCase()
    .replace(/[ァ-ヶ]/g, character => String.fromCharCode(character.charCodeAt(0) - 0x60))
    .replace(/[āīūēōâîûêô]/g, character => longVowels[character] + 'ー')
    .normalize('NFC');
}

/** Split hiragana, katakana, or explicit romaji into native Sinsy note lyrics.
 * Returns new {lyric, display, phonemes, kind} objects, one per mora or native
 * continuation/closure. Latin is always literal romaji, including words that
 * also happen to exist in English. Punctuation separates text without rests.
 * Repeated vowels stay separate; ー and macrons explicitly prolong a vowel.
 * Native vowel-reduction markup needs a custom per-note lyric because its
 * meaning depends on multiple syllables sharing the same native note.
 * No phrase-length cap or silent truncation is imposed by this pure helper.
 */
export function tokenizeSinsyLyrics(text) {
  const source = normalizeLyrics(text), tokens = [];
  let position = 0, continuationVowel = null;
  const emit = choice => {
    const kind = choice.phonemes === 'N' ? 'nasal' : choice.phonemes === 'cl' ? 'closure' : 'mora';
    tokens.push({lyric: choice.kana, display: `${choice.romaji} · ${choice.kana}`, phonemes: choice.phonemes, kind});
    const vowel = choice.phonemes.split(' ').at(-1);
    if (/^[aiueoN]$/.test(vowel)) continuationVowel = vowel;
  };
  const romanMatch = offset => romajiKeys.find(key => source.startsWith(key, offset));
  while (position < source.length) {
    const character = source[position];
    if (separator.test(character)) { position++; continue; }
    if (character === 'ー') {
      if (!continuationVowel) throw new Error('A Sinsy long-vowel mark (ー) must follow a sung vowel or nasal.');
      tokens.push({lyric:'ー', display:`${continuationVowel.toLowerCase()}— · ー`, phonemes:continuationVowel, kind:'long-vowel'});
      position++; continue;
    }
    if (character === 'n') {
      const next = source[position + 1], after = source[position + 2];
      if (next === "'" || next === '’') { emit(kana.get('ん')); position += 2; continue; }
      if (next === 'n') {
        emit(kana.get('ん'));
        // konnichiwa => ko / n / ni / chi / wa; final nn is one nasal.
        position += after && /[aiueoy]/.test(after) ? 1 : 2;
        continue;
      }
      if (!next || !/[aiueoy]/.test(next)) { emit(kana.get('ん')); position++; continue; }
    }
    const nativeMatch = kanaKeys.find(key => source.startsWith(key, position));
    if (nativeMatch) { emit(kana.get(nativeMatch)); position += nativeMatch.length; continue; }
    // Doubled consonants, including voiced loanword stops, use native cl.
    // Hepburn matcha is ma / cl / cha rather than an unrecognized tcha.
    const doubled = /[bcdfghjkmprstvz]/.test(character) && character === source[position + 1];
    const tch = source.startsWith('tch', position);
    if ((doubled || tch) && romanMatch(position + 1)) {
      emit(kana.get('っ')); position++; continue;
    }
    const roman = romanMatch(position);
    if (roman) { emit(romaji.get(roman)); position += roman.length; continue; }
    if (character === '’') throw new Error('Use a custom note lyric for Sinsy’s native vowel-reduction mark (’).');
    const near = source.slice(position, position + 12);
    throw new Error(`Sinsy needs kana or explicit romaji; cannot read “${near}”. Kanji and English are not translated.`);
  }
  return tokens;
}

/** Join native kana for display/export. Build notes from the token array, not
 * by re-tokenizing this string: removing separators can merge き + ゃ to きゃ.
 */
export function sinsyLyricsToKana(text) {
  return tokenizeSinsyLyrics(text).map(token => token.lyric).join('');
}
