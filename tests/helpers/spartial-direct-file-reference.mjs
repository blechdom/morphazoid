import assert from "node:assert/strict";

// Remove only this later recording option before older frozen source proofs.
// An altered option or unrelated source drift must remain detectable.
const edits = new Map([
  ["src/pages/spartial.html", [[
    '        <label id="multitrackFileOption" class="spartial-record-to-file" for="multitrackToFile"><input id="multitrackToFile" type="checkbox" />Record multichannel WAV directly to a file</label>\n', "",
  ]]],
  ["src/instruments/spartial/spartial.css", [[`.spartial-record-to-file { display: flex; align-items: center; gap: 8px; min-height: 38px; color: var(--muted); font-size: 11px; cursor: pointer; }
.spartial-record-to-file input { accent-color: #ff596d; }
@media (pointer: coarse) { .spartial-record-to-file { min-height: 48px; } }
`, ""]]],
  ["docs/spartial.md", [[
    `The available time appears beside the multitrack control. With **Record
multichannel WAV directly to a file** unchecked (the default), capture uses a
bounded 128 MiB buffer: at 48 kHz, approximately 3:53 for four channels, 1:56
for eight, 1:17 for twelve, or 0:58 for sixteen. At the limit, capture stops
and preserves the take for export. Audio off or an interrupted audio context
also finalizes the captured portion. Save cancellation or failure keeps the
original take; **Discard take** frees it for a new recording. Export before
closing the page.
`,
    `The available time appears beside the multitrack control. Capture uses a bounded
128 MiB buffer: at 48 kHz, approximately 3:53 for four channels, 1:56 for eight,
1:17 for twelve, or 0:58 for sixteen. At the limit, capture stops and preserves
the take for export. Audio off or an interrupted audio context also finalizes
the captured portion. Save cancellation or failure keeps the original take;
**Discard take** frees it for a new recording. Export before closing the page.
`,
  ], [`
On browsers with a writable save picker (usually desktop Chrome/Edge), check
**Record multichannel WAV directly to a file** before pressing Record. Choose
the file first; the recorder then writes bounded chunks of all physical
channels to it and finalizes the WAV header on Stop. **Saved** appears only
after the file closes successfully. This avoids the 128 MiB browser buffer;
the ordinary WAV format still limits one file to approximately 4 GiB, or about
**1:02:08 for 7.1 at 48 kHz** (0:41:25 for twelve channels, 0:31:04 for
sixteen). The displayed limit uses the *actual* audio sample rate and channel
count. Direct recording produces one multichannel WAV, not a tracks ZIP or
folder; choose buffered recording if you need those exports. **New take**
clears the recorder's status but does not delete the saved file.

Browsers do not reliably expose free RAM or the remaining space in the chosen
folder. \`navigator.storage.estimate()\` describes this site's browser-storage
quota, not the selected disk. Disk speed, permissions, full storage, sleep, or
an interrupted tab can end recording before the format limit. Browser writes
may be transactional, so an unfinished file is not guaranteed to be visible
or recoverable until Stop completes. Keep the page and device awake; if the
file picker or write permission is unavailable, use the buffered mode. The
separate masthead Record button also offers direct-to-file recording, but
captures only the stereo monitoring mix.
`, ""]]],
]);

export function restoreSpartialDirectFileSource(source, file, { allowRestored = false } = {}) {
  if (typeof source !== "string") return source;
  const replacements = edits.get(file);
  if (!replacements) return source;
  const first = replacements[0];
  if (allowRestored && !source.includes(first[0])) return source;
  for (const [after, before] of replacements) {
    assert.equal(source.split(after).length - 1, 1, `${file}: exact SPARTIAL direct-file addition`);
    source = source.replace(after, before);
  }
  return source;
}
