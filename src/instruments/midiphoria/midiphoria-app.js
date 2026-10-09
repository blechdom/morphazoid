import { getSharedMidiManager } from '../../midi-manager.js';
import { MidiphoriaModel, DEFAULT_VISUALS } from './midiphoria-model.js';
import { MidiphoriaRenderer } from './midiphoria-renderer.js';
import { MidiphoriaPlayer } from './midiphoria-player.js';
import { generateTextMidi } from './midiphoria-text-midi.js';
import { drawTextMidiScore } from './midiphoria-text-score.js';
import { mountMidiphoriaEnvelope } from './midiphoria-envelope.js';
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
  trailWidth: 'width', motion: 'motion', colorSource: 'colorSource', voiceLayout: 'voiceLayout',
  fadeCurve: 'fadeCurve', spin: 'spin', symmetry: 'symmetry', reflection: 'reflection', flow: 'flow' });

function mountMidiphoria() {
  $('downloadTextMidi').hidden = true;
  $('downloadTextMidi').removeAttribute('href');
  $('downloadTextMidi').removeAttribute('download');
  $('textMidiStatus').textContent = '';
  const events = new AbortController();
  const on = (node, type, listener, options = {}) => node.addEventListener(type, listener, { ...options, signal: events.signal });
  const model = new MidiphoriaModel();
  const renderer = new MidiphoriaRenderer($('visualCanvas'));
  model.onNoteEvent = event => renderer.captureEvent(event);
  renderer.view = $('viewMode').value;
  const manager = getSharedMidiManager(globalThis);
  let settings = { ...DEFAULT_VISUALS };
  const envelopeEditor = mountMidiphoriaEnvelope($('lightEnvelope'), { readValue: input => settings[input.id] });
  let presetController;
  let learning = false;
  let disposed = false, frame = null, lastReadout = -Infinity;
  const padHeld = new Map();
  const padTimers = new Map();
  const pads = [];
  let player, audioStarting = false, loadingFile = false, selectionReady = false, fileError = '';
  let currentSongId = '';
  let collection = [], localSongs = [], visibleSongs = [], localSerial = 0, selectionVersion = 0, songRequest = null;
  let resumeAfterSelection = false, pendingPresetSong = false;
  let textScore = null, textDownloadUrl = null;
  let voiceSignature = '';
  const voiceButtons = new Map();
  const timeLabel = seconds => `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.floor(Math.max(0, seconds) % 60)).padStart(2, '0')}`;

  function reflectVoices() {
    const voices = renderer.getVoices();
    const signature = JSON.stringify(voices.map(({ id, label }) => [id, label]));
    const legend = $('voiceLegend'), menu = $('voiceFocus');
    if (signature !== voiceSignature) {
      // Keep existing nodes as activity changes so focus and native menus remain usable.
      const focusedId = legend.contains(document.activeElement) ? document.activeElement.dataset.voiceId : null;
      voiceSignature = signature;
      voiceButtons.clear();
      const buttons = [], options = [new Option('All voices', '')];
      for (const voice of voices) {
        const button = document.createElement('button');
        button.type = 'button'; button.dataset.voiceId = voice.id;
        button.setAttribute('aria-pressed', 'false');
        const label = document.createElement('span'); label.textContent = voice.label;
        button.append(label); buttons.push(button); voiceButtons.set(voice.id, button);
        options.push(new Option(voice.label, voice.id));
      }
      legend.replaceChildren(...buttons); menu.replaceChildren(...options);
      if (focusedId && voiceButtons.has(focusedId)) voiceButtons.get(focusedId).focus({ preventScroll: true });
    }
    const focus = renderer.voiceFocus ?? '';
    if (menu.value !== focus) menu.value = focus;
    for (const voice of voices) {
      const button = voiceButtons.get(voice.id);
      const pressed = String(voice.id === focus), active = String(voice.active);
      if (button.getAttribute('aria-pressed') !== pressed) button.setAttribute('aria-pressed', pressed);
      if (button.dataset.active !== active) button.dataset.active = active;
      if (button.style.getPropertyValue('--voice-color') !== voice.color) button.style.setProperty('--voice-color', voice.color);
    }
    $('voiceControls').hidden = !voices.length || Boolean(textScore && $('showTextScore').checked);
  }
  on($('voiceFocus'), 'change', () => { renderer.focusVoice($('voiceFocus').value || null); reflectVoices(); });
  on($('voiceLegend'), 'click', event => {
    const button = event.target.closest('button[data-voice-id]');
    if (!button || !voiceButtons.has(button.dataset.voiceId)) return;
    renderer.focusVoice(renderer.voiceFocus === button.dataset.voiceId ? null : button.dataset.voiceId);
    reflectVoices();
  });

  function reflectPlayer() {
    if (!player || disposed) return;
    const state = player.state;
    $('audioButton').setAttribute('aria-pressed', String(state.audioEnabled));
    $('audioButton').disabled = audioStarting;
    $('audioState').textContent = audioStarting ? 'loading' : state.audioEnabled ? 'on' : 'off';
    $('playButton').disabled = !state.ready || !selectionReady || loadingFile || state.loading;
    $('playButton').setAttribute('aria-pressed', String(state.playing));
    const playLabel = state.playing ? 'Pause MIDI' : 'Play MIDI';
    $('playButton').setAttribute('aria-label', playLabel); $('playButton').title = playLabel;
    $('stopButton').disabled = !state.ready && !loadingFile;
    $('songPosition').disabled = !state.ready || !selectionReady;
    $('songPosition').max = String(state.duration || 1);
    if (document.activeElement !== $('songPosition')) $('songPosition').value = String(state.time || 0);
    $('songTime').value = `${timeLabel(state.time || 0)} / ${timeLabel(state.duration || 0)}`;
    const status = fileError || state.error || (audioStarting ? 'Loading SoundFont…'
      : loadingFile || state.loading ? 'Loading MIDI…'
      : '');
    if ($('playerStatus').textContent !== status) $('playerStatus').textContent = status;
    $('textScoreView').hidden = !textScore;
    const scoreVisible = Boolean(textScore && $('showTextScore').checked);
    $('visualCanvas').dataset.display = scoreVisible ? 'letters' : 'lights';
    $('visualCanvas').setAttribute('aria-label', scoreVisible
      ? `MIDI letter score: ${textScore.text}. Notes highlight during playback.` : 'Live MIDI color field and note trails');
  }

  function showSongCredit(song) {
    $('songCredit').replaceChildren();
    $('songDescription').textContent = song?.description && song.buffer ? song.description : !song ? 'Your MIDI · stored only for this session.'
      : song.kind === 'pattern' ? 'Short geometric pattern · enable Loop to repeat.'
      : song.collection === 'Black MIDI' ? 'Complete creator AUDIO edition. Full decorative scores are in About & setup.'
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
    const groupFor = song => song.collection || (song.localFile || song.buffer ? 'Your MIDIs' : 'Popular arrangements');
    const selectedCollection = $('collectionSelect').value;
    const groups = [...new Set(all.map(groupFor))];
    $('collectionSelect').replaceChildren(new Option('All collections', ''), ...groups.map(group => new Option(group, group)));
    $('collectionSelect').value = groups.includes(selectedCollection) ? selectedCollection : '';
    const songs = visibleSongs = all.filter(song => (!$('collectionSelect').value || groupFor(song) === $('collectionSelect').value)
      && `${song.title} ${song.composer || ''} ${groupFor(song)}`.toLocaleLowerCase().includes(query));
    const menuGroups = new Map();
    for (const song of songs) {
      const label = groupFor(song);
      if (!menuGroups.has(label)) {
        const group = document.createElement('optgroup'); group.label = label; menuGroups.set(label, group);
      }
      const composer = song.demo ? '' : song.composer;
      menuGroups.get(label).append(new Option(`${composer ? `${composer} · ` : ''}${song.title}${song.kind === 'pattern' ? ' · pattern' : ''}`, song.id));
    }
    $('songSelect').replaceChildren(...menuGroups.values());
    // Browsing and filtering never choose a file or change the playing song.
    if (!selected && songs.length) {
      const placeholder = new Option('Choose a MIDI…', '');
      placeholder.disabled = true; placeholder.hidden = true;
      $('songSelect').prepend(placeholder);
    }
    $('songSelect').value = selected;
    $('songCount').value = query || $('collectionSelect').value ? `${songs.length} / ${all.length}` : `${all.length} MIDIs`;
    $('songSelect').disabled = !songs.length;
    $('nextSongButton').disabled = !songs.length;
    $('randomSongButton').disabled = !songs.length;
    $('songSearchStatus').textContent = songs.length ? '' : 'No matching songs. Try another title or artist.';
    return songs;
  }

  async function selectSong(song, { audition = false } = {}) {
    resumeAfterSelection = player.state.playing || (loadingFile && resumeAfterSelection)
      || (audition && player.state.audioEnabled);
    pendingPresetSong = false; currentSongId = song.id;
    textScore = song.textScore ?? null;
    $('showTextScore').checked = Boolean(textScore);
    renderSongMenu();
    const file = song.localFile;
    const version = ++selectionVersion;
    songRequest?.abort(); songRequest = new AbortController();
    loadingFile = true; selectionReady = false; fileError = ''; player.stop();
    showSongCredit(file ? null : song); reflectPlayer();
    try {
      if (file && file.size > 10 * 1024 * 1024) throw new Error('Choose a MIDI file smaller than 10 MB.');
      let binary;
      if (song.buffer) binary = song.buffer;
      else if (file) binary = await file.arrayBuffer();
      else {
        const response = await fetch(new URL(`../../../assets/midiphoria/${song.file}`, import.meta.url), { signal: songRequest.signal });
        if (!response.ok) throw new Error('Could not load this song. Choose another or open a local MIDI file.');
        binary = await response.arrayBuffer();
      }
      if (disposed || version !== selectionVersion) return;
      const loaded = await player.load(binary, file?.name || song.title);
      if (disposed || version !== selectionVersion) return;
      selectionReady = Boolean(loaded);
      if (selectionReady && resumeAfterSelection) player.play();
    } catch (error) {
      if (disposed || version !== selectionVersion || error.name === 'AbortError') return;
      fileError = error.message || 'Could not read this MIDI file.';
    } finally {
      if (!disposed && version === selectionVersion) { loadingFile = false; resumeAfterSelection = false; reflectPlayer(); }
    }
  }

  function randomSong(songs) {
    const choices = songs.filter(song => song.id !== currentSongId);
    const candidates = choices.length ? choices : songs;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  function choosePresetSong() {
    if (currentSongId) return;
    const song = randomSong(collection);
    if (!song) { pendingPresetSong = true; return; }
    $('songSearch').value = ''; $('collectionSelect').value = '';
    void selectSong(song);
  }

  // Generated scores use the same session library and transport as imported MIDIs.
  // A stable id replaces the previous generated score without accumulating files.
  function addSessionSong({ id, title, buffer, collection: group = 'Your MIDIs',
    description = '', attribution = 'Generated in this browser.', ...metadata }, options) {
    if (!(buffer instanceof ArrayBuffer)) throw new Error('The generated MIDI is unavailable.');
    const songId = id || `local-${++localSerial}`;
    const retained = localSongs.filter(song => song.id !== songId);
    const bytes = retained.reduce((sum, song) => sum + (song.localFile?.size ?? song.buffer?.byteLength ?? 0), buffer.byteLength);
    if (buffer.byteLength > 10 * 1024 * 1024 || bytes > 50 * 1024 * 1024 || retained.length >= 20) {
      throw new Error('Keep up to 20 MIDIs per session, 10 MB each and 50 MB in total.');
    }
    const song = { ...metadata, id: songId, title: String(title || 'Your MIDI').slice(0, 256),
      buffer, collection: group, description, attribution };
    localSongs = [...retained, song];
    $('songSearch').value = ''; $('collectionSelect').value = '';
    return selectSong(song, options).then(() => song);
  }

  player = new MidiphoriaPlayer({
    onMidi: message => accept(message), onState: reflectPlayer,
    onClear: (sourceId, reason) => {
      model.releaseSource(sourceId, clock());
      if (reason === 'song-replacement') renderer.clearSource('midiphoria:file', true);
    },
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
  on($('nextSongButton'), 'click', () => {
    const index = visibleSongs.findIndex(song => song.id === currentSongId);
    const song = visibleSongs[(index + 1) % visibleSongs.length];
    if (song) void selectSong(song);
  });
  on($('randomSongButton'), 'click', () => {
    const song = randomSong(visibleSongs);
    if (song) void selectSong(song);
  });
  on($('songSearch'), 'input', () => renderSongMenu());
  on($('collectionSelect'), 'change', () => renderSongMenu());
  on($('midiFile'), 'change', () => {
    const files = [...$('midiFile').files];
    $('midiFile').value = '';
    if (!files.length) return;
    const bytes = localSongs.reduce((sum, song) => sum + (song.localFile?.size ?? song.buffer?.byteLength ?? 0), 0)
      + files.reduce((sum, file) => sum + file.size, 0);
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
    else player.play();
    reflectPlayer();
  });
  on($('stopButton'), 'click', () => { resumeAfterSelection = false; player.stop(); reflectPlayer(); });
  on($('songPosition'), 'input', () => { $('songTime').value = `${timeLabel(Number($('songPosition').value))} / ${timeLabel(player.state.duration)}`; });
  on($('songPosition'), 'change', () => { player.seek(Number($('songPosition').value)); reflectPlayer(); });
  on($('playbackRate'), 'input', () => {
    player.setPlaybackRate(Number($('playbackRate').value));
    $('playbackRateOut').value = `${Number($('playbackRate').value).toFixed(2)}×`;
  });
  on($('loopSong'), 'change', () => { player.setLoop($('loopSong').checked); });
  on($('showTextScore'), 'change', reflectPlayer);
  on($('textMidiForm'), 'submit', async event => {
    event.preventDefault();
    try {
      const score = generateTextMidi($('textMidiInput').value);
      const pending = addSessionSong({ id: 'text-midi', title: score.text, buffer: score.buffer,
        collection: 'Text MIDI', textScore: score, attribution: 'Generated from your text in this browser.' }, { audition: true });
      $('textMidiStatus').textContent = '';
      if (textDownloadUrl) URL.revokeObjectURL(textDownloadUrl);
      textDownloadUrl = URL.createObjectURL(new Blob([score.buffer], { type: 'audio/midi' }));
      $('downloadTextMidi').href = textDownloadUrl;
      $('downloadTextMidi').download = `text-${score.text.replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'score'}.mid`;
      $('downloadTextMidi').hidden = false;
      await pending;
    } catch (error) {
      $('textMidiStatus').textContent = error.message || 'Could not create this MIDI.';
    }
  });

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
    const voiceColors = renderer.options.colorSource === 'voice';
    for (const id of ['palette', 'paletteHue', 'hueMode']) $(id).disabled = voiceColors;
    $('hueSpeed').disabled = voiceColors || settings.hueMode === 'static';
    $('voiceColorHelp').hidden = !voiceColors;
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
    envelopeEditor.refresh();
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
    const accepted = model.handleMessage(message, now);
    if (accepted && message.type === 'noteOn' && message.velocity > 0) renderer.setVoiceMetadata(message);
  }

  function releasePads() {
    player?.releasePads();
    for (const timer of padTimers.values()) clearTimeout(timer);
    padTimers.clear();
    for (const sourceId of padHeld.keys()) model.releaseSource(sourceId, clock());
    padHeld.clear();
    for (const pad of pads) pad.setAttribute('aria-pressed', 'false');
  }

  function clear() {
    releasePads();
    model.panic(clock()); renderer.clear();
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
  on($('resetButton'), 'click', () => {
    $('showTextScore').checked = false;
    resumeAfterSelection = false; pendingPresetSong = false; player.stop(); player.setPlaybackRate(1); player.setLoop(false);
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
    if (textScore && $('showTextScore').checked) {
      renderer.capture(sample, now);
      drawTextMidiScore(renderer.context, renderer.width, renderer.height, textScore, player.state, renderer.options, settings);
    } else renderer.draw(sample, now, settings);
    if (now - lastReadout > .08) {
      lastReadout = now;
      reflectPlayer();
      reflectVoices();
      const notes = [...new Set(sample.activeNotes.map(item => nameFor(item.note)))];
      $('noteReadout').value = notes.length ? `${notes.slice(0, 8).join(' · ')}${notes.length > 8 ? ' …' : ''} · ${sample.activeNotes.length} held`
        : sample.level > .001 ? `${sample.phase === 'release' ? 'Releasing' : 'Controller'} · ${sample.phase}` : 'Waiting for a note';
      $('levelReadout').value = `${Math.round(sample.level * 100)}% light`;
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
    if (textDownloadUrl) URL.revokeObjectURL(textDownloadUrl);
    if (frame !== null) cancelAnimationFrame(frame);
    resize.disconnect(); envelopeEditor.destroy(); presetController?.destroy(); unsubscribe(); manager.disable(); unregister(); events.abort();
  });
  presetController = registerHeaderPresets({ id: 'midiphoria', presets: MIDIPHORIA_PRESETS,
    capture: () => captureMidiphoriaPreset(settings, renderer.options),
    apply: snapshot => {
      $('showTextScore').checked = false;
      applyMidiphoriaPreset(model, renderer, snapshot, clock());
      settings = { ...model.options }; reflectControls(); choosePresetSong();
    },
    randomize: randomizeMidiphoriaPreset,
  });
  reflectControls(); draw();
  void fetch(new URL('../../../assets/midiphoria/collection.json', import.meta.url), { signal: events.signal })
    .then(response => { if (!response.ok) throw new Error('Collection unavailable. You can still open a local MIDI file.'); return response.json(); })
    .then(songs => {
      if (disposed) return;
      collection = songs;
      renderSongMenu();
      if (pendingPresetSong) choosePresetSong();
    })
    .catch(error => { if (!disposed && error.name !== 'AbortError') { fileError = error.message; reflectPlayer(); } });
}

mountMidiphoria();
globalThis.addEventListener('pageshow', event => { if (event.persisted) mountMidiphoria(); });
