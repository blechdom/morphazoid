import { expect, test } from "@playwright/test";

import {
  formatPageDiagnostics,
  pageDiagnosticMessages,
  settlePage,
  watchPageDiagnostics,
} from "./helpers/diagnostics.mjs";

const EDITOR_PATH = "/colony-syrinx.html";
const GRAPH_CONTROLS = [
  "randomizeGraphButton",
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

test("loads cleanly and places active anatomy off a rigid grid", async ({ page }) => {
  const diagnostics = watchPageDiagnostics(page);
  await openEditor(page);

  const nodes = (await graphPositions(page, { activeOnly: true })).map((node) => ({
    ...node,
    x: Number(node.x),
    y: Number(node.y),
  }));
  expect(nodes.length).toBeGreaterThan(4);
  expect(nodes.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);

  const uniqueX = new Set(nodes.map(({ x }) => x.toFixed(1))).size;
  const uniqueY = new Set(nodes.map(({ y }) => y.toFixed(1))).size;
  const fractional = nodes.filter(({ x, y }) => (
    Math.abs(x - Math.round(x)) > 0.01 || Math.abs(y - Math.round(y)) > 0.01
  )).length;
  expect(uniqueX).toBeGreaterThan(nodes.length * 0.6);
  expect(uniqueY).toBeGreaterThan(nodes.length * 0.6);
  expect(fractional).toBeGreaterThan(nodes.length / 2);

  expect(
    pageDiagnosticMessages(diagnostics),
    `Colony Syrinx emitted browser diagnostics:\n${formatPageDiagnostics(diagnostics)}`,
  ).toEqual([]);
});

test("dragging a source moves its data position and live route geometry", async ({ page }) => {
  await openEditor(page);
  const source = page.locator('.graph-node[data-organ-kind="source"]:not([hidden])').first();
  const sourceNumber = Number(await source.getAttribute("data-organ-index")) + 1;
  const incidentRoute = page.locator(
    `[data-vessel-route^="${sourceNumber}-"]:not([hidden])`,
  ).first();
  const before = {
    x: Number(await source.getAttribute("data-x")),
    y: Number(await source.getAttribute("data-y")),
    route: await incidentRoute.getAttribute("d"),
  };
  const plan = await nodeDragPlan(source);
  expect(plan, "active source did not expose a usable getScreenCTM() transform").not.toBeNull();

  await page.mouse.move(plan.start.x, plan.start.y);
  await page.mouse.down();
  await page.mouse.move(plan.target.x, plan.target.y, { steps: 8 });
  await page.mouse.up();

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

  const draggable = page.locator(
    '.vessel-route-hit[data-primary-open="true"]:not([hidden])',
  ).first();
  const draggableKey = await draggable.getAttribute("data-route-hit");
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
  await page.mouse.up();

  await expect.poll(async () => draggable.evaluate((element) => (
    Number(element.style.getPropertyValue("--aperture"))
  ))).toBeLessThan(beforeAperture - 0.05);
  const afterAperture = await draggable.evaluate((element) => (
    Number(element.style.getPropertyValue("--aperture"))
  ));
  await expect.poll(async () => draggableValve.evaluate((element) => (
    Number(element.style.getPropertyValue("--velocity"))
  ))).toBeCloseTo(afterAperture, 5);
  await expect.poll(async () => Number(
    await visibleRoute.getAttribute("data-runtime-aperture"),
  )).toBeCloseTo(afterAperture, 2);
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
  await page.mouse.up();
  await expect.poll(async () => Math.abs(
    Number(await aperture.inputValue()) - apertureBefore,
  )).toBeGreaterThan(0.1);
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
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
