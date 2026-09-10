import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { inspectInstrument, localPath, referencesIn, repositoryRoot } from "../scripts/inspect-instrument.mjs";

test("local paths reject encoded separators, traversal and malformed escapes before any file access", () => {
  for (const reference of [
    "./%2e%2e%2f%2e%2e%2foutside.js",
    "./%2E%2E%2F%2E%2E%2Foutside.js",
    "./%2e%2e%5c%2e%2e%5coutside.js",
    "./%2e%2e/%2e%2e/outside.js",
    "../../outside.js", "/../outside.js",
    "./bad%.js", "./bad%GG.js", "./bad%E0%A4%A.js",
    "https://example.com/outside.js", "file:///outside.js", "//example.com/outside.js",
  ]) assert.equal(localPath(reference, "src/demo.js"), null, reference);
});

test("local paths preserve encoded spaces and Unicode, query stripping and directory candidates", () => {
  assert.equal(localPath("./caf%C3%A9%20%E2%99%AB.js?v=1#section", "src/demo.js"), "src/café ♫.js");
  assert.equal(localPath("/assets/sound%20objects/%E9%9B%A8.wav", "src/demo.js"), "assets/sound objects/雨.wav");
  assert.equal(localPath("../assets/sound%20objects/", "src/demo.js"), "assets/sound objects/");
  assert.equal(localPath("../", "src/demo.js"), "");
  assert.equal(localPath("./next.js", "src/café #1%/demo.js"), "src/café #1%/next.js");
  assert.equal(localPath("./model.js?redirect=%2Felsewhere", "src/demo.js"), "src/model.js");
});

test("inspection recognizes multiline, side-effect, dynamic and re-export module references", () => {
  const refs = referencesIn(`
import {
  a, b,
} from "./model.js";
import "./setup.js";
export { c } from "./shared.js";
const next = import("./next.js");
const worker = new URL("./worker.js", import.meta.url);
const selected = new URL(\`../assets/demo/\${id}.wav\`, import.meta.url);
`, "src/demo.js");
  assert.deepEqual(refs.filter(r => r.kind === "module").map(r => r.reference), ["./model.js", "./setup.js", "./shared.js", "./next.js"]);
  assert.ok(refs.some(r => r.reference === "./worker.js" && r.kind === "module-url"));
  assert.ok(refs.some(r => r.reference === "../assets/demo/${id}.wav" && r.kind === "template-candidate"));
});

test("Puggler inventory includes samples, provenance, live capability and mirrored source", async () => {
  const report = await inspectInstrument("puggler");
  assert.deepEqual(report.entries, ["nav.js", "puggler-app.js"]);
  assert.equal(report.registration.capability.computerKeyboardMode, "page");
  const recordings = report.files.filter(f => f.path.endsWith(".wav"));
  assert.equal(recordings.length, 8);
  assert.ok(recordings.every(f => f.present && f.tracked));
  assert.ok(recordings.every(f => f.discoveredBy.includes("template-candidate")));
  const credits = report.files.find(f => f.path === "assets/puggler/CREDITS.md");
  assert.ok(credits?.present);
  // Discovery must remain useful before a build, including a stale/missing WAX
  // artifact. Full packaging parity belongs to check:wax-dist.
  for (const file of [...recordings, credits]) {
    const source = path.join(repositoryRoot, file.path), wax = path.join(repositoryRoot, "dist-wax", file.path);
    if (!existsSync(wax)) assert.equal(file.wax, "missing");
    else if (readFileSync(source).equals(readFileSync(wax))) assert.equal(file.wax, "identical");
    else assert.match(file.wax, /^different:/);
  }
  assert.ok(report.files.some(f => f.path === "src/puggler-presets.js"));
  assert.ok(report.tests.candidates.includes("e2e/puggler.spec.mjs"));
  assert.match(report.files.find(f => f.path === "puggler.html").wax, /^different:/);
  assert.deepEqual(report.files.filter(f => !f.present), []);
});

test("shared page names and transitive app imports find Wheel of Organs models and tests", async () => {
  const report = await inspectInstrument("image-to-instrument-3");
  assert.ok(report.entries.includes("image-to-instrument-app.js"));
  assert.ok(report.files.some(f => f.path === "src/wheel-of-organs-audio.js"));
  assert.ok(report.tests.candidates.includes("tests/wheel-of-organs-audio.test.mjs"));
  assert.deepEqual(report.files.filter(f => !f.present), []);
});

test("nested routes resolve index.html and relative source imports", async () => {
  const report = await inspectInstrument("morphazoidical");
  assert.equal(report.registration.page, "morphazoidical/index.html");
  assert.ok(report.entries.includes("morphazoidical/app.js"));
  assert.ok(report.files.some(f => f.path === "src/geometry.js"));
  assert.ok(report.tests.candidates.includes("morphazoidical/tests/runtime.test.mjs"));
  assert.deepEqual(report.files.filter(f => !f.present), []);
});

test("worker/worklet URLs and quoted Wasm assets stay discoverable with honest candidate labels", async () => {
  const report = await inspectInstrument("simd-resonator");
  for (const filename of ["src/simd-audio-worker.js", "src/simd-resonator-processor.js"]) assert.ok(report.files.some(f => f.path === filename));
  const wasm = report.files.filter(f => f.path.endsWith(".wasm"));
  assert.equal(wasm.length, 2);
  assert.ok(wasm.every(f => f.discoveredBy.includes("literal-asset-candidate")));
});

test("CLI works outside the checkout, is deterministic, rejects unknown IDs, and does not change Git state", () => {
  const script = path.join(repositoryRoot, "scripts/inspect-instrument.mjs");
  const status = () => execFileSync("git", ["-C", repositoryRoot, "status", "--porcelain"], { encoding: "utf8" });
  const before = status();
  const run = () => execFileSync(process.execPath, [script, "puggler", "--json"], { cwd: os.tmpdir(), encoding: "utf8" });
  const first = run();
  assert.equal(run(), first);
  assert.equal(JSON.parse(first).context.repositoryRoot, repositoryRoot);
  const invalid = spawnSync(process.execPath, [script, "missing-instrument"], { cwd: os.tmpdir(), encoding: "utf8" });
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /Unknown instrument ID/);
  assert.equal(status(), before);
});
