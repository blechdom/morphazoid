const rendererParameter = "graph";
const xyflowRenderer = "xyflow";
const xyflowAssetVersion = "20260906-module-rail";
const params = new URLSearchParams(globalThis.location?.search ?? "");
const requestedRenderer = params.get(rendererParameter);
const comparisonLink = document.getElementById("graphRendererComparison");
const rendererStatus = document.getElementById("graphRendererStatus");

function comparisonUrl(enableXyflow) {
  const url = new URL(globalThis.location?.href ?? "shader-synth-playground.html", document.baseURI);
  if (enableXyflow) url.searchParams.set(rendererParameter, xyflowRenderer);
  else url.searchParams.delete(rendererParameter);
  return `${url.pathname}${url.search}${url.hash}`;
}

function syncComparisonLink(xyflowActive) {
  if (!comparisonLink) return;
  comparisonLink.href = comparisonUrl(!xyflowActive);
  comparisonLink.textContent = xyflowActive ? "Original canvas" : "Try XYFlow";
  comparisonLink.setAttribute(
    "aria-label",
    xyflowActive
      ? "Compare with the original Morphazoid patch canvas"
      : "Compare with the XYFlow patch canvas",
  );
  comparisonLink.setAttribute("aria-current", xyflowActive ? "page" : "false");
}

function addXyflowStylesheet() {
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = `assets/xyflow/shader-synth-playground-xyflow.css?v=${xyflowAssetVersion}`;
  stylesheet.dataset.xyflowStylesheet = "";
  const ready = new Promise((resolve, reject) => {
    stylesheet.addEventListener("load", resolve, { once: true });
    stylesheet.addEventListener(
      "error",
      () => reject(new Error("The XYFlow stylesheet could not be loaded.")),
      { once: true },
    );
  });
  document.head.append(stylesheet);
  return { stylesheet, ready };
}

async function boot() {
  const wantsXyflow = requestedRenderer === xyflowRenderer;
  syncComparisonLink(wantsXyflow);

  if (wantsXyflow) {
    document.body.dataset.graphRendererRequested = xyflowRenderer;
    const { stylesheet, ready: stylesheetReady } = addXyflowStylesheet();
    try {
      const assetResults = await Promise.allSettled([
        stylesheetReady,
        import(`./assets/xyflow/shader-synth-playground-xyflow.js?v=${xyflowAssetVersion}`),
      ]);
      const failedAsset = assetResults.find((result) => result.status === "rejected");
      if (failedAsset) throw failedAsset.reason;
      if (typeof globalThis.MorphazoidShaderSynthGraphRenderer?.mount !== "function") {
        throw new Error("The XYFlow renderer did not register its mount function.");
      }
      document.body.dataset.graphRendererReady = xyflowRenderer;
      if (rendererStatus) {
        rendererStatus.hidden = false;
        rendererStatus.textContent = "XYFlow canvas";
      }
    } catch (error) {
      stylesheet.remove();
      delete globalThis.MorphazoidShaderSynthGraphRenderer;
      delete document.body.dataset.graphRendererReady;
      syncComparisonLink(false);
      if (rendererStatus) {
        rendererStatus.hidden = false;
        rendererStatus.textContent = "Original canvas · XYFlow unavailable";
      }
      console.warn("XYFlow comparison renderer unavailable; using the original canvas.", error);
    }
  }

  await import("./shader-synth-playground-app.js?v=20260906-module-rail-tooltip");
}

void boot();
