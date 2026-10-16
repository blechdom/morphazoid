import { test, expect } from '@playwright/test';

test('Rust stripe visibility preserves the original pixels and reuses the unchanged escape field', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createStripedStaircaseRenderer, createStaircaseFrame, cameraFromView, viewById, STRIPED_STAIRCASE_DEFAULTS } =
      await import('/src/instruments/striped-staircase/striped-staircase.js');
    const { createRustStaircaseRenderer } = await import('/src/instruments/striped-staircase-rust/renderer.js');
    const width = 320, height = 240;
    const original = createStripedStaircaseRenderer(document.createElement('canvas'));
    const rust = createRustStaircaseRenderer(document.createElement('canvas'));
    original.resize(width, height);
    rust.resize(width, height);
    const read = renderer => {
      const pixels = new Uint8Array(width * height * 4);
      const gl = renderer.gl;
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return pixels;
    };
    const differences = (a, b) => a.reduce((count, value, index) => count + Number(value !== b[index]), 0);
    const camera = cameraFromView(viewById('seahorse'));
    const settings = { ...STRIPED_STAIRCASE_DEFAULTS };
    const defaultDifferences = [];
    for (const [depth, palette] of [[0.175, 0], [41 / 63, 2], [0.9, 3]]) {
      const frame = createStaircaseFrame(depth, settings);
      original.render(frame, settings, camera, 1, palette);
      const reference = read(original);
      rust.render(frame, settings, camera, 1, palette);
      defaultDifferences.push(differences(reference, read(rust)));
    }
    const frame = createStaircaseFrame(0.175, settings);
    rust.render(frame, settings, camera);
    const striped = read(rust);
    const fieldState = rust.fieldState, fieldTexture = rust.fieldTexture;
    rust.gl.bindFramebuffer(rust.gl.FRAMEBUFFER, rust.fieldFramebuffer);
    const fieldBefore = read(rust);
    rust.render(frame, settings, camera, 1, 0, { showStripes: false });
    const unstriped = read(rust);
    rust.render(frame, { ...settings, stripePeriod: 19 }, camera, 1, 0, { showStripes: false });
    const periodDifferences = differences(unstriped, read(rust));
    rust.gl.bindFramebuffer(rust.gl.FRAMEBUFFER, rust.fieldFramebuffer);
    const fieldDifferences = differences(fieldBefore, read(rust));
    rust.render(frame, settings, camera, 1, 0, { showStripes: true });
    const restoredDifferences = differences(striped, read(rust));
    const shades = new Set();
    for (let i = 0; i < unstriped.length; i += 4) shades.add(unstriped[i]);
    const output = {
      defaultDifferences, periodDifferences, fieldDifferences, restoredDifferences,
      shadeCount: shades.size,
      changedPixels: differences(striped, unstriped) / 3,
      sameFieldState: rust.fieldState === fieldState,
      sameFieldTexture: rust.fieldTexture === fieldTexture,
      glErrors: [original.gl.getError(), rust.gl.getError()],
    };
    const contourProgram = rust.contourProgram;
    rust.destroy();
    output.contourProgramDeleted = !rust.gl.isProgram(contourProgram);
    original.destroy();
    return output;
  });
  expect(result.defaultDifferences).toEqual([0, 0, 0]);
  expect(result.periodDifferences).toBe(0);
  expect(result.fieldDifferences).toBe(0);
  expect(result.restoredDifferences).toBe(0);
  expect(result.changedPixels).toBeGreaterThan(320 * 240 / 4);
  expect(result.shadeCount).toBeGreaterThan(32);
  expect(result.sameFieldState).toBe(true);
  expect(result.sameFieldTexture).toBe(true);
  expect(result.glErrors).toEqual([0, 0]);
  expect(result.contourProgramDeleted).toBe(true);
});
