import { MidiphoriaPlayer } from '../midiphoria/midiphoria-player.js';
import { mountMidiScoreView, readMidiAsset, MAX_PREVIEW_NOTES } from './blech-midi-score-view.js';

const MAX_LOCAL_BYTES = 200 * 1024 * 1024;
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const timeLabel = seconds => `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.floor(Math.max(0, seconds) % 60)).padStart(2, '0')}`;

/** Full-score file transport, independent of drawing pads and live evolution. */
export function mountBlechFilePlayer(host, { engine, creditsHost, onAudioRequest } = {}) {
  const events = new AbortController();
  const on = (node, type, fn) => node.addEventListener(type, fn, { signal: events.signal });
  host.innerHTML = `<summary>Black MIDI player</summary>
    <div class="blech-file-layout">
      <div class="blech-file-stage">
        <div class="blech-file-transport">
          <button id="blackPlayButton" class="play-button" type="button" aria-pressed="false" aria-label="Play Black MIDI" disabled><svg class="transport-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5 18 12 8 18.5Z" /></svg><svg class="transport-pause" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6v12M16 6v12" /></svg></button>
          <button id="blackStopButton" type="button" class="mini-action" aria-label="Stop and rewind Black MIDI" disabled>■</button>
          <label class="control" for="blackPlaybackRate"><span><b>Speed</b><output id="blackPlaybackRateOut">1.00×</output></span><input id="blackPlaybackRate" type="range" min=".5" max="8" step=".05" value="1"></label>
          <label class="control" for="blackFileLevel"><span><b>File volume</b><output id="blackFileLevelOut">75%</output></span><input id="blackFileLevel" type="range" min="0" max="1" step=".01" value=".75"></label>
          <label class="blech-art-check"><input id="blackLoopSong" type="checkbox">Loop file</label>
          <label class="blech-art-check"><input id="blackSyncTempo" type="checkbox">Sync to tempo</label>
        </div>
        <p id="blackTempoStatus" class="midiphoria-help"></p>
        <button id="blackAudioStart" class="midiphoria-audio-start" type="button" hidden>Turn audio on</button>
        <p id="blackPlayerStatus" class="midiphoria-help" role="status"></p>
        <div class="blech-file-viewport"><div id="blackMidiViewport"></div><button id="blackFullscreen" type="button" class="mini-action" aria-label="Black MIDI fullscreen">⛶</button></div>
        <label class="control blech-file-position" for="blackSongPosition"><span><b>Position</b><output id="blackSongTime">0:00 / 0:00</output></span><input id="blackSongPosition" type="range" data-keep-slider min="0" max="1" step=".1" value="0" disabled></label>
        <details class="blech-file-settings"><summary>Colors, keyboard &amp; statistics</summary><section id="blackMidiControls" aria-label="Black MIDI score controls"></section></details>
      </div>
      <section class="blech-file-library" aria-labelledby="blackSongListHeading">
        <div class="midiphoria-library-heading"><h2 id="blackSongListHeading">MIDI files</h2><output id="blackSongCount">Loading…</output><button id="blackNextSong" type="button" class="mini-action" aria-label="Next MIDI" disabled>Next</button><button id="blackRandomSong" type="button" class="mini-action" aria-label="Random MIDI" disabled>Random</button></div>
        <label class="control"><span class="sr-only">Filter MIDI files</span><input id="blackSongSearch" type="search" placeholder="Filter by song, artist or collection" autocomplete="off"></label>
        <p id="blackSongSearchStatus" class="midiphoria-help" role="status"></p>
        <p id="blackCurrentSong" class="midiphoria-current-song" hidden></p>
        <ul id="blackSongList" class="midiphoria-song-list" aria-labelledby="blackSongListHeading" aria-busy="true"></ul>
        <label class="midiphoria-file">Open your MIDIs<input id="blackMidiFile" type="file" accept=".mid,.midi,audio/midi,audio/x-midi" multiple></label>
      </section>
    </div>`;
  const $ = id => host.querySelector(`#${id}`);
  const songDescription = creditsHost.querySelector('#blackSongDescription');
  const songCredit = creditsHost.querySelector('#blackSongCredit');
  let disposed = false, frame = null, lastReflect = -Infinity, version = 0, request = null;
  let collection = [], locals = [], visible = [], selected = null, focusId = '', localSerial = 0;
  let loading = false, ready = false, resumeAfterSelection = false, error = '', tempo = null, tempoChanges = 0, preparedSongId = '';
  const rows = new Map();
  let player;
  const view = mountMidiScoreView({ mount: $('blackMidiViewport'), controls: $('blackMidiControls'),
    getTransport: () => { const state = player?.state; return { position: state?.time ?? 0, playing: state?.playing ?? false, speed: state?.rate ?? 1 }; } });
  // One context and one final effects/volume/peak-control path for the whole page.
  // The file player already supplies an 8× preamp; undo that before Blech's 8× stage.
  player = new MidiphoriaPlayer({ getAudioContext: () => engine.context,
    connectOutput: (context, node) => engine.connectExternalSource(context, node, { gain: 1 / 8 }),
    onState: () => reflect(),
  });
  player.setVolume(Number($('blackFileLevel').value));
  function reflect() {
    if (disposed || !player) return;
    const state = player.state;
    $('blackPlayButton').disabled = !ready || !state.ready || loading || state.loading;
    $('blackPlayButton').setAttribute('aria-pressed', String(state.playing));
    $('blackPlayButton').setAttribute('aria-label', state.playing ? 'Pause Black MIDI' : 'Play Black MIDI');
    $('blackStopButton').disabled = !selected;
    $('blackSongPosition').disabled = !ready || !state.ready || loading;
    $('blackSongPosition').max = String(state.duration || 1);
    if (document.activeElement !== $('blackSongPosition')) $('blackSongPosition').value = String(state.time || 0);
    $('blackSongTime').value = `${timeLabel(state.time)} / ${timeLabel(state.duration)}`;
    $('blackAudioStart').hidden = !selected || state.audioEnabled || state.visualOnly;
    $('blackPlayerStatus').textContent = error || state.error || (loading || state.loading ? 'Loading MIDI…' : '');
    host.dataset.playing = String(state.playing);
  }
  function setTempo() {
    const sync = $('blackSyncTempo').checked, speed = Number($('blackPlaybackRate').value);
    const requested = speed * (sync && tempo ? engine.state.tempo / tempo : 1);
    const rate = player.setPlaybackRate(requested);
    $('blackPlaybackRateOut').value = `${speed.toFixed(2)}×`;
    $('blackTempoStatus').textContent = sync
      ? tempo ? `${Number(tempo.toFixed(2))} BPM source → ${rate.toFixed(2)}× playback${Math.abs(rate - requested) > .001 ? ' · limited to 0.5–8×' : ''}${tempoChanges ? ' · source tempo changes are preserved' : ''}`
        : 'Tempo sync is unavailable for this score. Speed still applies.'
      : '';
  }
  const label = song => `${song.composer ? `${song.composer} · ` : ''}${song.title}`;
  const group = song => song.collection || 'Your MIDIs';
  function renderList() {
    const query = $('blackSongSearch').value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const all = [...locals, ...collection];
    visible = all.filter(song => query.every(word => `${label(song)} ${group(song)}`.toLocaleLowerCase().includes(word)));
    if (!visible.some(song => song.id === focusId)) focusId = visible.find(song => song.id === selected?.id)?.id ?? visible[0]?.id ?? '';
    const list = $('blackSongList'), scroll = list.scrollTop;
    const focused = list.contains(document.activeElement) ? document.activeElement.dataset.songId : null;
    const next = visible.map(song => {
      if (!rows.has(song.id)) {
        const row = document.createElement('li'), button = document.createElement('button');
        button.type = 'button'; button.className = 'midiphoria-song'; button.dataset.songId = song.id;
        const title = document.createElement('span'), meta = document.createElement('span');
        title.className = 'midiphoria-song-title'; meta.className = 'midiphoria-song-meta';
        title.textContent = label(song); meta.textContent = group(song); button.append(title, meta); row.append(button); rows.set(song.id, row);
      }
      const row = rows.get(song.id), button = row.firstElementChild;
      button.setAttribute('aria-pressed', String(song.id === selected?.id)); button.tabIndex = song.id === focusId ? 0 : -1;
      return row;
    });
    if (next.length !== list.children.length || next.some((row, i) => row !== list.children[i])) {
      list.replaceChildren(...next); list.scrollTop = scroll;
      if (focused && visible.some(song => song.id === focused)) rows.get(focused).firstElementChild.focus({ preventScroll: true });
    }
    list.setAttribute('aria-busy', 'false');
    $('blackSongCount').value = query.length ? `${visible.length} / ${all.length}` : `${all.length}`;
    $('blackNextSong').disabled = $('blackRandomSong').disabled = !visible.length;
    $('blackSongSearchStatus').textContent = visible.length ? '' : 'No matching MIDIs.';
    $('blackCurrentSong').hidden = !selected;
    $('blackCurrentSong').textContent = selected ? label(selected) : '';
  }
  function showRow(id) {
    const list = $('blackSongList'), row = rows.get(id);
    if (row?.parentNode !== list) return;
    const bounds = row.getBoundingClientRect(), viewport = list.getBoundingClientRect();
    if (bounds.top < viewport.top) list.scrollTop -= viewport.top - bounds.top;
    else if (bounds.bottom > viewport.bottom) list.scrollTop += bounds.bottom - viewport.bottom;
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
    loading = true; ready = false; error = ''; selected = song; focusId = song.id; tempo = null; tempoChanges = 0; preparedSongId = '';
    player.stop(); view.clear('Loading MIDI score…'); renderList(); showRow(song.id); credit(song); reflect();
    songDescription.textContent = '';
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
      tempo = parsed?.initialTempo ?? null; tempoChanges = parsed?.tempoChanges ?? 0; setTempo();
      let loaded;
      if (audio) { preparedSongId = song.id; loaded = await player.load(audio, song.title, { preserveLeadIn: true }); }
      else {
        if (!parsed) throw new Error('This score cannot be previewed here. Download its complete original.');
        preparedSongId = song.id;
        loaded = await player.loadVisualTimeline(parsed.duration, song.title);
      }
      if (disposed || ticket !== version) return;
      ready = Boolean(loaded);
      songDescription.textContent = paired
        ? 'Full decorative score · sound uses the creator’s AUDIO edition on its original timeline. Editions may differ.'
        : audio ? ''
          : 'Full score · silent visual playback. No separate audio edition is available for this file.';
      if (ready && resumeAfterSelection) player.play();
    } catch (caught) {
      if (!disposed && ticket === version) {
        preparedSongId = '';
        if (caught.name !== 'AbortError') error = caught.message || 'Could not load this MIDI.';
      }
    } finally { if (!disposed && ticket === version) { loading = false; resumeAfterSelection = false; reflect(); } }
  }
  function open() { host.open = true; view.setVisible(!document.hidden); }
  on($('blackSongList'), 'click', event => {
    const button = event.target.closest('[data-song-id]'), song = button && visible.find(item => item.id === button.dataset.songId);
    if (song && (song.id !== selected?.id || !ready && !loading || error)) void select(song);
  });
  on($('blackSongList'), 'focusin', event => {
    const id = event.target.dataset.songId; if (!id) return;
    focusId = id; for (const row of $('blackSongList').children) row.firstElementChild.tabIndex = row.firstElementChild.dataset.songId === id ? 0 : -1;
  });
  on($('blackSongList'), 'keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const buttons = [...$('blackSongList').querySelectorAll('[data-song-id]')], index = buttons.indexOf(event.target);
    if (index < 0) return;
    const page = Math.max(1, Math.floor($('blackSongList').clientHeight / event.target.offsetHeight));
    const next = { ArrowUp: index - 1, ArrowDown: index + 1, Home: 0, End: buttons.length - 1, PageUp: index - page, PageDown: index + page }[event.key];
    if (next === undefined) return; event.preventDefault();
    const target = buttons[Math.max(0, Math.min(buttons.length - 1, next))]; target.focus({ preventScroll: true }); showRow(target.dataset.songId);
  });
  on($('blackSongSearch'), 'input', () => { $('blackSongList').scrollTop = 0; renderList(); });
  on($('blackNextSong'), 'click', () => { if (visible.length) void select(visible[(visible.findIndex(song => song.id === selected?.id) + 1) % visible.length]); });
  on($('blackRandomSong'), 'click', () => {
    const others = visible.filter(song => song.id !== selected?.id), choices = others.length ? others : visible;
    if (choices.length) void select(choices[Math.floor(Math.random() * choices.length)]);
  });
  on($('blackPlayButton'), 'click', () => { if (player.state.playing) player.pause(); else if (ready && !loading) player.play(); reflect(); });
  function stop() { resumeAfterSelection = false; player.stop(); reflect(); }
  on($('blackStopButton'), 'click', stop);
  on($('blackLoopSong'), 'change', () => player.setLoop($('blackLoopSong').checked));
  on($('blackPlaybackRate'), 'input', setTempo); on($('blackSyncTempo'), 'change', setTempo);
  on($('blackFileLevel'), 'input', () => { player.setVolume(Number($('blackFileLevel').value)); $('blackFileLevelOut').value = `${Math.round(Number($('blackFileLevel').value) * 100)}%`; });
  on($('blackSongPosition'), 'input', () => { $('blackSongTime').value = `${timeLabel(Number($('blackSongPosition').value))} / ${timeLabel(player.state.duration)}`; });
  on($('blackSongPosition'), 'change', () => { player.seek(Number($('blackSongPosition').value)); reflect(); });
  on($('blackAudioStart'), 'click', () => onAudioRequest?.());
  on($('blackMidiFile'), 'change', () => {
    const files = [...$('blackMidiFile').files]; $('blackMidiFile').value = '';
    if (!files.length) return;
    const total = locals.reduce((sum, item) => sum + (item.localFile?.size ?? item.buffer?.byteLength ?? 0), 0) + files.reduce((sum, file) => sum + file.size, 0);
    if (locals.length + files.length > 20 || total > MAX_LOCAL_BYTES || files.some(file => file.size > MAX_LOCAL_BYTES)) {
      error = 'Keep up to 20 local MIDIs and 200 MB total. Large scores may be visual-only.'; reflect(); return;
    }
    const added = files.map(file => ({ id: `file-${++localSerial}`, title: file.name, localFile: file }));
    locals.push(...added); $('blackSongSearch').value = ''; void select(added[0]);
  });
  on($('blackFullscreen'), 'click', async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await host.querySelector('.blech-file-viewport').requestFullscreen(); }
    catch { error = 'Fullscreen is unavailable in this browser.'; reflect(); }
  });
  const showHash = () => { if (['#blackMidiPlayer', '#black-midi'].includes(location.hash)) open(); };
  on(globalThis, 'hashchange', showHash);
  for (const link of document.querySelectorAll('a[href="#blackMidiPlayer"]')) on(link, 'click', open);
  on(host, 'toggle', () => view.setVisible(host.open && !document.hidden));
  function tick(now) {
    frame = null; if (disposed || document.hidden) return;
    if (now - lastReflect > 100) { lastReflect = now; reflect(); }
    frame = requestAnimationFrame(tick);
  }
  on(document, 'visibilitychange', () => {
    view.setVisible(host.open && !document.hidden);
    if (document.hidden) { if (frame !== null) cancelAnimationFrame(frame); frame = null; }
    else if (frame === null) frame = requestAnimationFrame(tick);
  });
  showHash(); view.setVisible(host.open && !document.hidden); reflect();
  if (!document.hidden) frame = requestAnimationFrame(tick);
  return {
    stop, reflect, setTempo,
    setCollection(songs) { collection = songs; renderList(); },
    async enableAudio() {
      const enabled = await player.enableAudio();
      // A processor/load failure may have returned false to select(). Successful
      // Audio recovery makes that exact prepared selection playable again, but
      // must never revive an older file after a newer download failed.
      if (!disposed && !loading && enabled && player.state.ready && preparedSongId === selected?.id) { ready = true; error = ''; }
      reflect(); return enabled;
    },
    setAudioEnabled: enabled => player.setAudioEnabled(enabled),
    setNoteEffects: value => player.setNoteEffects(value),
    loadSoundFont: (bytes, name) => player.loadSoundFont(bytes, name),
    async previewScore(score, title = 'Your MIDI artwork') {
      if (!(score?.buffer instanceof ArrayBuffer)) throw new Error('Prepare a drawing or artwork first.');
      const old = locals.findIndex(song => song.id === 'prepared-art'); if (old >= 0) locals.splice(old, 1);
      rows.delete('prepared-art');
      const song = { id: 'prepared-art', title, buffer: score.buffer.slice(0), collection: 'Your artwork', attribution: 'Prepared in Blech MIDI.' };
      locals.unshift(song); $('blackSongSearch').value = ''; open(); await select(song); host.scrollIntoView({ block: 'start', behavior: 'smooth' });
    },
    dispose() { if (disposed) return; disposed = true; version++; request?.abort(); events.abort(); if (frame !== null) cancelAnimationFrame(frame); view.dispose(); void player.dispose(); host.replaceChildren(); },
  };
}
