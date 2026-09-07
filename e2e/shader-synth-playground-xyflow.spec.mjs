import { expect, test } from "@playwright/test";

import {
  formatPageDiagnostics,
  pageDiagnosticMessages,
  settlePage,
  watchPageDiagnostics,
} from "./helpers/diagnostics.mjs";

const originalUrl = "/shader-synth-playground.html";
const xyflowUrl = `${originalUrl}?graph=xyflow`;
const diagnosticBaseUrl = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3435";

test("the default Shader Synth keeps its original graph renderer", async ({ page }) => {
  const diagnostics = watchPageDiagnostics(page, { baseURL: diagnosticBaseUrl });
  await page.goto(originalUrl, { waitUntil: "domcontentloaded" });
  await settlePage(page);

  await expect(page.locator("body")).toHaveAttribute("data-graph-renderer", "original");
  await expect(page.locator("#patchNodes")).toBeVisible();
  await expect(page.locator("#xyflowGraphRoot")).toBeHidden();
  await expect(page.locator("#graphRendererComparison")).toHaveText("Try XYFlow");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  expect(
    pageDiagnosticMessages(diagnostics),
    formatPageDiagnostics(diagnostics),
  ).toEqual([]);
});

test("the module rail nests icon tiles and keeps transport controls atop the inspector", async ({ page }) => {
  const diagnostics = watchPageDiagnostics(page, { baseURL: diagnosticBaseUrl });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(xyflowUrl, { waitUntil: "domcontentloaded" });
  await settlePage(page);

  const rail = page.locator(".module-browser");
  const inspector = page.locator("#nodeInspector");
  const sessionControls = inspector.locator(".inspector-session-controls");
  const railBox = await rail.boundingBox();
  const inspectorBox = await inspector.boundingBox();
  const sessionBox = await sessionControls.boundingBox();
  expect(railBox).not.toBeNull();
  expect(railBox?.width).toBeLessThanOrEqual(90);
  expect(inspectorBox).not.toBeNull();
  expect(sessionBox).not.toBeNull();
  expect(Math.abs((sessionBox?.y ?? 0) - (inspectorBox?.y ?? 0))).toBeLessThanOrEqual(1);
  await expect(sessionControls.locator("#playgroundPlayButton")).toBeVisible();
  await expect(sessionControls.locator("#patchSelect")).toBeVisible();

  await expect(page.locator("#moduleHearSelect, #moduleAddSelect")).toHaveCount(0);
  const categoryButtons = page.locator("[data-module-category]");
  expect(await categoryButtons.count()).toBeGreaterThanOrEqual(10);
  await expect(page.locator('[data-module-category][aria-expanded="true"]')).toHaveCount(0);
  await expect(page.locator(".module-palette-items:not([hidden])")).toHaveCount(0);

  const spaceCategory = page.locator('[data-module-category="space"]');
  await spaceCategory.hover();
  await expect(page.locator("#modulePaletteTooltip")).toBeVisible();
  await expect(page.locator("#modulePaletteTooltip")).toHaveText("Delay · reverb · motion");
  const spaceCategoryBox = await spaceCategory.boundingBox();
  const tooltipBox = await page.locator("#modulePaletteTooltip").boundingBox();
  expect(spaceCategoryBox).not.toBeNull();
  expect(tooltipBox).not.toBeNull();
  expect(tooltipBox?.x ?? 0).toBeGreaterThan((spaceCategoryBox?.x ?? 0) + (spaceCategoryBox?.width ?? 0));

  await spaceCategory.click();
  await expect(spaceCategory).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator('[data-module-category="source"]')).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator('[data-module-category][aria-expanded="true"]')).toHaveCount(1);

  const visibleItems = page.locator("#modulePaletteItems-space .module-palette-item");
  expect(await visibleItems.count()).toBeGreaterThan(0);
  const addButton = visibleItems.locator('[data-module-action="add"]:not(:disabled)').first();
  const hearButton = visibleItems.locator('[data-module-action="hear"]').first();
  await expect(addButton).toHaveAttribute("aria-label", /^Add .+ to the patch$/);
  await expect(hearButton).toHaveAttribute("aria-label", /^Hear .+; replaces the current patch$/);

  const nodes = page.locator("#xyflowGraphRoot .react-flow__node");
  const nodeCount = await nodes.count();
  await addButton.click();
  await expect(nodes).toHaveCount(nodeCount + 1);
  await expect(page.locator("#patchSelect")).toHaveValue("");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");

  await page.locator("#patchTitle").click();
  await page.keyboard.press("/");
  await expect(page.locator('[data-module-action="add"]:focus')).toHaveCount(1);

  expect(
    pageDiagnosticMessages(diagnostics),
    formatPageDiagnostics(diagnostics),
  ).toEqual([]);
});

test("the XYFlow route renders and edits the canonical shader patch", async ({ page }) => {
  const diagnostics = watchPageDiagnostics(page, { baseURL: diagnosticBaseUrl });
  const warnings = [];
  page.on("console", (message) => {
    if (message.type() === "warning") warnings.push(message.text());
  });
  await page.goto(xyflowUrl, { waitUntil: "domcontentloaded" });
  await settlePage(page);

  const root = page.locator("#xyflowGraphRoot");
  await expect(
    page.locator("body"),
    `XYFlow did not activate:\n${formatPageDiagnostics(diagnostics)}\n${warnings.join("\n")}`,
  ).toHaveAttribute("data-graph-renderer", "xyflow");
  await expect(root).toBeVisible();
  await expect(root.locator(".react-flow")).toBeVisible();
  expect(await root.locator(".react-flow__node").count()).toBeGreaterThan(0);
  expect(await root.locator(".react-flow__edge").count()).toBeGreaterThan(0);
  await expect(root.locator(".react-flow__controls")).toBeVisible();
  await expect(root.locator(".shader-flow-status")).toContainText("AUDIO OFF");
  await expect(page.locator("#graphRendererComparison")).toHaveText("Original canvas");

  const graphPresentation = await root.evaluate((element) => {
    const boxes = [...element.querySelectorAll(".react-flow__node")].map((node) => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(node).transform);
      return {
        id: node.dataset.id,
        left: matrix.m41,
        right: matrix.m41 + node.offsetWidth,
        top: matrix.m42,
        bottom: matrix.m42 + node.offsetHeight,
      };
    });
    const rows = [...new Set(boxes.map(({ top }) => top))].sort((a, b) => a - b);
    const horizontalGaps = rows.flatMap((top) => {
      const row = boxes.filter((box) => box.top === top).sort((a, b) => a.left - b.left);
      return row.slice(1).map((box, index) => box.left - row[index].right);
    });
    const verticalGaps = rows.slice(1).map((top, index) => {
      const previous = boxes.filter((box) => box.top === rows[index]);
      return top - Math.max(...previous.map((box) => box.bottom));
    });
    const updaterPaint = [...element.querySelectorAll(".react-flow__edgeupdater")].map((updater) => {
      const style = getComputedStyle(updater);
      return { opacity: style.opacity, radius: updater.getAttribute("r") };
    });
    return { boxes, horizontalGaps, verticalGaps, updaterPaint };
  });
  expect(Math.min(...graphPresentation.horizontalGaps)).toBeGreaterThanOrEqual(60);
  expect(Math.min(...graphPresentation.verticalGaps)).toBeGreaterThanOrEqual(48);
  expect(graphPresentation.updaterPaint.length).toBeGreaterThan(0);
  for (const updater of graphPresentation.updaterPaint) {
    expect(updater.opacity).toBe("0");
    expect(updater.radius).toBe("28");
  }

  const firstOutputPort = root.locator(".mz-flow-port-column.is-output .mz-flow-port-action").first();
  await firstOutputPort.click();
  await expect(firstOutputPort).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(root.locator(".mz-flow-port-column.is-output .mz-flow-port-action").first()).toHaveAttribute("aria-pressed", "false");

  const firstNode = root.locator(".react-flow__node").first();
  const firstNodeId = await firstNode.getAttribute("data-id");
  await firstNode.locator(".mz-flow-node__header").click();
  await expect(firstNode).toHaveClass(/selected/);

  const before = await firstNode.boundingBox();
  if (!before) throw new Error("XYFlow node did not produce a bounding box");
  await firstNode.locator(".mz-flow-node__header").dragTo(root, {
    sourcePosition: { x: 70, y: 20 },
    targetPosition: { x: Math.min(before.x + 120, 520), y: Math.min(before.y + 100, 360) },
  });
  const after = await root.locator(`.react-flow__node[data-id="${firstNodeId}"]`).boundingBox();
  expect(after).not.toBeNull();
  expect(Math.abs((after?.x ?? before.x) - before.x) + Math.abs((after?.y ?? before.y) - before.y)).toBeGreaterThan(2);

  const quickControl = root.locator(".mz-flow-parameter input[type='range']").first();
  if (await quickControl.count()) {
    const originalValue = Number(await quickControl.inputValue());
    const minimum = Number(await quickControl.getAttribute("min"));
    const maximum = Number(await quickControl.getAttribute("max"));
    const nextValue = Math.abs(originalValue - minimum) > Math.abs(originalValue - maximum) ? minimum : maximum;
    await quickControl.evaluate((input, value) => {
      input.value = String(value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, nextValue);
    await expect(quickControl).toHaveValue(String(nextValue));
    await expect(page.locator("#patchSelect")).toHaveValue("");
  }

  await page.locator("#viewModeToggle").click();
  await expect(page.locator("#graphViewport")).toHaveAttribute("data-view-mode", "chain");
  await expect(root).toBeHidden();
  await expect(page.locator("#patchNodes")).toBeVisible();
  await page.locator("#viewModeToggle").click();
  await expect(page.locator("#graphViewport")).toHaveAttribute("data-view-mode", "patch");
  await expect(root).toBeVisible();

  await page.locator("#nextPatch").click();
  await expect(root.locator(".react-flow__node").first()).toBeVisible();

  const nodeCountBeforeCache = await root.locator(".react-flow__node").count();
  await page.evaluate(() => {
    dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
  });
  await expect(root).toBeVisible();
  await expect(root.locator(".react-flow__node")).toHaveCount(nodeCountBeforeCache);

  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  expect(
    pageDiagnosticMessages(diagnostics),
    formatPageDiagnostics(diagnostics),
  ).toEqual([]);
});

test("XYFlow can reconnect a cable source without treating its target as occupied", async ({ page }) => {
  await page.goto(xyflowUrl, { waitUntil: "domcontentloaded" });
  await settlePage(page);

  const root = page.locator("#xyflowGraphRoot");
  await root.scrollIntoViewIfNeeded();
  const edges = root.locator(".react-flow__edge");
  const edgeCount = await edges.count();
  const edge = root.locator('.react-flow__edge[data-id="pan-out"]');
  await edge.locator(".react-flow__edge-interaction").dispatchEvent("click");
  await expect(edge).toHaveClass(/selected/);

  const updater = edge.locator(".react-flow__edgeupdater-source");
  await expect(updater).toBeVisible();
  const alternateSource = root.locator(
    '.react-flow__node[data-id="vca"] .react-flow__handle.source',
  ).first();
  await expect(alternateSource).toBeVisible();
  const updaterBox = await updater.boundingBox();
  const sourceBox = await alternateSource.boundingBox();
  if (!updaterBox || !sourceBox) throw new Error("XYFlow reconnect endpoints did not produce boxes");
  const start = {
    x: updaterBox.x + updaterBox.width / 2,
    y: updaterBox.y + updaterBox.height / 2,
  };
  const target = {
    x: sourceBox.x + 2,
    y: sourceBox.y + sourceBox.height / 2,
  };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move((start.x + target.x) / 2, (start.y + target.y) / 2, { steps: 5 });
  await page.mouse.move(target.x, target.y, { steps: 5 });
  await page.mouse.up();

  await expect(page.locator("#connectionHint")).toContainText("Cable rerouted");
  await expect(edges).toHaveCount(edgeCount);
  await expect(root.locator('.react-flow__edge[data-id="pan-out"]')).toHaveAttribute(
    "aria-label",
    /Edge from vca to out/,
  );
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
});

test("XYFlow keyboard selection and movement persist in the canonical patch", async ({ page }) => {
  await page.goto(xyflowUrl, { waitUntil: "domcontentloaded" });
  await settlePage(page);

  const root = page.locator("#xyflowGraphRoot");
  await root.scrollIntoViewIfNeeded();
  const node = root.locator(".react-flow__node").nth(1);
  const nodeId = await node.getAttribute("data-id");
  const nodeLabel = (await node.locator(".mz-flow-node__identity b").textContent())?.trim();
  if (!nodeId || !nodeLabel) throw new Error("XYFlow keyboard test could not identify its module");
  const before = await node.boundingBox();
  if (!before) throw new Error("XYFlow keyboard module did not produce a bounding box");

  await node.focus();
  await page.keyboard.press("Enter");
  await expect(node).toHaveClass(/selected/);
  await expect(page.locator("#selectedNodeTitle")).toHaveText(nodeLabel);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");

  await page.locator("#viewModeToggle").click();
  await page.locator("#viewModeToggle").click();
  const movedNode = root.locator(`.react-flow__node[data-id="${nodeId}"]`);
  const after = await movedNode.boundingBox();
  if (!after) throw new Error("XYFlow keyboard module disappeared after a renderer round trip");
  expect(Math.abs(after.x - before.x) + Math.abs(after.y - before.y)).toBeGreaterThan(2);
  await expect(page.locator("#selectedNodeTitle")).toHaveText(nodeLabel);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
});

test("a hidden XYFlow selection cannot delete a cable from chain view", async ({ page }) => {
  await page.goto(xyflowUrl, { waitUntil: "domcontentloaded" });
  await settlePage(page);

  const root = page.locator("#xyflowGraphRoot");
  const edges = root.locator(".react-flow__edge");
  const edge = root.locator(".react-flow__edge[data-id='pan-out']");
  await expect(edge).toBeVisible();
  const edgeCount = await edges.count();
  await edge.locator(".react-flow__edge-interaction").dispatchEvent("click");
  await expect(edge).toHaveClass(/selected/);

  await page.locator("#viewModeToggle").click();
  await expect(page.locator("#graphViewport")).toHaveAttribute("data-view-mode", "chain");
  await expect(root).toBeHidden();
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("Delete");
  await page.locator("#viewModeToggle").click();

  await expect(root).toBeVisible();
  await expect(edges).toHaveCount(edgeCount);
  await expect(root.locator(".react-flow__edge[data-id='pan-out']")).toHaveCount(1);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
});

test("the XYFlow route falls back to the original canvas when its bundle is unavailable", async ({ page }) => {
  await page.route(
    /\/assets\/xyflow\/shader-synth-playground-xyflow\.js(?:\?.*)?$/,
    (route) => route.abort("failed"),
  );
  await page.goto(xyflowUrl, { waitUntil: "domcontentloaded" });
  await settlePage(page);

  await expect(page.locator("body")).toHaveAttribute("data-graph-renderer", "original");
  await expect(page.locator("#patchNodes")).toBeVisible();
  await expect(page.locator("#xyflowGraphRoot")).toBeHidden();
  await expect(page.locator("#graphRendererStatus")).toContainText("XYFlow unavailable");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
});

test("the XYFlow route falls back when its extracted stylesheet is unavailable", async ({ page }) => {
  await page.route(
    /\/assets\/xyflow\/shader-synth-playground-xyflow\.js(?:\?.*)?$/,
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 250));
      await route.continue();
    },
  );
  await page.route(
    /\/assets\/xyflow\/shader-synth-playground-xyflow\.css(?:\?.*)?$/,
    (route) => route.abort("failed"),
  );
  await page.goto(xyflowUrl, { waitUntil: "domcontentloaded" });
  await settlePage(page);

  await expect(page.locator("body")).toHaveAttribute("data-graph-renderer", "original");
  await expect(page.locator("#patchNodes")).toBeVisible();
  await expect(page.locator("#xyflowGraphRoot")).toBeHidden();
  await expect(page.locator("#graphRendererStatus")).toContainText("XYFlow unavailable");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await expect.poll(
    () => page.evaluate(() => typeof globalThis.MorphazoidShaderSynthGraphRenderer),
  ).toBe("undefined");
});

test("a one-finger swipe over XYFlow scrolls the page on a touch phone", async ({ browser }) => {
  const context = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  try {
    await page.goto(xyflowUrl, { waitUntil: "domcontentloaded" });
    await settlePage(page);
    const root = page.locator("#xyflowGraphRoot");
    await expect(root).toBeVisible();
    await root.evaluate((element) => {
      const maximumScroll = Math.max(0, document.documentElement.scrollHeight - innerHeight);
      const targetScroll = element.getBoundingClientRect().top + scrollY - 80;
      scrollTo(0, Math.min(targetScroll, Math.max(0, maximumScroll - 100)));
    });
    const before = await page.evaluate(() => scrollY);
    const start = await page.evaluate(() => {
      const rootElement = document.getElementById("xyflowGraphRoot");
      const rect = rootElement.getBoundingClientRect();
      const left = Math.max(12, rect.left + 12);
      const right = Math.min(innerWidth - 12, rect.right - 12);
      const top = Math.max(12, rect.top + 12);
      const bottom = Math.min(innerHeight - 80, rect.bottom - 12);
      for (const yRatio of [0.5, 0.35, 0.65, 0.2, 0.8]) {
        for (const xRatio of [0.5, 0.12, 0.88, 0.3, 0.7]) {
          const x = Math.round(left + (right - left) * xRatio);
          const y = Math.round(top + (bottom - top) * yRatio);
          if (document.elementFromPoint(x, y)?.classList.contains("react-flow__pane")) {
            return { x, y };
          }
        }
      }
      return { x: Math.round(left + 8), y: Math.round(top + 8) };
    });
    const session = await context.newCDPSession(page);
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [start],
    });
    for (let step = 1; step <= 5; step += 1) {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: start.x, y: start.y - step * 36 }],
      });
    }
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(before + 30);
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  } finally {
    await context.close();
  }
});

for (const layout of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone portrait", width: 390, height: 844 },
  { name: "phone landscape", width: 844, height: 390 },
]) {
  test(`XYFlow keeps its canvas and controls reachable at ${layout.name}`, async ({ page }) => {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    await page.goto(xyflowUrl, { waitUntil: "domcontentloaded" });
    await settlePage(page);
    await expect(page.locator("body")).toHaveAttribute("data-graph-renderer", "xyflow");
    await expect(page.locator("#xyflowGraphRoot")).toBeVisible();

    const report = await page.evaluate(() => {
      const root = document.getElementById("xyflowGraphRoot");
      const rect = root.getBoundingClientRect();
      const minimap = root.querySelector(".react-flow__minimap");
      return {
        documentOverflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
        rootWidth: rect.width,
        rootHeight: rect.height,
        minimapDisplay: minimap ? getComputedStyle(minimap).display : "missing",
        overflowCandidates: [...document.querySelectorAll("body *")]
          .map((element) => ({ element, rect: element.getBoundingClientRect() }))
          .filter(({ rect: candidate }) => candidate.width > 0 && (candidate.left < -2 || candidate.right > innerWidth + 2))
          .slice(0, 12)
          .map(({ element, rect: candidate }) => ({
            element: element.id ? `#${element.id}` : `.${[...element.classList].slice(0, 2).join(".")}`,
            left: Math.round(candidate.left),
            right: Math.round(candidate.right),
            width: Math.round(candidate.width),
          })),
      };
    });
    expect(report.documentOverflow, JSON.stringify(report.overflowCandidates)).toBeLessThanOrEqual(2);
    expect(report.rootWidth).toBeGreaterThan(300);
    expect(report.rootWidth).toBeLessThanOrEqual(layout.width + 2);
    expect(report.rootHeight).toBeGreaterThan(300);
    if (report.rootWidth < 1000 || report.rootHeight < 600 || layout.height <= 520) {
      expect(report.minimapDisplay).toBe("none");
    } else {
      expect(report.minimapDisplay).not.toBe("none");
    }
    await expect(page.locator("#graphRendererComparison")).toBeVisible();
  });
}
