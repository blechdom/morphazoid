import {
  MAX_LIBRARY_ENTRIES, fileTrackDescriptor, normalizeTrackMetadata,
  normalizeTrackPath, supportedAudioFile, trackIdentity,
} from "./library-model.js";

export { supportedAudioFile } from "./library-model.js";

const BATCH_SIZE = 64;
const DB_NAME = "morphazoid-trackazoid-library";
const DB_VERSION = 1;
const yieldToBrowser = () => new Promise((resolve) => setTimeout(resolve, 0));

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Browser storage is unavailable."));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () => reject(transaction.error || new Error("Could not save the library."));
  });
}

/** Persist metadata and handles, never audio bytes. */
export class IndexedTrackStore {
  constructor(indexedDB = globalThis.indexedDB) { this.indexedDB = indexedDB; this.db = null; }

  async load() {
    if (!this.indexedDB) throw new Error("Browser storage is unavailable.");
    const opening = this.indexedDB.open(DB_NAME, DB_VERSION);
    opening.onupgradeneeded = () => {
      const db = opening.result;
      for (const name of ["entries", "folders"]) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: "id" });
      }
    };
    this.db = await new Promise((resolve, reject) => {
      let blocked = false;
      opening.onsuccess = () => {
        if (blocked) opening.result.close();
        else resolve(opening.result);
      };
      opening.onerror = () => reject(opening.error || new Error("Could not open the library."));
      opening.onblocked = () => {
        blocked = true;
        reject(new Error("Close other Trackazoid tabs to update library storage."));
      };
    });
    this.db.onversionchange = () => this.close();
    const transaction = this.db.transaction(["entries", "folders"], "readonly");
    const done = transactionDone(transaction);
    const [entries, folders] = await Promise.all([
      requestResult(transaction.objectStore("entries").getAll()),
      requestResult(transaction.objectStore("folders").getAll()),
      done,
    ]);
    return { entries, folders };
  }

  async putEntries(entries) { return this.put("entries", entries); }
  async putFolders(folders) { return this.put("folders", folders); }

  async put(name, records) {
    if (!records.length) return;
    if (!this.db) throw new Error("Library storage is closed.");
    const transaction = this.db.transaction(name, "readwrite");
    const done = transactionDone(transaction);
    try {
      for (const record of records) transaction.objectStore(name).put(record);
    } catch (error) {
      transaction.abort();
      await done.catch(() => {});
      throw error;
    }
    await done;
  }

  close() { this.db?.close(); this.db = null; }
}

export class TrackLibrary {
  constructor({
    onChange = () => {}, onStatus = () => {}, store,
    directoryPicker = globalThis.showDirectoryPicker?.bind(globalThis),
    yieldControl = yieldToBrowser, maxEntries = MAX_LIBRARY_ENTRIES,
  } = {}) {
    this.onChange = onChange; this.onStatus = onStatus;
    this.store = store === undefined ? new IndexedTrackStore() : store;
    this.directoryPicker = directoryPicker; this.yieldControl = yieldControl;
    this.maxEntries = Math.max(1, Math.min(MAX_LIBRARY_ENTRIES, Math.floor(maxEntries) || MAX_LIBRARY_ENTRIES));
    this._entries = new Map(); this._folders = new Map(); this._files = new Map();
    this._import = null; this._disposed = false; this._memoryOnly = !this.store;
  }

  get entries() { return [...this._entries.values()]; }
  get folders() { return [...this._folders.values()].map(({ id, name, connected }) => ({ id, name, connected })); }
  get importing() { return Boolean(this._import && !this._import.cancelled); }

  _changed() { if (!this._disposed) this.onChange(); }
  _status(message) { if (!this._disposed) this.onStatus(message); }

  _storageFailed() {
    this.store?.close?.(); this.store = null; this._memoryOnly = true;
    this._status("Browser storage is unavailable. Tracks and cue edits will only last this visit.");
  }

  async _save(method, records) {
    if (!this.store || !records.length) return;
    try { await this.store[method](records); } catch { this._storageFailed(); }
  }

  async init() {
    if (this._disposed) return;
    try {
      const saved = await this.store?.load();
      if (this._disposed) { this.store?.close?.(); return; }
      for (const folder of (saved?.folders || []).slice(0, this.maxEntries)) {
        if (!folder || typeof folder.id !== "string" || typeof folder.name !== "string") continue;
        let connected = false;
        // Querying never opens a browser permission prompt.
        try { connected = Boolean(folder.handle && await folder.handle.queryPermission({ mode: "read" }) === "granted"); } catch { /* reconnect explicitly */ }
        this._folders.set(folder.id, { ...folder, connected });
      }
      for (const record of (saved?.entries || []).slice(0, this.maxEntries)) {
        if (!record || typeof record.id !== "string" || typeof record.name !== "string"
          || !normalizeTrackPath(record.path)) continue;
        const available = Boolean(record.available !== false && record.handle && this._folders.get(record.folderId)?.connected);
        this._entries.set(record.id, { ...record, available, metadata: normalizeTrackMetadata(record.metadata) });
      }
      if (!this._disposed) this._changed();
    } catch { this._storageFailed(); }
  }

  _begin() {
    if (this._disposed) throw new Error("The library is closed.");
    this.cancelImport();
    const token = { cancelled: false, pending: [], ids: new Set(), errors: 0, visited: 0, limited: false };
    this._import = token;
    return token;
  }

  _active(token) { return !this._disposed && !token.cancelled && this._import === token; }

  async _flush(token) {
    const records = token.pending.splice(0);
    await this._save("putEntries", records);
    if (this._active(token)) this._changed();
  }

  async _progress(token) {
    token.visited++;
    if (token.visited >= this.maxEntries * 5) token.limited = true;
    if (token.visited % BATCH_SIZE !== 0) return;
    await this._flush(token);
    if (this._active(token)) this._status(`Indexed ${token.ids.size.toLocaleString()} audio tracks…`);
    await this.yieldControl();
  }

  _add(descriptor, token, { file, handle } = {}) {
    const previous = this._entries.get(descriptor.id);
    if (!previous && this._entries.size >= this.maxEntries) { token.limited = true; return; }
    const entry = {
      ...descriptor, available: true,
      metadata: previous?.metadata || normalizeTrackMetadata(),
      ...(handle ? { handle } : {}),
    };
    this._entries.set(entry.id, entry);
    if (file) this._files.set(entry.id, file);
    token.ids.add(entry.id); token.pending.push(entry);
  }

  async _finish(token) {
    await this._flush(token);
    if (this._import === token) {
      this._import = null;
      const count = token.ids.size.toLocaleString();
      const result = token.cancelled ? `Import stopped; ${count} audio tracks indexed.`
        : token.limited ? `Library limit reached; ${count} audio tracks indexed. Choose a smaller folder to continue.`
          : `${count} audio ${token.ids.size === 1 ? "track" : "tracks"} indexed.`;
      const errors = token.errors ? ` ${token.errors} unreadable ${token.errors === 1 ? "item was" : "items were"} skipped.` : "";
      this._status(`${result}${errors}${this._memoryOnly ? " Changes will only last this visit." : ""}`);
      this._changed();
    }
    return [...token.ids];
  }

  async addFiles(files, options = {}) {
    const token = this._begin();
    for (const file of files || []) {
      if (!this._active(token) || token.limited) break;
      try {
        if (supportedAudioFile(file)) {
          const descriptor = fileTrackDescriptor(file, options);
          if (descriptor.folder && !this._folders.has(descriptor.folderId)) {
            const folder = { id: descriptor.folderId, name: descriptor.folder, connected: true };
            this._folders.set(folder.id, folder);
            await this._save("putFolders", [folder]);
          } else if (descriptor.folder) this._folders.get(descriptor.folderId).connected = true;
          if (this._active(token)) this._add(descriptor, token, { file });
        }
      } catch { token.errors++; }
      await this._progress(token);
    }
    return this._finish(token);
  }

  async openFolder() {
    if (!this.directoryPicker) {
      const error = new Error("Choose a folder using this browser’s folder file picker.");
      error.code = "DIRECTORY_PICKER_UNAVAILABLE";
      throw error;
    }
    // Start directly in the click handler to preserve transient user activation.
    const handle = await this.directoryPicker({ id: "trackazoid-library", mode: "read", startIn: "music" });
    if (this._disposed) return [];
    let folder;
    for (const candidate of this._folders.values()) {
      try { if (candidate.handle && await handle.isSameEntry(candidate.handle)) { folder = candidate; break; } } catch { /* stale handle */ }
    }
    if (!folder) {
      const id = `directory:${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
      folder = { id, name: handle.name, handle, connected: true };
      this._folders.set(id, folder);
    } else { folder.handle = handle; folder.connected = true; }
    await this._save("putFolders", [folder]);
    return this._indexFolder(folder);
  }

  async reconnect(folderId) {
    const folder = this._folders.get(folderId);
    if (!folder?.handle) throw new Error("Choose the same folder again with Open folder to reconnect its tracks.");
    // Only this explicit action is allowed to request permission.
    const permission = await folder.handle.requestPermission({ mode: "read" });
    if (this._disposed) return [];
    folder.connected = permission === "granted";
    if (!folder.connected) {
      this._unavailable(folderId); this._changed();
      throw new Error("Folder access was not granted. Your saved cues are still here.");
    }
    return this._indexFolder(folder);
  }

  async refresh(folderId) {
    const folder = this._folders.get(folderId);
    if (!folder?.handle) throw new Error("Choose the folder again to refresh its tracks.");
    const permission = await folder.handle.queryPermission({ mode: "read" });
    if (this._disposed) return [];
    folder.connected = permission === "granted";
    if (!folder.connected) {
      this._unavailable(folderId); this._changed();
      throw new Error("Reconnect this folder to refresh it.");
    }
    return this._indexFolder(folder);
  }

  _unavailable(folderId) {
    for (const entry of this._entries.values()) {
      if (entry.folderId === folderId && !this._files.has(entry.id)) entry.available = false;
    }
  }

  async _indexFolder(folder) {
    const token = this._begin();
    this._status(`Reading ${folder.name}…`); this._changed();
    const stack = [{ handle: folder.handle, path: "", depth: 0 }];
    while (stack.length && this._active(token) && !token.limited) {
      const current = stack.pop();
      try {
        for await (const [name, handle] of current.handle.entries()) {
          if (!this._active(token) || token.limited) break;
          const path = normalizeTrackPath(`${current.path}/${name}`);
          if (handle.kind === "directory") {
            if (current.depth < 64) stack.push({ handle, path, depth: current.depth + 1 });
            else token.errors++;
          } else if (handle.kind === "file" && supportedAudioFile({ name })) {
            try {
              // This reads only file metadata; no arrayBuffer or audio decoding.
              const file = await handle.getFile();
              if (!this._active(token)) break;
              const descriptor = {
                name: file.name, path, folder: folder.name, folderId: folder.id,
                size: file.size, lastModified: file.lastModified,
              };
              this._add({ ...descriptor, id: trackIdentity(descriptor) }, token, { handle });
            } catch { token.errors++; }
          }
          await this._progress(token);
        }
      } catch { token.errors++; }
    }
    // A cancelled, limited, or partly unreadable scan cannot prove files were removed.
    if (this._active(token) && !token.limited && !token.errors) {
      for (const entry of this._entries.values()) {
        if (entry.folderId === folder.id && !token.ids.has(entry.id)) {
          entry.available = false; token.pending.push(entry);
        }
      }
    }
    return this._finish(token);
  }

  async getFile(id) {
    const entry = this._entries.get(id);
    if (!entry) throw new Error("This track is no longer in the library.");
    if (this._files.has(id)) return this._files.get(id);
    if (!entry.available || !entry.handle) throw new Error("Reconnect the folder or add this file again to load it. Saved cues will be restored.");
    try {
      const file = await entry.handle.getFile();
      if (file.size !== entry.size || file.lastModified !== entry.lastModified) {
        throw new Error("This file changed on disk. Refresh its folder before loading it.");
      }
      return file;
    } catch (error) {
      entry.available = false; this._changed();
      if (error?.name === "NotAllowedError") {
        const folder = this._folders.get(entry.folderId);
        if (folder) folder.connected = false;
        this._unavailable(entry.folderId); this._changed();
      }
      throw new Error(error?.name === "NotAllowedError"
        ? "Folder access expired. Reconnect the folder to load this track."
        : error?.name === "NotFoundError" ? "This file moved or was removed. Refresh its folder."
          : error.message || "This file could not be read.");
    }
  }

  async updateMetadata(id, patch) {
    const entry = this._entries.get(id);
    if (!entry || this._disposed) return;
    entry.metadata = normalizeTrackMetadata({ ...entry.metadata, ...patch });
    this._changed();
    await this._save("putEntries", [{ ...entry }]);
    return entry.metadata;
  }

  cancelImport() { if (this._import) this._import.cancelled = true; }

  dispose() {
    this.cancelImport(); this._disposed = true; this._files.clear();
    this.store?.close?.(); this.store = null;
  }
}
