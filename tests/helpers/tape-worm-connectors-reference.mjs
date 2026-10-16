import { restoreWipRolloutSite } from './wip-rollout-site-reference.mjs';
import { restoreMicInputBatchSite } from './mic-input-batch-site-reference.mjs';
import { restoreHeaderPresetsBatchSite } from './header-presets-batch-site-reference.mjs';
import { restoreGraphonicCalculatorSite } from './graphonic-calculator-site-reference.mjs';
import assert from "node:assert/strict";

const file = "src/families/work-in-progress/network-view.js";
const overlay = [
  "    // Tape connectors stay visible over every loop. Keep their wider hit paths",
  "    // underneath the loops so crossing a control never steals its pointer input.",
  "    this.routeDrawing = this.routesSvg;",
  "    if (tape) {",
  '      this.routeDrawing = svg("svg", { class: "network-routes network-route-overlay", viewBox: `0 0 ${NETWORK_SIZE.width} ${NETWORK_SIZE.height}`, "aria-hidden": "true" });',
  "      surface.append(this.routeDrawing);",
  "    }",
  "",
].join("\n");
const replacements = [
  { before: "", after: overlay },
  { before: "    this.routesSvg.append(path, hit);", after: "    this.routeDrawing.append(path); this.routesSvg.append(hit);" },
];

/** Reverse only the reviewed foreground connector change; keep layout hashes frozen. */
export function restoreTapeWormConnectors(source, relative) {
  source = restoreWipRolloutSite(source, relative, { allowRestored: true });
  source = restoreMicInputBatchSite(source, relative, { allowRestored: true });
  source = restoreHeaderPresetsBatchSite(source, relative, { allowRestored: true });
  source = restoreGraphonicCalculatorSite(source, relative, { allowRestored: true });
  if (relative !== file) return source;
  for (const { before, after } of replacements) {
    assert.equal(source.split(after).length - 1, 1, `${file}: exact foreground connector amendment`);
    source = source.replace(after, before);
  }
  return source;
}
