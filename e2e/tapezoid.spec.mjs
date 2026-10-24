import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { readAudioStatus, sampleAudioEnvelope, waitForStableAudioState } from "./helpers/audio-probe.mjs";
import { collectControlInventory, exerciseRangeMathematics } from "./helpers/control-inventory.mjs";
import { settlePage, watchPageDiagnostics, pageDiagnosticMessages } from "./helpers/diagnostics.mjs";
import { buildPath, copyNodes, headDelaySeconds, tapeTimeline } from "../src/instruments/tapezoid/path.js";

const snapshot = page => page.evaluate(() => window.__tapezoid.snapshot());
function firstReadSeconds(state) {
  const factory = copyNodes();
  const path = buildPath([factory[0], ...state.rollers.map(roller => ({ ...roller, kind: "roller" })),
    ...factory.slice(-2)]);
  const write = state.headParts.find(head => head.kind === "record");
  const read = state.headParts.find(head => head.kind === "play");
  return headDelaySeconds(path, state.pools, write.position, read.position, tapeTimeline(path, state.pools));
}
async function expectTransportMatchesCassette(page) {
  const { width, projected } = await page.evaluate(() => {
    const { cassetteRender, cameraFrame } = window.__tapezoid.snapshot();
    return {
      width: document.querySelector(".tapezoid-deck").getBoundingClientRect().width,
      projected: cassetteRender.width * document.querySelector("#scene").clientHeight
        / (2 * cameraFrame.halfHeight),
    };
  });
  expect(width).toBeCloseTo(projected, 0);
}
async function expectTransportKeysVisible(page) {
  const layout = await page.evaluate(() => {
    const deck = document.querySelector(".tapezoid-deck").getBoundingClientRect();
    const keys = document.querySelector(".tapezoid-transport");
    return {
      scrollWidth: keys.scrollWidth, clientWidth: keys.clientWidth,
      buttons: [...keys.querySelectorAll("button")].map(button => {
        const rect = button.getBoundingClientRect();
        const symbol = button.querySelector("span");
        return {
          speed: Number(button.dataset.speed), left: rect.left, right: rect.right,
          top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height,
          inside: rect.left >= deck.left - 1 && rect.right <= deck.right + 1
            && rect.top >= deck.top - 1 && rect.bottom <= deck.bottom + 1,
          hit: document.elementFromPoint(rect.left + rect.width / 2,
            rect.top + rect.height / 2)?.closest("button") === button,
          symbolFits: symbol.scrollWidth <= symbol.clientWidth + 1,
        };
      }),
    };
  });
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
  expect(layout.buttons.map(button => button.speed)).toEqual([-4, -1, 0, 1, 4]);
  for (const button of layout.buttons) {
    expect(button.width).toBeGreaterThan(0);
    expect(button.height).toBeGreaterThan(0);
    expect(button.inside).toBe(true);
    expect(button.hit).toBe(true);
    expect(button.symbolFits).toBe(true);
  }
}
const sizes = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 320, height: 568 },
];

async function ready(page, { cassette = "bundled" } = {}) {
  await page.goto("tapezoid.html");
  await settlePage(page);
  await expect(page.locator(".header-preset-controls[data-instrument-id='tapezoid']")).toBeVisible();
  await expect(page.locator("#scene canvas")).toBeVisible();
  if (cassette) await expect(page.locator("#scene")).toHaveAttribute("data-cassette-model", cassette);
}

// Project a real model handle or tape fraction through the overhead orthographic
// camera. Pointer/touch events still go through the public gesture surface.
async function workbenchPoint(page, target) {
  return page.evaluate(async target => {
    const THREE = await import("/vendor/three/three.module.min.js");
    const { buildPath, clampRoller, copyNodes, forkTiming, pointOnSplitLane, pointOnTape, poolCenter }
      = await import("/src/instruments/tapezoid/path.js");
    const live = window.__tapezoid.snapshot();
    const anchors = copyNodes();
    const nodes = [anchors[0], ...live.rollers.map(roller => ({ ...roller, kind: "roller" })),
      ...anchors.slice(-2)];
    const path = buildPath(nodes);
    const fork = live.split && forkTiming(path, live.pools, live.split);
    const model = target.kind === "roller"
      ? live.rollers.find(roller => roller.id === target.id)
      : target.kind === "guide" ? live.split.guides.find(guide => guide.id === target.id)
      : target.kind === "branch" ? pointOnSplitLane(fork.lanes.find(lane => lane.id === target.id), target.progress)
      : target.kind === "post-offset" ? (() => {
        const point = pointOnTape(path, target.position);
        return clampRoller(point.x - point.tz * target.offset, point.z + point.tx * target.offset);
      })()
      : target.kind === "pool" ? (() => {
        const pool = live.pools.find(item => item.id === target.id);
        return pool.laneId
          ? fork.lanes.find(lane => lane.id === pool.laneId).pools.find(item => item.id === pool.id).track.center
          : poolCenter(path, pool);
      })()
      : target.kind === "headId"
        ? pointOnTape(path, live.headParts.find(head => head.id === target.id).position)
      : target.kind === "head" ? pointOnTape(path, live.heads[target.index])
        : target.kind === "tape" ? pointOnTape(path, target.position) : target;
    const element = document.querySelector("#scene");
    const rect = element.getBoundingClientRect();
    const aspect = rect.width / rect.height;
    const halfHeight = live.cameraFrame.halfHeight;
    const camera = new THREE.OrthographicCamera(-halfHeight * aspect, halfHeight * aspect, halfHeight, -halfHeight, .1, 100);
    camera.up.set(0, 0, -1);
    camera.position.set(0, 18, live.cameraFrame.centerZ);
    camera.lookAt(0, .2, live.cameraFrame.centerZ);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    const projected = new THREE.Vector3(model.x, .42, model.z).project(camera);
    return {
      x: rect.left + (projected.x + 1) * rect.width / 2,
      y: rect.top + (1 - projected.y) * rect.height / 2,
    };
  }, target);
}

async function setLevel(page, value) {
  await page.locator("#outputLevel").evaluate((field, next) => {
    field.value = String(next);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

function localToneWav() {
  const rate = 24000, frames = rate * 2, channels = 2;
  const bytes = Buffer.alloc(44 + frames * channels * 2);
  bytes.write("RIFF", 0); bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(channels, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * channels * 2, 28);
  bytes.writeUInt16LE(channels * 2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(frames * channels * 2, 40);
  for (let i = 0; i < frames; i++) {
    const value = Math.sin(2 * Math.PI * 220 * i / rate);
    bytes.writeInt16LE(Math.round(value * 15000), 44 + i * 4);
    bytes.writeInt16LE(Math.round(value * 9000), 46 + i * 4);
  }
  return bytes;
}

// A tiny, self-contained tetrahedron in binary glTF 2.0 exercises the
// session-only loader independently of the bundled, attributed artist model.
function localCassetteGlb(externalImage = false) {
  const positions = [-1, -.09, -.4, 1, -.09, -.4, 0, .09, .4, 0, -.09, .4];
  const triangles = [0, 2, 1, 0, 1, 3, 1, 2, 3, 2, 0, 3];
  const binary = Buffer.alloc(72);
  positions.forEach((value, index) => binary.writeFloatLE(value, index * 4));
  triangles.forEach((value, index) => binary.writeUInt16LE(value, 48 + index * 2));
  const model = {
    asset: { version: "2.0" }, scene: 0,
    scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    buffers: [{ byteLength: binary.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 48, target: 34962 },
      { buffer: 0, byteOffset: 48, byteLength: 24, target: 34963 }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 4, type: "VEC3",
        min: [-1, -.09, -.4], max: [1, .09, .4] },
      { bufferView: 1, componentType: 5123, count: 12, type: "SCALAR", min: [0], max: [3] },
    ],
  };
  if (externalImage) model.images = [{ uri: "https://example.com/should-not-load.png" }];
  const json = Buffer.from(JSON.stringify(model));
  const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 0x20);
  json.copy(padded);
  const glb = Buffer.alloc(12 + 8 + padded.length + 8 + binary.length);
  glb.writeUInt32LE(0x46546c67, 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8);
  glb.writeUInt32LE(padded.length, 12); glb.writeUInt32LE(0x4e4f534a, 16);
  padded.copy(glb, 20);
  const binaryOffset = 20 + padded.length;
  glb.writeUInt32LE(binary.length, binaryOffset); glb.writeUInt32LE(0x004e4942, binaryOffset + 4);
  binary.copy(glb, binaryOffset + 8);
  return glb;
}

test("the Morphazoid menu, preset rail and overhead cassette deck remain usable at four sizes", async ({ page, baseURL }) => {
  test.setTimeout(60_000); // Four viewports, with software WebGL resize.
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await ready(page);
  await expect(page.locator(".instrument-picker[data-active-tool-id='tapezoid']")).toBeVisible();
  await expect(page.locator("#trackName")).toHaveText("Afterimage · original track");
  await expect(page.locator(".tapezoid-deck")).toBeVisible();
  await expect(page.locator(".tapezoid-toolbar")).toBeVisible();
  await expect(page.locator("#tapeStatus")).toBeEmpty();
  await expect(page.locator("#trackClock")).toBeVisible();
  await expect(page.locator("#speedValue")).toBeVisible();
  await expect(page.locator("#firstReadDelay")).toHaveText(/^\d+\.\d{2} s$/);
  await expect(page.locator(".tapezoid-first-listen summary")).toHaveText("What changes the sound?");
  const chrome = await page.evaluate(() => {
    const style = selector => getComputedStyle(document.querySelector(selector));
    return {
      deckShadow: style(".tapezoid-deck").boxShadow,
      keyShadow: style(".tapezoid-transport button[aria-pressed='true']").boxShadow,
      keyTextShadow: style(".tapezoid-transport button[aria-pressed='true']").textShadow,
      keyGradient: style(".tapezoid-transport button[aria-pressed='true']").backgroundImage,
      titleShadow: style(".tapezoid-title").textShadow,
      toolbarShadow: style(".tapezoid-toolbar").boxShadow,
      activeToolShadow: style(".tapezoid-toolbar button[aria-pressed='true']").boxShadow,
      poolShadow: style(".tapezoid-pool-adjust").boxShadow,
    };
  });
  expect(Object.values(chrome)).toEqual(Array(Object.keys(chrome).length).fill("none"));
  await expect(page.locator(".tapezoid-panel .tapezoid-transport")).toHaveCount(0);
  await expect(page.locator(".tapezoid-panel [data-tool]")).toHaveCount(0);
  await expect(page.locator(".tapezoid-readouts, .tapezoid-workspace-head, .tapezoid-stage-hint")).toHaveCount(0);
  await expect(page.locator(".output-recording-control")).toBeVisible();
  await expect(page.locator(".header-output-meter-shell")).toBeVisible();
  await expect(page.locator(".header-settings-trigger")).toBeVisible();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  for (const size of sizes) {
    await page.setViewportSize(size);
    await settlePage(page);
    // The control rail intentionally preserves its scroll position on rotate;
    // inspect its top, then verify recovery remains reachable by scrolling.
    await page.locator(".tapezoid-panel").evaluate(panel => { panel.scrollTop = 0; });
    const layout = await page.evaluate(() => {
      const rect = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
      const panel = document.querySelector(".tapezoid-panel");
      return {
        documentWidth: document.documentElement.scrollWidth,
        stage: rect("#scene"), deck: rect(".tapezoid-deck"), toolbar: rect(".tapezoid-toolbar"),
        title: rect(".tapezoid-title"), panel: rect(".tapezoid-panel"),
        preset: rect(".tapezoid-panel .header-preset-controls"),
        play: rect("#playButton"), audio: rect("#audioButton"),
        panelScrollHeight: panel.scrollHeight, panelClientHeight: panel.clientHeight,
        panelOverflow: getComputedStyle(panel).overflowY,
      };
    });
    expect(layout.documentWidth).toBeLessThanOrEqual(size.width + 1);
    for (const part of [layout.stage, layout.deck, layout.toolbar, layout.panel, layout.preset, layout.play, layout.audio]) {
      expect(part.width).toBeGreaterThan(0);
      expect(part.x).toBeGreaterThanOrEqual(0);
      expect(part.right).toBeLessThanOrEqual(size.width + 1);
      expect(part.y).toBeGreaterThanOrEqual(0);
      expect(part.top).toBeLessThan(size.height);
    }
    const cassetteBack = await workbenchPoint(page, { x: 0, z: -4.1 });
    const { cassetteRender } = await snapshot(page);
    expect(cassetteRender.visible).toBe(true);
    const cassetteLeft = await workbenchPoint(page, { x: -cassetteRender.width / 2, z: -3.02 });
    const cassetteRight = await workbenchPoint(page, { x: cassetteRender.width / 2, z: -3.02 });
    const visualWidth = cassetteRight.x - cassetteLeft.x;
    expect(layout.deck.top).toBeGreaterThanOrEqual(layout.stage.top + 8);
    expect(layout.toolbar.left).toBeGreaterThanOrEqual(layout.stage.right - 1);
    expect(layout.toolbar.right).toBeLessThanOrEqual(
      layout.panel.left > layout.stage.left ? layout.panel.left + 1 : size.width + 1);
    expect(layout.toolbar.width).toBeLessThanOrEqual(50);
    expect(layout.toolbar.top).toBeCloseTo(layout.stage.top, 0);
    expect(layout.toolbar.bottom).toBeLessThanOrEqual(layout.stage.bottom);
    for (const geometry of await page.locator(".tapezoid-toolbar button").evaluateAll(buttons => buttons.map(button => {
      const rect = button.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    }))) {
      expect(geometry.width).toBeGreaterThanOrEqual(35);
      expect(geometry.width).toBeLessThanOrEqual(44);
      expect(geometry.height).toBeLessThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.elementFromPoint(
      document.querySelector("#scene").getBoundingClientRect().right - 5,
      document.querySelector("#scene").getBoundingClientRect().bottom - 5,
    )?.closest("#scene")?.id)).toBe("scene");
    expect(layout.deck.bottom).toBeLessThan(cassetteBack.y - 2);
    expect(cassetteBack.y - layout.deck.bottom).toBeLessThan(13);
    expect(layout.deck.x + layout.deck.width / 2).toBeCloseTo((cassetteLeft.x + cassetteRight.x) / 2, 0);
    expect(layout.deck.width).toBeCloseTo(visualWidth, 0);
    await expectTransportKeysVisible(page);
    const titleOverlapsDeck = layout.title.x < layout.deck.right && layout.title.right > layout.deck.x
      && layout.title.y < layout.deck.bottom && layout.title.bottom > layout.deck.y;
    expect(titleOverlapsDeck).toBe(false);
    expect(layout.play.x).toBeGreaterThanOrEqual(layout.deck.x);
    expect(layout.play.right).toBeLessThanOrEqual(layout.deck.right + 1);
    if (size.width < 900) {
      expect(layout.play.width).toBeGreaterThanOrEqual(48);
      expect(layout.play.height).toBeGreaterThanOrEqual(48);
      expect(layout.audio.width).toBeGreaterThanOrEqual(48);
      expect(layout.audio.height).toBeGreaterThanOrEqual(48);
      expect(layout.panelOverflow).toBe("auto");
      await page.locator("#resetButton").scrollIntoViewIfNeeded();
      await expect(page.locator("#resetButton")).toBeInViewport();
      const pinned = await page.evaluate(() => {
        const rail = document.querySelector(".tapezoid-panel").getBoundingClientRect();
        const row = document.querySelector(".tapezoid-panel .header-preset-controls").getBoundingClientRect();
        return { railTop: rail.top, railBottom: rail.bottom, rowTop: row.top, rowBottom: row.bottom };
      });
      expect(pinned.rowTop).toBeGreaterThanOrEqual(pinned.railTop - 1);
      expect(pinned.rowBottom).toBeLessThanOrEqual(pinned.railBottom + 1);
      await page.locator("#eraseTool").scrollIntoViewIfNeeded();
      await expect(page.locator("#eraseTool")).toBeInViewport();
    }
  }
  // Both visible cassette models, not just the hidden generated shell, turn
  // their reel geometry in the same direction.
  const artist = await snapshot(page);
  await page.waitForTimeout(170);
  const laterArtist = await snapshot(page);
  expect(artist.reelAngles).toHaveLength(2);
  expect(laterArtist.reelAngles[0] - artist.reelAngles[0]).toBeGreaterThan(0);
  expect(laterArtist.reelAngles[1] - artist.reelAngles[1])
    .toBeCloseTo(laterArtist.reelAngles[0] - artist.reelAngles[0], 6);
  await page.locator("#stockCassette").click();
  await expect(page.locator("#scene")).toHaveAttribute("data-cassette-model", "stock");
  await expectTransportMatchesCassette(page);
  await expectTransportKeysVisible(page);
  const reels = await snapshot(page);
  await page.waitForTimeout(170);
  const later = await snapshot(page);
  expect(reels.reelAngles).toHaveLength(2);
  expect(later.reelAngles[0] - reels.reelAngles[0]).toBeGreaterThan(0);
  expect(later.reelAngles[1] - reels.reelAngles[1])
    .toBeCloseTo(later.reelAngles[0] - reels.reelAngles[0], 6);
  await page.locator("#bundledCassette").click();
  await expect(page.locator("#scene")).toHaveAttribute("data-cassette-model", "bundled");
  await expectTransportMatchesCassette(page);
  await expectTransportKeysVisible(page);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("the first REC-to-PLAY readout follows the audible route; TIME is display-only", async ({ page, baseURL }) => {
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await ready(page);
  const original = await snapshot(page);
  expect(original).toMatchObject({
    speed: 1, audioOn: false, voices: 1, phaseSlip: 0,
    printing: true, monitorMix: .75, echoReturn: 0,
  });
  await expect(page.locator("#firstReadHeads")).toHaveText("REC 01 → PLAY 01");
  await expect(page.locator("#firstReadDelay")).toHaveText(`${firstReadSeconds(original).toFixed(2)} s`);
  await page.locator("#audioButton").click();
  await expect.poll(async () => (await snapshot(page)).audioOn).toBe(true);

  const from = await workbenchPoint(page, { kind: "headId", id: "play-1" });
  const to = await workbenchPoint(page, { kind: "tape", position: .27 });
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
  const moved = await snapshot(page);
  expect(Math.abs(moved.headParts[1].position - original.headParts[1].position)).toBeGreaterThan(.04);
  expect(Math.abs(firstReadSeconds(moved) - firstReadSeconds(original))).toBeGreaterThan(.15);
  await expect(page.locator("#firstReadDelay")).toHaveText(`${firstReadSeconds(moved).toFixed(2)} s`);
  expect(moved.audioOn).toBe(true);
  expect(moved.speed).toBe(1);

  await page.locator("#timeButton").click();
  const hidden = await snapshot(page);
  expect(hidden.showTimes).toBe(false);
  expect(hidden.headParts).toEqual(moved.headParts);
  expect(hidden.seconds).toBe(moved.seconds);
  await expect(page.locator("#firstReadDelay")).toHaveText(`${firstReadSeconds(moved).toFixed(2)} s`);
  await page.locator(".tapezoid-first-listen summary").click();
  await expect(page.locator(".tapezoid-first-listen details")).toHaveAttribute("open", "");
  await expect(page.locator(".tapezoid-first-listen")).toContainText("TIME");
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("a Razor fork shows both arrival times without crowding the rail, then amber only before a later join", async ({ page }) => {
  await ready(page);
  await page.locator("#razorTool").click();
  const blade = await workbenchPoint(page, { kind: "tape", position: .33 });
  await page.mouse.click(blade.x, blade.y);
  const fork = await snapshot(page);
  const base = firstReadSeconds(fork);
  expect(fork.branchDelays).toHaveLength(2);
  await expect(page.locator("#firstReadDelay")).toHaveText(
    `A ${(base + fork.branchDelays[0]).toFixed(2)} · B ${(base + fork.branchDelays[1]).toFixed(2)} s`,
  );
  for (const size of sizes) {
    await page.setViewportSize(size);
    await settlePage(page);
    const layout = await page.locator(".tapezoid-first-read").evaluate(read => {
      const [heads, times] = [...read.children].map(child => child.getBoundingClientRect());
      return {
        overflow: read.scrollWidth - read.clientWidth,
        timeRight: times.right, readRight: read.getBoundingClientRect().right,
        sameLine: heads.bottom > times.top,
        gap: times.left - heads.right,
      };
    });
    expect(layout.overflow).toBeLessThanOrEqual(1);
    expect(layout.timeRight).toBeLessThanOrEqual(layout.readRight + 1);
    if (layout.sameLine) expect(layout.gap).toBeGreaterThanOrEqual(5);
  }
  await page.setViewportSize(sizes[0]);
  await settlePage(page);
  await page.locator("#tapeTool").click();
  const laterJoin = await workbenchPoint(page, { kind: "tape", position: .44 });
  await page.mouse.click(laterJoin.x, laterJoin.y);
  const joined = await snapshot(page);
  expect(joined.split?.join).toBeCloseTo(.44, 2);
  await expect(page.locator("#firstReadDelay")).toHaveText(
    `A ${(firstReadSeconds(joined) + joined.branchDelays[0]).toFixed(2)} s`,
  );
  await expect(page.locator("#firstReadDelay")).toHaveAttribute("aria-label", /blue rejoins later/);
});

test("coarse-pointer transport keeps every key visible within the cassette width", async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  });
  try {
    const page = await context.newPage();
    await ready(page);
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
    const layout = await page.evaluate(() => ({
      deckWidth: document.querySelector(".tapezoid-deck").getBoundingClientRect().width,
      stageHeight: document.querySelector("#scene").clientHeight,
      cassetteWidth: window.__tapezoid.snapshot().cassetteRender.width,
      halfHeight: window.__tapezoid.snapshot().cameraFrame.halfHeight,
      play: document.querySelector("#playButton").getBoundingClientRect().toJSON(),
      deck: document.querySelector(".tapezoid-deck").getBoundingClientRect().toJSON(),
    }));
    expect(layout.deckWidth).toBeCloseTo(layout.cassetteWidth * layout.stageHeight / (2 * layout.halfHeight), 0);
    await expectTransportKeysVisible(page);
    expect(layout.play.left).toBeGreaterThanOrEqual(layout.deck.left);
    expect(layout.play.right).toBeLessThanOrEqual(layout.deck.right);
    expect(layout.play.width).toBeGreaterThanOrEqual(48);
    expect(layout.play.height).toBeGreaterThanOrEqual(48);
    for (const speed of [-4, -1, 0, 1, 4]) {
      await page.locator(`.tapezoid-transport [data-speed="${speed}"]`).click();
      expect((await snapshot(page)).speed).toBe(speed);
    }
  } finally {
    await context.close();
  }
});

test("the actual artist-model hubs turn together, reverse together and freeze when stopped", async ({ page }) => {
  await ready(page);
  const first = await snapshot(page);
  await page.waitForTimeout(200);
  const forward = await snapshot(page);
  expect(forward.reelAngles[0] - first.reelAngles[0]).toBeGreaterThan(.1);
  expect(forward.reelAngles[1] - first.reelAngles[1])
    .toBeCloseTo(forward.reelAngles[0] - first.reelAngles[0], 6);

  await page.locator("[data-speed='0']").click();
  const paused = await snapshot(page);
  await page.waitForTimeout(200);
  const still = await snapshot(page);
  expect(still.reelAngles).toEqual(paused.reelAngles);

  await page.locator("[data-speed='-1']").click();
  const reverse = await snapshot(page);
  await page.waitForTimeout(200);
  const woundBack = await snapshot(page);
  expect(woundBack.reelAngles[0]).toBeLessThan(reverse.reelAngles[0] - .1);
  expect(woundBack.reelAngles[1] - reverse.reelAngles[1])
    .toBeCloseTo(woundBack.reelAngles[0] - reverse.reelAngles[0], 6);
});

test("the exact downloaded, credited cassette GLB is served and rendered by default, without arming Audio", async ({ page, baseURL }) => {
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  const responsePromise = page.waitForResponse(response =>
    response.url().endsWith("/assets/tapezoid/cassette-tape.glb"));
  await ready(page);
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  const served = await response.body();
  const download = await readFile(new URL("../assets/tapezoid/cassette-tape.glb", import.meta.url));
  expect(served.equals(download)).toBe(true);
  expect(createHash("sha256").update(served).digest("hex"))
    .toBe("19f27f4eb2b0c5463623dd1479fee7e6874c3b8f2df88bd022f28ef325009668");
  await expect(page.locator("#cassetteName")).toHaveText("Cassette Tape · joshtmc");
  await expect(page.locator(".tapezoid-model-credit a").first())
    .toHaveAttribute("href", "https://sketchfab.com/3d-models/cassette-tape-4613411c569d4185a2e07f31b1bf9e49");
  const live = await snapshot(page);
  expect(live.cassetteRender.visible).toBe(true);
  expect(live.cassetteRender.vertices).toBe(3837);
  expect(live.cassetteRender.width).toBeGreaterThan(3);
  expect(live.cassetteRender.width).toBeLessThan(4.5);
  expect(live.cassetteRender.reelTriangles).toEqual([418, 418]);
  expect(live.cassetteRender.opaqueDepthWrite).toBe(true);
  expect(live.cassetteRender.windowDepthWrite).toBe(false);
  expect(live.reelAngles).toHaveLength(2);
  expect(live.audioOn).toBe(false);
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("pulling tape toward the bottom edge uses the canvas freed by the side dock", async ({ page }) => {
  await ready(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const before = await snapshot(page);
  const start = await workbenchPoint(page, { kind: "tape", position: .62 });
  const scene = await page.locator("#scene").boundingBox();
  const destination = { x: scene.x + scene.width - 30, y: scene.y + scene.height - 14 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(destination.x, destination.y, { steps: 14 });
  await page.mouse.up();
  const pulled = await snapshot(page);
  const tip = pulled.rollers.filter(roller => roller.id.startsWith("post-")).at(-1);
  expect(tip).toBeTruthy();
  expect(tip.x).toBeGreaterThan(5.5);
  expect(tip.z).toBeGreaterThan(7);
  expect(pulled.history).toBe(before.history + 1);
  expect(pulled.audioOn).toBe(false);
  const onScreen = await workbenchPoint(page, { kind: "roller", id: tip.id });
  expect(Math.abs(onScreen.x - destination.x)).toBeLessThan(20);
  expect(Math.abs(onScreen.y - destination.y)).toBeLessThan(20);

  await page.setViewportSize({ width: 844, height: 390 });
  const rotated = await page.locator("#scene").boundingBox();
  const retained = await workbenchPoint(page, { kind: "roller", id: tip.id });
  expect(retained.x).toBeGreaterThan(rotated.x);
  expect(retained.x).toBeLessThan(rotated.x + rotated.width);
  expect(retained.y).toBeGreaterThan(rotated.y);
  expect(retained.y).toBeLessThan(rotated.y + rotated.height);
  const expandedFrame = (await snapshot(page)).cameraFrame.halfHeight;
  await page.locator("#undoButton").click();
  const restored = await snapshot(page);
  expect(restored.rollers).toEqual(before.rollers);
  expect(restored.cameraFrame.halfHeight).toBeLessThan(expandedFrame - 1);
});

test("a far-flung tape bend does not hide the transport keys at phone width", async ({ page }) => {
  await ready(page);
  await page.setViewportSize({ width: 320, height: 568 });
  const start = await workbenchPoint(page, { kind: "roller", id: "roller-4" });
  const desk = await page.locator("#scene").boundingBox();
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x, desk.y + desk.height + 145, { steps: 10 });
  await page.mouse.up();
  expect((await snapshot(page)).rollers[3].z).toBeGreaterThan(9);
  await expectTransportKeysVisible(page);
  const play = await page.locator("#playButton").boundingBox();
  expect(play.width).toBeGreaterThanOrEqual(48);
  expect(play.height).toBeGreaterThanOrEqual(48);
});

test("missing artist GLB falls back to the generated shell and can be retried", async ({ page }) => {
  await page.route("**/assets/tapezoid/cassette-tape.glb", route =>
    route.fulfill({ status: 404, body: "not here" }));
  await ready(page, { cassette: "stock" });
  await expect(page.locator("#cassetteError")).toContainText("generated shell in use");
  await expect(page.locator("#cassetteName")).toHaveText("Generated shell");
  expect((await snapshot(page)).cassetteRender.visible).toBe(true);
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  await page.unroute("**/assets/tapezoid/cassette-tape.glb");
  await page.locator("#bundledCassette").click();
  await expect(page.locator("#scene")).toHaveAttribute("data-cassette-model", "bundled");
  await expect(page.locator("#cassetteError")).toBeHidden();
  expect((await snapshot(page)).audioOn).toBe(false);
});

// Work in Progress pages are outside the site-wide primary-instrument axe and
// range inventories. Exercise Tapezoid's shared controls and stage explicitly.
test("the workbench and its Morphazoid controls have accessible names and bounded ranges", async ({ page }, testInfo) => {
  await ready(page);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  await testInfo.attach("tapezoid-accessibility.json", {
    body: JSON.stringify(results.violations.map(({ id, impact, nodes }) => ({
      id, impact, targets: nodes.map(({ target }) => target),
    })), null, 2),
    contentType: "application/json",
  });
  expect(results.violations.filter(({ impact }) => impact === "critical" || impact === "serious")).toEqual([]);
  const inventory = await collectControlInventory(page);
  const ranges = await exerciseRangeMathematics(page);
  expect(inventory.duplicateIds).toEqual([]);
  expect(inventory.summary.unlabeledVisible).toBe(0);
  expect(ranges.filter(({ skipped, finite, bounded, restored }) => (
    !skipped && (!finite || !bounded || !restored)
  ))).toEqual([]);
});

test("live roller and head dragging changes the route/read point without arming Audio", async ({ page, baseURL }) => {
  test.setTimeout(75_000); // Two multi-frame 3D drags and Undo on software WebGL.
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await ready(page);
  const before = await snapshot(page);
  const from = await workbenchPoint(page, { kind: "roller", id: "roller-4" });
  const to = await workbenchPoint(page, { x: .4, z: 1.15 });
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
  const rerouted = await snapshot(page);
  expect(rerouted.rollers[3].z).toBeLessThan(before.rollers[3].z - .7);
  expect(Math.abs(rerouted.seconds - before.seconds)).toBeGreaterThan(.02);
  expect(rerouted.history).toBe(before.history + 1);

  const headStart = await workbenchPoint(page, { kind: "head", index: 1 });
  const headEnd = await workbenchPoint(page, { kind: "tape", position: .27 });
  await page.mouse.move(headStart.x, headStart.y);
  await page.mouse.down();
  await page.mouse.move(headEnd.x, headEnd.y, { steps: 15 });
  await page.mouse.up();
  const moved = await snapshot(page);
  expect(Math.abs(moved.heads[1] - rerouted.heads[1])).toBeGreaterThan(.025);
  expect(moved.speed).toBe(1);
  expect(moved.audioOn).toBe(false);
  expect((await readAudioStatus(page)).connectionCount).toBe(0);

  await page.locator("#undoButton").click();
  expect((await snapshot(page)).heads[1]).toBeCloseTo(rerouted.heads[1], 3);
  await page.locator("#undoButton").click();
  expect((await snapshot(page)).rollers).toEqual(before.rollers);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("a near-post grab on adjacent tape moves only that post; Undo restores it", async ({ page }) => {
  test.setTimeout(65_000);
  await ready(page);
  const before = await snapshot(page);
  // ~0.55 world units from roller-4 but right on its neighboring ribbon:
  // this used to fall just outside the 0.53-unit post target and draw posts.
  const nearPost = await workbenchPoint(page, { x: .8, z: 2.55 });
  const destination = await workbenchPoint(page, { x: 1.3, z: 1.7 });
  await page.mouse.move(nearPost.x, nearPost.y);
  await page.mouse.down();
  await page.mouse.move(destination.x, destination.y, { steps: 6 });
  await page.mouse.up();
  const moved = await snapshot(page);
  expect(moved.rollers).toHaveLength(before.rollers.length);
  expect(moved.rollers.filter(roller => roller.id.startsWith("post-"))).toEqual([]);
  expect(moved.rollers[3].z).toBeLessThan(before.rollers[3].z - .45);
  expect(moved.rollers.filter(roller => roller.id !== "roller-4")).toEqual(
    before.rollers.filter(roller => roller.id !== "roller-4"));
  expect(moved.history).toBe(before.history + 1);
  await page.locator("#undoButton").click();
  expect((await snapshot(page)).rollers).toEqual(before.rollers);
});

test("grabbing bare tape pulls out a new guide; squeezing and Undo shorten it without stopping", async ({ page, baseURL }) => {
  test.setTimeout(85_000);
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await ready(page);
  const before = await snapshot(page);
  const bare = await workbenchPoint(page, { kind: "tape", position: .62 });
  await page.mouse.click(bare.x, bare.y);
  expect((await snapshot(page)).rollers).toEqual(before.rollers);
  expect((await snapshot(page)).history).toBe(before.history);

  const outward = await workbenchPoint(page, { x: 1.5, z: .7 });
  await page.mouse.move(bare.x, bare.y);
  await page.mouse.down();
  await page.mouse.move(outward.x, outward.y, { steps: 10 });
  await page.mouse.up();
  const stretched = await snapshot(page);
  expect(stretched.rollers.find(roller => roller.id === "post-1")).toBeTruthy();
  expect(stretched.selectedId).toBe("post-1");
  expect(stretched.seconds).toBeGreaterThan(before.seconds + .1);
  expect(stretched.history).toBe(before.history + 1);
  expect(stretched.audioOn).toBe(false);
  expect(stretched.speed).toBe(before.speed);

  const from = await workbenchPoint(page, { kind: "roller", id: "post-1" });
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(bare.x, bare.y, { steps: 8 });
  await page.mouse.up();
  const squeezed = await snapshot(page);
  expect(squeezed.seconds).toBeLessThan(stretched.seconds - .1);
  await page.locator("#undoButton").click();
  expect((await snapshot(page)).rollers).toEqual(stretched.rollers);
  await page.locator("#undoButton").click();
  const restored = await snapshot(page);
  expect(restored.rollers).toEqual(before.rollers);
  expect(restored.seconds).toBeCloseTo(before.seconds, 5);
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("MOVE follows a winding bare-tape pull with only one bend; DRAW is explicit", async ({ page }) => {
  test.setTimeout(75_000);
  await ready(page);
  const before = await snapshot(page);
  const start = await workbenchPoint(page, { kind: "tape", position: .62 });
  const corners = [];
  for (const [x, z] of [[-4.2, 2.8], [3.8, 1.4], [1.15, .6]]) {
    corners.push(await workbenchPoint(page, { x, z }));
  }
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (const corner of corners) await page.mouse.move(corner.x, corner.y, { steps: 3 });
  await page.mouse.up();
  const moved = await snapshot(page);
  expect(moved.tool).toBe("route");
  expect(moved.rollers.filter(roller => roller.id.startsWith("post-"))).toHaveLength(1);
  expect(moved.selectedId).toBe("post-1");
  expect(moved.history).toBe(before.history + 1);
  await page.locator("#undoButton").click();
  expect((await snapshot(page)).rollers).toEqual(before.rollers);
  await page.locator("#scene").focus();
  await page.keyboard.press("d");
  await expect(page.locator("#drawTool")).toHaveAttribute("aria-pressed", "true");
});

test("one captured stroke draws a tape maze across the desk; squeezing, Undo and audio keep working", async ({ page, baseURL }) => {
  test.setTimeout(100_000);
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await ready(page);
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#drawTool").click();
  const before = await snapshot(page);
  const start = await workbenchPoint(page, { kind: "tape", position: .62 });
  const corners = [];
  for (const [x, z] of [
    [-6.15, 3.15], [6.1, 3.15], [6.05, -1.25], [-6, -1.2],
    [-5.9, 2.5], [5.95, 2.5], [5.9, -.45], [-5.6, -.4],
  ]) corners.push(await workbenchPoint(page, { x, z }));
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (const corner of corners) await page.mouse.move(corner.x, corner.y);
  await page.mouse.up();
  const maze = await snapshot(page);
  const drawn = maze.rollers.filter(roller => roller.id.startsWith("post-"));
  expect(drawn.length).toBeGreaterThanOrEqual(7);
  expect(drawn.length).toBeLessThanOrEqual(32);
  expect(Math.min(...drawn.map(roller => roller.x))).toBeLessThan(-5.4);
  expect(Math.max(...drawn.map(roller => roller.x))).toBeGreaterThan(5.4);
  expect(Math.max(...drawn.map(roller => roller.z))).toBeGreaterThan(2.4);
  expect(maze.seconds).toBeGreaterThan(before.seconds + 2);
  expect(maze.seconds).toBeLessThanOrEqual(12);
  expect(maze.history).toBe(before.history + 1);
  expect(maze.tool).toBe("draw");
  expect(maze.audioOn).toBe(true);
  expect(maze.speed).toBe(before.speed);
  expect((await readAudioStatus(page)).connectionCount).toBe(1);
  const sound = await sampleAudioEnvelope(page, { durationMs: 650, intervalMs: 80 });
  expect(sound.summary.finite).toBe(true);
  expect(sound.summary.maxRms).toBeGreaterThan(.002);
  expect(sound.summary.clippedSamples).toBe(0);

  const first = maze.rollers.findIndex(roller => roller.id === drawn[4].id);
  const post = maze.rollers[first];
  const previous = maze.rollers[first - 1], next = maze.rollers[first + 1];
  const pickup = await workbenchPoint(page, { kind: "roller", id: post.id });
  const midpoint = await workbenchPoint(page, {
    x: (previous.x + next.x) / 2, z: (previous.z + next.z) / 2,
  });
  await page.mouse.move(pickup.x, pickup.y);
  await page.mouse.down();
  await page.mouse.move(midpoint.x, midpoint.y, { steps: 4 });
  await page.mouse.up();
  const squeezed = await snapshot(page);
  expect(squeezed.seconds).toBeLessThan(maze.seconds - .005);
  await page.locator("#undoButton").click();
  expect((await snapshot(page)).rollers).toEqual(maze.rollers);
  await page.locator("#undoButton").click();
  const restored = await snapshot(page);
  expect(restored.rollers).toEqual(before.rollers);
  expect(restored.audioOn).toBe(true);
  expect(restored.speed).toBe(1);
  await page.locator("#audioButton").click();
  await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(0);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("bare tape keeps adding bends past the previous four-post limit", async ({ page }) => {
  test.setTimeout(70_000);
  await ready(page);
  for (const [position, offset] of [[.1, .5], [.41, -.5], [.55, .4], [.76, -.5]]) {
    await page.locator("#newPostTool").click();
    const beside = await workbenchPoint(page, { kind: "post-offset", position, offset });
    await page.mouse.click(beside.x, beside.y);
  }
  const four = await snapshot(page);
  expect(four.rollers.filter(roller => roller.id.startsWith("post-"))).toHaveLength(4);
  await expect(page.locator("#newPostTool")).toBeEnabled();
  const from = await workbenchPoint(page, { kind: "tape", position: .33 });
  const to = await workbenchPoint(page, { x: -3.2, z: .25 });
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 9 });
  await page.mouse.up();
  const shaped = await snapshot(page);
  expect(shaped.rollers.length).toBeGreaterThan(four.rollers.length);
  expect(shaped.rollers.some(roller => roller.id === "post-5")).toBe(true);
  expect(Math.abs(shaped.seconds - four.seconds)).toBeGreaterThan(.01);
  expect(shaped.history).toBe(four.history + 1);
  await page.locator("#undoButton").click();
  expect((await snapshot(page)).rollers).toEqual(four.rollers);
});

test("desk tools place live heads, a guide post and a timed pool; Eraser and Undo preserve the tape", async ({ page, baseURL }, testInfo) => {
  test.setTimeout(110_000);
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await ready(page);
  await page.locator("[data-speed='0']").click();
  const before = await snapshot(page);
  await page.locator("#newPlayTool").click();
  await expect(page.locator("#newPlayTool")).toHaveAttribute("aria-pressed", "true");
  const playPoint = await workbenchPoint(page, { kind: "tape", position: .67 });
  await page.mouse.click(playPoint.x, playPoint.y);
  let edited = await snapshot(page);
  expect(edited.headParts.find(head => head.id === "play-3")?.kind).toBe("play");
  expect(edited.selectedId).toBe("play-3");
  expect(edited.tool).toBe("route");
  await expect(page.locator("#returnHead option[value='play-3']")).toHaveCount(1);

  await page.locator("#newRecordTool").click();
  const recordPoint = await workbenchPoint(page, { kind: "tape", position: .26 });
  await page.mouse.click(recordPoint.x, recordPoint.y);
  expect((await snapshot(page)).headParts.find(head => head.id === "record-2")?.kind).toBe("record");
  await page.locator("#newPostTool").click();
  const postPoint = await workbenchPoint(page, { x: -2.8, z: 1.65 });
  await page.mouse.click(postPoint.x, postPoint.y);
  edited = await snapshot(page);
  expect(edited.rollers.some(post => post.id === "post-1")).toBe(true);
  expect(Math.abs(edited.seconds - before.seconds)).toBeGreaterThan(.02);

  await page.locator("#newPoolTool").click();
  const poolPoint = await workbenchPoint(page, { kind: "tape", position: .32 });
  await page.mouse.click(poolPoint.x, poolPoint.y);
  const stored = await snapshot(page);
  expect(stored.pools).toEqual([{ id: "pool-1", position: expect.any(Number), seconds: 1 }]);
  expect(stored.selectedId).toBe("pool-1");
  expect(stored.seconds).toBeGreaterThan(edited.seconds + .99);
  await expect(page.locator("#poolAdjust")).toBeVisible();
  await expect(page.locator("#tapeStatus")).toHaveText("STORED");
  await page.locator("#poolSeconds").evaluate(field => {
    field.value = "2.4";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const lengthened = await snapshot(page);
  expect(lengthened.pools[0].seconds).toBe(2.4);
  expect(lengthened.seconds - stored.seconds).toBeCloseTo(1.4, 2);
  expect(lengthened.poolShapes[0].radius).toBeGreaterThan(stored.poolShapes[0].radius);
  expect(lengthened.poolShapes[0].rows).toBeGreaterThan(stored.poolShapes[0].rows);
  expect(lengthened.poolShapes[0].length).toBeGreaterThan(stored.poolShapes[0].length);
  expect(lengthened.poolShapes[0].renderedRadius).toBeCloseTo(lengthened.poolShapes[0].radius, 6);
  await testInfo.attach("tapezoid-growing-zigzag-pool.png", {
    body: await page.locator("#scene").screenshot(), contentType: "image/png",
  });
  const poolHandle = await workbenchPoint(page, { kind: "pool", id: "pool-1" });
  const poolDestination = await workbenchPoint(page, { kind: "tape", position: .58 });
  await page.mouse.move(poolHandle.x, poolHandle.y);
  await page.mouse.down();
  await page.mouse.move(poolDestination.x, poolDestination.y, { steps: 12 });
  await page.mouse.up();
  expect((await snapshot(page)).pools[0].position).toBeGreaterThan(.51);

  await page.locator("#returnHead").selectOption("play-3");
  await page.locator("#eraseTool").click();
  const extraPlay = await workbenchPoint(page, { kind: "headId", id: "play-3" });
  await page.mouse.click(extraPlay.x, extraPlay.y);
  expect((await snapshot(page)).headParts.some(head => head.id === "play-3")).toBe(false);
  expect((await snapshot(page)).returnHead).toBe("play-1");
  await page.locator("#undoButton").click();
  expect((await snapshot(page)).headParts.some(head => head.id === "play-3")).toBe(true);
  expect((await snapshot(page)).returnHead).toBe("play-3");

  await page.locator("#eraseTool").click();
  const poolToErase = await workbenchPoint(page, { kind: "pool", id: "pool-1" });
  await page.mouse.click(poolToErase.x, poolToErase.y);
  expect((await snapshot(page)).pools).toEqual([]);
  await page.locator("#undoButton").click();
  expect((await snapshot(page)).pools[0].seconds).toBe(2.4);
  await page.locator("#eraseTool").click();
  const addedPost = await workbenchPoint(page, { kind: "roller", id: "post-1" });
  await page.mouse.click(addedPost.x, addedPost.y);
  expect((await snapshot(page)).rollers.some(post => post.id === "post-1")).toBe(false);
  await page.locator("#undoButton").click();
  expect((await snapshot(page)).rollers.some(post => post.id === "post-1")).toBe(true);
  await page.locator("#resetButton").click();
  const reset = await snapshot(page);
  expect(reset.pools).toEqual([]);
  expect(reset.rollers).toHaveLength(6);
  expect(reset.headParts).toHaveLength(3);
  expect(reset.speed).toBe(1);
  expect(reset.audioOn).toBe(false);
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("six pools share one bounded tape loop; limits and REC routing are explained", async ({ page }) => {
  test.setTimeout(120_000);
  await ready(page);
  await page.locator("#newRecordTool").click();
  await expect(page.locator("#feedback")).toContainText("same loop");
  for (const position of [.11, .23, .39, .54, .67, .8]) {
    await page.locator("#newPoolTool").click();
    const tape = await workbenchPoint(page, { kind: "tape", position });
    await page.mouse.click(tape.x, tape.y);
  }
  const full = await snapshot(page);
  expect(full.pools.map(pool => pool.id)).toEqual([
    "pool-1", "pool-2", "pool-3", "pool-4", "pool-5", "pool-6",
  ]);
  expect(full.seconds).toBeLessThanOrEqual(12);
  await expect(page.locator("#newPoolTool")).toBeDisabled();
  await page.locator(".tapezoid-first-listen details summary").click();
  await expect(page.locator("#editCapacity")).toContainText("6/6 pools");
  await expect(page.locator("#editCapacity")).toContainText("12-second loop");
  await expect(page.locator(".tapezoid-first-listen")).toContainText("same loop");
  await expect(page.locator(".tapezoid-first-listen")).toContainText("do not create tracks, capture your mic or send to a separate output");
  await page.locator("#scene").focus();
  await page.keyboard.press("4");
  await expect(page.locator("#feedback")).toContainText("at capacity");
  expect((await snapshot(page)).tool).toBe("route");
  await page.keyboard.press("e");
  await page.keyboard.press("Enter");
  expect((await snapshot(page)).pools).toHaveLength(5);
  await expect(page.locator("#newPoolTool")).toBeEnabled();
  await page.locator("#undoButton").click();
  expect((await snapshot(page)).pools).toHaveLength(6);
  await expect(page.locator("#newPoolTool")).toBeDisabled();
});

test("head tools stop at the preallocated audio contacts, with a clear capacity reason", async ({ page }) => {
  test.setTimeout(65_000);
  await ready(page);
  for (const position of [.66, .74]) {
    await page.locator("#newPlayTool").click();
    const tape = await workbenchPoint(page, { kind: "tape", position });
    await page.mouse.click(tape.x, tape.y);
  }
  for (const position of [.1, .26]) {
    await page.locator("#newRecordTool").click();
    const tape = await workbenchPoint(page, { kind: "tape", position });
    await page.mouse.click(tape.x, tape.y);
  }
  const full = await snapshot(page);
  expect(full.headParts.filter(head => head.kind === "play")).toHaveLength(4);
  expect(full.headParts.filter(head => head.kind === "record")).toHaveLength(3);
  await expect(page.locator("#newPlayTool")).toBeDisabled();
  await expect(page.locator("#newRecordTool")).toBeDisabled();
  await expect(page.locator("#editCapacity")).toContainText("4/4 PLAY, 3/3 REC");
  await expect(page.locator("#editCapacity")).toContainText("fixed real-time audio contacts");
  await page.locator("#scene").focus();
  await page.keyboard.press("2");
  await expect(page.locator("#feedback")).toContainText("at capacity");
  expect((await snapshot(page)).audioOn).toBe(false);
});

test("Eraser keeps a REC/PLAY contact while keyboard tools and storage presets remain reversible", async ({ page }) => {
  test.setTimeout(65_000);
  await ready(page);
  await page.locator("#scene").focus();
  await page.keyboard.press("1");
  await page.keyboard.press("Enter");
  expect((await snapshot(page)).headParts.some(head => head.id === "play-3")).toBe(true);
  await page.keyboard.press("2");
  await page.keyboard.press("Enter");
  expect((await snapshot(page)).headParts.some(head => head.id === "record-2")).toBe(true);
  for (let step = 0; step < 6; step += 1) await page.keyboard.press("ArrowRight");
  await page.keyboard.press("4");
  await page.keyboard.press("Enter");
  const stored = await snapshot(page);
  expect(stored.pools).toHaveLength(1);
  await expect(page.locator("#poolAdjust")).toBeVisible();
  await page.keyboard.press("ArrowUp"); // Pool seconds, not page scrolling.
  expect((await snapshot(page)).pools[0].seconds).toBeGreaterThan(stored.pools[0].seconds);
  await page.keyboard.press("e");
  await page.keyboard.press("Enter");
  expect((await snapshot(page)).pools).toHaveLength(0);
  const record2 = await workbenchPoint(page, { kind: "headId", id: "record-2" });
  await page.mouse.click(record2.x, record2.y);
  expect((await snapshot(page)).headParts.filter(head => head.kind === "record")).toHaveLength(1);
  const lastRecord = await workbenchPoint(page, { kind: "headId", id: "record" });
  await page.mouse.click(lastRecord.x, lastRecord.y);
  expect((await snapshot(page)).headParts.filter(head => head.kind === "record")).toHaveLength(1);
  await expect(page.locator("#feedback")).toContainText("Keep at least one REC");
  await page.locator(".header-preset-picker summary").click();
  await page.locator("[data-preset-id='route-15']").click();
  const orchard = await snapshot(page);
  expect(orchard.pools).toHaveLength(1);
  expect(orchard.headParts).toHaveLength(5);
  expect(orchard.rollers.some(roller => roller.id === "post-1")).toBe(true);
  await page.locator(".header-preset-picker summary").click();
  await page.locator("[data-preset-id='route-14']").click();
  const storage = await snapshot(page);
  expect(storage.pools[0].seconds).toBe(2.15);
  expect(storage.speed).toBe(1);
  expect(storage.audioOn).toBe(false);
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
});

test("a zigzag storage pool coexists with a continuous fork and Scotch restores one route", async ({ page, baseURL }) => {
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await ready(page);
  await page.locator("[data-speed='0']").click();
  await page.locator("#newPoolTool").click();
  const beforeRec = await workbenchPoint(page, { kind: "tape", position: .11 });
  await page.mouse.click(beforeRec.x, beforeRec.y);
  const stored = await snapshot(page);
  expect(stored.pools).toHaveLength(1);
  await page.locator("#razorTool").click();
  await page.locator("#scene").focus();
  await page.keyboard.press("Enter");
  const fork = await snapshot(page);
  expect(fork.split?.guides).toHaveLength(2);
  expect(fork.selectedId).toBe("lane-b");
  expect(fork.cut).toBeNull();
  expect(fork.branchDelays[1] - fork.branchDelays[0]).toBeGreaterThan(.08);
  expect(fork.pools).toEqual(stored.pools);
  expect(fork.seconds).toBeCloseTo(stored.seconds, 4);
  await page.locator("#tapeTool").click();
  const rejoin = await workbenchPoint(page, { kind: "tape", position: fork.split.end });
  await page.mouse.click(rejoin.x, rejoin.y);
  const joined = await snapshot(page);
  expect(joined.split).toBeNull();
  expect(joined.pools).toEqual(stored.pools);
  expect(joined.patches).toHaveLength(1);
  expect(joined.audioOn).toBe(false);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("both fork ribbons pull directly, accept separate movable pools, and rejoin without stranding storage", async ({ page, baseURL }, testInfo) => {
  test.setTimeout(110_000);
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await ready(page);
  await page.locator("#scene").focus();
  await page.keyboard.press("r");
  await page.keyboard.press("Enter");
  const fork = await snapshot(page);
  expect(fork.split).not.toBeNull();
  const amber = await workbenchPoint(page, { kind: "branch", id: "lane-a", progress: .7 });
  const pulledAmber = await workbenchPoint(page, { x: -4.7, z: .4 });
  await page.mouse.move(amber.x, amber.y);
  await page.mouse.down();
  await page.mouse.move(pulledAmber.x, pulledAmber.y, { steps: 10 });
  await page.mouse.up();
  const movedAmber = await snapshot(page);
  expect(movedAmber.selectedId).toBe("lane-a");
  expect(Math.abs(movedAmber.branchDelays[0] - fork.branchDelays[0])).toBeGreaterThan(.15);
  expect(movedAmber.branchDelays[1]).toBeCloseTo(fork.branchDelays[1], 5);

  const blue = await workbenchPoint(page, { kind: "branch", id: "lane-b", progress: .3 });
  const pulledBlue = await workbenchPoint(page, { x: -2.5, z: 1.2 });
  await page.mouse.move(blue.x, blue.y);
  await page.mouse.down();
  await page.mouse.move(pulledBlue.x, pulledBlue.y, { steps: 8 });
  await page.mouse.up();
  const movedBlue = await snapshot(page);
  expect(Math.abs(movedBlue.branchDelays[1] - movedAmber.branchDelays[1])).toBeGreaterThan(.025);
  expect(movedBlue.branchDelays[0]).toBeCloseTo(movedAmber.branchDelays[0], 5);
  expect(movedBlue.speed).toBe(1);

  await page.locator("#newPoolTool").click();
  const blueTape = await workbenchPoint(page, { kind: "branch", id: "lane-b", progress: .32 });
  await page.mouse.click(blueTape.x, blueTape.y);
  const pooledBlue = await snapshot(page);
  expect(pooledBlue.pools[0]).toMatchObject({ id: "pool-1", laneId: "lane-b", seconds: 1 });
  expect(pooledBlue.seconds).toBeCloseTo(movedBlue.seconds, 5);
  expect(pooledBlue.branchDelays[1] - movedBlue.branchDelays[1]).toBeGreaterThan(.9);
  expect(pooledBlue.branchDelays[0]).toBeCloseTo(movedBlue.branchDelays[0], 5);
  expect(pooledBlue.poolShapes[0].renderedRadius).toBeCloseTo(pooledBlue.poolShapes[0].radius, 6);

  await page.locator("#newPoolTool").click();
  const amberTape = await workbenchPoint(page, { kind: "branch", id: "lane-a", progress: .36 });
  await page.mouse.click(amberTape.x, amberTape.y);
  const pooledBoth = await snapshot(page);
  expect(pooledBoth.pools.map(pool => pool.laneId)).toEqual(["lane-b", "lane-a"]);
  expect(pooledBoth.branchDelays[0] - pooledBlue.branchDelays[0]).toBeGreaterThan(.9);
  expect(pooledBoth.seconds).toBeCloseTo(movedBlue.seconds, 5);
  await expect(page.locator("#poolLabel")).toContainText("AMBER BRANCH");
  await testInfo.attach("tapezoid-pulled-fork-branch-pools.png", {
    body: await page.locator("#scene").screenshot(), contentType: "image/png",
  });

  const poolFrom = await workbenchPoint(page, { kind: "pool", id: "pool-1" });
  const poolTo = await workbenchPoint(page, { kind: "branch", id: "lane-b", progress: .78 });
  await page.mouse.move(poolFrom.x, poolFrom.y);
  await page.mouse.down();
  await page.mouse.move(poolTo.x, poolTo.y, { steps: 12 });
  await page.mouse.up();
  const shifted = await snapshot(page);
  expect((shifted.pools[0].position - shifted.split.start)
    / (shifted.split.end - shifted.split.start)).toBeGreaterThan(.65);
  expect(shifted.pools[0].laneId).toBe("lane-b");
  expect(shifted.branchDelays).toEqual(pooledBoth.branchDelays);
  await expect(page.locator("#poolLabel")).toContainText("BLUE BRANCH");
  await page.locator("#poolSeconds").evaluate(field => {
    field.value = "2.4";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const lengthened = await snapshot(page);
  expect(lengthened.branchDelays[1]).toBeGreaterThan(shifted.branchDelays[1] + 1);
  expect(lengthened.branchDelays[0]).toBeCloseTo(shifted.branchDelays[0], 5);
  expect(lengthened.poolShapes[0].radius).toBeGreaterThan(shifted.poolShapes[0].radius);
  expect(lengthened.seconds).toBeCloseTo(shifted.seconds, 5);

  await page.locator("#joinButton").click();
  const joined = await snapshot(page);
  expect(joined.split).toBeNull();
  expect(joined.pools).toHaveLength(2);
  expect(joined.pools.every(pool => !("laneId" in pool))).toBe(true);
  expect(Math.abs(joined.pools[0].position - joined.pools[1].position)).toBeGreaterThanOrEqual(.055);
  expect(joined.seconds).toBeGreaterThan(lengthened.seconds + 2);
  expect(joined.speed).toBe(1);
  await page.locator("#undoButton").click();
  const restored = await snapshot(page);
  expect(restored.split).toEqual(lengthened.split);
  expect(restored.pools).toEqual(lengthened.pools);
  expect(restored.branchDelays).toEqual(lengthened.branchDelays);
  await page.locator("#scene").focus();
  await page.keyboard.press("e");
  await page.keyboard.press("Delete"); // Selected pool is erased without dropping the other branch.
  const onePool = await snapshot(page);
  expect(onePool.pools).toHaveLength(1);
  expect(onePool.pools[0].laneId).toBe("lane-a");
  expect((await snapshot(page)).split).not.toBeNull();
  const guide = await workbenchPoint(page, { kind: "guide", id: "lane-b" });
  await page.mouse.click(guide.x, guide.y);
  const erased = await snapshot(page);
  expect(erased.split).toBeNull();
  expect(erased.pools).toHaveLength(1);
  expect(erased.pools[0].laneId).toBeUndefined();
  expect(erased.patches).toHaveLength(0);
  await page.locator("#undoButton").click();
  expect((await snapshot(page)).pools).toEqual(onePool.pools);
  expect((await snapshot(page)).split).toEqual(onePool.split);
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("a larger pool and a fork retain their timed paths during fast-forward without stopping", async ({ page }) => {
  test.setTimeout(45_000);
  await ready(page);
  await page.locator("[data-speed='0']").click();
  await page.locator("#newPoolTool").click();
  const poolPoint = await workbenchPoint(page, { kind: "tape", position: .39 });
  await page.mouse.click(poolPoint.x, poolPoint.y);
  await page.locator("#poolSeconds").evaluate(field => {
    field.value = "2.5";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const stored = await snapshot(page);
  expect(stored.poolShapes[0].rows).toBeGreaterThan(4);
  await page.locator("#razorTool").click();
  const cutPoint = await workbenchPoint(page, { kind: "tape", position: .24 });
  await page.mouse.click(cutPoint.x, cutPoint.y);
  const fork = await snapshot(page);
  expect(fork.split).not.toBeNull();
  expect(fork.branchDelays[1] - fork.branchDelays[0]).toBeGreaterThan(.08);
  expect(fork.pools).toEqual(stored.pools);
  await page.locator("[data-speed='4']").click();
  const initialTime = (await snapshot(page)).trackTime;
  await expect.poll(async () => (await snapshot(page)).trackTime, { timeout: 8000 })
    .toBeGreaterThan(initialTime + .45);
  expect((await snapshot(page)).speed).toBe(4);
  await page.locator("#joinButton").click();
  const joined = await snapshot(page);
  expect(joined.cut).toBeNull();
  expect(joined.split).toBeNull();
  expect(joined.pools).toEqual(stored.pools);
  expect(joined.speed).toBe(4);
  await page.locator("#playButton").click();
  expect((await snapshot(page)).speed).toBe(1);
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
});

test("live tool edits keep Audio armed, bounded, and in time through pool and head changes", async ({ page, baseURL }) => {
  test.setTimeout(90_000);
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await ready(page);
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(1);
  await page.locator("#newPoolTool").click();
  const poolPoint = await workbenchPoint(page, { kind: "tape", position: .29 });
  await page.mouse.click(poolPoint.x, poolPoint.y);
  await page.locator("#poolSeconds").evaluate(field => {
    field.value = "2.8";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const pooled = await snapshot(page);
  expect(pooled.pools[0].seconds).toBe(2.8);
  await page.locator("#newPlayTool").click();
  const playPoint = await workbenchPoint(page, { kind: "tape", position: .68 });
  await page.mouse.click(playPoint.x, playPoint.y);
  await page.locator("#newRecordTool").click();
  const recordPoint = await workbenchPoint(page, { kind: "tape", position: .25 });
  await page.mouse.click(recordPoint.x, recordPoint.y);
  await page.locator("#returnHead").selectOption("play-3");
  const changed = await snapshot(page);
  expect(changed.headParts).toHaveLength(5);
  expect(changed.returnHead).toBe("play-3");
  expect(changed.speed).toBe(1);
  expect(changed.audioOn).toBe(true);
  const envelope = await sampleAudioEnvelope(page, { durationMs: 2100, intervalMs: 80 });
  expect(envelope.summary.finite).toBe(true);
  expect(envelope.summary.maxRms).toBeGreaterThan(.002);
  expect(envelope.summary.clippedSamples).toBe(0);
  await page.locator("#audioButton").click();
  await expect.poll(async () => (await snapshot(page)).memoryStored).toBe(true);
  await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(0);
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  const restored = await snapshot(page);
  expect(restored.pools).toEqual(changed.pools);
  expect(restored.headParts).toEqual(changed.headParts);
  expect(restored.returnHead).toBe("play-3");
  expect(restored.speed).toBe(1);
  await page.locator("#audioButton").click();
  await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(0);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("Razor and Scotch stay in the toolbar; blank desk clicks do not switch tools, while Undo and Reset work", async ({ page, baseURL }) => {
  test.setTimeout(110_000); // Two complete edits, Undo and Reset on software WebGL.
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await ready(page);
  await page.locator("[data-speed='0']").click();
  const oldRazor = await workbenchPoint(page, { x: -5.2, z: 3.65 });
  const oldScotch = await workbenchPoint(page, { x: 5.2, z: 3.65 });
  await page.mouse.click(oldRazor.x, oldRazor.y);
  await page.mouse.click(oldScotch.x, oldScotch.y);
  expect((await snapshot(page)).tool).toBe("route");
  expect((await snapshot(page)).split).toBeNull();
  await page.locator("#razorTool").click();
  await expect(page.locator("#razorTool")).toHaveAttribute("aria-pressed", "true");
  await page.mouse.click(oldRazor.x, oldRazor.y); // Empty desk is no longer a prop or cut target.
  expect((await snapshot(page)).cut).toBeNull();
  expect((await snapshot(page)).split).toBeNull();
  const insideCassette = await workbenchPoint(page, { x: 0, z: -3.02 });
  await page.mouse.click(insideCassette.x, insideCassette.y);
  expect((await snapshot(page)).split).toBeNull();
  const point = await workbenchPoint(page, { kind: "tape", position: .33 });
  await page.mouse.click(point.x, point.y);
  const fork = await snapshot(page);
  expect(fork.cut).toBeNull();
  expect(fork.split.start).toBeGreaterThan(.3);
  expect(fork.split.end).toBeLessThan(.37);
  expect(fork.split.guides[1].id).toBe("lane-b");
  expect(fork.tool).toBe("route");
  await expect(page.locator("#firstReadDelay")).toHaveText(/^A \d+\.\d{2} · B \d+\.\d{2} s$/);
  await expect(page.locator("#tapeStatus")).toHaveText("BIFURCATED");
  await expect(page.locator("#joinButton")).toBeEnabled();
  const rejoin = await workbenchPoint(page, { kind: "tape", position: fork.split.end });
  await page.locator("#tapeTool").click();
  await page.mouse.click(rejoin.x, rejoin.y);
  const sealed = await snapshot(page);
  expect(sealed.split).toBeNull();
  expect(sealed.patches).toHaveLength(1);
  await expect(page.locator("#firstReadDelay")).toHaveText(`${firstReadSeconds(sealed).toFixed(2)} s`);
  expect(sealed.speed).toBe(0);
  await page.locator("#undoButton").click();
  expect((await snapshot(page)).split).toEqual(fork.split);
  await page.locator("#undoButton").click();
  expect((await snapshot(page)).split).toBeNull();
  await page.locator("#resetButton").click();
  const reset = await snapshot(page);
  expect(reset.patches).toEqual([]);
  expect(reset.rollers[3]).toMatchObject({ x: .25, z: 2.55 });
  expect(reset.speed).toBe(1);
  expect(reset.audioOn).toBe(false);

  // A fork after the last reader would be inaudible. The blade refuses
  // that placement without stopping the motor or opening the tape.
  await page.locator("[data-speed='0']").click();
  await page.locator("#razorTool").click();
  await expect(page.locator("#razorTool")).toHaveAttribute("aria-pressed", "true");
  const returnSide = await workbenchPoint(page, { kind: "tape", position: .93 });
  await page.mouse.click(returnSide.x, returnSide.y);
  expect((await snapshot(page)).split).toBeNull();
  await expect(page.locator("#feedback")).toContainText("before PLAY");
  expect((await snapshot(page)).speed).toBe(0);
  const validPoint = await workbenchPoint(page, { kind: "tape", position: .24 });
  await page.mouse.click(validPoint.x, validPoint.y);
  const validFork = await snapshot(page);
  expect(validFork.split).not.toBeNull();
  await page.locator("#tapeTool").click();
  await expect(page.locator("#tapeTool")).toHaveAttribute("aria-pressed", "true");
  const validJoin = await workbenchPoint(page, { kind: "tape", position: validFork.split.end });
  await page.mouse.click(validJoin.x, validJoin.y);
  expect((await snapshot(page)).patches[0]).toBeCloseTo(validFork.split.end, 2);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("a Razor stroke automatically forks before the next part; moving its post delays one read until Scotch", async ({ page, baseURL }) => {
  test.setTimeout(110_000);
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await ready(page);
  await page.locator("[data-speed='0']").click();
  const original = await snapshot(page);
  await page.locator("#razorTool").click();
  const first = await workbenchPoint(page, { kind: "tape", position: .31 });
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (let fraction = .31; fraction <= .331; fraction += .007) {
    const point = await workbenchPoint(page, { kind: "tape", position: fraction });
    await page.mouse.move(point.x, point.y, { steps: 3 });
  }
  await page.mouse.up();
  const fork = await snapshot(page);
  expect(fork.cut).toBeNull();
  expect(fork.split?.guides.map(guide => guide.id)).toEqual(["lane-a", "lane-b"]);
  expect(fork.split.start).toBeGreaterThan(fork.heads[0] + .02);
  expect(fork.split.end - fork.split.start).toBeGreaterThan(.035);
  expect(fork.heads.slice(1).every(position => position > fork.split.end)).toBe(true);
  expect(Math.abs(fork.branchDelays[0] - fork.branchDelays[1])).toBeGreaterThan(.08);
  expect(fork.history).toBe(original.history + 1);
  expect(fork.speed).toBe(0);
  await expect(page.locator("#tapeStatus")).toHaveText("BIFURCATED");
  await expect(page.locator("#joinButton")).toHaveText("Scotch · restore one path");

  const guide = await workbenchPoint(page, { kind: "guide", id: "lane-b" });
  const movedTo = await workbenchPoint(page, { x: -3.4, z: -.4 });
  await page.mouse.move(guide.x, guide.y);
  await page.mouse.down();
  await page.mouse.move(movedTo.x, movedTo.y, { steps: 8 });
  await page.mouse.up();
  const bent = await snapshot(page);
  expect(bent.history).toBe(fork.history + 1);
  expect(bent.branchDelays[0]).toBeCloseTo(fork.branchDelays[0], 6);
  expect(Math.abs(bent.branchDelays[1] - fork.branchDelays[1])).toBeGreaterThan(.03);
  expect(bent.audioOn).toBe(false);

  await page.locator("#tapeTool").click();
  const rejoin = await workbenchPoint(page, { kind: "tape", position: bent.split.end });
  await page.mouse.click(rejoin.x, rejoin.y);
  const joined = await snapshot(page);
  expect(joined.split).toBeNull();
  expect(joined.branchDelays).toBeNull();
  expect(joined.patches.at(-1)).toBeCloseTo(bent.split.end, 2);
  expect(joined.speed).toBe(0);
  await page.locator("#undoButton").click();
  const restored = await snapshot(page);
  expect(restored.split).toEqual(bent.split);
  expect(restored.branchDelays).toEqual(bent.branchDelays);
  await page.locator("#resetButton").click();
  const reset = await snapshot(page);
  expect(reset.split).toBeNull();
  expect(reset.branchDelays).toBeNull();
  expect(reset.speed).toBe(1);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("each visible stretch has its own time, and a pool adds time only to its stretch", async ({ page, baseURL }) => {
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await ready(page);
  await page.locator("[data-speed='0']").click();
  const original = await snapshot(page);
  expect(original.segmentTimes).toHaveLength(original.rollers.length + 1);
  expect(new Set(original.segmentTimes.map(segment => segment.seconds.toFixed(2))).size).toBeGreaterThan(3);
  await expect(page.locator("#timeLabels .tapezoid-time-label")).not.toHaveCount(0);
  await page.locator("#timeButton").click();
  await expect(page.locator("#timeLabels")).toBeHidden();
  await expect(page.locator("#timeButton")).toHaveAttribute("aria-pressed", "false");
  await page.locator("#timeButton").click();
  await expect(page.locator("#timeLabels")).toBeVisible();
  expect(await page.locator("#segmentTiming").textContent()).toContain("Stretch 1");

  const handle = await workbenchPoint(page, { kind: "roller", id: "roller-4" });
  const pulled = await workbenchPoint(page, { x: .25, z: 3.2 });
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(pulled.x, pulled.y, { steps: 5 });
  await page.mouse.up();
  const shaped = await snapshot(page);
  expect(shaped.segmentTimes.some((segment, index) =>
    Math.abs(segment.length - original.segmentTimes[index].length) > .1
    && Math.abs(segment.seconds - original.segmentTimes[index].seconds) > .01)).toBe(true);

  await page.locator("#newPoolTool").click();
  const tape = await workbenchPoint(page, { kind: "tape", position: .62 });
  await page.mouse.click(tape.x, tape.y);
  await expect(page.locator("#poolAdjust")).toBeVisible();
  await page.locator("#poolSeconds").evaluate(field => {
    field.value = "2";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const withPool = await snapshot(page);
  expect(withPool.segmentTimes.filter(segment => segment.storageSeconds > 0)).toHaveLength(1);
  const owner = withPool.segmentTimes.find(segment => segment.storageSeconds > 0);
  expect(owner.storageSeconds).toBeCloseTo(2, 1);
  expect(owner.seconds).toBeGreaterThan(owner.travelSeconds + 1.9);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("grab the blue end and Scotch it to another segment as an undoable audio mixer", async ({ page, baseURL }, testInfo) => {
  test.setTimeout(90_000);
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await ready(page);
  await page.locator("[data-speed='0']").click();
  await page.locator("#razorTool").click();
  const blade = await workbenchPoint(page, { kind: "tape", position: .33 });
  await page.mouse.click(blade.x, blade.y);
  const fork = await snapshot(page);
  expect(fork.split).not.toBeNull();
  await expect(page.locator("#junctionAdjust")).toBeHidden();
  const end = await workbenchPoint(page, { kind: "tape", position: fork.split.end });
  const target = await workbenchPoint(page, { kind: "tape", position: .44 });
  await page.mouse.move(end.x, end.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 7 });
  await page.mouse.up();
  const connected = await snapshot(page);
  expect(connected.split?.join).toBeCloseTo(.44, 2);
  expect(connected.split?.mix).toBe(.5);
  expect(connected.selectedId).toBe("junction");
  expect(connected.history).toBe(fork.history + 1);
  expect(connected.junctionArrivals[0]).not.toBeCloseTo(connected.junctionArrivals[1], 2);
  await expect(page.locator("#junctionAdjust")).toBeVisible();
  await expect(page.locator("#tapeStatus")).toHaveText("PATCH MIX");
  await expect(page.locator("#junctionArrival")).toContainText("Δ");
  await testInfo.attach("tapezoid-segment-junction.png", {
    body: await page.screenshot(), contentType: "image/png",
  });
  expect(connected.speed).toBe(0);
  expect(connected.audioOn).toBe(false, "patching never arms Audio");

  await page.locator("#junctionMix").evaluate(field => {
    field.value = ".8";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect((await snapshot(page)).split.mix).toBe(.8);
  await page.locator("#undoButton").click();
  expect((await snapshot(page)).split.mix).toBe(.5);
  await page.locator("#joinButton").click();
  const patched = await snapshot(page);
  expect(patched.split).toBeNull();
  expect(patched.patches.at(-1)).toBeCloseTo(connected.split.join, 2);
  await page.locator("#undoButton").click();
  expect((await snapshot(page)).split).toEqual(connected.split);

  await page.locator("#resetButton").click();
  await page.locator("[data-speed='0']").click();
  await page.locator("#razorTool").click();
  const nextBlade = await workbenchPoint(page, { kind: "tape", position: .33 });
  await page.mouse.click(nextBlade.x, nextBlade.y);
  await page.locator("#tapeTool").click();
  const viaScotch = await workbenchPoint(page, { kind: "tape", position: .44 });
  await page.mouse.click(viaScotch.x, viaScotch.y);
  expect((await snapshot(page)).split.join).toBeCloseTo(.44, 2);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("a running Scotch mixer keeps one audible transport and bounded output", async ({ page, baseURL }) => {
  test.setTimeout(90_000);
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await ready(page);
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#razorTool").click();
  const blade = await workbenchPoint(page, { kind: "tape", position: .33 });
  await page.mouse.click(blade.x, blade.y);
  await page.locator("#tapeTool").click();
  const target = await workbenchPoint(page, { kind: "tape", position: .44 });
  await page.mouse.click(target.x, target.y);
  expect((await snapshot(page)).split.join).toBeCloseTo(.44, 2);
  for (const mix of ["0", "1"]) {
    await page.locator("#junctionMix").evaluate((field, value) => {
      field.value = value;
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
    }, mix);
    expect((await snapshot(page)).split.mix).toBe(Number(mix));
    const envelope = await sampleAudioEnvelope(page, { durationMs: 550, intervalMs: 80 });
    expect(envelope.summary.finite).toBe(true);
    expect(envelope.summary.maxRms).toBeGreaterThan(.002);
    expect(envelope.summary.clippedSamples).toBe(0);
    expect((await readAudioStatus(page)).connectionCount).toBe(1);
  }
  expect((await snapshot(page)).speed).toBe(1);
  await page.locator("#audioButton").click();
  await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(0);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("touch can cancel or commit a dragged blue join without opening the tape", async ({ page, baseURL }) => {
  test.setTimeout(75_000);
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await ready(page);
  await page.locator("[data-speed='0']").click();
  await page.locator("#razorTool").click();
  const blade = await workbenchPoint(page, { kind: "tape", position: .33 });
  await page.mouse.click(blade.x, blade.y);
  const original = await snapshot(page);
  const from = await workbenchPoint(page, { kind: "tape", position: original.split.end });
  const target = await workbenchPoint(page, { kind: "tape", position: .44 });
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [from] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [target] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    expect((await snapshot(page)).split).toEqual(original.split);
    expect((await snapshot(page)).history).toBe(original.history);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [from] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [target] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    expect((await snapshot(page)).split.join).toBeCloseTo(.44, 2);
    expect((await snapshot(page)).history).toBe(original.history + 1);
    expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
  } finally { await cdp.detach(); }
});

test("the single-post fork works with keyboard Razor, Scotch and a complete factory preset", async ({ page }) => {
  await ready(page);
  await page.locator("#scene").focus();
  await page.keyboard.press("r");
  await page.keyboard.press("Enter");
  const fork = await snapshot(page);
  expect(fork.split).not.toBeNull();
  expect(fork.branchDelays).toHaveLength(2);
  await page.locator("#scene").press("4");
  await page.locator("#scene").press("Enter");
  expect((await snapshot(page)).pools[0].laneId).toBe("lane-b",
    "Enter places a pool on the selected branch instead of the invisible original strip");
  await page.locator("#scene").press("ArrowLeft");
  expect((await snapshot(page)).pools[0].position).toBeLessThan((await snapshot(page)).split.end);
  await page.locator("#scene").press("BracketRight");
  await page.locator("#scene").press("ArrowRight");
  expect((await snapshot(page)).split).not.toBeNull();
  await page.locator("#scene").press("t");
  await page.locator("#scene").press("Enter");
  expect((await snapshot(page)).split).toBeNull();
  await page.locator(".header-preset-picker summary").click();
  await page.locator(".header-preset-controls [data-preset-id='route-13']").click();
  await expect(page.locator(".header-preset-controls")).toHaveAttribute("data-preset-id", "route-13");
  const preset = await snapshot(page);
  expect(preset.split?.guides).toHaveLength(2);
  expect(preset.pools[0].laneId).toBe("lane-b");
  expect(preset.cut).toBeNull();
  expect(preset.branchDelays[0]).not.toBeCloseTo(preset.branchDelays[1], 2);
  expect(preset.speed).toBe(1);
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
});

test("a live Razor fork keeps AudioWorklet transport and REC running; Scotch removes its delay", async ({ page, baseURL }) => {
  test.setTimeout(60_000);
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await ready(page);
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#razorTool").click();
  const position = await workbenchPoint(page, { kind: "tape", position: .33 });
  await page.mouse.click(position.x, position.y);
  const fork = await snapshot(page);
  await expect(page.locator("#tapeStatus")).toHaveText("BIFURCATED");
  expect(fork.speed).toBe(1);
  expect(fork.printing).toBe(true);
  expect(fork.branchDelays[1] - fork.branchDelays[0]).toBeGreaterThan(.08);
  await page.locator("#newPoolTool").click();
  const branch = await workbenchPoint(page, { kind: "branch", id: "lane-b", progress: .3 });
  await page.mouse.click(branch.x, branch.y);
  const pooled = await snapshot(page);
  expect(pooled.pools[0].laneId).toBe("lane-b");
  expect(pooled.seconds).toBeCloseTo(fork.seconds, 5);
  expect(pooled.branchDelays[1]).toBeGreaterThan(fork.branchDelays[1] + .9);
  expect(pooled.speed).toBe(1);
  expect(pooled.audioOn).toBe(true);
  const envelope = await sampleAudioEnvelope(page, { durationMs: 900, intervalMs: 80 });
  expect(envelope.summary.finite).toBe(true);
  expect(envelope.summary.maxRms).toBeGreaterThan(.002);
  expect(envelope.summary.clippedSamples).toBe(0);
  expect((await snapshot(page)).speed).toBe(1);
  await page.locator("#joinButton").click();
  expect((await snapshot(page)).patches).toHaveLength(1);
  expect((await snapshot(page)).branchDelays).toBeNull();
  expect((await snapshot(page)).pools[0].laneId).toBeUndefined();
  expect((await snapshot(page)).seconds).toBeGreaterThan(pooled.seconds + .9);
  expect((await snapshot(page)).speed).toBe(1);
  expect((await snapshot(page)).audioOn).toBe(true);
  expect((await readAudioStatus(page)).connectionCount).toBe(1);
  await page.locator("#audioButton").click();
  await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(0);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("nine keyboard fork-and-Scotch edits retain only eight bounded visible patches", async ({ page }) => {
  test.setTimeout(55_000); // Eighteen geometry rebuilds on software WebGL.
  await ready(page);
  await page.locator("#scene").focus();
  for (let count = 0; count < 9; count++) {
    await page.keyboard.press("r");
    await page.keyboard.press("Enter");
    await page.keyboard.press("t");
    await page.keyboard.press("Enter");
  }
  const state = await snapshot(page);
  expect(state.cut).toBeNull();
  expect(state.patches).toHaveLength(8);
  expect(state.history).toBe(18);
  await expect(page.locator("#tapeStatus")).toHaveText("PATCHED");
  await page.locator(".header-preset-random").click();
  await expect(page.locator(".header-preset-controls")).toHaveAttribute("data-preset-id", "custom");
  expect((await snapshot(page)).speed).toBe(1);
});

test("phase study presets layer two, four and eight virtual reads; echo remains a separate route", async ({ page, baseURL }) => {
  test.setTimeout(85_000);
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await ready(page);
  const choose = async id => {
    await page.locator(".header-preset-picker summary").click();
    await page.locator(`[data-preset-id='${id}']`).click();
    await expect(page.locator(".header-preset-controls")).toHaveAttribute("data-preset-id", id);
    return snapshot(page);
  };
  const paired = await choose("route-16");
  expect(paired.voices).toBe(2);
  expect(paired.printing).toBe(false);
  expect(paired.monitorMix).toBe(0);
  expect(paired.echoReturn).toBe(0);
  await page.locator("#audioButton").click();
  await expect.poll(async () => (await snapshot(page)).phaseShiftTime).toBeGreaterThan(.001);
  const beforeLayering = await snapshot(page);
  const four = await choose("route-17");
  expect(four.voices).toBe(4);
  expect(four.echoReturn).toBe(0);
  expect(four.rollers.length).toBeGreaterThan(paired.rollers.length + 4);
  expect(four.phaseShiftTime).toBeGreaterThan(beforeLayering.phaseShiftTime - .01);
  const eight = await choose("route-18");
  expect(eight.voices).toBe(8);
  expect(eight.echoReturn).toBe(0);
  expect(eight.rollers.length).toBeGreaterThan(four.rollers.length);
  expect(eight.speed).toBe(1);
  expect(eight.audioOn).toBe(true);
  const echo = await choose("route-19");
  expect(echo.voices).toBe(1);
  expect(echo.echoReturn).toBeGreaterThan(.5);
  expect(echo.pools[0].seconds).toBeGreaterThan(1);
  expect(echo.rollers.length).toBeGreaterThan(12);
  const fork = await choose("route-20");
  expect(fork.split).not.toBeNull();
  expect(fork.pools[0].laneId).toBe("lane-b");
  expect(fork.audioOn).toBe(true);
  expect((await readAudioStatus(page)).connectionCount).toBe(1);
  const envelope = await sampleAudioEnvelope(page, { durationMs: 700, intervalMs: 80 });
  expect(envelope.summary.finite).toBe(true);
  expect(envelope.summary.maxRms).toBeGreaterThan(.002);
  expect(envelope.summary.clippedSamples).toBe(0);
  await page.locator("#audioButton").click();
  await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(0);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("presets, dice and keyboard transport preserve external Audio/transport state", async ({ page }) => {
  test.setTimeout(55_000);
  await ready(page);
  await page.locator("[data-speed='-1']").click();
  await expect(page.locator("[data-speed='-1']")).toHaveAttribute("aria-pressed", "true");
  await page.locator(".header-preset-next").click();
  expect((await snapshot(page)).speed).toBe(-1);
  await expect(page.locator(".header-preset-controls")).toHaveAttribute("data-preset-id", "route-1");
  await page.locator(".header-preset-random").click();
  await expect(page.locator(".header-preset-controls")).toHaveAttribute("data-preset-id", "custom");
  const randomized = await snapshot(page);
  expect(randomized.cut).toBeNull();
  expect(randomized.speed).toBe(-1);
  await page.locator("#scene").focus();
  await page.keyboard.press("Space"); // Stage owns Space, not the shared global handler.
  expect((await snapshot(page)).speed).toBe(0);
  await page.locator("#scene").press("Space");
  expect((await snapshot(page)).speed).toBe(1);
  await page.locator("#scene").press("g");
  await expect(page.locator("#routeTool")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#scene").press("BracketRight");
  await page.locator("#scene").press("ArrowRight");
  await expect(page.locator("#feedback")).toContainText("Moved");
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
});

test("Audio needs its own action, meters signal, pauses silently and disconnects on pagehide", async ({ page, baseURL }, testInfo) => {
  test.setTimeout(100_000); // Two AudioWorklet starts, meter probes and teardown.
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await ready(page);
  await page.locator("#playButton").click(); // Pause with Audio off.
  await page.locator("#playButton").click(); // Rolling silently again.
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(1);
  const playing = await sampleAudioEnvelope(page, { durationMs: 1600, intervalMs: 80 });
  await testInfo.attach("tapezoid-output-envelope.json", {
    body: JSON.stringify(playing, null, 2), contentType: "application/json",
  });
  expect(playing.summary.finite).toBe(true);
  expect(playing.summary.maxRms).toBeGreaterThan(.002);
  expect(playing.summary.clippedSamples).toBe(0);
  await setLevel(page, 0);
  await expect(page.locator("#outputLevelOut")).toHaveText("0%");
  await waitForStableAudioState(page, false, { stableMs: 250, timeout: 6000 });
  await setLevel(page, .72);
  await page.locator("[data-speed='0']").click();
  await waitForStableAudioState(page, false, { stableMs: 250, timeout: 6000 });
  expect((await snapshot(page)).audioOn).toBe(true);
  await page.locator("#playButton").click();
  await page.locator(".header-preset-next").click();
  expect((await snapshot(page)).audioOn).toBe(true);
  expect((await snapshot(page)).speed).toBe(1);
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(0);
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(0);
  expect(await page.evaluate(() => "__tapezoid" in window)).toBe(false);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("a local stereo track is downmixed onto the tape without arming Audio or stopping transport", async ({ page, baseURL }) => {
  test.setTimeout(60_000);
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await ready(page);
  await page.locator("#trackFile").setInputFiles({
    name: "My song.wav", mimeType: "audio/wav", buffer: localToneWav(),
  });
  await expect(page.locator("#trackName")).toHaveText("My song.wav");
  const loaded = await snapshot(page);
  expect(loaded.trackSeconds).toBeCloseTo(2, 2);
  expect(loaded.audioOn).toBe(false);
  expect(loaded.speed).toBe(1);
  expect((await readAudioStatus(page)).connectionCount).toBe(0);

  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  const playing = await sampleAudioEnvelope(page, { durationMs: 900, intervalMs: 80 });
  expect(playing.summary.finite).toBe(true);
  expect(playing.summary.maxRms).toBeGreaterThan(.008);
  expect(playing.summary.clippedSamples).toBe(0);
  await page.locator("#originalTrack").click();
  await expect(page.locator("#trackName")).toHaveText("Afterimage · original track");
  expect((await snapshot(page)).speed).toBe(1);
  expect((await snapshot(page)).audioOn).toBe(true);
  await page.locator("#trackFile").setInputFiles({
    name: "Not audio.wav", mimeType: "audio/wav", buffer: Buffer.from("not-a-wave"),
  });
  await expect(page.locator("#audioError")).toContainText("Track could not load");
  expect((await snapshot(page)).trackName).toBe("Afterimage · original track");
  await page.locator("#audioButton").click();
  await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(0);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("a locally chosen GLB replaces only the cassette shell and restores without a remote request", async ({ page, baseURL }) => {
  test.setTimeout(55_000);
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await ready(page);
  const start = await snapshot(page);
  await page.locator("#cassetteFile").setInputFiles({
    name: "My cassette.glb", mimeType: "model/gltf-binary", buffer: localCassetteGlb(),
  });
  await expect(page.locator("#scene")).toHaveAttribute("data-cassette-model", "local");
  await expectTransportMatchesCassette(page);
  await expect(page.locator("#cassetteName")).toHaveText("My cassette.glb");
  expect((await snapshot(page)).rollers).toEqual(start.rollers);
  expect((await snapshot(page)).heads).toEqual(start.heads);
  expect((await snapshot(page)).audioOn).toBe(false);
  await page.locator("#cassetteFile").setInputFiles({
    name: "Bad cassette.glb", mimeType: "model/gltf-binary", buffer: localCassetteGlb(true),
  });
  await expect(page.locator("#cassetteError")).toContainText("external URLs are not loaded");
  await expect(page.locator("#cassetteName")).toHaveText("My cassette.glb");
  await page.locator("#stockCassette").click();
  await expect(page.locator("#scene")).toHaveAttribute("data-cassette-model", "stock");
  await expectTransportMatchesCassette(page);
  await expect(page.locator("#cassetteError")).toBeHidden();
  await expect(page.locator("#cassetteName")).toHaveText("Generated shell");
  expect((await snapshot(page)).cassetteRender.vertices).toBe(0);
  await page.locator("#bundledCassette").click();
  await expect(page.locator("#scene")).toHaveAttribute("data-cassette-model", "bundled");
  await expectTransportMatchesCassette(page);
  expect((await snapshot(page)).cassetteRender.vertices).toBe(3837);
  await page.reload();
  await expect(page.locator("#scene")).toHaveAttribute("data-cassette-model", "bundled");
  expect((await snapshot(page)).audioOn).toBe(false);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("a slow bundled fetch cannot replace a cassette chosen or restored in the meantime", async ({ page }) => {
  test.setTimeout(60_000);
  let release, requested = false;
  const model = await readFile(new URL("../assets/tapezoid/cassette-tape.glb", import.meta.url));
  await page.route("**/assets/tapezoid/cassette-tape.glb", async route => {
    requested = true;
    await new Promise(resolve => { release = resolve; });
    try {
      await route.fulfill({ status: 200, contentType: "model/gltf-binary", body: model });
    } catch {
      // Switching models aborts the old fetch, so its route may already be closed.
    }
  });
  await ready(page, { cassette: "stock" });
  await expect.poll(() => requested).toBe(true);
  await page.locator("#cassetteFile").setInputFiles({
    name: "My cassette.glb", mimeType: "model/gltf-binary", buffer: localCassetteGlb(),
  });
  await expect(page.locator("#scene")).toHaveAttribute("data-cassette-model", "local");
  release();
  await page.waitForTimeout(250);
  await expect(page.locator("#cassetteName")).toHaveText("My cassette.glb");
  expect((await snapshot(page)).cassetteRender.vertices).toBe(4);
  expect((await snapshot(page)).audioOn).toBe(false);
});

test("dropping a local cassette GLB on the workbench uses the same session-only model loader", async ({ page, baseURL }) => {
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await ready(page);
  const start = await snapshot(page);
  await page.locator("#scene").evaluate((element, base64) => {
    const file = new File([Uint8Array.from(atob(base64), char => char.charCodeAt(0))],
      "Dropped cassette.glb", { type: "model/gltf-binary" });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    element.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    if (!element.classList.contains("dragging-model")) throw new Error("Missing drop target");
    element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, localCassetteGlb().toString("base64"));
  await expect(page.locator("#cassetteName")).toHaveText("Dropped cassette.glb");
  await expect(page.locator("#scene")).toHaveAttribute("data-cassette-model", "local");
  expect((await snapshot(page)).rollers).toEqual(start.rollers);
  expect((await snapshot(page)).speed).toBe(1);
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test("sound-on-sound, head return, monitoring and motor doubling are preset-owned and survive Audio off/on", async ({ page, baseURL }) => {
  test.setTimeout(80_000);
  const diagnostics = watchPageDiagnostics(page, { baseURL });
  await ready(page);
  await page.locator(".header-preset-next").click();
  await expect(page.locator(".header-preset-controls")).toHaveAttribute("data-preset-id", "route-1");
  await page.locator("#feedbackAmount").evaluate(field => {
    field.value = "0.85"; field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.locator("#phaseSlip").evaluate(field => {
    field.value = "0.06"; field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.locator("#echoReturn").evaluate(field => {
    field.value = "0.77"; field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.locator("#monitorMix").evaluate(field => {
    field.value = "0.92"; field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.locator("#returnHead").selectOption("play-2");
  await page.locator("#sourceVoices").selectOption("8");
  await expect(page.locator(".header-preset-controls")).toHaveAttribute("data-preset-id", "custom");
  await page.locator("#printTape").uncheck();
  const edited = await snapshot(page);
  expect(edited).toMatchObject({
    feedback: .85, phaseSlip: .06, printing: false,
    echoReturn: .77, returnHead: "play-2", monitorMix: .92, voices: 8, audioOn: false,
  });
  expect((await readAudioStatus(page)).connectionCount).toBe(0);
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await snapshot(page)).phaseShiftTime, { timeout: 7500 }).toBeGreaterThan(.045);
  await expect.poll(async () => (await snapshot(page)).extraPhaseTimes[0], { timeout: 7500 }).toBeGreaterThan(.01);
  await page.locator("#phaseSlip").evaluate(field => {
    field.value = "0"; field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.locator("#syncMotors").click();
  await expect.poll(async () => (await snapshot(page)).phaseShiftTime).toBeLessThan(.01);
  await expect.poll(async () => (await snapshot(page)).extraPhaseTimes[0]).toBeLessThan(.004);
  expect((await snapshot(page)).speed).toBe(1);
  expect((await snapshot(page)).audioOn).toBe(true);
  await page.locator("#phaseSlip").evaluate(field => {
    field.value = "0.06"; field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect.poll(async () => (await snapshot(page)).extraPhaseTimes[0], { timeout: 7500 })
    .toBeGreaterThan(.01);
  await page.locator("#phaseSlip").evaluate(field => {
    field.value = "0"; field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const locked = await snapshot(page);
  await page.waitForTimeout(350);
  expect(Math.abs((await snapshot(page)).phaseShiftTime - locked.phaseShiftTime)).toBeLessThan(.015);
  await page.locator("#audioButton").click();
  await expect.poll(async () => (await snapshot(page)).memoryStored).toBe(true);
  await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(0);
  await page.locator("#audioButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await snapshot(page)).extraPhaseTimes[0], { timeout: 5000 })
    .toBeGreaterThan(.005);
  const reopened = await snapshot(page);
  expect(reopened.printing).toBe(false);
  expect(reopened.voices).toBe(8);
  expect(reopened.returnHead).toBe("play-2");
  expect(Math.abs(reopened.extraPhaseTimes[0] - locked.extraPhaseTimes[0])).toBeLessThan(.005);
  await page.locator(".header-preset-next").click();
  const recalled = await snapshot(page);
  expect(recalled.feedback).not.toBe(.85);
  expect(recalled.printing).toBe(true);
  expect(recalled.audioOn).toBe(true);
  expect(recalled.speed).toBe(1);
  await page.locator("#resetButton").click();
  const reset = await snapshot(page);
  expect(reset).toMatchObject({
    feedback: .45, phaseSlip: 0, printing: true,
    echoReturn: 0, returnHead: "play-1", monitorMix: .75, voices: 1,
    memoryStored: false,
  });
  await page.locator("#audioButton").click();
  await expect.poll(async () => (await readAudioStatus(page)).connectionCount).toBe(0);
  expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
});

test.describe("emulated touch", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("a finger next to a post picks up that post instead of drawing a curve", async ({ page }) => {
    test.setTimeout(75_000);
    await ready(page);
    const before = await snapshot(page);
    const start = await workbenchPoint(page, { x: .8, z: 2.55 });
    const to = await workbenchPoint(page, { x: 1.25, z: 1.65 });
    const cdp = await page.context().newCDPSession(page);
    try {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [start] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [to] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      const moved = await snapshot(page);
      expect(moved.rollers).toHaveLength(before.rollers.length);
      expect(moved.rollers[3].z).toBeLessThan(before.rollers[3].z - .45);
      expect(moved.rollers.filter(roller => roller.id !== "roller-4")).toEqual(
        before.rollers.filter(roller => roller.id !== "roller-4"));
      await page.locator("#undoButton").click();
      expect((await snapshot(page)).rollers).toEqual(before.rollers);
    } finally { await cdp.detach(); }
  });

  test("finger pulls and cancels an intact stretch, then pools a movable fork half in landscape", async ({ page, baseURL }) => {
    test.setTimeout(110_000);
    const diagnostics = watchPageDiagnostics(page, { baseURL });
    await ready(page);
    const cdp = await page.context().newCDPSession(page);
    const tap = async point => {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    };
    try {
      const before = await snapshot(page);
      const bare = await workbenchPoint(page, { kind: "tape", position: .62 });
      const farther = await workbenchPoint(page, { x: 1.5, z: .7 });
      await tap(bare);
      expect((await snapshot(page)).history).toBe(before.history);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [bare] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [farther] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
      expect((await snapshot(page)).rollers).toEqual(before.rollers);
      expect((await snapshot(page)).history).toBe(before.history);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [bare] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [farther] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      expect((await snapshot(page)).rollers.some(roller => roller.id === "post-1")).toBe(true);
      await page.locator("#undoButton").click();
      expect((await snapshot(page)).rollers).toEqual(before.rollers);

      await page.setViewportSize({ width: 844, height: 390 });
      await settlePage(page);
      await page.locator("#razorTool").click();
      await tap(await workbenchPoint(page, { kind: "tape", position: .33 }));
      const fork = await snapshot(page);
      expect(fork.split).not.toBeNull();
      await page.locator("#newPoolTool").click();
      await tap(await workbenchPoint(page, { kind: "branch", id: "lane-b", progress: .32 }));
      const pooled = await snapshot(page);
      expect(pooled.pools[0].laneId).toBe("lane-b");
      const amber = await workbenchPoint(page, { kind: "branch", id: "lane-a", progress: .7 });
      const stretched = await workbenchPoint(page, { x: -4.7, z: .4 });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [amber] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [stretched] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      const moved = await snapshot(page);
      expect(Math.abs(moved.branchDelays[0] - pooled.branchDelays[0])).toBeGreaterThan(.15);
      expect(moved.branchDelays[1]).toBeCloseTo(pooled.branchDelays[1], 5);
      await page.locator("#joinButton").click();
      const joined = await snapshot(page);
      expect(joined.split).toBeNull();
      expect(joined.pools[0].laneId).toBeUndefined();
      expect(joined.audioOn).toBe(false);
      expect(joined.speed).toBe(1);
      expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
    } finally { await cdp.detach(); }
  });

  test("a finger draws several corners in one stroke; cancel restores the whole maze", async ({ page, baseURL }) => {
    test.setTimeout(85_000);
    const diagnostics = watchPageDiagnostics(page, { baseURL });
    await ready(page);
    await page.locator("#drawTool").click();
    const before = await snapshot(page);
    const start = await workbenchPoint(page, { kind: "tape", position: .62 });
    const corners = [];
    for (const [x, z] of [
      [-5.75, 2.5], [5.7, 2.55], [5.7, -.75],
      [-5.7, -.7], [-5.6, 1.7], [5.5, 1.75],
    ]) corners.push(await workbenchPoint(page, { x, z }));
    const cdp = await page.context().newCDPSession(page);
    const draw = async canceled => {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [start] });
      for (const point of corners) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [point] });
      }
      await cdp.send("Input.dispatchTouchEvent", {
        type: canceled ? "touchCancel" : "touchEnd", touchPoints: [],
      });
    };
    try {
      await draw(true);
      expect((await snapshot(page)).rollers).toEqual(before.rollers);
      expect((await snapshot(page)).history).toBe(before.history);
      await draw(false);
      const maze = await snapshot(page);
      expect(maze.rollers.filter(roller => roller.id.startsWith("post-")).length).toBeGreaterThanOrEqual(5);
      expect(maze.history).toBe(before.history + 1);
      expect(maze.speed).toBe(1);
      expect(maze.audioOn).toBe(false);
      await page.locator("#undoButton").click();
      expect((await snapshot(page)).rollers).toEqual(before.rollers);
      expect((await readAudioStatus(page)).connectionCount).toBe(0);
      expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
    } finally { await cdp.detach(); }
  });

  test("the desk toolbar places, adjusts and erases parts by touch across phone orientation", async ({ page, baseURL }) => {
    test.setTimeout(70_000);
    const diagnostics = watchPageDiagnostics(page, { baseURL });
    await ready(page);
    await page.locator("[data-speed='0']").click();
    const cdp = await page.context().newCDPSession(page);
    const tap = async point => {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    };
    try {
      await page.locator("#newPlayTool").click();
      await tap(await workbenchPoint(page, { kind: "tape", position: .7 }));
      expect((await snapshot(page)).headParts.some(head => head.id === "play-3")).toBe(true);
      await page.locator("#newPostTool").click();
      await tap(await workbenchPoint(page, { x: -2.75, z: 1.7 }));
      expect((await snapshot(page)).rollers.some(roller => roller.id === "post-1")).toBe(true);
      await page.locator("#newPoolTool").click();
      await tap(await workbenchPoint(page, { kind: "tape", position: .3 }));
      expect((await snapshot(page)).pools).toHaveLength(1);
      await page.setViewportSize({ width: 844, height: 390 });
      await settlePage(page);
      await expect(page.locator("#poolAdjust")).toBeVisible();
      await page.locator("#poolSeconds").evaluate(field => {
        field.value = "1.75";
        field.dispatchEvent(new Event("input", { bubbles: true }));
        field.dispatchEvent(new Event("change", { bubbles: true }));
      });
      expect((await snapshot(page)).pools[0].seconds).toBe(1.75);
      const center = await workbenchPoint(page, { kind: "pool", id: "pool-1" });
      const destination = await workbenchPoint(page, { kind: "tape", position: .48 });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [center] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [destination] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
      expect((await snapshot(page)).pools[0].position).toBeGreaterThan(.39);
      await page.locator("#eraseTool").click();
      await tap(await workbenchPoint(page, { kind: "pool", id: "pool-1" }));
      expect((await snapshot(page)).pools).toHaveLength(0);
      await page.locator("#undoButton").click();
      expect((await snapshot(page)).pools[0].seconds).toBe(1.75);
      expect((await readAudioStatus(page)).connectionCount).toBe(0);
      expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
    } finally { await cdp.detach(); }
  });

  test("a finger forks the ribbon, moves the separating post and Scotch removes the detour", async ({ page, baseURL }) => {
    test.setTimeout(55_000);
    const diagnostics = watchPageDiagnostics(page, { baseURL });
    await ready(page);
    await page.locator("[data-speed='0']").click();
    await page.locator("#razorTool").click();
    const points = [];
    for (let fraction = .32; fraction <= .338; fraction += .006) {
      points.push(await workbenchPoint(page, { kind: "tape", position: fraction }));
    }
    const cdp = await page.context().newCDPSession(page);
    try {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [points[0]] });
      for (const point of points.slice(1)) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [point] });
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      const fork = await snapshot(page);
      expect(fork.split?.guides).toHaveLength(2);
      expect(fork.cut).toBeNull();
      expect(fork.tool).toBe("route");
      const from = await workbenchPoint(page, { kind: "guide", id: "lane-b" });
      const destination = await workbenchPoint(page, { x: -3.4, z: -.4 });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [from] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [destination] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      const bent = await snapshot(page);
      expect(Math.abs(bent.branchDelays[1] - fork.branchDelays[1])).toBeGreaterThan(.025);
      expect(bent.branchDelays[0]).toBeCloseTo(fork.branchDelays[0], 6);
      await page.locator("#tapeTool").click();
      const rejoin = await workbenchPoint(page, { kind: "tape", position: bent.split.end });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [rejoin] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      expect((await snapshot(page)).split).toBeNull();
      expect((await snapshot(page)).patches).toHaveLength(1);
      expect((await readAudioStatus(page)).connectionCount).toBe(0);
      expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
    } finally { await cdp.detach(); }
  });

  test("touch drags a roller, uses toolbar Razor, cancels a cut, and patches after rotation", async ({ page, baseURL }) => {
    const diagnostics = watchPageDiagnostics(page, { baseURL });
    await ready(page);
    const before = await snapshot(page);
    const from = await workbenchPoint(page, { kind: "roller", id: "roller-4" });
    const to = await workbenchPoint(page, { x: .4, z: 1 });
    const cdp = await page.context().newCDPSession(page);
    try {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [from] });
      for (let step = 1; step <= 10; step++) {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove", touchPoints: [{
            x: from.x + (to.x - from.x) * step / 10,
            y: from.y + (to.y - from.y) * step / 10,
          }],
        });
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
      expect((await snapshot(page)).rollers[3].z).toBeLessThan(before.rollers[3].z - .6);
      await page.setViewportSize({ width: 844, height: 390 });
      await page.locator("[data-speed='0']").click();
      await page.locator("#razorTool").scrollIntoViewIfNeeded();
      await page.locator("#razorTool").tap();
      await expect(page.locator("#razorTool")).toHaveAttribute("aria-pressed", "true");
      const cutPoint = await workbenchPoint(page, { kind: "tape", position: .33 });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [cutPoint] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
      expect((await snapshot(page)).split).toBeNull();
      expect((await snapshot(page)).tool).toBe("razor");
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [cutPoint] });
      const endPoint = await workbenchPoint(page, { kind: "tape", position: .335 });
      for (let step = 1; step <= 12; step++) {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove", touchPoints: [{
            x: cutPoint.x + (endPoint.x - cutPoint.x) * step / 12,
            y: cutPoint.y + (endPoint.y - cutPoint.y) * step / 12,
          }],
        });
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await expect(page.locator("#joinButton")).toBeEnabled();
      expect((await snapshot(page)).split).not.toBeNull();
      await page.locator("#joinButton").click();
      expect((await snapshot(page)).patches).toHaveLength(1);
      expect((await snapshot(page)).speed).toBe(0);
      expect((await readAudioStatus(page)).connectionCount).toBe(0);
      expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
    } finally { await cdp.detach(); }
  });
});
