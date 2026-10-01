import { enhanceRangeKnob } from '../../ui/primitives/range-knob.js';

/** Ordinary dial gestures stay in a fixed span; exact entry keeps native values. */
export function enhanceNativeKnob(input, output, rule) {
  const doc = input.ownerDocument, runtime = doc.defaultView ?? globalThis;
  const range = Object.freeze({
    min: rule.dragMin ?? (Number.isFinite(rule.min) ? rule.min : Number(input.min)),
    max: rule.dragMax ?? (Number.isFinite(rule.max) ? rule.max : Number(input.max)),
  });
  if (!Number.isFinite(range.min) || !Number.isFinite(range.max) || range.max < range.min) {
    throw new TypeError('A native knob needs finite ordered drag bounds.');
  }
  const bounded = value => Math.max(range.min, Math.min(range.max, value));
  const signal = (type, exact = false) => {
    const event = new runtime.Event(type, { bubbles: true });
    if (exact) event.nativeExact = true;
    input.dispatchEvent(event);
  };
  // HTML range inputs clamp .value to their attributes. These backing bounds
  // retain the raw request only; interactionRange always remains fixed above.
  const store = value => {
    input.min = String(Math.min(range.min, value));
    input.max = String(Math.max(range.max, value));
    input.value = String(value);
  };
  const widget = enhanceRangeKnob(input, { interactionRange: range });
  input.dataset.dragMin = String(range.min);
  input.dataset.dragMax = String(range.max);
  const update = () => { store(Number(input.value)); widget.update(); };
  const key = event => {
    if (input.disabled) return;
    const direction = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[event.key];
    if (!direction && !['Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) return;
    event.preventDefault();
    const previous = Number(input.value), span = range.max - range.min;
    const step = Number(rule.nativeStep) || Number(rule.step) || span / 100 || 1;
    const amount = (event.key === 'PageUp' ? 10 : event.key === 'PageDown' ? -10 : direction) * step;
    const next = event.key === 'Home' ? range.min : event.key === 'End' ? range.max : bounded(bounded(previous) + amount);
    if (next === previous) return;
    store(next); widget.update(); signal('input'); signal('change');
  };
  input.addEventListener('keydown', key, { capture: true });
  input.addEventListener('input', update);
  input.addEventListener('change', update);
  output.tabIndex = 0;
  output.setAttribute('role', 'button');
  output.setAttribute('aria-label', `Enter exact ${rule.label} value`);
  output.title = 'Type an exact value, including outside the normal drag range.';
  input.title = `Drag range ${range.min} to ${range.max}${rule.unit ? ' ' + rule.unit : ''}. Shift-drag for fine adjustment; click the readout to type any finite native value.`;
  let editor = null;
  const edit = () => {
    if (editor || input.disabled) return;
    editor = doc.createElement('input');
    editor.type = 'text'; editor.inputMode = 'decimal'; editor.className = 'native-exact-value';
    editor.value = input.value; editor.setAttribute('aria-label', `Exact ${rule.label}`);
    output.hidden = true; output.after(editor); editor.focus(); editor.select();
    const finish = commit => {
      if (!editor) return;
      const value = Number(editor.value.trim());
      if (commit && (!editor.value.trim() || !Number.isFinite(value))) {
        editor.setCustomValidity('Enter a finite number. Scientific notation is accepted.');
        editor.reportValidity(); return;
      }
      const field = editor; editor = null; field.remove(); output.hidden = false;
      if (commit) { store(value); signal('input', true); signal('change', true); widget.update(); }
    };
    editor.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); finish(true); if (!editor) input.focus({ preventScroll: true }); }
      else if (event.key === 'Escape') { event.preventDefault(); finish(false); input.focus({ preventScroll: true }); }
    });
    editor.addEventListener('blur', () => finish(true));
  };
  const editKey = event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); edit(); } };
  output.addEventListener('click', edit); output.addEventListener('keydown', editKey);
  update();
  return {
    update,
    destroy() {
      widget.destroy();
      const field = editor; editor = null; field?.remove(); output.hidden = false;
      output.removeEventListener('click', edit); output.removeEventListener('keydown', editKey);
      input.removeEventListener('keydown', key, { capture: true });
      input.removeEventListener('input', update); input.removeEventListener('change', update);
      delete input.dataset.dragMin; delete input.dataset.dragMax;
    },
  };
}
