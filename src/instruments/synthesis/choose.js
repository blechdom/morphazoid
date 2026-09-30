import { createChoosePickerShell, anchorChoosePickerPanel } from "../../ui/patterns/choose-picker-shell.js";

/** Choose presentation for a native select. Its owner retains values and change events. */
export function enhanceChooseSelect(select, options = {}) {
  const doc = select.ownerDocument;
  const runtime = doc.defaultView ?? globalThis;
  const label = options.label || select.getAttribute("aria-label") || "Choose";
  const shell = createChoosePickerShell(doc, {
    current: select.selectedOptions[0]?.text || label,
    label, title: label,
    panelId: options.panelId || `${select.id || "synthesis"}-choices`,
    placeholder: options.placeholder || "Type to find",
    filterLabel: `Filter ${label.toLowerCase()}`,
    listLabel: label,
  });
  const { details, summary, currentLabel, panel, search, searchInput, list } = shell;
  details.classList.add("synthesis-choose");
  details.dataset.selectId = select.id;
  panel.append(search, list);
  details.append(summary, panel);
  const wasHidden = select.hidden;
  select.hidden = true;
  select.after(details);
  const empty = doc.createElement("p");
  empty.className = "instrument-picker-empty";
  empty.textContent = "No matches";
  const removers = [];
  let signature = "";
  let destroyed = false;
  let buttons = [];
  let groups = [];
  const listen = (target, type, callback, settings) => {
    target.addEventListener(type, callback, settings);
    removers.push(() => target.removeEventListener(type, callback, settings));
  };
  const visibleButtons = () => buttons.filter(button => !button.parentElement.hidden && !button.disabled);
  function filter() {
    const query = searchInput.value.trim().toLocaleLowerCase();
    let count = 0;
    for (const button of buttons) {
      const match = !query || button.dataset.search.includes(query);
      button.parentElement.hidden = !match;
      if (match) count++;
    }
    for (const group of groups) group.hidden = ![...group.querySelectorAll(".instrument-picker-row")].some(row => !row.hidden);
    empty.hidden = count > 0;
  }
  function refresh() {
    if (destroyed) return;
    const values = [...select.options].map((option, index) => ({
      index, value: option.value, text: option.text,
      disabled: option.disabled || !!option.closest("optgroup")?.disabled,
      hidden: option.hidden || !!option.closest("optgroup")?.hidden,
      group: option.closest("optgroup")?.label || "",
    }));
    const nextSignature = JSON.stringify(values);
    if (signature !== nextSignature) {
      signature = nextSignature;
      list.replaceChildren(); buttons = []; groups = [];
      let group = null;
      let previousGroup = "";
      for (const value of values) {
        if (value.hidden) continue;
        if (value.group !== previousGroup || !group) {
          previousGroup = value.group;
          group = doc.createElement("div");
          group.className = "synthesis-choose-group";
          if (value.group) {
            const heading = doc.createElement("p");
            heading.className = "instrument-picker-group-label synthesis-choose-group-label";
            heading.textContent = value.group; group.append(heading);
          }
          list.append(group); groups.push(group);
        }
        const row = doc.createElement("div"); row.className = "instrument-picker-row";
        const button = doc.createElement("button");
        button.type = "button"; button.className = "instrument-picker-link";
        button.textContent = value.text;
        button.dataset.optionIndex = String(value.index);
        button.dataset.search = `${value.group} ${value.text}`.toLocaleLowerCase();
        button.disabled = value.disabled;
        row.append(button); group.append(row); buttons.push(button);
      }
      list.append(empty);
    }
    currentLabel.textContent = select.selectedOptions[0]?.text || label;
    summary.title = `${label}: ${currentLabel.textContent}`;
    summary.setAttribute("aria-label", `${label}: ${currentLabel.textContent}`);
    summary.setAttribute("aria-disabled", String(select.disabled));
    summary.tabIndex = select.disabled ? -1 : 0;
    details.classList.toggle("is-disabled", select.disabled);
    if (select.disabled) details.open = false;
    for (const button of buttons) button.setAttribute("aria-pressed", String(Number(button.dataset.optionIndex) === select.selectedIndex));
    filter();
  }
  const anchor = anchorChoosePickerPanel(shell, runtime);
  listen(list, "click", event => {
    const button = event.target.closest("[data-option-index]");
    if (!button || button.disabled || select.disabled) return;
    select.selectedIndex = Number(button.dataset.optionIndex);
    // Close before dispatch: a method selection may dispose this entire picker.
    details.open = false;
    select.dispatchEvent(new runtime.Event("input", { bubbles: true }));
    select.dispatchEvent(new runtime.Event("change", { bubbles: true }));
    refresh();
    if (!destroyed && summary.isConnected) summary.focus({ preventScroll: true });
  });
  listen(select, "input", refresh);
  listen(select, "change", refresh);
  listen(searchInput, "input", filter);
  listen(summary, "click", event => {
    refresh();
    if (select.disabled) event.preventDefault();
  });
  listen(details, "toggle", () => {
    if (details.open) refresh();
    else { searchInput.value = ""; filter(); }
  });
  listen(details, "keydown", event => {
    event.stopPropagation();
    if (select.disabled) { event.preventDefault(); return; }
    if (event.key === "Escape" && details.open) {
      event.preventDefault();
      if (searchInput.value) { searchInput.value = ""; filter(); searchInput.focus(); }
      else { details.open = false; summary.focus({ preventScroll: true }); }
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    if (event.target === searchInput && !["ArrowDown", "ArrowUp"].includes(event.key)) return;
    event.preventDefault();
    refresh(); details.open = true; anchor.update();
    const visible = visibleButtons();
    if (!visible.length) return;
    const index = visible.indexOf(doc.activeElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? visible.length - 1
      : index < 0 ? event.key === "ArrowUp" ? visible.length - 1 : 0
        : (index + (event.key === "ArrowDown" ? 1 : -1) + visible.length) % visible.length;
    visible[next].focus({ preventScroll: true });
    visible[next].scrollIntoView({ block: "nearest" });
  });
  listen(doc, "pointerdown", event => { if (details.open && !details.contains(event.target)) details.open = false; });
  const observer = typeof runtime.MutationObserver === "function" ? new runtime.MutationObserver(refresh) : null;
  observer?.observe(select, { childList: true, characterData: true, subtree: true, attributes: true,
    attributeFilter: ["disabled", "label", "value", "selected", "hidden"] });
  refresh();
  return {
    ...shell, select, refresh,
    destroy() {
      if (destroyed) return;
      destroyed = true; observer?.disconnect(); anchor.destroy();
      for (const remove of removers) remove();
      details.remove(); select.hidden = wasHidden;
    },
  };
}
