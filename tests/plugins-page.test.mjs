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

test("plug-ins page gives non-programmers a direct REAPER download and VST roadmap", async () => {
  const [html, css] = await Promise.all([
    readFile(new URL("plugins.html", root), "utf8"),
    readFile(new URL("plugins.css", root), "utf8"),
  ]);

  assert.match(html, /<title>Morphazoid Plug-ins \(under development\)<\/title>/);
  assert.match(html, /href="plugins\.html" aria-current="page">plug-ins<\/a>/);
  assert.match(html, /<h1>Morphazoid Plug-ins<\/h1>/);
  assert.match(html, /\(under development\)/i);
  assert.match(html, /Use REAPER\? You can download Chaotic FM now\./);
  assert.match(html, /id="install-reaper-jsfx"/);
  assert.equal((html.match(/<li>/g) ?? []).length, 3);
  assert.match(html, /VST versions/);
  assert.match(html, /VST plug-ins are in development/);
  assert.match(
    html,
    /downloads\/plugins\/chaotic-fm\/0\.3\.0\/reaper-jsfx\/Morphazoid_Chaotic_FM\.jsfx/,
  );
  assert.match(html, /download="Morphazoid_Chaotic_FM-v0\.3\.0\.jsfx"/);
  assert.match(html, /href="chaotic-fm\.html">Try it in the browser<\/a>/);
  assert.match(html, /src="nav\.js"/);
  assert.doesNotMatch(html, /id="pluginSearch"|id="pluginStatusFilter"|src="plugins-app\.js"/);

  assert.match(css, /\.plugin-download/);
  assert.match(css, /\.plugins-install/);
  assert.match(css, /\.plugins-coming/);
  assert.match(css, /@media \(max-width: 650px\)/);
});

test("Chaotic FM demo points to the recommended catalog release", async () => {
  const html = await readFile(new URL("chaotic-fm.html", root), "utf8");
  const plugin = PLUGIN_CATALOG.find(({ id }) => id === "chaotic-fm");
  const artifact = latestPluginArtifact(plugin);

  assert.ok(artifact);
  assert.match(html, new RegExp(artifact.href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(html, /href="plugins\.html#chaotic-fm"/);
});
