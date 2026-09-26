// A view of the existing four ADSR fields, not a second envelope/DSP model.
// Independent logarithmic time lanes keep 1 ms attacks and long releases
// editable together, without overlapping handles on a phone.
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const keys = ['caAttack', 'caDecay', 'caSustain', 'caRelease'];
const lanes = { caAttack:[.07,.25], caDecay:[.38,.56], caRelease:[.83,.98] };
export const envelopeTimeFraction = (value, min, max) => clamp(Math.log(value / min) / Math.log(max / min));
export const envelopeTimeValue = (fraction, min, max) => min * (max / min) ** clamp(fraction);
export function automatapoeiaEnvelopeGeometry(values, limits) {
  const x = key => {
    const [low, high] = lanes[key];
    return low + (high - low) * envelopeTimeFraction(values[key], ...limits[key]);
  };
  return {
    caAttack:{x:x('caAttack'),y:0}, caDecay:{x:x('caDecay'),y:1-values.caSustain},
    caSustain:{x:.69,y:1-values.caSustain}, caRelease:{x:x('caRelease'),y:1},
  };
}

export function mountAutomatapoeiaEnvelope(host, { readValue = input => Number(input.value), onInput = () => {} } = {}) {
  const doc = host.ownerDocument, runtime = doc.defaultView;
  const inputs = Object.fromEntries(keys.map(key => [key, doc.getElementById(key)]));
  const nodes = Object.fromEntries(keys.map(key => [key, host.querySelector(`[data-envelope="${key}"]`)]));
  const limits = Object.fromEntries(keys.map(key => [key, [Number(inputs[key].min), Number(inputs[key].max)]]));
  const editor = host.querySelector('.curve-editor'), path = host.querySelector('.curve-path');
  const abort = new runtime.AbortController();
  const listen = (node, type, fn) => node.addEventListener(type, fn, {signal:abort.signal});
  let drag = null, previous = '';
  const refresh = () => {
    const values = Object.fromEntries(keys.map(key => [key, readValue(inputs[key])]));
    const signature = keys.map(key => `${values[key]}:${inputs[key].disabled}`).join(':');
    if (signature === previous) return;
    previous = signature;
    const points = automatapoeiaEnvelopeGeometry(values, limits);
    for (const key of keys) {
      const node = nodes[key], point = points[key], scale = key === 'caSustain' ? 100 : 1000;
      const value = Math.round(values[key] * scale);
      const text = key === 'caSustain' ? `${value} percent` : `${value} milliseconds`;
      node.style.left = `${point.x * 100}%`; node.style.top = `${point.y * 100}%`;
      node.setAttribute('aria-valuemin', String(limits[key][0] * scale));
      node.setAttribute('aria-valuemax', String(limits[key][1] * scale));
      node.setAttribute('aria-valuenow', String(value)); node.setAttribute('aria-valuetext', text);
      node.title = `${node.getAttribute('aria-label')}: ${text}. Drag ${key === 'caSustain' ? 'up/down' : 'left/right (log time)'}, or use arrow keys.`;
      node.disabled = inputs[key].disabled;
    }
    const a = points.caAttack.x * 240, d = points.caDecay.x * 240;
    const s = points.caSustain.x * 240, r = points.caRelease.x * 240, y = points.caSustain.y * 96;
    path.setAttribute('d', `M0 96 C${a*.35} 96 ${a*.65} 0 ${a} 0 L${d} ${y} L${s} ${y} Q${(s+r)/2} 96 ${r} 96`);
  };
  const set = (key, value) => {
    const input = inputs[key], [min, max] = limits[key], step = Number(input.step);
    const next = clamp(min + Math.round((value - min) / step) * step, min, max);
    if (Math.abs(next - readValue(input)) < step * .001) return;
    input.value = String(next);
    input.dispatchEvent(new runtime.Event('input', {bubbles:true}));
    refresh();
    onInput(input);
  };
  const finish = () => {
    if (!drag) return;
    const id = drag.id; drag = null;
    if (editor.hasPointerCapture(id)) editor.releasePointerCapture(id);
  };
  listen(editor, 'pointerdown', event => {
    const node = event.target.closest('[data-envelope]');
    if (!node || node.disabled || drag || event.button !== 0) return;
    const key = node.dataset.envelope, value = readValue(inputs[key]);
    drag = {id:event.pointerId,key,x:event.clientX,y:event.clientY,value,bounds:editor.getBoundingClientRect()};
    editor.setPointerCapture(event.pointerId); node.focus({preventScroll:true}); event.preventDefault();
  });
  listen(editor, 'pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    const {key,value,bounds} = drag, fine = event.shiftKey ? .1 : 1;
    if (key === 'caSustain') set(key, value - (event.clientY-drag.y) / Math.max(1,bounds.height) * fine);
    else set(key, envelopeTimeValue(
      envelopeTimeFraction(value, ...limits[key]) + (event.clientX-drag.x) / Math.max(1,bounds.width*(lanes[key][1]-lanes[key][0])) * fine,
      ...limits[key],
    ));
  });
  for (const type of ['pointerup','pointercancel','lostpointercapture']) listen(editor, type, event => {
    if (drag?.id === event.pointerId) finish();
  });
  listen(runtime, 'blur', finish);
  listen(editor, 'keydown', event => {
    const node = event.target.closest('[data-envelope]');
    if (!node || node.disabled || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const key = node.dataset.envelope, [min,max] = limits[key];
    const delta = Number(inputs[key].step) * (event.shiftKey ? 10 : 1);
    set(key, event.key === 'Home' ? min : event.key === 'End' ? max
      : readValue(inputs[key]) + (['ArrowRight','ArrowUp'].includes(event.key) ? delta : -delta));
  });
  listen(host, 'input', refresh);
  refresh();
  return {refresh, destroy() { finish(); abort.abort(); }};
}
