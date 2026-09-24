import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "acorn";
import { canvasLocalPoint, canvasScaledPoint } from "../src/graphics/pointer-coordinates.js";
import { restoreShapesSoundBanks } from "./helpers/shapes-sound-banks-reference.mjs";
import { pointerReference, restorePointerExtraction } from "./helpers/pointer-extraction-reference.mjs";
import { restoreIphoneStartup } from "./helpers/iphone-startup-reference.mjs";
import { readRuntimeManifest } from "../scripts/site/runtime-manifest.mjs";
import { runtimeSourceFiles } from "../scripts/check-runtime-source.mjs";

const root = new URL("../", import.meta.url);
const sha = text => createHash("sha256").update(text).digest("hex");

function namedFunctions(node, name, found = []) {
  if (!node || typeof node !== "object") return found;
  if (node.type === "FunctionDeclaration" && node.id?.name === name) found.push(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(child => namedFunctions(child, name, found));
    else if (value && typeof value === "object") namedFunctions(value, name, found);
  }
  return found;
}

const compile = (source, canvas, size) => new Function(
  "canvas", "cssWidth", "cssHeight", "canvasMetrics", "canvasLocalPoint", "canvasScaledPoint",
  `return (${source});`,
)(canvas, size.width, size.height, size, canvasLocalPoint, canvasScaledPoint);

const boundsCases = [
  { left: 0, top: 0, width: 1440, height: 900 },
  { left: 37.25, top: -123.5, width: 389.625, height: 245.875 },
  { left: -200, top: 844.25, width: 585.5, height: 360.125 },
  { left: 12, top: 4, width: 0, height: 0 },
  { left: -0, top: -0, width: 0.125, height: 0.75 },
  { left: 11, top: 22, width: -5, height: -3 },
];
const sizes = [
  { width: 1440, height: 900 }, { width: 390, height: 844 },
  { width: 844, height: 390 }, { width: 201.75, height: 97.125 },
  { width: 0, height: 0 }, { width: -0, height: -1 },
];
const positions = [
  [-0, 0], [0, -0], [1, 1], [123.125, 99.75], [-400.25, -900.125],
  [3000.375, 2000.875], [Number.MAX_VALUE, -Number.MAX_VALUE],
  [NaN, Infinity], [undefined, undefined],
];

for (const entry of pointerReference.entries) {
  test(`${entry.file}: the actual callback exactly matches the original calculation`, async () => {
    const source = await readFile(new URL(entry.file, root), "utf8");
    const declarations = namedFunctions(parse(source, { sourceType: "module", ecmaVersion: "latest" }), entry.name);
    assert.equal(declarations.length, 1, "one real instrument callback, not a copied test implementation");
    const actualSource = source.slice(declarations[0].start, declarations[0].end);
    assert.equal(actualSource, entry.after);
    let measurements = 0;
    let currentBounds = boundsCases[0];
    const canvas = { getBoundingClientRect() { measurements++; return currentBounds; } };
    for (const size of sizes) {
      const before = compile(entry.before, canvas, size);
      const after = compile(actualSource, canvas, size);
      for (const bounds of boundsCases) for (const [clientX, clientY] of positions) {
        currentBounds = Object.freeze({ ...bounds });
        const event = Object.freeze({ clientX, clientY, offsetX: 987, offsetY: 654 });
        measurements = 0;
        const expected = before(event);
        assert.equal(measurements, 1);
        measurements = 0;
        const actual = after(event);
        assert.equal(measurements, 1, "measurement stays in the caller, once per event");
        assert.deepEqual(actual, expected, "includes exact doubles, signed zero and existing non-finite behavior");
        assert.deepEqual(Object.keys(actual), ["x", "y"]);
      }
    }
  });

  test(`${entry.file}: surrounding code matches the reference plus reviewed iPhone and Shapes kit updates`, async () => {
    const source = await readFile(new URL(entry.file, root), "utf8");
    const beforeExtraction = restorePointerExtraction(restoreShapesSoundBanks(source, entry.file), entry.file);
    assert.equal(sha(restoreIphoneStartup(beforeExtraction, entry.file)), entry.moduleSha256);
  });
}

test("local and scaled policies remain distinct and do not clamp captured drags", () => {
  const bounds = { left: 100, top: 40, width: 200, height: 100 };
  const event = { clientX: 50, clientY: 170 };
  assert.deepEqual(canvasLocalPoint(event, bounds), { x: -50, y: 130 });
  assert.deepEqual(canvasScaledPoint(event, bounds, { width: 400, height: 200 }), { x: -100, y: 260 });
});

test("scaling retains arithmetic order and zero/subpixel denominator behavior", () => {
  // These values distinguish a*b/c from a*(b/c) in a binary floating-point runtime.
  const event = { clientX: 0.1, clientY: 1 };
  const bounds = { left: 0, top: 0, width: 3, height: 0.25 };
  const actual = canvasScaledPoint(event, bounds, { width: 10, height: 20 });
  assert.equal(actual.x, (0.1 * 10) / 3);
  assert.notEqual(actual.x, 0.1 * (10 / 3));
  assert.equal(actual.y, 20);
});

test("helper inputs stay read-only and local points do not inspect scale fields", () => {
  const event = Object.freeze({ clientX: 8, clientY: 12 });
  const bounds = Object.freeze({
    left: 3, top: 4,
    get width() { throw new Error("local policy does not scale"); },
    get height() { throw new Error("local policy does not scale"); },
  });
  assert.deepEqual(canvasLocalPoint(event, bounds), { x: 5, y: 8 });
  const size = Object.freeze({ width: 20, height: 40 });
  assert.deepEqual(canvasScaledPoint(event, Object.freeze({ left: 3, top: 4, width: 10, height: 20 }), size), { x: 10, y: 16 });
});

test("extraction reversal rejects missing imports, modified calls and duplicate replacements", async () => {
  const entry = pointerReference.entries[0];
  const source = await readFile(new URL(entry.file, root), "utf8");
  assert.throws(() => restorePointerExtraction(source.replace(entry.importLine, ""), entry.file));
  assert.throws(() => restorePointerExtraction(source.replace(entry.after, entry.before), entry.file));
  assert.throws(() => restorePointerExtraction(source + entry.after, entry.file));
  assert.equal(restorePointerExtraction("unrelated", "not-a-migrated-app.js"), "unrelated");
});

test("the shared helper is browser-only data math with explicit build and syntax inclusion", async () => {
  const file = "src/graphics/pointer-coordinates.js";
  const manifest = await readRuntimeManifest();
  assert.ok(manifest.worktreeFiles.includes(file));
  assert.ok(manifest.requiredFiles.includes(file));
  assert.ok((await runtimeSourceFiles()).includes(file));
  const source = await readFile(new URL(file, root), "utf8");
  const ast = parse(source, { sourceType: "module", ecmaVersion: "latest" });
  assert.ok(ast.body.every(node => node.type === "ExportNamedDeclaration" && node.declaration?.type === "FunctionDeclaration"));
  assert.doesNotMatch(source, /\b(?:document|window|AudioContext|requestAnimationFrame|Math\.random|addEventListener)\b/);
});
