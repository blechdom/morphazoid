import { canvasSizing } from '../../graphics/canvas-sizing.js';
import { blackMidiStatistics, queryBlackMidiNotes } from './blech-midi-black-score.js';
import { parseBlackMidi } from './blech-midi-black-loader.js';
import { createBlechLiveProjector, BLECH_LIVE_NOTE_LIMIT } from './blech-midi-live-score.js';

export const BLACK_MIDI_PALETTES = Object.freeze(['rainbow', 'candy', 'ember', 'ice', 'acid']);
const clamp = (value, min, max, fallback) => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : fallback));
const wrap = value => ((value % 1) + 1) % 1;
const blackKey = pitch => [1, 3, 6, 8, 10].includes(pitch % 12);
const safe = (callback, value) => { try { callback?.(value); } catch { /* Display callbacks never own playback. */ } };

export function blackMidiKeyLayout(alignment = 'piano') {
  let whites = 0;
  for (let pitch = 0; pitch < 128; pitch++) if (!blackKey(pitch)) whites++;
  let white = 0;
  return Array.from({ length: 128 }, (_, pitch) => {
    const black = blackKey(pitch);
    const key = alignment === 'equal' ? { x: pitch / 128, width: 1 / 128, black }
      : { x: (black ? white - .32 : white) / whites, width: (black ? .64 : 1) / whites, black };
    if (!black) white++;
    return key;
  });
}

export function blackMidiColor({ pitch, velocity, channel, track }, options = {}) {
  const custom = options.trackColors?.[track];
  if (/^#[0-9a-f]{6}$/i.test(custom)) return [1, 3, 5].map(at => parseInt(custom.slice(at, at + 2), 16) / 255);
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
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.clearColor(.025, .03, .045, 1);
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
    context.fillStyle = '#06080c'; context.fillRect(0, 0, width, height);
    for (let index = 0; index < count * 7; index += 7) {
      context.fillStyle = `rgb(${Math.round(data[index + 4] * 255)} ${Math.round(data[index + 5] * 255)} ${Math.round(data[index + 6] * 255)})`;
      context.fillRect(data[index] * width, data[index + 1] * height, data[index + 2] * width, data[index + 3] * height);
    }
  }, destroy() {} };
}

/** The score supplies future notes; the caller's actual audio transport supplies
 * seconds. Never extrapolates from frames, starts Audio, or mutates playback.
 * Counts represent the full file; preview-only hidden tracks and display caps
 * are separately reported. Generated layers use their independent engine clocks
 * and share the same falling-note stage without owning any audio scheduling.
 */
export function createBlackMidiVisualizer({ mount, getTransport = () => ({ position: 0 }), getLiveState = null, onStats, onStatus, forceCanvas = false } = {}) {
  if (!mount?.ownerDocument) throw new Error('Falling notes requires a mount element.');
  const document = mount.ownerDocument, window = document.defaultView;
  const wrapper = document.createElement('div'); wrapper.className = 'midiphoria-black-stage';
  Object.assign(wrapper.style, { position: 'relative', width: '100%', height: '100%', minHeight: '160px', overflow: 'hidden', background: '#06080c' });
  const makeCanvas = (label, accessible = false) => {
    const canvas = document.createElement('canvas'); canvas.setAttribute('aria-label', label);
    canvas.setAttribute(accessible ? 'role' : 'aria-hidden', accessible ? 'img' : 'true');
    Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block', pointerEvents: 'none' });
    return canvas;
  };
  let canvas = makeCanvas('Falling MIDI notes and full 128-key keyboard', true);
  const keyboard = makeCanvas('MIDI keyboard'), context = keyboard.getContext('2d');
  wrapper.append(canvas, keyboard); mount.append(wrapper);
  let backend = forceCanvas ? null : createGpu(canvas);
  // A canvas with a failed/lost WebGL context cannot acquire a 2D context.
  if (!backend) { const replacement = makeCanvas('Falling MIDI notes and full 128-key keyboard', true); canvas.replaceWith(replacement); canvas = replacement; backend = createCpu(canvas); }
  let options = { lookAhead: 6, alignment: 'piano', colorBy: 'track', palette: 'rainbow', trackColors: {}, hiddenTracks: [], keyboardHeight: .16 };
  let layout = blackMidiKeyLayout(), score = null, visible = true, disposed = false, frame = null, lastFrame = -Infinity, lastStats = -Infinity;
  let previousTime = NaN, dirty = true, serial = 0, controller = null, latestStats = null;
  const data = new Float32Array(200_000 * 7), lit = new Array(128).fill(null);
  let colorCache = new Map();
  const projectLive = createBlechLiveProjector();
  let dimensions = { width: 1, height: 1, cssWidth: 1, cssHeight: 1 };
  const status = (state, message) => safe(onStatus, { state, message, renderer: backend.name });
  const resize = () => {
    if (disposed) return;
    dimensions = canvasSizing(wrapper.getBoundingClientRect(), window.devicePixelRatio, { maxPixelRatio: 2, pixelBudget: 2_000_000 });
    for (const surface of [canvas, keyboard]) { if (surface.width !== dimensions.width) surface.width = dimensions.width; if (surface.height !== dimensions.height) surface.height = dimensions.height; }
    dirty = true;
  };
  const resizeObserver = typeof window.ResizeObserver === 'function' ? new window.ResizeObserver(resize) : null;
  resizeObserver?.observe(wrapper); window.addEventListener('resize', resize);
  function drawKeyboard() {
    if (!context) return;
    const { width, height } = dimensions, strike = (1 - options.keyboardHeight) * height, keyHeight = height - strike;
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#11131a'; context.fillRect(0, strike, width, keyHeight);
    const draw = black => {
      for (let pitch = 0; pitch < 128; pitch++) {
        const key = layout[pitch]; if (key.black !== black) continue;
        const rgb = lit[pitch]; context.fillStyle = rgb ? `rgb(${rgb.map(value => Math.round(value * 255)).join(' ')})` : black ? '#10131b' : '#d7dbe5';
        context.fillRect(key.x * width, strike + 1, Math.max(1, key.width * width - .65), keyHeight * (black && options.alignment === 'piano' ? .63 : 1));
      }
    };
    draw(false); draw(true);
    context.fillStyle = '#aebbd3'; context.fillRect(0, strike, width, 1);
    if (dimensions.cssWidth >= 540) {
      context.fillStyle = '#596174'; context.font = `${Math.max(8, 9 * (width / dimensions.cssWidth))}px sans-serif`;
      for (let pitch = 0; pitch < 128; pitch += 12) context.fillText(`C${pitch / 12 - 1}`, layout[pitch].x * width + 2, height - 3);
    }
  }
  function render(position = getTransport()?.position ?? 0) {
    if (disposed) return latestStats;
    const time = Math.max(0, Number(position) || 0), strike = 1 - options.keyboardHeight;
    const transport = getTransport() ?? {}, speed = clamp(transport.speed ?? transport.rate, .125, 8, 1);
    let liveState = null;
    try { liveState = getLiveState?.(); } catch { /* Display failure cannot affect sound. */ }
    const live = projectLive(liveState, { lookAhead: options.lookAhead, limit: Math.min(BLECH_LIVE_NOTE_LIMIT, backend.limit / 2) });
    lit.fill(null); let count = 0;
    function rectangle({ pitch, velocity, channel, track, start, end }) {
      const key = layout[pitch]; if (!key || count >= backend.limit) return;
      const custom = options.trackColors[track];
      const colorKey = /^#[0-9a-f]{6}$/i.test(custom) ? `custom:${custom}` : options.colorBy === 'pitch' ? pitch
        : options.colorBy === 'velocity' ? velocity : options.colorBy === 'channel' ? channel : track;
      let rgb = colorCache.get(colorKey);
      if (!rgb) { rgb = blackMidiColor({ pitch, velocity, channel, track }, options); colorCache.set(colorKey, rgb); }
      const bottom = Math.min(strike, strike - start / options.lookAhead * strike);
      const top = Math.max(0, strike - end / options.lookAhead * strike);
      const at = count++ * 7;
      data[at] = key.x; data[at + 1] = top; data[at + 2] = Math.max(1 / dimensions.width, key.width - .4 / dimensions.width);
      data[at + 3] = Math.max(1 / dimensions.height, bottom - top); data[at + 4] = rgb[0]; data[at + 5] = rgb[1]; data[at + 6] = rgb[2];
      if (start <= 0 && end > 0) lit[pitch] = rgb;
    }
    // Live layers retain a guaranteed share even over a dense decorative file.
    const fileLimit = backend.limit - live.notes.length;
    const queried = queryBlackMidiNotes(score, time, options.lookAhead * speed, { limit: fileLimit, scanLimit: fileLimit * 2, hiddenTracks: options.hiddenTracks,
      visit(index, track) {
        rectangle({ pitch: score.pitches[index], velocity: score.velocities[index], channel: score.channels[index], track,
          start: (score.starts[index] - time) / speed, end: (score.ends[index] - time) / speed });
      },
    });
    const fileVisible = count;
    for (const note of live.notes) rectangle(note);
    backend.draw(data, count); drawKeyboard();
    latestStats = { ...blackMidiStatistics(score, time, { ...options, lookAhead: options.lookAhead * speed }), visible: fileVisible, scanned: queried.scanned,
      liveVisible: live.notes.length, liveHeld: live.held, liveSources: live.sources, liveTruncated: live.truncated,
      renderer: backend.name, displayLimit: backend.limit, position: time };
    latestStats.omitted = Math.max(0, latestStats.candidateCount - fileVisible);
    wrapper.dataset.liveNotes = String(live.notes.length);
    wrapper.dataset.liveHeld = String(live.held);
    wrapper.dataset.liveSources = JSON.stringify(live.sources);
    wrapper.dataset.fileNotes = String(fileVisible);
    previousTime = time; dirty = false;
    return latestStats;
  }
  function tick(now) {
    frame = null; if (disposed || !visible || document.hidden) return;
    const position = getTransport()?.position ?? 0;
    if (now - lastFrame >= 1000 / 30 && (dirty || position !== previousTime || getLiveState)) { lastFrame = now; render(position); }
    if (latestStats && now - lastStats >= 100) { lastStats = now; safe(onStats, latestStats); }
    frame = window.requestAnimationFrame(tick);
  }
  const schedule = () => { if (!disposed && visible && !document.hidden && frame === null) frame = window.requestAnimationFrame(tick); };
  const visibility = () => { if (document.hidden) { if (frame !== null) window.cancelAnimationFrame(frame); frame = null; } else { dirty = true; schedule(); } };
  document.addEventListener('visibilitychange', visibility);
  const contextLost = event => {
    event.preventDefault(); if (disposed || backend.name !== 'WebGL2') return;
    backend.destroy(); canvas.removeEventListener('webglcontextlost', contextLost);
    const replacement = makeCanvas('Falling MIDI notes and full 128-key keyboard', true); canvas.replaceWith(replacement); canvas = replacement; backend = createCpu(canvas);
    resize(); dirty = true; status('ready', 'Using Canvas fallback after the GPU context was lost.'); schedule();
  };
  canvas.addEventListener('webglcontextlost', contextLost);
  function cancelLoad() { serial++; controller?.abort(); controller = null; }
  function dispose() {
    if (disposed) return; disposed = true; cancelLoad();
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
      options = { ...options, ...value,
        lookAhead: clamp(value.lookAhead ?? options.lookAhead, .25, 60, 6), keyboardHeight: clamp(value.keyboardHeight ?? options.keyboardHeight, .08, .35, .16),
        alignment: (value.alignment ?? options.alignment) === 'equal' ? 'equal' : 'piano',
        colorBy: ['track', 'channel', 'pitch', 'velocity'].includes(value.colorBy ?? options.colorBy) ? value.colorBy ?? options.colorBy : 'track',
        palette: BLACK_MIDI_PALETTES.includes(value.palette ?? options.palette) ? value.palette ?? options.palette : 'rainbow',
        trackColors: { ...(value.trackColors ?? options.trackColors) }, hiddenTracks: [...(value.hiddenTracks ?? options.hiddenTracks)],
      };
      layout = blackMidiKeyLayout(options.alignment); colorCache = new Map(); dirty = true; schedule();
    },
    setVisible(value) { visible = Boolean(value); wrapper.hidden = !visible; if (!visible && frame !== null) { window.cancelAnimationFrame(frame); frame = null; } else { resize(); dirty = true; schedule(); } },
    get score() { return score; }, get stats() { return latestStats; }, get renderer() { return backend.name; }, render, dispose,
  };
}
