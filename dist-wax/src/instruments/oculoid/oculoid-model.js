// One bounded preset state drives the eye/lid loops and their short audio events.
export const TAU = Math.PI * 2;
export const OCULOID_EYEBALL_STYLES = Object.freeze([
  Object.freeze({ id: "still", label: "Still" }),
  Object.freeze({ id: "drift", label: "Drift" }),
  Object.freeze({ id: "flutter", label: "Tremble" }),
  Object.freeze({ id: "wild", label: "Wild eyes" }),
  Object.freeze({ id: "drowse", label: "Drowse" }),
  Object.freeze({ id: "pupil", label: "Pupil pulse" }),
]);
export const OCULOID_EYELID_STYLES = Object.freeze([
  Object.freeze({ id: "still", label: "Still" }),
  Object.freeze({ id: "blink", label: "Blink" }),
  Object.freeze({ id: "flutter", label: "Flutter" }),
  Object.freeze({ id: "wild", label: "Wild blink" }),
  Object.freeze({ id: "drowse", label: "Drowse" }),
  Object.freeze({ id: "lid-flutter", label: "Lid flutter" }),
]);
const eyeballStyleIds = new Set(OCULOID_EYEBALL_STYLES.map(style => style.id));
const eyelidStyleIds = new Set(OCULOID_EYELID_STYLES.map(style => style.id));
// Old single-style snapshots still recall the same paired movements.
const legacyMotion = Object.freeze({
  drift: ["drift", "blink"], flutter: ["flutter", "flutter"],
  wild: ["wild", "wild"], drowse: ["drowse", "drowse"],
  pupil: ["pupil", "still"], "lid-flutter": ["still", "lid-flutter"],
});
export const OCULOID_DEFAULTS = Object.freeze({
  gazeX: 0, gazeY: 0, blink: 0.04, lowerLid: 0, pupil: 0.42,
  tempo: 84, lidRate: 1, motion: 0.5, eyeballStyle: "drift", eyelidStyle: "blink", rootHz: 112,
  tone: 0.42, air: 0.24, wetness: 0.5, veins: 0.38, irisTint: 0.46,
});

export const OCULOID_RANGES = Object.freeze({
  gazeX: [-1, 1], gazeY: [-1, 1], blink: [-1, 1], lowerLid: [-1, 1], pupil: [0, 1],
  tempo: [35, 200], lidRate: [0.5, 2], motion: [0, 1], rootHz: [55, 330],
  tone: [0, 1], air: [0, 1], wetness: [0, 1], veins: [0, 1], irisTint: [0, 1],
});
// Cry has its own live clock; extending it must not speed up preset-owned eye motion.
export const OCULOID_CRY_TEMPO_RANGE = Object.freeze([35, 800]);

export const OCULOID_ENSEMBLES = Object.freeze([
  Object.freeze({ id: "together", label: "Together" }),
  Object.freeze({ id: "banter", label: "Banter" }),
  Object.freeze({ id: "harmony", label: "Harmony" }),
  Object.freeze({ id: "rock", label: "Rock out" }),
]);
const ensembleIds = new Set(OCULOID_ENSEMBLES.map(style => style.id));
export function normalizeOculoidEnsemble(style) {
  return ensembleIds.has(style) ? style : "banter";
}

const sonicProps = Object.freeze(["tongue", "teeth", "mustache", "lipstick",
  "cigar", "sunglasses", "coat", "scarf", "catEars", "humanEars",
  "bowTie", "headband"]);
/** Only these live accessories reach the worklet; geometry and color pickers
 * do not. Dressing up never creates a voice or arms Audio. */
export function oculoidSonicWardrobe(value) {
  const disguise = value?.groucho === true;
  return {
    ...Object.fromEntries(sonicProps.map(key => [key,
      value?.[key] === true || disguise && (key === "sunglasses" || key === "mustache")])),
    hat: ["top", "cowboy", "frosting", "cherry", "cat"].includes(value?.hat)
      ? value.hat : "none",
    hair: ["mullet", "mom-bob"].includes(value?.hair) ? value.hair : "none",
  };
}

// The studio is a visual viewpoint, not part of the musical preset or audio state.
export const OCULOID_LIGHT_DEFAULTS = Object.freeze({
  finish: "chrome", color: "#f2f1ef", pattern: "solid", lightPattern: "none", reflection: 1,
  keyAzimuth: -27, keyElevation: 30, fillAzimuth: 53, fillElevation: -22,
  keyBrightness: 1,
});
export const OCULOID_LIGHT_RANGES = Object.freeze({
  keyAzimuth: [-140, 140], keyElevation: [-75, 75],
  fillAzimuth: [-140, 140], fillElevation: [-75, 75],
  keyBrightness: [0, 2], reflection: [0, 2],
});

// Visual-only palettes; the imported textures are never overwritten on disk.
export const OCULOID_APPEARANCE_DEFAULTS = Object.freeze({
  eyeLook: "textured", irisColor: "violet", irisPattern: "natural",
  scleraColor: "pearl", scleraPattern: "solid", scleraPatternColor: "#35274e",
});
export const OCULOID_EYE_LOOKS = Object.freeze(["textured", "ink"]);
export const OCULOID_IRIS_COLORS = Object.freeze([
  { id: "original", label: "Original sea glass", swatch: 0x658b84 },
  { id: "brown", label: "Dark brown", swatch: 0x784523 },
  { id: "hazel", label: "Hazel", swatch: 0x9a8450 },
  { id: "amber", label: "Amber", swatch: 0xc58a35 },
  { id: "green", label: "Leaf green", swatch: 0x43b447 },
  { id: "blue", label: "Deep blue", swatch: 0x235ae8 },
  { id: "gray", label: "Slate gray", swatch: 0x8b9497 },
  { id: "violet", label: "Violet", swatch: 0x9876b8 },
  { id: "pink", label: "Neon pink", swatch: 0xff37b0 },
  { id: "cyan", label: "Electric cyan", swatch: 0x18eef3 },
  { id: "lime", label: "Acid lime", swatch: 0xa6f522 },
  { id: "red", label: "Ember red", swatch: 0xe13b28 },
  { id: "black", label: "Blackout", swatch: 0x020205 },
].map(Object.freeze));
export const OCULOID_IRIS_PATTERNS = Object.freeze(["natural", "stripes", "rings", "dots"]);
export const OCULOID_SCLERA_PATTERNS = Object.freeze(["solid", "dots", "stripes", "checker"]);
export const OCULOID_SCLERA_COLORS = Object.freeze([
  { id: "natural", label: "Natural", tint: 0xffffff },
  { id: "ivory", label: "Ivory", tint: 0xffe9d4 },
  { id: "rose", label: "Blush", tint: 0xffd5d7 },
  { id: "pearl", label: "Pearl", tint: 0xe2e6eb },
  { id: "ink", label: "Ink black", tint: 0x20202d },
  { id: "orchid", label: "Orchid", tint: 0xb47ce6 },
  { id: "mint", label: "Radioactive mint", tint: 0x62f0ac },
  { id: "cobalt", label: "Cobalt", tint: 0x4083ed },
  { id: "coral", label: "Coral", tint: 0xfb5974 },
].map(Object.freeze));
export const OCULOID_SKIN_FINISHES = Object.freeze([
  { id: "chrome", label: "Mirror chrome", metal: true },
  { id: "matte", label: "Matte", metal: false },
  { id: "wet", label: "Wet glaze", metal: false },
  { id: "gooey", label: "Gooey", metal: false },
  { id: "clumpy", label: "Clumpy", metal: false },
].map(Object.freeze));
export const OCULOID_SKIN_PATTERNS = Object.freeze(["solid", "stripes", "plaid", "dots", "checker"]);
export const OCULOID_LIGHT_PATTERNS = Object.freeze(["none", "checker", "dots", "stripes", "ripples"]);

export function hexEyeColor(value, fallback = "#9876b8") {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toLowerCase() : fallback;
}

const IRIS_DOT_RINGS = [[0.34, 9], [0.61, 15], [0.84, 21]];
/** Recolor the licensed iris texture at runtime, retaining every fiber's
 * luminance and alpha. With GLTF flipY=false the iris's high-V 0.268 UV
 * square samples the bottom-left corner of its bitmap atlas. */
export function colorizeIrisPixels(source, swatch, { width = source.length / 4,
  atlas = false, pattern = "natural" } = {}) {
  if (!ArrayBuffer.isView(source) || source.length % 4 || !Number.isInteger(swatch)
    || swatch < 0 || swatch > 0xffffff) throw new TypeError("RGBA pixels and a color are required");
  if (!Number.isInteger(width) || width < 1 || (source.length / 4) % width !== 0
    || !OCULOID_IRIS_PATTERNS.includes(pattern)) throw new TypeError("Invalid iris image or pattern");
  const rgb = [(swatch >> 16) & 255, (swatch >> 8) & 255, swatch & 255];
  const tinted = new Uint8ClampedArray(source);
  const height = source.length / 4 / width;
  const xLimit = atlas ? Math.ceil(width * 0.269) : width;
  const yStart = atlas ? Math.floor(height * 0.731) : 0;
  for (let y = yStart; y < height; y++) for (let x = 0; x < xLimit; x++) {
    const i = (y * width + x) * 4;
    const luma = (0.299 * source[i] + 0.587 * source[i + 1] + 0.114 * source[i + 2]) / 255;
    let shade = 0.20 + 1.25 * Math.pow(luma, 0.82);
    if (pattern !== "natural") {
      const dx = ((x + 0.5) / width - (atlas ? 0.134 : 0.5)) / (atlas ? 0.134 : 0.5);
      const dy = ((y + 0.5) / height - (atlas ? 0.866 : 0.5)) / (atlas ? 0.134 : 0.5);
      if (pattern === "dots") {
        const r = Math.hypot(dx, dy), angle = Math.atan2(dy, dx);
        let spotted = false;
        for (let row = 0; row < IRIS_DOT_RINGS.length; row++) {
          const [radius, count] = IRIS_DOT_RINGS[row];
          const delta = angle - Math.round((angle - row * 0.21) * count / TAU)
            * TAU / count - row * 0.21;
          if (Math.hypot(r * Math.sin(delta), r * Math.cos(delta) - radius) < 0.085) {
            spotted = true;
            break;
          }
        }
        shade *= spotted ? 1.4 : 0.27;
      } else {
        const line = pattern === "stripes"
          ? Math.cos(14 * Math.atan2(dy, dx) + 3 * Math.hypot(dx, dy))
          : Math.cos(24 * Math.hypot(dx, dy));
        shade *= line > 0.15 ? 1.18 : 0.19;
      }
    }
    for (let channel = 0; channel < 3; channel++) tinted[i + channel] = rgb[channel] * shade;
  }
  return tinted;
}

export const MAX_EYE_TURN = 90; // degrees in either direction: only the front hemisphere

export function clampEye(value, min, max, fallback = min) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

// Poking is live expression, not a preset or a new sustained oscillator.
// Work in the rotating globe's *local* space so a dent follows its texture,
// veins and iris when the gaze or whole-eye viewpoint changes.
export const OCULOID_POKE_HOME = Object.freeze({
  x: 0.58, y: 0.04, z: Math.sqrt(1 - 0.58 ** 2 - 0.04 ** 2),
});
// Diameters are fractions of the globe's diameter (and thus radii in
// normalized globe coordinates). Studio lighting and these live tools are
// outside the musical preset state.
export const OCULOID_SURFACE_DEFAULTS = Object.freeze({
  pokeDiameter: 0.42, pokeDepth: 1, flashDiameter: 0.43,
});
export const OCULOID_SURFACE_RANGES = Object.freeze({
  pokeDiameter: [0.12, 0.92], pokeDepth: [0, 1.5], flashDiameter: [0.12, 1.2],
});
export function normalizeOculoidSurface(value = {}) {
  return Object.fromEntries(Object.entries(OCULOID_SURFACE_RANGES).map(([key, [min, max]]) =>
    [key, clampEye(value?.[key], min, max, OCULOID_SURFACE_DEFAULTS[key])]));
}

export function oculoidPokeContact(value) {
  const { x, y, z } = value ?? {};
  if (![x, y, z].every(Number.isFinite) || z <= 0) return OCULOID_POKE_HOME;
  const radius = Math.hypot(x, y, z);
  return radius > 0.1 ? { x: x / radius, y: y / radius, z: z / radius } : OCULOID_POKE_HOME;
}

/** Signed displacement along the contact normal in normalized globe units.
 * A smooth compact kernel dents the center and slightly lifts the near rim;
 * neither the opposite side nor the eyelid geometry is displaced. */
export function oculoidPokeDisplacement(x, y, z, contact, depth,
  diameter = OCULOID_SURFACE_DEFAULTS.pokeDiameter) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return 0;
  const amount = clampEye(depth, -0.12, 1.08, 0);
  if (!amount || !contact) return 0;
  const { x: cx, y: cy, z: cz } = contact;
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(cz)) return 0;
  const along = x * cx + y * cy + z * cz;
  if (along <= 0) return 0;
  const dx = x - along * cx, dy = y - along * cy, dz = z - along * cz;
  const radius = clampEye(diameter, ...OCULOID_SURFACE_RANGES.pokeDiameter,
    OCULOID_SURFACE_DEFAULTS.pokeDiameter);
  const r2 = (dx * dx + dy * dy + dz * dz) / (radius ** 2);
  if (r2 >= 1) return 0;
  const taper = 1 - r2;
  return 0.21 * amount * (-(taper ** 3) + 0.12 * r2 * taper ** 2);
}

/** A small elastic patch follows a tangent drag; the opposite globe and
 * eyelid shell stay exactly where they were. */
export function oculoidStretchWeight(x, y, z, contact) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)
    || !Number.isFinite(contact?.x) || !Number.isFinite(contact?.y)
    || !Number.isFinite(contact?.z)) return 0;
  const along = x * contact.x + y * contact.y + z * contact.z;
  if (along <= 0) return 0;
  const r2 = ((x - along * contact.x) ** 2 + (y - along * contact.y) ** 2
    + (z - along * contact.z) ** 2) / 0.55 ** 2;
  return r2 >= 1 ? 0 : (1 - r2) ** 2;
}

export const OCULOID_STRETCH_LIMIT = 0.25;
/** A grip can only pull a short distance, including a diagonal drag. */
export function boundedOculoidStretch(x, y) {
  const dx = clampEye(x, -1, 1, 0), dy = clampEye(y, -1, 1, 0);
  const scale = Math.min(1, OCULOID_STRETCH_LIMIT / (Math.hypot(dx, dy) || 1));
  return { x: dx * scale, y: dy * scale };
}

/** Frame-rate independent tangent-stretch return spring; bounded even after a stalled RAF. */
export function stepOculoidElastic(spring = {}, target = {}, seconds = 0, limit = 0.42) {
  const bound = clampEye(limit, 0.01, 1.6, 0.42);
  let x = clampEye(spring.x, -bound, bound, 0);
  let y = clampEye(spring.y, -bound, bound, 0);
  let vx = clampEye(spring.vx, -18, 18, 0);
  let vy = clampEye(spring.vy, -18, 18, 0);
  const tx = clampEye(target.x, -bound, bound, 0);
  const ty = clampEye(target.y, -bound, bound, 0);
  const elapsed = clampEye(seconds, 0, 0.12, 0);
  const steps = Math.max(1, Math.ceil(elapsed / 0.008)), h = elapsed / steps;
  for (let i = 0; i < steps; i++) {
    vx += ((tx - x) * 260 - vx * 24) * h;
    vy += ((ty - y) * 260 - vy * 24) * h;
    x = clampEye(x + vx * h, -bound, bound, 0);
    y = clampEye(y + vy * h, -bound, bound, 0);
  }
  if (!tx && !ty && Math.hypot(x, y) < 0.0005 && Math.hypot(vx, vy) < 0.008)
    return { x: 0, y: 0, vx: 0, vy: 0 };
  return { x, y, vx, vy };
}

/** Frame-rate-independent bounded spring, substepped for 12-fps software GL. */
export function stepOculoidPoke(spring = {}, target = 0, seconds = 0) {
  let depth = clampEye(spring.depth, -0.12, 1.08, 0);
  let velocity = clampEye(spring.velocity, -18, 18, 0);
  const elapsed = clampEye(seconds, 0, 0.12, 0), wanted = clampEye(target, 0, 1, 0);
  const steps = Math.max(1, Math.ceil(elapsed / 0.008)), h = elapsed / steps;
  for (let i = 0; i < steps; i++) {
    velocity += ((wanted - depth) * 370 - velocity * 27) * h;
    depth += velocity * h;
  }
  depth = clampEye(depth, -0.12, 1.08, 0);
  velocity = clampEye(velocity, -18, 18, 0);
  if (!wanted && Math.abs(depth) < 0.0005 && Math.abs(velocity) < 0.008)
    return { depth: 0, velocity: 0 };
  return { depth, velocity };
}

/** Artistic flashlight response, not a physiological pupil model. Only a
 * visible hit on the iris can constrict the pupil; the raycast owns lid
 * occlusion, while this radial falloff keeps edge hits gentle. */
export function oculoidFlashlightExposure(contact) {
  if (!contact || ![contact.x, contact.y, contact.z].every(Number.isFinite)
    || contact.z < 0.45) return 0;
  const distance = Math.hypot(contact.x, contact.y);
  const t = clampEye((distance - 0.29) / 0.26, 0, 1);
  return 1 - t * t * (3 - 2 * t);
}

export function oculoidLitPupil(pupil, exposure) {
  return clampEye(pupil, 0, 1, OCULOID_DEFAULTS.pupil)
    * (1 - 0.84 * clampEye(exposure, 0, 1, 0));
}

export function normalizeOculoidLighting(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    finish: OCULOID_SKIN_FINISHES.some(item => item.id === source.finish)
      ? source.finish : OCULOID_LIGHT_DEFAULTS.finish,
    color: hexEyeColor(source.color ?? source.customColor, OCULOID_LIGHT_DEFAULTS.color),
    pattern: OCULOID_SKIN_PATTERNS.includes(source.pattern)
      ? source.pattern : OCULOID_LIGHT_DEFAULTS.pattern,
    lightPattern: OCULOID_LIGHT_PATTERNS.includes(source.lightPattern)
      ? source.lightPattern : OCULOID_LIGHT_DEFAULTS.lightPattern,
    ...Object.fromEntries(Object.entries(OCULOID_LIGHT_RANGES).map(([key, [min, max]]) =>
      [key, clampEye(source[key], min, max, OCULOID_LIGHT_DEFAULTS[key])])),
  };
}

// Reference samples for the antialiased sphere-local shader. More, smaller
// dots preserve round spots across the moving lids and the back hemisphere.
const polkaRows = Array.from({ length: 17 }, (_, index) => {
  const latitude = (index - 8) * Math.PI / 16;
  return { latitude, count: Math.max(4, Math.round(30 * Math.cos(latitude))),
    offset: index % 2 ? 0.5 : 0 };
});
function spherePolkaShade(x, y, z) {
  const latitude = Math.atan2(y, Math.hypot(x, z));
  const longitude = Math.atan2(z, x);
  const row = Math.round(latitude * 16 / Math.PI + 8);
  for (let i = Math.max(0, row - 1); i <= Math.min(polkaRows.length - 1, row + 1); i++) {
    const { latitude: center, count, offset } = polkaRows[i];
    const turns = longitude * count / TAU - offset;
    const delta = (turns - Math.round(turns)) * TAU / count;
    const dot = Math.sin(latitude) * Math.sin(center)
      + Math.cos(latitude) * Math.cos(center) * Math.cos(delta);
    if (dot > Math.cos(0.063)) return 0.16;
  }
  return 1;
}

/** Sample sphere-local longitude/latitude, never each patch's independent UVs.
 * The front lids, rounded lips, fused side caps and back therefore share the
 * same repeating finish even while the margins deform. */
export function lidPatternShade(x, y, z, pattern = "solid") {
  if (pattern === "solid") return 1;
  const longitude = Math.atan2(z, x);
  const latitude = Math.atan2(y, Math.hypot(x, z));
  if (pattern === "dots") return spherePolkaShade(x, y, z);
  const vertical = Math.cos(12 * longitude) > 0.08;
  if (pattern === "stripes") return vertical ? 1 : 0.27;
  const horizontal = Math.cos(16 * latitude) > 0.36;
  if (pattern === "plaid") return (vertical ? 1 : 0.44) * (horizontal ? 1 : 0.45);
  if (pattern === "checker") return Math.cos(12 * longitude) * Math.cos(12 * latitude) > 0 ? 1 : 0.22;
  return 1;
}

/** Reference for the globe's antialiased sphere-local shader, not its UV atlas. */
export function eyeballPatternShade(x, y, z, pattern = "solid") {
  if (pattern === "dots") return spherePolkaShade(x, y, z);
  if (pattern === "stripes")
    return Math.cos(12 * Math.atan2(z, x)) > 0.08 ? 1 : 0.22;
  if (pattern === "checker")
    return Math.cos(12 * Math.atan2(z, x))
      * Math.cos(12 * Math.atan2(y, Math.hypot(x, z))) > 0 ? 1 : 0.22;
  return 1;
}

/** Orbit a real light around the eye, with the angle limits shared by the pad
 * and keyboard knobs. Negative azimuth faces viewer-left. */
export function oculoidLightPosition(azimuth, elevation, distance = 7) {
  const yaw = clampEye(azimuth, -140, 140, 0) * Math.PI / 180;
  const pitch = clampEye(elevation, -75, 75, 0) * Math.PI / 180;
  const radius = clampEye(distance, 0.01, 100, 7);
  return [radius * Math.sin(yaw) * Math.cos(pitch),
    radius * Math.sin(pitch), radius * Math.cos(yaw) * Math.cos(pitch)];
}

/** Camera-like inspection of the whole rig, independent of the musical gaze. */
export function boundedEyeTurn(yaw = 0, pitch = 0) {
  return {
    yaw: clampEye(yaw, -MAX_EYE_TURN, MAX_EYE_TURN, 0),
    pitch: clampEye(pitch, -MAX_EYE_TURN, MAX_EYE_TURN, 0),
  };
}

export function normalizeOculoid(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const [legacyEyeball, legacyEyelid] = Object.hasOwn(legacyMotion, source.motionStyle)
    ? legacyMotion[source.motionStyle] : [];
  return {
    ...Object.fromEntries(Object.entries(OCULOID_RANGES).map(([key, [min, max]]) =>
      [key, clampEye(source[key], min, max, OCULOID_DEFAULTS[key])])),
    eyeballStyle: eyeballStyleIds.has(source.eyeballStyle) ? source.eyeballStyle
      : legacyEyeball ?? OCULOID_DEFAULTS.eyeballStyle,
    eyelidStyle: eyelidStyleIds.has(source.eyelidStyle) ? source.eyelidStyle
      : legacyEyelid ?? OCULOID_DEFAULTS.eyelidStyle,
  };
}

function blinkAt(beat, center) {
  const distance = Math.abs(beat - center);
  const triangle = Math.max(0, 1 - distance / 0.19);
  return triangle * triangle * (3 - 2 * triangle);
}

const wave = (beat, cycles, offset = 0) => Math.sin(TAU * (beat * cycles + offset));
const ease = value => {
  const t = clampEye(value, 0, 1);
  return t * t * (3 - 2 * t);
};
const pulse = (beat, cycles, offset, edge) =>
  ease((wave(beat, cycles, offset) - edge) / (1 - edge));

/** Each part chooses its own continuously curved oscillator. At 1x their
 * combination repeats after eight beats; no steps or probability sequence. */
function eyeballMotionAt(style, beat) {
  if (style === "still") return { x: 0, y: 0, pupil: 0 };
  if (style === "pupil") {
    return { x: 0, y: 0, pupil: 0.48 * wave(beat, 0.25, -0.25) };
  }
  if (style === "flutter") {
    return {
      x: 0.22 * wave(beat, 1.25, 0.11) + 0.12 * wave(beat, 0.5, 0.3),
      y: 0.15 * wave(beat, 0.75, 0.3),
      pupil: 0.06 * wave(beat, 1, -0.08),
    };
  }
  if (style === "wild") {
    return {
      x: 0.78 * Math.tanh(2.6 * (wave(beat, 0.75, 0.11) + 0.4 * wave(beat, 1.25, 0.42))),
      y: 0.57 * Math.tanh(2.1 * (wave(beat, 1.25, 0.1) + 0.25 * wave(beat, 0.5, 0.32))),
      pupil: 0.14 * wave(beat, 1.5, 0.22),
    };
  }
  if (style === "drowse") {
    const heavy = ease(0.5 - 0.5 * Math.cos(TAU * beat / 8));
    return {
      x: 0.27 * wave(beat, 0.125),
      y: -0.22 * heavy + 0.08 * wave(beat, 0.125, 0.1),
      pupil: -0.09 * heavy,
    };
  }
  return {
    x: 0.47 * Math.sin(beat * Math.PI / 4),
    y: 0.27 * Math.sin(beat * Math.PI / 2 + 0.6),
    pupil: 0.085 * Math.sin(beat * Math.PI / 2 - 0.4),
  };
}

function eyelidMotionAt(style, beat) {
  if (style === "still") return { upper: 0, lower: 0 };
  if (style === "lid-flutter") {
    return {
      upper: 0.98 * pulse(beat, 1.5, 0.03, 0.28),
      lower: -0.22 * pulse(beat, 1.5, 0.17, 0.05)
        + 0.08 * wave(beat, 0.5, 0.12),
    };
  }
  if (style === "flutter") {
    const accent = 0.8 + 0.2 * (0.5 + 0.5 * wave(beat, 0.25, -0.15));
    return {
      upper: 0.98 * accent * pulse(beat, 1.5, 0.03, 0.28),
      lower: -0.22 * pulse(beat, 1.5, 0.17, 0.05) + 0.08 * wave(beat, 0.5, 0.12),
    };
  }
  if (style === "wild") return {
    upper: 0.99 * pulse(beat, 1.5, 0.02, -0.05),
    lower: -0.28 * pulse(beat, 0.75, 0.18, -0.1) + 0.12 * wave(beat, 1.5, 0.13),
  };
  if (style === "drowse") {
    const heavy = ease(0.5 - 0.5 * Math.cos(TAU * beat / 8));
    return { upper: 0.97 * heavy, lower: -0.31 * heavy };
  }
  const four = ((beat % 4) + 4) % 4;
  return { upper: Math.max(blinkAt(four, 0.74), blinkAt(four, 3.17) * 0.82), lower: 0 };
}

/** Both beats are audio-clock beats, not animation frames. The lid clock may
 * advance at another rate without jumping when the performer edits it. */
export function eyePose(config, beat = 0, playing = false, lidBeat = beat) {
  const state = normalizeOculoid(config);
  const phase = Math.max(0, Number.isFinite(beat) ? beat : 0);
  const lidPhase = Math.max(0, Number.isFinite(lidBeat) ? lidBeat : 0);
  const amount = playing ? state.motion : 0;
  const globe = amount ? eyeballMotionAt(state.eyeballStyle, phase) : { x: 0, y: 0, pupil: 0 };
  const lids = amount ? eyelidMotionAt(state.eyelidStyle, lidPhase) : { upper: 0, lower: 0 };
  return {
    gazeX: clampEye(state.gazeX + amount * globe.x, -1, 1),
    gazeY: clampEye(state.gazeY + amount * globe.y, -1, 1),
    blink: clampEye(state.blink + (1 - state.blink) * amount * lids.upper, -1, 1),
    lowerLid: clampEye(state.lowerLid + amount * lids.lower, -1, 1),
    pupil: clampEye(state.pupil + amount * globe.pupil, 0, 1),
  };
}

/** A live lid retractor changes the *performed* pose, never the knob/preset
 * state underneath it. Both audio and viewer use this same override. */
export function eyePoseWithRetractor(pose, retracted = false) {
  return retracted ? { ...pose, blink: -1, lowerLid: 1 } : pose;
}

// Both the globe and the enclosing skin use a true sphere, with no depth
// flattening. The imported globe's largest normalized vertex radius is 1.0524;
// its 1.07-radius spherical envelope encloses it at every gaze angle.
export const GLOBE_SQUASH = 1;
export const GLOBE_HULL_RADIUS = 1.07;
export const LID_SHELL_RADIUS = 1.14;
// Alternate visual layouts share the same spherical socket. Preserve the
// The pair, triangle and square touch; higher counts use compact offset rows
// with a shallow depth weave, rather than tiny globes in three sparse tiers.
export const OCULOID_EYE_COUNTS = Object.freeze(
  Array.from({ length: 12 }, (_, index) => index + 1));
const PAIR_SIZE = 0.53, TRIANGLE_SIZE = 0.47, SQUARE_SIZE = 0.44;
const triangleY = 0.03;
const PACKED_ROWS = Object.freeze({
  5: { rows: [2, 3], across: 0.69, between: 0.595, lift: -0.06, depth: 0.08 },
  6: { rows: [3, 3], across: 0.63, between: 0.605, lift: 0.04, depth: 0.16 },
  7: { rows: [2, 3, 2], across: 0.70, between: 0.605, lift: 0.04, depth: 0.08 },
  8: { rows: [4, 4], across: 0.48, between: 0.525, lift: 0, depth: 0.20 },
  9: { rows: [3, 3, 3], across: 0.57, between: 0.48, lift: 0, depth: 0.20 },
  10: { rows: [3, 4, 3], across: 0.525, between: 0.535, lift: 0, depth: 0.16 },
  11: { rows: [3, 4, 4], across: 0.45, between: 0.48, lift: 0, depth: 0.16 },
  12: { rows: [4, 4, 4], across: 0.45, between: 0.42, lift: 0.06, depth: 0.16 },
});
function packedEyeCluster(count) {
  const { rows, across, between, lift, depth } = PACKED_ROWS[count];
  const points = rows.flatMap((columns, row) =>
    Array.from({ length: columns }, (_, column) => ({
      x: (column - (columns - 1) / 2) * across,
      y: (row - (rows.length - 1) / 2) * between + lift,
      z: (row + column) % 2 ? -depth : depth,
    })));
  // Grow the entire cluster until either two globes nearly touch or one
  // reaches the inside of the spherical shell. No count is assigned a
  // smaller arbitrary "many eyes" size.
  let scale = 1;
  for (let i = 0; i < count; i++) {
    const a = points[i];
    scale = Math.min(scale,
      (LID_SHELL_RADIUS - 0.018 - Math.hypot(a.x, a.y, a.z)) / GLOBE_HULL_RADIUS);
    for (let j = 0; j < i; j++) {
      const b = points[j];
      scale = Math.min(scale, (Math.hypot(
        a.x - b.x, a.y - b.y, a.z - b.z,
      ) - 0.006) / 2);
    }
  }
  return points.map(point => ({ ...point, scale }));
}
const EYE_CLUSTER_LAYOUTS = Object.freeze([
  [{ x: 0, y: 0, z: 0, scale: 1 }],
  [{ x: -PAIR_SIZE, y: 0, z: 0.21, scale: PAIR_SIZE },
    { x: PAIR_SIZE, y: 0, z: 0.21, scale: PAIR_SIZE }],
  [{ x: -TRIANGLE_SIZE, y: triangleY - TRIANGLE_SIZE / Math.sqrt(3), z: 0.16, scale: TRIANGLE_SIZE },
    { x: TRIANGLE_SIZE, y: triangleY - TRIANGLE_SIZE / Math.sqrt(3), z: 0.16, scale: TRIANGLE_SIZE },
    { x: 0, y: triangleY + 2 * TRIANGLE_SIZE / Math.sqrt(3), z: 0.16, scale: TRIANGLE_SIZE }],
  [{ x: -SQUARE_SIZE, y: SQUARE_SIZE, z: 0.16, scale: SQUARE_SIZE },
    { x: SQUARE_SIZE, y: SQUARE_SIZE, z: 0.16, scale: SQUARE_SIZE },
    { x: -SQUARE_SIZE, y: -SQUARE_SIZE, z: 0.16, scale: SQUARE_SIZE },
    { x: SQUARE_SIZE, y: -SQUARE_SIZE, z: 0.16, scale: SQUARE_SIZE }],
  ...Array.from({ length: 8 }, (_, index) => packedEyeCluster(index + 5)),
].map(points => Object.freeze(points.map(point => Object.freeze(point)))));

export function eyeClusterLayout(count = 1) {
  return EYE_CLUSTER_LAYOUTS[OCULOID_EYE_COUNTS.includes(Number(count))
    ? Number(count) - 1 : 0];
}

/** The same bounded eight-beat relationship drives the pictured eyes and
 * their independent event voices. The shared gaze pad remains an offset for
 * all eyes; Still and Pause really leave them still. */
export function eyeEnsemblePose(pose, config, beat, index, count, style = "banter", playing = false) {
  const n = OCULOID_EYE_COUNTS.includes(count) ? count : 1;
  if (n === 1 || normalizeOculoidEnsemble(style) === "together") return pose;
  const i = Math.max(0, Math.min(n - 1, Math.trunc(Number(index) || 0)));
  const partner = eyeClusterLayout(n);
  const xToward = Math.sign(partner[(i + 1) % n].x - partner[i].x);
  const yToward = Math.sign(partner[(i + 1) % n].y - partner[i].y);
  // The rest pose is also an ensemble: Pause and Still stop each eye's
  // movement without forcing the whole cluster to stare in one direction.
  const restingX = style === "harmony" ? partner[i].x * 0.26
    : style === "rock" ? (i % 2 ? -0.19 : 0.19)
      : 0.16 * xToward + 0.045 * Math.sin(i * 2.47);
  const restingY = style === "harmony" ? partner[i].y * 0.15
    : style === "rock" ? (i % 3 - 1) * 0.08
      : 0.11 * yToward + 0.035 * Math.cos(i * 2.47);
  const rest = {
    ...pose,
    gazeX: clampEye(pose.gazeX + restingX, -1, 1),
    gazeY: clampEye(pose.gazeY + restingY, -1, 1),
  };
  if (!playing || config?.eyeballStyle === "still") return rest;
  const size = clampEye(config?.motion, 0, 1, OCULOID_DEFAULTS.motion);
  if (!size) return rest;
  const b = ((Number.isFinite(beat) ? beat : 0) % 8 + 8) % 8;
  let dx, dy, dp, energy;
  if (style === "harmony") {
    // Keep the choir's gaze spread musical as the band grows: an unscaled
    // twelve-eye index would pin the outside singers at the gaze clamp.
    dx = (i - (n - 1) / 2) * 0.22 * Math.min(1, 3 / (n - 1))
      + 0.17 * wave(b, 0.25, i / n);
    dy = 0.17 * wave(b, 0.25, i / n + 0.16);
    dp = 0.08 * wave(b, 0.25, i / n);
    energy = 0.8;
  } else if (style === "rock") {
    dx = 0.3 * (i % 2 ? -1 : 1) + 0.18 * wave(b, 0.5, i * 0.23);
    dy = 0.25 * wave(b, 0.5, i * 0.25);
    dp = 0.10 * wave(b, 0.5, i * 0.25);
    energy = 0.55 + 0.35 * (0.5 + 0.5 * wave(b, 0.5, i * 0.25));
  } else {
    // A slow call/response passes the lead round the cluster; the others
    // glance at a neighboring singer while waiting for their entrance.
    const spotlight = (0.5 + 0.5 * wave(b, n === 2 ? 0.25 : 0.125, 0.25 - i / n)) ** 2;
    dx = 0.28 * xToward * (1 - spotlight) + 0.19 * wave(b, 0.25, i / n);
    dy = 0.15 * yToward * (1 - spotlight) + 0.17 * wave(b, 0.125, i / n);
    dp = 0.14 * spotlight - 0.07;
    energy = 0.32 + 0.68 * spotlight;
  }
  return {
    ...rest,
    gazeX: clampEye(rest.gazeX + size * dx, -1, 1),
    gazeY: clampEye(rest.gazeY + size * dy, -1, 1),
    pupil: clampEye(pose.pupil + size * dp, 0, 1),
    energy,
  };
}
// The moving upper and lower lids end where the opening closes. The remaining
// spherical surface on either side is one continuous, stationary skin cap.
export const LID_PATCH_X = 1;
const LIP_INSET = 0.06, LIP_OUTSET = 0.0375, LIP_ROLL = 0.125;
// The shell sits ahead of the globe: project its inner lip slightly across
// the globe's silhouette to seal the recessed-socket gap at full opening.
// A sphere projects its front pole farther forward than the old shallow
// surround. Stop the fully opened margins nearer the globe so they cannot
// expose a strip of black socket above or below the sclera.
const OPEN_POLE = GLOBE_HULL_RADIUS - LIP_INSET - 0.14;
const canthusY = side => -0.025 + 0.035 * side;

/** One simple, asymmetric arch per lid keeps the silhouette cartoony rather
 * than sculpting a brow/cheek. Negative blink opens the upper lid past rest;
 * positive lowerLid opens the lower one. Neither opens past the globe. */
export function lidEdge(x, upper, blink, lowerLid = 0) {
  const side = clampEye(x, -1, 1);
  const arch = Math.sqrt(Math.max(0, 1 - side * side));
  const b = clampEye(blink, -1, 1);
  const canthus = canthusY(side);
  const lowerRest = canthus - 0.39 * arch * (1 - 0.09 * side);
  const upperRest = canthus + 0.60 * arch * (1 + 0.10 * side);
  // The projected gap widens toward the canthi; pull the fully open arcs
  // closer to the globe there so the dark rear socket cannot outline it.
  const openArc = (OPEN_POLE - 0.21 * side * side) * arch;
  const pole = openArc + canthus * (1 - arch);
  const top = b < 0
    ? upperRest + (pole - upperRest) * -b
    : upperRest + (lowerRest + 0.012 * arch - upperRest) * b;
  if (upper) return top;
  const lower = clampEye(lowerLid, -1, 1);
  const bottom = lower >= 0
    // Both independent lids must still meet at the same canthus even at
    // maximum opening; negating the asymmetric canthus made a side slit.
    ? lowerRest + (canthus * (1 - arch) - openArc - lowerRest) * lower
    : lowerRest - 0.58 * lower * arch;
  return Math.min(bottom, top - 0.009 * arch);
}

function smoothEye(min, max, value) {
  const t = clampEye((value - min) / (max - min), 0, 1);
  return t * t * (3 - 2 * t);
}

export function globeHullDepth(x, y) {
  return GLOBE_SQUASH * Math.sqrt(Math.max(0, GLOBE_HULL_RADIUS ** 2 - x * x - y * y));
}

export function lidOuterY(x, upper) {
  const edge = Math.sqrt(Math.max(0, LID_SHELL_RADIUS ** 2 - x * x));
  return upper ? edge : -edge;
}

/** The visible eyelid is the front of a spherical shell, not a face sheet.
 * Its equator joins a separate back hemisphere; its radius stays safely
 * outside the largest possible rotation of the imported globe. */
export function lidSurfaceDepth(x, y) {
  return GLOBE_SQUASH * Math.sqrt(Math.max(0, LID_SHELL_RADIUS ** 2 - x * x - y * y));
}

/** Outward sphere normal shared by both sides of the skin's equator. */
export function lidShellNormal(x, y, z) {
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length];
}

export function lidPatchPoint(x, radial, upper, blink, lowerLid = 0) {
  const side = clampEye(x, -1, 1), atCorner = canthusY(side);
  // Both margins meet at the canthi. Beyond them this only distributes the
  // fused cap's vertices; it does not draw a further upper/lower seam.
  const marginY = lidEdge(side, upper, blink, lowerLid);
  const margin = (marginY + (atCorner - marginY) * smoothEye(0.93, 1.08, Math.abs(x)))
    * (1 - smoothEye(1.08, LID_SHELL_RADIUS, Math.abs(x)));
  const y = margin + (lidOuterY(x, upper) - margin) * radial;
  return [x, y, lidSurfaceDepth(x, y)];
}

/** The rounded roll meets the shell with the shell's tangent; its inner edge
 * stays close to (and outside) the globe's gaze-independent envelope. */
export function lidLipPoint(x, t, upper, blink, lowerLid = 0) {
  const [px, marginY, frontZ] = lidPatchPoint(x, 0, upper, blink, lowerLid);
  const gap = lidEdge(x, true, blink, lowerLid) - lidEdge(x, false, blink, lowerLid);
  // Keep a nearly uniform rim through the aperture; round it off only
  // where both lids meet instead of wedging it toward either canthus.
  // End the entire roll at the canthus, not partway into the side cap.
  const corner = 1 - smoothEye(0.96, LID_PATCH_X, Math.abs(x));
  const inset = Math.min(LIP_INSET, gap * 0.42) * corner;
  const shoulder = Math.max(0, upper
    ? lidOuterY(x, true) - marginY : marginY - lidOuterY(x, false));
  const outward = Math.min(LIP_OUTSET, shoulder * 0.55) * corner;
  const inward = upper ? -1 : 1;
  const round = Math.sin(Math.PI * t) ** 2;
  const y = marginY + inward * (inset * (1 - t) - outward * round);
  const innerY = marginY + inward * inset;
  const opening = clampEye(upper ? -blink : lowerLid, 0, 1);
  const fold = Math.min(0.02 + 0.105 * opening,
    Math.max(0, frontZ - globeHullDepth(px, innerY) - 0.038));
  // At t=1 the derivative matches the sphere, eliminating the crease
  // where the lip joins the front shell. Most of the roll faces outward.
  const seamSlope = frontZ > 0
    ? GLOBE_SQUASH ** 2 * marginY * inward * inset / frontZ : 0;
  const z = frontZ + corner * (-fold * (1 - t) ** 2
    + LIP_ROLL * round - seamSlope * t * t * (1 - t));
  return [px, y, z];
}

/** The dark canthal recess lies behind the globe, not across its visible
 * sclera. Only the uncovered corners show through the moving lid opening. */
export function canthusRecessPoint(side, fraction, across, blink, lowerLid = 0) {
  const x = (side < 0 ? -1 : 1) * (1 - 0.2 * clampEye(fraction, 0, 1));
  const top = lidEdge(x, true, blink, lowerLid);
  const bottom = lidEdge(x, false, blink, lowerLid);
  const taper = smoothEye(0.8, 0.9, Math.abs(x));
  const y = (top + bottom) / 2 + (2 * clampEye(across, 0, 1) - 1)
    * (top - bottom) * 0.46 * taper;
  // A shallow plane inside the socket is behind the front of the globe at
  // every gaze angle. Drawing it on the globe's *front* hull masked the eye
  // with black triangular wedges, particularly against chrome lids.
  return [x, y, -0.04];
}

// The imported drop's pointed +Z vertex is 0.83351171 from its center.
// Rotate +Z to +Y and stretch the drop vertically to 0.2 shell units;
// give the fallback the same tip-to-center distance.
export const TEAR_DROP_SCALE = 1.6;
export const TEAR_CYCLE_BEATS = 4;
export const TEAR_RELEASE_BEAT = TEAR_CYCLE_BEATS * 0.52;
export const TEAR_TIP_HEIGHT = 0.83351171 * 0.2 * TEAR_DROP_SCALE;

/** Tear and Cry explicitly start the same four-beat growth/fall gesture.
 * Tears controls the grown size, never whether the buttons work. */
export function tearDropMotion(wetness, beat = 0, active = false) {
  if (!active) return { size: 0, fall: 0 };
  const flow = 0.24 + 0.91 * clampEye(wetness, 0, 1, 0.5);
  const cycle = ((clampEye(beat, 0, 1e9, 0) / TEAR_CYCLE_BEATS) % 1 + 1) % 1;
  return {
    // Keep the grown drop until it leaves the frame; only then repeat.
    size: flow * smoothEye(0, 0.44, cycle),
    fall: smoothEye(TEAR_RELEASE_BEAT / TEAR_CYCLE_BEATS, 0.96, cycle),
  };
}

export function tearDropPose(blink, lowerLid, wetness, beat = 0, active = false, aspect = 1,
  viewDistance = lidCameraDistance(aspect)) {
  const { size, fall } = tearDropMotion(wetness, beat, active);
  // At the actual canthus the two lid lips meet. Place the pointed tip on
  // that join, just ahead of its surface so it doesn't disappear in the rim.
  // The drop mesh leans *away* from the lid while growing, not the anchor.
  const x = -LID_PATCH_X;
  const [, cornerY, cornerZ] = lidLipPoint(x, 0.55, false, blink, lowerLid);
  const rootY = cornerY - 0.003;
  // Grow downward from the tip; after release translate only in Y.
  // Size does not fade while falling. Travel far enough that even the *tip*
  // clears the bottom of a portrait stage before the next cycle begins.
  const fov = 36;
  const screenBottom = (viewDistance + LID_SHELL_RADIUS) * Math.tan(fov * Math.PI / 360);
  const fallDistance = rootY + screenBottom + 0.18;
  return { x, y: rootY - TEAR_TIP_HEIGHT * size - fall * fallDistance,
    z: cornerZ + 0.026, size };
}

/** Keep the spherical eyelid close to the edges of either a wide or a tall
 * canvas, without clipping it on mobile or exposing a large empty backdrop. */
export function lidCameraDistance(aspect, fovDegrees = 36) {
  return LID_SHELL_RADIUS / (Math.tan(fovDegrees * Math.PI / 360)
    * Math.min(1, aspect) * 0.91);
}

/** Lash roots remain on the corresponding moving margin. Length and outward
 * sweep increase toward the temple, unlike a mirrored fan on either side. */
export function lashShape(fraction, upper) {
  const f = clampEye(fraction, 0, 1);
  const t = clampEye((f - 0.04) / 0.81, 0, 1);
  const temple = t * t * (3 - 2 * t);
  const innerTaper = clampEye(f / 0.14, 0, 1);
  const outerTaper = clampEye((f - 0.87) / 0.13, 0, 1);
  const length = ((upper ? 0.13 : 0.075) + (upper ? 0.15 : 0.06) * temple)
    * (0.52 + 0.48 * innerTaper) * (1 - 0.36 * outerTaper);
  return { length, sweep: length * (0.16 + 0.72 * temple) };
}

/** Roots sit on the *outside crest* of each rounded lip. Starting on the
 * inside shoulder made the tubes disappear into the other lip at full blink.
 * Each strand then curves away from the opening and clears the skin shell. */
export function lashPoint(fraction, step, upper, blink, lowerLid = 0, variation = 1) {
  const f = clampEye(fraction, 0, 1);
  const t = clampEye(step, 0, 1);
  const x = -0.95 + 1.88 * f;
  const [, rootY, lipZ] = lidLipPoint(x, 0.5, upper, blink, lowerLid);
  const rootZ = Math.max(lipZ, lidSurfaceDepth(x, rootY)) + 0.014;
  const profile = lashShape(f, upper);
  const bend = 0.33 * t + 0.67 * t ** 2;
  const px = x + profile.sweep * variation * bend + Math.sin(f * 75) * 0.012 * t;
  const py = rootY + (upper ? 1 : -1) * profile.length * variation * bend;
  const pz = Math.max(
    rootZ + (upper ? 0.06 : 0.035) * Math.sin(t * Math.PI)
      + (upper ? 0.12 : 0.075) * t,
    lidSurfaceDepth(px, py) + 0.017,
  );
  return [px, py, pz];
}

export function eyeSoundTargets(config, pose) {
  const c = normalizeOculoid(config);
  const p = pose && typeof pose === "object" ? pose : eyePose(c);
  const x = clampEye(p.gazeX, -1, 1), y = clampEye(p.gazeY, -1, 1);
  const pupil = clampEye(p.pupil, 0, 1), blink = clampEye(p.blink, -1, 1);
  const lowerLid = clampEye(p.lowerLid, -1, 1, c.lowerLid);
  const aperture = clampEye(
    (lidEdge(0, true, blink, lowerLid) - lidEdge(0, false, blink, lowerLid))
      / (lidEdge(0, true, 0, 0) - lidEdge(0, false, 0, 0)),
    0, 1,
  );
  const midiHz = Number.isFinite(config?.midiHz) && config.midiHz > 0
    ? clampEye(config.midiHz, 25, 3000) : null;
  return {
    hz: midiHz === null ? c.rootHz * 2 ** (y * 0.43 + x * 0.11)
      : midiHz * 2 ** (y * 0.06),
    cutoff: 440 + pupil * 3000 + c.tone * 2350,
    pan: x * 0.84,
    gate: 0.18 + 0.82 * aperture ** 2,
    grain: c.air * 0.18 + c.veins * 0.17,
    color: c.tone * 0.78 + c.irisTint * 0.22,
    brightness: pupil,
    shimmer: c.wetness,
  };
}
