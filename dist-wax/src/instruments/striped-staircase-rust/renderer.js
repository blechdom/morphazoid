import {
  StripedStaircaseRenderer,
  normalizeStaircaseSettings,
} from '../striped-staircase/striped-staircase.js';

const VERTEX_SHADER = `
  attribute vec2 a_position;
  varying vec2 v_uv;
  void main() {
    v_uv = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

// One continuous escape-depth ramp: no stripe period, staircase boundaries or
// moving guide are baked into this view. Voiced paths remain a separate overlay.
const CONTOUR_FRAGMENT_SHADER = `
  precision highp float;
  varying vec2 v_uv;
  uniform sampler2D u_field;
  uniform vec2 u_displayCenter;
  uniform float u_displayScale;
  uniform float u_displayAspect;
  uniform vec2 u_fieldCenter;
  uniform float u_fieldScale;
  uniform float u_fieldAspect;
  uniform float u_fieldMaxIterations;
  uniform float u_startIteration;
  uniform float u_endIteration;
  uniform float u_palette;

  void main() {
    vec2 displayPlane = (v_uv * 2.0 - 1.0) * vec2(u_displayAspect, 1.0);
    vec2 point = u_displayCenter + displayPlane * u_displayScale;
    vec2 fieldPlane = (point - u_fieldCenter) / max(0.00000001, u_fieldScale);
    fieldPlane.x /= max(0.0001, u_fieldAspect);
    vec2 fieldUv = fieldPlane * 0.5 + 0.5;
    vec3 background = vec3(0.012, 0.017, 0.020);
    if (fieldUv.x < 0.0 || fieldUv.x > 1.0 || fieldUv.y < 0.0 || fieldUv.y > 1.0) {
      gl_FragColor = vec4(background, 1.0);
      return;
    }
    vec4 sampled = texture2D(u_field, fieldUv);
    if (sampled.b < 0.5) {
      gl_FragColor = vec4(background, 1.0);
      return;
    }
    float code = floor(sampled.r * 255.0 + 0.5) * 256.0 + floor(sampled.g * 255.0 + 0.5);
    float iteration = code / 65535.0 * u_fieldMaxIterations;
    float depth = clamp((iteration - u_startIteration) / max(1.0, u_endIteration - u_startIteration), 0.0, 1.0);
    float shade = pow(depth, 0.46);
    vec3 low = vec3(0.10, 0.13, 0.14);
    vec3 high = vec3(0.68, 0.73, 0.71);
    if (u_palette > 0.5 && u_palette < 1.5) {
      low = vec3(0.16, 0.08, 0.05);
      high = vec3(0.88, 0.63, 0.38);
    } else if (u_palette > 1.5 && u_palette < 2.5) {
      low = vec3(0.07, 0.10, 0.18);
      high = vec3(0.48, 0.67, 0.88);
    } else if (u_palette > 2.5) {
      low = vec3(0.12);
      high = vec3(0.78);
    }
    vec3 color = mix(low, high, shade);
    float vignette = 1.0 - smoothstep(0.28, 0.93, length((v_uv - 0.5) * vec2(0.82, 1.0)));
    gl_FragColor = vec4(color * mix(0.73, 1.0, vignette), 1.0);
  }
`;

function createContourProgram(gl) {
  const program = gl.createProgram();
  const shaders = [];
  try {
    for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX_SHADER], [gl.FRAGMENT_SHADER, CONTOUR_FRAGMENT_SHADER]]) {
      const shader = gl.createShader(type);
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader) || 'The contour shader could not be compiled.');
      }
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || 'The contour shader could not be linked.');
    }
    return program;
  } catch (error) {
    gl.deleteProgram(program);
    throw error;
  } finally {
    for (const shader of shaders) gl.deleteShader(shader);
  }
}

/** Rust-page-only display option; the original renderer and field are unchanged. */
export class RustStaircaseRenderer extends StripedStaircaseRenderer {
  constructor(canvas) {
    super(canvas);
    this.contourProgram = null;
    this.contourUniforms = null;
  }

  render(frame, settings, camera, depthDirection = 1, palette = 0, options = {}) {
    if (options.showStripes !== false) {
      return super.render(frame, settings, camera, depthDirection, palette);
    }
    const normalized = normalizeStaircaseSettings(settings);
    if (!this.fieldState) this.renderField(camera, normalized.maxIterations);
    const gl = this.gl;
    if (!this.contourProgram) {
      this.contourProgram = createContourProgram(gl);
      this.contourPosition = gl.getAttribLocation(this.contourProgram, 'a_position');
      this.contourUniforms = Object.fromEntries([
        'u_field', 'u_displayCenter', 'u_displayScale', 'u_displayAspect',
        'u_fieldCenter', 'u_fieldScale', 'u_fieldAspect', 'u_fieldMaxIterations',
        'u_startIteration', 'u_endIteration', 'u_palette',
      ].map(name => [name, gl.getUniformLocation(this.contourProgram, name)]));
    }
    const field = this.fieldState, uniforms = this.contourUniforms;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.disable(gl.BLEND);
    gl.useProgram(this.contourProgram);
    this.bindQuad(this.contourPosition);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fieldTexture);
    gl.uniform1i(uniforms.u_field, 0);
    gl.uniform2f(uniforms.u_displayCenter, camera.centerX, camera.centerY);
    gl.uniform1f(uniforms.u_displayScale, camera.scale);
    gl.uniform1f(uniforms.u_displayAspect, this.width / Math.max(1, this.height));
    gl.uniform2f(uniforms.u_fieldCenter, field.centerX, field.centerY);
    gl.uniform1f(uniforms.u_fieldScale, field.scale);
    gl.uniform1f(uniforms.u_fieldAspect, field.aspect);
    gl.uniform1f(uniforms.u_fieldMaxIterations, field.maxIterations);
    gl.uniform1f(uniforms.u_startIteration, normalized.startIteration);
    gl.uniform1f(uniforms.u_endIteration, normalized.maxIterations);
    gl.uniform1f(uniforms.u_palette, Math.max(0, Math.min(3, palette)));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  destroy() {
    if (this.contourProgram) this.gl.deleteProgram(this.contourProgram);
    this.contourProgram = null;
    this.contourUniforms = null;
    super.destroy();
  }
}

export function createRustStaircaseRenderer(canvas) {
  return new RustStaircaseRenderer(canvas);
}
