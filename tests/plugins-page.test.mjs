import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  PLUGIN_CATALOG,
  PLUGIN_CATALOG_SCHEMA_VERSION,
  formatPluginBytes,
  latestPluginArtifact,
  latestPluginRelease,
} from "../src/plugin-catalog.js";

const root = new URL("../", import.meta.url);

test("plug-in catalog keeps separate instruments and immutable release artifacts", async () => {
  assert.equal(PLUGIN_CATALOG_SCHEMA_VERSION, 1);
  assert.deepEqual(
    PLUGIN_CATALOG.map(({ id }) => id),
    ["chaotic-fm", "chaotic-pm", "recursive-fm", "recursive-pm"],
  );
  assert.equal(new Set(PLUGIN_CATALOG.map(({ id }) => id)).size, PLUGIN_CATALOG.length);

  const downloadHrefs = new Set();
  for (const plugin of PLUGIN_CATALOG) {
    assert.match(plugin.demoHref, new RegExp(`^${plugin.id}\\.html$`));
    assert.ok(plugin.plannedFormats.length > 0);

    const recommended = plugin.releases.filter((release) => release.recommended);
    assert.ok(recommended.length <= 1);
    if (plugin.status === "available") assert.equal(recommended.length, 1);

    for (const release of plugin.releases) {
      assert.match(release.version, /^\d+\.\d+\.\d+$/);
      for (const artifact of release.artifacts) {
        assert.match(
          artifact.href,
          new RegExp(`^downloads/plugins/${plugin.id}/${release.version}/`),
        );
        assert.equal(downloadHrefs.has(artifact.href), false, `duplicate ${artifact.href}`);
        downloadHrefs.add(artifact.href);

        const bytes = await readFile(new URL(`../${artifact.href}`, import.meta.url));
        assert.equal(bytes.byteLength, artifact.bytes, `${artifact.href} size drifted`);
        assert.equal(
          createHash("sha256").update(bytes).digest("hex"),
          artifact.sha256,
          `${artifact.href} checksum drifted`,
        );
      }
    }
  }

  const chaoticFm = PLUGIN_CATALOG.find(({ id }) => id === "chaotic-fm");
  assert.equal(latestPluginRelease(chaoticFm)?.version, "0.3.0");
  assert.equal(latestPluginArtifact(chaoticFm)?.format, "REAPER JSFX");
  const latestBytes = await readFile(
    new URL(`../${latestPluginArtifact(chaoticFm).href}`, import.meta.url),
  );
  const sourceBytes = await readFile(
    new URL("../plugins/reaper/Morphazoid_Chaotic_FM.jsfx", import.meta.url),
  );
  assert.deepEqual(latestBytes, sourceBytes, "recommended download drifted from JSFX source");
  assert.equal(formatPluginBytes(47819), "46.7 KB");
  assert.equal(formatPluginBytes(800), "800 B");

  for (const plugin of PLUGIN_CATALOG.filter(({ id }) => id !== "chaotic-fm")) {
    assert.equal(plugin.voiceMode, "Monophonic");
    assert.ok(plugin.capabilities.includes("Browser MIDI notes and pitch bend"));
    assert.ok(plugin.capabilities.includes("Shared factory performance CCs"));
  }
});

test("plug-ins page exposes catalog, filters, install guide, and no-script download", async () => {
  const [html, css, app] = await Promise.all([
    readFile(new URL("plugins.html", root), "utf8"),
    readFile(new URL("plugins.css", root), "utf8"),
    readFile(new URL("plugins-app.js", root), "utf8"),
  ]);

  assert.match(html, /<title>Plug-ins — Morphazoid<\/title>/);
  assert.match(html, /href="plugins\.html" aria-current="page">plug-ins<\/a>/);
  assert.match(html, /id="pluginSearch"/);
  assert.match(html, /id="pluginStatusFilter"/);
  assert.match(html, /id="pluginCatalog"/);
  assert.match(html, /Separate instruments, shared system/);
  assert.match(html, /id="install-reaper-jsfx"/);
  assert.match(html, /downloads never move/i);
  assert.match(
    html,
    /downloads\/plugins\/chaotic-fm\/0\.3\.0\/reaper-jsfx\/Morphazoid_Chaotic_FM\.jsfx/,
  );
  assert.match(html, /<noscript>/);
  assert.match(html, /src="plugins-app\.js"/);
  assert.match(html, /src="nav\.js"/);

  assert.match(app, /PLUGIN_CATALOG\.map\(renderPluginCard\)/);
  assert.match(app, /data-plugin-download/);
  assert.match(app, /card\.dataset\.pluginStatus/);
  assert.match(app, /search\?\.addEventListener\("input", applyFilters\)/);
  assert.match(css, /\.plugin-card-available/);
  assert.match(css, /\.plugin-download/);
  assert.match(css, /\.plugins-shell\s*\{[^}]*overflow-y: auto;/);
  assert.match(css, /@media \(max-width: 520px\)/);
});

test("Chaotic FM demo points to the recommended catalog release", async () => {
  const html = await readFile(new URL("chaotic-fm.html", root), "utf8");
  const plugin = PLUGIN_CATALOG.find(({ id }) => id === "chaotic-fm");
  const artifact = latestPluginArtifact(plugin);

  assert.ok(artifact);
  assert.match(html, new RegExp(artifact.href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(html, /href="plugins\.html#chaotic-fm"/);
});
