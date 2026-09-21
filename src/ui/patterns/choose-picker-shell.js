/** The existing Choose markup, shared by navigation and instrument presets. */
export function createChoosePickerShell(doc, {
  current, label, title, panelId, placeholder, filterLabel, listLabel,
}) {
  const node = (tag, className, text) => {
    const result = doc.createElement(tag);
    result.className = className;
    if (text !== undefined) result.textContent = text;
    return result;
  };
  const details = node("details", "instrument-picker");
  const summary = node("summary", "instrument-picker-trigger");
  summary.setAttribute("aria-label", label);
  summary.setAttribute("title", title);
  const currentLabel = node("strong", "instrument-picker-current", current);
  const chevron = node("span", "instrument-picker-chevron");
  chevron.setAttribute("aria-hidden", "true");
  summary.append(currentLabel, chevron);
  const panel = node("div", "instrument-picker-panel");
  panel.id = panelId;
  const search = node("label", "instrument-picker-search");
  const searchLabel = node("span", "instrument-picker-search-label", "Find");
  const searchInput = node("input", "instrument-picker-search-input");
  searchInput.type = "search";
  searchInput.placeholder = placeholder;
  searchInput.autocomplete = "off";
  searchInput.spellcheck = false;
  searchInput.setAttribute("aria-label", filterLabel);
  search.append(searchLabel, searchInput);
  const list = node("div", "instrument-picker-list");
  list.setAttribute("aria-label", listLabel);
  return { details, summary, currentLabel, panel, search, searchInput, list };
}

/** Fixed popup coordinates: under its own trigger, clamped to the viewport. */
export function choosePickerPanelBounds(anchor, viewport) {
  const margin = 8;
  const gap = 4;
  const width = Math.max(0, viewport.width);
  const height = Math.max(0, viewport.height);
  const originX = viewport.offsetLeft ?? 0;
  const originY = viewport.offsetTop ?? 0;
  const insetX = Math.min(margin, width / 2);
  const insetY = Math.min(margin, height / 2);
  const panelWidth = Math.min(380, Math.max(0, width - 2 * insetX));
  const left = Math.max(originX + insetX, Math.min(
    anchor.left,
    originX + width - insetX - panelWidth,
  ));
  const bottom = originY + height - insetY;
  const top = Math.max(originY + insetY, Math.min(anchor.bottom + gap, bottom));
  return {
    left, top, width: panelWidth,
    height: Math.min(540, height * 0.7, Math.max(0, bottom - top)),
  };
}

/**
 * Opt-in trigger anchoring; navigation's existing left-edge panel is unchanged.
 * Keep fixed positioning so the popup escapes scrolling/clipped control rails.
 * No audio, application state, or keyboard-action ownership lives here.
 */
export function anchorChoosePickerPanel({ details, summary, panel }, runtime = globalThis) {
  const doc = summary.ownerDocument;
  const removers = [];
  let destroyed = false;
  const place = () => {
    if (destroyed) return;
    const viewport = runtime.visualViewport;
    const bounds = choosePickerPanelBounds(summary.getBoundingClientRect(), {
      width: viewport?.width ?? (doc.documentElement.clientWidth || runtime.innerWidth),
      height: viewport?.height ?? (doc.documentElement.clientHeight || runtime.innerHeight),
      offsetLeft: viewport?.offsetLeft ?? 0,
      offsetTop: viewport?.offsetTop ?? 0,
    });
    for (const [key, value] of Object.entries(bounds)) panel.style[key] = `${value}px`;
  };
  const update = () => { if (details.open) place(); };
  const listen = (target, type, callback, options) => {
    target?.addEventListener?.(type, callback, options);
    removers.push(() => target?.removeEventListener?.(type, callback, options));
  };
  // Position before the browser opens <details>, avoiding a left-edge flash.
  listen(summary, "click", place);
  listen(summary, "keydown", event => {
    if (event.key === "Enter" || event.key === " ") place();
  });
  listen(details, "toggle", update);
  listen(runtime, "resize", update);
  listen(doc, "scroll", event => {
    // Scrolling the preset list must not repeatedly reposition its own panel.
    if (!panel.contains(event.target)) update();
  }, { capture: true, passive: true });
  listen(runtime.visualViewport, "resize", update);
  listen(runtime.visualViewport, "scroll", update);
  const observer = typeof runtime.ResizeObserver === "function"
    ? new runtime.ResizeObserver(update)
    : null;
  observer?.observe(summary);
  const header = summary.closest(".masthead");
  if (header) observer?.observe(header);
  place();
  return {
    update,
    destroy() {
      destroyed = true;
      observer?.disconnect();
      for (const remove of removers) remove();
    },
  };
}
