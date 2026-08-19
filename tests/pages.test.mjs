import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("all instrument pages share desktop and mobile navigation", async () => {
  const files = [
    "shape.html", "lattice.html", "spiral.html", "solid.html", "hyper.html",
    "l-system.html", "recursion.html", "julia.html", "lumber.html", "l-mic.html",
    "graph-delay.html",
    "throatazoid.html",
  ];
  const [pages, css, nav] = await Promise.all([
    Promise.all(files.map((file) => readFile(new URL(file, root), "utf8"))),
    readFile(new URL("style.css", root), "utf8"),
    readFile(new URL("nav.js", root), "utf8"),
  ]);
  for (const [index, html] of pages.entries()) {
    for (const label of [
      "shape", "lattice", "spiral", "solid", "hyper",
      "l-system", "recursion", "julia", "lumber loops", "L-system Delay", "graph-delay", "throatazoid",
      "morphazoidical",
    ]) {
      const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      assert.match(html, new RegExp(`>${escapedLabel}<\\/a>`));
      assert.match(html, new RegExp(`>${escapedLabel}<\\/option>`));
    }
    assert.match(html, /class="mobile-instrument-select"/);
    assert.match(html, /<script type="module" src="nav\.js">/);
    assert.match(
      html,
      /<a class="wordmark" href="\.\/" aria-label="Morphazoid home">/,
      `${files[index]} logo should always link to the home page`,
    );
    const desktopNavigation = html.match(/<nav class="tabs"[\s\S]*?<\/nav>/)?.[0] ?? "";
    const mobileNavigation = html.match(
      /<select class="mobile-instrument-select"[\s\S]*?<\/select>/,
    )?.[0] ?? "";
    assert.equal(
      (desktopNavigation.match(/<a\b[^>]*aria-current="page"[^>]*>/g) ?? []).length,
      1,
      `${files[index]} should keep one current desktop tool`,
    );
    assert.equal(
      (mobileNavigation.match(/<option\b[^>]*\sselected(?:\s|>)/g) ?? []).length,
      1,
      `${files[index]} should keep one selected mobile tool`,
    );
    if (files[index] === "recursion.html") {
      assert.match(html, /id="resetStudy"[^>]*>Reset<\/button>/);
    } else {
      assert.match(html, /data-reset-all>Reset all parameters<\/button>/);
    }
  }
  const visibleTransportFiles = new Set([
    "shape.html", "lattice.html", "spiral.html", "solid.html", "hyper.html",
    "l-system.html", "julia.html", "lumber.html", "graph-delay.html",
  ]);
  for (const [index, html] of pages.entries()) {
    const openSections = html.match(/<details\b[^>]*\sopen(?:\s|>)/g) ?? [];
    assert.equal(
      openSections.length,
      visibleTransportFiles.has(files[index]) ? 1 : 0,
      `${files[index]} should expose its primary transport and keep parameter sections collapsed`,
    );
  }
  assert.match(css, /@media \(max-width: 1800px\)[\s\S]*?\.tabs\s*\{\s*display: none;/);
  assert.match(css, /@media \(max-width: 650px\)[\s\S]*?\.tabs\s*\{\s*display: none;/);
  assert.match(css, /\.tools-menu-label\s*\{[^}]*color: var\(--muted\);[^}]*font-size: 10px;/);
  assert.match(css, /\.tools-menu-current\s*\{[^}]*font-size: 13px;/);
  assert.match(css, /\.tools-menu-group\[data-tool-group="geometry-drums"\]\s*\{[^}]*--group-accent: var\(--orange\);/);
  assert.match(css, /\.tools-menu-group\[data-tool-group="signal-voice"\]\s*\{[^}]*--group-accent: var\(--blue\);/);
  assert.doesNotMatch(css, /data-tool-group="image-to-instrument"/);
  assert.match(css, /\.tools-menu-group\[data-tool-group="webgpu-synths"\]\s*\{[^}]*--group-accent: #9dff57;/);
  assert.match(css, /\.tools-menu-group\[data-tool-group="experiments"\]\s*\{[^}]*--group-accent: #e883ee;/);
  assert.match(css, /\.tools-menu-heading\s*\{[^}]*color: color-mix\(in oklab, var\(--group-accent\) 68%, var\(--muted\)\);[^}]*font-size: 10px;/);
  assert.match(css, /\.tools-menu-links\s*\{[^}]*flex-wrap: wrap;/);
  assert.match(css, /\.tools-menu-link\s*\{[^}]*font-size: 12px;/);
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
  const files = ["shape.html", "lattice.html", "spiral.html", "solid.html", "hyper.html", "julia.html"];
  const pages = await Promise.all(files.map((file) => readFile(new URL(file, root), "utf8")));
  for (const html of pages) {
    assert.match(html, /id="baseFrequency"[^>]*min="20"/);
  }
});
