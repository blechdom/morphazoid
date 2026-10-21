import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { SLICE_CELLS } from "../src/instruments/globule-damacy/model.js";
import { pageDiagnosticMessages, watchPageDiagnostics } from "./helpers/diagnostics.mjs";

const count = page => page.locator("#ribbonCount").textContent().then(Number);
const meter = page => page.evaluate(async () => {
  const { getSharedAudioOutputManager } = await import("/src/audio-output-manager.js");
  return getSharedAudioOutputManager().getStatus();
});
const angle = page => page.locator("#turnOut").textContent().then(text => Number(text.match(/\d+/)[0]));

async function paintedGrainCenter(page) {
  // Follow a single, saturated pink grain in the *rendered canvas*, not an
  // internal app state. Chrome imperfections and the fixed straw are less pink.
  return page.locator("#stageCanvas").evaluate(async canvas => {
    await new Promise(requestAnimationFrame);
    const { width, height } = canvas.getBoundingClientRect();
    const scaleX = canvas.width / width, scaleY = canvas.height / height;
    const cx = width * .49, cy = height * .46;
    const radius = Math.min(width * .30, height * .32, 62 * 3.9);
    const image = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
    let count = 0, xsum = 0, ysum = 0;
    for (let y = Math.floor((cy + radius * .1) * scaleY);
      y < Math.ceil((cy + radius * .88) * scaleY); y++) {
      for (let x = Math.floor((cx - radius * .82) * scaleX);
        x < Math.ceil((cx + radius * .82) * scaleX); x++) {
        const index = (y * canvas.width + x) * 4;
        const red = image.data[index], green = image.data[index + 1], blue = image.data[index + 2];
        if (red < 225 || green > 170 || blue < 140 || blue > 220
          || red - green < 85 || blue - green < 35) continue;
        count++;
        xsum += x / scaleX;
        ysum += y / scaleY;
      }
    }
    return { x: xsum / count, y: ysum / count, count };
  });
}

async function hearPeak(page, threshold = .002, timeout = 8000) {
  // A real 70 ms grain can fall entirely between Playwright's default
  // 100/250/500/1000 ms polls; observe the output meter at audio-grain scale.
  const peak = await page.evaluate(async ({ threshold, timeout }) => {
    const { getSharedAudioOutputManager } = await import("/src/audio-output-manager.js");
    const deadline = performance.now() + timeout;
    let loudest = 0;
    while (performance.now() < deadline) {
      loudest = Math.max(loudest, getSharedAudioOutputManager().getStatus().peak);
      if (loudest > threshold) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    return loudest;
  }, { threshold, timeout });
  expect(peak).toBeGreaterThan(threshold);
}

function point(box, phase, lane) {
  const radius = Math.min(62, box.width * .22, box.height * .18);
  const left = radius + 10, right = box.width - left;
  const top = Math.min(130, box.height * .30);
  const bottom = box.height - Math.max(56, radius + 10);
  return { x: box.x + left + phase * (right - left),
    y: box.y + top + (lane + .5) * (bottom - top) / 8 };
}
async function rollAcross(page, from = [.1, 0], to = [.85, 7]) {
  const box = await page.locator("#stageCanvas").boundingBox();
  const start = point(box, ...from), end = point(box, ...to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 18 });
  await page.mouse.up();
}
function wav(frequency = 220, silence = false) {
  const rate = 8000, frames = rate, data = Buffer.alloc(44 + frames * 2);
  data.write("RIFF", 0); data.writeUInt32LE(data.length - 8, 4);
  data.write("WAVEfmt ", 8); data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write("data", 36); data.writeUInt32LE(frames * 2, 40);
  for (let frame = 0; frame < frames; frame++)
    data.writeInt16LE(silence ? 0
      : Math.round(Math.sin(2 * Math.PI * frequency * frame / rate) * 22000), 44 + frame * 2);
  return data;
}

test("black stage carries continuous signed audio waves into the chrome marble", async ({ page }) => {
  await page.goto("/globule-damacy.html");
  const floor = await page.locator("#stageCanvas").evaluate(async canvas => {
    await new Promise(requestAnimationFrame);
    const { width, height } = canvas.getBoundingClientRect();
    const ctx = canvas.getContext("2d");
    const sx = canvas.width / width, sy = canvas.height / height;
    const radius = Math.min(62, width * .22, height * .18);
    const left = radius + 10, right = width - left;
    const top = Math.min(130, height * .30);
    const bottom = height - Math.max(56, radius + 10);
    const row = (bottom - top) / 8, y = top + row * 1.5;
    const pixel = (x, py) => [...ctx.getImageData(
      Math.round(x * sx), Math.round(py * sy), 1, 1).data];
    const inWave = (x, py) => {
      const [red, green, blue] = pixel(x, py);
      return red < 160 && green > 135 && blue > 135;
    };
    let above = 0, below = 0, leftEdge = 0, rightEdge = 0;
    for (let x = left + (right - left) * .25; x < left + (right - left) * .8; x += 2) {
      for (let py = y - row * .34; py < y + row * .34; py += 2) {
        if (!inWave(x, py)) continue;
        if (py < y - 2) above++;
        if (py > y + 2) below++;
      }
    }
    for (let x = 0; x < 20; x++)
      for (let py = y - row * .34; py < y + row * .34; py += 2)
        if (inWave(x, py)) leftEdge++;
    for (let x = width - 20; x < width; x++)
      for (let py = y - row * .34; py < y + row * .34; py += 2)
        if (inWave(x, py)) rightEdge++;
    return { page: getComputedStyle(document.body).backgroundColor,
      stage: getComputedStyle(canvas.parentElement).backgroundColor,
      corner: pixel(width - 10, 10), above, below, leftEdge, rightEdge };
  });
  expect(floor.page).toBe("rgb(0, 0, 0)");
  expect(floor.stage).toBe("rgb(0, 0, 0)");
  expect(floor.corner.slice(0, 3)).toEqual([0, 0, 0]);
  for (const count of [floor.above, floor.below, floor.leftEdge, floor.rightEdge])
    expect(count).toBeGreaterThan(3);

  const marble = await page.evaluate(async () => {
    const { createGlobuleView } = await import("/src/instruments/globule-damacy/view.js");
    const { coordinatesOf, IDENTITY_ORIENTATION } =
      await import("/src/instruments/globule-damacy/model.js");
    const { waveTraceOf } = await import("/src/instruments/globule-damacy/sources.js");
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "position:fixed;left:-1100px;top:0;width:700px;height:600px";
    document.body.append(canvas);
    try {
      const view = createGlobuleView(canvas);
      const orientation = IDENTITY_ORIENTATION, cx = 700 * .49, cy = 600 * .46;
      const radius = Math.min(700 * .30, 600 * .32, 62 * 3.9);
      const normal = [-.45, .3, Math.sqrt(1 - .45 ** 2 - .3 ** 2)];
      const zone = { key: 1299, sourceIndex: 0, normal, ...coordinatesOf(normal),
        angularRadius: .046, latitudeRadius: .84, tilt: .24, shapeSeed: .2 };
      const frame = { mode: "play", sources: [], ribbons: [],
        orientation, phase: 0, needle: 3.5, wander: 0, needleWidth: 0,
        playPose: orientation };
      const ctx = canvas.getContext("2d");
      const pixel = (x, y) => [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3);
      view.render(frame);
      const shades = [];
      for (let y = cy - radius * .6; y <= cy + radius * .6; y += 13)
        for (let x = cx - radius * .7; x <= cx - radius * .2; x += 13) {
          const [red, green, blue] = pixel(Math.round(x), Math.round(y));
          shades.push({ light: (red + green + blue) / 3,
            spread: Math.max(red, green, blue) - Math.min(red, green, blue) });
        }
      const crop = () => ctx.getImageData(
        Math.round(cx - radius * .66), Math.round(cy - radius * .55),
        Math.round(radius * .46), Math.round(radius * .55)).data;
      const tone = Float32Array.from({ length: 800 }, (_, index) =>
        Math.sin(index * Math.PI / 21) * .85);
      view.render({ ...frame, ribbons: [{ ...zone, waveTrace: waveTraceOf([tone], 8) }] });
      const sounding = crop();
      view.render({ ...frame, ribbons: [{ ...zone, waveTrace: new Float32Array(16) }] });
      const silent = crop();
      let difference = 0;
      for (let index = 0; index < sounding.length; index += 4)
        difference += Math.abs(sounding[index] - silent[index]);
      return { bright: shades.filter(shade => shade.light > 190 && shade.spread < 35).length,
        dark: shades.filter(shade => shade.light < 65).length, difference };
    } finally { canvas.remove(); }
  });
  expect(marble.bright).toBeGreaterThan(10);
  expect(marble.dark).toBeGreaterThan(10);
  expect(marble.difference).toBeGreaterThan(2000,
    "changing only the captured PCM trace must repaint its mark on the same ball");
});

test("newer overlapping grains become transparent; isolated paint and chrome stay put", async ({ page }) => {
  await page.goto("/globule-damacy.html");
  const comparison = await page.evaluate(async () => {
    const { createGlobuleView } = await import("/src/instruments/globule-damacy/view.js");
    const { coordinatesOf, IDENTITY_ORIENTATION } =
      await import("/src/instruments/globule-damacy/model.js");
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "position:fixed;left:-1200px;top:0;width:700px;height:600px";
    document.body.append(canvas);
    try {
      const view = createGlobuleView(canvas);
      const unit = coordinates => {
        const length = Math.hypot(...coordinates);
        return coordinates.map(value => value / length);
      };
      const zone = (key, sourceIndex, normal, pitch) => ({
        key, sourceIndex, normal, ...coordinatesOf(normal),
        angularRadius: .075, latitudeRadius: 1.05, tilt: .1, shapeSeed: .2,
        waveTrace: Float32Array.from({ length: 28 }, (_, i) =>
          Math.sin(i * pitch) * .75),
      });
      const lower = zone(100, 1, unit([-.52, .17, .83]), .78);
      const upper = zone(101, 0, unit([-.62, .26, .74]), 1.44);
      const isolated = zone(102, 0, unit([.7, -.24, .68]), 1.44);
      const frame = { mode: "play", sources: [], ribbons: [],
        orientation: IDENTITY_ORIENTATION, phase: 0, needle: 3.5, wander: 0,
        needleWidth: 0, playPose: IDENTITY_ORIENTATION, layerTransparency: 0 };
      const ctx = canvas.getContext("2d");
      const picture = (ribbons, layerTransparency, mode = "play") => {
        view.render({ ...frame, mode, ribbons, layerTransparency,
          position: { phase: .5, lane: 3.5 } });
        return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      };
      const chrome = picture([], 0);
      const bottom = picture([lower], 0);
      const top = picture([upper], 0);
      const opaque = picture([lower, upper], 0);
      const half = picture([lower, upper], 50);
      const clear = picture([lower, upper], 100);
      const reversed = picture([upper, lower], 100);
      const singleClear = picture([upper], 100);
      const isolatedOpaque = picture([lower, isolated], 0);
      const isolatedClear = picture([lower, isolated], 100);
      const scale = canvas.width / 700, cx = 700 * .49, cy = 600 * .46;
      const distance = (a, b, index) =>
        Math.abs(a[index] - b[index]) + Math.abs(a[index + 1] - b[index + 1])
        + Math.abs(a[index + 2] - b[index + 2]);
      let overlap = 0, exposed = 0, gain = 0, reveal = 0, middle = 0, swapped = 0;
      let exposedFaded = 0, exposedRevealed = 0, isolatedDifference = 0;
      for (let y = Math.floor((cy - 105) * scale); y < (cy + 90) * scale; y++)
        for (let x = Math.floor((cx - 175) * scale); x < (cx - 25) * scale; x++) {
          const pixel = (y * canvas.width + x) * 4;
          const fromBottom = distance(bottom, chrome, pixel);
          const fromTop = distance(top, chrome, pixel);
          if (fromBottom > 38 && fromTop > 38) {
            overlap++;
            gain += distance(opaque, clear, pixel);
            reveal += distance(clear, bottom, pixel);
            middle += distance(half, bottom, pixel);
            swapped += distance(reversed, top, pixel);
          } else if (fromTop > 38 && fromBottom === 0) {
            exposed++;
            exposedFaded += distance(clear, opaque, pixel);
            exposedRevealed += distance(clear, chrome, pixel);
          }
        }
      for (let pixel = 0; pixel < isolatedOpaque.length; pixel += 4)
        isolatedDifference += distance(isolatedOpaque, isolatedClear, pixel)
          + distance(top, singleClear, pixel);
      const record0 = picture([lower, upper], 0, "record");
      const record100 = picture([lower, upper], 100, "record");
      let recordDifference = 0;
      for (let pixel = 0; pixel < record0.length; pixel += 4)
        recordDifference += Math.abs(record0[pixel] - record100[pixel]);
      return { overlap, exposed, gain: gain / overlap, reveal: reveal / overlap,
        middle: middle / overlap, swapped: swapped / overlap, recordDifference,
        exposedFaded: exposedFaded / exposed, exposedRevealed: exposedRevealed / exposed,
        isolatedDifference };
    } finally { canvas.remove(); }
  });
  expect(comparison.isolatedDifference).toBe(0,
    "paint without an older intersecting zone keeps its original look at 100%");
  expect(comparison.overlap).toBeGreaterThan(100);
  expect(comparison.exposed).toBeGreaterThan(50);
  expect(comparison.gain).toBeGreaterThan(20, "the top PCM waveform visibly fades");
  expect(comparison.reveal).toBeLessThan(comparison.gain * .2,
    "100% transparency exposes the lower mark at overlapping pixels");
  expect(comparison.exposedFaded).toBeGreaterThan(20,
    "a translucent grain fades as a whole, even where it extends beyond the crossing");
  expect(comparison.exposedRevealed).toBeLessThan(1,
    "the exposed portion becomes bare chrome at 100%");
  expect(comparison.middle).toBeGreaterThan(comparison.reveal,
    "the midpoint keeps some newer paint above the older mark");
  expect(comparison.middle).toBeLessThan(comparison.gain,
    "the midpoint reveals more of the older mark than 0%");
  expect(comparison.swapped).toBeLessThan(comparison.gain * .2,
    "collection order determines which waveform sits on top");
  expect(comparison.recordDifference).toBeGreaterThan(500,
    "the same spherical overlap is rendered on the Record marble");
});

test("Record opens with a larger marble; a surface spot rolls sideways, not around the screen", async ({ page }) => {
  await page.goto("/globule-damacy.html");
  const sampleOldPosition = () => page.locator("#stageCanvas").evaluate(async canvas => {
    await new Promise(requestAnimationFrame);
    const { width, height } = canvas.getBoundingClientRect();
    const radius = Math.min(62, width * .22, height * .18);
    const left = radius + 10, right = width - left;
    const top = Math.min(130, height * .30);
    const bottom = height - Math.max(56, radius + 10);
    const cx = left + .15 * (right - left);
    const cy = top + 4 * (bottom - top) / 8;
    // This point is on the new ball, but was outside the old 44px radius.
    const x = Math.round((cx - 50) * canvas.width / width);
    const y = Math.round((cy - 8) * canvas.height / height);
    return [...canvas.getContext("2d").getImageData(x, y, 1, 1).data];
  });
  const starting = await sampleOldPosition();
  await page.locator("#mapPhase").fill("0.75");
  await expect.poll(async () => {
    const current = await sampleOldPosition();
    return current.slice(0, 3).reduce((difference, channel, index) =>
      difference + Math.abs(channel - starting[index]), 0);
  }).toBeGreaterThan(30);
  await expect(page.locator("#ribbonCount")).toHaveText("0");

  // Track one luminous grain on the *rendered sphere* with its center held
  // still. A side-on camera would rotate it around the face like a record.
  const motion = await page.evaluate(async () => {
    const { createGlobuleView } = await import("/src/instruments/globule-damacy/view.js");
    const { IDENTITY_ORIENTATION, MARBLE_RADIUS, rollOrientation } =
      await import("/src/instruments/globule-damacy/model.js");
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "position:fixed;left:-1000px;top:0;width:800px;height:600px;visibility:hidden";
    document.body.append(canvas);
    try {
      const view = createGlobuleView(canvas);
      const zone = {
        key: 999, sourceIndex: 6, normal: [0, 1, 0], angle: 0, latitude: 0,
        angularRadius: .07, latitudeRadius: .48, tilt: 0, shapeSeed: .2,
      };
      const frame = {
        mode: "record", sources: [], ribbons: [zone], position: { phase: .5, lane: 3.5 },
        active: null,
      };
      const spot = orientation => {
        view.render({ ...frame, orientation });
        const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
        let count = 0, xsum = 0, ysum = 0;
        for (let y = 270; y < 370; y++)
          for (let x = 345; x < 455; x++) {
            const offset = (y * canvas.width + x) * 4;
            const red = pixels.data[offset], green = pixels.data[offset + 1];
            const blue = pixels.data[offset + 2];
            if (green < 115 || green < red + 16 || green < blue + 23) continue;
            xsum += x; ysum += y; count++;
          }
        return { x: xsum / count, y: ysum / count, count };
      };
      return {
        start: spot(IDENTITY_ORIENTATION),
        right: spot(rollOrientation(IDENTITY_ORIENTATION, 40, 0, MARBLE_RADIUS)),
        left: spot(rollOrientation(IDENTITY_ORIENTATION, -40, 0, MARBLE_RADIUS)),
        down: spot(rollOrientation(IDENTITY_ORIENTATION, 0, 40, MARBLE_RADIUS)),
      };
    } finally { canvas.remove(); }
  });
  for (const { count } of Object.values(motion)) expect(count).toBeGreaterThan(60);
  expect(motion.right.x - motion.start.x).toBeGreaterThan(24);
  expect(motion.left.x - motion.start.x).toBeLessThan(-24);
  expect(Math.abs(motion.right.y - motion.start.y)).toBeLessThan(12);
  expect(motion.down.y - motion.start.y).toBeGreaterThan(24);
  expect(Math.abs(motion.down.x - motion.start.x)).toBeLessThan(12);
});

test("Record rolls one full turn from end to end, even when the floor is already collected", async ({ page }) => {
  test.setTimeout(60_000);
  for (const viewport of [
    { width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/globule-damacy.html");
    await page.locator("#mapPhase").fill("0");
    await page.locator("#mapLane").fill("3");
    const stage = page.locator("#stageCanvas");
    const traverse = async () => {
      await stage.scrollIntoViewIfNeeded();
      const box = await stage.boundingBox();
      const left = point(box, 0, 3), right = point(box, 1, 3);
      await page.mouse.move(left.x, left.y);
      await page.mouse.down();
      await page.mouse.move(right.x + 8, right.y, { steps: 20 });
      await page.mouse.up();
    };
    const atStart = async () => {
      await page.locator("#mapPhase").fill("0");
      await stage.scrollIntoViewIfNeeded();
      await stage.evaluate(() => new Promise(resolve =>
        setTimeout(() => requestAnimationFrame(resolve), 80)));
      return stage.screenshot();
    };
    await traverse();
    await expect(page.locator("#ribbonCount")).toHaveText(String(SLICE_CELLS));
    const once = await atStart();
    await traverse();
    await expect(page.locator("#ribbonCount")).toHaveText(String(SLICE_CELLS));
    expect((await atStart()).equals(once)).toBe(true);
  }
});

test("one ball rolls over all eight source ribbons; cancel, Undo and Clear Ball are atomic", async ({ page, baseURL }) => {
  test.setTimeout(60_000);
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await page.goto("/globule-damacy.html");
  await expect(page.getByRole("heading", { name: "Globule Damacy" })).toBeVisible();
  await expect(page.locator("#sourceLane option")).toHaveCount(8);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  expect((await meter(page)).connectionCount).toBe(0);

  await rollAcross(page);
  const picked = await count(page);
  expect(picked).toBeGreaterThan(12);
  await expect(page.locator("#sourceCount")).toHaveText("8");
  const oldPhase = await page.locator("#mapPhase").inputValue();
  const oldLane = await page.locator("#mapLane").inputValue();
  const box = await page.locator("#stageCanvas").boundingBox();
  const start = point(box, .24, 6), end = point(box, .7, 1);
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  expect(await count(page)).toBeGreaterThan(picked);
  await page.locator("#stageCanvas").dispatchEvent("pointercancel", { pointerId: 1 });
  await page.mouse.up();
  expect(await count(page)).toBe(picked);
  await expect(page.locator("#mapPhase")).toHaveValue(oldPhase);
  await expect(page.locator("#mapLane")).toHaveValue(oldLane);
  await page.locator("#undoButton").click();
  await expect(page.locator("#ribbonCount")).toHaveText("0");
  await expect(page.locator("#sourceCount")).toHaveText("0");
  await expect(page.locator("#undoButton")).toBeDisabled();

  await page.locator("#mapPhase").fill("0.5");
  await page.locator("#mapLane").fill("0");
  await page.locator("#stageCanvas").focus();
  await page.locator("#stageCanvas").press("Enter");
  expect(await count(page)).toBeGreaterThan(0);
  await page.locator("#stageCanvas").press("ArrowRight");
  const beforeClear = await count(page);
  await page.locator("#resetButton").click();
  await expect(page.locator("#ribbonCount")).toHaveText("0");
  await page.locator("#undoButton").click();
  expect(await count(page)).toBe(beforeClear);
  expect((await meter(page)).connectionCount).toBe(0);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("Record and Play are tabs on the same live ball; silent Play, Audio and collage controls stay separate", async ({ page, baseURL }) => {
  test.setTimeout(60_000);
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await page.goto("/globule-damacy.html");
  await rollAcross(page);
  const picked = await count(page);
  await page.locator("#playTab").click();
  await expect(page.locator("#recordControls")).toBeHidden();
  await expect(page.locator("#playControls")).toBeVisible();
  await page.locator("#playButton").click();
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => angle(page)).toBeGreaterThan(3);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  expect((await meter(page)).connectionCount).toBe(0);
  await page.locator("#recordTab").click();
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
  expect(await count(page)).toBe(picked);
  await page.locator("#playTab").click();
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await hearPeak(page);
  await expect(page.locator("#nowReading")).not.toContainText("The ball is empty");

  await page.locator("#spinSpeed").fill("2");
  await page.locator("#scatter").fill("1");
  await page.locator("#needleWidth").fill("85");
  await page.locator("#needle").fill("6.5");
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#spinSpeedOut")).toHaveText("2.00×");
  await expect(page.locator("#scatterOut")).toHaveText("100%");
  await expect(page.locator("#needleWidthOut")).toHaveText("85%");
  await expect(page.locator("#needleOut")).toHaveText("77° south");
  await hearPeak(page);
  await page.locator("#output").fill("0");
  await expect.poll(async () => (await meter(page)).peak, { timeout: 10_000 }).toBeLessThan(.001);
  await page.locator("#output").fill("0.58");
  await hearPeak(page);

  await page.locator("#playButton").click();
  await page.locator("#homeButton").click();
  await expect(page.locator("#turnOut")).toHaveText("0% of roll");
  await page.locator("#playButton").click();
  await expect.poll(() => angle(page)).toBeGreaterThan(23);
  await page.locator("#playButton").click();
  const stopped = await angle(page);
  await page.locator("#directionButton").click();
  await expect(page.locator("#directionButton")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#playButton").click();
  await page.waitForTimeout(280);
  expect(await angle(page)).toBeLessThan(stopped);
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await meter(page)).peak, { timeout: 10_000 }).toBeLessThan(.001);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("Record auditions freshly picked-up PCM with Audio on, without starting Play", async ({ page, baseURL }) => {
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await page.goto("/globule-damacy.html");
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
  await page.locator("#pickButton").click();
  expect(await count(page)).toBeGreaterThan(0);
  expect((await meter(page)).connectionCount).toBe(0);
  await page.locator("#resetButton").click();
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  const peak = await page.evaluate(async () => {
    const { getSharedAudioOutputManager } = await import("/src/audio-output-manager.js");
    document.querySelector("#pickButton").click();
    let loudest = 0;
    for (let index = 0; index < 35; index++) {
      loudest = Math.max(loudest, getSharedAudioOutputManager().getStatus().peak);
      await new Promise(resolve => setTimeout(resolve, 16));
    }
    return loudest;
  });
  expect(peak).toBeGreaterThan(.001);
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#ribbonCount")).not.toHaveText("0");
  await page.locator("#audioButton").click();
  await expect.poll(async () => (await meter(page)).peak).toBeLessThan(.001);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("real Web Audio grains release smoothly and mix 32 full-scale stereo voices without clipping", async ({ page }) => {
  await page.goto("/globule-damacy.html");
  const result = await page.evaluate(async () => {
    const { GlobuleAudio } = await import("/src/instruments/globule-damacy/audio.js");
    const rate = 48000;
    async function render(mode) {
      const context = new OfflineAudioContext(2, Math.round(rate * .25), rate);
      const audio = new GlobuleAudio();
      audio.context = context;
      audio.master = context.createGain();
      audio.master.gain.value = .8;
      audio.master.connect(context.destination);
      // A hot, non-zero-ended sample isolates envelope discontinuities from
      // transients actually present in a user's uploaded recording.
      const stereo = mode === "dense-stereo", dense = mode.startsWith("dense");
      const samples = new Float32Array(800).fill(dense ? 1 : .9);
      const ribbon = { sampleRate: 8000, channels: stereo ? [samples, samples] : [samples] };
      const hit = { ribbon, reverse: false, rate: 1, pan: stereo ? .62 : 0 };
      for (let voice = 0; voice < (dense ? 32 : 1); voice++)
        audio.schedule(hit, .04, 1);
      const pending = mode === "release"
        ? context.suspend(.048).then(() => {
          audio.releaseVoice([...audio.voices][0]);
          return context.resume();
        }) : null;
      const rendering = context.startRendering();
      if (pending) await pending;
      const rendered = (await rendering).getChannelData(stereo ? 1 : 0);
      const maxStep = (from, to) => {
        let largest = 0;
        for (let frame = Math.round(from * rate); frame < Math.round(to * rate); frame++)
          largest = Math.max(largest, Math.abs(rendered[frame] - rendered[frame - 1]));
        return largest;
      };
      let peak = 0;
      for (const sample of rendered) peak = Math.max(peak, Math.abs(sample));
      await audio.close();
      return { peak, attack: maxStep(.041, .046), release: maxStep(.045, .052),
        naturalEnd: maxStep(.134, .144), finite: rendered.every(Number.isFinite) };
    }
    return { normal: await render("normal"), stopped: await render("release"),
      dense: await render("dense"), denseStereo: await render("dense-stereo") };
  });
  expect(Object.values(result).every(scene => scene.finite)).toBe(true);
  expect(result.normal.peak).toBeGreaterThan(.01);
  expect(result.normal.naturalEnd).toBeLessThan(.004);
  expect(result.stopped.release).toBeLessThan(.004);
  expect(result.stopped.release).toBeLessThan(result.normal.attack + .003);
  expect(result.dense.peak).toBeGreaterThan(.1);
  expect(result.dense.peak).toBeLessThan(.99);
  expect(result.denseStereo.peak).toBeGreaterThan(.1);
  expect(result.denseStereo.peak).toBeLessThan(.99);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
});

test("fixed/random Record and Play presets keep the ball, running turn, output and Audio ownership", async ({ page }) => {
  await page.goto("/globule-damacy.html");
  await expect(page.locator("#recordPreset")).toHaveValue("chrome-confetti");
  await expect(page.locator("#grainSpreadField")).toBeHidden();
  await page.locator("#recordPreset").selectOption("afterparty");
  await expect(page.locator("#grainMode")).toHaveValue("random");
  await expect(page.locator("#grainSizeOut")).toHaveText("150 ms");
  await expect(page.locator("#grainSpreadField")).toBeVisible();
  await expect(page.locator("#grainSpreadOut")).toHaveText("±90 ms");
  await page.locator("#grainSpread").fill("40");
  await expect(page.locator("#recordPreset")).toHaveValue("custom");
  await rollAcross(page);
  const picked = await count(page);
  await page.locator("#playTab").click();
  await expect(page.locator("#layerTransparencyOut")).toHaveText("40%");
  await page.locator("#playButton").click();
  await expect.poll(() => angle(page)).toBeGreaterThan(2);
  const before = await angle(page);
  await page.locator("#playPreset").selectOption("backspin");
  const phaseDifference = Math.abs((await angle(page)) - before);
  expect(Math.min(phaseDifference, 100 - phaseDifference)).toBeLessThan(12);
  await expect(page.locator("#spinSpeedOut")).toHaveText("0.77×");
  await expect(page.locator("#layerTransparencyOut")).toHaveText("65%");
  await expect(page.locator("#directionButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#playPreset")).toHaveValue("backspin");
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await page.locator("#audioButton").click();
  await page.locator("#output").fill("0.43");
  await page.locator("#playPreset").selectOption("shattered-neon");
  await expect(page.locator("#playPreset")).toHaveValue("shattered-neon");
  await expect(page.locator("#spinSpeedOut")).toHaveText("1.60×");
  await expect(page.locator("#layerTransparencyOut")).toHaveText("20%");
  await expect(page.locator("#needleWidthOut")).toHaveText("85%");
  await expect(page.locator("#needleOut")).toHaveText("54° south");
  await page.locator("#needleWidth").fill("0");
  await expect(page.locator("#playPreset")).toHaveValue("custom");
  await page.locator("#playPreset").selectOption("shattered-neon");
  await expect(page.locator("#needleWidthOut")).toHaveText("85%");
  await page.locator("#layerTransparency").fill("100");
  await expect(page.locator("#layerTransparencyOut")).toHaveText("100%");
  await expect(page.locator("#playPreset")).toHaveValue("custom");
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#playPreset").selectOption("shattered-neon");
  await expect(page.locator("#layerTransparencyOut")).toHaveText("20%");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#outputOut")).toHaveText("43%");
  await page.locator("#recordTab").click();
  await page.locator("#recordPreset").selectOption("vhs-glitter");
  await expect(page.locator("#grainMode")).toHaveValue("fixed");
  await expect(page.locator("#ribbonCount")).toHaveText(String(picked));
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#playTab").click();
  await expect(page.locator("#layerTransparency")).toHaveValue("20");
  await page.locator("#playButton").click();
  await page.locator("#audioButton").click();
});

test("the stage keeps short instructions and the Morphazoid outlined transport in both modes", async ({ page }) => {
  await page.goto("/globule-damacy.html");
  await expect(page.locator("#recordTab")).toHaveText("Record");
  await expect(page.locator("#playTab")).toHaveText("Play");
  await expect(page.locator("#phaseName")).toHaveText("RECORD");
  await expect(page.locator("#canvasHelp")).toHaveText(
    "Drag the marble across the waves. Tap Audio to hear pickups.");
  const style = await page.evaluate(() => {
    const button = document.querySelector("#playButton");
    return {
      radius: getComputedStyle(button).borderRadius,
      iconFill: getComputedStyle(button.querySelector(".transport-play")).fill,
      titleFont: getComputedStyle(document.querySelector("#globuleTitle")).fontFamily,
    };
  });
  expect(style.radius).toBe("50%");
  expect(style.iconFill).toBe("none");
  expect(style.titleFont).toContain("monospace");
  await page.locator("#playButton").click();
  await expect(page.locator("#playButton .transport-pause")).toBeVisible();
  await page.locator("#playTab").click();
  await expect(page.locator("#phaseName")).toHaveText("PLAY");
  await expect(page.locator("#canvasHelp")).toHaveText(
    "Drag like a trackball; the straw stays still.");
  await expect(page.getByLabel("Orbit tilt · north ↔ south")).toBeVisible();
  await expect(page.getByLabel("Ball sway · drift across patches")).toBeVisible();
  await expect(page.locator("#needleWidth")).toBeVisible();
  await expect(page.locator("#needleOut")).toHaveText("level");
  await expect(page.locator("#playButton .transport-pause")).toBeVisible();
  await page.locator("#playButton").click();
  await expect(page.locator("#playButton .transport-play")).toBeVisible();
});

test("the ribbed straw stays parked while the marble rolls beneath it", async ({ page }) => {
  await page.goto("/globule-damacy.html");
  await page.locator("#playTab").click();
  const sampleCanvas = () => page.evaluate(() => {
    const canvas = document.querySelector("#stageCanvas");
    const { width, height } = canvas.getBoundingClientRect();
    const radius = Math.min(width * .30, height * .32, 62 * 3.9);
    const cx = width * .49, cy = height * .46;
    const scaleX = canvas.width / width, scaleY = canvas.height / height;
    const context = canvas.getContext("2d");
    const pixel = (x, y) => [...context.getImageData(Math.round(x * scaleX),
      Math.round(y * scaleY), 1, 1).data].slice(0, 3);
    // This piece of the turquoise upper tube is beyond the ball's silhouette.
    const upper = pixel(cx + radius * 1.25, cy - radius * .77);
    const paper = pixel(cx + radius * 1.25, cy - radius * .55);
    const patch = context.getImageData(
      Math.round((cx - radius * .65) * scaleX),
      Math.round((cy - radius * .5) * scaleY),
      Math.round(radius * .65 * scaleX),
      Math.round(radius * scaleY),
    ).data;
    let ball = 2166136261;
    for (let index = 0; index < patch.length; index += 20)
      ball = Math.imul(ball ^ patch[index], 16777619) >>> 0;
    return { upper, paper, ball };
  });
  await expect.poll(async () => {
    const { upper, paper } = await sampleCanvas();
    return upper[1] - paper[1];
  }).toBeGreaterThan(55);
  const level = await sampleCanvas();
  expect(level.upper[1] - level.paper[1]).toBeGreaterThan(55,
    "a colored straw segment must exist outside the sphere");
  await page.locator("#needle").fill("0");
  await expect(page.locator("#needleOut")).toHaveText("90° north");
  await expect.poll(async () => (await sampleCanvas()).ball).not.toBe(level.ball);
  const north = await sampleCanvas();
  expect(north.upper).toEqual(level.upper);
  expect(north.ball).not.toBe(level.ball);
  await page.locator("#needle").fill("7");
  await expect(page.locator("#needleOut")).toHaveText("90° south");
  await expect.poll(async () => (await sampleCanvas()).ball).not.toBe(north.ball);
  const south = await sampleCanvas();
  expect(south.upper).toEqual(north.upper);
  expect(south.ball).not.toBe(north.ball);
  await page.locator("#scatter").fill("1");
  await page.locator("#playButton").click();
  await expect.poll(() => angle(page)).toBeGreaterThan(3);
  await page.locator("#playButton").click();
  expect((await sampleCanvas()).upper).toEqual(level.upper);
});

test("needle width enlarges its reading mouth without moving the fixed straw tip", async ({ page }) => {
  await page.goto("/globule-damacy.html");
  await page.locator("#playTab").click();
  const sample = () => page.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    const canvas = document.querySelector("#stageCanvas");
    const { width, height } = canvas.getBoundingClientRect();
    const radius = Math.min(width * .30, height * .32, 62 * 3.9);
    const cx = width * .49, cy = height * .46;
    const footprint = radius * Math.sin(.19);
    const context = canvas.getContext("2d");
    const pixel = (x, y) => [...context.getImageData(
      Math.round(x * canvas.width / width), Math.round(y * canvas.height / height), 1, 1).data];
    return {
      tip: pixel(cx, cy),
      mouthEdge: pixel(cx - footprint, cy),
      beyondMouth: pixel(cx - radius * .28, cy),
      tube: pixel(cx + radius * 1.25, cy - radius * .77),
    };
  });
  await page.locator("#needleWidth").fill("0");
  await expect(page.locator("#needleWidthOut")).toHaveText("0%");
  const fine = await sample();
  await page.locator("#needleWidth").fill("100");
  await expect(page.locator("#needleWidthOut")).toHaveText("100%");
  await expect.poll(async () => {
    const wide = await sample();
    return wide.mouthEdge.slice(0, 3).reduce((sum, channel, index) =>
      sum + Math.abs(channel - fine.mouthEdge[index]), 0);
  }).toBeGreaterThan(30);
  const wide = await sample();
  expect(wide.tip).toEqual(fine.tip);
  expect(wide.beyondMouth).toEqual(fine.beyondMouth);
  expect(wide.tube).toEqual(fine.tube);
  await expect(page.locator("#playPreset")).toHaveValue("custom");
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
});

test("drag-scratching sounds scraps, tilts the marble under the fixed straw, and resumes transport", async ({ page }) => {
  test.setTimeout(45_000);
  await page.goto("/globule-damacy.html");
  await rollAcross(page);
  await page.locator("#playTab").click();
  await page.locator("#audioButton").click();
  await page.locator("#playButton").click();
  await hearPeak(page);
  const box = await page.locator("#stageCanvas").boundingBox();
  await page.mouse.move(box.x + box.width * .4, box.y + box.height * .55);
  await page.mouse.down();
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
  const held = await angle(page);
  await page.mouse.move(box.x + box.width * .63, box.y + box.height * .72, { steps: 10 });
  await expect(page.locator("#needleOut"),
    "the fixed needle and motor controls do not follow the pointer").toHaveText("level");
  expect(await angle(page)).toBe(held);
  await page.mouse.up();
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
  await hearPeak(page);
  await page.locator("#playButton").click();
  await page.locator("#scatter").fill("0");
  const before = await angle(page);
  const frame = () => page.locator("#stageCanvas").evaluate(canvas => {
    const { width, height } = canvas.getBoundingClientRect();
    const ctx = canvas.getContext("2d");
    const x = Math.round(width * .3 * canvas.width / width);
    const y = Math.round(height * .3 * canvas.height / height);
    const pixels = ctx.getImageData(x, y,
      Math.round(width * .25 * canvas.width / width),
      Math.round(height * .34 * canvas.height / height)).data;
    let hash = 2166136261;
    for (let index = 0; index < pixels.length; index += 20)
      hash = Math.imul(hash ^ pixels[index], 16777619) >>> 0;
    return hash;
  });
  const ball = await frame();
  await page.locator("#stageCanvas").focus();
  await page.locator("#stageCanvas").press("ArrowUp");
  await expect.poll(frame).not.toBe(ball);
  await expect(page.locator("#needleOut")).toHaveText("level");
  expect(await angle(page)).toBe(before);
  const up = await frame();
  await page.locator("#stageCanvas").press("ArrowRight");
  await expect.poll(frame).not.toBe(up);
  expect(await angle(page)).toBe(before);
  await page.locator("#stageCanvas").press("Enter");
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
});

test("Play gestures roll visible paint right/down without turning the needle; cancel and Undo recover", async ({ page, baseURL }) => {
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await page.goto("/globule-damacy.html");
  await page.locator("#mapPhase").fill("0.5");
  await page.locator("#mapLane").fill("0");
  await page.locator("#pickButton").click();
  await expect(page.locator("#ribbonCount")).toHaveText("1");
  await page.locator("#playTab").click();
  await page.locator("#scatter").fill("0");
  await page.locator("#needleWidth").fill("0");
  await page.locator("#needle").fill("6.25");
  await page.locator("#homeButton").click();
  const before = await paintedGrainCenter(page);
  expect(before.count).toBeGreaterThan(30);
  const straw = () => page.locator("#stageCanvas").evaluate(canvas => {
    const { width, height } = canvas.getBoundingClientRect();
    const radius = Math.min(width * .30, height * .32, 62 * 3.9);
    const x = Math.round((width * .49 + radius * 1.25) * canvas.width / width);
    const y = Math.round((height * .46 - radius * .77) * canvas.height / height);
    return [...canvas.getContext("2d").getImageData(x, y, 1, 1).data];
  });
  const fixedStraw = await straw();
  const box = await page.locator("#stageCanvas").boundingBox();
  const start = { x: box.x + box.width * .49, y: box.y + box.height * .46 };
  const drag = async (dx, dy) => {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + dx, start.y + dy, { steps: 6 });
    await page.mouse.up();
  };
  await drag(55, 0);
  const right = await paintedGrainCenter(page);
  expect(right.x).toBeGreaterThan(before.x + 18);
  expect(Math.abs(right.y - before.y)).toBeLessThan(17);
  await drag(0, 40);
  const down = await paintedGrainCenter(page);
  expect(down.y).toBeGreaterThan(right.y + 18);
  expect(await straw()).toEqual(fixedStraw);
  await expect(page.locator("#needle")).toHaveValue("6.25");
  await expect(page.locator("#turnOut")).toHaveText("0% of roll");
  expect((await meter(page)).connectionCount).toBe(0);

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x - 35, start.y - 20, { steps: 5 });
  await expect.poll(async () => (await paintedGrainCenter(page)).x).toBeLessThan(down.x - 10);
  await page.locator("#stageCanvas").dispatchEvent("pointercancel", { pointerId: 1 });
  await page.mouse.up();
  await expect.poll(async () => Math.abs((await paintedGrainCenter(page)).x - down.x)).toBeLessThan(2);
  await expect.poll(async () => Math.abs((await paintedGrainCenter(page)).y - down.y)).toBeLessThan(2);

  await page.locator("#stageCanvas").focus();
  await page.locator("#stageCanvas").press("ArrowLeft");
  const left = await paintedGrainCenter(page);
  expect(left.x).toBeLessThan(down.x - 10);
  await page.locator("#stageCanvas").press("ArrowUp");
  const up = await paintedGrainCenter(page);
  expect(up.y).toBeLessThan(left.y - 10);

  await page.locator("#recordTab").click();
  await page.locator("#resetButton").click();
  await expect(page.locator("#ribbonCount")).toHaveText("0");
  await page.locator("#undoButton").click();
  await page.locator("#playTab").click();
  await expect(page.locator("#ribbonCount")).toHaveText("1");
  await expect.poll(async () => Math.abs((await paintedGrainCenter(page)).x - up.x)).toBeLessThan(2);
  await expect.poll(async () => Math.abs((await paintedGrainCenter(page)).y - up.y)).toBeLessThan(2);
  await expect(page.locator("#needle")).toHaveValue("6.25");
  await expect(page.locator("#turnOut")).toHaveText("0% of roll");
  await page.locator("#playButton").click();
  await expect.poll(() => angle(page)).toBeGreaterThan(3);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
  await page.mouse.move(start.x + 25, start.y - 20, { steps: 4 });
  await page.locator("#stageCanvas").dispatchEvent("pointercancel", { pointerId: 1 });
  await page.mouse.up();
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("imported local PCM is heard after pickup and survives replacing its floor source with silence", async ({ page, baseURL }) => {
  test.setTimeout(60_000);
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await page.goto("/globule-damacy.html");
  await page.locator("#sourceInput").setInputFiles({
    name: "own-tone.wav", mimeType: "audio/wav", buffer: wav(),
  });
  await expect(page.locator("#sourceInfo")).toContainText("own-tone.wav");
  await page.locator("#mapPhase").fill("0.5");
  await page.locator("#mapLane").fill("0");
  await page.locator("#pickButton").click();
  await expect(page.locator("#ribbonCount")).toHaveText("1");
  await expect(page.locator("#sourceCount")).toHaveText("1");
  const grain = await page.evaluate(async () => {
    const { IDENTITY_ORIENTATION, PICKUP_REACH, collectSweep } =
      await import("/src/instruments/globule-damacy/model.js");
    const where = { phase: .5, lane: 0 };
    // The first upload refills ribbon 01 as floor placement 8.
    const picked = collectSweep([], where, where, IDENTITY_ORIENTATION, PICKUP_REACH,
      100, [8, 1, 2, 3, 4, 5, 6, 7]).added;
    return { angle: picked[0].angle, latitude: picked[0].latitude };
  });
  expect(grain.latitude).toBeGreaterThan(6.5, "stationary pickup marks the underside pole");

  await page.locator("#sourceInput").setInputFiles({
    name: "replacement-silence.wav", mimeType: "audio/wav", buffer: wav(220, true),
  });
  await expect(page.locator("#sourceInfo")).toContainText("replacement-silence.wav");
  await expect(page.locator("#ribbonCount")).toHaveText("1");
  await page.locator("#playTab").click();
  await page.locator("#scatter").fill("0");
  await page.locator("#needle").fill(grain.latitude > 3.5 ? "0" : "7");
  await page.locator("#audioButton").click();
  await page.locator("#stageCanvas").focus();
  await page.locator("#stageCanvas").press("Enter");
  await expect(page.locator("#nowReading")).toHaveText("Straw has not touched a grain zone yet.");
  expect((await meter(page)).peak).toBeLessThan(.001);
  await page.locator("#needle").fill(grain.latitude.toFixed(2));
  await page.locator("#homeButton").click();
  await page.locator("#stageCanvas").press("Enter");
  await hearPeak(page, .01, 8000);
  await expect(page.locator("#nowReading")).toContainText("own-tone.wav");
  await page.locator("#recordTab").click();
  await page.locator("#sourceInput").setInputFiles({
    name: "invalid.wav", mimeType: "audio/wav", buffer: Buffer.from("not a WAV"),
  });
  await expect(page.locator("#globuleError")).toBeVisible();
  await expect(page.locator("#sourceInfo")).toContainText("replacement-silence.wav");
  await expect(page.locator("#ribbonCount")).toHaveText("1");
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("a silent top grain cannot mute audible PCM buried underneath at either transparency extreme", async ({ page }) => {
  await page.goto("/globule-damacy.html");
  await page.locator("#sourceLane").selectOption("1");
  await page.locator("#mapPhase").fill("0.5");
  await page.locator("#mapLane").fill("1");
  await page.locator("#grainSize").fill("240");
  await page.locator("#pickButton").click();
  await expect(page.locator("#ribbonCount")).toHaveText("1");
  await page.locator("#sourceInput").setInputFiles({
    name: "silent-top.wav", mimeType: "audio/wav", buffer: wav(220, true),
  });
  await expect(page.locator("#sourceInfo")).toContainText("silent-top.wav");
  await page.locator("#pickButton").click();
  await expect(page.locator("#ribbonCount")).toHaveText("2");
  const latitude = await page.evaluate(async () => {
    const { IDENTITY_ORIENTATION, collectSweep } =
      await import("/src/instruments/globule-damacy/model.js");
    const where = { phase: .5, lane: 1 };
    return collectSweep([], where, where, IDENTITY_ORIENTATION, .9, 240).added[0].latitude;
  });
  await page.locator("#playTab").click();
  await page.locator("#scatter").fill("0");
  await page.locator("#needleWidth").fill("100");
  await page.locator("#needle").fill(latitude.toFixed(2));
  await page.locator("#audioButton").click();
  let lastPaint = null;
  for (const transparency of ["100", "0"]) {
    await page.locator("#layerTransparency").fill(transparency);
    await expect(page.locator("#layerTransparencyOut")).toHaveText(`${transparency}%`);
    const paint = await page.locator("#stageCanvas").evaluate(async canvas => {
      await new Promise(requestAnimationFrame);
      const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      let hash = 2166136261;
      for (let pixel = 0; pixel < pixels.length; pixel += 16)
        hash = Math.imul(hash ^ pixels[pixel], 16777619) >>> 0;
      return hash;
    });
    if (lastPaint !== null) expect(paint).not.toBe(lastPaint,
      "the live slider repaints the same stationary ball");
    lastPaint = paint;
    await page.locator("#stageCanvas").focus();
    await page.locator("#stageCanvas").press("Enter");
    await hearPeak(page, .002);
    await expect(page.locator("#contactStatus")).toContainText("2 zones");
    await expect(page.locator("#nowReading")).toContainText("source");
    await page.waitForTimeout(290);
  }
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
  await page.locator("#audioButton").click();
});

test("the marble never fills up: exhaust the floor, lay new samples, and collect again at a new size", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/globule-damacy.html");
  await page.locator("#grainSize").fill("240");
  await expect(page.locator("#grainSizeOut")).toHaveText("240 ms");
  const box = await page.locator("#stageCanvas").boundingBox();
  for (let lane = 0; lane < 8; lane++) {
    const start = point(box, 0, lane), end = point(box, 1, lane);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 4 });
    await page.mouse.up();
  }
  await expect(page.locator("#ribbonCount")).toHaveText("1280");
  await expect(page.locator("#floorRemaining")).toContainText("picked clean");
  const before = await count(page);
  await page.locator("#grainSize").fill("40");
  await expect(page.locator("#grainSizeOut")).toHaveText("40 ms");
  await page.locator("#sampleSelect").selectOption("6");
  await page.locator("#useSampleButton").click();
  await expect(page.locator("#sourceInfo")).toContainText("Wire birds · generated sample");
  await expect(page.locator("#floorRemaining")).toContainText("160 grain places left");
  await page.locator("#mapPhase").fill("0.5");
  await page.locator("#mapLane").fill("0");
  await page.locator("#pickButton").click();
  expect(await count(page)).toBe(before + 1, "old grains stay, new material sticks to the same-size ball");
  await expect(page.locator("#floorRemaining")).toContainText("159 grain places left");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await page.locator("#playTab").click();
  await page.locator("#audioButton").click();
  await page.locator("#playButton").click();
  await hearPeak(page, .002, 10_000);
  await expect(page.locator("#nowReading")).not.toContainText("Straw has not touched");
  await page.locator("#playButton").click();
  await page.locator("#audioButton").click();
  await expect.poll(async () => (await meter(page)).peak).toBeLessThan(.001);
});

test("multiple uploaded tracks fill the floor atomically, even when the sequence wraps", async ({ page }) => {
  await page.goto("/globule-damacy.html");
  await page.locator("#sourceLane").selectOption("7");
  await page.locator("#sourceInput").setInputFiles([
    { name: "ribbon-eight.wav", mimeType: "audio/wav", buffer: wav(230) },
    { name: "ribbon-one.wav", mimeType: "audio/wav", buffer: wav(320) },
    { name: "ribbon-two.wav", mimeType: "audio/wav", buffer: wav(430) },
  ]);
  await expect(page.locator("#sourceInfo")).toContainText("ribbon-eight.wav");
  await expect(page.locator("#sourceLane option").nth(0)).toContainText("ribbon-one.wav");
  await expect(page.locator("#sourceLane option").nth(1)).toContainText("ribbon-two.wav");
  await page.locator("#sourceInput").setInputFiles([
    { name: "would-change.wav", mimeType: "audio/wav", buffer: wav(500) },
    { name: "broken.wav", mimeType: "audio/wav", buffer: Buffer.from("not audio") },
  ]);
  await expect(page.locator("#globuleError")).toBeVisible();
  await expect(page.locator("#sourceInfo")).toContainText("ribbon-eight.wav");
  await expect(page.locator("#sourceLane option").nth(0)).toContainText("ribbon-one.wav");
  await expect(page.locator("#sourceLane option").nth(1)).toContainText("ribbon-two.wav");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
});

test("mic permission, a real decoded take, cancellation and device failure never arm Audio or corrupt the floor", async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(samples => {
    const h = { requests: 0, stops: 0, pending: null, defer: false, deny: false, failRecorder: false };
    h.stream = () => ({
      getTracks() {
        return [{ addEventListener() {}, stop() { h.stops++; } }];
      },
    });
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
      getUserMedia() {
        h.requests++;
        if (h.deny) return Promise.reject(new Error("Microphone denied"));
        if (h.defer) return new Promise(resolve => { h.pending = resolve; });
        return Promise.resolve(h.stream());
      },
    } });
    class Recorder extends EventTarget {
      constructor() {
        super();
        if (h.failRecorder) throw new Error("Recorder unavailable");
        this.state = "inactive";
        this.mimeType = "audio/wav";
      }
      start() { this.state = "recording"; }
      stop() {
        if (this.state === "inactive") return;
        this.state = "inactive";
        queueMicrotask(() => {
          this.dispatchEvent(new MessageEvent("dataavailable", {
            data: new Blob([Uint8Array.from(samples)], { type: "audio/wav" }),
          }));
          this.dispatchEvent(new Event("stop"));
        });
      }
    }
    Object.defineProperty(window, "MediaRecorder", { configurable: true, value: Recorder });
    window.__globuleMic = h;
  }, [...wav(270)]);
  await page.goto("/globule-damacy.html");
  expect(await page.evaluate(() => window.__globuleMic.requests)).toBe(0);
  await page.locator("#sourceLane").selectOption("2");
  await page.evaluate(() => { window.__globuleMic.defer = true; });
  await page.locator("#micButton").click();
  await expect(page.locator("#micStatus")).toContainText("Waiting for microphone permission");
  await page.locator("#micButton").click();
  await expect(page.locator("#micButton")).toContainText("Record mic");
  await page.evaluate(() => {
    window.__globuleMic.pending(window.__globuleMic.stream());
    window.__globuleMic.defer = false;
  });
  await expect.poll(() => page.evaluate(() => window.__globuleMic.stops)).toBe(1);
  await expect(page.locator("#sourceInfo")).toContainText("Paper thunder · generated loop");

  await page.evaluate(() => { window.__globuleMic.deny = true; });
  await page.locator("#micButton").click();
  await expect(page.locator("#globuleError")).toContainText("Microphone denied");
  await expect(page.locator("#sourceInfo")).toContainText("Paper thunder");
  await page.evaluate(() => { window.__globuleMic.deny = false; window.__globuleMic.failRecorder = true; });
  await page.locator("#micButton").click();
  await expect(page.locator("#globuleError")).toContainText("Recorder unavailable");
  await expect.poll(() => page.evaluate(() => window.__globuleMic.stops)).toBe(2);
  await page.evaluate(() => { window.__globuleMic.failRecorder = false; });

  await page.locator("#micButton").click();
  await expect(page.locator("#micButton")).toContainText("Finish mic take");
  expect((await meter(page)).connectionCount).toBe(0);
  await page.locator("#micButton").click();
  await expect(page.locator("#sourceInfo")).toContainText("Mic take 3 · local mic take");
  await expect(page.locator("#micStatus")).toContainText("take laid on ribbon 3");
  await expect.poll(() => page.evaluate(() => window.__globuleMic.stops)).toBe(3);
  await page.locator("#mapPhase").fill("0.5");
  await page.locator("#mapLane").fill("2");
  await page.locator("#pickButton").click();
  expect(await count(page)).toBeGreaterThan(0);
  const micGrain = await page.evaluate(async () => {
    const { IDENTITY_ORIENTATION, PICKUP_REACH, collectSweep } =
      await import("/src/instruments/globule-damacy/model.js");
    const at = { phase: .5, lane: 2 };
    return collectSweep([], at, at, IDENTITY_ORIENTATION, PICKUP_REACH, 100,
      [0, 1, 8, 3, 4, 5, 6, 7]).added.find(grain => grain.sourceIndex === 2).latitude;
  });
  await page.locator("#playTab").click();
  await page.locator("#scatter").fill("0");
  await page.locator("#needle").fill(micGrain.toFixed(2));
  await page.locator("#audioButton").click();
  // This grain sits at the pole: once the needle enters, it can stay inside
  // throughout later turns. Measure the FIRST attack, not a nonexistent
  // retrigger after waiting for the readout to update.
  const micPeak = await page.evaluate(async () => {
    const { getSharedAudioOutputManager } = await import("/src/audio-output-manager.js");
    document.querySelector("#playButton").click();
    let loudest = 0;
    for (let index = 0; index < 90; index++) {
      loudest = Math.max(loudest, getSharedAudioOutputManager().getStatus().peak);
      await new Promise(resolve => setTimeout(resolve, 16));
    }
    return loudest;
  });
  expect(micPeak).toBeGreaterThan(.002);
  await expect(page.locator("#nowReading")).toContainText("Mic take 3", { timeout: 10_000 });
  await page.locator("#playButton").click();
  await page.locator("#audioButton").click();
  await page.locator("#recordTab").click();

  await page.locator("#micButton").click();
  await expect(page.locator("#micButton")).toContainText("Finish mic take");
  await page.locator("#playTab").click();
  await expect.poll(() => page.evaluate(() => window.__globuleMic.stops)).toBe(4);
  await page.locator("#recordTab").click();
  await expect(page.locator("#sourceInfo")).toContainText("Mic take 3");
  await page.locator("#micButton").click();
  await expect(page.locator("#micButton")).toContainText("Finish mic take");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => page.evaluate(() => window.__globuleMic.stops)).toBe(5);
  await expect(page.locator("#sourceInfo")).toContainText("Mic take 3");
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await expect.poll(async () => (await meter(page)).peak).toBeLessThan(.001);
});

test("the stage and controls are unframed; phase and Play indicators stay visible", async ({ page }) => {
  for (const viewport of [
    { width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/globule-damacy.html");
    const styles = await page.evaluate(() => {
      const of = selector => getComputedStyle(document.querySelector(selector));
      const borders = style => [
        style.borderTopWidth, style.borderRightWidth,
        style.borderBottomWidth, style.borderLeftWidth,
      ];
      return {
        stage: borders(of(".gd-stage-wrap")),
        stageShadow: of(".gd-stage-wrap").boxShadow,
        transport: borders(of(".gd-transport")),
        record: borders(of("#recordControls")),
        tab: borders(of("#recordTab")),
        tabAccent: of("#recordTab").borderBottomColor,
        tabColor: of("#recordTab").color,
        playRadius: of("#playButton").borderRadius,
        playBorder: of("#playButton").borderTopWidth,
      };
    });
    expect(styles.stage).toEqual(["0px", "0px", "0px", "0px"]);
    expect(styles.stageShadow).toBe("none");
    expect(styles.transport).toEqual(["0px", "0px", "1px", "0px"]);
    expect(styles.record).toEqual(["0px", "0px", "0px", "0px"]);
    expect(styles.tab).toEqual(["0px", "0px", "2px", "0px"]);
    expect(styles.tabAccent).toBe(styles.tabColor);
    expect(styles.playRadius).toBe("50%");
    expect(parseFloat(styles.playBorder)).toBeGreaterThan(0);
    await page.locator("#playTab").click();
    await expect(page.locator("#playControls")).toHaveCSS("border-top-width", "0px");
  }
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator("#stageCanvas")).toBeFocused();
  await expect(page.locator("#stageCanvas")).toHaveCSS("outline-style", "solid");
});

test("desktop, portrait and landscape keep the stage, transport and both phases reachable", async ({ page }) => {
  test.setTimeout(60_000);
  for (const { width, height } of [
    { width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 },
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto("/globule-damacy.html");
    await expect(page.locator("#stageCanvas")).toBeVisible();
    for (const id of ["playButton", "recordTab", "sourceLane", "recordPreset",
      "grainSize", "grainMode", "grainSpread",
      "sampleSelect", "useSampleButton", "importButton", "micButton", "resetButton"]) {
      if (id === "grainSpread") {
        await page.locator("#grainMode").selectOption("random");
      }
      await page.locator(`#${id}`).scrollIntoViewIfNeeded();
      await expect(page.locator(`#${id}`)).toBeVisible();
    }
    await page.locator("#playTab").click();
    for (const id of ["playPreset", "spinSpeed", "scatter", "needleWidth", "layerTransparency", "needle",
      "directionButton", "homeButton"]) {
      await page.locator(`#${id}`).scrollIntoViewIfNeeded();
      await expect(page.locator(`#${id}`)).toBeVisible();
    }
    const metrics = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - innerWidth,
      stage: document.querySelector("#stageCanvas").getBoundingClientRect().width,
      transport: document.querySelector("#playButton").getBoundingClientRect().toJSON(),
    }));
    expect(metrics.overflow).toBeLessThanOrEqual(1);
    expect(metrics.stage).toBeGreaterThan(240);
    expect(metrics.transport.width).toBeGreaterThanOrEqual(48);
    expect(metrics.transport.height).toBeGreaterThanOrEqual(48);
  }
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(results.violations).toEqual([]);
});

test("coarse-pointer portrait keeps Audio/Play touch targets and touch pickup usable", async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  });
  const page = await context.newPage();
  try {
    await page.goto("/globule-damacy.html");
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
    for (const id of ["audioButton", "playButton"]) {
      const box = await page.locator(`#${id}`).boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(48);
      expect(box.height).toBeGreaterThanOrEqual(48);
    }
    const box = await page.locator("#stageCanvas").boundingBox();
    const pickup = point(box, .5, 0);
    await page.touchscreen.tap(pickup.x, pickup.y);
    await expect(page.locator("#ribbonCount")).not.toHaveText("0");
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  } finally { await context.close(); }
});
