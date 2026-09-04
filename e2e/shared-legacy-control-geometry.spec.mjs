import { expect, test } from "@playwright/test";

import { settlePage } from "./helpers/diagnostics.mjs";

const route = "/spiral.html";

async function loadProductionPage(page) {
  const response = await page.goto(route, { waitUntil: "domcontentloaded" });
  expect(response?.ok(), `${route} returned HTTP ${response?.status()}`).toBe(true);
  await expect(page.locator('link[rel="stylesheet"][href="style.css"]')).toHaveCount(1);
  await settlePage(page);
}

async function controlMetrics(page) {
  return page.evaluate(() => {
    const measure = (selector) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) throw new Error(`Missing control: ${selector}`);
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        backgroundColor: style.backgroundColor,
        height: rect.height,
        minHeight: style.minHeight,
        minWidth: style.minWidth,
        width: rect.width,
      };
    };

    return {
      audio: measure("#audioButton"),
      choice: measure("#timePath button"),
      miniAction: measure("#sizeCoupling"),
      play: measure("#playButton"),
    };
  });
}

test("shared legacy controls retain their desktop production geometry", async ({ page }) => {
  await loadProductionPage(page);
  const metrics = await controlMetrics(page);

  expect(metrics.audio.width).toBe(44);
  expect(metrics.audio.height).toBe(44);
  expect(metrics.audio.backgroundColor).not.toMatch(/^(?:transparent|rgba\(0, 0, 0, 0\))$/u);

  expect(metrics.miniAction.minHeight).toBe("32px");
  expect(metrics.miniAction.height).toBe(32);
  expect(metrics.miniAction.minWidth).not.toBe("44px");
  expect(metrics.miniAction.width).toBeGreaterThan(44);

  expect(metrics.play.width).toBe(44);
  expect(metrics.play.height).toBe(44);

  expect(metrics.choice.minHeight).toBe("40px");
  expect(metrics.choice.height).toBe(40);
});

test("primary button hover keeps dark text on the bright accent surface", async ({ page }) => {
  await loadProductionPage(page);
  await page.evaluate(() => {
    const button = document.createElement("button");
    button.id = "sharedPrimaryButton";
    button.className = "mz-button mz-button--primary";
    button.type = "button";
    button.textContent = "Apply mapping";
    document.body.append(button);
  });

  const button = page.locator("#sharedPrimaryButton");
  await button.hover();
  const colors = await button.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      text: style.color,
    };
  });

  expect(colors.text).toBe("rgb(5, 6, 8)");
  expect(colors.background).not.toBe(colors.text);
});

test("legacy filled primary actions keep dark text on hover", async ({ page }) => {
  const cases = [
    ["/fm-drums.html", "#saveBank"],
    ["/sample-drums.html", "#preloadSamples"],
    ["/chaotic-fm.html", ".plugin-download-callout-primary"],
  ];

  for (const [route, selector] of cases) {
    const response = await page.goto(route, { waitUntil: "domcontentloaded" });
    expect(response?.ok(), `${route} returned HTTP ${response?.status()}`).toBe(true);
    const button = page.locator(selector);
    await expect(button).toBeVisible();
    await button.hover();
    await expect(button).toHaveCSS("color", "rgb(5, 6, 8)");
  }
});

test("customizable selects center their value and use the component highlight", async ({ page }) => {
  await loadProductionPage(page);
  const supportsCustomPicker = await page.evaluate(() => CSS.supports("appearance", "base-select"));
  test.skip(!supportsCustomPicker, "Browser retains its native platform picker");

  await expect(page.locator("#tilingType")).toHaveCSS("align-items", "center");

  await page.evaluate(() => {
    const field = document.createElement("label");
    field.className = "mz-select-field";
    const select = document.createElement("select");
    select.id = "sharedSelectHighlight";
    select.className = "mz-select-field__select";
    select.innerHTML = `
      <option value="sine" selected>Sine oscillators</option>
      <option value="fm">FM synthesis</option>
    `;
    field.append(select);
    document.body.append(field);
  });

  const select = page.locator("#sharedSelectHighlight");
  await expect(select).toHaveCSS("align-items", "center");
  await select.click();
  const selectedColors = await select.locator("option:checked").evaluate((option) => {
    const style = getComputedStyle(option);
    const probe = document.createElement("span");
    probe.style.color = "var(--mz-active-accent)";
    option.closest(".mz-select-field").append(probe);
    const accent = getComputedStyle(probe).color;
    probe.remove();
    return {
      accent,
      background: style.backgroundColor,
      text: style.color,
    };
  });

  expect(selectedColors.background).toBe(selectedColors.accent);
  expect(selectedColors.text).toBe("rgb(5, 6, 8)");
  await select.press("Escape");
});

test.describe("coarse pointer", () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });

  test("audio and play controls retain 48px touch targets", async ({ page }) => {
    await loadProductionPage(page);
    await expect.poll(() => page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
    const metrics = await controlMetrics(page);

    expect(metrics.audio.width).toBe(48);
    expect(metrics.audio.height).toBe(48);
    expect(metrics.play.width).toBe(48);
    expect(metrics.play.height).toBe(48);
  });
});
