import { expect, test } from "@playwright/test";

import {
  MIDI_BYTES,
  enableFakeMidi,
  installFakeMidi,
  sendMidi,
} from "./helpers/fake-midi.mjs";

test("Jaw Harp exposes every body reference and steps vowels only on sounding plucks", async ({ page }) => {
  await page.goto("jaw-harp.html", { waitUntil: "load" });

  await expect(page.locator("#harpSelect option")).toHaveCount(5);
  await expect(page.locator("#styleSelect option")).toHaveCount(17);
  await expect(page.locator("#styleSelect optgroup")).toHaveCount(5);

  const physicalBody = await page.locator("#harpSelect").inputValue();
  await page.getByRole("button", { name: "With plucks" }).click();
  await expect(page.locator("#mouthSummary")).toContainText("/ɑ/ · step 1/4 · pluck");

  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#pluckButton").click();
  await expect(page.locator("#mouthSummary")).toContainText("/ɑ/ · step 1/4 · pluck");
  await page.locator("#pluckButton").click();
  await expect(page.locator("#mouthSummary")).toContainText("/i/ · step 2/4 · pluck");
  await page.locator("#pluckButton").click();
  await expect(page.locator("#mouthSummary")).toContainText("/o/ · step 3/4 · pluck");
  await expect(page.locator("#harpSelect")).toHaveValue(physicalBody);

  await page.getByRole("button", { name: "Off", exact: true }).click();
  await expect(page.locator("#mouthSummary")).not.toContainText("step");
  await expect(page.locator("#harpSelect")).toHaveValue(physicalBody);
});

test("Jaw Harp MIDI notes use the native pitched strike path", async ({ page }) => {
  await installFakeMidi(page);
  await page.goto("jaw-harp.html", { waitUntil: "load" });
  await enableFakeMidi(page);

  await sendMidi(page, MIDI_BYTES.noteOn(45, 96));
  await expect(page.locator("#reedFrequencyHzOut")).toHaveText("110 Hz");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#motionReadout")).not.toHaveText("resting");

  await sendMidi(page, MIDI_BYTES.noteOff(45));
  await expect(page.locator("#reedFrequencyHzOut")).toHaveText("110 Hz");
  await sendMidi(page, MIDI_BYTES.noteOn(0, 64));
  await expect(page.locator("#reedFrequencyHzOut")).toHaveText("38 Hz");
});

test("Jaw Harp breath vowels follow real manual direction turns", async ({ page }) => {
  await page.goto("jaw-harp.html", { waitUntil: "load" });
  await page.locator("#breathCycleButton").click();
  await expect(page.locator("#breathCycleButton")).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "With breath" }).click();
  await expect(page.locator("#mouthSummary")).toContainText("/ɑ/ · step 1/4 · breath");

  await page.locator("#inhaleButton").click();
  await expect(page.locator("#mouthSummary")).toContainText("/ɑ/ · step 1/4 · breath");
  await page.locator("#exhaleButton").click();
  await expect(page.locator("#mouthSummary")).toContainText("/i/ · step 2/4 · breath");
  await page.locator("#inhaleButton").click();
  await expect(page.locator("#mouthSummary")).toContainText("/o/ · step 3/4 · breath");
});

test("Jaw Harp Randomize includes mouth geometry and an audible vowel phrase", async ({ page }) => {
  await page.goto("jaw-harp.html", { waitUntil: "load" });
  await page.evaluate(() => { Math.random = () => 0.5; });

  await page.locator("#randomizeButton").click();
  await expect(page.locator("#vowelSequenceSelect")).toHaveValue("a-o-e-a");
  await expect(page.getByRole("button", { name: "With plucks" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#tongueHeight")).toHaveValue("0.5");
  await expect(page.locator("#mouthSummary")).toContainText("/ɑ/ · step 1/4 · pluck");
});

test("Jaw Harp respects WAX MIDI-only routing", async ({ page }) => {
  await page.goto("jaw-harp.html", { waitUntil: "load" });
  const dispatchedWithoutClaim = await page.evaluate(() => {
    document.documentElement.dataset.morphazoidWaxOutputMode = "midi";
    return globalThis.dispatchEvent(new CustomEvent("morphazoid:midi-input", {
      cancelable: true,
      detail: {
        source: "wax",
        message: { type: "noteOn", note: 45, velocity: 96 },
      },
    }));
  });
  expect(dispatchedWithoutClaim).toBe(true);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#reedFrequencyHzOut")).toHaveText("76 Hz");
});
