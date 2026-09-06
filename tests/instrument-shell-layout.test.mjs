import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readProjectFile = (path) => readFile(new URL("../" + path, import.meta.url), "utf8");

test("Storybook exposes deterministic Shape, Solid, and Hyper shell references", async () => {
  const [story, fixture, styles] = await Promise.all([
    readProjectFile("stories/instrument-shell.stories.js"),
    readProjectFile("stories/instrument-shell-fixture.js"),
    readProjectFile("stories/instrument-shell-fixtures.css"),
  ]);

  assert.match(story, /title:\s*"Layouts\/Instrument Shell"/);
  assert.match(story, /parameters:\s*\{[\s\S]*layout:\s*"fullscreen"/);
  assert.match(story, /export const Shape/);
  assert.match(story, /createInstrumentShellFixture\("shape"\)/);
  assert.match(story, /export const Solid/);
  assert.match(story, /createInstrumentShellFixture\("solid"\)/);
  assert.match(story, /export const Hyper/);
  assert.match(story, /createInstrumentShellFixture\("hyper"\)/);

  assert.match(fixture, /from "\.\.\/src\/ui\/index\.js"/);
  for (const factory of [
    "createAudioStrip",
    "createButton",
    "createChoiceSwitch",
    "createControlSection",
    "createMidiStatus",
    "createRangeField",
    "createSelectField",
    "createStatusReadout",
  ]) {
    assert.match(fixture, new RegExp("\\b" + factory + "\\("));
  }

  assert.match(fixture, /shell\.className = "shell"/);
  assert.match(fixture, /stage\.className = "stage"/);
  assert.match(fixture, /stageWrap\.className = "stage-wrap"/);
  assert.match(fixture, /panel\.className = "panel"/);
  assert.doesNotMatch(fixture, /canvas\.tabIndex|tabindex/);
  assert.match(fixture, /canvas\.setAttribute\("role", "img"\)/);
  assert.match(fixture, /canvas\.setAttribute\("aria-label", config\.name \+ " instrument canvas"\)/);
  assert.match(fixture, /label: "Play",[\s\S]*?disabled: true/);
  assert.match(fixture, /readout: "1 POINT · 1 CONTACT · AUDIO OFF"/);
  assert.match(fixture, /amountValue: 4/);
  assert.match(fixture, /accent: "#7db4ff"/);
  assert.match(fixture, /accent: "#c79bff"/);

  const runtime = story + fixture;
  assert.doesNotMatch(
    runtime,
    /AudioContext|webkitAudioContext|requestMIDIAccess|mediaDevices|requestAnimationFrame|setInterval|setTimeout|nav\.js/,
  );
  assert.doesNotMatch(styles, /(?:^|\n)\s*(?:html|body)\b/);
  assert.doesNotMatch(styles, /\banimation(?:-name)?:/);
  assert.doesNotMatch(styles, /cursor:\s*crosshair|touch-action:\s*none/);
  assert.match(styles, /Temporary Storybook-only compatibility mirror/);
  assert.doesNotMatch(styles, /(?:^|\n)\s*\.(?:shell|stage|stage-wrap|panel)\s*\{/);
  assert.match(styles, /height:\s*100dvh/);
  assert.match(styles, /object-fit:\s*contain/);
});

test("the reference retains the production shell order without migrating production pages", async () => {
  const pages = [
    ["shape.html", "shape", "Shape"],
    ["solid.html", "solid", "Solid"],
    ["hyper.html", "hyper", "Hyper"],
  ];

  for (const [path, id, name] of pages) {
    const source = await readProjectFile(path);
    const shell = source.indexOf('<main class="shell" id="' + id + '">');
    const stage = source.indexOf('<section class="stage" aria-label="' + name + ' stage">', shell);
    const stageWrap = source.indexOf('class="stage-wrap"', stage);
    const panel = source.indexOf('<aside class="panel" aria-label="' + name + ' controls">', stageWrap);

    assert.ok(shell >= 0, path + " keeps the shell root");
    assert.ok(stage > shell, path + " keeps the stage inside the shell");
    assert.ok(stageWrap > stage, path + " keeps the stage wrapper inside the stage");
    assert.ok(panel > stageWrap, path + " keeps the panel after the stage");
  }
});
