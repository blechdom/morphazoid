import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = await readFile(path.join(repositoryRoot, "surround-field.html"), "utf8");
const app = await readFile(path.join(repositoryRoot, "surround-field-app.js"), "utf8");
const css = await readFile(path.join(repositoryRoot, "surround-field.css"), "utf8");

test("Surround Field exposes every requested array and the custom 32-channel ring", () => {
  for (const layout of ["7-4-1", "4-1", "8-circle", "8-cube"]) {
    assert.match(html, new RegExp(`data-layout="${layout}"`));
  }
  assert.match(html, /id="speakerCount"[^>]+min="2" max="32"/);
  assert.match(html, /7 bed · 4 height · 1 LFE/i);
  assert.match(html, /4 lower · 4 upper/i);
  assert.match(html, /commonly written 7\.1\.4/);
});

test("output capability copy distinguishes graph channels from physical outputs", () => {
  assert.match(html, /GRAPH[\s\S]+demo ceiling[\s\S]+PATCH[\s\S]+virtual speakers[\s\S]+DEVICE[\s\S]+reported outputs/);
  assert.match(html, /destination\.maxChannelCount/);
  assert.match(html, /at least 32 channels/);
  assert.match(html, /Stereo preview/);
  assert.match(html, /webAudio-fact|web-audio-fact/);
});

test("audio routing has real discrete and explicit stereo-preview paths", () => {
  assert.match(app, /createChannelMerger\(layout\.speakers\.length\)/);
  assert.match(app, /channelInterpretation = "discrete"/);
  assert.match(app, /routeEntry\.connect\(merger, 0, index\)/);
  assert.match(app, /createStereoPanner\(\)/);
  assert.match(app, /connectAudioOutput\(context, merger\)/);
  assert.match(app, /speaker\.kind === "lfe"/);
  assert.match(app, /lowpass\.frequency\.value = 120/);
});

test("the room stays playable on pointer, keyboard, and mobile", () => {
  assert.match(html, /aria-label="Sound position\. Drag to move; use arrow keys/);
  assert.match(html, /click pads or use A S D F G H J K/);
  assert.match(app, /KEY_NOTES/);
  assert.match(app, /morphazoid:midi-input/);
  assert.match(app, /event\.preventDefault\(\)/);
  assert.match(app, /setPointerCapture/);
  assert.match(css, /@media \(max-width: 650px\)/);
  assert.match(css, /touch-action: none/);
});
