import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { pageDiagnosticMessages, watchPageDiagnostics } from "./helpers/diagnostics.mjs";

const count = page => page.locator("#ribbonCount").textContent().then(Number);
const meter = page => page.evaluate(async () => {
  const { getSharedAudioOutputManager } = await import("/src/audio-output-manager.js");
  return getSharedAudioOutputManager().getStatus();
});
const angle = page => page.locator("#turnOut").textContent().then(text => Number(text.match(/\d+/)[0]));

async function paintedGrainCenter(page) {
  // Follow a single, saturated pink grain in the *rendered canvas*, not an
  // internal app state. Glass veins and the fixed straw are much less pink.
  return page.locator("#stageCanvas").evaluate(async canvas => {
    await new Promise(requestAnimationFrame);
    const { width, height } = canvas.getBoundingClientRect();
    const scaleX = canvas.width / width, scaleY = canvas.height / height;
    const cx = width * .49, cy = height * .46;
    const radius = Math.min(width * .30, height * .32, 44 * 3.9);
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
  const left = Math.min(62, box.width * .13), right = box.width - Math.min(30, box.width * .055);
  const top = Math.min(117, box.height * .24), bottom = box.height - 56;
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
  await page.locator("#playButton").click();
  await expect.poll(() => angle(page)).toBeGreaterThan(2);
  const before = await angle(page);
  await page.locator("#playPreset").selectOption("backspin");
  await expect(page.locator("#spinSpeedOut")).toHaveText("0.77×");
  await expect(page.locator("#directionButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#playPreset")).toHaveValue("backspin");
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  expect(Math.abs((await angle(page)) - before)).toBeLessThan(12);
  await page.locator("#audioButton").click();
  await page.locator("#output").fill("0.43");
  await page.locator("#playPreset").selectOption("shattered-neon");
  await expect(page.locator("#playPreset")).toHaveValue("shattered-neon");
  await expect(page.locator("#spinSpeedOut")).toHaveText("1.60×");
  await expect(page.locator("#needleWidthOut")).toHaveText("85%");
  await expect(page.locator("#needleOut")).toHaveText("54° south");
  await page.locator("#needleWidth").fill("0");
  await expect(page.locator("#playPreset")).toHaveValue("custom");
  await page.locator("#playPreset").selectOption("shattered-neon");
  await expect(page.locator("#needleWidthOut")).toHaveText("85%");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#outputOut")).toHaveText("43%");
  await page.locator("#recordTab").click();
  await page.locator("#recordPreset").selectOption("vhs-glitter");
  await expect(page.locator("#grainMode")).toHaveValue("fixed");
  await expect(page.locator("#ribbonCount")).toHaveText(String(picked));
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
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

test("the ribbed straw stays parked while the marble tilts and spins beneath it", async ({ page }) => {
  await page.goto("/globule-damacy.html");
  await page.locator("#playTab").click();
  const sampleCanvas = () => page.evaluate(() => {
    const canvas = document.querySelector("#stageCanvas");
    const { width, height } = canvas.getBoundingClientRect();
    const radius = Math.min(width * .30, height * .32, 44 * 3.9);
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
    const radius = Math.min(width * .30, height * .32, 44 * 3.9);
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
    const radius = Math.min(width * .30, height * .32, 44 * 3.9);
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
    for (const id of ["playPreset", "spinSpeed", "scatter", "needleWidth", "needle",
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
