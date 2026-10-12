import { test, expect } from "@playwright/test";

const state = (page) => page.evaluate(() => window.__trackazoid.snapshot());
const deck = async (page, id) => (await state(page)).decks[id];

function diagnostics(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("requestfailed", (request) => {
    if (new URL(request.url()).origin === new URL(page.url()).origin && request.failure()?.errorText !== "net::ERR_ABORTED") errors.push(`${request.failure()?.errorText} ${request.url()}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && new URL(response.url()).origin === new URL(page.url()).origin) errors.push(`${response.status()} ${response.url()}`);
  });
  return errors;
}

async function ready(page, { demos = true } = {}) {
  await page.goto("/trackazoid.html");
  await expect(page.locator("#trackazoid")).toHaveAttribute("data-ready", "true");
  if (demos) {
    await page.locator("#demoPair").click();
    await expect(page.locator("#aState")).toHaveText("READY");
    await expect(page.locator("#bState")).toHaveText("READY");
    await expect(page.locator("#demoPair")).toBeEnabled();
  }
}

async function remainsSilent(page, errors) {
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  expect((await state(page)).contextState).toBe("none");
  expect(errors).toEqual([]);
}

async function canvasGeometry(page, id) {
  const canvas = page.locator(`#${id}Waveform`);
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  const snapshot = await deck(page, id);
  return { canvas, box, snapshot };
}

// Ratios describe the visible window, not track duration. Using real pointer
// events exercises capture, the drag threshold and the canvas hit regions.
async function gesture(page, id, from, to, { modifiers = [], y = 0.42, cancel = false } = {}) {
  const geometry = await canvasGeometry(page, id), { box } = geometry;
  for (const modifier of modifiers) await page.keyboard.down(modifier);
  try {
    await page.mouse.move(box.x + box.width * from, box.y + box.height * y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * to, box.y + box.height * y, { steps: 8 });
    if (cancel) await geometry.canvas.dispatchEvent("pointercancel", { pointerId: 1, pointerType: "mouse", button: 0 });
    await page.mouse.up();
  } finally { for (const modifier of modifiers.reverse()) await page.keyboard.up(modifier); }
  return geometry;
}

async function clickTime(page, id, time, options = {}) {
  const { canvas, box, snapshot } = await canvasGeometry(page, id);
  const ratio = (time - snapshot.viewport.start) / snapshot.viewport.span;
  expect(ratio).toBeGreaterThanOrEqual(0); expect(ratio).toBeLessThanOrEqual(1);
  await canvas.click({ position: { x: ratio * box.width, y: box.height * 0.42 }, ...options });
}

function beatAligned(value, metadata) {
  const beat = (value - metadata.beatOffset) * metadata.bpm / 60;
  expect(Math.abs(beat - Math.round(beat))).toBeLessThan(0.00001);
}

function silentWave(seconds = 8) {
  const sampleRate = 8000, bytes = Buffer.alloc(44 + seconds * sampleRate * 2);
  bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24); bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write("data", 36);
  bytes.writeUInt32LE(bytes.length - 44, 40); return bytes;
}

for (const id of ["a", "b"]) {
  test(`deck ${id.toUpperCase()} selects, reverses and trims a range without seeking; Snap has an Alt override`, async ({ page }) => {
    const errors = diagnostics(page); await ready(page);
    await page.locator(`#${id}Fit`).click();
    const initial = await deck(page, id);
    await expect(page.locator(`#${id}Snap`)).toHaveAttribute("aria-pressed", "true");
    await gesture(page, id, 0.21, 0.59);
    let after = await deck(page, id);
    expect(after.position).toBe(initial.position); expect(after.playing).toBe(false); expect(after.loop).toBeNull();
    expect(after.selection.start).toBeLessThan(after.selection.end);
    beatAligned(after.selection.start, after.metadata); beatAligned(after.selection.end, after.metadata);
    await expect(page.locator(`#${id}SelectionInfo`)).not.toHaveText("");

    // Start away from the previous range's handles, then drag backwards.
    await gesture(page, id, 0.81, 0.35);
    after = await deck(page, id);
    expect(after.selection.start).toBeLessThan(after.selection.end);
    expect(after.selection.start).toBeGreaterThan(initial.duration * 0.3);
    expect(after.selection.end).toBeGreaterThan(initial.duration * 0.75);
    const originalEnd = after.selection.end;
    await gesture(page, id, (after.selection.start - after.viewport.start) / after.viewport.span, 0.49);
    after = await deck(page, id);
    expect(after.selection.start).toBeGreaterThan(initial.duration * 0.45);
    expect(after.selection.end).toBe(originalEnd);
    await clickTime(page, id, initial.duration * 0.9, { modifiers: ["Shift"] });
    const extended = await deck(page, id);
    expect(extended.selection.start).toBe(after.selection.start);
    expect(extended.selection.end).toBeGreaterThan(originalEnd);

    await page.locator(`#${id}SelectionClear`).click();
    expect((await deck(page, id)).selection).toBeNull();
    const free = await gesture(page, id, 0.137, 0.433, { modifiers: ["Alt"] });
    after = await deck(page, id);
    const pixelSeconds = free.snapshot.viewport.span / free.box.width;
    expect(after.selection.start).toBeCloseTo(free.snapshot.viewport.start + free.snapshot.viewport.span * 0.137, 1);
    expect(Math.abs(after.selection.end - (free.snapshot.viewport.start + free.snapshot.viewport.span * 0.433))).toBeLessThan(pixelSeconds * 2);
    const startBeat = (after.selection.start - after.metadata.beatOffset) * after.metadata.bpm / 60;
    expect(Math.abs(startBeat - Math.round(startBeat))).toBeGreaterThan(0.05);
    expect(after.position).toBe(initial.position);
    await page.locator(`#${id}SelectionClear`).click();
    await clickTime(page, id, initial.duration * 0.6);
    expect((await deck(page, id)).position).toBeGreaterThan(initial.duration * 0.55);
    await remainsSilent(page, errors);
  });
}

test("selection, zoom and Shift-pan preserve both running decks and follower Sync", async ({ page }) => {
  const errors = diagnostics(page); await ready(page);
  await page.locator("#aPlay").click(); await page.locator("#bSync").click(); await page.locator("#bPlay").click();
  await expect.poll(async () => (await deck(page, "b")).pending).toBe(false);
  await page.locator("#bFit").click();
  const before = await state(page);
  await gesture(page, "b", 0.45, 0.74);
  let after = await state(page);
  expect(after.decks.b.selection).not.toBeNull(); expect(after.decks.b.loop).toBeNull();
  expect(after.decks.b.position - before.decks.b.position).toBeGreaterThanOrEqual(0);
  expect(after.decks.b.position - before.decks.b.position).toBeLessThan(2);
  const selection = after.decks.b.selection;
  await page.locator("#bZoomIn").click();
  const zoomed = await deck(page, "b"); expect(zoomed.viewport.span).toBeLessThan(before.decks.b.viewport.span);
  await gesture(page, "b", 0.75, 0.25, { modifiers: ["Shift"] });
  after = await state(page);
  expect(after.decks.b.viewport.start).toBeGreaterThan(zoomed.viewport.start);
  expect(after.decks.b.viewport.following).toBe(false);
  expect(after.decks.b.selection).toEqual(selection);
  for (const id of ["a", "b"]) expect(after.decks[id].playing).toBe(true);
  expect(after.decks.b.sync).toBe(true); expect(after.decks.b.syncError).toBeFalsy();
  expect(Math.abs(after.decks.b.phaseError)).toBeLessThan(0.05);
  await page.locator("#bZoomOut").click();
  expect((await deck(page, "b")).viewport.span).toBeGreaterThan(zoomed.viewport.span);
  await page.locator("#bFollow").click();
  expect((await deck(page, "b")).viewport.following).toBe(true);
  await page.locator("#bFit").click();
  const fit = await deck(page, "b"); expect(fit.viewport.span).toBeCloseTo(fit.duration, 5);
  expect(fit.sync).toBe(true); expect(fit.selection).toEqual(selection);
  await remainsSilent(page, errors);
});

test("focused waveform shortcuts edit the selected deck while text and native controls keep their keys", async ({ page }) => {
  const errors = diagnostics(page); await ready(page);
  await page.locator("#bFit").click(); await page.locator("#bWaveform").focus();
  await page.keyboard.press("Home");
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight");
  await page.keyboard.press("i");
  await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowRight"); await page.keyboard.press("o");
  let b = await deck(page, "b"); expect(b.selection.end - b.selection.start).toBeGreaterThan(0.8);
  expect((await state(page)).selected).toBe("b");
  await page.keyboard.press("l"); expect((await deck(page, "b")).loop).toEqual(b.selection);
  await page.keyboard.press("l"); expect((await deck(page, "b")).loop).toBeNull();
  await page.keyboard.press("m"); b = await deck(page, "b"); expect(b.metadata.cues[0]).toBeCloseTo(b.position, 5);
  await page.keyboard.press("Shift+Digit1"); expect((await deck(page, "b")).metadata.cues[0]).toBeNull();
  await page.keyboard.press("1"); expect((await deck(page, "b")).metadata.cues[0]).not.toBeNull();
  await page.keyboard.press("Delete"); expect((await deck(page, "b")).selection).toBeNull();
  await page.keyboard.press("Space"); expect((await deck(page, "b")).playing).toBe(true);
  expect((await deck(page, "a")).playing).toBe(false);
  await page.keyboard.press("Space"); expect((await deck(page, "b")).playing).toBe(false);

  await page.locator("#librarySearch").fill("mix");
  await page.keyboard.type(" ioml1234 "); await page.keyboard.press("Backspace");
  await expect(page.locator("#librarySearch")).toHaveValue("mix ioml1234");
  const untouched = await deck(page, "b"); expect(untouched.playing).toBe(false); expect(untouched.selection).toBeNull();
  expect(untouched.metadata.cues.slice(1)).toEqual([null, null, null]);
  await page.locator("#bPlay").focus(); await page.keyboard.press("Space");
  expect((await deck(page, "b")).playing).toBe(true);
  await page.keyboard.press("Space"); expect((await deck(page, "b")).playing).toBe(false);
  await page.locator("#bLoopBeats").focus(); await page.keyboard.press("ArrowDown");
  expect((await deck(page, "b")).loop).toBeNull();
  expect((await deck(page, "b")).metadata.cues).toEqual(untouched.metadata.cues);
  await remainsSilent(page, errors);
});

test("double-click and bottom cue flags edit persistent markers while selection and view reset on reload", async ({ page }) => {
  const errors = diagnostics(page); await ready(page);
  await page.locator("#aFit").click();
  const { canvas, box } = await canvasGeometry(page, "a");
  await canvas.dblclick({ position: { x: box.width * 0.25, y: box.height * 0.42 } });
  let a = await deck(page, "a"); expect(a.metadata.cues[0]).not.toBeNull();
  expect(a.metadata.cues.slice(1)).toEqual([null, null, null]);
  const first = a.metadata.cues[0], playhead = a.position;
  await gesture(page, "a", (first - a.viewport.start) / a.viewport.span + 3 / box.width, 0.59, { y: 1 - 12 / box.height });
  a = await deck(page, "a"); expect(a.metadata.cues[0]).toBeGreaterThan(first + 1);
  expect(a.position).toBe(playhead); beatAligned(a.metadata.cues[0], a.metadata);
  const moved = a.metadata.cues[0];
  await gesture(page, "a", 0.11, 0.39); await page.locator("#aZoomIn").click();
  expect((await deck(page, "a")).selection).not.toBeNull();
  await expect.poll(() => page.evaluate(() => new Promise((resolve, reject) => {
    const opening = indexedDB.open("morphazoid-trackazoid-library", 1);
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result, request = db.transaction("entries", "readonly").objectStore("entries").getAll();
      request.onerror = () => { db.close(); reject(request.error); };
      request.onsuccess = () => { db.close(); resolve(request.result.find(entry => entry.name.startsWith("Mint transmission"))?.metadata.cues[0]); };
    };
  }))).toBe(moved);
  await ready(page);
  a = await deck(page, "a"); expect(a.metadata.cues[0]).toBe(moved); expect(a.selection).toBeNull();
  expect(a.position).toBe(0); expect(a.viewport.following).toBe(true);
  await page.locator("#aHotCue1").click(); expect((await deck(page, "a")).position).toBeCloseTo(moved, 5);
  await remainsSilent(page, errors);
});

test("unknown-BPM tracks support In/Out selection and range loops without Audio or a guessed beat grid", async ({ page }) => {
  const errors = diagnostics(page); await ready(page, { demos: false });
  await page.locator("#filePicker").setInputFiles({ name: "No beat.wav", mimeType: "audio/wav", buffer: silentWave() });
  await page.getByRole("button", { name: "Load No beat.wav into deck A", exact: true }).click();
  await expect(page.locator("#aState")).toHaveText("READY");
  await expect.poll(async () => (await deck(page, "a")).analyzing).toBe(false);
  expect((await deck(page, "a")).metadata.gridSource).toBe("unknown");
  await page.locator("#aFit").click();
  await clickTime(page, "a", 1); await page.locator("#aSelectionIn").click();
  await clickTime(page, "a", 3); await page.locator("#aSelectionOut").click();
  const selection = (await deck(page, "a")).selection;
  expect(selection.start).toBeCloseTo(1, 1); expect(selection.end).toBeCloseTo(3, 1);
  await clickTime(page, "a", 0.5); await page.locator("#aSelectionOut").click();
  expect((await deck(page, "a")).selection).toEqual(selection);
  await expect(page.locator("#aLoop")).toBeEnabled();
  await page.locator("#aSelectionLoop").click(); expect((await deck(page, "a")).loop).toEqual(selection);
  await page.locator("#aPlay").click();
  await expect.poll(async () => {
    const a = await deck(page, "a"); return a.position >= selection.start && a.position < selection.end && a.playing;
  }).toBe(true);
  await page.locator("#aLoop").click(); expect((await deck(page, "a")).loop).toBeNull();
  await page.locator("#aWaveform").focus(); await page.keyboard.press("l");
  expect((await deck(page, "a")).loop).toEqual(selection);
  await gesture(page, "a", 0.51, 0.79);
  const edited = (await deck(page, "a")).selection;
  expect(edited.start).toBeGreaterThan(selection.end);
  expect((await deck(page, "a")).loop).toEqual(selection);
  await page.locator("#aSelectionLoop").click(); expect((await deck(page, "a")).loop).toEqual(edited);
  await page.locator("#aWaveform").focus();
  await page.keyboard.press("Backspace"); expect((await deck(page, "a")).selection).toBeNull();
  expect((await deck(page, "a")).playing).toBe(true);
  await remainsSilent(page, errors);
});

test("cancelled range and cue drags restore the last committed edit", async ({ page }) => {
  const errors = diagnostics(page); await ready(page); await page.locator("#aFit").click();
  await gesture(page, "a", 0.15, 0.45); const selection = (await deck(page, "a")).selection;
  await gesture(page, "a", 0.68, 0.89, { cancel: true });
  expect((await deck(page, "a")).selection).toEqual(selection);
  const { canvas, box } = await canvasGeometry(page, "a");
  await canvas.dblclick({ position: { x: box.width * 0.6, y: box.height * 0.42 } });
  const a = await deck(page, "a"), cues = a.metadata.cues;
  await gesture(page, "a", (cues[0] - a.viewport.start) / a.viewport.span + 3 / box.width, 0.83, { y: 1 - 12 / box.height, cancel: true });
  expect((await deck(page, "a")).metadata.cues).toEqual(cues);
  // A subsequent ordinary edit proves cancellation released pointer state.
  await gesture(page, "a", 0.69, 0.91);
  expect((await deck(page, "a")).selection).not.toEqual(selection);
  await remainsSilent(page, errors);
});

async function assertHeaderHit(page) {
  const header = page.locator(".masthead"); await expect(header).toBeInViewport();
  const hit = await header.evaluate((node) => {
    const box = node.getBoundingClientRect(), style = getComputedStyle(node);
    return { top: box.top, opacity: Number(style.opacity), background: style.backgroundColor,
      hit: node.contains(document.elementFromPoint(box.left + box.width / 2, Math.max(0, box.top) + 2)) };
  });
  expect(hit.top).toBeGreaterThanOrEqual(-1); expect(hit.top).toBeLessThanOrEqual(1);
  expect(hit.hit).toBe(true); expect(hit.opacity).toBe(1);
  const alpha = hit.background.startsWith("rgba") ? Number(hit.background.split(",").at(-1).replace(")", "")) : 1;
  expect(alpha).toBe(1);
  for (const selector of [".instrument-picker-trigger", ".header-settings-trigger", "#audioButton"]) {
    const control = page.locator(`.masthead ${selector}`).first();
    await expect(control).toBeInViewport();
    expect(await control.evaluate((node) => {
      const box = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
    }), selector).toBe(true);
  }
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`wave tools and opaque menubar remain usable after document and library scrolling at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    const errors = diagnostics(page); await page.setViewportSize(viewport); await ready(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    for (const id of ["a", "b"]) {
      for (const key of ["Waveform", "Snap", "ZoomIn", "ZoomOut", "Fit", "Follow", "SelectionIn", "SelectionOut", "Mark"]) {
        const control = page.locator(`#${id}${key}`); await control.scrollIntoViewIfNeeded(); await expect(control).toBeInViewport();
        const box = await control.boundingBox(); expect(box.x).toBeGreaterThanOrEqual(-1);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
      }
    }
    await page.locator("#filePicker").setInputFiles(Array.from({ length: 45 }, (_, i) => ({ name: `Scroll ${i}.wav`, mimeType: "audio/wav", buffer: silentWave(0.01) })));
    await expect(page.locator("#trackCount")).toHaveText("47 tracks");
    await page.locator("#libraryTableWrap").scrollIntoViewIfNeeded();
    await page.locator("#libraryTableWrap").evaluate(node => { node.scrollTop = node.scrollHeight; });
    await expect.poll(() => page.locator("#libraryTableWrap").evaluate(node => node.scrollTop)).toBeGreaterThan(0);
    await page.mouse.move(viewport.width - 3, viewport.height - 40); await page.mouse.wheel(0, 500);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
    await assertHeaderHit(page);
    await page.locator(".masthead .instrument-picker-trigger").first().click();
    await expect(page.locator(".masthead .instrument-picker-panel").first()).toBeVisible();
    await page.keyboard.press("Escape");
    await page.locator(".header-settings-trigger").click();
    await expect(page.locator(".header-settings-panel")).toBeVisible();
    await page.keyboard.press("Escape");
    await assertHeaderHit(page); await remainsSilent(page, errors);
  });
}
