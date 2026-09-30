import { test, expect } from "@playwright/test";

test.describe("Hiccup Head private webcam cut-up", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const camera = { calls: [], tracks: [], source: null };
      Object.defineProperty(globalThis, "__hiccupHeadCameraTest", {
        configurable: true,
        value: camera,
      });
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
          async getUserMedia(constraints) {
            camera.calls.push(constraints);
            const source = document.createElement("canvas");
            source.width = 640;
            source.height = 640;
            const context = source.getContext("2d");
            context.fillStyle = "#1e75c7";
            context.fillRect(0, 0, source.width, source.height);
            context.fillStyle = "#f0b949";
            context.beginPath();
            context.arc(320, 330, 230, 0, Math.PI * 2);
            context.fill();
            context.fillStyle = "#17121b";
            context.fillRect(190, 220, 72, 48);
            context.fillRect(378, 220, 72, 48);
            context.fillStyle = "#df375f";
            context.fillRect(230, 430, 180, 52);
            const stream = source.captureStream(12);
            const track = stream.getVideoTracks()[0];
            camera.source = source;
            camera.tracks.push(track);
            track.requestFrame?.();
            return stream;
          },
        },
      });
    });
  });

  test("asks only after Start, releases the camera at Freeze, and keeps the skin in this tab", async ({ page }) => {
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto("/hiccup-head.html");
    await expect(page.locator("#visualSkinSelect option")).toHaveCount(6);
    await expect.poll(() => page.evaluate(() => globalThis.__hiccupHeadCameraTest.calls.length)).toBe(0);

    await page.locator("#playButton").click();
    await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true", { timeout: 10_000 });

    await page.locator("#openWebcamSkinButton").click();
    await expect(page.locator("#webcamSkinDialog")).toBeVisible();
    await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#webcamSkinPrivacy")).toContainText("never uploaded or saved");
    expect(await page.evaluate(() => globalThis.__hiccupHeadCameraTest.calls.length)).toBe(0);

    await page.locator("#startWebcamButton").click();
    await expect(page.locator("#webcamSkinStatus")).toContainText("Move the outlines");
    const constraints = await page.evaluate(() => globalThis.__hiccupHeadCameraTest.calls[0]);
    expect(constraints.audio).toBe(false);
    expect(constraints.video.facingMode.ideal).toBe("user");
    await expect(page.locator("#webcamSkinVideo")).toBeVisible();
    await page.locator('[data-webcam-guide="nose"]').click();
    await expect(page.locator("#webcamGuideSelect")).toHaveValue("nose");

    await page.locator("#freezeWebcamButton").click();
    await expect(page.locator("#webcamSkinStatus")).toContainText("camera off");
    await expect(page.locator("#webcamSkinFrame")).toBeVisible();
    await expect(page.locator("#useWebcamSkinButton")).toBeVisible();
    expect(await page.evaluate(() => globalThis.__hiccupHeadCameraTest.tracks[0].readyState)).toBe("ended");

    await page.locator("#webcamGuideSelect").selectOption("mouth");
    await page.locator("#webcamGuideSize").fill("128");
    await page.locator("#useWebcamSkinButton").click();
    await expect(page.locator("#webcamSkinDialog")).not.toBeVisible();
    await expect(page.locator("#visualSkinSelect option")).toHaveCount(7);
    await expect(page.locator("#visualSkinSelect")).toHaveValue("webcam-cutup");
    await expect(page.locator("#stage")).toHaveAttribute("data-visual-skin", "webcam-cutup");

    await page.locator("#playButton").click();
    await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true", { timeout: 10_000 });
    await page.locator("#playButton").click();
    await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");

    await page.reload();
    await expect(page.locator("#visualSkinSelect option")).toHaveCount(6);
    await expect(page.locator("#visualSkinSelect")).toHaveValue("checker");
    expect(pageErrors).toEqual([]);
  });
});


// This uses real canvas MediaStreams and decoded video frames. The only camera
// replacement is getUserMedia; neither video.play nor drawImage is stubbed.
const PARTS = ["leftEar", "rightEar", "leftEye", "rightEye", "nose", "hair", "head"];
const LABELS = ["Left ear", "Right ear", "Left eye", "Right eye", "Nose", "Hair", "Face"];
const COLORS = [
  [224, 40, 56], [36, 194, 78], [46, 86, 224], [230, 190, 34],
  [192, 44, 205], [34, 197, 204], [208, 126, 70],
];
const RETAKE_COLOR = [116, 67, 210];
// Existing 4x4 skin-atlas layout, in renderer order.
const CELL_PARTS = [
  "head", "leftEye", "rightEye", "hair",
  "nose", "head", "head", "head",
  "leftEar", "rightEar", "hair", "head",
  "head", "hair", "hair", "head",
];

async function installCamera(page) {
  await page.addInitScript(() => {
    const camera = {
      calls: [], tracks: [], pending: [], source: null,
      deferNext: false, atlases: [], stageAtlas: -1,
    };
    Object.defineProperty(globalThis, "__hiccupHeadCameraTest", {
      configurable: true, value: camera,
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        async getUserMedia(constraints) {
          camera.calls.push(constraints);
          const source = document.createElement("canvas");
          source.width = 640;
          source.height = 640;
          const context = source.getContext("2d");
          context.fillStyle = "rgb(48, 82, 120)";
          context.fillRect(0, 0, source.width, source.height);
          const stream = source.captureStream(12);
          const track = stream.getVideoTracks()[0];
          camera.source = source;
          camera.tracks.push(track);
          track.requestFrame?.();
          if (camera.deferNext) {
            camera.deferNext = false;
            await new Promise((resolve) => camera.pending.push({ resolve, track }));
          }
          return stream;
        },
      },
    });

    // Observe the real final atlas without adding production-only test hooks.
    // Frozen photos are 640/720px; the disconnected 4x4 atlas is 768/1024px.
    // Retained feature canvases are cleared after Apply, but the atlas survives.
    const drawImage = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (source, ...args) {
      const result = drawImage.call(this, source, ...args);
      const destination = this.canvas;
      if (
        source instanceof HTMLCanvasElement &&
        [640, 720].includes(source.width) &&
        source.width === source.height &&
        !destination.isConnected &&
        [768, 1024].includes(destination.width) &&
        destination.width === destination.height &&
        !camera.atlases.includes(destination)
      ) {
        camera.atlases.push(destination);
      }
      if (destination.id === "stage" && camera.atlases.includes(source)) {
        camera.stageAtlas = camera.atlases.indexOf(source);
      }
      return result;
    };
  });
}

async function openBooth(page) {
  await page.locator("#openWebcamSkinButton").click();
  await expect(page.locator("#webcamSkinDialog")).toBeVisible();
}

async function expectTracksEnded(page) {
  await expect.poll(() => page.evaluate(() => (
    globalThis.__hiccupHeadCameraTest.tracks.every((track) => track.readyState === "ended")
  ))).toBe(true);
}

function expectRgb(actual, expected, label) {
  expect(actual, label).toHaveLength(4);
  // Canvas capture may round RGB through the browser's video color conversion.
  for (let channel = 0; channel < 3; channel += 1) {
    expect(Math.abs(actual[channel] - expected[channel]), label + " channel " + channel)
      .toBeLessThanOrEqual(5);
  }
  expect(actual[3], label + " opacity").toBe(255);
}

async function frozenRgb(page) {
  return page.locator("#webcamSkinFrame").evaluate((frame) => (
    Array.from(frame.getContext("2d").getImageData(
      Math.floor(frame.width / 2), Math.floor(frame.height / 2), 1, 1,
    ).data)
  ));
}

async function captureColor(page, rgb) {
  await expect(page.locator("#freezeWebcamButton")).toBeVisible();
  await expect(page.locator("#freezeWebcamButton")).toBeEnabled();
  await page.evaluate((color) => {
    const camera = globalThis.__hiccupHeadCameraTest;
    const source = camera.source;
    const context = source.getContext("2d");
    context.fillStyle = "rgb(" + color.join(",") + ")";
    context.fillRect(0, 0, source.width, source.height);
    camera.tracks.at(-1).requestFrame?.();
  }, rgb);
  // A requested frame is asynchronous. Sample the decoded video, rather than
  // waiting a fixed delay and accidentally freezing the preceding feature.
  await expect.poll(() => page.evaluate((color) => {
    const video = document.getElementById("webcamSkinVideo");
    if (video.readyState < 2 || !video.videoWidth) return 255;
    const sample = document.createElement("canvas");
    sample.width = sample.height = 1;
    const context = sample.getContext("2d");
    context.drawImage(video, 0, 0, 1, 1);
    const pixel = context.getImageData(0, 0, 1, 1).data;
    return Math.max(...color.map((value, channel) => Math.abs(pixel[channel] - value)));
  }, rgb)).toBeLessThanOrEqual(5);
  await page.locator("#freezeWebcamButton").click();
  await expect(page.locator("#webcamSkinFrame")).toBeVisible();
  await expect(page.locator("#webcamSkinStatus")).toContainText("camera off");
  await expectTracksEnded(page);
  expectRgb(await frozenRgb(page), rgb, "frozen frame");
}

async function atlasPixels(page) {
  return page.evaluate(() => {
    const atlases = globalThis.__hiccupHeadCameraTest.atlases;
    return atlases.map((atlas) => {
      const cell = atlas.width / 4;
      const context = atlas.getContext("2d");
      return Array.from({ length: 16 }, (_, index) => (
        Array.from(context.getImageData(
          Math.floor((index % 4 + 0.5) * cell),
          Math.floor((Math.floor(index / 4) + 0.5) * cell),
          1, 1,
        ).data)
      ));
    });
  });
}

async function expectActivePart(page, index) {
  const id = PARTS[index];
  await expect(page.locator("#freezeWebcamButton")).toBeVisible();
  await expect(page.locator('[data-webcam-part="' + id + '"]')).toHaveAttribute("aria-current", "true");
  await expect(page.locator("#webcamSkinStatus")).toContainText(LABELS[index]);
  await expect(page.locator("#webcamSkinStatus")).toContainText((index + 1) + " / 7");
  await expect(page.locator("[data-webcam-guide]:visible")).toHaveCount(1);
  await expect(page.locator("[data-webcam-guide]:visible")).toHaveAttribute("data-webcam-guide", id);
  await expect(page.locator("#useWebcamSkinButton")).toBeHidden();
}

async function expectEmptyDraft(page) {
  await expect(page.locator("[data-webcam-part]:enabled")).toHaveCount(0);
  await expect(page.locator("#webcamSkinFrame")).toBeHidden();
  await expect(page.locator("#useWebcamSkinButton")).toBeHidden();
}

async function releasePendingCamera(page) {
  await page.evaluate(() => {
    const pending = globalThis.__hiccupHeadCameraTest.pending.shift();
    if (!pending) throw new Error("Expected a pending camera request");
    pending.resolve();
  });
  await expectTracksEnded(page);
}

async function deferCameraAndStart(page) {
  await page.evaluate(() => { globalThis.__hiccupHeadCameraTest.deferNext = true; });
  await page.locator("#startWebcamButton").click();
  await expect.poll(() => page.evaluate(() => (
    globalThis.__hiccupHeadCameraTest.pending.length
  ))).toBe(1);
}

test.describe("Hiccup Head webcam capture modes", () => {
  test.setTimeout(60_000);
  test.beforeEach(async ({ page }) => {
    await installCamera(page);
    await page.goto("/hiccup-head.html");
  });

  test("one photo maps every part, releases the camera, and remains session-only", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    // Exercise the real silence boundary with both audio and transport active.
    await page.locator("#audioButton").click();
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
    await page.locator("#playButton").click();
    await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
    await openBooth(page);
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("radio", { name: "One photo", exact: true })).toBeChecked();
    await expect(page.getByRole("radio", { name: "Feature by feature", exact: true })).not.toBeChecked();
    await expect(page.locator("#webcamSkinPrivacy")).toContainText("never uploaded or saved");
    expect(await page.evaluate(() => globalThis.__hiccupHeadCameraTest.calls.length)).toBe(0);
    await expect(page.locator("#visualSkinSelect option")).toHaveCount(6);

    await page.locator("#startWebcamButton").click();
    await captureColor(page, COLORS[0]);
    const constraints = await page.evaluate(() => globalThis.__hiccupHeadCameraTest.calls[0]);
    expect(constraints.audio).toBe(false);
    expect(constraints.video.facingMode.ideal).toBe("user");
    // No guide changes: one frozen photo must supply every anatomical cell.
    await page.locator("#useWebcamSkinButton").click();
    await expect(page.locator("#webcamSkinDialog")).toBeHidden();
    await expect(page.locator("#visualSkinSelect")).toHaveValue("webcam-cutup");
    await expect(page.locator("#stage")).toHaveAttribute("data-visual-skin", "webcam-cutup");
    const atlases = await atlasPixels(page);
    expect(atlases).toHaveLength(1);
    atlases[0].forEach((pixel, index) => expectRgb(pixel, COLORS[0], "atlas cell " + index));
    expect(await page.evaluate(() => globalThis.__hiccupHeadCameraTest.calls.length)).toBe(1);
    await expectTracksEnded(page);

    await page.reload();
    await expect(page.locator("#visualSkinSelect option")).toHaveCount(6);
    await expect(page.locator("#visualSkinSelect")).toHaveValue("checker");
    expect(errors).toEqual([]);
  });

  test("seven captures keep independent pixels and retaking an ear preserves the others", async ({ page }) => {
    await openBooth(page);
    await page.getByRole("radio", { name: "Feature by feature", exact: true }).check();
    expect(await page.locator("[data-webcam-part]").evaluateAll((buttons) => (
      buttons.map((button) => button.dataset.webcamPart)
    ))).toEqual(PARTS);
    await expectEmptyDraft(page);
    await page.locator("#startWebcamButton").click();

    for (let index = 0; index < PARTS.length; index += 1) {
      await expectActivePart(page, index);
      if (index === 2) {
        // A completed step restores its own frame and stops the in-flight
        // next camera. Retake must replace only that feature's saved photo.
        await page.locator('[data-webcam-part="leftEar"]').click();
        await expectTracksEnded(page);
        await expect(page.locator("#webcamSkinFrame")).toBeVisible();
        expectRgb(await frozenRgb(page), COLORS[0], "restored left ear");
        await page.locator("#retakeWebcamButton").click();
        await captureColor(page, RETAKE_COLOR);
        await page.locator("#useWebcamSkinButton").click();
        await expect(page.locator('[data-webcam-part="rightEar"]')).toBeEnabled();
        await expectActivePart(page, index);
      }
      await captureColor(page, COLORS[index]);
      if (index < PARTS.length - 1) {
        await expect(page.locator("#useWebcamSkinButton")).toContainText("next");
      } else {
        await expect(page.locator("#useWebcamSkinButton")).toHaveText("Use as visual skin");
      }
      // The unfinished draft must never replace the instrument's current skin.
      await expect(page.locator("#visualSkinSelect")).toHaveValue("checker");
      await expect(page.locator('#visualSkinSelect option[value="webcam-cutup"]')).toHaveCount(0);
      await page.locator("#useWebcamSkinButton").click();
      if (index < PARTS.length - 1) {
        await expect(page.locator("#webcamSkinDialog")).toBeVisible();
        await expect(page.locator('[data-webcam-part="' + PARTS[index] + '"]')).toBeEnabled();
      }
    }

    await expect(page.locator("#webcamSkinDialog")).toBeHidden();
    await expect(page.locator("#visualSkinSelect")).toHaveValue("webcam-cutup");
    await expectTracksEnded(page);
    const atlases = await atlasPixels(page);
    expect(atlases).toHaveLength(1);
    const expected = Object.fromEntries(PARTS.map((part, index) => [part, COLORS[index]]));
    expected.leftEar = RETAKE_COLOR;
    CELL_PARTS.forEach((part, index) => {
      expectRgb(atlases[0][index], expected[part], "atlas cell " + index + " from " + part);
    });
  });

  test("switching mode and closing discard drafts and stop stale requests without replacing the applied face", async ({ page }) => {
    await openBooth(page);
    await page.locator("#startWebcamButton").click();
    await captureColor(page, COLORS[6]);
    await page.locator("#useWebcamSkinButton").click();
    await expect(page.locator("#webcamSkinDialog")).toBeHidden();
    const appliedPixels = await atlasPixels(page);
    expect(appliedPixels).toHaveLength(1);

    await openBooth(page);
    await page.getByRole("radio", { name: "Feature by feature", exact: true }).check();
    await page.locator("#startWebcamButton").click();
    await captureColor(page, COLORS[0]);
    await page.locator("#useWebcamSkinButton").click();
    await expectActivePart(page, 1);
    // Switching mode with a completed feature and a live next capture must
    // release the camera and discard both portions of the unfinished draft.
    await page.getByRole("radio", { name: "One photo", exact: true }).check();
    await expectTracksEnded(page);
    await page.getByRole("radio", { name: "Feature by feature", exact: true }).check();
    await expectEmptyDraft(page);

    // Resolve a permission request after its originating mode was abandoned.
    await deferCameraAndStart(page);
    await page.getByRole("radio", { name: "One photo", exact: true }).check();
    await releasePendingCamera(page);
    await expect(page.locator("#webcamSkinVideo")).toBeHidden();
    await expect(page.locator("#freezeWebcamButton")).toBeHidden();
    await expect(page.locator("#startWebcamButton")).toBeEnabled();

    // Closing and reopening before resolution catches generation bugs that a
    // simple "is the dialog open?" check would miss.
    await deferCameraAndStart(page);
    await page.locator("#closeWebcamSkinButton").click();
    await expect(page.locator("#webcamSkinDialog")).toBeHidden();
    await openBooth(page);
    await releasePendingCamera(page);
    await expect(page.locator("#webcamSkinVideo")).toBeHidden();
    await expect(page.locator("#freezeWebcamButton")).toBeHidden();

    // A fresh request still works, and closing also forgets accepted parts.
    await page.getByRole("radio", { name: "Feature by feature", exact: true }).check();
    await page.locator("#startWebcamButton").click();
    await expectActivePart(page, 0);
    await captureColor(page, COLORS[1]);
    await page.locator("#useWebcamSkinButton").click();
    await expectActivePart(page, 1);
    await page.locator("#closeWebcamSkinButton").click();
    await expectTracksEnded(page);
    await openBooth(page);
    await expectEmptyDraft(page);
    await expect(page.locator("#visualSkinSelect")).toHaveValue("webcam-cutup");
    await expect(page.locator("#stage")).toHaveAttribute("data-visual-skin", "webcam-cutup");
    expect(await atlasPixels(page)).toEqual(appliedPixels);
    await page.locator("#closeWebcamSkinButton").click();
    await page.locator("#stage").scrollIntoViewIfNeeded();
    // The original atlas must still be the source actually drawn on stage.
    await expect.poll(() => page.evaluate(() => (
      globalThis.__hiccupHeadCameraTest.stageAtlas
    ))).toBe(0);
  });
});

test("a tiny feature crop preserves its source region through resize and retake", async ({ page }) => {
  await installCamera(page);
  await page.goto("/hiccup-head.html");
  await openBooth(page);
  await expect(page.locator("#webcamGuideSize")).toHaveAttribute("min", "60");
  await page.getByRole("radio", { name: "Feature by feature", exact: true }).check();
  await expect(page.locator("#webcamGuideSize")).toHaveAttribute("min", "5");
  await expect(page.locator("#webcamGuideSize")).toHaveValue("25");

  const ear = page.locator('[data-webcam-guide="leftEar"]');
  const background = [48, 82, 120];
  const cropSnapshot = () => ear.evaluate((guide) => {
    const fraction = (property) => parseFloat(guide.style[property]) / 100;
    const width = fraction("width"), height = fraction("height");
    return {
      x: fraction("left") + width / 2,
      y: fraction("top") + height / 2,
      width, height,
    };
  });
  const expectTinyCrop = async () => {
    await expect(page.locator("#webcamGuideSize")).toHaveValue("5");
    await expect(page.locator("#webcamGuideSizeOut")).toHaveText("5%");
    const crop = await cropSnapshot();
    expect(crop.x).toBeCloseTo(0.5, 7);
    expect(crop.y).toBeCloseTo(0.5, 7);
    expect(crop.width).toBeCloseTo(0.021, 7);
    expect(crop.height).toBeCloseTo(0.0325, 7);
  };
  const expectExpandedHitTarget = async () => {
    await ear.scrollIntoViewIfNeeded();
    const target = await ear.evaluate((guide) => {
      const rect = guide.getBoundingClientRect();
      // This point is outside the tiny visible crop but within its 44px target.
      const x = rect.left + rect.width / 2 + 18;
      const y = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(x, y);
      return {
        width: rect.width, height: rect.height,
        outsideOutline: x > rect.right,
        hitsGuide: hit === guide || guide.contains(hit),
      };
    });
    expect(target.width).toBeLessThan(36);
    expect(target.height).toBeLessThan(44);
    expect(target.outsideOutline).toBe(true);
    expect(target.hitsGuide).toBe(true);
  };
  const capturePatch = async (color) => {
    await expect(page.locator("#freezeWebcamButton")).toBeVisible();
    await expect(page.locator("#freezeWebcamButton")).toBeEnabled();
    await page.evaluate(({ color, background }) => {
      const camera = globalThis.__hiccupHeadCameraTest;
      const source = camera.source;
      const context = source.getContext("2d");
      context.fillStyle = "rgb(" + background.join(",") + ")";
      context.fillRect(0, 0, source.width, source.height);
      context.fillStyle = "rgb(" + color.join(",") + ")";
      context.fillRect(312, 312, 16, 16);
      camera.tracks.at(-1).requestFrame?.();
    }, { color, background });

    // Sample actual decoded source pixels. Downsampling the whole video to 1px
    // would blend away the small marker, unlike the solid-color helper.
    await expect.poll(() => page.evaluate(({ color, background }) => {
      const video = document.getElementById("webcamSkinVideo");
      if (video.readyState < 2 || !video.videoWidth) return 255;
      const sample = document.createElement("canvas");
      sample.width = sample.height = 1;
      const context = sample.getContext("2d");
      const sampleAt = (x, y) => {
        context.drawImage(video, x, y, 1, 1, 0, 0, 1, 1);
        return context.getImageData(0, 0, 1, 1).data;
      };
      const center = sampleAt(Math.floor(video.videoWidth / 2), Math.floor(video.videoHeight / 2));
      const outside = sampleAt(Math.floor(video.videoWidth / 4), Math.floor(video.videoHeight / 2));
      return Math.max(
        ...color.map((value, channel) => Math.abs(center[channel] - value)),
        ...background.map((value, channel) => Math.abs(outside[channel] - value)),
      );
    }, { color, background })).toBeLessThanOrEqual(5);
    await page.locator("#freezeWebcamButton").click();
    await expect(page.locator("#webcamSkinFrame")).toBeVisible();
    await expectTracksEnded(page);
    expectRgb(await frozenRgb(page), color, "small patch in frozen frame");
  };

  await page.locator("#startWebcamButton").click();
  await expectActivePart(page, 0);
  await page.locator("#webcamGuideSize").fill("5");
  await expectTinyCrop();
  await expectExpandedHitTarget();
  await capturePatch(COLORS[0]);
  await page.locator("#useWebcamSkinButton").click();
  await expectActivePart(page, 1);

  // The first saved frame is desktop-sized; its retake will be phone-sized.
  // Neither the resized preview nor switching saved frames may enlarge its crop.
  await page.setViewportSize({ width: 390, height: 844 });
  await captureColor(page, COLORS[1]);
  await page.locator("#useWebcamSkinButton").click();
  await expectActivePart(page, 2);
  await page.locator('[data-webcam-part="leftEar"]').click();
  await expectTracksEnded(page);
  await expectTinyCrop();
  await expectExpandedHitTarget();
  expectRgb(await frozenRgb(page), COLORS[0], "restored small-patch frame");

  await page.locator("#retakeWebcamButton").click();
  await expectActivePart(page, 0);
  await expectTinyCrop();
  await capturePatch(RETAKE_COLOR);
  await expectTinyCrop();
  await page.locator("#useWebcamSkinButton").click();
  for (let index = 2; index < PARTS.length; index += 1) {
    await expectActivePart(page, index);
    await captureColor(page, COLORS[index]);
    await page.locator("#useWebcamSkinButton").click();
  }
  await expect(page.locator("#webcamSkinDialog")).toBeHidden();
  await expect(page.locator("#visualSkinSelect")).toHaveValue("webcam-cutup");
  await expectTracksEnded(page);

  const atlases = await atlasPixels(page);
  expect(atlases).toHaveLength(1);
  expectRgb(atlases[0][9], COLORS[1], "right ear preserved during left-ear retake");
  const samples = await page.evaluate(() => {
    const atlas = globalThis.__hiccupHeadCameraTest.atlases[0];
    const context = atlas.getContext("2d");
    const cell = atlas.width / 4;
    // Left-ear cell 8 is column 0, row 2. All samples are inside its ellipse.
    // Center-only would still pass if a 44px or .04 floor enlarged the crop.
    return [[0.12, 0.5], [0.3, 0.5], [0.5, 0.5], [0.7, 0.5], [0.88, 0.5],
      [0.5, 0.3], [0.5, 0.7]].map(([x, y]) => Array.from(
      context.getImageData(Math.floor(x * cell), Math.floor((2 + y) * cell), 1, 1).data,
    ));
  });
  samples.forEach((pixel, index) => {
    expectRgb(pixel, RETAKE_COLOR, "tiny source patch at ear atlas sample " + index);
  });
});
