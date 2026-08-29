import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { TOOL_GROUPS } from "../nav.js";
import { INSTRUMENT_GROUPS, INSTRUMENTS } from "../src/instrument-catalog.js";

const root = new URL("../", import.meta.url);

test("Home page is the About guide", async () => {
  const html = await readFile(new URL("index.html", root), "utf8");

  assert.match(html, /<body class="about-page">/);
  assert.match(html, /<title>Morphazoid<\/title>/);
  assert.match(html, /<h1>Morphazoid<\/h1>/);
  assert.doesNotMatch(html, /Project (?:reference|guide)/i);
  assert.match(html, /<nav class="tabs" aria-label="Morphazoid main menu"><\/nav>/);
  assert.match(html, /<option value="" selected>choose<\/option>/);
  assert.doesNotMatch(html, /href="(?:plugins|instruments|about)\.html"/);
  assert.match(html, /id="homeInstrumentCatalogue"[\s\S]*?data-instrument-catalog/);
  assert.match(html, /src="instrument-catalog-app\.js\?v=catalog-[^"]+"/);
  assert.match(
    html,
    /<h1>Morphazoid<\/h1>[\s\S]*?<h2>Instrument Catalogue<\/h2>[\s\S]*?Select an instrument, turn on audio, then find its play, input, or transport control\./,
  );
  assert.doesNotMatch(html, /class="about-lede"|Basic operation/);
  assert.doesNotMatch(html, /manual-section-label">Browse|Instrument sections, titles, and order/);
  assert.doesNotMatch(html, /microphone input|audio files?|file instruments?/i);
  assert.doesNotMatch(html, /Select the speaker, Input/);
  assert.doesNotMatch(html, /Audio starts off\./);
  assert.doesNotMatch(html, /class="about-summary"/);
  assert.doesNotMatch(html, /class="manual-index"/);
  assert.doesNotMatch(html, /<dt>(?:Instruments|Runtime|License)<\/dt>/);
  assert.match(
    html,
    /<dt>Plug-ins<\/dt>[\s\S]*?<a href="wax\.html">Morphazoid for WAX<\/a>[\s\S]*?setup, routing, and Linux test notes\./,
  );
  assert.doesNotMatch(html, /href="plugins\.html"/);
  assert.match(html, /vibed up with Codex 5\.6 Sol Ultra, mostly/);
  assert.doesNotMatch(html, /manual-section-label">\d+/);
  assert.doesNotMatch(html, /class="page-entry"/);
  assert.doesNotMatch(html, /<script type="module" src="app\.js"><\/script>/);
});

test("Home mounts the only complete menu-ordered catalogue", async () => {
  const [home, about, catalogue] = await Promise.all([
    readFile(new URL("index.html", root), "utf8"),
    readFile(new URL("about.html", root), "utf8"),
    readFile(new URL("instruments.html", root), "utf8"),
  ]);
  const catalogueGroups = TOOL_GROUPS
    .filter((group) => group.catalogue !== false)
    .map((group) => ({
      ...group,
      tools: group.tools.filter((tool) => tool.catalogue !== false),
    }))
    .filter((group) => group.tools.length > 0);

  assert.match(home, /<title>Morphazoid<\/title>/);
  assert.match(home, /class="mobile-instrument-select"/);
  assert.match(home, /<script type="module" src="nav\.js\?v=catalog-[^"]+"><\/script>/);
  assert.equal([home, about, catalogue].filter((html) => /data-instrument-catalog/.test(html)).length, 1);
  assert.equal(INSTRUMENTS.length, 106);
  assert.equal(
    INSTRUMENTS.find(({ id }) => id === "escher-tessellation")?.label,
    "Escher",
  );
  assert.deepEqual(
    INSTRUMENT_GROUPS.map(({ id, label, tools }) => ({
      id,
      label,
      tools: tools.map(({ id: toolId, label: toolLabel, href }) => ({
        id: toolId,
        label: toolLabel,
        href,
      })),
    })),
    catalogueGroups.map(({ id, label, tools }) => ({
      id,
      label,
      tools: tools.map(({ id: toolId, label: toolLabel, href }) => ({
        id: toolId,
        label: toolLabel,
        href,
      })),
    })),
  );
  assert.match(home, /https:\/\/github\.com\/blechdom\/morphazoid/);
  assert.match(home, /https:\/\/github\.com\/blechdom\/morphazoid\/blob\/main\/LICENSE/);
  assert.match(home, /Kristin Galvin/);
});

test("Standalone MIDI guide keeps WAX output distinct", async () => {
  const html = await readFile(new URL("midi-guide.html", root), "utf8");
  const visibleText = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  assert.match(html, /<title>MIDI Guide — Morphazoid<\/title>/);
  assert.match(html, /<body class="about-page">/);
  assert.match(html, /<h1>MIDI Guide<\/h1>/);
  assert.match(html, /<nav class="tabs" aria-label="Morphazoid main menu"><\/nav>/);
  assert.match(html, /<script type="module" src="nav\.js"><\/script>/);
  assert.match(visibleText, /MIDI Guide/);
  assert.match(visibleText, /Every playable instrument has a MIDI control in its top bar/);
  assert.match(visibleText, /receive light flashes for incoming notes and controls/);
  assert.match(visibleText, /small L\/R meter shows the two channels being sent to the audio destination/);
  assert.match(visibleText, /panning and channel imbalance stay visible/);
  assert.match(visibleText, /gear at the far right opens the compact Morphazoid Settings panel/);
  assert.match(
    visibleText,
    /Audio Out, Mic \/ Audio In, MIDI In, MIDI Out, and MIDI Map describe the routes/,
  );
  assert.match(visibleText, /greyed-out selector means that route is not used.*cannot be selected/);
  assert.match(visibleText, /Computer keys This is the default MIDI Map/);
  assert.match(visibleText, /Z S X D C V G B H N J M.*Q 2 W 3 E R 5 T 6 Y 7 U/);
  assert.match(visibleText, /1 2 3 4.*Q W E R.*A S D F.*Z X C V/);
  assert.match(visibleText, /\[ and \] shift octaves; - and = change velocity/);
  assert.match(visibleText, /Controller profiles Computer keys remains the default.*detected automatically/);
  assert.match(visibleText, /Maschine Mikro uses MIDI mode.*Akai MPK Mini uses CC70–77/);
  assert.match(visibleText, /Arturia MiniLab 3 uses CC74, 71, 76, 77, 93, 18, 19, and 16/);
  assert.match(visibleText, /Novation Launchkey uses Custom Mode CC21–28/);
  assert.match(visibleText, /custom native mappings.*conservative universal map/);
  assert.match(visibleText, /Pitch bend follows a mapped pitch.*pressure or intensity control/);
  assert.match(visibleText, /MIDI Clock, Start, and Stop follow a page's tempo and transport/);
  assert.match(visibleText, /notes and velocity, pitch bend, CC, Program Change/);
  assert.match(visibleText, /Input and output remain separate/);
  assert.match(visibleText, /normal browser, MIDI Out is currently a preview only/);
  assert.match(visibleText, /no output destination is exposed.*none of the displayed values is sent/);
  assert.match(visibleText, /MIDI Out Monitor/);
  assert.match(
    visibleText,
    /exact instrument note previews.*unassigned 0–127 CC candidates.*BPM clock candidates.*transport state/,
  );
  assert.match(visibleText, /diagnostic only.*not.*routed, mapped, or sent as MIDI/i);
  assert.match(html, /href="wax\.html"/);
  assert.match(visibleText, /WAX build can run as MIDI FX/);
  assert.match(visibleText, /Incoming MIDI is never echoed automatically/);
  assert.doesNotMatch(visibleText, /every page (?:generates|outputs) MIDI/i);
});

test("Home gives one concise instruction before the catalogue", async () => {
  const html = await readFile(new URL("index.html", root), "utf8");
  const visibleText = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  assert.match(
    visibleText,
    /Morphazoid Instrument Catalogue Select an instrument, turn on audio, then find its play, input, or transport control\./,
  );
  assert.doesNotMatch(visibleText, /Basic operation|Select the speaker to arm audio/);
});

test("legacy About and catalogue URLs redirect to the single home page", async () => {
  const [about, catalogue] = await Promise.all([
    readFile(new URL("about.html", root), "utf8"),
    readFile(new URL("instruments.html", root), "utf8"),
  ]);
  assert.match(about, /http-equiv="refresh" content="0; url=\.\/"/);
  assert.match(about, /window\.location\.replace\("\.\/"\)/);
  assert.doesNotMatch(about, /data-instrument-catalog/);
  assert.match(catalogue, /http-equiv="refresh" content="0; url=\.\/#instrument-catalogue"/);
  assert.match(catalogue, /window\.location\.replace\("\.\/#instrument-catalogue"\)/);
  assert.doesNotMatch(catalogue, /data-instrument-catalog/);
});

test("About document styles remain independently scrollable on instrument breakpoints", async () => {
  const css = await readFile(new URL("about.css", root), "utf8");

  assert.match(css, /\.about-shell\s*\{[^}]*overflow-y: auto;/);
  assert.match(css, /\.about-shell\s*\{[^}]*flex: 1 1 auto;/);
  assert.match(css, /\.about-header-label\s*\{[^}]*color: var\(--muted\);/);
  assert.match(css, /\.about-footer\s*\{[^}]*color: var\(--muted\);/);
  assert.match(css, /@media \(max-width: 560px\)/);
});

test("repository declares Morphazoid's MIT license and keeps third-party terms separate", async () => {
  const [license, notices, signalsmithLicense, readme, packageText] = await Promise.all([
    readFile(new URL("LICENSE", root), "utf8"),
    readFile(new URL("THIRD_PARTY_NOTICES.md", root), "utf8"),
    readFile(new URL("vendor/signalsmith-stretch/LICENSE", root), "utf8"),
    readFile(new URL("README.md", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
  ]);

  assert.match(license, /^MIT License/);
  assert.match(license, /Copyright \(c\) 2026 Kristin Galvin/);
  assert.match(license, /Permission is hereby granted, free of charge/);
  assert.match(license, /THE SOFTWARE IS PROVIDED "AS IS"/);
  assert.match(readme, /\[MIT License\]\(LICENSE\)/);
  assert.match(readme, /\[THIRD_PARTY_NOTICES\.md\]\(THIRD_PARTY_NOTICES\.md\)/);
  assert.match(notices, /## Pink Trombone/);
  assert.match(notices, /## Tactile/);
  assert.match(notices, /## Signalsmith Stretch/);
  assert.match(signalsmithLicense, /Copyright \(c\) 2022 Geraint Luff \/ Signalsmith Audio Ltd\./);
  assert.equal(JSON.parse(packageText).license, "MIT");
});

test("Morphazoidical's local menus retain one home link without a duplicate About link", async () => {
  const pages = await Promise.all([
    readFile(new URL("morphazoidical/index.html", root), "utf8"),
    readFile(new URL("morphazoidical/atlas.html", root), "utf8"),
  ]);

  for (const html of pages) {
    assert.match(html, /href="\.\.\/">All tools<\/a>/);
    assert.doesNotMatch(html, />About<\/a>/);
  }
});
