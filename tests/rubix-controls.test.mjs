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

  const tokenPattern = new RegExp(`<${tagName}\\b[^>]*>|<\\/${tagName}>`, "g");
  tokenPattern.lastIndex = opening.index;
  let depth = 0;
  for (const token of source.matchAll(tokenPattern)) {
    if (token.index < opening.index) continue;
    if (token[0].startsWith(`</${tagName}`)) depth -= 1;
    else depth += 1;
    if (depth === 0) return source.slice(opening.index, token.index + token[0].length);
  }

  assert.fail(`${tagName}.${className} should have a closing tag`);
}

test("Rubix controls keep shape, size, visibility dynamics, and panel order explicit", async () => {
  const [html, css] = await Promise.all([
    readFile(new URL("rubix.html", root), "utf8"),
    readFile(new URL("rubix.css", root), "utf8"),
  ]);

  const clock = detailsSection(html, "Clock");
  const cubeMoves = detailsSection(html, "Cube moves");
  const soundBank = detailsSection(html, "Sound bank");
  const visibleScore = detailsSection(html, "Visible score");
  const headings = [...html.matchAll(/<h2 class="group-title">([^<]+)<\/h2>/g)]
    .map((match) => match[1]);

  assert.ok(headings.indexOf("Clock") < headings.indexOf("Cube moves"));
  assert.ok(headings.indexOf("Cube moves") < headings.indexOf("Visible score"));
  assert.equal(headings.at(-1), "Visible score", "Visible score should remain the last panel");
  assert.match(clock, /id="playButton"/);
  assert.doesNotMatch(cubeMoves, /id="playButton"/);
  assert.match(visibleScore, /id="scoreDescription"/);
  assert.match(
    clock,
    /data-read-mode="face"[^>]*>[\s\S]*?<b>Alternate faces<\/b>[\s\S]*?<small>one face per subdivision · 27 steps<\/small>/,
  );

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
    cubeMoves.indexOf('id="scrambleCube"') < cubeMoves.indexOf('class="rubix-random-twists"'),
    "Scramble should sit high in Cube moves, immediately after Shape and Size",
  );
  assert.ok(
    cubeMoves.indexOf('id="solveCube"') < cubeMoves.indexOf('class="rubix-random-twists"'),
    "Solve cube should sit beside Scramble, above the detailed move controls",
  );
  assert.ok(
    cubeMoves.indexOf('id="resetView"') < cubeMoves.indexOf('class="rubix-random-twists"'),
    "Reset view should be part of the raised cube action group",
  );
  assert.doesNotMatch(cubeMoves, /id="resetSound"/);
  assert.doesNotMatch(html, /Solve cube\s*\+\s*reset sound/i);
  assert.doesNotMatch(html, /id="resetCube"/);
  assert.match(resetSound, /\bdata-reset-all\b/);
  assert.match(resetSound, /\bdata-reset-in-place\b/);
  const visibleScoreEnd = html.indexOf(
    "</details>",
    html.indexOf('<h2 class="group-title">Visible score</h2>'),
  );
  assert.ok(
    html.indexOf('id="resetSound"') > visibleScoreEnd,
    "Reset sound should remain the final panel action, below Visible score",
  );

  const dynamics = openingTag(clock, "input", "visibilityDynamics");
  assert.equal(attribute(dynamics, "type"), "range");
  assert.equal(attribute(dynamics, "min"), "0");
  assert.equal(attribute(dynamics, "max"), "1");
  assert.equal(attribute(dynamics, "step"), "0.01");
  assert.equal(attribute(dynamics, "value"), "0.72");
  assert.match(clock, /id="visibilityDynamicsOut"[^>]*for="visibilityDynamics">72%<\/output>/);
  assert.match(clock, /0% equal level · 100% projected square area/);
  assert.match(clock, /title="0% keeps every visible sticker at equal level; 100% follows its projected square area\."/);
  assert.ok(clock.indexOf('class="rubix-read-modes"') < clock.indexOf('id="visibilityDynamics"'));
  assert.ok(clock.indexOf('id="visibilityDynamics"') < clock.indexOf('id="tempo"'));

  const randomTwists = openingTag(cubeMoves, "button", "randomTwists");
  assert.equal(attribute(randomTwists, "type"), "button");
  assert.equal(attribute(randomTwists, "aria-pressed"), "false");
  const randomTwistSpeed = openingTag(cubeMoves, "input", "randomTwistSpeed");
  assert.equal(attribute(randomTwistSpeed, "type"), "range");
  assert.equal(attribute(randomTwistSpeed, "min"), "0");
  assert.equal(attribute(randomTwistSpeed, "max"), "100");
  assert.equal(attribute(randomTwistSpeed, "step"), "1");
  assert.equal(attribute(randomTwistSpeed, "value"), "36");
  assert.match(
    cubeMoves,
    /id="randomTwistSpeedOut"[^>]*for="randomTwistSpeed">1×<\/output>/,
  );
  assert.doesNotMatch(cubeMoves, /randomTwistTempo|\bTPM\b|twists?\s+per\s+minute/i);
  assert.match(cubeMoves, /Automatic movement speed · independent of sequencer tempo/);

  assert.doesNotMatch(html, /id="orbitMode"/, "empty-space drag should replace an explicit Orbit toggle");
  assert.match(html, /drag empty space to orbit/i);

  const soundBankOptions = selectOptions(soundBank, "soundBank");
  assert.deepEqual(
    soundBankOptions.map(({ value }) => value),
    ["soft-fm", "analog", "modal", "noise", "acid-303"],
    "the top-level selector should expose four drum banks and one acid bank",
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
  assert.match(soundBank, /(?:Acid\s*303|303\s*acid|303)[\s\S]*upper|upper[\s\S]*(?:Acid\s*303|303\s*acid|303)/i);
  assert.match(soundBank, /drum (?:banks?|kits?)[\s\S]*side|side[\s\S]*drum (?:banks?|kits?)/i);
  assert.doesNotMatch(html, /\bid="percEngine"/);
  assert.match(soundBank, /id="soundBankSummary"[^>]*>[^<]*Soft FM/i);
  assert.match(soundBank, /id="soundBankStatus"[^>]*[\s\S]*?side faces audible/i);
  assert.match(soundBank, /<fieldset\b[^>]*\bid="acidBankControls"[^>]*\bdisabled\b/);
  assert.doesNotMatch(
    openingTag(soundBank, "fieldset", "kitBankControls"),
    /\bdisabled\b/,
  );
  assert.match(html, /id="scoreSummary"[^>]*>[^<]*Soft FM[^<]*sides only/i);
  assert.match(
    visibleScore,
    /Soft FM[\s\S]*two side faces[\s\S]*upper acid face rests/i,
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
  assert.match(css, /\.rubix-visibility-dynamics\s*\{[\s\S]*?background:/);
  assert.match(css, /\.rubix-cube-actions\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,/);
  assert.match(css, /\.rubix-reset-sound-row\s*\{[\s\S]*?border-top:/);
  assert.match(css, /@media \(max-width: 650px\)[\s\S]*?\.rubix-geometry-control/);
});

test("Rubix clock spans 30–300 BPM without redundant half/double controls", async () => {
  const [html, app] = await Promise.all([
    readFile(new URL("rubix.html", root), "utf8"),
    readFile(new URL("rubix-app.js", root), "utf8"),
  ]);

  const clock = detailsSection(html, "Clock");
  const tempo = openingTag(clock, "input", "tempo");
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
  assert.doesNotMatch(clock, /class="[^"]*\brubix-clock-actions\b/);
});

test("Rubix keeps restart compact beside tempo and outside the main transport", async () => {
  const [html, app, css] = await Promise.all([
    readFile(new URL("rubix.html", root), "utf8"),
    readFile(new URL("rubix-app.js", root), "utf8"),
    readFile(new URL("rubix.css", root), "utf8"),
  ]);

  const clock = detailsSection(html, "Clock");
  const transport = elementWithClass(clock, "div", "rubix-clock-transport");
  const tempoRow = elementWithClass(clock, "div", "rubix-tempo-row");
  const restart = openingTag(clock, "button", "restartLoop");
  const restartLabel = [
    attribute(restart, "aria-label"),
    attribute(restart, "title"),
    tempoRow.replace(/<[^>]+>/g, " "),
  ].filter(Boolean).join(" ");

  assert.doesNotMatch(transport, /\bid="restartLoop"/);
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
