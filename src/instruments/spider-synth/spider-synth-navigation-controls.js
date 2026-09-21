const clamp = value => Math.max(-1, Math.min(1, Number(value) || 0));
const directions = Object.freeze({ ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] });

/** A small spring-return stick. It owns input, never time, sound or transport. */
export function createSpiderNavigationControls({ element, onSteer, runtime = window }) {
  const listeners = new AbortController(), options = { signal: listeners.signal };
  const keys = new Set();
  let pointer = null, vector = { x: 0, z: 0 }, disposed = false;
  function emit(x, z) {
    x = clamp(x); z = clamp(z);
    const length = Math.hypot(x, z);
    if (length > 1) { x /= length; z /= length; }
    if (Math.hypot(x, z) < .08) { x = 0; z = 0; }
    if (Math.abs(x - vector.x) < .001 && Math.abs(z - vector.z) < .001) return;
    vector = { x, z };
    element.style.setProperty('--stick-x', `${x * 28}px`);
    element.style.setProperty('--stick-y', `${-z * 28}px`);
    element.classList.toggle('is-steering', Boolean(x || z));
    onSteer({ x, z, active: Boolean(x || z), source: 'joystick' });
  }
  function fromPointer(event) {
    const box = element.getBoundingClientRect(), radius = Math.min(box.width, box.height) * .38;
    emit((event.clientX - box.x - box.width / 2) / radius, -(event.clientY - box.y - box.height / 2) / radius);
  }
  function fromKeys() {
    let x = 0, z = 0;
    for (const key of keys) { x += directions[key][0]; z += directions[key][1]; }
    emit(x, z);
  }
  function release() {
    const old = pointer; pointer = null; keys.clear(); emit(0, 0);
    if (old !== null && element.hasPointerCapture?.(old)) element.releasePointerCapture(old);
  }
  element.addEventListener('pointerdown', event => {
    if (disposed || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault(); element.focus({ preventScroll: true });
    keys.clear(); pointer = event.pointerId; element.setPointerCapture(pointer); fromPointer(event);
  }, options);
  element.addEventListener('pointermove', event => {
    if (event.pointerId !== pointer) return;
    event.preventDefault(); fromPointer(event);
  }, options);
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) element.addEventListener(type, event => {
    if (event.pointerId === pointer) release();
  }, options);
  element.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey || !directions[event.key]) return;
    event.preventDefault(); event.stopPropagation(); keys.add(event.key); fromKeys();
  }, options);
  element.addEventListener('keyup', event => {
    if (!directions[event.key]) return;
    event.preventDefault(); event.stopPropagation(); keys.delete(event.key); fromKeys();
  }, options);
  element.addEventListener('click', event => { if (event.detail === 0) release(); }, options);
  element.addEventListener('blur', release, options);
  runtime.addEventListener('blur', release, options);
  runtime.document.addEventListener('visibilitychange', () => { if (runtime.document.hidden) release(); }, options);
  return Object.freeze({
    release,
    getState: () => ({ ...vector, active: Boolean(vector.x || vector.z) }),
    dispose() { if (disposed) return; release(); disposed = true; listeners.abort(); },
  });
}
