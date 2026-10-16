import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const dialog = ".output-recording-dialog";

test("IndexedDB recovery and independently valid WAV parts preserve every frame across chunk boundaries", async ({ page }) => {
  await page.goto("karplus-strong.html");
  const result = await page.evaluate(async () => {
    const { BrowserRecordingStore } = await import("/src/output-recording-storage.js");
    const database = `recording-parts-${Date.now()}`;
    let store = new BrowserRecordingStore({ database, routeId: "proof", partBytes: 256 });
    const take = await store.create({ filename: "words.wav", sampleRate: 48_000, channelCount: 2 });
    let offset = 0;
    for (const frames of [31, 49, 43]) {
      const bytes = new Uint8Array(frames * 6);
      for (let i = 0; i < bytes.length; i += 1) bytes[i] = (offset * 6 + i) % 251;
      await store.append(take.id, bytes.buffer, frames);
      offset += frames;
    }
    (await store.open()).close();
    store = new BrowserRecordingStore({ database, routeId: "proof" });
    const recovered = (await store.list())[0];
    const parts = [];
    for (let index = 1; index <= 4; index += 1) {
      const part = await store.exportPart(take.id, index);
      parts.push({ filename: part.filename, bytes: [...new Uint8Array(await part.blob.arrayBuffer())] });
    }
    // A request failure after a metadata mutation must roll back the entire
    // transaction, rather than leave a frame count without its PCM.
    let aborted = false;
    try {
      await store.transaction(["takes", "chunks"], "readwrite", tx => {
        tx.objectStore("takes").delete(take.id);
        tx.objectStore("chunks").add({ takeId: take.id, start: 0, frames: 1, buffer: new ArrayBuffer(6) });
      });
    } catch { aborted = true; }
    const retained = (await store.list())[0];
    await store.remove(take.id);
    const afterDelete = await store.list();
    let removed = false;
    try { await store.exportPart(take.id, 1); } catch { removed = true; }
    return { recovered, parts, aborted, retained, afterDelete, removed };
  });
  expect(result.recovered.frames).toBe(123);
  expect(result.recovered.state, "unfinished take is available without finalization").toBe("recording");
  expect(result.aborted).toBe(true);
  expect(result.retained.frames).toBe(123);
  expect(result.afterDelete).toEqual([]);
  expect(result.removed).toBe(true);
  const payloads = [];
  for (const [index, part] of result.parts.entries()) {
    const bytes = Buffer.from(part.bytes);
    expect(part.filename).toBe(`words-part-${String(index + 1).padStart(3, "0")}.wav`);
    expect(bytes.toString("ascii", 0, 4)).toBe("RIFF");
    expect(bytes.toString("ascii", 8, 12)).toBe("WAVE");
    expect(bytes.readUInt32LE(4) + 8).toBe(bytes.length);
    expect(bytes.readUInt32LE(40) + 44).toBe(bytes.length);
    expect(bytes.readUInt16LE(22)).toBe(2);
    expect(bytes.readUInt16LE(34)).toBe(24);
    expect(bytes.length).toBeLessThanOrEqual(256);
    payloads.push(bytes.subarray(44));
  }
  const combined = Buffer.concat(payloads);
  expect(combined.length).toBe(123 * 6);
  expect([...combined]).toEqual(Array.from({ length: 123 * 6 }, (_, i) => i % 251));
});

test("storage export rejects missing audio instead of silently joining across a gap", async ({ page }) => {
  await page.goto("karplus-strong.html");
  const result = await page.evaluate(async () => {
    const { BrowserRecordingStore } = await import("/src/output-recording-storage.js");
    const store = new BrowserRecordingStore({ database: `recording-gap-${Date.now()}`, partBytes: 256 });
    const take = await store.create({ filename: "gap.wav", sampleRate: 48_000, channelCount: 2 });
    await store.append(take.id, new ArrayBuffer(60), 10);
    await store.append(take.id, new ArrayBuffer(60), 10);
    await store.transaction(["chunks"], "readwrite", tx => tx.objectStore("chunks").delete([take.id, 0]));
    try { await store.exportPart(take.id, 1); return "unexpected export"; }
    catch (error) { return error.message; }
  });
  expect(result).toMatch(/inconsistent|incomplete/);
});

test("stored continuous take survives reload and exports with Audio off, without automatic downloads", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("karplus-strong.html");
  await expect(page.locator(".output-recording-mode")).toHaveValue("memory");
  await page.locator(".header-settings-trigger").click();
  await page.locator(".output-recording-mode").selectOption("storage");
  await page.locator(".header-settings-trigger").click();
  await page.locator("#audioButton").click();
  await page.evaluate(async () => {
    const { getSharedAudioOutputManager, connectAudioOutput } = await import("/src/audio-output-manager.js");
    const context = getSharedAudioOutputManager().recordingContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    gain.gain.value = 0.15;
    oscillator.connect(gain);
    connectAudioOutput(context, gain);
    oscillator.start();
    window.__recordingTone = oscillator;
  });
  let downloads = 0;
  page.on("download", () => { downloads += 1; });
  await page.locator(".output-recording-button").click();
  await expect(page.locator(".output-recording-button")).toHaveAttribute("aria-label", "Stop recording");
  await expect.poll(async () => page.evaluate(async () => {
    const { BrowserRecordingStore } = await import("/src/output-recording-storage.js");
    return (await new BrowserRecordingStore({ routeId: "karplus-strong" }).list())[0]?.frames || 0;
  })).toBeGreaterThan(16_000);
  await page.locator(".output-recording-button").click();
  await expect(page.locator(dialog)).toBeVisible();
  await expect(page.locator(`${dialog} h2`)).toHaveText("Recording stored");
  await expect(page.locator(".output-recording-part option")).toHaveCount(1);
  expect(downloads).toBe(0);
  await page.locator(dialog).getByRole("button", { name: "New recording", exact: true }).click();
  await page.reload();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await page.locator(".header-settings-trigger").click();
  await page.getByRole("button", { name: "Stored recordings", exact: true }).click();
  await expect(page.locator(".output-recording-stored-take option")).toHaveCount(1);
  await expect(page.locator(dialog)).toBeVisible();
  await page.getByRole("button", { name: "Prepare WAV part", exact: true }).click();
  await expect(page.getByRole("link", { name: "Download part 001", exact: true })).toBeVisible();
  expect(downloads).toBe(0);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download part 001", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/-part-001\.wav$/);
  const bytes = await readFile(await download.path());
  expect(bytes.readUInt32LE(4) + 8).toBe(bytes.length);
  expect(bytes.readUInt16LE(22)).toBe(2);
  expect(bytes.readUInt16LE(34)).toBe(24);
  expect(bytes.subarray(44).some(value => value !== 0)).toBe(true);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  const fits = await page.locator(dialog).evaluate(node => {
    const box = node.getBoundingClientRect();
    return box.left >= -1 && box.right <= innerWidth + 1 && node.scrollWidth <= node.clientWidth + 1;
  });
  expect(fits, "storage controls fit 320 CSS pixels").toBe(true);
  await page.locator(dialog).getByRole("button", { name: "Cancel", exact: true }).click();
  await page.locator(".header-settings-trigger").click();
  await page.getByRole("button", { name: "Stored recordings", exact: true }).click();
  await expect(page.getByRole("button", { name: "Prepare WAV part", exact: true })).toBeVisible();
  page.once("dialog", prompt => prompt.accept());
  await page.getByRole("button", { name: "Delete stored recording", exact: true }).click();
  await expect(page.locator(".output-recording-stored-take option")).toHaveCount(0);
});

test("Wobblini alone defaults to browser storage; stored preferences stay instrument scoped", async ({ page }) => {
  await page.goto("wobblini.html");
  await expect(page.locator(".output-recording-mode")).toHaveValue("storage");
  await page.locator(".header-settings-trigger").click();
  await page.locator(".output-recording-mode").selectOption("memory");
  await page.goto("karplus-strong.html");
  await expect(page.locator(".output-recording-mode")).toHaveValue("memory");
  await page.locator(".header-settings-trigger").click();
  await page.locator(".output-recording-mode").selectOption("storage");
  await page.goto("wobblini.html");
  await expect(page.locator(".output-recording-mode")).toHaveValue("memory");
});

test("unfinished committed take is discoverable after reload with Audio off", async ({ page }) => {
  await page.goto("karplus-strong.html");
  await page.evaluate(async () => {
    const { BrowserRecordingStore } = await import("/src/output-recording-storage.js");
    const store = new BrowserRecordingStore({ routeId: "karplus-strong" });
    const take = await store.create({ filename: "interrupted-conversation.wav", sampleRate: 48_000, channelCount: 2 });
    await store.append(take.id, new ArrayBuffer(600), 100);
    // No finish(): simulate a page that disappeared after this commit.
  });
  await page.reload();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  await page.locator(".header-settings-trigger").click();
  await page.getByRole("button", { name: "Stored recordings", exact: true }).click();
  await expect(page.locator(".output-recording-stored-take option")).toHaveText("interrupted-conversation.wav");
  await expect(page.locator(".output-recording-archive .output-recording-summary")).toContainText("Unfinished take");
  await page.getByRole("button", { name: "Prepare WAV part", exact: true }).click();
  await expect(page.getByRole("link", { name: "Download part 001", exact: true })).toBeVisible();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
});
