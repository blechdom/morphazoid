import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  COMBO_NATIVE_INSTRUMENTS,
  COMBO_SOUNDS,
  comboInstrumentFor,
  sanitizeComboFocus,
} from "../src/combo-host.js";
import { resolveActiveTool, TOOL_GROUPS } from "../nav.js";

const repositoryRoot = new URL("../", import.meta.url);

test("combo host maps exactly to the six existing Morphazoid instruments", async () => {
  assert.deepEqual(Object.keys(COMBO_NATIVE_INSTRUMENTS), [
    "shape-synth",
    "shape-drums",
    "solid-synth",
    "solid-drums",
    "hyper-synth",
    "hyper-drums",
  ]);
  assert.deepEqual(
    Object.values(COMBO_NATIVE_INSTRUMENTS).map(({ href }) => href),
    [
      "shape.html",
      "shape-drums.html",
      "solid.html",
      "solid-drums.html",
      "hyper.html",
      "hyper-drums.html",
    ],
  );

  for (const instrument of Object.values(COMBO_NATIVE_INSTRUMENTS)) {
    const html = await readFile(new URL(instrument.href, repositoryRoot), "utf8");
    assert.match(
      html,
      new RegExp(`<script type="module" src="${instrument.appModule.replace(".", "\\.")}"></script>`),
      `${instrument.title} uses its original application module`,
    );

    if (instrument.sound === "synth") {
      assert.match(html, /id="soundMode"/);
      for (const voice of ["sine", "fm", "pm", "shepard", "percussion"]) {
        assert.match(html, new RegExp(`value="${voice}"`), `${instrument.title} exposes ${voice}`);
      }
    } else {
      assert.match(html, /id="mappingMode"/);
      assert.match(html, instrument.geometry === "shape" ? /id="sideSubdivisions"/ : /id="subdivisions"/);
    }
  }
});

test("combo focus sanitization falls back to Polygon Synth", () => {
  assert.equal(comboInstrumentFor("solid", "drums").href, "solid-drums.html");
  assert.equal(sanitizeComboFocus({ geometry: "hyper", sound: "synth" }).href, "hyper.html");
  assert.equal(sanitizeComboFocus({ geometry: "invalid", sound: "noise" }).href, "shape.html");
  assert.equal(COMBO_SOUNDS.synth.systemLabel, "Voices");
  assert.equal(COMBO_SOUNDS.drums.systemLabel, "Triggers");
});

test("Shapes is an additive focused host without a replacement sequencer or audio engine", async () => {
  const [html, redirect, css, embedCss, app] = await Promise.all([
    readFile(new URL("shapes.html", repositoryRoot), "utf8"),
    readFile(new URL("combo.html", repositoryRoot), "utf8"),
    readFile(new URL("combo.css", repositoryRoot), "utf8"),
    readFile(new URL("combo-embed.css", repositoryRoot), "utf8"),
    readFile(new URL("combo-app.js", repositoryRoot), "utf8"),
  ]);
  const comboTool = TOOL_GROUPS.flatMap(({ tools }) => tools).find(({ id }) => id === "combo");
  assert.equal(comboTool?.href, "shapes.html");
  assert.equal(comboTool?.label, "Shapes");
  assert.equal(TOOL_GROUPS.find(({ id }) => id === "apps")?.tools[0]?.id, "combo");
  assert.equal(resolveActiveTool(
    "https://example.test/morphazoid/shapes.html",
    "https://example.test/morphazoid/",
  )?.id, "combo");
  assert.match(redirect, /new URL\("shapes\.html", window\.location\.href\)/);
  assert.match(redirect, /destination\.search = window\.location\.search/);
  assert.match(redirect, /destination\.hash = window\.location\.hash/);
  assert.match(redirect, /window\.location\.replace\(destination\)/);
  assert.match(redirect, /<link rel="canonical" href="shapes\.html"/);
  assert.doesNotMatch(redirect, /nativeInstrumentFrame|combo-app\.js/);
  assert.match(html, /<iframe[^>]+id="nativeInstrumentFrame"/s);
  assert.match(html, /<iframe[^>]+id="nativeInstrumentFrame"[^>]+loading="eager"/s);
  assert.match(html, /<title>Shapes — Morphazoid<\/title>/);
  assert.match(html, /src="shape\.html\?combo-embed=1"/);
  assert.doesNotMatch(html, /combo-modebar|geometry-owned pitched voices|Original ↗/);
  assert.match(app, /prepareNativeInstrumentPicker/);
  assert.match(app, /current\.textContent !== "Shapes"/);
  assert.match(app, /MutationObserver\(enforceShapesLabel\)/);
  assert.match(app, /link\.target = "_top"/);
  assert.match(app, /wordmark\.target = "_top"/);
  assert.match(app, /label:\s*"2D"/);
  assert.match(app, /label:\s*"3D"/);
  assert.match(app, /label:\s*"4D"/);
  assert.match(app, /label:\s*"Continuous"/);
  assert.match(app, /label:\s*"Notes"/);
  assert.match(app, /label:\s*"Triggers"/);
  assert.match(app, /label:\s*"Percussive"/);
  assert.doesNotMatch(html, /sequencer|sequence-grid/i);
  assert.doesNotMatch(app, /AudioContext|createOscillator|FmDrumAudio|scheduleStep/);
  assert.match(app, /contentDocument/);
  assert.match(app, /audioButton/);
  assert.match(app, /getElementById\("soundMode"\)/);
  assert.match(app, /getElementById\("mappingMode"\)/);
  assert.match(app, /sideSubdivisions/);
  assert.match(app, /installNativePluginLayout/);
  assert.match(app, /activateNativeBank/);
  assert.match(app, /installNativeRouteToolbar/);
  assert.match(app, /createNativeRouteKnob/);
  assert.match(app, /createNativeRotationToggle/);
  assert.match(app, /selectNativePerformanceMode/);
  assert.match(app, /resetNativeControlBank/);
  assert.match(app, /watchNativeFrameReadiness\(frame, instrument\)/);
  assert.match(app, /frameHasExpectedDocument\(frame, instrument\) && nativeBridge\(frame\)/);
  assert.doesNotMatch(app, /documentFallbackReady|FRAME_READINESS_FALLBACK/);
  assert.match(app, /finally \{\s*frame\.dataset\.ready = "true";[\s\S]*frameReadyWaiters\.delete\(frame\);\s*\}/);
  const enhanceStart = app.indexOf("function enhanceNativeFrame");
  const enhanceEnd = app.indexOf("\nfunction nativeBridge", enhanceStart);
  const enhancement = app.slice(enhanceStart, enhanceEnd);
  assert.ok(
    enhancement.indexOf("nativeDocument.head.append(stylesheet)")
      < enhancement.lastIndexOf("finishFrameLoad(frame, instrument)"),
    "native controls become ready without waiting for the full iframe load event",
  );
  assert.doesNotMatch(app, /createNativeInstrumentSelect|TOOL_GROUPS/);
  assert.match(css, /\.combo-host\s*\{[^}]*height:\s*100dvh[^}]*display:\s*block/s);
  assert.match(embedCss, /body\.combo-native-embed \.masthead > \.tabs/);
  assert.match(embedCss, /\.masthead > \.tabs\.combo-native-picker\s*\{[^}]*display:\s*flex\s*!important/s);
  assert.match(embedCss, /\.combo-native-route/);
  assert.match(embedCss, /\.combo-control-rail/);
  assert.match(embedCss, /\.masthead > \.wordmark\s*\{[^}]*display:\s*inline-flex\s*!important/s);
  assert.match(embedCss, /\.masthead > \.header-io-controls\s*\{[^}]*width:\s*auto/s);
  assert.match(embedCss, /\.panel\.combo-plugin-panel\s*\{[^}]*overflow:\s*hidden/s);
  assert.match(embedCss, /\.combo-plugin-reset\s*\{\s*display:\s*none\s*!important/);
  assert.match(embedCss, /\.combo-bank-reset/);
  assert.match(embedCss, /\.combo-native-knob-dial/);
  assert.match(embedCss, /--combo-native-menu-control-height:\s*30px/);
  assert.match(
    embedCss,
    /\.combo-native-route-select select\s*\{[^}]*height:\s*var\(--combo-native-menu-control-height\);[^}]*min-height:\s*var\(--combo-native-menu-control-height\)/s,
  );
  assert.match(
    embedCss,
    /\.instrument-picker-trigger\s*\{[^}]*height:\s*var\(--combo-native-menu-control-height\);[^}]*min-height:\s*var\(--combo-native-menu-control-height\)/s,
  );
  assert.match(embedCss, /\.combo-bank-tabs/);
  assert.match(embedCss, /\.combo-host-mirrored-control\s*\{\s*display:\s*none\s*!important/);
  assert.match(embedCss, /grid-template-rows:\s*40px minmax\(0, 1fr\)/);
  assert.match(embedCss, /\.combo-performance-routing/);
  assert.match(embedCss, /\.combo-primary-speed-control/);
  assert.match(embedCss, /\.combo-live-rotation/);
  assert.match(embedCss, /@media \(max-width: 960px\)[\s\S]*overflow-y:\s*auto/);
  assert.doesNotMatch(embedCss, /\.audio-strip\s*\{[^}]*display:\s*none/s);
  assert.doesNotMatch(html, /combo-edition|<header class="masthead">/);
  assert.match(app, /routeToolbar\?\.rail\.append\(tabs\)/);
  assert.match(app, /panel\.prepend\(rail\)/);
  assert.match(app, /const CONTROL_BANKS = Object\.freeze\(\["play", "form", "rotation", "mapping"\]\)/);
  assert.match(app, /play:\s*"Main"/);
  assert.match(app, /mappingBody\.prepend\(\.\.\.soundBody\.children\)/);
  assert.doesNotMatch(app, /soundSection\.remove\(\)/);
  assert.match(app, /for \(const selector of \["\.rotation-position-row", "#rotationControls"\]\)/);
  assert.match(app, /activateNativeBank\(frame, "mapping"\)/);
  assert.match(app, /layout\.buttons\[targetIndex\]\.scrollIntoView/);

  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "Combo host HTML IDs stay unique");
});
