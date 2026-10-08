// Shape's curve-editor presentation, backed by Midiphoria's existing light ADSR
// controls. Separate logarithmic time lanes keep zero/short stages and five-second
// releases editable together; the sustain segment lasts until the note is released.
const keys = ['attack', 'decay', 'sustain', 'release'];
const lanes = { attack: [.08, .23], decay: [.36, .52], release: [.8, .95] };
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const timeFraction = (value, max) => Math.log1p(value / .01) / Math.log1p(max / .01);
const timeValue = (fraction, max) => .01 * Math.expm1(clamp(fraction) * Math.log1p(max / .01));

export function mountMidiphoriaEnvelope(host, { readValue = input => Number(input.value) } = {}) {
  const doc = host.ownerDocument, runtime = doc.defaultView;
  const editor = host.querySelector('.curve-editor'), path = host.querySelector('.curve-path');
  const inputs = Object.fromEntries(keys.map(key => [key, doc.getElementById(key)]));
  const nodes = Object.fromEntries(keys.map(key => [key, host.querySelector(`[data-envelope="${key}"]`)]));
  const events = new runtime.AbortController();
  const on = (node, type, listener) => node.addEventListener(type, listener, { signal: events.signal });
  let drag = null, previous = '';

  function refresh() {
    const values = Object.fromEntries(keys.map(key => [key, readValue(inputs[key])]));
    const signature = keys.map(key => `${values[key]}:${inputs[key].disabled}`).join(':');
    if (signature === previous) return;
    previous = signature;
    const points = {};
    for (const key of keys) {
      const input = inputs[key], node = nodes[key], value = values[key];
      const scale = key === 'sustain' ? 100 : 1;
      const lane = lanes[key];
      const x = lane ? lane[0] + (lane[1] - lane[0]) * timeFraction(value, Number(input.max)) : .67;
      const y = key === 'attack' ? 0 : key === 'release' ? 1 : 1 - values.sustain;
      points[key] = [x * 240, y * 96];
      node.style.left = `${x * 100}%`; node.style.top = `${y * 100}%`;
      node.setAttribute('aria-valuemin', String(Number(input.min) * scale));
      node.setAttribute('aria-valuemax', String(Number(input.max) * scale));
      node.setAttribute('aria-valuenow', String(Number((value * scale).toFixed(2))));
      const spoken = key === 'sustain' ? `${Math.round(value * 100)} percent` : `${value.toFixed(2)} seconds`;
      node.setAttribute('aria-valuetext', spoken);
      node.title = `${node.getAttribute('aria-label')}: ${spoken}. Drag ${key === 'sustain' ? 'up/down' : 'left/right (log time)'}, or use arrow keys.`;
      node.disabled = input.disabled;
    }
    path.setAttribute('d', `M0 96 ${keys.map(key => `L${points[key].join(' ')}`).join(' ')}`);
    host.querySelector('#lightEnvelopeReadout').value = `A ${values.attack.toFixed(2)} s · D ${values.decay.toFixed(2)} s · S ${Math.round(values.sustain * 100)}% · R ${values.release.toFixed(2)} s`;
  }

  function set(key, value) {
    const input = inputs[key], min = Number(input.min), max = Number(input.max), step = Number(input.step);
    const next = clamp(min + Math.round((value - min) / step) * step, min, max);
    if (Math.abs(next - readValue(input)) < step * .001) return;
    input.value = String(Number(next.toFixed(4)));
    input.dispatchEvent(new runtime.Event('input', { bubbles: true }));
    refresh();
  }

  function finish() {
    if (!drag) return;
    const id = drag.id; drag = null;
    if (editor.hasPointerCapture(id)) editor.releasePointerCapture(id);
  }
  on(editor, 'pointerdown', event => {
    const node = event.target.closest('[data-envelope]');
    if (!node || node.disabled || event.button !== 0 || drag) return;
    const key = node.dataset.envelope;
    drag = { id: event.pointerId, key, x: event.clientX, y: event.clientY,
      value: readValue(inputs[key]), bounds: editor.getBoundingClientRect() };
    editor.setPointerCapture(event.pointerId); node.focus({ preventScroll: true }); event.preventDefault();
  });
  on(editor, 'pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    const { key, value, bounds } = drag, fine = event.shiftKey ? .1 : 1;
    if (key === 'sustain') set(key, value - (event.clientY - drag.y) / Math.max(1, bounds.height) * fine);
    else {
      const max = Number(inputs[key].max), lane = lanes[key];
      set(key, timeValue(timeFraction(value, max) + (event.clientX - drag.x) / Math.max(1, bounds.width * (lane[1] - lane[0])) * fine, max));
    }
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) on(editor, type, event => {
    if (drag?.id === event.pointerId) finish();
  });
  on(runtime, 'blur', finish);
  on(editor, 'keydown', event => {
    const node = event.target.closest('[data-envelope]');
    if (!node || node.disabled || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const key = node.dataset.envelope, input = inputs[key];
    const delta = Number(input.step) * (event.shiftKey ? 10 : 1);
    set(key, event.key === 'Home' ? Number(input.min) : event.key === 'End' ? Number(input.max)
      : readValue(input) + (['ArrowRight', 'ArrowUp'].includes(event.key) ? delta : -delta));
  });
  on(host, 'input', refresh);
  refresh();
  return { refresh, destroy() { finish(); events.abort(); } };
}
