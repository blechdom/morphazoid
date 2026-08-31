import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  WEBGPU_DSP_CATEGORIES,
  WEBGPU_DSP_PRIMITIVES,
  WEBGPU_DSP_STATUSES,
} from "../src/webgpu-dsp-primitives.js";
import { WEBGPU_SYNTHS_SHADER } from "../src/webgpu-synths.js";

const ROOT = new URL("../", import.meta.url);
const DSP_STATUSES = Object.freeze(["live", "direct", "block"]);

function recordId(record) {
  return typeof record === "string" ? record : record?.id;
}

function assertUniqueIds(records, label) {
  assert.ok(Array.isArray(records), `${label} must be an array`);
  assert.ok(records.length > 0, `${label} must not be empty`);
  const ids = records.map(recordId);
  assert.equal(
    ids.every((id) => typeof id === "string" && id.trim().length > 0),
    true,
    `${label} must expose non-empty ids`,
  );
  assert.equal(new Set(ids).size, ids.length, `${label} ids must be unique`);
}

test("Shader Synth Primitives exports complete, uniquely identified primitive data", () => {
  assertUniqueIds(WEBGPU_DSP_CATEGORIES, "DSP categories");
  assertUniqueIds(WEBGPU_DSP_PRIMITIVES, "DSP primitives");
  assert.equal(WEBGPU_DSP_PRIMITIVES.length, 145, "the atlas count and initial page count should stay aligned");

  const statuses = new Set();
  for (const primitive of WEBGPU_DSP_PRIMITIVES) {
    assert.ok(
      DSP_STATUSES.includes(primitive.status),
      `${primitive.id} has unsupported status ${primitive.status}`,
    );
    statuses.add(primitive.status);
    for (const field of ["syntax", "audio", "note", "compose"]) {
      assert.equal(
        typeof primitive[field],
        "string",
        `${primitive.id}.${field} must be a string`,
      );
      assert.ok(primitive[field].trim(), `${primitive.id}.${field} must not be empty`);
    }
  }
  assert.deepEqual([...statuses].sort(), [...DSP_STATUSES].sort());
  assert.equal(
    WEBGPU_DSP_PRIMITIVES.find(({ id }) => id === "classic-fm")?.category,
    "modulation",
    "FM / PM belongs to the modulation category",
  );
  assert.equal(WEBGPU_DSP_STATUSES.live.short, "Current synth");
  assert.equal(WEBGPU_DSP_STATUSES.direct.short, "Single-sample");
  assert.equal(WEBGPU_DSP_STATUSES.block.short, "State / passes");
  assert.equal(
    Object.values(WEBGPU_DSP_STATUSES).every(({ description }) => description.trim().length > 30),
    true,
    "every execution label must explain what it means",
  );
});

test("the atlas documents the live geometry-to-time primitives with primary shader references", () => {
  const expectedIds = [
    "mirror-fold-time-field",
    "sdf-boundary-clock",
    "polar-kaleidoscope-clock",
    "voronoi-event-field",
    "truchet-path-clock",
    "kifs-fold-clock",
    "interference-lattice-clock",
  ];
  const entries = expectedIds.map((id) => WEBGPU_DSP_PRIMITIVES.find((primitive) => primitive.id === id));
  assert.equal(entries.every(Boolean), true);
  for (const entry of entries) {
    assert.equal(entry.status, "live");
    assert.equal(entry.category, "control");
    assert.match(entry.source?.url ?? "", /^https:\/\/www\.shadertoy\.com\/view\//);
    assert.match(`${entry.audio} ${entry.note} ${entry.compose}`, /event|gate|rhythm|note|clock|phrase/i);
  }

  const composableIds = [
    "phase-plane-coordinate-field", "tile-mirror-coordinate-field", "polar-fold-coordinate-field",
    "sdf-pattern-control-field", "sdf-boolean-control-field", "interference-control-field",
    "voronoi-control-field", "truchet-router-control-field",
  ];
  for (const id of composableIds) {
    const entry = WEBGPU_DSP_PRIMITIVES.find((primitive) => primitive.id === id);
    assert.ok(entry, `${id} needs a matching atlas entry`);
    assert.equal(entry.status, "live");
    assert.match(entry.source?.url ?? "", /^https:\/\/(?:www\.)?(?:shadertoy\.com|thebookofshaders\.com)\//);
    assert.match(`${entry.audio} ${entry.note}`, /X\/Y|coordinate|distance|field|cell|tile/i);
  }

  for (const id of [
    "cellular-automaton-score",
    "reaction-diffusion-score-lattice",
    "geometric-feedback-lattice",
    "spectral-sdf",
    "flow-field-advection",
    "raymarch-resonator",
  ]) {
    assert.equal(WEBGPU_DSP_PRIMITIVES.find((primitive) => primitive.id === id)?.status, "live");
  }
});

test("every function in the live GPU synth WGSL is named by a live atlas entry", () => {
  const helperNames = [
    ...WEBGPU_SYNTHS_SHADER.matchAll(/^fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm),
  ].map((match) => match[1]);
  assert.ok(helperNames.length > 0, "the live shader must expose WGSL functions");
  assert.equal(new Set(helperNames).size, helperNames.length, "WGSL function names must be unique");

  const liveReference = JSON.stringify(
    WEBGPU_DSP_PRIMITIVES.filter(({ status }) => status === "live"),
  );
  for (const helperName of helperNames) {
    assert.ok(
      liveReference.includes(helperName),
      `live DSP reference is missing WGSL function ${helperName}`,
    );
  }
});

test("the companion page exposes filters, a semantic table, and technical notes", async () => {
  const [html, css, app, synthPage] = await Promise.all([
    readFile(new URL("webgpu-dsp-primitives.html", ROOT), "utf8"),
    readFile(new URL("webgpu-dsp-primitives.css", ROOT), "utf8"),
    readFile(new URL("webgpu-dsp-primitives-app.js", ROOT), "utf8"),
    readFile(new URL("webgpu-synths.html", ROOT), "utf8"),
  ]);

  const inputTags = html.match(/<input\b[^>]*>/gi) ?? [];
  const buttonTags = html.match(/<button\b[^>]*>/gi) ?? [];
  assert.equal(inputTags.some((tag) => /\btype=["']search["']/i.test(tag)), true);
  assert.equal(buttonTags.some((tag) => /\bdata-category-filter(?:\s|=|>)/i.test(tag)), true);
  assert.equal(buttonTags.some((tag) => /\bdata-status-filter(?:\s|=|>)/i.test(tag)), true);

  assert.match(html, /<table\b/i);
  assert.match(html, /<caption\b/i);
  assert.match(html, /<thead\b/i);
  assert.match(html, /<tbody\b/i);
  assert.match(html, /<th\b[^>]*\bscope=["']col["']/i);
  assert.doesNotMatch(html, /patch-sketch|SOUND SKETCHPAD|WGSL RAW MATERIAL/i);
  assert.match(html, /href=["'](?:\.\/)?webgpu-synths\.html(?:[?#][^"']*)?["']/i);
  assert.match(html, /href=["'](?:\.\/)?shader-synth-playground\.html(?:[?#][^"']*)?["']/i);
  assert.match(html, /src=["'](?:\.\/)?webgpu-dsp-primitives-app\.js(?:\?[^"']*)?["']/i);
  assert.match(html, /href=["'](?:\.\/)?webgpu-dsp-primitives\.css(?:\?[^"']*)?["']/i);
  assert.match(synthPage, /href=["'](?:\.\/)?webgpu-dsp-primitives\.html(?:[?#][^"']*)?["']/i);
  assert.match(html, /<title>Shader Synth Primitives — Morphazoid<\/title>/i);
  assert.doesNotMatch(html, /FIELD NOTES \+ PRIMARY SOURCES/i);
  assert.match(html, /Shader audio architecture/i);
  assert.match(html, /class=["']dsp-consideration-list["']/i);
  assert.match(html, /class=["']dsp-consideration-list["'][\s\S]*?<code>/i);
  assert.match(html, /shadertoy\.com\/view\//i);
  assert.match(html, /gpuweb\.github\.io\/gpuweb/i);
  assert.match(html, /faustdoc\.grame\.fr\/manual\/syntax/i);
  assert.match(html, /faustlibraries\.grame\.fr\/libs\/oscillators/i);

  assert.match(app, /WEBGPU_DSP_PRIMITIVES/);
  assert.match(app, /WEBGPU_DSP_CATEGORIES/);
  assert.match(app, /primitive-status[^\n]*title=/);
  assert.match(app, /class="primitive-source"/);
  assert.match(app, /primitive\.source\?\.url/);
  assert.match(css, /\.primitive-source/);
  assert.match(html, />145 primitives</);
  assert.doesNotMatch(app, /WEBGPU_DSP_RECIPES|data-add-sketch|recipeStrip/);
  assert.match(css, /overflow-x:\s*(?:auto|scroll)/);
  assert.match(css, /@media\s*\(max-width:\s*\d+px\)/);
});
