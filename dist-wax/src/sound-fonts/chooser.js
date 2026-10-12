import { createSoundFontService, createSoundFontSelection } from './bank-service.js';
import { enhanceChooseSelect } from '../ui/patterns/choose-select.js';

/** Reusable bank control; the consumer owns audio and commits the selected bytes. */
export function mountSoundFontChooser(host, { fileInput, defaultButton, onLoad, onStatus = () => {}, service = createSoundFontService(), id = 'sharedSoundFontBank' } = {}) {
  const doc = host.ownerDocument, runtime = doc.defaultView;
  const events = new AbortController();
  const label = doc.createElement('label'); label.className = 'control';
  label.textContent = 'SoundFont bank'; label.htmlFor = id;
  const select = doc.createElement('select'); select.id = id; select.setAttribute('aria-label', 'SoundFont bank');
  const initial = doc.createElement('option'); initial.value = 'bundled-timgm6mb'; initial.textContent = 'TimGM6mb'; select.append(initial);
  label.append(select);
  const status = doc.createElement('p'); status.id = `${id === 'sharedSoundFontBank' ? 'sharedSoundFont' : id}Status`; status.className = 'midiphoria-help'; status.setAttribute('role', 'status');
  const refreshButton = doc.createElement('button'); refreshButton.type = 'button'; refreshButton.className = 'mini-action'; refreshButton.textContent = 'Refresh library';
  host.append(label, refreshButton, status);
  // Keep body controls beneath the masthead; their popup uses the top layer.
  host.style.position = 'relative'; host.style.zIndex = '0';
  const picker = enhanceChooseSelect(select, { label: 'SoundFont bank', placeholder: 'Find a bank or saved font' });
  let disposed = false, revision = 0, unsubscribe = () => {}, committed = 'bundled-timgm6mb', loading = false;
  const on = (node, event, listener) => node?.addEventListener(event, listener, { signal: events.signal });
  async function refresh() {
    const ticket = ++revision;
    try {
      const entries = await service.list(); if (disposed || ticket !== revision) return;
      const selected = loading ? select.value : committed;
      const groups = new Map();
      for (const entry of entries) {
        let group = groups.get(entry.group);
        if (!group) { group = doc.createElement('optgroup'); group.label = entry.group; groups.set(entry.group, group); }
        const option = doc.createElement('option'); option.value = entry.id;
        option.textContent = `${entry.name}${entry.format === 'sf3' ? ' · SF3' : ''}`; group.append(option);
      }
      select.replaceChildren(...groups.values());
      // A previously loaded font may have been removed from the saved library.
      if (![...select.options].some(option => option.value === selected)) {
        const option = doc.createElement('option'); option.value = selected; option.textContent = selection.current?.name || 'Current bank'; select.append(option);
      }
      select.value = selected; picker.refresh();
    } catch (error) { if (!disposed && !loading) { status.textContent = error.message; onStatus({ loading: false, error }); } }
  }
  const selection = createSoundFontSelection({ service, onLoad, onState(state) {
    if (disposed) return;
    loading = state.loading; host.setAttribute('aria-busy', String(loading));
    if (state.current) committed = state.current.id;
    if (!loading) { select.value = committed; picker.refresh(); }
    status.textContent = state.error?.message || (loading ? 'Loading SoundFont…' : state.warning || `Using ${state.current?.name || 'TimGM6mb'}`);
    onStatus(state);
    if (!loading && !state.error) void refresh();
  } });
  on(select, 'change', () => { void selection.select(select.value); });
  on(fileInput, 'change', () => { const file = fileInput.files?.[0]; fileInput.value = ''; if (file) void selection.importFile(file); });
  on(defaultButton, 'click', () => { select.value = 'bundled-timgm6mb'; void selection.select('bundled-timgm6mb'); });
  on(refreshButton, 'click', () => { void refresh(); });
  on(runtime, 'focus', () => { void refresh(); });
  void service.subscribe(() => { void refresh(); }).then(off => { if (disposed) off(); else unsubscribe = off; });
  void refresh();
  return { refresh, select: id => selection.select(id), dispose() {
    if (disposed) return; disposed = true; revision++; events.abort(); unsubscribe(); selection.dispose(); picker.destroy(); service.dispose(); host.replaceChildren();
  } };
}
