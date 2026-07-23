import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const pages = ["index.html", "lattice.html", "spiral.html", "solid.html", "hyper.html", "lumber.html"];
const links = ["shape", "lattice", "spiral", "solid", "hyper", "lumber"];

test("Spiral sits between Lattice and Solid in published navigation", async () => {
  const htmlPages = await Promise.all(pages.map((file) => readFile(new URL(file, root), "utf8")));

  for (const html of htmlPages) {
    let desktopPosition = -1;
    let mobilePosition = -1;
    for (const link of links) {
      const desktop = html.indexOf(`>${link}</a>`);
      const mobile = html.indexOf(`>${link}</option>`);
      assert.ok(desktop > desktopPosition, `${link} should be in desktop navigation order`);
      assert.ok(mobile > mobilePosition, `${link} should be in mobile navigation order`);
      desktopPosition = desktop;
      mobilePosition = mobile;
    }
    assert.match(html, /<script type="module" src="nav\.js"><\/script>/);
  }

  const spiral = htmlPages[2];
  assert.match(spiral, /class="tab active" href="spiral\.html" aria-current="page">spiral<\/a>/);
  assert.match(spiral, /<option value="spiral\.html" selected>spiral<\/option>/);
  assert.match(spiral, /<script type="module" src="spiral-app\.js\?v=deep-zoom"><\/script>/);
});
