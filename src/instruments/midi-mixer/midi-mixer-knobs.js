import { enhanceRangeKnob } from '../../ui/primitives/range-knob.js';

/** Mixer-only presentation; native inputs remain the owners of values/events. */
export function mountMixerKnobs(host) {
  const document = host.ownerDocument, runtime = document.defaultView ?? globalThis;
  const controls = new Map(), owners = new WeakMap();
  let destroyed = false;
  const ranges = node => node?.nodeType === 1
    ? [...(node.matches('input[type="range"]') ? [node] : []), ...node.querySelectorAll('input[type="range"]')]
    : [];

  function add(input) {
    if (destroyed || controls.has(input) || !host.contains(input) || input.hasAttribute('data-midi-note-effect') || input.hasAttribute('data-keep-slider')) return;
    // An editor row also contains its exact number and Follow button. A separate
    // dial surface prevents the transparent range from intercepting either.
    const owner = input.closest('.midi-edit-field, .control, label') ?? input.parentElement;
    const wrapper = document.createElement('span'); wrapper.className = 'mixer-range-knob';
    input.before(wrapper); wrapper.append(input);
    const widget = enhanceRangeKnob(input);
    const record = { input, owner, wrapper, widget };
    controls.set(input, record);
    if (!owners.has(owner)) owners.set(owner, new Set());
    owners.get(owner).add(record);
  }

  function remove(record) {
    controls.delete(record.input); owners.get(record.owner)?.delete(record);
    record.widget.destroy();
    if (record.input.parentNode === record.wrapper) record.wrapper.before(record.input);
    record.wrapper.remove();
  }

  function mark(node, affected) {
    // Readouts are outside the small dial wrapper. Refresh only their owning
    // field, rather than every opened voice editor on each transport update.
    for (let element = node?.nodeType === 1 ? node : node?.parentElement;
      element && host.contains(element); element = element.parentElement) {
      for (const record of owners.get(element) ?? []) affected.add(record);
      if (element === host) break;
    }
  }

  for (const input of ranges(host)) add(input);
  const observer = runtime.MutationObserver ? new runtime.MutationObserver(records => {
    if (destroyed) return;
    const affected = new Set(); let removedRanges = false;
    for (const mutation of records) {
      mark(mutation.target, affected);
      if (mutation.type === 'attributes') {
        const record = controls.get(mutation.target); if (record) affected.add(record);
        if (mutation.attributeName === 'disabled') for (const input of ranges(mutation.target)) {
          const descendant = controls.get(input); if (descendant) affected.add(descendant);
        }
      } else if (mutation.type === 'childList') {
        for (const node of mutation.addedNodes) for (const input of ranges(node)) add(input);
        if (!removedRanges) removedRanges = [...mutation.removedNodes].some(node => ranges(node).length > 0);
      }
    }
    if (removedRanges) for (const record of [...controls.values()]) {
      if (!host.contains(record.input) || record.input.parentNode !== record.wrapper) {
        remove(record);
        if (host.contains(record.input)) add(record.input);
      }
    }
    for (const record of affected) if (controls.get(record.input) === record) record.widget.update();
  }) : null;
  // Knob updates change only style/class. Neither is observed, so reflecting a
  // value cannot create an observer loop or emit a musical input event.
  observer?.observe(host, { subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ['min', 'max', 'step', 'disabled', 'value'] });

  return {
    update(input) {
      if (destroyed) return;
      if (!controls.has(input) && input?.matches?.('input[type="range"]')) add(input);
      controls.get(input)?.widget.update();
    },
    refresh() {
      if (destroyed) return;
      for (const record of controls.values()) record.widget.update();
    },
    destroy() {
      if (destroyed) return; destroyed = true; observer?.disconnect();
      for (const record of [...controls.values()]) remove(record);
    },
  };
}
