import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../nightingale-manifold.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../nightingale-manifold.css", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../nightingale-manifold-app.js", import.meta.url), "utf8");
const renderer = fs.readFileSync(new URL("../src/nightingale-manifold-3d.js", import.meta.url), "utf8");

test("the nightingale shell exposes the complete local graph workflow", () => {
  for (const id of [
    "manifold-canvas",
    "audio-file",
    "load-demo",
    "reanalyze",
    "listen-mode",
    "walk-rule",
    "route-length",
    "surprise",
    "build-route",
    "route-ribbon",
    "play-route",
    "stop-route",
    "node-list",
    "audition-selected",
    "add-selected",
    "export-physical",
    "export-json",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
  }
  assert.match(html, /data-primary-transport/);
  assert.match(html, /core diameter shows duration/i);
  assert.match(html, /gap to the wire shell shows relative RMS level/i);
  assert.match(html, /compact ribbon reveals its active frames and tone candidates/i);
  assert.match(html, /active runs inside each strophe as tone candidates/i);
  assert.match(html, /0\.5 s/);
  assert.match(html, /0\.8 s/);
  assert.match(html, /not a claim of multifractal estimation/i);
  assert.match(html, /graph of occurrences in one short recording/i);
  assert.match(html, /not a typed repertoire or a small-world claim/i);
  assert.match(html, /dotted teal[^<]*acoustic similarity/i);
  assert.match(html, /solid amber[^<]*observed succession/i);
  assert.match(html, /Projection, not anatomy/i);
  assert.match(html, /10\.1098\/rspb\.2014\.0460/);
  assert.match(html, /Lucio Arese/i);
  assert.match(html, /12 MFCCs plus seven frame descriptors/i);
  assert.match(html, /not a reproduction/i);
});

test("the app keeps analysis local and separates samples from physical playback", () => {
  assert.match(app, /createDemoNightingaleSequence/);
  assert.match(app, /analyzeNightingaleSequence/);
  assert.match(app, /strongestChannel/);
  assert.match(app, /renderBirdsongModel/);
  assert.match(app, /assembleStropheRoute/);
  assert.match(app, /assembleAudioSegments/);
  assert.match(app, /dataset\.nightingaleManifoldReady/);
  assert.match(app, /sample-free physical model/);
  assert.match(app, /cancelPending/);
  assert.doesNotMatch(app, /fetch\s*\(/, "local uploads must not be sent over the network");
});

test("the renderer uses vendored Three and preserves distinct graph channels", () => {
  assert.match(renderer, /\.\.\/vendor\/three\/three\.module\.min\.js/);
  assert.match(renderer, /LineDashedMaterial/);
  assert.match(renderer, /showSimilarity/);
  assert.match(renderer, /showSequence/);
  assert.match(renderer, /showTrajectories/);
  assert.match(renderer, /setRoute/);
  assert.match(renderer, /Raycaster/);
  assert.match(renderer, /IcosahedronGeometry/);
  assert.match(renderer, /PointsMaterial/);
  assert.match(renderer, /relativeLevel/);
  assert.match(renderer, /nightingaleToneFrames/);
  assert.match(renderer, /nightingaleToneCandidates/);
  assert.match(renderer, /webglcontextlost/);
  assert.doesNotMatch(renderer, /https?:\/\//, "the 3D runtime must not depend on a CDN");
});

test("the manifold palette is teal, amber, lime, and avoids pink accents", () => {
  assert.match(css, /--manifold-teal:\s*#[0-9a-f]{6}/i);
  assert.match(css, /--manifold-amber:\s*#[0-9a-f]{6}/i);
  assert.match(css, /--manifold-lime:\s*#[0-9a-f]{6}/i);
  assert.doesNotMatch(css, /#ff69b4|#ff82c8|hotpink|deeppink/i);
});
