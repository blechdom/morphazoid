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

test("plug-ins page gives non-programmers the Chaotic Synth catalog and VST roadmap", async () => {
  const [html, css, app] = await Promise.all([
    readFile(new URL("plugins.html", root), "utf8"),
    readFile(new URL("plugins.css", root), "utf8"),
    readFile(new URL("plugins-app.js", root), "utf8"),
  ]);

  assert.match(html, /<title>Morphazoid Plug-ins \(under development\)<\/title>/);
  assert.match(html, /href="plugins\.html" aria-current="page">plug-ins<\/a>/);
  assert.match(html, /<h1>Morphazoid Plug-ins<\/h1>/);
  assert.match(html, /<p class="plugins-development">Under development<\/p>/);
  assert.match(html, /<p class="plugins-vst">VST coming soon<\/p>/);
  assert.match(html, /Chaotic FM is available now as a beta for REAPER\./);
  assert.match(html, /id="pluginCatalog"/);
  assert.match(html, /id="install-reaper-jsfx"/);
  assert.equal((html.match(/<li>/g) ?? []).length, 3);
  assert.doesNotMatch(html, /Next format|will be added here when ready/);
  assert.match(
    html,
    /downloads\/plugins\/chaotic-fm\/0\.3\.0\/reaper-jsfx\/Morphazoid_Chaotic_FM\.jsfx/,
  );
  assert.match(html, /download="Morphazoid_Chaotic_FM-v0\.3\.0\.jsfx"/);
  assert.match(html, /src="nav\.js"/);
  assert.match(html, /href="plugins\.css\?v=20260815-2"/);
  assert.match(html, /src="plugins-app\.js\?v=20260815-2"/);
  assert.doesNotMatch(html, /id="pluginSearch"|id="pluginStatusFilter"/);

  assert.match(app, /PLUGIN_CATALOG\.map\(renderPluginCard\)/);
  assert.match(app, /Beta available/);
  assert.match(app, /Under development/);
  assert.match(app, /plugin-version-picker/);
  assert.match(app, /download version/);
  assert.match(app, /v\$\{artifact\.version\}/);
  assert.match(app, /Download for REAPER/);
  assert.match(app, /Try it in the browser/);
  assert.doesNotMatch(app, /plugin-change-list|sha256|Previous Chaotic FM versions/);

  assert.match(css, /\.plugin-download/);
  assert.match(css, /\.plugin-catalog/);
  assert.match(css, /\.plugin-version-picker/);
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /\.plugins-install/);
  assert.doesNotMatch(css, /\.plugins-coming/);
  assert.doesNotMatch(css, /\.plugins-install\s*\{[^}]*grid-template-columns/s);
  assert.match(css, /\.plugins-intro\s*\{[^}]*text-align: left/s);
  assert.match(css, /\.plugins-intro h1\s*\{[^}]*text-align: left/s);
  assert.match(css, /@media \(max-width: 650px\)/);
  assert.match(css, /\.plugins-intro h1\s*\{[^}]*white-space: nowrap/s);
  assert.match(css, /@media \(max-width: 380px\)[^{]*\{[^}]*\.plugins-intro h1/s);
});

test("Chaotic FM demo points to the recommended catalog release", async () => {
  const html = await readFile(new URL("chaotic-fm.html", root), "utf8");
  const plugin = PLUGIN_CATALOG.find(({ id }) => id === "chaotic-fm");
  const artifact = latestPluginArtifact(plugin);

  assert.ok(artifact);
  assert.match(html, new RegExp(artifact.href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(html, /href="plugins\.html#chaotic-fm"/);
});
