import { expect, test } from "@playwright/test";

async function graphTopology(canvas) {
  return canvas.evaluate((host) => ({
    graphPath: host.querySelector("[data-graph-path]")?.getAttribute("data-graph-path") ?? null,
    nodes: [...host.querySelectorAll("[data-device-node-id]")]
      .map((node) => `${node.getAttribute("data-device-node-id")}:${node.getAttribute("data-node-kind")}`)
      .sort(),
    edges: [...host.querySelectorAll("[data-edge-id][data-signal-type]")]
      .map((edge) => `${edge.getAttribute("data-edge-id")}:${edge.getAttribute("data-signal-type")}`)
      .sort(),
  }));
}

test("Constellation, Live Flow, and Projected Timeline expose the same recursive typed patch", async ({ page }) => {
  const diagnostics = [];
  page.on("pageerror", (error) => diagnostics.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.push(message.text());
  });
  await page.goto("constellation.html", { waitUntil: "domcontentloaded" });

  const constellation = page.locator("#constellationCanvas");
  await expect(constellation).toBeVisible();
  await expect(constellation.locator("[data-graph-path]")).toBeVisible();
  const rootTopology = await graphTopology(constellation);
  expect(rootTopology.graphPath).toBeTruthy();
  expect(rootTopology.nodes.length).toBeGreaterThan(4);
  expect([...new Set(rootTopology.edges.map((edge) => edge.split(":").at(-1)))].sort()).toEqual([
    "audio",
    "control",
    "trigger",
  ]);
  await expect(constellation.locator('[data-node-kind="subgraph"]')).not.toHaveCount(0);
  await expect(constellation.locator('[data-signal-type="trigger"]')).not.toHaveCount(0);
  await expect(constellation.locator('[data-signal-type="audio"]')).not.toHaveCount(0);
  await expect(constellation.locator('[data-signal-type="control"]')).not.toHaveCount(0);

  await page.getByRole("tab", { name: /Live Flow/i }).click();
  const liveFlow = page.locator("#flowCanvas");
  await expect(liveFlow).toBeVisible();
  await expect(liveFlow.locator(".constellation-flow-ledger")).toBeVisible();
  expect(await graphTopology(liveFlow)).toEqual(rootTopology);

  await page.getByRole("tab", { name: /^Constellation/i }).click();
  const nestedGraph = constellation.locator('[data-device-node-id="voice"][data-node-kind="subgraph"]');
  await expect(nestedGraph).toContainText("Graph Synth");
  await nestedGraph.press("Enter");
  await expect(page.locator("#sectionTitle")).toHaveText("Graph Synth");
  await expect(page.locator("#graphBreadcrumb .graph-breadcrumb-item")).toHaveCount(2);
  await expect(page.locator("#graphBreadcrumb .graph-breadcrumb-item").last()).toBeDisabled();
  const childTopology = await graphTopology(constellation);
  expect(childTopology.graphPath).not.toBe(rootTopology.graphPath);
  expect(childTopology.nodes.some((node) => node.endsWith(":primitive"))).toBe(true);
  expect(childTopology.nodes.some((node) => node.endsWith(":port"))).toBe(true);

  await page.locator("#graphBreadcrumb").getByRole("button", { name: "Patch", exact: true }).click();
  await expect(constellation.locator("[data-graph-path]")).toHaveAttribute("data-graph-path", rootTopology.graphPath ?? "");

  await page.getByRole("tab", { name: /Projected Timeline/i }).click();
  const timeline = page.locator("#timelineCanvas");
  await expect(timeline).toBeVisible();
  await expect(timeline.locator("[data-projected-event-id]").first()).toBeVisible();
  const projectedSignals = await timeline.locator("[data-projected-event-id][data-signal-type]").evaluateAll((events) => (
    [...new Set(events.map((event) => event.getAttribute("data-signal-type")))].sort()
  ));
  expect(projectedSignals).toEqual(["control", "trigger"]);

  await page.getByRole("tab", { name: /^Constellation/i }).click();
  const beforeInsert = (await graphTopology(constellation)).nodes.length;
  const palette = page.locator("#instrumentBrowser");
  await palette.getByRole("button", { name: "effect", exact: true }).click();
  const filterCard = palette.locator('[data-device-id="filter"]');
  await expect(filterCard).toContainText("Filter Graph");
  await filterCard.getByRole("button", { name: "Insert graph", exact: true }).click();
  await expect(constellation.locator("[data-device-node-id]")).toHaveCount(beforeInsert + 1);
  await expect(constellation.locator('[data-device-node-id="filter"][data-node-kind="subgraph"]')).toBeVisible();
  await expect(page.locator("#inspector")).toContainText("Filter Graph");

  expect(diagnostics).toEqual([]);
});

test("Constellation remains navigable across graph views in a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("constellation.html", { waitUntil: "domcontentloaded" });

  await expect(page.locator("#constellationCanvas")).toBeVisible();
  await expect(page.locator("#constellationCanvas [data-device-node-id]").first()).toBeVisible();
  await expect(page.locator("#graphBreadcrumb")).toBeVisible();
  await expect(page.locator("#instrumentBrowser")).toBeVisible();

  await page.getByRole("tab", { name: /Live Flow/i }).click();
  await expect(page.locator("#flowCanvas [data-graph-path]")).toBeVisible();
  await expect(page.locator("#flowCanvas .constellation-flow-ledger")).toBeVisible();

  await page.getByRole("tab", { name: /Projected Timeline/i }).click();
  await expect(page.locator("#timelineCanvas")).toBeVisible();
  await expect(page.locator("#timelineCanvas [data-projected-event-id]").first()).toBeVisible();
});

test("Constellation audio and graph transport start only from explicit gestures", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("constellation.html", { waitUntil: "domcontentloaded" });

  await expect(page.locator("#audioState")).toHaveText("off");
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#transportPosition")).toHaveText(/CYCLE 1 · BEAT 1\.00/);

  await page.locator("#audioButton").click();
  await expect(page.locator("#audioState")).toHaveText("on", { timeout: 10_000 });
  await page.locator("#playButton").click();
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#playButton")).toContainText("Pause");
  await expect(page.locator("#liveStatus")).toContainText("Patch running");

  await page.locator("#stopButton").click();
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#playButton")).toContainText("Run");
  await expect(page.locator("#transportPosition")).toHaveText(/CYCLE 1 · BEAT 1\.00/);
  expect(pageErrors).toEqual([]);
});
