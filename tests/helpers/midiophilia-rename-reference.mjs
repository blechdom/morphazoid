import { restoreGraphonicCalculatorSite } from './graphonic-calculator-site-reference.mjs';
import assert from "node:assert/strict";

const registryFile = "src/site/instrument-registry.js";
const renamedRecord = '    { id: "midiphoria", label: "Midiophilia", href: "midiphoria.html", catalogue: false, browse: true, entryType: "lab", imageHref: "assets/instruments/midiphoria.webp" },\n';
const originalRecord = renamedRecord.replace('label: "Midiophilia"', 'label: "Midiphoria"');

/** Undo only the approved display-name change for pre-rename hash evidence. */
export function restoreMidiophiliaRename(source, file) {
  source = restoreGraphonicCalculatorSite(source, file, { allowRestored: true });
  if (file !== registryFile) return source;
  assert.equal(source.split(renamedRecord).length - 1, 1,
    `${file}: exact Midiophilia rename`);
  return source.replace(renamedRecord, originalRecord);
}
