import assert from "node:assert/strict";

// Reverse the October 1 owner-requested removal only for older source proofs.
// Their frozen hashes still detect every unrelated metadata change.
const removals = {
  "src/site/instrument-catalog.js": {
    anchor: '  "bell-square": define(\n',
    removed: [
      '  morphazoidical: define(',
      '    "Mapping workbench",',
      '    "Shows the live form, contact, reader, and event data available for geometry-to-sound mappings.",',
      '    "Turn on audio, choose a form and reader, then drag the stage and inspect its live values.",',
      '  ),',
      '',
    ].join("\n"),
  },
  "src/site/instrument-registry.js": {
    anchor: '    { id: "bell-square", label: "Bell Square", href: "bell-square.html" },\n',
    removed: '    { id: "morphazoidical", label: "Morphazoidical", href: "morphazoidical/", match: "directory" },\n',
  },
  "src/site/instrument-midi-capabilities.js": {
    anchor: '    "order-tones",\n    "bell-square",',
    restored: '    "order-tones",\n    "morphazoidical",\n    "bell-square",',
  },
  "src/site/catalogue-taxonomy.js": {
    anchor: '  "order-tones": [],\n  "bell-square": [],',
    restored: '  "order-tones": [],\n  "morphazoidical": [],\n  "bell-square": [],',
  },
};

export function restoreMorphazoidicalRemoval(source, file) {
  const removal = removals[file];
  if (!removal) return source;
  assert.equal(source.split(removal.anchor).length - 1, 1, `${file}: exact Morphazoidical removal anchor`);
  return source.replace(removal.anchor, removal.restored ?? removal.removed + removal.anchor);
}
