import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  HICCUP_HEAD_FULL_PRESETS,
} from "../src/instruments/hiccup-head/full-presets.js";
import {
  HICCUP_HEAD_LIMITS, HICCUP_HEAD_PRESETS, HICCUP_HEAD_PATTERNS, HICCUP_HEAD_SOUND_BANKS,
  sanitizeHiccupHeadState, hiccupHeadState,
} from "../src/hiccup-head.js";
import {
  CREATURAZOID_BODY_PRESETS, CREATURAZOID_SEQUENCE_PRESETS,
} from "../src/creaturazoid.js";
import { CREATURAZOID_FULL_PRESETS } from "../src/instruments/creaturazoid/full-presets.js";
import { validateFullPresetBank } from "../src/site/header-presets.js";

const root = new URL("../", import.meta.url);
const fixture = JSON.parse(await readFile(new URL("./fixtures/preset-hierarchy-controls-before.json", import.meta.url)));
const skinIds = ["checker", "cutout-collage", "photo-1904", "food-portrait", "ascii", "wild-ink"];
const attributes = markup => Object.fromEntries([...markup.matchAll(/([\w-]+)\s*=\s*(["'])(.*?)\2/g)].map(m => [m[1], m[3]]));

for (const id of ["creaturazoid", "hiccup-head"]) {
  test(`${id}: every original authored control, range and option remains`, async () => {
    const html = await readFile(new URL(`${id}.html`, root), "utf8");
    const tags = [...html.replace(/<!--[\s\S]*?-->/g, "").matchAll(/<([a-z][\w-]*)\b([^>]*)>/gi)]
      .map(m => ({ tag: m[1].toLowerCase(), ...attributes(m[2]) }));
    for (const [key, expected] of Object.entries(fixture.pages[id].ids)) {
      const actual = tags.filter(tag => tag.id === key);
      assert.equal(actual.length, 1, `${key}: retained exactly once`);
      for (const [attr, value] of Object.entries(expected)) {
        assert.equal(actual[0][attr], value, `${key}: ${attr}`);
      }
    }
    for (const [key, expected] of Object.entries(fixture.pages[id].options)) {
      const select = [...html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)]
        .find(m => attributes(m[1]).id === key);
      assert.ok(select, key);
      const actual = [...select[2].matchAll(/<option\b([^>]*)>/g)].map(m => attributes(m[1]).value ?? null);
      assert.deepEqual(actual, expected, `${key}: options`);
    }
    const app = await readFile(new URL(`src/instruments/${id}/${id}-app.js`, root), "utf8");
    const adapter = app.slice(app.lastIndexOf("registerHeaderPresets("));
    assert.doesNotMatch(adapter, /ingredientSelectors\s*:/, "main presets must not relocate independent sub-presets");
    assert.match(html, new RegExp(`class="${id}-[\\s\\S]*id="patternSelect"`));
    assert.match(html, new RegExp(`<aside class="panel ${id}-panel"[\\s\\S]*id="presetSelect"`));
  });
}

test("all original creature body/rhythm choices still contribute to the unchanged main bank", () => {
  assert.deepEqual(new Set(CREATURAZOID_FULL_PRESETS.map(p => p.snapshot.state.bodyPresetId)),
    new Set(CREATURAZOID_BODY_PRESETS.map(p => p.id)));
  assert.deepEqual(new Set(CREATURAZOID_FULL_PRESETS.map(p => p.snapshot.currentPatternId)),
    new Set(CREATURAZOID_SEQUENCE_PRESETS.map(p => p.id)));
  validateFullPresetBank(CREATURAZOID_FULL_PRESETS);
});

test("Hiccup main scenes include every built-in skin, never automatic webcam capture", async () => {
  validateFullPresetBank(HICCUP_HEAD_FULL_PRESETS);
  assert.deepEqual(new Set(HICCUP_HEAD_FULL_PRESETS.map(p => p.snapshot.visualSkinId)), new Set(skinIds));
  const html = await readFile(new URL("hiccup-head.html", root), "utf8");
  const select = html.match(/<select id="visualSkinSelect"[^>]*>([\s\S]*?)<\/select>/)[1];
  assert.deepEqual([...select.matchAll(/value="([^"]+)"/g)].map(m => m[1]), skinIds);
  assert.match(html, /id="nextVisualSkinButton"/);
  assert.match(html, /id="openWebcamSkinButton"/);
  const app = await readFile(new URL("src/instruments/hiccup-head/hiccup-head-app.js", root), "utf8");
  const adapter = app.slice(app.lastIndexOf("registerHeaderPresets("));
  assert.match(adapter, /setVisualSkin\(snapshot\.visualSkinId, \{ announceChange: false, persist: false \}\)/);
  assert.doesNotMatch(adapter, /getUserMedia|openWebcam|startWebcam|forgetWebcamSkin/);
  const cycle = app.slice(app.indexOf("function cycleVisualSkin()"), app.indexOf("const WEBCAM_GUIDE_LABELS"));
  assert.match(cycle, /HICCUP_HEAD_VISUAL_SKINS/);
  assert.doesNotMatch(cycle, /getUserMedia|openWebcam|startWebcam/);
});

test("main scenes explicitly vary decay, eyes, hair, stereo and bypasses within original limits", () => {
  const states = HICCUP_HEAD_FULL_PRESETS.map(p => p.snapshot.state);
  for (const state of states) {
    assert.deepEqual(sanitizeHiccupHeadState(state), state);
    assert.deepEqual(Object.keys(state).sort(), Object.keys(hiccupHeadState()).sort());
    for (const [key, [min, max]] of Object.entries(HICCUP_HEAD_LIMITS)) {
      assert.ok(state[key] >= min && state[key] <= max, key);
    }
  }
  for (const key of ["decay", "eyeDivergence", "leftHairLength", "rightHairLength", "leftEyeClosure", "rightEyeClosure", "earSpread"]) {
    assert.ok(new Set(states.map(state => state[key])).size >= 3, `${key}: deliberate audible/visible variety`);
  }
  assert.ok(states.some(state => state.eyeDivergence < 0), "inward eyes demonstrate plate");
  assert.ok(states.some(state => state.eyeDivergence > 0), "outward eyes demonstrate hall");
  assert.ok(states.some(state => state.rightEyeClosure > 0.5), "right lid demonstrates fuzz");
  assert.ok(states.some(state => state.leftEyeClosure > 0.5), "left lid demonstrates filtering");
  for (const key of ["delay", "reverb"]) {
    assert.deepEqual(new Set(HICCUP_HEAD_FULL_PRESETS.map(p => p.snapshot.faceEffectEnabled[key])), new Set([false, true]));
  }
  for (const [key, originals] of [["presetId", HICCUP_HEAD_PRESETS], ["patternId", HICCUP_HEAD_PATTERNS]]) {
    assert.deepEqual(new Set(states.map(state => state[key])), new Set(originals.map(p => p.id)));
  }
  assert.deepEqual(new Set(HICCUP_HEAD_FULL_PRESETS.map(p => p.snapshot.currentSoundBankId)),
    new Set(HICCUP_HEAD_SOUND_BANKS.map(p => p.id)));
});

test("the local Hiccup face selector preserves pattern identity as well as the live rhythm", async () => {
  const app = await readFile(new URL("src/instruments/hiccup-head/hiccup-head-app.js", root), "utf8");
  const body = app.slice(app.indexOf("function setPreset("), app.indexOf("function cycleFacePreset("));
  assert.match(body, /patternId: state\.patternId/);
  assert.match(body, /withPersistentFaceEffects/);
  assert.doesNotMatch(body, /setCurrentPattern|setVisualSkin|setSoundBank|stopSequence/);
});
