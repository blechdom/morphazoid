import { expect, test } from "@playwright/test";

import { attachJson } from "./helpers/canvas-preservation.mjs";
import { readAudioStatus } from "./helpers/audio-probe.mjs";
import { pageDiagnosticMessages, settlePage, watchPageDiagnostics } from "./helpers/diagnostics.mjs";
import { canonicalInstrumentId } from "../src/site/instrument-identities.js";

test("catalogue data imports alone do not initialize a page or clear storage", async ({ page, baseURL }) => {
  await page.route("**/v2-data-probe.html", (route) => route.fulfill({
    contentType: "text/html",
    body: '<!doctype html><html lang="en"><head><title>Data-only probe</title></head><body><p>Unchanged</p></body></html>',
  }));
  await page.goto(`${baseURL}/v2-data-probe.html`);
  const result = await page.evaluate(async () => {
    const key = "morphazoid:shape:audio:v1";
    localStorage.setItem(key, "keep-for-probe");
    const original = EventTarget.prototype.addEventListener;
    const markup = document.documentElement.outerHTML;
    let listeners = 0;
    EventTarget.prototype.addEventListener = function (...args) {
      listeners += 1;
      return Reflect.apply(original, this, args);
    };
    try {
      const browser = await import("/src/site/instrument-catalog.js?data-only-probe");
      const wax = await import("/dist-wax/src/site/instrument-catalog.js?data-only-probe");
      return {
        listeners,
        markupUnchanged: markup === document.documentElement.outerHTML,
        stored: localStorage.getItem(key),
        browserIds: browser.INSTRUMENTS.map(({ id }) => id),
        waxIds: wax.INSTRUMENTS.map(({ id }) => id),
      };
    } finally {
      EventTarget.prototype.addEventListener = original;
      localStorage.removeItem(key);
    }
  });
  expect(result.listeners).toBe(0);
  expect(result.markupUnchanged).toBe(true);
  expect(result.stored).toBe("keep-for-probe");
  expect(result.browserIds.length).toBeGreaterThan(0);
  expect(result.waxIds).toEqual(result.browserIds);
});

for (const id of ["shape", "solid", "l-system", "l-systems"]) {
  test(`${id}: metadata hydration preserves navigation and one-click transport behavior`, async ({ page, baseURL }, testInfo) => {
    const diagnostics = watchPageDiagnostics(page, { baseURL });
    await page.goto(`${id}.html`, { waitUntil: "load" });
    await settlePage(page);
    await page.evaluate(async () => { await import("/src/site/instrument-catalog.js?late-data-probe"); });
    await expect(page.locator(".tabs .instrument-picker")).toHaveAttribute("data-active-tool-id", canonicalInstrumentId(id));
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
    expect((await readAudioStatus(page)).connectionCount).toBe(0);

    const navigation = await page.evaluate(() => ({
      activeId: document.querySelector(".instrument-picker")?.getAttribute("data-active-tool-id"),
      options: [...document.querySelectorAll(".mobile-instrument-select option")].map((option) => {
        const url = new URL(option.value, location.href);
        return { label: option.textContent, href: `${url.pathname}${url.search}${url.hash}`, selected: option.selected };
      }),
    }));
    await page.evaluate(() => {
      window.__v2TransportClicks = 0;
      document.getElementById("playButton").addEventListener("click", () => { window.__v2TransportClicks += 1; });
      document.body.tabIndex = -1;
      document.body.focus();
    });
    await page.keyboard.press("Space");
    await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => window.__v2TransportClicks)).toBe(1);
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("Space");
    await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
    expect(await page.evaluate(() => window.__v2TransportClicks)).toBe(2);

    await page.locator('input[type="range"]:visible').first().focus();
    await page.keyboard.press("Space");
    expect(await page.evaluate(() => window.__v2TransportClicks)).toBe(2);
    expect((await readAudioStatus(page)).connectionCount).toBe(0);
    expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
    await attachJson(testInfo, "navigation-and-transport.json", {
      route: page.url(), navigation, clicks: 2, audioInitiallyOff: true,
    });
  });
}

test("the home catalogue retains its rendered groups, links, and ordering", async ({ page, baseURL }, testInfo) => {
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await page.goto("index.html", { waitUntil: "load" });
  await settlePage(page);
  await expect(page.locator(".instrument-card").first()).toBeVisible();
  const catalogue = await page.evaluate(() => [...document.querySelectorAll(".catalogue-group")].map((group) => ({
    id: group.getAttribute("data-category-id"),
    title: group.querySelector(".catalogue-group-title")?.textContent,
    cards: [...group.querySelectorAll(".instrument-card")].map((card) => ({
      href: new URL(card.querySelector(".instrument-card-link").href).pathname,
      title: card.querySelector(".instrument-card-title")?.textContent,
    })),
  })));
  expect(catalogue.length).toBeGreaterThan(0);
  expect(catalogue.every((group) => group.cards.every((card) => Boolean(card.title)))).toBe(true);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
  await attachJson(testInfo, "rendered-catalogue.json", catalogue);
});
