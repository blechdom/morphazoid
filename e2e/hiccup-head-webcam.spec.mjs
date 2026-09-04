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
