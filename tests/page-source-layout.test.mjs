import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

import {
  CANONICAL_PAGE_ROUTES,
  PAGE_SOURCE_DIRECTORY,
  pageSourcePath,
} from "../src/pages/manifest.js";
import { validatePageSources } from "../scripts/site/page-source-routes.mjs";

const root = new URL("../", import.meta.url);

test("canonical pages live only in src/pages and exactly match the route manifest", async () => {
  const routes = await validatePageSources();
  assert.deepEqual(routes, [...CANONICAL_PAGE_ROUTES].sort());
  const rootHtml = (await readdir(root)).filter(name => name.endsWith(".html"));
  assert.deepEqual(rootHtml, []);
  const sourceHtml = (await readdir(new URL(`../${PAGE_SOURCE_DIRECTORY}/`, import.meta.url)))
    .filter(name => name.endsWith(".html")).sort();
  assert.deepEqual(sourceHtml, routes);
});

test("canonical sources are real pages, never redirect placeholders", async () => {
  for (const route of CANONICAL_PAGE_ROUTES) {
    const html = await readFile(new URL(`../${pageSourcePath(route)}`, import.meta.url), "utf8");
    assert.doesNotMatch(html, /http-equiv=["']refresh["']/i, route);
    assert.doesNotMatch(html, /location\.replace\(/, route);
  }
});
