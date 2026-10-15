import { restoreHeaderPresetsBatchSite } from './header-presets-batch-site-reference.mjs';
import { restoreGraphonicCalculatorSite } from './graphonic-calculator-site-reference.mjs';
import assert from "node:assert/strict";

const amendments = {
  "src/families/work-in-progress/loop-network-app.js": [{
    before: '  const rect = $("networkSurface").getBoundingClientRect(); return { x: e.clientX - rect.left, y: e.clientY - rect.top };',
    after: [
      '  const surface = $("networkSurface"), rect = surface.getBoundingClientRect();',
      "  // Client coordinates include the view's translation/scale and both scrollers.",
      "  // Convert back to the native network units used by loops and route phases.",
      "  return {",
      "    x: (e.clientX - rect.left) * (rect.width ? surface.offsetWidth / rect.width : 1),",
      "    y: (e.clientY - rect.top) * (rect.height ? surface.offsetHeight / rect.height : 1),",
      "  };",
    ].join("\n"),
  }],
  "src/families/work-in-progress/network-view.js": [{
    before: [
      '      if (v.out) describeButton(v.out, `Route ${a.label} to ${b.label} exit`);',
      '      if (v.entry) describeButton(v.entry, `Route ${a.label} to ${b.label} entry`);',
    ].join("\n"),
    after: [
      "      if (v.out) {",
      '        describeButton(v.out, `Route ${a.label} to ${b.label} exit`);',
      '        v.out.setAttribute("aria-pressed", String(selectedRoute === route.id));',
      "      }",
      "      if (v.entry) {",
      '        describeButton(v.entry, `Route ${a.label} to ${b.label} entry`);',
      '        v.entry.setAttribute("aria-pressed", String(selectedRoute === route.id));',
      "      }",
    ].join("\n"),
  }],
  "src/families/work-in-progress/loop-network.css": [{
    before: "",
    after: '.network-port[aria-pressed="true"] { z-index: 1; border-color: #fff0b3; }\n',
  }],
};

/** Reverse only the scaled-pointer/selected-gate fix, proved by loop-network-pointer.spec.mjs. */
export function restoreLoopNetworkPointers(source, relative) {
  source = restoreHeaderPresetsBatchSite(source, relative, { allowRestored: true });
  source = restoreGraphonicCalculatorSite(source, relative, { allowRestored: true });
  for (const { before, after } of amendments[relative] ?? []) {
    assert.equal(source.split(after).length - 1, 1, `${relative}: exact pointer/gate amendment`);
    source = source.replace(after, before);
  }
  return source;
}
