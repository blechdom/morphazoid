import { expect, test } from "@playwright/test";

async function fixture(page) {
  await page.goto("/index.html");
  await page.evaluate(async () => {
    const { mountAudioInputControl } = await import("/src/audio-input-control.js");
    const container = document.createElement("div");
    container.style.cssText = "position:fixed;left:8px;top:100px;width:280px;background:#10151b;z-index:9999;padding:8px";
    document.body.append(container);
    const button = document.createElement("button");
    button.textContent = "Old long microphone label";
    container.append(button);
    const context = new AudioContext();
    const source = context.createConstantSource();
    source.offset.value = 0.25;
    const right = context.createGain(); right.gain.value = -0.5;
    const merger = context.createChannelMerger(2);
    source.connect(merger, 0, 0); source.connect(right).connect(merger, 0, 1);
    const gain = context.createGain(); merger.connect(gain); source.start();
    const owner = window.__inputFixture = { context, gain, active: false, starts: 0, stops: 0, source: "mic" };
    owner.control = mountAudioInputControl({
      container, button, before: button, placement: false,
      sources: [{ value: "mic", label: "Mic" }, { value: "file", label: "File" }],
      onSourceChange: value => { owner.source = value; owner.active = false; },
      getState: () => ({ active: owner.active, source: owner.source }),
      getSignal: () => ({ node: gain, channels: 2 }),
      onGainInput: value => { gain.gain.value = value; },
      onStart: async () => {
        owner.starts++;
        if (owner.failNext) { owner.failNext = false; throw new Error("Input device is unavailable"); }
        await context.resume(); owner.active = true;
      },
      onStop: () => { owner.stops++; owner.active = false; },
    });
  });
}

test("adopted button retains its position and native keyboard gain drives independent stereo meters", async ({ page }) => {
  await fixture(page);
  const row = page.locator(".mz-audio-input-strip");
  await expect(row.locator("button.mz-input-toggle svg")).toHaveCount(1);
  await row.locator(".mz-input-toggle").click();
  await expect(row.locator(".mz-input-toggle")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => row.locator("meter").evaluateAll(nodes => nodes.map(node => node.value))).toEqual([0.25, 0.125]);
  const gain = row.locator('input[type="range"]');
  await gain.focus(); await gain.press("ArrowUp");
  await expect(gain).toHaveValue("1.01");
  expect(await page.evaluate(() => __inputFixture.gain.gain.value)).toBeCloseTo(1.01);
  await gain.evaluate(input => { input.value = "0"; input.dispatchEvent(new Event("input", { bubbles: true })); });
  await expect.poll(() => row.locator("meter").evaluateAll(nodes => nodes.map(node => node.value))).toEqual([0, 0]);
  await row.locator(".mz-input-toggle").click();
  await expect(row.locator(".mz-input-toggle")).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate(() => __inputFixture.stops)).toBe(1);
  await row.locator("select").selectOption("file");
  await expect(row.locator(".mz-input-toggle")).toHaveAccessibleName("Activate file input");
  expect(await page.evaluate(() => __inputFixture.starts)).toBe(1);
});

test("shared input stays compact at desktop, phone and short landscape widths", async ({ page }) => {
  await fixture(page);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    const geometry = await page.locator(".mz-audio-input-strip").evaluate(row => {
      const box = row.getBoundingClientRect();
      return { height: box.height, overflow: row.scrollWidth > row.clientWidth + 1, button: row.button.getBoundingClientRect().width, knob: row.gainInput.closest(".mz-range-knob").getBoundingClientRect().width };
    });
    expect(geometry.height).toBeLessThan(70);
    expect(geometry.overflow).toBe(false);
    expect(geometry.button).toBeGreaterThanOrEqual(44);
    expect(geometry.knob).toBeGreaterThanOrEqual(32);
  }
});

test("repeated mic activation keeps managed gain nodes bounded and reconnectable", async ({ page }) => {
  await page.goto("/index.html");
  await page.evaluate(async () => {
    const { mountAudioInputControl } = await import("/src/audio-input-control.js");
    const container = document.createElement("div");
    document.body.append(container);
    const context = new AudioContext();
    await context.resume();
    const source = context.createConstantSource();
    source.offset.value = 0.25;
    source.start();
    const owner = window.__managedInput = { context, source, active: false, gains: [] };
    owner.control = mountAudioInputControl({
      container, placement: false,
      getState: () => ({ active: owner.active }),
      getSignal: () => ({ node: owner.gain }),
      onStart: () => {
        owner.gain = owner.control.createGain(context);
        owner.gains.push(owner.gain);
        source.connect(owner.gain);
        owner.active = true;
      },
      onStop: () => {
        if (owner.active) { source.disconnect(owner.gain); owner.gain.disconnect(); }
        owner.active = false;
      },
    });
    for (let cycle = 0; cycle < 24; cycle++) {
      owner.control.button.click();
      await Promise.resolve();
      owner.control.button.click();
      await Promise.resolve();
    }
    owner.control.button.click();
    await Promise.resolve();
    owner.control.refresh();
  });
  expect(await page.evaluate(() => new Set(__managedInput.gains).size)).toBe(1);
  const strip = page.locator(".mz-audio-input-strip");
  await expect.poll(() => strip.locator("meter").first().evaluate(meter => meter.value)).toBe(0.25);
  await strip.locator('input[type="range"]').evaluate(input => {
    input.value = "0";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect.poll(() => strip.locator("meter").first().evaluate(meter => meter.value)).toBeLessThan(0.001);
  await strip.locator(".mz-input-toggle").click();
  // Preset restoration can update the native value while the mic is off.
  await strip.locator('input[type="range"]').evaluate(input => { input.value = "0.5"; });
  await strip.locator(".mz-input-toggle").click();
  await expect.poll(() => strip.locator("meter").first().evaluate(meter => meter.value)).toBe(0.125);
  expect(await page.evaluate(() => __managedInput.gain.gain.value)).toBe(0.5);
  await page.evaluate(() => { __managedInput.control.destroy(); return __managedInput.context.close(); });
});

for (const fallback of [false, true]) {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    test.describe(`${fallback ? "fixed fallback" : "native popover"} ${viewport.width}×${viewport.height}`, () => {
      test.use({ viewport, hasTouch: viewport.width !== 1440 });
      test("input errors never shift controls and can dismiss, repeat and retry", async ({ page }) => {
        if (fallback) await page.addInitScript(() => {
          HTMLElement.prototype.showPopover = undefined;
          HTMLElement.prototype.hidePopover = undefined;
        });
        await fixture(page);
        const strip = page.locator(".mz-audio-input-strip");
        const mic = strip.locator(".mz-input-toggle");
        await strip.evaluate(root => { root.parentElement.style.cssText += ";contain:paint;overflow:hidden;transform:translateZ(0)"; });
        const geometry = () => strip.evaluate(root => [root, root.gainField, root.meter, root.button].map(node => {
          const { x, y, width, height } = node.getBoundingClientRect();
          return { x, y, width, height };
        }));
        const before = await geometry();
        await page.evaluate(() => { __inputFixture.failNext = true; });
        await mic.click();
        const popup = page.locator(".mz-input-error");
        await expect(popup).toBeVisible();
        await expect(popup.getByRole("alert")).toHaveText("Input unavailable");
        expect(await geometry()).toEqual(before);
        expect(await popup.evaluate(node => node.parentElement === document.body && getComputedStyle(node).position === "fixed")).toBe(true);
        const bounds = await popup.boundingBox();
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.y).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
        await popup.getByRole("button", { name: "Dismiss input error" }).click();
        await expect(popup).toBeHidden();
        await page.waitForTimeout(150);
        await expect(popup).toBeHidden();
        await page.evaluate(() => { __inputFixture.failNext = true; });
        await mic.click();
        await expect(popup).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(popup).toBeHidden();
        await page.evaluate(() => { __inputFixture.failNext = true; });
        await mic.click();
        await expect(popup).toBeVisible();
        await page.locator("body").click({ position: { x: 2, y: 2 } });
        await expect(popup).toBeHidden();
        await page.evaluate(() => { __inputFixture.failNext = true; });
        await mic.click();
        await expect(popup).toBeVisible();
        await popup.getByRole("button", { name: "Retry audio input" }).click();
        await expect(mic).toHaveAttribute("aria-pressed", "true");
        await expect(popup).toBeHidden();
        expect(await geometry()).toEqual(before);
        expect(await page.evaluate(() => __inputFixture.starts)).toBe(5);
        await page.evaluate(() => { __inputFixture.control.destroy(); return __inputFixture.context.close(); });
        await expect(popup).toHaveCount(0);
      });
    });
  }
}
