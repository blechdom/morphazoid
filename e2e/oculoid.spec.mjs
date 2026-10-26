import { expect, test } from "@playwright/test";

import { readAudioStatus, waitForStableAudioState } from "./helpers/audio-probe.mjs";
import { pageDiagnosticMessages, watchPageDiagnostics } from "./helpers/diagnostics.mjs";
import { MIDI_BYTES, enableFakeMidi, installFakeMidi, midiClockSequence, sendMidi, sendMidiSequence } from "./helpers/fake-midi.mjs";

test.setTimeout(75_000);
const diagnostics = new WeakMap();

async function openEye(page, { finish = "brown" } = {}) {
  const errors = [];
  diagnostics.set(page, errors);
  page.on("pageerror", error => errors.push(`page: ${error.message}`));
  page.on("console", message => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("response", response => {
    if (response.url().startsWith(new URL(page.url()).origin)
      && response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`);
  });
  const response = await page.goto("oculoid.html", { waitUntil: "domcontentloaded" });
  expect(response?.ok()).toBe(true);
  await expect(page.locator(".oc-stage")).toHaveAttribute("data-model-state", "ready", { timeout: 20_000 });
  await expect(page.locator("#modelStatus")).toBeHidden();
  await expect(page.locator(".header-preset-controls")).toBeVisible();
  // Keep the earlier brown-skin geometry/color assertions as a regression
  // check while the newly requested chrome becomes the actual page default.
  if (finish === "brown") {
    await page.locator("#skinFinish").selectOption("matte");
    await page.locator("#skinPicker").fill("#704b33");
  }
  return errors;
}

const hiddenSurfaceMarkers = new WeakSet();
async function eyeSurfaceScreenshot(page) {
  // Hide the aim dot for mesh comparisons; it remains after a grip releases.
  if (!hiddenSurfaceMarkers.has(page)) {
    await page.addStyleTag({ content: "#surfaceMarker { visibility: hidden !important; }" });
    hiddenSurfaceMarkers.add(page);
  }
  return page.locator("#eyeCanvas").screenshot();
}

async function inkIrisShades(page, png) {
  return page.evaluate(async base64 => {
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    const image = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const canvas = document.createElement("canvas");
    canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0);
    image.close();
    const { width, height } = canvas, side = Math.min(width, height);
    const pixels = ctx.getImageData(0, 0, width, height).data;
    const sums = [0, 0], counts = [0, 0];
    for (let y = height / 2 - side * 0.14; y < height / 2 + side * 0.14; y++) {
      for (let x = width / 2 - side * 0.14; x < width / 2 + side * 0.14; x++) {
        const distance = Math.hypot(x - width / 2, y - height / 2) / side;
        const band = distance < 0.025 ? 0 : distance > 0.085 && distance < 0.14 ? 1 : -1;
        if (band < 0) continue;
        const offset = (Math.floor(y) * width + Math.floor(x)) * 4;
        sums[band] += (pixels[offset] + pixels[offset + 1] + pixels[offset + 2]) / 3;
        counts[band]++;
      }
    }
    return sums.map((sum, index) => sum / counts[index]);
  }, png.toString("base64"));
}

test("the ready eye has no status footer or faux scrollbar", async ({ page }) => {
  const network = watchPageDiagnostics(page);
  await openEye(page, { finish: "chrome" });
  expect(pageDiagnosticMessages(network), "loaded eye assets must finish without aborted requests").toEqual([]);
  await expect(page.locator("#modelStatus")).toBeEmpty();
  await expect(page.locator(".oc-footer, #eyeMeter")).toHaveCount(0);
  await expect(page.locator("#twistMode")).toHaveCount(0);
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    stage: document.querySelector(".oc-stage").scrollWidth - document.querySelector(".oc-stage").clientWidth,
    panel: document.querySelector(".oc-panel").scrollWidth - document.querySelector(".oc-panel").clientWidth,
    statusHeight: document.querySelector("#modelStatus").getBoundingClientRect().height,
  }));
  expect(overflow.document).toBeLessThanOrEqual(2);
  expect(overflow.stage).toBeLessThanOrEqual(2);
  expect(overflow.panel).toBeLessThanOrEqual(2);
  expect(overflow.statusHeight).toBe(0);
});

test("Poke indents the textured globe, not the gaze or lids, then springs completely back", async ({ page }, testInfo) => {
  await openEye(page);
  const canvas = page.locator("#eyeCanvas"), button = page.locator("#pokeMode");
  await expect(button).toBeEnabled();
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect(canvas).toHaveClass(/oc-poking/);
  const box = await canvas.boundingBox();
  const x = box.x + box.width * 0.5, y = box.y + box.height * 0.5;
  const original = await canvas.screenshot();
  await testInfo.attach("oculoid-before-poke.png", { body: original, contentType: "image/png" });
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(260);
  const pressed = await canvas.screenshot();
  expect(await changedPixels(page, original, pressed, [0.37, 0.25, 0.63, 0.75], 35),
    "the imported textured globe must visibly dimple instead of showing a decoration").toBeGreaterThan(270);
  for (const [id, value] of [["gazeX", "0"], ["gazeY", "0"],
    ["blink", "0.04"], ["lowerLid", "0"], ["turnX", "0"]]) {
    await expect(page.locator(`#${id}`)).toHaveValue(value);
  }
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  await testInfo.attach("oculoid-poked.png", { body: pressed, contentType: "image/png" });
  await page.mouse.up();
  await page.waitForTimeout(680);
  const released = await canvas.screenshot();
  await testInfo.attach("oculoid-after-poke.png", { body: released, contentType: "image/png" });
  expect(await changedPixels(page, original, released, undefined, 25),
    "the released eye must return to its pre-poke surface").toBeLessThan(90);

  await canvas.focus();
  await page.keyboard.down("p");
  await page.waitForTimeout(260);
  const keyboardPoke = await canvas.screenshot();
  expect(await changedPixels(page, original, keyboardPoke, [0.4, 0.26, 0.72, 0.74], 35))
    .toBeGreaterThan(140);
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#gazeX")).toHaveValue("0");
  await page.keyboard.up("p");
  await page.waitForTimeout(680);
  expect(await changedPixels(page, original, await canvas.screenshot(), undefined, 25)).toBeLessThan(90);
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await canvas.focus();
  await page.keyboard.press("ArrowRight");
  expect(Number(await page.locator("#gazeX").inputValue())).toBeGreaterThan(0);
  await page.locator("#stageReset").click();
  await expect(page.locator("#gazeX")).toHaveValue("0");
  expect(diagnostics.get(page)).toEqual([]);
});

test("Poke cancels safely and never punches through a shut eyelid", async ({ page }) => {
  await openEye(page);
  const canvas = page.locator("#eyeCanvas"), box = await canvas.boundingBox();
  const button = page.locator("#pokeMode");
  await button.click();
  await page.locator("#blink").fill("1");
  await page.locator("#lowerLid").fill("-1");
  const shut = await canvas.screenshot();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.waitForTimeout(300);
  await page.mouse.up();
  expect(await changedPixels(page, shut, await canvas.screenshot(), undefined, 25))
    .toBeLessThan(70);
  await page.locator("#stageReset").click();
  await button.click();
  await page.evaluate(() => {
    document.getElementById("eyeCanvas").addEventListener("pointerdown",
      event => { window.ocPokePointer = event.pointerId; }, { once: true });
  });
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.waitForTimeout(140);
  await page.evaluate(() => document.getElementById("eyeCanvas").dispatchEvent(
    new PointerEvent("pointercancel", { bubbles: true, pointerId: window.ocPokePointer }),
  ));
  await page.mouse.up();
  expect(await canvas.evaluate(element => element.hasPointerCapture(window.ocPokePointer))).toBe(false);
  await page.waitForTimeout(680);
  await expect(page.locator("#pokeMode")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#gazeX")).toHaveValue("0");
  await page.locator("#stageReset").click();
  await expect(page.locator("#pokeMode")).toHaveAttribute("aria-pressed", "false");
  expect(diagnostics.get(page)).toEqual([]);
});

test("turning Poke off or resetting during a captured press cannot leave a live dent", async ({ page }) => {
  // Reset restores the factory chrome finish; compare against that finish,
  // not openEye's legacy brown-skin regression scene.
  await openEye(page, { finish: "chrome" });
  const canvas = page.locator("#eyeCanvas"), button = page.locator("#pokeMode");
  const box = await canvas.boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  for (const recovery of [button, page.locator("#stageReset")]) {
    await button.click();
    const original = await canvas.screenshot();
    await canvas.evaluate(element => element.addEventListener("pointerdown", event => {
      window.ocPokePointer = event.pointerId;
    }, { once: true }));
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.waitForTimeout(260);
    expect(await changedPixels(page, original, await canvas.screenshot(),
      [0.37, 0.25, 0.63, 0.75], 35)).toBeGreaterThan(270);
    expect(await canvas.evaluate(element => element.hasPointerCapture(window.ocPokePointer))).toBe(true);
    // A keyboard action can reach either button while a different pointer
    // still holds the canvas. Releasing capture must invalidate that gesture.
    await recovery.focus();
    await page.keyboard.press("Space");
    await expect(button).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#motionButton")).toHaveAttribute("aria-pressed", "false");
    expect(await canvas.evaluate(element => element.hasPointerCapture(window.ocPokePointer))).toBe(false);
    await page.mouse.move(x + 30, y + 10);
    await page.mouse.up();
    // The software WebGL renderer may still be finishing an older low-res
    // poke frame; wait for the first full-resolution restored frame.
    await expect.poll(async () => changedPixels(page, original,
      await canvas.screenshot(), undefined, 25), { timeout: 10_000 }).toBeLessThan(90);
    await expect(page.locator("#gazeX")).toHaveValue("0");
    await expect(page.locator("#gazeY")).toHaveValue("0");
  }
  expect(diagnostics.get(page)).toEqual([]);
});

test("a prolonged poke scrub stays on the globe and releases without drift", async ({ page }, testInfo) => {
  await openEye(page, { finish: "chrome" });
  const canvas = page.locator("#eyeCanvas"), button = page.locator("#pokeMode");
  await button.click();
  const original = await canvas.screenshot(), box = await canvas.boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await canvas.evaluate(element => {
    window.ocPokeMoves = 0;
    window.ocPokeHandlerMs = [];
    let started = 0;
    element.addEventListener("pointermove", event => {
      if (event.buttons === 1) started = performance.now();
    }, { capture: true });
    element.addEventListener("pointermove", event => {
      if (event.buttons !== 1) return;
      window.ocPokeMoves++;
      window.ocPokeHandlerMs.push(performance.now() - started);
    });
  });
  await page.mouse.move(x, y);
  await page.mouse.down();
  const start = Date.now();
  for (let i = 0; i < 40; i++) {
    await page.mouse.move(x + Math.sin(i * 0.55) * 22, y + Math.cos(i * 0.43) * 24);
  }
  const dragMs = Date.now() - start;
  const handlerMs = await page.evaluate(() => window.ocPokeHandlerMs);
  const sorted = [...handlerMs].sort((a, b) => a - b);
  await testInfo.attach("oculoid-poke-drag-timing.json", {
    body: JSON.stringify({ pointerMoves: handlerMs.length, dragMs,
      medianHandlerMs: sorted[Math.floor(sorted.length / 2)],
      p95HandlerMs: sorted[Math.floor(sorted.length * 0.95)] }, null, 2),
    contentType: "application/json",
  });
  expect(await page.evaluate(() => window.ocPokeMoves)).toBeGreaterThanOrEqual(40);
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#gazeX")).toHaveValue("0");
  await expect(page.locator("#gazeY")).toHaveValue("0");
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  await page.mouse.up();
  await expect.poll(async () => changedPixels(page, original,
    await canvas.screenshot(), undefined, 25), { timeout: 10_000 }).toBeLessThan(90);
  await page.locator("#stageReset").click();
  await expect(button).toHaveAttribute("aria-pressed", "false");
  expect(diagnostics.get(page)).toEqual([]);
});

test("the lid retractor holds the globe open without rewriting knobs; the three tools exclude each other", async ({ page }, testInfo) => {
  await openEye(page, { finish: "chrome" });
  const canvas = page.locator("#eyeCanvas"), retractor = page.locator("#lidRetractor");
  await page.locator("#blink").fill("1");
  await page.locator("#lowerLid").fill("-1");
  await page.waitForTimeout(190);
  const shut = await eyeSurfaceScreenshot(page);
  await testInfo.attach("closed-before.png", { body: shut, contentType: "image/png" });
  await retractor.click();
  await expect(retractor).toHaveAttribute("aria-pressed", "true");
  expect(await changedPixels(page, shut, await canvas.screenshot(),
    [0.26, 0.16, 0.74, 0.83], 35)).toBeGreaterThan(800);
  await expect(page.locator("#blink")).toHaveValue("1");
  await expect(page.locator("#lowerLid")).toHaveValue("-1");
  await page.locator("#stretchMode").click();
  await expect(page.locator("#stretchMode")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#flashlightMode").click();
  await expect(page.locator("#stretchMode")).toHaveAttribute("aria-pressed", "false");
  await page.locator("#pokeMode").click();
  await expect(page.locator("#flashlightMode")).toHaveAttribute("aria-pressed", "false");
  await page.locator("#stretchMode").click();
  await expect(page.locator("#pokeMode")).toHaveAttribute("aria-pressed", "false");
  await retractor.click();
  await expect(retractor).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#blink")).toHaveValue("1");
  await expect(page.locator("#lowerLid")).toHaveValue("-1");
  await page.waitForTimeout(250);
  await testInfo.attach("closed-after.png", { body: await eyeSurfaceScreenshot(page), contentType: "image/png" });
  await expect.poll(async () => changedPixels(page, shut,
    await eyeSurfaceScreenshot(page), undefined, 25)).toBeLessThan(95);
  await page.locator("#stageReset").click();
  await expect(page.locator("#stretchMode")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#blink")).toHaveValue("0.04");
  await expect(page.locator("#lowerLid")).toHaveValue("0");
  await expect(retractor).toHaveAttribute("aria-pressed", "false");
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  expect(diagnostics.get(page)).toEqual([]);
});

test("Hide lids exposes only the globe, makes closed-lid touch available and restores the saved lids", async ({ page }) => {
  await openEye(page, { finish: "chrome" });
  const canvas = page.locator("#eyeCanvas"), hide = page.locator("#hideLids");
  await page.locator("#blink").fill("1");
  await page.locator("#lowerLid").fill("-1");
  const closed = await canvas.screenshot();
  await hide.click();
  await expect(hide).toHaveAttribute("aria-pressed", "true");
  for (const id of ["lidRetractor", "tearOnce", "cryMode"])
    await expect(page.locator(`#${id}`)).toBeDisabled();
  await expect(page.locator("#blink")).toHaveValue("1");
  await expect(page.locator("#lowerLid")).toHaveValue("-1");
  const bare = await canvas.screenshot();
  expect(await changedPixels(page, closed, bare, [0.25, 0.17, 0.75, 0.84], 32),
    "removing the shell and lashes exposes the globe instead of repainting its lid knobs")
    .toBeGreaterThan(1200);
  await page.locator("#pokeMode").click();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(220);
  expect(await changedPixels(page, bare, await canvas.screenshot(), [0.38, 0.25, 0.65, 0.75], 25),
    "touch should hit the exposed globe although the saved lids are closed").toBeGreaterThan(150);
  await page.mouse.up();
  await page.locator("#pokeMode").click();
  await page.waitForTimeout(650);
  await hide.click();
  await expect(hide).toHaveAttribute("aria-pressed", "false");
  for (const id of ["lidRetractor", "tearOnce", "cryMode"])
    await expect(page.locator(`#${id}`)).toBeEnabled();
  await expect(page.locator("#blink")).toHaveValue("1");
  await expect(page.locator("#lowerLid")).toHaveValue("-1");
  await expect.poll(async () => changedPixels(page, closed,
    await canvas.screenshot(), undefined, 25), { timeout: 10_000 }).toBeLessThan(100);
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
});

test("the black loading-eye look keeps its iris and pupil while turning in 3D", async ({ page }) => {
  await openEye(page, { finish: "chrome" });
  const canvas = page.locator("#eyeCanvas");
  await page.locator("#hideLids").click();
  const textured = await canvas.screenshot();
  await page.locator("#eyeLook").selectOption("ink");
  for (const id of ["irisColor", "scleraColor"])
    await expect(page.locator(`#${id}`)).toBeDisabled();
  const black = await canvas.screenshot();
  expect(await changedPixels(page, textured, black, [0.26, 0.17, 0.74, 0.83], 30))
    .toBeGreaterThan(1200);
  const [pupilShade, irisShade] = await inkIrisShades(page, black);
  expect(pupilShade, "the loading eye's dark pupil must remain visible").toBeLessThan(8);
  expect(irisShade - pupilShade, "the iris must not be buried under the black cornea")
    .toBeGreaterThan(18);
  await page.locator("#gazeX").fill("0.65");
  const glanced = await canvas.screenshot();
  expect(await changedPixels(page, black, glanced, [0.3, 0.22, 0.7, 0.78], 20),
    "iris marks and glints of the black eye must turn with the globe").toBeGreaterThan(120);
  expect((await inkIrisShades(page, glanced))[0],
    "the pupil must leave the center when gaze moves").toBeGreaterThan(pupilShade + 8);
  await page.locator("#turnX").fill("60");
  const turned = await canvas.screenshot();
  expect(await changedPixels(page, glanced, turned, [0.3, 0.22, 0.7, 0.78], 20),
    "the black eye must follow the same whole-eye pivot").toBeGreaterThan(120);
  await page.locator("#gazeX").fill("0");
  await page.locator("#turnX").fill("0");
  await page.locator("#eyeLook").selectOption("textured");
  for (const id of ["irisColor", "scleraColor"])
    await expect(page.locator(`#${id}`)).toBeEnabled();
  await expect.poll(async () => changedPixels(page, textured,
    await canvas.screenshot(), undefined, 25), { timeout: 10_000 }).toBeLessThan(100);
  await page.locator("#hideLids").click();
  await page.locator("#eyeLook").selectOption("ink");
  await page.locator("#stageReset").click();
  await expect(page.locator("#hideLids")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#eyeLook")).toHaveValue("textured");
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
});

test("the bare iris opening has neither a black gap nor a dark sclera-tint seam", async ({ page }) => {
  await openEye(page, { finish: "chrome" });
  await page.locator("#hideLids").click();
  const canvas = page.locator("#eyeCanvas");
  await page.locator("#eyeLook").selectOption("ink");
  const ink = await canvas.screenshot();
  const [pupil, iris] = await inkIrisShades(page, ink);
  expect(iris - pupil, "the black globe must still reveal the detailed iris").toBeGreaterThan(18);
  await page.locator("#eyeLook").selectOption("textured");
  await page.locator("#scleraColor").selectOption("coral");
  const coral = await canvas.screenshot();

  const { blackGap, tintStep } = await page.evaluate(async ({ ink, coral }) => {
    const decode = async base64 => {
      const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
      return createImageBitmap(new Blob([bytes], { type: "image/png" }));
    };
    const images = await Promise.all([decode(ink), decode(coral)]);
    const { width, height } = images[0], side = Math.min(width, height);
    const ctx = document.createElement("canvas").getContext("2d");
    ctx.canvas.width = width; ctx.canvas.height = height;
    const pixels = images.map(image => {
      ctx.drawImage(image, 0, 0);
      image.close();
      return ctx.getImageData(0, 0, width, height).data;
    });
    const first = Math.round(side * 0.255), last = Math.round(side * 0.31);
    const green = new Float64Array(last - first + 1), counts = new Uint32Array(green.length);
    let blackGap = 0;
    // The lower iris occupies < 0.24 of the short canvas side. The old
    // oversize cutout left pure stage-black pixels around its outer edge;
    // the old short tint transition painted a hard ring just beyond it.
    for (let y = Math.floor(height / 2); y < Math.min(height, height / 2 + side * 0.35); y++) {
      for (let x = Math.floor(width / 2 - side * 0.32);
        x < Math.min(width, width / 2 + side * 0.32); x++) {
        const radius = Math.round(Math.hypot(x - width / 2, y - height / 2));
        if (radius < first || radius > last) continue;
        const offset = (y * width + x) * 4;
        if (radius < side * 0.29 && Math.max(pixels[0][offset],
          pixels[0][offset + 1], pixels[0][offset + 2]) < 7) blackGap++;
        green[radius - first] += pixels[1][offset + 1];
        counts[radius - first]++;
      }
    }
    const averages = green.map((sum, index) => sum / counts[index]);
    return { blackGap, tintStep: Math.max(...averages.slice(0, -1).map(
      (value, index) => value - averages[index + 1],
    )) };
  }, { ink: ink.toString("base64"), coral: coral.toString("base64") });
  expect(blackGap, "the ink cornea must not expose the black stage outside the iris").toBeLessThan(50);
  expect(tintStep, "the sclera tint must feather into the cornea, not form a dark ring")
    .toBeLessThan(8);
  expect(diagnostics.get(page)).toEqual([]);
});

test("removed Film, Ripple and Twist cannot capture input; a missed Stretch grip never steers the eye", async ({ page }) => {
  await openEye(page, { finish: "chrome" });
  await expect(page.locator("#rippleMode, #filmMode, #twistMode")).toHaveCount(0);
  const canvas = page.locator("#eyeCanvas"), box = await canvas.boundingBox();
  await page.locator("#stretchMode").click();
  // Outside the shell, the selected tool cannot become a whole-eye turn.
  await page.mouse.move(box.x + 25, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 100, box.y + box.height / 2 + 50, { steps: 3 });
  await page.mouse.up();
  await expect(page.locator("#turnX")).toHaveValue("0");
  await expect(page.locator("#turnY")).toHaveValue("0");
  // A closed lid cannot become a gaze drag merely because Stretch missed.
  await page.locator("#blink").fill("1");
  await page.locator("#lowerLid").fill("-1");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator("#gazeX")).toHaveValue("0");
  await expect(page.locator("#gazeY")).toHaveValue("0");
  await expect(page.locator("#blink")).toHaveValue("1");
  await expect(page.locator("#lowerLid")).toHaveValue("-1");
  await expect(page.locator("#turnX")).toHaveValue("0");
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  expect(diagnostics.get(page)).toEqual([]);
});

test("Stretch bends the loaded eye and springs exactly back", async ({ page }, testInfo) => {
  await openEye(page);
  const canvas = page.locator("#eyeCanvas"), box = await canvas.boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.locator("#stretchMode").click();
  await page.waitForTimeout(180);
  const original = await eyeSurfaceScreenshot(page);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 82, y + 44, { steps: 8 });
  await page.waitForTimeout(200);
  const stretched = await eyeSurfaceScreenshot(page);
  await testInfo.attach("oculoid-stretch.png", { body: stretched, contentType: "image/png" });
  expect(await changedPixels(page, original, stretched, [0.33, 0.23, 0.7, 0.78], 35))
    .toBeGreaterThan(150);
  await page.mouse.up();
  await page.waitForTimeout(850);
  await expect.poll(async () => changedPixels(page, original,
    await eyeSurfaceScreenshot(page), undefined, 25), { timeout: 10_000 }).toBeLessThan(95);
  await expect(page.locator("#gazeX")).toHaveValue("0");
  await expect(page.locator("#gazeY")).toHaveValue("0");
  expect(diagnostics.get(page)).toEqual([]);
});

test("a horizontal Stretch tug deforms the globe without steering the whole eye", async ({ page }, testInfo) => {
  await openEye(page);
  const canvas = page.locator("#eyeCanvas"), box = await canvas.boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.locator("#stretchMode").click();
  const before = await eyeSurfaceScreenshot(page);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 80, y, { steps: 10 });
  await page.waitForTimeout(200);
  const stretched = await eyeSurfaceScreenshot(page);
  await testInfo.attach("oculoid-horizontal-stretch.png", { body: stretched, contentType: "image/png" });
  expect(await changedPixels(page, before, stretched, [0.33, 0.23, 0.7, 0.78], 28))
    .toBeGreaterThan(130);
  await page.mouse.up();
  await expect.poll(async () => changedPixels(page, before, await eyeSurfaceScreenshot(page),
    undefined, 25), { timeout: 10_000 }).toBeLessThan(95);
  for (const id of ["gazeX", "gazeY", "turnX", "turnY"])
    await expect(page.locator(`#${id}`)).toHaveValue("0");
  expect(diagnostics.get(page)).toEqual([]);
});

test("poke diameter changes the held dent and beam diameter changes the actual spotlight", async ({ page }) => {
  await openEye(page, { finish: "chrome" });
  const canvas = page.locator("#eyeCanvas"), pokeSize = page.locator("#pokeDiameter");
  const beamSize = page.locator("#flashDiameter"), marker = page.locator("#flashlightMarker");
  await page.locator("#pokeMode").click();
  const box = await canvas.boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await pokeSize.fill("0.12");
  await expect(page.locator("#pokeDiameterOut")).toHaveText("12% eye");
  const resting = await canvas.screenshot();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(170);
  const narrow = await canvas.screenshot();
  await pokeSize.fill("0.92");
  await expect(page.locator("#pokeDiameterOut")).toHaveText("92% eye");
  await expect.poll(async () => changedPixels(page, narrow, await canvas.screenshot(),
    [0.30, 0.22, 0.70, 0.79], 32), { timeout: 10_000 }).toBeGreaterThan(150);
  await page.mouse.up();
  await expect.poll(async () => changedPixels(page, resting, await canvas.screenshot(),
    undefined, 25), { timeout: 10_000 }).toBeLessThan(95);
  await page.locator("#flashlightMode").click();
  await expect(marker).toBeVisible();
  await beamSize.fill("0.12");
  const small = await marker.boundingBox();
  await expect(page.locator("#flashDiameterOut")).toHaveText("12% eye");
  await beamSize.fill("1.2");
  const large = await marker.boundingBox();
  expect(large.width).toBeGreaterThan(small.width * 5);
  await expect(page.locator("#flashDiameterOut")).toHaveText("120% eye");
  await expect(page.locator("#gazeX")).toHaveValue("0");
  await page.locator("#stageReset").click();
  await expect(pokeSize).toHaveValue("0.42");
  await expect(beamSize).toHaveValue("0.43");
  await expect(marker).toBeHidden();
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  expect(diagnostics.get(page)).toEqual([]);
});

test("Poke depth controls a held physical dent independently of diameter and resets cleanly", async ({ page }, testInfo) => {
  await openEye(page);
  const canvas = page.locator("#eyeCanvas"), depth = page.locator("#pokeDepth");
  const box = await canvas.boundingBox();
  await page.locator("#pokeMode").click();
  await depth.fill("0");
  const resting = await canvas.screenshot();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(170);
  expect(await changedPixels(page, resting, await canvas.screenshot(), undefined, 28))
    .toBeLessThan(100);
  await depth.fill("1");
  await expect.poll(async () => changedPixels(page, resting, await canvas.screenshot(),
    [0.34, 0.22, 0.68, 0.8], 30), { timeout: 10_000 }).toBeGreaterThan(170);
  const medium = await canvas.screenshot();
  await depth.fill("1.5");
  await expect.poll(async () => changedPixels(page, medium, await canvas.screenshot(),
    [0.34, 0.22, 0.68, 0.8], 28), { timeout: 10_000 }).toBeGreaterThan(100);
  await expect(page.locator("#pokeDepthOut")).toHaveText("150% depth");
  await testInfo.attach("oculoid-deep-poke.png", { body: await canvas.screenshot(), contentType: "image/png" });
  await page.mouse.up();
  await page.locator("#stageReset").click();
  await expect(depth).toHaveValue("1");
  await expect(page.locator("#pokeMode")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#pokeDiameter")).toHaveValue("0.42");
  expect(diagnostics.get(page)).toEqual([]);
});

test("visual dress-up follows the rotating rig and colors only the moving lid lips", async ({ page }, testInfo) => {
  await openEye(page, { finish: "chrome" });
  const canvas = page.locator("#eyeCanvas");
  const bare = await canvas.screenshot({ path: testInfo.outputPath("oculoid-undressed.png") });
  for (const id of ["sunglasses", "cigar", "mustache", "coat", "scarf", "lipstick"])
    await expect(page.locator(`#${id}`)).not.toBeChecked();
  await page.locator("#sunglasses").check();
  const glasses = await canvas.screenshot({ path: testInfo.outputPath("oculoid-sunglasses.png") });
  expect(await changedPixels(page, bare, glasses, [0.27, 0.12, 0.73, 0.55], 28))
    .toBeGreaterThan(100);
  expect(await changedPixels(page, bare, glasses, [0.488, 0.05, 0.512, 0.14], 24),
    "the sunglasses have a visible bridge joining the two frames").toBeGreaterThan(20);
  await page.locator("#lipstick").check();
  await page.locator("#lipstickColor").fill("#e42d64");
  const lips = await canvas.screenshot();
  expect(await changedPixels(page, glasses, lips, [0.2, 0.24, 0.8, 0.78], 25))
    .toBeGreaterThan(200);
  await page.locator("#cigar").check();
  const withCigar = await canvas.screenshot();
  expect(await changedPixels(page, lips, withCigar, [0.36, 0.26, 0.78, 0.75], 25))
    .toBeGreaterThan(100);
  await page.locator("#mustache").check();
  const withMustache = await canvas.screenshot({
    path: testInfo.outputPath("oculoid-before-coat.png"),
  });
  expect(await changedPixels(page, withCigar, withMustache, [0.3, 0.02, 0.7, 0.18], 30),
    "the mustache should rest above the upper lid, not on the iris").toBeGreaterThan(400);
  await page.locator("#coat").check();
  const withCoat = await canvas.screenshot({
    path: testInfo.outputPath("oculoid-with-coat.png"),
  });
  for (const side of [[0.09, 0.42, 0.21, 0.58], [0.79, 0.42, 0.91, 0.58]]) {
    expect(await changedPixels(page, withMustache, withCoat, side, 24),
      "both coat shoulders reach the equator at the sides of the eye").toBeGreaterThan(100);
  }
  expect(await changedPixels(page, withMustache, withCoat, [0.35, 0.33, 0.65, 0.55], 24),
    "the coat must leave the eyelid and lashes visible in the center").toBeLessThan(50);
  await page.locator("#scarf").check();
  const dressed = await canvas.screenshot({ path: testInfo.outputPath("oculoid-dressed.png") });
  expect(await changedPixels(page, withMustache, dressed, [0.2, 0.57, 0.8, 0.98], 24))
    .toBeGreaterThan(100);
  await page.locator("#gazeX").fill("0.5");
  expect(await changedPixels(page, dressed, await canvas.screenshot(), [0.33, 0.24, 0.78, 0.76], 25))
    .toBeGreaterThan(200);
  await page.locator("#hideLids").click();
  const naked = await canvas.screenshot();
  await page.locator("#sunglasses").uncheck();
  const withoutGlasses = await canvas.screenshot();
  expect(await changedPixels(page, naked, withoutGlasses, [0.24, 0.15, 0.76, 0.72], 25),
    "sunglasses must remain on the bare eye when the lid shell hides").toBeGreaterThan(100);
  for (const id of ["mustache", "coat", "scarf", "lipstick"])
    await page.locator(`#${id}`).uncheck();
  expect(await changedPixels(page, withoutGlasses, await canvas.screenshot(), undefined, 24))
    .toBeLessThan(70);
  await page.locator("#cigar").uncheck();
  expect(await changedPixels(page, naked, await canvas.screenshot(), [0.3, 0.2, 0.85, 0.78], 24))
    .toBeGreaterThan(90);
  await page.locator("#stageReset").click();
  for (const id of ["sunglasses", "cigar", "mustache", "coat", "scarf", "lipstick"])
    await expect(page.locator(`#${id}`)).not.toBeChecked();
  await expect(page.locator("#lipstickColor")).toHaveValue("#bb476c");
  expect(diagnostics.get(page)).toEqual([]);
});

test("sunglasses follow the upper lid through a blink and rest on the bare globe", async ({ page }, testInfo) => {
  await openEye(page, { finish: "chrome" });
  const canvas = page.locator("#eyeCanvas");
  const centers = [];
  for (const blink of ["-1", "0.04", "1"]) {
    await page.locator("#blink").fill(blink);
    const undressed = await canvas.screenshot();
    await page.locator("#sunglasses").check();
    const dressed = await canvas.screenshot({
      path: testInfo.outputPath(`oculoid-glasses-blink-${blink}.png`),
    });
    centers.push(await eyewearFootprint(page, undressed, dressed));
    await page.locator("#sunglasses").uncheck();
  }
  expect(centers.every(({ count }) => count > 180), "the glasses remain visible through the blink")
    .toBe(true);
  expect(centers[1].y - centers[0].y,
    "opening the upper lid lifts the glasses").toBeGreaterThan(12);
  expect(centers[2].y - centers[1].y,
    "closing the upper lid carries the glasses down, not just the lid beneath them").toBeGreaterThan(55);

  await page.locator("#sunglasses").check();
  await page.locator("#hideLids").click();
  await expect(page.locator("#sunglasses")).toBeChecked();
  const bareDressed = await canvas.screenshot({
    path: testInfo.outputPath("oculoid-glasses-without-lids.png"),
  });
  await page.locator("#sunglasses").uncheck();
  const barePlain = await canvas.screenshot();
  const bare = await eyewearFootprint(page, barePlain, bareDressed);
  expect(bare.count, "the glasses dress the bare eyeball").toBeGreaterThan(180);
  expect(bare.y, "the bare frames should rest over the globe, not at the shut lid").toBeLessThan(centers[2].y - 25);
  await page.locator("#blink").fill("-1");
  await page.locator("#sunglasses").check();
  expect(await changedPixels(page, bareDressed, await canvas.screenshot(), undefined, 25),
    "a hidden lid cannot pull the bare-eye glasses around").toBeLessThan(90);
  await page.locator("#hideLids").click();
  await expect(page.locator("#sunglasses")).toBeChecked();
  await page.locator("#stageReset").click();
  await expect(page.locator("#sunglasses")).not.toBeChecked();
  await expect(page.locator("#hideLids")).toHaveAttribute("aria-pressed", "false");
  expect(diagnostics.get(page)).toEqual([]);
});

test("Groucho is one high glasses-nose-mustache costume, not three competing props", async ({ page }, testInfo) => {
  await openEye(page, { finish: "chrome" });
  const canvas = page.locator("#eyeCanvas"), costume = page.locator("#groucho");
  await expect(costume).not.toBeChecked();
  await page.locator("#sunglasses").check();
  await page.locator("#mustache").check();
  const separate = await canvas.screenshot();
  await costume.check();
  const disguise = await canvas.screenshot({
    path: testInfo.outputPath("oculoid-groucho-disguise.png"),
  });
  expect(await changedPixels(page, separate, disguise, [0.22, 0.06, 0.78, 0.55], 28),
    "the nose, round glasses and bushy mustache must replace the aviators").toBeGreaterThan(400);
  await page.locator("#sunglasses").uncheck();
  await page.locator("#mustache").uncheck();
  expect(await changedPixels(page, disguise, await canvas.screenshot(), undefined, 25),
    "separate switches do not draw over the one-piece costume").toBeLessThan(95);
  const atRest = await canvas.screenshot();
  await page.locator("#blink").fill("0.7");
  expect(await changedPixels(page, atRest, await canvas.screenshot(), [0.2, 0.07, 0.8, 0.68], 27))
    .toBeGreaterThan(600);
  await page.locator("#hideLids").click();
  const bare = await canvas.screenshot();
  await costume.uncheck();
  expect(await changedPixels(page, bare, await canvas.screenshot(), [0.2, 0.13, 0.8, 0.72], 27),
    "the Groucho nose and glasses remain on a bare globe").toBeGreaterThan(400);
  await page.locator("#hideLids").click();
  await page.locator("#sunglasses").check();
  await page.locator("#mustache").check();
  await expect(costume).not.toBeChecked();
  const restored = await canvas.screenshot();
  await costume.check();
  expect(await changedPixels(page, restored, await canvas.screenshot(), undefined, 25),
    "the one-piece costume replaces the restored separate switches").toBeGreaterThan(400);
  await costume.uncheck();
  expect(await changedPixels(page, restored, await canvas.screenshot(), undefined, 25),
    "removing the costume restores the separate props without moving them").toBeLessThan(95);
  await page.locator("#stageReset").click();
  for (const id of ["sunglasses", "mustache", "groucho"])
    await expect(page.locator(`#${id}`)).not.toBeChecked();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  expect(diagnostics.get(page)).toEqual([]);
});

test("the licensed aviators render instead of the procedural fallback, which remains usable", async ({ page, context }, testInfo) => {
  const loaded = page.waitForResponse(response => response.url().endsWith("/aviator-sunglasses.glb")
    && response.ok());
  await openEye(page, { finish: "chrome" });
  await loaded;
  await page.locator("#sunglasses").check();
  const fallbackPage = await context.newPage();
  try {
    // A successful request with invalid optional geometry exercises the
    // fallback without producing an expected 404 in the page diagnostics.
    await fallbackPage.route("**/assets/oculoid/aviator-sunglasses.glb", route =>
      route.fulfill({ status: 200, contentType: "model/gltf-binary", body: "invalid glb" }));
    await openEye(fallbackPage, { finish: "chrome" });
    await fallbackPage.locator("#sunglasses").check();
    const fallback = await fallbackPage.locator("#eyeCanvas").screenshot({
      path: testInfo.outputPath("oculoid-fallback-glasses.png"),
    });
    await expect.poll(async () => changedPixels(page, fallback,
      await page.locator("#eyeCanvas").screenshot(), [0.24, 0.04, 0.76, 0.63], 32),
    { timeout: 15_000 }).toBeGreaterThan(1000);
    await page.locator("#eyeCanvas").screenshot({
      path: testInfo.outputPath("oculoid-imported-aviators.png"),
    });
    expect(diagnostics.get(fallbackPage)).toEqual([]);
  } finally {
    await fallbackPage.close();
  }
  expect(diagnostics.get(page)).toEqual([]);
});

test("hats, cat ears, tie and tail remain visible when the shell is removed", async ({ page }, testInfo) => {
  await openEye(page, { finish: "chrome" });
  const canvas = page.locator("#eyeCanvas");
  const bare = await canvas.screenshot();
  await page.locator("#hatStyle").selectOption("top");
  const topHat = await canvas.screenshot({ path: testInfo.outputPath("oculoid-top-hat.png") });
  expect(await changedPixels(page, bare, topHat, [0.28, 0.02, 0.72, 0.32], 32))
    .toBeGreaterThan(400);
  await page.locator("#hatStyle").selectOption("cowboy");
  const cowboy = await canvas.screenshot({ path: testInfo.outputPath("oculoid-cowboy-hat.png") });
  expect(await changedPixels(page, topHat, cowboy, [0.28, 0.02, 0.72, 0.34], 32))
    .toBeGreaterThan(400);
  await page.locator("#hatStyle").selectOption("none");
  await page.locator("#catEars").check();
  const ears = await canvas.screenshot({ path: testInfo.outputPath("oculoid-cat-ears.png") });
  expect(await changedPixels(page, bare, ears, [0.2, 0.03, 0.8, 0.35], 32))
    .toBeGreaterThan(400);
  await page.locator("#bowTie").check();
  const tied = await canvas.screenshot({ path: testInfo.outputPath("oculoid-bow-tie.png") });
  expect(await changedPixels(page, ears, tied, [0.3, 0.68, 0.7, 0.96], 28))
    .toBeGreaterThan(140);
  await page.locator("#tail").check();
  const dressed = await canvas.screenshot({ path: testInfo.outputPath("oculoid-cat-tail.png") });
  expect(await changedPixels(page, tied, dressed, [0.59, 0.46, 0.96, 0.94], 28))
    .toBeGreaterThan(140);
  await page.locator("#turnX").fill("72");
  await page.locator("#turnY").fill("-48");
  expect(await changedPixels(page, dressed, await canvas.screenshot(), undefined, 26),
    "ears, tie and tail must rotate with the whole rig").toBeGreaterThan(1500);
  await page.locator("#turnX").fill("0");
  await page.locator("#turnY").fill("0");
  await page.locator("#hatStyle").selectOption("cowboy");
  await page.locator("#hideLids").click();
  const bareWithAccessories = await canvas.screenshot();
  await page.locator("#hatStyle").selectOption("none");
  expect(await changedPixels(page, bareWithAccessories, await canvas.screenshot(),
    [0.28, 0.02, 0.72, 0.32], 27),
  "Hide lids leaves the selected hat on the bare eyeball").toBeGreaterThan(150);
  const bareWithoutHat = await canvas.screenshot();
  await page.locator("#tail").uncheck();
  expect(await changedPixels(page, bareWithoutHat, await canvas.screenshot(),
    [0.6, 0.45, 0.97, 0.96], 28)).toBeGreaterThan(140);
  await page.locator("#bowTie").uncheck();
  await page.locator("#catEars").uncheck();
  await page.locator("#hatStyle").selectOption("none");
  await page.locator("#stageReset").click();
  for (const id of ["tail", "bowTie", "catEars"])
    await expect(page.locator(`#${id}`)).not.toBeChecked();
  await expect(page.locator("#hatStyle")).toHaveValue("none");
  await expect(page.locator("#hideLids")).toHaveAttribute("aria-pressed", "false");
  expect(await changedPixels(page, bare, await canvas.screenshot(), undefined, 24))
    .toBeLessThan(90);
  expect(diagnostics.get(page)).toEqual([]);
});

test("new hats, layered hair and face accessories change the rig without touching Audio", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await openEye(page, { finish: "chrome" });
  const canvas = page.locator("#eyeCanvas"), hat = page.locator("#hatStyle");
  const original = await canvas.screenshot();
  let previous = original;
  for (const style of ["frosting", "cherry", "cat"]) {
    await hat.selectOption(style);
    const dressed = await canvas.screenshot({
      path: testInfo.outputPath(`oculoid-${style}-hat.png`),
    });
    expect(await changedPixels(page, previous, dressed, [0.27, 0.02, 0.73, 0.45], 30),
      `${style} hat must be distinct from the preceding look`).toBeGreaterThan(300);
    previous = dressed;
  }
  await page.locator("#hatSize").fill("1.5");
  await expect(page.locator("#hatSizeOut")).toHaveText("150%");
  expect(await changedPixels(page, previous, await canvas.screenshot(), [0.25, 0.02, 0.75, 0.6], 27),
    "hat size changes the actual rendered hat").toBeGreaterThan(200);
  await hat.selectOption("none");
  for (const [id, crop] of [["humanEars", [0.13, 0.2, 0.87, 0.75]],
    ["catEars", [0.2, 0.03, 0.8, 0.43]],
    ["tail", [0.58, 0.4, 0.97, 0.96]],
    ["headband", [0.25, 0.04, 0.75, 0.45]]]) {
    await page.locator(`#${id}`).check();
    expect(await changedPixels(page, original, await canvas.screenshot(), crop, 27),
      `${id} must occupy visible 3D space`).toBeGreaterThan(150);
    await page.locator(`#${id}`).uncheck();
  }
  let hairless = await canvas.screenshot();
  for (const style of ["mullet", "mom-bob"]) {
    await page.locator("#hairStyle").selectOption(style);
    const haired = await canvas.screenshot({
      path: testInfo.outputPath(`oculoid-${style}.png`),
    });
    expect(await changedPixels(page, hairless, haired, [0.22, 0.03, 0.78, 0.55], 29))
      .toBeGreaterThan(350);
    hairless = haired;
  }
  await page.locator("#hairStyle").selectOption("none");
  await page.locator("#bowTie").check();
  const oldColor = await canvas.screenshot();
  await page.locator("#bowTieColor").fill("#29daa5");
  expect(await changedPixels(page, oldColor, await canvas.screenshot(),
    [0.3, 0.66, 0.7, 0.96], 27),
  "the color picker recolors the bow in front of the lid").toBeGreaterThan(120);
  await page.locator("#stageReset").click();
  await expect(hat).toHaveValue("none");
  await expect(page.locator("#hatSize")).toHaveValue("1");
  await expect(page.locator("#hairStyle")).toHaveValue("none");
  await expect(page.locator("#bowTieColor")).toHaveValue("#9c3457");
  await expect(page.locator("#bowTie")).not.toBeChecked();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  expect(diagnostics.get(page)).toEqual([]);
});

test("the mustache perches on the upper lashes during blinks, not on the wandering pupil", async ({ page }) => {
  await openEye(page, { finish: "chrome" });
  const canvas = page.locator("#eyeCanvas");
  await page.locator("#mustache").check();
  const atRest = await canvas.screenshot();
  await page.locator("#gazeX").fill("0.75");
  await page.locator("#gazeY").fill("0.6");
  await page.locator("#pupil").fill("0.9");
  const lookingAway = await canvas.screenshot();
  expect(await changedPixels(page, atRest, lookingAway, [0.32, 0.025, 0.68, 0.13], 30),
    "gaze and dilation must not move the lash-mounted mustache").toBeLessThan(80);
  await page.locator("#blink").fill("0.6");
  const blinking = await canvas.screenshot();
  expect(await changedPixels(page, lookingAway, blinking, [0.3, 0.02, 0.7, 0.18], 30),
    "the mustache must leave its resting position with the upper lid").toBeGreaterThan(400);
  await page.locator("#mustache").uncheck();
  expect(await changedPixels(page, blinking, await canvas.screenshot(), [0.27, 0.15, 0.73, 0.67], 30),
    "the mustache must remain visible on the descending lashes").toBeGreaterThan(400);
  await page.locator("#mustache").check();
  await page.locator("#hideLids").click();
  const withoutLids = await canvas.screenshot();
  await page.locator("#mustache").uncheck();
  expect(await changedPixels(page, withoutLids, await canvas.screenshot(), undefined, 24),
    "the mustache cannot remain on the bare eyeball").toBeLessThan(70);
  await page.locator("#hideLids").click();
  await page.locator("#mustache").check();
  expect(await changedPixels(page, withoutLids, await canvas.screenshot(), undefined, 30))
    .toBeGreaterThan(400);
  expect(diagnostics.get(page)).toEqual([]);
});

async function touchingEyePixels(page, image, count) {
  return page.evaluate(async ({ png, count }) => {
    const { eyeClusterLayout, lidCameraDistance } = await import("/src/instruments/oculoid/oculoid-model.js");
    const bitmap = await createImageBitmap(new Blob(
      [Uint8Array.from(atob(png), char => char.charCodeAt(0))], { type: "image/png" }));
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    context.drawImage(bitmap, 0, 0); bitmap.close();
    const { width, height } = canvas, pixels = context.getImageData(0, 0, width, height).data;
    const focal = height / (2 * Math.tan(18 * Math.PI / 180));
    const cameraZ = lidCameraDistance(width / height);
    const layout = eyeClusterLayout(count), contacts = [];
    for (let i = 0; i < layout.length; i++) for (let j = 0; j < i; j++) {
      const a = layout[i], b = layout[j];
      if (Math.abs(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) - a.scale - b.scale) > 1e-6) continue;
      const x = Math.round(width / 2 + (a.x + b.x) / 2 * focal / (cameraZ - a.z));
      const y = Math.round(height / 2 - (a.y + b.y) / 2 * focal / (cameraZ - a.z));
      let eyePixels = 0;
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const index = ((y + dy) * width + x + dx) * 4;
        const [red, green, blue] = pixels.slice(index, index + 3);
        if (red > 30 && red > green + 12 && red > blue + 12) eyePixels++;
      }
      contacts.push(eyePixels);
    }
    return contacts;
  }, { png: image.toString("base64"), count });
}

test("one sheath holds a touching pair, triangle or square without changing saved presets", async ({ page }, testInfo) => {
  await openEye(page, { finish: "chrome" });
  const canvas = page.locator("#eyeCanvas"), count = page.locator("#eyeCount");
  const musical = await page.locator("#gazeX").inputValue();
  const initial = await canvas.screenshot();
  await expect(count).toHaveValue("1");
  let previous = initial;
  for (const n of [2, 3, 4]) {
    await count.fill(String(n));
    const image = await canvas.screenshot({ path: testInfo.outputPath(`oculoid-${n}-eyes.png`) });
    expect(await changedPixels(page, previous, image, [0.2, 0.28, 0.8, 0.7], 32),
      `${n} eyes should be visibly different from the preceding arrangement`).toBeGreaterThan(2000);
    const contacts = await touchingEyePixels(page, image, n);
    expect(contacts, `${n} eyes must have visible contact along each shared edge`)
      .toHaveLength({ 2: 1, 3: 3, 4: 4 }[n]);
    for (const pixels of contacts)
      expect(pixels, `${n} eyes must meet on the rendered globe, not just in layout coordinates`)
        .toBeGreaterThan(1);
    previous = image;
  }
  await page.locator("#eyeLook").selectOption("ink");
  expect(await changedPixels(page, previous, await canvas.screenshot(), undefined, 30))
    .toBeGreaterThan(400);
  await page.locator("#eyeLook").selectOption("textured");
  await count.fill("2");
  const pair = await canvas.screenshot();
  await page.locator("#gazeX").fill("0.62");
  expect(await changedPixels(page, pair, await canvas.screenshot(), [0.28, 0.28, 0.73, 0.73], 30))
    .toBeGreaterThan(400);
  await page.locator("#gazeX").fill("0");
  await page.locator("#pokeMode").click();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width * 0.35, box.y + box.height / 2);
  await page.mouse.down();
  await expect.poll(async () => changedPixels(page, pair, await canvas.screenshot(),
    [0.29, 0.32, 0.45, 0.7], 30), { timeout: 10_000 }).toBeGreaterThan(100);
  await page.mouse.up();
  await expect(page.locator("#gazeX")).toHaveValue("0");
  await page.locator("#blink").fill("1");
  await page.locator("#lowerLid").fill("-1");
  const closed = await canvas.screenshot();
  await page.locator("#lidRetractor").click();
  expect(await changedPixels(page, closed, await canvas.screenshot(), undefined, 30))
    .toBeGreaterThan(1000);
  await page.locator("#hideLids").click();
  await count.fill("4");
  await expect(page.locator("#eyeCount")).toHaveValue("4");
  await page.locator("#stageReset").click();
  await expect(count).toHaveValue("1");
  expect(await changedPixels(page, initial, await canvas.screenshot(), undefined, 30))
    .toBeLessThan(130);
  expect(await page.locator("#gazeX").inputValue()).toBe(musical);
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  expect(diagnostics.get(page)).toEqual([]);
});

test("five through twelve eyeballs fill the same moving socket on the live count knob", async ({ page }, testInfo) => {
  test.setTimeout(140_000);
  await openEye(page, { finish: "chrome" });
  const canvas = page.locator("#eyeCanvas"), count = page.locator("#eyeCount");
  await expect(count).toHaveAttribute("min", "1");
  await expect(count).toHaveAttribute("max", "12");
  await page.locator("#scleraColor").selectOption("coral");
  let previous = await canvas.screenshot();
  for (let number = 5; number <= 12; number++) {
    await count.fill(String(number));
    await expect(page.locator("#eyeCountOut")).toHaveText(`${number} eyes`);
    const cluster = await canvas.screenshot({
      path: number === 5 || number === 12
        ? testInfo.outputPath(`oculoid-${number}-eye-cluster.png`) : undefined,
    });
    expect(await changedPixels(page, previous, cluster, [0.2, 0.18, 0.8, 0.81], 31),
      `the ${number}-eye cluster must differ from the previous arrangement`).toBeGreaterThan(500);
    previous = cluster;
  }
  await page.locator("#blink").fill("1");
  await page.locator("#lowerLid").fill("-1");
  const closed = await canvas.screenshot();
  await page.locator("#lidRetractor").click();
  expect(await changedPixels(page, closed, await canvas.screenshot(), undefined, 30),
    "the retractor must expose all twelve eyes without changing their count").toBeGreaterThan(1000);
  await page.locator("#eyeballStyle").selectOption("wild");
  await page.locator("#motionButton").click();
  const rest = await canvas.screenshot();
  await expect.poll(async () => changedPixels(page, rest, await canvas.screenshot(),
    [0.2, 0.15, 0.8, 0.84], 27), { timeout: 15_000 }).toBeGreaterThan(250);
  await page.locator("#motionButton").click();
  await page.locator("#stageReset").click();
  await expect(count).toHaveValue("1");
  await expect(page.locator("#scleraColor")).toHaveValue("pearl");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  expect(diagnostics.get(page)).toEqual([]);
});

test("paused multi-eye bands keep individual gaze directions until Together is selected", async ({ page }) => {
  await openEye(page, { finish: "chrome" });
  const canvas = page.locator("#eyeCanvas");
  await page.locator("#blink").fill("-1");
  await page.locator("#lowerLid").fill("1");
  for (const count of [3, 6, 10]) {
    await page.locator("#eyeCount").fill(String(count));
    const banter = await canvas.screenshot();
    await page.locator("#ensembleStyle").selectOption("together");
    const together = await canvas.screenshot();
    expect(await changedPixels(page, banter, together, [0.2, 0.18, 0.8, 0.83], 26),
      `${count} paused eyes must not all stare the same way in Banter`).toBeGreaterThan(100);
    await page.locator("#ensembleStyle").selectOption("banter");
    expect(await changedPixels(page, banter, await canvas.screenshot(), undefined, 25),
      `${count} paused gazes return to their own positions`).toBeLessThan(100);
  }
  await expect(page.locator("#motionButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  expect(diagnostics.get(page)).toEqual([]);
});

test("bigger clustered eyes take their own gaze parts while lids keep a separate loop speed", async ({ page }, testInfo) => {
  await openEye(page, { finish: "chrome" });
  const canvas = page.locator("#eyeCanvas");
  await page.locator("#eyeCount").fill("4");
  await page.locator("#blink").fill("-1");
  await page.locator("#lowerLid").fill("1");
  await page.locator("#eyeballStyle").selectOption("still");
  await page.locator("#eyelidStyle").selectOption("flutter");
  await page.locator("#motion").fill("1");
  await page.locator("#lidRate").fill("1.5");
  await expect(page.locator("#lidRateOut")).toHaveText("1.5×");
  const atRest = await canvas.screenshot();
  await page.locator("#motionButton").click();
  await expect.poll(async () => changedPixels(page, atRest, await canvas.screenshot()),
    { timeout: 10_000 }).toBeGreaterThan(350);
  await page.locator("#eyelidStyle").selectOption("still");
  await page.waitForTimeout(160);
  const still = await canvas.screenshot();
  await page.waitForTimeout(190);
  expect(await changedPixels(page, still, await canvas.screenshot(), undefined, 30),
    "Still on both engines holds the whole multi-eye band").toBeLessThan(90);
  await page.locator("#eyeballStyle").selectOption("drift");
  await expect.poll(async () => changedPixels(page, still, await canvas.screenshot(),
    [0.22, 0.15, 0.78, 0.82], 28), { timeout: 10_000 }).toBeGreaterThan(500);
  const banter = await canvas.screenshot({
    path: testInfo.outputPath("oculoid-four-eye-banter.png"),
  });
  await page.locator("#ensembleStyle").selectOption("together");
  expect(await changedPixels(page, banter, await canvas.screenshot(),
    [0.22, 0.2, 0.78, 0.8], 28)).toBeGreaterThan(150);
  await page.locator("#ensembleStyle").selectOption("rock");
  await expect(page.locator("#eyeballStyle")).toHaveValue("drift");
  await expect(page.locator("#lidRate")).toHaveValue("1.5");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await page.locator("#stageReset").click();
  await expect(page.locator("#eyeCount")).toHaveValue("1");
  await expect(page.locator("#ensembleStyle")).toHaveValue("banter");
  await expect(page.locator("#lidRate")).toHaveValue("1");
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  expect(diagnostics.get(page)).toEqual([]);
});

test("teeth and tongue sit behind moving lips, retract when closed and leave with Hide lids", async ({ page }, testInfo) => {
  await openEye(page, { finish: "chrome" });
  const canvas = page.locator("#eyeCanvas");
  const bare = await canvas.screenshot();
  for (const id of ["teeth", "tongue"]) await expect(page.locator(`#${id}`)).not.toBeChecked();
  await page.locator("#teeth").check();
  const teeth = await canvas.screenshot();
  expect(await changedPixels(page, bare, teeth, [0.27, 0.25, 0.73, 0.75], 30))
    .toBeGreaterThan(150);
  await page.locator("#tongue").check();
  const mouth = await canvas.screenshot({ path: testInfo.outputPath("oculoid-teeth-tongue.png") });
  expect(await changedPixels(page, teeth, mouth, [0.27, 0.25, 0.73, 0.78], 30))
    .toBeGreaterThan(100);
  expect(await changedPixels(page, teeth, mouth, [0.39, 0.79, 0.61, 0.95], 28),
    "the tongue should hang below the lower lip like a dog's").toBeGreaterThan(100);
  await page.locator("#coat").check();
  const coatAndTongue = await canvas.screenshot({
    path: testInfo.outputPath("oculoid-coat-tongue.png"),
  });
  await page.locator("#tongue").uncheck();
  expect(await changedPixels(page, coatAndTongue, await canvas.screenshot(),
    [0.39, 0.76, 0.61, 0.95], 28),
  "the open coat should not conceal the hanging tongue").toBeGreaterThan(100);
  await page.locator("#coat").uncheck();
  await page.locator("#blink").fill("0.7");
  const midBlink = await canvas.screenshot();
  await page.locator("#teeth").uncheck();
  const noTeeth = await canvas.screenshot();
  expect(await changedPixels(page, midBlink, noTeeth, [0.3, 0.5, 0.7, 0.78], 25),
    "teeth should still show inside a half-open mouth").toBeGreaterThan(50);
  expect(await changedPixels(page, midBlink, noTeeth, [0.25, 0.2, 0.75, 0.48], 25),
    "teeth must not protrude above the closing lip").toBeLessThan(50);
  await page.locator("#teeth").check();
  await page.locator("#tongue").check();
  await page.locator("#blink").fill("1");
  await page.locator("#lowerLid").fill("-1");
  const shut = await canvas.screenshot();
  await page.locator("#teeth").uncheck();
  await page.locator("#tongue").uncheck();
  expect(await changedPixels(page, shut, await canvas.screenshot(), undefined, 25))
    .toBeLessThan(90);
  await page.locator("#blink").fill("0.04");
  await page.locator("#lowerLid").fill("0");
  await page.locator("#teeth").check();
  await page.locator("#tongue").check();
  await page.locator("#hideLids").click();
  const hidden = await canvas.screenshot();
  await page.locator("#teeth").uncheck();
  await page.locator("#tongue").uncheck();
  expect(await changedPixels(page, hidden, await canvas.screenshot(), undefined, 25))
    .toBeLessThan(90);
  await page.locator("#stageReset").click();
  for (const id of ["teeth", "tongue"]) await expect(page.locator(`#${id}`)).not.toBeChecked();
  await expect(page.locator("#hideLids")).toHaveAttribute("aria-pressed", "false");
  expect(await changedPixels(page, bare, await canvas.screenshot(), undefined, 30))
    .toBeLessThan(130);
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  expect(diagnostics.get(page)).toEqual([]);
});

test("surface tools select the touched globe rather than deforming the entire two-eye sheath", async ({ page }) => {
  await openEye(page, { finish: "chrome" });
  await page.locator("#eyeCount").fill("2");
  await page.locator("#hideLids").click();
  await page.locator("#stretchMode").click();
  const canvas = page.locator("#eyeCanvas"), marker = page.locator("#surfaceMarker");
  const box = await canvas.boundingBox();
  const select = async fraction => {
    await page.mouse.move(box.x + box.width * fraction, box.y + box.height / 2);
    await page.mouse.down();
    await expect(marker).toBeVisible();
    const x = await marker.evaluate(element => Number.parseFloat(element.style.left));
    await page.mouse.up();
    return x;
  };
  expect(await select(0.35), "the left globe becomes the active touch surface").toBeLessThan(45);
  expect(await select(0.65), "the right globe becomes the active touch surface").toBeGreaterThan(55);
  await expect(page.locator("#gazeX")).toHaveValue("0");
  await expect(page.locator("#eyeCount")).toHaveValue("2");
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  expect(diagnostics.get(page)).toEqual([]);
});

test("retracting closed lids exposes the globe to Poke and releases it without rewriting lid knobs", async ({ page }) => {
  await openEye(page, { finish: "chrome" });
  const canvas = page.locator("#eyeCanvas"), retract = page.locator("#lidRetractor");
  await page.locator("#blink").fill("1");
  await page.locator("#lowerLid").fill("-1");
  await page.locator("#pokeMode").click();
  const box = await canvas.boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  const shut = await canvas.screenshot();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(140);
  expect(await changedPixels(page, shut, await canvas.screenshot(), undefined, 25))
    .toBeLessThan(70);
  await page.mouse.up();
  await retract.click();
  await expect(retract).toHaveAttribute("aria-pressed", "true");
  const open = await canvas.screenshot();
  expect(await changedPixels(page, shut, open, [0.28, 0.22, 0.72, 0.78], 32))
    .toBeGreaterThan(800);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(210);
  expect(await changedPixels(page, open, await canvas.screenshot(),
    [0.35, 0.26, 0.65, 0.74], 32)).toBeGreaterThan(180);
  await page.mouse.up();
  await retract.click();
  await expect(retract).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#blink")).toHaveValue("1");
  await expect(page.locator("#lowerLid")).toHaveValue("-1");
  await expect.poll(async () => changedPixels(page, shut,
    await canvas.screenshot(), undefined, 25), { timeout: 10_000 }).toBeLessThan(95);
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  expect(diagnostics.get(page)).toEqual([]);
});

test("surface tools work from a focused keyboard and excite only brief audio-clock hits after Audio is armed", async ({ page }) => {
  await page.addInitScript(() => {
    window.surfacePosts = [];
    window.surfaceLevels = [];
    const Worklet = window.AudioWorkletNode;
    window.AudioWorkletNode = class extends Worklet {
      constructor(...args) {
        super(...args);
        if (args[1] !== "oculoid-voice") return;
        const send = this.port.postMessage.bind(this.port);
        this.port.postMessage = message => {
          if (message.type === "surface") window.surfacePosts.push(message);
          send(message);
        };
        this.port.addEventListener("message", ({ data }) => {
          if (data?.type === "level") window.surfaceLevels.push(data.peak);
        });
        this.port.start();
      }
    };
  });
  await openEye(page);
  const canvas = page.locator("#eyeCanvas");
  await page.locator("#stretchMode").click();
  await canvas.focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Enter");
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  await expect(page.locator("#gazeX")).toHaveValue("0");
  await page.locator("#stretchMode").click(); // Clear the unarmed grip before the armed loop.
  await page.locator("#audioButton").click();
  await waitForArmedGraph(page);
  await page.locator("#stretchMode").click();
  await canvas.focus();
  await page.keyboard.press("Enter");
  await expect.poll(async () => page.evaluate(() =>
    window.surfacePosts.some(post => post.kind === "stretch" && !post.cancel && !post.release)),
  { timeout: 7000 }).toBe(true);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect.poll(async () => page.evaluate(() =>
    window.surfacePosts.some(post => post.kind === "stretch" && post.release)),
  { timeout: 7000 }).toBe(true);
  await expect(page.locator("#gazeX")).toHaveValue("0");
  expect(await page.evaluate(() => window.surfacePosts.every(post =>
    post.cancel || post.kind === "stretch"))).toBe(true);
  await expect.poll(async () => page.evaluate(() => Math.max(0, ...window.surfaceLevels)),
    { timeout: 7000 }).toBeGreaterThan(0.007);
  expect((await page.evaluate(() => window.surfacePosts)).length).toBeLessThan(40);
  // The last release is a short event, not a hard mute. Let its ~96 ms
  // envelope and the shared meter's latest peak expire before checking rest.
  await page.waitForTimeout(650);
  const quiet = await sampleEyeAudio(page, 480, 2);
  expect(quiet.summary.maxPeak, "released surface tools must not drone").toBeLessThan(0.002);
  await page.locator("#stageReset").click();
  await expect(page.locator("#stretchMode")).toHaveAttribute("aria-pressed", "false");
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false })));
  await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(0);
  expect(diagnostics.get(page)).toEqual([]);
});

test("Tear fires once and Cry repeats at its own tempo on the audio clock with Motion paused", async ({ page }) => {
  await page.addInitScript(() => {
    window.dropPosts = [];
    window.dropLevels = [];
    const Worklet = window.AudioWorkletNode;
    window.AudioWorkletNode = class extends Worklet {
      constructor(...args) {
        super(...args);
        if (args[1] !== "oculoid-voice") return;
        const send = this.port.postMessage.bind(this.port);
        this.port.postMessage = message => {
          if (["cry", "cry-tempo", "tear"].includes(message.type)) window.dropPosts.push(message);
          send(message);
        };
        this.port.addEventListener("message", ({ data }) => {
          if (data?.type === "level") window.dropLevels.push(data.peak);
        });
        this.port.start();
      }
    };
  });
  await openEye(page);
  await page.locator("#tempo").fill("35");
  await page.locator("#cryTempo").fill("200");
  await page.locator("#wetness").fill("1");
  await page.locator("#cryMode").click();
  await expect(page.locator("#motionButton")).toHaveAttribute("aria-pressed", "false");
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  await page.locator("#cryMode").click();
  await page.locator("#audioButton").click();
  await waitForArmedGraph(page);
  await expect.poll(async () => page.evaluate(() => window.dropPosts.some(post =>
    post.type === "cry-tempo" && post.tempo === 200)), { timeout: 7000 }).toBe(true);
  await page.locator("#tearOnce").click();
  await expect.poll(async () => page.evaluate(() => window.dropPosts.some(post => post.type === "tear"
    && post.size === 1)), { timeout: 7000 }).toBe(true);
  await expect.poll(async () => page.evaluate(() => Math.max(0, ...window.dropLevels)),
    { message: "one Tear must excite the armed audio worklet", timeout: 7000 }).toBeGreaterThan(0.008);
  await page.locator("#cryMode").click();
  await expect.poll(async () => page.evaluate(() => window.dropPosts.some(post =>
    post.type === "cry" && post.active)), { timeout: 7000 }).toBe(true);
  await page.evaluate(() => { window.dropLevels.length = 0; });
  await page.waitForTimeout(3600); // Three 1.2-second cycles at 200 BPM.
  const peaks = await page.evaluate(() => window.dropLevels);
  let hits = 0, high = false;
  for (const peak of peaks) {
    if (peak > 0.008 && !high) { hits++; high = true; }
    if (peak < 0.001) high = false;
  }
  expect(hits, "Cry must repeat short drops even though Motion is paused").toBeGreaterThanOrEqual(2);
  expect(Math.max(0, ...peaks)).toBeLessThan(0.6);
  await expect(page.locator("#cryTempo")).toHaveAttribute("max", "800");
  await expect(page.locator("#tempo")).toHaveAttribute("max", "200");
  await page.locator("#cryTempo").fill("800");
  await expect(page.locator("#cryTempoOut")).toHaveText("800 BPM");
  await expect.poll(async () => page.evaluate(() => window.dropPosts.some(post =>
    post.type === "cry-tempo" && post.tempo === 800)), { timeout: 7000 }).toBe(true);
  await page.evaluate(() => { window.dropLevels.length = 0; });
  await expect.poll(async () => page.evaluate(() => Math.max(0, ...window.dropLevels)),
    { message: "Cry must still sound at 800 BPM", timeout: 7000 }).toBeGreaterThan(0.008);
  expect(Math.max(0, ...await page.evaluate(() => window.dropLevels))).toBeLessThan(0.6);
  await page.locator("#cryMode").click();
  await expect(page.locator("#cryMode")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#motionButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#tempo")).toHaveValue("35");
  await page.locator("#cryTempo").fill("400");
  const tapped = await page.evaluate(() => {
    const tap = document.querySelector('[data-tap-control="#cryTempo"]');
    tap.tap(1000);
    return tap.tap(1075);
  });
  expect(tapped).toBe(800);
  await expect(page.locator("#cryTempo")).toHaveValue("800");
  expect(diagnostics.get(page)).toEqual([]);
});

test("the flashlight lights the visible iris, not a closed lid, without stealing eye gestures", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    window.flashlightPosts = [];
    const Worklet = window.AudioWorkletNode;
    window.AudioWorkletNode = class extends Worklet {
      constructor(...args) {
        super(...args);
        if (args[1] !== "oculoid-voice") return;
        const send = this.port.postMessage.bind(this.port);
        this.port.postMessage = message => {
          if (message.type === "flashlight") window.flashlightPosts.push(message.exposure);
          send(message);
        };
      }
    };
  });
  await openEye(page, { finish: "chrome" });
  const canvas = page.locator("#eyeCanvas"), mode = page.locator("#flashlightMode");
  const marker = page.locator("#flashlightMarker"), power = page.locator("#flashlightPower");
  const box = await canvas.boundingBox();
  const unlit = await canvas.screenshot();
  await mode.click();
  await expect(mode).toHaveAttribute("aria-pressed", "true");
  await expect(marker).toBeVisible();
  await expect.poll(async () => changedPixels(page, unlit, await canvas.screenshot(),
    [0.3, 0.22, 0.7, 0.78], 32), { timeout: 15_000 }).toBeGreaterThan(400);
  await testInfo.attach("oculoid-flashlight-on.png", {
    body: await canvas.screenshot(), contentType: "image/png",
  });
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  await page.locator("#audioButton").click();
  await waitForArmedGraph(page);
  await expect.poll(async () => (await page.evaluate(() => window.flashlightPosts)).at(-1))
    .toBeGreaterThan(0.55);
  const idle = await sampleEyeAudio(page, 450, 2);
  expect(idle.summary.maxPeak, "a held beam must be silent").toBeLessThan(0.002);

  await power.fill("0");
  await expect.poll(async () => (await page.evaluate(() => window.flashlightPosts)).at(-1))
    .toBe(0);
  await power.fill("1");
  await expect.poll(async () => (await page.evaluate(() => window.flashlightPosts)).at(-1))
    .toBeGreaterThan(0.9);
  // Aim just outside the visible iris: a pencil beam misses, but the wide
  // *actual* spotlight reaches an exposed iris patch without moving its aim.
  const diameter = page.locator("#flashDiameter");
  await diameter.fill("0.12");
  await page.mouse.move(box.x + box.width * 0.72, box.y + box.height / 2);
  await expect.poll(async () => (await page.evaluate(() => window.flashlightPosts)).at(-1))
    .toBe(0);
  await diameter.fill("1.2");
  await expect.poll(async () => (await page.evaluate(() => window.flashlightPosts)).at(-1))
    .toBeGreaterThan(0.45);
  await diameter.fill("0.43");
  await page.locator("#blink").fill("1");
  await expect.poll(async () => (await page.evaluate(() => window.flashlightPosts)).at(-1))
    .toBe(0);
  await expect(page.locator("#pupil")).toHaveValue("0.42");
  await page.locator("#blink").fill("0.04");
  await page.mouse.move(box.x + 15, box.y + box.height / 2, { steps: 5 });
  await expect.poll(async () => (await page.evaluate(() => window.flashlightPosts)).at(-1))
    .toBe(0);

  await canvas.focus();
  const beforeKey = await marker.evaluate(element => Number.parseFloat(element.style.left));
  await page.keyboard.press("ArrowRight");
  await expect(marker).toHaveCSS("left", /\d+px/);
  expect(await marker.evaluate(element => Number.parseFloat(element.style.left)))
    .toBeGreaterThan(beforeKey + 3);
  await expect(page.locator("#gazeX")).toHaveValue("0");
  await page.locator("#pokeMode").click();
  await expect(mode).toHaveAttribute("aria-pressed", "false");
  await expect(marker).toBeHidden();
  await expect(page.locator("#pokeMode")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#stageReset").click();
  await expect(power).toHaveValue("0.8");
  await expect(page.locator("#pokeMode")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  expect(diagnostics.get(page)).toEqual([]);
});

test("an explicit Audio arm makes poke pressure and release audible, but holding still is quiet", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const Worklet = window.AudioWorkletNode;
    window.pokePosts = [];
    window.pokeLevels = [];
    window.AudioWorkletNode = class extends Worklet {
      constructor(...args) {
        super(...args);
        if (args[1] !== "oculoid-voice") return;
        const post = this.port.postMessage.bind(this.port);
        this.port.postMessage = (message, ...transfers) => {
          if (message.type === "poke") window.pokePosts.push(message);
          return post(message, ...transfers);
        };
        this.port.addEventListener("message", ({ data }) => {
          if (data?.type === "level") window.pokeLevels.push(data);
        });
        this.port.start();
      }
    };
  });
  await openEye(page);
  await page.locator("#pokeMode").click();
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  await page.locator("#audioButton").click();
  await waitForArmedGraph(page);
  const idle = await sampleEyeAudio(page, 380, 2);
  expect(idle.summary.maxPeak).toBeLessThan(0.002);
  // Tap the final stereo mix *after* its output gain. The shared UI meter's
  // main-thread ticks can miss an attack when software WebGL stalls rendering.
  // This test-only worklet records short windows on the audio clock instead.
  await page.evaluate(async () => {
    const { getSharedAudioOutputManager } = await import("/src/audio-output-manager.js");
    const manager = getSharedAudioOutputManager(globalThis);
    const context = manager.recordingContext();
    if (!context) throw new Error("Oculoid has no running final output");
    const source = `class OculoidOutputProbe extends AudioWorkletProcessor {
      constructor() {
        super(); this.blocks = 0; this.peak = 0; this.square = 0; this.count = 0; this.invalid = 0;
      }
      process(inputs, outputs) {
        for (const channel of outputs[0] || []) channel.fill(0);
        for (const channel of inputs[0] || []) for (const sample of channel) {
          if (!Number.isFinite(sample)) { this.invalid++; continue; }
          this.peak = Math.max(this.peak, Math.abs(sample));
          this.square += sample * sample; this.count++;
        }
        if (++this.blocks % 20 === 0) {
          this.port.postMessage({ peak: this.peak,
            rms: Math.sqrt(this.square / Math.max(1, this.count)), invalid: this.invalid });
          this.peak = this.square = this.count = this.invalid = 0;
        }
        return true;
      }
    } registerProcessor("oculoid-qa-output-probe", OculoidOutputProbe);`;
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    try { await context.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
    const probe = new AudioWorkletNode(context, "oculoid-qa-output-probe", {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
    });
    window.pokeOutputLevels = [];
    probe.port.onmessage = ({ data }) => window.pokeOutputLevels.push(data);
    const release = manager.tapInto(context, probe);
    probe.connect(context.destination); // The probe writes zeros, never a second audible mix.
    window.stopPokeOutput = () => { release(); probe.disconnect(); probe.port.close(); };
  });
  await page.waitForTimeout(130);
  expect(Math.max(0, ...await page.evaluate(() => window.pokeOutputLevels.map(level => level.peak))))
    .toBeLessThan(0.002);
  await page.evaluate(() => { window.pokeOutputLevels.length = window.pokeLevels.length = 0; });
  const box = await page.locator("#eyeCanvas").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(260);
  const press = await page.evaluate(() => ({
    output: window.pokeOutputLevels.splice(0), voice: window.pokeLevels.splice(0),
  }));
  const maxPeak = levels => Math.max(0, ...levels.map(level => level.peak));
  expect((await page.evaluate(() => window.pokePosts)).some(message => message.pressure > 0.1))
    .toBe(true);
  expect(press.output.length).toBeGreaterThan(1);
  expect(press.output.every(level => Number.isFinite(level.peak)
    && Number.isFinite(level.rms) && level.invalid === 0)).toBe(true);
  expect(maxPeak(press.voice)).toBeGreaterThan(0.025);
  expect(maxPeak(press.output), JSON.stringify(press)).toBeGreaterThan(0.005);
  expect(maxPeak(press.output)).toBeLessThan(0.9);

  await page.waitForTimeout(1000);
  const held = await sampleEyeAudio(page, 250, 2);
  const heldOutput = await page.evaluate(() => window.pokeOutputLevels.slice(-3));
  expect(heldOutput.length).toBeGreaterThan(1);
  expect(maxPeak(heldOutput), "holding a dent should fade to silence").toBeLessThan(0.002);
  expect(held.summary.maxPeak).toBeLessThan(0.002);
  await page.evaluate(() => { window.pokeOutputLevels.length = window.pokeLevels.length = 0; });
  await page.mouse.move(box.x + box.width / 2 + 26, box.y + box.height / 2 + 10, { steps: 3 });
  await page.waitForTimeout(210);
  const scrub = await page.evaluate(() => ({
    output: window.pokeOutputLevels.splice(0), voice: window.pokeLevels.splice(0),
  }));
  expect((await page.evaluate(() => window.pokePosts)).some(message => message.travel >= 0.12))
    .toBe(true);
  expect(maxPeak(scrub.output), JSON.stringify(scrub)).toBeGreaterThan(0.005);
  await page.mouse.up();
  await page.waitForTimeout(260);
  const released = await page.evaluate(() => ({
    output: window.pokeOutputLevels.splice(0), voice: window.pokeLevels.splice(0),
  }));
  const messages = await page.evaluate(() => window.pokePosts);
  expect(messages.some(message => message.pressure === 0 && !message.cancel), JSON.stringify(messages))
    .toBe(true);
  expect(maxPeak(released.voice)).toBeGreaterThan(0.025);
  expect(maxPeak(released.output), JSON.stringify(released)).toBeGreaterThan(0.005);
  expect([...press.output, ...scrub.output, ...released.output].every(
    level => Number.isFinite(level.peak) && Number.isFinite(level.rms) && level.invalid === 0,
  )).toBe(true);
  await page.waitForTimeout(760);
  const resting = await sampleEyeAudio(page, 400, 2);
  expect(resting.summary.maxPeak, "the poke has no drone after release").toBeLessThan(0.002);
  await testInfo.attach("oculoid-poke-audio.json", {
    body: JSON.stringify({ idle: idle.summary, pressPeak: maxPeak(press.output),
      scrubPeak: maxPeak(scrub.output), releasePeak: maxPeak(released.output),
      held: held.summary, resting: resting.summary, messages }, null, 2),
    contentType: "application/json",
  });
  await page.evaluate(() => window.stopPokeOutput());
  await page.locator("#audioButton").click();
  await waitForStableAudioState(page, false);
  // Muting retains the graph for an explicit re-arm; page teardown releases it.
  expect((await readAudioStatus(page)).connectionCount).toBe(1);
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false })));
  await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(0);
  expect(diagnostics.get(page)).toEqual([]);
});

test("touch pressure can poke the exposed eye without moving its gaze", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1,
  });
  const phone = await context.newPage();
  try {
    await openEye(phone);
    await phone.locator("#pokeMode").click();
    const canvas = phone.locator("#eyeCanvas"), box = await canvas.boundingBox();
    const original = await canvas.screenshot();
    const client = await context.newCDPSession(phone);
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1, force: 0.85 };
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
    await phone.waitForTimeout(250);
    expect(await changedPixels(phone, original, await canvas.screenshot(), [0.25, 0.18, 0.75, 0.82], 35))
      .toBeGreaterThan(35);
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await phone.waitForTimeout(720);
    expect(await changedPixels(phone, original, await canvas.screenshot(), undefined, 25))
      .toBeLessThan(70);
    await expect(phone.locator("#gazeX")).toHaveValue("0");
    await expect(phone.locator("#gazeY")).toHaveValue("0");
    expect((await readAudioStatus(phone)).connectionCount).toBe(0);
    expect(diagnostics.get(phone)).toEqual([]);
  } finally {
    await context.close();
  }
});

test("phone touch can aim the flashlight without scrolling or displacing the gaze", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1,
  });
  const phone = await context.newPage();
  try {
    await openEye(phone);
    const canvas = phone.locator("#eyeCanvas"), marker = phone.locator("#flashlightMarker");
    const flashButton = phone.locator("#flashlightMode"), title = phone.locator("#ocTitle");
    const button = await flashButton.boundingBox(), heading = await title.boundingBox();
    expect(button.width).toBeGreaterThanOrEqual(48);
    expect(button.height).toBeGreaterThanOrEqual(48);
    expect(button.x).toBeGreaterThanOrEqual(heading.x + heading.width,
      "the new stage mode must not cover the mobile title");
    await flashButton.click();
    const box = await canvas.boundingBox();
    const client = await context.newCDPSession(phone);
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart", touchPoints: [{ x, y, id: 1 }],
    });
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove", touchPoints: [{ x: x + box.width * 0.2, y, id: 1 }],
    });
    await expect.poll(async () => marker.evaluate(element => Number.parseFloat(element.style.left)))
      .toBeGreaterThan(65);
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(phone.locator("#gazeX")).toHaveValue("0");
    await expect(phone.locator("#blink")).toHaveValue("0.04");
    expect(await phone.evaluate(() => ({
      body: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      vertical: window.scrollY,
    }))).toEqual({ body: 0, vertical: 0 });
    expect((await readAudioStatus(phone)).connectionCount).toBe(0);
    expect(diagnostics.get(phone)).toEqual([]);
  } finally {
    await context.close();
  }
});

test("phone touch stretches a retracted globe; all new controls remain reachable in portrait and landscape", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1,
  });
  const phone = await context.newPage();
  try {
    await openEye(phone);
    for (const id of ["stretchMode", "lidRetractor",
      "hideLids", "tearOnce", "cryMode"]) {
      const box = await phone.locator(`#${id}`).boundingBox();
      expect(box.width, `${id} must be a usable touch target`).toBeGreaterThanOrEqual(48);
      expect(box.height, `${id} must be a usable touch target`).toBeGreaterThanOrEqual(48);
    }
    await phone.locator("#eyeCount").fill("3");
    await expect(phone.locator("#eyeCount")).toHaveValue("3");
    for (const id of ["teeth", "tongue"]) {
      const label = await phone.locator(`#${id}`).locator("..").boundingBox();
      expect(label.height, `${id} needs a touch-sized toggle row`).toBeGreaterThanOrEqual(48);
      await phone.locator(`#${id}`).check();
    }
    // The original long swipe spans more than the diameter of a small globe;
    // return to one eye for that existing surface-gesture regression.
    await phone.locator("#eyeCount").fill("1");
    await phone.locator("#teeth").uncheck();
    await phone.locator("#tongue").uncheck();
    await phone.locator("#blink").fill("1");
    await phone.locator("#lowerLid").fill("-1");
    await phone.locator("#lidRetractor").click();
    await phone.locator("#stretchMode").click();
    const canvas = phone.locator("#eyeCanvas"), marker = phone.locator("#surfaceMarker");
    await canvas.scrollIntoViewIfNeeded();
    const initialScroll = await phone.evaluate(() => window.scrollY);
    const box = await canvas.boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    const client = await context.newCDPSession(phone);
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart", touchPoints: [{ x, y, id: 1, force: 0.9 }],
    });
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove", touchPoints: [{ x: x + box.width * 0.17, y: y - 8, id: 1, force: 0.9 }],
    });
    await expect.poll(async () => marker.evaluate(element => Number.parseFloat(element.style.left)))
      .toBeGreaterThan(51);
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(phone.locator("#gazeX")).toHaveValue("0");
    await expect(phone.locator("#blink")).toHaveValue("1");
    await expect(phone.locator("#lowerLid")).toHaveValue("-1");
    expect(await phone.evaluate(() => window.scrollY)).toBe(initialScroll);
    await phone.setViewportSize({ width: 844, height: 390 });
    await phone.locator("#flashlightMode").click();
    await expect(phone.locator("#stretchMode")).toHaveAttribute("aria-pressed", "false");
    await phone.locator("#pokeDiameter").fill("0.92");
    await phone.locator("#pokeDepth").fill("1.5");
    await phone.locator("#flashDiameter").fill("1.2");
    await phone.locator("#cryTempo").fill("142");
    await phone.locator("#sunglasses").check();
    await phone.locator("#lipstick").check();
    await phone.locator("#teeth").check();
    await phone.locator("#tongue").check();
    await phone.locator("#eyeCount").fill("4");
    await expect(phone.locator("#pokeDiameter")).toHaveValue("0.92");
    await expect(phone.locator("#pokeDepth")).toHaveValue("1.5");
    await expect(phone.locator("#flashDiameter")).toHaveValue("1.2");
    await expect(phone.locator("#cryTempo")).toHaveValue("142");
    await expect(phone.locator("#eyeCount")).toHaveValue("4");
    const overflow = await phone.evaluate(() => ({
      body: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      stage: document.querySelector(".oc-stage").scrollWidth - document.querySelector(".oc-stage").clientWidth,
      panel: document.querySelector(".oc-panel").scrollWidth - document.querySelector(".oc-panel").clientWidth,
    }));
    expect(overflow.body).toBeLessThanOrEqual(2);
    expect(overflow.stage).toBeLessThanOrEqual(2);
    expect(overflow.panel).toBeLessThanOrEqual(2);
    expect((await readAudioStatus(phone)).connectionCount).toBe(0);
    expect(diagnostics.get(phone)).toEqual([]);
  } finally {
    await context.close();
  }
});

test("the chrome studio panorama uses soft highlights without a rectangular black divider", async ({ page }) => {
  await openEye(page, { finish: "chrome" });
  const scan = await page.evaluate(async () => {
    const { createStudioReflection } = await import("/src/instruments/oculoid/oculoid-viewer.js");
    const map = createStudioReflection();
    const context = map.image.getContext("2d");
    const row = context.getImageData(125, 245, 190, 1).data;
    const red = x => row[(x - 125) * 4];
    const result = {
      ambient: context.getImageData(430, 245, 1, 1).data[0],
      core: red(197),
      formerStripe: red(234),
      largestJump: Math.max(...Array.from({ length: 189 }, (_, i) =>
        Math.abs(row[i * 4] - row[(i + 1) * 4]))),
    };
    map.dispose();
    return result;
  });
  expect(scan.core).toBeGreaterThan(scan.ambient + 60);
  expect(scan.formerStripe).toBeGreaterThan(scan.ambient + 40);
  expect(scan.largestJump, "no hard-edged card or dark stripe should interrupt the chrome reflection")
    .toBeLessThan(12);
});

test("eye model failures still show a visible status", async ({ page }) => {
  await page.route("**/assets/oculoid/eye.glb", route => route.fulfill({ status: 404, body: "" }));
  await page.goto("oculoid.html");
  await expect(page.locator(".oc-stage")).toHaveAttribute("data-model-state", "error");
  await expect(page.locator("#modelStatus")).toBeVisible();
  await expect(page.locator("#modelStatus")).toContainText("The 3D model could not load:");
});

async function waitForArmedGraph(page) {
  await expect(page.locator("#audioButton")).toHaveAttribute("data-audio-state", "on", { timeout: 7000 });
  await expect.poll(async () => (await readAudioStatus(page)).connectionCount,
    { timeout: 7000 }).toBe(1);
}

// Collect every shared-meter tick in the page rather than making one CDP
// round-trip per sample: software WebGL can delay those round-trips enough to
// sample two unrelated phases of a fast flutter in a whole second.
async function sampleEyeAudio(page, durationMs, minimumSamples = 0) {
  const samples = await page.evaluate(async ({ ms, minimum }) => {
    const { getSharedAudioOutputManager } = await import("/src/audio-output-manager.js");
    const readings = [];
    let finish, elapsed = false;
    const ready = new Promise(resolve => { finish = resolve; });
    const release = getSharedAudioOutputManager(globalThis).subscribe(
      ({ active, clipped, peak, rms }) => {
        readings.push({ active, clipped, peak, rms });
        if (elapsed && readings.length >= minimum) finish();
      },
    );
    // The WebGL page can delay meter callbacks without changing the audio
    // clock. Collect the requested number of actual ticks before comparing
    // phases, with a finite extra window so a broken meter still fails.
    const duration = setTimeout(() => {
      elapsed = true;
      if (readings.length >= minimum) finish();
    }, ms);
    const deadline = setTimeout(finish, ms + 4000);
    try { await ready; } finally {
      clearTimeout(duration); clearTimeout(deadline); release();
    }
    return readings;
  }, { ms: durationMs, minimum: minimumSamples });
  return {
    samples,
    summary: {
      sampleCount: samples.length,
      finite: samples.every(({ peak, rms }) => Number.isFinite(peak) && Number.isFinite(rms)),
      activeSamples: samples.filter(({ active }) => active).length,
      clippedSamples: samples.filter(({ clipped }) => clipped).length,
      maxPeak: Math.max(0, ...samples.map(({ peak }) => peak)),
      meanRms: samples.reduce((sum, { rms }) => sum + rms, 0) / Math.max(1, samples.length),
    },
  };
}

async function screenshotEyeCenter(page) {
  // Screenshots capture the composited frame; a WebGL drawing buffer without
  // preserveDrawingBuffer may be cleared before a separate readPixels RAF.
  const box = await page.locator("#eyeCanvas").boundingBox();
  const png = await page.screenshot({ clip: {
    x: box.x + box.width / 2 - 8, y: box.y + box.height / 2 - 8, width: 16, height: 16,
  } });
  return page.evaluate(async base64 => {
    const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
    const image = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const sample = document.createElement("canvas");
    sample.width = image.width; sample.height = image.height;
    const ctx = sample.getContext("2d");
    ctx.drawImage(image, 0, 0);
    image.close();
    const data = ctx.getImageData(0, 0, sample.width, sample.height).data;
    const color = [0, 0, 0];
    for (let i = 0; i < data.length; i += 4) {
      for (let channel = 0; channel < 3; channel++) color[channel] += data[i + channel];
    }
    return color.map(value => Math.round(value / (data.length / 4)));
  }, png.toString("base64"));
}

async function visibleIrisPixels(page, png) {
  return page.evaluate(async base64 => {
    const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
    const image = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const canvas = document.createElement("canvas");
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    image.close();
    const { width, height } = canvas;
    const data = context.getImageData(width / 2 - 310, height / 2 - 180, 620, 360).data;
    let colored = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      // The licensed iris has blue-green fibers, unlike the warm brown skin,
      // neutral sclera or dark stage. Sample an interior crop, not the UI.
      if (b > r + 12 && g > r + 7 && r > 42 && r < 200 && g > 50 && b < 218) colored++;
    }
    return colored;
  }, png.toString("base64"));
}

async function changedPixels(page, before, after, region = [0.22, 0.14, 0.78, 0.86], threshold = 75) {
  return page.evaluate(async ({ first, second, crop, threshold }) => {
    const decode = async base64 => {
      const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
      return createImageBitmap(new Blob([bytes], { type: "image/png" }));
    };
    const images = await Promise.all([decode(first), decode(second)]);
    const { width, height } = images[0];
    const context = document.createElement("canvas").getContext("2d");
    context.canvas.width = width; context.canvas.height = height;
    const data = images.map(image => {
      context.clearRect(0, 0, width, height);
      context.drawImage(image, 0, 0);
      image.close();
      return context.getImageData(0, 0, width, height).data;
    });
    let count = 0;
    for (let y = Math.floor(height * crop[1]); y < Math.floor(height * crop[3]); y++) {
      for (let x = Math.floor(width * crop[0]); x < Math.floor(width * crop[2]); x++) {
        const i = (y * width + x) * 4;
        if (Math.abs(data[0][i] - data[1][i])
          + Math.abs(data[0][i + 1] - data[1][i + 1])
          + Math.abs(data[0][i + 2] - data[1][i + 2]) > threshold) count++;
      }
    }
    return count;
  }, { first: before.toString("base64"), second: after.toString("base64"), crop: region, threshold });
}

async function irisColorChanges(page, before, after) {
  return page.evaluate(async ({ first, second }) => {
    const { lidCameraDistance } = await import("/src/instruments/oculoid/oculoid-model.js");
    const decode = async base64 => createImageBitmap(new Blob([
      Uint8Array.from(atob(base64), char => char.charCodeAt(0)),
    ], { type: "image/png" }));
    const images = await Promise.all([decode(first), decode(second)]);
    const { width, height } = images[0];
    const ctx = document.createElement("canvas").getContext("2d");
    ctx.canvas.width = width; ctx.canvas.height = height;
    const pixels = images.map(image => {
      ctx.drawImage(image, 0, 0);
      image.close();
      return ctx.getImageData(0, 0, width, height).data;
    });
    const focal = height / (2 * Math.tan(36 * Math.PI / 360));
    const scale = focal / (lidCameraDistance(width / height) - 0.8);
    let changed = 0, sampled = 0;
    for (let y = Math.floor(height / 2 - scale * 0.43); y < height / 2 + scale * 0.43; y++)
      for (let x = Math.floor(width / 2 - scale * 0.43); x < width / 2 + scale * 0.43; x++) {
        const distance = Math.hypot(x - width / 2, y - height / 2) / scale;
        if (distance < 0.25 || distance > 0.43) continue;
        const i = (y * width + x) * 4;
        sampled++;
        if (Math.abs(pixels[0][i] - pixels[1][i])
          + Math.abs(pixels[0][i + 1] - pixels[1][i + 1])
          + Math.abs(pixels[0][i + 2] - pixels[1][i + 2]) > 30) changed++;
      }
    return { changed, sampled };
  }, { first: before.toString("base64"), second: after.toString("base64") });
}

async function eyewearFootprint(page, before, after) {
  // Compare identical lid poses with the glasses off/on, so movement of the
  // actual eyelid or iris does not masquerade as eyewear movement.
  return page.evaluate(async ({ first, second }) => {
    const decode = async base64 => createImageBitmap(new Blob([
      Uint8Array.from(atob(base64), char => char.charCodeAt(0)),
    ], { type: "image/png" }));
    const images = await Promise.all([decode(first), decode(second)]);
    const { width, height } = images[0];
    const context = document.createElement("canvas").getContext("2d");
    context.canvas.width = width; context.canvas.height = height;
    const pixels = images.map(image => {
      context.clearRect(0, 0, width, height);
      context.drawImage(image, 0, 0);
      image.close();
      return context.getImageData(0, 0, width, height).data;
    });
    let count = 0, sumY = 0;
    for (let y = Math.floor(height * 0.03); y < Math.floor(height * 0.87); y++) {
      for (let x = Math.floor(width * 0.18); x < Math.floor(width * 0.82); x++) {
        const i = (y * width + x) * 4;
        if (Math.abs(pixels[0][i] - pixels[1][i])
          + Math.abs(pixels[0][i + 1] - pixels[1][i + 1])
          + Math.abs(pixels[0][i + 2] - pixels[1][i + 2]) > 72) {
          count++; sumY += y;
        }
      }
    }
    return { count, y: count ? sumY / count : 0 };
  }, { first: before.toString("base64"), second: after.toString("base64") });
}

async function tearPixelBounds(page, before, after) {
  // Crop out the pupil, glints and other wetness-dependent colors; only the
  // viewer-left medial corner and the space directly below it remain.
  return page.evaluate(async ({ dry, wet }) => {
    const pixels = async base64 => {
      const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
      const image = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const canvas = document.createElement("canvas");
      canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0); image.close();
      return { data: context.getImageData(0, 0, canvas.width, canvas.height).data,
        width: canvas.width, height: canvas.height };
    };
    const first = await pixels(dry), second = await pixels(wet);
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity, count = 0;
    // Follow the detached drop nearly to the bottom of the stage. A narrow
    // crop can miss its entire falling phase on a busy software renderer.
    for (let y = Math.floor(first.height * 0.47); y < first.height * 0.98; y++) {
      for (let x = Math.floor(first.width * 0.06); x < first.width * 0.28; x++) {
        const i = (y * first.width + x) * 4;
        const delta = Math.abs(first.data[i] - second.data[i])
          + Math.abs(first.data[i + 1] - second.data[i + 1])
          + Math.abs(first.data[i + 2] - second.data[i + 2]);
        if (delta <= 75) continue;
        count++;
        left = Math.min(left, x); top = Math.min(top, y);
        right = Math.max(right, x); bottom = Math.max(bottom, y);
      }
    }
    return { count, left, top, right, bottom, width: first.width, height: first.height,
      centerX: (left + right) / 2, centerY: (top + bottom) / 2 };
  }, { dry: before.toString("base64"), wet: after.toString("base64") });
}

async function darkPupilPixels(page, png) {
  return page.evaluate(async base64 => {
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    const image = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const sample = document.createElement("canvas"), context = sample.getContext("2d");
    sample.width = image.width; sample.height = image.height;
    context.drawImage(image, 0, 0); image.close();
    const { width, height } = sample;
    const { data } = context.getImageData(width / 2 - 75, height / 2 - 75, 150, 150);
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (Math.max(data[i], data[i + 1], data[i + 2]) < 36) count++;
    }
    return count;
  }, png.toString("base64"));
}

async function brightLowerEyePixels(page, png) {
  return page.evaluate(async base64 => {
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    const image = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d");
    canvas.width = image.width; canvas.height = image.height;
    ctx.drawImage(image, 0, 0); image.close();
    const { data } = ctx.getImageData(
      Math.floor(canvas.width * 0.34), Math.floor(canvas.height * 0.62),
      Math.floor(canvas.width * 0.32), Math.floor(canvas.height * 0.23),
    );
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 167 && data[i + 1] > 167 && data[i + 2] > 167) count++;
    }
    return count;
  }, png.toString("base64"));
}

async function scleraOutsideLids(page, png, blink, lowerLid) {
  return page.evaluate(async ({ base64, blink, lowerLid }) => {
    const { lidCameraDistance, LID_PATCH_X, lidPatchPoint } =
      await import("/src/instruments/oculoid/oculoid-model.js");
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    const image = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d");
    canvas.width = image.width; canvas.height = image.height;
    ctx.drawImage(image, 0, 0); image.close();
    const { width, height } = canvas, f = height / (2 * Math.tan(36 * Math.PI / 360));
    const cameraZ = lidCameraDistance(width / height);
    const boundaries = [true, false].map(upper => {
      const projected = Array.from({ length: 301 }, (_, i) => {
        const [x, y, z] = lidPatchPoint(-LID_PATCH_X + 2 * LID_PATCH_X * i / 300,
          0, upper, blink, lowerLid);
        return [width / 2 + f * x / (cameraZ - z), height / 2 - f * y / (cameraZ - z)];
      });
      const marginY = new Float32Array(width).fill(NaN);
      for (let i = 1; i < projected.length; i++) {
        const [aX, aY] = projected[i - 1], [bX, bY] = projected[i];
        for (let px = Math.max(0, Math.ceil(aX)); px <= Math.min(width - 1, Math.floor(bX)); px++) {
          marginY[px] = aY + (bY - aY) * (px - aX) / (bX - aX);
        }
      }
      return marginY;
    });
    const { data } = ctx.getImageData(0, 0, width, height);
    let spill = 0;
    for (let py = Math.floor(height * 0.17); py < height * 0.83; py++) {
      for (let px = Math.floor(width * 0.2); px < width * 0.8; px++) {
        const at = (py * width + px) * 4;
        if (data[at] < 185 || data[at + 1] < 185 || data[at + 2] < 185) continue;
        const [top, bottom] = boundaries.map(boundary => boundary[px]);
        if (!Number.isFinite(top) || !Number.isFinite(bottom)
          || py < Math.min(top, bottom) - 4 || py > Math.max(top, bottom) + 4) spill++;
      }
    }
    return spill;
  }, { base64: png.toString("base64"), blink, lowerLid });
}

async function shellAndBackdropColors(page, png) {
  return page.evaluate(async base64 => {
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    const image = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d");
    canvas.width = image.width; canvas.height = image.height;
    ctx.drawImage(image, 0, 0); image.close();
    const at = (x, y) => [...ctx.getImageData(
      Math.floor(canvas.width * x), Math.floor(canvas.height * y), 1, 1,
    ).data].slice(0, 3);
    return {
      shell: at(0.5, 0.13), bottom: at(0.5, 0.87),
      top: at(0.5, 0.01), side: at(0.02, 0.5), diagonal: at(0.15, 0.15),
    };
  }, png.toString("base64"));
}

async function sideEquatorContinuity(page, png) {
  return page.evaluate(async base64 => {
    const { LID_SHELL_RADIUS, lidCameraDistance } =
      await import("/src/instruments/oculoid/oculoid-model.js");
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    const image = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d");
    canvas.width = image.width; canvas.height = image.height;
    ctx.drawImage(image, 0, 0); image.close();
    const { width, height } = canvas, pixels = ctx.getImageData(0, 0, width, height).data;
    const f = height / (2 * Math.tan(36 * Math.PI / 360));
    const cameraZ = lidCameraDistance(width / height), yaw = Math.PI / 3;
    const samples = [];
    // At 60° the front/back equator is visible on the lower left of the
    // sphere, safely away from the globe, lashes, socket, and silhouette.
    for (const x of [-1.03, -0.98, -0.92]) {
      const y = -Math.sqrt(LID_SHELL_RADIUS ** 2 - x * x);
      const depth = cameraZ + x * Math.sin(yaw);
      const px = Math.round(width / 2 + f * x * Math.cos(yaw) / depth);
      const py = Math.round(height / 2 - f * y / depth);
      const colors = Array.from({ length: 13 }, (_, i) => {
        const offset = (py * width + px + i - 6) * 4;
        return [...pixels.slice(offset, offset + 3)];
      });
      samples.push(...colors);
    }
    return {
      minRed: Math.min(...samples.map(([r]) => r)),
      minBrown: Math.min(...samples.map(([r, , b]) => r - b)),
      maxStep: Math.max(...samples.slice(1).map(([r, g, b], i) =>
        Math.max(...[r, g, b].map((channel, c) => Math.abs(channel - samples[i][c]))))),
    };
  }, png.toString("base64"));
}

async function fusedCanthusColors(page, png, side) {
  return page.evaluate(async ({ base64, side }) => {
    const { lidCameraDistance, lidPatchPoint } =
      await import("/src/instruments/oculoid/oculoid-model.js");
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    const image = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d");
    canvas.width = image.width; canvas.height = image.height;
    ctx.drawImage(image, 0, 0); image.close();
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const { width, height } = canvas;
    const yaw = -side * 75 * Math.PI / 180;
    const f = height / (2 * Math.tan(36 * Math.PI / 360));
    const distance = lidCameraDistance(width / height);
    return [1.005, 1.015, 1.025, 1.035, 1.055, 1.08, 1.11].map(radius => {
      const [x, y, z] = lidPatchPoint(side * radius, 0, true, 0, 0);
      const depth = distance - (-x * Math.sin(yaw) + z * Math.cos(yaw));
      const px = Math.round(width / 2 + f * (x * Math.cos(yaw) + z * Math.sin(yaw)) / depth);
      const py = Math.round(height / 2 - f * y / depth);
      const offset = (py * width + px) * 4;
      return [...pixels.slice(offset, offset + 3)];
    });
  }, { base64: png.toString("base64"), side });
}

async function lidRimColors(page, png, blink, lowerLid) {
  return page.evaluate(async ({ base64, blink, lowerLid }) => {
    const { lidCameraDistance, lidLipPoint } =
      await import("/src/instruments/oculoid/oculoid-model.js");
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    const image = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d");
    canvas.width = image.width; canvas.height = image.height;
    ctx.drawImage(image, 0, 0); image.close();
    const { width, height } = canvas, f = height / (2 * Math.tan(36 * Math.PI / 360));
    const cameraZ = lidCameraDistance(width / height);
    const at = ([x, y, z]) => {
      const px = Math.round(width / 2 + f * x / (cameraZ - z));
      const py = Math.round(height / 2 - f * y / (cameraZ - z));
      return [...ctx.getImageData(px, py, 1, 1).data].slice(0, 3);
    };
    return [true, false].map(upper => {
      // The new roots grow from the exposed crest. A single pixel may land
      // on one dark strand instead of the roll: require most sampled crest
      // positions to remain brown, not an arbitrary gap between hairs.
      const crest = [0, 0.15, 0.3, 0.45, 0.6]
        .map(x => at(lidLipPoint(x, 0.5, upper, blink, lowerLid)));
      return {
        inside: at(lidLipPoint(0.3, 0.09, upper, blink, lowerLid)),
        outside: [0, 1, 2].map(channel =>
          crest.map(color => color[channel]).sort((a, b) => a - b)[2]),
      };
    });
  }, { base64: png.toString("base64"), blink, lowerLid });
}

async function darkSocketStripAtLids(page, png, blink, lowerLid) {
  return page.evaluate(async ({ base64, blink, lowerLid }) => {
    const { lidCameraDistance, lidLipPoint } =
      await import("/src/instruments/oculoid/oculoid-model.js");
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    const image = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d");
    canvas.width = image.width; canvas.height = image.height;
    ctx.drawImage(image, 0, 0); image.close();
    const { width, height } = canvas, f = height / (2 * Math.tan(36 * Math.PI / 360));
    const cameraZ = lidCameraDistance(width / height);
    // Sample just inside each lip, away from the side recesses,
    // dark lashes and pupil. A black band here means the globe has separated
    // from the lid; it does not belong on the lip or above/below the globe.
    let count = 0;
    for (const upper of [true, false]) for (const x of [-0.65, -0.45, -0.25, 0.25, 0.45, 0.65]) {
      const [px, py, pz] = lidLipPoint(x, 0, upper, blink, lowerLid);
      const sampleX = Math.round(width / 2 + f * px / (cameraZ - pz));
      const edgeY = Math.round(height / 2 - f * py / (cameraZ - pz));
      for (let distance = 2; distance <= 14; distance++) {
        const sampleY = edgeY + (upper ? distance : -distance);
        const [r, g, b] = ctx.getImageData(sampleX, sampleY, 1, 1).data;
        if (Math.max(r, g, b) < 25) count++;
      }
    }
    return count;
  }, { base64: png.toString("base64"), blink, lowerLid });
}

async function canthusLayerColors(page, png, blink, lowerLid) {
  return page.evaluate(async ({ base64, blink, lowerLid }) => {
    const { canthusRecessPoint, GLOBE_SQUASH, lidCameraDistance, lidLipPoint } =
      await import("/src/instruments/oculoid/oculoid-model.js");
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    const image = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d");
    canvas.width = image.width; canvas.height = image.height;
    ctx.drawImage(image, 0, 0); image.close();
    const { width, height } = canvas, f = height / (2 * Math.tan(36 * Math.PI / 360));
    const cameraZ = lidCameraDistance(width / height);
    const at = ([x, y, z]) => {
      const px = Math.round(width / 2 + f * x / (cameraZ - z));
      const py = Math.round(height / 2 - f * y / (cameraZ - z));
      return [...ctx.getImageData(px, py, 1, 1).data].slice(0, 3);
    };
    const globeEdge = f * 0.965 / Math.sqrt(cameraZ ** 2 - GLOBE_SQUASH ** 2);
    return [-1, 1].map(side => ({
      globe: at(canthusRecessPoint(side, 0.7, 0.5, blink, lowerLid)),
      // Inside the actual globe's projected silhouette, where the old
      // forward-facing black corner triangles covered its red scleral edge.
      globeEdge: [...ctx.getImageData(
        Math.round(width / 2 + side * globeEdge), Math.round(height / 2), 1, 1,
      ).data].slice(0, 3),
      upperRim: at(lidLipPoint(side * 0.9, 0.6, true, blink, lowerLid)),
      lowerRim: at(lidLipPoint(side * 0.9, 0.6, false, blink, lowerLid)),
    }));
  }, { base64: png.toString("base64"), blink, lowerLid });
}

async function lateralRecessPixels(page, png) {
  return page.evaluate(async base64 => {
    const { GLOBE_HULL_RADIUS, GLOBE_SQUASH, LID_SHELL_RADIUS, lidCameraDistance } =
      await import("/src/instruments/oculoid/oculoid-model.js");
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    const image = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d");
    canvas.width = image.width; canvas.height = image.height;
    ctx.drawImage(image, 0, 0); image.close();
    const { width, height } = canvas, pixels = ctx.getImageData(0, 0, width, height).data;
    const f = height / (2 * Math.tan(36 * Math.PI / 360));
    const cameraZ = lidCameraDistance(width / height);
    // Look at the small posterior-sphere gap outside the globe but inside
    // each canthus. This excludes the pupil, lashes and the dark backdrop.
    const projectedX = x => width / 2 + f * x / (cameraZ
      + GLOBE_SQUASH * Math.sqrt(LID_SHELL_RADIUS ** 2 - x ** 2));
    const near = Math.floor(projectedX(GLOBE_HULL_RADIUS + 0.02));
    const far = Math.ceil(projectedX(LID_SHELL_RADIUS - 0.01));
    const halfHeight = Math.ceil(f * 0.21 / (cameraZ + 0.3));
    const top = Math.floor(height / 2 - halfHeight), bottom = Math.ceil(height / 2 + halfHeight);
    return Object.fromEntries(["left", "right"].map((name, i) => {
      const first = i ? near : width - far, last = i ? far : width - near;
      let dark = 0, pale = 0;
      for (let y = top; y < bottom; y++) for (let x = first; x < last; x++) {
        const p = (y * width + x) * 4;
        if (Math.max(pixels[p], pixels[p + 1], pixels[p + 2]) < 25) dark++;
        if (Math.min(pixels[p], pixels[p + 1], pixels[p + 2]) > 125) pale++;
      }
      return [name, { dark, pale }];
    }));
  }, png.toString("base64"));
}

test.afterEach(async ({ page }) => {
  expect(diagnostics.get(page) ?? [], "the route must load without script, WebGL or asset failures").toEqual([]);
});

test("mirror-chrome eyelids reflect two independently movable lights without touching the eye gestures or sound", async ({ page }, testInfo) => {
  await openEye(page, { finish: "chrome" });
  await expect(page.locator("#skinFinish")).toHaveValue("chrome");
  await expect(page.locator("#irisColor")).toHaveValue("violet");
  await expect(page.locator("#scleraColor")).toHaveValue("pearl");
  const stage = page.locator("#eyeCanvas");
  const neutral = await stage.screenshot({ path: testInfo.outputPath("eye-chrome-studio.png") });
  for (const { globe, globeEdge } of await canthusLayerColors(page, neutral, 0.04, 0)) {
    expect(globe[0], "the globe must cover the triangular recess under chrome lids").toBeGreaterThan(130);
    expect(globeEdge[0] - globeEdge[1],
      "the visible scleral edge must not be covered by a black or chrome triangle").toBeGreaterThan(25);
  }
  for (const { dark } of Object.values(await lateralRecessPixels(page, neutral))) {
    expect(dark, "the socket outside the globe stays black under chrome lids").toBeGreaterThan(80);
  }
  expect((await readAudioStatus(page)).connectionCount).toBe(0);

  await page.locator("#keyAzimuth").fill("105");
  await page.locator("#keyElevation").fill("-35");
  await expect(page.locator("#keyAzimuthOut")).toHaveText("105°");
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const keyMoved = await stage.screenshot({ path: testInfo.outputPath("eye-chrome-key-moved.png") });
  expect(await changedPixels(page, neutral, keyMoved, [0.27, 0.1, 0.73, 0.36]),
    "moving the key must move visible reflections on the upper chrome shell").toBeGreaterThan(1000);
  await page.locator("#fillAzimuth").fill("-120");
  await page.locator("#fillElevation").fill("65");
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await changedPixels(page, keyMoved, await stage.screenshot()),
    "the independent fill must change the lighting").toBeGreaterThan(800);
  await expect(page.locator("#keyAzimuth")).toHaveValue("105");

  const handle = page.locator("#keyLightHandle"), pad = page.locator("#lightPad");
  const light = await handle.boundingBox(), area = await pad.boundingBox();
  await page.mouse.move(light.x + light.width / 2, light.y + light.height / 2);
  await page.mouse.down();
  await page.mouse.move(area.x + area.width * 0.2, area.y + area.height * 0.25, { steps: 4 });
  await page.mouse.up();
  const draggedAzimuth = Number(await page.locator("#keyAzimuth").inputValue());
  expect(draggedAzimuth).toBeLessThan(-100);
  expect(Number(await page.locator("#keyElevation").inputValue())).toBeGreaterThan(40);
  await handle.focus();
  const elevation = Number(await page.locator("#keyElevation").inputValue());
  await page.keyboard.press("ArrowUp");
  await expect(page.locator("#keyElevation")).toHaveValue(String(Math.min(75, elevation + 5)));

  await page.locator(".header-preset-picker summary").click();
  await page.locator('[data-full-preset][data-preset-id="eye-5"]').click();
  await expect(page.locator("#keyAzimuth")).toHaveValue(String(draggedAzimuth));
  await expect(page.locator("#fillAzimuth")).toHaveValue("-120");
  const chromeBeforeFinish = await stage.screenshot();
  await page.locator("#skinFinish").selectOption("matte");
  await page.locator("#skinPicker").fill("#704b33");
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await changedPixels(page, chromeBeforeFinish, await stage.screenshot(), [0.27, 0.1, 0.73, 0.36]),
    "the brown option must actually replace the mirror material").toBeGreaterThan(1000);
  await page.locator("#resetAll").click();
  await expect(page.locator("#skinFinish")).toHaveValue("chrome");
  await expect(page.locator("#keyAzimuth")).toHaveValue("-27");
  await expect(page.locator("#keyElevation")).toHaveValue("30");
  await expect(page.locator("#fillAzimuth")).toHaveValue("53");
  await expect(page.locator("#fillElevation")).toHaveValue("-22");
  await expect(page.locator("#keyBrightness")).toHaveValue("1");
  await expect(page.locator("#gazeX")).toHaveValue("0");
  expect((await readAudioStatus(page)).connectionCount).toBe(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(pad).toBeVisible();
  await pad.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
});

test("key brightness dims and brightens soft chrome while fill position and musical presets stay put", async ({ page }) => {
  await openEye(page, { finish: "chrome" });
  const key = page.locator("#keyBrightness"), stage = page.locator("#eyeCanvas");
  await expect(key).toHaveValue("1");
  await expect(page.locator("#keyBrightnessOut")).toHaveText("100%");
  await key.fill("0");
  await expect(page.locator("#keyBrightnessOut")).toHaveText("0%");
  const dimmed = await stage.screenshot();
  await key.fill("2");
  await expect(page.locator("#keyBrightnessOut")).toHaveText("200%");
  const bright = await stage.screenshot();
  expect(await changedPixels(page, dimmed, bright, [0.28, 0.08, 0.72, 0.39], 40),
    "the chrome lid must visibly respond to brightness, not just update the knob").toBeGreaterThan(900);
  const lowShell = (await shellAndBackdropColors(page, dimmed)).shell;
  const highShell = (await shellAndBackdropColors(page, bright)).shell;
  expect(highShell[0], "turning the key up should brighten the shell").toBeGreaterThan(lowShell[0] + 10);
  await key.fill("1.35");
  await key.focus();
  await page.keyboard.press("ArrowDown");
  await expect(key).toHaveValue("1.34");
  await expect(page.locator("#keyBrightnessOut")).toHaveText("134%");
  await page.locator(".header-preset-picker summary").click();
  await page.locator('[data-full-preset][data-preset-id="eye-5"]').click();
  await expect(key).toHaveValue("1.34");
  await expect(page.locator("#fillAzimuth")).toHaveValue("53");
  await page.locator("#resetAll").click();
  await expect(key).toHaveValue("1");
  await expect(page.locator("#keyBrightnessOut")).toHaveText("100%");
  await expect(page.locator("#irisColor")).toHaveValue("violet");
  await expect(page.locator("#scleraColor")).toHaveValue("pearl");
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
});

test("iris and eye-white colors change separate textures without entering musical presets", async ({ page }, testInfo) => {
  await openEye(page, { finish: "chrome" });
  const stage = page.locator("#eyeCanvas");
  await expect(page.locator("#irisColor")).toHaveValue("violet");
  await expect(page.locator("#scleraColor")).toHaveValue("pearl");
  await expect(page.locator("#irisColor option")).toHaveCount(14);
  await expect(page.locator("#scleraColor option")).toHaveCount(10);
  const swatch = await page.locator("#irisSwatch").boundingBox();
  expect(swatch.width).toBeGreaterThanOrEqual(24);
  const settleFrame = () => page.evaluate(() =>
    new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  // Compare every alternate against the licensed original, not the new
  // violet/pearl default, so the original-texture regression still has a base.
  await page.locator("#irisColor").selectOption("original");
  await page.locator("#scleraColor").selectOption("natural");
  await settleFrame();
  const original = await stage.screenshot();
  for (const color of ["brown", "hazel", "amber", "green", "blue", "gray", "violet"]) {
    await page.locator("#irisColor").selectOption(color);
    await settleFrame();
    await expect(page.locator("#irisColor")).toHaveValue(color);
    const tinted = await stage.screenshot();
    expect(await changedPixels(page, original, tinted, [0.38, 0.31, 0.63, 0.7]),
      `${color} must recolor the iris texture, not just the swatch`).toBeGreaterThan(450);
    expect(await changedPixels(page, original, tinted, [0.32, 0.07, 0.68, 0.26]),
      "iris choices should not recolor chrome eyelids").toBeLessThan(30);
  }
  await page.locator("#irisColor").selectOption("original");
  await settleFrame();
  expect(await changedPixels(page, original, await stage.screenshot(), [0.38, 0.31, 0.63, 0.7]),
    "the original iris must retain its licensed source texture").toBeLessThan(75);
  await page.locator("#irisColor").selectOption("violet");
  await settleFrame();
  const irisOnly = await stage.screenshot();
  for (const white of ["ivory", "rose", "pearl"]) {
    await page.locator("#scleraColor").selectOption(white);
    await settleFrame();
    await expect(page.locator("#scleraColor")).toHaveValue(white);
    expect(await changedPixels(page, irisOnly, await stage.screenshot(), [0.29, 0.28, 0.71, 0.7], 30),
      `${white} should change the eye white without changing the selected iris`).toBeGreaterThan(300);
  }
  await page.locator(".header-preset-picker summary").click();
  await page.locator('[data-full-preset][data-preset-id="eye-36"]').click();
  await expect(page.locator("#irisColor")).toHaveValue("violet");
  await expect(page.locator("#scleraColor")).toHaveValue("pearl");
  await page.locator("#resetAll").click();
  await expect(page.locator("#irisColor")).toHaveValue("violet");
  await expect(page.locator("#scleraColor")).toHaveValue("pearl");
  await expect(page.locator("#skinFinish")).toHaveValue("chrome");
  await expect(page.locator("#irisSwatch")).toHaveCSS("background-color", "rgb(152, 118, 184)");
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  await testInfo.attach("oculoid-color-reset.png", { body: await stage.screenshot(), contentType: "image/png" });
});

test("custom color pickers and weird palettes recolor each eye layer without touching sound", async ({ page }) => {
  await openEye(page, { finish: "chrome" });
  const stage = page.locator("#eyeCanvas");
  const neutral = await stage.screenshot();
  await page.locator("#irisPicker").fill("#ff198a");
  await expect(page.locator("#irisColor")).toHaveValue("custom");
  await expect(page.locator("#irisPicker")).toHaveValue("#ff198a");
  await expect(page.locator("#irisSwatch")).toHaveCSS("background-color", "rgb(255, 25, 138)");
  const hotPink = await stage.screenshot();
  expect(await changedPixels(page, neutral, hotPink, [0.38, 0.31, 0.63, 0.7], 40),
    "the picker must recolor the actual textured iris").toBeGreaterThan(450);
  expect(await changedPixels(page, neutral, hotPink, [0.32, 0.07, 0.68, 0.26]),
    "the iris picker must not recolor the shell").toBeLessThan(30);
  await page.locator("#irisPattern").selectOption("stripes");
  const striped = await stage.screenshot();
  expect(await changedPixels(page, hotPink, striped, [0.38, 0.31, 0.63, 0.7], 25),
    "radial stripes must actually change the iris, not just a menu").toBeGreaterThan(400);
  await page.locator("#irisPattern").selectOption("rings");
  expect(await changedPixels(page, striped, await stage.screenshot(), [0.38, 0.31, 0.63, 0.7], 25),
    "concentric bands must differ from radial stripes").toBeGreaterThan(400);
  await page.locator("#irisPattern").selectOption("natural");
  await page.locator("#irisColor").selectOption("black");
  expect(await changedPixels(page, hotPink, await stage.screenshot(), [0.38, 0.31, 0.63, 0.7], 40),
    "blackout must darken the visible iris, not the eyeball").toBeGreaterThan(400);
  await page.locator("#irisColor").selectOption("cyan");
  await expect(page.locator("#irisPicker")).toHaveValue("#18eef3");

  const irisOnly = await stage.screenshot();
  await page.locator("#scleraPicker").fill("#ff42e1");
  await expect(page.locator("#scleraColor")).toHaveValue("custom");
  await expect(page.locator("#scleraPicker")).toHaveValue("#ff42e1");
  expect(await changedPixels(page, irisOnly, await stage.screenshot(), [0.29, 0.28, 0.71, 0.7], 35),
    "the second picker must color the globe without changing the selected iris").toBeGreaterThan(450);
  for (const [palette, hex] of [["ink", "#20202d"], ["mint", "#62f0ac"]]) {
    await page.locator("#scleraColor").selectOption(palette);
    await expect(page.locator("#scleraPicker")).toHaveValue(hex);
  }
  await page.locator(".header-preset-picker summary").click();
  await page.locator('[data-full-preset][data-preset-id="eye-5"]').click();
  await expect(page.locator("#irisColor")).toHaveValue("cyan");
  await expect(page.locator("#scleraColor")).toHaveValue("mint");
  await expect(page.locator("#irisPattern")).toHaveValue("natural");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
});

test("checkerboard and its color stay on the globe while eyeball tint leaves the iris intact", async ({ page }, testInfo) => {
  await openEye(page, { finish: "chrome" });
  const stage = page.locator("#eyeCanvas");
  await page.locator("#irisColor").selectOption("cyan");
  const pearl = await stage.screenshot();
  await page.locator("#scleraPicker").fill("#2048ed");
  const blue = await stage.screenshot();
  expect(await changedPixels(page, pearl, blue, [0.27, 0.28, 0.73, 0.74], 25))
    .toBeGreaterThan(500);
  const tintOnIris = await irisColorChanges(page, pearl, blue);
  expect(tintOnIris.sampled).toBeGreaterThan(1000);
  expect(tintOnIris.changed, "eyeball tint must not dye the separate iris through the cornea")
    .toBeLessThan(tintOnIris.sampled * 0.01);

  await page.locator("#scleraPattern").selectOption("checker");
  const checker = await stage.screenshot({ path: testInfo.outputPath("eye-checkerboard.png") });
  expect(await changedPixels(page, blue, checker, [0.25, 0.26, 0.75, 0.77], 28))
    .toBeGreaterThan(500);
  const patternOnIris = await irisColorChanges(page, blue, checker);
  expect(patternOnIris.changed, "globe checks must not paint over the iris")
    .toBeLessThan(patternOnIris.sampled * 0.01);
  await page.locator("#scleraPatternPicker").fill("#f42761");
  const pink = await stage.screenshot({ path: testInfo.outputPath("eye-pink-checks.png") });
  expect(await changedPixels(page, checker, pink, [0.25, 0.26, 0.75, 0.77], 28))
    .toBeGreaterThan(500);
  expect((await irisColorChanges(page, checker, pink)).changed).toBeLessThan(patternOnIris.sampled * 0.01);
  await page.locator("#eyeCount").fill("4");
  const fourPink = await stage.screenshot();
  await page.locator("#scleraPatternPicker").fill("#1eeaaa");
  expect(await changedPixels(page, fourPink, await stage.screenshot(), [0.25, 0.26, 0.75, 0.77], 25))
    .toBeGreaterThan(300, "all four moving eyes use the same independently colored pattern");
  await page.locator(".header-preset-picker summary").click();
  await page.locator('[data-full-preset][data-preset-id="eye-5"]').click();
  await expect(page.locator("#scleraPatternPicker")).toHaveValue("#1eeaaa");
  await expect(page.locator("#scleraPattern")).toHaveValue("checker");
  await page.locator("#stageReset").click();
  await expect(page.locator("#scleraPattern")).toHaveValue("solid");
  await expect(page.locator("#scleraPatternPicker")).toHaveValue("#35274e");
  await expect(page.locator("#scleraColor")).toHaveValue("pearl");
  await expect(page.locator("#irisColor")).toHaveValue("violet");
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
});

test("every eyelid finish retains its chosen color and patterns stay independent of the projected light", async ({ page }, testInfo) => {
  await openEye(page, { finish: "chrome" });
  const canvas = page.locator("#eyeCanvas"), finish = page.locator("#skinFinish");
  await expect(page.locator("#skinFinish option")).toHaveCount(5);
  await page.locator("#skinPicker").fill("#b7517b");
  const chrome = await canvas.screenshot();
  for (const choice of ["matte", "wet", "gooey", "clumpy"]) {
    await finish.selectOption(choice);
    await expect(page.locator("#skinPicker")).toHaveValue("#b7517b");
    const image = await canvas.screenshot({ path: testInfo.outputPath(`eye-${choice}-lid.png`) });
    expect(await changedPixels(page, chrome, image, [0.28, 0.07, 0.72, 0.35], 23),
      `${choice} must alter the actual PBR shell, not just the menu`).toBeGreaterThan(350);
  }
  await finish.selectOption("chrome");
  await expect(page.locator("#skinPicker")).toHaveValue("#b7517b");
  await page.locator("#skinPattern").selectOption("checker");
  const skinChecks = await canvas.screenshot();
  expect(await changedPixels(page, chrome, skinChecks, [0.27, 0.07, 0.73, 0.34], 23))
    .toBeGreaterThan(300);
  await page.locator("#lightPattern").selectOption("checker");
  const litChecks = await canvas.screenshot({ path: testInfo.outputPath("eye-projected-checks.png") });
  expect(await changedPixels(page, skinChecks, litChecks, [0.25, 0.12, 0.75, 0.78], 28),
    "the light cookie must illuminate a different pattern from the painted shell")
    .toBeGreaterThan(400);
  await page.locator("#skinPattern").selectOption("solid");
  const unpainted = await canvas.screenshot();
  expect(await changedPixels(page, litChecks, unpainted, [0.27, 0.07, 0.73, 0.34], 23))
    .toBeGreaterThan(200, "painted checks can be removed without turning off the projection");
  for (const pattern of ["dots", "stripes", "ripples"]) {
    const before = await canvas.screenshot();
    await page.locator("#lightPattern").selectOption(pattern);
    expect(await changedPixels(page, before, await canvas.screenshot(), [0.25, 0.12, 0.75, 0.78], 25),
      `${pattern} must cast a distinct light pattern`).toBeGreaterThan(250);
  }
  await page.locator("#keyBrightness").fill("0");
  const noKey = await canvas.screenshot();
  await page.locator("#lightPattern").selectOption("none");
  expect(await changedPixels(page, noKey, await canvas.screenshot(), undefined, 5),
    "at zero key brightness the projected pattern cannot affect the eye").toBeLessThan(20);
  await page.locator("#keyBrightness").fill("1");
  await page.locator("#lightPattern").selectOption("dots");
  const aimedDots = await canvas.screenshot();
  await page.locator("#keyAzimuth").fill("92");
  expect(await changedPixels(page, aimedDots, await canvas.screenshot(), [0.25, 0.12, 0.75, 0.78], 25),
    "the projected pattern must move with its real key light").toBeGreaterThan(400);
  await expect(page.locator("#skinPicker")).toHaveValue("#b7517b");
  await page.locator(".header-preset-picker summary").click();
  await page.locator('[data-full-preset][data-preset-id="eye-5"]').click();
  await expect(page.locator("#lightPattern")).toHaveValue("dots");
  await page.locator("#stageReset").click();
  await expect(page.locator("#skinFinish")).toHaveValue("chrome");
  await expect(page.locator("#skinPicker")).toHaveValue("#f2f1ef");
  await expect(page.locator("#lightPattern")).toHaveValue("none");
});

test("reflective custom eyelid color and three independent spotted eye layers survive presets", async ({ page }, testInfo) => {
  await openEye(page, { finish: "chrome" });
  const canvas = page.locator("#eyeCanvas");
  const silver = await canvas.screenshot();
  await page.locator("#skinPicker").fill("#31baab");
  await expect(page.locator("#skinFinish")).toHaveValue("chrome");
  await expect(page.locator("#skinPicker")).toHaveValue("#31baab");
  const teal = await canvas.screenshot();
  expect(await changedPixels(page, silver, teal, [0.3, 0.06, 0.7, 0.27], 26))
    .toBeGreaterThan(400);
  await page.locator("#reflection").fill("0");
  const dim = await canvas.screenshot();
  expect(await changedPixels(page, teal, dim, [0.3, 0.06, 0.7, 0.27], 22))
    .toBeGreaterThan(400);
  expect(await changedPixels(page, teal, dim, [0.43, 0.4, 0.57, 0.6], 30))
    .toBeLessThan(60);
  await page.locator("#reflection").fill("2");
  await expect(page.locator("#reflectionOut")).toHaveText("200%");
  const bright = await canvas.screenshot();
  expect(await changedPixels(page, dim, bright, [0.3, 0.06, 0.7, 0.27], 22))
    .toBeGreaterThan(400);
  await page.locator("#skinPattern").selectOption("dots");
  const skinDots = await canvas.screenshot({ path: testInfo.outputPath("oculoid-eyelid-dots.png") });
  expect(await changedPixels(page, bright, skinDots, [0.3, 0.06, 0.7, 0.28], 25))
    .toBeGreaterThan(300);
  await page.locator("#irisPattern").selectOption("dots");
  const irisDots = await canvas.screenshot({ path: testInfo.outputPath("oculoid-iris-dots.png") });
  expect(await changedPixels(page, skinDots, irisDots, [0.38, 0.32, 0.63, 0.7], 25))
    .toBeGreaterThan(220);
  for (const pattern of ["dots", "stripes", "checker"]) {
    const before = await canvas.screenshot();
    await page.locator("#scleraPattern").selectOption(pattern);
    const after = await canvas.screenshot({ path: testInfo.outputPath(`oculoid-eyeball-${pattern}.png`) });
    expect(await changedPixels(page, before, after, [0.26, 0.25, 0.73, 0.78], 25),
      `${pattern} must be drawn on the globe`).toBeGreaterThan(500);
  }
  await page.locator("#scleraPattern").selectOption("dots");
  await page.locator("#eyeCount").fill("2");
  const pairedDots = await canvas.screenshot();
  await page.locator("#scleraPattern").selectOption("solid");
  expect(await changedPixels(page, pairedDots, await canvas.screenshot(),
    [0.24, 0.25, 0.76, 0.78], 22)).toBeGreaterThan(200);
  await page.locator("#scleraPattern").selectOption("dots");
  await page.locator("#eyeCount").fill("1");
  await page.locator("#hideLids").click();
  const exposed = await canvas.screenshot();
  await page.locator("#scleraPattern").selectOption("solid");
  expect(await changedPixels(page, exposed, await canvas.screenshot(),
    [0.23, 0.18, 0.77, 0.84], 24)).toBeGreaterThan(500);
  await page.locator("#scleraPattern").selectOption("dots");
  await page.locator("#eyeLook").selectOption("ink");
  for (const id of ["irisPattern", "scleraPattern", "scleraPatternPicker"])
    await expect(page.locator(`#${id}`)).toBeDisabled();
  await page.locator("#eyeLook").selectOption("textured");
  await expect(page.locator("#scleraPattern")).toHaveValue("dots");
  await page.locator(".header-preset-picker summary").click();
  await page.locator('[data-full-preset][data-preset-id="eye-5"]').click();
  for (const [id, value] of [
    ["skinFinish", "chrome"], ["skinPattern", "dots"], ["irisPattern", "dots"],
    ["scleraPattern", "dots"], ["reflection", "2"],
  ]) await expect(page.locator(`#${id}`)).toHaveValue(value);
  await expect(page.locator("#skinPicker")).toHaveValue("#31baab");
  await page.locator("#stageReset").click();
  for (const [id, value] of [
    ["skinFinish", "chrome"], ["skinPattern", "solid"], ["irisPattern", "natural"],
    ["scleraPattern", "solid"], ["reflection", "1"],
  ]) await expect(page.locator(`#${id}`)).toHaveValue(value);
  await expect(page.locator("#skinPicker")).toHaveValue("#f2f1ef");
  await expect(page.locator("#scleraPatternPicker")).toHaveValue("#35274e");
  expect(diagnostics.get(page)).toEqual([]);
});

test("the stage Reset recovers a rotated, closed, patterned eye on desktop and phone", async ({ page }) => {
  await openEye(page, { finish: "chrome" });
  const stage = page.locator(".oc-stage"), reset = page.locator("#stageReset");
  await expect(reset).toBeVisible();
  await page.locator("#skinPicker").fill("#f1ada6");
  await page.locator("#skinPattern").selectOption("stripes");
  const stageCanvas = page.locator("#eyeCanvas");
  const striped = await stageCanvas.screenshot();
  await page.locator("#skinPattern").selectOption("solid");
  const solid = await stageCanvas.screenshot();
  expect(await changedPixels(page, striped, solid, [0.29, 0.06, 0.7, 0.3], 25),
    "stripes must wrap over the chrome shell").toBeGreaterThan(300);
  await page.locator("#skinPattern").selectOption("plaid");
  expect(await changedPixels(page, solid, await stageCanvas.screenshot(), [0.29, 0.06, 0.7, 0.3], 25),
    "plaid must visibly differ from solid chrome").toBeGreaterThan(300);
  await page.locator("#skinFinish").selectOption("matte");
  await page.locator("#skinPicker").fill("#422c26");
  await page.locator("#blink").fill("1");
  await page.locator("#lowerLid").fill("-1");
  await page.locator("#turnX").fill("90");
  await page.locator("#turnY").fill("-90");
  await page.locator("#irisPicker").fill("#4cffff");
  await page.locator("#scleraPicker").fill("#f053a8");
  const stageBox = await stage.boundingBox(), buttonBox = await reset.boundingBox();
  expect(buttonBox.width).toBeGreaterThanOrEqual(48);
  expect(buttonBox.height).toBeGreaterThanOrEqual(48);
  expect(buttonBox.x).toBeGreaterThan(stageBox.x + stageBox.width * 0.7);
  expect(buttonBox.x + buttonBox.width).toBeLessThan(stageBox.x + stageBox.width);
  await reset.click();
  for (const [id, value] of [
    ["turnX", "0"], ["turnY", "0"], ["blink", "0.04"], ["lowerLid", "0"],
    ["skinFinish", "chrome"], ["skinPattern", "solid"], ["irisColor", "violet"],
    ["irisPattern", "natural"], ["scleraColor", "pearl"],
  ]) await expect(page.locator(`#${id}`)).toHaveValue(value);
  await expect(page.locator("#irisPicker")).toHaveValue("#9876b8");
  await expect(page.locator("#scleraPicker")).toHaveValue("#e2e6eb");
  expect((await readAudioStatus(page)).connectionCount).toBe(0);

  for (const [width, height] of [[390, 844], [844, 390]]) {
    await page.setViewportSize({ width, height });
    const box = await stage.boundingBox(), button = await reset.boundingBox();
    expect(button.width).toBeGreaterThanOrEqual(48);
    expect(button.height).toBeGreaterThanOrEqual(48);
    expect(button.x + button.width).toBeLessThanOrEqual(box.x + box.width);
    expect(button.y + button.height).toBeLessThanOrEqual(box.y + box.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth
      - document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
    await page.locator("#turnX").fill("85");
    await page.locator("#blink").fill("1");
    await reset.click();
    await expect(page.locator("#turnX")).toHaveValue("0");
    await expect(page.locator("#blink")).toHaveValue("0.04");
  }
});

test("palette swapping reuses one derived texture and disposal releases both original and tinted maps", async ({ page }) => {
  await openEye(page, { finish: "chrome" });
  const released = await page.evaluate(async () => {
    const THREE = await import("/vendor/three/three.module.min.js");
    const { createOculoidViewer } = await import("/src/instruments/oculoid/oculoid-viewer.js");
    const { OCULOID_DEFAULTS, eyePose } = await import("/src/instruments/oculoid/oculoid-model.js");
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "position:fixed;left:0;top:-100px;width:64px;height:64px";
    document.body.append(canvas);
    const disposed = [], originalDispose = THREE.Texture.prototype.dispose;
    let viewer, ready;
    const loaded = new Promise(resolve => { ready = resolve; });
    try {
      viewer = createOculoidViewer(canvas, { onStatus: ({ state }) => {
        if (state === "ready") ready();
      } });
      await Promise.race([loaded, new Promise((_, reject) =>
        setTimeout(() => reject(new Error("The duplicate viewer did not load")), 20_000))]);
      THREE.Texture.prototype.dispose = function () {
        disposed.push({ id: this.uuid, isCanvas: this.isCanvasTexture === true,
          width: this.image?.width, height: this.image?.height });
        return originalDispose.call(this);
      };
      for (const [choice, hex] of [["brown"], ["green"], ["custom", "#fe27c8"]]) {
        viewer.setIrisColor(choice, hex);
        viewer.setIrisPattern("stripes");
        viewer.setScleraColor("custom", "#5050ff");
        viewer.draw(eyePose(OCULOID_DEFAULTS), OCULOID_DEFAULTS);
      }
      for (const pattern of ["checker", "dots", "checker"]) {
        viewer.setLighting({ lightPattern: pattern });
        viewer.draw(eyePose(OCULOID_DEFAULTS), OCULOID_DEFAULTS);
      }
      viewer.dispose();
      viewer = null;
      return disposed;
    } finally {
      THREE.Texture.prototype.dispose = originalDispose;
      viewer?.dispose();
      canvas.remove();
    }
  });
  expect(released[0], "inactive original iris map must be released before scene traversal")
    .toMatchObject({ isCanvas: false, width: 1024, height: 1024 });
  expect(released.filter(texture => texture.isCanvas
    && texture.width === 1024 && texture.height === 1024),
  "changing color should reuse and finally release one derived iris texture").toHaveLength(1);
  expect(released.filter(texture => texture.isCanvas
    && texture.width === 512 && texture.height === 512),
  "reused projected-light cookies must be disposed exactly once each").toHaveLength(2);
  expect(new Set(released.map(texture => texture.id)).size,
    "all texture resources must be disposed at most once").toBe(released.length);
});

test("native panel knobs and the X/Y gaze pad remain synchronized across gestures and recall", async ({ page }) => {
  await openEye(page, { finish: "chrome" });
  const controls = page.locator(".oc-panel .oc-dial > input[type=range]");
  const controlCount = await controls.count();
  expect(controlCount).toBeGreaterThan(0);
  await expect(page.locator(".oc-panel input[type=range]")).toHaveCount(controlCount);
  await expect(page.locator(".oc-panel .mz-range-knob")).toHaveCount(controlCount);
  await expect(page.locator(".masthead .header-level.mz-range-knob")).toHaveCount(1);
  expect(await controls.evaluateAll(inputs => inputs.every(input =>
    input.labels?.length && Number.isFinite(Number(input.value))))).toBe(true);
  const pupil = page.locator("#pupil");
  await pupil.scrollIntoViewIfNeeded();
  const needle = page.locator(".oc-dial:has(#pupil) .mz-range-knob__dial i");
  const initialNeedle = await needle.evaluate(element => element.style.transform);
  const box = await pupil.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(pupil).toHaveValue("0.42");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 48, { steps: 3 });
  await page.mouse.up();
  expect(Number(await pupil.inputValue())).toBeGreaterThan(0.65);
  expect(await needle.evaluate(element => element.style.transform)).not.toBe(initialNeedle);
  await pupil.focus();
  await page.keyboard.press("ArrowDown");
  const afterKeyboard = Number(await pupil.inputValue());
  expect(afterKeyboard).toBeLessThan(1);
  await expect(page.locator("#pupilOut")).toHaveText(`${Math.round(afterKeyboard * 100)}%`);

  const stage = page.locator("#eyeCanvas"), front = await stage.screenshot();
  const pad = page.locator("#gazePad");
  await pad.scrollIntoViewIfNeeded();
  const area = await pad.boundingBox();
  await page.mouse.click(area.x + area.width * 0.78, area.y + area.height * 0.23);
  expect(Number(await page.locator("#gazeX").inputValue())).toBeGreaterThan(0.75);
  expect(Number(await page.locator("#gazeY").inputValue())).toBeGreaterThan(0.75);
  expect(await changedPixels(page, front, await stage.screenshot()))
    .toBeGreaterThan(1000);
  await expect(page.locator("#gazeHandle")).toHaveCSS("left", /[0-9.]+px/);
  await page.locator("#gazeHandle").focus();
  const x = Number(await page.locator("#gazeX").inputValue());
  await page.keyboard.press("Shift+ArrowLeft");
  await expect(page.locator("#gazeX")).toHaveValue((x - 0.01).toFixed(2));
  await page.locator("#gazeX").fill("0.21");
  await page.locator("#gazeY").fill("-0.31");
  await expect(page.locator("#gazeHandle")).toHaveAttribute("aria-label", /21% across, -31% up\/down/);
  await pad.evaluate(element => element.addEventListener("pointerdown",
    event => { window.__gazePointer = event.pointerId; }, { once: true }));
  await page.mouse.move(area.x + area.width * 0.5, area.y + area.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(area.x + area.width * 0.84, area.y + area.height * 0.84, { steps: 3 });
  await page.evaluate(() => document.getElementById("gazePad").dispatchEvent(
    new PointerEvent("pointercancel", { bubbles: true, pointerId: window.__gazePointer }),
  ));
  await page.mouse.up();
  await expect(page.locator("#gazeX")).toHaveValue("0.21");
  await expect(page.locator("#gazeY")).toHaveValue("-0.31");

  await page.locator(".header-preset-picker summary").click();
  await page.locator('[data-full-preset][data-preset-id="eye-36"]').click();
  await expect(page.locator("#pupil")).toHaveValue("0.44");
  expect(await needle.evaluate(element => element.style.transform)).not.toBe(initialNeedle);
  await page.locator("#resetAll").click();
  await expect(pupil).toHaveValue("0.42");
  expect(await needle.evaluate(element => element.style.transform)).toBe(initialNeedle);
  await expect(page.locator("#gazeX")).toHaveValue("0");
  await expect(page.locator("#gazeY")).toHaveValue("0");
  await expect(page.locator("#gazeHandle")).toHaveAttribute("aria-label", /0% across, 0% up\/down/);
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
});

test("brown lids retain a dark rear socket even at forward gaze and conceal extreme glances", async ({ page }, testInfo) => {
  await openEye(page);
  // This geometry/color probe counts sea-glass fibers in the licensed source
  // iris, independently of the new violet/pearl initial appearance.
  await page.locator("#irisColor").selectOption("original");
  await page.locator("#scleraColor").selectOption("natural");
  const stage = page.locator("#eyeCanvas");
  const neutral = await screenshotEyeCenter(page);
  const neutralShot = await stage.screenshot({ path: testInfo.outputPath("eye-neutral.png") });
  const visible = await visibleIrisPixels(page, neutralShot);
  expect(visible).toBeGreaterThan(1000);
  expect(await scleraOutsideLids(page, neutralShot, 0.04, 0),
    "the resting globe must remain inside the projected eyelid aperture").toBeLessThan(15);
  const neutralRecess = await lateralRecessPixels(page, neutralShot);
  for (const side of ["left", "right"]) {
    expect(neutralRecess[side].dark, `the ${side} posterior socket must be dark at rest`).toBeGreaterThan(80);
    expect(neutralRecess[side].pale, `the ${side} posterior socket must not be sclera-toned`).toBeLessThan(12);
  }
  for (const [index, { globe, globeEdge, upperRim, lowerRim }] of
    (await canthusLayerColors(page, neutralShot, 0.04, 0)).entries()) {
    expect(globe[0], `the ${index ? "right" : "left"} corner triangle must sit behind the globe`)
      .toBeGreaterThan(130);
    expect(globeEdge[0] - globeEdge[1],
      "the globe must remain in front all the way to its scleral edge").toBeGreaterThan(25);
    for (const rim of [upperRim, lowerRim]) {
      expect(rim[0], "the rounded eyelid edge must remain visible brown").toBeGreaterThan(70);
      expect(rim[0]).toBeGreaterThan(rim[2] + 25);
    }
  }
  expect(await darkSocketStripAtLids(page, neutralShot, 0.04, 0),
    "the dark recess must be behind the resting globe, not along the lid margins").toBeLessThan(12);
  const centers = { neutral };
  for (const [axis, value, name] of [
    ["gazeX", "-1", "left"], ["gazeX", "1", "right"],
    ["gazeX", "0", "center"], ["gazeY", "1", "up"], ["gazeY", "-1", "down"],
  ]) {
    await page.locator(`#${axis}`).fill(value);
    if (name === "center") {
      const reset = await lateralRecessPixels(page, await stage.screenshot());
      for (const side of ["left", "right"]) {
        expect(reset[side].dark, `the ${side} recess stays dark on returning to center`).toBeGreaterThan(80);
      }
      continue;
    }
    await expect.poll(async () => (await screenshotEyeCenter(page))[1],
      { message: `${name} gaze must move the dark iris away from center` },
    ).toBeGreaterThan(neutral[1] + 25);
    centers[name] = await screenshotEyeCenter(page);
    const frame = await stage.screenshot({ path: testInfo.outputPath(`eye-${name}.png`) });
    expect(await visibleIrisPixels(page, frame),
      `${name} extreme must hide the iris behind the stationary socket`).toBeLessThan(visible * 0.02);
    expect(await scleraOutsideLids(page, frame, 0.04, 0),
      `${name} gaze must not show sclera through the skin`).toBeLessThan(15);
    const recess = await lateralRecessPixels(page, frame);
    if (name === "left" || name === "right") {
      const trailing = name === "left" ? "right" : "left";
      expect(recess[trailing].dark,
        `${name} gaze should reveal the dark recess behind the globe`).toBeGreaterThan(80);
    } else {
      for (const side of ["left", "right"]) {
        expect(recess[side].dark,
          `${name} gaze must keep the posterior socket dark`).toBeGreaterThan(80);
      }
    }
  }
  await page.locator("#gazeY").fill("0");
  await page.locator("#blink").fill("1");
  const closed = await screenshotEyeCenter(page);
  centers.closed = closed;
  expect(closed[0]).toBeGreaterThan(closed[1] * 1.2);
  expect(closed[1]).toBeGreaterThan(closed[2] * 1.08);
  expect(closed[0]).toBeLessThan(180);
  const closedShot = await stage.screenshot({ path: testInfo.outputPath("eye-brown-closed.png") });
  expect(await scleraOutsideLids(page, closedShot, 1, 0),
    "closing the upper lid must not expose white beyond the narrow slit").toBeLessThan(15);
  await page.locator("#lowerLid").fill("-1");
  expect(await scleraOutsideLids(page, await stage.screenshot(), 1, -1),
    "raising the lower lid must cover the globe independently").toBeLessThan(15);
  await testInfo.attach("eye-center-colors.json", {
    body: JSON.stringify(centers, null, 2), contentType: "application/json",
  });
});

test("slimmer brown lids meet the globe without a socket strip at maximum opening", async ({ page }, testInfo) => {
  await openEye(page);
  const stage = page.locator("#eyeCanvas");
  const resting = await stage.screenshot();
  for (const { inside, outside } of await lidRimColors(page, resting, 0.04, 0)) {
    expect(inside[0], "the fold against the globe must be brown, not a black outline")
      .toBeGreaterThan(85);
    expect(inside[0]).toBeGreaterThan(inside[2] + 30);
    expect(outside[0], "the thick outer roll must remain brown").toBeGreaterThan(80);
    expect(outside[0]).toBeGreaterThan(outside[2] + 35);
  }

  await page.locator("#blink").fill("-1");
  await expect(page.locator("#blinkOut")).toHaveText("-100%");
  await expect(page.locator("#lowerLid")).toHaveValue("0");
  const upperOpen = await stage.screenshot();
  expect(await changedPixels(page, resting, upperOpen, [0.34, 0.1, 0.66, 0.43]),
    "pulling the upper lid beyond rest must expose the globe's upper half").toBeGreaterThan(1000);
  await page.locator("#lowerLid").fill("1");
  await expect(page.locator("#lowerLidOut")).toHaveText("+100%");
  const bothOpen = await stage.screenshot({ path: testInfo.outputPath("eye-both-lids-open.png") });
  expect(await changedPixels(page, upperOpen, bothOpen, [0.34, 0.57, 0.66, 0.92]),
    "the lower lid must open separately while the upper stays wide").toBeGreaterThan(1000);
  expect(await scleraOutsideLids(page, bothOpen, -1, 1),
    "the fully open lids must not expose sclera outside the eyelid mesh").toBeLessThan(15);
  expect(await darkSocketStripAtLids(page, bothOpen, -1, 1),
    "the fully open lip must touch the globe, not show a dark socket strip").toBeLessThan(12);
  for (const { globe, globeEdge } of await canthusLayerColors(page, bothOpen, -1, 1)) {
    expect(globe[0], "the globe stays in front of the corners when both lids open")
      .toBeGreaterThan(130);
    expect(globeEdge[0] - globeEdge[1],
      "the open lids must not expose black over the edge of the globe").toBeGreaterThan(25);
  }
  for (const { inside } of await lidRimColors(page, bothOpen, -1, 1)) {
    expect(inside[0], "the stretched folds must stay brown").toBeGreaterThan(85);
    expect(inside[0]).toBeGreaterThan(inside[2] + 30);
  }
  const openRecess = await lateralRecessPixels(page, bothOpen);
  for (const side of ["left", "right"]) {
    expect(openRecess[side].dark,
      `opening both lids must not lighten the ${side} posterior socket`).toBeGreaterThan(80);
  }
  await testInfo.attach("oculoid-both-lids-open.png", { body: bothOpen, contentType: "image/png" });

  const grips = await page.evaluate(async () => {
    const { lidCameraDistance, lidLipPoint } =
      await import("/src/instruments/oculoid/oculoid-model.js");
    const rect = document.getElementById("eyeCanvas").getBoundingClientRect();
    const f = rect.height / (2 * Math.tan(36 * Math.PI / 360));
    const cameraZ = lidCameraDistance(rect.width / rect.height);
    return [true, false].map(upper => {
      const [x, y, z] = lidLipPoint(0, 0.52, upper, -1, 1);
      return {
        x: rect.left + rect.width / 2 + f * x / (cameraZ - z),
        y: rect.top + rect.height / 2 - f * y / (cameraZ - z),
      };
    });
  });
  await page.mouse.move(grips[0].x, grips[0].y);
  await page.mouse.down();
  await page.mouse.move(grips[0].x, grips[0].y + 85, { steps: 4 });
  await page.mouse.up();
  expect(Number(await page.locator("#blink").inputValue()),
    "the lid must remain draggable after opening to its pole").toBeGreaterThan(-0.9);
  await page.mouse.move(grips[1].x, grips[1].y);
  await page.mouse.down();
  await page.mouse.move(grips[1].x, grips[1].y - 85, { steps: 4 });
  await page.mouse.up();
  expect(Number(await page.locator("#lowerLid").inputValue()),
    "the lower lid must remain draggable from fully open").toBeLessThan(0.9);
});

test("the closed outer skin stays circular from the front and from both oblique viewpoints", async ({ page }) => {
  await openEye(page);
  await page.locator("#blink").fill("1");
  await page.locator("#lowerLid").fill("-1");
  const stage = page.locator("#eyeCanvas");
  const axes = async () => page.evaluate(async base64 => {
    const image = await createImageBitmap(new Blob(
      [Uint8Array.from(atob(base64), char => char.charCodeAt(0))], { type: "image/png" }));
    const canvas = document.createElement("canvas");
    canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0); image.close();
    const { width, height } = canvas, data = ctx.getImageData(0, 0, width, height).data;
    const isSkin = (x, y) => {
      const i = (y * width + x) * 4;
      return data[i] > 42 && data[i] > data[i + 1] + 8 && data[i + 1] > data[i + 2] + 5;
    };
    const horizontal = Array.from({ length: width }, (_, x) => x).filter(x => isSkin(x, Math.floor(height / 2)));
    const vertical = Array.from({ length: height }, (_, y) => y).filter(y => isSkin(Math.floor(width / 2), y));
    return { width: horizontal.at(-1) - horizontal[0],
      height: vertical.at(-1) - vertical[0] };
  }, (await stage.screenshot()).toString("base64"));
  const front = await axes();
  expect(Math.abs(front.width / front.height - 1), "closed skin must not be tall or flat").toBeLessThan(0.035);
  for (const [id, value] of [["turnX", "70"], ["turnY", "70"], ["turnX", "-70"]]) {
    await page.locator("#turnX").fill("0");
    await page.locator("#turnY").fill("0");
    await page.locator(`#${id}`).fill(value);
    const rotated = await axes();
    expect(Math.abs(rotated.width / rotated.height - 1),
      `${id}=${value} should preserve the sphere's outer silhouette`).toBeLessThan(0.045);
    expect(Math.abs(rotated.width - front.width)).toBeLessThan(25);
    expect(Math.abs(rotated.height - front.height)).toBeLessThan(25);
  }
});

test("both fused lid corners stay smooth across the side sphere at rest and fully open", async ({ page }, testInfo) => {
  await openEye(page);
  const stage = page.locator("#eyeCanvas");
  for (const [pose, blink, lowerLid] of [["rest", "0.04", "0"], ["open", "-1", "1"]]) {
    await page.locator("#blink").fill(blink);
    await page.locator("#lowerLid").fill(lowerLid);
    for (const side of [-1, 1]) {
      // Turn toward each canthus so the front-to-side transition is visible.
      await page.locator("#turnX").fill(String(-side * 75));
      const frame = await stage.screenshot({
        path: testInfo.outputPath(`fused-canthus-${pose}-${side}.png`),
      });
      const colors = await fusedCanthusColors(page, frame, side);
      const reds = colors.map(([red]) => red);
      expect(Math.min(...reds), `${side} side cap must remain skin, not a dark cut`).toBeGreaterThan(75);
      expect(colors.every(([red, , blue]) => red > blue + 22),
        `${side} side cap must use the outer brown finish`).toBe(true);
      expect(Math.max(...reds) - Math.min(...reds),
        `${side} canthus must not leave a rolled lip or visible split extending across the cap`)
        .toBeLessThan(20);
    }
  }
});

test("the open chrome shell stays visibly round as the whole eye turns", async ({ page }) => {
  await openEye(page, { finish: "chrome" });
  const stage = page.locator("#eyeCanvas");
  const visibleAxes = async () => page.evaluate(async base64 => {
    const image = await createImageBitmap(new Blob(
      [Uint8Array.from(atob(base64), char => char.charCodeAt(0))], { type: "image/png" }));
    const canvas = document.createElement("canvas");
    canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0); image.close();
    const { width, height } = canvas;
    const pixels = ctx.getImageData(0, 0, width, height).data;
    // The liner is near-black, not a chrome ring or painted-on outline.
    // Sample above the black stage's luminance while avoiding the title and
    // the highly reflective regions that shift as the whole eye rotates.
    const visible = (x, y) => {
      const i = (y * width + x) * 4;
      return Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) > 20;
    };
    const horizontal = Array.from({ length: width }, (_, x) => x)
      .filter(x => visible(x, Math.floor(height / 2)));
    const vertical = Array.from({ length: height }, (_, y) => y)
      .filter(y => visible(Math.floor(width / 2), y));
    return { width: horizontal.at(-1) - horizontal[0],
      height: vertical.at(-1) - vertical[0] };
  }, (await stage.screenshot()).toString("base64"));
  const front = await visibleAxes();
  for (const [id, value] of [
    ["turnX", 65], ["turnX", -65], ["turnX", 0],
    ["turnY", 65], ["turnY", -65], ["turnY", 0],
  ]) {
    await page.locator(`#${id}`).fill(String(value));
    const axes = await visibleAxes();
    expect(Math.abs(axes.width / axes.height - 1),
      `${id}=${value}: the socket and eyelid must not look vertically stretched`).toBeLessThan(0.045);
    expect(Math.abs(axes.width - front.width)).toBeLessThan(30);
    expect(Math.abs(axes.height - front.height)).toBeLessThan(30);
  }
  await page.locator("#blink").fill("-1");
  await page.locator("#lowerLid").fill("1");
  await page.locator("#turnX").fill("65");
  const open = await visibleAxes();
  expect(Math.abs(open.width / open.height - 1),
    "opening both lids must not squash the surrounding orb").toBeLessThan(0.05);
});

test("background drags turn the entire rig at most 90° per axis, without stealing gaze or lid gestures", async ({ page }, testInfo) => {
  await openEye(page);
  const stage = page.locator("#eyeCanvas"), box = await stage.boundingBox();
  const neutral = await stage.screenshot();
  await page.mouse.move(box.x + 10, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 10 + box.width * 0.45, box.y + box.height * 0.25, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator("#turnX")).toHaveValue("81");
  await expect(page.locator("#turnY")).toHaveValue("45");
  expect(await changedPixels(page, neutral, await stage.screenshot()),
    "the back shell, globe, lids, lashes and tears should rotate together").toBeGreaterThan(2500);
  for (const [id, value] of [["gazeX", "0"], ["gazeY", "0"], ["blink", "0.04"], ["lowerLid", "0"]]) {
    await expect(page.locator(`#${id}`)).toHaveValue(value);
  }
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  await testInfo.attach("oculoid-whole-eye-turned.png", {
    body: await stage.screenshot(), contentType: "image/png",
  });
  await page.locator("#turnX").fill("60");
  await page.locator("#turnY").fill("0");
  const sideView = await stage.screenshot({ path: testInfo.outputPath("oculoid-side-seam.png") });
  const seam = await sideEquatorContinuity(page, sideView);
  expect(seam.minRed, "the back/front join must not reveal the dark backdrop").toBeGreaterThan(65);
  expect(seam.minBrown, "the outside remains brown across the seam").toBeGreaterThan(22);
  expect(seam.maxStep, "the spherical skin must shade smoothly across its equator").toBeLessThan(28);
  await testInfo.attach("oculoid-side-seam.png", { body: sideView, contentType: "image/png" });
  await page.locator("#turnX").fill("81");
  await page.locator("#turnY").fill("45");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 75, box.y + box.height / 2 - 60, { steps: 3 });
  await page.mouse.up();
  expect(Number(await page.locator("#gazeX").inputValue())).toBeGreaterThan(0.1);
  expect(Number(await page.locator("#gazeY").inputValue())).toBeGreaterThan(0.1);
  await expect(page.locator("#turnX")).toHaveValue("81");
  await expect(page.locator("#turnY")).toHaveValue("45");
  await page.locator("#gazeX").fill("0");
  await page.locator("#gazeY").fill("0");

  await page.locator("#turnX").fill("0");
  await page.locator("#turnY").fill("0");
  await page.mouse.move(box.x + 10, box.y + box.height - 10);
  await page.mouse.down();
  // Pointer capture keeps rotating when the drag leaves the eye AND canvas.
  await page.mouse.move(box.x + box.width - 5, 0, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator("#turnX")).toHaveValue("90");
  await expect(page.locator("#turnY")).toHaveValue("90");
  await expect(page.locator("#turnXOut")).toHaveText("90°");
  await expect(page.locator("#turnYOut")).toHaveText("90°");
  await page.locator("#turnX").fill("-90");
  await page.locator("#turnY").fill("-90");
  await expect(page.locator("#turnX")).toHaveValue("-90");
  await expect(page.locator("#turnY")).toHaveValue("-90");

  await page.locator("#turnX").fill("0");
  await page.locator("#turnY").fill("0");
  await page.evaluate(() => {
    document.getElementById("eyeCanvas").addEventListener("pointerdown",
      event => { window.eyeTurnPointer = event.pointerId; }, { once: true });
  });
  await page.mouse.move(box.x + 10, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 10 + box.width * 0.3, box.y + box.height * 0.3);
  await expect(page.locator("#turnX")).not.toHaveValue("0");
  await page.evaluate(() => document.getElementById("eyeCanvas").dispatchEvent(
    new PointerEvent("pointercancel", { bubbles: true, pointerId: window.eyeTurnPointer }),
  ));
  await page.mouse.up();
  await expect(page.locator("#turnX")).toHaveValue("0");
  await expect(page.locator("#turnY")).toHaveValue("0");
  expect(await stage.evaluate(canvas => canvas.hasPointerCapture(window.eyeTurnPointer))).toBe(false);

  // Whole-eye viewpoint is not a musical preset parameter, but Reset centers it.
  await page.locator("#turnX").fill("35");
  await page.locator(".header-preset-picker summary").click();
  await page.locator('[data-full-preset][data-preset-id="eye-5"]').click();
  await expect(page.locator("#turnX")).toHaveValue("35");
  await page.locator("#resetAll").click();
  await expect(page.locator("#turnX")).toHaveValue("0");
  await expect(page.locator("#turnY")).toHaveValue("0");
});

test("a thick spherical eyelid fills the stage without a face sheet or tear duct", async ({ page }, testInfo) => {
  const dropResponses = [];
  page.on("response", response => {
    if (new URL(response.url()).pathname === "/assets/oculoid/drop.glb") {
      dropResponses.push(response.status());
    }
  });
  await openEye(page);
  await expect.poll(() => dropResponses,
    { message: "the credited teardrop mesh must be requested, not merely the sphere fallback" }).toContain(200);
  const stage = page.locator("#eyeCanvas");
  const neutral = await stage.screenshot({ path: testInfo.outputPath("eye-sculpted-neutral.png") });
  const { shell, bottom, top, side, diagonal } = await shellAndBackdropColors(page, neutral);
  expect(shell[0], "spherical skin should reach near the top of the canvas").toBeGreaterThan(top[0] + 22);
  expect(bottom[0], "the back of the orb should fill the bottom of the canvas").toBeGreaterThan(top[0] + 20);
  expect(shell[0], "there must be no flat brown rectangle behind the orb").toBeGreaterThan(side[0] + 22);
  expect(shell[0], "the diagonal outside the spherical silhouette should be dark")
    .toBeGreaterThan(diagonal[0] + 22);
  await expect(page.locator(".oc-stage-readout, .oc-gesture-hint, .oc-stage-shade")).toHaveCount(0);
  await expect(page.locator(".oc-stage")).toHaveCSS("border-top-width", "0px");
  const heading = await page.evaluate(() => ({
    size: parseFloat(getComputedStyle(document.getElementById("ocTitle")).fontSize),
    family: getComputedStyle(document.getElementById("ocTitle")).fontFamily,
    body: getComputedStyle(document.body).fontFamily,
  }));
  expect(heading.size).toBeLessThanOrEqual(36);
  expect(heading.family).toBe(heading.body);

  await page.locator("#wetness").fill("0");
  const dry = await stage.screenshot({ path: testInfo.outputPath("eye-dry.png") });
  await page.locator("#wetness").fill("0.5");
  const moist = await stage.screenshot();
  expect(await changedPixels(page, dry, moist, [0.12, 0.57, 0.43, 0.97]),
    "Tear size alone must not start a drop or draw an oval").toBeLessThan(40);
  await page.locator("#wetness").fill("1");
  await page.locator("#cryTempo").fill("50");
  const stillDry = await stage.screenshot();
  // Freeze the *tear* clock at specific phases while real RAF/WebGL frames
  // catch up. Motion stays paused throughout: Tear/Cry own their own clock.
  await page.evaluate(() => {
    const start = performance.now();
    let beat = 0;
    Object.defineProperty(performance, "now", {
      configurable: true, value: () => start + beat * 1200,
    });
    window.__oculoidSetTearBeat = value => { beat = value; };
  });
  const setTearBeat = beat => page.evaluate(value => window.__oculoidSetTearBeat(value), beat);
  const stillBufferWidth = await stage.evaluate(canvas => canvas.width);
  await page.locator("#tearOnce").click();
  // Animated tears use the lower moving WebGL budget. Capture the dry start
  // at that same resolution, so pixel differences isolate the drop.
  await expect.poll(() => stage.evaluate(canvas => canvas.width),
    { message: "a falling tear should adopt the audio-first rendering budget" })
    .toBeLessThan(stillBufferWidth);
  const movingDry = await stage.screenshot();
  const sampleTear = async () => tearPixelBounds(page, movingDry, await stage.screenshot());
  await expect.poll(async () => (await sampleTear()).count,
    { message: "Tear begins with no drop", timeout: 10_000 }).toBeLessThan(100);
  await setTearBeat(0.8);
  let forming;
  await expect.poll(async () => {
    forming = await sampleTear();
    return forming.count;
  }, { message: "a small drop should form at the corner", timeout: 10_000 }).toBeGreaterThan(80);
  await setTearBeat(1.9);
  let grown;
  await expect.poll(async () => {
    grown = await sampleTear();
    return grown.count;
  }, { message: "the drop should visibly grow from nothing at the corner",
    timeout: 10_000 }).toBeGreaterThan(forming.count * 1.7);
  expect(Math.abs(grown.centerX - forming.centerX),
    "the bulb should grow straight down rather than leaning away from the corner").toBeLessThan(6);
  const crying = await stage.screenshot({ path: testInfo.outputPath("eye-crying.png") });
  await expect(page.locator(".oc-stage")).toHaveAttribute("data-model-state", "ready");
  const stillDrop = await tearPixelBounds(page, movingDry, crying);
  expect(stillDrop.count,
    "one large drop must grow out of the viewer-left lid corner").toBeGreaterThan(1000);
  expect(stillDrop.right - stillDrop.left).toBeGreaterThan(58);
  expect(stillDrop.bottom - stillDrop.top).toBeGreaterThan(155);
  expect(stillDrop.bottom - stillDrop.top,
    "the large bulb should not become a narrow streak").toBeLessThan((stillDrop.right - stillDrop.left) * 3);
  expect(stillDrop.bottom,
    "the drop must not have a long streak running down the lower skin").toBeLessThan(stillDrop.height * 0.97);
  const corner = await page.evaluate(async ({ width, height }) => {
    const { lidCameraDistance, lidLipPoint, TEAR_TIP_HEIGHT, tearDropPose } =
      await import("/src/instruments/oculoid/oculoid-model.js");
    const f = height / (2 * Math.tan(36 * Math.PI / 360));
    const cameraZ = lidCameraDistance(width / height);
    const project = ([x, y, z]) => ({
      x: width / 2 + f * x / (cameraZ - z),
      y: height / 2 - f * y / (cameraZ - z),
    });
    const drop = tearDropPose(0.04, 0, 1, 1.9, true);
    return {
      tip: project([drop.x, drop.y + TEAR_TIP_HEIGHT * drop.size, drop.z]),
      exterior: project(lidLipPoint(drop.x, 0.55, false, 0.04, 0)),
    };
  }, { width: stillDrop.width, height: stillDrop.height });
  expect(Math.abs(stillDrop.centerX - corner.tip.x),
    "the grown bulb should stay vertically under its anchored tip").toBeLessThan(6);
  expect(Math.abs(stillDrop.top - corner.tip.y),
    "the pointed GLB apex should touch the lid join, not hover away").toBeLessThan(14);
  expect(Math.abs(stillDrop.top - corner.exterior.y),
    "the tear must start at the lower lid, not inside the eyeline").toBeLessThan(14);
  await testInfo.attach("oculoid-crying.png", { body: crying, contentType: "image/png" });
  await page.locator("#wetness").fill("0");
  let tiny;
  await expect.poll(async () => {
    tiny = await sampleTear();
    return tiny.count;
  }, { message: "Tear size should visibly reduce the bulb while its tip stays at the corner",
    timeout: 10_000 }).toBeLessThan(grown.count * 0.4);
  await page.locator("#wetness").fill("1");
  await expect.poll(async () => (await sampleTear()).count,
    { message: "increasing Tear size grows the same anchored bulb", timeout: 10_000 })
    .toBeGreaterThan(tiny.count * 4);
  // Sample early in the fall, while the enlarged bulb is fully in frame;
  // later frames clip its lower half against the bottom of the stage.
  await setTearBeat(2.5);
  let fallingImage, falling;
  await expect.poll(async () => {
    fallingImage = await stage.screenshot();
    falling = await tearPixelBounds(page, movingDry, fallingImage);
    return falling.count > 300 ? falling.centerY : -Infinity;
  }, { message: "the detached drop should fall below its growth position",
    timeout: 10_000 }).toBeGreaterThan(grown.centerY + 12);
  expect(Math.abs(falling.centerX - grown.centerX),
    "the drop must fall straight down, not slide inward across the lid").toBeLessThan(9);
  expect(falling.right - falling.left,
    "the falling drop must not become a thin, shrinking streak")
    .toBeGreaterThan((grown.right - grown.left) * 0.75);
  await testInfo.attach("eye-tear-in-motion.png", { body: fallingImage, contentType: "image/png" });
  await setTearBeat(3.84);
  await expect.poll(async () => (await sampleTear()).count,
    { message: "the still-full-size tear should exit below the stage before resetting",
      timeout: 10_000 }).toBeLessThan(100);
  await setTearBeat(5.9);
  await expect.poll(async () => tearPixelBounds(page, stillDry, await stage.screenshot())
    .then(bounds => bounds.count),
  { message: "Tear must not start a second cycle", timeout: 10_000 }).toBeLessThan(100);
  await expect(page.locator("#motionButton")).toHaveAttribute("aria-pressed", "false");
  await page.locator("#cryMode").click();
  await expect(page.locator("#cryMode")).toHaveAttribute("aria-pressed", "true");
  await setTearBeat(7.8);
  await expect.poll(async () => (await sampleTear()).count,
    { message: "Cry starts another drop without Motion", timeout: 10_000 }).toBeGreaterThan(900);
  await page.locator("#tempo").fill("200");
  await expect(page.locator("#cryTempo")).toHaveValue("50");
  await page.locator("#cryTempo").fill("100");
  await setTearBeat(8.3);
  let faster;
  await expect.poll(async () => {
    faster = await sampleTear();
    return faster.centerY;
  }, { message: "changing Cry tempo preserves its phase through detachment",
    timeout: 10_000 }).toBeGreaterThan(grown.centerY + 12);
  await setTearBeat(9.8);
  await expect.poll(async () => (await sampleTear()).count,
    { message: "Cry repeats at its new tempo with Motion stopped", timeout: 10_000 })
    .toBeGreaterThan(900);
  await page.locator("#cryMode").click();
  await expect(page.locator("#cryMode")).toHaveAttribute("aria-pressed", "false");

  await page.locator("#blink").fill("1");
  const closed = await stage.screenshot();
  const upper = await page.locator("#blink").inputValue();
  await page.locator("#lowerLid").fill("1");
  await expect(page.locator("#blink")).toHaveValue(upper);
  await expect(page.locator("#lowerLidOut")).toHaveText("+100%");
  const reopened = await stage.screenshot();
  expect(await brightLowerEyePixels(page, reopened))
    .toBeGreaterThan((await brightLowerEyePixels(page, closed)) + 300);
  await testInfo.attach("oculoid-lower-open.png", { body: reopened, contentType: "image/png" });
});

test("24 new scenes include tiny pupils, pupil-only pulses and forward lid-only flutter", async ({ page }, testInfo) => {
  await openEye(page);
  const stage = page.locator("#eyeCanvas");
  await page.locator(".header-preset-picker summary").click();
  await expect(page.locator("[data-full-preset]")).toHaveCount(36);
  await page.locator('[data-full-preset][data-preset-id="eye-13"]').click();
  await expect(page.locator("#eyeballStyle")).toHaveValue("pupil");
  await expect(page.locator("#eyelidStyle")).toHaveValue("still");
  for (const id of ["gazeX", "gazeY", "lowerLid"]) await expect(page.locator(`#${id}`)).toHaveValue("0");
  const stillPupil = await stage.screenshot();
  await page.locator("#motion").fill("1");
  await page.locator("#tempo").fill("170");
  await page.locator("#motionButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await expect.poll(async () => changedPixels(page, stillPupil, await stage.screenshot(),
    [0.37, 0.28, 0.63, 0.72]), { timeout: 10_000 }).toBeGreaterThan(400);
  for (const [id, value] of [["gazeX", "0"], ["gazeY", "0"], ["blink", "0.04"],
    ["lowerLid", "0"]]) await expect(page.locator(`#${id}`)).toHaveValue(value);

  // Isolated pupil movement still sounds in discrete attacks, not a drone.
  await page.locator("#audioButton").click();
  await waitForArmedGraph(page);
  const { summary } = await sampleEyeAudio(page, 2400);
  expect(summary.finite).toBe(true);
  expect(summary.maxPeak, "the pupil-only LFO must excite audible events").toBeGreaterThan(0.008);
  await page.locator("#motionButton").click();
  await page.locator("#pupil").fill("1");
  const large = await stage.screenshot();
  await page.locator(".header-preset-picker summary").click();
  await page.locator('[data-full-preset][data-preset-id="eye-21"]').click();
  await expect(page.locator("#pupil")).toHaveValue("0");
  const tiny = await stage.screenshot({ path: testInfo.outputPath("eye-pinlight-pupil.png") });
  expect(await darkPupilPixels(page, tiny),
    "a tiny-pupil preset must render a genuinely smaller central aperture")
    .toBeLessThan((await darkPupilPixels(page, large)) * 0.3);

  await page.locator(".header-preset-picker summary").click();
  await page.locator('[data-full-preset][data-preset-id="eye-29"]').click();
  await expect(page.locator("#eyeballStyle")).toHaveValue("still");
  await expect(page.locator("#eyelidStyle")).toHaveValue("lid-flutter");
  await expect(page.locator("#gazeX")).toHaveValue("0");
  await expect(page.locator("#gazeY")).toHaveValue("0");
  await expect(page.locator("#pupil")).toHaveValue("0.12");
  const stillLids = await stage.screenshot();
  await page.locator("#motionButton").click();
  await expect.poll(async () => changedPixels(page, stillLids, await stage.screenshot()),
    { timeout: 10_000 }).toBeGreaterThan(500);
  await expect(page.locator("#pupil")).toHaveValue("0.12");
  await expect(page.locator("#gazeX")).toHaveValue("0");
  await expect(page.locator("#gazeY")).toHaveValue("0");
  await page.locator(".header-preset-picker summary").click();
  await page.locator('[data-full-preset][data-preset-id="eye-31"]').click();
  await expect(page.locator("#motionButton")).toHaveAttribute("aria-pressed", "true",
    "changing presets must not restart or pause Motion");
  await expect(page.locator("#eyeballStyle")).toHaveValue("still");
  await expect(page.locator("#eyelidStyle")).toHaveValue("lid-flutter");
  await expect(page.locator("#gazeX")).toHaveValue("0");
  await expect(page.locator("#pupil")).toHaveValue("0.08");
  await page.locator("#motionButton").click();
});

test("textured globe, gesture and complete presets play silently without arming Audio", async ({ page }, testInfo) => {
  // Several full-canvas WebGL captures can take >75s in software-rendered CI.
  test.setTimeout(120_000);
  await openEye(page);
  const stage = page.locator("#eyeCanvas");
  const box = await stage.boundingBox();
  expect(box.width).toBeGreaterThan(650);
  expect(box.height).toBeGreaterThan(550);
  await testInfo.attach("oculoid-desktop.png", { body: await page.screenshot(), contentType: "image/png" });
  const openPixel = await screenshotEyeCenter(page);
  await page.locator("#blink").fill("1");
  await expect(page.locator("#blink")).toHaveValue("1");
  const closedPixel = await screenshotEyeCenter(page);
  expect(closedPixel[0]).toBeGreaterThan(openPixel[0] + 20);
  expect(closedPixel[0]).toBeGreaterThan(closedPixel[2] + 15);
  await testInfo.attach("oculoid-lid-closed.png", {
    body: await page.screenshot(), contentType: "image/png",
  });
  await page.locator("#blink").fill("0.04");
  expect(await readAudioStatus(page)).toMatchObject({ active: false, connectionCount: 0 });
  const play = page.locator("#motionButton");
  // Exercise an unmistakable glance rather than depending on a narrow,
  // near-neutral instant of the default Drift oscillator.
  await page.locator("#eyeballStyle").selectOption("wild");
  await page.locator("#motion").fill("1");
  const stillFrame = await stage.screenshot();
  await play.click();
  await expect(play).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await expect.poll(async () => changedPixels(page, stillFrame, await stage.screenshot()),
    { message: "silent Motion must visibly move the eye", timeout: 20_000 }).toBeGreaterThan(1000);
  await page.keyboard.press("Space");
  await expect(play).toHaveAttribute("aria-pressed", "false");

  // Captured iris drag edits both dimensions and cancellation restores them.
  await page.evaluate(() => {
    window.eyeTestPointer = null;
    document.getElementById("eyeCanvas").addEventListener("pointerdown",
      event => { window.eyeTestPointer = event.pointerId; }, { once: true });
  });
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 110, box.y + box.height / 2 - 80, { steps: 5 });
  expect(Number(await page.locator("#gazeX").inputValue())).toBeGreaterThan(0.1);
  expect(Number(await page.locator("#gazeY").inputValue())).toBeGreaterThan(0.1);
  await page.evaluate(() => document.getElementById("eyeCanvas").dispatchEvent(
    new PointerEvent("pointercancel", { bubbles: true, pointerId: window.eyeTestPointer }),
  ));
  await page.mouse.up();
  await expect(page.locator("#gazeX")).toHaveValue("0");
  await expect(page.locator("#gazeY")).toHaveValue("0");
  expect(await stage.evaluate(canvas => canvas.hasPointerCapture(window.eyeTestPointer))).toBe(false);

  // The lid hit region follows its actual upper margin, not the iris.
  await page.mouse.move(box.x + box.width / 2, box.y + 90);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 195, { steps: 5 });
  await page.mouse.up();
  expect(Number(await page.locator("#blink").inputValue())).toBeGreaterThan(0.2);
  const movedUpper = await page.locator("#blink").inputValue();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.73);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.73 + 90, { steps: 5 });
  await page.mouse.up();
  expect(Number(await page.locator("#lowerLid").inputValue())).toBeGreaterThan(0.12);
  await expect(page.locator("#blink")).toHaveValue(movedUpper);
  await stage.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#gazeX")).not.toHaveValue("0");
  await page.keyboard.down("l");
  await expect(page.locator("#blink")).toHaveValue("1");
  await page.keyboard.up("l");
  expect(Number(await page.locator("#blink").inputValue())).toBeLessThan(1);

  await page.locator("#outputLevel").fill("0.27");
  await play.click();
  await page.locator(".header-preset-picker summary").click();
  await page.locator('[data-full-preset][data-preset-id="eye-5"]').click();
  await expect(page.locator("#rootHz")).toHaveValue("174");
  await expect(page.locator("#tempo")).toHaveValue("160");
  await expect(page.locator("#eyeballStyle")).toHaveValue("flutter");
  await expect(page.locator("#eyelidStyle")).toHaveValue("flutter");
  await expect(play).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#outputLevel")).toHaveValue("0.27");
  await page.locator(".header-preset-random").click();
  await expect(page.locator(".header-preset-picker summary")).toContainText("Custom");
  await page.locator("#resetAll").click();
  await expect(page.locator("#rootHz")).toHaveValue("112");
  await expect(page.locator("#eyeballStyle")).toHaveValue("drift");
  await expect(page.locator("#eyelidStyle")).toHaveValue("blink");
  await expect(page.locator("#blink")).toHaveValue("0.04");
  await expect(page.locator("#lowerLid")).toHaveValue("0");
  await expect(play).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#outputLevel")).toHaveValue("0.27");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
});

test("switching repeating eye styles animates the globe and independent lids without changing manual sliders", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await openEye(page);
  const stage = page.locator("#eyeCanvas");
  await page.locator("#motion").fill("1");
  await page.locator("#tempo").fill("145");
  await page.locator("#motionButton").click();
  for (const style of ["flutter", "wild", "drowse"]) {
    await page.locator("#eyeballStyle").selectOption(style);
    await page.locator("#eyelidStyle").selectOption(style);
    const before = await stage.screenshot();
    await page.waitForTimeout(450);
    const after = await stage.screenshot();
    expect(await changedPixels(page, before, after), `${style} must animate the actual viewer`)
      .toBeGreaterThan(250);
    await testInfo.attach(`oculoid-${style}.png`, { body: after, contentType: "image/png" });
    await expect(page.locator("#gazeX")).toHaveValue("0");
    await expect(page.locator("#blink")).toHaveValue("0.04");
    await expect(page.locator("#lowerLid")).toHaveValue("0");
  }
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await page.locator("#motionButton").click();
  await expect(page.locator("#eyeballStyle")).toHaveValue("drowse");
  await expect(page.locator("#eyelidStyle")).toHaveValue("drowse");
});

test("separate eyeball/lid animations and local dice leave the other part, Play and Audio alone", async ({ page }) => {
  await openEye(page, { finish: "chrome" });
  const eye = page.getByRole("combobox", { name: "Eyeball animation" });
  const lids = page.getByRole("combobox", { name: "Eyelid animation" });
  const eyeDice = page.getByRole("button", { name: "Random eyeball animation" });
  const lidDice = page.getByRole("button", { name: "Random eyelid animation" });
  const play = page.locator("#motionButton"), canvas = page.locator("#eyeCanvas");
  await expect(eye.locator("option")).toHaveCount(6);
  await expect(lids.locator("option")).toHaveCount(6);
  await page.locator("#tempo").fill("154");
  await page.locator("#motion").fill("1");
  await eye.selectOption("still");
  await lids.selectOption("lid-flutter");
  const idle = await canvas.screenshot();
  await play.click();
  await expect.poll(async () => changedPixels(page, idle, await canvas.screenshot()),
    { timeout: 10_000 }).toBeGreaterThan(500);
  await expect(eye).toHaveValue("still");
  await expect(page.locator("#pupil")).toHaveValue("0.42");
  await lids.selectOption("still");
  await page.waitForTimeout(160);
  const held = await canvas.screenshot();
  await page.waitForTimeout(220);
  expect(await changedPixels(page, held, await canvas.screenshot(), undefined, 35),
    "Still on both parts keeps the globe still even while the clock plays").toBeLessThan(80);
  await eyeDice.click();
  const firstEye = await eye.inputValue();
  expect(firstEye).not.toBe("still");
  await expect(lids).toHaveValue("still");
  await eyeDice.click();
  expect(await eye.inputValue()).not.toBe(firstEye);
  await expect(lids).toHaveValue("still");
  await eye.selectOption("still");
  await lidDice.click();
  const firstLid = await lids.inputValue();
  expect(firstLid).not.toBe("still");
  await expect(eye).toHaveValue("still");
  await lidDice.click();
  expect(await lids.inputValue()).not.toBe(firstLid);
  await expect(eye).toHaveValue("still");
  await expect(play).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  expect((await readAudioStatus(page)).active).toBe(false);
  await expect(page.locator("#tempo")).toHaveValue("154");
  await expect(page.locator("#motion")).toHaveValue("1");
  for (const [id, value] of [["gazeX", "0"], ["gazeY", "0"], ["blink", "0.04"],
    ["lowerLid", "0"], ["pupil", "0.42"]]) await expect(page.locator(`#${id}`)).toHaveValue(value);
  await page.locator("#stageReset").click();
  await expect(eye).toHaveValue("drift");
  await expect(lids).toHaveValue("blink");
  await expect(play).toHaveAttribute("aria-pressed", "true");
  expect(diagnostics.get(page)).toEqual([]);
});

test("LFO motion makes short sounds without a drone; lids, Output and mute remain effective", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await openEye(page);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  expect((await readAudioStatus(page)).active).toBe(false);
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true", { timeout: 7000 });
  await waitForArmedGraph(page);
  await page.waitForTimeout(240);
  const idle = await sampleEyeAudio(page, 320);
  expect(idle.summary.maxPeak).toBeLessThan(0.002);
  await page.locator("#eyeballStyle").selectOption("flutter");
  await page.locator("#eyelidStyle").selectOption("flutter");
  await page.locator("#motion").fill("1");
  await page.locator("#tempo").fill("160");
  await page.locator("#motionButton").click();
  const open = await sampleEyeAudio(page, 1800, 9);
  expect(open.summary.finite).toBe(true);
  expect(open.summary.sampleCount).toBeGreaterThan(8);
  expect(open.summary.maxPeak).toBeGreaterThan(0.01);
  expect(open.summary.maxPeak).toBeLessThan(0.9);
  expect(open.summary.clippedSamples).toBe(0);
  expect(open.summary.activeSamples, JSON.stringify(open.summary)).toBeGreaterThan(0);
  await page.locator("#blink").fill("1");
  await page.waitForTimeout(300);
  const closed = await sampleEyeAudio(page, 1800, 9);
  expect(closed.summary.sampleCount).toBeGreaterThan(8);
  expect(closed.summary.meanRms, JSON.stringify({ open: open.summary, closed: closed.summary }))
    .toBeLessThan(open.summary.meanRms * 0.7);
  await page.locator("#lowerLid").fill("1");
  await page.waitForTimeout(300);
  const bottomOpen = await sampleEyeAudio(page, 1800, 9);
  expect(bottomOpen.summary.sampleCount).toBeGreaterThan(8);
  expect(bottomOpen.summary.meanRms, JSON.stringify({ closed: closed.summary, bottomOpen: bottomOpen.summary }))
    .toBeGreaterThan(closed.summary.meanRms * 1.12);
  await page.locator("#lowerLid").fill("0");
  await page.locator("#blink").fill("0.04");
  await page.locator("#outputLevel").fill("0");
  await page.waitForTimeout(270);
  const quiet = await sampleEyeAudio(page, 550);
  expect(quiet.summary.maxPeak).toBeLessThan(0.002);
  await page.locator("#outputLevel").fill("0.4");
  const unmuted = await sampleEyeAudio(page, 1800, 9);
  expect(unmuted.summary.maxPeak).toBeGreaterThan(0.005);
  await page.locator("#motionButton").click();
  await page.waitForTimeout(450);
  const resting = await sampleEyeAudio(page, 350);
  expect(resting.summary.maxPeak).toBeLessThan(0.002);
  await testInfo.attach("oculoid-audio.json", {
    body: JSON.stringify({ idle: idle.summary, open: open.summary, closed: closed.summary,
      bottomOpen: bottomOpen.summary, quiet: quiet.summary, unmuted: unmuted.summary,
      resting: resting.summary }, null, 2),
    contentType: "application/json",
  });
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await waitForStableAudioState(page, false);
  await page.locator("#motionButton").click();
  await expect(page.locator("#motionButton")).toHaveAttribute("aria-pressed", "true");
  expect((await readAudioStatus(page)).active).toBe(false);
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(0);
});

test("four eye voices and the eyelid rhythm can sound independently, even with the shell removed", async ({ page }) => {
  test.setTimeout(120_000);
  await openEye(page, { finish: "chrome" });
  await page.locator("#eyeCount").fill("4");
  await page.locator("#ensembleStyle").selectOption("harmony");
  await page.locator("#eyeballStyle").selectOption("still");
  await page.locator("#eyelidStyle").selectOption("still");
  await page.locator("#motion").fill("1");
  await page.locator("#tempo").fill("166");
  await page.locator("#audioButton").click();
  await waitForArmedGraph(page);
  const idle = await sampleEyeAudio(page, 350);
  expect(idle.summary.maxPeak).toBeLessThan(0.002);
  await page.locator("#eyeballStyle").selectOption("wild");
  await page.locator("#motionButton").click();
  const band = await sampleEyeAudio(page, 1500, 7);
  expect(band.summary.maxPeak, JSON.stringify(band.summary)).toBeGreaterThan(0.005);
  expect(band.summary.maxPeak).toBeLessThan(0.9);
  expect(band.summary.clippedSamples).toBe(0);
  await page.locator("#eyeballStyle").selectOption("still");
  await page.locator("#eyelidStyle").selectOption("flutter");
  await page.locator("#lidRate").fill("2");
  const lids = await sampleEyeAudio(page, 1200, 6);
  expect(lids.summary.maxPeak, JSON.stringify(lids.summary)).toBeGreaterThan(0.005);
  await page.locator("#hideLids").click();
  await page.waitForTimeout(300);
  const noLids = await sampleEyeAudio(page, 350, 2);
  expect(noLids.summary.maxPeak, "the hidden shell has no phantom rhythm").toBeLessThan(0.002);
  await page.locator("#eyeballStyle").selectOption("wild");
  const bareBand = await sampleEyeAudio(page, 1200, 6);
  expect(bareBand.summary.maxPeak,
    "all four voices still play when their shared eyelid hides").toBeGreaterThan(0.005);
  await page.locator("#motionButton").click();
  await page.waitForTimeout(390);
  const quiet = await sampleEyeAudio(page, 350, 2);
  expect(quiet.summary.maxPeak).toBeLessThan(0.002);
  expect(diagnostics.get(page)).toEqual([]);
});

test("BFCache parks the voice, preserves Motion and musical state, and accepts an explicit re-arm", async ({ page }) => {
  await openEye(page);
  await page.locator("#gazeX").fill("0.62");
  await page.locator("#turnX").fill("55");
  await page.locator("#outputLevel").fill("0.24");
  await page.locator("#motionButton").click();
  await page.locator("#audioButton").click();
  await waitForArmedGraph(page);
  const before = await page.locator("#gazeX").inputValue();
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
  await waitForStableAudioState(page, false);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#motionButton")).toHaveAttribute("aria-pressed", "true");
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  await expect(page.locator("#gazeX")).toHaveValue(before);
  await expect(page.locator("#turnX")).toHaveValue("55");
  await expect(page.locator("#outputLevel")).toHaveValue("0.24");
  await expect(page.locator(".oc-stage")).toHaveAttribute("data-model-state", "ready");
  await page.locator("#blink").fill("0.53");
  await expect(page.locator("#blink")).toHaveValue("0.53");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await page.locator("#audioButton").click();
  await waitForArmedGraph(page);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false })));
  await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(0);
});

test("BFCache cancels a captured poke without carrying its dent or Audio back", async ({ page }) => {
  await openEye(page, { finish: "chrome" });
  const canvas = page.locator("#eyeCanvas"), poke = page.locator("#pokeMode");
  await poke.click();
  const original = await canvas.screenshot(), box = await canvas.boundingBox();
  await page.locator("#audioButton").click();
  await waitForArmedGraph(page);
  await canvas.evaluate(element => element.addEventListener("pointerdown",
    event => { window.ocPokePointer = event.pointerId; }, { once: true }));
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(260);
  expect(await changedPixels(page, original, await canvas.screenshot(),
    [0.37, 0.25, 0.63, 0.75], 35)).toBeGreaterThan(270);
  expect(await canvas.evaluate(element => element.hasPointerCapture(window.ocPokePointer))).toBe(true);

  await page.evaluate(() => dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
  await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(0);
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  await page.mouse.up();
  await expect.poll(async () => changedPixels(page, original,
    await canvas.screenshot(), undefined, 25), { timeout: 10_000 }).toBeLessThan(90);
  expect(await canvas.evaluate(element => element.hasPointerCapture(window.ocPokePointer))).toBe(false);
  await expect(poke).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#gazeX")).toHaveValue("0");
  await expect(page.locator("#gazeY")).toHaveValue("0");
  expect(diagnostics.get(page)).toEqual([]);
});

test("one click resumes interrupted Audio; a failed processor is replaced on the next explicit click", async ({ page }) => {
  await page.addInitScript(() => {
    const Context = window.AudioContext, Node = window.AudioWorkletNode;
    window.__oculoidAudioNodes = [];
    window.__oculoidAudioContexts = [];
    window.AudioContext = class extends Context {
      constructor(...args) {
        super(...args);
        window.__oculoidAudioContexts.push(this);
      }
    };
    window.AudioWorkletNode = class extends Node {
      constructor(...args) {
        super(...args);
        window.__oculoidAudioNodes.push(this);
      }
    };
  });
  await openEye(page);
  await page.locator("#audioButton").click();
  await waitForArmedGraph(page);
  await page.evaluate(() => window.__oculoidAudioContexts[0].suspend());
  await expect(page.locator("#audioButton")).toHaveAttribute("data-audio-state", "interrupted");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-label", /resume audio/i);
  await page.locator("#audioButton").click();
  await waitForArmedGraph(page);
  await expect(page.locator("#audioButton")).toHaveAttribute("data-audio-state", "on");
  expect(await page.evaluate(() => window.__oculoidAudioNodes.length)).toBe(1);
  await page.evaluate(() => window.__oculoidAudioNodes[0].onprocessorerror());
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#liveStatus")).toContainText("processor stopped");
  await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(0);
  await page.locator("#audioButton").click();
  await waitForArmedGraph(page);
  expect(await page.evaluate(() => window.__oculoidAudioNodes.length)).toBe(2);
  expect(await page.evaluate(() => window.__oculoidAudioContexts.length)).toBe(2);
});

test("MIDI notes and CCs steer gaze/presets while clock and transport follow the shared input", async ({ page }) => {
  await installFakeMidi(page);
  await openEye(page);
  const stage = page.locator("#eyeCanvas");
  const neutral = await stage.screenshot();
  const status = await enableFakeMidi(page);
  expect(status.requests).toEqual([{ sysex: false, software: false }]);
  await sendMidi(page, MIDI_BYTES.noteOn(69, 110));
  await expect.poll(async () => changedPixels(page, neutral, await stage.screenshot()),
    { message: "a held MIDI note must visibly redirect the iris" }).toBeGreaterThan(600);
  await expect(page.locator("#motionButton")).toHaveAttribute("aria-pressed", "false");
  await sendMidi(page, MIDI_BYTES.noteOff(69));
  await expect.poll(async () => changedPixels(page, neutral, await stage.screenshot()))
    .toBeLessThan(80);
  await page.locator("#eyeCanvas").focus();
  await page.keyboard.down("l");
  await expect(page.locator("#blink")).toHaveValue("1");
  await page.keyboard.up("l");
  await expect(page.locator("#blink")).toHaveValue("0.04");
  await sendMidi(page, MIDI_BYTES.controlChange(14, 127));
  await expect(page.locator("#gazeX")).toHaveValue("1");
  await sendMidi(page, MIDI_BYTES.controlChange(7, 64));
  await expect(page.locator("#outputLevelOut")).toHaveText("40%");
  await sendMidi(page, [0xc0, 4]);
  await expect(page.locator("#rootHz")).toHaveValue("174");
  await sendMidi(page, MIDI_BYTES.start);
  await expect(page.locator("#motionButton")).toHaveAttribute("aria-pressed", "true");
  await sendMidiSequence(page, midiClockSequence({ bpm: 120, pulses: 32, startAt: 1000 }));
  await expect(page.locator("#tempo")).toHaveValue("120");
  await sendMidi(page, MIDI_BYTES.stop);
  await expect(page.locator("#motionButton")).toHaveAttribute("aria-pressed", "false");
  // Focusing the canvas for its Lid key closes Settings; reopen it before
  // operating the shared MIDI toggle inside that disclosure.
  const settings = page.locator(".header-settings-menu");
  if (!await settings.evaluate(details => details.open)) {
    await settings.locator(":scope > summary").click();
  }
  await sendMidi(page, MIDI_BYTES.noteOn(69, 110));
  const activeNote = await stage.screenshot();
  await page.locator("#sharedMidiToggle").click();
  await expect(page.locator("#sharedMidiToggle")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#gazeX")).toHaveValue("0");
  expect(await changedPixels(page, activeNote, await stage.screenshot()))
    .toBeGreaterThan(600);
});

test("touch-sized Audio and transport, desktop stage and scrollable phone controls have no horizontal overflow", async ({ browser }, testInfo) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1,
  });
  const phone = await context.newPage();
  try {
    await openEye(phone);
    for (const [width, height] of [[390, 844], [844, 390]]) {
      await phone.setViewportSize({ width, height });
      // Reset restores the new chrome default, while these silhouette-color
      // probes explicitly exercise the earlier warm-brown alternate.
      await phone.locator("#skinFinish").selectOption("matte");
      await phone.locator("#skinPicker").fill("#704b33");
      await phone.waitForTimeout(120);
      const report = await phone.evaluate(() => {
        const rect = id => {
          const r = document.getElementById(id).getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        };
        const panel = document.querySelector(".oc-panel"), stage = document.querySelector(".oc-stage");
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          audio: rect("audioButton"), play: rect("motionButton"), canvas: rect("eyeCanvas"),
          panel: { client: panel.clientHeight, scroll: panel.scrollHeight,
            overflowY: getComputedStyle(panel).overflowY,
            horizontalOverflow: panel.scrollWidth - panel.clientWidth },
          playRowOverflow: document.querySelector(".oc-play-row").scrollWidth
            - document.querySelector(".oc-play-row").clientWidth,
          animationRowOverflow: Math.max(...[...document.querySelectorAll(".oc-animation-row")]
            .map(row => row.scrollWidth - row.clientWidth)),
          eyeDice: rect("eyeballDice"), lidDice: rect("eyelidDice"),
          gazeHandle: rect("gazeHandle"),
          tempoKnob: rect("tempo"),
          tap: document.querySelector('[data-tap-control="#tempo"]')?.getBoundingClientRect().width,
          stage: stage.getBoundingClientRect().height,
        };
      });
      expect(report.overflow, `${width}×${height}: no accidental horizontal scroll`).toBeLessThanOrEqual(2);
      expect(report.audio.width).toBeGreaterThanOrEqual(48);
      expect(report.audio.height).toBeGreaterThanOrEqual(48);
      expect(report.play.width).toBeGreaterThanOrEqual(48);
      expect(report.play.height).toBeGreaterThanOrEqual(48);
      expect(report.canvas.width).toBeGreaterThan(245);
      expect(report.canvas.height).toBeGreaterThan(245);
      expect(report.stage).toBeGreaterThanOrEqual(255);
      expect(report.panel.horizontalOverflow).toBeLessThanOrEqual(2);
      expect(report.playRowOverflow).toBeLessThanOrEqual(2);
      expect(report.animationRowOverflow).toBeLessThanOrEqual(2);
      for (const dice of [report.eyeDice, report.lidDice]) {
        expect(dice.width).toBeGreaterThanOrEqual(44);
        expect(dice.height).toBeGreaterThanOrEqual(44);
        expect(dice.x).toBeGreaterThanOrEqual(0);
        expect(dice.x + dice.width).toBeLessThanOrEqual(width);
      }
      expect(report.gazeHandle.width).toBeGreaterThanOrEqual(48);
      expect(report.tempoKnob.width).toBeGreaterThanOrEqual(48);
      expect(report.tap).toBeGreaterThanOrEqual(48);
      const { shell, bottom, top } = await shellAndBackdropColors(phone,
        await phone.locator("#eyeCanvas").screenshot());
      expect(shell[0]).toBeGreaterThan(top[0] + 16);
      expect(bottom[0]).toBeGreaterThan(top[0] + 16);
      await phone.locator("#irisTint").scrollIntoViewIfNeeded();
      expect(await phone.locator("#irisTint").isVisible()).toBe(true);
      await phone.locator("#hatStyle").selectOption("top");
      await phone.locator("#catEars").check();
      await phone.locator("#bowTie").check();
      await phone.locator("#tail").check();
      await phone.locator("#skinPicker").fill("#80c3b0");
      await phone.locator("#scleraPattern").selectOption("checker");
      await phone.locator("#reflection").fill("1.5");
      await expect(phone.locator("#skinFinish")).toHaveValue("matte");
      const picker = await phone.locator("#skinPicker").boundingBox();
      expect(picker.width).toBeGreaterThanOrEqual(48);
      expect(picker.height).toBeGreaterThanOrEqual(48);
      expect(await phone.evaluate(() => document.documentElement.scrollWidth
        - document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
      await phone.locator(".header-preset-picker summary").click();
      const presetPicker = await phone.locator(".header-preset-picker .instrument-picker-panel").boundingBox();
      expect(presetPicker.y).toBeGreaterThanOrEqual(0);
      expect(presetPicker.y + presetPicker.height).toBeLessThanOrEqual(height - 4);
      await phone.locator(".header-preset-picker .instrument-picker-search-input").fill("Quiet eyelashes");
      await phone.locator('[data-full-preset][data-preset-id="eye-36"]').click();
      await expect(phone.locator("#eyeballStyle")).toHaveValue("still");
      await expect(phone.locator("#eyelidStyle")).toHaveValue("lid-flutter");
      await expect(phone.locator("#pupil")).toHaveValue("0.44");
      await phone.locator("#resetAll").click();
      await expect(phone.locator("#skinFinish")).toHaveValue("chrome");
      await expect(phone.locator("#skinPicker")).toHaveValue("#f2f1ef");
      await expect(phone.locator("#scleraPattern")).toHaveValue("solid");
      await expect(phone.locator("#reflection")).toHaveValue("1");
      await expect(phone.locator("#hatStyle")).toHaveValue("none");
      await testInfo.attach(`oculoid-${width}x${height}.png`, {
        body: await phone.screenshot(), contentType: "image/png",
      });
    }
    expect(diagnostics.get(phone)).toEqual([]);
  } finally {
    await context.close();
  }
});
