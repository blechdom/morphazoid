import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readAudioStatus, sampleAudioEnvelope } from "./helpers/audio-probe.mjs";

const snapshot = (page) => page.evaluate(async () => (await import("/src/instruments/graphonic-calculator/app.js")).diagnosticSnapshot());
const ready = (page) => expect.poll(async () => (await snapshot(page)).ready, { timeout: 15000 }).toBe(true);
const setRange = (page, selector, value) => page.locator(selector).evaluate((input, next) => {
  input.value = String(next);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}, value);

async function open(page) {
  await page.addInitScript(() => { try { localStorage.removeItem("morphazoid.graphonic-calculator.v1"); } catch { /* unavailable */ } });
  await page.goto("graphonic-calculator.html");
  await ready(page);
}

test("expressions, sliders, errors and the silent trace sweep behave like a graphing calculator", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => { if (response.status() >= 400 && response.url().startsWith("http://127.0.0.1")) errors.push(`${response.status()} ${response.url()}`); });
  await open(page);
  const initial = await snapshot(page);
  expect(initial.rows.map((row) => row.kind)).toEqual(["explicit-y", "parameter", "explicit-y", "point"]);
  expect(initial.geometry.length).toBe(3);
  expect((await readAudioStatus(page)).active).toBe(false);

  await page.locator("#newExpression").fill("x^2 + y^2 = R^2");
  await page.locator("#addExpression").click();
  await expect(page.locator(".expression-row").last().locator(".expression-status")).toContainText("Undefined: R");
  await page.locator(".expression-row").last().locator("[data-add-sliders]").click();
  await expect.poll(async () => (await snapshot(page)).rows.at(-1).text).toBe("R = 1");
  expect((await snapshot(page)).rows.at(-1).slider).toEqual({ min: -10, max: 10, step: 0, animating: false, mode: "bounce", speed: 1 });
  expect((await snapshot(page)).rows.at(-2).kind).toBe("implicit");

  const sliderRow = page.locator(".expression-row").last();
  await sliderRow.locator(".slider-value").evaluate((input) => { input.value = "3"; input.dispatchEvent(new Event("input", { bubbles: true })); });
  await expect(sliderRow.locator(".expression-input")).toHaveValue("R = 3");
  await sliderRow.locator(".slider-play").click();
  await expect.poll(async () => (await snapshot(page)).rows.at(-1).text).not.toBe("R = 3");
  await expect(sliderRow.locator(".expression-slider-options")).toBeVisible();
  await sliderRow.locator(".slider-mode").selectOption("once");
  await sliderRow.locator(".slider-speed").selectOption("4");
  expect((await snapshot(page)).rows.at(-1).slider).toMatchObject({ mode: "once", speed: 4 });
  await expect.poll(async () => (await snapshot(page)).rows.at(-1).slider.animating, { timeout: 15000 }).toBe(false);
  expect((await snapshot(page)).rows.at(-1).text).toBe("R = 10");
  await expect(sliderRow.locator(".expression-slider-options")).toBeVisible();
  await sliderRow.locator(".slider-mode").selectOption("bounce");
  await sliderRow.locator(".slider-speed").selectOption("1");
  await expect(sliderRow.locator(".expression-slider-options")).toBeHidden();

  const parabola = page.locator(".expression-row").first().locator(".expression-input");
  await parabola.fill("y = x^2 +");
  await expect(page.locator(".expression-row").first().locator(".expression-status")).toContainText("ends too early");
  await parabola.fill("y = x^2 + 1");
  await expect(page.locator(".expression-row").first().locator(".expression-status")).not.toContainText("early");

  await page.locator("#playButton").click();
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
  const before = await snapshot(page);
  await expect.poll(async () => (await snapshot(page)).travel).not.toBe(before.travel);
  expect((await snapshot(page)).armed).toBe(false);
  await expect.poll(async () => (await snapshot(page)).reading.contacts).toBeGreaterThan(0);
  await page.locator("#playButton").click();
  const paused = await snapshot(page);
  await page.waitForTimeout(150);
  expect((await snapshot(page)).travel).toBe(paused.travel);

  await page.locator(".header-preset-next").click();
  await expect.poll(async () => (await snapshot(page)).rows.length).toBeGreaterThan(0);
  await page.locator(".header-preset-random").click();
  expect((await snapshot(page)).rows.filter((row) => row.error).length).toBe(0);
  await page.locator("#resetAll").click();
  expect((await snapshot(page)).rows.map((row) => row.text)).toEqual(["y = x^2", "a = 1", "y = 2a x - a^2", "(a, a^2)"]);
  expect((await snapshot(page)).armed).toBe(false);
  expect(errors).toEqual([]);
});

test("the view pans, zooms and reads coordinates; draggable points move their sliders", async ({ page }) => {
  await open(page);
  const start = (await snapshot(page)).view;
  const stage = page.locator("#stage");
  const box = await stage.boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5 + 80, box.y + box.height * 0.5 + 20, { steps: 5 });
  await page.mouse.up();
  const panned = (await snapshot(page)).view;
  expect(panned.xMin).toBeLessThan(start.xMin);
  expect(panned.yMin).toBeGreaterThan(start.yMin);
  await page.mouse.wheel(0, -400);
  const zoomed = (await snapshot(page)).view;
  expect(zoomed.xMax - zoomed.xMin).toBeLessThan(panned.xMax - panned.xMin);
  await page.locator("#homeView").click();
  const home = (await snapshot(page)).view;
  expect(home.xMin).toBe(-10);
  expect(home.xMax).toBe(10);
  await stage.focus();
  await stage.press("ArrowRight");
  expect((await snapshot(page)).view.xMin).toBeGreaterThan(home.xMin);
  await stage.press("+");
  expect((await snapshot(page)).view.xMax - (await snapshot(page)).view.xMin).toBeLessThan(20);
  await page.locator("#homeView").click();

  const pointBefore = (await snapshot(page)).rows.find((row) => row.text === "a = 1");
  expect(pointBefore).toBeTruthy();
  const camera = await page.evaluate(async () => {
    const { createCamera } = await import("/src/instruments/graphonic-calculator/camera.js");
    const { diagnosticSnapshot } = await import("/src/instruments/graphonic-calculator/app.js");
    const canvas = document.querySelector("#stage");
    const rect = canvas.getBoundingClientRect();
    const [px, py] = createCamera(diagnosticSnapshot().view, rect.width, rect.height).toPixel(1, 1);
    return { x: rect.left + px, y: rect.top + py };
  });
  await page.mouse.move(camera.x, camera.y);
  await expect(page.locator("#hoverReadout")).toContainText("(1, 1)");
  await page.mouse.down();
  await page.mouse.move(camera.x + 60, camera.y, { steps: 6 });
  await page.mouse.up();
  const moved = (await snapshot(page)).rows.find((row) => row.kind === "parameter");
  expect(moved.text).not.toBe("a = 1");
  expect(moved.value).toBeGreaterThan(1);
  await setRange(page, "#viewXMin", -3);
  expect((await snapshot(page)).view.xMin).toBe(-3);
  await page.locator("[data-section='view'] summary").click();
  await page.locator("#angleMode [data-angle='degrees']").click();
  expect((await snapshot(page)).settings.angle).toBe("degrees");
});

test("explicit Audio arms the trace voices, survives UI stalls, mutes with level and releases on dispose", async ({ page }, testInfo) => {
  test.setTimeout(60000);
  await open(page);
  // Trig family keeps every curve inside the view, so the sweep sounds from its first pixel.
  for (let step = 0; step < 3 && (await snapshot(page)).rows.map((row) => row.text).join(",") !== "sin(x),cos(x),tan(x)"; step++) await page.locator(".header-preset-next").click();
  expect((await snapshot(page)).rows.map((row) => row.text).join(",")).toBe("sin(x),cos(x),tan(x)");
  await page.locator("#audioButton").click();
  await expect.poll(async () => (await snapshot(page)).armed).toBe(true);
  const silent = await sampleAudioEnvelope(page, { durationMs: 250, intervalMs: 50 });
  expect(silent.summary.maxPeak).toBeLessThan(0.001);
  await page.locator("#playButton").click();
  await page.waitForTimeout(250);
  const sounding = await sampleAudioEnvelope(page, { durationMs: 600, intervalMs: 50 });
  await testInfo.attach("trace-audio.json", { body: JSON.stringify(sounding.summary, null, 2), contentType: "application/json" });
  expect(sounding.summary.finite).toBe(true);
  expect(sounding.summary.maxPeak).toBeGreaterThan(0.01);
  expect(sounding.summary.maxPeak).toBeLessThan(0.9);
  expect(sounding.summary.clippedSamples).toBe(0);
  const before = await snapshot(page);
  await page.evaluate(() => { const end = performance.now() + 400; while (performance.now() < end) { /* deliberate stall */ } });
  await page.waitForTimeout(80);
  const after = await snapshot(page);
  expect(after.audioTime - before.audioTime).toBeGreaterThan(0.35);
  expect(after.travel).not.toBe(before.travel);
  await setRange(page, "#level", 0);
  await page.waitForTimeout(400);
  expect((await sampleAudioEnvelope(page, { durationMs: 250, intervalMs: 50 })).summary.maxPeak).toBeLessThan(0.002);
  await setRange(page, "#level", 0.5);
  await page.locator("#playButton").click();
  await page.waitForTimeout(400);
  expect((await sampleAudioEnvelope(page, { durationMs: 250, intervalMs: 50 })).summary.maxPeak).toBeLessThan(0.002);
  await page.locator("#audioButton").click();
  await expect.poll(async () => (await snapshot(page)).armed).toBe(false);
  expect((await snapshot(page)).audioTime).toBeNull();
  await page.locator("#audioButton").click();
  await expect.poll(async () => (await snapshot(page)).armed).toBe(true);
  await page.locator("#playButton").click();
  await page.waitForTimeout(300);
  expect((await sampleAudioEnvelope(page, { durationMs: 400, intervalMs: 50 })).summary.maxPeak).toBeGreaterThan(0.01);
  await page.evaluate(async () => (await import("/src/instruments/graphonic-calculator/app.js")).dispose());
  expect((await snapshot(page)).disposed).toBe(true);
  expect((await snapshot(page)).audioTime).toBeNull();
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`reachable controls and accessible graph at ${viewport.width}×${viewport.height}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport, isMobile: viewport.width < 1000, hasTouch: viewport.width < 1000 });
    const page = await context.newPage();
    await open(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(2);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    const stage = await page.locator("#stage").boundingBox();
    expect(stage.width).toBeGreaterThan(200);
    expect(stage.height).toBeGreaterThan(150);
    for (const selector of ["#audioButton", "#playButton", "#newExpression", "#resetAll", ".expression-row .expression-input"]) {
      const locator = page.locator(selector).first();
      await locator.scrollIntoViewIfNeeded();
      await expect(locator).toBeVisible();
      const box = await locator.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(-1);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
      if (viewport.width < 1000 && ["#audioButton", "#playButton"].includes(selector)) { expect(box.width).toBeGreaterThanOrEqual(48); expect(box.height).toBeGreaterThanOrEqual(48); }
    }
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(axe.violations.filter((violation) => ["critical", "serious"].includes(violation.impact))).toEqual([]);
    await context.close();
  });
}

test("Points, Line and Radar readers share Shape's transport: heads, spacing, per-head options, motion, direction, voice", async ({ page }) => {
  await open(page);
  for (let step = 0; step < 4 && (await snapshot(page)).rows.map((row) => row.text)[1] !== "x^2 + y^2 = R^2"; step++) await page.locator(".header-preset-next").click();
  expect((await snapshot(page)).settings).toMatchObject({ playback: "radar", pitchSource: "radius" });
  await expect(page.locator("#crossHeadAxes")).toBeHidden();
  await expect(page.locator("#positionLabel")).toHaveText("Ray angle");
  await page.locator("#playButton").click();
  await expect.poll(async () => (await snapshot(page)).reading.contacts).toBeGreaterThan(0);
  expect((await snapshot(page)).reading.heads[0].kind).toBe("ray");
  await page.locator("#addHead").click();
  await page.locator("#addHead").click();
  expect((await snapshot(page)).settings.heads).toBe(3);
  await expect(page.locator("#headCountOut")).toHaveText("3");
  await expect(page.locator("#headLayoutTrack .head-marker")).toHaveCount(3);
  await expect(page.locator("#headLayoutTrack .head-option-toggle")).toHaveCount(3);
  expect((await snapshot(page)).settings.headOffsets).toEqual([0, 0.333333, 0.666667]);
  expect((await snapshot(page)).reading.heads.map((head) => head.index)).toEqual([0, 1, 2]);
  await page.locator("#headOption1").click();
  expect((await snapshot(page)).settings.headDirections.slice(0, 3)).toEqual([1, -1, 1]);
  await page.locator("#headMarker2").focus();
  await page.keyboard.press("Shift+ArrowLeft");
  expect((await snapshot(page)).settings.headOffsets[2]).toBeCloseTo(0.616667, 5);
  await page.locator("#resetHeadSpacing").click();
  expect((await snapshot(page)).settings.headOffsets).toEqual([0, 0.333333, 0.666667]);
  await page.locator("#playbackMode [data-playback='line']").click();
  await expect(page.locator("#crossHeadAxes")).toBeVisible();
  await page.locator("#crossHeadAxes").click();
  expect((await snapshot(page)).reading.heads.map((head) => head.axis)).toEqual(["vertical", "horizontal", "vertical"]);
  await page.locator("#headOption0").click();
  expect((await snapshot(page)).reading.heads.map((head) => head.axis)).toEqual(["horizontal", "horizontal", "vertical"]);
  await expect.poll(async () => (await snapshot(page)).reading.contacts).toBeGreaterThan(0);
  const forward = await snapshot(page);
  await page.waitForTimeout(120);
  expect((await snapshot(page)).travel).toBeGreaterThan(forward.travel);
  await page.locator("#directionToggle").click();
  await expect(page.locator("#directionToggle")).toHaveAttribute("aria-pressed", "true");
  const reversed = await snapshot(page);
  await page.waitForTimeout(120);
  expect((await snapshot(page)).travel).toBeLessThan(reversed.travel);
  await page.locator("#playButton").click();
  await setRange(page, "#position", 0.25);
  expect((await snapshot(page)).reading.heads[0].phase).toBeCloseTo(0.25, 3);
  await expect(page.locator("#positionOut")).toHaveText("25.0%");
  await page.locator("#playheadMotion [data-motion='pingpong']").click();
  expect((await snapshot(page)).settings.motion).toBe("pingpong");
  await setRange(page, "#position", 0.6);
  expect((await snapshot(page)).reading.heads[0].phase).toBeCloseTo(0.6, 3);
  await page.locator("#playbackMode [data-playback='points']").click();
  await expect.poll(async () => (await snapshot(page)).reading.heads[0].kind).toBe("points");
  await expect.poll(async () => (await snapshot(page)).reading.contacts).toBeGreaterThan(0);
  await page.locator("#pitchSource").selectOption("width");
  await page.locator("#voice").selectOption("saw");
  await setRange(page, "#timbre", 0.8);
  await setRange(page, "#glide", 0.1);
  expect((await snapshot(page)).settings).toMatchObject({ pitchSource: "width", voice: "saw", timbre: 0.8, glide: 0.1 });
  expect((await snapshot(page)).timbre).toMatchObject({ voice: "saw", timbre: 0.8, glide: 0.1 });
  await expect(page.locator("#playbackSummary")).toHaveText("Points · 3 heads");
  await expect(page.locator("#soundSummary")).toHaveText("Saw · width");
  await page.locator("#resetAll").click();
  expect((await snapshot(page)).settings).toMatchObject({ playback: "line", heads: 1, direction: 1, motion: "loop", voice: "sine" });
  expect((await snapshot(page)).travel).toBe(0);
});

test("point playheads ride every branch of a multi-branch curve", async ({ page }) => {
  await open(page);
  await page.locator("#newExpression").fill("y = 1/x");
  await page.locator("#addExpression").click();
  await page.locator("#playbackMode [data-playback='points']").click();
  await page.locator("#addHead").click();
  await expect.poll(async () => (await snapshot(page)).reading.contacts).toBeGreaterThan(0);
  const reading = (await snapshot(page)).reading;
  const hyperbola = (await snapshot(page)).rows.find((row) => row.text === "y = 1/x").id;
  const branches = new Set(reading.sample.filter((contact) => contact.id === hyperbola).map((contact) => contact.branch));
  expect(branches.size).toBe(2);
  expect(reading.sample.filter((contact) => contact.id === hyperbola).length).toBe(4);
});

test("the play region box loops lines, recentres the radar and resizes from its handles", async ({ page }) => {
  await open(page);
  expect((await snapshot(page)).settings.region).toBeNull();
  await expect(page.locator("#regionOut")).toHaveText("follows the view");
  await page.locator("#regionUseView").click();
  const view = (await snapshot(page)).view;
  expect((await snapshot(page)).settings.region).toEqual(view);
  await page.locator("#regionFit").click();
  const fitted = (await snapshot(page)).settings.region;
  expect(fitted.yMin).toBeGreaterThanOrEqual(view.yMin);
  expect(fitted.yMax).toBeLessThanOrEqual(view.yMax);
  expect(fitted.xMax - fitted.xMin).toBeLessThanOrEqual(view.xMax - view.xMin);
  await page.locator("#playbackMode [data-playback='radar']").click();
  const reading = (await snapshot(page)).reading;
  expect(reading.center).toEqual({ x: (fitted.xMin + fitted.xMax) / 2, y: (fitted.yMin + fitted.yMax) / 2 });
  expect(reading.heads[0].kind).toBe("ray");
  const box = await page.locator("#stage").boundingBox();
  const toPixel = (x, y) => [box.x + ((x - view.xMin) / (view.xMax - view.xMin)) * box.width, box.y + ((view.yMax - y) / (view.yMax - view.yMin)) * box.height];
  const [cornerX, cornerY] = toPixel(fitted.xMax, fitted.yMax);
  await page.mouse.move(cornerX, cornerY);
  await page.mouse.down();
  await page.mouse.move(cornerX - 60, cornerY + 40, { steps: 6 });
  await page.mouse.up();
  const resized = (await snapshot(page)).settings.region;
  expect(resized.xMax).toBeLessThan(fitted.xMax);
  expect(resized.yMax).toBeLessThan(fitted.yMax);
  expect(resized.xMin).toBeCloseTo(fitted.xMin, 6);
  expect(resized.yMin).toBeCloseTo(fitted.yMin, 6);
  const [centerX, centerY] = toPixel((resized.xMin + resized.xMax) / 2, (resized.yMin + resized.yMax) / 2);
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX + 50, centerY, { steps: 5 });
  await page.mouse.up();
  const moved = (await snapshot(page)).settings.region;
  expect(moved.xMin).toBeGreaterThan(resized.xMin);
  expect(moved.xMax - moved.xMin).toBeCloseTo(resized.xMax - resized.xMin, 6);
  expect((await snapshot(page)).view).toEqual(view);
  await page.locator("#playbackMode [data-playback='line']").click();
  await page.locator("#playButton").click();
  await expect.poll(async () => (await snapshot(page)).reading.contacts).toBeGreaterThan(0);
  const sample = (await snapshot(page)).reading.sample;
  for (const contact of sample) { expect(contact.x).toBeGreaterThanOrEqual(moved.xMin - 1e-6); expect(contact.x).toBeLessThanOrEqual(moved.xMax + 1e-6); }
  await page.locator("#regionFollow").click();
  expect((await snapshot(page)).settings.region).toBeNull();
  await expect(page.locator("#regionFollow")).toBeDisabled();
});

test("on a phone the open instrument chooser covers the preset bar, not the other way round", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await open(page);
  await page.locator(".masthead .instrument-picker-trigger").first().click();
  await expect(page.locator(".masthead .instrument-picker-panel")).toBeVisible();
  const covering = await page.evaluate(() => {
    const bar = document.querySelector("#mainPresets .instrument-picker-trigger").getBoundingClientRect();
    return document.elementFromPoint(bar.x + bar.width / 2, bar.y + bar.height / 2)?.closest(".masthead .instrument-picker-panel") !== null;
  });
  expect(covering).toBe(true);
  await context.close();
});

test("a layer can switch to strikes that fire as the playhead passes while another layer keeps sounding", async ({ page }) => {
  await open(page);
  const parabola = page.locator(".expression-row").first();
  await expect(parabola.locator(".layer-mode [data-role='contour']")).toHaveAttribute("aria-pressed", "true");
  await parabola.locator(".layer-voice").selectOption("saw");
  expect((await snapshot(page)).rows[0].voice).toBe("saw");
  await parabola.locator(".layer-mode [data-role='drums']").click();
  await expect(parabola.locator(".layer-mode [data-role='drums']")).toHaveAttribute("aria-pressed", "true");
  await expect(parabola.locator(".drum-placement")).toBeVisible();
  await expect(parabola.locator(".layer-knob.mz-range-knob .mz-range-knob__dial")).toBeVisible();
  let state = await snapshot(page);
  expect(state.rows[0].kind).toBe("explicit-y");
  expect(state.drums.triggers.length).toBeGreaterThan(0);
  expect(state.drums.triggers.every((trigger) => trigger.rowId === state.rows[0].id)).toBe(true);
  const gridCount = state.drums.triggers.length;
  await parabola.locator(".drum-placement").selectOption("equidistant");
  await setRange(page, ".expression-row:first-child .drum-count", 5);
  await expect.poll(async () => (await snapshot(page)).drums.triggers.length).toBe(5);
  expect((await snapshot(page)).drums.triggers.map((trigger) => trigger.s)).toEqual([0.1, 0.3, 0.5, 0.7, 0.9]);
  await expect(parabola.locator(".drum-count-out")).toHaveText("5");
  await parabola.locator(".drum-voice").selectOption("pluck");
  await expect(parabola.locator(".layer-pitch")).toBeHidden();
  await parabola.locator(".drum-voice").selectOption("snap-snare");
  await expect(parabola.locator(".layer-pitch")).toBeVisible();
  await parabola.locator(".drum-placement").selectOption("xy");
  await expect.poll(async () => (await snapshot(page)).drums.triggers.length).toBeGreaterThan(gridCount);
  await page.locator("#playButton").click();
  await expect.poll(async () => (await snapshot(page)).drums.hits, { timeout: 8000 }).toBeGreaterThan(0);
  await expect.poll(async () => (await snapshot(page)).reading.contacts).toBeGreaterThan(0);
  state = await snapshot(page);
  expect(state.reading.sample.every((contact) => contact.id !== state.rows[0].id)).toBe(true);
  await parabola.locator(".layer-mode [data-role='contour']").click();
  await expect.poll(async () => (await snapshot(page)).drums.triggers.length).toBe(0);
  expect((await snapshot(page)).rows[0].kind).toBe("explicit-y");
  expect((await snapshot(page)).rows[0].voice).toBe("saw");
});
