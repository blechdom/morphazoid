const MIN_WIDTH = 1e-10;
const MAX_WIDTH = 5;
const CENTER_LIMIT = 3;
const SETTLE_MS = 150;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;

function boundedView(view = {}, fallback = {}) {
  return {
    x: clamp(finite(view.x, fallback.x ?? -.5), -CENTER_LIMIT, CENTER_LIMIT),
    y: clamp(finite(view.y, fallback.y ?? 0), -CENTER_LIMIT, CENTER_LIMIT),
    width: clamp(finite(view.width, fallback.width ?? 3.5), MIN_WIDTH, MAX_WIDTH),
    aspect: Math.max(.01, finite(view.aspect, fallback.aspect ?? 1)),
  };
}

/** Canvas-only exploration. This controller never starts or changes audio. */
export class ContourNavigation {
  constructor(canvas, {
    view, homeView = view, onViewChange = () => {}, onSelect = () => {},
    isActive = () => true, active = true,
  } = {}) {
    this.canvas = canvas;
    this.view = boundedView(view);
    this.homeView = boundedView(homeView, this.view);
    this.onViewChange = onViewChange;
    this.onSelect = onSelect;
    this.isActive = isActive;
    this.active = active;
    this.disposed = false;
    this.pointers = new Map();
    this.gesture = null;
    this.moved = false;
    this.pendingChange = false;
    this.settleTimer = null;
    this.originalTouchAction = canvas.style.touchAction;
    this.originalTabIndex = canvas.getAttribute('tabindex');
    canvas.style.touchAction = 'none';
    if (this.originalTabIndex === null) canvas.tabIndex = 0;
    this.listeners = [
      ['pointerdown', event => this.pointerDown(event)],
      ['pointermove', event => this.pointerMove(event)],
      ['pointerup', event => this.pointerEnd(event, false)],
      ['pointercancel', event => this.pointerEnd(event, true)],
      ['lostpointercapture', event => this.pointerEnd(event, true)],
      ['wheel', event => this.wheel(event), { passive: false }],
      ['keydown', event => this.keyDown(event)],
    ];
    for (const [name, listener, options] of this.listeners) canvas.addEventListener(name, listener, options);
    const environment = canvas.ownerDocument?.defaultView || globalThis;
    if (environment.ResizeObserver) {
      this.resizeObserver = new environment.ResizeObserver(() => this.resize());
      this.resizeObserver.observe(canvas);
    } else {
      this.onResize = () => this.resize();
      environment.addEventListener?.('resize', this.onResize);
      this.environment = environment;
    }
    this.syncAspect();
  }

  enabled() { return !this.disposed && this.active && this.isActive(); }

  metrics() {
    const rect = this.canvas.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
  }

  syncAspect() {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) this.view.aspect = rect.width / rect.height;
  }

  normalize(point, metrics = this.metrics()) {
    return { x: (point.x - metrics.left) / metrics.width, y: (point.y - metrics.top) / metrics.height };
  }

  worldAt(point, view = this.view) {
    return { x: view.x + (point.x - .5) * view.width, y: view.y + (.5 - point.y) * view.width / view.aspect };
  }

  emit(settled) {
    this.pendingChange = !settled;
    this.onViewChange(this.getView(), { settled });
  }

  apply(next, settled = false) {
    const previous = this.view;
    this.view = boundedView(next, previous);
    if (Object.keys(this.view).some(key => this.view[key] !== previous[key])) this.emit(settled);
  }

  clearTimer() {
    if (this.settleTimer !== null) clearTimeout(this.settleTimer);
    this.settleTimer = null;
  }

  finish() {
    this.clearTimer();
    if (this.pendingChange && this.enabled()) this.emit(true);
  }

  settleSoon() {
    this.clearTimer();
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      if (!this.pointers.size) this.finish();
    }, SETTLE_MS);
  }

  rebase() {
    const points = [...this.pointers.values()];
    if (!points.length) { this.gesture = null; return; }
    const midpoint = points.length === 1 ? points[0] : {
      x: (points[0].x + points[1].x) / 2,
      y: (points[0].y + points[1].y) / 2,
    };
    this.gesture = {
      view: this.getView(), midpoint: { ...midpoint },
      distance: points.length < 2 ? 0 : Math.max(1, Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y)),
      anchor: this.worldAt(this.normalize(midpoint)),
    };
  }

  clearGesture() {
    this.clearTimer();
    const ids = [...this.pointers.keys()];
    this.pointers.clear();
    this.gesture = null;
    this.moved = false;
    this.pendingChange = false;
    for (const id of ids) {
      try { if (this.canvas.hasPointerCapture(id)) this.canvas.releasePointerCapture(id); } catch { /* Capture may already be gone. */ }
    }
  }

  pointerDown(event) {
    if (!this.enabled() || event.button !== 0 || this.pointers.size >= 2) return;
    event.preventDefault();
    this.clearTimer();
    if (!this.pointers.size) this.moved = false;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size > 1) this.moved = true;
    try { this.canvas.setPointerCapture(event.pointerId); } catch { /* Synthetic or already cancelled pointer. */ }
    this.canvas.focus({ preventScroll: true });
    this.rebase();
  }

  pointerMove(event) {
    if (!this.enabled()) { this.clearGesture(); return; }
    if (!this.pointers.has(event.pointerId) || !this.gesture) return;
    event.preventDefault();
    const previous = this.pointers.get(event.pointerId);
    if (previous.x === event.clientX && previous.y === event.clientY) return;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...this.pointers.values()], base = this.gesture;
    const midpoint = points.length === 1 ? points[0] : {
      x: (points[0].x + points[1].x) / 2,
      y: (points[0].y + points[1].y) / 2,
    };
    if (!this.moved && Math.hypot(midpoint.x - base.midpoint.x, midpoint.y - base.midpoint.y) < 3) return;
    this.moved = true;
    const distance = points.length === 1 ? 0 : Math.max(1, Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y));
    const width = clamp(base.view.width * (distance ? base.distance / distance : 1), MIN_WIDTH, MAX_WIDTH);
    const normalized = this.normalize(midpoint);
    this.apply({
      ...base.view, width,
      x: base.anchor.x - (normalized.x - .5) * width,
      y: base.anchor.y - (.5 - normalized.y) * width / base.view.aspect,
    });
  }

  pointerEnd(event, cancelled) {
    if (!this.pointers.has(event.pointerId)) return;
    if (!this.enabled()) { this.clearGesture(); return; }
    if (!cancelled) this.pointerMove(event);
    const point = this.pointers.get(event.pointerId);
    const select = !cancelled && !this.moved && this.pointers.size === 1;
    this.pointers.delete(event.pointerId);
    try { if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId); } catch { /* Already released. */ }
    if (this.pointers.size) {
      this.moved = true;
      this.rebase();
    } else {
      this.gesture = null;
      this.finish();
      if (select) this.onSelect(this.worldAt(this.normalize(point)));
    }
  }

  wheel(event) {
    if (!this.enabled()) return;
    event.preventDefault();
    const metrics = this.metrics();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? metrics.height : 1;
    const factor = Math.exp(clamp(event.deltaY * unit, -600, 600) * .002);
    this.zoomAt(factor, this.normalize({ x: event.clientX, y: event.clientY }, metrics), false);
    if (this.pointers.size) this.rebase();
    this.settleSoon();
  }

  zoomAt(factor, point, settled) {
    if (!Number.isFinite(factor) || factor <= 0) return;
    const anchor = this.worldAt(point), width = clamp(this.view.width * factor, MIN_WIDTH, MAX_WIDTH);
    this.apply({
      ...this.view, width,
      x: anchor.x - (point.x - .5) * width,
      y: anchor.y - (.5 - point.y) * width / this.view.aspect,
    }, settled);
  }

  keyDown(event) {
    if (!this.enabled() || event.altKey || event.ctrlKey || event.metaKey) return;
    const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
    if (directions[event.key]) {
      event.preventDefault();
      const [dx, dy] = directions[event.key], step = event.shiftKey ? .35 : .12;
      this.apply({ ...this.view, x: this.view.x + dx * this.view.width * step, y: this.view.y + dy * this.view.width / this.view.aspect * step });
      this.rebase();
      this.settleSoon();
    } else if (['+', '=', '-', '_'].includes(event.key)) {
      event.preventDefault();
      this.zoomAt(['-', '_'].includes(event.key) ? 1.4 : 1 / 1.4, { x: .5, y: .5 }, false);
      this.rebase();
      this.settleSoon();
    } else if (event.key === 'Home') {
      event.preventDefault();
      this.reset();
    }
  }

  resize() {
    if (this.disposed) return;
    const previous = this.view.aspect;
    this.syncAspect();
    if (this.view.aspect === previous) return;
    this.rebase();
    if (this.enabled()) this.emit(!this.pointers.size);
  }

  getView() { return { ...this.view }; }

  setView(view, { notify = true } = {}) {
    if (this.disposed) return this.getView();
    this.clearGesture();
    this.view = boundedView(view, this.view);
    this.syncAspect();
    if (notify) this.emit(true);
    return this.getView();
  }

  setActive(active) {
    if (this.disposed) return;
    this.active = Boolean(active);
    if (!this.active) this.clearGesture();
    else this.resize();
  }

  /** factor < 1 zooms in; anchor uses normalized canvas coordinates, Y down. */
  zoomBy(factor, anchor = { x: .5, y: .5 }) {
    if (!this.enabled()) return this.getView();
    this.clearGesture();
    this.zoomAt(factor, { x: clamp(finite(anchor.x, .5), 0, 1), y: clamp(finite(anchor.y, .5), 0, 1) }, true);
    return this.getView();
  }

  reset() {
    if (!this.enabled()) return this.getView();
    return this.setView(this.homeView);
  }

  diagnosticSnapshot() {
    return { view: this.getView(), active: this.enabled(), pointers: this.pointers.size, pending: this.pendingChange, disposed: this.disposed };
  }

  destroy() {
    if (this.disposed) return;
    this.clearGesture();
    this.disposed = true;
    this.resizeObserver?.disconnect();
    if (this.onResize) this.environment.removeEventListener('resize', this.onResize);
    for (const [name, listener, options] of this.listeners) this.canvas.removeEventListener(name, listener, options);
    this.canvas.style.touchAction = this.originalTouchAction;
    if (this.originalTabIndex === null) this.canvas.removeAttribute('tabindex');
    else this.canvas.setAttribute('tabindex', this.originalTabIndex);
  }
}
