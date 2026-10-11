import test from "node:test";
import assert from "node:assert/strict";
import { TrackLibrary } from "../src/instruments/trackazoid/library.js";
import {
  fileTrackDescriptor, normalizeTrackMetadata, normalizeTrackPath, supportedAudioFile, trackIdentity, hasBeatGrid, withBeatAnalysis,
} from "../src/instruments/trackazoid/library-model.js";

function file(name, { path = "", size = 2048, lastModified = 1234, type = "audio/wav" } = {}) {
  return {
    name, size, lastModified, type, webkitRelativePath: path,
    arrayBuffer() { throw new Error("Library indexing must not read audio bytes."); },
  };
}

const copyEntry = (value) => ({ ...value, ...(value.metadata ? { metadata: structuredClone(value.metadata) } : {}) });
function memoryStore() {
  const entries = new Map(); const folders = new Map();
  return {
    entries, folders, writes: 0, closed: false,
    async load() { return { entries: [...entries.values()].map(copyEntry), folders: [...folders.values()].map(copyEntry) }; },
    async putEntries(records) { this.writes++; for (const entry of records) entries.set(entry.id, copyEntry(entry)); },
    async putFolders(records) { for (const folder of records) folders.set(folder.id, copyEntry(folder)); },
    close() { this.closed = true; },
  };
}

function fileHandle(source, { error } = {}) {
  return {
    kind: "file", name: source.name, reads: 0, source,
    async getFile() { this.reads++; if (error) throw error; return this.source; },
  };
}

function directory(name, children = [], { permission = "granted", grant = "granted", error } = {}) {
  return {
    kind: "directory", name, children, permission, queries: 0, requests: 0,
    async queryPermission(options) { assert.deepEqual(options, { mode: "read" }); this.queries++; return this.permission; },
    async requestPermission(options) { assert.deepEqual(options, { mode: "read" }); this.requests++; this.permission = grant; return grant; },
    async isSameEntry(other) { return other === this; },
    async *entries() {
      if (error) throw error;
      for (const child of this.children) yield [child.name, child];
    },
  };
}

test("audio acceptance is a codec hint; paths and identities preserve nested duplicates", () => {
  assert.equal(supportedAudioFile(file("unknown", { type: "audio/aac" })), true);
  assert.equal(supportedAudioFile(file("TRACK.FLAC", { type: "" })), true);
  assert.equal(supportedAudioFile(file("notes.txt", { type: "text/plain" })), false);
  assert.equal(normalizeTrackPath("music\\set\\track.wav"), "music/set/track.wav");
  assert.equal(normalizeTrackPath("music/../track.wav"), "");
  const base = { folderId: "collection", path: "one/track.wav", size: 3, lastModified: 4 };
  for (const variant of [{ path: "two/track.wav" }, { folderId: "other" }, { size: 5 }, { lastModified: 6 }]) {
    assert.notEqual(trackIdentity(base), trackIdentity({ ...base, ...variant }));
  }
  const descriptor = fileTrackDescriptor(file("track.wav", { path: "Mixes/set/track.wav" }));
  assert.equal(descriptor.folder, "Mixes");
  assert.equal(descriptor.path, "Mixes/set/track.wav");
});

test("metadata validates malformed saved state and bounds cues to the decoded duration", () => {
  assert.deepEqual(normalizeTrackMetadata(null), { version: 2, bpm: 120, beatOffset: 0, cues: [null, null, null, null], gridSource: "unknown", analysis: null });
  assert.deepEqual(normalizeTrackMetadata({ version: 900, bpm: Infinity, duration: 30, beatOffset: -1, cues: [0, 12, 99, NaN, 3] }), {
    version: 2, bpm: 120, duration: 30, beatOffset: 0, cues: [0, 12, 30, null], gridSource: "unknown", analysis: null,
  });
  assert.equal(normalizeTrackMetadata({ bpm: 999 }).bpm, 400);
});

test("automatic analysis fills unknown grids; manual corrections survive reanalysis until explicitly replaced", () => {
  const unknown = normalizeTrackMetadata({ duration: 30 });
  assert.equal(hasBeatGrid(unknown), false, "the legacy 120 fallback is not a detected tempo");
  const result = { version: 1, status: "ok", bpm: 126.03, beatOffset: 0.13, confidence: 0.85, candidates: [], analyzedSeconds: 24 };
  const automatic = withBeatAnalysis(unknown, result);
  assert.equal(hasBeatGrid(automatic), true);
  assert.equal(automatic.gridSource, "auto");
  assert.equal(automatic.bpm, result.bpm);
  const manual = { ...automatic, bpm: 63, beatOffset: 0.19, gridSource: "manual", cues: [2, null, null, null] };
  const protectedGrid = withBeatAnalysis(manual, { ...result, bpm: 128 });
  assert.equal(protectedGrid.bpm, 63);
  assert.equal(protectedGrid.beatOffset, 0.19);
  assert.equal(protectedGrid.analysis.bpm, 128, "new suggestion is saved without applying it");
  const restored = withBeatAnalysis(protectedGrid, protectedGrid.analysis, { useAutomatic: true });
  assert.equal(restored.bpm, 128);
  assert.equal(restored.gridSource, "auto");
  assert.deepEqual(restored.cues, manual.cues);
  const unreliable = withBeatAnalysis(unknown, { version: 1, status: "unreliable", bpm: null, confidence: 0, reason: "silence" });
  assert.equal(hasBeatGrid(unreliable), false);
  assert.equal(unreliable.analysis.reason, "silence");
});

test("legacy prepared tracks retain their manual grids and invalid analysis is not trusted", () => {
  const legacy = normalizeTrackMetadata({ version: 1, bpm: 120, duration: 70, beatOffset: 2.5, cues: [4] });
  assert.equal(legacy.gridSource, "manual");
  assert.equal(legacy.beatOffset, 2.5);
  assert.equal(normalizeTrackMetadata({ version: 1, bpm: 120, beatOffset: 0 }).gridSource, "unknown");
  assert.equal(normalizeTrackMetadata({ analysis: { version: 1, status: "ok", bpm: Infinity, beatOffset: 0 } }).analysis, null);
});

test("analysis and manual protection survive library persistence without retaining audio data", async () => {
  const store = memoryStore(), first = new TrackLibrary({ store });
  await first.init(); const [id] = await first.addFiles([file("prepared.wav")]);
  await first.updateMetadata(id, withBeatAnalysis(normalizeTrackMetadata({ duration: 30 }), {
    version: 1, status: "ok", bpm: 117.2, beatOffset: 0.17, confidence: 0.8, candidates: [], analyzedSeconds: 24,
  }));
  await first.updateMetadata(id, { bpm: 117, gridSource: "manual" }); first.dispose();
  const second = new TrackLibrary({ store }); await second.init();
  const metadata = second.entries[0].metadata;
  assert.equal(metadata.gridSource, "manual"); assert.equal(metadata.bpm, 117);
  assert.equal(metadata.analysis.bpm, 117.2); assert.equal(metadata.beatOffset, 0.17);
  assert.equal(JSON.stringify(metadata).includes("samples"), false);
});

test("file-only imports deduplicate the full source identity and reconnect saved cues after reload", async () => {
  const store = memoryStore(); const first = new TrackLibrary({ store });
  await first.init();
  const kick = file("same.wav", { path: "Set/one/same.wav" });
  const snare = file("same.wav", { path: "Set/two/same.wav" });
  const ids = await first.addFiles([kick, snare, kick, file("readme.txt", { type: "text/plain" })]);
  assert.equal(ids.length, 2);
  assert.equal(first.entries.length, 2);
  assert.equal(await first.getFile(ids[0]), kick);
  await first.updateMetadata(ids[0], { bpm: 131, duration: 33, cues: [2, null, 22] });
  first.dispose();
  const second = new TrackLibrary({ store });
  await second.init();
  assert.equal(second.entries.length, 2);
  assert.equal(second.entries.every((entry) => !entry.available), true);
  assert.equal(second.folders[0].connected, false);
  await assert.rejects(second.getFile(ids[0]), /Reconnect/);
  await second.addFiles([kick]);
  const recovered = second.entries.find((entry) => entry.id === ids[0]);
  assert.equal(recovered.available, true);
  assert.deepEqual(recovered.metadata.cues, [2, null, 22, null]);
  assert.equal(recovered.metadata.bpm, 131);
  assert.equal(second.entries.length, 2);
  assert.equal(second.folders[0].connected, true);
  for (const entry of store.entries.values()) assert.equal("arrayBuffer" in entry, false);
});

test("folder access indexes recursively without bytes, stays lazy on restore, and requests permission only on reconnect", async () => {
  const rootTrack = fileHandle(file("root.wav"));
  const nestedTrack = fileHandle(file("root.wav", { size: 8192 }));
  const folder = directory("Music", [rootTrack, directory("Nested", [nestedTrack])]);
  const store = memoryStore();
  const first = new TrackLibrary({ store, directoryPicker: async (options) => {
    assert.equal(options.mode, "read"); return folder;
  } });
  await first.init();
  const ids = await first.openFolder();
  assert.equal(ids.length, 2);
  assert.deepEqual(first.entries.map((entry) => entry.path), ["root.wav", "Nested/root.wav"]);
  assert.equal(rootTrack.reads, 1);
  assert.equal(nestedTrack.reads, 1);
  await first.updateMetadata(ids[0], { bpm: 96, cues: [1] });
  first.dispose();
  folder.permission = "prompt";
  const second = new TrackLibrary({ store });
  await second.init();
  assert.equal(folder.requests, 0);
  assert.equal(rootTrack.reads, 1);
  assert.equal(second.entries.every((entry) => !entry.available), true);
  await assert.rejects(second.refresh(second.folders[0].id), /Reconnect/);
  assert.equal(folder.requests, 0);
  await second.reconnect(second.folders[0].id);
  assert.equal(folder.requests, 1);
  assert.equal(second.entries.every((entry) => entry.available), true);
  assert.equal(second.entries.find((entry) => entry.id === ids[0]).metadata.bpm, 96);
  assert.equal(await second.getFile(ids[0]), rootTrack.source);
  assert.equal(rootTrack.reads, 3);
});

test("restoring a granted folder makes saved handles usable without rescanning or requesting permission", async () => {
  const track = fileHandle(file("one.mp3"));
  const folder = directory("Music", [track]);
  const store = memoryStore();
  const first = new TrackLibrary({ store, directoryPicker: async () => folder });
  await first.init(); await first.openFolder(); first.dispose();
  const second = new TrackLibrary({ store });
  await second.init();
  assert.equal(second.entries[0].available, true);
  assert.equal(track.reads, 1);
  assert.equal(folder.requests, 0);
  await second.getFile(second.entries[0].id);
  assert.equal(track.reads, 2);
});

test("same-named folders remain distinct, but choosing the same directory again retains metadata", async () => {
  const first = directory("Music", [fileHandle(file("same.mp3"))]);
  const second = directory("Music", [fileHandle(file("same.mp3"))]);
  const choices = [first, second, first];
  const library = new TrackLibrary({ store: memoryStore(), directoryPicker: async () => choices.shift() });
  await library.init();
  const [id] = await library.openFolder();
  await library.updateMetadata(id, { cues: [4] });
  await library.openFolder(); await library.openFolder();
  assert.equal(library.entries.length, 2);
  assert.equal(library.folders.length, 2);
  assert.deepEqual(library.entries.find((entry) => entry.id === id).metadata.cues, [4, null, null, null]);
});

test("indexing yields progressively, cancellation preserves the accepted batch, and files stay bounded", async () => {
  let library; let yields = 0; const counts = []; const statuses = [];
  library = new TrackLibrary({ store: memoryStore(), onChange: () => counts.push(library.entries.length),
    onStatus: (message) => statuses.push(message), yieldControl: async () => { yields++; library.cancelImport(); } });
  await library.init();
  const files = Array.from({ length: 180 }, (_, index) => file(`${index}.wav`));
  const ids = await library.addFiles(files);
  assert.equal(ids.length, 64);
  assert.equal(yields, 1);
  assert.equal(library.importing, false);
  assert.ok(counts.includes(64));
  assert.match(statuses.at(-1), /Import stopped/);
  const bounded = new TrackLibrary({ store: memoryStore(), maxEntries: 3 });
  await bounded.init(); await bounded.addFiles(files);
  assert.equal(bounded.entries.length, 3);
});

test("an unreadable file is skipped and does not suppress other tracks", async () => {
  const statuses = [];
  const folder = directory("Music", [fileHandle(file("bad.wav"), { error: new Error("Unreadable") }), fileHandle(file("good.wav"))]);
  const library = new TrackLibrary({ store: memoryStore(), directoryPicker: async () => folder, onStatus: (message) => statuses.push(message) });
  await library.init(); const ids = await library.openFolder();
  assert.equal(ids.length, 1);
  assert.equal(library.entries[0].name, "good.wav");
  assert.match(statuses.at(-1), /1 unreadable item was skipped/);
});

test("refresh marks removed files unavailable and changed audio receives a distinct identity", async () => {
  const track = fileHandle(file("one.wav"));
  const folder = directory("Music", [track]); const store = memoryStore();
  const library = new TrackLibrary({ store, directoryPicker: async () => folder });
  await library.init(); const [oldId] = await library.openFolder();
  await library.updateMetadata(oldId, { cues: [8] });
  track.source = file("one.wav", { lastModified: 3000 });
  await assert.rejects(library.getFile(oldId), /changed on disk/);
  const [newId] = await library.refresh(library.folders[0].id);
  assert.notEqual(newId, oldId);
  assert.equal(library.entries.find((entry) => entry.id === oldId).available, false);
  assert.deepEqual(library.entries.find((entry) => entry.id === newId).metadata.cues, [null, null, null, null]);
  folder.children = [];
  await library.refresh(library.folders[0].id);
  assert.equal(library.entries.every((entry) => !entry.available), true);
  library.dispose();
  const restored = new TrackLibrary({ store }); await restored.init();
  assert.equal(restored.entries.every((entry) => !entry.available), true);
});

test("storage failure preserves playback and metadata for the current visit", async () => {
  const statuses = []; const store = memoryStore();
  store.putEntries = async () => { throw new Error("Quota exceeded"); };
  const library = new TrackLibrary({ store, onStatus: (message) => statuses.push(message) });
  await library.init();
  const source = file("one.wav"); const [id] = await library.addFiles([source]);
  await library.updateMetadata(id, { bpm: 134 });
  assert.equal(library.entries[0].metadata.bpm, 134);
  assert.equal(await library.getFile(id), source);
  assert.equal(store.closed, true);
  assert.ok(statuses.some((message) => /only last this visit/.test(message)));
});

test("a rejected permission request leaves cues intact and never asks for write access", async () => {
  const folder = directory("Music", [fileHandle(file("one.wav"))], { grant: "denied" });
  const library = new TrackLibrary({ store: memoryStore(), directoryPicker: async () => folder });
  await library.init(); const [id] = await library.openFolder();
  await library.updateMetadata(id, { cues: [9] });
  folder.permission = "prompt";
  await assert.rejects(library.reconnect(library.folders[0].id), /not granted/);
  assert.equal(library.folders[0].connected, false);
  assert.equal(library.entries[0].available, false);
  assert.deepEqual(library.entries[0].metadata.cues, [9, null, null, null]);
});

test("storage opening failure still permits import", async () => {
  const store = memoryStore(); store.load = async () => { throw new Error("Storage disabled"); };
  const statuses = [];
  const library = new TrackLibrary({ store, onStatus: (message) => statuses.push(message) });
  await library.init(); const ids = await library.addFiles([file("one.wav")]);
  assert.equal(ids.length, 1);
  assert.ok(statuses.some((message) => /storage is unavailable/.test(message)));
});

test("missing directory API offers the fallback without starting an import", async () => {
  const library = new TrackLibrary({ store: null, directoryPicker: null });
  await assert.rejects(library.openFolder(), { code: "DIRECTORY_PICKER_UNAVAILABLE" });
  assert.equal(library.importing, false);
});

test("dispose during a pending file read cannot publish late entries or notifications", async () => {
  let resolveRead; let startedRead;
  const started = new Promise((resolve) => { startedRead = resolve; });
  const track = { kind: "file", name: "late.wav", getFile() {
    startedRead(); return new Promise((resolve) => { resolveRead = resolve; });
  } };
  const folder = directory("Music", [track]);
  let notifications = 0;
  const library = new TrackLibrary({ store: memoryStore(), directoryPicker: async () => folder,
    onChange: () => notifications++, onStatus: () => notifications++ });
  await library.init(); const importing = library.openFolder();
  await started;
  library.dispose(); const before = notifications;
  resolveRead(file("late.wav")); await importing;
  assert.equal(notifications, before);
  assert.equal(library.entries.length, 0);
});
