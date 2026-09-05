import { expect, test } from "@playwright/test";

async function captureDentaphoneFoodMessages(page) {
  await page.addInitScript(() => {
    const NativeAudioWorkletNode = globalThis.AudioWorkletNode;
    globalThis.__dentaphoneFoodMessages = [];
    globalThis.AudioWorkletNode = class DentaphoneFoodCaptureNode extends NativeAudioWorkletNode {
      constructor(...args) {
        super(...args);
        const nativePostMessage = this.port.postMessage.bind(this.port);
        this.port.postMessage = (message, transfer) => {
          if (message?.type === "configure") {
            globalThis.__dentaphoneFoodMessages.push({
              type: "configure",
              frequency: message.fundamentalOverrideHz,
              position: message.configuration?.strikePosition,
              at: performance.now(),
              jawOpen: globalThis.__dentaphoneWebGL?.snapshot?.().jawOpen ?? null,
            });
          } else if (message?.type === "excite") {
            globalThis.__dentaphoneFoodMessages.push({
              type: "excite",
              position: message.position,
              strength: message.strength,
              eventType: message.eventType,
              at: performance.now(),
              jawOpen: globalThis.__dentaphoneWebGL?.snapshot?.().jawOpen ?? null,
            });
          }
          return nativePostMessage(message, transfer);
        };
      }
    };
  });
}

async function dentaphoneToothPoints(page, toothIds) {
  return page.evaluate((ids) => ids.map((id) => {
    const tooth = document.querySelector(`[data-tooth-id="${id}"]`);
    if (!tooth) return null;
    const bounds = tooth.getBoundingClientRect();
    return {
      id,
      x: bounds.left + bounds.width / 2,
      y: bounds.top + bounds.height / 2,
      width: bounds.width,
      height: bounds.height,
      centerToothId: document.elementFromPoint(
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2,
      )?.closest?.(".dentaphone-tooth")?.dataset.toothId ?? null,
    };
  }), toothIds);
}

async function waitForDentaphoneWebGL(page) {
  await expect.poll(() => page.evaluate(() => {
    const snapshot = globalThis.__dentaphoneWebGL?.snapshot?.();
    return Boolean(
      snapshot?.ready
      && snapshot.active
      && snapshot.renderer === "webgl"
      && snapshot.toothCount === 32,
    );
  }), { timeout: 15_000 }).toBe(true);
  return page.evaluate(() => globalThis.__dentaphoneWebGL.snapshot());
}

async function enterDentaphone3d(page) {
  await page.locator("#dentaphoneView3d").click();
  return waitForDentaphoneWebGL(page);
}

async function captureDentaphoneStrikeConcurrency(page) {
  await page.evaluate(() => {
    globalThis.__dentaphoneMaxSimultaneousStrikes = 0;
    const rig = document.querySelector("#dentaphoneKeyboard");
    const sample = () => {
      globalThis.__dentaphoneMaxSimultaneousStrikes = Math.max(
        globalThis.__dentaphoneMaxSimultaneousStrikes,
        rig.querySelectorAll(".dentaphone-tooth.is-struck").length,
      );
    };
    new MutationObserver(sample).observe(rig, {
      attributes: true,
      attributeFilter: ["class"],
      subtree: true,
    });
    sample();
  });
}

test("Dentaphone preserves Object Forge modal JSON and preset synchronization", async ({ page }) => {
  await page.goto("dentaphone.html", { waitUntil: "load" });
  const preset = page.locator("#preset");
  const description = page.locator("#presetDescription");
  const before = await description.textContent();
  await preset.selectOption("glass-bowl");
  await expect(description).not.toHaveText(before ?? "");

  await page.locator("#modalJson").fill(JSON.stringify({
    name: "Browser test resonator",
    modeCount: 1,
    modes: [
      { ratio: 1, decay: 2.4, gain: 1, pan: -0.2, strikeNode: 1 },
      { ratio: 2.71, decay: 1.3, gain: 0.45, pan: 0.25, strikeNode: 2 },
    ],
  }));
  await page.locator('[data-action="loadModalJson"]').click();
  await expect(page.locator("#liveStatus")).toContainText("Loaded 1 custom mode");
  await expect(page.locator("#modeCount")).toHaveValue("1");
  await expect(preset).toHaveValue("__custom_modal_bank__");
  await expect(page.locator("#presetSummary")).toContainText("Browser test resonator · 1 mode");
  await expect(description).toContainText("Imported modal data is active");

  await page.locator('[data-action="copyModalJson"]').click();
  const copied = JSON.parse(await page.locator("#modalJson").inputValue());
  expect(copied.modeCount).toBe(1);
  expect(copied.modes).toHaveLength(2);
  await page.locator("#modeCount").fill("2");
  await page.locator('[data-action="loadModalJson"]').click();
  await expect(page.locator("#modeCount")).toHaveValue("1");

  await page.locator("#modalJson").fill(JSON.stringify({
    modes: [{ ratio: 1, decay: 1, gain: "bad" }],
  }));
  await page.locator('[data-action="loadModalJson"]').click();
  await expect(page.locator("#liveStatus")).toContainText("Modal JSON was not loaded");
  await expect(page.locator("#modeCount")).toHaveValue("1");
  await expect(page.locator("#presetSummary")).toContainText("Browser test resonator · 1 mode");
});

test("Dentaphone exposes all 32 anatomical keys and retunes both pitch layers", async ({ page }) => {
  await page.goto("dentaphone.html", { waitUntil: "load" });
  await expect(page.locator("body")).toHaveAttribute("data-dentaphone-view-mode", "2d");
  await expect(page.locator("#dentaphoneArtboard")).toHaveAttribute("data-dentaphone-renderer", "image");
  await expect(page.locator("#dentaphoneArtboard")).toHaveAttribute("data-dentaphone-view-mode", "2d");
  await expect(page.locator("#dentaphoneView2d")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#dentaphoneView3d")).toHaveAttribute("aria-selected", "false");
  await expect(page.locator(".dentaphone-artwork")).toHaveCount(2);
  for (const artwork of await page.locator(".dentaphone-artwork").all()) {
    await expect(artwork).toBeVisible();
  }
  expect(await page.locator(".dentaphone-artwork").evaluateAll((images) => images.map((image) => ({
    width: image.naturalWidth,
    height: image.naturalHeight,
  })))).toEqual([
    { width: 1536, height: 1024 },
    { width: 1536, height: 1024 },
  ]);
  await expect(page.locator("#dentaphoneWebgl")).toHaveCount(1);
  await expect(page.locator("#dentaphoneWebgl")).toHaveCSS("opacity", "0");
  await expect(page.locator("#dentaphoneWebgl")).toHaveCSS("pointer-events", "none");
  await expect(page.locator(".dentaphone-renderer-badge")).toHaveCSS("opacity", "0");
  await expect(page.locator("#dentaphone3dControls")).toBeHidden();
  for (const controlId of ["dentaphoneYaw", "dentaphonePitch", "dentaphoneResetView"]) {
    await expect(page.locator(`#${controlId}`)).toBeHidden();
  }
  await expect(page.locator("#dentaphoneViewHint")).toHaveText("Tap or drag teeth to play · switch to 3D to chomp");
  expect(await page.evaluate(() => "__dentaphoneWebGL" in globalThis)).toBe(false);
  const teeth = page.locator(".dentaphone-tooth");
  const upper = page.locator('.dentaphone-tooth[data-arch="upper"]');
  const lower = page.locator('.dentaphone-tooth[data-arch="lower"]');
  await expect(teeth).toHaveCount(32);
  await expect(upper).toHaveCount(16);
  await expect(lower).toHaveCount(16);
  await expect(page.locator('[data-tooth-id="upper-01"]')).toHaveAttribute("data-tooth-type", "third-molar");
  await expect(page.locator('[data-tooth-id="upper-16"]')).toHaveAttribute("data-tooth-type", "third-molar");
  await expect(page.locator('[data-tooth-id="lower-01"]')).toHaveAttribute("data-note", "C3");
  await expect(page.locator('[data-tooth-id="upper-01"]')).toHaveAttribute("data-note", "C4");
  await expect(page.locator("#pitchLayout")).toHaveValue("paired-chromatic");
  await expect(page.locator("#lowerPitchRange")).toHaveText("C3–D♯4");
  await expect(page.locator("#upperPitchRange")).toHaveText("C4–D♯5");

  await page.locator('[data-tooth-id="lower-01"]').focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#audioState")).toHaveText("on");
  await expect(page.locator('[data-tooth-id="lower-01"]')).toHaveClass(/is-selected/);
  const lowerFrequency = Number(await page.locator("#baseFrequencyHz").inputValue());
  const lowerEffectPosition = Number(await page.locator('[data-tooth-id="lower-01"]').getAttribute("data-effect-position"));
  expect(lowerFrequency).toBeGreaterThan(130);
  expect(lowerFrequency).toBeLessThan(132);

  await page.locator('[data-tooth-id="upper-01"]').focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#stageReadout")).toContainText("C4");
  expect(Number(await page.locator("#baseFrequencyHz").inputValue())).toBeGreaterThan(lowerFrequency);
  expect(Number(await page.locator('[data-tooth-id="upper-01"]').getAttribute("data-effect-position")))
    .not.toBeCloseTo(lowerEffectPosition, 2);

  await page.locator("#preset").selectOption("glass-bowl");
  await expect(page.locator("body")).toHaveAttribute("data-dentaphone-material", "glass-bowl");
  await expect(page.locator('[data-tooth-id="upper-01"]')).toHaveAttribute("aria-label", /Glass Bowl/i);

  await page.locator("#pitchLayout").selectOption("marimba-split");
  await expect(page.locator('[data-tooth-id="upper-01"]')).toHaveAttribute("data-note", "C♯3");
  await page.locator("#pitchLayout").selectOption("paired-chromatic");
  await page.locator("#rootPitch").selectOption("9");
  await page.locator("#pitchOctave").selectOption("2");
  await expect(page.locator('[data-tooth-id="lower-01"]')).toHaveAttribute("data-note", "A2");
  await expect(page.locator('[data-tooth-id="upper-01"]')).toHaveAttribute("data-note", "A3");
  await expect(page.locator("#lowerPitchRange")).toHaveText("A2–C4");
  await expect(page.locator("#upperPitchRange")).toHaveText("A3–C5");
  await page.locator('[data-tooth-id="upper-16"]').focus();
  await page.keyboard.press("KeyA");
  await expect(page.locator('[data-tooth-id="lower-01"]')).toBeFocused();
  await expect(page.locator('[data-tooth-id="lower-01"]')).toHaveAttribute("aria-current", "true");
  expect(Number(await page.locator("#baseFrequencyHz").inputValue())).toBeCloseTo(110, 1);
});

test("Dentaphone keyboard navigation crosses the two arches and strikes a focused tooth", async ({ page }) => {
  await page.goto("dentaphone.html", { waitUntil: "load" });
  const firstLower = page.locator('[data-tooth-id="lower-01"]');
  await firstLower.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator('[data-tooth-id="lower-02"]')).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(page.locator('[data-tooth-id="upper-02"]')).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(page.locator('[data-tooth-id="upper-02"]')).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator('[data-tooth-id="lower-02"]')).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(page.locator('[data-tooth-id="upper-02"]')).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#audioState")).toHaveText("on");
  await expect(page.locator('[data-tooth-id="upper-02"]')).toHaveClass(/is-struck/);
});

test("Dentaphone keeps strike feedback local to its 2D tooth and leaves the canvas clear", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("dentaphone.html", { waitUntil: "load" });
  const tooth = page.locator('[data-tooth-id="upper-08"]');
  const distantTooth = page.locator('[data-tooth-id="lower-01"]');
  await tooth.dispatchEvent("pointerdown", {
    pointerId: 41,
    pointerType: "mouse",
    button: 0,
    pressure: 0.5,
  });
  await expect(tooth).toHaveClass(/is-struck/);
  await expect(tooth.locator(".dentaphone-tooth-crown")).toHaveCSS(
    "animation-name",
    "dentaphone-tooth-vibration",
  );
  await expect(distantTooth).not.toHaveClass(/is-struck/);
  await expect(distantTooth.locator(".dentaphone-tooth-crown")).toHaveCSS("animation-name", "none");
  for (const artwork of await page.locator(".dentaphone-artwork").all()) {
    await expect(artwork).toBeVisible();
    await expect(artwork).toHaveCSS("opacity", "1");
  }

  await expect(page.locator("#audioState")).toHaveText("on");
  await page.waitForTimeout(50);
  const canvasHasVisiblePixels = await page.locator("#stage").evaluate((canvas) => {
    const context = canvas.getContext("2d");
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    return pixels.some((value, index) => index % 4 === 3 && value !== 0);
  });
  expect(canvasHasVisiblePixels).toBe(false);
  await tooth.dispatchEvent("pointerup", { pointerId: 41, pointerType: "mouse", button: 0 });
});

test("Dentaphone keeps food and chomp behavior out of its static 2D anatomy view", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await captureDentaphoneFoodMessages(page);
  await page.goto("dentaphone.html", { waitUntil: "load" });
  const artboard = page.locator("#dentaphoneArtboard");
  const initial = await page.evaluate(() => ({
    upper: getComputedStyle(document.querySelector('[data-dentaphone-jaw="upper"]')).transform,
    lower: getComputedStyle(document.querySelector('[data-dentaphone-jaw="lower"]')).transform,
    jawOpen: document.querySelector("#dentaphoneArtboard").dataset.jawOpen,
  }));

  await expect(page.locator("#dentaphoneFoodCard")).toBeHidden();
  await expect(page.locator("#dentaphoneMotionCard")).toBeHidden();
  await expect(page.locator("#dentaphoneChomp")).toBeHidden();
  await expect(page.locator("#dentaphoneJawOpen")).toBeHidden();
  await expect(page.locator("#dentaphone3dControls")).toBeHidden();
  for (const controlId of ["dentaphoneYaw", "dentaphonePitch", "dentaphoneResetView"]) {
    await expect(page.locator(`#${controlId}`)).toBeHidden();
  }
  await expect(artboard).toHaveAttribute("data-view-yaw", "-4.00");
  await expect(artboard).toHaveAttribute("data-view-pitch", "3.00");

  const selectedId = await page.locator('.dentaphone-tooth[aria-current="true"]').getAttribute("data-tooth-id");
  const chomp = page.locator("#dentaphoneChomp");
  await page.evaluate(() => {
    for (const button of [
      document.querySelector("#dentaphoneChomp"),
      document.querySelector('[data-dentaphone-food="apple"]'),
    ]) {
      button.disabled = false;
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
  });
  await page.waitForTimeout(750);
  await expect(chomp).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#dentaphoneKeyboard")).not.toHaveClass(/is-chomping|is-chewing/);
  expect(await page.evaluate(() => ({
    upper: getComputedStyle(document.querySelector('[data-dentaphone-jaw="upper"]')).transform,
    lower: getComputedStyle(document.querySelector('[data-dentaphone-jaw="lower"]')).transform,
    jawOpen: document.querySelector("#dentaphoneArtboard").dataset.jawOpen,
  }))).toEqual(initial);
  expect(await page.evaluate(() => globalThis.__dentaphoneFoodMessages)).toEqual([]);
  await expect(page.locator("#audioState")).toHaveText("off");
  await expect(page.locator("#dentaphoneFoodLayer .dentaphone-mouth-food")).toHaveCount(0);
  await expect(page.locator(`.dentaphone-tooth[data-tooth-id="${selectedId}"]`)).toHaveAttribute("aria-current", "true");

  await page.locator("#preset").selectOption("glass-bowl");
  await page.locator("#pitchLayout").selectOption("twin-diatonic");
  await page.locator("#rootPitch").selectOption("9");
  await page.locator('.physical-footer-actions [data-action="reset"]').click();
  await expect(page.locator("#dentaphoneJawOpen")).toHaveValue("0.58");
  await expect(artboard).toHaveAttribute("data-jaw-open", "0.58");
  await expect(page.locator("#pitchLayout")).toHaveValue("paired-chromatic");
  await expect(page.locator("#rootPitch")).toHaveValue("0");
  await expect(page.locator("#lowerPitchRange")).toHaveText("C3–D♯4");
  await expect(page.locator("#upperPitchRange")).toHaveText("C4–D♯5");
});

test("Dentaphone waits for slow first-use audio before closing and still contacts all teeth", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript(() => {
    const nativeAddModule = globalThis.AudioWorklet.prototype.addModule;
    globalThis.AudioWorklet.prototype.addModule = async function delayedAddModule(...args) {
      await new Promise((resolve) => setTimeout(resolve, 900));
      return nativeAddModule.apply(this, args);
    };
    const NativeAudioWorkletNode = globalThis.AudioWorkletNode;
    globalThis.__dentaphoneDelayedChompExcites = [];
    globalThis.__dentaphoneChompStartedAt = 0;
    globalThis.AudioWorkletNode = class DelayedChompCaptureNode extends NativeAudioWorkletNode {
      constructor(...args) {
        super(...args);
        const nativePostMessage = this.port.postMessage.bind(this.port);
        this.port.postMessage = (message, transfer) => {
          if (message?.type === "excite") {
            globalThis.__dentaphoneDelayedChompExcites.push({
              chomping: document.querySelector("#dentaphoneKeyboard")?.classList.contains("is-chomping") ?? false,
              elapsedMs: performance.now() - globalThis.__dentaphoneChompStartedAt,
              eventType: message.eventType,
              jawOpen: globalThis.__dentaphoneWebGL?.snapshot?.().jawOpen ?? null,
              at: performance.now(),
            });
          }
          return nativePostMessage(message, transfer);
        };
      }
    };
  });
  await page.goto("dentaphone.html", { waitUntil: "load" });
  await enterDentaphone3d(page);

  const chomp = page.locator("#dentaphoneChomp");
  await page.evaluate(() => { globalThis.__dentaphoneChompStartedAt = performance.now(); });
  await chomp.click();
  await page.waitForTimeout(450);
  await expect(page.locator("#dentaphoneKeyboard")).not.toHaveClass(/is-chomping/);
  await expect.poll(
    () => page.evaluate(() => globalThis.__dentaphoneWebGL.snapshot().jawOpen),
  ).toBeCloseTo(0.58, 2);
  expect(await page.evaluate(() => globalThis.__dentaphoneDelayedChompExcites)).toEqual([]);
  await expect.poll(() => page.evaluate(() => (
    globalThis.__dentaphoneDelayedChompExcites.length
  )), { timeout: 3_500 }).toBe(32);

  const delayedImpacts = await page.evaluate(() => globalThis.__dentaphoneDelayedChompExcites);
  expect(delayedImpacts).toHaveLength(32);
  expect(delayedImpacts.every(({ chomping }) => chomping)).toBe(true);
  expect(delayedImpacts.every(({ elapsedMs }) => elapsedMs >= 850)).toBe(true);
  expect(delayedImpacts.every(({ eventType }) => eventType === "strike")).toBe(true);
  expect(delayedImpacts.every(({ jawOpen }) => jawOpen !== null && jawOpen <= 0.002)).toBe(true);
  expect(delayedImpacts.at(-1).at - delayedImpacts[0].at).toBeLessThanOrEqual(25);
  await expect(chomp).toHaveAttribute("aria-pressed", "false", { timeout: 2_000 });
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => globalThis.__dentaphoneDelayedChompExcites.length)).toBe(32);
});

test("Dentaphone cancels an empty-mouth chomp without a hit when returning to 2D before contact", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await captureDentaphoneFoodMessages(page);
  await page.goto("dentaphone.html", { waitUntil: "load" });
  await enterDentaphone3d(page);
  await page.locator("#dentaphoneJawOpen").fill("0.31");
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioState")).toHaveText("on");
  await page.evaluate(() => { globalThis.__dentaphoneFoodMessages.length = 0; });
  await page.evaluate(() => {
    globalThis.__dentaphoneSwitchedBeforeContact = false;
    const rig = document.querySelector("#dentaphoneKeyboard");
    const observer = new MutationObserver(() => {
      if (!rig.classList.contains("is-chomping")) return;
      observer.disconnect();
      document.querySelector("#dentaphoneView2d").click();
      globalThis.__dentaphoneSwitchedBeforeContact = true;
    });
    observer.observe(rig, { attributes: true, attributeFilter: ["class"] });
  });

  await page.locator("#dentaphoneChomp").click();
  await expect.poll(() => page.evaluate(() => globalThis.__dentaphoneSwitchedBeforeContact))
    .toBe(true);
  await expect(page.locator("#dentaphoneView2d")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#dentaphoneKeyboard")).not.toHaveClass(/is-chomping/);
  await expect(page.locator("#dentaphoneChomp")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#dentaphoneFoodCard")).toBeHidden();
  await expect(page.locator("#dentaphoneMotionCard")).toBeHidden();
  await expect(page.locator("#dentaphoneArtboard")).toHaveAttribute("data-jaw-open", "0.58");
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => (
    globalThis.__dentaphoneFoodMessages.filter((message) => message.type === "excite").length
  ))).toBe(0);
});

test("Dentaphone reduced-motion chomp still strikes all teeth together at full closure", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await captureDentaphoneFoodMessages(page);
  await page.goto("dentaphone.html", { waitUntil: "load" });
  await enterDentaphone3d(page);
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioState")).toHaveText("on");
  await page.evaluate(() => { globalThis.__dentaphoneFoodMessages.length = 0; });

  const selectedId = await page.locator('.dentaphone-tooth[aria-current="true"]')
    .getAttribute("data-tooth-id");
  await captureDentaphoneStrikeConcurrency(page);
  await page.locator("#dentaphoneChomp").click();
  await expect.poll(() => page.evaluate(() => (
    globalThis.__dentaphoneFoodMessages.filter((message) => message.type === "excite").length
  )), { intervals: [8, 12, 16], timeout: 800 }).toBe(32);
  await expect.poll(() => page.evaluate(() => globalThis.__dentaphoneMaxSimultaneousStrikes))
    .toBe(32);
  const impacts = await page.evaluate(() => (
    globalThis.__dentaphoneFoodMessages.filter((message) => message.type === "excite")
  ));
  expect(impacts).toHaveLength(32);
  expect(impacts.every(({ eventType }) => eventType === "strike")).toBe(true);
  expect(impacts.every(({ jawOpen }) => jawOpen !== null && jawOpen <= 0.002)).toBe(true);
  expect(impacts.at(-1).at - impacts[0].at).toBeLessThanOrEqual(25);
  await expect(page.locator(`[data-tooth-id="${selectedId}"]`)).toHaveAttribute("aria-current", "true");
  await expect(page.locator("#dentaphoneChomp")).toHaveAttribute("aria-pressed", "false", {
    timeout: 800,
  });
  await page.waitForTimeout(160);
  expect(await page.evaluate(() => (
    globalThis.__dentaphoneFoodMessages.filter((message) => message.type === "excite").length
  ))).toBe(32);
});

test("Dentaphone maps all 32 DOM teeth one-to-one onto its 2D artwork", async ({ page }) => {
  await page.goto("dentaphone.html", { waitUntil: "load" });
  const toothIds = await page.locator(".dentaphone-tooth").evaluateAll((teeth) => (
    teeth.map((tooth) => tooth.dataset.toothId)
  ));
  expect(toothIds).toHaveLength(32);
  expect(new Set(toothIds).size).toBe(32);
  const points = await dentaphoneToothPoints(page, toothIds);
  expect(points.every(Boolean)).toBe(true);
  expect(points.every(({ width, height }) => width > 0 && height > 0)).toBe(true);
  expect(points.map(({ centerToothId }) => centerToothId)).toEqual(toothIds);

  for (const id of [
    "upper-01", "upper-08", "upper-09", "upper-16",
    "lower-01", "lower-08", "lower-09", "lower-16",
  ]) {
    const point = points.find((candidate) => candidate.id === id);
    await page.mouse.click(point.x, point.y);
    const tooth = page.locator(`[data-tooth-id="${id}"]`);
    await expect(tooth).toHaveAttribute("aria-current", "true");
    await expect(tooth).toHaveClass(/is-selected/);
    await expect(page.locator("#stageReadout")).toContainText(await tooth.getAttribute("data-note"));
  }
  await expect(page.locator("#audioState")).toHaveText("on");
});

test("Dentaphone leaves empty 2D space inert and requests no 3D resources", async ({ page }) => {
  const requests = [];
  page.on("request", (request) => requests.push(new URL(request.url()).pathname));
  await page.goto("dentaphone.html", { waitUntil: "load" });
  const artboard = page.locator("#dentaphoneArtboard");
  const selectedBefore = await page.locator('.dentaphone-tooth[aria-current="true"]').getAttribute("data-tooth-id");
  const jawOpenBefore = await artboard.getAttribute("data-jaw-open");
  const orientationBefore = await artboard.evaluate((element) => ({
    yaw: element.dataset.viewYaw,
    pitch: element.dataset.viewPitch,
  }));

  const emptyPath = await artboard.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const stageBounds = element.closest("#stageWrap").getBoundingClientRect();
    const emptyPoints = [];
    for (let row = 1; row < 8; row += 1) {
      for (let column = 1; column < 8; column += 1) {
        const point = {
          x: stageBounds.left + stageBounds.width * column / 8,
          y: stageBounds.top + stageBounds.height * row / 8,
        };
        const hit = document.elementFromPoint(point.x, point.y);
        const insideArtboard = point.x >= bounds.left && point.x <= bounds.right
          && point.y >= bounds.top && point.y <= bounds.bottom;
        if (insideArtboard && element.contains(hit) && !hit?.closest?.(".dentaphone-tooth")) {
          emptyPoints.push(point);
        }
      }
    }
    let path = null;
    for (const from of emptyPoints) {
      for (const to of emptyPoints) {
        const distance = Math.hypot(to.x - from.x, to.y - from.y);
        if (!path || distance > path.distance) path = { from, to, distance };
      }
    }
    return path;
  });
  expect(emptyPath?.distance).toBeGreaterThan(120);
  await page.mouse.move(emptyPath.from.x, emptyPath.from.y);
  await page.mouse.down();
  await page.mouse.move(emptyPath.to.x, emptyPath.to.y, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator("#audioState")).toHaveText("off");
  await expect(page.locator(`.dentaphone-tooth[data-tooth-id="${selectedBefore}"]`)).toHaveAttribute("aria-current", "true");
  await expect(artboard).toHaveAttribute("data-jaw-open", jawOpenBefore);
  await expect(page.locator("#stageWrap")).not.toHaveClass(/is-rotating/);
  expect(await artboard.evaluate((element) => ({
    yaw: element.dataset.viewYaw,
    pitch: element.dataset.viewPitch,
  }))).toEqual(orientationBefore);
  await expect(page.locator("#dentaphoneWebgl")).toHaveCount(1);
  await expect(page.locator("#dentaphoneWebgl")).toHaveCSS("opacity", "0");
  await expect(page.locator("#dentaphoneWebgl")).toHaveCSS("pointer-events", "none");
  await expect(page.locator(".dentaphone-renderer-badge")).toHaveCSS("opacity", "0");
  await expect(page.locator("#dentaphone3dControls")).toBeHidden();
  for (const controlId of ["dentaphoneYaw", "dentaphonePitch", "dentaphoneResetView"]) {
    await expect(page.locator(`#${controlId}`)).toBeHidden();
  }
  expect(await page.evaluate(() => "__dentaphoneWebGL" in globalThis)).toBe(false);
  await page.waitForTimeout(100);
  expect(requests.filter((path) => (
    /src\/dentaphone-webgl\.js|assets\/models\/dentaphone-chomper\.glb|vendor\/three\//u.test(path)
  ))).toEqual([]);
});

test("Dentaphone opts into its complete 3D chomper and restores the direct 2D map", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await captureDentaphoneFoodMessages(page);
  await page.goto("dentaphone.html", { waitUntil: "load" });
  const artboard = page.locator("#dentaphoneArtboard");
  const canvas = page.locator("#dentaphoneWebgl");
  const toothLayout = () => page.locator(".dentaphone-tooth").evaluateAll((teeth) => teeth.map((tooth) => ({
    id: tooth.dataset.toothId,
    x: tooth.style.getPropertyValue("--tooth-x"),
    y: tooth.style.getPropertyValue("--tooth-y"),
    width: tooth.style.getPropertyValue("--tooth-width"),
    height: tooth.style.getPropertyValue("--tooth-height"),
    angle: tooth.style.getPropertyValue("--tooth-angle"),
    counterAngle: tooth.style.getPropertyValue("--tooth-counter-angle"),
    zIndex: tooth.style.zIndex,
    webglHidden: tooth.hasAttribute("data-webgl-hidden"),
  })));
  const imageLayout = await toothLayout();
  expect(imageLayout).toHaveLength(32);
  expect(imageLayout.every(({ webglHidden }) => !webglHidden)).toBe(true);
  expect(await page.evaluate(() => "__dentaphoneWebGL" in globalThis)).toBe(false);

  await page.locator("#dentaphoneView3d").click();
  const initial3d = await waitForDentaphoneWebGL(page);
  expect(initial3d.triangles).toBeGreaterThan(7_200);
  expect(initial3d.drawCalls).toBeGreaterThan(0);
  expect(initial3d.renderWidth).toBeGreaterThan(0);
  expect(initial3d.renderHeight).toBeGreaterThan(0);
  await expect(page.locator("body")).toHaveAttribute("data-dentaphone-view-mode", "3d");
  await expect(artboard).toHaveAttribute("data-dentaphone-view-mode", "3d");
  await expect(artboard).toHaveAttribute("data-dentaphone-renderer", "webgl");
  await expect(artboard).toHaveClass(/is-webgl-ready/);
  await expect(page.locator("#dentaphoneView2d")).toHaveAttribute("aria-selected", "false");
  await expect(page.locator("#dentaphoneView3d")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#dentaphone3dControls")).toBeVisible();
  for (const controlId of ["dentaphoneYaw", "dentaphonePitch", "dentaphoneResetView"]) {
    await expect(page.locator(`#${controlId}`)).toBeVisible();
  }
  await expect(canvas).toHaveCSS("opacity", "1");
  await expect(canvas).toHaveCSS("pointer-events", "none");
  for (const artwork of await page.locator(".dentaphone-artwork").all()) {
    await expect(artwork).toHaveCSS("opacity", "0");
  }
  const mismatched3dBadges = () => artboard.evaluate((element) => (
    [...element.querySelectorAll(".dentaphone-tooth:not([data-webgl-hidden])")]
      .map((tooth) => {
        const bounds = tooth.getBoundingClientRect();
        return {
          expected: tooth.dataset.toothId,
          actual: globalThis.__dentaphoneWebGL.pick(
            (bounds.left + bounds.right) / 2,
            (bounds.top + bounds.bottom) / 2,
          ),
        };
      })
      .filter(({ expected, actual }) => expected !== actual)
  ));

  const degrees = Math.PI / 180;
  await page.locator("#dentaphoneYaw").fill("18");
  await page.locator("#dentaphonePitch").fill("-7");
  await expect(artboard).toHaveAttribute("data-view-yaw", "18.00");
  await expect(artboard).toHaveAttribute("data-view-pitch", "-7.00");
  await expect.poll(() => page.evaluate(() => globalThis.__dentaphoneWebGL.snapshot().yaw)).toBeCloseTo(18 * degrees, 3);
  await expect.poll(() => page.evaluate(() => globalThis.__dentaphoneWebGL.snapshot().pitch)).toBeCloseTo(7 * degrees, 3);
  await expect.poll(mismatched3dBadges).toEqual([]);
  await page.locator("#dentaphoneResetView").click();
  await expect(page.locator("#dentaphoneYaw")).toHaveValue("-4");
  await expect(page.locator("#dentaphonePitch")).toHaveValue("3");
  await expect.poll(() => page.evaluate(() => globalThis.__dentaphoneWebGL.snapshot().yaw)).toBeCloseTo(-4 * degrees, 3);
  await expect.poll(() => page.evaluate(() => globalThis.__dentaphoneWebGL.snapshot().pitch)).toBeCloseTo(-3 * degrees, 3);
  await expect.poll(mismatched3dBadges).toEqual([]);

  const selectedBeforeStrike = await page.locator('.dentaphone-tooth[aria-current="true"]').getAttribute("data-tooth-id");
  const strikeTarget = await artboard.evaluate((element, excludedId) => {
    const api = globalThis.__dentaphoneWebGL;
    const candidates = [...element.querySelectorAll(".dentaphone-tooth:not([data-webgl-hidden])")].map((tooth) => {
      const bounds = tooth.getBoundingClientRect();
      return { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 };
    });
    const bounds = element.getBoundingClientRect();
    for (let row = 2; row < 19; row += 1) {
      for (let column = 2; column < 19; column += 1) {
        candidates.push({
          x: bounds.left + bounds.width * column / 20,
          y: bounds.top + bounds.height * row / 20,
        });
      }
    }
    for (const point of candidates) {
      const id = api.pick(point.x, point.y);
      if (id && id !== excludedId) return { ...point, id };
    }
    return null;
  }, selectedBeforeStrike);
  expect(strikeTarget).not.toBeNull();
  expect(await page.evaluate(({ x, y }) => globalThis.__dentaphoneWebGL.pick(x, y), strikeTarget))
    .toBe(strikeTarget.id);
  const distantId = strikeTarget.id === "upper-01" ? "lower-16" : "upper-01";
  const struckTooth = page.locator(`[data-tooth-id="${strikeTarget.id}"]`);
  const distantTooth = page.locator(`[data-tooth-id="${distantId}"]`);
  await page.mouse.move(strikeTarget.x, strikeTarget.y);
  await page.waitForTimeout(40);
  const shaderBefore = await canvas.screenshot();
  await page.mouse.down();
  await expect(struckTooth).toHaveAttribute("aria-current", "true");
  await expect(struckTooth).toHaveClass(/is-struck/);
  await expect(struckTooth.locator(".dentaphone-tooth-crown")).toHaveCSS(
    "animation-name",
    "dentaphone-tooth-vibration",
  );
  await expect(distantTooth).not.toHaveClass(/is-struck/);
  await page.waitForTimeout(32);
  const shaderAfter = await canvas.screenshot();
  expect(shaderAfter.equals(shaderBefore)).toBe(false);
  await page.mouse.up();
  await expect(page.locator("#audioState")).toHaveText("on");
  await expect.poll(() => page.evaluate(() => (
    globalThis.__dentaphoneFoodMessages.filter((message) => message.type === "excite").length
  ))).toBeGreaterThan(0);

  await page.locator("#dentaphoneJawOpen").fill("0.31");
  await expect.poll(() => page.evaluate(() => globalThis.__dentaphoneWebGL.snapshot().jawOpen)).toBeCloseTo(0.31, 2);
  const selectedBeforeChomp = await page.locator('.dentaphone-tooth[aria-current="true"]')
    .getAttribute("data-tooth-id");
  const expectedChompFrequencies = await page.locator(".dentaphone-tooth").evaluateAll((teeth) => (
    teeth
      .map((tooth) => 440 * (2 ** ((Number(tooth.dataset.midi) - 69) / 12)))
      .sort((left, right) => left - right)
  ));
  await page.evaluate(() => { globalThis.__dentaphoneFoodMessages.length = 0; });
  await captureDentaphoneStrikeConcurrency(page);
  const chomp = page.locator("#dentaphoneChomp");
  await chomp.click();
  await expect(chomp).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.evaluate(() => (
    globalThis.__dentaphoneFoodMessages.filter((message) => message.type === "excite").length
  )), { intervals: [16, 20, 24], timeout: 1_200 }).toBe(32);
  await expect.poll(() => page.evaluate(() => globalThis.__dentaphoneMaxSimultaneousStrikes))
    .toBe(32);
  const chompMessages = await page.evaluate(() => globalThis.__dentaphoneFoodMessages);
  const chompConfigurations = chompMessages.filter((message) => message.type === "configure");
  const chompExcites = chompMessages.filter((message) => message.type === "excite");
  expect(chompConfigurations).toHaveLength(32);
  expect(chompExcites).toHaveLength(32);
  expect(chompExcites.every(({ eventType }) => eventType === "strike")).toBe(true);
  expect(chompExcites.every(({ jawOpen }) => jawOpen !== null && jawOpen <= 0.002)).toBe(true);
  expect(chompExcites.at(-1).at - chompExcites[0].at).toBeLessThanOrEqual(25);
  const actualChompFrequencies = chompConfigurations
    .map(({ frequency }) => frequency)
    .sort((left, right) => left - right);
  for (const [index, frequency] of expectedChompFrequencies.entries()) {
    expect(actualChompFrequencies[index]).toBeCloseTo(frequency, 6);
  }
  await expect(page.locator(`[data-tooth-id="${selectedBeforeChomp}"]`))
    .toHaveAttribute("aria-current", "true");
  await expect(chomp).toHaveAttribute("aria-pressed", "false", { timeout: 1_500 });
  await expect.poll(() => page.evaluate(() => globalThis.__dentaphoneWebGL.snapshot().jawOpen)).toBeCloseTo(0.31, 2);
  await expect(page.locator("#dentaphoneKeyboard")).not.toHaveClass(/is-chomping/);
  await page.waitForTimeout(180);
  expect(await page.evaluate(() => (
    globalThis.__dentaphoneFoodMessages.filter((message) => message.type === "excite").length
  ))).toBe(32);

  const emptyOrbitPath = await artboard.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const points = [];
    for (let row = 1; row < 10; row += 1) {
      for (let column = 1; column < 10; column += 1) {
        const point = {
          x: bounds.left + bounds.width * column / 10,
          y: bounds.top + bounds.height * row / 10,
        };
        const hit = document.elementFromPoint(point.x, point.y);
        if (
          element.contains(hit)
          && !hit?.closest?.(".dentaphone-tooth")
          && !globalThis.__dentaphoneWebGL.pick(point.x, point.y)
        ) points.push(point);
      }
    }
    let path = null;
    for (const from of points) {
      for (const to of points) {
        const horizontalDistance = Math.abs(to.x - from.x);
        if (!path || horizontalDistance > path.horizontalDistance) {
          path = { from, to, horizontalDistance };
        }
      }
    }
    return path;
  });
  expect(emptyOrbitPath?.horizontalDistance).toBeGreaterThan(120);
  const yawBeforeOrbit = await page.evaluate(() => globalThis.__dentaphoneWebGL.snapshot().yaw);
  await page.mouse.move(emptyOrbitPath.from.x, emptyOrbitPath.from.y);
  await page.mouse.down();
  await expect(page.locator("#stageWrap")).toHaveClass(/is-rotating/);
  await page.mouse.move(emptyOrbitPath.to.x, emptyOrbitPath.to.y, { steps: 8 });
  await expect.poll(() => page.evaluate((before) => (
    Math.abs(globalThis.__dentaphoneWebGL.snapshot().yaw - before)
  ), yawBeforeOrbit)).toBeGreaterThan(0.03);
  await page.mouse.up();
  await expect(page.locator("#stageWrap")).not.toHaveClass(/is-rotating/);
  await expect(struckTooth).toHaveAttribute("aria-current", "true");
  expect(await toothLayout()).not.toEqual(imageLayout);

  await page.locator("#dentaphoneView2d").click();
  await expect(page.locator("body")).toHaveAttribute("data-dentaphone-view-mode", "2d");
  await expect(artboard).toHaveAttribute("data-dentaphone-view-mode", "2d");
  await expect(artboard).toHaveAttribute("data-dentaphone-renderer", "image");
  await expect(page.locator("#dentaphoneView2d")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#dentaphoneView3d")).toHaveAttribute("aria-selected", "false");
  await expect.poll(() => page.evaluate(() => globalThis.__dentaphoneWebGL.snapshot().active)).toBe(false);
  const paused = await page.evaluate(() => globalThis.__dentaphoneWebGL.snapshot());
  expect(paused.ready).toBe(true);
  expect(paused.active).toBe(false);
  await expect(canvas).toHaveCSS("opacity", "0");
  await expect(page.locator("#dentaphone3dControls")).toBeHidden();
  for (const artwork of await page.locator(".dentaphone-artwork").all()) {
    await expect(artwork).toHaveCSS("opacity", "1");
  }
  await expect(page.locator(".dentaphone-tooth[data-webgl-hidden]")).toHaveCount(0);
  expect(await toothLayout()).toEqual(imageLayout);
  const restoredIds = imageLayout.map(({ id }) => id);
  const restoredPoints = await dentaphoneToothPoints(page, restoredIds);
  expect(restoredPoints.map(({ centerToothId }) => centerToothId)).toEqual(restoredIds);
});

test("Dentaphone shows a visible 3D load failure and retries from the same page", async ({ page }) => {
  let modelRequests = 0;
  let heldModelRoute = null;
  let markFirstRequest;
  const firstRequest = new Promise((resolve) => { markFirstRequest = resolve; });
  await page.route("**/assets/models/dentaphone-chomper.glb*", async (route) => {
    modelRequests += 1;
    if (modelRequests === 1) {
      heldModelRoute = route;
      markFirstRequest();
      return;
    }
    await route.continue();
  });

  await page.goto("dentaphone.html", { waitUntil: "load" });
  const status = page.locator("#dentaphone3dStatus");
  const tab = page.locator("#dentaphoneView3d");
  await expect(status).toBeHidden();
  await page.locator("#dentaphoneView2d").focus();
  await page.keyboard.press("ArrowRight");
  await firstRequest;
  await expect(tab).toHaveAttribute("aria-busy", "true");
  await expect(status).toBeVisible();
  await expect(status).toHaveAttribute("data-state", "loading");
  await expect(page.locator("#dentaphone3dStatusMessage")).toContainText("Loading the 3D tooth model");

  await heldModelRoute.abort("failed");
  await expect(page.locator("body")).toHaveAttribute("data-dentaphone-view-mode", "2d");
  await expect(tab).toHaveAttribute("aria-selected", "false");
  await expect(page.locator("#dentaphoneView2d")).toBeFocused();
  await expect(tab).not.toHaveAttribute("aria-busy", "true");
  await expect(status).toBeVisible();
  await expect(status).toHaveAttribute("data-state", "error");
  await expect(page.locator("#dentaphone3dStatusMessage")).toContainText("couldn’t load");
  await expect(page.locator("#dentaphone3dRetry")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileStatusBounds = await status.boundingBox();
  expect(mobileStatusBounds).not.toBeNull();
  expect(mobileStatusBounds.x).toBeGreaterThanOrEqual(0);
  expect(mobileStatusBounds.x + mobileStatusBounds.width).toBeLessThanOrEqual(390);

  await page.locator("#dentaphone3dRetry").click();
  const recovered = await waitForDentaphoneWebGL(page);
  expect(modelRequests).toBe(2);
  expect(recovered.active).toBe(true);
  expect(recovered.toothCount).toBe(32);
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(status).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#dentaphone3dStatusMessage")).toContainText("3D model ready");
  await expect(status).toBeHidden({ timeout: 3_000 });
});

test("Dentaphone ignores a stale 3D rejection after a newer retry starts", async ({ page }) => {
  let modelRequests = 0;
  let heldModelRoute = null;
  let markModelRequest;
  const modelRequest = new Promise((resolve) => { markModelRequest = resolve; });
  await page.route("**/assets/models/dentaphone-chomper.glb*", async (route) => {
    modelRequests += 1;
    heldModelRoute = route;
    markModelRequest();
  });

  await page.goto("dentaphone.html", { waitUntil: "load" });
  await page.evaluate(async () => {
    const { GLTFLoader } = await import("./vendor/three/loaders/GLTFLoader.js");
    const module = await import("./src/dentaphone-webgl.js?retry-race");
    const nativeLoadAsync = GLTFLoader.prototype.loadAsync;
    // FileLoader coalesces concurrent requests for one URL, so control only the
    // stale load and let the retry exercise the real loader independently.
    const firstLoad = new Promise((_resolve, reject) => {
      globalThis.__dentaphoneRejectFirstLoad = reject;
    });
    let loadCount = 0;
    GLTFLoader.prototype.loadAsync = function loadAsync(...args) {
      loadCount += 1;
      if (loadCount === 1) return firstLoad;
      return nativeLoadAsync.apply(this, args);
    };
    globalThis.__dentaphoneRetryRaceModule = module;
    globalThis.__dentaphoneFirstInitialization = module.initializeDentaphoneWebGL();
  });

  await page.evaluate(() => {
    globalThis.__dentaphoneRetryRaceModule.disposeDentaphoneWebGL();
    globalThis.__dentaphoneSecondInitialization = (
      globalThis.__dentaphoneRetryRaceModule.initializeDentaphoneWebGL()
    );
  });
  await modelRequest;
  expect(modelRequests).toBe(1);

  await page.evaluate(() => {
    globalThis.__dentaphoneRejectFirstLoad(new Error("stale model load failed"));
  });
  await heldModelRoute.continue();
  const recovered = await page.evaluate(async () => {
    await globalThis.__dentaphoneFirstInitialization;
    await globalThis.__dentaphoneSecondInitialization;
    return {
      ready: globalThis.__dentaphoneRetryRaceModule.dentaphoneWebGLIsReady(),
      snapshot: globalThis.__dentaphoneRetryRaceModule.dentaphoneWebGLSnapshot(),
    };
  });
  expect(recovered.ready).toBe(true);
  expect(recovered.snapshot.toothCount).toBe(32);
});

test("Dentaphone keeps note shortcuts and physical controls coherent from a focused tooth", async ({ page }) => {
  await page.goto("dentaphone.html", { waitUntil: "load" });
  const highTooth = page.locator('[data-tooth-id="upper-16"]');
  await highTooth.focus();
  expect(Number(await page.locator("#baseFrequencyHz").inputValue())).toBe(622);

  await page.locator("#strikePosition").fill("0.2");
  await expect(page.locator("#strikePosition")).toHaveAttribute("aria-valuetext", "20%");
  await page.locator('[data-action="strike"]').click();
  expect(Number(await page.locator("#strikePosition").inputValue())).toBeCloseTo(0.2, 2);

  await page.locator("#size").fill("4");
  expect(Number(await page.locator("#baseFrequencyHz").inputValue())).toBe(622);
  await expect(page.locator('[data-metric="secondary"]')).toContainText("622 Hz");

  await highTooth.focus();
  await page.keyboard.press("KeyA");
  await expect(page.locator('[data-tooth-id="lower-01"]')).toHaveClass(/is-struck/);
  const shortcutFrequency = Number(await page.locator("#baseFrequencyHz").inputValue());
  expect(shortcutFrequency).toBeGreaterThan(130);
  expect(shortcutFrequency).toBeLessThan(132);
});

test("Dentaphone mouse glissando follows the curved lower 2D tooth row", async ({ page }) => {
  await page.goto("dentaphone.html", { waitUntil: "load" });
  const ids = Array.from({ length: 8 }, (_, index) => `lower-${String(index + 5).padStart(2, "0")}`);
  const points = await dentaphoneToothPoints(page, ids);
  expect(points.map(({ centerToothId }) => centerToothId)).toEqual(ids);
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  await expect(page.locator(`[data-tooth-id="${ids[0]}"]`)).toHaveAttribute("aria-current", "true");
  for (const point of points.slice(1)) {
    await page.mouse.move(point.x, point.y, { steps: 3 });
    await expect(page.locator(`[data-tooth-id="${point.id}"]`)).toHaveAttribute("aria-current", "true");
  }
  await page.waitForTimeout(100);
  await page.mouse.up();
  const last = page.locator('[data-tooth-id="lower-12"]');
  await expect(last).toHaveClass(/is-selected/);
  await expect(page.locator("#stageReadout")).toContainText("B3");
});

test("Dentaphone touch glissando escapes implicit pointer capture", async ({ page }) => {
  await page.goto("dentaphone.html", { waitUntil: "load" });
  const ids = Array.from({ length: 8 }, (_, index) => `lower-${String(index + 5).padStart(2, "0")}`);
  const points = await dentaphoneToothPoints(page, ids);
  expect(points.map(({ centerToothId }) => centerToothId)).toEqual(ids);
  const first = page.locator(`[data-tooth-id="${ids[0]}"]`);
  const last = page.locator(`[data-tooth-id="${ids.at(-1)}"]`);
  await first.dispatchEvent("pointerdown", {
    pointerId: 23,
    pointerType: "touch",
    clientX: points[0].x,
    clientY: points[0].y,
    pressure: 0.6,
  });
  await expect(first).toHaveAttribute("aria-current", "true");
  for (const point of points.slice(1)) {
    await first.dispatchEvent("pointermove", {
      pointerId: 23,
      pointerType: "touch",
      clientX: point.x,
      clientY: point.y,
      pressure: 0.6,
    });
    await expect(page.locator(`[data-tooth-id="${point.id}"]`)).toHaveAttribute("aria-current", "true");
  }
  await first.dispatchEvent("pointerup", {
    pointerId: 23,
    pointerType: "touch",
    clientX: points.at(-1).x,
    clientY: points.at(-1).y,
  });
  await expect(last).toHaveClass(/is-selected/);
});

test("Dentaphone keeps each queued pitch during delayed first-use startup", async ({ page }) => {
  await page.addInitScript(() => {
    const NativeAudioWorkletNode = globalThis.AudioWorkletNode;
    globalThis.__dentaphoneMessages = [];
    globalThis.AudioWorkletNode = class DentaphoneCaptureNode extends NativeAudioWorkletNode {
      constructor(...args) {
        super(...args);
        const nativePostMessage = this.port.postMessage.bind(this.port);
        this.port.postMessage = (message, transfer) => {
          if (message?.type === "configure" || message?.type === "excite") {
            globalThis.__dentaphoneMessages.push(message);
          }
          return nativePostMessage(message, transfer);
        };
      }
    };
  });
  await page.route("**/src/physical-sounds-processor.js", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    await route.continue();
  });
  await page.goto("dentaphone.html", { waitUntil: "load" });
  for (const toothId of ["lower-01", "lower-02", "lower-03"]) {
    await page.locator(`[data-tooth-id="${toothId}"]`).focus();
    await page.keyboard.press("Enter");
  }

  await expect.poll(() => page.evaluate(() => (
    globalThis.__dentaphoneMessages.filter((message) => message.type === "excite").length
  )), { timeout: 2_000 }).toBe(3);
  const captures = await page.evaluate(() => {
    const excitedFrequencies = [];
    const excitedPositions = [];
    let configuredFrequency = null;
    let configuredPosition = null;
    for (const message of globalThis.__dentaphoneMessages) {
      if (message.type === "configure") {
        configuredFrequency = message.fundamentalOverrideHz;
        configuredPosition = message.configuration.strikePosition;
      } else if (message.type === "excite") {
        excitedFrequencies.push(configuredFrequency);
        excitedPositions.push(configuredPosition);
      }
    }
    return { frequencies: excitedFrequencies, positions: excitedPositions };
  });
  expect(captures.frequencies[0]).toBeCloseTo(130.81, 1);
  expect(captures.frequencies[1]).toBeCloseTo(138.59, 1);
  expect(captures.frequencies[2]).toBeCloseTo(146.83, 1);
  expect(new Set(captures.positions).size).toBe(3);
});

test("Dentaphone cancels a queued glissando when audio is switched off", async ({ page }) => {
  await page.addInitScript(() => {
    const NativeAudioWorkletNode = globalThis.AudioWorkletNode;
    globalThis.__dentaphoneExcites = 0;
    globalThis.AudioWorkletNode = class DentaphoneCancelCaptureNode extends NativeAudioWorkletNode {
      constructor(...args) {
        super(...args);
        const nativePostMessage = this.port.postMessage.bind(this.port);
        this.port.postMessage = (message, transfer) => {
          if (message?.type === "excite") globalThis.__dentaphoneExcites += 1;
          return nativePostMessage(message, transfer);
        };
      }
    };
  });
  await page.route("**/src/physical-sounds-processor.js", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.continue();
  });
  await page.goto("dentaphone.html", { waitUntil: "load" });
  await page.evaluate(() => {
    for (const [index, tooth] of [...document.querySelectorAll('.dentaphone-tooth')].entries()) {
      tooth.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true,
        pointerId: index + 40,
        pointerType: "touch",
        pressure: 0.6,
      }));
    }
  });
  await expect(page.locator("#audioState")).toHaveText("on", { timeout: 2_000 });
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioState")).toHaveText("off");
  const countAfterOff = await page.evaluate(() => globalThis.__dentaphoneExcites);
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => globalThis.__dentaphoneExcites)).toBe(countAfterOff);
  await expect(page.locator("#audioState")).toHaveText("off");
});

test("Dentaphone material edits supersede queued strike snapshots", async ({ page }) => {
  await page.addInitScript(() => {
    const NativeAudioWorkletNode = globalThis.AudioWorkletNode;
    globalThis.__dentaphoneConfigurations = [];
    globalThis.AudioWorkletNode = class DentaphoneStateCaptureNode extends NativeAudioWorkletNode {
      constructor(...args) {
        super(...args);
        const nativePostMessage = this.port.postMessage.bind(this.port);
        this.port.postMessage = (message, transfer) => {
          if (message?.type === "configure") {
            globalThis.__dentaphoneConfigurations.push(message.configuration);
          }
          return nativePostMessage(message, transfer);
        };
      }
    };
  });
  await page.goto("dentaphone.html", { waitUntil: "load" });
  await page.locator("#audioButton").click();
  await page.evaluate(() => {
    globalThis.__dentaphoneConfigurations.length = 0;
    for (const [index, tooth] of [...document.querySelectorAll('.dentaphone-tooth')].entries()) {
      tooth.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true,
        pointerId: index + 80,
        pointerType: "touch",
        pressure: 0.6,
      }));
    }
  });
  await page.locator("#preset").selectOption("glass-bowl");
  await page.locator("#size").fill("3");
  await page.waitForTimeout(600);
  const finalConfiguration = await page.evaluate(() => globalThis.__dentaphoneConfigurations.at(-1));
  expect(finalConfiguration.presetId).toBe("glass-bowl");
  expect(finalConfiguration.size).toBe(3);
  await expect(page.locator("body")).toHaveAttribute("data-dentaphone-material", "glass-bowl");
});

test("Dentaphone tap-feeds the chosen object and completes multiple jaw bites", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("dentaphone.html", { waitUntil: "load" });
  await enterDentaphone3d(page);
  await page.evaluate(() => {
    globalThis.__dentaphoneObservedBites = [];
    const rig = document.querySelector("#dentaphoneKeyboard");
    new MutationObserver(() => {
      const bite = Number(rig.dataset.chewBite);
      if (bite && !globalThis.__dentaphoneObservedBites.includes(bite)) {
        globalThis.__dentaphoneObservedBites.push(bite);
      }
    }).observe(rig, { attributes: true, attributeFilter: ["data-chew-bite"] });
  });

  await page.locator('[data-dentaphone-food="apple"]').click();
  const layer = page.locator("#dentaphoneFoodLayer");
  const object = layer.locator('[data-food="apple"]');
  await expect(layer).toHaveAttribute("data-active-food", "apple");
  await expect(object).toHaveAttribute("src", "assets/dentaphone-chew-apple.webp");
  await expect(page.locator('[data-dentaphone-food="apple"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#dentaphoneChewStatus")).toHaveText(
    "Crisp apple swallowed after 4 bites.",
    { timeout: 4_000 },
  );
  expect(await page.evaluate(() => globalThis.__dentaphoneObservedBites)).toEqual([1, 2, 3, 4]);
});

test("Dentaphone gives all four foods distinct nonempty reduced-motion sound sequences", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await captureDentaphoneFoodMessages(page);
  await page.goto("dentaphone.html", { waitUntil: "load" });
  await enterDentaphone3d(page);
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioState")).toHaveText("on");

  const foods = [
    { id: "apple", completion: "Crisp apple swallowed after 4 bites." },
    { id: "crystal", completion: "Resonant crystal swallowed after 3 bites." },
    { id: "gear", completion: "Clockwork gear swallowed after 5 bites." },
    { id: "seedpod", completion: "Rattle seedpod swallowed after 4 bites." },
  ];
  const sequences = [];
  for (const food of foods) {
    await page.evaluate(() => { globalThis.__dentaphoneFoodMessages.length = 0; });
    await page.locator(`[data-dentaphone-food="${food.id}"]`).click();
    await expect(page.locator("#dentaphoneFoodLayer")).toHaveAttribute("data-active-food", food.id);
    await expect(page.locator("#dentaphoneChewStatus")).toHaveText(food.completion, { timeout: 4_000 });
    const messages = await page.evaluate(() => globalThis.__dentaphoneFoodMessages);
    const configureCount = messages.filter((message) => message.type === "configure").length;
    const exciteCount = messages.filter((message) => message.type === "excite").length;
    expect(configureCount, `${food.id} configure messages`).toBeGreaterThan(0);
    expect(exciteCount, `${food.id} excite messages`).toBeGreaterThan(0);
    expect(configureCount, `${food.id} should configure every excitation`)
      .toBeGreaterThanOrEqual(exciteCount);
    sequences.push(JSON.stringify(messages.map(({
      type,
      frequency,
      position,
      strength,
      eventType,
    }) => ({ type, frequency, position, strength, eventType }))));
  }
  expect(new Set(sequences).size).toBe(foods.length);
});

test("Dentaphone rejects an outside mouse drop and accepts the mouth center", async ({ page }) => {
  await page.goto("dentaphone.html", { waitUntil: "load" });
  await enterDentaphone3d(page);
  const food = page.locator('[data-dentaphone-food="crystal"]');
  const thumbnail = food.locator("img");
  await food.scrollIntoViewIfNeeded();
  const [start, artboard] = await Promise.all([
    thumbnail.boundingBox(),
    page.locator("#dentaphoneArtboard").boundingBox(),
  ]);
  expect(start).not.toBeNull();
  expect(artboard).not.toBeNull();
  const dragFromThumbnail = async (x, y) => {
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, y, { steps: 5 });
    await page.mouse.up();
  };

  await dragFromThumbnail(artboard.x + 3, artboard.y + 3);
  await expect(page.locator("#dentaphoneChewStatus")).toContainText("returned");
  await expect(page.locator("#dentaphoneFoodLayer .dentaphone-mouth-food")).toHaveCount(0);
  await expect(page.locator("#dentaphoneFoodLayer")).not.toHaveAttribute("data-active-food", /.+/);

  await dragFromThumbnail(
    artboard.x + artboard.width / 2,
    artboard.y + artboard.height / 2,
  );
  await expect(page.locator("#dentaphoneFoodLayer")).toHaveAttribute("data-active-food", "crystal");
  await expect(page.locator('#dentaphoneFoodLayer [data-food="crystal"]')).toHaveAttribute(
    "src",
    "assets/dentaphone-chew-crystal.webp",
  );
  await page.locator("#dentaphoneClearFood").click();
});

test("Dentaphone Clear and Mute cancel pending food hits and empty the mouth", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await captureDentaphoneFoodMessages(page);
  await page.goto("dentaphone.html", { waitUntil: "load" });
  await enterDentaphone3d(page);
  await page.locator("#audioButton").click();
  const cancellations = ["#dentaphoneClearFood", '.performance-button[data-action="stop"]'];

  for (const selector of cancellations) {
    await page.evaluate(() => { globalThis.__dentaphoneFoodMessages.length = 0; });
    await page.locator('[data-dentaphone-food="gear"]').click();
    await expect.poll(() => page.evaluate(() => (
      globalThis.__dentaphoneFoodMessages.filter((message) => message.type === "excite").length
    ))).toBeGreaterThan(0);
    await page.locator(selector).click();
    const hitsAfterCancellation = await page.evaluate(() => (
      globalThis.__dentaphoneFoodMessages.filter((message) => message.type === "excite").length
    ));
    await page.waitForTimeout(650);
    expect(await page.evaluate(() => (
      globalThis.__dentaphoneFoodMessages.filter((message) => message.type === "excite").length
    ))).toBe(hitsAfterCancellation);
    await expect(page.locator("#dentaphoneFoodLayer")).toHaveAttribute("data-state", "empty");
    await expect(page.locator("#dentaphoneFoodLayer .dentaphone-mouth-food")).toHaveCount(0);
    await expect(page.locator("#dentaphoneKeyboard")).not.toHaveClass(/is-chewing|is-chomping/);
    await expect(page.locator('[data-dentaphone-food="gear"]')).toHaveAttribute("aria-pressed", "false");
  }
});

test("Dentaphone automatic toothbrush sweeps every tooth, reverses, and stops cleanly", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await captureDentaphoneFoodMessages(page);
  await page.goto("dentaphone.html", { waitUntil: "load" });
  await page.evaluate(() => {
    globalThis.__dentaphoneBrushTeeth = [];
    const rig = document.querySelector("#dentaphoneKeyboard");
    new MutationObserver(() => {
      if (rig.dataset.brushTooth) globalThis.__dentaphoneBrushTeeth.push(rig.dataset.brushTooth);
    }).observe(rig, { attributes: true, attributeFilter: ["data-brush-tooth"] });
  });

  const automatic = page.locator("#dentaphoneBrushAuto");
  const brush = page.locator("#dentaphoneToothbrush");
  await automatic.click();
  await expect(automatic).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#dentaphoneBrushManual")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#dentaphoneKeyboard")).toHaveAttribute("data-brush-mode", "auto");
  await expect(brush.locator("img")).toBeVisible();
  await expect(page.locator("#dentaphoneBrushStatus")).toContainText("Automatic brush");
  await expect.poll(() => page.evaluate(() => (
    new Set(globalThis.__dentaphoneBrushTeeth).size
  )), { timeout: 12_000 }).toBe(32);

  const capture = await page.evaluate(() => ({
    teeth: globalThis.__dentaphoneBrushTeeth,
    messages: globalThis.__dentaphoneFoodMessages,
  }));
  expect(capture.teeth.slice(0, 17)).toEqual([
    ...Array.from({ length: 16 }, (_, index) => `upper-${String(index + 1).padStart(2, "0")}`),
    "upper-15",
  ]);
  const configuredFrequencies = capture.messages
    .filter((message) => message.type === "configure" && Number.isFinite(message.frequency))
    .map((message) => message.frequency);
  expect(new Set(configuredFrequencies).size).toBeGreaterThan(20);
  expect(capture.messages.filter((message) => message.type === "excite").length).toBeGreaterThan(30);
  const alignment = await page.locator("#dentaphoneKeyboard").evaluate((rig) => {
    const id = rig.dataset.brushTooth;
    const tooth = document.querySelector(`[data-tooth-id="${id}"]`);
    const artboard = document.querySelector("#dentaphoneArtboard");
    const brushImage = document.querySelector("#dentaphoneToothbrush");
    const toothBounds = tooth.getBoundingClientRect();
    const artboardBounds = artboard.getBoundingClientRect();
    return {
      x: Number.parseFloat(brushImage.style.getPropertyValue("--brush-x")),
      y: Number.parseFloat(brushImage.style.getPropertyValue("--brush-y")),
      expectedX: ((toothBounds.left + toothBounds.right) * 0.5 - artboardBounds.left) / artboardBounds.width * 100,
      expectedY: ((toothBounds.top + toothBounds.bottom) * 0.5 - artboardBounds.top) / artboardBounds.height * 100,
    };
  });
  expect(alignment.x).toBeCloseTo(alignment.expectedX, 1);
  expect(alignment.y).toBeCloseTo(alignment.expectedY, 1);

  await page.locator("#dentaphoneBrushStop").click();
  await expect(automatic).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#dentaphoneKeyboard")).toHaveAttribute("data-brush-mode", "off");
  await expect(brush.locator("img")).toBeHidden();
  const hitsAfterStop = await page.evaluate(() => (
    globalThis.__dentaphoneFoodMessages.filter((message) => message.type === "excite").length
  ));
  await page.waitForTimeout(420);
  expect(await page.evaluate(() => (
    globalThis.__dentaphoneFoodMessages.filter((message) => message.type === "excite").length
  ))).toBe(hitsAfterStop);
});

test("Dentaphone manual toothbrush follows a back-and-forth 2D scrub and plays contacted teeth", async ({ page }) => {
  await captureDentaphoneFoodMessages(page);
  await page.goto("dentaphone.html", { waitUntil: "load" });
  await page.evaluate(() => {
    globalThis.__dentaphoneBrushTeeth = [];
    const rig = document.querySelector("#dentaphoneKeyboard");
    new MutationObserver(() => {
      if (rig.dataset.brushTooth) globalThis.__dentaphoneBrushTeeth.push(rig.dataset.brushTooth);
    }).observe(rig, { attributes: true, attributeFilter: ["data-brush-tooth"] });
  });
  await page.locator("#dentaphoneBrushManual").click();
  await expect(page.locator("#dentaphoneBrushManual")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#dentaphoneKeyboard")).toHaveAttribute("data-brush-state", "armed");
  await expect(page.locator("#dentaphoneJawOpen")).toBeHidden();

  const ids = ["lower-06", "lower-07", "lower-08", "lower-09", "lower-10", "lower-11"];
  const points = await dentaphoneToothPoints(page, ids);
  expect(points.every(Boolean)).toBe(true);
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  for (const point of points.slice(1)) {
    await page.mouse.move(point.x, point.y, { steps: 4 });
  }
  for (const point of [...points].reverse().slice(1)) {
    await page.mouse.move(point.x, point.y, { steps: 4 });
  }
  await page.mouse.up();

  await expect(page.locator("#dentaphoneKeyboard")).toHaveAttribute("data-brush-state", "armed");
  await expect(page.locator("#dentaphoneToothbrush img")).toBeVisible();
  await expect.poll(() => page.evaluate(() => (
    globalThis.__dentaphoneFoodMessages.filter((message) => message.type === "excite").length
  ))).toBeGreaterThanOrEqual(ids.length * 2 - 2);
  const visited = await page.evaluate(() => globalThis.__dentaphoneBrushTeeth);
  for (const id of ids) expect(visited).toContain(id);
  expect(visited.filter((id) => id === ids[0]).length).toBeGreaterThanOrEqual(2);
  expect(new Set(await page.evaluate(() => (
    globalThis.__dentaphoneFoodMessages
      .filter((message) => message.type === "configure" && Number.isFinite(message.frequency))
      .map((message) => message.frequency)
  ))).size).toBeGreaterThanOrEqual(ids.length);

  await page.keyboard.press("Escape");
  await expect(page.locator("#dentaphoneBrushManual")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#dentaphoneToothbrush img")).toBeHidden();
});

test("Dentaphone manual toothbrush uses 3D mesh picking without rotating the mouth", async ({ page }) => {
  await captureDentaphoneFoodMessages(page);
  await page.goto("dentaphone.html", { waitUntil: "load" });
  await page.locator("#dentaphoneView3d").click();
  await waitForDentaphoneWebGL(page);
  await page.locator("#dentaphoneYaw").fill("14");
  await expect(page.locator("#dentaphoneArtboard")).toHaveAttribute("data-view-yaw", "14.00");
  const targets = await page.locator("#dentaphoneArtboard").evaluate((artboard) => (
    [...artboard.querySelectorAll(".dentaphone-tooth:not([data-webgl-hidden])")]
      .map((tooth) => {
        const bounds = tooth.getBoundingClientRect();
        const point = {
          id: tooth.dataset.toothId,
          x: (bounds.left + bounds.right) * 0.5,
          y: (bounds.top + bounds.bottom) * 0.5,
        };
        return globalThis.__dentaphoneWebGL.pick(point.x, point.y) === point.id ? point : null;
      })
      .filter(Boolean)
      .slice(0, 5)
  ));
  expect(targets.length).toBeGreaterThanOrEqual(3);
  const orientation = await page.evaluate(() => {
    const snapshot = globalThis.__dentaphoneWebGL.snapshot();
    return { yaw: snapshot.yaw, pitch: snapshot.pitch };
  });

  await page.locator("#dentaphoneBrushManual").click();
  await page.mouse.move(targets[0].x, targets[0].y);
  await page.mouse.down();
  for (const point of targets.slice(1)) await page.mouse.move(point.x, point.y, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => (
    globalThis.__dentaphoneFoodMessages.filter((message) => message.type === "excite").length
  ))).toBeGreaterThanOrEqual(3);
  const visited = await page.evaluate(() => globalThis.__dentaphoneFoodMessages
    .filter((message) => message.type === "configure" && Number.isFinite(message.frequency))
    .map((message) => message.frequency));
  expect(new Set(visited).size).toBeGreaterThanOrEqual(3);
  const after = await page.evaluate(() => {
    const snapshot = globalThis.__dentaphoneWebGL.snapshot();
    return { yaw: snapshot.yaw, pitch: snapshot.pitch };
  });
  expect(after.yaw).toBeCloseTo(orientation.yaw, 6);
  expect(after.pitch).toBeCloseTo(orientation.pitch, 6);
  await expect(page.locator("#stageWrap")).not.toHaveClass(/is-rotating/);
});

test("Dentaphone stops a pending automatic brush before delayed first-use audio can emit", async ({ page }) => {
  await page.addInitScript(() => {
    const nativeAddModule = globalThis.AudioWorklet.prototype.addModule;
    globalThis.AudioWorklet.prototype.addModule = async function delayedAddModule(...args) {
      await new Promise((resolve) => setTimeout(resolve, 1_200));
      return nativeAddModule.apply(this, args);
    };
  });
  await captureDentaphoneFoodMessages(page);
  await page.goto("dentaphone.html", { waitUntil: "load" });
  await page.locator("#dentaphoneBrushAuto").click();
  await expect(page.locator("#dentaphoneKeyboard")).toHaveAttribute("data-brush-state", "starting");
  await page.locator("#dentaphoneBrushStop").click();
  await expect(page.locator("#dentaphoneKeyboard")).toHaveAttribute("data-brush-mode", "off");
  await page.waitForTimeout(1_500);
  expect(await page.evaluate(() => (
    globalThis.__dentaphoneFoodMessages.filter((message) => message.type === "excite").length
  ))).toBe(0);
});

test("Dentaphone manual toothbrush scrubs with touch on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await captureDentaphoneFoodMessages(page);
  await page.goto("dentaphone.html", { waitUntil: "load" });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  await page.locator("#dentaphoneBrushManual").click();
  await page.locator("#dentaphoneArtboard").scrollIntoViewIfNeeded();

  const points = await dentaphoneToothPoints(page, [
    "lower-07",
    "lower-08",
    "lower-09",
    "lower-10",
  ]);
  expect(points.every(Boolean)).toBe(true);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ id: 1, x: points[0].x, y: points[0].y }],
  });
  for (const point of points.slice(1)) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ id: 1, x: point.x, y: point.y }],
    });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });

  await expect(page.locator("#dentaphoneBrushManual")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#dentaphoneKeyboard")).toHaveAttribute("data-brush-state", "armed");
  await expect(page.locator("#dentaphoneToothbrush img")).toBeVisible();
  await expect.poll(() => page.evaluate(() => (
    globalThis.__dentaphoneFoodMessages.filter((message) => message.type === "excite").length
  ))).toBeGreaterThanOrEqual(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("Dentaphone keeps mobile label swipes scrollable and thumbnail drags feedable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("dentaphone.html", { waitUntil: "load" });
  await enterDentaphone3d(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  const touchDrag = async (from, to) => {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ id: 1, x: from.x, y: from.y }],
    });
    for (let step = 1; step <= 5; step += 1) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{
          id: 1,
          x: from.x + (to.x - from.x) * step / 5,
          y: from.y + (to.y - from.y) * step / 5,
        }],
      });
      await page.waitForTimeout(20);
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };

  const food = page.locator('[data-dentaphone-food="seedpod"]');
  const panel = page.locator(".physical-panel");
  await food.evaluate((button) => button.scrollIntoView({ block: "center" }));
  const labelBounds = await food.locator("span").boundingBox();
  expect(labelBounds).not.toBeNull();
  const scrollBefore = await panel.evaluate((element) => element.scrollTop);
  await touchDrag(
    { x: labelBounds.x + labelBounds.width / 2, y: labelBounds.y + labelBounds.height / 2 },
    { x: labelBounds.x + labelBounds.width / 2, y: labelBounds.y + labelBounds.height / 2 - 70 },
  );
  await expect.poll(() => panel.evaluate((element) => element.scrollTop)).toBeGreaterThan(scrollBefore + 10);

  await food.locator("img").scrollIntoViewIfNeeded();
  const [thumbnailBounds, artboardBounds] = await Promise.all([
    food.locator("img").boundingBox(),
    page.locator("#dentaphoneArtboard").boundingBox(),
  ]);
  expect(thumbnailBounds).not.toBeNull();
  expect(artboardBounds).not.toBeNull();
  await touchDrag(
    {
      x: thumbnailBounds.x + thumbnailBounds.width / 2,
      y: thumbnailBounds.y + thumbnailBounds.height / 2,
    },
    {
      x: artboardBounds.x + artboardBounds.width / 2,
      y: artboardBounds.y + artboardBounds.height / 2,
    },
  );
  await expect(page.locator("#dentaphoneFoodLayer")).toHaveAttribute("data-active-food", "seedpod");
  await expect(page.locator('#dentaphoneFoodLayer [data-food="seedpod"]')).toHaveCount(1);
  await page.locator("#dentaphoneClearFood").click();
});

test("Dentaphone keeps both view tabs, 2D teeth, and budgeted 3D usable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("dentaphone.html", { waitUntil: "load" });
  await expect(page.locator("#dentaphoneArtboard")).toHaveAttribute("data-dentaphone-renderer", "image");
  await expect(page.locator("#dentaphoneWebgl")).toHaveCount(1);
  await expect(page.locator("#dentaphoneWebgl")).toHaveCSS("opacity", "0");
  const tabGeometry = await page.locator(".dentaphone-view-tabs button").evaluateAll((tabs) => tabs.map((tab) => {
    const box = tab.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return {
      left: box.left,
      right: box.right,
      top: box.top,
      bottom: box.bottom,
      width: box.width,
      height: box.height,
      hit: hit === tab || tab.contains(hit),
    };
  }));
  expect(tabGeometry).toHaveLength(2);
  expect(tabGeometry.every((tab) => (
    tab.left >= 0
    && tab.right <= 390
    && tab.top >= 0
    && tab.bottom <= 844
    && tab.width > 100
    && tab.height >= 32
    && tab.hit
  ))).toBe(true);
  const bounds = await page.locator(".dentaphone-tooth").evaluateAll((buttons) => buttons.map((button) => {
    const box = button.getBoundingClientRect();
    return {
      left: box.left,
      right: box.right,
      top: box.top,
      bottom: box.bottom,
      width: box.width,
      height: box.height,
    };
  }));
  expect(bounds).toHaveLength(32);
  expect(bounds.every((box) => box.width > 0 && box.height > 0)).toBe(true);
  expect(bounds.every((box) => (
    box.left >= 0 && box.right <= 390 && box.top >= 0 && box.bottom <= 844
  ))).toBe(true);
  expect(await page.evaluate(() => (
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  ))).toBeLessThanOrEqual(2);
  await expect(page.locator(".dentaphone-artwork")).toHaveCount(2);
  for (const artwork of await page.locator(".dentaphone-artwork").all()) {
    await expect(artwork).toBeVisible();
    await expect(artwork).toHaveCSS("opacity", "1");
  }
  expect(await page.locator(".dentaphone-artwork").evaluateAll((images) => images.map((image) => ({
    width: image.naturalWidth,
    height: image.naturalHeight,
  })))).toEqual([
    { width: 1536, height: 1024 },
    { width: 1536, height: 1024 },
  ]);

  const tooth = page.locator('[data-tooth-id="lower-08"]');
  await tooth.focus();
  await page.keyboard.press("Enter");
  await expect(tooth).toBeFocused();
  await expect(tooth).toHaveClass(/is-selected/);

  await page.locator("#dentaphoneView3d").click();
  const mobile3d = await waitForDentaphoneWebGL(page);
  expect(mobile3d.renderWidth).toBeGreaterThan(0);
  expect(mobile3d.renderHeight).toBeGreaterThan(0);
  expect(mobile3d.renderWidth * mobile3d.renderHeight).toBeLessThanOrEqual(1_650_000);
  await expect(page.locator("#dentaphoneView3d")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#dentaphoneWebgl")).toHaveCSS("opacity", "1");
  const canvasBounds = await page.locator("#dentaphoneWebgl").boundingBox();
  expect(canvasBounds).not.toBeNull();
  expect(canvasBounds.x).toBeGreaterThanOrEqual(0);
  expect(canvasBounds.x + canvasBounds.width).toBeLessThanOrEqual(390);
  expect(canvasBounds.y).toBeGreaterThanOrEqual(0);
  expect(canvasBounds.y + canvasBounds.height).toBeLessThanOrEqual(844);

  await page.locator("#dentaphoneView2d").click();
  await expect(page.locator("#dentaphoneView2d")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#dentaphoneArtboard")).toHaveAttribute("data-dentaphone-renderer", "image");
  await expect.poll(() => page.evaluate(() => globalThis.__dentaphoneWebGL.snapshot().active)).toBe(false);
  await expect(page.locator(".dentaphone-tooth")).toHaveCount(32);
  for (const artwork of await page.locator(".dentaphone-artwork").all()) {
    await expect(artwork).toHaveCSS("opacity", "1");
  }
});

test("Dentaphone keeps its stage and scrollable controls usable in phone landscape", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("dentaphone.html", { waitUntil: "load" });

  const layout = await page.evaluate(() => {
    const rectFor = (element) => {
      const bounds = element.getBoundingClientRect();
      return {
        left: bounds.left,
        top: bounds.top,
        right: bounds.right,
        bottom: bounds.bottom,
        width: bounds.width,
        height: bounds.height,
      };
    };
    const stage = document.querySelector("#stageWrap");
    const artboard = document.querySelector("#dentaphoneArtboard");
    const panel = document.querySelector(".physical-panel");
    const teeth = [...document.querySelectorAll(".dentaphone-tooth")].map((tooth) => {
      const bounds = tooth.getBoundingClientRect();
      const x = bounds.left + bounds.width / 2;
      const y = bounds.top + bounds.height / 2;
      return {
        id: tooth.dataset.toothId,
        x,
        y,
        inViewport: x >= 0 && x <= innerWidth && y >= 0 && y <= innerHeight,
      };
    });
    return {
      viewport: { width: innerWidth, height: innerHeight },
      stage: rectFor(stage),
      artboard: rectFor(artboard),
      artwork: [...document.querySelectorAll(".dentaphone-artwork")].map((image) => ({
        width: image.naturalWidth,
        height: image.naturalHeight,
        opacity: getComputedStyle(image).opacity,
      })),
      panel: {
        ...rectFor(panel),
        clientHeight: panel.clientHeight,
        scrollHeight: panel.scrollHeight,
        overflowY: getComputedStyle(panel).overflowY,
      },
      teeth,
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });

  expect(layout.viewport).toEqual({ width: 844, height: 390 });
  expect(layout.documentOverflow).toBeLessThanOrEqual(2);
  expect(layout.stage.width).toBeGreaterThan(0);
  expect(layout.stage.height).toBeGreaterThanOrEqual(165);
  expect(layout.stage.left).toBeGreaterThanOrEqual(0);
  expect(layout.stage.top).toBeGreaterThanOrEqual(0);
  expect(layout.stage.right).toBeLessThanOrEqual(layout.viewport.width);
  expect(layout.stage.bottom).toBeLessThanOrEqual(layout.viewport.height);
  expect(layout.artboard.left).toBeGreaterThanOrEqual(0);
  expect(layout.artboard.top).toBeGreaterThanOrEqual(0);
  expect(layout.artboard.right).toBeLessThanOrEqual(layout.viewport.width);
  expect(layout.artboard.bottom).toBeLessThanOrEqual(layout.viewport.height);
  expect(layout.artwork).toEqual([
    { width: 1536, height: 1024, opacity: "1" },
    { width: 1536, height: 1024, opacity: "1" },
  ]);
  expect(layout.panel.clientHeight).toBeGreaterThan(0);
  expect(layout.panel.scrollHeight).toBeGreaterThan(layout.panel.clientHeight);
  expect(layout.panel.overflowY).toMatch(/auto|scroll/);
  expect(layout.teeth).toHaveLength(32);
  expect(layout.teeth.filter((tooth) => !tooth.inViewport)).toEqual([]);

  const stageTooth = page.locator('[data-tooth-id="lower-08"]');
  await stageTooth.focus();
  await page.keyboard.press("Enter");
  await expect(stageTooth).toHaveClass(/is-selected/);
  await expect(page.locator("#audioState")).toHaveText("on");

  const panel = page.locator(".physical-panel");
  const initialPanelScroll = await panel.evaluate((element) => element.scrollTop);
  await expect(page.locator("#dentaphoneFoodCard")).toBeHidden();
  await expect(page.locator("#dentaphoneMotionCard")).toBeHidden();
  const pitchLayout = page.locator("#pitchLayout");
  await pitchLayout.scrollIntoViewIfNeeded();
  const controlGeometry = await pitchLayout.evaluate((control) => {
    const bounds = control.getBoundingClientRect();
    const panelBounds = control.closest(".physical-panel").getBoundingClientRect();
    const hit = document.elementFromPoint(
      bounds.left + bounds.width / 2,
      bounds.top + bounds.height / 2,
    );
    return {
      bounds: {
        left: bounds.left,
        top: bounds.top,
        right: bounds.right,
        bottom: bounds.bottom,
      },
      panel: { top: panelBounds.top, bottom: panelBounds.bottom },
      panelScroll: control.closest(".physical-panel").scrollTop,
      hit: hit === control || control.contains(hit),
      viewport: { width: innerWidth, height: innerHeight },
    };
  });
  expect(controlGeometry.panelScroll).toBeGreaterThan(initialPanelScroll);
  expect(controlGeometry.bounds.left).toBeGreaterThanOrEqual(0);
  expect(controlGeometry.bounds.right).toBeLessThanOrEqual(controlGeometry.viewport.width);
  expect(controlGeometry.bounds.top).toBeGreaterThanOrEqual(controlGeometry.panel.top);
  expect(controlGeometry.bounds.bottom).toBeLessThanOrEqual(controlGeometry.panel.bottom);
  expect(controlGeometry.bounds.bottom).toBeLessThanOrEqual(controlGeometry.viewport.height);
  expect(controlGeometry.hit).toBe(true);

  await pitchLayout.selectOption("marimba-split");
  await expect(pitchLayout).toHaveValue("marimba-split");
});

test("legacy Object Forge links land on Dentaphone", async ({ page }) => {
  await page.goto("object-forge.html", { waitUntil: "load" });
  await expect(page).toHaveURL(/dentaphone\.html$/);
});
