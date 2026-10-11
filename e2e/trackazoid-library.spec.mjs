import { test, expect } from "@playwright/test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function wave(frequency = 220, duration = 12) {
  const sampleRate = 8000, frames = sampleRate * duration;
  const bytes = Buffer.alloc(44 + frames * 2);
  bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24); bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write("data", 36);
  bytes.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) bytes.writeInt16LE(Math.round(4000 * Math.sin(i * 2 * Math.PI * frequency / sampleRate)), 44 + i * 2);
  return bytes;
}

const state = (page) => page.evaluate(() => window.__trackazoid.snapshot());

async function observeAudio(page) {
  await page.addInitScript(() => {
    window.__trackazoidAudioCreates = { realtime: 0, offline: 0 };
    for (const [name, alias, type] of [
      ["AudioContext", "webkitAudioContext", "realtime"],
      ["OfflineAudioContext", "webkitOfflineAudioContext", "offline"],
    ]) {
      const Original = window[name] || window[alias];
      if (!Original) continue;
      const Tracked = new Proxy(Original, {
        construct(target, args, newTarget) {
          window.__trackazoidAudioCreates[type]++;
          return Reflect.construct(target, args, newTarget);
        },
      });
      window[name] = Tracked;
      if (window[alias]) window[alias] = Tracked;
    }
  });
}

async function ready(page) {
  await page.goto("/trackazoid.html");
  await expect(page.locator("#trackazoid")).toHaveAttribute("data-ready", "true");
  await expect(page.locator("#audioButton")).toBeEnabled();
}

async function audioRemainsUncreated(page) {
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate(() => window.__trackazoidAudioCreates.realtime)).toBe(0);
  expect((await state(page)).contextState).toBe("none");
}

async function load(page, name, deck) {
  await page.getByRole("button", { name: `Load ${name} into deck ${deck.toUpperCase()}`, exact: true }).click();
  await expect(page.locator(`#${deck}Title`)).toHaveText(name);
  await expect(page.locator(`#${deck}State`)).toHaveText("READY");
}

async function storedTracks(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open("morphazoid-trackazoid-library", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const read = db.transaction("entries", "readonly").objectStore("entries").getAll();
      read.onerror = () => { db.close(); reject(read.error); };
      read.onsuccess = () => { db.close(); resolve(read.result); };
    };
  }));
}

async function dropFile(page, target, name, bytes) {
  const transfer = await page.evaluateHandle(({ name, bytes }) => {
    const data = new DataTransfer();
    data.items.add(new File([new Uint8Array(bytes)], name, { type: "audio/wav", lastModified: 1700000000000 }));
    return data;
  }, { name, bytes: [...bytes] });
  try {
    await page.locator(target).dispatchEvent("dragover", { dataTransfer: transfer });
    await page.locator(target).dispatchEvent("drop", { dataTransfer: transfer });
  } finally { await transfer.dispose(); }
}

test("local uploads decode only when loaded, keep Audio off, and restore saved cues after reselection", async ({ page }) => {
  // Real disk files retain lastModified across reload and re-selection.
  const directory = await mkdtemp(join(tmpdir(), "trackazoid-files-"));
  const first = join(directory, "First.wav"), second = join(directory, "Second.wav");
  try {
    await writeFile(first, wave()); await writeFile(second, wave(330));
    await observeAudio(page); await ready(page);
    await page.locator("#filePicker").setInputFiles([first, second]);
    await expect(page.locator("#trackCount")).toHaveText("2 tracks");
    expect(await page.evaluate(() => window.__trackazoidAudioCreates)).toEqual({ realtime: 0, offline: 0 });
    await expect(page.locator("#aPlay")).toBeDisabled();
    await load(page, "First.wav", "a"); await load(page, "Second.wav", "b");
    expect(await page.evaluate(() => window.__trackazoidAudioCreates.offline)).toBe(2);
    await audioRemainsUncreated(page);

    await page.locator('#aAdjust > summary').click();
    await page.locator("#aBpm").fill("138");
    await page.locator("#aWaveform").focus(); await page.keyboard.press("ArrowRight");
    const cue = (await state(page)).decks.a.position;
    expect(cue).toBeGreaterThan(0);
    await page.locator("#aGrid").click(); await page.locator("#aHotCue2").click();
    await expect(page.locator("#aHotCue2")).toHaveClass(/has-cue/);
    await expect.poll(async () => {
      const entry = (await storedTracks(page)).find((track) => track.name === "First.wav");
      return entry && { bpm: entry.metadata.bpm, beatOffset: entry.metadata.beatOffset, cue: entry.metadata.cues[1] };
    }).toEqual({ bpm: 138, beatOffset: cue, cue });

    await ready(page);
    await expect(page.locator("#trackRows tr.tz-unavailable")).toHaveCount(2);
    await expect(page.locator("#aPlay")).toBeDisabled();
    await page.locator("#filePicker").setInputFiles([first, second]);
    await expect(page.locator("#trackCount")).toHaveText("2 tracks");
    await expect(page.locator("#trackRows tr.tz-unavailable")).toHaveCount(0);
    await load(page, "First.wav", "a");
    await expect(page.locator("#aBpm")).toHaveValue("138");
    await expect(page.locator("#aHotCue2")).toHaveClass(/has-cue/);
    await page.locator("#aHotCue2").click();
    expect((await state(page)).decks.a.position).toBeCloseTo(cue, 5);
    expect((await state(page)).decks.a.metadata.beatOffset).toBeCloseTo(cue, 5);
    await audioRemainsUncreated(page);
    await expect(page.locator("#errorMessage")).toBeHidden();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("dropping a replacement preserves the playing deck until the explicit replacement action", async ({ page }) => {
  await observeAudio(page); await ready(page);
  await dropFile(page, "#deckA", "Playing.wav", wave(220, 60));
  await expect(page.locator("#aTitle")).toHaveText("Playing.wav");
  await expect(page.locator("#aState")).toHaveText("READY");
  await page.locator("#aPlay").click();
  await expect(page.locator("#aState")).toHaveText("SILENT PLAY");
  await expect.poll(async () => (await state(page)).decks.a.position).toBeGreaterThan(0.05);
  const original = (await state(page)).decks.a.entry;
  await dropFile(page, "#deckA", "Replacement.wav", wave(440));
  await expect(page.locator("#aPending")).toBeVisible();
  await expect(page.locator("#aPendingName")).toHaveText("Replacement.wav");
  await expect(page.locator("#aTitle")).toHaveText("Playing.wav");
  expect((await state(page)).decks.a.entry).toBe(original);
  await expect(page.locator("#aPlay")).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => window.__trackazoidAudioCreates.offline)).toBe(1);
  await page.locator("#aReplace").click();
  await expect(page.locator("#aTitle")).toHaveText("Replacement.wav");
  await expect(page.locator("#aPending")).toBeHidden();
  await expect(page.locator("#aPlay")).toHaveAttribute("aria-pressed", "false");
  expect((await state(page)).decks.a.entry).not.toBe(original);
  await audioRemainsUncreated(page);
  await expect(page.locator("#errorMessage")).toBeHidden();
});

test("Open folder requests read access and remains playable when a handle cannot be persisted", async ({ page }) => {
  await observeAudio(page);
  await page.addInitScript(({ bytes }) => {
    window.__trackazoidFolder = { options: [], reads: 0 };
    const fileHandle = (name) => ({ kind: "file", name, getFile: async () => {
      window.__trackazoidFolder.reads++;
      return new File([new Uint8Array(bytes)], name, { type: "audio/wav", lastModified: 1700000000000 });
    } });
    const nested = { kind: "directory", name: "Nested", async *entries() { yield ["Nested.wav", fileHandle("Nested.wav")]; } };
    const folder = { kind: "directory", name: "Read-only music", async *entries() {
      yield ["Folder.wav", fileHandle("Folder.wav")]; yield ["Nested", nested];
      yield ["Notes.txt", { kind: "file", name: "Notes.txt", getFile() { throw new Error("Non-audio files must not be read"); } }];
    } };
    // Plain test handles contain methods and cannot be cloned into IndexedDB.
    // This exercises the real memory-only recovery path, not persistence mocks.
    Object.defineProperty(window, "showDirectoryPicker", { configurable: true, value: async (options) => {
      window.__trackazoidFolder.options.push(options); return folder;
    } });
  }, { bytes: [...wave()] });
  await ready(page);
  await page.locator("#openFolder").click();
  await expect(page.locator("#trackCount")).toHaveText("2 tracks");
  await expect(page.locator("#libraryStatus")).toContainText("only last this visit");
  expect(await page.evaluate(() => window.__trackazoidFolder.options)).toEqual([
    { id: "trackazoid-library", mode: "read", startIn: "music" },
  ]);
  expect(await page.evaluate(() => window.__trackazoidFolder.reads)).toBe(2);
  expect(await page.evaluate(() => window.__trackazoidAudioCreates.offline)).toBe(0);
  await page.locator("#librarySearch").fill("Nested");
  await expect(page.locator("#trackRows tr")).toHaveCount(1);
  await load(page, "Nested.wav", "b");
  expect(await page.evaluate(() => window.__trackazoidFolder.reads)).toBe(3);
  await audioRemainsUncreated(page);
  await expect(page.locator("#errorMessage")).toBeHidden();
});

test("the directory-input fallback includes subfolders and preserves distinct same-named tracks", async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), "trackazoid-folder-"));
  try {
    await mkdir(join(directory, "Nested"));
    await writeFile(join(directory, "Shared.wav"), wave());
    await writeFile(join(directory, "Nested", "Shared.wav"), wave(330));
    await writeFile(join(directory, "Notes.txt"), "Ignore this non-audio file.");
    await observeAudio(page);
    await page.addInitScript(() => Object.defineProperty(window, "showDirectoryPicker", { configurable: true, value: undefined }));
    await ready(page);
    const chooserPromise = page.waitForEvent("filechooser");
    await page.locator("#openFolder").click();
    const chooser = await chooserPromise;
    await chooser.setFiles(directory);
    await expect(page.locator("#trackCount")).toHaveText("2 tracks");
    const tracks = (await state(page)).library;
    expect(new Set(tracks.map((track) => track.id)).size).toBe(2);
    expect(tracks.every((track) => track.name === "Shared.wav")).toBe(true);
    expect(await page.evaluate(() => window.__trackazoidAudioCreates.offline)).toBe(0);
    await page.locator("#librarySearch").fill("Nested");
    await expect(page.locator("#trackRows tr")).toHaveCount(1);
    await load(page, "Shared.wav", "a");
    await page.locator("#librarySearch").fill("Nothing matches this");
    await expect(page.locator("#trackRows tr")).toHaveCount(0);
    await expect(page.locator("#aTitle")).toHaveText("Shared.wav");
    await audioRemainsUncreated(page);
    await expect(page.locator("#errorMessage")).toBeHidden();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
