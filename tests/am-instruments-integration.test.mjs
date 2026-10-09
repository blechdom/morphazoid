import { restoreChaoticAmRouting } from "./helpers/chaotic-am-routing-reference.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createHash } from "node:crypto";
import { amSharedAmendments, restoreAmInstrumentAdditions } from "./helpers/am-instruments-reference.mjs";
import { TOOL_GROUPS } from "../src/site/instrument-registry.js";
import { instrumentById } from "../src/site/instrument-catalog.js";
import { instrumentMidiCapabilityForId } from "../src/site/instrument-midi-capabilities.js";
import { waxSupportForId } from "../src/instruments/wax/wax-instrument-roles.js";
import { CANONICAL_PAGE_ROUTES } from "../src/pages/manifest.js";
import { readRuntimeManifest } from "../scripts/site/runtime-manifest.mjs";
import { chaoticDspReferenceForId } from "../src/instruments/chaotic-dsp-reference/chaotic-dsp-reference.js";

test("AM additions preserve the previous shared runtime bytes and reject unrelated changes", async () => {
  for (const change of amSharedAmendments.changes) {
    const source = restoreChaoticAmRouting(await readFile(new URL(`../${change.file}`, import.meta.url), "utf8"), change.file, { allowRestored: true });
    const digest = value => createHash("sha256").update(restoreAmInstrumentAdditions(value, change.file)).digest("hex");
    assert.equal(digest(source), change.sha256, change.file);
    assert.notEqual(digest(source + "\n// unrelated drift\n"), change.sha256);
    for (const { after } of change.replacements) {
      assert.throws(() => restoreAmInstrumentAdditions(source.replace(after, ""), change.file), /exact AM instrument amendment/);
      assert.throws(() => restoreAmInstrumentAdditions(source + after, change.file), /exact AM instrument amendment/);
    }
    const restored = restoreAmInstrumentAdditions(source, change.file);
    assert.equal(restoreAmInstrumentAdditions(restored, change.file, { allowRestored: true }), restored);
  }
});

for (const family of ["cascading", "recursive", "chaotic"]) {
  test(`${family} AM is a separate discoverable instrument with its sibling's capabilities`, async () => {
    const id = `${family}-am`;
    const sibling = `${family}-pm`;
    const item = instrumentById(id);
    assert.equal(item.href, `${id}.html`);
    assert.ok(item.tags.some(tag => tag.id === "am"));
    assert.ok(!item.tags.some(tag => tag.id === "pm" || tag.id === "fm"));
    const group = TOOL_GROUPS.find(group => group.id === "synthesizer");
    assert.equal(group.tools.findIndex(tool => tool.id === id), group.tools.findIndex(tool => tool.id === sibling) + 1);
    assert.deepEqual(instrumentMidiCapabilityForId(id), { ...instrumentMidiCapabilityForId(sibling), id });
    assert.deepEqual(waxSupportForId(id).roles, waxSupportForId(sibling).roles);
    assert.ok(CANONICAL_PAGE_ROUTES.includes(`${id}.html`));
    const source = await readFile(new URL(`../src/pages/${id}.html`, import.meta.url), "utf8");
    assert.match(source, new RegExp(`src/instruments/${id}/${id}-app\\.js`));
    assert.doesNotMatch(source, /data-morphazoid-wax-bootstrap/);
    const reference = chaoticDspReferenceForId(id);
    assert.ok(reference.algorithm.formula.includes("(1 + d[n] x modulator) / (1 + d[n])"));
    assert.ok(reference.algorithm.sections[0].nodes.some(node => node.detail.includes("no phase or frequency modulation")));
    const icon = await readFile(new URL(`../assets/instruments/${id}.webp`, import.meta.url));
    assert.equal(icon.toString("ascii", 0, 4), "RIFF");
    assert.equal(icon.toString("ascii", 8, 12), "WEBP");
    const manifest = await readRuntimeManifest();
    for (const file of [`${id}.html`, `src/instruments/${id}/${id}.js`, `src/instruments/${id}/${id}-app.js`, `src/instruments/${id}/${id}.css`]) {
      assert.ok(manifest.requiredFiles.includes(file), `${file} must ship`);
    }
  });
}

test("FM, PM and AM siblings link to all three AM routes without JavaScript", async () => {
  for (const family of ["cascading", "recursive", "chaotic"]) {
    for (const mode of ["fm", "pm", "am"]) {
      const html = await readFile(new URL(`../src/pages/${family}-${mode}.html`, import.meta.url), "utf8");
      const nav = html.match(/<nav class="tabs"[\s\S]*?<\/nav>/)[0];
      const select = html.match(/<select class="mobile-instrument-select"[\s\S]*?<\/select>/)[0];
      for (const target of ["cascading-am", "recursive-am", "chaotic-am"]) {
        assert.ok(nav.includes(`href="${target}.html"`));
        assert.ok(select.includes(`value="${target}.html"`));
      }
      assert.equal((nav.match(/aria-current="page"/g) ?? []).length, 1);
      assert.equal((select.match(/ selected/g) ?? []).length, 1);
    }
  }
});
