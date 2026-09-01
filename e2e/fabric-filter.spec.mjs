import { expect, test } from "@playwright/test";

test.use({ reducedMotion: "no-preference" });

async function installFabricRecorder(page, { audioDelay = 0 } = {}) {
  await page.addInitScript(({ delayedResume }) => {
    if (delayedResume > 0) {
      const AudioContextConstructor = globalThis.AudioContext
        ?? globalThis.webkitAudioContext;
      const prototype = AudioContextConstructor?.prototype;
      const originalResume = prototype?.resume;
      if (typeof originalResume === "function") {
        prototype.resume = function delayedAudioResume(...args) {
          return new Promise((resolve) => {
            globalThis.setTimeout(resolve, delayedResume);
          }).then(() => originalResume.apply(this, args));
        };
      }
    }
    const prototype = CanvasRenderingContext2D.prototype;
    const original = {
      beginPath: prototype.beginPath,
      clearRect: prototype.clearRect,
      lineTo: prototype.lineTo,
      moveTo: prototype.moveTo,
      stroke: prototype.stroke,
    };
    let currentPath = [];
    let frameSerial = 0;
    globalThis.__fabricGridFrames = [];
    prototype.clearRect = function patchedClearRect(...args) {
      if (this.canvas?.id === "stage") {
        frameSerial += 1;
        globalThis.__fabricGridFrames.push({ serial: frameSerial, paths: [] });
        if (globalThis.__fabricGridFrames.length > 90) {
          globalThis.__fabricGridFrames.splice(0, 30);
        }
      }
      return original.clearRect.apply(this, args);
    };
    prototype.beginPath = function patchedBeginPath(...args) {
      if (this.canvas?.id === "stage") currentPath = [];
      return original.beginPath.apply(this, args);
    };
    prototype.moveTo = function patchedMoveTo(x, y, ...args) {
      if (this.canvas?.id === "stage") currentPath.push([x, y]);
      return original.moveTo.call(this, x, y, ...args);
    };
    prototype.lineTo = function patchedLineTo(x, y, ...args) {
      if (this.canvas?.id === "stage") currentPath.push([x, y]);
      return original.lineTo.call(this, x, y, ...args);
    };
    prototype.stroke = function patchedStroke(...args) {
      if (
        this.canvas?.id === "stage"
        && (this.strokeStyle === "#68f7a4" || this.strokeStyle === "#ff5cad")
      ) {
        const frame = globalThis.__fabricGridFrames.at(-1);
        frame?.paths.push({
          color: this.strokeStyle,
          points: currentPath.map(([x, y]) => [Number(x), Number(y)]),
        });
      }
      return original.stroke.apply(this, args);
    };
  }, { delayedResume: audioDelay });
}

async function readAnchorVertex(page) {
  return page.evaluate(() => {
    const frames = globalThis.__fabricGridFrames ?? [];
    const completed = frames.filter((frame) => (
      frame.paths.filter(({ color }) => color === "#68f7a4").length >= 29
    ));
    const frame = completed.at(-1);
    const columns = frame?.paths.filter(({ color }) => color === "#68f7a4");
    const centerColumn = columns?.[14];
    const point = centerColumn?.points?.[20];
    return point ? { serial: frame.serial, x: point[0], y: point[1] } : null;
  });
}

async function readAnchorVerticesAfter(page, serial) {
  return page.evaluate((minimumSerial) => {
    const frames = globalThis.__fabricGridFrames ?? [];
    return frames.flatMap((frame) => {
      if (frame.serial <= minimumSerial) return [];
      const columns = frame.paths.filter(({ color }) => color === "#68f7a4");
      const point = columns?.[14]?.points?.[20];
      return point ? [{ serial: frame.serial, x: point[0], y: point[1] }] : [];
    });
  }, serial);
}

async function readLatestGridFrame(page) {
  return page.evaluate(() => {
    const frames = globalThis.__fabricGridFrames ?? [];
    const frame = [...frames].reverse().find((candidate) => (
      candidate.paths.filter(({ color }) => color === "#68f7a4").length >= 29
      && candidate.paths.filter(({ color }) => color === "#ff5cad").length >= 21
    ));
    if (!frame) return null;
    return {
      serial: frame.serial,
      paths: frame.paths
        .filter(({ color }) => color === "#68f7a4" || color === "#ff5cad")
        .map(({ color, points }) => ({ color, points })),
    };
  });
}

function gridRmsDifference(left, right) {
  let squared = 0;
  let count = 0;
  for (let pathIndex = 0; pathIndex < Math.min(left.paths.length, right.paths.length); pathIndex += 1) {
    const leftPath = left.paths[pathIndex];
    const rightPath = right.paths[pathIndex];
    if (leftPath.color !== rightPath.color) continue;
    for (let pointIndex = 0; pointIndex < Math.min(leftPath.points.length, rightPath.points.length); pointIndex += 1) {
      const dx = leftPath.points[pointIndex][0] - rightPath.points[pointIndex][0];
      const dy = leftPath.points[pointIndex][1] - rightPath.points[pointIndex][1];
      squared += dx * dx + dy * dy;
      count += 1;
    }
  }
  return Math.sqrt(squared / Math.max(1, count));
}

test("a released fabric vertex keeps its position and then flops", async ({ page }) => {
  await installFabricRecorder(page);

  await page.goto("/moire-drone.html", { waitUntil: "domcontentloaded" });
  const stage = page.locator("#stage");
  await expect(stage).toBeVisible();
  const box = await stage.boundingBox();
  expect(box).not.toBeNull();

  const anchor = {
    x: box.x + box.width * 0.5,
    y: box.y + box.height * 0.5,
  };
  const pulled = {
    x: anchor.x + box.width * 0.3,
    y: anchor.y + box.height * 0.18,
  };
  await page.mouse.move(anchor.x, anchor.y);
  await page.mouse.down();
  await page.mouse.move(pulled.x, pulled.y, { steps: 8 });
  await page.waitForTimeout(120);

  const held = await readAnchorVertex(page);
  expect(held).not.toBeNull();
  const base = { x: box.width * 0.5, y: box.height * 0.5 };
  const heldOffset = { x: held.x - base.x, y: held.y - base.y };
  const heldMagnitude = Math.hypot(heldOffset.x, heldOffset.y);
  expect(heldMagnitude).toBeGreaterThan(35);
  expect(heldOffset.x).toBeGreaterThan(0);
  expect(heldOffset.y).toBeGreaterThan(0);

  await page.mouse.up();
  await expect.poll(async () => (await readAnchorVertex(page))?.serial ?? -1)
    .toBeGreaterThan(held.serial);
  await page.waitForTimeout(42);
  const releaseFrames = await readAnchorVerticesAfter(page, held.serial);
  expect(releaseFrames.length).toBeGreaterThan(0);
  for (const frame of releaseFrames.slice(0, 3)) {
    const offsetX = frame.x - base.x;
    const offsetY = frame.y - base.y;
    expect(Math.hypot(offsetX, offsetY)).toBeGreaterThan(heldMagnitude * 0.72);
    expect(offsetX * heldOffset.x + offsetY * heldOffset.y).toBeGreaterThan(0);
  }
  const released = releaseFrames[0];
  expect(released).not.toBeNull();
  const releasedOffset = {
    x: released.x - base.x,
    y: released.y - base.y,
  };
  const releasedMagnitude = Math.hypot(releasedOffset.x, releasedOffset.y);
  expect(releasedMagnitude).toBeGreaterThan(heldMagnitude * 0.82);
  expect(releasedOffset.x * heldOffset.x + releasedOffset.y * heldOffset.y)
    .toBeGreaterThan(0);

  await page.waitForTimeout(360);
  const later = await readAnchorVertex(page);
  expect(later).not.toBeNull();
  expect(Math.hypot(later.x - released.x, later.y - released.y)).toBeGreaterThan(3);
});

test("first-use audio startup cannot flatten an already released sheet", async ({ page }) => {
  await installFabricRecorder(page, { audioDelay: 650 });
  await page.goto("/moire-drone.html", { waitUntil: "domcontentloaded" });
  const stage = page.locator("#stage");
  await expect(stage).toBeVisible();
  await page.locator("#fabricDamping").evaluate((element) => {
    element.value = "0";
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const baseline = await readLatestGridFrame(page);
  expect(baseline).not.toBeNull();
  const box = await stage.boundingBox();
  expect(box).not.toBeNull();
  const anchor = {
    x: box.x + box.width * 0.42,
    y: box.y + box.height * 0.46,
  };
  const pulled = {
    x: anchor.x + box.width * 0.36,
    y: anchor.y - box.height * 0.24,
  };
  await page.mouse.move(anchor.x, anchor.y);
  await page.mouse.down();
  await page.mouse.move(pulled.x, pulled.y, { steps: 5 });
  await page.mouse.up();

  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true", {
    timeout: 4_000,
  });
  await page.waitForTimeout(80);
  const afterStartup = await readLatestGridFrame(page);
  expect(afterStartup).not.toBeNull();
  expect(afterStartup.serial).toBeGreaterThan(baseline.serial);
  expect(gridRmsDifference(afterStartup, baseline)).toBeGreaterThan(0.75);
});
