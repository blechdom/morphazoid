import { wavHeader, wavHeaderBytes } from "./output-recorder.js";

export const RECORDING_PART_BYTES = 32 * 1024 * 1024;
const DATABASE = "morphazoid-output-recordings-v1";

export function recordingParts(take) {
  const parts = [];
  for (let start = 0, index = 1; start < take.frames; start += take.partFrames, index += 1) {
    const frames = Math.min(take.partFrames, take.frames - start);
    const dataBytes = frames * take.channelCount * 3;
    parts.push({ index, start, frames, seconds: frames / take.sampleRate,
      bytes: wavHeaderBytes(take.channelCount) + dataBytes + dataBytes % 2,
      filename: `${take.filename.replace(/\.wav$/i, "")}-part-${String(index).padStart(3, "0")}.wav` });
  }
  return parts;
}

/** Atomic PCM + frame-count commits. No audio context or in-memory take buffer. */
export class BrowserRecordingStore {
  constructor({ runtime = globalThis, routeId = "instrument", database = DATABASE,
    partBytes = RECORDING_PART_BYTES, timeoutMs = 15_000 } = {}) {
    this.runtime = runtime;
    this.routeId = routeId;
    this.database = database;
    this.partBytes = Number.isFinite(partBytes)
      ? Math.min(RECORDING_PART_BYTES, Math.max(256, Math.floor(partBytes))) : RECORDING_PART_BYTES;
    this.timeoutMs = timeoutMs;
    this.opening = null;
  }

  open() {
    if (this.opening) return this.opening;
    this.opening = new Promise((resolve, reject) => {
      if (!this.runtime.indexedDB) { reject(new Error("Browser storage is unavailable. Choose another recording mode.")); return; }
      const request = this.runtime.indexedDB.open(this.database, 1);
      let settled = false;
      const fail = error => {
        if (settled) return;
        settled = true;
        this.runtime.clearTimeout(timer);
        reject(error);
      };
      const timer = this.runtime.setTimeout(() => fail(new Error("Opening recording storage timed out. Close other tabs and try again.")), this.timeoutMs);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore("takes", { keyPath: "id" }).createIndex("route", "routeId");
        db.createObjectStore("chunks", { keyPath: ["takeId", "start"] });
      };
      request.onerror = () => fail(request.error);
      request.onblocked = () => fail(new Error("Recording storage is blocked by another tab. Close it and try again."));
      request.onsuccess = () => {
        const db = request.result;
        if (settled) { db.close(); return; }
        settled = true;
        this.runtime.clearTimeout(timer);
        db.onversionchange = () => { db.close(); this.opening = null; };
        db.onclose = () => { this.opening = null; };
        resolve(db);
      };
    }).catch(error => { this.opening = null; throw error; });
    return this.opening;
  }

  async transaction(names, mode, operation) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(names, mode);
      let value;
      let failure;
      const timer = this.runtime.setTimeout(() => {
        failure = new Error("Recording storage timed out. Completed audio is retained.");
        try { tx.abort(); } catch { /* Already completed. */ }
        reject(failure);
      }, this.timeoutMs);
      const finish = () => this.runtime.clearTimeout(timer);
      tx.oncomplete = () => { finish(); resolve(value); };
      tx.onabort = () => { finish(); reject(failure || tx.error || new Error("Recording storage was interrupted.")); };
      // Request errors abort the whole transaction, including its frame count.
      tx.onerror = () => {};
      const fail = error => { failure = error; tx.abort(); };
      try { operation(tx, result => { value = result; }, fail); }
      catch (error) { fail(error); }
    });
  }

  async create({ filename, sampleRate, channelCount }) {
    const header = wavHeaderBytes(channelCount);
    let partFrames = Math.floor((this.partBytes - header) / (channelCount * 3));
    if (header + partFrames * channelCount * 3 + (partFrames * channelCount * 3) % 2 > this.partBytes) partFrames -= 1;
    const id = this.runtime.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const take = { id, routeId: this.routeId, filename, sampleRate, channelCount, partFrames,
      frames: 0, createdAt: Date.now(), updatedAt: Date.now(), state: "recording", reason: "", error: "" };
    await this.transaction(["takes"], "readwrite", tx => tx.objectStore("takes").add(take));
    return take;
  }

  async append(id, buffer, frames) {
    return this.transaction(["takes", "chunks"], "readwrite", (tx, done, fail) => {
      const takes = tx.objectStore("takes");
      const request = takes.get(id);
      request.onsuccess = () => {
        const take = request.result;
        if (!take || take.state !== "recording") { fail(new Error("This recording was removed or closed. Capture stopped.")); return; }
        const bytesPerFrame = take.channelCount * 3;
        if (!(buffer instanceof ArrayBuffer) || !Number.isSafeInteger(frames) || frames <= 0
          || buffer.byteLength !== frames * bytesPerFrame || !Number.isSafeInteger(take.frames + frames)) {
          fail(new Error("Invalid recording storage chunk.")); return;
        }
        // Split only stored data, never stop/restart capture at a part boundary.
        for (let offset = 0; offset < frames;) {
          const start = take.frames + offset;
          const count = Math.min(frames - offset, take.partFrames - start % take.partFrames);
          const data = offset === 0 && count === frames ? buffer : buffer.slice(offset * bytesPerFrame, (offset + count) * bytesPerFrame);
          tx.objectStore("chunks").add({ takeId: id, start, frames: count, buffer: data });
          offset += count;
        }
        take.frames += frames;
        take.updatedAt = Date.now();
        takes.put(take);
        done(take);
      };
    });
  }

  finish(id, { reason = "stopped", error = "" } = {}) {
    return this.transaction(["takes"], "readwrite", (tx, done, fail) => {
      const store = tx.objectStore("takes");
      const request = store.get(id);
      request.onsuccess = () => {
        const take = request.result;
        if (!take) {
          const error = new Error("This recording was removed from browser storage.");
          error.name = "NotFoundError";
          fail(error);
          return;
        }
        Object.assign(take, { state: "finished", reason, error, updatedAt: Date.now() });
        store.put(take);
        done(take);
      };
    });
  }

  list() {
    return this.transaction(["takes"], "readonly", (tx, done) => {
      const request = tx.objectStore("takes").index("route").getAll(this.routeId);
      request.onsuccess = () => done(request.result.sort((a, b) => b.createdAt - a.createdAt));
    });
  }

  async exportPart(id, index) {
    const result = await this.transaction(["takes", "chunks"], "readonly", (tx, done, fail) => {
      const request = tx.objectStore("takes").get(id);
      request.onsuccess = () => {
        const take = request.result;
        if (!take) { fail(new Error("This recording is no longer in browser storage.")); return; }
        const part = recordingParts(take).find(item => item.index === index);
        if (!part) { fail(new Error("This recording part is unavailable.")); return; }
        const chunks = [];
        let next = part.start;
        const range = this.runtime.IDBKeyRange.bound([id, part.start], [id, part.start + part.frames], false, true);
        const cursor = tx.objectStore("chunks").openCursor(range);
        cursor.onsuccess = () => {
          const row = cursor.result;
          if (!row) {
            if (next !== part.start + part.frames) { fail(new Error("Stored audio is incomplete. This part was not exported.")); return; }
            done({ take, part, chunks });
            return;
          }
          const chunk = row.value;
          if (chunk.start !== next || chunk.buffer.byteLength !== chunk.frames * take.channelCount * 3
            || next + chunk.frames > part.start + part.frames) {
            fail(new Error("Stored audio is inconsistent. This part was not exported.")); return;
          }
          chunks.push(chunk.buffer);
          next += chunk.frames;
          row.continue();
        };
      };
    });
    const { take, part, chunks } = result;
    const dataBytes = part.frames * take.channelCount * 3;
    return { ...part, blob: new this.runtime.Blob([
      wavHeader({ sampleRate: take.sampleRate, frames: part.frames, channelCount: take.channelCount }),
      ...chunks, new Uint8Array(dataBytes % 2),
    ], { type: "audio/wav" }) };
  }

  remove(id) {
    return this.transaction(["takes", "chunks"], "readwrite", tx => {
      tx.objectStore("takes").delete(id);
      tx.objectStore("chunks").delete(this.runtime.IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]));
    });
  }
}
