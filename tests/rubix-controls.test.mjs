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

test("Rubix controls keep geometry, visibility dynamics, and panel order explicit", async () => {
  const [html, css] = await Promise.all([
    readFile(new URL("rubix.html", root), "utf8"),
    readFile(new URL("rubix.css", root), "utf8"),
  ]);

  const clock = detailsSection(html, "Clock");
  const cubeMoves = detailsSection(html, "Cube moves");
  const drumVoice = detailsSection(html, "Percussion voice");
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

  const geometryOptions = selectOptions(cubeMoves, "geometry");
  assert.deepEqual(geometryOptions, [
    { value: "cube3", selected: true, label: "3 × 3 · Rubix cube" },
    { value: "cube2", selected: false, label: "2 × 2 · Pocket cube" },
    { value: "cube4", selected: false, label: "4 × 4 · Rubix cube" },
    { value: "cube5", selected: false, label: "5 × 5 · Rubix cube" },
    { value: "cube6", selected: false, label: "6 × 6 · Rubix cube" },
    { value: "pyramid", selected: false, label: "Pyramid · faceted" },
    { value: "sphere", selected: false, label: "Sphere · orbital" },
  ]);
  assert.match(cubeMoves, /id="geometryState"[^>]*for="geometry">3 × 3 · Rubix cube<\/output>/);
  assert.ok(
    cubeMoves.indexOf('id="geometry"') < cubeMoves.indexOf('id="selectedSticker"'),
    "Geometry should be the first Cube moves control",
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
  const randomTwistTempo = openingTag(cubeMoves, "input", "randomTwistTempo");
  assert.equal(attribute(randomTwistTempo, "type"), "range");
  assert.ok(Number(attribute(randomTwistTempo, "min")) > 0);
  assert.ok(Number(attribute(randomTwistTempo, "max")) > Number(attribute(randomTwistTempo, "min")));
  assert.ok(Number(attribute(randomTwistTempo, "step")) > 0);
  assert.match(cubeMoves, /id="randomTwistTempoOut"[^>]*for="randomTwistTempo"/);

  assert.doesNotMatch(html, /id="orbitMode"/, "empty-space drag should replace an explicit Orbit toggle");
  assert.match(html, /drag empty space to orbit/i);

  const percOptions = selectOptions(drumVoice, "percEngine");
  assert.ok(percOptions.length >= 4, "Perc synth should expose at least four engines");
  assert.equal(new Set(percOptions.map(({ value }) => value)).size, percOptions.length);
  assert.deepEqual(
    percOptions.filter(({ selected }) => selected).map(({ value }) => value),
    ["soft-fm"],
    "Soft FM should be the default percussion synth",
  );
  assert.match(percOptions.find(({ value }) => value === "soft-fm")?.label ?? "", /soft\s*fm/i);
  for (const engine of ["analog", "modal", "noise"]) {
    assert.ok(percOptions.some(({ value }) => value === engine), `${engine} percussion engine should exist`);
  }

  const presetOptions = selectOptions(html, "rubixPreset");
  assert.ok(presetOptions.length >= 4, "Rubix should expose at least four presets");
  assert.equal(new Set(presetOptions.map(({ value }) => value)).size, presetOptions.length);
  assert.equal(
    presetOptions.filter(({ selected }) => selected).length,
    1,
    "One Rubix preset should be selected initially",
  );

  const drumLevel = openingTag(drumVoice, "input", "drumLevel");
  assert.equal(attribute(drumLevel, "value"), "0.54");
  assert.match(
    drumVoice,
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
  assert.match(css, /@media \(max-width: 650px\)[\s\S]*?\.rubix-geometry-control/);
});
