import { pointsFromDecks, patchesFromPoints, centroid, transformPoints, withPoint, octagonPoints, centerPans } from "./wobblini-geometry-model.js";

/** Gesture-only control of existing stereo deck gains/pans; no audio ownership. */
export function mountGeometricMixer({ root, dialog, launcher, getState, setMix, colors, icon, constrained = false }) {
  const controller = new AbortController();
  const on = (node, type, fn, options = {}) => node.addEventListener(type, fn, { ...options, signal: controller.signal });
  const button = (id, glyph, label) => `<button id="${id}" type="button" aria-label="${label}" title="${label}">${icon(glyph)}</button>`;
  root.innerHTML = `<div class="wb-section-heading"><h2>Stereo shape</h2>${button("geometryExpand", "expand", "Expand stereo shape mixer")}</div>
    <div id="geometryControls" class="wb-geometry-controls">
      <div class="wb-geometry-tools" role="group" aria-label="Shape gesture">
        ${button("geometryMove", "move", "Move shape or individual track")}${button("geometryRotate", "rotate", "Rotate shape")}${button("geometryStretch", "stretch", "Stretch shape")}
        ${button("geometryArrange", "polygon", "Arrange eight tracks in an octagon")}${button("geometryUndo", "undo", "Undo last mix gesture")}${button("geometryCenter", "center", "Center all track pans")}
      </div>
      <div id="geometryStage" class="wb-geometry-stage" aria-describedby="geometryHelp">
        <canvas id="geometryCanvas" role="img" aria-label="Eight stereo tracks. Left to right is pan; bottom to top is volume."></canvas>
        ${Array.from({ length: 8 }, (_, id) => `<button type="button" class="wb-geometry-point" data-track="${id}" id="geometryPoint${id}" aria-label="Select track ${id + 1}" style="--deck-color:${colors[id]}">${id + 1}</button>`).join("")}
      </div>
      <p id="geometryHelp" class="wb-geometry-help">Drag a point to mix one track. Drag the space around it to move all eight. Use the octagon to spread them out.</p>
      <div class="wb-geometry-selected"><label for="geometryTrack">Track</label><select id="geometryTrack" aria-label="Track to pan and mix">${Array.from({ length: 8 }, (_, id) => `<option value="${id}">${id + 1}</option>`).join("")}</select><output id="geometryReadout"></output></div>
      <label class="wb-control" for="geometryPan"><span>Pan <output id="geometryPanOut"></output></span><input id="geometryPan" type="range" min="-1" max="1" step="0.01" aria-label="Selected track pan" /></label>
      <label class="wb-control" for="geometryVolume"><span>Volume <output id="geometryVolumeOut"></output></span><input id="geometryVolume" type="range" min="0" max="1" step="0.01" aria-label="Selected track volume" /></label>
      <details class="wb-geometry-keyboard"><summary>Shape controls</summary>
        <label class="wb-control" for="geometryTurn"><span>Turn <output id="geometryTurnOut">0°</output></span><input id="geometryTurn" type="range" min="-180" max="180" step="1" value="0" aria-label="Rotate all tracks" /></label>
        <label class="wb-control" for="geometryWidth"><span>Width <output id="geometryWidthOut">1×</output></span><input id="geometryWidth" type="range" min="0.1" max="3" step="0.01" value="1" aria-label="Stereo shape width" /></label>
        <label class="wb-control" for="geometryHeight"><span>Height <output id="geometryHeightOut">1×</output></span><input id="geometryHeight" type="range" min="0.1" max="3" step="0.01" value="1" aria-label="Stereo shape level spread" /></label>
      </details>
    </div>`;
  const $ = id => root.ownerDocument.getElementById(id);
  const controls = $("geometryControls"), stage = $("geometryStage"), canvas = $("geometryCanvas"), context = canvas.getContext("2d");
  const home = document.createComment("geometric mixer controls"); controls.before(home);
  const pointButtons = [...stage.querySelectorAll("[data-track]")];
  let points = pointsFromDecks(getState().decks), selected = 0, mode = "move", undo = null;
  let gesture = null, rangeGesture = null, pending = null, timer = 0, drawing = 0, disposed = false, lastWrite = 0, focusReturn = null;
  let stateKey = "", silent = new Set();
  const copy = values => values.map(point => ({ ...point }));
  const key = values => values.map(point => `${point.id}:${point.x}:${point.y}`).join("|");
  stateKey = key(points);
  const bounds = () => { const r = stage.getBoundingClientRect(); return { r, w: r.width, h: r.height, x: 28, y: 28, width: Math.max(1, r.width - 56), height: Math.max(1, r.height - 56) }; };
  const toPixel = (point, b) => ({ x: b.x + (point.x + 1) * b.width / 2, y: b.y + (point.y + 1) * b.height / 2 });
  const eventPoint = (event, b) => ({ x: (event.clientX - b.r.left - b.x) / b.width * 2 - 1, y: (event.clientY - b.r.top - b.y) / b.height * 2 - 1 });
  const scheduleDraw = () => { if (!drawing && !disposed) drawing = requestAnimationFrame(draw); };
  function adoptExternal(next) {
    const nextKey = key(next); if (nextKey === stateKey) return false;
    // A second control can change the mix during a captured touch. Drop its
    // stale snapshot and any queued write before adopting the new engine mix.
    pending = null; clearTimeout(timer); timer = 0;
    const previous = gesture; gesture = null; rangeGesture = null;
    if (previous && stage.hasPointerCapture(previous.id)) stage.releasePointerCapture(previous.id);
    stage.classList.remove("is-dragging");
    points = next; stateKey = nextKey; undo = null;
    resetTransformFields(); renderControls(); scheduleDraw(); return true;
  }
  function flush() {
    if (timer) clearTimeout(timer); timer = 0;
    if (!disposed && adoptExternal(pointsFromDecks(getState().decks))) return;
    if (!pending || disposed) return;
    const next = pending; pending = null; lastWrite = performance.now();
    setMix(patchesFromPoints(next)); points = pointsFromDecks(getState().decks); stateKey = key(points);
  }
  function apply(next, previous, immediate = false) {
    if (adoptExternal(pointsFromDecks(getState().decks)) || key(next) === key(points)) return false;
    if (previous) undo = copy(previous);
    points = copy(next); pending = points;
    const wait = (constrained ? 50 : 33) - (performance.now() - lastWrite);
    if (immediate || wait <= 0) flush(); else if (!timer) timer = setTimeout(flush, wait);
    renderControls(); scheduleDraw();
    return true;
  }
  function endGesture() {
    const previous = gesture; gesture = null;
    if (previous && stage.hasPointerCapture(previous.id)) stage.releasePointerCapture(previous.id);
    flush(); stage.classList.remove("is-dragging");
  }
  function endRange() { const previous = rangeGesture; rangeGesture = null; flush(); if (previous && !["geometryPan", "geometryVolume"].includes(previous.id)) resetTransformFields(); }
  function release() { endGesture(); endRange(); }
  function resetTransformFields() {
    for (const [id, value] of [["geometryTurn", 0], ["geometryWidth", 1], ["geometryHeight", 1]]) $(id).value = value;
    $("geometryTurnOut").value = "0°"; $("geometryWidthOut").value = $("geometryHeightOut").value = "1×";
  }
  function setMode(next) {
    release(); mode = next;
    for (const name of ["Move", "Rotate", "Stretch"]) $("geometry" + name).setAttribute("aria-pressed", String(name.toLowerCase() === mode));
    $("geometryHelp").textContent = mode === "rotate" ? "Drag around the shape to turn all eight pan and volume positions."
      : mode === "stretch" ? "Drag sideways to change stereo spread; drag vertically to change the range of track volumes."
      : "Drag a point to mix one track. Drag the space around it to move all eight. Use the octagon to spread them out.";
    stage.dataset.mode = mode;
  }
  function renderControls() {
    const p = points.find(point => point.id === selected); if (!p) return;
    const gain = (1 - p.y) / 2, pan = Math.abs(p.x) < .005 ? "C" : `${p.x < 0 ? "L" : "R"} ${Math.round(Math.abs(p.x) * 100)}%`;
    controls.style.setProperty("--deck-color", colors[selected]);
    $("geometryTrack").value = selected;
    $("geometryPan").value = p.x; $("geometryVolume").value = gain;
    $("geometryPanOut").value = pan; $("geometryVolumeOut").value = Math.round(gain * 100) + "%";
    $("geometryReadout").value = `${pan} · ${Math.round(gain * 100)}%`;
    $("geometryUndo").disabled = !undo;
    for (const node of pointButtons) {
      const id = Number(node.dataset.track), point = points.find(p => p.id === id);
      node.setAttribute("aria-pressed", String(id === selected));
      node.setAttribute("aria-label", `Track ${id + 1}, pan ${Math.round(point.x * 100)}, volume ${Math.round((1 - point.y) * 50)} percent`);
    }
  }
  function draw() {
    drawing = 0; if (disposed || !stage.getClientRects().length) return;
    const b = bounds(), scale = Math.min(devicePixelRatio || 1, constrained ? 1 : 2);
    const w = Math.round(b.w * scale), h = Math.round(b.h * scale);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    context.setTransform(scale, 0, 0, scale, 0, 0); context.clearRect(0, 0, b.w, b.h);
    context.lineWidth = 1; context.strokeStyle = "#344653";
    for (const x of [-1, 0, 1]) { const p = toPixel({ x, y: 0 }, b); context.beginPath(); context.moveTo(p.x, b.y); context.lineTo(p.x, b.y + b.height); context.stroke(); }
    for (const y of [-1, 0, 1]) { const p = toPixel({ x: 0, y }, b); context.beginPath(); context.moveTo(b.x, p.y); context.lineTo(b.x + b.width, p.y); context.stroke(); }
    context.fillStyle = "#aebfcb"; context.font = "10px system-ui"; context.textAlign = "center";
    context.fillText("L", b.x, b.h - 7); context.fillText("R", b.x + b.width, b.h - 7); context.fillText("100%", b.w / 2, 14); context.fillText("0%", b.w / 2, b.h - 7);
    const pixels = points.map(point => ({ ...toPixel(point, b), id: point.id }));
    context.beginPath(); pixels.forEach((p, i) => i ? context.lineTo(p.x, p.y) : context.moveTo(p.x, p.y)); context.closePath();
    context.fillStyle = "#75dfc714"; context.fill();
    for (let i = 0; i < pixels.length; i++) {
      const p = pixels[i], q = pixels[(i + 1) % pixels.length]; context.strokeStyle = colors[p.id] + "99"; context.beginPath(); context.moveTo(p.x, p.y); context.lineTo(q.x, q.y); context.stroke();
    }
    // Separate coincident hit targets with visible leaders; audio coordinates stay exact.
    const occupied = [], separation = pointButtons[0].offsetWidth + 4;
    for (const p of pixels) {
      let label = { x: p.x, y: p.y };
      for (let trial = 0; trial < 64 && occupied.some(q => Math.hypot(label.x - q.x, label.y - q.y) < separation); trial++) {
        const angle = (p.id + trial * 3) * Math.PI / 4, radius = 24 + Math.floor(trial / 8) * 18;
        label = { x: Math.max(24, Math.min(b.w - 24, p.x + Math.cos(angle) * radius)), y: Math.max(24, Math.min(b.h - 24, p.y + Math.sin(angle) * radius)) };
      }
      occupied.push(label); const node = pointButtons[p.id];
      node.style.left = label.x + "px"; node.style.top = label.y + "px"; node.style.opacity = silent.has(p.id) ? ".45" : "1";
      context.strokeStyle = colors[p.id] + "99"; context.beginPath(); context.moveTo(p.x, p.y); context.lineTo(label.x, label.y); context.stroke();
      context.fillStyle = colors[p.id]; context.beginPath(); context.arc(p.x, p.y, 2.5, 0, Math.PI * 2); context.fill();
    }
  }
  on(stage, "pointerdown", event => {
    if (event.button !== 0 || gesture) return;
    endRange(); event.preventDefault(); const target = event.target.closest?.("[data-track]");
    if (target) { selected = Number(target.dataset.track); target.focus({ preventScroll: true }); }
    resetTransformFields(); const baseline = pointsFromDecks(getState().decks), b = bounds();
    gesture = { id: event.pointerId, baseline, start: eventPoint(event, b), pivot: centroid(baseline), b, track: target && mode === "move" ? selected : null, changed: false };
    stage.setPointerCapture(event.pointerId); stage.classList.add("is-dragging"); renderControls();
  });
  on(stage, "pointermove", event => {
    if (!gesture || event.pointerId !== gesture.id) return;
    const g = gesture, current = eventPoint(event, g.b), dx = current.x - g.start.x, dy = current.y - g.start.y;
    if (!g.changed && Math.hypot(dx, dy) < .008) return;
    let next;
    if (g.track !== null) { const p = g.baseline.find(p => p.id === g.track); next = withPoint(g.baseline, g.track, { x: p.x + dx, y: p.y + dy }); }
    else if (mode === "rotate") {
      const first = Math.atan2(g.start.y - g.pivot.y, g.start.x - g.pivot.x), last = Math.atan2(current.y - g.pivot.y, current.x - g.pivot.x);
      const rotation = Math.hypot(g.start.x - g.pivot.x, g.start.y - g.pivot.y) < .15 ? dx * Math.PI : last - first;
      next = transformPoints(g.baseline, { rotation, pivot: g.pivot });
    } else if (mode === "stretch") next = transformPoints(g.baseline, { scaleX: Math.exp(dx), scaleY: Math.exp(-dy), pivot: g.pivot });
    else next = transformPoints(g.baseline, { translateX: dx, translateY: dy });
    g.changed = apply(next, g.changed ? null : g.baseline) || g.changed;
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) on(stage, type, event => { if (event.pointerId === gesture?.id) endGesture(); });
  for (const node of pointButtons) {
    on(node, "click", () => { selected = Number(node.dataset.track); renderControls(); });
    on(node, "keydown", event => {
      const delta = (event.shiftKey ? .01 : .05), p = points.find(p => p.id === Number(node.dataset.track));
      const move = { ArrowLeft: [-delta, 0], ArrowRight: [delta, 0], ArrowUp: [0, -delta], ArrowDown: [0, delta] }[event.key];
      if (!move) return; event.preventDefault(); event.stopPropagation(); selected = p.id;
      apply(withPoint(points, p.id, { x: p.x + move[0], y: p.y + move[1] }), points, true); resetTransformFields();
    });
  }
  on($("geometryTrack"), "change", event => { release(); selected = Number(event.target.value); renderControls(); });
  for (const name of ["Move", "Rotate", "Stretch"]) on($("geometry" + name), "click", () => setMode(name.toLowerCase()));
  on($("geometryArrange"), "click", () => { release(); apply(octagonPoints(), points, true); resetTransformFields(); });
  on($("geometryCenter"), "click", () => { release(); apply(centerPans(points), points, true); resetTransformFields(); });
  on($("geometryUndo"), "click", () => { release(); if (undo) { const previous = undo; undo = null; apply(previous, null, true); resetTransformFields(); renderControls(); } });
  for (const id of ["geometryPan", "geometryVolume", "geometryTurn", "geometryWidth", "geometryHeight"]) {
    on($(id), "input", event => {
      const n = Number(event.target.value);
      if (!rangeGesture || rangeGesture.id !== id) { release(); rangeGesture = { id, baseline: copy(points), changed: false }; }
      const g = rangeGesture; event.target.value = n; let next;
      if (id === "geometryPan" || id === "geometryVolume") {
        const p = points.find(p => p.id === selected); next = withPoint(points, selected, id === "geometryPan" ? { x: n, y: p.y } : { x: p.x, y: 1 - 2 * n });
      } else {
        const changes = id === "geometryTurn" ? { rotation: n * Math.PI / 180 } : id === "geometryWidth" ? { scaleX: n } : { scaleY: n };
        next = transformPoints(g.baseline, changes); $(id + "Out").value = id === "geometryTurn" ? `${n}°` : `${n.toFixed(2)}×`;
      }
      g.changed = apply(next, g.changed ? null : g.baseline) || g.changed;
    });
    for (const type of ["change", "blur", "pointercancel"]) on($(id), type, endRange);
  }
  const expand = $("geometryExpand"), close = dialog.querySelector("[data-geometry-close]");
  expand.setAttribute("aria-haspopup", "dialog"); expand.setAttribute("aria-controls", dialog.id);
  function open(event) {
    release(); focusReturn = event?.currentTarget || expand; dialog.append(controls); dialog.showModal(); close.focus(); scheduleDraw();
  }
  on(expand, "click", open); if (launcher) on(launcher, "click", open);
  on(close, "click", () => dialog.close());
  on(dialog, "close", () => { release(); home.after(controls); focusReturn?.focus({ preventScroll: true }); scheduleDraw(); });
  on(dialog, "click", event => { const r = dialog.getBoundingClientRect(); if (event.target === dialog && (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom)) dialog.close(); });
  on(window, "blur", release); on(document, "visibilitychange", () => { if (document.hidden) release(); });
  const observer = new ResizeObserver(() => { release(); scheduleDraw(); }); observer.observe(stage);
  function update(decks) {
    if (disposed) return;
    adoptExternal(pointsFromDecks(decks));
    const nextSilent = new Set(decks.filter(d => d.mute || (decks.some(d => d.solo) && !d.solo)).map(d => d.id));
    if ([...nextSilent].join() !== [...silent].join()) { silent = nextSilent; scheduleDraw(); }
  }
  setMode("move"); update(getState().decks); renderControls(); scheduleDraw();
  return {
    update,
    release,
    close: () => { release(); if (dialog.open) dialog.close(); },
    destroy: () => { release(); disposed = true; controller.abort(); observer.disconnect(); cancelAnimationFrame(drawing); clearTimeout(timer); },
  };
}
