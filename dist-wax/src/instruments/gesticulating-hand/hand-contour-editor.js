import { HAND_CONTOUR_POINTS, normalizeHandContour } from './hand-contour.js';
import { evaluateHandPose, handAnimationLanes, handAnimationBounds, handAnimationValue,
  getHandAnimationEdit, setHandAnimationEdit, handJointLabel, handMotionPeriod, handLoopBeats } from './hand-model.js';
import { sampleHandAnimationDisplay } from './hand-animation-display.js';

const COLORS = { mcp: '#e5b16f', pip: '#6ed3cb', dip: '#cb9cf1', spread: '#ef91ad',
  flex: '#e5b16f', side: '#6ed3cb', twist: '#cb9cf1', arch: '#e5b16f', stretch: '#ef91ad' };
const PAD = 5;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const clone = value => structuredClone(value);
const sameCurve = (a, b) => a == null || b == null ? a == null && b == null
  : a.length === b.length && a.every((value, index) => value === b[index]);
const compact = (lane, value) => lane.joint === 'stretch' ? `${Math.round(value * 100)}%` : `${Math.round(value)}°`;
const spoken = (lane, value) => lane.joint === 'stretch' ? `${Math.round(value * 100)} percent stretch` : `${Number(value.toFixed(1))} degrees`;

/** Show the evaluated performance and edit sparse corrections to one joint.
 * Pointer strokes freeze their underlying generator/window; audio and transport
 * remain owned by the application. Undo restores corrections only. */
export function createHandContourEditor({ read, commit, listen, selectFinger }) {
  const lanes = [], undo = [], ruler = document.getElementById('loopRuler');
  let rulerKey = '', rulerStep = 1, rulerPlayhead;
  let config, drag = null, lastTime = 0, lastTremorTime = 0, lastRhythmTime = 0, preview = null;
  const activeLanes = () => lanes.filter(lane => lane.definition);
  const invalidate = () => { preview = null; };
  function frameFor(value = config) {
    if (drag) return drag.frame;
    const period = handMotionPeriod(value.motion);
    return { startTime: Math.floor(lastTime / period) * period, period, tremorOffset: lastTremorTime - lastTime, rhythmOffset: lastRhythmTime - lastTime };
  }
  function pointValue(lane, value = config, frame = frameFor(value)) {
    const time = frame.startTime + lane.cursor / HAND_CONTOUR_POINTS * frame.period;
    return handAnimationValue(evaluateHandPose(value, time, undefined, time + frame.tremorOffset, time + frame.rhythmOffset), lane.index, lane.joint);
  }
  function updateA11y(lane, value) {
    if (!config || !lane.definition) return;
    const [low, high] = handAnimationBounds(config.form, lane.index, lane.joint);
    const angle = value ?? pointValue(lane);
    const name = `${lane.definition.label} ${handJointLabel(config.form, lane.index, lane.joint)}`;
    lane.canvas.setAttribute('aria-label', `${name} animation`);
    lane.canvas.setAttribute('aria-valuemin', String(low));
    lane.canvas.setAttribute('aria-valuemax', String(high));
    lane.canvas.setAttribute('aria-valuenow', String(Number(angle.toFixed(4))));
    lane.canvas.setAttribute('aria-valuetext', `Point ${lane.cursor + 1} of ${HAND_CONTOUR_POINTS}, ${spoken(lane, angle)}`);
    lane.readout.textContent = compact(lane, angle);
    lane.selector.style.color = COLORS[lane.joint];
  }
  function remember(edits) {
    undo.push(clone(edits ?? {})); if (undo.length > 32) undo.shift();
  }
  function applyCurve(lane, curve, transaction) {
    const next = clone(read());
    const normalized = curve == null ? null : normalizeHandContour(curve);
    const replacement = normalized?.some(value => value !== 0) ? normalized : null;
    if (sameCurve(getHandAnimationEdit(next, lane.index, lane.joint), replacement)) return false;
    if (!transaction?.remembered) {
      remember(next.motion.edits);
      if (transaction) transaction.remembered = true;
    }
    setHandAnimationEdit(next, lane.index, lane.joint, replacement);
    commit(next); // sync invalidates the display; the next draw samples all lanes once.
    return true;
  }
  function capture(lane) {
    const baseline = clone(read()), frame = { ...frameFor(baseline) };
    const underlying = clone(baseline);
    setHandAnimationEdit(underlying, lane.index, lane.joint, null);
    const base = Array.from({ length: HAND_CONTOUR_POINTS }, (_, index) => {
      const time = frame.startTime + index / HAND_CONTOUR_POINTS * frame.period;
      return handAnimationValue(evaluateHandPose(underlying, time, undefined, time + frame.tremorOffset, time + frame.rhythmOffset), lane.index, lane.joint);
    });
    return { frame, baseline, base, curve: normalizeHandContour(getHandAnimationEdit(baseline, lane.index, lane.joint)),
      bounds: handAnimationBounds(baseline.form, lane.index, lane.joint), remembered: false };
  }
  function point(lane, event, bounds) {
    const rect = lane.canvas.getBoundingClientRect(), height = Math.max(1, rect.height - PAD * 2);
    return { index: clamp(Math.round((event.clientX - rect.left) / Math.max(1, rect.width) * HAND_CONTOUR_POINTS), 0, HAND_CONTOUR_POINTS - 1),
      angle: clamp(bounds[1] - (event.clientY - rect.top - PAD) / height * (bounds[1] - bounds[0]), ...bounds) };
  }
  function paint(lane, event) {
    const next = point(lane, event, drag.bounds), previous = drag.last ?? next;
    const distance = Math.abs(next.index - previous.index), span = drag.bounds[1] - drag.bounds[0];
    for (let step = 0; step <= distance; step++) {
      const amount = distance ? step / distance : 1, index = previous.index + Math.sign(next.index - previous.index) * step;
      const target = previous.angle + (next.angle - previous.angle) * amount;
      drag.curve[index] = span > 0 ? clamp((target - drag.base[index]) / span, -1, 1) : 0;
    }
    lane.cursor = next.index; drag.last = next;
    applyCurve(lane, drag.curve, drag); updateA11y(lane, next.angle);
  }
  function finishDrag(event) {
    if (!drag || (event && event.pointerId !== drag.pointer)) return;
    const { lane, pointer } = drag; drag = null; invalidate();
    if (lane.canvas.hasPointerCapture(pointer)) lane.canvas.releasePointerCapture(pointer);
  }
  function samplePreview() {
    const active = activeLanes(), frame = frameFor();
    // Multiple-of-16 columns retain exact edit-point anchors without extra model evaluations.
    const width = Math.max(1, ...active.map(lane => lane.canvas.clientWidth));
    const columns = clamp(Math.ceil(width / 2 / HAND_CONTOUR_POINTS) * HAND_CONTOUR_POINTS, 32, 192);
    if (!preview || preview.columns !== columns || preview.startTime !== frame.startTime || preview.period !== frame.period
      || Math.abs(preview.tremorOffset - frame.tremorOffset) > 1e-9 || Math.abs(preview.rhythmOffset - frame.rhythmOffset) > 1e-9) {
      preview = sampleHandAnimationDisplay(config, { ...frame, columns });
    }
    return preview;
  }
  function drawRuler(time, display) {
    if (!ruler) return;
    const beats = handLoopBeats(config.motion);
    const slots = Math.max(1, Math.floor(ruler.clientWidth / 40));
    rulerStep = Math.max(1, 2 ** Math.ceil(Math.log2(beats / slots)));
    const key = `${beats}:${rulerStep}:${display.period}`;
    if (key !== rulerKey) {
      rulerKey = key;
      const marks = [];
      for (let beat = 0; beat < beats; beat += rulerStep) marks.push(beat);
      marks.push(beats);
      const ticks = marks.map(beat => {
        const tick = document.createElement('span');
        tick.className = 'hand-loop-tick';
        if (beat === 0) tick.classList.add('hand-loop-start');
        if (beat === beats) tick.classList.add('hand-loop-end');
        tick.style.left = `${beat / beats * 100}%`;tick.textContent = String(beat);
        tick.setAttribute('aria-hidden', 'true');return tick;
      });
      rulerPlayhead = document.createElement('i');
      rulerPlayhead.className = 'hand-loop-playhead';rulerPlayhead.setAttribute('aria-hidden', 'true');
      ruler.replaceChildren(...ticks, rulerPlayhead);
      ruler.dataset.beats = String(beats);
      ruler.setAttribute('aria-label', `${beats}-beat motion loop, ${Number(display.period.toFixed(3))} seconds`);
    }
    rulerPlayhead.style.left = `${((time / display.period) % 1 + 1) % 1 * 100}%`;
  }
  function drawLane(lane, time, display) {
    const canvas = lane.canvas, width = canvas.clientWidth, height = canvas.clientHeight;
    const sampled = display.lanes.find(item => item.index === lane.index);
    if (!width || !height || !sampled) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    }
    const context = canvas.getContext('2d'); if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0); context.clearRect(0, 0, width, height);
    const yFor = (value, bounds) => PAD + (bounds[1] - value) / Math.max(1e-9, bounds[1] - bounds[0]) * (height - PAD * 2);
    const selectedBounds = handAnimationBounds(config.form, lane.index, lane.joint);
    context.strokeStyle = '#ffffff12'; context.lineWidth = 1; context.beginPath();
    for (let point = 0; point < HAND_CONTOUR_POINTS; point++) {
      const x = point / HAND_CONTOUR_POINTS * width; context.moveTo(x, 0); context.lineTo(x, height);
    }
    if (selectedBounds[0] <= 0 && selectedBounds[1] >= 0) {
      const y = yFor(0, selectedBounds); context.moveTo(0, y); context.lineTo(width, y);
    }
    context.stroke();
    // Beat divisions follow the loop ruler; the faint grid keeps the 16 edit points.
    context.strokeStyle = '#ffffff24';context.beginPath();
    const beats = handLoopBeats(config.motion);
    for (let beat = 0; beat <= beats; beat += rulerStep) {
      const x = beat / beats * width;context.moveTo(x, 0);context.lineTo(x, height);
    }
    context.stroke();
    const ordered = [...lane.definition.keys.filter(key => key !== lane.joint), lane.joint];
    for (const joint of ordered) {
      const curve = sampled.curves[joint], selected = joint === lane.joint;
      const bounds = handAnimationBounds(config.form, lane.index, joint), step = width / display.columns;
      context.fillStyle = COLORS[joint]; context.globalAlpha = selected ? .18 : .055;
      for (let x = 0; x < display.columns; x++) {
        const top = yFor(curve.max[x], bounds), bottom = yFor(curve.min[x], bounds);
        if (bottom - top > .6) context.fillRect(x * step, top, step + .5, bottom - top);
      }
      context.globalAlpha = selected ? 1 : .32; context.strokeStyle = COLORS[joint]; context.lineWidth = selected ? 2 : 1.1; context.beginPath();
      for (let x = 0; x <= display.columns; x++) {
        const y = yFor(curve.values[x], bounds);
        if (x === 0) context.moveTo(0, y); else context.lineTo(x * step, y);
      }
      context.stroke();
    }
    context.globalAlpha = 1;
    const progress = ((time / display.period) % 1 + 1) % 1;
    context.strokeStyle = '#ffffffaa'; context.lineWidth = 1; context.beginPath();
    context.moveTo(progress * width, 0); context.lineTo(progress * width, height); context.stroke();
    const value = sampled.curves[lane.joint].values[lane.cursor * display.columns / HAND_CONTOUR_POINTS];
    updateA11y(lane, value);
    if (document.activeElement === canvas) {
      context.fillStyle = COLORS[lane.joint]; context.beginPath();
      context.arc(lane.cursor / HAND_CONTOUR_POINTS * width, yFor(value, selectedBounds), 4, 0, Math.PI * 2); context.fill();
    }
  }
  function draw(time = lastTime, tremorTime = lastTremorTime, rhythmTime = lastRhythmTime) {
    lastTime = Number.isFinite(time) ? time : lastTime;
    lastTremorTime = Number.isFinite(tremorTime) ? tremorTime : lastTime;
    lastRhythmTime = Number.isFinite(rhythmTime) ? rhythmTime : lastTime;
    if (!config) return;
    const display = samplePreview();
    drawRuler(time, display);
    for (const lane of activeLanes()) drawLane(lane, lastTime, display);
  }
  function select(index, joint) {
    const lane = lanes.find(lane => lane.index === index);
    if (!lane?.definition) return;
    if (lane.definition.keys.includes(joint)) {
      if (drag?.lane === lane && lane.joint !== joint) finishDrag();
      lane.joint = joint;
    }
    lane.selector.value = lane.joint; updateA11y(lane);
    if (preview) drawLane(lane, lastTime, preview);
  }
  for (let index = 0; index < 7; index++) {
    const canvas = document.getElementById(`contour-${index}`), selector = document.getElementById(`contour-joint-${index}`);
    if (!canvas || !selector) continue;
    const lane = { index, canvas, selector, joint: index < 5 ? 'mcp' : index === 5 ? 'flex' : 'arch', cursor: 0,
      readout: document.getElementById(`contour-value-${index}`), definition: null }; lanes.push(lane);
    listen(selector, 'change', () => { select(index, selector.value); selectFinger(index, lane.joint); });
    listen(canvas, 'pointerdown', event => {
      if (event.button !== 0 || drag || !lane.definition) return;
      event.preventDefault(); canvas.focus({ preventScroll: true });
      drag = { ...capture(lane), lane, pointer: event.pointerId, last: null };
      canvas.setPointerCapture(event.pointerId); selectFinger(index, lane.joint); paint(lane, event);
    });
    listen(canvas, 'pointermove', event => { if (drag?.lane === lane && event.pointerId === drag.pointer) paint(lane, event); });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(canvas, type, finishDrag);
    listen(canvas, 'focus', () => { if (config) draw(); }); listen(canvas, 'blur', () => { if (config) draw(); });
    listen(canvas, 'keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey && !event.altKey) {
        event.preventDefault(); event.stopPropagation(); finishDrag();
        if (undo.length) {
          const next = clone(read()); next.motion.edits = clone(undo.pop());
          commit(next); draw();
        }
        return;
      }
      if (!lane.definition || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'Delete', 'Backspace'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation(); finishDrag();
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        lane.cursor = (lane.cursor + (event.key === 'ArrowRight' ? 1 : HAND_CONTOUR_POINTS - 1)) % HAND_CONTOUR_POINTS;
      } else {
        const transaction = capture(lane), reset = ['Home', 'Delete', 'Backspace'].includes(event.key);
        if (reset) transaction.curve[lane.cursor] = 0;
        else {
          const span = transaction.bounds[1] - transaction.bounds[0], delta = span * (event.shiftKey ? .1 : .025);
          const target = clamp(pointValue(lane, transaction.baseline, transaction.frame)
            + (event.key === 'ArrowUp' ? 1 : -1) * delta, ...transaction.bounds);
          transaction.curve[lane.cursor] = span > 0 ? clamp((target - transaction.base[lane.cursor]) / span, -1, 1) : 0;
        }
        applyCurve(lane, transaction.curve);
      }
      updateA11y(lane); draw();
    });
  }
  return {
    sync(next) {
      if (config && (config.form !== next.form || handLoopBeats(config.motion) !== handLoopBeats(next.motion))) finishDrag();
      config = next; invalidate();
      const definitions = handAnimationLanes(next.form);
      for (const lane of lanes) {
        const previous = lane.definition; lane.definition = definitions.find(item => item.index === lane.index);
        if (!lane.definition) continue;
        const { keys, label } = lane.definition;
        if (!keys.includes(lane.joint)) lane.joint = keys[0];
        if (previous !== lane.definition) lane.selector.replaceChildren(...keys.map(key => new Option(handJointLabel(next.form, lane.index, key), key)));
        lane.selector.value = lane.joint; lane.selector.setAttribute('aria-label', `${label} animation joint`); updateA11y(lane);
      }
    },
    draw(time, tremorTime = time, rhythmTime = time) { draw(time, tremorTime, rhythmTime); },
    select,
    clearHistory() { finishDrag(); undo.length = 0; },
  };
}
