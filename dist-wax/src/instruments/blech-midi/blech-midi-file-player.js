import { MidiphoriaPlayer } from '../midiphoria/midiphoria-player.js';
import { BlackMidiPlayedCounter } from './blech-midi-black-score.js';
import { mountMidiScoreView, readMidiAsset, MAX_PREVIEW_NOTES } from './blech-midi-score-view.js';
import { parseMidi, MIDI_SAMPLE_LIMITS } from '../midi-mixer/midi-mixer-model.js';
import { resolveBlechFileTiming, BLECH_MAX_FILE_RATE } from './blech-midi-timing.js';

const MAX_LOCAL_BYTES = 200 * 1024 * 1024;
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const timeLabel = seconds => `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.floor(Math.max(0, seconds) % 60)).padStart(2, '0')}`;

/** Full-score file transport, independent of drawing pads and live evolution. */
export function mountBlechFilePlayer(host, { engine, creditsHost, libraryHost, settingsHost, transportHost, onPrepare, onNoteCount, onKeyboardNote } = {}) {
  const events = new AbortController();
  const on = (node, type, fn) => node.addEventListener(type, fn, { signal: events.signal });
  host.innerHTML = `
    <div class="blech-file-layout">
      <div class="blech-file-stage">
        <div class="blech-file-channel">
        <div class="blech-file-transport" role="group" aria-label="MIDI file playback">
          <span class="blech-file-transport-label">MIDI file</span>
          <button id="blackPlayButton" data-primary-transport class="play-button" type="button" aria-pressed="false" aria-label="Play MIDI file" disabled><svg class="transport-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5 18 12 8 18.5Z" /></svg><svg class="transport-pause" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6v12M16 6v12" /></svg></button>
          <button id="blackStopButton" type="button" class="mini-action" aria-label="Stop and rewind MIDI file" title="Stop only the MIDI file" disabled>Stop</button>
          <label class="control" for="blackFileLevel" title="Volume of the MIDI file and the playable keyboard"><span><b>Volume</b><output id="blackFileLevelOut">75%</output></span><input id="blackFileLevel" aria-label="MIDI file and keyboard volume" type="range" min="0" max="1" step=".01" value=".75"></label>
          <label class="blech-file-bpm" for="blackFileTempo"><span>File BPM</span><input id="blackFileTempo" type="number" min="1" max="4800" step=".1" value="120" aria-label="Independent MIDI file tempo" disabled></label>
          <label class="blech-art-check blech-file-link" title="Follow the master tempo; ratio still applies"><input id="blackSyncTempo" type="checkbox">Link</label>
          <label class="blech-file-ratio" for="blackSpeedRatio"><span>Ratio</span><select id="blackSpeedRatio" aria-label="MIDI file speed ratio"><option value="0.125">⅛×</option><option value="0.25">¼×</option><option value="0.3333333333333333">⅓×</option><option value="0.5">½×</option><option value="0.6666666666666666">⅔×</option><option value="1" selected>1×</option><option value="1.5">1½×</option><option value="2">2×</option><option value="3">3×</option><option value="4">4×</option><option value="8">8×</option><option value="16">16×</option><option value="32">32×</option><option value="64">64×</option><option value="custom" disabled>Custom</option></select></label>
          <input id="blackTempoReference" type="hidden" value="120">
          <label class="control" for="blackPlaybackRate"><span><b>Speed</b><output id="blackPlaybackRateOut">1.00×</output></span><input id="blackPlaybackRate" aria-label="MIDI file speed" type="range" min=".125" max="64" step="any" value="1"></label>
          <label class="blech-art-check"><input id="blackLoopSong" type="checkbox">Loop</label>
          <button id="blackOriginalTiming" class="mini-action" type="button" title="Unlink and restore the MIDI file's original tempo and speed">Original</button>
        </div>
        <p id="blackTempoStatus" class="midiphoria-help" aria-live="off"></p>
        </div>
        <p id="blackCurrentSong" class="midiphoria-current-song" hidden></p>
        <p id="blackPlayerStatus" class="midiphoria-help" role="status"></p>
        <div class="blech-file-viewport"><div id="blackMidiViewport"></div><button id="blackFullscreen" type="button" class="mini-action" aria-label="Black MIDI fullscreen">⛶</button></div>
        <label class="control blech-file-position" for="blackSongPosition"><span><b>Position</b><output id="blackSongTime">0:00 / 0:00</output></span><input id="blackSongPosition" type="range" data-keep-slider min="0" max="1" step=".1" value="0" disabled></label>
        <section id="blackMidiControls" aria-label="Black MIDI score controls"></section>
      </div>
      <section class="blech-file-library" aria-labelledby="blackSongListHeading">
        <div class="midiphoria-library-heading"><h2 id="blackSongListHeading">MIDI files</h2><output id="blackSongCount">Loading…</output><button id="blackNextSong" type="button" class="mini-action" aria-label="Next MIDI" disabled>Next</button><button id="blackRandomSong" type="button" class="mini-action" aria-label="Random MIDI" disabled>Random</button></div>
        <label class="control" for="blackSongSelect"><span>Choose a MIDI file</span><select id="blackSongSelect" aria-label="MIDI file"><option value="">Choose a MIDI…</option></select></label>
        <label class="midiphoria-file">Open your MIDIs<input id="blackMidiFile" type="file" accept=".mid,.midi,audio/midi,audio/x-midi" multiple></label>
      </section>
    </div>`;
  const nodes = new Map([...host.querySelectorAll('[id]')].map(node => [node.id, node]));
  const $ = id => nodes.get(id);
  if (libraryHost) libraryHost.append(host.querySelector('.blech-file-library'));
  if (settingsHost) settingsHost.append($('blackMidiControls'));
  if (transportHost) transportHost.append(host.querySelector('.blech-file-channel'), $('blackCurrentSong'), $('blackPlayerStatus'), host.querySelector('.blech-file-position'));
  const songDescription = creditsHost.querySelector('#blackSongDescription');
  const songCredit = creditsHost.querySelector('#blackSongCredit');
  let transportRevision = 0;
  let disposed = false, frame = null, lastReflect = -Infinity, version = 0, request = null;
  let collection = [], locals = [], visible = [], selected = null, localSerial = 0;
  let loading = false, ready = false, resumeAfterSelection = false, error = '', tempo = null, timingKind = 'unknown', freeTempo = null, tempoChanges = 0, preparedSongId = '';
  let player, preparedScore = null, preparationError = '';
  const noteCounter = new BlackMidiPlayedCounter();
  let rebasingCounter = false;
  function getPlayedNoteCount() { return player && !rebasingCounter ? noteCounter.update(player.state) : noteCounter.count; }
  function resetNoteCount() { if (player) noteCounter.reset(player.state); return noteCounter.count; }
  function getSettings() {
    return { name: selected?.title ?? '', source: 'files', program: 'original', channel: null, loop: $('blackLoopSong').checked, gain: Number($('blackFileLevel').value), linked: $('blackSyncTempo').checked, ratio: Number($('blackPlaybackRate').value), sourceTempo: tempo, tempo: freeTempo ?? tempo, rate: player?.state.rate ?? 1 };
  }
  function notifyPrepared() {
    if (typeof onPrepare !== 'function') return;
    onPrepare({ score: preparedScore ? structuredClone(preparedScore) : null, settings: getSettings(), error: preparationError });
  }
  function prepareSelected(binary, song) {
    preparedScore = null; preparationError = '';
    if (typeof onPrepare !== 'function') return;
    const limit = 'This full MIDI can use the file transport. Layer drops accept up to 2 MB, 32,768 notes, 16 channels and 512 beats.';
    if (!(binary instanceof ArrayBuffer) || binary.byteLength > MIDI_SAMPLE_LIMITS.fileBytes || song.noteCount > MIDI_SAMPLE_LIMITS.notes) preparationError = limit;
    else try {
      const analysis = parseMidi(binary);
      if (analysis.notes.length > MIDI_SAMPLE_LIMITS.notes || analysis.events.length > MIDI_SAMPLE_LIMITS.events || analysis.channels.length > MIDI_SAMPLE_LIMITS.channels || analysis.durationBeats > MIDI_SAMPLE_LIMITS.beats) preparationError = limit;
      else preparedScore = { buffer: binary.slice(0), analysis, durationBeats: analysis.durationBeats, noteCount: analysis.noteCount, text: song.title };
    } catch (caught) { preparationError = caught.message || 'This MIDI cannot be sent as a layer.'; }
    notifyPrepared();
  }
  const view = mountMidiScoreView({ mount: $('blackMidiViewport'), controls: $('blackMidiControls'), getLiveState: () => engine.state, onNoteCount,
    onNoteOn: ({ sourceId, note, velocity }) => { const played = player?.padNoteOn(sourceId, note, velocity); if (played) onKeyboardNote?.(); return played; },
    onNoteOff: ({ sourceId }) => player?.padNoteOff(sourceId),
    getTransport: () => { const state = player?.state; return { position: state?.time ?? 0, playing: state?.playing ?? false, speed: state?.rate ?? 1 }; } });
  // One context and one final effects/volume/peak-control path for the whole page.
  // The file player already supplies an 8× preamp; undo that before Blech's 8× stage.
  player = new MidiphoriaPlayer({ minPlaybackRate: .01, maxPlaybackRate: BLECH_MAX_FILE_RATE, getAudioContext: () => engine.context,
    connectOutput: (context, node) => engine.connectExternalSource(context, node, { gain: 1 / 8 }),
    onState: () => reflect(),
  });
  player.setVolume(Number($('blackFileLevel').value));
  function reflect() {
    if (disposed || !player) return;
    const state = player.state;
    if (!rebasingCounter) noteCounter.update(state);
    $('blackPlayButton').disabled = !ready || !state.ready || loading || state.loading;
    $('blackPlayButton').setAttribute('aria-pressed', String(state.playing));
    $('blackPlayButton').setAttribute('aria-label', state.playing ? 'Pause MIDI file' : 'Play MIDI file');
    $('blackStopButton').disabled = !selected;
    $('blackSongPosition').disabled = !ready || !state.ready || loading;
    $('blackSongPosition').max = String(state.duration || 1);
    if (document.activeElement !== $('blackSongPosition')) $('blackSongPosition').value = String(state.time || 0);
    $('blackSongTime').value = `${timeLabel(state.time)} / ${timeLabel(state.duration)}`;
    $('blackPlayerStatus').textContent = error || state.error || (loading || state.loading ? 'Loading MIDI…' : '');
    host.dataset.playing = String(state.playing);
  }
  function setTempo() {
    const sync = $('blackSyncTempo').checked, speed = Number($('blackPlaybackRate').value);
    const timing = resolveBlechFileTiming({ sourceTempo: tempo, masterTempo: engine.state.tempo, linked: sync, freeTempo, ratio: speed });
    const rate = player.setPlaybackRate(timing.requestedRate);
    $('blackPlaybackRateOut').value = `${speed.toFixed(2)}×`;
    const ratio = [...$('blackSpeedRatio').options].find(option => Math.abs(Number(option.value) - speed) < .000001);
    $('blackSpeedRatio').value = ratio?.value ?? 'custom';
    $('blackFileTempo').disabled = !tempo || sync;
    $('blackSyncTempo').disabled = !tempo;
    $('blackTempoReference').value = String(tempo ? sync ? engine.state.tempo : freeTempo ?? tempo : 120);
    if (document.activeElement !== $('blackFileTempo')) $('blackFileTempo').value = tempo ? String(Number((sync ? engine.state.tempo : freeTempo ?? tempo).toFixed(1))) : '';
    $('blackFileTempo').setAttribute('aria-label', sync ? 'Linked master tempo before speed ratio' : 'Independent MIDI file tempo before speed ratio');
    const bpm = tempo ? `${Number((tempo * rate).toFixed(1))} BPM` : `${rate.toFixed(2)}×`;
    $('blackTempoStatus').textContent = !selected ? 'Choose a MIDI file'
      : timingKind === 'unknown' ? loading ? 'Reading file tempo…' : `Tempo unavailable · ${rate.toFixed(2)}× speed`
      : `${sync && tempo ? 'Linked' : 'Independent'} · ${bpm}${Math.abs(rate - timing.requestedRate) > .000001 ? ` · rate limited to 0.01–${BLECH_MAX_FILE_RATE}×` : ''}${tempoChanges ? ' at start · source tempo changes preserved' : ''}${!tempo ? ' · this score uses timecode' : ''}`;
  }
  const label = song => `${song.composer ? `${song.composer} · ` : ''}${song.title}`;
  const group = song => song.collection || 'Your MIDIs';
  function renderList() {
    visible = [...locals, ...collection];
    const select = $('blackSongSelect'), groups = new Map();
    select.replaceChildren(new Option('Choose a MIDI…', ''));
    for (const song of visible) {
      const name = group(song);
      if (!groups.has(name)) { const node = document.createElement('optgroup'); node.label = name; groups.set(name, node); select.append(node); }
      groups.get(name).append(new Option(label(song), song.id));
    }
    select.value = selected?.id ?? '';
    $('blackSongCount').value = `${visible.length} files`;
    $('blackNextSong').disabled = $('blackRandomSong').disabled = !visible.length;
    $('blackCurrentSong').hidden = !selected;
    $('blackCurrentSong').textContent = selected ? label(selected) : '';
  }
  function credit(song) {
    creditsHost.hidden = false;
    const node = songCredit; node.replaceChildren();
    node.append(document.createTextNode(song.attribution || (song.file ? '' : 'Your MIDI · stays in this browser.')));
    function link(text, href, download) {
      const a = document.createElement('a'); a.textContent = text; a.href = href;
      if (download) a.download = download; else { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
      node.append(document.createTextNode(' · '), a);
    }
    if (song.sourceUrl) link('Source ↗', song.sourceUrl);
    if (song.file) link(song.compression ? 'Download full MIDI (.gz)' : 'Download MIDI', new URL(`../../../assets/midiphoria/${song.file}`, import.meta.url), song.file.split('/').pop());
    if (song.licenseUrl) link(song.licenseName || 'License', song.licenseUrl);
  }
  async function select(song) {
    const ticket = ++version;
    resumeAfterSelection = player.state.playing || (loading && resumeAfterSelection);
    request?.abort(); request = new AbortController(); const signal = request.signal;
    preparedScore = null; preparationError = '';
    loading = true; ready = false; error = ''; selected = song; tempo = null; timingKind = 'unknown'; freeTempo = null; tempoChanges = 0; preparedSongId = '';
    const resume = resumeAfterSelection; stop(); resumeAfterSelection = resume;
    noteCounter.setScore(null); view.clear('Loading MIDI score…'); renderList(); credit(song); setTempo(); reflect();
    songDescription.textContent = ''; notifyPrepared();
    try {
      let binary = null, preview = null;
      if (song.noteCount > MAX_PREVIEW_NOTES) view.unavailable(song);
      else {
        binary = song.buffer ? song.buffer.slice(0) : song.localFile ? await song.localFile.arrayBuffer() : await readMidiAsset(song, signal);
        if (disposed || ticket !== version) return;
        preview = view.load(binary, { signal });
      }
      const paired = song.pairedAudioId && collection.find(item => item.id === song.pairedAudioId);
      const audio = paired ? await readMidiAsset(paired, signal) : binary?.byteLength <= MAX_AUDIO_BYTES ? binary : null;
      if (disposed || ticket !== version) return;
      const parsed = await preview;
      if (disposed || ticket !== version) return;
      tempo = parsed?.initialTempo ?? null; timingKind = parsed ? parsed.division & 0x8000 ? 'timecode' : 'musical' : 'unknown';
      tempoChanges = parsed?.tempoChanges ?? 0; setTempo();
      let loaded;
      if (audio) { preparedSongId = song.id; loaded = await player.load(audio, song.title, { preserveLeadIn: true }); }
      else {
        if (!parsed) throw new Error('This score cannot be previewed here. Download its complete original.');
        preparedSongId = song.id;
        loaded = await player.loadVisualTimeline(parsed.duration, song.title);
      }
      if (disposed || ticket !== version) return;
      ready = Boolean(loaded);
      noteCounter.setScore(parsed, player.state);
      // A layer always contains this exact score, even when playback has a
      // separate creator-provided AUDIO edition. Never substitute that edition.
      prepareSelected(binary, song);
      songDescription.textContent = paired
        ? 'Full decorative score · sound uses the creator’s AUDIO edition on its original timeline. Editions may differ.'
        : audio ? ''
          : 'Full score · silent visual playback. No separate audio edition is available for this file.';
      if (ready && resumeAfterSelection) player.play();
    } catch (caught) {
      if (!disposed && ticket === version) {
        preparedSongId = '';
        if (caught.name !== 'AbortError') error = caught.message || 'Could not load this MIDI.';
        preparedScore = null; preparationError = error; notifyPrepared();
      }
    } finally { if (!disposed && ticket === version) { loading = false; resumeAfterSelection = false; setTempo(); reflect(); } }
  }
  function clearSelection() {
    version++; request?.abort(); request = null; loading = false; ready = false; resumeAfterSelection = false; selected = null;
    tempo = null; timingKind = 'unknown'; freeTempo = null; tempoChanges = 0; preparedSongId = ''; preparedScore = null; preparationError = ''; error = '';
    stop(); noteCounter.setScore(null); view.clear(); renderList(); songDescription.textContent = ''; songCredit.replaceChildren(); setTempo(); reflect(); notifyPrepared();
  }
  function open() { view.setVisible(!document.hidden); }
  on($('blackSongSelect'), 'change', () => {
    const song = visible.find(item => item.id === $('blackSongSelect').value);
    if (song) void select(song); else clearSelection();
  });
  on($('blackNextSong'), 'click', () => { if (visible.length) void select(visible[(visible.findIndex(song => song.id === selected?.id) + 1) % visible.length]); });
  on($('blackRandomSong'), 'click', () => {
    const others = visible.filter(song => song.id !== selected?.id), choices = others.length ? others : visible;
    if (choices.length) void select(choices[Math.floor(Math.random() * choices.length)]);
  });
  function getTransportState() {
    const state = player.state;
    return { selectionId: selected?.id ?? null, selectionVersion: version, revision: transportRevision,
      ready: Boolean(ready && state.ready && !loading), loading, playing: state.playing || loading && resumeAfterSelection, time: state.time };
  }
  function play(expected = null) {
    if (disposed || !selected || expected && (expected.selectionVersion !== version || expected.revision !== transportRevision)) return false;
    if (loading) { resumeAfterSelection = true; transportRevision++; reflect(); return true; }
    if (!ready || !player.state.ready) return false;
    const before = player.state;
    getPlayedNoteCount();
    const restarting = before.time >= before.duration;
    if (restarting) rebasingCounter = true;
    let playing;
    try { playing = player.play(); } finally { rebasingCounter = false; }
    if (restarting) noteCounter.rebase(player.state, { includeStart: true });
    if (playing) transportRevision++;
    reflect(); return playing;
  }
  function pause() { if (disposed) return null; getPlayedNoteCount(); resumeAfterSelection = false; transportRevision++; player.pause(); reflect(); return getTransportState(); }
  on($('blackPlayButton'), 'click', () => { if (getTransportState().playing) pause(); else play(); });
  function stop() {
    getPlayedNoteCount(); resumeAfterSelection = false; transportRevision++; rebasingCounter = true;
    try { player.stop(); } finally { rebasingCounter = false; }
    noteCounter.rebase(player.state, { includeStart: true }); reflect();
  }
  on($('blackStopButton'), 'click', stop);
  on($('blackLoopSong'), 'change', () => player.setLoop($('blackLoopSong').checked));
  on($('blackPlaybackRate'), 'input', setTempo); on($('blackSyncTempo'), 'change', setTempo);
  on($('blackSpeedRatio'), 'change', () => { if ($('blackSpeedRatio').value === 'custom') return; $('blackPlaybackRate').value = $('blackSpeedRatio').value; $('blackPlaybackRate').dispatchEvent(new Event('input', { bubbles: true })); });
  on($('blackFileTempo'), 'input', () => { if ($('blackFileTempo').validity.valid && $('blackFileTempo').value !== '') { freeTempo = Number($('blackFileTempo').value); setTempo(); } });
  on($('blackOriginalTiming'), 'click', () => { freeTempo = null; $('blackSyncTempo').checked = false; $('blackPlaybackRate').value = '1'; $('blackPlaybackRate').dispatchEvent(new Event('input', { bubbles: true })); });
  on($('blackFileLevel'), 'input', () => { player.setVolume(Number($('blackFileLevel').value)); $('blackFileLevelOut').value = `${Math.round(Number($('blackFileLevel').value) * 100)}%`; });
  on($('blackSongPosition'), 'input', () => { $('blackSongTime').value = `${timeLabel(Number($('blackSongPosition').value))} / ${timeLabel(player.state.duration)}`; });
  on($('blackSongPosition'), 'change', () => {
    getPlayedNoteCount(); transportRevision++; rebasingCounter = true;
    try { player.seek(Number($('blackSongPosition').value)); } finally { rebasingCounter = false; }
    noteCounter.rebase(player.state); reflect();
  });
  on($('blackMidiFile'), 'change', () => {
    const files = [...$('blackMidiFile').files]; $('blackMidiFile').value = '';
    if (!files.length) return;
    const total = locals.reduce((sum, item) => sum + (item.localFile?.size ?? item.buffer?.byteLength ?? 0), 0) + files.reduce((sum, file) => sum + file.size, 0);
    if (locals.length + files.length > 20 || total > MAX_LOCAL_BYTES || files.some(file => file.size > MAX_LOCAL_BYTES)) {
      error = 'Keep up to 20 local MIDIs and 200 MB total. Large scores may be visual-only.'; reflect(); return;
    }
    const added = files.map(file => ({ id: `file-${++localSerial}`, title: file.name, localFile: file }));
    locals.push(...added); void select(added[0]);
  });
  on($('blackFullscreen'), 'click', async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await host.querySelector('.blech-file-viewport').requestFullscreen(); }
    catch { error = 'Fullscreen is unavailable in this browser.'; reflect(); }
  });
  const showHash = () => { if (['#blackMidiPlayer', '#black-midi'].includes(location.hash)) open(); };
  on(globalThis, 'hashchange', showHash);
  for (const link of document.querySelectorAll('a[href="#blackMidiPlayer"]')) on(link, 'click', open);
  function tick(now) {
    frame = null; if (disposed || document.hidden) return;
    if (now - lastReflect > 100) { lastReflect = now; reflect(); }
    frame = requestAnimationFrame(tick);
  }
  on(document, 'visibilitychange', () => {
    view.setVisible(!document.hidden);
    if (document.hidden) { if (frame !== null) cancelAnimationFrame(frame); frame = null; }
    else if (frame === null) frame = requestAnimationFrame(tick);
  });
  showHash(); view.setVisible(!document.hidden); setTempo(); reflect();
  if (!document.hidden) frame = requestAnimationFrame(tick);
  return {
    play, pause, stop, getTransportState, reflect, setTempo, getSettings, getPlayedNoteCount, resetNoteCount,
    getPreparedScore: () => preparedScore ? structuredClone(preparedScore) : null,
    setCollection(songs) { collection = songs; renderList(); },
    async enableAudio() {
      const enabled = await player.enableAudio();
      // A processor/load failure may have returned false to select(). Successful
      // Audio recovery makes that exact prepared selection playable again, but
      // must never revive an older file after a newer download failed.
      if (!disposed && !loading && enabled && player.state.ready && preparedSongId === selected?.id) { ready = true; error = ''; }
      reflect(); return enabled;
    },
    setAudioEnabled(enabled) { if (!enabled) view.releaseKeyboard(); player.setAudioEnabled(enabled); },
    releaseKeyboard() { view.releaseKeyboard(); player.releasePads(); },
    setNoteEffects: value => player.setNoteEffects(value),
    loadSoundFont: (bytes, name) => player.loadSoundFont(bytes, name),
    async previewScore(score, title = 'Your MIDI artwork') {
      if (!(score?.buffer instanceof ArrayBuffer)) throw new Error('Prepare a drawing or artwork first.');
      const old = locals.findIndex(song => song.id === 'prepared-art'); if (old >= 0) locals.splice(old, 1);
      const song = { id: 'prepared-art', title, buffer: score.buffer.slice(0), collection: 'Your artwork', attribution: 'Prepared in BLECH MIDI.' };
      locals.unshift(song); open(); await select(song);
    },
    dispose() { if (disposed) return; disposed = true; version++; request?.abort(); events.abort(); if (frame !== null) cancelAnimationFrame(frame); view.dispose(); void player.dispose(); libraryHost?.replaceChildren(); settingsHost?.replaceChildren(); transportHost?.replaceChildren(); host.replaceChildren(); },
  };
}
