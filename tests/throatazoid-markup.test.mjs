import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("Throatazoid is a first-class mic and glottis-driven Morphazoid instrument", async () => {
  const [html, css, app] = await Promise.all([
    readFile(new URL("throatazoid.html", root), "utf8"),
    readFile(new URL("throatazoid.css", root), "utf8"),
    readFile(new URL("throatazoid-app.js", root), "utf8"),
  ]);

  assert.match(html, /<title>THROATAZOID<\/title>/);
  assert.match(html, /<body class="throatazoid-page">/);
  assert.match(
    html,
    /class="tab throatazoid-tab active"[\s\S]*?aria-current="page"[\s\S]*?>throatazoid<\/a>/,
  );
  assert.match(html, /<option value="throatazoid\.html" selected>throatazoid<\/option>/);
  assert.match(html, /id="stage"[\s\S]*?aria-describedby="canvasInstructions liveStatus"/);
  assert.match(html, /id="stageReadout">DORMANT · TRIUNE · 3T\/2G\/2N<\/span>/);
  assert.match(html, /id="awakenButton"[\s\S]*?aria-pressed="false"/);
  assert.match(html, /<b id="awakenLabel">Awaken<\/b>/);
  assert.match(html, /Headphones recommended\./);
  assert.match(html, /Glottis mode needs no microphone\./);
  assert.match(html, /Audio is synthesized and processed in this browser\./);
  assert.match(html, /data-reset-all>Reset all parameters<\/button>/);
  assert.match(html, /THROATAZOID is very, very inspired by/);
  assert.match(
    html,
    /href="https:\/\/dood\.al\/pinktrombone\/"[\s\S]*?>Pink Trombone<\/a>/,
  );
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /src="nav\.js"/);
  assert.match(html, /src="throatazoid-app\.js"/);
  assert.doesNotMatch(html, /<details\b[^>]*\sopen(?:\s|>)/);
  assert.doesNotMatch(html, /class="[^"]*(?:subtitle|tagline)[^"]*"/i);

  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "every Throatazoid id must be unique");

  assert.match(html, /\bid="sourceButtons"/);
  const sources = [...html.matchAll(
    /<button\b[^>]*\bdata-source="([^"]+)"[^>]*>/g,
  )].map((match) => match[1]);
  assert.deepEqual(sources, ["mic", "glottis", "hybrid"]);

  assert.match(html, /\bid="articulationSection"/);
  assert.match(html, /\bid="articulationSummary"/);
  assert.match(html, /\bid="tongueButtons"/);
  assert.match(html, /\bid="noseButtons"/);
  assert.match(html, /\bid="phonemeButtons"/);
  assert.match(
    html,
    /id="typingModeButton"[\s\S]*?role="switch"[\s\S]*?aria-checked="false"/,
  );
  assert.match(html, /\bid="typingModeState">off<\/span>/);
  assert.match(html, /Type to speak/i);
  assert.match(html, /hold to sustain/i);
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
    ["A", "E", "I", "O", "U", "Q", "K", "T", "P", "S", "X", "F", "M", "N", "G"],
  );
  for (const id of [
    "stageGuide",
    "stageArticulation",
    "articulationGestureOut",
    "articulationPlace",
    "articulationAperture",
    "articulationPressure",
    "articulationVoicing",
  ]) {
    assert.match(html, new RegExp(`\\bid="${id}"`), `${id} direct articulation hook is required`);
  }
  assert.match(html, /data-tongue="0"[\s\S]*?aria-label="Select tongue one"/);
  assert.match(html, /data-tongue="4"[\s\S]*?aria-label="Select tongue five"/);
  assert.match(html, /data-nose="0"[\s\S]*?aria-label="Select nose one"/);
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
    "throatCount",
    "bodyLength",
    "tension",
    "mutation",
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
