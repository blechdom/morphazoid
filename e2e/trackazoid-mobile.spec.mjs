import { test, expect } from "@playwright/test";

const state = (page) => page.evaluate(() => window.__trackazoid.snapshot());

for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`touch navigation clears the menubar and preserves the mix at ${viewport.width}×${viewport.height}`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, viewport, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const errors = []; page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto("/trackazoid.html");
      await expect(page.locator("#trackazoid")).toHaveAttribute("data-ready", "true");
      await page.locator("#demoPair").tap();
      await expect(page.locator("#aPlay")).toBeEnabled();
      await expect(page.locator("#bSync")).toBeEnabled();
      const heading = await page.locator(".tz-heading").boundingBox();
      const status = await page.locator("#sessionStatus").boundingBox();
      expect(status.width).toBeGreaterThan(heading.width * 0.9);
      expect(heading.height).toBeLessThan(130);

      for (const [anchor, control] of [["deckA", "aPlay"], ["mixer", "pitchBoth"], ["deckB", "bSync"], ["libraryDrop", "addFiles"]]) {
        await page.locator(`#deckNavigation a[href="#${anchor}"]`).tap();
        const navigation = await page.locator("#deckNavigation").boundingBox();
        const header = await page.locator(".masthead").boundingBox();
        const target = await page.locator(`#${anchor}`).boundingBox();
        expect(navigation.y).toBeGreaterThanOrEqual(header.y + header.height - 1);
        expect(target.y).toBeGreaterThanOrEqual(navigation.y + navigation.height);
        const field = page.locator(`#${control}`);
        await field.scrollIntoViewIfNeeded();
        expect(await field.evaluate((el) => {
          const box = el.getBoundingClientRect();
          return el.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
        }), control).toBe(true);
        expect((await field.boundingBox()).height, control).toBeGreaterThanOrEqual(44);
      }
      for (const deck of ["a", "b"]) {
        const load = page.locator(`#trackRows button[data-deck="${deck}"]`).first();
        const box = await load.boundingBox();
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.locator("#bSync").tap();
      await page.locator("#bPlay").tap();
      await page.locator("#aPlay").tap();
      await expect.poll(async () => (await state(page)).decks.a.playing && (await state(page)).decks.b.playing).toBe(true);
      await page.locator("#aKeyLock").tap();
      await expect(page.locator("#aKeyLock")).toHaveText("Pitch follows tempo");
      await expect(page.locator("#bKeyLock")).toHaveText("Keep pitch");
      await expect(page.locator("#pitchBoth option").first()).toHaveText("Different per deck");
      await page.locator("#deckNavigation a[href='#mixer']").tap();
      await page.locator("#pitchBoth").selectOption("follow");
      await expect(page.locator("#bKeyLock")).toHaveAttribute("aria-pressed", "false");
      await page.setViewportSize({ width: viewport.height, height: viewport.width });
      await page.locator("#deckNavigation a[href='#deckB']").tap();
      await expect(page.locator("#bSync")).toHaveAttribute("aria-pressed", "true");
      const playing = await state(page);
      expect(playing.decks.a.playing && playing.decks.b.playing).toBe(true);
      expect(playing.armed).toBe(false);
      expect(playing.contextState).toBe("none");
      await page.locator("#pauseBoth").tap();
      await expect.poll(async () => (await state(page)).decks.a.playing || (await state(page)).decks.b.playing).toBe(false);
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  });
}
