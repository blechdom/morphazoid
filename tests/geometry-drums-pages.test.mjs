import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const pages = [
  ["shape-drums.html", "shape-drums.html"],
  ["lattice-drums.html", "lattice-drums.html"],
  ["spiral-drums.html", "spiral-drums.html"],
  ["solid-drums.html", "solid-drums.html"],
  ["hyper-drums.html", "hyper-drums.html"],
  ["l-system-drums.html", "l-system-drums.html"],
];
const drumRoutes = pages.map(([, route]) => route);
const subdividedPages = [
  ["shape-drums.html", "sideSubdivisions", "sideSubdivisionsOut"],
  ["solid-drums.html", "subdivisions", "subdivisionsOut"],
  ["hyper-drums.html", "subdivisions", "subdivisionsOut"],
];

test("every geometry drum page has a complete static family menu and collapsed UI", async () => {
  for (const [file, currentRoute] of pages) {
    const html = await readFile(new URL(file, root), "utf8");
    const desktop = html.match(/<nav class="tabs"[\s\S]*?<\/nav>/)?.[0] ?? "";
    const mobile = html.match(
      /<select class="mobile-instrument-select"[\s\S]*?<\/select>/,
    )?.[0] ?? "";

    for (const route of drumRoutes) {
      assert.match(desktop, new RegExp(`href="${route.replace(".", "\\.")}"`));
      assert.match(mobile, new RegExp(`value="${route.replace(".", "\\.")}"`));
    }
    assert.equal(
      (desktop.match(/aria-current="page"/g) ?? []).length,
      1,
      `${file} should expose one current desktop route`,
    );
    assert.match(
      desktop,
      new RegExp(`href="${currentRoute.replace(".", "\\.")}"[^>]*aria-current="page"`),
    );
    assert.equal(
      (mobile.match(/\sselected(?:\s|>)/g) ?? []).length,
      1,
      `${file} should expose one selected mobile route`,
    );
    assert.match(
      mobile,
      new RegExp(`value="${currentRoute.replace(".", "\\.")}"[^>]*selected`),
    );
    assert.doesNotMatch(html, /<details\b[^>]*\sopen(?:\s|>)/);
    assert.doesNotMatch(html, /<h1\b|class="[^"]*(?:subtitle|drums-heading)/);
    assert.match(html, /id="stage"[\s\S]*?aria-describedby="canvasInstructions liveStatus"/);
    assert.match(html, /id="canvasInstructions"/);
  }
});

test("Shape, Solid, and Hyper expose one-to-sixteen subdivisions defaulting to two", async () => {
  for (const [file, inputId, outputId] of subdividedPages) {
    const html = await readFile(new URL(file, root), "utf8");
    assert.match(html, /<b>Subdivisions \/ side<\/b>/);
    const input = html.match(
      new RegExp(`<input\\b(?=[^>]*\\bid="${inputId}")[^>]*>`),
    )?.[0] ?? "";
    assert.match(input, /min="1"/, `${file} subdivision minimum`);
    assert.match(input, /max="16"/, `${file} subdivision maximum`);
    assert.match(input, /step="1"/, `${file} subdivision step`);
    assert.match(input, /value="2"/, `${file} subdivision default`);
    assert.match(
      html,
      new RegExp(`<output\\b(?=[^>]*\\bid="${outputId}")[^>]*>2<\\/output>`),
      `${file} subdivision output default`,
    );
    assert.match(
      html,
      /id="mappingSummary"[^>]*>[^<]*2\/side/,
      `${file} mapping summary default`,
    );
    const readout = html.match(/<div class="[^"]*-mapping-readout"[^>]*id="mappingReadout"[^>]*>/)?.[0] ?? "";
    assert.match(readout, /aria-label="Latest drum mapping"/);
    assert.match(readout, /aria-live="off"/);
    assert.doesNotMatch(readout, /aria-hidden="true"/);
  }
});
