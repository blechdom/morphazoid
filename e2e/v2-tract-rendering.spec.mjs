import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

import { specimenState, voicePresetState } from "../src/throatazoid.js";
import { createTractGeometryHarness } from "../tests/helpers/tract-geometry-harness.mjs";
import { attachJson } from "./helpers/canvas-preservation.mjs";
import { pageDiagnosticMessages, watchPageDiagnostics } from "./helpers/diagnostics.mjs";

const fixture = JSON.parse(await readFile(new URL("../tests/fixtures/tract-rendering-v1.json", import.meta.url)));
const geometryFixture = JSON.parse(await readFile(new URL("../tests/fixtures/tract-geometry-v1.json", import.meta.url)));
const originalGeometry = createTractGeometryHarness(geometryFixture.records[0]);
const layouts = [
  { name: "desktop", width: 1000, height: 600, dpr: 1 },
  { name: "portrait", width: 390, height: 500, dpr: 3 },
  { name: "landscape", width: 844, height: 300, dpr: 2 },
];

for (const layout of layouts) {
  for (const prefix of ["", "/dist-wax"]) {
    test(`${prefix || "browser"}: fixed-frame tract pixels match the original at ${layout.name}`, async ({ page, baseURL, browser }, testInfo) => {
      const diagnostics = watchPageDiagnostics(page, { baseURL });
      await page.route("**/v2-render-probe.html", (route) => route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><html lang="en"><head><title>Drawing comparison</title></head><body></body></html>',
      }));
      await page.goto(`${baseURL}/v2-render-probe.html`);
      const scenes = [];
      for (const anatomy of ["clear", "hydra", "oracle"]) {
        const state = anatomy === "clear" ? voicePresetState("clear")
          : { ...voicePresetState("clear"), ...specimenState(anatomy) };
        for (const reduced of [false, true]) {
          state.articulationAperture = anatomy === "clear" ? 0.32 : 0.01;
          state.glottalClosure = anatomy === "oracle" ? 0.95 : 0;
          const selectedThroat = state.throatCount - 1;
          originalGeometry.setScene(state, { ...layout, selectedThroat });
          scenes.push({
            name: `${anatomy}-${reduced ? "reduced" : "animated"}`,
            state: structuredClone(state),
            geometry: originalGeometry.call("tractGeometry"),
            view: {
              cssWidth: layout.width, cssHeight: layout.height,
              selectedThroat, selectedTongue: state.tongueCount - 1, selectedNose: 0,
              sourcePressures: state.pressureSources.map((_, index) => index * 0.13),
              mouthPressures: state.throats.map((_, index) => index * 0.1),
              tractPressure: 0.7, prefersReducedMotion: reduced,
              pointerDrag: { type: "tract-constriction" },
              burstFlashUntil: 825, burstFlashPlace: 0.6,
              keyboardPulse: { startedAt: 610, place: 0.8, letter: "s", capital: true },
            },
          });
        }
      }
      // Explicitly encode typed profiles; do not depend on automation serialization.
      const encodedScenes = JSON.parse(JSON.stringify(scenes, (_key, value) =>
        ArrayBuffer.isView(value) ? Array.from(value) : value));
      const results = await page.evaluate(async ({ fixture, pointSource, layout, prefix, scenes }) => {
        const { clamp } = await import(`${prefix}/src/throatazoid.js`);
        const { drawPhysicalTract } = await import(`${prefix}/src/families/tract/rendering.js`);
        const original = Function("drawing", "clamp", "state", "geometry", "view", `
          const {
            cssWidth, cssHeight, selectedThroat, selectedTongue, selectedNose,
            sourcePressures, mouthPressures, tractPressure, prefersReducedMotion,
            pointerDrag, burstFlashUntil, burstFlashPlace, keyboardPulse,
          } = view;
          let currentTract, currentTongues, currentNoses, currentBodyHandles;
          const isAwake = () => true;
          const tractGeometry = () => geometry;
          const animatedTractDiameterProfile = () => geometry.diameters;
          ${pointSource}
          ${fixture.colorWithAlpha}
          ${fixture.block}
          drawPhysicalTract(750, 0.75, state);
        `);
        const colorWithAlpha = Function(`return (${fixture.colorWithAlpha});`)();
        const expectedCanvas = document.createElement("canvas");
        const actualCanvas = document.createElement("canvas");
        const results = [];
        for (const scene of scenes) {
          scene.geometry.diameters = new Float32Array(scene.geometry.diameters);
          for (const canvas of [expectedCanvas, actualCanvas]) {
            canvas.width = Math.round(layout.width * layout.dpr);
            canvas.height = Math.round(layout.height * layout.dpr);
            canvas.getContext("2d").setTransform(layout.dpr, 0, 0, layout.dpr, 0, 0);
          }
          const expected = expectedCanvas.getContext("2d");
          const actual = actualCanvas.getContext("2d");
          original(expected, clamp, scene.state, scene.geometry, scene.view);
          drawPhysicalTract(actual, scene.geometry, 750, 0.75, scene.state, {
            ...scene.view, isAwake: () => true, colorWithAlpha,
          });
          const a = expected.getImageData(0, 0, expectedCanvas.width, expectedCanvas.height).data;
          const b = actual.getImageData(0, 0, actualCanvas.width, actualCanvas.height).data;
          let differingBytes = 0;
          let paintedPixels = 0;
          for (let index = 0; index < a.length; index += 1) {
            if (a[index] !== b[index]) differingBytes += 1;
            if (index % 4 === 3 && a[index] > 0) paintedPixels += 1;
          }
          results.push({
            name: scene.name, differingBytes, paintedPixels,
            ...(differingBytes > 0 ? {
              expectedPng: expectedCanvas.toDataURL(), actualPng: actualCanvas.toDataURL(),
            } : {}),
          });
        }
        return results;
      }, {
        fixture, pointSource: geometryFixture.records[0].functions.tractPoint,
        layout, prefix, scenes: encodedScenes,
      });
      for (const result of results) {
        for (const key of ["expectedPng", "actualPng"]) {
          if (result[key]) {
            await testInfo.attach(`${result.name}-${key}.png`, {
              body: Buffer.from(result[key].split(",")[1], "base64"), contentType: "image/png",
            });
            delete result[key];
          }
        }
      }
      await attachJson(testInfo, "fixed-frame-rendering.json", {
        browser: browser.version(), layout, prefix, results,
        scope: "Same-browser fixed-time Canvas pixels, not live animation or audio equivalence.",
      });
      expect(pageDiagnosticMessages(diagnostics)).toEqual([]);
      for (const result of results) {
        expect(result.paintedPixels, result.name).toBeGreaterThan(0);
        expect(result.differingBytes, result.name).toBe(0);
      }
    });
  }
}
