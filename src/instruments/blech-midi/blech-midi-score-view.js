import { createBlackMidiVisualizer, blackMidiColor } from './blech-midi-black-renderer.js';
import { mountMixerKnobs } from '../midi-mixer/midi-mixer-knobs.js';

const MAX_SCORE_BYTES = 200 * 1024 * 1024;
export const MAX_PREVIEW_NOTES = 12000000;
const count = value => Math.round(value || 0).toLocaleString();

/** Bounded, lossless decompression; this never edits or removes MIDI events. */
export async function readMidiAsset(song, signal) {
  const response = await fetch(new URL(`../../../assets/midiphoria/${song.file}`, import.meta.url), { signal });
  if (!response.ok) throw new Error('Could not load this song. Choose another or open a local MIDI file.');
  const limit = song.compression ? MAX_SCORE_BYTES : 10 * 1024 * 1024;
  let stream = response.body;
  if (song.compression === 'gzip') {
    if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot unpack the full score. Download it or use a current browser.');
    stream = stream.pipeThrough(new DecompressionStream('gzip'));
  }
  const reader = stream.getReader(), chunks = [];
  let bytes = 0;
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) throw new Error(`This MIDI exceeds the ${limit / 1024 / 1024} MB loading limit.`);
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  signal?.throwIfAborted();
  const binary = new Uint8Array(bytes); let offset = 0;
  for (const chunk of chunks) { binary.set(chunk, offset); offset += chunk.byteLength; }
  if (song.uncompressedBytes && bytes !== song.uncompressedBytes) throw new Error('The full score download is incomplete. Try selecting it again.');
  return binary.buffer;
}

export function mountMidiScoreView({ mount, controls, getTransport, getLiveState, onNoteOn, onNoteOff, onNoteCount }) {
  const events = new AbortController();
  controls.innerHTML = `
    <h2>Visualizer</h2>
    <div class="midiphoria-score-stats" aria-label="MIDI score statistics">
      <span>Total notes <output data-total>—</output></span><span>Passed <output data-passed>0</output></span>
      <span>Notes / second <output data-nps>0</output></span><span>Held notes <output data-held>0</output></span><span>Live layers <output data-live>0</output></span>
    </div>
    <p class="midiphoria-help" role="status" data-score-status>Choose a MIDI to see its complete score.</p>
    <label class="control"><span><b>Color by</b></span><select data-color-by><option value="track">Track</option><option value="channel">MIDI channel</option><option value="pitch">Pitch</option><option value="velocity">Velocity</option></select></label>
    <label class="control"><span><b>Palette</b></span><select data-palette><option value="rainbow">Rainbow</option><option value="candy">Candy</option><option value="ember">Ember</option><option value="ice">Ice</option><option value="acid">Acid</option></select></label>
    <label class="control"><span><b>Keyboard layout</b></span><select data-alignment><option value="piano">Piano keys · 128 pitches</option><option value="equal">Equal pitch lanes · 128 pitches</option></select></label>
    <label class="control"><span><b>Future</b><output data-look-output>6 s</output></span><input data-look aria-label="Future window" type="range" min="1" max="20" step="0.5" value="6"></label>
    <label class="control"><span><b>Trail lifetime</b><output data-past-output>4 s</output></span><input data-past aria-label="Past trail lifetime" type="range" min="0.5" max="20" step="0.5" value="4"></label>
    <label class="control"><span><b>Keyboard position</b><output data-present-output>78%</output></span><input data-present aria-label="Keyboard position" type="range" min="30" max="80" step="1" value="78"></label>
    <label class="blech-art-check"><input data-trails type="checkbox" checked>Past trails</label>
    <details><summary>Tracks &amp; colors</summary><p class="midiphoria-help">Overlaid on one keyboard. Checkboxes change the picture; audio keeps playing.</p><button type="button" class="mini-action" data-reset-colors>Reset track colors</button><div data-tracks class="midiphoria-score-tracks"></div></details>
    <details><summary>Score details</summary><p class="midiphoria-help" data-score-detail></p><p class="midiphoria-help">Total counts positive-velocity Note On events. Held and peak count overlapping note gates, before sustain, effects or the synthesizer's voice limit. Notes/second counts attacks in the preceding score second.</p><p class="midiphoria-help">File notes show the source score before MIDI effects. Playing pads and Automatapoeia share this keyboard; their forecasts follow their own clocks and current note effects. Changing a rule updates future generations. Above the keys is the future; below them is fading history. Future sets the fall speed. Trail lifetime sets how long the past remains, until it leaves the picture. Keyboard position divides the picture. File history follows its playhead, including seeks; live history follows each layer and continues after a pad stops. Dense forecasts and history have separate display limits.</p></details>
    <p class="midiphoria-help"><a href="#midiArtCreator">Make MIDI artwork ↓</a> · <a href="assets/midiphoria/ARTWORK-SOURCES.md" target="_blank" rel="noopener">Collections &amp; artist sources ↗</a></p>`;
  const $ = selector => controls.querySelector(selector);
  const knobs = mountMixerKnobs(controls);
  let renderer, score = null, lastStats = null, request = null, serial = 0, disposed = false;
  let trackColors = {}, hiddenTracks = [], unavailableCount = null;
  const on = (node, type, listener) => node.addEventListener(type, listener, { signal: events.signal });
  function options() {
    return { colorBy: $('[data-color-by]').value, palette: $('[data-palette]').value,
      alignment: $('[data-alignment]').value, lookAhead: Number($('[data-look]').value),
      pastSeconds: Number($('[data-past]').value), keyboardPosition: Number($('[data-present]').value) / 100,
      trails: $('[data-trails]').checked, trackColors, hiddenTracks };
  }
  function details() {
    if (!lastStats) return;
    const diagnostics = score?.diagnostics ?? {};
    $('[data-score-detail]').textContent = `${lastStats.renderer || 'Preparing renderer'} · Peak ${count(score?.peakPolyphony)} held · ${count(lastStats.visible)} drawn / ${count(lastStats.candidateCount)} in view${lastStats.omitted ? ` · ${count(lastStats.omitted)} omitted from this frame (score counts remain complete)` : ''}${lastStats.liveVisible ? ` · ${count(lastStats.liveVisible)} live notes in view` : ''}${lastStats.liveTruncated ? ' · live preview capped' : ''}.${diagnostics.unclosed ? ` ${count(diagnostics.unclosed)} notes without an off event end at the track boundary.` : ''}${diagnostics.unmatchedOffs ? ` ${count(diagnostics.unmatchedOffs)} unmatched off events.` : ''}`;
  }
  renderer = createBlackMidiVisualizer({ mount, getTransport, getLiveState, onNoteOn, onNoteOff,
    onStatus(value) { $('[data-score-status]').textContent = value.message || ''; },
    onStats(stats) {
      lastStats = stats;
      for (const [key, value] of [['total', unavailableCount ?? stats.total], ['passed', stats.passed], ['nps', stats.notesPerSecond], ['held', stats.held + stats.liveHeld]]) $('[data-' + key + ']').value = count(value);
      $('[data-live]').value = count(stats.liveSources.length);
      onNoteCount?.({ passed: unavailableCount != null ? null : score ? stats.passed : 0, total: unavailableCount ?? score?.total ?? null });
      details();
    },
  });
  function configure() {
    $('[data-look-output]').value = `${$('[data-look]').value} s`;
    $('[data-past-output]').value = `${$('[data-past]').value} s`;
    $('[data-present-output]').value = `${$('[data-present]').value}%`;
    renderer.setOptions(options());
    for (const input of controls.querySelectorAll('[data-track][type="color"]')) {
      input.value = trackColors[input.dataset.track] || '#' + blackMidiColor({ track: Number(input.dataset.track), pitch: 60, channel: 0, velocity: 96 }, { ...options(), colorBy: 'track' })
        .map(value => Math.round(value * 255).toString(16).padStart(2, '0')).join('');
    }
  }
  on($('[data-reset-colors]'), 'click', () => { trackColors = {}; configure(); });
  for (const node of controls.querySelectorAll('select, [data-look], [data-past], [data-present], [data-trails]')) on(node, 'input', configure);
  on($('[data-tracks]'), 'input', event => {
    const node = event.target, id = Number(node.dataset.track);
    if (!Number.isInteger(id)) return;
    if (node.type === 'color') trackColors = { ...trackColors, [id]: node.value };
    else hiddenTracks = [...controls.querySelectorAll('[data-track][type="checkbox"]:not(:checked)')].map(input => Number(input.dataset.track));
    configure();
  });
  function clear(message = 'Choose a MIDI to see its complete score.') {
    serial++; request?.abort(); request = null; score = null; lastStats = null; unavailableCount = null;
    renderer.setScore(null); $('[data-tracks]').replaceChildren(); trackColors = {}; hiddenTracks = [];
    $('[data-score-status]').textContent = message; $('[data-score-detail]').textContent = '';
    $('[data-total]').value = '—'; for (const key of ['passed', 'nps', 'held']) $('[data-' + key + ']').value = '0';
    onNoteCount?.({ passed: 0, total: null });
  }
  async function load(buffer, { signal } = {}) {
    clear('Reading complete MIDI score…');
    const version = serial; request = new AbortController(); const active = request;
    const abort = () => active.abort(); signal?.addEventListener('abort', abort, { once: true });
    try {
      signal?.throwIfAborted();
      const parsed = await renderer.load(buffer, { signal: active.signal });
      if (disposed || version !== serial) return null;
      score = parsed;
      const rows = score.tracks.filter(track => track.noteCount).map(track => {
        const label = document.createElement('label'); label.className = 'midiphoria-score-track';
        const input = document.createElement('input'); input.type = 'checkbox'; input.checked = true; input.dataset.track = track.id;
        input.setAttribute('aria-label', `Show ${track.name || `Track ${track.id + 1}`}`);
        const name = document.createElement('span'); name.textContent = `${track.name || `Track ${track.id + 1}`} · ${count(track.noteCount)}`;
        const color = document.createElement('input'); color.type = 'color'; color.value = '#96f4cc'; color.dataset.track = track.id;
        color.setAttribute('aria-label', `Color for ${track.name || `Track ${track.id + 1}`}`);
        label.append(input, name, color); return label;
      });
      $('[data-tracks]').replaceChildren(...rows); configure();
      return score;
    } catch (error) {
      if (!disposed && version === serial && error.name !== 'AbortError') $('[data-score-status]').textContent = error.message || 'Could not read this score.';
      return null;
    } finally { signal?.removeEventListener('abort', abort); }
  }
  configure();
  return { load, clear,
    unavailable(song) { clear(`${count(song.noteCount)} notes · exceeds the 12 million-note preview limit. The complete original is available from Download full MIDI below; its audio edition can still play.`); unavailableCount = song.noteCount; $('[data-total]').value = count(song.noteCount); onNoteCount?.({ passed: null, total: song.noteCount }); },
    setVisible(value) { renderer.setVisible(value); },
    setLiveSource(value) { renderer.setLiveSource(value); },
    releaseKeyboard() { renderer.releaseKeyboard(); },
    dispose() { disposed = true; clear(); events.abort(); knobs.destroy(); renderer.dispose(); },
  };
}
