import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("all five instrument pages share complete navigation", async () => {
  const files = ["index.html", "lattice.html", "solid.html", "hyper.html", "lumber.html"];
  const pages = await Promise.all(files.map((file) => readFile(new URL(file, root), "utf8")));
  for (const html of pages) {
    for (const link of ["shape", "lattice", "solid", "hyper", "lumber"]) {
      assert.match(html, new RegExp(`>${link}<\\/a>`));
    }
  }
  for (const html of pages) {
    assert.doesNotMatch(html, /<details\b[^>]*\sopen(?:\s|>)/, "sections should start collapsed");
  }
});

test("Solid and Hyper expose wireframe players and Sine-first audio", async () => {
  const [solid, hyper] = await Promise.all([
    readFile(new URL("solid.html", root), "utf8"),
    readFile(new URL("hyper.html", root), "utf8"),
  ]);
  assert.match(solid, /2D SURFACE PLAYER/);
  assert.match(solid, /Cube[\s\S]*Pyramid[\s\S]*Cone[\s\S]*Sphere/);
  assert.match(solid, /<script type="module" src="solid-app\.js">/);
  assert.match(hyper, /3D HYPERPLANE PLAYER/);
  assert.match(hyper, /X–W plane[\s\S]*Y–W plane[\s\S]*Z–W plane/);
  assert.match(hyper, /<script type="module" src="hyper-app\.js">/);
  for (const html of [solid, hyper]) assert.match(html, /<option value="sine" selected>/);
});

test("every synthesized instrument can reach a 20 Hz base frequency", async () => {
  const files = ["index.html", "lattice.html", "solid.html", "hyper.html"];
  const pages = await Promise.all(files.map((file) => readFile(new URL(file, root), "utf8")));
  for (const html of pages) {
    assert.match(html, /id="baseFrequency"[^>]*min="20"/);
  }
});
