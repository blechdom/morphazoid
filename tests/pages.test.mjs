import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("all ten instrument pages share desktop and mobile navigation", async () => {
  const files = [
    "index.html", "lattice.html", "spiral.html", "solid.html", "hyper.html",
    "l-system.html", "recursion.html", "julia.html", "lumber.html", "micmic.html",
  ];
  const [pages, css, nav] = await Promise.all([
    Promise.all(files.map((file) => readFile(new URL(file, root), "utf8"))),
    readFile(new URL("style.css", root), "utf8"),
    readFile(new URL("nav.js", root), "utf8"),
  ]);
  for (const [index, html] of pages.entries()) {
    for (const label of [
      "shape", "lattice", "spiral", "solid", "hyper",
      "l-system", "recursion", "julia", "lumber", "mic(mic)",
    ]) {
      const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      assert.match(html, new RegExp(`>${escapedLabel}<\\/a>`));
      assert.match(html, new RegExp(`>${escapedLabel}<\\/option>`));
    }
    assert.match(html, /class="mobile-instrument-select"/);
    assert.match(html, /<script type="module" src="nav\.js">/);
    if (files[index] === "recursion.html") {
      assert.match(html, /id="resetStudy"[^>]*>Reset this system<\/button>/);
    } else {
      assert.match(html, /data-reset-all>Reset all parameters<\/button>/);
    }
  }
  for (const html of pages) {
    assert.doesNotMatch(html, /<details\b[^>]*\sopen(?:\s|>)/, "sections should start collapsed");
  }
  assert.match(css, /@media \(max-width: 650px\)[\s\S]*?\.tabs\s*\{\s*display: none;/);
  assert.match(css, /\.mobile-instrument-nav/);
  assert.match(css, /@media \(max-width: 520px\)[\s\S]*?\.header-level\s*\{\s*display: grid;/);
  assert.match(nav, /location\.href = select\.value/);
  assert.match(nav, /localStorage\?\.removeItem/);
  assert.match(nav, /location\.reload\(\)/);
});

test("Solid and Hyper expose wireframe players and Sine-first audio", async () => {
  const [solid, hyper] = await Promise.all([
    readFile(new URL("solid.html", root), "utf8"),
    readFile(new URL("hyper.html", root), "utf8"),
  ]);
  assert.match(solid, /Cube[\s\S]*Pyramid[\s\S]*Cone[\s\S]*Sphere/);
  assert.match(solid, /<script type="module" src="solid-app\.js">/);
  assert.match(hyper, /X–W plane[\s\S]*Y–W plane[\s\S]*Z–W plane/);
  assert.match(hyper, /<script type="module" src="hyper-app\.js">/);
  for (const html of [solid, hyper]) assert.match(html, /<option value="sine" selected>/);
});

test("every oscillator-based instrument can reach a 20 Hz base frequency", async () => {
  const files = ["index.html", "lattice.html", "spiral.html", "solid.html", "hyper.html", "julia.html"];
  const pages = await Promise.all(files.map((file) => readFile(new URL(file, root), "utf8")));
  for (const html of pages) {
    assert.match(html, /id="baseFrequency"[^>]*min="20"/);
  }
});
