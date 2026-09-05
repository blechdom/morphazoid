import { expect, test } from "@playwright/test";

async function openTiles(page) {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const response = await page.goto("/tiles.html", { waitUntil: "domcontentloaded" });
  expect(response?.ok(), `tiles.html returned HTTP ${response?.status()}`).toBe(true);
  await expect(page.locator("#stage")).toBeVisible();
  return pageErrors;
}

async function settlePaint(page) {
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
}

async function canvasDigest(locator) {
  return locator.evaluate((canvas) => {
    const { width, height } = canvas;
    const pixels = canvas.getContext("2d").getImageData(0, 0, width, height).data;
    let checksum = 0;
    let opaque = 0;
    for (let index = 0; index < pixels.length; index += 73) {
      checksum = (checksum * 33 + pixels[index]) >>> 0;
      if (pixels[index + 3] > 8) opaque += 1;
    }
    return { checksum, opaque, width, height };
  });
}

async function parameterValues(page) {
  return page.locator("#parameterControls input").evaluateAll(
    (inputs) => inputs.map((input) => Number(input.value)),
  );
}

test("Tiles presents all tile systems with generated lattice previews", async ({ page }) => {
  const pageErrors = await openTiles(page);
  const selector = page.locator("#tilingType");

  await expect(selector.locator("option")).toHaveCount(72);
  await expect(selector).toHaveValue("20");
  await expect(selector.locator('option[value="20"]')).toContainText("Pentagon · IH20");

  const richOptions = await page.evaluate(() => CSS.supports("appearance", "base-select"));
  if (richOptions) {
    await expect.poll(
      () => selector.locator("option .tiles-tiling-preview").count(),
      { timeout: 5_000 },
    ).toBe(72);
    await expect(selector.locator("option .tiles-tiling-preview[aria-hidden='true']")).toHaveCount(72);
    await expect(selector.locator("selectedcontent .tiles-tiling-preview")).toHaveCount(1);

    const previewPaths = await page.evaluate(() => [1, 20, 31].map((type) => (
      document.querySelector(
        `#tilingType option[value="${type}"] .tiles-tiling-preview-edges`,
      )?.getAttribute("d") ?? ""
    )));
    expect(previewPaths.every((path) => path.length > 20)).toBe(true);
    expect(new Set(previewPaths).size).toBe(3);
  }

  await selector.selectOption("1");
  await expect(selector).toHaveValue("1");
  await expect(page.locator("#parameterControls input")).toHaveCount(4);
  await expect(page.locator("#tileEditorCanvas")).toHaveAttribute("aria-disabled", "false");

  await selector.selectOption("31");
  await expect(page.locator("#parameterControls input")).toHaveCount(0);
  await expect(page.locator("#tileEditorCanvas")).toHaveAttribute("aria-disabled", "true");

  await selector.selectOption("20");
  await expect(page.locator("#parameterControls input")).toHaveCount(2);
  expect(pageErrors).toEqual([]);
});

test("Tiles X/Y editor changes guarded shape state without disturbing transport or mode state", async ({ page }) => {
  const pageErrors = await openTiles(page);
  const editor = page.locator("#tileEditorCanvas");
  const stage = page.locator("#stage");
  const play = page.locator("#playButton");
  const audio = page.locator("#audioButton");

  await expect(editor).toBeVisible();
  await settlePaint(page);
  const defaults = await parameterValues(page);
  const beforeStage = await canvasDigest(stage);
  const beforeEditor = await canvasDigest(editor);

  await editor.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowUp");
  await settlePaint(page);

  const edited = await parameterValues(page);
  const afterStage = await canvasDigest(stage);
  const afterEditor = await canvasDigest(editor);
  expect(edited.some((value, index) => Math.abs(value - defaults[index]) > 1e-6)).toBe(true);
  expect(afterStage.checksum).not.toBe(beforeStage.checksum);
  expect(afterEditor.checksum).not.toBe(beforeEditor.checksum);
  expect(afterEditor.opaque).toBeGreaterThan(10);

  await page.locator("#modeSpiral").click();
  await page.locator("#modeLatticeDrums").click();
  await page.locator("#modeLattice").click();
  expect(await parameterValues(page)).toEqual(edited);

  await play.click();
  await expect(play).toHaveAttribute("aria-pressed", "true");
  await editor.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(play).toHaveAttribute("aria-pressed", "true");
  await expect(audio).toHaveAttribute("aria-pressed", "false");
  await play.click();

  await page.locator("#resetTile").click();
  expect(await parameterValues(page)).toEqual(defaults);
  await expect(play).toHaveAttribute("aria-pressed", "false");
  expect(pageErrors).toEqual([]);
});

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone portrait", width: 390, height: 844 },
  { name: "phone landscape", width: 844, height: 390 },
]) {
  test(`Tiles form controls stay reachable at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const pageErrors = await openTiles(page);

    const initial = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      panelTop: document.querySelector(".tiles-panel")?.getBoundingClientRect().top ?? Infinity,
    }));
    expect(initial.documentWidth).toBeLessThanOrEqual(initial.viewportWidth + 1);
    if (viewport.name === "phone landscape") {
      expect(initial.panelTop).toBeLessThan(viewport.height);
    }

    const editor = page.locator("#tileEditorCanvas");
    await editor.scrollIntoViewIfNeeded();
    await expect(editor).toBeVisible();
    const editorBox = await editor.boundingBox();
    expect(editorBox).not.toBeNull();
    expect(editorBox.x).toBeGreaterThanOrEqual(0);
    expect(editorBox.x + editorBox.width).toBeLessThanOrEqual(viewport.width + 1);

    await page.locator("#tilingType").selectOption("81");
    await expect(page.locator("#tilingType")).toHaveValue("81");
    expect(pageErrors).toEqual([]);
  });
}
