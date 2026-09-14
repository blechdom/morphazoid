import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("WAX setup now lives in the single MIDI and WAX guide", async () => {
  const [guide, legacyWax, plugins] = await Promise.all([
    readFile(new URL("midi-guide.html", root), "utf8"),
    readFile(new URL("wax.html", root), "utf8"),
    readFile(new URL("plugins.html", root), "utf8"),
  ]);
  const visibleText = guide.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  assert.match(guide, /<title>MIDI &amp; WAX Plugin Guide — Morphazoid<\/title>/);
  assert.match(guide, /id="wax"/);
  assert.match(visibleText, /WAX is the required audio plug-in host for Morphazoid in a DAW/);
  assert.match(visibleText, /not a standalone Morphazoid VST3 or Audio Unit/);
  assert.match(visibleText, /Windows 10\+ or macOS 11\+/);
  assert.match(visibleText, /Linux.*not.*officially supported native WAX plug-in/i);
  assert.match(visibleText, /WAX Instrument.*WAX Audio FX.*WAX MIDI FX/);
  assert.match(visibleText, /Track MIDI → Morphazoid → audio/);
  assert.match(visibleText, /Track audio → Morphazoid processing → audio/);
  assert.match(visibleText, /MIDI or host clock → Morphazoid → MIDI/);
  assert.match(visibleText, /One WAX instance has fixed inputs and outputs/);
  assert.match(visibleText, /Incoming MIDI is never echoed automatically/);
  assert.match(guide, /http:\/\/127\.0\.0\.1:3436\//);
  assert.match(guide, /https:\/\/blechdom\.github\.io\/morphazoid\/dist-wax\/chaotic-fm\.html/);
  assert.match(guide, /py -m http\.server 3436 --bind 127\.0\.0\.1/);
  assert.match(guide, /python3 -m http\.server 3436 --bind 127\.0\.0\.1/);
  assert.match(guide, /Direct files can block modules and AudioWorklets/);

  for (const url of [
    "https://audiofusion.com/download-wax/",
    "https://wp.audiofusion.com/docs/download-install-wax/",
    "https://audiofusion.com/docs/how-to-use-wax/",
    "https://audiofusion.com/docs/custom-pages/",
    "https://audiofusion.com/docs/debug-panel/",
    "https://github.com/blechdom/morphazoid/archive/refs/heads/main.zip",
  ]) {
    assert.match(guide, new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.match(legacyWax, /http-equiv="refresh" content="0; url=\.\/midi-guide\.html#wax"/);
  assert.match(legacyWax, /window\.location\.replace\("\.\/midi-guide\.html#wax"\)/);
  assert.doesNotMatch(legacyWax, /wax-page\.js/);
  assert.match(plugins, /href="midi-guide\.html#wax"/);
});
