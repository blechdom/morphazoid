import { expect, test } from "@playwright/test";
import { settlePage } from "./helpers/diagnostics.mjs";

const palette = locator => locator.evaluate(node => {
  const style = getComputedStyle(node);
  return Object.fromEntries([
    "backgroundColor", "backgroundImage", "color", "borderRadius", "boxShadow",
  ].map(key => [key, style[key]]));
});

for (const id of ["hiccup-head", "creaturazoid", "shape-synth"]) {
  test(`${id}: preset menu matches Choose in default, hover and selected states`, async ({ page }) => {
    await page.goto(`${id}.html`);
    await settlePage(page);
    await expect(page.locator(".header-preset-controls")).toBeVisible();
    // Keep the pointer away from both controls when measuring their defaults.
    await page.mouse.move(0, 899);
    const choose = page.locator(".tabs .instrument-picker");
    const presets = page.locator(".header-preset-picker");
    expect(await palette(presets.locator(":scope > summary")))
      .toEqual(await palette(choose.locator(":scope > summary")));
    expect(await palette(page.locator(".header-preset-next")))
      .toEqual(await palette(page.locator(".tabs .instrument-picker-next")));
    expect(await palette(page.locator(".header-preset-random")))
      .toEqual(await palette(page.locator(".tabs .instrument-picker-next")));
    expect(await palette(presets.locator(".instrument-picker-panel")))
      .toEqual(await palette(choose.locator(".instrument-picker-panel")));

    await choose.locator(":scope > summary").click();
    const chooseDefault = choose.locator('.instrument-picker-link:not([aria-current="page"]):visible').first();
    const chooseSelected = choose.locator('.instrument-picker-link[aria-current="page"]:visible').first();
    const defaultPalette = await palette(chooseDefault);
    const selectedPalette = await palette(chooseSelected);
    await chooseDefault.hover();
    const hoverPalette = await palette(chooseDefault);
    await choose.locator(":scope > summary").click();

    await presets.locator(":scope > summary").click();
    const presetDefault = presets.locator('button[data-full-preset][aria-pressed="false"]').first();
    expect(await palette(presetDefault)).toEqual(defaultPalette);
    await presetDefault.hover();
    expect(await palette(presetDefault)).toEqual(hoverPalette);
    await presetDefault.click();
    await presets.locator(":scope > summary").click();
    await page.mouse.move(0, 899);
    expect(await palette(presets.locator('button[data-full-preset][aria-pressed="true"]')))
      .toEqual(selectedPalette);
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  });
}
