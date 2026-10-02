import test from 'node:test';
import assert from 'node:assert/strict';
import { JAPANESE_SYLLABLE_GROUPS } from '../src/families/speech/japanese-syllables.js';
import { tokenizeSinsyLyrics, sinsyLyricsToKana } from '../src/families/speech/sinsy-lyrics.js';

const lyrics = text => tokenizeSinsyLyrics(text).map(token => token.lyric);

test('hiragana, katakana, and literal romaji create the same singable mora', () => {
  const expected = ['こ','ん','に','ち','わ','せ','か','い'];
  assert.deepEqual(lyrics('こんにちわ、せかい！'), expected);
  assert.deepEqual(lyrics('コンニチワ、セカイ！'), expected);
  assert.deepEqual(lyrics('konnichiwa, sekai!'), expected);
  // The written particle is preserved; this is not a Japanese word reader.
  assert.deepEqual(lyrics('こんにちは'), ['こ','ん','に','ち','は']);
});

test('longest native mora keeps palatals and extended vowels on one note', () => {
  assert.deepEqual(lyrics('きゃ ふぁ てぃ くゎ しぃ'), ['きゃ','ふぁ','てぃ','くゎ','しぃ']);
  assert.deepEqual(lyrics('kya fa ti kwa si'), ['きゃ','ふぁ','てぃ','くぁ','すぃ']);
  assert.deepEqual(tokenizeSinsyLyrics('きゃ')[0], {lyric:'きゃ',display:'kya · きゃ',phonemes:'ky a',kind:'mora'});
});

test('canonical native loanword romaji wins over conflicting traditional aliases', () => {
  assert.deepEqual(lyrics('ji zu wo di du si ti tu zi'), ['じ','ず','を','でぃ','どぅ','すぃ','てぃ','とぅ','ずぃ']);
  assert.deepEqual(tokenizeSinsyLyrics('ぢ づ うぉ').map(token => token.phonemes), ['j i','z u','w o']);
});

test('nasal n distinguishes following vowels, y sounds, and consonants', () => {
  const cases = [
    ['kanpai', ['か','ん','ぱ','い']], ['konnichiwa', ['こ','ん','に','ち','わ']],
    ["shin'you", ['し','ん','よ','う']], ['shin’you', ['し','ん','よ','う']],
    ['shinyou', ['し','にょ','う']], ['nnya', ['ん','にゃ']],
    ['nn', ['ん']], ['n', ['ん']], ['ann', ['あ','ん']],
    ['anna', ['あ','ん','な']], ['nnka', ['ん','か']],
    ['n a n ya', ['ん','あ','ん','や']], ['kan,i', ['か','ん','い']],
  ];
  for (const [input, expected] of cases) assert.deepEqual(lyrics(input), expected, input);
  assert.equal(tokenizeSinsyLyrics('n')[0].kind, 'nasal');
});

test('gemination creates native closure notes including Hepburn tch', () => {
  const cases = [
    ['kitte', ['き','っ','て']], ['gakkou', ['が','っ','こ','う']],
    ['matcha', ['ま','っ','ちゃ']], ['masshiro', ['ま','っ','し','ろ']],
    ['mittsu', ['み','っ','つ']], ['beddo', ['べ','っ','ど']],
    ['ippai', ['い','っ','ぱ','い']], ['a xtsu a ltsu', ['あ','っ','あ','っ']],
  ];
  for (const [input, expected] of cases) assert.deepEqual(lyrics(input), expected, input);
  assert.deepEqual(tokenizeSinsyLyrics('っ')[0], {lyric:'っ',display:'closure · っ',phonemes:'cl',kind:'closure'});
});

test('explicit macrons and native long marks retain native continuation semantics', () => {
  for (const text of ['Tōkyō', 'Tôkyô', 'トーキョー', 'とーきょー']) {
    assert.deepEqual(lyrics(text), ['と','ー','きょ','ー']);
    assert.equal(sinsyLyricsToKana(text), 'とーきょー');
  }
  assert.deepEqual(lyrics('ā ī ū ē ō'), ['あ','ー','い','ー','う','ー','え','ー','お','ー']);
  assert.deepEqual(tokenizeSinsyLyrics('あーー').map(token => token.phonemes), ['a','a','a']);
  assert.deepEqual(tokenizeSinsyLyrics('んー').map(token => token.phonemes), ['N','N']);
  assert.deepEqual(tokenizeSinsyLyrics('あっー').map(token => token.phonemes), ['a','cl','a']);
  assert.equal(tokenizeSinsyLyrics('あー')[1].kind, 'long-vowel');
  for (const text of ['ー', ' ーあ', 'っー']) assert.throws(() => lyrics(text), /must follow/);
});

test('repeated vowels and ou / ei remain authored vowels rather than guessed pronunciations', () => {
  assert.deepEqual(lyrics('aa ou ei too tou toー'), ['あ','あ','お','う','え','い','と','お','と','う','と','ー']);
});

test('native unusual and archaic spellings keep their actual native phonemes', () => {
  const output = tokenizeSinsyLyrics('ゔゃ ゔゅ ゔょ ゐ ゑ ゎ ゃ ゅ ょ しぃ');
  assert.deepEqual(output.map(token => token.phonemes), ['by a','by u','by o','i','e','w a','y a','y u','y o','s i']);
  assert.equal(output[0].lyric, 'ゔゃ');
});

test('all displayed native syllables and katakana equivalents are supported', () => {
  let count = 0;
  for (const group of JAPANESE_SYLLABLE_GROUPS) {
    for (const choice of group.syllables) {
      const katakana = choice.kana.replace(/[ぁ-ゖ]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60));
      for (const text of [choice.kana, katakana]) {
        const tokens = tokenizeSinsyLyrics(text);
        assert.equal(tokens.length, 1, text);
        assert.equal(tokens[0].lyric, choice.kana, text);
        assert.equal(tokens[0].phonemes, choice.phonemes, text);
      }
      assert.equal(tokenizeSinsyLyrics(choice.romaji).length, 1, choice.romaji);
      count++;
    }
  }
  assert.equal(count, 155);
});

test('normalization supports halfwidth kana, fullwidth romaji, and combining diacritics', () => {
  assert.deepEqual(lyrics('ｶﾞｯｷｭｰ ｼﾞｬ'), ['が','っ','きゅ','ー','じゃ']);
  assert.deepEqual(lyrics('ＫＹＡ ＳＨＩ ＴＳＵ'), ['きゃ','し','つ']);
  assert.deepEqual(lyrics('か\u3099 う\u3099ぁ To\u0304kyo\u0304'), ['が','ゔぁ','と','ー','きょ','ー']);
});

test('punctuation and spaces separate syllables without creating invented rests', () => {
  assert.deepEqual(lyrics('「ka」, (ki);\nku! ke? ko… / a-i'), ['か','き','く','け','こ','あ','い']);
  assert.deepEqual(lyrics(' \n\t、。!?'), []);
  assert.deepEqual(lyrics(''), []);
});

test('unsupported symbols, kanji, and non-romaji sequences fail without returning a partial phrase', () => {
  for (const input of ['日本語', 'あ日', 'hello', 'sakura please', '123', 'あ🎵', 'ça', 'tch', 'x', 'q']) {
    assert.throws(() => tokenizeSinsyLyrics(input), /needs kana or explicit romaji/, input);
  }
  for (const input of [null, undefined, 42, {}, ['あ']]) assert.throws(() => tokenizeSinsyLyrics(input), TypeError);
  assert.throws(() => tokenizeSinsyLyrics('き’'), /custom note lyric/);
});

test('parseable Latin homographs are explicitly literal romaji, never translated English', () => {
  assert.deepEqual(lyrics('tone'), ['と','ね']);
  assert.deepEqual(lyrics('name'), ['な','め']);
});

test('conversion has no note cap, no input mutation, and no shared token state', () => {
  const text = 'ka '.repeat(100), before = text;
  assert.equal(tokenizeSinsyLyrics(text).length, 100);
  assert.equal(text, before);
  const result = tokenizeSinsyLyrics('ka'); result[0].lyric = 'changed';
  assert.deepEqual(lyrics('ka'), ['か']);
  assert.equal(sinsyLyricsToKana('ｻｸﾗ sakura'), 'さくらさくら');
});
