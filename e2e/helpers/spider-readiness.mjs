/** Read existing instrument state; never arm audio or start a replacement load. */
export function spiderModelStatus(win = window, doc = document) {
  const instrument = win.spiderSynth?.getState();
  return {
    initialized: Boolean(instrument),
    loading: Boolean(instrument?.modelLoading),
    loaded: Boolean(instrument?.loaded),
    bones: instrument?.bones?.length ?? 0,
    vertices: instrument?.skin?.vertices ?? 0,
    disposed: Boolean(instrument?.disposed),
    retryVisible: doc.getElementById("retryModel")?.hidden === false,
    message: doc.getElementById("modelStatus")?.textContent?.trim() ?? "",
    audioOn: Boolean(instrument?.audioOn),
  };
}

export function requireLoadedSpider(status) {
  if (!status.initialized || status.loading || !status.loaded || status.disposed
    || status.retryVisible || status.bones !== 38 || status.vertices <= 0) {
    throw new Error(`Spider model did not become ready: ${JSON.stringify(status)}`);
  }
}
