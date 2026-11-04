import { BLECH_MAX_FILE_RATE } from './blech-midi-timing.js';
import { canvasSizing } from '../../graphics/canvas-sizing.js';
import { blackMidiStatistics, queryBlackMidiNotes } from './blech-midi-black-score.js';
import { parseBlackMidi } from './blech-midi-black-loader.js';
import { createBlechLiveProjector, BLECH_LIVE_NOTE_LIMIT } from './blech-midi-live-score.js';

export const BLACK_MIDI_PALETTES = Object.freeze(['ultra', 'rainbow', 'candy', 'ember', 'ice', 'acid']);
const ULTRA_NOTE_INKS = Object.freeze([
  [199, 255, 42], // logo green
  [255, 37, 50], // original BLECH MIDI logo red
  [50, 255, 223], // fluorescent turquoise
  [242, 221, 113], // paper yellow
  [242, 241, 230], // warm white
]);
const clamp = (value, min, max, fallback) => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : fallback));
const wrap = value => ((value % 1) + 1) % 1;
const blackKey = pitch => [1, 3, 6, 8, 10].includes(pitch % 12);
const PIANO_WHITE_KEYS = 75;
const PIANO_BLACK_WIDTH = 5 / 8; // Narrower black cells, not overlays on the white cells.
const PIANO_KEY_UNITS = PIANO_WHITE_KEYS + (128 - PIANO_WHITE_KEYS) * PIANO_BLACK_WIDTH;
const PIANO_KEY_ASPECT = 4; // White-key height / white-key width.
const safe = (callback, value) => { try { callback?.(value); } catch { /* Display callbacks never own playback. */ } };

export function blackMidiKeyLayout(alignment = 'piano') {
  let units = 0;
  return Array.from({ length: 128 }, (_, pitch) => {
    const black = blackKey(pitch);
    if (alignment === 'equal') return { x: pitch / 128, width: 1 / 128, black };
    const x = units / PIANO_KEY_UNITS;
    units += black ? PIANO_BLACK_WIDTH : 1;
    return { x, width: units / PIANO_KEY_UNITS - x, black };
  });
}

/** Snap the keyboard and note ink to the same device-pixel boundaries.
 * Every pitch owns one contiguous cell. Keys keep a one-pixel separator;
 * solid note ink paints through it so adjacent pitches have no dark seam.
 */
export function blackMidiPixelLayout(layout, canvasWidth) {
  const width = Math.max(1, Math.round(canvasWidth));
  return layout.map((key, pitch) => {
    const left = Math.round(key.x * width), right = pitch + 1 === layout.length ? width : Math.round(layout[pitch + 1].x * width);
    const paintedWidth = Math.max(1, right - left - 1);
    const noteWidth = Math.max(1, right - left);
    return { left, width: paintedWidth, noteWidth, x: left / width, unitWidth: paintedWidth / width, noteUnitWidth: noteWidth / width };
  });
}

const keyboardLayouts = { piano: blackMidiKeyLayout(), equal: blackMidiKeyLayout('equal') };

/** One horizontal pitch cell from the shared keyboard, rail and note-field boundaries. */
export function blackMidiPitchAtX(x, layout) {
  if (!Number.isFinite(x) || x < 0 || x > 1 || layout?.length !== 128) return null;
  let low = 0, high = 127;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (x < layout[middle].x) high = middle - 1;
    else low = middle;
  }
  return low;
}

/** Coordinates are relative to the visible keyboard band, not the note field. */
export function blackMidiKeyboardPitch(x, y, alignment = 'piano') {
  if (![x, y].every(Number.isFinite) || x < 0 || x > 1 || y < 0 || y > 1) return null;
  return blackMidiPitchAtX(x, keyboardLayouts[alignment === 'equal' ? 'equal' : 'piano']);
}

/** Pointer ownership is separate from audio: the app decides whether Audio is armed. */
export function createBlackMidiKeyboardState({ onNoteOn, onNoteOff, onChange } = {}) {
  const held = new Map();
  const release = sourceId => {
    if (!held.has(sourceId)) return;
    const note = held.get(sourceId); held.delete(sourceId);
    safe(onNoteOff, { sourceId, note }); safe(onChange);
  };
  return {
    play(sourceId, note) {
      if (!Number.isInteger(note) || note < 0 || note > 127) { release(sourceId); return; }
      if (held.get(sourceId) === note || (!held.has(sourceId) && held.size >= 16)) return;
      release(sourceId); held.set(sourceId, note);
      safe(onNoteOn, { sourceId, note, velocity: 100 }); safe(onChange);
    },
    release,
    releaseAll() { for (const sourceId of [...held.keys()]) release(sourceId); },
    get notes() { return [...held.values()]; },
  };
}

export function blackMidiColor({ pitch, velocity, channel, track }, options = {}) {
  const custom = options.trackColors?.[track];
  if (/^#[0-9a-f]{6}$/i.test(custom)) return [1, 3, 5].map(at => parseInt(custom.slice(at, at + 2), 16) / 255);
  if (options.palette === 'ultra') {
    const index = options.colorBy === 'pitch' ? Math.floor(pitch / 12)
      : options.colorBy === 'velocity' ? Math.min(4, Math.floor((127 - velocity) / 26))
        : options.colorBy === 'channel' ? channel : track;
    const safeIndex = Number.isFinite(index) ? ((Math.trunc(index) % ULTRA_NOTE_INKS.length) + ULTRA_NOTE_INKS.length) % ULTRA_NOTE_INKS.length : 0;
    return ULTRA_NOTE_INKS[safeIndex].map(value => value / 255);
  }
  let hue = options.colorBy === 'pitch' ? pitch / 128 : options.colorBy === 'velocity' ? (1 - velocity / 127) * 2 / 3
    : options.colorBy === 'channel' ? channel / 16 : wrap(track * .61803398875 + .55);
  const phase = Math.sin(hue * Math.PI * 2);
  if (options.palette === 'candy') hue = (270 + 100 * phase) / 360;
  else if (options.palette === 'ember') hue = (5 + 55 * (.5 + .5 * phase)) / 360;
  else if (options.palette === 'ice') hue = (180 + 60 * (.5 + .5 * phase)) / 360;
  else if (options.palette === 'acid') hue = (65 + 95 * (.5 + .5 * phase)) / 360;
  const sector = wrap(hue) * 6;
  return [0, 4, 2].map(offset => .96 * (.2 + .8 * clamp(Math.abs((sector + offset) % 6 - 3) - 1, 0, 1, 0)));
}

/** One velocity on both sides of the keyboard. Trail lifetime is bounded by
 * pastSeconds; viewport clipping can make the visible past shorter. Keyboard
 * thickness hides the crossing, rather than accelerating it into a second map.
 */
export function blackMidiTimeGeometry(options = {}, cssHeight = 500, cssWidth = 750) {
  const height = Math.max(1, Number(cssHeight) || 500);
  const width = Math.max(1, Number(cssWidth) || 750);
  // Every key has its own cell: use the new white-cell width for the same
  // aspect ratio when the stage stretches, without relying on its height.
  const pianoHeight = width / PIANO_KEY_UNITS * PIANO_KEY_ASPECT * clamp(options.keyboardHeight, .04, .2, .08) / .08;
  const band = options.alignment === 'equal'
    ? Math.min(.3, Math.max(18, Math.min(42, height * clamp(options.keyboardHeight, .04, .2, .08))) / height)
    : Math.min(.85, pianoHeight / height);
  const center = clamp(options.keyboardPosition, .3, .8, .78);
  const keyboardTop = Math.max(.1, Math.min(.95 - band, center - band / 2)), keyboardBottom = keyboardTop + band;
  const lookAhead = clamp(options.lookAhead, .25, 60, 6), pastSeconds = clamp(options.pastSeconds, 0, 30, 4);
  return { keyboardTop, keyboardBottom, lookAhead, pastSeconds, velocity: keyboardTop / lookAhead };
}

export function blackMidiNoteSegment(start, end, geometry, past = false) {
  const { keyboardTop, keyboardBottom, velocity, lookAhead, pastSeconds } = geometry;
  if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) return null;
  if (!past) {
    if (!(end > 0) || start > lookAhead) return null;
    const top = Math.max(0, keyboardTop - end * velocity);
    const bottom = Math.min(keyboardTop, keyboardTop - start * velocity);
    return { top, height: Math.max(0, bottom - top), brightness: 1 };
  }
  if (!(pastSeconds > 0) || !(start < 0) || end <= -pastSeconds) return null;
  const recent = Math.min(0, end), oldest = Math.max(-pastSeconds, start);
  const top = keyboardBottom - recent * velocity;
  const bottom = Math.min(1, keyboardBottom - oldest * velocity);
  if (top >= 1 || bottom <= top) return null;
  const age = ((top + bottom) / 2 - keyboardBottom) / velocity;
  return { top, height: bottom - top, brightness: .82 * Math.pow(Math.max(0, 1 - age / pastSeconds), 1.3) };
}

/** Spend frame time on notes only when something is moving. Audio owns its own
 * clock; this visual budget never delays or schedules MIDI. */
export function blechVisualFrameInterval(renderMilliseconds, active = true) {
  if (!active) return 1000 / 15;
  // Dense Canvas fallback or a slow GPU can take much longer than one frame.
  // Spend at most roughly a third of the main thread on recurring visuals;
  // direct edits still request an immediate frame through the dirty path.
  if (renderMilliseconds > 16) return Math.min(300, Math.max(1000 / 20, renderMilliseconds * 3));
  return 1000 / (renderMilliseconds > 8 ? 20 : renderMilliseconds > 4 ? 24 : 30);
}

function createGpu(canvas) {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false });
  if (!gl) return null;
  const shaders = [], program = gl.createProgram(), buffer = gl.createBuffer(), vertexArray = gl.createVertexArray();
  const shader = (type, source) => {
    const result = gl.createShader(type); shaders.push(result); gl.shaderSource(result, source); gl.compileShader(result);
    if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(result));
    gl.attachShader(program, result);
  };
  const destroy = () => { shaders.forEach(value => gl.deleteShader(value)); gl.deleteBuffer(buffer); gl.deleteVertexArray(vertexArray); gl.deleteProgram(program); };
  try {
    shader(gl.VERTEX_SHADER, `#version 300 es
      precision highp float;
      layout(location=0) in vec4 rect;
      layout(location=1) in vec3 color;
      out vec3 tint;
      void main(){ vec2 corner=vec2(float(gl_VertexID & 1),float((gl_VertexID >> 1) & 1));
        vec2 point=rect.xy+corner*rect.zw;
        gl_Position=vec4(point.x*2.0-1.0,1.0-point.y*2.0,0.0,1.0); tint=color; }`);
    shader(gl.FRAGMENT_SHADER, `#version 300 es
      precision mediump float; in vec3 tint; out vec4 pixel;
      void main(){ pixel=vec4(tint,1.0); }`);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.bindVertexArray(vertexArray); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 28, 0); gl.vertexAttribDivisor(0, 1);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 28, 16); gl.vertexAttribDivisor(1, 1);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.clearColor(13 / 255, 16 / 255, 15 / 255, 1);
    let capacity = 0;
    return { name: 'WebGL2', limit: 200_000, draw(data, count) {
      gl.viewport(0, 0, canvas.width, canvas.height); gl.clear(gl.COLOR_BUFFER_BIT); gl.useProgram(program);
      gl.bindVertexArray(vertexArray); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      if (data.byteLength > capacity) { capacity = data.byteLength; gl.bufferData(gl.ARRAY_BUFFER, capacity, gl.DYNAMIC_DRAW); }
      if (count) { gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.subarray(0, count * 7)); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count); }
    }, destroy };
  } catch { destroy(); return null; }
}

function createCpu(canvas) {
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('This browser cannot create a note display.');
  return { name: 'Canvas2D', limit: 25_000, draw(data, count) {
    const { width, height } = canvas;
    context.fillStyle = '#0d100f'; context.fillRect(0, 0, width, height);
    for (let index = 0; index < count * 7; index += 7) {
      context.fillStyle = `rgb(${Math.round(data[index + 4] * 255)} ${Math.round(data[index + 5] * 255)} ${Math.round(data[index + 6] * 255)})`;
      const left = Math.round(data[index] * width), right = Math.round((data[index] + data[index + 2]) * width);
      context.fillRect(left, data[index + 1] * height, Math.max(1, right - left), data[index + 3] * height);
    }
  }, destroy() {} };
}

/** The score supplies future notes; the caller's actual audio transport supplies
 * seconds. Never extrapolates from frames, starts Audio, or mutates playback.
 * Counts represent the full file; preview-only hidden tracks and display caps
 * are separately reported. Generated layers use their independent engine clocks
 * and share the same falling-note stage without owning any audio scheduling.
 */
export function createBlackMidiVisualizer({ mount, getTransport = () => ({ position: 0 }), getLiveState = null, onStats, onStatus, onNoteOn, onNoteOff, onPerformed, forceCanvas = false } = {}) {
  if (!mount?.ownerDocument) throw new Error('Falling notes requires a mount element.');
  const document = mount.ownerDocument, window = document.defaultView;
  const wrapper = document.createElement('div'); wrapper.className = 'midiphoria-black-stage';
  Object.assign(wrapper.style, { position: 'relative', width: '100%', height: '100%', minHeight: '0', overflow: 'hidden', background: '#0d100f' });
  const makeCanvas = (label, accessible = false) => {
    const canvas = document.createElement('canvas'); canvas.setAttribute('aria-label', label);
    canvas.setAttribute(accessible ? 'role' : 'aria-hidden', accessible ? 'img' : 'true');
    Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block', pointerEvents: 'none' });
    return canvas;
  };
  let canvas = makeCanvas('Future MIDI notes, present 128-key keyboard, and fading past trails', true);
  const keyboard = makeCanvas('MIDI keyboard'), context = keyboard.getContext('2d');
  wrapper.append(canvas, keyboard); mount.append(wrapper);
  let backend = forceCanvas ? null : createGpu(canvas);
  // A canvas with a failed/lost WebGL context cannot acquire a 2D context.
  if (!backend) { const replacement = makeCanvas('Future MIDI notes, present 128-key keyboard, and fading past trails', true); canvas.replaceWith(replacement); canvas = replacement; backend = createCpu(canvas); }
  let options = { lookAhead: 6, alignment: 'piano', colorBy: 'track', palette: 'ultra', trackColors: {}, hiddenTracks: [], keyboardHeight: .08, keyboardPosition: .78, pastSeconds: 4, trails: true };
  let layout = blackMidiKeyLayout(), pixelLayout = [], score = null, visible = true, disposed = false, frame = null, lastFrame = -Infinity, lastStats = -Infinity;
  let previousTime = NaN, dirty = true, serial = 0, controller = null, latestStats = null;
  let visualInterval = 1000 / 30, visualsActive = false;
  const data = new Float32Array(200_000 * 7), lit = new Array(128).fill(null);
  let colorCache = new Map();
  const projectLive = createBlechLiveProjector();
  let lastPerformedFile = null, fileEpoch = 0;
  let dimensions = { width: 1, height: 1, cssWidth: 1, cssHeight: 1 };
  const keyboardSurface = document.createElement('div'), keyboardEvents = new window.AbortController();
  const keyboardState = createBlackMidiKeyboardState({ onNoteOn, onNoteOff, onChange: () => { dirty = true; } });
  const pressedPointers = new Set();
  let selectedPitch = 60, enterHeld = false;
  const noteName = pitch => `${['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][pitch % 12]}${Math.floor(pitch / 12) - 1}`;
  keyboardSurface.className = 'blech-playable-keyboard'; keyboardSurface.tabIndex = 0;
  keyboardSurface.setAttribute('role', 'slider'); keyboardSurface.setAttribute('aria-label', 'Play MIDI keyboard. Arrow keys choose pitch; hold Enter to play.');
  keyboardSurface.setAttribute('aria-valuemin', '0'); keyboardSurface.setAttribute('aria-valuemax', '127');
  keyboardSurface.title = 'Move over the keys to play. Touch and drag on a screen. Arrow keys choose pitch; hold Enter to play.';
  Object.assign(keyboardSurface.style, { position: 'absolute', left: '0', width: '100%', touchAction: 'none', cursor: 'crosshair', outlineOffset: '-2px' });
  wrapper.append(keyboardSurface);
  const selectPitch = note => {
    selectedPitch = note; keyboardSurface.setAttribute('aria-valuenow', String(note)); keyboardSurface.setAttribute('aria-valuetext', `${noteName(note)}, MIDI ${note}`);
  };
  selectPitch(selectedPitch);
  function releaseKeyboard() { pressedPointers.clear(); enterHeld = false; keyboardState.releaseAll(); }
  const listenKeyboard = (node, type, listener) => node.addEventListener(type, listener, { signal: keyboardEvents.signal });
  const pointerSource = event => `blech:keyboard:pointer:${event.pointerId}`;
  const movePointer = event => {
    const rect = keyboardSurface.getBoundingClientRect();
    const note = blackMidiKeyboardPitch((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height, options.alignment);
    keyboardState.play(pointerSource(event), note);
    if (note !== null) selectPitch(note);
  };
  listenKeyboard(keyboardSurface, 'pointerenter', event => { if (event.pointerType === 'mouse') movePointer(event); });
  listenKeyboard(keyboardSurface, 'pointerdown', event => {
    if (event.button !== 0 || pressedPointers.size >= 16) return;
    event.preventDefault(); keyboardSurface.focus({ preventScroll: true }); pressedPointers.add(event.pointerId);
    keyboardSurface.setPointerCapture?.(event.pointerId); movePointer(event);
  });
  listenKeyboard(keyboardSurface, 'pointermove', event => {
    if (event.pointerType !== 'mouse' && !pressedPointers.has(event.pointerId)) return;
    // Coalesced samples are real pointer observations. Never invent skipped
    // attacks with zero-duration gates or schedule audio from rendering frames.
    const samples = event.getCoalescedEvents?.() ?? [];
    for (const sample of samples.slice(-16)) movePointer(sample);
    movePointer(event);
  });
  const releasePointer = event => { pressedPointers.delete(event.pointerId); keyboardState.release(pointerSource(event)); };
  for (const type of ['pointerleave', 'pointerup', 'pointercancel', 'lostpointercapture']) listenKeyboard(keyboardSurface, type, releasePointer);
  listenKeyboard(window, 'pointerup', releasePointer); listenKeyboard(window, 'pointercancel', releasePointer);
  listenKeyboard(keyboardSurface, 'keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault(); if (!event.repeat) { enterHeld = true; keyboardState.play('blech:keyboard:enter', selectedPitch); }
      return;
    }
    const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowDown: -12, ArrowUp: 12 }[event.key];
    if (delta === undefined && !['Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    selectPitch(event.key === 'Home' ? 0 : event.key === 'End' ? 127 : clamp(selectedPitch + delta, 0, 127, selectedPitch));
    if (enterHeld) keyboardState.play('blech:keyboard:enter', selectedPitch);
    dirty = true;
  });
  listenKeyboard(keyboardSurface, 'keyup', event => { if (event.key === 'Enter') { event.preventDefault(); enterHeld = false; keyboardState.release('blech:keyboard:enter'); } });
  listenKeyboard(keyboardSurface, 'focus', () => { keyboardSurface.style.outline = '2px solid #c7ff2a'; dirty = true; });
  listenKeyboard(keyboardSurface, 'blur', () => { keyboardSurface.style.outline = ''; releaseKeyboard(); dirty = true; });
  listenKeyboard(window, 'blur', releaseKeyboard);
  const status = (state, message) => safe(onStatus, { state, message, renderer: backend.name });
  const resize = () => {
    if (disposed) return;
    releaseKeyboard();
    dimensions = canvasSizing(wrapper.getBoundingClientRect(), window.devicePixelRatio, { maxPixelRatio: 2, pixelBudget: 2_000_000 });
    for (const surface of [canvas, keyboard]) { if (surface.width !== dimensions.width) surface.width = dimensions.width; if (surface.height !== dimensions.height) surface.height = dimensions.height; }
    pixelLayout = blackMidiPixelLayout(layout, dimensions.width);
    dirty = true;
  };
  const resizeObserver = typeof window.ResizeObserver === 'function' ? new window.ResizeObserver(resize) : null;
  resizeObserver?.observe(wrapper); window.addEventListener('resize', resize);
  function drawKeyboard() {
    if (!context) return;
    const { width, height, cssHeight, cssWidth } = dimensions, geometry = blackMidiTimeGeometry(options, cssHeight, cssWidth);
    const strike = geometry.keyboardTop * height, keyHeight = (geometry.keyboardBottom - geometry.keyboardTop) * height;
    keyboardSurface.style.top = `${geometry.keyboardTop * 100}%`; keyboardSurface.style.height = `${(geometry.keyboardBottom - geometry.keyboardTop) * 100}%`;
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#252b25'; context.fillRect(0, strike, width, keyHeight);
    for (let pitch = 0; pitch < 128; pitch++) {
      const key = pixelLayout[pitch], rgb = lit[pitch];
      context.fillStyle = rgb ? `rgb(${rgb.map(value => Math.round(value * 255)).join(' ')})` : layout[pitch].black ? '#171c18' : '#e2e3d6';
      context.fillRect(key.left, strike + 1, key.width, keyHeight - 1);
    }
    if (document.activeElement === keyboardSurface) {
      const key = pixelLayout[selectedPitch], lineWidth = Math.max(1, Math.round(2 * width / dimensions.cssWidth));
      context.strokeStyle = '#c7ff2a'; context.lineWidth = lineWidth;
      context.strokeRect(key.left + lineWidth / 2, strike + 2, Math.max(0, key.width - lineWidth),
        keyHeight - 3);
    }
    context.fillStyle = '#819178'; context.fillRect(0, strike, width, 1);
    if (dimensions.cssHeight >= 180) {
      context.font = `${Math.max(9, 10 * (width / dimensions.cssWidth))}px sans-serif`;
      context.fillStyle = '#899783';
      context.fillText('FUTURE', 6, 13 * (width / dimensions.cssWidth));
      context.fillText('PAST', 6, Math.min(height - 5, strike + keyHeight + 14 * (width / dimensions.cssWidth)));
    }
    if (dimensions.cssWidth >= 540) {
      context.fillStyle = '#71816e'; context.font = `${Math.max(8, 9 * (width / dimensions.cssWidth))}px sans-serif`;
      for (let pitch = 0; pitch < 128; pitch += 12) context.fillText(`C${pitch / 12 - 1}`, pixelLayout[pitch].left + 2, strike + keyHeight - 3);
    }
  }
  function render(position = getTransport()?.position ?? 0) {
    if (disposed) return latestStats;
    const time = Math.max(0, Number(position) || 0), geometry = blackMidiTimeGeometry(options, dimensions.cssHeight, dimensions.cssWidth);
    const transport = getTransport() ?? {}, speed = clamp(transport.speed ?? transport.rate, .01, BLECH_MAX_FILE_RATE, 1);
    const frameLimit = Math.max(Math.floor(backend.limit / 8), Math.floor(backend.limit / Math.max(1, speed)));
    let liveState = null;
    try { liveState = getLiveState?.(); } catch { /* Display failure cannot affect sound. */ }
    const pastSeconds = options.trails ? options.pastSeconds : 0;
    const now = liveState?.sampleTime ?? window.performance.now() / 1000;
    const live = projectLive(liveState, { lookAhead: options.lookAhead, pastSeconds: onPerformed ? Math.max(8, pastSeconds) : pastSeconds,
      now, limit: Math.min(BLECH_LIVE_NOTE_LIMIT, frameLimit / 4) });
    visualsActive = Boolean(transport.playing || liveState?.samples?.length || liveState?.rails?.length || liveState?.automata?.playing
      || keyboardState.notes.length || live.heldOutlines.length || (pastSeconds && live.pastNotes.length));
    if (onPerformed) {
      const file = [];
      if (score && transport.playing) {
        const before = lastPerformedFile, seekGeneration = transport.seekGeneration ?? 0;
        const sameScore = before?.score === score, sameSeek = before?.seekGeneration === seekGeneration;
        const samePass = sameScore && sameSeek && before.playing && time >= before.time &&
          time - before.time <= Math.max(.15, (now - before.now) * speed + .15);
        if (!samePass) fileEpoch++;
        // A seek discards jumped-over attacks. Pause/resume starts a new
        // performed pass at the paused position; a real loop restarts at zero.
        const resumed = sameScore && sameSeek && !before.playing;
        const loopRestart = sameScore && sameSeek && before.playing && time < before.time;
        const floor = samePass ? before.floor : resumed ? before.time
          : loopRestart || time < .25 && transport.seekWasRewind !== false ? 0 : time;
        const from = samePass || resumed ? before.time : floor;
        const heard = new Map();
        const visit = (index, track) => {
          if (score.starts[index] < floor || score.starts[index] > time) return;
          heard.set(index, { id: `file:${fileEpoch}:${index}`, source: 'file', track, pitch: score.pitches[index],
            channel: score.channels[index], velocity: score.velocities[index],
            start: (score.starts[index] - time) / speed, end: (score.ends[index] - time) / speed });
        };
        queryBlackMidiNotes(score, from, Math.max(0, time - from), { limit: 1024, scanLimit: 8192, visit(index, track) {
          if (samePass && score.starts[index] <= from) return;
          visit(index, track);
        } });
        // Ongoing gates need their end advanced on each performed frame, not
        // just on their attack frame. This query visits no future notes.
        queryBlackMidiNotes(score, time, 0, { limit: 512, scanLimit: 4096, visit });
        file.push(...heard.values());
        lastPerformedFile = { score, playing: true, time, now, seekGeneration, floor };
      } else {
        lastPerformedFile = { score, playing: false, time, now, seekGeneration: transport.seekGeneration ?? 0,
          floor: lastPerformedFile?.score === score ? lastPerformedFile.floor : 0 };
      }
      safe(onPerformed, { now, live: live.pastNotes, file });
    }
    lit.fill(null); let count = 0, pastVisible = 0, futureVisible = 0;
    function rectangle({ pitch, velocity, channel, track, start, end }, past = false) {
      const key = pixelLayout[pitch]; if (!key || count >= frameLimit) return false;
      const segment = blackMidiNoteSegment(start, end, geometry, past); if (!segment) return false;
      const custom = options.trackColors[track];
      const colorKey = /^#[0-9a-f]{6}$/i.test(custom) ? `custom:${custom}` : options.colorBy === 'pitch' ? pitch
        : options.colorBy === 'velocity' ? velocity : options.colorBy === 'channel' ? channel : track;
      let rgb = colorCache.get(colorKey);
      if (!rgb) { if (colorCache.size >= 8192) colorCache.clear(); rgb = blackMidiColor({ pitch, velocity, channel, track }, options); colorCache.set(colorKey, rgb); }
      const at = count++ * 7;
      data[at] = key.x; data[at + 1] = segment.top; data[at + 2] = key.noteUnitWidth;
      data[at + 3] = Math.max(1 / dimensions.height, segment.height);
      data[at + 4] = rgb[0] * segment.brightness; data[at + 5] = rgb[1] * segment.brightness; data[at + 6] = rgb[2] * segment.brightness;
      if (past) pastVisible++; else { futureVisible++; if (start <= 0 && end > 0) lit[pitch] = rgb; }
      return true;
    }
    const fileNote = (index, track) => ({ pitch: score.pitches[index], velocity: score.velocities[index], channel: score.channels[index], track,
      start: (score.starts[index] - time) / speed, end: (score.ends[index] - time) / speed });
    // Reserve both future and past live geometry before querying dense files.
    const livePastLimit = pastSeconds ? Math.min(live.pastNotes.length, Math.floor(frameLimit / 4)) : 0;
    const fileLimit = Math.max(0, Math.floor((frameLimit - live.notes.length - livePastLimit) / (pastSeconds ? 2 : 1)));
    const queried = queryBlackMidiNotes(score, time, options.lookAhead * speed, { limit: fileLimit, scanLimit: fileLimit * 2,
      hiddenTracks: options.hiddenTracks, visit(index, track) { rectangle(fileNote(index, track)); } });
    const fileVisible = count;
    for (const note of live.notes) rectangle(note);
    // A source-position query is intentional: file pause freezes its picture;
    // seek replaces both sides immediately, so no unrelated stale tails survive.
    let filePastVisible = 0;
    if (pastSeconds) {
      const from = Math.max(0, time - pastSeconds * speed);
      queryBlackMidiNotes(score, from, time - from, { limit: fileLimit, scanLimit: fileLimit * 2,
        hiddenTracks: options.hiddenTracks, visit(index, track) { if (rectangle(fileNote(index, track), true)) filePastVisible++; } });
      for (let index = Math.max(0, live.pastNotes.length - livePastLimit); index < live.pastNotes.length; index++) rectangle(live.pastNotes[index], true);
    }
    for (const note of live.heldOutlines) lit[note.pitch] = blackMidiColor(note, options);
    for (const pitch of keyboardState.notes) lit[pitch] = blackMidiColor({ pitch, velocity: 100, channel: 0, track: 0 }, { ...options, colorBy: 'pitch' });
    backend.draw(data, count); drawKeyboard();
    // Held rail keys immediately connect the rail to the keyboard in the
    // future plane. Older sample latches still grow below the keyboard in the
    // past plane. Neither outline waits for another MIDI or animation event.
    let heldOutlineExtent = 0;
    if (context) for (const note of live.heldOutlines) {
      const segment = note.fromRail
        ? { top: 0, height: geometry.keyboardTop }
        : blackMidiNoteSegment(Math.min(-.02, note.start), 0, { ...geometry, pastSeconds: 30 }, true);
      const key = pixelLayout[note.pitch]; if (!segment || !key) continue;
      const rgb = blackMidiColor(note, options).map(value => Math.round(value * 255));
      const y = Math.round(segment.top * dimensions.height);
      const height = Math.max(2, Math.round((segment.top + segment.height) * dimensions.height) - y);
      const lineWidth = Math.max(1, Math.round(dimensions.width / dimensions.cssWidth));
      context.strokeStyle = `rgb(${rgb.join(' ')})`; context.lineWidth = lineWidth;
      if (key.noteWidth <= lineWidth || height <= lineWidth) {
        context.fillStyle = context.strokeStyle; context.fillRect(key.left, y, key.noteWidth, height);
      } else {
        context.strokeRect(key.left + lineWidth / 2, y + lineWidth / 2, key.noteWidth - lineWidth, height - lineWidth);
      }
      heldOutlineExtent = Math.max(heldOutlineExtent, height / dimensions.height * dimensions.cssHeight);
    }
    wrapper.dataset.keyboardHeld = keyboardState.notes.join(',');
    latestStats = { ...blackMidiStatistics(score, time, { ...options, lookAhead: options.lookAhead * speed }), visible: fileVisible, scanned: queried.scanned,
      liveVisible: live.notes.length, liveHeld: live.held, heldOutlinesVisible: live.heldOutlines.length, heldOutlineExtent, liveSources: live.sources, liveTruncated: live.truncated,
      pastVisible, filePastVisible, livePastVisible: pastVisible - filePastVisible, futureVisible, keyboardTop: geometry.keyboardTop, keyboardBottom: geometry.keyboardBottom,
      renderer: backend.name, displayLimit: frameLimit, position: time };
    latestStats.omitted = Math.max(0, latestStats.candidateCount - fileVisible);
    wrapper.dataset.liveNotes = String(live.notes.length);
    wrapper.dataset.liveHeld = String(live.held);
    wrapper.dataset.heldOutlines = String(live.heldOutlines.length);
    wrapper.dataset.railHeld = String(live.heldOutlines.filter(note => note.fromRail).length);
    wrapper.dataset.heldOutlineExtent = String(Math.round(heldOutlineExtent));
    wrapper.dataset.liveSources = JSON.stringify(live.sources);
    wrapper.dataset.fileNotes = String(fileVisible);
    wrapper.dataset.pastNotes = String(pastVisible);
    wrapper.dataset.keyboardTop = String(geometry.keyboardTop);
    wrapper.dataset.keyboardBottom = String(geometry.keyboardBottom);
    previousTime = time; dirty = false;
    return latestStats;
  }
  function tick(now) {
    frame = null; if (disposed || !visible || document.hidden) return;
    const position = getTransport()?.position ?? 0;
    const interval = dirty ? Math.min(visualInterval, 1000 / 30)
      : visualsActive ? visualInterval : blechVisualFrameInterval(0, false);
    if (now - lastFrame >= interval
      && (dirty || position !== previousTime || getLiveState)) {
      lastFrame = now;
      const started = window.performance.now();
      render(position);
      visualInterval = blechVisualFrameInterval(window.performance.now() - started);
    }
    if (latestStats && now - lastStats >= 100) { lastStats = now; safe(onStats, latestStats); }
    frame = window.requestAnimationFrame(tick);
  }
  const schedule = () => { if (!disposed && visible && !document.hidden && frame === null) frame = window.requestAnimationFrame(tick); };
  const visibility = () => { if (document.hidden) { releaseKeyboard(); if (frame !== null) window.cancelAnimationFrame(frame); frame = null; } else { dirty = true; schedule(); } };
  document.addEventListener('visibilitychange', visibility);
  const contextLost = event => {
    event.preventDefault(); if (disposed || backend.name !== 'WebGL2') return;
    releaseKeyboard();
    backend.destroy(); canvas.removeEventListener('webglcontextlost', contextLost);
    const replacement = makeCanvas('Future MIDI notes, present 128-key keyboard, and fading past trails', true); canvas.replaceWith(replacement); canvas = replacement; backend = createCpu(canvas);
    resize(); dirty = true; status('ready', 'Using Canvas fallback after the GPU context was lost.'); schedule();
  };
  canvas.addEventListener('webglcontextlost', contextLost);
  function cancelLoad() { serial++; controller?.abort(); controller = null; }
  function dispose() {
    if (disposed) return; disposed = true; cancelLoad();
    releaseKeyboard(); keyboardEvents.abort();
    if (frame !== null) window.cancelAnimationFrame(frame); frame = null;
    resizeObserver?.disconnect(); window.removeEventListener('resize', resize); document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('pagehide', dispose); canvas.removeEventListener('webglcontextlost', contextLost); backend.destroy(); wrapper.remove(); score = null; getLiveState = null; projectLive(null);
  }
  window.addEventListener('pagehide', dispose, { once: true });
  resize(); schedule();
  return {
    async load(buffer, { signal } = {}) {
      cancelLoad(); const ticket = serial; controller = new AbortController(); const active = controller;
      const abort = () => active.abort(); signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) active.abort();
      status('loading', 'Indexing the complete MIDI score…');
      try {
        const result = await parseBlackMidi(buffer, { signal: active.signal });
        if (disposed || ticket !== serial) throw new DOMException('MIDI indexing cancelled.', 'AbortError');
        score = result; dirty = true; status('ready', `${result.total.toLocaleString('en-US')} notes indexed.`); schedule(); return result;
      } catch (error) { if (!disposed && ticket === serial && error?.name !== 'AbortError') status('error', error.message); throw error; }
      finally { signal?.removeEventListener('abort', abort); if (controller === active) controller = null; }
    },
    setScore(value) { cancelLoad(); score = value; dirty = true; schedule(); },
    setLiveSource(value) { getLiveState = typeof value === 'function' ? value : null; dirty = true; schedule(); },
    setOptions(value = {}) {
      if (['alignment', 'keyboardPosition', 'keyboardHeight'].some(key => value[key] !== undefined && value[key] !== options[key])) releaseKeyboard();
      options = { ...options, ...value,
        lookAhead: clamp(value.lookAhead ?? options.lookAhead, .25, 60, 6), keyboardHeight: clamp(value.keyboardHeight ?? options.keyboardHeight, .04, .2, .08),
        keyboardPosition: clamp(value.keyboardPosition ?? options.keyboardPosition, .3, .8, .78),
        pastSeconds: clamp(value.pastSeconds ?? options.pastSeconds, 0, 30, 4), trails: value.trails === undefined ? options.trails : Boolean(value.trails),
        alignment: (value.alignment ?? options.alignment) === 'equal' ? 'equal' : 'piano',
        colorBy: ['track', 'channel', 'pitch', 'velocity'].includes(value.colorBy ?? options.colorBy) ? value.colorBy ?? options.colorBy : 'track',
        palette: BLACK_MIDI_PALETTES.includes(value.palette ?? options.palette) ? value.palette ?? options.palette : 'ultra',
        trackColors: { ...(value.trackColors ?? options.trackColors) }, hiddenTracks: [...(value.hiddenTracks ?? options.hiddenTracks)],
      };
      layout = blackMidiKeyLayout(options.alignment); pixelLayout = blackMidiPixelLayout(layout, dimensions.width);
      colorCache = new Map(); dirty = true; schedule();
    },
    setVisible(value) { visible = Boolean(value); wrapper.hidden = !visible; if (!visible) { releaseKeyboard(); if (frame !== null) window.cancelAnimationFrame(frame); frame = null; } else { resize(); dirty = true; schedule(); } },
    get score() { return score; }, get stats() { return latestStats; }, get renderer() { return backend.name; },
    get keyboardHeldCount() { return keyboardState.notes.length; }, releaseKeyboard, render, dispose,
  };
}
