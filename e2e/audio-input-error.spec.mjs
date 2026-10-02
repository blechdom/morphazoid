import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { installAudioInputFixture } from "./helpers/audio-input-fixture.mjs";

const { controls } = JSON.parse(await readFile(new URL("../docs/audio-input-controls.json", import.meta.url)));

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test.describe(`${viewport.width}×${viewport.height} input errors`, () => {
    test.use({ viewport, hasTouch: viewport.width !== 1440 });
    for (const entry of controls) {
      test(`${entry.label}: permission failure stays in a popup and Retry reconnects`, async ({ page }) => {
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        await installAudioInputFixture(page);
        await page.addInitScript(() => {
          window.__inputDenied = true;
          const request = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
          navigator.mediaDevices.getUserMedia = constraints => {
            if (__inputDenied) return Promise.reject(new DOMException("Microphone permission denied", "NotAllowedError"));
            return request(constraints);
          };
        });
        await page.goto(`/${entry.route}`);
        if (/^(graphs|l-systems)\.html/.test(entry.route)) await page.locator("#modeMic").click();
        if (entry.route.startsWith("settings.html")) await page.locator("#inputTest").evaluate(node => { node.open = true; });
        const strip = page.locator(".mz-audio-input-strip");
        const mic = strip.locator(".mz-input-toggle");
        await mic.scrollIntoViewIfNeeded();
        const geometry = () => strip.evaluate(root => [root, root.gainField, root.meter, root.button].map(node => {
          const { x, y, width, height } = node.getBoundingClientRect();
          return { x, y, width, height };
        }));
        const before = await geometry();
        await mic.click();
        const popup = page.locator(".mz-input-error");
        await expect(popup).toBeVisible();
        await expect(mic).toHaveAttribute("aria-busy", "false");
        await expect(mic).toHaveAttribute("aria-pressed", "false");
        expect(await geometry()).toEqual(before);
        expect(await page.locator("#audioError,#setupError").evaluateAll(nodes => nodes.some(node => {
          const box = node.getBoundingClientRect();
          return box.width > 0 && box.height > 0 && getComputedStyle(node).display !== "none";
        }))).toBe(false);
        await popup.getByRole("button", { name: "Dismiss input error" }).click();
        await expect(popup).toBeHidden();
        await page.waitForTimeout(150);
        await expect(popup).toBeHidden();
        await mic.click();
        await expect(popup).toBeVisible();
        expect(await geometry()).toEqual(before);
        await page.evaluate(() => { __inputDenied = false; });
        await popup.getByRole("button", { name: "Retry audio input" }).click();
        await expect(mic).toHaveAttribute("aria-pressed", "true");
        await expect(popup).toBeHidden();
        await mic.click();
        await expect(mic).toHaveAttribute("aria-pressed", "false");
        await expect.poll(() => page.evaluate(() => __familyInput.tracks.every(track => track.readyState === "ended"))).toBe(true);
        await page.evaluate(() => Promise.all(__familyInput.contexts.map(context => context.close())));
        expect(errors).toEqual([]);
      });
    }
    for (const route of ["sandy-syrup-delay.html", "candy-coil-delay.html", "slippery-resynthesis.html", "recursion.html", "synthesis.html?method=fx-biquad"]) {
      test(`${route}: an unreadable File input uses the popup without moving controls`, async ({ page }) => {
        await page.goto(`/${route}`);
        const strip = page.locator(".mz-audio-input-strip");
        await strip.locator(".mz-input-source").selectOption("file");
        await strip.scrollIntoViewIfNeeded();
        const geometry = () => strip.evaluate(root => [root, root.gainField, root.meter, root.button].map(node => {
          const { x, y, width, height } = node.getBoundingClientRect();
          return { x, y, width, height };
        }));
        const before = await geometry();
        await strip.locator('input[type="file"]').setInputFiles({
          name: "unreadable.wav", mimeType: "audio/wav", buffer: Buffer.from("This file contains no audio."),
        });
        const popup = page.locator(".mz-input-error");
        await expect(popup).toBeVisible();
        await expect(popup.getByRole("alert")).toHaveText("Input unavailable");
        expect(await geometry()).toEqual(before);
        await expect(page.locator("#audioError")).toBeHidden();
        await popup.getByRole("button", { name: "Dismiss input error" }).click();
        await expect(popup).toBeHidden();
        await strip.locator('input[type="file"]').setInputFiles({
          name: "unreadable-again.wav", mimeType: "audio/wav", buffer: Buffer.from("This file also contains no audio."),
        });
        await expect(popup).toBeVisible();
        expect(await geometry()).toEqual(before);
      });
    }
  });
}
