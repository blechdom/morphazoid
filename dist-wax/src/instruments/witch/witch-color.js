// Safari's Canvas 2D implementation may omit `filter`. Keep the Witch's
// whole-scene palette pass on the GPU without recoloring its foreground layer.
const passes = new WeakMap();
const VERTEX = `
attribute vec2 position;
varying vec2 uv;
void main() {
  uv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;
const FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D source;
uniform vec2 turn;
uniform float saturation;
varying vec2 uv;
void main() {
  vec4 pixel = texture2D(source, uv);
  float c = turn.x, s = turn.y;
  // CSS filter functions operate in sRGB, not linear-light RGB. Their color
  // matrices are linear, so premultiplied colors can stay premultiplied if
  // each operation clamps to alpha rather than 1 (including transparent edges).
  vec3 hue = vec3(
    dot(pixel.rgb, vec3(.213 + .787*c - .213*s, .715 - .715*c - .715*s, .072 - .072*c + .928*s)),
    dot(pixel.rgb, vec3(.213 - .213*c + .143*s, .715 + .285*c + .140*s, .072 - .072*c - .283*s)),
    dot(pixel.rgb, vec3(.213 - .213*c - .787*s, .715 - .715*c + .715*s, .072 + .928*c + .072*s))
  );
  hue = clamp(hue, vec3(0.0), vec3(pixel.a));
  float gray = dot(hue, vec3(.213, .715, .072));
  vec3 color = mix(vec3(gray), hue, saturation);
  gl_FragColor = vec4(clamp(color, vec3(0.0), vec3(pixel.a)), pixel.a);
}`;

function createPass(document) {
  if (!document?.createElement) return null;
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl', {
    alpha: true, premultipliedAlpha: true, antialias: false,
    depth: false, stencil: false, preserveDrawingBuffer: false,
    powerPreference: 'low-power',
  });
  if (!gl) return null;
  let resources = null, lost = false, disposed = false, failed = false;
  let width = 0, height = 0, notify;
  const maximum = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE),
    ...gl.getParameter(gl.MAX_VIEWPORT_DIMS));

  function release() {
    if (!resources) return;
    if (resources.texture) gl.deleteTexture(resources.texture);
    if (resources.buffer) gl.deleteBuffer(resources.buffer);
    if (resources.program) gl.deleteProgram(resources.program);
    resources = null;
  }
  function initialize() {
    const shaders = [];
    resources = {};
    try {
      const compile = (type, text) => {
        const shader = gl.createShader(type); shaders.push(shader);
        gl.shaderSource(shader, text); gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('Witch color shader unavailable');
        return shader;
      };
      const program = resources.program = gl.createProgram();
      gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Witch color pass unavailable');
      gl.useProgram(program);
      resources.buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, resources.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, 'position');
      gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      resources.turn = gl.getUniformLocation(program, 'turn');
      resources.saturation = gl.getUniformLocation(program, 'saturation');
      gl.uniform1i(gl.getUniformLocation(program, 'source'), 0);
      resources.texture = gl.createTexture(); gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, resources.texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.disable(gl.DITHER);
      width = height = 0;
    } finally {
      for (const shader of shaders) gl.deleteShader(shader);
    }
  }
  function contextLost(event) {
    event.preventDefault(); lost = true; resources = null;
    if (!disposed) notify?.();
  }
  function contextRestored() {
    if (disposed) return;
    lost = false; failed = false;
    try { initialize(); } catch { release(); failed = true; }
    notify?.();
  }
  function dispose() {
    if (disposed) return;
    disposed = true; notify = undefined;
    canvas.removeEventListener('webglcontextlost', contextLost);
    canvas.removeEventListener('webglcontextrestored', contextRestored);
    release(); gl.getExtension('WEBGL_lose_context')?.loseContext();
    canvas.width = canvas.height = 1;
  }
  try { initialize(); } catch { dispose(); return null; }
  canvas.addEventListener('webglcontextlost', contextLost);
  canvas.addEventListener('webglcontextrestored', contextRestored);
  return {
    dispose,
    render(source, hue, saturation, onInvalidate) {
      notify = typeof onInvalidate === 'function' ? onInvalidate : undefined;
      if (disposed || lost || failed || gl.isContextLost()) return null;
      const w = source.width, h = source.height;
      if (!(w > 0 && h > 0 && w <= maximum && h <= maximum)) return null;
      try {
        if (width !== w || height !== h) {
          canvas.width = width = w; canvas.height = height = h;
          gl.viewport(0, 0, w, h);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        }
        // One source upload and one fullscreen triangle. No pixel readback,
        // CPU pixel loop, buffer allocation, or animation clock per frame.
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
        const angle = (Number.isFinite(hue) ? hue % 360 : 0) * Math.PI / 180;
        gl.uniform2f(resources.turn, Math.cos(angle), Math.sin(angle));
        gl.uniform1f(resources.saturation, Number.isFinite(saturation) ? Math.max(0, saturation) : 1);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        return canvas;
      } catch {
        // A lost context can recover through the existing lifecycle events.
        // Other failures stay quiet instead of reallocating on every frame.
        if (!gl.isContextLost()) { failed = true; release(); }
        return null;
      }
    },
  };
}

/** Fallback for unsupported Canvas2D filters. The source must be an sRGB
 * canvas; consume the returned canvas with drawImage in this same task.
 * One weakly owned pass per source is reused through resize and palette changes.
 * Returns null while WebGL is unavailable/lost; the caller may draw the source.
 * onInvalidate requests a repaint after context loss/restoration, never a loop. */
export function renderWitchColor(source, hue = 0, saturation = 1, onInvalidate) {
  if (!source || typeof source !== 'object') return null;
  let pass = passes.get(source);
  if (pass === undefined) { pass = createPass(source.ownerDocument); passes.set(source, pass); }
  return pass?.render(source, hue, saturation, onInvalidate) ?? null;
}

/** Release this world's GPU resources when its owner is disposed. */
export function disposeWitchColor(source) {
  passes.get(source)?.dispose(); passes.delete(source);
}
