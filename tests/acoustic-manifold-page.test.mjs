import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../acoustic-manifold.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../acoustic-manifold.css", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../acoustic-manifold-app.js", import.meta.url), "utf8");
const sourceCatalog = fs.readFileSync(
  new URL("../src/acoustic-source-catalog.js", import.meta.url),
  "utf8",
);

test("the Acoustic Manifold shell exposes profile, built-in, upload, and live sources", () => {
  for (const id of [
    "acoustic-manifold-root",
    "manifold-canvas",
    "analysis-profile",
    "built-in-source",
    "built-in-count",
    "load-built-in",
    "audio-file",
    "live-input-device",
    "live-window-seconds",
    "live-input-meter",
    "live-input-state",
    "start-live-input",
    "capture-live-input",
    "reanalyze",
    "analysis-tuning",
    "analysis-tuning-state",
    "analysis-minimum-spectral-hz",
    "analysis-maximum-spectral-hz",
    "analysis-minimum-event-seconds",
    "analysis-gap-seconds",
    "analysis-fixed-window-seconds",
    "analysis-fixed-window-overlap",
    "analysis-minimum-active-ratio",
    "analysis-frame-size",
    "analysis-hop-ratio",
    "analysis-target-rate",
    "analysis-sequence-gap-seconds",
    "analysis-neighbor-count",
    "reset-analysis-parameters",
    "analysis-parameter-summary",
    "recording-order",
    "recording-order-title",
    "recording-order-note",
    "recorded-order-example",
    "analysis-flow-title",
    "route-apply-state",
    "tone-stat",
    "analysis-rate-stat",
    "selected-signal-glyph",
    "selected-amplitude-area",
    "selected-frequency-trace",
    "selected-frame-beads",
    "selected-tone-markers",
    "archive-count",
    "archive-search",
    "archive-group",
    "archive-results",
    "archive-library",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
  }

  assert.match(html, /value=["']songbird["']/);
  assert.match(html, /id=["']profile-research-title["']/);
  assert.match(html, /id=["']profile-band["']/);
  assert.match(html, /id=["']profile-evidence["']/);
  assert.match(html, /id=["']profile-capture-note["']/);
  assert.match(html, /id=["']source-compatibility["']/);
  assert.match(html, /id=["']profile-library["']/);
  assert.match(html, /68 operational presets/);

  assert.match(html, /thrush-nightingale-synthetic/);
  assert.match(sourceCatalog, /field-cricket-synthetic/);
  for (const source of [
    "thrush-nightingale",
    "common-blackbird",
    "chaffinch",
    "house-cricket",
    "field-cricket",
    "european-field-cricket",
    "coyote-chorus",
    "frog-soundscape",
    "dolphin-vocalizations",
    "humpback-whale-song",
    "killer-whale-call",
    "blue-whale-south-pacific",
  ]) {
    assert.match(sourceCatalog, new RegExp(`id: ["']${source}["']`), `missing ${source}`);
  }
  assert.match(app, /function populateBuiltInSourceSelect/);
  assert.match(html, /Nothing is sent to a server/i);
  assert.match(html, /grant browser permission/i);
  assert.match(html, /graph is rebuilt after you stop/i);
  assert.match(html, /not a continuous species detector/i);
  assert.match(html, /PCM WAV keeps its source sample rate/i);
  assert.match(html, /adaptive activity gate still measures full-band frame energy/i);
  assert.match(html, /do not retrain a classifier/i);
  assert.match(html, /blank disables/i);
  assert.match(html, /id=["']analysis-tuning-state["'][^>]+role=["']status["'][^>]+aria-live=["']polite["']/);
  assert.match(html, /id=["']analysis-parameter-summary["'][^>]+role=["']status["'][^>]+aria-live=["']polite["']/);
  assert.match(html, /id=["']analysis-target-rate["'][^>]+step=["']1["']/);
  assert.match(html, /ordinary browser microphones and compressed decoding usually stop near the audible band/i);
  assert.match(html, /Indigenous songs are not animal data/i);
  assert.match(html, /does not by itself authorize dataset extraction/i);
  assert.match(html, /CARE Principles for Indigenous Data Governance/i);
  assert.match(sourceCatalog, /Watkins Marine Mammal Sound Database/);
  assert.match(sourceCatalog, /DOLPHINFREE/);
  assert.match(sourceCatalog, /InsectSet459/);
  assert.match(sourceCatalog, /Australian Bat Acoustic Data Collection/);
  assert.match(sourceCatalog, /PARADISEC/);
  assert.match(sourceCatalog, /Ancestral Voices · Passamaquoddy recordings/);
});

test("the generic shell retains the complete playable graph workflow", () => {
  for (const id of [
    "listen-mode",
    "walk-rule",
    "route-length",
    "surprise",
    "build-route",
    "reverse-route",
    "route-ribbon",
    "play-route",
    "stop-route",
    "node-list",
    "audition-selected",
    "add-selected",
    "export-physical",
    "export-json",
    "resynthesis-preset",
    "gesture-speed",
    "pitch-shift",
    "manifold-exaggeration",
    "body-scale",
    "texture-amount",
    "route-gap",
    "reset-resynthesis",
    "resynthesis-summary",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
  }

  assert.match(html, /shell shows relative level/i);
  assert.match(html, /Nothing is shipped pre-analyzed/i);
  assert.match(html, /Position is similarity, not time/i);
  assert.match(html, /Recorded order/i);
  assert.match(html, /Playback order/i);
  assert.match(html, /core diameter duration · shell gap relative RMS/i);
  assert.match(html, /ribbon · small frames \/ diamond candidates · amber low → blue high/i);
  assert.match(html, /dotted teal[^<]*acoustic similarity/i);
  assert.match(html, /solid amber[^<]*observed succession/i);
  assert.match(html, /Dotted links are acoustic neighbors/i);
  for (const rule of [
    "reverse-chronology",
    "spatial-nearest",
    "spatial-farthest",
    "axis-x",
    "axis-y",
    "axis-z",
    "shuffled",
  ]) assert.match(html, new RegExp(`value=["']${rule}["']`));
  assert.match(html, /PC1 bends pitch, PC2 texture, and PC3 speed/i);
  assert.match(html, /not a measured physiological limit/i);
});

test("the multifractal explanation distinguishes the claim from multiscale summaries", () => {
  assert.match(html, /Multiscale analysis<\/b> asks how a measurement changes/i);
  assert.match(html, /different scaling exponents/i);
  assert.match(html, /multifractal detrended fluctuation analysis/i);
  assert.match(html, /surrogate signals/i);
  assert.match(html, /does <b>not<\/b> estimate a multifractal spectrum/i);
  assert.match(html, /not by themselves evidence of multifractality/i);
});

test("the additive stylesheet reuses the established responsive manifold design", () => {
  assert.match(css, /@import url\(["']\.\/nightingale-manifold\.css["']\)/);
  assert.match(css, /\.live-source/);
  assert.match(css, /#live-input-meter/);
  assert.match(css, /\.profile-research/);
  assert.match(css, /\.profile-library/);
  assert.match(css, /\.archive-library/);
  assert.match(css, /\.archive-controls/);
  assert.match(css, /data-archive-kind=["']community["']/);
  assert.match(css, /\.analysis-tuning/);
  assert.match(css, /\.analysis-parameter-grid/);
  assert.match(css, /analysis-parameter-summary\[data-mode=["']custom["']\]/);
  assert.match(css, /\[aria-invalid=["']true["']\]/);
  assert.match(css, /source-compatibility\[data-coverage=["']limited["']\]/);
  assert.match(css, /\.resynthesis-card/);
  assert.match(css, /\.resynthesis-summary\[data-mode=["']extrapolated["']\]/);
  assert.match(css, /\.route-build-actions/);
  assert.match(css, /\.recording-timeline/);
  assert.match(css, /#recording-order/);
  assert.match(css, /\.analysis-flow/);
  assert.match(css, /\.selected-signal/);
  assert.match(css, /@media \(max-width: 520px\)/);
  assert.doesNotMatch(css, /#ff69b4|#ff82c8|hotpink|deeppink/i);
});
