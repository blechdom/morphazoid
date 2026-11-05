// Native instruments own MIDI permission, clocks and routing. The shared header
// only presents their current destination choices and forwards user selections.
const registries = new WeakMap();

export class MidiOutputRoutes {
  constructor() { this.routes = new Map(); this.listeners = new Map(); }

  get(id) { return this.routes.get(id) ?? null; }

  notify(id) {
    for (const listener of this.listeners.get(id) ?? []) {
      try { listener(this.get(id)); } catch { /* Keep other headers connected. */ }
    }
  }

  register({ id, getState, select }) {
    if (!id || typeof getState !== 'function' || typeof select !== 'function') {
      throw new TypeError('A native MIDI output route requires an id, getState and select.');
    }
    if (this.routes.has(id)) throw new Error(`MIDI output route already registered: ${id}`);
    const route = Object.freeze({ id, getState, select });
    this.routes.set(id, route); this.notify(id);
    let disposed = false;
    return Object.freeze({
      changed: () => { if (!disposed) this.notify(id); },
      destroy: () => {
        if (disposed) return;
        disposed = true;
        if (this.routes.get(id) === route) { this.routes.delete(id); this.notify(id); }
      },
    });
  }

  subscribe(id, listener) {
    if (!this.listeners.has(id)) this.listeners.set(id, new Set());
    const listeners = this.listeners.get(id); listeners.add(listener);
    listener(this.get(id));
    return () => { listeners.delete(listener); if (!listeners.size) this.listeners.delete(id); };
  }
}

export function getSharedMidiOutputRoutes(runtime = globalThis) {
  if (!registries.has(runtime)) registries.set(runtime, new MidiOutputRoutes());
  return registries.get(runtime);
}
