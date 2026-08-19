const TAU = Math.PI * 2;
const SHADER_ITERATION_LIMIT = 384;

export const STRIPED_STAIRCASE_DEFAULTS = Object.freeze({
  progress: 0.12,
  speed: 0.035,
  motionMode: "steps",
  startIteration: 12,
  maxIterations: 260,
  steps: 24,
  spacingCurve: 1.7,
  stripePeriod: 7,
  edgeSoftness: 0.9,
});

export const STRIPED_STAIRCASE_VIEWS = Object.freeze([
  Object.freeze({
    id: "seahorse",
    label: "Seahorse",
    centerX: -0.74364388703,
    centerY: 0.13182590421,
    scale: 0.018,
  }),
  Object.freeze({
    id: "overview",
    label: "Whole set",
    centerX: -0.55,
    centerY: 0,
    scale: 1.45,
  }),
  Object.freeze({
    id: "cardioid-cusp",
    label: "Cardioid cusp",
    centerX: 0.25,
    centerY: 0,
    scale: 0.16,
  }),
  Object.freeze({
    id: "elephant-broad",
    label: "Elephant valley · broad",
    centerX: 0.285,
    centerY: 0.01,
    scale: 0.028,
  }),
  Object.freeze({
    id: "elephant-archive",
    label: "Elephant valley · Codex archive",
    centerX: 0.285,
    centerY: 0.01,
    scale: 0.11046972125386503,
  }),
  Object.freeze({
    id: "elephant-close",
    label: "Elephant valley · close",
    centerX: 0.27205033514905763,
    centerY: 0.006118038612346085,
    scale: 0.0024031526709817415,
  }),
  Object.freeze({
    id: "seahorse-gallery",
    label: "Seahorse valley · gallery",
    centerX: -0.74519683,
    centerY: 0.101869885,
    scale: 0.0059049,
  }),
  Object.freeze({
    id: "double-spiral",
    label: "Satellite double spiral",
    centerX: -0.743643900055,
    centerY: 0.131825890901,
    scale: 0.0004,
  }),
  Object.freeze({
    id: "spiral",
    label: "Spiral arms",
    centerX: -0.761574,
    centerY: -0.0847596,
    scale: 0.0041,
  }),
  Object.freeze({
    id: "triple-spiral",
    label: "Triple spiral valley",
    centerX: -0.088,
    centerY: 0.654,
    scale: 0.05257478451658221,
  }),
  Object.freeze({
    id: "airplane",
    label: "Airplane",
    centerX: -1.75,
    centerY: 0.02,
    scale: 0.36240023368463636,
  }),
  Object.freeze({
    id: "antenna",
    label: "Antenna",
    centerX: -1.25,
    centerY: 0,
    scale: 0.0820837058591744,
  }),
  Object.freeze({
    id: "needle",
    label: "Mini set",
    centerX: -1.25066,
    centerY: 0.02012,
    scale: 0.0017,
  }),
  Object.freeze({
    id: "period-three",
    label: "Period-three island",
    centerX: -0.122561,
    centerY: 0.744862,
    scale: 0.12,
  }),
  Object.freeze({
    id: "dendrite-needle",
    label: "Dendrite needle",
    centerX: -0.1011,
    centerY: 0.9563,
    scale: 0.010264855411934313,
  }),
  Object.freeze({
    id: "island-field",
    label: "Island field",
    centerX: 0.37865401,
    centerY: 0.669227668,
    scale: 0.04,
  }),
  Object.freeze({
    id: "antenna-filament",
    label: "Antenna filament",
    centerX: -1.749705768080503,
    centerY: -0.0000613369029080495,
    scale: 0.00012,
  }),
]);

export const CAMERA_SCALE_LIMITS = Object.freeze({
  minimum: 0.00008,
  maximum: 2.25,
});

export function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

export function lerp(start, end, amount) {
  return start + (end - start) * amount;
}

export function smoothstep(edge0, edge1, value) {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const amount = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return amount * amount * (3 - 2 * amount);
}

export function normalizeStaircaseSettings(settings = {}) {
  const startIteration = clamp(
    settings.startIteration ?? STRIPED_STAIRCASE_DEFAULTS.startIteration,
    2,
    SHADER_ITERATION_LIMIT - 2,
  );
  const maxIterations = clamp(
    settings.maxIterations ?? STRIPED_STAIRCASE_DEFAULTS.maxIterations,
    startIteration + 2,
    SHADER_ITERATION_LIMIT,
  );
  return Object.freeze({
    startIteration,
    maxIterations,
    steps: Math.round(clamp(settings.steps ?? STRIPED_STAIRCASE_DEFAULTS.steps, 4, 48)),
    spacingCurve: clamp(
      settings.spacingCurve ?? STRIPED_STAIRCASE_DEFAULTS.spacingCurve,
      0.5,
      3,
    ),
    stripePeriod: clamp(
      settings.stripePeriod ?? STRIPED_STAIRCASE_DEFAULTS.stripePeriod,
      0.5,
      32,
    ),
    edgeSoftness: clamp(
      settings.edgeSoftness ?? STRIPED_STAIRCASE_DEFAULTS.edgeSoftness,
      0.05,
      8,
    ),
  });
}

export function staircaseBoundary(index, settings = STRIPED_STAIRCASE_DEFAULTS) {
  const normalized = normalizeStaircaseSettings(settings);
  const boundaryIndex = clamp(Math.round(index), 0, normalized.steps);
  const amount = Math.pow(boundaryIndex / normalized.steps, normalized.spacingCurve);
  return lerp(normalized.startIteration, normalized.maxIterations, amount);
}

export function staircaseBoundaries(settings = STRIPED_STAIRCASE_DEFAULTS) {
  const normalized = normalizeStaircaseSettings(settings);
  return Object.freeze(Array.from(
    { length: normalized.steps + 1 },
    (_, index) => staircaseBoundary(index, normalized),
  ));
}

/**
 * Pure control-rate model for both the renderer and a later sonification layer.
 * No value in this snapshot depends on requestAnimationFrame or GPU readback.
 */
export function createStaircaseFrame(
  progress,
  settings = STRIPED_STAIRCASE_DEFAULTS,
  motionMode = STRIPED_STAIRCASE_DEFAULTS.motionMode,
) {
  const normalized = normalizeStaircaseSettings(settings);
  const amount = clamp(progress, 0, 1);
  const discretePosition = amount * normalized.steps;
  const stepIndex = amount >= 1
    ? normalized.steps - 1
    : Math.min(normalized.steps - 1, Math.floor(discretePosition));
  const stepPhase = amount >= 1 ? 1 : discretePosition - stepIndex;
  const bandLow = staircaseBoundary(stepIndex, normalized);
  const bandHigh = staircaseBoundary(stepIndex + 1, normalized);

  let renderLow = bandLow;
  let renderHigh = bandHigh;
  let slideMix = 0;
  if (motionMode === "slide" && normalized.steps > 1) {
    const slidePosition = amount * (normalized.steps - 1);
    const slideIndex = Math.min(normalized.steps - 2, Math.floor(slidePosition));
    slideMix = amount >= 1 ? 1 : slidePosition - slideIndex;
    renderLow = lerp(
      staircaseBoundary(slideIndex, normalized),
      staircaseBoundary(slideIndex + 1, normalized),
      slideMix,
    );
    renderHigh = lerp(
      staircaseBoundary(slideIndex + 1, normalized),
      staircaseBoundary(slideIndex + 2, normalized),
      slideMix,
    );
  }

  return Object.freeze({
    progress: amount,
    motionMode: motionMode === "slide" ? "slide" : "steps",
    stepIndex,
    stepNumber: stepIndex + 1,
    stepCount: normalized.steps,
    stepPhase,
    slideMix,
    bandLow,
    bandHigh,
    renderLow,
    renderHigh,
    normalizedSettings: normalized,
  });
}

export function advancePingPong(progress, direction, distance) {
  let next = clamp(progress, 0, 1) + (direction < 0 ? -1 : 1) * Math.max(0, Number(distance) || 0);
  let nextDirection = direction < 0 ? -1 : 1;
  while (next > 1 || next < 0) {
    if (next > 1) {
      next = 2 - next;
      nextDirection = -1;
    } else if (next < 0) {
      next = -next;
      nextDirection = 1;
    }
  }
  return Object.freeze({ progress: clamp(next, 0, 1), direction: nextDirection });
}

export function viewById(id) {
  return STRIPED_STAIRCASE_VIEWS.find((view) => view.id === id)
    ?? STRIPED_STAIRCASE_VIEWS[0];
}

export function cameraFromView(view = STRIPED_STAIRCASE_VIEWS[0]) {
  return Object.freeze({
    centerX: Number(view.centerX),
    centerY: Number(view.centerY),
    scale: clamp(view.scale, CAMERA_SCALE_LIMITS.minimum, CAMERA_SCALE_LIMITS.maximum),
  });
}

export function complexPointAt(camera, point, aspect = 1) {
  const x = clamp(point?.x ?? 0.5, 0, 1) * 2 - 1;
  const y = 1 - clamp(point?.y ?? 0.5, 0, 1) * 2;
  return Object.freeze({
    x: camera.centerX + x * Math.max(0.01, aspect) * camera.scale,
    y: camera.centerY + y * camera.scale,
  });
}

export function zoomCameraAt(camera, point, factor, aspect = 1) {
  const anchor = complexPointAt(camera, point, aspect);
  const scale = clamp(
    camera.scale * Math.max(0.02, Number(factor) || 1),
    CAMERA_SCALE_LIMITS.minimum,
    CAMERA_SCALE_LIMITS.maximum,
  );
  const x = clamp(point?.x ?? 0.5, 0, 1) * 2 - 1;
  const y = 1 - clamp(point?.y ?? 0.5, 0, 1) * 2;
  return Object.freeze({
    centerX: anchor.x - x * Math.max(0.01, aspect) * scale,
    centerY: anchor.y - y * scale,
    scale,
  });
}

export function panCamera(camera, deltaX, deltaY, viewportHeight) {
  const height = Math.max(1, Number(viewportHeight) || 1);
  return Object.freeze({
    centerX: camera.centerX - (2 * (Number(deltaX) || 0) / height) * camera.scale,
    centerY: camera.centerY + (2 * (Number(deltaY) || 0) / height) * camera.scale,
    scale: camera.scale,
  });
}

export function formatComplexCoordinate(real, imaginary, digits = 7) {
  const safeDigits = Math.round(clamp(digits, 2, 12));
  const realText = Number(real).toFixed(safeDigits).replace(/\.?0+$/, "") || "0";
  const imaginaryText = Math.abs(Number(imaginary))
    .toFixed(safeDigits)
    .replace(/\.?0+$/, "") || "0";
  return `${realText} ${Number(imaginary) < 0 ? "−" : "+"} ${imaginaryText}i`;
}

export function zoomLevel(camera, overviewScale = viewById("overview").scale) {
  return Math.max(1, Number(overviewScale) / Math.max(CAMERA_SCALE_LIMITS.minimum, camera.scale));
}

/** Follow one reversible exponential zoom path through a selected coordinate. */
export function cameraAtStaircaseDepth(baseCamera, progress, zoomOctaves = 6) {
  const amount = clamp(progress, 0, 1);
  const octaves = clamp(zoomOctaves, 0, 12);
  return Object.freeze({
    centerX: Number(baseCamera.centerX),
    centerY: Number(baseCamera.centerY),
    scale: clamp(
      Number(baseCamera.scale) * 2 ** (-amount * octaves),
      CAMERA_SCALE_LIMITS.minimum,
      CAMERA_SCALE_LIMITS.maximum,
    ),
  });
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || "Unknown shader compile error";
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function createProgram(gl, vertexSource, fragmentSource) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || "Unknown shader link error";
    gl.deleteProgram(program);
    throw new Error(message);
  }
  return program;
}

const VERTEX_SHADER = `
  attribute vec2 a_position;
  varying vec2 v_uv;

  void main() {
    v_uv = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

const FIELD_FRAGMENT_SHADER = `
  precision highp float;

  varying vec2 v_uv;
  uniform vec2 u_center;
  uniform float u_scale;
  uniform float u_aspect;
  uniform float u_maxIterations;

  const int ITERATION_LIMIT = ${SHADER_ITERATION_LIMIT};

  void main() {
    vec2 plane = (v_uv * 2.0 - 1.0) * vec2(u_aspect, 1.0);
    vec2 c = u_center + plane * u_scale;
    vec2 z = vec2(0.0);
    float smoothIteration = u_maxIterations;
    float escaped = 0.0;

    for (int iteration = 0; iteration < ITERATION_LIMIT; iteration += 1) {
      if (float(iteration) >= u_maxIterations) break;
      float xSquared = z.x * z.x;
      float ySquared = z.y * z.y;
      z = vec2(xSquared - ySquared + c.x, 2.0 * z.x * z.y + c.y);
      float magnitudeSquared = dot(z, z);
      if (magnitudeSquared > 256.0) {
        float logMagnitude = 0.5 * log(magnitudeSquared);
        smoothIteration = float(iteration) + 1.0 - log(max(0.000001, logMagnitude)) / log(2.0);
        escaped = 1.0;
        break;
      }
    }

    float code = floor(clamp(smoothIteration / u_maxIterations, 0.0, 1.0) * 65535.0 + 0.5);
    float highByte = floor(code / 256.0);
    float lowByte = code - highByte * 256.0;
    gl_FragColor = vec4(highByte / 255.0, lowByte / 255.0, escaped, 1.0);
  }
`;

function colorFragmentShader(hasDerivatives) {
  const extension = hasDerivatives ? "#extension GL_OES_standard_derivatives : enable" : "";
  const stripeAntialias = hasDerivatives
    ? "clamp(fwidth(stripeCoordinate) * 1.35, 0.003, 0.14)"
    : "0.018";
  return `
    ${extension}
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
    uniform float u_stepCount;
    uniform float u_spacingCurve;
    uniform float u_stripePeriod;
    uniform float u_edgeSoftness;
    uniform float u_bandLow;
    uniform float u_bandHigh;
    uniform float u_stepPhase;
    uniform float u_depthDirection;
    uniform float u_palette;

    float decodeSmooth(vec4 sampledField) {
      float highByte = floor(sampledField.r * 255.0 + 0.5);
      float lowByte = floor(sampledField.g * 255.0 + 0.5);
      return ((highByte * 256.0 + lowByte) / 65535.0) * u_fieldMaxIterations;
    }

    float bandMask(float value, float low, float high, float softness) {
      float leading = smoothstep(low - softness, low + softness, value);
      float trailing = 1.0 - smoothstep(high - softness, high + softness, value);
      return leading * trailing;
    }

    void main() {
      vec2 displayPlane = (v_uv * 2.0 - 1.0) * vec2(u_displayAspect, 1.0);
      vec2 complexPoint = u_displayCenter + displayPlane * u_displayScale;
      vec2 fieldPlane = (complexPoint - u_fieldCenter) / max(0.00000001, u_fieldScale);
      fieldPlane.x /= max(0.0001, u_fieldAspect);
      vec2 fieldUv = fieldPlane * 0.5 + 0.5;
      float inField = step(0.0, fieldUv.x) * step(fieldUv.x, 1.0)
        * step(0.0, fieldUv.y) * step(fieldUv.y, 1.0);

      vec3 background = vec3(0.012, 0.017, 0.020);
      if (inField < 0.5) {
        float grid = 0.035 * (step(0.985, fract(v_uv.x * 26.0)) + step(0.985, fract(v_uv.y * 20.0)));
        gl_FragColor = vec4(background + grid, 1.0);
        return;
      }

      vec4 sampledField = texture2D(u_field, fieldUv);
      if (sampledField.b < 0.5) {
        float interiorGlow = 0.018 * (1.0 - length(v_uv - 0.5));
        gl_FragColor = vec4(background + vec3(0.0, interiorGlow, interiorGlow * 0.75), 1.0);
        return;
      }

      float smoothIteration = decodeSmooth(sampledField);
      float stripeCoordinate = smoothIteration / max(0.5, u_stripePeriod);
      float stripeWidth = ${stripeAntialias};
      float stripe = smoothstep(0.5 - stripeWidth, 0.5 + stripeWidth, fract(stripeCoordinate));
      float depth = clamp(
        (smoothIteration - u_startIteration) / max(1.0, u_endIteration - u_startIteration),
        0.0,
        1.0
      );

      vec3 darkStart = vec3(0.018, 0.027, 0.031);
      vec3 darkEnd = vec3(0.030, 0.041, 0.046);
      vec3 lightStart = vec3(0.72, 0.76, 0.72);
      vec3 lightEnd = vec3(0.50, 0.56, 0.55);
      vec3 contourStart = vec3(0.37, 0.91, 0.77);
      vec3 contourEnd = vec3(0.78, 0.61, 1.0);
      if (u_palette > 0.5 && u_palette < 1.5) {
        darkStart = vec3(0.035, 0.015, 0.012);
        darkEnd = vec3(0.075, 0.025, 0.018);
        lightStart = vec3(1.0, 0.72, 0.30);
        lightEnd = vec3(0.90, 0.22, 0.16);
        contourStart = vec3(1.0, 0.82, 0.34);
        contourEnd = vec3(1.0, 0.28, 0.54);
      } else if (u_palette > 1.5 && u_palette < 2.5) {
        darkStart = vec3(0.010, 0.016, 0.040);
        darkEnd = vec3(0.018, 0.035, 0.080);
        lightStart = vec3(0.30, 0.88, 1.0);
        lightEnd = vec3(0.67, 0.40, 1.0);
        contourStart = vec3(0.24, 0.92, 1.0);
        contourEnd = vec3(0.86, 0.46, 1.0);
      } else if (u_palette > 2.5) {
        darkStart = vec3(0.010, 0.010, 0.010);
        darkEnd = vec3(0.035, 0.035, 0.035);
        lightStart = vec3(0.96, 0.96, 0.92);
        lightEnd = vec3(0.58, 0.58, 0.56);
        contourStart = vec3(1.0, 1.0, 1.0);
        contourEnd = vec3(0.66, 0.66, 0.66);
      }
      vec3 darkStripe = mix(darkStart, darkEnd, depth);
      vec3 lightStripe = mix(lightStart, lightEnd, depth);
      vec3 color = mix(darkStripe, lightStripe, stripe);

      float passed = 1.0 - smoothstep(u_bandLow - 1.4, u_bandLow + 0.4, smoothIteration);
      color = mix(color, color * vec3(0.42, 0.54, 0.52), passed * 0.62);

      float active = bandMask(
        smoothIteration,
        u_bandLow,
        u_bandHigh,
        max(0.05, u_edgeSoftness)
      );
      vec3 activeInk = mix(vec3(0.004, 0.018, 0.020), vec3(0.012, 0.065, 0.059), stripe * 0.58);
      color = mix(color, activeInk, active * 0.94);

      // Invert the monotone exponential staircase instead of testing every
      // boundary. This keeps the animated color pass constant-time per pixel.
      float staircaseCoordinate = pow(depth, 1.0 / max(0.1, u_spacingCurve)) * u_stepCount;
      float nearestStep = clamp(floor(staircaseCoordinate + 0.5), 0.0, u_stepCount);
      float nearestAmount = nearestStep / max(1.0, u_stepCount);
      float nearestBoundary = mix(
        u_startIteration,
        u_endIteration,
        pow(nearestAmount, u_spacingCurve)
      );
      float allContours = 1.0 - smoothstep(
        0.0,
        max(0.055, u_edgeSoftness * 0.16),
        abs(smoothIteration - nearestBoundary)
      );

      vec3 contourColor = mix(contourStart, contourEnd, depth);
      color = mix(color, contourColor, allContours * 0.34);

      float activeLowLine = 1.0 - smoothstep(
        0.0,
        max(0.08, u_edgeSoftness * 0.28),
        abs(smoothIteration - u_bandLow)
      );
      float activeHighLine = 1.0 - smoothstep(
        0.0,
        max(0.08, u_edgeSoftness * 0.28),
        abs(smoothIteration - u_bandHigh)
      );
      color = mix(color, vec3(0.37, 0.91, 0.77), activeLowLine * 0.92);
      color = mix(color, vec3(0.84, 0.91, 0.89), activeHighLine * 0.72);

      float sweepAmount = u_depthDirection > 0.0 ? u_stepPhase : 1.0 - u_stepPhase;
      float sweepDepth = mix(u_bandLow, u_bandHigh, sweepAmount);
      float sweepLine = active * (1.0 - smoothstep(
        0.0,
        max(0.06, u_edgeSoftness * 0.2),
        abs(smoothIteration - sweepDepth)
      ));
      color += vec3(0.28, 0.88, 0.80) * sweepLine * 0.5;

      float vignette = 1.0 - smoothstep(0.28, 0.93, length((v_uv - 0.5) * vec2(0.82, 1.0)));
      color *= mix(0.73, 1.0, vignette);
      gl_FragColor = vec4(color, 1.0);
    }
  `;
}

function uniformLocations(gl, program, names) {
  return Object.fromEntries(names.map((name) => [name, gl.getUniformLocation(program, name)]));
}

export class StripedStaircaseRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
    }) ?? canvas.getContext("experimental-webgl");
    if (!this.gl) throw new Error("WebGL is unavailable in this browser.");

    const gl = this.gl;
    this.hasDerivatives = Boolean(gl.getExtension("OES_standard_derivatives"));
    this.fieldProgram = createProgram(gl, VERTEX_SHADER, FIELD_FRAGMENT_SHADER);
    this.colorProgram = createProgram(gl, VERTEX_SHADER, colorFragmentShader(this.hasDerivatives));
    this.fieldUniforms = uniformLocations(gl, this.fieldProgram, [
      "u_center",
      "u_scale",
      "u_aspect",
      "u_maxIterations",
    ]);
    this.colorUniforms = uniformLocations(gl, this.colorProgram, [
      "u_field",
      "u_displayCenter",
      "u_displayScale",
      "u_displayAspect",
      "u_fieldCenter",
      "u_fieldScale",
      "u_fieldAspect",
      "u_fieldMaxIterations",
      "u_startIteration",
      "u_endIteration",
      "u_stepCount",
      "u_spacingCurve",
      "u_stripePeriod",
      "u_edgeSoftness",
      "u_bandLow",
      "u_bandHigh",
      "u_stepPhase",
      "u_depthDirection",
      "u_palette",
    ]);
    this.fieldPosition = gl.getAttribLocation(this.fieldProgram, "a_position");
    this.colorPosition = gl.getAttribLocation(this.colorProgram, "a_position");
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );

    this.fieldTexture = gl.createTexture();
    this.fieldFramebuffer = gl.createFramebuffer();
    this.fieldState = null;
    this.width = 0;
    this.height = 0;
  }

  bindQuad(attributeLocation) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(attributeLocation);
    gl.vertexAttribPointer(attributeLocation, 2, gl.FLOAT, false, 0, 0);
  }

  resize(width, height) {
    const nextWidth = Math.max(1, Math.round(width));
    const nextHeight = Math.max(1, Math.round(height));
    if (nextWidth === this.width && nextHeight === this.height) return false;
    this.width = nextWidth;
    this.height = nextHeight;
    this.canvas.width = nextWidth;
    this.canvas.height = nextHeight;

    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.fieldTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      nextWidth,
      nextHeight,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fieldFramebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.fieldTexture,
      0,
    );
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error("The fractal field framebuffer could not be created.");
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.fieldState = null;
    return true;
  }

  renderField(camera, maxIterations) {
    const gl = this.gl;
    const boundedIterations = clamp(maxIterations, 8, SHADER_ITERATION_LIMIT);
    const aspect = this.width / Math.max(1, this.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fieldFramebuffer);
    gl.viewport(0, 0, this.width, this.height);
    gl.disable(gl.BLEND);
    gl.useProgram(this.fieldProgram);
    this.bindQuad(this.fieldPosition);
    gl.uniform2f(this.fieldUniforms.u_center, camera.centerX, camera.centerY);
    gl.uniform1f(this.fieldUniforms.u_scale, camera.scale);
    gl.uniform1f(this.fieldUniforms.u_aspect, aspect);
    gl.uniform1f(this.fieldUniforms.u_maxIterations, boundedIterations);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.fieldState = Object.freeze({
      centerX: camera.centerX,
      centerY: camera.centerY,
      scale: camera.scale,
      aspect,
      maxIterations: boundedIterations,
    });
  }

  render(frame, settings, camera, depthDirection = 1, palette = 0) {
    const normalized = normalizeStaircaseSettings(settings);
    if (!this.fieldState) this.renderField(camera, normalized.maxIterations);
    const field = this.fieldState;
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.disable(gl.BLEND);
    gl.useProgram(this.colorProgram);
    this.bindQuad(this.colorPosition);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fieldTexture);
    gl.uniform1i(this.colorUniforms.u_field, 0);
    gl.uniform2f(this.colorUniforms.u_displayCenter, camera.centerX, camera.centerY);
    gl.uniform1f(this.colorUniforms.u_displayScale, camera.scale);
    gl.uniform1f(this.colorUniforms.u_displayAspect, this.width / Math.max(1, this.height));
    gl.uniform2f(this.colorUniforms.u_fieldCenter, field.centerX, field.centerY);
    gl.uniform1f(this.colorUniforms.u_fieldScale, field.scale);
    gl.uniform1f(this.colorUniforms.u_fieldAspect, field.aspect);
    gl.uniform1f(this.colorUniforms.u_fieldMaxIterations, field.maxIterations);
    gl.uniform1f(this.colorUniforms.u_startIteration, normalized.startIteration);
    gl.uniform1f(this.colorUniforms.u_endIteration, normalized.maxIterations);
    gl.uniform1f(this.colorUniforms.u_stepCount, normalized.steps);
    gl.uniform1f(this.colorUniforms.u_spacingCurve, normalized.spacingCurve);
    gl.uniform1f(this.colorUniforms.u_stripePeriod, normalized.stripePeriod);
    gl.uniform1f(this.colorUniforms.u_edgeSoftness, normalized.edgeSoftness);
    gl.uniform1f(this.colorUniforms.u_bandLow, frame.renderLow);
    gl.uniform1f(this.colorUniforms.u_bandHigh, frame.renderHigh);
    gl.uniform1f(this.colorUniforms.u_stepPhase, frame.stepPhase);
    gl.uniform1f(this.colorUniforms.u_depthDirection, depthDirection < 0 ? -1 : 1);
    gl.uniform1f(this.colorUniforms.u_palette, clamp(palette, 0, 3));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  destroy() {
    const gl = this.gl;
    gl.deleteFramebuffer(this.fieldFramebuffer);
    gl.deleteTexture(this.fieldTexture);
    gl.deleteBuffer(this.quad);
    gl.deleteProgram(this.fieldProgram);
    gl.deleteProgram(this.colorProgram);
    this.fieldState = null;
  }
}

export function createStripedStaircaseRenderer(canvas) {
  return new StripedStaircaseRenderer(canvas);
}

export { SHADER_ITERATION_LIMIT, TAU };
