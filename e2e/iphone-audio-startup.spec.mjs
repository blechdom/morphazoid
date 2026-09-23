import { test, expect } from "@playwright/test";

const route = "shapes.html?dimension=2d&playing=continuous";

async function stallFirstContext(page) {
  await page.addInitScript(() => {
    const Native = AudioContext;
    const nativeState = Object.getOwnPropertyDescriptor(BaseAudioContext.prototype, "state").get;
    let first = true;
    globalThis.AudioContext = class extends Native {
      constructor(...args) {
        super(...args);
        if (!first) return;
        first = false;
        // Chromium often creates a running context inside a trusted click.
        // Model the suspended first context of a blocked/interrupted startup.
        Object.defineProperty(this, "state", {
          get: () => nativeState.call(this) === "closed" ? "closed" : "suspended",
        });
        this.resume = () => new Promise(resolve => { globalThis.finishOldResume = resolve; });
      }
    };
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "audioSession", {
      configurable: true, value: { type: "auto" },
    });
  });
});

test("Audio policy waits for the explicit speaker tap; Play never arms Audio", async ({ page }) => {
  await page.goto(route);
  await page.locator("#playButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate(() => navigator.audioSession.type)).toBe("auto");
  expect(await page.evaluate(async () => (
    await import("/src/audio-output-manager.js")
  ).getSharedAudioOutputManager().connectionCount())).toBe(0);
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("data-audio-state", "on");
  expect(await page.evaluate(() => navigator.audioSession.type)).toBe("playback");
  await page.waitForFunction(async () => (
    await import("/src/audio-output-manager.js")
  ).getSharedAudioOutputManager().getStatus().active);
});

test("a pending first resume is cancellable; a new tap succeeds without a late unmute", async ({ page }) => {
  await stallFirstContext(page);
  await page.goto(route);
  const audio = page.locator("#audioButton");
  await audio.click();
  await expect(audio).toHaveAttribute("data-audio-state", "starting");
  await expect(audio).toHaveAttribute("aria-pressed", "false");
  await expect(audio).toBeEnabled();
  await expect(page.locator("#audioStartupNotice")).toContainText("cancel");
  await audio.click();
  await expect(audio).toHaveAttribute("data-audio-state", "off");
  await audio.click();
  await expect(audio).toHaveAttribute("data-audio-state", "on");
  await page.evaluate(() => globalThis.finishOldResume());
  await expect(audio).toHaveAttribute("data-audio-state", "on");
});

test("a stalled resume becomes a visible retryable failure, not a permanently disabled button", async ({ page }) => {
  test.setTimeout(25000);
  await stallFirstContext(page);
  await page.goto(route);
  const audio = page.locator("#audioButton");
  await audio.click();
  await expect(audio).toHaveAttribute("data-audio-state", "error", { timeout: 12000 });
  await expect(audio).toBeEnabled();
  await expect(page.locator("#audioStartupNotice")).toContainText("retry");
  await audio.click();
  await expect(audio).toHaveAttribute("data-audio-state", "on");
});

for (const instrument of ["julie-saw", "morphynx", "syrinx"]) {
  test(`${instrument}: one explicit Audio tap starts the worklet; capture routing is preserved`, async ({ page }) => {
    await page.goto(`${instrument}.html`);
    const audio = page.locator("#audioButton");
    await expect(audio).toHaveAttribute("aria-pressed", "false");
    await audio.click();
    await expect(audio).toHaveAttribute("data-audio-state", "on", { timeout: 12000 });
    expect(await page.evaluate(() => navigator.audioSession.type)).toBe(instrument === "morphynx" ? "auto" : "playback");
  });
}

test("a failed Syrinx worklet load displays an error and a second tap rebuilds successfully", async ({ page }) => {
  await page.addInitScript(() => {
    const Native = AudioContext;
    let first = true;
    globalThis.AudioContext = class extends Native {
      constructor(...args) {
        super(...args);
        const worklet = this.audioWorklet, load = worklet.addModule.bind(worklet);
        // Worklet fetches are not consistently intercepted by page.route.
        // Reject the actual loading API once, then exercise its real retry.
        worklet.addModule = (...args) => {
          if (first) {
            first = false;
            return Promise.reject(new DOMException("Simulated failed worklet download", "AbortError"));
          }
          return load(...args);
        };
      }
    };
  });
  await page.goto("syrinx.html");
  const audio = page.locator("#audioButton");
  await audio.click();
  await expect(audio).toHaveAttribute("data-audio-state", "error");
  await expect(audio).toBeEnabled();
  await expect(page.locator("#audioError")).toBeVisible();
  await audio.click();
  await expect(audio).toHaveAttribute("data-audio-state", "on");
});

test("interruption gets a truthful resume control without resetting Play or arming an off session", async ({ page }) => {
  await page.goto(route);
  await page.locator("#playButton").click();
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("data-audio-state", "on");
  await page.evaluate(async () => {
    const manager = (await import("/src/audio-output-manager.js")).getSharedAudioOutputManager();
    globalThis.testAudioContext = [...manager.contexts.keys()][0];
    await globalThis.testAudioContext.suspend();
  });
  await expect(page.locator("#audioButton")).toHaveAttribute("data-audio-state", "interrupted");
  await expect(page.locator("#audioButton")).toHaveAccessibleName("Resume audio");
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("data-audio-state", "on");
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#audioButton").click();
  await page.evaluate(async () => {
    await globalThis.testAudioContext.suspend();
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator("#audioButton")).toHaveAttribute("data-audio-state", "off");
});

for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test.describe(`${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport, hasTouch: true });
    test("the explicit Audio control remains tappable on phone layouts", async ({ page }) => {
      await page.goto(route);
      const audio = page.locator("#audioButton");
      await audio.tap();
      await expect(audio).toHaveAttribute("data-audio-state", "on");
      const box = await audio.boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(48);
      expect(box.height).toBeGreaterThanOrEqual(48);
      await audio.tap();
      await expect(audio).toHaveAttribute("data-audio-state", "off");
    });
  });
}
