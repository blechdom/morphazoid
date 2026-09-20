import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readAudioStatus, sampleAudioEnvelope } from "./helpers/audio-probe.mjs";
const state = (page) => page.locator("#stage").evaluate((c) => JSON.parse(c.dataset.state));
async function ready(page) {
  await page.goto("/graph-3d.html");
  await expect(page.locator("#stage")).toHaveAttribute("data-state", /"nodes"/);
  await expect(page.locator(".instrument-picker")).toHaveAttribute("data-active-tool-id", "graph-3d");
}
async function arm(page) {
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(1);
}
async function range(page, id, value) {
  await page.locator(`#${id}`).evaluate((e, v) => {
    e.value = String(v); e.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}
async function dragNode(page, index, dx, dy, depth = false, cancel = false) {
  await page.locator("#stage").scrollIntoViewIfNeeded();
  const s = await state(page), box = await page.locator("#stage").boundingBox(), p = s.projected[index];
  if (depth) await page.keyboard.down("Shift");
  await page.mouse.move(box.x + p.x, box.y + p.y);
  await page.mouse.down(); await page.mouse.move(box.x + p.x + dx, box.y + p.y + dy, { steps: 8 });
  if (cancel) await page.locator("#stage").dispatchEvent("pointercancel", { pointerId: 1, pointerType: "mouse" });
  await page.mouse.up();
  if (depth) await page.keyboard.up("Shift");
}

test("explicit Audio, native scheduled sound, silent transport, live scene changes and panic", async ({ page }) => {
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await ready(page);
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  await page.locator("#playButton").click();
  await expect.poll(async () => (await state(page)).arrivals).toBeGreaterThan(0);
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  await expect(page.locator("#liveStatus")).toContainText("Audio is off");
  await arm(page);
  const signal = await sampleAudioEnvelope(page, { durationMs: 1800 });
  expect(signal.summary.finite).toBe(true); expect(signal.summary.maxRms).toBeGreaterThan(0.001);
  expect(signal.summary.maxPeak).toBeLessThan(0.95); expect(signal.summary.clippedSamples).toBe(0);
  await page.locator("#scene").selectOption("Helical return");
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#panicButton").click();
  await expect.poll(async () => (await state(page)).pending).toBe(0);
  await page.waitForTimeout(500);
  expect((await sampleAudioEnvelope(page, { durationMs: 250 })).summary.maxRms).toBeLessThan(0.0001);
  await page.locator("#sendButton").click();
  expect((await sampleAudioEnvelope(page, { durationMs: 700 })).summary.maxRms).toBeGreaterThan(0.001);
  await page.locator("#audioButton").click(); await page.waitForTimeout(300);
  expect((await sampleAudioEnvelope(page, { durationMs: 250 })).summary.maxRms).toBeLessThan(0.0001);
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(0);
  expect(errors).toEqual([]);
});

test("all scenes are playable with bounded audio; modulation controls reflect voice capability", async ({ page }) => {
  test.setTimeout(120_000);
  await ready(page); await arm(page); await page.locator("#playButton").click();
  const scenes = await page.locator("#scene option:not([disabled])").allTextContents();
  expect(scenes.length).toBe(30);
  const metrics = [];
  for (const scene of scenes) {
    await page.locator("#scene").selectOption(scene);
    await expect(page.locator("#tuning")).toHaveValue("free");
    const signal = await sampleAudioEnvelope(page, { durationMs: 800 });
    expect(signal.summary.maxRms, scene).toBeGreaterThan(0.0005);
    expect(signal.summary.clippedSamples, scene).toBe(0);
    expect(signal.summary.finite, scene).toBe(true);
    expect(signal.summary.maxPeak, scene).toBeLessThan(0.95);
    metrics.push({ scene, ...signal.summary });
    expect((await state(page)).pending).toBeLessThanOrEqual(1024);
  }
  await test.info().attach("preset-audio-metrics", { body: JSON.stringify(metrics, null, 2), contentType: "application/json" });
  await page.locator("#soundMode").selectOption("sine");
  await expect(page.locator("#modulationIndex")).toBeDisabled(); await expect(page.locator("#strain")).toBeDisabled();
  await page.locator("#soundMode").selectOption("pm");
  await expect(page.locator("#strain")).toBeEnabled();
});

test("seed 68, continuous tuning, assignable sources and info dialog agree", async ({ page }) => {
  await ready(page);
  await expect(page.locator("#rootMidiNote")).toHaveValue("68");
  await expect(page.locator("#tuning")).toHaveValue("free");
  await expect(page.locator("#motion")).not.toBeChecked();
  await expect(page.locator(".graph-3d-title")).not.toContainText("routes in space");
  await page.locator("#playButton").click();
  const before = (await state(page)).arrivals;
  await page.locator("#infoButton").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator("#infoClose")).toBeFocused();
  await expect(page.getByRole("dialog")).toContainText("automatically pins");
  await expect.poll(async () => (await state(page)).arrivals).toBeGreaterThan(before);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.locator("#infoButton")).toBeFocused();
  for (const [id, value] of [["timeSource", "x"], ["mapping", "depth"], ["timbreSource", "height"], ["shadeSource", "radius"], ["panSource", "depth"]]) {
    await page.locator(`#${id}`).selectOption(value);
    await expect.poll(async () => (await state(page)).settings[id]).toBe(value);
  }
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  await page.locator("#savePatch").click();
  await page.locator("#resetAll").click();
  await page.locator("#loadPatch").click();
  await expect(page.locator("#timeSource")).toHaveValue("x");
  await expect(page.locator("#mapping")).toHaveValue("depth");
  await expect(page.locator("#timbreSource")).toHaveValue("height");
  await page.locator("#panSource").selectOption("none");
  await expect(page.locator("#spread")).toBeDisabled();
});

test("drag, sliders and keyboard edits stay put; cancellation restores exact positions and pins", async ({ page }) => {
  await ready(page);
  const initial = (await state(page)).nodes[0];
  await dragNode(page, 0, 30, 20, false, true);
  await expect.poll(async () => (await state(page)).nodes[0]).toEqual(initial);
  await dragNode(page, 0, 28, 18);
  await expect.poll(async () => (await state(page)).nodes[0].pinned).toBe(true);
  const dragged = (await state(page)).nodes[0];
  await page.locator("#motion").check();
  await page.waitForTimeout(800);
  expect((await state(page)).nodes[0]).toEqual(dragged);
  await page.locator("#nodeSelect").selectOption("2");
  await range(page, "nodeX", 0.2);
  await expect.poll(async () => (await state(page)).nodes[2].pinned).toBe(true);
  const slider = (await state(page)).nodes[2];
  await page.waitForTimeout(500);
  expect((await state(page)).nodes[2]).toEqual(slider);
  await page.locator("#stage").focus();
  await page.keyboard.press("]"); await page.keyboard.press("Shift+ArrowRight");
  await expect.poll(async () => (await state(page)).nodes[3].pinned).toBe(true);
  const keyboard = (await state(page)).nodes[3];
  await page.waitForTimeout(500);
  expect((await state(page)).nodes[3]).toEqual(keyboard);
  await page.locator("#scene").selectOption("Orbital branches");
  await expect.poll(async () => (await state(page)).nodes[0]).toEqual(initial);
  expect((await state(page)).nodes.every((n) => !n.pinned)).toBe(true);
});

test("camera orbit, zoom and view buttons do not edit the 3D graph; node drags do", async ({ page }) => {
  await ready(page);
  const initial = await state(page), box = await page.locator("#stage").boundingBox();
  await page.mouse.move(box.x + 90, box.y + box.height * 0.55); await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + box.height * 0.55 + 50, { steps: 10 }); await page.mouse.up();
  await expect.poll(async () => (await state(page)).camera.yaw).not.toBe(initial.camera.yaw);
  expect((await state(page)).nodes).toEqual(initial.nodes);
  expect((await state(page)).edges).toEqual(initial.edges);
  await page.locator("#zoomIn").click(); await page.locator("#viewSide").click();
  expect((await state(page)).nodes).toEqual(initial.nodes);
  await page.locator("#viewReset").click();
  await expect.poll(async () => (await state(page)).camera).toEqual(initial.camera);
  await dragNode(page, 0, 45, 25);
  await expect.poll(async () => (await state(page)).nodes[0]).not.toEqual(initial.nodes[0]);
  const moved = (await state(page)).nodes[0];
  await dragNode(page, 0, 0, -35, true);
  await expect.poll(async () => (await state(page)).nodes[0].z).not.toBe(moved.z);
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
});

test("live force controls reorganize positions, pins survive, camera remains untouched", async ({ page }) => {
  await ready(page);
  const before = await state(page);
  await page.locator("#pinNode").click();
  await range(page, "repel", 0.8); await range(page, "shell", 0.7);
  await page.locator("#motion").check();
  await expect.poll(async () => (await state(page)).nodes[2]).not.toEqual(before.nodes[2]);
  const after = await state(page);
  expect(after.nodes[0].x).toBe(before.nodes[0].x);
  expect(after.nodes[0].y).toBe(before.nodes[0].y);
  expect(after.nodes[0].z).toBe(before.nodes[0].z);
  expect(after.camera).toEqual(before.camera);
  await page.locator("#motion").uncheck();
  await page.waitForTimeout(150); const stopped = (await state(page)).nodes;
  await page.waitForTimeout(180); expect((await state(page)).nodes).toEqual(stopped);
  await page.locator("#releasePins").click();
  await expect.poll(async () => (await state(page)).nodes[0].pinned).toBe(false);
});

test("depth/folding edit spatial routes; route switches, saved patches and reset stay consistent", async ({ page }) => {
  await ready(page);
  await range(page, "depth", 1.2);
  await range(page, "nodeZ", 0.7);
  await expect(page.locator("#nodeZOut")).toHaveText("0.70");
  const route = await page.locator("#routeReadout").textContent();
  await range(page, "twist", -0.8);
  await expect(page.locator("#routeReadout")).not.toHaveText(route);
  await page.locator("#routeSwitch").click();
  await expect.poll(async () => (await state(page)).edges[0].enabled).toBe(false);
  await page.locator("#savePatch").click();
  const stored = await state(page);
  await page.locator("#resetAll").click();
  await page.locator("#loadPatch").click();
  await expect.poll(async () => (await state(page)).nodes).toEqual(stored.nodes);
  expect((await state(page)).edges).toEqual(stored.edges);
  await page.evaluate(() => localStorage.setItem("morphazoid.graph-3d.v1", '{"version":1,"nodes":[]}'));
  await page.locator("#loadPatch").click();
  await expect(page.locator("#audioError")).toBeVisible();
  expect((await state(page)).nodes).toEqual(stored.nodes);
});

for (const [name, width, height] of [["desktop",1440,900],["phone",390,844],["landscape",844,390]]) {
  test(`${name}: keyboard, painting and controls remain reachable and accessible`, async ({ page }) => {
    await page.setViewportSize({ width, height }); await ready(page);
    await expect(page.getByRole("heading", { name: "3D Graph", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const clipped = await page.locator(".graph-3d-panel output").evaluateAll((outputs) =>
      outputs.filter((o) => o.scrollWidth > o.clientWidth + 1).map((o) => o.id));
    expect(clipped).toEqual([]);
    const pixels = await page.locator("#stage").evaluate((c) => {
      const data = c.getContext("2d").getImageData(0,0,c.width,c.height).data;
      let bright=0;for(let i=0;i<data.length;i+=4)if(data[i]+data[i+1]+data[i+2]>170)bright++;
      return bright;
    });
    expect(pixels).toBeGreaterThan(150);
    await page.locator("#stage").focus();const initial = await state(page);
    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await state(page)).camera.yaw).not.toBe(initial.camera.yaw);
    await page.keyboard.press("]");
    await expect.poll(async () => (await state(page)).selected).toBe(1);
    await page.keyboard.press("Shift+ArrowUp");
    await expect.poll(async () => (await state(page)).nodes[1]).not.toEqual(initial.nodes[1]);
    await page.keyboard.press("Enter");
    expect((await readAudioStatus(page)).connectionCount).toBe(0);
    await page.locator("#loadPatch").scrollIntoViewIfNeeded();await expect(page.locator("#loadPatch")).toBeInViewport();
    const a11y = await new AxeBuilder({ page }).include(".graph-3d-shell").withTags(["wcag2a","wcag2aa"]).analyze();
    expect(a11y.violations.filter((v) => ["critical","serious"].includes(v.impact))).toEqual([]);
    await page.locator("#infoButton").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    const dialog = await page.getByRole("dialog").boundingBox();
    expect(dialog.x).toBeGreaterThanOrEqual(0); expect(dialog.y).toBeGreaterThanOrEqual(0);
    expect(dialog.width).toBeLessThanOrEqual(width); expect(dialog.height).toBeLessThanOrEqual(height);
    await page.getByRole("dialog").getByRole("link").scrollIntoViewIfNeeded();
    await expect(page.getByRole("dialog").getByRole("link")).toBeInViewport();
    const helpA11y = await new AxeBuilder({ page }).include("#infoDialog").withTags(["wcag2a","wcag2aa"]).analyze();
    expect(helpA11y.violations.filter((v) => ["critical","serious"].includes(v.impact))).toEqual([]);
    await page.keyboard.press("Escape");
  });
}

test("MIDI note handoff, blocked Audio initialization and teardown do not auto-arm", async ({ page }) => {
  await ready(page);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("morphazoid:midi-input", {
    cancelable: true, detail: { routeId:"graph-3d", message:{type:"noteOn",note:65,velocity:90} },
  })));
  await expect.poll(async () => (await state(page)).arrivals).toBeGreaterThan(0);
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  await page.locator("#audioButton").evaluate((b) => { b.click(); b.click(); });
  await page.waitForTimeout(250);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed","false");
  const silence=await sampleAudioEnvelope(page,{durationMs:200});expect(silence.summary.maxRms).toBeLessThan(.0001);
});

test("touch orbit cancels capture cleanly; coarse Audio/Play targets remain 48px", async ({ browser, baseURL }) => {
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const page=await context.newPage();
  try {
    await page.goto(`${baseURL}/graph-3d.html`);await expect(page.locator("#stage")).toHaveAttribute("data-state",/"nodes"/);
    for(const id of ["audioButton","playButton"]){const box=await page.locator(`#${id}`).boundingBox();expect(box.width).toBeGreaterThanOrEqual(48);expect(box.height).toBeGreaterThanOrEqual(48);}
    const initial=await state(page),box=await page.locator("#stage").boundingBox(),cdp=await context.newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:box.x+40,y:box.y+260}]});
    await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:box.x+110,y:box.y+300}]});
    await cdp.send("Input.dispatchTouchEvent",{type:"touchCancel",touchPoints:[]});
    await expect.poll(async()=>(await state(page)).camera.yaw).not.toBe(initial.camera.yaw);
    await expect(page.locator("#stage")).not.toHaveClass(/is-dragging/);
    await page.locator("#loadPatch").scrollIntoViewIfNeeded();await expect(page.locator("#loadPatch")).toBeInViewport();
    expect((await readAudioStatus(page)).connectionCount).toBe(0);
  } finally {await context.close();}
});
