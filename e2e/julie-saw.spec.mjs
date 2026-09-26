import { expect, test } from "@playwright/test";

import {
  MIDI_BYTES,
  enableFakeMidi,
  installFakeMidi,
  sendMidi,
} from "./helpers/fake-midi.mjs";
import { readAudioStatus } from "./helpers/audio-probe.mjs";

test("Julie Saw exposes recoverable performances and keeps Play separate from Audio", async ({ page }) => {
  await page.goto("julie-saw.html", { waitUntil: "load" });

  await expect(page.locator("#presetSelect option")).toHaveCount(38);
  await expect(page.locator("#techniqueSelect option")).toHaveCount(17);
  await expect(page.locator("#rhythmSelect option")).toHaveCount(22);
  await expect(page.locator(".julie-actions button")).toHaveCount(7);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".julie-stage-readout")).not.toHaveAttribute("aria-live", /.+/);
  await expect(page.locator("#liveStatus")).toHaveAttribute("aria-live", "polite");

  await page.locator("#playButton").click();
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#transportAudioAttention")).toHaveCount(0);

  await page.locator("#presetSelect").selectOption("rough-rosin");
  await expect(page.locator("#techniqueSelect")).toHaveValue("continuous-bow");
  await expect(page.locator("#rhythmSelect")).toHaveValue("train-rebows");

  await page.locator("#presetSelect").selectOption("storm-window");
  await expect(page.locator("#bladeSelect")).toHaveValue("old-carpenter");
  await expect(page.locator("#techniqueSelect")).toHaveValue("storm");
  await expect(page.locator("#rhythmSelect")).toHaveValue("storm-motion");
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");

  await page.locator("#resetAll").click();
  await expect(page.locator("#presetSelect")).toHaveValue("julies-first-note");
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#bend")).toHaveValue("0.43");
  await expect(page.locator("#techniqueSelect")).toHaveValue("clean-ring");
  await expect(page.locator("#rhythmSelect")).toHaveValue("lyric-ring");
});

test("the performer canvas gives flex and bow independent continuous gestures", async ({ page }) => {
  await page.goto("julie-saw.html", { waitUntil: "load" });
  const canvas = page.locator("#stage");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();

  const bendBefore = Number(await page.locator("#bend").inputValue());
  const curlBefore = Number(await page.locator("#tipCurl").inputValue());
  await page.mouse.move(box.x + box.width * .55, box.y + box.height * .2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .64, box.y + box.height * .13, { steps: 7 });
  await page.mouse.up();
  expect(Number(await page.locator("#bend").inputValue())).toBeGreaterThan(bendBefore);
  expect(Number(await page.locator("#tipCurl").inputValue())).toBeGreaterThan(curlBefore);
  const raisedBend = Number(await page.locator("#bend").inputValue());
  const raisedCurl = Number(await page.locator("#tipCurl").inputValue());
  await page.mouse.move(box.x + box.width * .64, box.y + box.height * .17);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .52, box.y + box.height * .32, { steps: 8 });
  await page.mouse.up();
  expect(Number(await page.locator("#bend").inputValue())).toBeLessThan(raisedBend);
  expect(Number(await page.locator("#tipCurl").inputValue())).toBeLessThan(raisedCurl);
  await expect(page.locator("#trackSweetSpot")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#presetSelect")).toHaveValue("custom");

  const contactBefore = Number(await page.locator("#bowContact").inputValue());
  await page.mouse.move(box.x + box.width * .8, box.y + box.height * .52);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .68, box.y + box.height * .39, { steps: 8 });
  await page.waitForTimeout(180);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#bowButton")).toHaveAttribute("aria-pressed", "true");
  expect(Number(await page.locator("#bowContact").inputValue())).toBeGreaterThan(contactBefore);
  await expect(page.locator("#trackSweetSpot")).toHaveAttribute("aria-pressed", "false");
  await page.mouse.up();
  await expect(page.locator("#bowButton")).toHaveAttribute("aria-pressed", "false");

  for (const gesture of ["soft-mallet", "hard-mallet", "pluck", "thimble", "teeth"]) {
    await page.locator(`[data-gesture="${gesture}"]`).click();
  }
  await page.locator("#chokeButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  expect(await readAudioStatus(page)).toMatchObject({ active: false, connectionCount: 0 });
});

test("the pink flex grip follows a coarse touch down and sideways without scrolling the page", async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto("julie-saw.html", { waitUntil: "load" });
  const canvas = page.locator("#stage");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const bendBefore = Number(await page.locator("#bend").inputValue());
  const curlBefore = Number(await page.locator("#tipCurl").inputValue());
  const session = await context.newCDPSession(page);
  const point = (x, y) => ({
    x: box.x + box.width * x,
    y: box.y + box.height * y,
    id: 1,
    radiusX: 7,
    radiusY: 7,
    force: .5,
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [point(.54, .24)],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [point(.46, .39)],
  });
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  expect(Number(await page.locator("#bend").inputValue())).toBeLessThan(bendBefore);
  expect(Number(await page.locator("#tipCurl").inputValue())).toBeLessThan(curlBefore);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  const bowBox = await page.locator("#bowButton").boundingBox();
  expect(bowBox).not.toBeNull();
  await page.mouse.move(bowBox.x + bowBox.width / 2, bowBox.y + bowBox.height / 2);
  await page.mouse.down();
  await expect(page.locator("#bowButton")).toHaveAttribute("aria-pressed", "true");
  const frameHealth = await page.evaluate(async () => {
    const canvas = document.querySelector("#stage");
    const context = canvas.getContext("2d");
    const panel = document.querySelector(".panel");
    const litSamples = [];
    const sizes = new Set();
    for (let frame = 0; frame < 24; frame += 1) {
      panel.scrollTop = frame % 8 < 4 ? panel.scrollHeight : 0;
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let lit = 0;
      for (let index = 0; index < pixels.length; index += 1600) {
        if (pixels[index] + pixels[index + 1] + pixels[index + 2] > 42) lit += 1;
      }
      litSamples.push(lit);
      sizes.add(`${canvas.width}x${canvas.height}`);
    }
    return {
      desynchronized: context.getContextAttributes?.().desynchronized ?? false,
      minimumLitSamples: Math.min(...litSamples),
      maximumLitSamples: Math.max(...litSamples),
      sizes: [...sizes],
      backingPixels: canvas.width * canvas.height,
    };
  });
  expect(frameHealth.desynchronized).toBe(false);
  expect(frameHealth.minimumLitSamples).toBeGreaterThan(20);
  expect(frameHealth.minimumLitSamples).toBeGreaterThanOrEqual(frameHealth.maximumLitSamples * .8);
  expect(frameHealth.sizes).toHaveLength(1);
  expect(frameHealth.backingPixels).toBeLessThanOrEqual(720_000);
  expect(await readAudioStatus(page)).toMatchObject({ active: true, connectionCount: 1 });
  await page.mouse.up();
  await context.close();
});

test("manual bow and alternate exciters run through the real AudioWorklet", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("julie-saw.html", { waitUntil: "load" });
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");

  const bow = page.locator("#bowButton");
  const box = await bow.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(bow).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(350);
  await expect(page.locator("#contactReadout")).toContainText("sweet");
  await page.mouse.up();
  await expect(bow).toHaveAttribute("aria-pressed", "false");

  for (const gesture of ["soft-mallet", "hard-mallet", "pluck", "thimble", "teeth"]) {
    await page.locator(`[data-gesture="${gesture}"]`).click();
  }
  await page.locator("#chokeButton").click();
  await expect(page.locator("#liveStatus")).toContainText("choked");
  expect(errors).toEqual([]);
});

test("Audio joins the running visual phrase without forcing it back to step zero", async ({ page }) => {
  await page.goto("julie-saw.html", { waitUntil: "load" });
  // Exercise the harder re-arm path with an existing suspended worklet.
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await page.locator("#playButton").click();
  await page.waitForFunction(() => (
    [...document.querySelectorAll("#rhythmScore i")]
      .findIndex((marker) => marker.classList.contains("is-current")) === 3
  ));
  expect(await page.locator("#rhythmScore i").evaluateAll((markers) => (
    markers.findIndex((marker) => marker.classList.contains("is-current"))
  ))).toBe(3);

  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(70);
  const joinedStep = await page.locator("#rhythmScore i").evaluateAll((markers) => (
    markers.findIndex((marker) => marker.classList.contains("is-current"))
  ));
  expect([3, 4]).toContain(joinedStep);
});

test("tracked automatic bends keep the bow on the moving sweet spot", async ({ page }) => {
  await page.goto("julie-saw.html", { waitUntil: "load" });
  await page.locator("#presetSelect").selectOption("siren-chair");
  await expect(page.locator("#trackSweetSpot")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#audioButton").click();
  await page.locator("#playButton").click();
  const trackedReadings = [];
  for (let index = 0; index < 10; index += 1) {
    await page.waitForTimeout(70);
    trackedReadings.push(await page.locator("#contactReadout").textContent());
  }
  expect(trackedReadings.some((reading) => /sweet/.test(reading))).toBe(true);
  expect(trackedReadings.every((reading) => !/scrape|weak/.test(reading))).toBe(true);

  await page.locator("#bowContact").evaluate((input) => {
    input.value = "0.02";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.locator("#trackSweetSpot")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#contactReadout")).toContainText("scrape", { timeout: 1500 });
});

test("MIDI and computer-key notes own Julie's monophonic bow without starting transport", async ({ page }) => {
  await installFakeMidi(page);
  await page.goto("julie-saw.html", { waitUntil: "load" });
  await enableFakeMidi(page);

  await sendMidi(page, MIDI_BYTES.noteOn(69, 104));
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#pitchReadout")).toContainText("A4");
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
  await sendMidi(page, MIDI_BYTES.noteOn(72, 88));
  await expect(page.locator("#pitchReadout")).toContainText("C5");
  await sendMidi(page, MIDI_BYTES.noteOff(72));
  await expect(page.locator("#pitchReadout")).toContainText("A4");
  await sendMidi(page, MIDI_BYTES.noteOff(69));

  await sendMidi(page, MIDI_BYTES.noteOn(81, 96));
  await expect(page.locator("#pitchReadout")).toContainText("A5");
  await sendMidi(page, MIDI_BYTES.controlChange(120, 0));
  await expect(page.locator("#liveStatus")).toContainText("MIDI notes released");
  await expect(page.locator("#pitchReadout")).toContainText("D5", { timeout: 3000 });

  await page.keyboard.press("KeyA");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
});

test("Julie Saw respects WAX MIDI-only ownership", async ({ page }) => {
  await page.goto("julie-saw.html", { waitUntil: "load" });
  const dispatchedWithoutClaim = await page.evaluate(() => {
    document.documentElement.dataset.morphazoidWaxOutputMode = "midi";
    return globalThis.dispatchEvent(new CustomEvent("morphazoid:midi-input", {
      cancelable: true,
      detail: {
        source: "wax",
        message: { type: "noteOn", note: 69, velocity: 104 },
      },
    }));
  });
  expect(dispatchedWithoutClaim).toBe(true);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
});

test("the generated WAX Julie Saw loads without arming Audio", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("dist-wax/julie-saw.html", { waitUntil: "load" });
  await expect(page.locator("script[data-morphazoid-wax-bootstrap]")).toHaveCount(1);
  await expect(page.locator("script[data-morphazoid-wax-universal-adapter]")).toHaveCount(1);
  await expect(page.locator("#presetSelect option")).toHaveCount(38);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await page.locator("#presetSelect").selectOption("bow-lift-halo");
  await expect(page.locator("#bladeSelect")).toHaveValue("thick-stage");
  expect(errors).toEqual([]);
});

for (const viewport of [
  { width: 390, height: 844, name: "phone portrait" },
  { width: 844, height: 390, name: "phone landscape" },
]) {
  test(`Julie Saw keeps the performer visible and controls reachable on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("julie-saw.html", { waitUntil: "load" });
    const stage = await page.locator("#stageWrap").boundingBox();
    const top = await page.locator(".julie-top").boundingBox();
    expect(stage).not.toBeNull();
    expect(top).not.toBeNull();
    expect(stage.height).toBeGreaterThanOrEqual(viewport.height < 500 ? 230 : 300);
    expect(top.y).toBeGreaterThanOrEqual(stage.y + stage.height - 2);

    const panel = page.locator(".julie-saw-page .panel");
    const stageTop = stage.y;
    const panelBox = await panel.boundingBox();
    await page.mouse.move(panelBox.x + panelBox.width / 2, panelBox.y + panelBox.height / 2);
    await page.mouse.wheel(0, 360);
    await expect.poll(() => panel.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    const downwardScroll = await panel.evaluate((element) => element.scrollTop);
    await page.mouse.wheel(0, -180);
    await expect.poll(() => panel.evaluate((element) => element.scrollTop)).toBeLessThan(downwardScroll);
    await panel.evaluate((element) => {
      element.scrollTop = Math.min(700, element.scrollHeight - element.clientHeight);
    });
    await expect.poll(() => panel.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await expect.poll(async () => (await page.locator("#stageWrap").boundingBox())?.y ?? -1)
      .toBeCloseTo(stageTop, 0);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    await page.locator("#resetAll").scrollIntoViewIfNeeded();
    await expect(page.locator("#resetAll")).toBeVisible();
    await page.locator("#bladeSelect").scrollIntoViewIfNeeded();
    await expect(page.locator("#bladeSelect")).toBeVisible();
  });
}
