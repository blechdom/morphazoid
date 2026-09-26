import { expect, test } from "@playwright/test";
import { pageDiagnosticMessages, watchPageDiagnostics } from "./helpers/diagnostics.mjs";

for (const prefix of ["", "dist-wax/"]) {
  for (const [width, height] of [[1440, 900], [390, 844], [844, 390]]) {
    test(`${prefix || "source/"} Settings needs activation and silent Play has no popup at ${width}x${height}`, async ({ browser, baseURL }) => {
      const context = await browser.newContext({
        baseURL, viewport: { width, height }, isMobile: width < 1000, hasTouch: width < 1000,
      });
      const page = await context.newPage();
      const diagnostics = watchPageDiagnostics(page, { baseURL });
      try {
        await page.addInitScript(() => {
          globalThis.__headerAudioContexts = 0;
          globalThis.AudioContext = new Proxy(globalThis.AudioContext, {
            construct(target, args) {
              __headerAudioContexts += 1;
              return Reflect.construct(target, args);
            },
          });
        });
        await page.goto(`${prefix}automatapoeia.html`);
        const gear = page.locator(".header-settings-trigger");
        const menu = page.locator(".header-settings-menu");
        const audio = page.locator("#audioButton");
        const play = page.locator("#playButton");
        const activate = () => width < 1000 ? gear.tap() : gear.click();
        await gear.hover();
        await page.waitForTimeout(350);
        await expect(menu).toHaveJSProperty("open", false);
        await gear.focus();
        await expect(menu).toHaveJSProperty("open", false);
        await activate();
        await expect(gear).toHaveAttribute("aria-expanded", "true");
        await expect(page.locator(".header-settings-controls")).toBeVisible();
        await page.mouse.move(10, 160);
        await page.waitForTimeout(350);
        await expect(menu).toHaveJSProperty("open", true);
        await activate();
        await expect(gear).toHaveAttribute("aria-expanded", "false");
        await gear.press("Space");
        await expect(menu).toHaveJSProperty("open", true);
        await expect(play).toHaveAttribute("aria-pressed", "false");
        await gear.press("Enter");
        await expect(menu).toHaveJSProperty("open", false);
        await gear.press("ArrowDown");
        await expect(menu).toHaveJSProperty("open", true);
        await page.keyboard.press("Escape");
        await expect(gear).toBeFocused();
        await expect(menu).toHaveJSProperty("open", false);
        await activate();
        await page.locator("#stage").click({ position: { x: 20, y: 20 } });
        await expect(menu).toHaveJSProperty("open", false);
        await expect(audio).toHaveAttribute("aria-pressed", "false");

        // Pointer, keyboard and programmatic Play all keep Audio explicit and
        // do not create a floating reminder over the instrument or its controls.
        await play.click();
        await expect(play).toHaveAttribute("aria-pressed", "true");
        await expect(page.locator("#transportAudioAttention, .transport-audio-attention")).toHaveCount(0);
        await expect(audio).toHaveAttribute("aria-label", "Turn audio on");
        await page.evaluate(() => document.activeElement?.blur());
        await page.keyboard.press("Space");
        await expect(play).toHaveAttribute("aria-pressed", "false");
        await page.keyboard.press("Space");
        await expect(play).toHaveAttribute("aria-pressed", "true");
        await play.evaluate(button => { button.click(); button.click(); });
        await expect(play).toHaveAttribute("aria-pressed", "true");
        await expect(audio).toHaveAttribute("aria-pressed", "false");
        await expect(page.locator("#transportAudioAttention, .transport-audio-attention")).toHaveCount(0);
        // The WAX facade already suppresses the browser-only MIDI preview.
        // Keep that existing policy; the normal site retains its full monitor.
        await expect(page.locator("#midiOutputMonitor")).toHaveCount(prefix ? 0 : 1);
        expect(await page.evaluate(() => __headerAudioContexts)).toBe(0);
        expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }
}
