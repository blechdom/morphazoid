import { getSharedMidiManager } from '../../midi-manager.js';
import { MidiphoriaModel, DEFAULT_VISUALS } from './midiphoria-model.js';
import { MidiphoriaRenderer } from './midiphoria-renderer.js';
import { MidiphoriaPlayer } from './midiphoria-player.js';
import { registerHeaderPresets } from '../../site/header-presets.js';
import { MIDIPHORIA_PRESETS, DEFAULT_RENDER_OPTIONS, captureMidiphoriaPreset,
  applyMidiphoriaPreset, randomizeMidiphoriaPreset } from './midiphoria-presets.js';

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const KEY_LABELS = ['Z', 'S', 'X', 'D', 'C', 'V', 'G', 'B', 'H', 'N', 'J', 'M', 'Q', '2', 'W', '3', 'E', 'R', '5', 'T', '6', 'Y', '7', 'U'];
const nameFor = note => `${NOTE_NAMES[note % 12]}${Math.floor(note / 12) - 1}`;
const clock = () => performance.now() / 1000;
const $ = id => document.getElementById(id);
const RENDER_CONTROLS = Object.freeze({ viewMode: 'view', trailSeconds: 'trailSeconds',
  palette: 'palette', paletteHue: 'hueOffset', saturation: 'saturation', glow: 'glow',
  trailWidth: 'width', motion: 'motion', colorSource: 'colorSource',
  fadeCurve: 'fadeCurve', spin: 'spin', symmetry: 'symmetry' });

function mountMidiphoria() {
  const events = new AbortController();
  const on = (node, type, listener, options = {}) => node.addEventListener(type, listener, { ...options, signal: events.signal });
  const model = new MidiphoriaModel();
  const renderer = new MidiphoriaRenderer($('visualCanvas'));
  renderer.view = $('viewMode').value;
  const manager = getSharedMidiManager(globalThis);
  let settings = { ...DEFAULT_VISUALS };
  let presetController;
  let learning = false, demoTimer = null, demoNote = null, demoIndex = 0;
  let disposed = false, frame = null, lastReadout = -Infinity, hasPlayed = false;
  let lastFileCapture = -Infinity;
  const padHeld = new Map();
  const padTimers = new Map();
  const pads = [];
  let player, audioStarting = false, loadingFile = false, selectionReady = false, fileError = '';
  let currentSongId = '';
  let collection = [], localSongs = [], localSerial = 0, selectionVersion = 0, songRequest = null;
  const timeLabel = seconds => `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.floor(Math.max(0, seconds) % 60)).padStart(2, '0')}`;

  function reflectPlayer() {
    if (!player || disposed) return;
    const state = player.state;
    $('audioButton').setAttribute('aria-pressed', String(state.audioEnabled));
    $('audioButton').disabled = audioStarting;
    $('audioState').textContent = audioStarting ? 'loading' : state.audioEnabled ? 'on' : 'off';
    $('playButton').disabled = !state.ready || !selectionReady || loadingFile || state.loading;
    $('playButton').setAttribute('aria-pressed', String(state.playing));
    $('playButton').textContent = state.playing ? 'Ⅱ Pause' : '▶ Play';
    $('stopButton').disabled = !state.ready;
    $('songPosition').disabled = !state.ready || !selectionReady;
    $('songPosition').max = String(state.duration || 1);
    if (document.activeElement !== $('songPosition')) $('songPosition').value = String(state.time || 0);
    $('songTime').value = `${timeLabel(state.time || 0)} / ${timeLabel(state.duration || 0)}`;
    const status = fileError || state.error || (audioStarting ? 'Loading SoundFont…'
      : loadingFile || state.loading ? 'Loading MIDI…'
      : !state.ready ? state.audioEnabled ? 'Piano pads ready · open a MIDI to play along.' : 'Enable Audio to hear the piano pads and MIDI player.'
      : state.playing ? state.audioEnabled ? 'Playing · change the light controls as you listen.' : 'Playing · audio muted, graphics continue.'
      : state.audioEnabled ? 'Ready · play the piano pads or press Play for the song.' : 'Audio muted · enable Audio to hear the pads and player.');
    if ($('playerStatus').textContent !== status) $('playerStatus').textContent = status;
  }

  function showSongCredit(song) {
    $('songCredit').replaceChildren();
    $('songDescription').textContent = !song ? 'Your MIDI · stored only for this session.'
      : song.kind === 'pattern' ? 'Short geometric pattern · enable Loop to repeat.'
      : song.collection === 'Black MIDI' ? 'Complete creator AUDIO edition. Full decorative scores are in the archive below.'
      : song.collection?.startsWith('Orchestral') ? 'Full orchestral arrangement.' : '';
    if (!song) { $('songCredit').textContent = 'Local MIDI file · stays in this browser.'; return; }
    $('songCredit').append(document.createTextNode(`${song.attribution} `));
    if (!song.sourceUrl) return;
    const link = document.createElement('a');
    link.href = song.sourceUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Source ↗';
    $('songCredit').append(link);
    if (song.file) {
      const download = document.createElement('a');
      download.href = new URL(`../../../assets/midiphoria/${song.file}`, import.meta.url).href;
      download.download = song.file.split('/').pop(); download.textContent = 'Download MIDI';
      $('songCredit').append(document.createTextNode(' · '), download);
    }
    if (song.licenseUrl && song.licenseName) {
      const license = document.createElement('a');
      license.href = song.licenseUrl; license.target = '_blank'; license.rel = 'noopener noreferrer'; license.textContent = song.licenseName;
      $('songCredit').append(document.createTextNode(' · '), license);
    }
  }

  function renderSongMenu(preferredId) {
    const selected = preferredId ?? currentSongId;
    const query = $('songSearch').value.trim().toLocaleLowerCase();
    const all = [...localSongs, ...collection];
    const groupFor = song => song.localFile ? 'Your MIDIs' : song.collection || 'Popular arrangements';
    const selectedCollection = $('collectionSelect').value;
    const groups = [...new Set(all.map(groupFor))];
    $('collectionSelect').replaceChildren(new Option('All collections', ''), ...groups.map(group => new Option(group, group)));
    $('collectionSelect').value = groups.includes(selectedCollection) ? selectedCollection : '';
    const songs = all.filter(song => (!$('collectionSelect').value || groupFor(song) === $('collectionSelect').value)
      && `${song.title} ${song.composer || ''} ${groupFor(song)}`.toLocaleLowerCase().includes(query));
    const menuGroups = new Map();
    for (const song of songs) {
      const label = groupFor(song);
      if (!menuGroups.has(label)) {
        const group = document.createElement('optgroup'); group.label = label; menuGroups.set(label, group);
      }
      menuGroups.get(label).append(new Option(`${song.composer ? `${song.composer} · ` : ''}${song.title}${song.kind === 'pattern' ? ' · pattern' : ''}`, song.id));
    }
    $('songSelect').replaceChildren(...menuGroups.values());
    // Filtering never changes the current file or starts playback.
    if (songs.some(song => song.id === selected)) $('songSelect').value = selected;
    else if (selectionVersion) $('songSelect').selectedIndex = -1;
    $('songCount').value = query || $('collectionSelect').value ? `${songs.length} / ${all.length}` : `${all.length} MIDIs`;
    $('songSelect').disabled = !songs.length;
    $('songSearchStatus').textContent = songs.length ? '' : 'No matching songs. Try another title or artist.';
    return songs.find(song => song.id === $('songSelect').value);
  }

  async function selectSong(song) {
    currentSongId = song.id;
    const file = song.localFile;
    const version = ++selectionVersion;
    songRequest?.abort(); songRequest = new AbortController();
    loadingFile = true; selectionReady = false; fileError = ''; player.stop();
    showSongCredit(file ? null : song); reflectPlayer();
    try {
      if (file && file.size > 10 * 1024 * 1024) throw new Error('Choose a MIDI file smaller than 10 MB.');
      let binary;
      if (file) binary = await file.arrayBuffer();
      else {
        const response = await fetch(new URL(`../../../assets/midiphoria/${song.file}`, import.meta.url), { signal: songRequest.signal });
        if (!response.ok) throw new Error('Could not load this song. Choose another or open a local MIDI file.');
        binary = await response.arrayBuffer();
      }
      if (disposed || version !== selectionVersion) return;
      const loaded = await player.load(binary, file?.name || song.title);
      if (disposed || version !== selectionVersion) return;
      selectionReady = Boolean(loaded);
    } catch (error) {
      if (disposed || version !== selectionVersion || error.name === 'AbortError') return;
      fileError = error.message || 'Could not read this MIDI file.';
    } finally {
      if (!disposed && version === selectionVersion) { loadingFile = false; reflectPlayer(); }
    }
  }

  player = new MidiphoriaPlayer({
    onMidi: message => accept(message), onState: reflectPlayer,
    onClear: sourceId => { model.releaseSource(sourceId, clock()); },
  });
  player.setVolume(Number($('outputLevel').value));
  player.setPlaybackRate(Number($('playbackRate').value));
  player.setLoop($('loopSong').checked);
  on($('audioButton'), 'click', async () => {
    if (selectionReady) fileError = '';
    if (player.state.audioEnabled) { player.setAudioEnabled(false); reflectPlayer(); return; }
    audioStarting = true;
    try { const pending = player.enableAudio(); reflectPlayer(); await pending; }
    catch (error) { if (!disposed) fileError = error.message || 'Audio could not start. Try Audio again.'; }
    finally { audioStarting = false; reflectPlayer(); }
  });
  on($('outputLevel'), 'input', () => {
    player.setVolume(Number($('outputLevel').value));
    $('outputLevelOut').value = `${Math.round(Number($('outputLevel').value) * 100)}%`;
  });
  on($('songSelect'), 'change', () => {
    const song = [...localSongs, ...collection].find(item => item.id === $('songSelect').value);
    if (song) void selectSong(song);
  });
  on($('songSearch'), 'input', () => renderSongMenu());
  on($('collectionSelect'), 'change', () => renderSongMenu());
  on($('midiFile'), 'change', () => {
    const files = [...$('midiFile').files];
    $('midiFile').value = '';
    if (!files.length) return;
    const bytes = [...localSongs.map(song => song.localFile), ...files].reduce((sum, file) => sum + file.size, 0);
    if (files.some(file => file.size > 10 * 1024 * 1024) || bytes > 50 * 1024 * 1024 || localSongs.length + files.length > 20) {
      fileError = 'Open up to 20 MIDIs per session, 10 MB each and 50 MB in total.'; reflectPlayer(); return;
    }
    const added = files.map(file => ({ id: `local-${++localSerial}`, title: file.name, localFile: file }));
    localSongs.push(...added); $('songSearch').value = ''; $('collectionSelect').value = ''; renderSongMenu(added[0].id);
    void selectSong(added[0]);
  });
  on($('playButton'), 'click', () => {
    if (!selectionReady || loadingFile) return;
    if (player.state.playing) player.pause();
    else { stopDemo(); player.play(); }
    reflectPlayer();
  });
  on($('stopButton'), 'click', () => { player.stop(); reflectPlayer(); });
  on($('songPosition'), 'input', () => { $('songTime').value = `${timeLabel(Number($('songPosition').value))} / ${timeLabel(player.state.duration)}`; });
  on($('songPosition'), 'change', () => { player.seek(Number($('songPosition').value)); reflectPlayer(); });
  on($('playbackRate'), 'input', () => {
    player.setPlaybackRate(Number($('playbackRate').value));
    $('playbackRateOut').value = `${Number($('playbackRate').value).toFixed(2)}×`;
  });
  on($('loopSong'), 'change', () => { player.setLoop($('loopSong').checked); });

  const reflectControls = () => {
    for (const [key, value] of Object.entries(settings)) {
      const control = $(key);
      if (!control) continue;
      if (control.type === 'checkbox') control.checked = value;
      else control.value = String(value);
      const output = $(`${key}Out`);
      if (output) output.value = key === 'sustain' ? `${Math.round(value * 100)}%`
        : key === 'hueSpeed' ? settings.hueMode === 'activity'
          ? `≤ ${(Number(value) * .1).toFixed(3)} turns/note` : `${Number(value).toFixed(2)} turns/s`
          : `${Number(value).toFixed(2)} s`;
    }
    $('mappingControls').hidden = settings.trigger !== 'mapped';
    $('hueSpeed').disabled = settings.hueMode === 'static';
    $('visualViewport').dataset.invert = String(settings.invert);
    for (const [id, key] of Object.entries(RENDER_CONTROLS)) {
      const value = renderer.options[key];
      $(id).value = String(value);
      const output = $(`${id}Out`);
      if (output) output.value = id === 'trailSeconds' ? `${Number(value).toFixed(1)} s`
        : id === 'paletteHue' ? `${Math.round(value)}°`
        : id === 'spin' ? `${Number(value).toFixed(2)} rpm`
        : id === 'symmetry' ? `${value}×`
        : ['glow', 'saturation'].includes(id) ? `${Math.round(value * 100)}%`
        : `${Number(value).toFixed(2)}×`;
    }
    for (const id of ['spin', 'symmetry']) $(id).disabled = !['radial', 'orbit'].includes(renderer.options.view);
    presetController?.refresh();
  };

  function accept(message) {
    const now = clock();
    if (learning && !message.sourceId?.startsWith('midiphoria:file') && !message.synthetic && ((message.type === 'noteOn' && message.velocity > 0) || message.type === 'controlChange')) {
      learning = false;
      settings = { ...settings, trigger: 'mapped', channel: -1,
        mappedType: message.type === 'noteOn' ? 'note' : 'cc',
        mappedNumber: message.note ?? message.controller, mappedChannel: message.channel };
      model.configure(settings, now);
      renderer.clear();
      $('learnButton').setAttribute('aria-pressed', 'false');
      $('learnButton').textContent = 'Learn next note / CC';
      $('learnStatus').textContent = `Mapped ${settings.mappedType === 'note' ? nameFor(settings.mappedNumber) : `CC ${settings.mappedNumber}`} · channel ${settings.mappedChannel + 1}`;
      reflectControls();
    }
    model.handleMessage(message, now);
    // Dense files can emit thousands of notes per second. Keep every note/off in
    // the bounded model, but avoid rebuilding the complete trail history for
    // every event. The animation frame also captures the latest model state.
    if (message.sourceId?.startsWith('midiphoria:file')) {
      if (now - lastFileCapture < 1 / 120) return;
      lastFileCapture = now;
    }
    const sample = model.sample(now);
    renderer.capture(sample, now);
    if (sample.activeNotes.length || sample.level > 0) hasPlayed = true;
  }

  function releasePads() {
    player?.releasePads();
    for (const timer of padTimers.values()) clearTimeout(timer);
    padTimers.clear();
    for (const sourceId of padHeld.keys()) model.releaseSource(sourceId, clock());
    padHeld.clear();
    for (const pad of pads) pad.setAttribute('aria-pressed', 'false');
  }

  function stopDemo() {
    if (demoTimer !== null) clearInterval(demoTimer);
    demoTimer = null;
    demoNote = null;
    model.releaseSource('midiphoria:demo', clock());
    $('demoButton').textContent = '▶ Demo';
    $('demoButton').setAttribute('aria-pressed', 'false');
  }

  function clear() {
    stopDemo(); releasePads();
    model.panic(clock()); renderer.clear();
    hasPlayed = false;
    lastFileCapture = -Infinity;
  }

  $('channel').replaceChildren(new Option('All channels', '-1'));
  $('mappedChannel').replaceChildren();
  for (let channel = 0; channel < 16; channel++) {
    for (const id of ['channel', 'mappedChannel']) {
      const option = document.createElement('option');
      option.value = channel; option.textContent = `Channel ${channel + 1}`;
      $(id).append(option);
    }
  }

  const padContainer = $('notePads');
  padContainer.replaceChildren();
  KEY_LABELS.forEach((label, index) => {
    const note = 48 + index;
    const pad = document.createElement('button');
    pad.type = 'button'; pad.className = 'midiphoria-pad';
    pad.dataset.note = String(note);
    pad.style.setProperty('--note-hue', note / 128 * 360);
    pad.setAttribute('aria-label', `${nameFor(note)}, computer key ${label}`);
    pad.setAttribute('aria-pressed', 'false');
    const key = document.createElement('kbd'); key.textContent = label;
    const caption = document.createElement('small'); caption.textContent = nameFor(note);
    pad.append(key, caption); padContainer.append(pad); pads.push(pad);
    const start = sourceId => {
      if (padHeld.has(sourceId)) return;
      const channel = settings.trigger === 'mapped' ? settings.mappedChannel : Math.max(0, settings.channel);
      padHeld.set(sourceId, { note, channel });
      const velocity = Number($('padVelocity').value);
      player.padNoteOn(sourceId, note, velocity);
      accept({ type: 'noteOn', note, velocity, channel, sourceId });
    };
    const end = sourceId => {
      const held = padHeld.get(sourceId);
      if (!held) return;
      padHeld.delete(sourceId);
      player.padNoteOff(sourceId);
      accept({ type: 'noteOff', ...held, velocity: 0, sourceId });
    };
    on(pad, 'pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault(); pad.focus({ preventScroll: true });
      pad.setPointerCapture(event.pointerId);
      start(`midiphoria:pad:${event.pointerId}`);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) on(pad, type, event => end(`midiphoria:pad:${event.pointerId}`));
    on(pad, 'keydown', event => {
      if (!['Space', 'Enter'].includes(event.code)) return;
      event.preventDefault();
      if (!event.repeat) start(`midiphoria:button:${note}`);
    });
    on(pad, 'keyup', event => {
      if (!['Space', 'Enter'].includes(event.code)) return;
      event.preventDefault(); end(`midiphoria:button:${note}`);
    });
    on(pad, 'blur', () => end(`midiphoria:button:${note}`));
    // Assistive-technology activation has no preceding physical pointer/key event.
    on(pad, 'click', event => {
      if (event.detail !== 0 || padHeld.size) return;
      const sourceId = `midiphoria:assistive:${note}`;
      start(sourceId);
      clearTimeout(padTimers.get(sourceId));
      padTimers.set(sourceId, setTimeout(() => { padTimers.delete(sourceId); end(sourceId); }, 180));
    });
  });

  for (const key of Object.keys(DEFAULT_VISUALS)) {
    const control = $(key);
    if (!control) continue;
    on(control, control.tagName === 'SELECT' || control.type === 'checkbox' ? 'change' : 'input', () => {
      let value = control.type === 'checkbox' ? control.checked : control.value;
      if (typeof DEFAULT_VISUALS[key] === 'number') {
        value = Number(value);
        if (!Number.isFinite(value)) value = DEFAULT_VISUALS[key];
        if (control.type === 'number' || control.type === 'range') value = Math.max(Number(control.min), Math.min(Number(control.max), value));
        if (key === 'mappedNumber') value = Math.round(value);
      }
      settings[key] = value;
      model.configure({ [key]: value }, clock());
      if (['trigger', 'channel', 'mappedType', 'mappedNumber', 'mappedChannel'].includes(key)) renderer.clear();
      reflectControls();
    });
  }
  for (const [id, key] of Object.entries(RENDER_CONTROLS)) {
    const control = $(id);
    on(control, control.tagName === 'SELECT' ? 'change' : 'input', () => {
      renderer.configure({ [key]: control.tagName === 'SELECT' ? control.value : Number(control.value) });
      reflectControls();
    });
  }
  on($('padVelocity'), 'input', () => { $('padVelocityOut').value = $('padVelocity').value; });
  on($('clearButton'), 'click', clear);
  on($('resetButton'), 'click', () => {
    player.stop(); player.setPlaybackRate(1); player.setLoop(false);
    $('playbackRate').value = '1'; $('playbackRateOut').value = '1.00×'; $('loopSong').checked = false;
    clear(); learning = false; settings = { ...DEFAULT_VISUALS };
    model.configure(settings, clock());
    renderer.configure(DEFAULT_RENDER_OPTIONS);
    $('padVelocity').value = '100'; $('padVelocityOut').value = '100';
    $('learnButton').setAttribute('aria-pressed', 'false');
    $('learnButton').textContent = 'Learn next note / CC';
    $('learnStatus').textContent = 'All connected MIDI inputs are received.';
    reflectControls();
  });
  on($('learnButton'), 'click', () => {
    learning = !learning;
    $('learnButton').setAttribute('aria-pressed', String(learning));
    $('learnButton').textContent = learning ? 'Cancel learn' : 'Learn next note / CC';
    $('learnStatus').textContent = learning ? 'Play a note or move a controller. MIDI must be enabled for hardware.' : 'All connected MIDI inputs are received.';
  });
  on($('demoButton'), 'click', () => {
    if (demoTimer !== null) { stopDemo(); return; }
    demoIndex = 0;
    const tick = () => {
      const channel = settings.trigger === 'mapped' ? settings.mappedChannel : Math.max(0, settings.channel);
      if (demoNote) accept({ type: 'noteOff', ...demoNote, velocity: 0, sourceId: 'midiphoria:demo' });
      demoNote = null;
      if (settings.trigger === 'mapped' && settings.mappedType === 'cc') {
        accept({ type: 'controlChange', channel, controller: settings.mappedNumber,
          value: demoIndex % 2 ? 0 : 104, sourceId: 'midiphoria:demo' });
      } else if (demoIndex % 2 === 0) {
        const note = settings.trigger === 'mapped' ? settings.mappedNumber : [48, 57, 65, 70, 52, 61, 68, 73][(demoIndex / 2) % 8];
        demoNote = { note, channel };
        accept({ type: 'noteOn', ...demoNote, velocity: 65 + (demoIndex * 17) % 62, sourceId: 'midiphoria:demo' });
      }
      demoIndex++;
    };
    tick(); demoTimer = setInterval(tick, 320);
    $('demoButton').textContent = '■ Stop demo'; $('demoButton').setAttribute('aria-pressed', 'true');
  });
  on($('midiSettingsButton'), 'click', () => {
    const details = document.querySelector('.header-settings-menu');
    if (details) { details.open = true; $('sharedMidiToggle')?.focus(); }
  });
  on($('fullscreenButton'), 'click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await $('visualViewport').requestFullscreen();
    } catch { $('learnStatus').textContent = 'Fullscreen is unavailable in this browser.'; }
  });
  on(document, 'fullscreenchange', () => {
    const fullscreen = Boolean(document.fullscreenElement);
    $('fullscreenButton').setAttribute('aria-label', fullscreen ? 'Exit visualization fullscreen' : 'Enter visualization fullscreen');
    $('fullscreenButton').querySelector('span').textContent = fullscreen ? 'Exit' : 'Fullscreen';
    renderer.resize();
  });

  const unregister = manager.registerClient({
    id: 'midiphoria', computerKeyboard: { layout: 'piano', baseNote: 48, velocity: 100 },
    onMessage: message => accept(message.virtual ? {
      ...message, channel: settings.trigger === 'mapped' ? settings.mappedChannel : Math.max(0, settings.channel),
    } : message),
    onEnabledChange: enabled => { if (!enabled) { model.panic(clock()); renderer.clear(); } },
  });
  const unsubscribe = manager.subscribeStatus(status => {
    $('inputStatus').textContent = !status.enabled ? 'MIDI is off · pads ready'
      : status.hardwareError ? 'Computer keys on · hardware unavailable'
      : `MIDI on · ${status.inputCount} ${status.inputCount === 1 ? 'input' : 'inputs'} · computer keys ready`;
    const base = 48 + status.computerKeyboard.octave * 12;
    pads.forEach((pad, index) => {
      const note = Math.max(0, Math.min(127, base + index));
      // The fixed pad pitch is explicit; keyboard transposition belongs to the MIDI manager.
      pad.title = `Pad ${nameFor(48 + index)} · key ${KEY_LABELS[index]} plays ${nameFor(note)}`;
    });
  });

  function draw() {
    frame = null;
    if (disposed || document.hidden) return;
    const now = clock(), sample = model.sample(now);
    if (sample.activeNotes.length || sample.level > 0) hasPlayed = true;
    renderer.draw(sample, now, settings);
    if (now - lastReadout > .08) {
      lastReadout = now;
      reflectPlayer();
      const notes = [...new Set(sample.activeNotes.map(item => nameFor(item.note)))];
      $('noteReadout').value = notes.length ? `${notes.slice(0, 8).join(' · ')}${notes.length > 8 ? ' …' : ''} · ${sample.activeNotes.length} held`
        : sample.level > .001 ? `${sample.phase === 'release' ? 'Releasing' : 'Controller'} · ${sample.phase}` : 'Waiting for a note';
      $('levelReadout').value = `${Math.round(sample.level * 100)}% light`;
      $('emptyHint').hidden = hasPlayed || sample.level > 0;
      const active = new Set(sample.activeNotes.map(item => item.note));
      for (const pad of pads) pad.setAttribute('aria-pressed', String(active.has(Number(pad.dataset.note))));
    }
    frame = requestAnimationFrame(draw);
  }
  const resize = new ResizeObserver(() => renderer.resize());
  resize.observe($('visualViewport'));
  on(globalThis, 'blur', releasePads);
  on(document, 'visibilitychange', () => {
    if (document.hidden) { clear(); if (frame !== null) cancelAnimationFrame(frame); frame = null; }
    else if (frame === null) draw();
  });
  on(globalThis, 'pagehide', () => {
    if (disposed) return;
    disposed = true; clear(); songRequest?.abort(); void player.dispose();
    if (frame !== null) cancelAnimationFrame(frame);
    resize.disconnect(); presetController?.destroy(); unsubscribe(); manager.disable(); unregister(); events.abort();
  });
  presetController = registerHeaderPresets({ id: 'midiphoria', presets: MIDIPHORIA_PRESETS,
    capture: () => captureMidiphoriaPreset(settings, renderer.options),
    apply: snapshot => {
      applyMidiphoriaPreset(model, renderer, snapshot, clock());
      settings = { ...model.options }; reflectControls();
    },
    randomize: randomizeMidiphoriaPreset,
  });
  reflectControls(); draw();
  void fetch(new URL('../../../assets/midiphoria/collection.json', import.meta.url), { signal: events.signal })
    .then(response => { if (!response.ok) throw new Error('Collection unavailable. You can still open a local MIDI file.'); return response.json(); })
    .then(songs => {
      if (disposed) return;
      collection = songs;
      const selected = $('songSelect').value;
      const song = renderSongMenu(selected);
      if (!selectionVersion && song) return selectSong(song);
    })
    .catch(error => { if (!disposed && error.name !== 'AbortError') { fileError = error.message; reflectPlayer(); } });
}

mountMidiphoria();
globalThis.addEventListener('pageshow', event => { if (event.persisted) mountMidiphoria(); });
