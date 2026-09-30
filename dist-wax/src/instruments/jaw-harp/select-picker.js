import { createChoosePickerShell, anchorChoosePickerPanel } from '../../ui/patterns/choose-picker-shell.js';

/** Choose-menu presentation; the native select still owns values and events. */
export function createJawHarpSelectPicker(select, { label }) {
  const doc = select.ownerDocument;
  const runtime = doc.defaultView;
  const originalHidden = select.getAttribute('hidden');
  const shell = createChoosePickerShell(doc, {
    current: label, label, title: label, panelId: `${select.id}-picker-panel`,
    placeholder: `Find ${label.toLowerCase()}`, filterLabel: `Filter ${label.toLowerCase()}`,
    listLabel: label,
  });
  const { details, summary, currentLabel, panel, search, searchInput, list } = shell;
  details.classList.add('jaw-select-picker');
  details.dataset.selectId = select.id;
  summary.id = `${select.id}-picker-trigger`;
  summary.setAttribute('aria-controls', panel.id);
  panel.append(search, list);
  details.append(summary, panel);
  select.after(details);
  select.hidden = true;
  const anchor = anchorChoosePickerPanel(shell, runtime);
  const removers = [];
  let destroyed = false, signature = '', rows = [], groups = [];
  const empty = doc.createElement('p');
  empty.className = 'instrument-picker-empty';
  empty.textContent = 'No options found';

  const listen = (target, type, handler) => {
    target.addEventListener(type, handler);
    removers.push(() => target.removeEventListener(type, handler));
  };
  const filter = () => {
    const query = searchInput.value.trim().toLocaleLowerCase();
    for (const row of rows) {
      const option = select.options[row.index];
      row.element.hidden = !option || option.hidden || row.group?.source.hidden
        || !`${option.label} ${row.group?.source.label ?? ''}`.toLocaleLowerCase().includes(query);
    }
    for (const group of groups) group.element.hidden = !group.rows.some(row => !row.element.hidden);
    empty.hidden = rows.some(row => !row.element.hidden);
  };
  const available = () => rows.filter(row => !row.element.hidden && !row.button.disabled);
  const focusRow = row => {
    row?.button.focus({ preventScroll: true });
    row?.button.scrollIntoView({ block: 'nearest' });
  };
  const close = ({ focus = false } = {}) => {
    if (destroyed) return;
    details.open = false;
    searchInput.value = '';
    filter();
    anchor.update();
    if (focus) summary.focus({ preventScroll: true });
  };
  const sync = () => {
    if (destroyed) return;
    const options = [...select.options];
    const children = [...select.children];
    const nextSignature = JSON.stringify(options.map(option => {
      const group = option.parentElement === select ? null : option.parentElement;
      return [option.value, option.label, option.title, option.disabled, option.hidden,
        group && [children.indexOf(group), group.label, group.disabled, group.hidden]];
    }));
    if (nextSignature !== signature) {
      signature = nextSignature;
      rows = []; groups = []; list.replaceChildren();
      const groupNodes = new Map();
      for (const [index, option] of options.entries()) {
        let group = null;
        if (option.parentElement !== select) {
          const source = option.parentElement;
          group = groupNodes.get(source);
          if (!group) {
            const element = doc.createElement('section');
            element.className = 'instrument-picker-group';
            const heading = doc.createElement('h3');
            heading.className = 'instrument-picker-group-title';
            heading.id = `${select.id}-picker-group-${groups.length}`;
            heading.textContent = source.label;
            heading.style.cursor = 'default';
            element.setAttribute('aria-labelledby', heading.id);
            element.append(heading); list.append(element);
            group = { source, element, rows: [] };
            groups.push(group); groupNodes.set(source, group);
          }
        }
        const element = doc.createElement('div');
        element.className = 'instrument-picker-row';
        const button = doc.createElement('button');
        button.type = 'button'; button.className = 'instrument-picker-link';
        button.dataset.optionIndex = String(index); button.dataset.value = option.value;
        button.textContent = option.label;
        if (option.title) button.title = option.title;
        element.append(button); (group?.element ?? list).append(element);
        const row = { element, button, index, group };
        rows.push(row); group?.rows.push(row);
      }
      list.append(empty);
    }
    currentLabel.textContent = select.selectedOptions[0]?.label || label;
    summary.setAttribute('aria-label', `${label}: ${currentLabel.textContent}`);
    summary.title = `${label}: ${currentLabel.textContent}`;
    const description = select.getAttribute('aria-describedby');
    if (description) summary.setAttribute('aria-describedby', description);
    else summary.removeAttribute('aria-describedby');
    summary.setAttribute('aria-disabled', String(select.disabled));
    summary.tabIndex = select.disabled ? -1 : 0;
    for (const row of rows) {
      const option = options[row.index];
      row.button.disabled = select.disabled || option.disabled || Boolean(row.group?.source.disabled);
      row.button.setAttribute('aria-pressed', String(row.index === select.selectedIndex));
    }
    filter();
    if (select.disabled) close();
  };
  const choose = row => {
    if (!row || select.disabled || row.button.disabled) return;
    select.selectedIndex = row.index;
    select.dispatchEvent(new runtime.Event('input', { bubbles: true }));
    select.dispatchEvent(new runtime.Event('change', { bubbles: true }));
    sync(); close({ focus: true });
  };
  listen(list, 'click', event => {
    const button = event.target.closest('button[data-option-index]');
    if (button && list.contains(button)) choose(rows.find(row => row.button === button));
  });
  listen(select, 'input', sync);
  listen(select, 'change', sync);
  listen(searchInput, 'input', filter);
  listen(summary, 'click', event => {
    sync();
    if (select.disabled) event.preventDefault();
  });
  for (const controlLabel of select.labels) listen(controlLabel, 'click', event => {
    if (details.contains(event.target)) return;
    event.preventDefault(); sync();
    if (select.disabled) return;
    summary.focus({ preventScroll: true });
    details.open = true; anchor.update();
  });
  listen(details, 'toggle', () => {
    if (destroyed) return;
    if (details.open) {
      sync();
      if (details.open && (doc.activeElement === summary || !details.contains(doc.activeElement))) {
        searchInput.focus({ preventScroll: true });
      }
    } else {
      searchInput.value = ''; filter();
    }
  });
  listen(details, 'keydown', event => {
    // The instrument uses letters and Space as performance gestures.
    event.stopPropagation();
    if (select.disabled) { event.preventDefault(); return; }
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Escape' && details.open) {
      event.preventDefault(); close({ focus: true }); return;
    }
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      if (!details.open) { sync(); details.open = true; anchor.update(); }
      const choices = available(), direction = event.key === 'ArrowDown' ? 1 : -1;
      const index = choices.findIndex(row => row.button === event.target);
      focusRow(choices[index < 0 ? (direction > 0 ? 0 : choices.length - 1)
        : (index + direction + choices.length) % choices.length]);
    } else if (details.open && event.target !== searchInput && ['Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const choices = available(); focusRow(event.key === 'Home' ? choices[0] : choices.at(-1));
    } else if (details.open && event.target === searchInput && event.key === 'Enter') {
      event.preventDefault(); choose(available()[0]);
    }
  });
  listen(details, 'keyup', event => {
    // Release a breath key held before focus entered the menu.
    if (!['[', ']'].includes(event.key)) event.stopPropagation();
  });
  const dismissOutside = event => {
    if (details.open && !event.composedPath().includes(details)) close();
  };
  listen(doc, 'pointerdown', dismissOutside);
  listen(doc, 'focusin', dismissOutside);
  sync();
  return {
    sync, close,
    destroy() {
      if (destroyed) return;
      const restoreFocus = details.contains(doc.activeElement);
      close(); destroyed = true; anchor.destroy();
      for (const remove of removers) remove();
      details.remove();
      if (originalHidden === null) select.removeAttribute('hidden');
      else select.setAttribute('hidden', originalHidden);
      if (restoreFocus && !select.hidden && !select.disabled) select.focus({ preventScroll: true });
    },
  };
}
