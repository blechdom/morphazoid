let generatedId = 0;

export function requireDocument(doc) {
  if (!doc || typeof doc.createElement !== "function") {
    throw new TypeError("A DOM Document is required to create Morphazoid UI components.");
  }
  return doc;
}

export function nextId(prefix, doc) {
  let id;
  do {
    generatedId += 1;
    id = `${prefix}-${generatedId}`;
  } while (typeof doc.getElementById === "function" && doc.getElementById(id));
  return id;
}

export function classNames(...values) {
  return values
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .filter(Boolean)
    .flatMap((value) => String(value).trim().split(/\s+/))
    .filter(Boolean)
    .join(" ");
}

export function setAttributes(element, attributes = {}) {
  for (const [name, value] of Object.entries(attributes ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    element.setAttribute(name, value === true ? "" : String(value));
  }
}

export function setData(element, data = {}) {
  for (const [name, value] of Object.entries(data ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    const attribute = `data-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
    element.setAttribute(attribute, value === true ? "true" : String(value));
  }
}

export function applyCommonOptions(element, options = {}) {
  if (options.id) element.id = String(options.id);
  if (options.title) element.title = String(options.title);
  if (options.ariaLabel) element.setAttribute("aria-label", String(options.ariaLabel));
  setAttributes(element, options.attributes);
  setData(element, options.data);
}

export function defineApi(element, api) {
  for (const [name, value] of Object.entries(api)) {
    Object.defineProperty(element, name, {
      configurable: true,
      enumerable: false,
      writable: typeof value !== "function",
      value,
    });
  }
  return element;
}

export function defineGetter(element, name, get) {
  Object.defineProperty(element, name, {
    configurable: true,
    enumerable: false,
    get,
  });
}

export function appendContent(parent, content, doc) {
  if (content === undefined || content === null || content === false) return;
  for (const item of Array.isArray(content) ? content : [content]) {
    if (item === undefined || item === null || item === false) continue;
    if (typeof item === "string" || typeof item === "number") {
      if (typeof doc.createTextNode === "function") parent.append(doc.createTextNode(String(item)));
      else {
        const span = doc.createElement("span");
        span.textContent = String(item);
        parent.append(span);
      }
    } else {
      parent.append(item);
    }
  }
}

export function dispatchNativeEvent(element, type, doc) {
  const EventClass = doc.defaultView?.Event ?? globalThis.Event;
  if (typeof EventClass !== "function" || typeof element.dispatchEvent !== "function") return false;
  return element.dispatchEvent(new EventClass(type, { bubbles: true }));
}

export function setClassState(element, className, enabled) {
  if (element.classList?.toggle) element.classList.toggle(className, Boolean(enabled));
  else if (enabled) element.classList?.add?.(className);
  else element.classList?.remove?.(className);
}
