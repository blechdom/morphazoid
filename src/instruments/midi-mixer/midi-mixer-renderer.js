import { GM_PROGRAM_NAMES } from './midi-mixer-model.js';
// Full-score density maps: horizontal time, one row per MIDI voice. No pitch lanes.
export const mixerVoiceColor = (deck, channel) => `hsl(${(deck ? 287 : 143) + channel * 4} 65% 69%)`;
const bounded = (n, low, high) => Math.max(low, Math.min(high, n));
export function buildVoiceMap(analysis, bins = 512) {
  const duration = Math.max(1, analysis.durationBeats || 1);
  const rows = analysis.channels.filter(channel => channel.noteCount > 0).map(channel => ({ ...channel, bins: new Uint32Array(bins), peak: 0 }));
  const byChannel = new Map(rows.map(row => [row.channel, row]));
  for (const note of analysis.notes) {
    const row = byChannel.get(note.channel); if (!row) continue;
    const i = Math.min(bins - 1, Math.floor(note.beat / duration * bins));
    row.peak = Math.max(row.peak, ++row.bins[i]);
  }
  return { duration, rows, bins };
}
export class MidiMixerRenderer {
  constructor(canvas, deckIndex, { onSeek = () => {}, onLoop = () => {}, onMute = () => {}, onSolo = () => {} } = {}) {
    this.canvas = canvas; this.deckIndex = deckIndex; this.onSeek = onSeek; this.onLoop = onLoop; this.onMute = onMute; this.onSolo = onSolo;
    this.context = canvas.getContext('2d'); this.cache = null; this.analysis = null; this.gesture = null;
    this.labelWidth = 0; this.voiceRows = new Map(); this.map = canvas.parentElement;
    const document = canvas.ownerDocument, view = document.defaultView;
    this.coarsePointer = view.matchMedia('(pointer: coarse)'); this.narrowViewport = view.matchMedia('(max-width: 900px)');
    this.sidebar = document.createElement('div'); this.sidebar.className = 'mixer-voice-sidebar'; this.sidebar.hidden = true;
    this.sidebar.setAttribute('role', 'group'); this.sidebar.setAttribute('aria-label', `Deck ${deckIndex ? 'B' : 'A'} voice controls`);
    this.map.classList.add('mixer-voice-map'); this.map.insertBefore(this.sidebar, canvas);
    this.events = new AbortController();
    this.sidebar.addEventListener('click', event => {
      const button = event.target.closest('button[data-voice-action]');
      if (!button || !this.sidebar.contains(button)) return;
      const channel = Number(button.closest('[data-channel]').dataset.channel);
      if (button.dataset.voiceAction === 'mute') this.onMute(channel); else this.onSolo(channel);
    }, { signal: this.events.signal });
    const on = (type, fn) => canvas.addEventListener(type, fn, { signal: this.events.signal });
    on('pointerdown', event => {
      if (!this.cache || event.button !== 0) return;
      event.preventDefault(); canvas.focus({ preventScroll: true }); canvas.setPointerCapture(event.pointerId);
      this.gesture = { id: event.pointerId, x: event.clientX, start: this.beatAt(event.clientX), end: this.beatAt(event.clientX) };
    });
    on('pointermove', event => { if (this.gesture?.id === event.pointerId) this.gesture.end = this.beatAt(event.clientX); });
    on('pointerup', event => {
      const gesture = this.gesture; if (gesture?.id !== event.pointerId) return;
      this.gesture = null;
      if (Math.abs(event.clientX - gesture.x) < 8) this.onSeek(gesture.end);
      else {
        const start = Math.floor(Math.min(gesture.start, gesture.end));
        this.onLoop(start, Math.max(start + 1, Math.ceil(Math.max(gesture.start, gesture.end))));
      }
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    });
    on('pointercancel', () => { this.gesture = null; });
    on('lostpointercapture', () => { this.gesture = null; });
    on('keydown', event => {
      if (event.key === 'Escape') { this.gesture = null; return; }
      if (!this.cache || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const beat = event.key === 'Home' ? 0 : event.key === 'End' ? this.cache.duration - .25
        : (this.position || 0) + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 4 : 1);
      this.onSeek(bounded(beat, 0, this.cache.duration));
    });
  }
  beatAt(clientX) {
    const box = this.canvas.getBoundingClientRect();
    return bounded((clientX - box.left) / Math.max(1, box.width), 0, 1) * this.cache.duration;
  }
  rebuildVoices() {
    const document = this.canvas.ownerDocument, letter = this.deckIndex ? 'B' : 'A', rows = this.cache?.rows ?? [];
    this.voiceRows.clear(); this.sidebar.replaceChildren(); this.sidebar.hidden = !rows.length;
    this.map.classList.toggle('has-voices', rows.length > 0);
    for (const voice of rows) {
      const row = document.createElement('div'); row.className = 'mixer-voice-row'; row.dataset.channel = String(voice.channel);
      const label = document.createElement('span'); label.className = 'mixer-voice-label';
      const name = document.createElement('span'); name.className = 'mixer-voice-name';
      const count = document.createElement('span'); count.className = 'mixer-voice-count'; count.textContent = `${voice.noteCount.toLocaleString()} notes`;
      label.append(name, count); row.append(label);
      const entry = { row, label, name };
      for (const action of ['mute', 'solo']) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'mixer-voice-button';
        button.textContent = action === 'mute' ? 'M' : 'S'; button.dataset.voiceAction = action;
        button.setAttribute('aria-label', `${action === 'mute' ? 'Mute' : 'Solo'} deck ${letter} channel ${voice.channel + 1}`);
        button.setAttribute('aria-pressed', 'false'); button.title = `${action === 'mute' ? 'Mute' : 'Solo'} this voice`;
        row.append(button); entry[action] = button;
      }
      row.style.setProperty('--voice-ink', mixerVoiceColor(this.deckIndex, voice.channel));
      this.sidebar.append(row); this.voiceRows.set(voice.channel, entry);
    }
  }
  reflectVoice(voice, config, muted) {
    const entry = this.voiceRows.get(voice.channel); if (!entry) return;
    const instrument = voice.drums ? 'Drums' : config?.program != null ? GM_PROGRAM_NAMES[config.program] : voice.instrument;
    const name = `${voice.port ? `P${voice.port + 1} · ` : ''}${voice.channel % 16 + 1} · ${instrument}`;
    if (entry.name.textContent !== name) {
      entry.name.textContent = name;
      const tracks = (voice.tracks ?? []).map(index => this.analysis.tracks?.find(track => track.index === index)?.name).filter(Boolean);
      entry.label.title = `${name} · ${voice.noteCount.toLocaleString()} notes${tracks.length ? ` · ${tracks.join(', ')}` : ''}`;
    }
    entry.row.classList.toggle('is-muted', Boolean(muted));
    for (const action of ['mute', 'solo']) {
      const pressed = String(Boolean(config?.[action]));
      if (entry[action].getAttribute('aria-pressed') !== pressed) entry[action].setAttribute('aria-pressed', pressed);
    }
  }
  draw(state) {
    const deck = state.decks?.[this.deckIndex]; if (!deck) return;
    if (deck.analysis !== this.analysis) {
      this.analysis = deck.analysis; this.cache = deck.analysis ? buildVoiceMap(deck.analysis) : null;
      this.gesture = null; this.rebuildVoices();
    }
    const width = this.canvas.getBoundingClientRect().width; if (!width) return;
    const rows = this.cache?.rows ?? [], rowHeight = this.coarsePointer.matches ? 48 : this.narrowViewport.matches ? 40 : 36;
    const height = Math.max(96, rows.length * rowHeight + 24);
    if (rowHeight !== this.rowHeight) { this.rowHeight = rowHeight; this.map.style.setProperty('--mixer-voice-row-height', `${rowHeight}px`); }
    const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
    this.canvas.style.height = `${height}px`;
    if (this.canvas.width !== Math.round(width * ratio) || this.canvas.height !== Math.round(height * ratio)) {
      this.canvas.width = Math.round(width * ratio); this.canvas.height = Math.round(height * ratio);
    }
    const ctx = this.context; ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = '#050b0d'; ctx.fillRect(0, 0, width, height);
    const left = 0, span = width;
    ctx.font = '10px monospace'; ctx.textBaseline = 'middle';
    if (!this.cache) { ctx.fillStyle = '#9db7af'; ctx.fillText('Choose a MIDI file', 12, height / 2); return; }
    const duration = this.cache.duration, scale = span / duration;
    const configs = new Map(deck.channels.map(channel => [channel.channel, channel]));
    const solo = deck.channels.some(channel => channel.solo);
    rows.forEach((row, index) => {
      const config = configs.get(row.channel), muted = deck.weaveActive === false || deck.config.mute || config?.mute || (solo && !config?.solo);
      this.reflectVoice(row, config, muted);
      const y = index * rowHeight;
      ctx.fillStyle = index % 2 ? '#0a1317' : '#071014'; ctx.fillRect(left, y, span, rowHeight - 1);
      const color = muted ? '#46514f' : mixerVoiceColor(this.deckIndex, row.channel);
      ctx.fillStyle = color;
      const cellWidth = span / this.cache.bins;
      for (let b = 0; b < row.bins.length; b++) {
        if (!row.bins[b]) continue;
        const density = .2 + .8 * Math.log1p(row.bins[b]) / Math.log1p(row.peak);
        const barHeight = density * (rowHeight - 6);
        ctx.fillRect(left + b * cellWidth, y + (rowHeight - barHeight) / 2, Math.max(.7, cellWidth), barHeight);
      }
    });
    const region = this.gesture ? [Math.min(this.gesture.start, this.gesture.end), Math.max(this.gesture.start, this.gesture.end)]
      : deck.config.loopEndBeats != null ? [deck.loopStartBeats, deck.loopEndBeats] : null;
    if (region) {
      ctx.fillStyle = '#dbe9d022'; ctx.fillRect(left + region[0] * scale, 0, (region[1] - region[0]) * scale, height - 24);
      ctx.strokeStyle = '#dbe9d0'; ctx.strokeRect(left + region[0] * scale, .5, (region[1] - region[0]) * scale, height - 25);
    }
    this.position = deck.positionBeats || 0;
    const x = left + bounded(this.position, 0, duration) * scale;
    ctx.fillStyle = '#fff'; ctx.fillRect(x, 0, 1, height - 24);
    ctx.fillStyle = '#91aaa2'; ctx.textAlign = 'left'; ctx.fillText('0', left, height - 11);
    ctx.textAlign = 'center'; ctx.fillText(`${Math.round(duration / 2)} beats`, left + span / 2, height - 11);
    ctx.textAlign = 'right'; ctx.fillText(`${Math.round(duration)} beats`, width - 4, height - 11); ctx.textAlign = 'left';
    this.canvas.setAttribute('aria-valuenow', String(Math.round(this.position * 100) / 100));
    this.canvas.setAttribute('aria-valuemax', String(duration));
    this.canvas.setAttribute('aria-valuetext', `Beat ${this.position.toFixed(1)} of ${Math.round(duration)}. Left and right to seek; drag a region to loop.`);
  }
  dispose() {
    this.events.abort(); this.gesture = null; this.sidebar.remove(); this.voiceRows.clear();
    this.map.classList.remove('mixer-voice-map', 'has-voices'); this.map.style.removeProperty('--mixer-voice-row-height');
  }
}
