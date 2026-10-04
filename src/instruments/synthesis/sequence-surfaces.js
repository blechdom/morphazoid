import { getSequenceStudy } from './sequence-catalog.js';
import { createSequenceParameterValues, getSequenceParameterBounds, MAX_GESTURE_POINTS } from './sequence-parameters.js';
import { euclideanPattern } from './sequence-compiler.js';

// Mechanism-led adaptations, not facsimiles or historical factory data:
// GROOVE: https://doi.org/10.1145/362814.362817 (editable functions of time).
// Voltage stages: https://buchla.com/product/250e/ (stored stage values).
// Euclidean distribution: https://archive.bridgesmathart.org/2005/bridges2005-47.html
// A Music Mouse pitch field and a Wavestation four-source vector mixer have
// different destinations; neither is claimed by this time/pitch/pressure editor.
const TAU = Math.PI * 2;
const clone = value => JSON.parse(JSON.stringify(value));
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : min));
const studyFor = value => getSequenceStudy(typeof value === 'string' ? value : value?.id);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const modulo = (value, size) => (value % size + size) % size;

export function sequenceSurfaceKind(studyOrId) {
  const archetype = studyFor(studyOrId)?.archetype;
  return ['gesture', 'euclidean', 'cv-rows'].includes(archetype) ? archetype : null;
}

export function sequenceSurfaceData(studyOrId, input) {
  const study = studyFor(studyOrId);
  if (!study || !sequenceSurfaceKind(study)) return null;
  const values = createSequenceParameterValues(study, input);
  if (study.archetype === 'gesture') return clone(values.gesturePoints || study.config.points);
  if (study.archetype === 'cv-rows') return {
    pitches: [...(values.stagePitches || study.config.pitch)],
    gates: [...(values.stageGates || study.config.gates || study.config.pitch.map(() => 1))],
    address: [...(study.config.address || study.config.pitch.map((_, index) => index))],
  };
  const pattern = euclideanPattern(values.pulses, values.euclideanSteps);
  return pattern.map((_, index) => pattern[modulo(index - values.rotation, pattern.length)]);
}

/** Edit a captured control point without allowing crossing or moving loop ends. */
export function editGesturePoint(studyOrId, input, index, patch) {
  const study = studyFor(studyOrId), values = createSequenceParameterValues(study, input);
  if (study.archetype !== 'gesture') return values;
  const points = sequenceSurfaceData(study, values);
  if (!Number.isInteger(index) || !points[index]) return values;
  const point = points[index];
  if (patch.note != null) point.note = clamp(patch.note, -96, 96);
  if (patch.pressure != null) point.pressure = clamp(patch.pressure, 0, 1);
  if (patch.time != null && index > 0 && index < points.length - 1) {
    const gap = Math.min(.001, (points[index + 1].time - points[index - 1].time) / 3);
    point.time = clamp(patch.time, points[index - 1].time + gap, points[index + 1].time - gap);
  }
  return createSequenceParameterValues(study, { ...values, gesturePoints: points });
}

/** Fast stage painting fills skipped cells with a continuous line in one edit. */
export function paintVoltageStages(studyOrId, input, from, to, startValue, endValue, gate = false) {
  const study = studyFor(studyOrId), values = createSequenceParameterValues(study, input);
  if (study.archetype !== 'cv-rows') return values;
  const data = sequenceSurfaceData(study, values);
  const lane = gate ? data.gates : data.pitches;
  const first = Math.round(clamp(from, 0, lane.length - 1));
  const last = Math.round(clamp(to, 0, lane.length - 1));
  for (let index = Math.min(first, last); index <= Math.max(first, last); index++) {
    const mix = first === last ? 1 : (index - first) / (last - first);
    lane[index] = gate ? (endValue ? 1 : 0)
      : clamp(Number(startValue) + (Number(endValue) - Number(startValue)) * mix, -96, 96);
  }
  return createSequenceParameterValues(study, { ...values, [gate ? 'stageGates' : 'stagePitches']: lane });
}

export function editEuclideanSurface(studyOrId, input, patch) {
  const study = studyFor(studyOrId), values = createSequenceParameterValues(study, { ...input, ...patch });
  if (study.archetype !== 'euclidean' || patch.rotation == null) return values;
  const bounds = getSequenceParameterBounds(study, 'rotation', values);
  const rotation = bounds.min + modulo(Math.round(Number(patch.rotation) || 0) - bounds.min, bounds.max - bounds.min + 1);
  return createSequenceParameterValues(study, { ...values, rotation });
}

/**
 * Owns only musical edit data. Never arms Audio, changes transport, or schedules.
 * onChange receives the complete sanitized parameter snapshot plus transaction
 * metadata: { phase: 'preview' | 'commit' | 'cancel', before }.
 * Keep the instance mounted while dragging and feed external changes to setValue.
 */
export function createSequenceSurface(host, studyOrId, input, onChange = () => {}) {
  const study = studyFor(studyOrId), kind = sequenceSurfaceKind(study);
  if (!kind || !host?.ownerDocument) return null;
  const doc = host.ownerDocument, win = doc.defaultView || globalThis;
  const listeners = [];
  let values = createSequenceParameterValues(study, input), undo = null, drag = null, disposed = false;
  let selected = 0, playCursor = null;
  const root = doc.createElement('section');
  root.className = `synthesis-sequence-surface synthesis-sequence-surface--${kind}`;
  root.dataset.sequenceSurface = kind;
  const title = doc.createElement('h3');
  title.textContent = kind === 'gesture' ? 'Gesture score' : kind === 'euclidean' ? 'Pulse circle' : 'Voltage stages';
  const readout = doc.createElement('output'); readout.className = 'synthesis-sequence-surface-readout';
  const controls = doc.createElement('div'); controls.className = 'synthesis-sequence-surface-actions';
  const hint = doc.createElement('p'); hint.className = 'synthesis-sequence-surface-hint';
  root.append(title, controls);
  host.append(root);
  const listen = (element, type, handler) => {
    element.addEventListener(type, handler);
    listeners.push(() => element.removeEventListener(type, handler));
  };
  const button = (label, handler) => {
    const element = doc.createElement('button'); element.type = 'button'; element.textContent = label;
    listen(element, 'click', handler); return element;
  };
  const undoButton = button('Undo', () => {
    if (!undo || drag) return;
    const previous = values, target = undo; undo = null;
    values = target; render(); onChange(values, { phase: 'commit', before: previous });
  });
  controls.append(undoButton, button(kind === 'gesture' ? 'Reset drawing' : 'Reset pattern', () => {
    if (drag) return;
    const next = { ...values };
    for (const id of ['gesturePoints', 'stagePitches', 'stageGates']) delete next[id];
    if (kind === 'euclidean') {
      const defaults = createSequenceParameterValues(study);
      for (const id of ['pulses', 'euclideanSteps', 'rotation']) next[id] = defaults[id];
    }
    commit(next);
  }));

  function update(next, phase = 'preview', before = values) {
    values = createSequenceParameterValues(study, next);
    render(); onChange(values, { phase, before });
  }
  function commit(next) {
    const before = values, clean = createSequenceParameterValues(study, next);
    if (same(clean, before)) return;
    undo = before; update(clean, 'commit', before);
  }
  function endDrag(event, cancel = false) {
    if (!drag || (event?.pointerId != null && event.pointerId !== drag.pointerId)) return;
    const transaction = drag; drag = null;
    if (transaction.element.hasPointerCapture?.(transaction.pointerId)) transaction.element.releasePointerCapture(transaction.pointerId);
    if (cancel) update(transaction.before, 'cancel', transaction.before);
    else if (!same(values, transaction.before)) {
      undo = transaction.before; render(); onChange(values, { phase: 'commit', before: transaction.before });
    }
  }
  function capture(element, event, extra = {}) {
    if (event.button !== 0 || drag) return false;
    event.preventDefault(); element.focus({ preventScroll: true });
    drag = { element, pointerId: event.pointerId, before: values, ...extra };
    element.setPointerCapture?.(event.pointerId); return true;
  }
  function bindEnd(element) {
    listen(element, 'pointerup', event => endDrag(event));
    listen(element, 'pointercancel', event => endDrag(event, true));
    listen(element, 'lostpointercapture', event => endDrag(event, true));
  }
  function makeCanvas(label, className = '') {
    const canvas = doc.createElement('canvas');
    canvas.className = `synthesis-sequence-surface-canvas ${className}`;
    canvas.tabIndex = 0; canvas.setAttribute('role', 'slider'); canvas.setAttribute('aria-label', label);
    canvas.setAttribute('aria-orientation', 'vertical');
    root.append(canvas); bindEnd(canvas); return canvas;
  }
  function geometry(canvas) {
    const rect = canvas.getBoundingClientRect();
    return { rect, width: Math.max(1, rect.width), height: Math.max(1, rect.height), pad: 16 };
  }
  function context(canvas) {
    const size = geometry(canvas), dpr = Math.min(2, Number(win.devicePixelRatio) || 1);
    const width = Math.max(1, Math.round(size.width * dpr)), height = Math.max(1, Math.round(size.height * dpr));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, size.width, size.height);
    return { ...size, ctx };
  }
  const fractionAt = (canvas, event) => {
    const g = geometry(canvas);
    return { x: clamp((event.clientX - g.rect.left - g.pad) / Math.max(1, g.width - g.pad * 2), 0, 1),
      y: clamp(1 - (event.clientY - g.rect.top - g.pad) / Math.max(1, g.height - g.pad * 2), 0, 1) };
  };
  const pitchBounds = pitches => [Math.max(-96, Math.min(-24, Math.floor((Math.min(...pitches) - 3) / 12) * 12)),
    Math.min(96, Math.max(24, Math.ceil((Math.max(...pitches) + 3) / 12) * 12))];
  function drawLane(canvas, points, bounds, field, steps = false) {
    const g = context(canvas); if (!g) return;
    const { ctx, width, height, pad } = g;
    const x = value => pad + value * (width - pad * 2);
    const y = value => height - pad - (value - bounds[0]) / (bounds[1] - bounds[0]) * (height - pad * 2);
    ctx.strokeStyle = '#ffffff16'; ctx.lineWidth = 1; ctx.beginPath();
    for (let index = 0; index <= 4; index++) {
      const px = x(index / 4); ctx.moveTo(px, pad); ctx.lineTo(px, height - pad);
      const py = pad + index / 4 * (height - pad * 2); ctx.moveTo(pad, py); ctx.lineTo(width - pad, py);
    }
    ctx.stroke();
    ctx.strokeStyle = '#c294ff'; ctx.lineWidth = 2; ctx.beginPath();
    points.forEach((point, index) => {
      const px = x(point.time), py = y(point[field]);
      if (!index) ctx.moveTo(px, py);
      else if (steps) { ctx.lineTo(px, y(points[index - 1][field])); ctx.lineTo(px, py); }
      else ctx.lineTo(px, py);
    }); ctx.stroke();
    points.forEach((point, index) => {
      ctx.fillStyle = index === selected ? '#ffffff' : '#c294ff';
      ctx.beginPath(); ctx.arc(x(point.time), y(point[field]), index === selected ? 5 : 3.5, 0, TAU); ctx.fill();
    });
    ctx.fillStyle = '#bbc5d6'; ctx.font = '11px system-ui'; ctx.textAlign = 'left';
    ctx.fillText(field === 'pressure' ? 'Pressure' : 'Pitch', pad, 12);
    ctx.textAlign = 'right'; ctx.fillText(steps ? 'Stage →' : 'Time →', width - pad, height - 2);
    canvas.setAttribute('aria-valuemin', String(bounds[0])); canvas.setAttribute('aria-valuemax', String(bounds[1]));
    canvas.setAttribute('aria-valuenow', String(points[selected]?.[field] ?? 0));
    const point = points[selected];
    canvas.setAttribute('aria-valuetext', point ? `Point ${selected + 1} of ${points.length}, ${field} ${Number(point[field].toFixed(3))}, time ${Math.round(point.time * 100)} percent` : '');
  }

  let renderSurface = () => {};
  if (kind === 'gesture') {
    const pitchCanvas = makeCanvas('Gesture pitch points. Left and right select a point; up and down change pitch; Alt with left and right changes time.');
    const pressureCanvas = makeCanvas('Gesture pressure points. Left and right select a point; up and down change pressure.', 'is-pressure');
    hint.textContent = 'Edit source points before scaling, reversal and tuning. The lower curve sets velocity and optional attack probability. Click the pitch curve to add a point. Arrows select/edit; Alt + ← → moves time.';
    controls.append(button('Remove point', () => {
      const points = sequenceSurfaceData(study, values);
      if (selected <= 0 || selected >= points.length - 1 || drag) return;
      points.splice(selected, 1); selected--; commit({ ...values, gesturePoints: points });
    }));
    for (const [canvas, field] of [[pitchCanvas, 'note'], [pressureCanvas, 'pressure']]) {
      const move = event => {
        if (drag?.element !== canvas || drag.pointerId !== event.pointerId) return;
        const f = fractionAt(canvas, event);
        update(editGesturePoint(study, values, selected, field === 'pressure' ? { pressure: f.y }
          : { time: f.x, note: drag.bounds[0] + f.y * (drag.bounds[1] - drag.bounds[0]) }), 'preview', drag.before);
      };
      listen(canvas, 'pointerdown', event => {
        const points = sequenceSurfaceData(study, values), f = fractionAt(canvas, event);
        const bounds = field === 'pressure' ? [0, 1] : pitchBounds(points.map(point => point.note));
        if (!capture(canvas, event, { bounds })) return;
        selected = points.reduce((best, point, index) => Math.abs(point.time - f.x) < Math.abs(points[best].time - f.x) ? index : best, 0);
        const width = Math.max(1, geometry(canvas).width - 32);
        if (field === 'note' && Math.abs(points[selected].time - f.x) * width > 18 && points.length < MAX_GESTURE_POINTS) {
          const point = { time: f.x, note: bounds[0] + f.y * (bounds[1] - bounds[0]), pressure: points[selected].pressure };
          points.push(point); points.sort((a, b) => a.time - b.time); selected = points.indexOf(point);
          update({ ...values, gesturePoints: points }, 'preview', drag.before);
        }
        move(event);
      });
      listen(canvas, 'pointermove', move);
      listen(canvas, 'keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Escape'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        if (event.key === 'Escape') { endDrag(null, true); return; }
        const points = sequenceSurfaceData(study, values);
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          const direction = event.key === 'ArrowRight' ? 1 : -1;
          if (event.altKey && field === 'note') commit(editGesturePoint(study, values, selected, { time: points[selected].time + direction * (event.shiftKey ? .001 : .01) }));
          else { selected = modulo(selected + direction, points.length); render(); }
        } else {
          const direction = event.key === 'ArrowUp' ? 1 : -1;
          const delta = field === 'pressure' ? .05 : .5;
          commit(editGesturePoint(study, values, selected, { [field]: points[selected][field] + direction * delta * (event.shiftKey ? .1 : 1) }));
        }
      });
    }
    renderSurface = () => {
      const points = sequenceSurfaceData(study, values); selected = Math.min(selected, points.length - 1);
      drawLane(pitchCanvas, points, drag?.element === pitchCanvas ? drag.bounds : pitchBounds(points.map(point => point.note)), 'note');
      drawLane(pressureCanvas, points, [0, 1], 'pressure');
      readout.textContent = `Point ${selected + 1}/${points.length} · ${Math.round(points[selected].time * 100)}% time · ${points[selected].note.toFixed(1)} pitch · ${Math.round(points[selected].pressure * 100)}% pressure`;
    };
  } else if (kind === 'euclidean') {
    const ring = makeCanvas('Euclidean pulse circle. Drag to rotate; left and right rotate; up and down change pulse count.', 'is-ring');
    ring.setAttribute('aria-orientation', 'horizontal');
    const pulseReadout = doc.createElement('output'); pulseReadout.className = 'synthesis-sequence-pulse-count';
    controls.append(button('− pulse', () => commit(editEuclideanSurface(study, values, { pulses: values.pulses - 1 }))), pulseReadout,
      button('+ pulse', () => commit(editEuclideanSurface(study, values, { pulses: values.pulses + 1 }))));
    const slotsLabel = doc.createElement('label'); slotsLabel.textContent = 'Slots ';
    const slots = doc.createElement('input'); slots.type = 'number'; slots.step = '1'; slots.min = '1'; slots.setAttribute('aria-label', 'Euclidean slots');
    slotsLabel.append(slots); controls.append(slotsLabel);
    listen(slots, 'change', () => commit(editEuclideanSurface(study, values, { euclideanSteps: slots.value })));
    hint.textContent = 'Drag around the circle to rotate the rhythm. ← → rotates; ↑ ↓ changes pulse count.';
    const angle = event => {
      const g = geometry(ring); return Math.atan2(event.clientY - g.rect.top - g.height / 2, event.clientX - g.rect.left - g.width / 2);
    };
    listen(ring, 'pointerdown', event => capture(ring, event, { angle: angle(event), rotation: values.rotation }));
    listen(ring, 'pointermove', event => {
      if (drag?.element !== ring || drag.pointerId !== event.pointerId) return;
      const delta = modulo(angle(event) - drag.angle + Math.PI, TAU) - Math.PI;
      update(editEuclideanSurface(study, values, { rotation: drag.rotation + Math.round(delta / TAU * values.euclideanSteps) }), 'preview', drag.before);
    });
    listen(ring, 'keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'Escape'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      if (event.key === 'Escape') { endDrag(null, true); return; }
      const patch = event.key === 'Home' ? { rotation: 0 }
        : ['ArrowLeft', 'ArrowRight'].includes(event.key) ? { rotation: values.rotation + (event.key === 'ArrowRight' ? 1 : -1) }
          : { pulses: values.pulses + (event.key === 'ArrowUp' ? 1 : -1) };
      commit(editEuclideanSurface(study, values, patch));
    });
    renderSurface = () => {
      const pattern = sequenceSurfaceData(study, values), bounds = getSequenceParameterBounds(study, 'rotation', values);
      slots.value = values.euclideanSteps; slots.max = getSequenceParameterBounds(study, 'euclideanSteps', values).max;
      pulseReadout.textContent = `${values.pulses} / ${values.euclideanSteps}`;
      ring.setAttribute('aria-valuemin', String(bounds.min)); ring.setAttribute('aria-valuemax', String(bounds.max));
      ring.setAttribute('aria-valuenow', String(values.rotation)); ring.setAttribute('aria-valuetext', `${values.pulses} pulses in ${values.euclideanSteps} slots, rotation ${values.rotation}`);
      const g = context(ring); if (!g) return;
      const { ctx, width, height } = g, radius = Math.max(1, Math.min(width, height) / 2 - 22), cx = width / 2, cy = height / 2;
      ctx.strokeStyle = '#ffffff30'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, radius, 0, TAU); ctx.stroke();
      pattern.forEach((active, index) => {
        const a = index / pattern.length * TAU - Math.PI / 2, px = cx + radius * Math.cos(a), py = cy + radius * Math.sin(a);
        ctx.fillStyle = playCursor != null && modulo(playCursor, pattern.length) === index ? '#fff' : active ? '#c294ff' : '#344153';
        ctx.beginPath(); ctx.arc(px, py, Math.min(active ? 7 : 4, Math.PI * radius / pattern.length * .7), 0, TAU); ctx.fill();
      });
      ctx.fillStyle = '#edf2ff'; ctx.font = '18px system-ui'; ctx.textAlign = 'center'; ctx.fillText(`${values.pulses} : ${values.euclideanSteps}`, cx, cy + 6);
      readout.textContent = `${values.pulses} attacks · ${values.euclideanSteps - values.pulses} rests · phase ${values.rotation}`;
    };
  } else {
    const canvas = makeCanvas('Voltage stage pitch row. Drag across stages to paint; left and right select, up and down change voltage pitch.');
    const gates = doc.createElement('div'); gates.className = 'synthesis-sequence-gate-row'; root.append(gates); bindEnd(gates);
    const gateButtons = [];
    sequenceSurfaceData(study, values).gates.forEach((_, index) => {
      const element = button(String(index + 1), event => {
        if (event.detail === 0) {
          const data = sequenceSurfaceData(study, values);
          commit(paintVoltageStages(study, values, index, index, 0, !data.gates[index], true));
        }
      });
      element.setAttribute('aria-label', `Gate clock slot ${index + 1}`); gates.append(element); gateButtons.push(element);
    });
    const gateSlot = event => {
      const rect = gates.getBoundingClientRect(); return Math.floor(clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, .999999) * gateButtons.length);
    };
    const paintGate = event => {
      if (drag?.element !== gates || drag.pointerId !== event.pointerId) return;
      const index = gateSlot(event);
      update(paintVoltageStages(study, values, drag.last, index, drag.gateValue, drag.gateValue, true), 'preview', drag.before);
      drag.last = index;
    };
    listen(gates, 'pointerdown', event => {
      const index = gateSlot(event), data = sequenceSurfaceData(study, values);
      if (capture(gates, event, { last: index, gateValue: !data.gates[index] })) paintGate(event);
    });
    listen(gates, 'pointermove', paintGate);
    const paint = event => {
      if (drag?.element !== canvas || drag.pointerId !== event.pointerId) return;
      const f = fractionAt(canvas, event), pitches = sequenceSurfaceData(study, values).pitches;
      const index = Math.round(f.x * (pitches.length - 1)), note = drag.bounds[0] + f.y * (drag.bounds[1] - drag.bounds[0]);
      update(paintVoltageStages(study, values, drag.last, index, drag.note, note), 'preview', drag.before);
      drag.last = index; drag.note = note; selected = index; render();
    };
    listen(canvas, 'pointerdown', event => {
      const f = fractionAt(canvas, event), pitches = sequenceSurfaceData(study, values).pitches, bounds = pitchBounds(pitches);
      const index = Math.round(f.x * (pitches.length - 1)), note = bounds[0] + f.y * (bounds[1] - bounds[0]);
      if (capture(canvas, event, { last: index, note, bounds })) paint(event);
    });
    listen(canvas, 'pointermove', paint);
    listen(canvas, 'keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Escape'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      if (event.key === 'Escape') { endDrag(null, true); return; }
      const pitches = sequenceSurfaceData(study, values).pitches;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { selected = modulo(selected + (event.key === 'ArrowRight' ? 1 : -1), pitches.length); render(); }
      else {
        const note = pitches[selected] + (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? .05 : .5);
        commit(paintVoltageStages(study, values, selected, selected, note, note));
      }
    });
    hint.textContent = 'Paint source stages and gate slots before voltage scaling, gate rotation and tuning. Arrows select/edit pitch. Addressing may visit stages in a different order.';
    renderSurface = () => {
      const data = sequenceSurfaceData(study, values); selected = Math.min(selected, data.pitches.length - 1);
      drawLane(canvas, data.pitches.map((note, index) => ({ note, time: index / Math.max(1, data.pitches.length - 1) })), drag?.element === canvas ? drag.bounds : pitchBounds(data.pitches), 'note', true);
      gateButtons.forEach((element, index) => element.setAttribute('aria-pressed', String(Boolean(data.gates[index]))));
      readout.textContent = `Stage ${selected + 1}/${data.pitches.length} · pitch ${data.pitches[selected].toFixed(1)} · ${data.gates.filter(Boolean).length}/${data.gates.length} gate slots open`;
    };
  }
  root.append(readout, hint);
  function render() {
    if (disposed) return;
    undoButton.disabled = !undo || Boolean(drag); renderSurface();
  }
  const observer = win.ResizeObserver ? new win.ResizeObserver(render) : null;
  observer?.observe(root);
  render();
  return {
    element: root,
    kind,
    ownedParameterIds: Object.freeze(kind === 'euclidean' ? ['pulses', 'euclideanSteps', 'rotation']
      : kind === 'gesture' ? ['gesturePoints'] : ['stagePitches', 'stageGates']),
    setValue(next, cycle) {
      if (disposed) return;
      const clean = createSequenceParameterValues(study, next);
      if (!same(clean, values)) {
        undo = null;
        if (drag) {
          const active = drag; drag = null;
          if (active.element.hasPointerCapture?.(active.pointerId)) active.element.releasePointerCapture(active.pointerId);
        }
      }
      values = clean;
      if (Number.isInteger(cycle?.cursor)) playCursor = cycle.cursor;
      render();
    },
    setCursor(cursor) { playCursor = Number.isInteger(cursor) ? cursor : null; render(); },
    destroy() {
      if (disposed) return;
      disposed = true; observer?.disconnect();
      const active = drag; drag = null;
      if (active?.element.hasPointerCapture?.(active.pointerId)) active.element.releasePointerCapture(active.pointerId);
      listeners.splice(0).forEach(remove => remove()); root.remove();
    },
  };
}
