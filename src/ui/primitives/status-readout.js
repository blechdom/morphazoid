import {
  applyCommonOptions,
  classNames,
  defineApi,
  defineGetter,
  nextId,
  requireDocument,
} from "../internal.js";

const TONES = new Set(["default", "muted", "warning", "danger"]);

/** Create the compact label/value readout repeated throughout control panels. */
export function createStatusReadout(options = {}, doc = globalThis.document) {
  requireDocument(doc);
  const root = doc.createElement("div");
  root.className = classNames("mz-status-readout", "structure-readout", options.className);
  applyCommonOptions(root, options);

  const label = doc.createElement("b");
  label.id = String(options.labelId ?? nextId("mz-readout-label", doc));
  label.className = "mz-status-readout__label";
  label.textContent = String(options.label ?? "Status");

  const output = doc.createElement("output");
  output.className = "mz-status-readout__value mz-readout";
  output.setAttribute("aria-labelledby", label.id);
  if (options.live) output.setAttribute("aria-live", options.live === true ? "polite" : String(options.live));
  root.append(label, output);

  const setValue = (value) => {
    output.value = String(value ?? "");
    output.textContent = output.value;
    return output.value;
  };
  const setTone = (tone) => {
    const next = TONES.has(tone) ? tone : "default";
    root.setAttribute("data-tone", next);
    return next;
  };

  setValue(options.value);
  setTone(options.tone);
  defineApi(root, { labelElement: label, output, setValue, setTone });
  defineGetter(root, "value", () => output.value);
  return root;
}
