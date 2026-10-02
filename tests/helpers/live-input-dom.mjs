/** Add mounted-control DOM operations to the existing instrument smoke fakes. */
export function installLiveInputDOM(doc, elements, listeners, html = "") {
  let sequence = 0;
  const augment = (node, tagName = "div") => {
    node.ownerDocument = doc;
    node.tagName = tagName.toUpperCase();
    node.nodeType = 1;
    node.children ??= [];
    Object.defineProperty(node, "childNodes", { configurable: true, get: () => node.children });
    node.dataset ??= {};
    node.style ??= {};
    node.classList ??= {};
    const classes = new Set();
    for (const method of ["add", "remove", "contains", "toggle"]) if (!node.classList[method]) {
      node.classList[method] = (name, force) => {
        if (method === "contains") return classes.has(name);
        if (method === "remove") return classes.delete(name);
        if (method === "toggle" && (force === false || (force === undefined && classes.has(name)))) return classes.delete(name);
        classes.add(name); return true;
      };
    }
    const attrs = new Map();
    node.setAttribute ??= (name, value) => attrs.set(name, String(value));
    node.getAttribute ??= (name) => attrs.get(name) ?? null;
    node.removeAttribute ??= (name) => attrs.delete(name);
    node.append = (...children) => {
      for (const child of children) {
        child.parentNode?.removeChild?.(child);
        node.children.push(child); child.parentNode = child.parentElement = node;
      }
    };
    node.insertBefore = (child, before) => {
      child.parentNode?.removeChild?.(child);
      const index = node.children.indexOf(before);
      node.children.splice(index < 0 ? node.children.length : index, 0, child);
      child.parentNode = child.parentElement = node;
    };
    node.removeChild = (child) => { node.children = node.children.filter(value => value !== child); child.parentNode = child.parentElement = null; };
    node.remove = () => node.parentNode?.removeChild?.(node);
    node.contains = (target) => target === node || node.children.some(child => child.contains?.(target));
    const callbacks = new Map();
    const oldAdd = node.addEventListener?.bind(node);
    node.addEventListener = (type, callback) => {
      if (!callbacks.has(type)) callbacks.set(type, []);
      callbacks.get(type).push(callback);
      const invoke = (event = {}) => { let result; for (const fn of callbacks.get(type)) result = fn(event); return result; };
      oldAdd?.(type, invoke);
      if (node.id) listeners.set(`${node.id}:${type}`, invoke);
    };
    node.removeEventListener = (type, callback) => callbacks.set(type, (callbacks.get(type) ?? []).filter(value => value !== callback));
    node.dispatchEvent = (event) => { for (const fn of callbacks.get(event.type) ?? []) fn(event); return true; };
    return node;
  };
  doc.createElement = (tag) => augment({ id: `input-dom-${++sequence}`, value: "", textContent: "" }, tag);
  const panel = doc.createElement("aside");
  for (const [id, node] of elements) {
    const tag = html.match(new RegExp(`<([^ >]+)[^>]*\\bid="${id}"[^>]*>`))?.[0] ?? "";
    augment(node, tag.match(/^<([^ >]+)/)?.[1] ?? "div");
    for (const key of ["min", "max", "step", "type"]) node[key] = tag.match(new RegExp(`\\b${key}="([^"]+)"`))?.[1] ?? node[key] ?? "";
    panel.append(node);
    if (["inputTrim", "inputMeterBar", "micButton"].includes(id)) {
      const oldClosest = node.closest?.bind(node);
      node.closest = selector => oldClosest?.(selector) ?? panel;
    }
  }
  doc.querySelector = selector => [".micmic-panel-input", "aside.panel"].includes(selector) ? panel : null;
  doc.head = doc.createElement("head");
  doc.body = augment(doc.body ?? {}, "body");
  doc.defaultView = globalThis;
  return panel;
}
