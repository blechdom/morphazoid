import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  SPELLING_ENGINES,
  SPELLING_PERSONALITIES,
  insertedText,
  isSpellingPairPrefix,
  isSpellingVowel,
  previousTypedLetter,
  remapSpellingOffset,
  spellingArticulation,
  spellingContextualArticulation,
  spellingDiphthong,
  spellingEngine,
  spellingPair,
  spellingPerformanceState,
  spellingPersonality,
  spellingSoundLabel,
  spellingTextEdit,
  spellingTokens,
  typingDynamics,
} from "../src/spelling-synthesizer.js";

const root = new URL("../", import.meta.url);

test("Spelling Synthesizer is a focused, accessible text-driven voice instrument", async () => {
  const [html, css, app, audio] = await Promise.all([
    readFile(new URL("spelling-synthesizer.html", root), "utf8"),
    readFile(new URL("spelling-synthesizer.css", root), "utf8"),
    readFile(new URL("spelling-synthesizer-app.js", root), "utf8"),
    readFile(new URL("src/spelling-synthesizer-audio.js", root), "utf8"),
  ]);

  assert.match(html, /<title>Spelling Synthesizer — Morphazoid<\/title>/);
  assert.match(html, /<body class="spelling-synthesizer-page">/);
  assert.match(html, /aria-current="page"[\s\S]*?>spelling synthesizer<\/a>/);
  assert.match(html, /<h1 id="spellingTitle">Spelling Synthesizer<\/h1>/);
  assert.match(
    html,
    /<label class="spelling-input-wrap" for="spellingInput">[\s\S]*?<textarea[\s\S]*?id="spellingInput"[\s\S]*?aria-describedby="spellingHelp"/,
  );
  assert.match(html, /id="liveStatus" aria-live="polite"/);
  assert.match(html, /id="audioError" role="alert" hidden/);
  assert.match(html, /id="pairGlidesButton"[\s\S]*?role="switch"[\s\S]*?aria-checked="true"/);
  assert.match(html, /id="rhythmAmount" type="range"/);
  assert.match(html, /id="diphthongDelay" type="range"/);
  assert.match(html, /id="readbackButton"[\s\S]*?>Read it back to me<\/button>/);
  assert.match(html, /Typing interrupts it, then it[\s\S]*?continues when you pause/);
  assert.match(html, /href="throatazoid\.html">Open the full Throatazoid anatomy/);
  assert.match(html, /src="nav\.js"/);
  assert.match(html, /src="spelling-synthesizer-app\.js"/);

  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "every page id must be unique");
  assert.deepEqual(
    [...html.matchAll(/\bdata-engine="([^"]+)"/g)].map((match) => match[1]),
    ["tube", "diphone", "vocoder"],
  );
  assert.deepEqual(
    [...html.matchAll(/\bdata-personality="([^"]+)"/g)].map((match) => match[1]),
    ["clear", "warm", "whisper", "reed", "creature"],
  );

  assert.match(css, /#spellingInput\s*\{/);
  assert.match(css, /"Courier New"[\s\S]*?"Liberation Mono"/);
  assert.match(css, /@media \(max-width: 860px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(app, /addEventListener\("compositionstart"/);
  assert.match(app, /addEventListener\("compositionend"/);
  assert.match(app, /addEventListener\("input", handleEditorInput\)/);
  assert.match(app, /SpeechSynthesisUtterance/);
  assert.match(app, /scheduleReadbackContinuation/);
  assert.match(app, /scheduleTypedCharacter/);
  assert.match(app, /slice\(0, 32\)/, "pasted and composed playback stays bounded");
  assert.match(audio, /throatazoid-tract-processor\.js/);
  assert.match(audio, /SPELLING_DIPHONE_ATLAS_URL/);
  assert.match(audio, /spelling-vocoder-processor\.js/);
});

test("each selectable engine and personality has stable public metadata", () => {
  assert.deepEqual(Object.keys(SPELLING_ENGINES), ["tube", "diphone", "vocoder"]);
  assert.deepEqual(
    Object.keys(SPELLING_PERSONALITIES),
    ["clear", "warm", "whisper", "reed", "creature"],
  );
  assert.equal(spellingEngine("vocoder"), "vocoder");
  assert.equal(spellingEngine("missing"), "tube");
  assert.equal(spellingPersonality("whisper"), "whisper");
  assert.equal(spellingPersonality("missing"), "clear");
  for (const engine of Object.values(SPELLING_ENGINES)) {
    assert.ok(engine.name.length > 3);
    assert.ok(engine.lineage.length > 5);
    assert.ok(engine.description.length > 30);
    assert.match(engine.color, /^#[\da-f]{6}$/i);
    assert.equal(Object.isFrozen(engine), true);
  }
});

test("all alphabet keys resolve to playable Throatazoid articulations", () => {
  for (const letter of "abcdefghijklmnopqrstuvwxyz") {
    const articulation = spellingArticulation(letter);
    assert.ok(articulation, `${letter} needs an articulation`);
    assert.ok(spellingSoundLabel(articulation), `${letter} needs a sound label`);
    assert.equal(spellingArticulation(letter.toUpperCase()), articulation);
  }
  assert.equal(spellingArticulation(""), "");
  assert.equal(spellingArticulation("th"), "");
  assert.equal(spellingArticulation("1"), "");
  assert.equal(isSpellingVowel("A"), true);
  assert.equal(isSpellingVowel("y"), false);
  assert.equal(spellingContextualArticulation("c", "i"), "s");
  assert.equal(spellingContextualArticulation("c", "a"), "k");
  assert.equal(spellingContextualArticulation("g", "e"), "j");
  assert.equal(spellingContextualArticulation("g", "a"), "g");
});

test("vowel pairs become spelling-aware delayed transitions", () => {
  assert.deepEqual(spellingDiphthong("a", "i"), {
    from: "e",
    to: "iy",
    label: "EY /eɪ/",
  });
  assert.deepEqual(spellingDiphthong("O", "Y"), {
    from: "ao",
    to: "iy",
    label: "OY /ɔɪ/",
  });
  assert.deepEqual(spellingDiphthong("o", "w"), {
    from: "o",
    to: "uw",
    label: "AW /aʊ/",
  });
  assert.equal(spellingDiphthong("e", "r"), null);
});

test("greedy spelling tokens fuse common digraphs and vowel gestures", () => {
  assert.equal(isSpellingPairPrefix("T"), true);
  assert.equal(isSpellingPairPrefix("r"), false);
  assert.deepEqual(spellingPair("t", "h"), {
    kind: "digraph",
    label: "TH",
    sounds: [{ articulation: "th", label: "TH" }],
  });
  assert.deepEqual(
    spellingTokens("thing about sheep").map(({ type, source, kind, label }) => ({
      type,
      source,
      kind,
      label,
    })),
    [
      { type: "sound", source: "th", kind: "digraph", label: "TH" },
      { type: "sound", source: "i", kind: "letter", label: "IH" },
      { type: "sound", source: "ng", kind: "digraph", label: "NG" },
      { type: "boundary", source: " ", kind: undefined, label: undefined },
      { type: "sound", source: "a", kind: "letter", label: "AE" },
      { type: "sound", source: "b", kind: "letter", label: "B" },
      { type: "sound", source: "ou", kind: "vowel pair", label: "AW /aʊ/" },
      { type: "sound", source: "t", kind: "letter", label: "T" },
      { type: "boundary", source: " ", kind: undefined, label: undefined },
      { type: "sound", source: "sh", kind: "digraph", label: "SH" },
      { type: "sound", source: "ee", kind: "vowel pair", label: "IY /i/" },
      { type: "sound", source: "p", kind: "letter", label: "P" },
    ],
  );
  assert.deepEqual(
    spellingTokens("cat city gem gap").filter(({ type }) => type === "sound")
      .map(({ source, sounds }) => [source, sounds[0].articulation]),
    [
      ["c", "k"], ["a", "a"], ["t", "t"],
      ["c", "s"], ["i", "i"], ["t", "t"], ["y", "y"],
      ["g", "j"], ["e", "e"], ["m", "m"],
      ["g", "g"], ["a", "a"], ["p", "p"],
    ],
    "one-letter lookahead covers common soft-C and soft-G spellings",
  );
  assert.deepEqual(
    spellingTokens("thow", { joinPairs: false }).map(({ source }) => source),
    ["t", "h", "o", "w"],
    "the live pair switch also applies to pasted and composed text",
  );
  assert.equal(
    spellingTokens("city", { joinPairs: false })[0].sounds[0].articulation,
    "k",
    "turning lookahead off also restores the immediate hard-C fallback",
  );
});

test("typing dynamics stay finite and turn tempo, surprise, and capitals into expression", () => {
  const fast = typingDynamics({ intervalMs: 75, averageIntervalMs: 320, amount: 1 });
  const slow = typingDynamics({ intervalMs: 720, averageIntervalMs: 720, amount: 1 });
  const capital = typingDynamics({ intervalMs: 320, averageIntervalMs: 320, amount: 1, capital: true });
  const plain = typingDynamics({ intervalMs: 320, averageIntervalMs: 320, amount: 1 });
  const hostile = typingDynamics({ intervalMs: -Infinity, averageIntervalMs: NaN, amount: 99 });

  assert.ok(fast.pace > slow.pace);
  assert.ok(fast.durationMs < slow.durationMs);
  assert.ok(fast.attackMs < slow.attackMs);
  assert.ok(capital.emphasis > plain.emphasis);
  assert.ok(capital.pitchCents > plain.pitchCents);
  for (const result of [fast, slow, capital, plain, hostile]) {
    for (const value of Object.values(result)) assert.equal(Number.isFinite(value), true);
    assert.ok(result.emphasis >= 0 && result.emphasis <= 1);
    assert.ok(result.velocity >= 0 && result.velocity <= 1);
    assert.ok(result.durationMs >= 95 && result.durationMs <= 520);
  }
});

test("performance states are fresh, bounded voice bodies with distinct personalities", () => {
  const dynamics = typingDynamics({ intervalMs: 160, averageIntervalMs: 320, amount: 0.8 });
  const clear = spellingPerformanceState({
    personality: "clear",
    articulation: "s",
    carrierVowel: "a",
    dynamics,
  });
  const repeat = spellingPerformanceState({
    personality: "clear",
    articulation: "s",
    carrierVowel: "a",
    dynamics,
  });
  const creature = spellingPerformanceState({
    personality: "creature",
    articulation: "s",
    carrierVowel: "a",
    dynamics,
  });

  assert.equal(clear.phoneme, "s");
  assert.equal(clear.articulationManner, "fricative");
  assert.ok(clear.exciterPitch >= 40 && clear.exciterPitch <= 520);
  assert.ok(clear.exciterBreath >= 0 && clear.exciterBreath <= 1);
  assert.notEqual(clear.throats, repeat.throats);
  assert.notEqual(clear.tongues, repeat.tongues);
  assert.notEqual(clear.noses, repeat.noses);
  assert.equal(creature.spellingPersonality, "creature");
  assert.ok(creature.throatCount > clear.throatCount);
  assert.ok(creature.exciterPitch < clear.exciterPitch);

  const ch = spellingPerformanceState({ articulation: "c", carrierVowel: "a", dynamics });
  const hAfterO = spellingPerformanceState({ articulation: "h", carrierVowel: "o", dynamics });
  assert.equal(ch.phoneme, "c");
  assert.equal(ch.articulationManner, "affricate");
  assert.equal(hAfterO.lipDiameter, 3, "carrier-colored H inherits spelling AA, not old rounded O");
  for (const vowel of ["iy", "ao", "uw"]) {
    const state = spellingPerformanceState({ articulation: vowel, carrierVowel: "a", dynamics });
    assert.equal(state.phoneme, vowel, `${vowel.toUpperCase()} keeps its spelling-specific tube target`);
    assert.equal(state.articulationManner, "vowel");
  }
});

test("text diffs isolate insertions without replaying deletion or unchanged text", () => {
  assert.equal(insertedText("spell", "spelling"), "ing");
  assert.equal(insertedText("spelling", "spell"), "");
  assert.equal(insertedText("cat", "coat"), "o");
  assert.equal(insertedText("same", "same"), "");
  assert.equal(insertedText("", "voice"), "voice");
  assert.equal(previousTypedLetter("hello", 5), "o");
  assert.equal(previousTypedLetter("hello ", 6), "");
  assert.equal(previousTypedLetter("AI", 2), "i");

  const insertion = spellingTextEdit("hello world", "hello brave world");
  assert.deepEqual(insertion, { start: 6, removed: "", inserted: "brave " });
  assert.equal(remapSpellingOffset(11, insertion), 17);
  const replacement = spellingTextEdit("speling", "spelling");
  assert.deepEqual(replacement, { start: 4, removed: "", inserted: "l" });
  assert.equal(remapSpellingOffset(4, replacement), 5);
});
