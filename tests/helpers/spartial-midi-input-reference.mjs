import assert from "node:assert/strict";

// Peel only the later MIDI master-volume guard before the older frozen
// SPARTIAL source proofs. Unrelated changes remain visible to their hashes.
const edits = new Map([
  ["src/browser-midi-adapter.js", [[
    '  if (!control || control.disabled || control.hasAttribute?.("data-midi-no-input")) return false;\n',
    '  if (!control || control.disabled) return false;\n',
  ]]],
  ["src/pages/spartial.html", [[
    '      <label class="header-level" for="level"><span><b>Volume</b><output id="levelOut" for="level">65%</output></span><input id="level" aria-label="Master audio level" data-midi-no-input type="range" min="0" max="1" step="0.01" value="0.65" /></label>\n',
    '      <label class="header-level" for="level"><span><b>Volume</b><output id="levelOut" for="level">65%</output></span><input id="level" aria-label="Master audio level" type="range" min="0" max="1" step="0.01" value="0.65" /></label>\n',
  ]]],
  ["src/instruments/spartial/spartial-app.js", [[
    `  } else if (message.type === "channelPressure" || message.type === "polyPressure"
    || message.type === "controlChange" && [7, 11].includes(message.controller)) {
    // SPARTIAL has no pressure/expression voice mapping. Do not reinterpret
    // these messages as master or percussion gain (including at note release).
    event.preventDefault();
`, "",
  ]]],
  ["docs/spartial.md", [[
    `The master Volume knob is performer-owned: incoming MIDI notes, note release,
aftertouch, expression (CC11), master level (CC7), and generic controller macros
never change it. SPARTIAL ignores aftertouch and CC7/11 rather than redirecting
them to a different volume control; other mapped MIDI controls still work.

`, "",
  ]]],
]);

export function restoreSpartialMidiInputSource(source, file, { allowRestored = false } = {}) {
  if (typeof source !== "string") return source;
  const replacements = edits.get(file);
  if (!replacements) return source;
  const first = replacements[0];
  if (allowRestored && !source.includes(first[0])) return source;
  for (const [after, before] of replacements) {
    assert.equal(source.split(after).length - 1, 1, `${file}: exact SPARTIAL MIDI input guard`);
    source = source.replace(after, before);
  }
  return source;
}
