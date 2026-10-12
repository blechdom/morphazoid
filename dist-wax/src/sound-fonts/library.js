const DATABASE = 'morphazoid-sound-fonts-v1';
const STORES = ['fonts', 'files', 'settings'];

/** Binary files and metadata are separate so browsing never loads every bank. */
export async function openLibrary() {
  const db = await new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('Browser storage is unavailable.'));
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      for (const store of STORES) request.result.createObjectStore(store);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close other Sound Fonts tabs and try again.'));
  });
  db.onversionchange = () => db.close();
  const listeners = new Set();
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(DATABASE) : null;
  const notify = () => { for (const listener of listeners) listener(); };
  if (channel) channel.onmessage = notify;
  const read = (store, id) => new Promise((resolve, reject) => {
    const request = id === undefined ? db.transaction(store).objectStore(store).getAll() : db.transaction(store).objectStore(store).get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const write = (stores, operation) => new Promise((resolve, reject) => {
    const transaction = db.transaction(stores, 'readwrite');
    transaction.oncomplete = () => { if (stores.includes('fonts')) { notify(); channel?.postMessage('changed'); } resolve(); };
    transaction.onerror = () => reject(transaction.error || new Error('Could not save this change.'));
    transaction.onabort = () => reject(transaction.error || new Error('Saving was interrupted.'));
    try { operation(transaction); } catch (error) { transaction.abort(); reject(error); }
  });
  return {
    persistent: true,
    list: () => read('fonts'),
    file: id => read('files', id),
    setting: id => read('settings', id),
    setSetting: (id, value) => write(['settings'], tx => tx.objectStore('settings').put(value, id)),
    put: (font, bytes) => write(['fonts', 'files'], tx => {
      tx.objectStore('fonts').put(font, font.id);
      if (bytes) tx.objectStore('files').put(bytes, font.id);
    }),
    remove: id => write(['fonts', 'files'], tx => {
      tx.objectStore('fonts').delete(id);
      tx.objectStore('files').delete(id);
    }),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    close: () => { listeners.clear(); channel?.close(); db.close(); },
  };
}

export function temporaryLibrary() {
  const fonts = new Map(), files = new Map(), settings = new Map();
  const listeners = new Set();
  const notify = () => { for (const listener of listeners) listener(); };
  return {
    persistent: false,
    list: async () => [...fonts.values()],
    file: async id => files.get(id),
    setting: async id => settings.get(id),
    setSetting: async (id, value) => { settings.set(id, value); },
    put: async (font, bytes) => { fonts.set(font.id, font); if (bytes) files.set(font.id, bytes); notify(); },
    remove: async id => { fonts.delete(id); files.delete(id); notify(); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    close() { listeners.clear(); },
  };
}

export function safeSourceUrl(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const url = new URL(text);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Use an http or https source link.');
  return url.href;
}

export function waveformPeaks(data, count = 80) {
  if (!data?.length) return [];
  const result = [];
  for (let i = 0; i < count; i++) {
    const start = Math.floor(i * data.length / count);
    const end = Math.max(start + 1, Math.floor((i + 1) * data.length / count));
    let peak = 0;
    for (let j = start; j < end; j++) peak = Math.max(peak, Math.abs(data[j] || 0));
    result.push(Math.min(1, peak));
  }
  return result;
}
