import { expect, test } from "@playwright/test";

import {
  formatPageDiagnostics,
  pageDiagnosticMessages,
  settlePage,
  watchPageDiagnostics,
} from "./helpers/diagnostics.mjs";

const EDITOR_PATH = "/monstrozoid.html";
const EDITOR_ORIGIN = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3435";
const GRAPH_CONTROLS = [
  "scatterGraphButton",
  "resetGraphButton",
  "graphMotionButton",
];

async function openEditor(page, { freezeMotion = true } = {}) {
  const response = await page.goto(EDITOR_PATH, { waitUntil: "domcontentloaded" });
  expect(response?.ok(), `${EDITOR_PATH} returned HTTP ${response?.status()}`).toBe(true);
  await settlePage(page);
  await expect(page.locator(".colony-body .graph-node").first()).toHaveAttribute("data-x", /\d/u);

  if (freezeMotion) {
    const motion = page.locator("#graphMotionButton");
    if (await motion.getAttribute("aria-pressed") === "true") await motion.click();
    await expect(motion).toHaveAttribute("aria-pressed", "false");
  }
}

async function graphPositions(page, { activeOnly = false } = {}) {
  const selector = `.colony-body .graph-node${activeOnly ? ":not([hidden])" : ""}`;
  return page.locator(selector).evaluateAll((nodes) => nodes.map((node) => ({
    id: node.dataset.organId,
    x: node.dataset.x,
    y: node.dataset.y,
  })));
}

async function lowerControlSnapshot(page) {
  return page.locator(".anatomy-flow input, .anatomy-flow select").evaluateAll((controls) => (
    controls.map((control) => ({
      id: control.id,
      value: control.value,
      checked: "checked" in control ? control.checked : null,
      disabled: control.disabled,
    }))
  ));
}

async function routeStateSnapshot(page) {
  return page.locator(".route-valve[data-route]").evaluateAll((routes) => routes.map((route) => ({
    route: route.dataset.route,
    pressed: route.getAttribute("aria-pressed"),
    disabled: route.getAttribute("aria-disabled"),
  })));
}

async function nodeDragPlan(node) {
  await node.scrollIntoViewIfNeeded();
  return node.evaluate((element) => {
    const svg = element.ownerSVGElement;
    const nodeMatrix = element.getScreenCTM();
    const svgMatrix = svg?.getScreenCTM();
    if (!svg || !nodeMatrix || !svgMatrix || typeof DOMPoint !== "function") return null;

    const start = new DOMPoint(0, 0).matrixTransform(nodeMatrix);
    const x = Number(element.dataset.x);
    const y = Number(element.dataset.y);
    const targetSvg = new DOMPoint(
      x < 500 ? Math.min(565, x + 52) : Math.max(431, x - 52),
      y < 310 ? Math.min(545, y + 47) : Math.max(75, y - 47),
    );
    const target = targetSvg.matrixTransform(svgMatrix);
    return {
      start: { x: start.x, y: start.y },
      target: { x: target.x, y: target.y },
    };
  });
}

async function svgControlCenter(control) {
  await control.scrollIntoViewIfNeeded();
  return control.evaluate((element) => {
    const matrix = element.getScreenCTM();
    const box = element.getBBox();
    const bounds = element.getBoundingClientRect();
    if (!matrix || typeof DOMPoint !== "function") return null;
    const center = new DOMPoint(
      box.x + box.width / 2,
      box.y + box.height / 2,
    ).matrixTransform(matrix);
    return {
      x: center.x,
      y: center.y,
      width: bounds.width,
      height: bounds.height,
    };
  });
}

async function graphNodeAuditionPoint(node) {
  await node.scrollIntoViewIfNeeded();
  return node.evaluate((element) => {
    const matrix = element.getScreenCTM();
    if (!matrix || typeof DOMPoint !== "function") return null;
    const offsets = {
      lung: { x: -36, y: 0 },
      source: { x: -30, y: 0 },
      mouth: { x: 110, y: -18 },
    };
    const local = offsets[element.dataset.organKind] ?? { x: 0, y: 0 };
    const point = new DOMPoint(local.x, local.y).matrixTransform(matrix);
    return { x: point.x, y: point.y };
  });
}

async function spatialBackgroundPoint(page) {
  const svg = page.locator(".colony-body");
  await svg.scrollIntoViewIfNeeded();
  return svg.evaluate((element) => {
    const matrix = element.getScreenCTM();
    if (!matrix || typeof DOMPoint !== "function") return null;
    const candidates = [
      { x: 1140, y: 300 },
      { x: 1120, y: 540 },
      { x: 1090, y: 70 },
      { x: 920, y: 590 },
    ];
    for (const candidate of candidates) {
      const screen = new DOMPoint(candidate.x, candidate.y).matrixTransform(matrix);
      const hit = document.elementFromPoint(screen.x, screen.y);
      if (hit?.closest?.("[data-spatial-background], [data-graph-background]")) {
        return {
          x: screen.x,
          y: screen.y,
          svgX: candidate.x,
          svgY: candidate.y,
        };
      }
    }
    return null;
  });
}

async function editorStateSnapshot(page) {
  return {
    preset: await page.locator("#presetTextOutput").inputValue(),
    selectedCall: await page.locator("#callPresetSelect").inputValue(),
    positions: await graphPositions(page),
    controls: await lowerControlSnapshot(page),
    routes: await routeStateSnapshot(page),
  };
}

async function jawDragPlan(handle, opening) {
  await handle.scrollIntoViewIfNeeded();
  return handle.evaluate((element, currentOpening) => {
    const svg = element.ownerSVGElement;
    const node = element.closest(".graph-node[data-x][data-y]");
    const handleMatrix = element.getScreenCTM();
    const svgMatrix = svg?.getScreenCTM();
    const box = element.getBBox();
    const bounds = element.getBoundingClientRect();
    if (!svg || !node || !handleMatrix || !svgMatrix || typeof DOMPoint !== "function") return null;
    const start = new DOMPoint(
      box.x + box.width / 2,
      box.y + box.height / 2,
    ).matrixTransform(handleMatrix);
    const target = new DOMPoint(
      Number(node.dataset.x) + Number(element.getAttribute("cx")),
      Number(node.dataset.y) + (currentOpening < 0.5 ? 50 : 14),
    ).matrixTransform(svgMatrix);
    return {
      start: { x: start.x, y: start.y },
      target: { x: target.x, y: target.y },
      bounds: { width: bounds.width, height: bounds.height },
    };
  }, opening);
}

async function routePointerPlan(routeHit, dragDistance = 0) {
  await routeHit.scrollIntoViewIfNeeded();
  return routeHit.evaluate((path, requestedDistance) => {
    const svg = path.ownerSVGElement;
    const matrix = svg?.getScreenCTM();
    const length = path.getTotalLength?.() ?? 0;
    if (!svg || !matrix || length <= 0 || typeof DOMPoint !== "function") return null;

    const toScreen = (point) => new DOMPoint(point.x, point.y).matrixTransform(matrix);
    let startSvg = null;
    let startScreen = null;
    for (const fraction of [0.5, 0.35, 0.65, 0.22, 0.78]) {
      const offset = length * fraction;
      const point = path.getPointAtLength(offset);
      const before = path.getPointAtLength(Math.max(0, offset - 2));
      const after = path.getPointAtLength(Math.min(length, offset + 2));
      const tangentLength = Math.max(0.001, Math.hypot(after.x - before.x, after.y - before.y));
      const normal = {
        x: -(after.y - before.y) / tangentLength,
        y: (after.x - before.x) / tangentLength,
      };
      for (const distance of [6, -6, 8, -8, 4, -4]) {
        const candidate = {
          x: point.x + normal.x * distance,
          y: point.y + normal.y * distance,
        };
        const screen = toScreen(candidate);
        const top = document.elementFromPoint(screen.x, screen.y);
        if (top?.closest?.("[data-route-hit]") === path) {
          startSvg = candidate;
          startScreen = screen;
          break;
        }
      }
      if (startSvg) break;
    }
    if (!startSvg || !startScreen) return null;

    const [sourceNumber, mouthNumber] = path.dataset.routeHit.split("-").map(Number);
    const source = svg.querySelector(`[data-organ-id="source-${sourceNumber}"]`);
    const mouth = svg.querySelector(`[data-organ-id="mouth-${mouthNumber}"]`);
    const sourceX = Number(source?.dataset.x);
    const sourceY = Number(source?.dataset.y);
    const mouthX = Number(mouth?.dataset.x);
    const mouthY = Number(mouth?.dataset.y);
    const span = Math.max(0.001, Math.hypot(mouthX - sourceX, mouthY - sourceY));
    const apertureNormal = {
      x: -(mouthY - sourceY) / span,
      y: (mouthX - sourceX) / span,
    };
    const target = toScreen({
      x: startSvg.x + apertureNormal.x * requestedDistance,
      y: startSvg.y + apertureNormal.y * requestedDistance,
    });
    return {
      start: { x: startScreen.x, y: startScreen.y },
      target: { x: target.x, y: target.y },
    };
  }, dragDistance);
}

test("loads cleanly with an aligned anatomy and opt-in motion", async ({ page }) => {
  const diagnostics = watchPageDiagnostics(page);
  await openEditor(page);

  const nodes = (await graphPositions(page, { activeOnly: true })).map((node) => ({
    ...node,
    x: Number(node.x),
    y: Number(node.y),
  }));
  expect(nodes.length).toBeGreaterThanOrEqual(4);
  expect(nodes.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);

  const lungs = nodes.filter(({ id }) => id.startsWith("lung-"));
  const sources = nodes.filter(({ id }) => id.startsWith("source-"));
  const mouths = nodes.filter(({ id }) => id.startsWith("mouth-"));
  expect(lungs.length).toBeGreaterThan(0);
  expect(sources.length).toBeGreaterThan(0);
  expect(mouths.length).toBeGreaterThan(0);
  expect(new Set(sources.map(({ x }) => x.toFixed(1))).size).toBe(1);
  expect(new Set(mouths.map(({ x }) => x.toFixed(1))).size).toBe(1);
  expect(Math.max(...lungs.map(({ x }) => x))).toBeLessThan(Math.min(...sources.map(({ x }) => x)));
  expect(Math.max(...sources.map(({ x }) => x))).toBeLessThan(Math.min(...mouths.map(({ x }) => x)));
  await expect(page.locator("#graphMotionButton")).toHaveAttribute("aria-pressed", "false");

  expect(
    pageDiagnosticMessages(diagnostics),
    `Monstrozoid emitted browser diagnostics:\n${formatPageDiagnostics(diagnostics)}`,
  ).toEqual([]);
});

test("calls live in one right-rail chooser and play as soon as they are selected", async ({ page }) => {
  await openEditor(page);

  const rail = page.locator(".colony-console.control-rail");
  const chooser = rail.locator("#callPresetSelect");
  await expect(chooser).toHaveCount(1);
  await expect(page.locator(".call-preset-button, .call-bank")).toHaveCount(0);
  await expect(chooser.locator("option:not([disabled])")).toHaveCount(72);

  const callIds = await chooser.locator("option:not([disabled])").evaluateAll((options) => (
    options.map((option) => option.value)
  ));
  expect(callIds.slice(0, 4)).toEqual([
    "air-clean-low-tone",
    "air-clear-reed-tone",
    "water-clean-hollow-tone",
    "pellets-pitched-tap",
  ]);

  const labels = await chooser.locator("option:not([disabled])").allTextContents();
  expect(labels.some((label) => /^Rounded low tone ·/u.test(label))).toBe(true);
  expect(labels.some((label) => /^Low hollow tone ·/u.test(label))).toBe(true);
  expect(labels.some((label) => /^Pitched dry tap ·/u.test(label))).toBe(true);
  expect(labels.every((label) => !/^(?:Air|Water|Pellets)\b/u.test(label))).toBe(true);
  expect(labels.some((label) => /1\.1 s$/u.test(label))).toBe(true);
  expect(labels.some((label) => /9\.7 s$/u.test(label))).toBe(true);

  await chooser.selectOption("air-clear-reed-tone");
  await expect(page.locator("#statusText")).toHaveText("Call active.");
  await expect(page.locator("#audioState")).toHaveText("on");
  await expect(page.locator("#selectedCallReadout")).toContainText("Centered reed tone · 3.2 s");
  await expect.poll(() => page.evaluate(() => (
    Number(getComputedStyle(document.documentElement).getPropertyValue("--colony-rms"))
  ))).toBeGreaterThan(0.0001);
  await expect(page.locator("#playCallButton")).toBeEnabled();
});

test("left and right arrows step through calls and audition each selection", async ({ page }) => {
  await openEditor(page);

  const chooser = page.locator("#callPresetSelect");
  await expect(chooser).toHaveValue("air-clean-low-tone");

  await chooser.focus();
  await chooser.press("ArrowRight");
  await expect(chooser).toHaveValue("air-clear-reed-tone");
  await expect(page.locator("#statusText")).toHaveText("Call active.");
  await expect(page.locator("#audioState")).toHaveText("on");
  await expect(page.locator("#selectedCallReadout")).toContainText("Centered reed tone");
  await expect.poll(() => page.evaluate(() => (
    Number(getComputedStyle(document.documentElement).getPropertyValue("--colony-rms"))
  ))).toBeGreaterThan(0.0001);

  await chooser.press("ArrowLeft");
  await expect(chooser).toHaveValue("air-clean-low-tone");
  await expect(page.locator("#selectedCallReadout")).toContainText("Rounded low tone");
});

test("Randomize all is primary and emits copyable reproducible preset text", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: EDITOR_ORIGIN,
  });
  await openEditor(page);

  const randomize = page.locator("#randomizeAllButton");
  const chooser = page.locator("#callPresetSelect");
  const randomizeBox = await randomize.boundingBox();
  const chooserBox = await chooser.boundingBox();
  expect(randomizeBox?.y).toBeLessThan(chooserBox?.y ?? 0);

  const output = page.locator("#presetTextOutput");
  const before = await output.inputValue();
  const positionsBefore = await graphPositions(page);
  expect(before).toMatch(/^MORPHAZOID-PRESET monstrozoid v2\n\{/u);
  await randomize.click();
  await expect.poll(() => output.inputValue()).not.toBe(before);
  await expect.poll(async () => JSON.stringify(await graphPositions(page))).not.toBe(
    JSON.stringify(positionsBefore),
  );
  const randomizedText = await output.inputValue();
  const randomizedPreset = JSON.parse(randomizedText.slice(randomizedText.indexOf("\n") + 1));
  expect(randomizedPreset.organLayout.lungs).toHaveLength(16);
  expect(randomizedPreset.organLayout.sources).toHaveLength(4);
  expect(randomizedPreset.organLayout.mouths).toHaveLength(3);
  expect(typeof randomizedPreset.organMotionEnabled).toBe("boolean");
  const randomizedPositions = await graphPositions(page);
  for (const node of randomizedPositions) {
    const [kind, number] = node.id.split("-");
    const family = kind === "lung" ? "lungs" : kind === "source" ? "sources" : "mouths";
    const stored = randomizedPreset.organLayout[family][Number(number) - 1];
    expect(Number(node.x)).toBeCloseTo(stored[0], 1);
    expect(Number(node.y)).toBeCloseTo(stored[1], 1);
  }

  await page.locator(".preset-text-section > summary").click();
  await page.locator("#copyPresetButton").click();
  await expect(page.locator("#presetCopyState")).toHaveText("COPIED");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await output.inputValue());
});

test("compact layout keeps the generator above the anatomy", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openEditor(page);

  const primary = page.locator(".colony-primary-section");
  await expect(primary).toHaveCount(1);
  await expect(primary.locator("xpath=..")).toHaveAttribute("id", "mobilePrimaryMount");
  const primaryBox = await primary.boundingBox();
  const anatomyBox = await page.locator(".anatomy-heading").boundingBox();
  expect(primaryBox?.y).toBeLessThan(anatomyBox?.y ?? 0);

  const monster = page.locator(".colony-body");
  const monsterBox = await monster.boundingBox();
  await expect(page.locator(".monster-body-shell")).toBeVisible();
  await expect(page.locator('.vessel-mouth:not([hidden]) .monster-head-shell').first()).toBeVisible();
  expect(monsterBox?.height).toBeGreaterThanOrEqual(290);
  expect(monsterBox?.y).toBeLessThan(844);

  await page.setViewportSize({ width: 1100, height: 800 });
  await expect(primary.locator("xpath=..")).toHaveClass(/colony-console/u);
});

test("live contours articulate the monster lips and tongue", async ({ page }) => {
  await openEditor(page);

  const mouth = page.locator('.vessel-mouth:not([hidden])').first();
  const lowerLip = mouth.locator(".mouth-lower");
  const tongue = mouth.locator(".mouth-tongue");
  const initial = {
    lip: await lowerLip.getAttribute("transform"),
    tongue: await tongue.getAttribute("transform"),
  };

  await page.locator("#callPresetSelect").selectOption("air-clear-reed-tone");
  await expect.poll(async () => ({
    lip: await lowerLip.getAttribute("transform"),
    tongue: await tongue.getAttribute("transform"),
  })).not.toEqual(initial);
  await expect(mouth).toHaveCSS("--mouth-opening", /0?\.\d+/u);
});

test("spatial taps share cold audio startup and preserve the editable creature", async ({ page }) => {
  await openEditor(page);

  const before = await editorStateSnapshot(page);
  const lung = page.locator('.graph-node[data-organ-kind="lung"]:not([hidden])').first();
  const source = page.locator('.graph-node[data-organ-kind="source"]:not([hidden])').first();
  const mouth = page.locator('.graph-node[data-organ-kind="mouth"]:not([hidden])').first();
  const lungPoint = await graphNodeAuditionPoint(lung);
  const sourcePoint = await graphNodeAuditionPoint(source);
  const mouthPoint = await graphNodeAuditionPoint(mouth);
  expect(lungPoint).not.toBeNull();
  expect(sourcePoint).not.toBeNull();
  expect(mouthPoint).not.toBeNull();

  // These two releases intentionally arrive while the first AudioWorklet startup
  // is still pending. The newest spatial intent must win the shared startup.
  await page.mouse.click(lungPoint.x, lungPoint.y);
  await page.mouse.click(sourcePoint.x, sourcePoint.y);
  await expect(page.locator("#statusText")).toHaveText(/Vocal source \d+ · .+ active\./u);
  await expect(page.locator("#audioState")).toHaveText("on");
  await expect(source).toHaveClass(/is-spatial-auditioning/u);

  await page.mouse.click(mouthPoint.x, mouthPoint.y);
  await expect(page.locator("#statusText")).toHaveText(/Mouth \d+ · .+ active\./u);
  await expect(mouth).toHaveClass(/is-spatial-auditioning/u);

  const backgroundPoint = await spatialBackgroundPoint(page);
  expect(backgroundPoint, "no unobstructed spatial background point was found").not.toBeNull();
  await page.mouse.click(backgroundPoint.x, backgroundPoint.y);
  await expect(page.locator("#statusText")).toHaveText(/(?:Lung|Vocal source|Mouth) \d+ · .+ active\./u);
  await expect(page.locator("#spatialTriggerFeedback")).not.toHaveAttribute("hidden", "");
  await expect(page.locator("#spatialTriggerFeedback")).toHaveAttribute(
    "transform",
    `translate(${backgroundPoint.svgX.toFixed(2)} ${backgroundPoint.svgY.toFixed(2)})`,
  );

  const duration = Number.parseFloat(await page.locator("#playCallDetail").textContent());
  expect(duration).toBeGreaterThanOrEqual(1);
  expect(duration).toBeLessThanOrEqual(4);
  await expect.poll(() => page.evaluate(() => (
    Number(getComputedStyle(document.documentElement).getPropertyValue("--colony-rms"))
  ))).toBeGreaterThan(0.0001);
  expect(await editorStateSnapshot(page)).toEqual(before);
});

test("a body hold stays manual breath instead of becoming a spatial call", async ({ page }) => {
  await openEditor(page);

  const backgroundPoint = await spatialBackgroundPoint(page);
  expect(backgroundPoint, "no unobstructed spatial background point was found").not.toBeNull();
  await page.mouse.move(backgroundPoint.x, backgroundPoint.y);
  await page.mouse.down();
  await page.waitForTimeout(180);
  await expect(page.locator("#breathButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#breathReadout")).toHaveText("manual pressure");
  await page.mouse.up();

  await expect(page.locator("#breathButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#audioState")).toHaveText("on");
  await expect(page.locator("#statusText")).not.toContainText("Spatial audition");
  await expect(page.locator("#spatialTriggerFeedback")).toHaveAttribute("hidden", "");
});

test("A auditions the focused organ and then resumes continuous flow", async ({ page }) => {
  await openEditor(page);

  const before = await editorStateSnapshot(page);
  const play = page.locator("#playButton");
  await play.click();
  await expect(play).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#statusText")).toHaveText("Continuous flow active.");

  const mouth = page.locator('.graph-node[data-organ-kind="mouth"]:not([hidden])').first();
  await mouth.focus();
  await mouth.press("a");
  await expect(page.locator("#statusText")).toHaveText(/Mouth \d+ · .+ active\./u);
  await expect(play).toHaveAttribute("aria-pressed", "false");
  await expect(mouth).toHaveClass(/is-spatial-auditioning/u);
  await expect(mouth).toHaveAttribute("aria-keyshortcuts", "A");

  await expect(play).toHaveAttribute("aria-pressed", "true", { timeout: 5_500 });
  await expect(page.locator("#statusText")).toHaveText("Continuous flow active.");
  await expect(page.locator("#spatialTriggerFeedback")).toHaveAttribute("hidden", "");
  expect(await editorStateSnapshot(page)).toEqual(before);
});

test("dragging a source moves its data position and live route geometry", async ({ page }) => {
  await openEditor(page);
  const source = page.locator('.graph-node[data-organ-kind="source"]:not([hidden])').first();
  const sourceNumber = Number(await source.getAttribute("data-organ-index")) + 1;
  const incidentRoute = page.locator(
    `[data-vessel-route^="${sourceNumber}-"]:not([hidden])`,
  ).first();
  const presetBefore = await page.locator("#presetTextOutput").inputValue();
  const before = {
    x: Number(await source.getAttribute("data-x")),
    y: Number(await source.getAttribute("data-y")),
    route: await incidentRoute.getAttribute("d"),
    body: await page.locator(".monster-body-shell").getAttribute("d"),
  };
  const plan = await nodeDragPlan(source);
  expect(plan, "active source did not expose a usable getScreenCTM() transform").not.toBeNull();

  await page.mouse.move(plan.start.x, plan.start.y);
  await page.mouse.down();
  await page.mouse.move(plan.target.x, plan.target.y, { steps: 8 });

  const feedback = page.locator("#dragSoundFeedback");
  await expect(feedback).not.toHaveAttribute("hidden", "");
  await expect(feedback.locator("text")).toHaveText(/PITCH \d+ HZ · TENSION \d+% → SOUND/u);
  await expect(page.locator(".monster-body-shell")).not.toHaveAttribute("d", before.body);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.evaluate(() => (
    Number(getComputedStyle(document.documentElement).getPropertyValue("--colony-rms"))
  ))).toBeGreaterThan(0.0001);
  await page.mouse.up();
  await expect(feedback).toHaveAttribute("hidden", "");

  await expect.poll(async () => ({
    x: Number(await source.getAttribute("data-x")),
    y: Number(await source.getAttribute("data-y")),
  })).not.toEqual({ x: before.x, y: before.y });
  const after = {
    x: Number(await source.getAttribute("data-x")),
    y: Number(await source.getAttribute("data-y")),
  };
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(2);
  await expect(incidentRoute).not.toHaveAttribute("d", before.route);
  await expect.poll(() => page.locator("#presetTextOutput").inputValue()).not.toBe(presetBefore);
  const presetAfter = await page.locator("#presetTextOutput").inputValue();
  const payload = JSON.parse(presetAfter.slice(presetAfter.indexOf("\n") + 1));
  expect(payload.organLayout.sources[sourceNumber - 1][0]).toBeCloseTo(after.x, 1);
  expect(payload.organLayout.sources[sourceNumber - 1][1]).toBeCloseTo(after.y, 1);
});

test("route hit paths control the matching lower valve and expose aperture dragging", async ({ page }) => {
  await openEditor(page);

  const clickable = page.locator(".vessel-route-hit:not([hidden])").first();
  const routeKey = await clickable.getAttribute("data-route-hit");
  const lowerValve = page.locator(`.route-valve[data-route="${routeKey}"]`);
  const beforePressed = await lowerValve.getAttribute("aria-pressed");
  const clickPlan = await routePointerPlan(clickable);
  expect(clickPlan, `route ${routeKey} has no hittable wide-stroke point`).not.toBeNull();
  await page.mouse.click(clickPlan.start.x, clickPlan.start.y);
  await expect(lowerValve).toHaveAttribute(
    "aria-pressed",
    beforePressed === "true" ? "false" : "true",
  );
  await expect(clickable).toHaveAttribute(
    "data-primary-open",
    beforePressed === "true" ? "false" : "true",
  );

  if (beforePressed === "true") {
    await page.mouse.click(clickPlan.start.x, clickPlan.start.y);
    await expect(lowerValve).toHaveAttribute("aria-pressed", "true");
    await expect(clickable).toHaveAttribute("data-primary-open", "true");
  }

  const draggable = clickable;
  const draggableKey = routeKey;
  const visibleRoute = page.locator(`[data-vessel-route="${draggableKey}"]`);
  const draggableValve = page.locator(`.route-valve[data-route="${draggableKey}"]`);
  const beforeAperture = await draggable.evaluate((element) => (
    Number(element.style.getPropertyValue("--aperture"))
  ));
  expect(beforeAperture).toBeGreaterThan(0.02);
  const dragPlan = await routePointerPlan(draggable, 48);
  expect(dragPlan, `route ${draggableKey} has no draggable wide-stroke point`).not.toBeNull();

  await page.mouse.move(dragPlan.start.x, dragPlan.start.y);
  await page.mouse.down();
  await page.mouse.move(dragPlan.target.x, dragPlan.target.y, { steps: 8 });
  await expect(page.locator("#dragSoundFeedback text")).toHaveText(/ROUTE OPEN \d+% → SOUND/u);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await page.mouse.up();
  await expect(page.locator("#dragSoundFeedback")).toHaveAttribute("hidden", "");

  await expect.poll(async () => draggableValve.evaluate((element) => (
    Number(element.style.getPropertyValue("--velocity"))
  ))).toBeLessThan(beforeAperture - 0.05);
  const afterAperture = await draggableValve.evaluate((element) => (
    Number(element.style.getPropertyValue("--velocity"))
  ));
  await expect.poll(async () => Number(
    await visibleRoute.getAttribute("data-runtime-aperture"),
  )).toBeGreaterThanOrEqual(0);
  await expect.poll(async () => Number(
    await visibleRoute.getAttribute("data-runtime-aperture"),
  )).toBeLessThanOrEqual(1);
  expect(afterAperture).toBeGreaterThanOrEqual(0);
  expect(afterAperture).toBeLessThanOrEqual(1);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
});

test("patching a source to a mouth and shaping its jaw update real controls", async ({ page }) => {
  await openEditor(page);
  const sourcePort = page.locator(
    '.graph-node[data-organ-kind="source"]:not([hidden]) .source-port',
  ).first();
  const mouthPort = page.locator(
    '.graph-node[data-organ-kind="mouth"]:not([hidden]) .mouth-port',
  ).first();
  const sourceIndex = Number(await sourcePort.getAttribute("data-source-index"));
  const mouthIndex = Number(await mouthPort.getAttribute("data-mouth-port"));
  const routeKey = `${sourceIndex + 1}-${mouthIndex + 1}`;
  const lowerValve = page.locator(`.route-valve[data-route="${routeKey}"]`);
  const routeBefore = await lowerValve.getAttribute("aria-pressed");
  const sourcePoint = await svgControlCenter(sourcePort);
  const mouthPoint = await svgControlCenter(mouthPort);
  expect(sourcePoint?.width).toBeGreaterThan(0);
  expect(mouthPoint?.width).toBeGreaterThan(0);

  await page.mouse.move(sourcePoint.x, sourcePoint.y);
  await page.mouse.down();
  await page.mouse.move(mouthPoint.x, mouthPoint.y, { steps: 10 });
  await page.mouse.up();
  await expect(lowerValve).toHaveAttribute(
    "aria-pressed",
    routeBefore === "true" ? "false" : "true",
  );

  const jawHandle = page.locator(
    `.graph-node[data-organ-id="mouth-${mouthIndex + 1}"]:not([hidden]) .jaw-shape-handle`,
  );
  const aperture = page.locator(`#mouth${mouthIndex + 1}Aperture`);
  const apertureBefore = Number(await aperture.inputValue());
  const jawPlan = await jawDragPlan(jawHandle, apertureBefore);
  expect(jawPlan?.bounds.width).toBeGreaterThan(0);
  await page.mouse.move(jawPlan.start.x, jawPlan.start.y);
  await page.mouse.down();
  await page.mouse.move(jawPlan.target.x, jawPlan.target.y, { steps: 8 });
  await expect(page.locator("#dragSoundFeedback text")).toHaveText(
    /RESONANCE \d+ HZ · OPEN \d+% → SOUND/u,
  );
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await page.mouse.up();
  await expect(page.locator("#dragSoundFeedback")).toHaveAttribute("hidden", "");
  await expect.poll(async () => Math.abs(
    Number(await aperture.inputValue()) - apertureBefore,
  )).toBeGreaterThan(0.1);
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
});

test("scatter preserves acoustic controls and reset restores canonical positions", async ({ page }) => {
  await openEditor(page);
  const canonical = await graphPositions(page);
  const controlsBefore = await lowerControlSnapshot(page);
  const routesBefore = await routeStateSnapshot(page);

  await page.locator("#scatterGraphButton").click();
  await expect.poll(async () => JSON.stringify(await graphPositions(page))).not.toBe(
    JSON.stringify(canonical),
  );
  expect(await lowerControlSnapshot(page)).toEqual(controlsBefore);
  expect(await routeStateSnapshot(page)).toEqual(routesBefore);

  await page.locator("#resetGraphButton").click();
  await expect.poll(async () => graphPositions(page)).toEqual(canonical);
});

test("graph controls, nodes, and routes honor keyboard focus without starting audio", async ({ page }) => {
  await openEditor(page);

  for (const id of GRAPH_CONTROLS) {
    const control = page.locator(`#${id}`);
    await expect(control).toBeVisible();
    expect(await control.evaluate((element) => element.tabIndex)).toBeGreaterThanOrEqual(0);
    await control.focus();
    await expect(control).toBeFocused();
  }

  const activeNodes = page.locator(".colony-body .graph-node:not([hidden])");
  expect(await activeNodes.count()).toBeGreaterThan(0);
  expect(await activeNodes.evaluateAll((nodes) => nodes.every((node) => (
    node.tabIndex === 0
      && node.getAttribute("role") === "button"
      && node.getAttribute("aria-disabled") === "false"
  )))).toBe(true);
  const firstNode = activeNodes.first();
  await firstNode.focus();
  await expect(firstNode).toBeFocused();

  const absentNodes = page.locator(".colony-body .graph-node[hidden]");
  expect(await absentNodes.count()).toBeGreaterThan(0);
  expect(await absentNodes.evaluateAll((nodes) => nodes.every((node) => (
    node.tabIndex === -1
      && node.getAttribute("aria-disabled") === "true"
      && getComputedStyle(node).display === "none"
      && [...node.querySelectorAll("[tabindex]")].every((child) => child.tabIndex === -1)
  )))).toBe(true);

  const route = page.locator(".vessel-route:not([hidden])").first();
  const routeKey = await route.getAttribute("data-vessel-route");
  const lowerValve = page.locator(`.route-valve[data-route="${routeKey}"]`);
  const routeBefore = await lowerValve.getAttribute("aria-pressed");
  const playBefore = await page.locator("#playButton").getAttribute("aria-pressed");
  await route.focus();
  await expect(route).toBeFocused();
  await route.press("Space");
  await expect(lowerValve).toHaveAttribute(
    "aria-pressed",
    routeBefore === "true" ? "false" : "true",
  );
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", playBefore);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
});
