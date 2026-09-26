import { SEQUENCER_VOICES } from "../src/sequencer-voice-renderer.js";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

function detailsSection(html, heading) {
  const headingIndex = html.indexOf(`<h2 class="group-title">${heading}</h2>`);
  assert.notEqual(headingIndex, -1, `${heading} section should exist`);
  const start = html.lastIndexOf("<details", headingIndex);
  const end = html.indexOf("</details>", headingIndex);
  assert.ok(start >= 0 && end > headingIndex, `${heading} should be inside a details section`);
  return html.slice(start, end + "</details>".length);
}

function openingTag(source, tagName, id) {
  const match = source.match(new RegExp(`<${tagName}\\b[^>]*\\bid="${id}"[^>]*>`));
  assert.ok(match, `${tagName}#${id} should exist`);
  return match[0];
}

function attribute(tag, name) {
  return tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? null;
}

function selectOptions(section, id) {
  const select = section.match(new RegExp(
    `<select\\b[^>]*\\bid="${id}"[^>]*>[\\s\\S]*?<\\/select>`,
  ))?.[0];
  assert.ok(select, `select#${id} should exist`);
  return [...select.matchAll(
    /<option\b[^>]*\bvalue="([^"]+)"([^>]*)>([^<]+)<\/option>/g,
  )].map((match) => ({
    value: match[1],
    selected: /\bselected\b/.test(match[2]),
    label: match[3].trim(),
  }));
}

function elementWithClass(source, tagName, className) {
  const openingPattern = new RegExp(
    `<${tagName}\\b[^>]*\\bclass="[^"]*\\b${className}\\b[^"]*"[^>]*>`,
  );
  const opening = openingPattern.exec(source);
  assert.ok(opening, `${tagName}.${className} should exist`);

  return elementStartingAt(source, tagName, opening.index);
}

function elementStartingAt(source, tagName, start) {
  const tokenPattern = new RegExp(`<${tagName}\\b[^>]*>|<\\/${tagName}>`, "g");
  tokenPattern.lastIndex = start;
  let depth = 0;
  for (const token of source.matchAll(tokenPattern)) {
    if (token.index < start) continue;
    if (token[0].startsWith(`</${tagName}`)) depth -= 1;
    else depth += 1;
    if (depth === 0) return source.slice(start, token.index + token[0].length);
  }

  assert.fail(`${tagName} at ${start} should have a closing tag`);
}

function hiddenContainers(source) {
  return [...source.matchAll(/<(div|section)\b[^>]*\bhidden(?=[\s>])[^>]*>/g)]
    .map((match) => elementStartingAt(source, match[1], match.index));
}

test("Rubix puts Shape-style transport, twists, and read path first while retaining musical controls", async () => {
  const [html, css] = await Promise.all([
    readFile(new URL("rubix.html", root), "utf8"),
    readFile(new URL("src/instruments/rubix/rubix.css", root), "utf8"),
  ]);

  const panel = elementWithClass(html, "aside", "rubix-panel");
  const performance = elementWithClass(panel, "section", "puzzle-performance");
  const cubeMoves = detailsSection(html, "Cube moves");
  const soundBank = detailsSection(html, "Sound bank");
  const headings = [...panel.matchAll(/<h2 class="group-title">([^<]+)<\/h2>/g)]
    .map((match) => match[1]);

  assert.match(panel.slice(0, panel.indexOf(">") + 1), /\bdata-instrument-preset-host\b/);
  assert.deepEqual(headings, ["Cube moves", "Sound bank"]);
  assert.ok(panel.indexOf(performance) < panel.indexOf(cubeMoves));
  assert.ok(panel.indexOf(cubeMoves) < panel.indexOf(soundBank));
  const primaryIds = ["playButton", "tempo", "swing", "randomTwists", "randomTwistSpeed", "readPath"];
  for (let index = 1; index < primaryIds.length; index += 1) {
    const previous = performance.indexOf(`id="${primaryIds[index - 1]}"`);
    const next = performance.indexOf(`id="${primaryIds[index]}"`);
    assert.ok(previous >= 0 && next > previous, `${primaryIds[index]} should follow ${primaryIds[index - 1]}`);
  }
  const playRow = elementWithClass(performance, "div", "puzzle-play-row");
  const twistRow = elementWithClass(performance, "div", "puzzle-twist-row");
  assert.match(playRow, /id="playButton"/);
  assert.match(playRow, /id="tempo"/);
  assert.match(twistRow, /id="randomTwists"/);
  assert.match(twistRow, /id="randomTwistSpeed"/);
  for (const id of ["playButton", "randomTwists"]) {
    const button = openingTag(performance, "button", id);
    assert.match(attribute(button, "class") ?? "", /\bplay-button\b/);
    assert.equal(attribute(button, "aria-pressed"), "false");
    assert.doesNotMatch(cubeMoves, new RegExp(`\\bid="${id}"`));
  }
  assert.deepEqual(selectOptions(performance, "readPath"), [
    { value: "parallel", selected: true, label: "Rows" },
    { value: "snake", selected: false, label: "Snake" },
    { value: "face", selected: false, label: "Face pairs" },
  ]);
  assert.equal(attribute(openingTag(performance, "select", "readPath"), "aria-label"), "Read path");
  assert.doesNotMatch(html, /data-read-mode=/);

  const hidden = hiddenContainers(panel);
  for (const id of [
    "engineState", "sequenceState", "clockSummary", "readModeState", "stepStrip",
    "acidNow", "drumNow", "randomTwistHelp", "rubixPreset", "scoreSummary",
    "scoreDescription", "laneList", "colorKey",
  ]) {
    assert.ok(
      hidden.some((container) => container.includes(`id="${id}"`)),
      `${id} should remain available to the controller without visible panel chrome`,
    );
  }
  assert.doesNotMatch(panel, /class="[^"]*\brubix-(?:status-strip|step-strip|now-playing|score-section)\b/);
  assert.doesNotMatch(html, /Sticker colors choose kick, snare, tom, and hat voices|Attack-level matching and master compression/);

  const shapeOptions = selectOptions(cubeMoves, "shape");
  assert.deepEqual(shapeOptions, [
    { value: "cube", selected: true, label: "Cube" },
    { value: "morphix", selected: false, label: "Morphix · pyramid" },
    { value: "diamond", selected: false, label: "Diamond · double pyramid" },
    { value: "stella", selected: false, label: "Stella · 8-point star" },
    { value: "orb", selected: false, label: "Orb · sphere" },
  ]);
  assert.match(cubeMoves, /id="shapeState"[^>]*for="shape">Cube<\/output>/);
  const rubixSize = openingTag(cubeMoves, "input", "rubixSize");
  assert.equal(attribute(rubixSize, "type"), "range");
  assert.equal(attribute(rubixSize, "min"), "2");
  assert.equal(attribute(rubixSize, "max"), "6");
  assert.equal(attribute(rubixSize, "step"), "1");
  assert.equal(attribute(rubixSize, "value"), "3");
  assert.equal(attribute(rubixSize, "aria-describedby"), "rubixFormHelp");
  assert.match(cubeMoves, /id="rubixSizeOut"[^>]*for="rubixSize">3 × 3<\/output>/);
  assert.match(cubeMoves, /id="rubixFormHelp">Cube turns · visual form · release Size to load<\/small>/);
  assert.ok(
    cubeMoves.indexOf('id="shape"') < cubeMoves.indexOf('id="rubixSize"'),
    "Shape should precede Size in Cube moves",
  );
  assert.ok(
    cubeMoves.indexOf('id="rubixSize"') < cubeMoves.indexOf('id="scrambleCube"'),
    "Size should precede the raised cube actions",
  );
  assert.ok(
    cubeMoves.indexOf('id="rubixSize"') < cubeMoves.indexOf('id="selectedSticker"'),
    "Shape and Size should remain above the detailed move controls",
  );

  const scrambleCube = openingTag(cubeMoves, "button", "scrambleCube");
  const solveCube = openingTag(cubeMoves, "button", "solveCube");
  const resetView = openingTag(cubeMoves, "button", "resetView");
  const resetSound = openingTag(html, "button", "resetSound");
  assert.equal(attribute(scrambleCube, "type"), "button");
  assert.equal(attribute(solveCube, "type"), "button");
  assert.equal(attribute(resetView, "type"), "button");
  assert.equal(attribute(resetSound, "type"), "button");
  assert.ok(
    cubeMoves.indexOf('id="scrambleCube"') < cubeMoves.indexOf('id="selectedSticker"'),
    "Scramble should sit high in Cube moves, immediately after Shape and Size",
  );
  assert.ok(
    cubeMoves.indexOf('id="solveCube"') < cubeMoves.indexOf('id="selectedSticker"'),
    "Solve cube should sit beside Scramble, above the detailed move controls",
  );
  assert.ok(
    cubeMoves.indexOf('id="resetView"') < cubeMoves.indexOf('id="selectedSticker"'),
    "Reset view should be part of the raised cube action group",
  );
  assert.doesNotMatch(cubeMoves, /id="resetSound"/);
  assert.doesNotMatch(html, /Solve cube\s*\+\s*reset sound/i);
  assert.doesNotMatch(html, /id="resetCube"/);
  assert.match(resetSound, /\bdata-reset-all\b/);
  assert.match(resetSound, /\bdata-reset-in-place\b/);
  const soundBankEnd = html.indexOf(soundBank) + soundBank.length;
  assert.ok(
    html.indexOf('id="resetSound"') > soundBankEnd,
    "Reset sound should remain the final panel action, below the sound controls",
  );

  const dynamicsControl = panel.match(/<label\b[^>]*for="visibilityDynamics"[^>]*>[\s\S]*?<\/label>/)?.[0];
  const dynamics = openingTag(dynamicsControl, "input", "visibilityDynamics");
  assert.equal(attribute(dynamics, "type"), "range");
  assert.equal(attribute(dynamics, "min"), "0");
  assert.equal(attribute(dynamics, "max"), "1");
  assert.equal(attribute(dynamics, "step"), "0.01");
  assert.equal(attribute(dynamics, "value"), "1");
  assert.match(dynamicsControl, /id="visibilityDynamicsOut"[^>]*for="visibilityDynamics">100%<\/output>/);
  assert.doesNotMatch(dynamicsControl, /<small|rubix-visibility-dynamics/);
  assert.match(dynamicsControl, /title="0% keeps every visible sticker at equal level; 100% follows its projected square area\."/);
  assert.ok(performance.includes(dynamicsControl));
  assert.ok(panel.indexOf(dynamicsControl) < panel.indexOf(cubeMoves));

  const randomTwists = openingTag(twistRow, "button", "randomTwists");
  assert.equal(attribute(randomTwists, "type"), "button");
  assert.equal(attribute(randomTwists, "aria-pressed"), "false");
  assert.equal(attribute(randomTwists, "aria-label"), "Start random twists");
  assert.equal(attribute(randomTwists, "title"), "Start random twists");
  const twistButtonContent = twistRow.match(/<button\b[^>]*\bid="randomTwists"[^>]*>[\s\S]*?<\/button>/)?.[0];
  assert.match(twistButtonContent, /<svg class="transport-play"/);
  assert.match(twistButtonContent, /<svg class="transport-pause"/);
  assert.doesNotMatch(twistButtonContent, /⤨/);
  assert.match(css, /#randomTwists\[aria-pressed="true"\] \.transport-play\s*\{\s*display:\s*none/);
  assert.match(css, /#randomTwists\[aria-pressed="true"\] \.transport-pause\s*\{\s*display:\s*block/);
  const randomTwistSpeed = openingTag(twistRow, "input", "randomTwistSpeed");
  assert.equal(attribute(randomTwistSpeed, "type"), "range");
  assert.equal(attribute(randomTwistSpeed, "min"), "0");
  assert.equal(attribute(randomTwistSpeed, "max"), "100");
  assert.equal(attribute(randomTwistSpeed, "step"), "1");
  assert.equal(attribute(randomTwistSpeed, "value"), "36");
  assert.match(
    twistRow,
    /id="randomTwistSpeedOut"[^>]*for="randomTwistSpeed">1×<\/output>/,
  );
  assert.doesNotMatch(performance, /randomTwistTempo|\bTPM\b|twists?\s+per\s+minute/i);
  assert.match(html, /id="randomTwistHelp">Automatic movement speed, independent of tempo\./);
  assert.doesNotMatch(cubeMoves, /id="randomTwists"|id="randomTwistSpeed"/);

  assert.doesNotMatch(html, /id="orbitMode"/, "empty-space drag should replace an explicit Orbit toggle");
  assert.match(html, /drag empty space to orbit/i);

  const soundBankOptions = selectOptions(soundBank, "soundBank");
  assert.deepEqual(
    soundBankOptions.map(({ value }) => value),
    ["soft-fm", "analog", "modal", "noise", "rattlesnake", "pitched-morph", "karplus-strong", "acid-303", ...SEQUENCER_VOICES.map(({ id }) => `shared-${id}`)],
    "the top-level selector should retain legacy banks and expose every shared voice engine",
  );
  assert.deepEqual(
    soundBankOptions.filter(({ selected }) => selected).map(({ value }) => value),
    ["soft-fm"],
    "exactly one bank should be selected, with Soft FM as the default",
  );
  for (const [value, label] of [
    ["soft-fm", /soft\s*fm/i],
    ["analog", /analog/i],
    ["modal", /modal/i],
    ["noise", /noise/i],
    ["acid-303", /(?:acid\s*303|303\s*acid)/i],
  ]) {
    assert.match(
      soundBankOptions.find((option) => option.value === value)?.label ?? "",
      label,
    );
  }
  assert.match(soundBank, /id="soundBankState"[^>]*for="soundBank"[^>]*>[^<]*Soft FM/i);
  assert.match(soundBank, /one (?:sound )?bank (?:plays )?at a time/i);
  assert.match(soundBank, /303[\s\S]*all visible faces/i);
  assert.match(soundBank, /Selected kit · all visible faces/i);
  assert.doesNotMatch(html, /\bid="percEngine"/);
  assert.match(soundBank, /id="soundBankSummary"[^>]*>[^<]*Soft FM/i);
  assert.match(soundBank, /id="soundBankStatus"[^>]*[\s\S]*?all visible faces/i);
  assert.match(soundBank, /<fieldset\b[^>]*\bid="acidBankControls"[^>]*\bdisabled\b/);
  assert.doesNotMatch(
    openingTag(soundBank, "fieldset", "kitBankControls"),
    /\bdisabled\b/,
  );

  const presetOptions = selectOptions(html, "rubixPreset");
  assert.ok(presetOptions.length >= 4, "Rubix should expose at least four presets");
  assert.equal(new Set(presetOptions.map(({ value }) => value)).size, presetOptions.length);
  assert.equal(
    presetOptions.filter(({ selected }) => selected).length,
    1,
    "One Rubix preset should be selected initially",
  );

  const drumLevel = openingTag(soundBank, "input", "drumLevel");
  assert.equal(attribute(drumLevel, "value"), "0.54");
  assert.match(
    soundBank,
    /<output\b[^>]*\bid="drumLevelOut"[^>]*>\s*54%\s*<\/output>/,
  );
  const output = openingTag(html, "input", "output");
  assert.equal(attribute(output, "value"), "0.56");
  assert.match(
    html,
    /<output\b[^>]*\bid="outputOut"[^>]*>\s*56%\s*<\/output>/,
  );

  assert.match(css, /\.rubix-geometry-control\s*\{[\s\S]*?border:/);
  assert.match(css, /\.rubix-geometry-control select\s*\{[\s\S]*?min-height:\s*42px/);
  assert.doesNotMatch(css, /\.rubix-visibility-dynamics/);
  assert.match(css, /\.rubix-cube-actions\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,/);
  assert.match(css, /\.rubix-reset-sound-row\s*\{[\s\S]*?border-top:/);
  assert.match(css, /@media \(max-width: 650px\)[\s\S]*?\.rubix-geometry-control/);
});

test("Rubix clock spans 30–300 BPM without redundant half/double controls", async () => {
  const [html, app] = await Promise.all([
    readFile(new URL("rubix.html", root), "utf8"),
    readFile(new URL("src/instruments/rubix/rubix-app.js", root), "utf8"),
  ]);

  const performance = elementWithClass(html, "section", "puzzle-performance");
  const tempo = openingTag(performance, "input", "tempo");
  assert.equal(attribute(tempo, "min"), "30");
  assert.equal(attribute(tempo, "max"), "300");
  assert.equal(attribute(tempo, "step"), "1");
  assert.equal(attribute(tempo, "value"), "126");

  const tempoMinimum = Number(
    app.match(/\bTEMPO_MIN_BPM\s*=\s*(\d+(?:\.\d+)?)/)?.[1],
  );
  const tempoMaximum = Number(
    app.match(/\bTEMPO_MAX_BPM\s*=\s*(\d+(?:\.\d+)?)/)?.[1],
  );
  assert.equal(tempoMinimum, 30, "the audio clock should share the slider minimum");
  assert.equal(tempoMaximum, 300, "the audio clock should share the slider maximum");
  assert.match(
    app,
    /clamp\s*\(\s*state\.tempo\s*,\s*TEMPO_MIN_BPM\s*,\s*TEMPO_MAX_BPM\s*\)/,
    "the sequencer timing calculation should honor the full tempo range",
  );

  for (const removedId of ["halfTime", "doubleTime"]) {
    assert.doesNotMatch(html, new RegExp(`\\bid="${removedId}"`));
    assert.doesNotMatch(
      app,
      new RegExp(`\\$\\(\\s*["']${removedId}["']\\s*\\)`),
      `${removedId} should not retain a dead event handler`,
    );
  }
  const swing = openingTag(performance, "input", "swing");
  assert.equal(attribute(swing, "min"), "0");
  assert.equal(attribute(swing, "max"), "0.42");
  assert.equal(attribute(swing, "step"), "0.01");
  assert.equal(attribute(swing, "value"), "0");
  assert.doesNotMatch(performance, /class="[^"]*\brubix-clock-actions\b/);
  assert.match(
    app,
    /\$\(["']readPath["']\)\.addEventListener\(["']change["'],\s*\(event\)\s*=>\s*\{\s*markPresetCustom\(\);\s*setReadingMode\(event\.currentTarget\.value\);/,
    "the read-path select should keep the established mode-change behavior",
  );
  assert.match(app, /\$\(["']readPath["']\)\.value\s*=\s*state\.readingMode/);
});

test("Rubix keeps restart beside tempo as a separate action from play", async () => {
  const [html, app, css] = await Promise.all([
    readFile(new URL("rubix.html", root), "utf8"),
    readFile(new URL("src/instruments/rubix/rubix-app.js", root), "utf8"),
    readFile(new URL("src/instruments/rubix/rubix.css", root), "utf8"),
  ]);

  const performance = elementWithClass(html, "section", "puzzle-performance");
  const playRow = elementWithClass(performance, "div", "puzzle-play-row");
  const playButton = playRow.match(/<button\b[^>]*\bid="playButton"[^>]*>[\s\S]*?<\/button>/)?.[0];
  const tempoRow = elementWithClass(playRow, "div", "puzzle-tempo-control");
  const restart = openingTag(tempoRow, "button", "restartLoop");
  const restartLabel = [
    attribute(restart, "aria-label"),
    attribute(restart, "title"),
    tempoRow.replace(/<[^>]+>/g, " "),
  ].filter(Boolean).join(" ");

  assert.ok(playButton, "the play button should exist in the main playback row");
  assert.doesNotMatch(playButton, /\bid="restartLoop"/);
  assert.doesNotMatch(tempoRow, /\bid="playButton"/);
  assert.match(tempoRow, /\bid="tempo"/);
  assert.match(tempoRow, /\bid="restartLoop"/);
  assert.match(attribute(restart, "class") ?? "", /\brubix-restart-button\b/);
  assert.match(restartLabel, /(?:restart|return)[\s\S]*(?:step\s*)?1|beginning/i);
  assert.match(
    css,
    /\.rubix-restart-button\s*\{[\s\S]*?(?:min-height|max-height|height|padding|font-size)\s*:/,
    "the relocated restart should have its own compact styling",
  );
  assert.match(
    app,
    /\$\(\s*["']restartLoop["']\s*\)\.addEventListener\(\s*["']click["']/,
    "the compact restart should retain its transport behavior",
  );
});
