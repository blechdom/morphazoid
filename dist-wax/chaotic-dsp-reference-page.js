import {
  CHAOTIC_DSP_REFERENCES,
  chaoticDspReferenceForId,
  renderChaoticDspReference,
} from "./src/chaotic-dsp-reference.js";

const root = document.querySelector("[data-chaos-dsp-reference-page]");
const select = document.querySelector("#dspSynthSelect");
const title = document.querySelector("#dspReferenceTitle");
const instrumentLink = document.querySelector("#dspInstrumentLink");

function requestedReferenceId() {
  const requested = new URL(window.location.href).searchParams.get("synth");
  return chaoticDspReferenceForId(requested)?.id
    ?? CHAOTIC_DSP_REFERENCES[0].id;
}

function updateUrl(id, method = "replaceState") {
  const url = new URL(window.location.href);
  url.searchParams.set("synth", id);
  url.hash = "";
  window.history[method]({}, "", url);
}

function showReference(id, { historyMethod = null } = {}) {
  const reference = chaoticDspReferenceForId(id) ?? CHAOTIC_DSP_REFERENCES[0];
  root.dataset.chaosDspReference = reference.id;
  renderChaoticDspReference(root, reference, document);
  select.value = reference.id;
  title.textContent = reference.label;
  instrumentLink.href = `${reference.id}.html#dsp-reference`;
  instrumentLink.setAttribute("aria-label", `Back to ${reference.label}`);
  document.title = `${reference.label} DSP Reference - Morphazoid`;
  if (historyMethod) updateUrl(reference.id, historyMethod);
}

select.addEventListener("change", () => {
  showReference(select.value, { historyMethod: "pushState" });
  window.scrollTo({ top: 0, behavior: "auto" });
});

window.addEventListener("popstate", () => showReference(requestedReferenceId()));

const initialId = requestedReferenceId();
showReference(initialId, { historyMethod: "replaceState" });
