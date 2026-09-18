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
  assert.doesNotMatch(html, /class="about-header-link"/);
  assert.doesNotMatch(html, /href="(?:plugins|instruments|about)\.html"/);
  assert.match(html, /id="homeInstrumentCatalogue"[\s\S]*?data-instrument-catalog/);
  assert.match(html, /src="src\/site\/instrument-catalog-app\.js\?v=catalog-[^"]+"/);
  assert.match(
    html,
    /<h1>Morphazoid<\/h1>[\s\S]*?<h2>Instrument Catalogue<\/h2>/,
  );
  assert.doesNotMatch(html, /Select an instrument, turn on audio/);
  assert.doesNotMatch(html, /class="about-lede"|Basic operation/);
  assert.doesNotMatch(html, /manual-section-label">Browse|Instrument sections, titles, and order/);
  assert.doesNotMatch(html, /microphone input|audio files?|file instruments?/i);
  assert.doesNotMatch(html, /Select the speaker, Input/);
  assert.doesNotMatch(html, /Audio starts off\./);
  assert.doesNotMatch(html, /class="about-summary"/);
  assert.doesNotMatch(html, /class="manual-index"/);
  assert.doesNotMatch(html, /<dt>(?:Instruments|Runtime)<\/dt>/);
  assert.doesNotMatch(html, /<h2>Project<\/h2>/);
  assert.match(
    html,
    /id="instrument-catalogue"[\s\S]*?homeInstrumentCatalogue[\s\S]*?MIDI &amp; WAX Plugin Guide <span aria-hidden="true">→<\/span>/,
  );
  assert.match(html, /<dt>Design system<\/dt>[\s\S]*?<dt>License<\/dt>[\s\S]*?<dt>Code<\/dt>[\s\S]*?Created by/);
  assert.match(html, /class="about-title-mark"/);
  assert.match(html, /class="author-mark"[\s\S]*?src="assets\/authors\/kristin-galvin\.png"/);
  assert.match(html, /class="github-mark"[\s\S]*?aria-label="Morphazoid on GitHub"|aria-label="Morphazoid on GitHub"[\s\S]*?class="github-mark"/);
  assert.match(html, /<a class="catalogue-guide-link" href="midi-guide\.html">MIDI &amp; WAX Plugin Guide <span aria-hidden="true">→<\/span><\/a>/);
  assert.doesNotMatch(html, /catalogue-companion/);
  assert.doesNotMatch(html, /href="wax\.html"/);
  assert.match(html, /<a href="storybook\/">Component library<\/a>/);
  assert.match(html, /https:\/\/github\.com\/blechdom\/morphazoid\/blob\/main\/LICENSE/);
  assert.match(html, /https:\/\/www\.instagram\.com\/blechdom/);
  assert.match(html, /Created by <a href="https:\/\/github\.com\/blechdom">Kristin Galvin<\/a>[\s\S]*?a\.k\.a\. Kevin Blechdom/);
  assert.doesNotMatch(html, /href="plugins\.html"/);
  assert.doesNotMatch(
    html,
    /manual-section-label">Built with|<h2>Implementation<\/h2>|<dt>(?:Interface|Graphics|Audio|State|Development)<\/dt>/,
  );
  assert.doesNotMatch(html, /static site and does not need an application server/);
  assert.doesNotMatch(html, /vibed up with Codex|no code was ever touched|Copyright/);
  assert.doesNotMatch(html, /manual-section-label">\d+/);
  assert.doesNotMatch(html, /class="page-entry"/);
  assert.doesNotMatch(html, /<script type="module" src="src\/instruments\/shape-synth\/shape-synth-app\.js"><\/script>/);
});

test("Home mounts the only complete registry-backed catalogue", async () => {
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
  assert.ok(INSTRUMENTS.length > 0);
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
  assert.match(
    home,
    /class="author-mark"[\s\S]*?src="assets\/authors\/kristin-galvin\.png"[\s\S]*?width="112"[\s\S]*?alt="Kristin Galvin"/,
  );
});

test("MIDI and WAX guide keeps browser MIDI and DAW plug-in routing clear", async () => {
  const html = await readFile(new URL("midi-guide.html", root), "utf8");
  const visibleText = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  assert.match(html, /<title>MIDI &amp; WAX Plugin Guide — Morphazoid<\/title>/);
  assert.match(html, /<body class="about-page">/);
  assert.match(html, /<h1>MIDI &amp; WAX Plugin Guide<\/h1>/);
  assert.match(html, /<nav class="tabs" aria-label="Morphazoid main menu"><\/nav>/);
  assert.match(html, /<script type="module" src="nav\.js"><\/script>/);
  assert.match(visibleText, /Play Morphazoid from a controller in the browser, or load it in your DAW with WAX, an audio plug-in/);
  assert.match(visibleText, /Open any playable instrument and select MIDI in its top bar/);
  assert.match(visibleText, /receive light flash for incoming notes and controls/);
  assert.match(visibleText, /L\/R meter to see the two channels reaching the audio destination/);
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
  assert.match(visibleText, /Controller profiles Automatic: Computer keys remains the default.*detected automatically/);
  assert.match(visibleText, /Maschine Mikro: MIDI mode.*Akai MPK Mini: CC70–77/);
  assert.match(visibleText, /Arturia MiniLab 3: CC74, 71, 76, 77, 93, 18, 19, and 16/);
  assert.match(visibleText, /Novation Launchkey: Custom Mode CC21–28/);
  assert.match(visibleText, /custom native mappings.*conservative universal map/);
  assert.match(visibleText, /pitch bend follows a mapped pitch.*pressure or intensity control/i);
  assert.match(visibleText, /MIDI Clock, Start, and Stop follow a page's tempo and transport/);
  assert.match(visibleText, /notes and velocity, pitch bend, CC, Program Change/);
  assert.match(visibleText, /Input and output remain separate/);
  assert.match(visibleText, /normal browser, MIDI Out is a preview only/);
  assert.match(visibleText, /no output destination is exposed.*none of the displayed values is sent/);
  assert.match(visibleText, /MIDI Out Monitor/);
  assert.match(
    visibleText,
    /exact instrument note previews.*unassigned 0–127 CC candidates.*genuine BPM clock candidates.*transport state/,
  );
  assert.match(visibleText, /diagnostic only.*nothing it shows is routed, mapped, or sent as MIDI/i);
  assert.match(html, /id="wax"/);
  assert.match(visibleText, /WAX is the required audio plug-in host for Morphazoid in a DAW/);
  assert.match(visibleText, /not a standalone Morphazoid VST3 or Audio Unit/);
  assert.match(visibleText, /WAX Instrument.*WAX Audio FX.*WAX MIDI FX/);
  assert.match(visibleText, /MIDI only.*host MIDI destination.*root note.*division.*channel.*gate/);
  assert.match(visibleText, /Incoming MIDI is never echoed automatically/);
  assert.doesNotMatch(visibleText, /every page (?:generates|outputs) MIDI/i);
});

test("Home lets the visual catalogue begin without instructional copy", async () => {
  const html = await readFile(new URL("index.html", root), "utf8");
  const visibleText = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  assert.match(html, /<h2>Instrument Catalogue<\/h2>[\s\S]*?data-instrument-catalog/);
  assert.doesNotMatch(
    visibleText,
    /Basic operation|Select the speaker to arm audio|Select an instrument, turn on audio/,
  );
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
  const css = await readFile(new URL("src/site/styles/about.css", root), "utf8");

  assert.match(css, /\.about-shell\s*\{[^}]*overflow-y: auto;/);
  assert.match(css, /\.about-shell\s*\{[^}]*flex: 1 1 auto;/);
  assert.match(css, /\.about-header-label\s*\{[^}]*color: var\(--muted\);/);
  assert.match(css, /\.about-header-link\s*\{[^}]*min-height: 44px;/);
  assert.match(css, /\.about-header-link:hover\s*\{[^}]*color: var\(--ink\);/);
  assert.match(css, /\.author-mark\s*\{[^}]*width: 112px;/);
  assert.match(css, /\.author-mark\s*\{[^}]*border-radius: 50%;/);
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
  assert.match(notices, /## MakeHuman teeth_base/);
  assert.match(notices, /## Three\.js/);
  assert.match(notices, /assets\/models\/dentaphone-chomper\.LICENSE\.txt/);
  assert.match(notices, /vendor\/three\/LICENSE\.txt/);
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
