/** A bounded visual explorer, independent of audio parameters and admission.
 *
 * Mandelbrot pixels iterate 0 with each pixel as c. Julia pixels iterate the
 * pixel with the instrument's current c. Finite escape-time images approximate
 * the filled sets; they are not exact boundary membership tests.
 * Definitions: https://pi.math.cornell.edu/~klindsey/presentations/MandelbrotPresentation.pdf
 */
export const EXPLORER_LIMITS = Object.freeze({ zoom: Object.freeze([.5, 16384]),
  center: Object.freeze([-4, 4]), maxDimension: 360, iterations: Object.freeze([64, 384]), span: 3.4 });
export const DEFAULT_EXPLORER_VIEW = Object.freeze({ set: 'mandelbrot', centerReal: -.5, centerImag: 0, zoom: 1 });

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const finite = (value, fallback) => (typeof value === 'number' || typeof value === 'string')
  && value !== '' && Number.isFinite(Number(value)) ? Number(value) : fallback;
const aspectOf = value => clamp(finite(value, 1), 1 / 180, 180);

export function normalizeExplorerView(candidate = {}) {
  const source = candidate && typeof candidate === 'object' ? candidate : {};
  const set = source.set === 'julia' ? 'julia' : 'mandelbrot';
  return { set, centerReal: clamp(finite(source.centerReal, set === 'julia' ? 0 : -.5), ...EXPLORER_LIMITS.center),
    centerImag: clamp(finite(source.centerImag, 0), ...EXPLORER_LIMITS.center),
    zoom: clamp(finite(source.zoom, 1), ...EXPLORER_LIMITS.zoom) };
}

/** Fractions follow canvas coordinates: (0,0) is top left, imaginary increases up. */
export function complexAt(view, xFraction, yFraction, aspect = 1) {
  const normalized = normalizeExplorerView(view), span = EXPLORER_LIMITS.span / normalized.zoom;
  return { real: normalized.centerReal + (finite(xFraction, .5) - .5) * span,
    imag: normalized.centerImag + (.5 - finite(yFraction, .5)) * span / aspectOf(aspect) };
}

/** Inverse of complexAt. Returns normalized fractions; offscreen values remain offscreen. */
export function pixelAt(view, real, imag, aspect = 1) {
  const normalized = normalizeExplorerView(view), span = EXPLORER_LIMITS.span / normalized.zoom;
  return { x: .5 + (finite(real, normalized.centerReal) - normalized.centerReal) / span,
    y: .5 - (finite(imag, normalized.centerImag) - normalized.centerImag) * aspectOf(aspect) / span };
}

/** Absolute zoom; retains the complex point underneath the supplied canvas anchor. */
export function zoomExplorer(view, zoom, xFraction = .5, yFraction = .5, aspect = 1) {
  const normalized = normalizeExplorerView(view), anchor = complexAt(normalized, xFraction, yFraction, aspect);
  const next = normalizeExplorerView({ ...normalized, zoom }), moved = complexAt(next, xFraction, yFraction, aspect);
  return normalizeExplorerView({ ...next, centerReal: next.centerReal + anchor.real - moved.real,
    centerImag: next.centerImag + anchor.imag - moved.imag });
}

/** Drag fractions move the image with the pointer, without editing c. */
export function panExplorer(view, dxFraction, dyFraction, aspect = 1) {
  const normalized = normalizeExplorerView(view), span = EXPLORER_LIMITS.span / normalized.zoom;
  return normalizeExplorerView({ ...normalized,
    centerReal: normalized.centerReal - finite(dxFraction, 0) * span,
    centerImag: normalized.centerImag + finite(dyFraction, 0) * span / aspectOf(aspect) });
}

// Independently chosen exploration regions and coefficient starting points.
// Names describe visual invitations, not claims of exact periodicity or topology.
const preset = (id, label, set, centerReal, centerImag, zoom, cReal, cImag) => Object.freeze({ id, label,
  view: Object.freeze({ set, centerReal, centerImag, zoom }), cReal, cImag });
export const EXPLORER_PRESETS = Object.freeze([
  preset('mandelbrot-home', 'Mandelbrot · Full set', 'mandelbrot', -.5, 0, 1, -.745, .113),
  preset('mandelbrot-coast', 'Mandelbrot · Folded coast', 'mandelbrot', -.745, .113, 12, -.745, .113),
  preset('mandelbrot-upper', 'Mandelbrot · Upper tendrils', 'mandelbrot', -.16, .77, 10, -.16, .77),
  preset('mandelbrot-left', 'Mandelbrot · Western island', 'mandelbrot', -1.76, 0, 15, -1.76, .01),
  preset('mandelbrot-cusp', 'Mandelbrot · Cusp lace', 'mandelbrot', .26, .001, 35, .26, .001),
  preset('mandelbrot-fine', 'Mandelbrot · Fine spiral', 'mandelbrot', -.743643887, .131825904, 350, -.743643887, .131825904),
  preset('julia-current', 'Julia · Current coefficient', 'julia', 0, 0, 1, null, null),
  preset('julia-loops', 'Julia · Three-loop garden', 'julia', 0, 0, 1, -.123, .745),
  preset('julia-braid', 'Julia · Braided filaments', 'julia', 0, 0, 1.1, -.8, .156),
  preset('julia-lace', 'Julia · Broken lace', 'julia', 0, 0, 1, .285, .01),
  preset('julia-lobes', 'Julia · Paired lobes', 'julia', 0, 0, 1, -1, 0),
  preset('julia-curl', 'Julia · Curled shoreline', 'julia', 0, 0, 1, -.4, .6),
  preset('julia-detail', 'Julia · Filament close-up', 'julia', -.15, .35, 5, -.8, .156),
]);

export function normalizeExplorerRenderRequest(candidate = {}) {
  const source = candidate && typeof candidate === 'object' ? candidate : {};
  // Preserve aspect while limiting both dimensions and total allocation.
  let width = clamp(Math.round(finite(source.width, 240)), 2, 16384);
  let height = clamp(Math.round(finite(source.height, 120)), 2, 16384);
  const scale = Math.min(1, EXPLORER_LIMITS.maxDimension / Math.max(width, height));
  width = Math.max(2, Math.round(width * scale)); height = Math.max(2, Math.round(height * scale));
  const view = normalizeExplorerView(source.view), suggested = 112 + Math.max(0, Math.log2(view.zoom)) * 24;
  const iterations = Math.round(clamp(finite(source.iterations, suggested), ...EXPLORER_LIMITS.iterations));
  // These visual coefficients stay in the same finite coordinate range as the
  // instrument; Mandelbrot never reads them when evaluating a pixel.
  return { revision: Number.isSafeInteger(source.revision) ? source.revision : 0, width, height, view,
    cReal: clamp(finite(source.cReal, -.745), -2, 1), cImag: clamp(finite(source.cImag, .113), -1.5, 1.5), iterations };
}

function prepareImage(candidate) {
  const request = normalizeExplorerRenderRequest(candidate);
  return { ...request, pixels: new Uint8ClampedArray(request.width * request.height * 4) };
}

function renderRows(image, first, end) {
  const { width, height, view, cReal, cImag, iterations, pixels } = image;
  const span = EXPLORER_LIMITS.span / view.zoom, aspect = width / height;
  const julia = view.set === 'julia', top = view.centerImag + span / (2 * aspect), left = view.centerReal - span / 2;
  // Sample pixel centers. Their shape remains isotropic at every aspect ratio.
  for (let y = first; y < end; y++) {
    const imag = top - (y + .5) * span / width;
    for (let x = 0; x < width; x++) {
      const real = left + (x + .5) * span / width;
      const cr = julia ? cReal : real, ci = julia ? cImag : imag;
      let zr = julia ? real : 0, zi = julia ? imag : 0, squared = zr * zr + zi * zi, n = 0;
      // A conservative escape radius also accommodates larger bounded c values.
      const escapeSquared = Math.max(4, cr * cr + ci * ci + 1);
      for (; n < iterations && squared <= escapeSquared; n++) {
        const next = zr * zr - zi * zi + cr; zi = 2 * zr * zi + ci; zr = next;
        squared = zr * zr + zi * zi;
      }
      const at = (y * width + x) * 4;
      if (n === iterations) { pixels[at] = 17; pixels[at + 1] = 54; pixels[at + 2] = 53; }
      else {
        const smooth = Math.max(0, n + 1 - Math.log2(Math.max(1, Math.log2(Math.sqrt(squared)))));
        const glow = .5 + .5 * Math.sin(smooth * .16), edge = Math.min(1, smooth / 24);
        pixels[at] = 13 + 30 * glow + 35 * edge;
        pixels[at + 1] = 27 + 54 * glow + 132 * edge;
        pixels[at + 2] = 40 + 53 * glow + 109 * edge;
      }
      pixels[at + 3] = 255;
    }
  }
}

/** Deterministic reference renderer, useful for small fixtures and offline work. */
export function renderFractalImage(candidate) {
  const image = prepareImage(candidate); renderRows(image, 0, image.height); return image;
}

/** Worker rendering yields between bounded row chunks so newer requests can cancel it.
 * A cancelled render returns null and never sends a partial/stale image.
 */
export async function renderFractalImageAsync(candidate, {
  isCancelled = () => false, yieldTask = () => new Promise(resolve => setTimeout(resolve, 0)), rowsPerChunk = 3,
} = {}) {
  const image = prepareImage(candidate), chunk = clamp(Math.round(finite(rowsPerChunk, 3)), 1, 8);
  for (let row = 0; row < image.height; row += chunk) {
    if (isCancelled()) return null;
    renderRows(image, row, Math.min(image.height, row + chunk));
    if (row + chunk < image.height) await yieldTask();
  }
  return isCancelled() ? null : image;
}
