import { ART_LIMITS, ART_SCRIPTS, ART_CURVES, imageArtwork, transformArtwork, encodeArtwork, artworkStatistics } from './blech-midi-art.js';

const COLORS = ['#96f4cc', '#e9a1ff', '#ffd878', '#79beff', '#ff969d', '#c0e883', '#cea6ff', '#80e4e7'];
const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const range = (id, label, min, max, step, value) => `<label class="control" for="art${id}"><span><b>${label}</b><output id="art${id}Out">${value}</output></span><input id="art${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}"></label>`;
const curve = (id, label) => `<label>${label}<select id="art${id}">${ART_CURVES.map(name => `<option value="${name}">${name}</option>`).join('')}</select></label>`;

export function mountMidiArtCreator(host, { getDrawingScore, onSend, getTempo = () => 120 } = {}) {
  const events = new AbortController(), on = (node, type, fn) => node.addEventListener(type, fn, { signal: events.signal });
  host.innerHTML = `<summary>MIDI art creator</summary><div class="blech-art-body">
    <div class="blech-art-actions"><label class="blech-art-upload deck-file">Image → MIDI<input id="artImage" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp" aria-label="Image to MIDI"></label><button id="artUseDrawing" type="button">Copy drawing</button><button id="artClear" type="button">Clear layers</button></div>
    <div class="blech-art-scene"><canvas id="artPreview" width="960" height="420" aria-label="MIDI artwork layers: pitch left to right, time from bottom to top">Prepared notes overlap on one canvas. Layer colors identify their sources.</canvas><output id="artStatistics">Add an image, copy a drawing, or select a generator.</output></div>
    <div id="artLayers" class="blech-art-layers" role="group" aria-label="Artwork layers"></div>
    <label class="blech-art-check"><input id="artGhosts" type="checkbox" checked>Show original notes behind the result</label>
    <label class="blech-art-script">Piano-roll script<select id="artScript">${ART_SCRIPTS.map(script => `<option value="${script.id}">${escape(script.label)}</option>`).join('')}</select></label><p id="artScriptDescription" class="midiphoria-help"></p>
    <div class="blech-art-actions"><button id="artSend" type="button" disabled>Send to pad ↑</button><label class="blech-art-check"><input id="artLoop" type="checkbox">Loop this send</label><button id="artExport" type="button" disabled>Export MIDI</button></div>
    <output id="artStatus" role="status"></output>
    <details class="blech-art-settings"><summary>Image mapping &amp; script controls</summary><div class="blech-art-controls">
      ${range('Width', 'Image width', 4, 128, 1, 64)}${range('Height', 'Image height', 4, 256, 1, 64)}${range('Threshold', 'Ink threshold', 0, 255, 1, 128)}
      ${range('Low', 'Lowest pitch', 0, 127, 1, 0)}${range('High', 'Highest pitch', 0, 127, 1, 127)}${range('Beats', 'Length · beats', .25, 128, .25, 8)}${range('Velocity', 'Velocity', 1, 127, 1, 96)}
      ${range('Step', 'Step · beats', .015625, 8, .015625, .125)}${range('Repeats', 'Repeats', 1, 16, 1, 4)}${range('Interval', 'Interval · semitones', -48, 48, 1, 12)}${range('Amount', 'Scatter amount', 0, 1, .01, .3)}${range('Cycles', 'Wave cycles', .25, 16, .25, 2)}
    </div><div class="blech-art-actions"><label class="blech-art-check"><input id="artInvert" type="checkbox">Light pixels</label><label class="blech-art-check"><input id="artImageVelocity" type="checkbox">Ink → velocity</label><label class="blech-art-check"><input id="artRetrigger" type="checkbox">Retrigger each cell</label><label class="blech-art-seed">Seed<input id="artSeed" type="number" min="0" max="4294967295" step="1" value="1"></label><button id="artReseed" type="button">Reseed</button></div>
    <p class="midiphoria-help">Image width maps across the selected pitches; image height divides Length into time rows, bottom first. Dark pixels become notes. These controls update the latest image layer. Scripts transform a copy; changing them leaves sent pads playing.</p></details>
    <details class="blech-art-settings"><summary>Pitch, velocity &amp; length curves</summary><div class="blech-art-controls">
      ${curve('PitchCurve', 'Pitch path')}${range('PitchDepth', 'Pitch depth · semitones', -64, 64, 1, 0)}
      ${curve('VelocityCurve', 'Velocity curve')}${range('VelocityDepth', 'Velocity depth', 0, 1, .01, 0)}
      ${curve('GateCurve', 'Note length curve')}${range('GateDepth', 'Length depth', 0, 1, .01, 0)}
    </div><p class="midiphoria-help">Curves follow attack position across the prepared timeline. Pitch changes note numbers, velocity changes attacks, and length changes release times. These are note edits, not continuous pitch bends. Wave cycles applies to sine and triangle.</p></details>
  </div>`;
  const $ = id => host.querySelector(`#art${id}`), canvas = $('Preview'), context = canvas.getContext('2d');
  for (const button of host.querySelectorAll('.blech-art-actions button')) button.classList.add('mini-action');
  let layers = [], serial = 0, processed = { notes: [], durationBeats: 8 }, original = [], error = '', disposed = false, imageTicket = 0, raster = null, imageLayer = null, download = null, scheduled = null;
  const number = id => Number($(id).value);
  const options = () => ({ low: number('Low'), high: number('High'), beats: number('Beats'), velocity: number('Velocity'), threshold: number('Threshold'), invert: $('Invert').checked, retrigger: $('Retrigger').checked, velocityFromImage: $('ImageVelocity').checked, seed: number('Seed'), step: number('Step'), repeats: number('Repeats'), interval: number('Interval'), amount: number('Amount'), cycles: number('Cycles'), pitchCurve: $('PitchCurve').value, pitchDepth: number('PitchDepth'), velocityCurve: $('VelocityCurve').value, velocityDepth: number('VelocityDepth'), gateCurve: $('GateCurve').value, gateDepth: number('GateDepth') });
  function revoke() { if (download) URL.revokeObjectURL(download); download = null; }
  function render() {
    if (disposed) return;
    const width = Math.max(300, Math.min(1440, Math.round(canvas.clientWidth * Math.min(devicePixelRatio || 1, 2)))), height = Math.round(width * .44);
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    context.fillStyle = '#080d10'; context.fillRect(0, 0, width, height);
    const duration = Math.max(number('Beats'), processed.durationBeats || 0, ...original.map(n => n.beat + n.duration));
    context.strokeStyle = '#23302f'; context.lineWidth = 1;
    for (let x = 0; x <= 128; x += 12) { context.beginPath(); context.moveTo(x / 128 * width, 0); context.lineTo(x / 128 * width, height); context.stroke(); }
    for (let y = 0; y <= 8; y++) { context.beginPath(); context.moveTo(0, y / 8 * height); context.lineTo(width, y / 8 * height); context.stroke(); }
    const draw = (notes, alpha) => { context.globalAlpha = alpha; for (const n of notes) { context.fillStyle = COLORS[n.layer % COLORS.length]; context.fillRect(n.note / 128 * width, height - (n.beat + n.duration) / duration * height, Math.max(1, width / 128 - .4), Math.max(1, n.duration / duration * height)); } };
    if ($('Ghosts').checked) draw(original, .18);
    draw(processed.notes, .9); context.globalAlpha = 1;
    canvas.dataset.notes = String(processed.notes.length); canvas.dataset.layers = String(layers.length);
  }
  function reflectLayers() {
    $('Layers').replaceChildren();
    for (const [index, layer] of layers.entries()) {
      const row = document.createElement('div'); row.className = 'blech-art-layer'; row.style.setProperty('--art-layer', COLORS[index]);
      const label = document.createElement('label'), toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.checked = layer.enabled; toggle.setAttribute('aria-label', `Include ${layer.name}`);
      label.append(toggle, document.createTextNode(layer.name));
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.setAttribute('aria-label', `Remove ${layer.name}`);
      // Nodes leave with their listeners when a layer is removed or replaced.
      toggle.addEventListener('change', () => { layer.enabled = toggle.checked; update(); });
      remove.addEventListener('click', () => { layers = layers.filter(item => item !== layer); if (imageLayer === layer) { imageLayer = null; raster?.close(); raster = null; } reflectLayers(); update(); });
      row.append(label, remove); $('Layers').append(row);
    }
  }
  function update() {
    if (disposed) return;
    revoke();
    for (const input of host.querySelectorAll('input[type="range"]')) $(`${input.id.slice(3)}Out`).value = String(Number(Number(input.value).toFixed(4)));
    $('ScriptDescription').textContent = ART_SCRIPTS.find(script => script.id === $('Script').value).description;
    try {
      if (number('High') < number('Low')) throw new Error('Highest pitch must be at least Lowest pitch.');
      if (raster && imageLayer) {
        const image = document.createElement('canvas'); image.width = number('Width'); image.height = number('Height');
        const ctx = image.getContext('2d', { willReadFrequently: true }); ctx.imageSmoothingEnabled = false; ctx.drawImage(raster, 0, 0, image.width, image.height);
        imageLayer.notes = imageArtwork(ctx.getImageData(0, 0, image.width, image.height), options()).notes;
      }
      original = layers.flatMap((layer, index) => layer.enabled ? layer.notes.map(note => ({ ...note, layer: index })) : []);
      processed = transformArtwork(original, $('Script').value, options()); error = '';
      const stats = artworkStatistics(processed.notes);
      $('Statistics').value = `${stats.notes.toLocaleString()} notes · peak ${stats.peakPolyphony.toLocaleString()} held · ${Number(processed.durationBeats.toFixed(2))} beats`;
      $('Status').value = '';
    } catch (caught) { error = caught.message; processed = { notes: [], durationBeats: number('Beats') }; $('Statistics').value = 'Adjust the artwork before sending.'; $('Status').value = error; }
    $('Send').disabled = $('Export').disabled = Boolean(error) || !processed.notes.length;
    render();
  }
  function queueUpdate() { if (scheduled === null) scheduled = requestAnimationFrame(() => { scheduled = null; update(); }); }
  function addLayer(name, notes) {
    if (layers.length >= ART_LIMITS.layers) throw new Error('Keep up to eight layers. Remove one before adding another.');
    if (layers.reduce((count, layer) => count + layer.notes.length, notes.length) > ART_LIMITS.notes) throw new Error('Keep artwork within 32,768 notes. Reduce image resolution or remove a layer.');
    const layer = { id: ++serial, name: String(name).slice(0, 80), notes, enabled: true }; layers.push(layer); reflectLayers(); return layer;
  }
  function safely(fn) { try { fn(); } catch (caught) { $('Status').value = caught.message; } }
  on($('Image'), 'change', async () => {
    const file = $('Image').files?.[0], ticket = ++imageTicket; $('Image').value = '';
    if (!file) return;
    let bitmap;
    try {
      if (file.size > ART_LIMITS.imageBytes) throw new Error('Choose an image of 16 MB or less.');
      if (!/^image\/(png|jpeg|webp|gif|bmp)$/.test(file.type)) throw new Error('Choose a PNG, JPEG, WebP, GIF or BMP image.');
      $('Status').value = 'Reading image…';
      bitmap = await createImageBitmap(file, { resizeWidth: 128, resizeHeight: 256, resizeQuality: 'pixelated' });
      if (disposed || ticket !== imageTicket) { bitmap.close(); return; }
      const layer = addLayer(file.name, []); raster?.close(); raster = bitmap; imageLayer = layer; update();
    } catch (caught) { bitmap?.close(); if (!disposed && ticket === imageTicket) $('Status').value = caught.message || 'Could not decode this image.'; }
  });
  on($('UseDrawing'), 'click', () => safely(() => {
    const score = getDrawingScore?.(); if (!score?.buffer) throw new Error('Prepare a drawing above first.');
    addLayer(`Drawing ${serial + 1}`, score.analysis.notes.map(n => ({ note: n.note, beat: n.beat, duration: n.duration, velocity: n.velocity })));
    update();
  }));
  on($('Clear'), 'click', () => { imageTicket++; layers = []; imageLayer = null; raster?.close(); raster = null; $('Script').value = 'none'; reflectLayers(); update(); });
  on($('Ghosts'), 'change', render);
  for (const node of host.querySelectorAll('input[type="range"], #artSeed, #artInvert, #artRetrigger, #artImageVelocity, select')) on(node, node.matches('input[type="range"]') ? 'input' : 'change', queueUpdate);
  on($('Reseed'), 'click', () => { $('Seed').value = String(crypto.getRandomValues(new Uint32Array(1))[0]); update(); });
  const score = () => { update(); if (error) throw new Error(error); return encodeArtwork(processed.notes, { title: `MIDI artwork ${$('Script').selectedOptions[0].textContent}`, tempo: getTempo(), durationBeats: processed.durationBeats }); };
  on($('Send'), 'click', () => safely(() => { const snapshot = score(); onSend(snapshot, { name: `Artwork ${serial || 1}`, program: 'original', loop: $('Loop').checked }); $('Status').value = `${snapshot.analysis.noteCount.toLocaleString()} notes sent to an independent pad.`; }));
  on($('Export'), 'click', () => safely(() => { const snapshot = score(); revoke(); download = URL.createObjectURL(new Blob([snapshot.buffer], { type: 'audio/midi' })); const link = document.createElement('a'); link.href = download; link.download = 'morphazoid-midi-art.mid'; link.click(); $('Status').value = `${snapshot.analysis.noteCount.toLocaleString()} notes exported.`; }));
  const resize = new ResizeObserver(render); resize.observe(canvas); on(host, 'toggle', render);
  const jump = host.ownerDocument.querySelector('a[href="#midiArtCreator"]');
  if (jump) on(jump, 'click', () => { host.open = true; });
  if (location.hash === '#midiArtCreator') host.open = true;
  update();
  return { getScore: score, dispose() { if (disposed) return; disposed = true; imageTicket++; events.abort(); resize.disconnect(); if (scheduled !== null) cancelAnimationFrame(scheduled); raster?.close(); revoke(); layers = []; host.replaceChildren(); } };
}
