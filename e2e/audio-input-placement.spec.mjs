import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { installAudioInputFixture } from "./helpers/audio-input-fixture.mjs";

const { controls } = JSON.parse(await readFile(new URL("../docs/audio-input-controls.json", import.meta.url)));
const presetRoutes = new Set([
  "graph-delay.html", "l-mic.html", "moire-drone.html", "l-systems.html",
  "fractal-synthesis.html", "synthesis.html", "graphs.html", "morphynx.html",
  "simd-resonator.html", "simd-lab.html", "gesturama.html", "tape-worm.html",
  "loop-soup.html", "hollowphonic.html",
]);
for (const fallback of [false, true]) {
  test(`${fallback ? "fallback" : "native"} input popup follows responsive placement and a new preset row`, async ({ page }) => {
    await page.addInitScript(({ fallback }) => {
      if (fallback) { HTMLElement.prototype.showPopover = undefined; HTMLElement.prototype.hidePopover = undefined; }
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
    }, { fallback });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/graph-delay.html");
    const strip = page.locator(".mz-audio-input-strip");
    await strip.locator(".mz-input-toggle").click();
    const popup = page.locator(".mz-input-error");
    await expect(popup).toBeVisible();
    const anchorDistance = () => strip.evaluate(root => {
      const mic = root.button.getBoundingClientRect();
      const popup = root.errorPopup.getBoundingClientRect();
      return Math.min(Math.abs(popup.top - mic.bottom - 6), Math.abs(mic.top - popup.bottom - 6));
    });
    await expect.poll(anchorDistance).toBeLessThan(1);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(strip).toHaveAttribute("data-input-placement", "preset");
    await expect.poll(anchorDistance).toBeLessThan(1);
    await page.evaluate(() => {
      const old = document.querySelector(".instrument-preset-controls");
      const spacer = document.createElement("div");
      spacer.style.height = "120px";
      old.parentElement.before(spacer);
      old.replaceWith(old.cloneNode(true));
    });
    await expect(strip).toHaveAttribute("data-input-placement", "preset");
    await expect.poll(anchorDistance).toBeLessThan(1);
    await expect(popup).toBeVisible();
  });
}
for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test.describe(`${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport, hasTouch: viewport.width !== 1440 });
    for (const entry of controls) {
      test(`${entry.label}: input controls occupy the requested row`, async ({ page }) => {
        await page.goto(`/${entry.route}`);
        const route = entry.route.split(/[?#]/)[0];
        const strip = page.locator(".mz-audio-input-strip");
        if (route === "settings.html") await page.locator("#inputTest").evaluate(node => { node.open = true; });
        else await expect(strip).toHaveAttribute("data-input-placement", viewport.width === 1440 ? "header" : presetRoutes.has(route) ? "preset" : "controls");
        await strip.scrollIntoViewIfNeeded();
        const layout = await strip.evaluate(root => {
          const box = node => {
            const rect = node.getBoundingClientRect();
            return { left: rect.left, right: rect.right, center: rect.top + rect.height / 2, width: rect.width, height: rect.height };
          };
          const header = document.querySelector(".masthead");
          const output = header.querySelector(".header-output-meter-shell");
          const row = root.closest(".mz-input-preset-row");
          const picker = row?.querySelector(".header-preset-picker > summary, .mz-input-native-preset select, select.mz-input-native-preset");
          return {
            parts: [root.gainField, root.meter, root.button].map(box),
            meterBorders: [root.meter.leftMeter, root.meter.rightMeter].map(node => {
              const style = getComputedStyle(node);
              return [style.borderTopWidth, style.outlineWidth];
            }),
            buttonRadius: getComputedStyle(root.button).borderRadius,
            inHeader: header.contains(root),
            beforeOutput: output ? root.nextElementSibling === output : true,
            output: output && !output.hidden ? box(output) : null,
            picker: picker ? box(picker) : null,
            overflow: document.documentElement.scrollWidth > innerWidth + 1 || root.scrollWidth > root.clientWidth + 1,
          };
        });
        expect(layout.overflow).toBe(false);
        expect(layout.meterBorders).toEqual([["0px", "0px"], ["0px", "0px"]]);
        expect(layout.buttonRadius).toBe("0px");
        expect(layout.parts[0].right).toBeLessThanOrEqual(layout.parts[1].left);
        expect(layout.parts[1].right).toBeLessThanOrEqual(layout.parts[2].left);
        for (const part of layout.parts) {
          expect(part.left).toBeGreaterThanOrEqual(-1);
          expect(part.right).toBeLessThanOrEqual(viewport.width + 1);
          expect(Math.abs(part.center - layout.parts[0].center)).toBeLessThan(3);
        }
        if (route !== "settings.html" && viewport.width === 1440) {
          expect(layout.inHeader).toBe(true);
          expect(layout.beforeOutput).toBe(true);
          if (layout.output?.width) expect(layout.parts[2].right).toBeLessThanOrEqual(layout.output.left);
        }
        if (viewport.width !== 1440) {
          expect(layout.parts[2].width).toBeGreaterThanOrEqual(48);
          expect(layout.parts[2].height).toBeGreaterThanOrEqual(48);
          if (presetRoutes.has(route)) {
            expect(layout.picker).not.toBeNull();
            expect(layout.parts[2].right).toBeLessThanOrEqual(layout.picker.left);
            expect(Math.abs(layout.parts[0].center - layout.picker.center)).toBeLessThan(3);
            await expect(page.locator(".mz-input-preset-row select, .mz-input-preset-row .header-preset-picker > summary").first()).toHaveAccessibleName(/.+/);
          }
        }
      });
    }
  });
}

test("resizing and replacing a preset row retain the live mic and native gain", async ({ page }) => {
  await installAudioInputFixture(page);
  await page.goto("/graph-delay.html");
  const strip = page.locator(".mz-audio-input-strip");
  const mic = strip.locator(".mz-input-toggle");
  await mic.click();
  await expect(mic).toHaveAttribute("aria-pressed", "true");
  await strip.locator('input[type="range"]').evaluate(input => {
    window.__originalMicGain = input;
    input.value = "0.42";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await mic.focus();
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await expect(strip).toHaveAttribute("data-input-placement", viewport.width === 1440 ? "header" : "preset");
    await expect(mic).toHaveAttribute("aria-pressed", "true");
    await expect(mic).toBeFocused();
    expect(await page.evaluate(() => __originalMicGain === document.querySelector(".mz-audio-input-strip input[type=range]"))).toBe(true);
    await expect(strip.locator('input[type="range"]')).toHaveValue("0.42");
    expect(await page.evaluate(() => __familyInput.requests)).toBe(1);
    expect(await page.evaluate(() => __familyInput.tracks.every(track => track.readyState === "live"))).toBe(true);
  }
  await page.evaluate(async () => {
    const { registerHeaderPresets } = await import("/src/site/header-presets.js");
    let value = 1;
    registerHeaderPresets({
      id: "placement-probe",
      presets: Array.from({ length: 12 }, (_, index) => ({ id: `probe-${index}`, label: `Probe ${index + 1}`, snapshot: { value: index + 1 } })),
      capture: () => ({ value }), apply: snapshot => { value = snapshot.value; }, randomize: () => ({ value: 100 }),
    });
  });
  await expect(page.locator('.mz-input-preset-row [data-instrument-id="placement-probe"]')).toHaveCount(1);
  await expect(strip).toHaveAttribute("data-input-placement", "preset");
  await expect(mic).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => __familyInput.requests)).toBe(1);
  await mic.click();
  await expect.poll(() => page.evaluate(() => __familyInput.tracks.every(track => track.readyState === "ended"))).toBe(true);
});
