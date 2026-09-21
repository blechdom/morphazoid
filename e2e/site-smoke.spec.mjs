import { expect, test } from "@playwright/test";

import {
  formatPageDiagnostics,
  pageDiagnosticMessages,
  settlePage,
  watchPageDiagnostics,
} from "./helpers/diagnostics.mjs";
import { allHtmlRoutes, instrumentRoutes, toolRoutes } from "./routes.mjs";
import { requireLoadedSpider, spiderModelStatus } from "./helpers/spider-readiness.mjs";

test("route inventory contains every catalogue and navigation route", () => {
  const htmlHrefs = new Set(allHtmlRoutes.map(({ href }) => href));
  const hasSourceHtml = ({ href }) => htmlHrefs.has(href)
    || (href.endsWith("/") && htmlHrefs.has(`${href}index.html`));

  expect(instrumentRoutes.length).toBeGreaterThan(0);
  expect(toolRoutes.length).toBeGreaterThanOrEqual(instrumentRoutes.length);
  expect(new Set(allHtmlRoutes.map(({ href }) => href)).size).toBe(allHtmlRoutes.length);
  expect(instrumentRoutes.filter((route) => !hasSourceHtml(route))).toEqual([]);
  expect(toolRoutes.filter((route) => !hasSourceHtml(route))).toEqual([]);
});

for (const route of allHtmlRoutes) {
  test(`${route.href} loads without browser errors`, async ({ page, baseURL }, testInfo) => {
    if (route.id === "spider-synth") test.setTimeout(60_000);
    const diagnostics = watchPageDiagnostics(page, { baseURL });
    const modelRequests = [];
    if (route.id === "spider-synth") {
      const isModel = url => /\/assets\/spider-synth\/.*(?:\.glb|rig-manifest\.json)(?:\?|$)/.test(url);
      page.on("response", response => {
        if (isModel(response.url())) modelRequests.push({ type: "response", url: response.url(), status: response.status() });
      });
      page.on("requestfinished", request => {
        if (isModel(request.url())) modelRequests.push({ type: "finished", url: request.url() });
      });
      page.on("requestfailed", request => {
        if (isModel(request.url())) modelRequests.push({ type: "failed", url: request.url(), error: request.failure()?.errorText });
      });
    }
    const response = await page.goto(route.testHref, { waitUntil: "domcontentloaded" });

    expect(response, `${route.href} did not return a document response`).not.toBeNull();
    expect(response?.ok(), `${response?.url() ?? route.href} returned HTTP ${response?.status()}`).toBe(true);
    await settlePage(page);
    if (route.id === "spider-synth") {
      // DOM load does not wait for the asynchronously fetched/decoded GLB.
      // Require the actual rig to load before ending the test and disposing it.
      // Do not ignore ERR_ABORTED: retain network failures even if the UI recovers.
      let readinessError;
      try {
        await page.waitForFunction(() => {
          const state = window.spiderSynth?.getState();
          return state?.loaded && !state.modelLoading
            || document.getElementById("retryModel")?.hidden === false
            || Boolean(state && !state.modelLoading && !state.loaded);
        }, undefined, { timeout: 45_000 });
      } catch (error) {
        readinessError = error;
      }
      const status = await page.evaluate(spiderModelStatus);
      await testInfo.attach("spider-model-loading.json", {
        body: JSON.stringify({ status, requests: modelRequests, diagnostics, waitError: readinessError?.message }, null, 2),
        contentType: "application/json",
      });
      if (readinessError) {
        throw new Error(`Spider model load timed out: ${JSON.stringify(status)}\n${formatPageDiagnostics(diagnostics)}`, { cause: readinessError });
      }
      requireLoadedSpider(status);
    }

    await expect(page.locator("html")).toHaveAttribute("lang", /\S/u);
    await expect(page).toHaveTitle(/\S/u);
    await expect(page.locator("body")).toBeVisible();

    expect(
      pageDiagnosticMessages(diagnostics),
      `${route.href} emitted browser diagnostics:\n${formatPageDiagnostics(diagnostics)}`,
    ).toEqual([]);
  });
}
