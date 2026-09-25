/** A combined instrument publishes its active, open shadow host with this attribute. */
export const ACTIVE_INSTRUMENT_ROOT_SELECTOR = "[data-active-instrument-root]";
export const INSTRUMENT_ROOT_CHANGE_EVENT = "morphazoid:instrument-root-change";

/**
 * Query the active instrument's controls before shared page controls. Resolve
 * the root on every call so MIDI and host transport follow dimension changes.
 * Only queries are scoped; creation, lifecycle and document properties delegate
 * to the real document. Pages without an active root keep normal queries.
 */
export function activeInstrumentControls(documentObject) {
  const activeRoot = () => documentObject?.querySelector?.(ACTIVE_INSTRUMENT_ROOT_SELECTOR)?.shadowRoot ?? null;
  const queries = Object.freeze({
    getElementById(id) {
      return activeRoot()?.getElementById?.(id) ?? documentObject?.getElementById?.(id) ?? null;
    },
    querySelector(selector) {
      return activeRoot()?.querySelector?.(selector) ?? documentObject?.querySelector?.(selector) ?? null;
    },
    querySelectorAll(selector) {
      const root = activeRoot();
      const pageNodes = [...(documentObject?.querySelectorAll?.(selector) ?? [])];
      if (!root) return pageNodes;
      const nodes = [...(root.querySelectorAll?.(selector) ?? []), ...pageNodes];
      const seenNodes = new Set();
      const seenIds = new Set();
      return nodes.filter(node => {
        if (seenNodes.has(node) || (node.id && seenIds.has(node.id))) return false;
        seenNodes.add(node);
        if (node.id) seenIds.add(node.id);
        return true;
      });
    },
  });
  return new Proxy(queries, {
    get(target, key) {
      if (Object.hasOwn(target, key)) return target[key];
      const value = documentObject?.[key];
      return typeof value === "function" ? value.bind(documentObject) : value;
    },
  });
}
