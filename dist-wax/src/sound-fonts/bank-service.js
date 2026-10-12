import { openLibrary, temporaryLibrary } from './library.js';
import { inspectSoundFont, MAX_SOUNDFONT_BYTES } from './bank-format.js';
export { inspectSoundFont, MAX_SOUNDFONT_BYTES };

const catalogUrl = new URL('../../assets/sound-fonts/catalog.json', import.meta.url);
const assetUrl = path => new URL(`../../${path}`, import.meta.url);
const aborted = signal => { if (signal?.aborted) throw signal.reason || new DOMException('Selection cancelled.', 'AbortError'); };

/** Metadata is cheap; bank bytes are fetched only by resolve/importFile. */
export function createSoundFontService({ library, fetch: fetchFile = globalThis.fetch, crypto = globalThis.crypto } = {}) {
  let catalogPromise, closed = false;
  const requests = new Set();
  const storage = library ? Promise.resolve(library) : openLibrary().catch(() => temporaryLibrary());
  const ensure = signal => { aborted(signal); if (closed) throw new Error('SoundFont library is closed.'); };
  async function request(url, read, signal) {
    ensure(signal);
    const controller = new AbortController(), cancel = () => controller.abort(signal.reason);
    const timeout = setTimeout(() => controller.abort(new Error('The SoundFont download timed out. Try again.')), 90000);
    requests.add(controller); signal?.addEventListener('abort', cancel, { once: true });
    try {
      const response = await fetchFile(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`Could not load the SoundFont file (${response.status}). Try again.`);
      const declaredSize = Number(response.headers?.get('content-length'));
      if (declaredSize > MAX_SOUNDFONT_BYTES) throw new Error('SoundFonts must be 128 MiB or smaller.');
      return await read(response);
    } finally { clearTimeout(timeout); requests.delete(controller); signal?.removeEventListener('abort', cancel); }
  }
  async function catalog() {
    if (!catalogPromise) catalogPromise = (async () => {
      const banks = await request(catalogUrl, response => response.json());
      if (!Array.isArray(banks)) throw new Error('The SoundFont catalog is invalid.');
      return banks;
    })().catch(error => { catalogPromise = null; throw error; });
    return catalogPromise;
  }
  async function list() {
    const db = await storage, saved = (await db.list()).filter(entry => entry.kind !== 'link');
    // Saved banks remain usable if the network catalog is temporarily unavailable.
    const banks = await catalog().catch(error => { if (!saved.length) throw error; return []; });
    const entries = banks.map(bank => ({ ...bank, ...saved.find(entry => entry.id === `bundled-${bank.id}`), id: `bundled-${bank.id}`, bundleId: bank.id, group: 'Built-in banks' }));
    return [...entries, ...saved.filter(entry => !entries.some(bank => bank.id === entry.id)).map(entry => ({ ...entry, group: 'Your Sound Fonts' }))];
  }
  async function verified(bytes, bank, signal) {
    ensure(signal);
    if (bytes.byteLength !== bank.bytes) throw new Error(`The ${bank.name} download is incomplete. Try again.`);
    if (!/^[a-f0-9]{64}$/i.test(bank.sha256 || '')) throw new Error(`The ${bank.name} integrity record is missing.`);
    if (!crypto?.subtle) throw new Error('Secure file verification is unavailable. Use HTTPS or localhost.');
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
    ensure(signal);
    if (hash !== bank.sha256.toLowerCase()) throw new Error(`The ${bank.name} download failed its integrity check. Try again.`);
  }
  async function resolve(id, { signal } = {}) {
    ensure(signal);
    const db = await storage, saved = (await db.list()).find(entry => entry.id === id && entry.kind !== 'link');
    const banks = await catalog().catch(error => { if (!saved) throw error; return []; });
    const bank = banks.find(item => `bundled-${item.id}` === id);
    if (!bank && !saved) throw new Error('That SoundFont is no longer available. Refresh the library.');
    let bytes = saved ? await db.file(id) : null;
    ensure(signal);
    if (!bytes && bank) {
      if (bank.bytes > MAX_SOUNDFONT_BYTES) throw new Error('SoundFonts must be 128 MiB or smaller.');
      bytes = await request(assetUrl(bank.file), response => response.arrayBuffer(), signal);
    }
    if (!bytes) throw new Error('The saved SoundFont file is missing. Import it again.');
    if (bank) await verified(bytes, bank, signal);
    const info = inspectSoundFont(bytes); ensure(signal);
    const entry = saved || { ...info, id, bundleId: bank.id, name: bank.name, kind: 'imported', author: bank.author || info.author, license: bank.license || info.license, source: bank.sourceUrl || '', notes: [bank.description, bank.attribution].filter(Boolean).join('\n'), createdAt: Date.now(), size: bytes.byteLength, peaks: [] };
    entry.format = info.format;
    return { bytes, name: entry.name, format: info.format, id, entry };
  }
  async function importFile(file, { signal } = {}) {
    ensure(signal);
    if (file.size > MAX_SOUNDFONT_BYTES) throw new Error('SoundFonts must be 128 MiB or smaller.');
    const bytes = await file.arrayBuffer(), info = inspectSoundFont(bytes); ensure(signal);
    const id = crypto.randomUUID();
    const entry = { ...info, id, name: info.name || file.name.replace(/\.sf[23]$/i, ''), kind: 'imported', source: '', notes: '', createdAt: Date.now(), size: bytes.byteLength, peaks: [] };
    return { bytes, name: entry.name, format: info.format, id, entry };
  }
  return { catalog, list, resolve, importFile,
    async save(result) { ensure(); await (await storage).put(result.entry, result.bytes); },
    async subscribe(listener) { return (await storage).subscribe?.(listener) || (() => {}); },
    async persistent() { return (await storage).persistent; },
    dispose() { closed = true; for (const controller of requests) controller.abort(); if (!library) void storage.then(db => db.close()); },
  };
}

/** Resolve concurrently, but commit one bank at a time; stale downloads never load. */
export function createSoundFontSelection({ service, onLoad, onState = () => {} }) {
  let serial = 0, controller, disposed = false, queue = Promise.resolve(), current = null;
  async function choose(input, local = false) {
    if (disposed) return null;
    const ticket = ++serial; controller?.abort(); controller = new AbortController();
    const signal = controller.signal;
    onState({ loading: true, current, error: null });
    try {
      const result = await (local ? service.importFile(input, { signal }) : service.resolve(input, { signal }));
      if (disposed || ticket !== serial) return null;
      const commit = queue.catch(() => {}).then(async () => {
        if (disposed || ticket !== serial) return null;
        await onLoad(result, { signal });
        if (disposed) return null;
        // A commit already handed to an audio worklet must finish before its successor.
        current = result;
        if (ticket !== serial) return null;
        let warning = '';
        try { await service.save(result); } catch { warning = 'Loaded for this session; browser storage could not save this bank.'; }
        if (!warning && service.persistent && !await service.persistent()) warning = 'Loaded for this session; browser storage is unavailable.';
        if (disposed || ticket !== serial) return null;
        onState({ loading: false, current, error: null, warning }); return result;
      });
      queue = commit; return await commit;
    } catch (error) {
      // An older load already handed to a consumer may still be completing.
      // Wait for its acknowledgement so an error reports the actual retained bank.
      await queue.catch(() => {});
      if (!disposed && ticket === serial) onState({ loading: false, current, error });
      return null;
    }
  }
  return { select: id => choose(id), importFile: file => choose(file, true), get current() { return current; }, dispose() { disposed = true; serial++; controller?.abort(); } };
}
