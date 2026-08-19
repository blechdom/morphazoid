import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("Throatazoid is a first-class mic and glottis-driven Morphazoid instrument", async () => {
  const [html, css, app, notices] = await Promise.all([
    readFile(new URL("throatazoid.html", root), "utf8"),
    readFile(new URL("throatazoid.css", root), "utf8"),
    readFile(new URL("throatazoid-app.js", root), "utf8"),
    readFile(new URL("THIRD_PARTY_NOTICES.md", root), "utf8"),
  ]);

  assert.match(html, /<title>THROATAZOID<\/title>/);
  assert.match(html, /<body class="throatazoid-page">/);
  assert.match(
    html,
    /class="tab throatazoid-tab active"[\s\S]*?aria-current="page"[\s\S]*?>throatazoid<\/a>/,
  );
  assert.match(html, /<option value="throatazoid\.html" selected>throatazoid<\/option>/);
  assert.match(html, /id="stage"[\s\S]*?aria-describedby="canvasInstructions liveStatus"/);
  assert.match(
    html,
    /id="stageReadout">DORMANT · PLAYABLE DEFAULT · 1P\/1M\/1G\/1N<\/span>/,
  );
  const instrumentTag = html.match(/<main\b[^>]*\bid="throatazoid"[^>]*>/)?.[0] ?? "";
  const instrumentShortcuts = (
    instrumentTag.match(/\baria-keyshortcuts="([^"]+)"/)?.[1] ?? ""
  ).split(/\s+/).filter(Boolean);
  assert.deepEqual(
    instrumentShortcuts,
    [
      ..."0123456789",
      ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ",
      ...[..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map((letter) => `Shift+${letter}`),
    ],
    "the whole instrument owns digits, ordinary letters, and all capital expressions",
  );
  assert.doesNotMatch(
    html.match(/<canvas[\s\S]*?id="stage"[\s\S]*?>/)?.[0] ?? "",
    /aria-keyshortcuts=/,
  );
  assert.match(html, /id="awakenButton"[\s\S]*?aria-pressed="false"/);
  assert.match(html, /<b id="awakenLabel">Start synth voice<\/b>/);
  assert.match(html, /Headphones recommended\./);
  assert.match(html, /Glottis mode needs no microphone\./);
  assert.match(html, /Audio is synthesized and processed in this browser\./);
  assert.match(html, /data-reset-all>Reset all parameters<\/button>/);
  assert.match(html, /THROATAZOID is very, very inspired by/);
  assert.match(
    html,
    /href="https:\/\/dood\.al\/pinktrombone\/"[\s\S]*?>Pink Trombone<\/a>/,
  );
  assert.match(
    html,
    /class="throatazoid-inspiration-note is-top"[\s\S]*?THROATAZOID is very, very inspired by[\s\S]*?href="https:\/\/dood\.al\/pinktrombone\/"[\s\S]*?>Pink Trombone<\/a>/,
    "the visible disclosure must credit and link Pink Trombone",
  );
  assert.equal(
    [...html.matchAll(/https:\/\/dood\.al\/pinktrombone\//g)].length,
    1,
    "the canonical Pink Trombone URL should appear exactly once",
  );
  assert.ok(
    html.indexOf('class="throatazoid-inspiration-note is-top"')
      < html.indexOf('<main'),
    "the Pink Trombone disclosure must appear at the top before the instrument",
  );
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(
    html,
    /href="THIRD_PARTY_NOTICES\.md">license notice<\/a>/,
    "the MIT adaptation notice must be reachable from the page",
  );
  assert.match(notices, /Copyright 2017 Neil Thapen/);
  assert.match(notices, /Permission is hereby granted, free of charge/);
  assert.match(html, /src="nav\.js"/);
  assert.match(html, /src="throatazoid-app\.js"/);
  assert.match(html, /href="throatazoid-architecture\.html"/);
  assert.match(html, /href="alien-larynx\.html"/);
  assert.doesNotMatch(html, /<details\b[^>]*\sopen(?:\s|>)/);
  assert.doesNotMatch(html, /class="[^"]*(?:subtitle|tagline)[^"]*"/i);

  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "every Throatazoid id must be unique");

  assert.match(html, /\bid="sourceButtons"/);
  const sources = [...html.matchAll(
    /<button\b[^>]*\bdata-source="([^"]+)"[^>]*>/g,
  )].map((match) => match[1]);
  assert.deepEqual(sources, ["mic", "glottis", "hybrid"]);
  assert.match(
    html,
    /data-source="glottis"\s+aria-pressed="true"/,
    "the stable internal glottis must be the default speech source",
  );
  assert.match(html, /\bid="quickSynthButton"/);
  assert.match(html, /\bid="quickMicButton"/);
  assert.match(html, /\bid="presetButtons"/);
  assert.doesNotMatch(html, /\bid="(?:voicePresetButtons|specimenButtons)"/);
  const voicePresets = [...html.matchAll(
    /<button\b[^>]*\bdata-voice-preset="([^"]+)"[^>]*>/g,
  )].map((match) => match[1]);
  assert.deepEqual(voicePresets, [
    "clear",
    "deep",
    "bright",
    "warm",
    "alto",
    "mezzo",
    "soprano",
    "airy",
    "bell",
    "coloratura",
    "whisper",
    "reed",
    "nasal",
    "growl",
    "beatbox",
    "singer",
    "choir",
    "alien",
  ]);
  assert.match(
    html,
    /data-voice-preset="clear"\s+aria-pressed="true"/,
    "the Pink-aligned playable default must be the first selected voice",
  );
  assert.match(
    html,
    /data-voice-preset="clear"[\s\S]*?<b>Playable default<\/b>[\s\S]*?classic 44-section voice/,
  );
  assert.match(html, /the synth voice is the clearest way to hear vowels/i);
  assert.match(html, /click a vowel[\s\S]*hold friction[\s\S]*press and release/i);
  assert.match(
    html,
    /id="presetButtons"[\s\S]*data-voice-preset="clear"[\s\S]*data-specimen="void"[\s\S]*id="anatomySection"/,
    "voices and alien anatomies must share one top-level mega preset bank",
  );
  const specimens = [...html.matchAll(
    /<button\b[^>]*\bdata-specimen="([^"]+)"[^>]*>/g,
  )].map((match) => match[1]);
  assert.ok(specimens.includes("choir"), "Choir remains available as its own texture");
  assert.ok(specimens.includes("singing"), "Singing must be an explicit selectable preset");
  const digitPresets = new Map([
    ["1", "triune"],
    ["2", "oracle"],
    ["3", "hive"],
    ["4", "hydra"],
    ["5", "razor"],
    ["6", "monolith"],
    ["7", "siren"],
    ["8", "larva"],
    ["9", "cathedral"],
    ["0", "singing"],
  ]);
  const specimenTags = [...html.matchAll(
    /<button\b[^>]*\bdata-specimen="([^"]+)"[^>]*>/g,
  )].map((match) => [match[1], match[0]]);
  for (const [digit, specimen] of digitPresets) {
    const tag = specimenTags.find(([name]) => name === specimen)?.[1] ?? "";
    assert.match(
      tag,
      new RegExp(`\\bdata-shortcut="${digit}"`),
      `${specimen} needs its visible ${digit} shortcut badge`,
    );
    assert.match(
      tag,
      new RegExp(`\\baria-keyshortcuts="${digit}"`),
      `${specimen} needs its accessible ${digit} shortcut`,
    );
  }
  assert.match(html, /0(?:–|-)9 loads these organisms anywhere/i);
  assert.match(html, /0(?:–|-)9<\/i>\s*loads alien anatomy presets across the UI/i);
  assert.match(
    html,
    /data-specimen="singing"[\s\S]*?<span>Singing<\/span>[\s\S]*?<small>[^<]*(?:voice|sing|vowel)[^<]*<\/small>/i,
  );
  assert.match(html, /\bid="pressureSourceCount"/);
  assert.match(html, /\bid="pressureSourceButtons"/);
  assert.deepEqual(
    [...html.matchAll(/\bdata-pressure-source="([^"]+)"/g)].map((match) => match[1]),
    ["0", "1", "2", "3"],
  );
  assert.match(html, /\bid="mouthGateButtons"/);
  assert.deepEqual(
    [...html.matchAll(/\bdata-mouth-gate="([^"]+)"/g)].map((match) => match[1]),
    ["0", "1", "2", "3", "4", "5", "6"],
  );

  assert.match(html, /\bid="articulationSection"/);
  assert.match(html, /\bid="articulationSummary"/);
  assert.match(html, /\bid="tongueButtons"/);
  assert.match(html, /\bid="noseButtons"/);
  assert.match(html, /\bid="phonemeButtons"/);
  assert.match(
    html,
    /id="typingModeButton"[\s\S]*?role="switch"[\s\S]*?aria-checked="false"/,
  );
  assert.match(html, /\bid="typingModeState">momentary<\/span>/);
  assert.match(html, /Keyboard gate/i);
  assert.match(html, /A(?:–|-)Z works across the instrument/i);
  assert.match(html, /Shift mutates each letter/i);
  assert.match(html, /arm to silence between keys/i);
  assert.match(html, /A(?:–|-)Z and 0(?:–|-)9 work across the UI/i);
  assert.match(html, /Shift\+A(?:–|-)Z triggers bigger expressions/i);
  assert.match(html, /0(?:–|-)9 loads anatomies/i);
  assert.match(html, /\bid="alphabetKeyMap"/);
  const alphabetKeys = [...html.matchAll(
    /<kbd\b[^>]*\bdata-letter="([a-z])"[^>]*>/g,
  )].map((match) => match[1]);
  assert.deepEqual(alphabetKeys, [..."qwertyuiopasdfghjklzxcvbnm"]);
  assert.equal(new Set(alphabetKeys).size, 26);
  const tongues = [...html.matchAll(
    /<button\b[^>]*\bdata-tongue="([^"]+)"[^>]*>/g,
  )].map((match) => match[1]);
  const noses = [...html.matchAll(
    /<button\b[^>]*\bdata-nose="([^"]+)"[^>]*>/g,
  )].map((match) => match[1]);
  const phonemes = [...html.matchAll(
    /<button\b[^>]*\bdata-phoneme="([^"]+)"[^>]*>/g,
  )].map((match) => match[1]);
  assert.deepEqual(tongues, ["0", "1", "2", "3", "4"]);
  assert.deepEqual(noses, ["0", "1", "2"]);
  assert.deepEqual(phonemes, [
    "a",
    "e",
    "i",
    "o",
    "u",
    "glottal",
    "k",
    "t",
    "p",
    "s",
    "sh",
    "f",
    "m",
    "n",
    "ng",
  ]);
  assert.deepEqual(
    [...html.matchAll(/<kbd(?:\s[^>]*)?>([A-Z])/g)].map((match) => match[1]),
    [..."QWERTYUIOPASDFGHJKLZXCVBNM"],
  );
  for (const id of [
    "stageGuide",
    "stageArticulation",
    "articulationGestureOut",
    "articulationPlace",
    "articulationAperture",
    "articulationLip",
    "articulationPressure",
    "articulationVoicing",
  ]) {
    assert.match(html, new RegExp(`\\bid="${id}"`), `${id} direct articulation hook is required`);
  }
  assert.match(html, /data-tongue="0"[\s\S]*?aria-label="Select tongue one"/);
  assert.match(html, /data-tongue="4"[\s\S]*?aria-label="Select tongue five"/);
  assert.match(html, /data-nose="0"[\s\S]*?aria-label="Select nose one"/);

  assert.match(
    html,
    /class="throatazoid-motion"[\s\S]*?aria-labelledby="motionTitle"[\s\S]*?aria-describedby="motionHelp"/,
  );
  assert.match(
    html,
    /id="motionButton"[\s\S]*?role="switch"[\s\S]*?aria-checked="false"[\s\S]*?aria-labelledby="motionTitle motionState"[\s\S]*?aria-describedby="motionHelp"/,
  );
  assert.match(html, /\bid="motionState">off<\/span>/);
  assert.match(
    html,
    /<label[^>]*for="motionDepth"[\s\S]*?<output id="motionDepthOut" for="motionDepth">55%<\/output>[\s\S]*?<input[\s\S]*?id="motionDepth"[\s\S]*?type="range"[\s\S]*?value="0\.55"/,
  );
  assert.match(
    html,
    /id="motionTargetButtons"[\s\S]*?role="group"[\s\S]*?aria-labelledby="motionTargetLabel"/,
  );
  assert.deepEqual(
    [...html.matchAll(/\bdata-motion-target="([^"]+)"/g)].map((match) => match[1]),
    ["mouths", "tongues", "noses", "pressure"],
  );
  for (const target of ["mouths", "tongues", "noses", "pressure"]) {
    assert.match(
      html,
      new RegExp(`data-motion-target="${target}"[^>]*aria-pressed="true"`),
      `${target} motion starts available`,
    );
  }
  assert.match(html, /Fast motion follows Vibrato; slow drift follows Wobble/i);
  assert.match(html, /Drawing only[\s\S]*the sounding tract stays precise/i);

  for (const output of [
    "tongueCountOut",
    "selectedTonguePositionOut",
    "selectedTongueHeightOut",
    "selectedTongueCurlOut",
    "noseCountOut",
    "selectedNoseOpennessOut",
    "selectedNoseLengthOut",
    "selectedNoseResonanceOut",
    "oralClosureOut",
  ]) {
    assert.match(html, new RegExp(`\\bid="${output}"`), `${output} hook is required`);
  }

  for (const control of [
    "level",
    "inputTrim",
    "inputStability",
    "exciterPitch",
    "exciterIntensity",
    "exciterTenseness",
    "exciterBreath",
    "exciterVibrato",
    "exciterWobble",
    "pressureSourceCount",
    "throatCount",
    "bodyLength",
    "tension",
    "mutation",
    "motionDepth",
    "tongueCount",
    "selectedTonguePosition",
    "selectedTongueHeight",
    "selectedTongueCurl",
    "noseCount",
    "selectedNoseOpenness",
    "selectedNoseLength",
    "selectedNoseResonance",
    "oralClosure",
    "selectedAperture",
    "selectedLength",
    "articulationLip",
    "wet",
    "dry",
    "growl",
    "coupling",
    "spread",
  ]) {
    assert.match(html, new RegExp(`<label[^>]*for="${control}"`), `${control} needs a label`);
  }

  assert.match(css, /--xeno-black:\s*#020302/);
  assert.match(css, /\.throatazoid-word/);
  assert.match(css, /\.throatazoid-inspiration-note/);
  assert.match(css, /\.throatazoid-performance-presets/);
  assert.match(css, /\.throatazoid-preset-bank/);
  assert.match(css, /\.throatazoid-motion/);
  assert.match(css, /\.throatazoid-motion-targets button/);
  assert.match(css, /\.is-capital/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(app, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(app, /echoCancellation:\s*(?:false|\{\s*ideal:\s*false\s*\})/);
  assert.match(app, /noiseSuppression:\s*(?:false|\{\s*ideal:\s*false\s*\})/);
  assert.match(app, /autoGainControl:\s*(?:false|\{\s*ideal:\s*false\s*\})/);
  assert.match(app, /createPeriodicWave/);
  assert.match(app, /createBufferSource/);
  assert.match(app, /glottalHarmonics/);
  assert.match(app, /createDynamicsCompressor/);
  assert.match(app, /makeCeilingCurve/);
  assert.match(app, /createMediaStreamDestination/);
  assert.match(app, /throatVoiceParameters/);
  assert.match(app, /noseVoiceParameters/);
  assert.match(app, /PHONEMES/);
  assert.match(app, /tongue-curl/);
  assert.match(app, /nose-resonance/);
  assert.match(app, /body-membrane/);
  assert.match(app, /document\.addEventListener\("keyup"/);
  assert.match(css, /\.is-held|\[data-held="true"\]/);
  assert.match(app, /pointerdown/);
  assert.match(app, /Emergency sever complete/);
});
