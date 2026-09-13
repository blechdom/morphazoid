/** Choose once per page: rotating a phone must not start a second model download. */
export function getSpiderDisplayProfile(win = globalThis) {
  const width = Number(win.innerWidth) || Number(win.document?.documentElement?.clientWidth) || Infinity;
  const mobileAssets = !!(win.matchMedia?.('(pointer: coarse)').matches || width <= 760 || win.navigator?.connection?.saveData);
  return Object.freeze(mobileAssets
    ? { mobileAssets, maxPixels: 600_000, maxDpr: 1.25, maxFps: 15, shadowMapSize: 512 }
    : { mobileAssets, maxPixels: 1_150_000, maxDpr: 1.5, maxFps: 20, shadowMapSize: 768 });
}
