/** Direct component mounting context. Standalone instruments have no context. */
const mounts = new Map();

export function nativeInstrumentContext(id) {
  return mounts.get(id) ?? null;
}

export function registerNativeInstrumentRoot(id, root) {
  if (mounts.has(id)) throw new Error(`Instrument already mounted: ${id}`);
  const owner = root.ownerDocument;
  const document = {
    getElementById: id => root.getElementById(id),
    querySelector: selector => root.querySelector(selector),
    querySelectorAll: selector => root.querySelectorAll(selector),
    createElement: (...args) => owner.createElement(...args),
    createElementNS: (...args) => owner.createElementNS(...args),
    createDocumentFragment: () => owner.createDocumentFragment(),
    get activeElement() { return root.activeElement; },
    get hidden() { return owner.hidden; },
    get visibilityState() { return owner.visibilityState; },
    get defaultView() { return owner.defaultView; },
    get documentElement() { return owner.documentElement; },
    get body() { return root.querySelector('.rubixoids-native-view'); },
    addEventListener(type, listener, options) {
      (type === 'visibilitychange' ? owner : root).addEventListener(type, listener, options);
    },
    removeEventListener(type, listener, options) {
      (type === 'visibilitychange' ? owner : root).removeEventListener(type, listener, options);
    },
  };
  const context = { root, document, presets: null };
  context.registerPresets = adapter => { context.presets = adapter; };
  mounts.set(id, context);
  return context;
}

/** Remove only the failed attempt's own registration, never a live root. */
export function unregisterNativeInstrumentRoot(id, root) {
  if (mounts.get(id)?.root !== root) return false;
  mounts.delete(id);
  return true;
}
