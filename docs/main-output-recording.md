# Main output recording

The red circle beside the output meters records the current instrument's final
stereo mix, after its effects and master volume. Turn Audio on, click Record,
then click the square to Stop. Recording does not start transport, enable the
microphone, or change what you hear. The elapsed counter follows captured audio
frames. Computer/system volume does not affect the file.

The recording is an uncompressed **24-bit stereo WAV** at the output's sample
rate. Mono output becomes dual mono. Surround output uses the shared stereo
downmix. Capture runs on the instrument’s own audio clock, without resampling or
passing audio through a media stream.

## Saving

**Save after Stop** is the default. Record immediately; after Stop, edit the
suggested instrument/date/time filename and select Save WAV. Supporting browsers
open a save picker; others download the file. **Download WAV** is also available
beside Save WAV when the picker exists, so you can use a normal browser download
if writing to the chosen file is blocked. Embedded browsers (including editor
previews) may expose the picker while restricting file writes. Try another
filename/folder or use Download WAV; cancelled and failed saves keep the take.
Saving again requests a new writable file and keeps the same recorded audio.
Keep for later closes the dialog
without deleting the take. The header's save arrow reopens it. New recording
returns to the red circle, confirming before discarding an unconfirmed take.
An initiated download is not proof that the browser saved it: the take is kept
available until you explicitly start a new one or leave the page.

**Record to file**, in Settings → Recording, is available when the browser
supports the file picker and writable file API (commonly desktop Chrome/Edge).
Choose the name/location before recording. Audio is written incrementally,
then the WAV header is finalized and the file closed on Stop. Saved is shown
only after that close succeeds. Browser writes can be transactional; this is
not a guarantee that a playable, growing file is visible on the desktop while
recording, or that an interrupted tab can recover its unfinished file.

No audio is uploaded. Recording the application's output requires neither
microphone nor screen-sharing permission. Live-input instruments retain their
existing separate microphone permission. In WAX, use the host's recorder.

## Limits and interruptions

Buffered recording has a 128 MiB PCM limit: approximately **7:46 at 48 kHz**,
or 8:27 at 44.1 kHz. Settings and the Record tooltip show the limit calculated
for the current output rate. At that limit, recording stops with a saveable
take. Direct-file recording stops before ordinary WAV's roughly 4 GiB limit,
approximately **4 hours 8 minutes at 48 kHz**. Start another take to continue; automatic file
splitting is not included. Stereo 24-bit audio uses about 1.04 GB/hour at 48 kHz.

Recording uses bounded transferable chunks on the audio thread. If storage or
the UI thread falls too far behind, capture stops and reports the interruption
instead of dropping samples silently or interrupting the instrument. Saveable
buffered audio is retained. Disk failures are reported without claiming that
an unfinished file was saved.

Keep the page open and the device awake. A screen wake lock is requested while
recording when supported, but mobile backgrounding, sleep, crashes, or operating
system audio interruptions can still stop capture. A navigation warning protects
active and unconfirmed takes where the browser supports it. That warning and
asynchronous finalization cannot guarantee recovery after a forced close.

## Integration

`src/audio-output-manager.js` provides a direct stereo recording tap for final
output nodes. Adding/replacing a source on that clock joins the take. Stopping
recording releases only the tap, never the instrument’s context or playback
route. Recording never depends on the visual meter timer. Instruments that mix
several engines share one context so all engines enter the same recording. An
unexpected additional independent output stops capture with an explicit error;
it is never silently omitted or passed through a potentially lossy clock bridge.

`src/output-recorder.js` owns capture, file writing and take lifecycle;
`src/output-recorder-processor.js` encodes bounded PCM chunks.
`src/site/output-recording-controls.js` owns the header control, settings and
save dialog. Capturing is project-wide; microphone/loop record buttons inside
individual instruments keep their original purposes.
