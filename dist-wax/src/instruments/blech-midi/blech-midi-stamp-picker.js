import { createChoosePickerShell, anchorChoosePickerPanel } from '../../ui/patterns/choose-picker-shell.js';

const THUMB_WIDTH = 128, THUMB_HEIGHT = 64, MAX_PREVIEW_NOTES = 4096;
let pickerSequence = 0;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** Bounded, pitch-horizontal preview geometry. It never parses a MIDI file. */
export function stampThumbnailRects(entry = {}) {
  const notes = entry.notes ?? entry.analysis?.notes ?? entry.score?.analysis?.notes ?? [];
  const count = Math.min(notes.length, MAX_PREVIEW_NOTES), sampled = [];
  let duration = Number(entry.durationBeats ?? entry.analysis?.durationBeats ?? entry.score?.durationBeats);
  for (let index = 0; index < count; index++) {
    const note = notes[Math.floor(index * notes.length / count)];
    if (!note || ![note.note, note.beat, note.duration].every(Number.isFinite)
      || note.note < 0 || note.note > 127 || note.beat < 0 || note.duration <= 0) continue;
    sampled.push(note);
  }
  if (!(duration > 0) || !Number.isFinite(duration)) {
    duration = sampled.reduce((end, note) => Math.max(end, note.beat + note.duration), 1);
  }
  const result = [];
  for (const note of sampled) {
    if (note.beat >= duration) continue;
    const bottom = clamp(THUMB_HEIGHT * (1 - note.beat / duration), 0, THUMB_HEIGHT);
    const top = clamp(THUMB_HEIGHT * (1 - (note.beat + note.duration) / duration), 0, THUMB_HEIGHT - 1);
    result.push({ x: Math.floor(note.note), y: top, width: 1, height: Math.min(THUMB_HEIGHT - top, Math.max(1, bottom - top)) });
  }
  return result;
}

/** Compact stamp choice only; preparing or playing the selected stamp belongs to the owner. */
export function mountBlechStampPicker(host, { entries = [], onSelect, selectedId, label = 'Choose stamp' } = {}) {
  const doc = host.ownerDocument, runtime = doc.defaultView ?? globalThis;
  const shell = createChoosePickerShell(doc, {
    current: label, label, title: label, panelId: `blech-stamp-choices-${++pickerSequence}`,
    placeholder: 'Find a stamp or collection', filterLabel: 'Filter MIDI stamps', listLabel: 'MIDI stamps',
  });
  const { details, summary, currentLabel, panel, search, searchInput, list } = shell;
  details.classList.add('blech-stamp-picker');
  panel.classList.add('blech-stamp-picker-panel');
  summary.setAttribute('aria-controls', panel.id);
  summary.setAttribute('aria-expanded', 'false');
  currentLabel.classList.add('blech-stamp-current');
  panel.append(search, list); details.append(summary, panel); host.append(details);
  const anchor = anchorChoosePickerPanel(shell, runtime);
  const empty = doc.createElement('p'); empty.className = 'instrument-picker-empty'; empty.textContent = 'No matching stamps';
  const removers = [];
  let disposed = false, selected = selectedId == null ? null : String(selectedId), rows = [];
  const listen = (target, type, handler) => {
    target.addEventListener(type, handler);
    removers.push(() => target.removeEventListener(type, handler));
  };
  function thumbnail(entry) {
    // The owner may provide a precomputed local raster. Never fetch a score or
    // remote image just to open the catalogue.
    if (typeof entry.thumbnail === 'string' && /^data:image\/(?:png|webp|jpeg|gif);base64,/i.test(entry.thumbnail)) {
      const image = doc.createElement('img'); image.className = 'blech-stamp-thumbnail';
      image.src = entry.thumbnail; image.alt = ''; image.width = THUMB_WIDTH; image.height = THUMB_HEIGHT;
      return image;
    }
    const canvas = doc.createElement('canvas'); canvas.className = 'blech-stamp-thumbnail';
    canvas.width = THUMB_WIDTH; canvas.height = THUMB_HEIGHT; canvas.setAttribute('aria-hidden', 'true');
    const context = canvas.getContext('2d');
    if (!context) return canvas;
    context.fillStyle = '#090e12'; context.fillRect(0, 0, THUMB_WIDTH, THUMB_HEIGHT);
    if (entry.thumbnail?.nodeName === 'CANVAS' && entry.thumbnail.width && entry.thumbnail.height) {
      context.drawImage(entry.thumbnail, 0, 0, THUMB_WIDTH, THUMB_HEIGHT); return canvas;
    }
    const rectangles = stampThumbnailRects(entry); context.fillStyle = '#caa0db';
    for (const rect of rectangles) context.fillRect(rect.x, rect.y, rect.width, rect.height);
    if (!rectangles.length) {
      context.font = '14px monospace'; context.textAlign = 'center'; context.textBaseline = 'middle';
      context.fillText(entry.file ? 'MIDI' : '—', THUMB_WIDTH / 2, THUMB_HEIGHT / 2);
    }
    return canvas;
  }
  function filter() {
    const words = searchInput.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    for (const row of rows) row.element.hidden = !words.every(word => row.search.includes(word));
    empty.hidden = rows.some(row => !row.element.hidden);
  }
  function reflect() {
    const chosen = rows.find(row => row.entry.id === selected);
    currentLabel.replaceChildren();
    const title = doc.createElement('span'); title.className = 'blech-stamp-current-label'; title.textContent = chosen?.entry.title ?? label;
    if (chosen) currentLabel.append(thumbnail(chosen.entry));
    currentLabel.append(title);
    summary.setAttribute('aria-label', chosen ? `${label}: ${chosen.entry.title}` : label);
    summary.title = chosen ? `${chosen.entry.title}${chosen.entry.group ? ` · ${chosen.entry.group}` : ''}` : label;
    summary.setAttribute('aria-disabled', String(!rows.length)); summary.tabIndex = rows.length ? 0 : -1;
    for (const row of rows) row.button.setAttribute('aria-pressed', String(row.entry.id === selected));
  }
  function close({ focus = false } = {}) {
    if (disposed) return;
    details.open = false; summary.setAttribute('aria-expanded', 'false');
    searchInput.value = ''; filter(); anchor.update();
    if (focus) summary.focus({ preventScroll: true });
  }
  function select(id) {
    if (disposed) return false;
    const row = rows.find(candidate => candidate.entry.id === String(id));
    if (!row || row.button.disabled) return false;
    selected = row.entry.id; reflect(); return true;
  }
  function choose(row) {
    if (!row || !select(row.entry.id)) return;
    close({ focus: true }); onSelect?.(row.entry.id, row.entry);
  }
  function update(nextEntries) {
    if (disposed) return;
    const seen = new Set(); rows = []; list.replaceChildren();
    for (const candidate of nextEntries ?? []) {
      if (candidate?.id == null || seen.has(String(candidate.id))) continue;
      const entry = { ...candidate, id: String(candidate.id), title: String(candidate.title ?? candidate.label ?? candidate.id) };
      seen.add(entry.id);
      const element = doc.createElement('div'); element.className = 'instrument-picker-row';
      const button = doc.createElement('button'); button.type = 'button'; button.className = 'instrument-picker-link blech-stamp-choice';
      button.dataset.stampId = entry.id; button.disabled = Boolean(entry.disabled);
      button.setAttribute('aria-label', entry.group ? `${entry.title} · ${entry.group}` : entry.title);
      const copy = doc.createElement('span'); copy.className = 'instrument-picker-link-label blech-stamp-choice-copy';
      const title = doc.createElement('span'); title.textContent = entry.title; copy.append(title);
      if (entry.group) { const group = doc.createElement('small'); group.textContent = entry.group; copy.append(group); }
      button.append(thumbnail(entry), copy); element.append(button); list.append(element);
      rows.push({ entry, element, button, search: `${entry.title} ${entry.group ?? ''} ${entry.artist ?? ''} ${entry.collection ?? ''} ${entry.file ? 'MIDI file' : 'generated pattern'}`.toLocaleLowerCase() });
    }
    list.append(empty);
    if (!rows.some(row => row.entry.id === selected && !row.button.disabled)) selected = rows.find(row => !row.button.disabled)?.entry.id ?? null;
    reflect(); filter();
    if (!rows.length) close();
    else anchor.update();
  }
  const available = () => rows.filter(row => !row.element.hidden && !row.button.disabled);
  const focusRow = row => { row?.button.focus({ preventScroll: true }); row?.button.scrollIntoView({ block: 'nearest' }); };
  listen(list, 'click', event => {
    const button = event.target.closest('button[data-stamp-id]');
    if (button && list.contains(button)) choose(rows.find(row => row.button === button));
  });
  listen(searchInput, 'input', filter);
  listen(summary, 'click', event => { if (!rows.length) event.preventDefault(); });
  listen(details, 'toggle', () => {
    if (disposed) return;
    summary.setAttribute('aria-expanded', String(details.open));
    if (details.open && (doc.activeElement === summary || !details.contains(doc.activeElement))) searchInput.focus({ preventScroll: true });
    else if (!details.open) { searchInput.value = ''; filter(); }
  });
  listen(details, 'keydown', event => {
    event.stopPropagation();
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Escape' && details.open) { event.preventDefault(); close({ focus: true }); return; }
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault(); if (!rows.length) return;
      details.open = true; summary.setAttribute('aria-expanded', 'true'); anchor.update();
      const choices = available(), direction = event.key === 'ArrowDown' ? 1 : -1;
      const index = choices.findIndex(row => row.button === event.target);
      focusRow(choices[index < 0 ? (direction > 0 ? 0 : choices.length - 1) : (index + direction + choices.length) % choices.length]);
    } else if (details.open && event.target !== searchInput && ['Home', 'End'].includes(event.key)) {
      event.preventDefault(); const choices = available(); focusRow(event.key === 'Home' ? choices[0] : choices.at(-1));
    } else if (details.open && event.target === searchInput && event.key === 'Enter') {
      event.preventDefault(); choose(available()[0]);
    }
  });
  const dismissOutside = event => { if (details.open && !event.composedPath().includes(details)) close(); };
  listen(doc, 'pointerdown', dismissOutside); listen(doc, 'focusin', dismissOutside);
  update(entries);
  return {
    update, select, close, element: details,
    get value() { return selected; },
    dispose() {
      if (disposed) return;
      close(); disposed = true; anchor.destroy(); for (const remove of removers) remove(); details.remove(); rows = [];
    },
  };
}
