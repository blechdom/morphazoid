import { expect, test } from "@playwright/test";

test("Constellation keeps timeline, flow, and whole-work views synchronized", async ({ page }) => {
  const diagnostics = [];
  page.on("pageerror", (error) => diagnostics.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.push(message.text());
  });
  await page.goto("constellation.html", { waitUntil: "domcontentloaded" });

  await expect(page.locator(".constellation-clip")).toHaveCount(3);
  await expect(page.locator("#timelineView .constellation-section-chip")).toHaveCount(4);

  await page.getByRole("tab", { name: /Flow Graph/i }).click();
  await expect(page.locator(".constellation-flow-svg")).toBeVisible();
  await expect(page.locator(".constellation-flow-node.is-fork")).toHaveCount(1);
  await expect(page.locator(".constellation-flow-node.is-join")).toHaveCount(1);

  await page.getByRole("tab", { name: /^Constellation/i }).click();
  await expect(page.locator(".constellation-form-svg")).toBeVisible();
  await expect(page.locator(".constellation-section-node")).toHaveCount(4);

  await page.getByRole("tab", { name: /Projected Timeline/i }).click();
  await page.locator(".constellation-section-chip").nth(1).click();
  await expect(page.locator(".constellation-clip")).toHaveCount(4);
  await expect(page.locator("#sectionTitle")).toContainText("Causeway");

  await page.locator(".constellation-instrument-card").filter({ hasText: "Spiral" }).getByRole("button", { name: "Insert" }).click();
  await expect(page.locator(".constellation-clip")).toHaveCount(5);
  await expect(page.locator("#inspector")).toContainText("Spiral");

  await page.locator("#presetSelect").selectOption("small-world-suite");
  await expect(page.locator("#timelineView .constellation-section-chip")).toHaveCount(4);
  await expect(page.locator("#presetDescription")).toContainText("alternate section route");
  expect(diagnostics).toEqual([]);
});

test("Constellation remains operable in a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("constellation.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#timelineCanvas")).toBeVisible();
  await expect(page.locator(".constellation-clip").first()).toBeVisible();
  await expect(page.locator("#instrumentBrowser")).toBeVisible();
  await page.getByRole("tab", { name: /Flow Graph/i }).click();
  await expect(page.locator(".constellation-flow-svg")).toBeVisible();
});

test("Constellation audio and graph transport start from explicit gestures", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("constellation.html", { waitUntil: "domcontentloaded" });
  const initialPosition = await page.locator("#transportPosition").textContent();

  await page.locator("#audioButton").click();
  await expect(page.locator("#audioState")).toHaveText("on", { timeout: 10_000 });
  await page.locator("#playButton").click();
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(450);
  await expect(page.locator("#transportPosition")).not.toHaveText(initialPosition ?? "");

  await page.locator("#stopButton").click();
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
  expect(pageErrors).toEqual([]);
});
