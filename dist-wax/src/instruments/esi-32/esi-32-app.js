import { createRangeField } from '../../ui/index.js';
import { registerHeaderPresets } from '../../site/header-presets.js';
import { getSharedMidiManager, COMPUTER_KEYBOARD_LAYOUTS } from '../../midi-manager.js';
import { Esi32Audio } from './esi-32-audio.js';
import { mountAudioInputControl } from '../../audio-input-control.js';
import { Esi32SampleRecorder } from './esi-32-recorder.js';
import { ESI32_DEFAULT_PATCH, ESI32_DEMO_SAMPLES, ESI32_PRESETS, sanitizeEsi32Patch, randomizeEsi32Patch, createEsi32DemoData } from './esi-32-model.js';
import { encodeWav, serializeBank, parseBank } from './esi-32-files.js';

const $ = id => document.getElementById(id);
const audio = new Esi32Audio(globalThis);
const midi = getSharedMidiManager(globalThis);
const state = {
  selectedSlot: 0, octave: 0, audioOn: false, audition: false,
  patches: ESI32_DEMO_SAMPLES.map((sample, sampleSlot) => sanitizeEsi32Patch({ ...ESI32_DEFAULT_PATCH, sampleSlot, rootNote: sample.rootNote })),
  names: ESI32_DEMO_SAMPLES.map(sample => sample.label),
};
const held = new Map();
const velocities = new Map();
const deferredMidi = new Set();
const sustainedChannels = new Set();
const fields = new Map();
const abort = new AbortController();
const listen = (node, event, handler, options = {}) => node.addEventListener(event, handler, { ...options, signal: abort.signal });
const patch = () => state.patches[state.selectedSlot];
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const percent = value => `${Math.round(value * 100)}%`;
const seconds = value => value < 1 ? `${Math.round(value * 1000)} ms` : `${value.toFixed(2)} s`;
const noteName = note => `${['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][note % 12]}${Math.floor(note / 12) - 1}`;
let fullPresets;
let audioGeneration = 0;
let importGeneration = 0;
let starting = null;
let fileOperation = false;
let disposed = false;
let raf = 0;
let waveData = null;
let peaks = null;
let drag = null;
let inputControl;
let inputStream = null;
let inputSource = null;
let inputGain = null;
let inputPending = false;
let inputGeneration = 0;
let recordingSlot = 0;
let recordingGeneration = 0;
let applyingRecording = false;
let appliedBlob = null;
let inputMessage = '';
let sampleRecorder;
sampleRecorder = new Esi32SampleRecorder({
  runtime: globalThis,
  onChange(snapshot) {
    if (disposed) return;
    syncInput();
    syncAudio();
    if (snapshot.state === 'ready' && snapshot.blob && snapshot.blob !== appliedBlob) {
      appliedBlob = snapshot.blob;
      void applyRecordedSample(snapshot.blob, recordingSlot, recordingGeneration);
    }
  },
  onError: error => { if (!disposed) report(error); },
});
const wave = $('waveform');
const ctx = wave.getContext('2d');
const theme = getComputedStyle(document.body);
const colors = Object.fromEntries(['violet','lilac','wave-bg','wave-region','wave-loop'].map(key => [key, theme.getPropertyValue(`--esi-${key}`).trim()]));
const isWaxMidiOnly = () => document.documentElement.dataset.morphazoidWaxOutputMode === 'midi';

function report(error) {
  $('audioError').hidden = !error;
  $('audioError').textContent = error ? (error.message || String(error)) : '';
}

function syncAudio() {
  $('audioButton').setAttribute('aria-pressed', String(state.audioOn));
  $('audioState').textContent = state.audioOn ? 'on' : 'off';
  for (const id of ['sampleFile', 'bankFile', 'saveBank', 'exportSample']) $(id).disabled = !state.audioOn || fileOperation || recordingBusy() || applyingRecording;
  audio.setOutput(state.audioOn ? Number($('output').value) : 0);
  $('lcdStatus').textContent = state.audioOn ? 'Ready · hold a key to play' : 'Enable Audio · play the keys';
  syncInput();
}

function recordingBusy() { return ['starting','recording','stopping'].includes(sampleRecorder?.state); }

function syncInput() {
  const active = sampleRecorder?.state === 'recording';
  const waiting = ['starting','stopping'].includes(sampleRecorder?.state) || applyingRecording;
  $('recordSample').disabled = waiting || (!active && (!state.audioOn || !inputStream || fileOperation));
  $('recordSample').setAttribute('aria-pressed', String(active));
  $('recordSample').textContent = active ? '■ Stop recording' : waiting ? 'Preparing sample…' : `Record into slot ${state.selectedSlot + 1}`;
  $('inputDevice').disabled = inputPending || recordingBusy() || applyingRecording;
  $('recordingStatus').textContent = active ? `Recording into slot ${recordingSlot + 1} · ${sampleRecorder.elapsed.toFixed(1)} s / 60 s`
    : waiting ? 'Finishing the recorded sample…'
    : inputMessage || (inputStream ? 'Input connected · ready to record' : 'Enable Audio and connect your mic or audio input.');
  inputControl?.refresh();
}

async function refreshInputDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    if (disposed) return;
    const selected = $('inputDevice').value;
    const defaultOption = new Option('Default audio input', '');
    $('inputDevice').replaceChildren(defaultOption, ...devices.filter(device => device.kind === 'audioinput' && device.deviceId && device.deviceId !== 'default').map((device, index) => new Option(device.label || `Audio input ${index + 1}`, device.deviceId)));
    if ([...$('inputDevice').options].some(option => option.value === selected)) $('inputDevice').value = selected;
  } catch { /* The default device remains usable if enumeration is unavailable. */ }
}

async function startInput() {
  if (disposed || inputStream || inputPending) return;
  if (!state.audioOn || audio.context?.state !== 'running') throw new Error('Enable Audio before connecting your input.');
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Audio input needs a secure browser with microphone support.');
  const generation = ++inputGeneration;
  inputPending = true; inputMessage = ''; syncInput();
  let stream;
  try {
    const deviceId = $('inputDevice').value;
    stream = await navigator.mediaDevices.getUserMedia({ audio: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), channelCount: { ideal: 2 }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    if (disposed || generation !== inputGeneration || !state.audioOn) { stream.getTracks().forEach(track => track.stop()); return; }
    const source = audio.context.createMediaStreamSource(stream);
    const gain = inputControl.createGain(audio.context);
    source.connect(gain);
    inputStream = stream; inputSource = source; inputGain = gain;
    for (const track of stream.getAudioTracks()) track.addEventListener('ended', () => { if (inputStream === stream) { void stopInput(); inputMessage = 'Audio input disconnected.'; syncInput(); } }, { once: true });
    await refreshInputDevices();
  } catch (error) { stream?.getTracks().forEach(track => track.stop()); throw error; }
  finally { if (generation === inputGeneration) { inputPending = false; syncInput(); } }
}

async function stopInput() {
  inputGeneration++; inputPending = false;
  const finishing = sampleRecorder.stop();
  const stream = inputStream; inputStream = null;
  stream?.getTracks().forEach(track => track.stop());
  inputSource?.disconnect(); inputSource = null;
  inputGain?.disconnect(); inputGain = null;
  syncInput();
  await finishing;
}

async function applyRecordedSample(blob, slot, generation) {
  applyingRecording = true; syncAudio();
  try {
    const context = audio.context;
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    if (disposed || generation !== recordingGeneration || context !== audio.context) return;
    audio.setSample(slot, buffer);
    state.names[slot] = `Input take ${String(slot + 1).padStart(2, '0')}`;
    state.patches[slot] = sanitizeEsi32Patch({ ...state.patches[slot], start:0, end:1, loopStart:0, loopEnd:1 });
    refreshSlots();
    if (slot === state.selectedSlot) { syncPatch(); refreshWave(); }
    inputMessage = `${buffer.duration.toFixed(2)} s recorded into slot ${slot + 1} · play the keys to listen`;
  } catch (error) { report(new Error(`Could not load recording: ${error.message}`)); }
  finally { applyingRecording = false; if (!disposed) syncAudio(); }
}

async function enableAudio() {
  if (disposed || isWaxMidiOnly()) return false;
  if (state.audioOn) return true;
  if (starting) return starting;
  const generation = audioGeneration;
  report(null);
  starting = audio.start().then(started => {
    if (!started || disposed || generation !== audioGeneration || isWaxMidiOnly()) return false;
    state.audioOn = true;
    syncAudio();
    refreshWave();
    for (const [id,note] of held) {
      try { audio.noteOn(note,(velocities.get(id) ?? 100)/127,id,patch()); }
      catch (error) { held.delete(id); velocities.delete(id); report(error); }
    }
    syncKeys();
    requestDraw();
    return true;
  }).catch(error => { if (generation === audioGeneration) report(error); return false; }).finally(() => { starting = null; });
  return starting;
}

function release(id) {
  held.delete(id); velocities.delete(id);
  deferredMidi.delete(id);
  audio.noteOff(id);
  syncKeys();
}

function panic() {
  held.clear(); velocities.clear(); deferredMidi.clear(); sustainedChannels.clear();
  audio.panic();
  state.audition = false;
  $('audition').setAttribute('aria-pressed', 'false');
  $('audition').textContent = '▶ Audition';
  syncKeys();
}

function play(note, id, velocity = 100) {
  if (disposed || held.has(id)) return;
  held.set(id, note); velocities.set(id,velocity);
  if (state.audioOn && !isWaxMidiOnly()) {
    try { audio.noteOn(note, velocity/127, id, patch()); }
    catch (error) { held.delete(id); velocities.delete(id); report(error); }
  }
  syncKeys();
  $('lcdStatus').textContent = state.audioOn ? `${noteName(note)} · velocity ${velocity}` : 'Audio off · enable Audio to listen';
  requestDraw();
}

function syncKeys() {
  const notes = new Set(held.values());
  for (const key of $('keyboard').querySelectorAll('[data-note]')) key.classList.toggle('is-held', notes.has(Number(key.dataset.note)));
}

function syncPatch() {
  for (const [key, field] of fields) field.setValue(patch()[key]);
  $('reverse').checked = patch().reverse;
  $('loopEnabled').checked = patch().loopMode === 'forward';
  wave.setAttribute('aria-valuenow', String(Math.round(patch().start * 100)));
  wave.setAttribute('aria-valuetext', `${percent(patch().start)} start, ${percent(patch().end)} end`);
  audio.setPatch(patch());
  audio.updateLivePatch(patch());
  fullPresets?.refresh();
  requestDraw();
}

function changePatch(changes) {
  state.patches[state.selectedSlot] = sanitizeEsi32Patch({ ...patch(), ...changes });
  syncPatch();
}

function refreshSlots() {
  $('sampleSlots').replaceChildren(...state.names.map((name, slot) => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'esi-slot'; button.dataset.slot = slot;
    button.setAttribute('aria-pressed', String(slot === state.selectedSlot));
    button.setAttribute('aria-label', `Sample ${slot + 1}: ${name}`);
    const label = document.createElement('span'); label.textContent = `0${slot + 1}`;
    const title = document.createElement('strong'); title.textContent = name;
    button.append(label, title);
    button.addEventListener('click', () => selectSlot(slot));
    return button;
  }));
  $('lcdBank').textContent = `0${state.selectedSlot + 1} / SAMPLE BANK`;
  $('lcdSample').textContent = state.names[state.selectedSlot];
  syncInput();
}

function selectSlot(slot) {
  state.selectedSlot = slot;
  refreshSlots(); syncPatch(); refreshWave(); syncInput();
}

function refreshWave() {
  const buffer = audio.samples.get(state.selectedSlot);
  waveData = buffer ? { channels: [buffer.getChannelData(0)], sampleRate: buffer.sampleRate, duration: buffer.duration } : createEsi32DemoData(state.selectedSlot);
  const data = waveData.channels[0];
  peaks = new Float32Array(1024);
  for (let i = 0; i < peaks.length; i++) {
    const end = Math.min(data.length, Math.ceil((i + 1) * data.length / peaks.length));
    let peak = 0;
    for (let j = Math.floor(i * data.length / peaks.length); j < end; j++) peak = Math.max(peak, Math.abs(data[j]));
    peaks[i] = peak;
  }
  $('sampleInfo').textContent = `${waveData.duration.toFixed(2)} s · ${(waveData.sampleRate / 1000).toFixed(1)} kHz · ${buffer?.numberOfChannels === 2 ? 'stereo' : 'mono'}`;
  requestDraw();
}

function requestDraw() { if (!raf && !disposed && !document.hidden) raf = requestAnimationFrame(drawWave); }

function drawWave() {
  raf = 0;
  if (disposed || !peaks) return;
  const rect = wave.getBoundingClientRect();
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (wave.width !== width || wave.height !== height) { wave.width = width; wave.height = height; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = rect.width; const h = rect.height; const p = patch();
  ctx.clearRect(0, 0, w, h); ctx.fillStyle = colors['wave-bg']; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = colors['wave-region']; ctx.fillRect(p.start * w, 0, (p.end - p.start) * w, h);
  if (p.loopMode === 'forward') { ctx.fillStyle = colors['wave-loop']; ctx.fillRect(p.loopStart * w, 0, (p.loopEnd - p.loopStart) * w, h); }
  ctx.strokeStyle = colors.violet; ctx.lineWidth = 1; ctx.beginPath();
  for (let x = 0; x < w; x++) {
    const peak = peaks[Math.min(peaks.length - 1, Math.floor(x / w * peaks.length))] * h * .39;
    ctx.moveTo(x + .5, h / 2 - peak); ctx.lineTo(x + .5, h / 2 + peak);
  }
  ctx.stroke();
  for (const [key, label, color, y] of [['start','START',colors.lilac,14],['end','END',colors.lilac,14],['loopStart','LOOP IN',colors.violet,h-10],['loopEnd','LOOP OUT',colors.violet,h-10]]) {
    if (key.startsWith('loop') && p.loopMode !== 'forward') continue;
    const x = clamp(p[key] * w, 1, w - 1);
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke();
    ctx.font = '9px monospace'; ctx.textAlign = x > w / 2 ? 'right' : 'left'; ctx.fillText(label, x > w / 2 ? x - 5 : x + 5, y);
  }
  const heads = state.audioOn ? audio.getPlayheads() : [];
  if (state.audioOn && state.audition && !audio.voices.has('audition')) {
    state.audition = false; release('audition');
    $('audition').setAttribute('aria-pressed','false'); $('audition').textContent = '▶ Audition';
    $('lcdStatus').textContent = 'Ready · hold a key to play';
  }
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
  for (const head of heads.filter(item => item.slot === state.selectedSlot)) { ctx.beginPath(); ctx.moveTo(head.position * w,20); ctx.lineTo(head.position * w,h - 20); ctx.stroke(); }
  if (heads.length) requestDraw();
}

const specs = {
  trimControls: [
    ['start', 'Trim start', 0, .999, .001, percent], ['end', 'Trim end', .001, 1, .001, percent],
    ['loopStart', 'Loop start', 0, .999, .001, percent], ['loopEnd', 'Loop end', .001, 1, .001, percent],
  ],
  tuningControls: [
    ['rootNote', 'Original key', 0, 127, 1, noteName], ['tune', 'Transpose', -36, 36, .1, value => `${value > 0 ? '+' : ''}${value.toFixed(1)} st`],
    ['fine', 'Fine tune', -100, 100, 1, value => `${value} cents`], ['pan', 'Pan', -1, 1, .01, value => value === 0 ? 'center' : `${Math.round(Math.abs(value) * 100)}% ${value < 0 ? 'L' : 'R'}`],
    ['level', 'Sample level', 0, 1, .01, percent],
  ],
  filterControls: [ ['cutoff', 'Cutoff', 30, 20000, 1, value => value >= 1000 ? `${(value / 1000).toFixed(1)} kHz` : `${Math.round(value)} Hz`], ['resonance', 'Resonance', 0, 1, .01, percent], ['filterEnv', 'Envelope depth', -48, 48, .1, value => `${value.toFixed(1)} st`] ],
  envelopeControls: [ ['attack', 'Attack', .002, 8, .001, seconds], ['decay', 'Decay', .005, 12, .005, seconds], ['sustain', 'Sustain', 0, 1, .01, percent], ['release', 'Release', .005, 15, .005, seconds] ],
  lfoControls: [ ['lfoRate', 'Rate', .05, 20, .05, value => `${value.toFixed(1)} Hz`], ['lfoDepth', 'Depth', 0, 200, 1, value => `${value} cents`] ],
};
for (const [host, controls] of Object.entries(specs)) {
  for (const [key, label, min, max, step, formatValue] of controls) {
    const field = createRangeField({ id:key, label, min, max, step, formatValue, value:patch()[key], className:'esi-field', onInput: value => changePatch({ [key]: value }) });
    fields.set(key, field); $(host).append(field);
  }
}

const physicalOffsets = COMPUTER_KEYBOARD_LAYOUTS.piano.noteOffsets;
const keyLabel = code => code.replace(/^(Key|Digit)/, '').toLowerCase();
const offsets = Object.fromEntries(Object.entries(physicalOffsets).map(([code,value]) => [keyLabel(code),value]));
const keyboardRows = [['z','s','x','d','c','v','g','b','h','n','j','m'], ['q','2','w','3','e','r','5','t','6','y','7','u']];
function renderKeyboard() {
  for (const id of [...held.keys()]) if (id.startsWith('p:') || id.startsWith('b:')) release(id);
  $('keyboard').replaceChildren(...keyboardRows.map(keys => {
    const row = document.createElement('div'); row.className = 'esi-key-row';
    keys.forEach(key => {
      const note = 48 + state.octave * 12 + offsets[key];
      const button = document.createElement('button'); button.type = 'button'; button.className = `esi-key${[1,3,6,8,10].includes(note % 12) ? ' sharp' : ''}`;
      button.dataset.note = note; button.dataset.key = key; button.setAttribute('aria-label', `${noteName(note)}, key ${key.toUpperCase()}`);
      const b = document.createElement('b'); b.textContent = key.toUpperCase(); const small = document.createElement('small'); small.textContent = noteName(note); button.append(b, small);
      button.addEventListener('pointerdown', event => { if (event.button !== 0) return; event.preventDefault(); button.setPointerCapture(event.pointerId); play(note, `p:${note}:${event.pointerId}`); });
      for (const eventType of ['pointerup','pointercancel','lostpointercapture']) button.addEventListener(eventType, event => release(`p:${note}:${event.pointerId}`));
      button.addEventListener('keydown', event => { if (!['Enter',' '].includes(event.key)) return; event.preventDefault(); if (!event.repeat) play(note, `b:${note}`); });
      button.addEventListener('keyup', event => { if (['Enter',' '].includes(event.key)) { event.preventDefault(); release(`b:${note}`); } });
      button.addEventListener('blur', () => release(`b:${note}`));
      row.append(button);
    });
    return row;
  }));
  $('octaveLabel').textContent = `${noteName(48 + state.octave * 12)}–${noteName(71 + state.octave * 12)}`;
  syncKeys();
}
const editable = target => target?.closest?.('input,select,textarea,[contenteditable]:not([contenteditable="false"])');
listen(window, 'keydown', event => {
  if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.altKey || event.metaKey || editable(event.target)) return;
  const key = keyLabel(event.code);
  if (physicalOffsets[event.code] === undefined) return;
  event.preventDefault();
  if (!event.repeat) play(48 + state.octave * 12 + offsets[key], `k:${key}`);
});
listen(window, 'keyup', event => { const id = `k:${keyLabel(event.code)}`; if (held.has(id)) { event.preventDefault(); release(id); } });
listen(window, 'blur', () => {
  for (const id of [...held.keys()]) if (id !== 'audition') release(id);
  sustainedChannels.clear(); deferredMidi.clear();
});
listen(document, 'visibilitychange', () => { if (document.hidden) { panic(); cancelAnimationFrame(raf); raf = 0; } else requestDraw(); });
for (const [id, delta] of [['octaveDown',-1],['octaveUp',1]]) listen($(id), 'click', () => { state.octave = clamp(state.octave + delta, -2, 2); renderKeyboard(); fullPresets?.refresh(); });

listen($('audioButton'), 'click', () => {
  if (state.audioOn || starting) {
    const generation = ++audioGeneration;
    importGeneration++; state.audioOn = false;
    const inputStopped = stopInput();
    const auditionWasOn = state.audition; panic();
    if (auditionWasOn) { state.audition = true; held.set('audition',patch().rootNote); $('audition').setAttribute('aria-pressed','true'); $('audition').textContent = '■ Stop audition'; }
    audio.setOutput(0); syncAudio();
    void inputStopped.finally(() => { if (!state.audioOn && generation === audioGeneration) void audio.stop(); });
  } else void enableAudio();
});
listen($('output'), 'input', () => { $('outputOut').textContent = percent(Number($('output').value)); audio.setOutput(state.audioOn ? Number($('output').value) : 0); });
listen($('audition'), 'click', () => {
  state.audition = !state.audition;
  $('audition').setAttribute('aria-pressed', String(state.audition));
  $('audition').textContent = state.audition ? '■ Stop audition' : '▶ Audition';
  if (state.audition) play(patch().rootNote, 'audition'); else release('audition');
});
listen($('panic'), 'click', panic);
listen($('reverse'), 'change', () => changePatch({ reverse: $('reverse').checked }));
listen($('loopEnabled'), 'change', () => changePatch({ loopMode: $('loopEnabled').checked ? 'forward' : 'off' }));
listen($('resetPatch'), 'click', () => changePatch({ ...ESI32_DEFAULT_PATCH, sampleSlot:state.selectedSlot, rootNote:ESI32_DEMO_SAMPLES[state.selectedSlot].rootNote }));

listen(wave, 'pointerdown', event => {
  if (event.button !== 0) return;
  const rect = wave.getBoundingClientRect(); const x = clamp((event.clientX - rect.left) / rect.width,0,1);
  const keys = patch().loopMode === 'forward' ? ['start','end','loopStart','loopEnd'] : ['start','end'];
  // Top/bottom halves disambiguate coincident trim/loop markers.
  const candidates = keys.filter(key => keys.length === 2 || (event.clientY - rect.top < rect.height / 2 ? !key.startsWith('loop') : key.startsWith('loop')));
  drag = { id:event.pointerId, key:candidates.reduce((a,b) => Math.abs(patch()[a] - x) < Math.abs(patch()[b] - x) ? a : b) };
  wave.setPointerCapture(event.pointerId); event.preventDefault(); wave.focus();
  changePatch({ [drag.key]: x });
});
listen(wave, 'pointermove', event => { if (!drag || drag.id !== event.pointerId) return; const rect = wave.getBoundingClientRect(); changePatch({ [drag.key]:clamp((event.clientX - rect.left)/rect.width,0,1) }); });
for (const name of ['pointerup','pointercancel','lostpointercapture']) listen(wave,name, () => { drag = null; });
listen(wave, 'keydown', event => { if (!['ArrowLeft','ArrowRight'].includes(event.key)) return; event.preventDefault(); const key = event.shiftKey ? 'end' : 'start'; changePatch({ [key]:patch()[key] + (event.key === 'ArrowLeft' ? -.005 : .005) }); });

function download(bytes, name, type) {
  const url = URL.createObjectURL(new Blob([bytes], {type}));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

listen($('sampleFile'), 'change', async event => {
  const file = event.target.files?.[0]; event.target.value = '';
  if (!file || !state.audioOn || fileOperation) return;
  fileOperation = true; syncAudio();
  const slot = state.selectedSlot; const generation = ++importGeneration;
  try {
    report(null);
    if (file.size > 32 * 1024 * 1024) throw new Error('Choose an audio file smaller than 32 MB.');
    const context = audio.context;
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    if (generation !== importGeneration || context !== audio.context || !state.audioOn || disposed) return;
    audio.setSample(slot, buffer);
    state.names[slot] = file.name.replace(/\.[^.]+$/, '').slice(0, 64) || 'Local sample';
    state.patches[slot] = sanitizeEsi32Patch({ ...state.patches[slot], start:0,end:1,loopStart:0,loopEnd:1 });
    refreshSlots(); if (slot === state.selectedSlot) { syncPatch(); refreshWave(); }
  } catch (error) { if (generation === importGeneration) report(new Error(`Could not load sample: ${error.message}`)); }
  finally { fileOperation = false; syncAudio(); }
});
listen($('exportSample'), 'click', () => {
  const buffer = audio.samples.get(state.selectedSlot); if (!buffer) return;
  try { download(encodeWav(buffer, patch()), `${state.names[state.selectedSlot].replace(/[^a-z0-9_-]/gi,'-')}-cut.wav`, 'audio/wav'); } catch (error) { report(error); }
});
listen($('saveBank'), 'click', () => {
  try { download(serializeBank(captureBank(), audio.samples), 'morphazoid-esi32-bank.json', 'application/json'); } catch (error) { report(error); }
});
listen($('bankFile'), 'change', async event => {
  const file = event.target.files?.[0]; event.target.value = '';
  if (!file || !state.audioOn || fileOperation) return;
  fileOperation = true; syncAudio();
  const generation = ++importGeneration;
  try {
    report(null);
    if (file.size > 48 * 1024 * 1024) throw new Error('Bank exceeds the 48 MB file limit.');
    const bank = parseBank(await file.text()); const context = audio.context;
    const decoded = await Promise.all(bank.samples.map(async sample => ({slot:sample.slot, buffer:await context.decodeAudioData(sample.bytes)})));
    let memory = 0;
    for (const {buffer} of decoded) {
      memory += buffer.length * buffer.numberOfChannels * 4;
      if (buffer.duration > 60 || buffer.numberOfChannels > 2) throw new Error('Each sample must be mono/stereo and no longer than 60 seconds.');
    }
    if (memory > 128 * 1024 * 1024) throw new Error('Bank exceeds 128 MB of decoded audio.');
    if (generation !== importGeneration || context !== audio.context || !state.audioOn || disposed) return;
    // Fully validate before replacing any existing sample or setting.
    const patches = bank.state.patches.map((item,sampleSlot) => sanitizeEsi32Patch({...item,sampleSlot}));
    const oldSamples = new Map(audio.samples);
    const oldReversals = new Map(audio.reverseBuffers);
    const oldRegions = new Map(audio.regionBuffers);
    try {
      audio.samples.clear(); audio.reverseBuffers.clear(); audio.regionBuffers.clear();
      for (const {slot,buffer} of decoded) audio.setSample(slot,buffer);
    } catch (error) { audio.samples.clear(); audio.reverseBuffers.clear(); audio.regionBuffers.clear(); for (const [slot,buffer] of oldSamples) audio.samples.set(slot,buffer); for (const [slot,record] of oldReversals) audio.reverseBuffers.set(slot,record); for (const [slot,record] of oldRegions) audio.regionBuffers.set(slot,record); throw error; }
    state.patches = patches; state.names = bank.state.names; state.selectedSlot = bank.state.selectedSlot; state.octave = bank.state.octave;
    refreshSlots(); syncPatch(); refreshWave(); renderKeyboard();
  } catch (error) { if (generation === importGeneration) report(new Error(`Could not open bank: ${error.message}`)); }
  finally { fileOperation = false; syncAudio(); }
});

function captureBank() { return {patches:state.patches.map(item => ({...item})), names:[...state.names], selectedSlot:state.selectedSlot, octave:state.octave}; }
function captureScene() { return {patches:state.patches.map(item => ({...item})), selectedSlot:state.selectedSlot, octave:state.octave}; }
fullPresets = registerHeaderPresets({
  id:'esi-32',
  presets:ESI32_PRESETS.map(preset => ({id:preset.id,label:preset.label,snapshot:{patches:state.patches.map((item,sampleSlot) => sanitizeEsi32Patch({...item,...(preset.patch || preset.snapshot),sampleSlot,rootNote:ESI32_DEMO_SAMPLES[sampleSlot].rootNote})),selectedSlot:(preset.patch || preset.snapshot).sampleSlot,octave:0}})),
  capture:captureScene,
  apply(snapshot) {
    if (!Array.isArray(snapshot.patches) || snapshot.patches.length !== 8) throw new Error('Invalid sampler scene');
    state.patches = snapshot.patches.map((item,sampleSlot) => sanitizeEsi32Patch({...item,sampleSlot}));
    state.selectedSlot = clamp(Math.round(snapshot.selectedSlot || 0),0,7); state.octave = clamp(Math.round(snapshot.octave || 0),-2,2);
    refreshSlots(); syncPatch(); refreshWave(); renderKeyboard();
  },
  randomize(snapshot, random) { return {patches:snapshot.patches.map((item,sampleSlot) => ({...randomizeEsi32Patch(Math.floor(random()*0xffffffff),item),sampleSlot})),selectedSlot:Math.floor(random()*8),octave:Math.floor(random()*5)-2}; },
});

function handleMidi(message) {
  if (message.logical?.type === 'macro') {
    const value = clamp(message.logical.normalized || 0,0,1);
    const macros = [ ['cutoff',30 * (20000/30) ** value], ['resonance',value], ['tune',value*72-36], ['attack',.002 + value*7.998], ['release',.005 + value*14.995], ['pan',value*2-1], ['lfoDepth',value*200], ['level',value] ];
    const control = macros[message.logical.index];
    if (control) changePatch({[control[0]]:control[1]});
    return;
  }
  const channel = `${message.sourceId || 'midi'}:${message.channel || 0}`;
  const id = `m:${channel}:${message.note}`;
  if (message.type === 'noteOn') { if (held.has(id)) release(id); play(message.note,id,message.velocity); }
  if (message.type === 'noteOff') { if (sustainedChannels.has(channel)) deferredMidi.add(id); else release(id); }
  if (message.type === 'pitchBend') audio.setPitchBend(clamp(message.normalized || 0,-1,1)*2);
  if (message.type === 'controlChange') {
    if (message.controller === 64) {
      if (message.value >= 64) sustainedChannels.add(channel);
      else { sustainedChannels.delete(channel); for (const key of [...deferredMidi]) if (key.startsWith(`m:${channel}:`)) release(key); }
    }
    if ([120,123].includes(message.controller)) panic();
    if (message.controller === 74) changePatch({cutoff:40 * 500 ** (message.value / 127)});
    if (message.controller === 71) changePatch({resonance:message.value / 127});
    if (message.controller === 73) changePatch({attack:.001 + 4.999 * message.value / 127});
    if (message.controller === 72) changePatch({release:.01 + 7.99 * message.value / 127});
    if (message.controller === 7) { $('output').value = message.value / 127; $('output').dispatchEvent(new Event('input',{bubbles:true})); }
  }
}
const unregisterMidi = midi.registerClient({id:'esi-32',computerKeyboard:false,onPrepareEnable:() => { void enableAudio(); },onMessage:handleMidi,onEnabledChange:enabled => { if (!enabled) { for (const id of [...held.keys()]) if (id.startsWith('m:')) release(id); sustainedChannels.clear(); audio.setPitchBend(0); } }});

const observer = new ResizeObserver(requestDraw); observer.observe(wave);
inputControl = mountAudioInputControl({
  container: $('sampleInputControls'),
  gainValue: 1,
  onStart: startInput,
  onStop: stopInput,
  getState: () => ({ active: Boolean(inputStream), pending: inputPending, supported: Boolean(navigator.mediaDevices?.getUserMedia) && !isWaxMidiOnly() }),
  getSignal: () => ({ node: inputGain, stream: inputStream }),
});
listen($('recordSample'), 'click', async () => {
  if (sampleRecorder.state === 'recording') { await sampleRecorder.stop(); return; }
  if (recordingBusy() || applyingRecording || !state.audioOn || !inputGain || !inputStream || fileOperation) return;
  recordingSlot = state.selectedSlot; recordingGeneration++; inputMessage = ''; report(null);
  const channels = inputStream.getAudioTracks()[0]?.getSettings?.().channelCount === 2 ? 2 : 1;
  await sampleRecorder.start(audio.context, inputGain, channels);
});
listen($('inputDevice'), 'change', async () => {
  const reconnect = Boolean(inputStream);
  await stopInput();
  if (reconnect && state.audioOn) { try { await startInput(); } catch (error) { report(error); } }
});
refreshSlots(); syncPatch(); refreshWave(); renderKeyboard(); syncAudio();
window.__esi32 = { audio, sampleRecorder, getState:() => ({...captureBank(),audioOn:state.audioOn,audition:state.audition,held:[...held.entries()],inputActive:Boolean(inputStream),inputPending,applyingRecording}) };
listen(window,'pagehide', () => {
  disposed = true; audioGeneration++; importGeneration++; panic(); state.audioOn = false; cancelAnimationFrame(raf); raf = 0;
  recordingGeneration++; inputControl.destroy(); sampleRecorder.dispose();
  observer.disconnect(); unregisterMidi(); fullPresets.destroy(); for (const field of fields.values()) field.destroy(); abort.abort(); void audio.dispose();
});
window.addEventListener('pageshow',event => { if (event.persisted) window.location.reload(); });
