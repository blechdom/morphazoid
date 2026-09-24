import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { KARPLUS_STRONG_FULL_PRESETS } from "../src/instruments/karplus-strong/full-presets.js";
import { installFakeMidi, enableFakeMidi, sendMidi, MIDI_BYTES } from "./helpers/fake-midi.mjs";
import { settlePage, watchPageDiagnostics, pageDiagnosticMessages } from "./helpers/diagnostics.mjs";

const rollout = JSON.parse(await readFile(new URL("../docs/preset-rollout-status.json", import.meta.url)));
const presetPages = rollout.entries.filter(entry => entry.status.startsWith("implemented-"));
for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test.describe(`${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport, hasTouch: viewport.width < 900 });
    for (const entry of presetPages) test(`${entry.id}: header order and first-row presets remain reachable`, async ({ page, baseURL }) => {
      const diagnostics = watchPageDiagnostics(page, { baseURL });
      await page.goto(entry.href); await settlePage(page);
      const layout = await page.evaluate(() => {
        const header = document.querySelector(".masthead"), host = document.querySelector("[data-instrument-preset-host]");
        const presets = document.querySelector(".header-preset-controls"), io = header.querySelector(".header-io-controls");
        const nodes = [header.querySelector(".wordmark"), header.querySelector(".instrument-picker-trigger"), header.querySelector(".instrument-picker-next"),
          io.querySelector(".header-output-meter-shell"), io.querySelector(".mz-range-knob"), io.querySelector(".audio-button"), io.querySelector(".header-settings-trigger")];
        return { first: host.firstElementChild === presets, inHeader: header.contains(presets),
          ioOrder: [...io.children].map(node => node.classList.contains("header-output-meter-shell") ? "meters" : node.classList.contains("audio-strip") ? "audio" : node.classList.contains("header-settings-menu") ? "settings" : node.className),
          boxes: nodes.map(node => node.getBoundingClientRect().toJSON()),
          width: document.documentElement.scrollWidth, audio: io.querySelector(".audio-button").getAttribute("aria-pressed"),
          nativeRange: io.querySelector(".mz-range-knob input").type,
        };
      });
      expect(layout.first).toBe(true); expect(layout.inHeader).toBe(false);
      expect(layout.ioOrder).toEqual(["meters", "audio", "settings"]);
      expect(layout.nativeRange).toBe("range"); expect(layout.audio).toBe("false");
      expect(layout.width).toBeLessThanOrEqual(viewport.width + 1);
      for (const box of layout.boxes) { expect(box.x).toBeGreaterThanOrEqual(0); expect(box.right).toBeLessThanOrEqual(viewport.width + 1); expect(box.width).toBeGreaterThan(0); }
      for (let i = 1; i < layout.boxes.length; i++) {
        const prev = layout.boxes[i - 1], box = layout.boxes[i];
        expect(box.y >= prev.bottom - 1 || box.x >= prev.right - 1).toBe(true);
      }
      if (viewport.width < 900) for (const index of [4, 5, 6]) {
        expect(layout.boxes[index].width).toBeGreaterThanOrEqual(48); expect(layout.boxes[index].height).toBeGreaterThanOrEqual(48);
      }
      await expect(page.locator(".header-settings-panel .midi-toggle")).toHaveCount(1);
      await expect(page.locator(".midi-toggle")).not.toBeVisible();
      await page.locator(".header-preset-picker > summary").scrollIntoViewIfNeeded();
      await page.locator(".header-preset-picker > summary").click();
      const popup = await page.locator("#header-preset-panel").boundingBox();
      expect(popup.x).toBeGreaterThanOrEqual(0); expect(popup.x + popup.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(popup.height).toBeGreaterThan(80); expect(popup.y + popup.height).toBeLessThanOrEqual(viewport.height + 1);
      await page.getByRole("searchbox", { name: "Filter presets" }).fill("no-such-preset-987");
      await expect(page.locator(".header-preset-picker .instrument-picker-empty")).toBeVisible();
      await page.keyboard.press("Escape"); // Clear search, then close while retaining keyboard focus.
      await page.keyboard.press("Escape");
      await expect(page.locator(".header-preset-picker")).not.toHaveAttribute("open", "");
      await expect(page.locator(".header-preset-picker > summary")).toBeFocused();
      expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
    });
  });
}

for (const route of ["shapes.html", "rubix.html", "karplus-strong.html"]) test(`${route}: knob drag, keyboard, cancellation and presets preserve the original level owner`, async ({ page }) => {
  await page.goto(route); await settlePage(page);
  const input = page.locator(".header-io-controls .mz-range-knob input");
  await input.evaluate(node => {
    globalThis.__levelEvents = [];
    node.addEventListener("input", () => __levelEvents.push(node.value));
    node.addEventListener("pointerdown", event => { globalThis.__levelPointerId = event.pointerId; });
  });
  const original = await input.inputValue(), box = await input.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  expect(await input.inputValue()).toBe(original);
  await page.mouse.move(box.x + box.width / 2, box.y - 20, { steps: 4 }); await page.mouse.up();
  expect(Number(await input.inputValue())).toBeGreaterThan(Number(original));
  expect(await page.evaluate(() => __levelEvents.length)).toBeGreaterThan(0);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 10);
  const cancelledLevel = await input.inputValue();
  await input.evaluate(node => node.dispatchEvent(new PointerEvent("pointercancel", { pointerId: globalThis.__levelPointerId })));
  await page.mouse.move(box.x + box.width / 2, box.y - 40); await page.mouse.up();
  expect(await input.inputValue()).toBe(cancelledLevel);
  await input.press("Home"); expect(Number(await input.inputValue())).toBe(Number(await input.getAttribute("min")));
  await input.press("End"); expect(Number(await input.inputValue())).toBe(Number(await input.getAttribute("max")));
  await input.press("ArrowLeft"); const level = await input.inputValue();
  await input.press("Tab"); await expect(page.locator("#audioButton")).toBeFocused();
  await page.locator(".header-preset-next").click();
  // Karplus has always recalled its material's output level; retain that
  // instrument-owned policy rather than impose a new one in the shared knob.
  const recalledLevel = route === "karplus-strong.html"
    ? String(KARPLUS_STRONG_FULL_PRESETS[0].snapshot.settings.level) : level;
  await expect(input).toHaveValue(recalledLevel);
  const dialAngle = await input.evaluate(node => -135 + 270 * (Number(node.value) - Number(node.min)) / (Number(node.max) - Number(node.min)));
  await expect.poll(() => page.locator(".mz-range-knob__dial i").evaluate(node => Number(node.getAttribute("style").match(/rotate\(([-\d.]+)deg\)/)[1]))).toBeCloseTo(dialAngle, 8);
  await page.locator(".header-preset-random").click(); await expect(input).toHaveValue(recalledLevel);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
});

test("Settings owns the same MIDI connection and CC volume still updates the knob", async ({ page }) => {
  await installFakeMidi(page); await page.goto("graph-synth.html"); await settlePage(page);
  await expect(page.locator(".midi-toggle")).not.toBeVisible();
  const before = await page.evaluate(() => __morphazoidFakeMidi.snapshot()); expect(before.requests).toEqual([]);
  await enableFakeMidi(page);
  await expect(page.locator(".header-settings-panel .midi-toggle")).toHaveAttribute("aria-pressed", "true");
  await sendMidi(page, MIDI_BYTES.controlChange(7, 127));
  await expect(page.locator("#output")).toHaveValue("0.9");
  await expect(page.locator(".mz-range-knob__dial i")).toHaveAttribute("style", "transform: rotate(135deg)");
  await page.locator("#sharedMidiToggle").click();
  await expect(page.locator("#sharedMidiToggle")).toHaveAttribute("aria-pressed", "false");
});
