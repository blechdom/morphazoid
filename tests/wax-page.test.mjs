import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("WAX setup page provides complete Windows and macOS instructions", async () => {
  const [markup, styles, pluginsMarkup, app] = await Promise.all([
    readFile(new URL("wax.html", root), "utf8"),
    readFile(new URL("wax.css", root), "utf8"),
    readFile(new URL("plugins.html", root), "utf8"),
    readFile(new URL("wax-page.js", root), "utf8"),
  ]);
  const visibleText = markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  assert.match(markup, /Morphazoid for WAX/);
  assert.match(markup, /id="windows"/);
  assert.match(markup, /id="macos"/);
  assert.match(visibleText, /Windows 10\+/);
  assert.match(visibleText, /macOS 11\+/);
  assert.match(visibleText, /Linux browser test only/i);
  assert.match(visibleText, /not a standalone Morphazoid VST3 or Audio Unit/i);
  assert.match(markup, /WAX Instrument/);
  assert.match(markup, /WAX Audio FX/);
  assert.match(markup, /WAX MIDI FX/);
  assert.match(visibleText, /VST3 and Audio Unit are plug-in formats/i);
  assert.match(visibleText, /There is no separate “WAX VST” role/i);
  assert.match(visibleText, /Track MIDI → Morphazoid → audio/i);
  assert.match(visibleText, /Track audio → Morphazoid processing → audio/i);
  assert.match(visibleText, /MIDI or host clock → Morphazoid → MIDI/i);
  assert.match(visibleText, /One page can work in several roles; one plug-in instance cannot/i);
  assert.match(visibleText, /fixed DAW inputs and outputs/i);
  assert.match(visibleText, /route its track’s MIDI output to a separate instrument track/i);
  assert.match(visibleText, /Linux has no official WAX build/i);
  assert.match(markup, /data-wax-role-search/);
  assert.match(markup, /data-wax-role-filter/);
  assert.match(markup, /data-wax-role-catalog/);
  assert.match(markup, /src="wax-page\.js"/);
  assert.match(markup, /http:\/\/127\.0\.0\.1:3436\/chaotic-fm\.html/);
  assert.match(markup, /https:\/\/blechdom\.github\.io\/morphazoid\/dist-wax\/chaotic-fm\.html/);
  assert.match(markup, /https:\/\/blechdom\.github\.io\/morphazoid\/dist-wax\//);
  assert.match(markup, /py -m http\.server 3436 --bind 127\.0\.0\.1/);
  assert.match(markup, /python3 -m http\.server 3436 --bind 127\.0\.0\.1/);
  assert.match(visibleText, /Do not open an HTML file directly from disk/i);

  for (const url of [
    "https://audiofusion.com/download-wax/",
    "https://audiofusion.com/wax/",
    "https://wp.audiofusion.com/docs/download-install-wax/",
    "https://audiofusion.com/docs/how-to-use-wax/",
    "https://audiofusion.com/docs/custom-pages/",
    "https://wp.audiofusion.com/docs/wax-developer-documentation/",
    "https://wp.audiofusion.com/docs/wax-dev-helper/",
    "https://audiofusion.com/docs/debug-panel/",
    "https://www.reaper.fm/download.php",
    "https://www.python.org/downloads/windows/",
    "https://www.python.org/downloads/macos/",
    "https://github.com/blechdom/morphazoid/archive/refs/heads/main.zip",
  ]) {
    assert.match(markup, new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.match(styles, /\.wax-resource-grid/);
  assert.match(styles, /\.wax-platform-grid/);
  assert.match(styles, /\.wax-catalog-controls/);
  assert.match(styles, /\.wax-catalog-table/);
  assert.match(styles, /\.wax-role-recommended/);
  assert.match(styles, /@media \(max-width: 650px\)/);
  assert.match(app, /WAX_INSTRUMENT_SUPPORT/);
  assert.match(app, /filterWaxSupport/);
  assert.match(app, /renderWaxRoleCatalog/);
  assert.match(pluginsMarkup, /href="wax\.html"/);
});

test("external WAX setup links opened in a new tab are protected", async () => {
  const markup = await readFile(new URL("wax.html", root), "utf8");
  const externalNewTabLinks = [...markup.matchAll(
    /<a\b[^>]*href="https:\/\/[^\"]+"[^>]*target="_blank"[^>]*>/g,
  )];
  assert.ok(externalNewTabLinks.length >= 8);
  for (const [link] of externalNewTabLinks) {
    assert.match(link, /rel="noopener noreferrer"/);
  }
});
