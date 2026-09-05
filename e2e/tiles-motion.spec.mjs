import { expect, test } from "@playwright/test";

async function openTiles(page) {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const response = await page.goto("/tiles.html", { waitUntil: "domcontentloaded" });
  expect(response?.ok(), `tiles.html returned HTTP ${response?.status()}`).toBe(true);
  await expect(page.locator("#stage")).toBeVisible();
  await page.waitForTimeout(120);
  return pageErrors;
}

async function setRange(page, selector, value) {
  await page.locator(selector).evaluate((input, nextValue) => {
    input.value = String(nextValue);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

async function latticeSnapshot(page) {
  return page.locator("#stage").evaluate((canvas) => {
    const context = canvas.getContext("2d");
    const { width, height } = canvas;
    const pixels = context.getImageData(0, 0, width, height).data;
    const scores = new Array(width).fill(0);

    for (let x = 0; x < width; x += 1) {
      for (let y = Math.floor(height * 0.08); y < Math.ceil(height * 0.92); y += 1) {
        const offset = (y * width + x) * 4;
        const minimum = Math.min(pixels[offset], pixels[offset + 1], pixels[offset + 2]);
        if (minimum > 150 && pixels[offset + 3] > 150) scores[x] += 1;
      }
    }

    const lineX = scores.reduce((best, score, x) => score > scores[best] ? x : best, 0);
    let checksum = 0;
    for (let index = 0; index < pixels.length; index += 97) {
      checksum = (checksum * 33 + pixels[index]) >>> 0;
    }
    return { width, lineX, lineScore: scores[lineX], checksum };
  });
}

test("Tiles keeps the lattice moving behind one fixed reader line", async ({ page }) => {
  const pageErrors = await openTiles(page);

  await setRange(page, "#position", 0.15);
  await page.waitForTimeout(80);
  const early = await latticeSnapshot(page);
  await setRange(page, "#position", 0.85);
  await page.waitForTimeout(80);
  const late = await latticeSnapshot(page);

  expect(Math.abs(early.lineX - early.width / 2)).toBeLessThanOrEqual(1);
  expect(Math.abs(late.lineX - late.width / 2)).toBeLessThanOrEqual(1);
  expect(early.lineScore).toBeGreaterThan(early.width * 0.5);
  expect(late.lineScore).toBeGreaterThan(late.width * 0.5);
  expect(late.checksum).not.toBe(early.checksum);
  expect(pageErrors).toEqual([]);
});
test("Tiles preserves the active ping-pong leg through latches and scrubbing", async ({ page }) => {
  const pageErrors = await openTiles(page);
  const position = page.locator("#position");
  const loop = page.locator("#loopMotion");
  const pingPong = page.locator("#pingPongMotion");
  const direction = page.locator("#traversalDirection");
  const play = page.locator("#playButton");

  await setRange(page, "#speed", 1);
  await setRange(page, "#position", 0.95);
  await pingPong.click();
  await play.click();

  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await expect(loop).toHaveAttribute("aria-pressed", "false");
  await expect(pingPong).toHaveAttribute("aria-pressed", "true");
  await expect(direction).not.toHaveAttribute("aria-pressed", /.+/);
  await expect.poll(async () => Number(await position.inputValue())).toBeLessThan(0.86);

  const beforeSameModeClick = Number(await position.inputValue());
  await pingPong.click();
  await page.waitForTimeout(80);
  expect(Number(await position.inputValue())).toBeLessThan(beforeSameModeClick);

  await setRange(page, "#position", 0.72);
  await page.waitForTimeout(80);
  expect(Number(await position.inputValue())).toBeLessThan(0.72);

  await loop.click();
  await pingPong.click();
  const beforeRoundTrip = Number(await position.inputValue());
  await page.waitForTimeout(80);
  expect(Number(await position.inputValue())).toBeLessThan(beforeRoundTrip);

  await direction.click();
  const beforeDirectionChange = Number(await position.inputValue());
  await page.waitForTimeout(80);
  expect(Number(await position.inputValue())).toBeGreaterThan(beforeDirectionChange);
  await expect(loop).toHaveAttribute("aria-pressed", "false");
  await expect(pingPong).toHaveAttribute("aria-pressed", "true");

  await play.click();
  await expect(play).toHaveAttribute("aria-pressed", "false");
  expect(pageErrors).toEqual([]);
});
