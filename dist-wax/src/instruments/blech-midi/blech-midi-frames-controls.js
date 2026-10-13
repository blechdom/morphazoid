import { MidiFrameSequence } from './blech-midi-frames.js';
import { encodeArtwork } from './blech-midi-art.js';
import { drawGeneratorPreview, generatorRange } from './blech-midi-generator-preview.js';
import { mountMixerKnobs } from '../midi-mixer/midi-mixer-knobs.js';

export function mountBlechFrames(host, { getDrawingScore, getTempo = () => 120, onDrop, onPreview, onEditDrawing } = {}) {
  const events = new AbortController(), on = (node, type, fn) => node.addEventListener(type, fn, { signal: events.signal });
  const sequence = new MidiFrameSequence();
  host.innerHTML = `<div class="blech-generator blech-frames">
    <div class="blech-generator-toolbar"><button id="blechFramesCapture" class="mini-action" type="button">Capture drawing</button><button id="blechFramesBlank" class="mini-action" type="button">Add rest</button><button id="blechFramesDrop" class="mini-action" type="button" disabled>Drop sequence</button><label class="blech-generator-check"><input id="blechFramesLoop" type="checkbox" checked>Loop new sequence</label></div>
    <div id="blechFramesList" class="blech-frame-list" role="group" aria-label="Animation frames"></div>
    <div class="blech-generator-toolbar blech-frame-edit"><button id="blechFramesBack" class="mini-action" type="button" aria-label="Move selected frame earlier">← Earlier</button><button id="blechFramesForward" class="mini-action" type="button" aria-label="Move selected frame later">Later →</button><button id="blechFramesDuplicate" class="mini-action" type="button">Duplicate</button><button id="blechFramesDelete" class="mini-action" type="button">Delete</button><button id="blechFramesEdit" class="mini-action" type="button" ${onEditDrawing ? '' : 'hidden'}>Edit drawing</button></div>
    <div class="blech-generator-work"><canvas id="blechFramesPreview" width="800" height="256" aria-label="Prepared animation sequence: pitch left to right, time bottom to top">Capture drawings as successive MIDI frames.</canvas>
    <div class="blech-generator-controls">${generatorRange('blechFrames', 'Beats', 'Beats / frame', .25, 16, .25, 1)}<button id="blechFramesAnimate" class="mini-action" type="button" aria-pressed="false" disabled>Animate preview</button><output id="blechFramesRate"></output></div></div>
    <output id="blechFramesStatistics"></output><output id="blechFramesStatus" role="status"></output>
    <p class="blech-generator-hint">Draw → capture → change the drawing → capture again. Each frame is a saved copy; Drop sends the sequence to its own pad.</p>
    <button id="blechFramesScore" class="mini-action" type="button" ${onPreview ? '' : 'hidden'}>Preview score</button>
  </div>`;
  const $ = key => host.querySelector(`#blechFrames${key}`), canvas = $('Preview');
  let disposed = false, selected = -1, animation = null, lastTime = 0, phase = 0, displayed = -1, animate = false, serial = 0;
  const beats = () => Number($('Beats').value), tempo = () => Math.max(30, Math.min(300, Number(getTempo()) || 120));
  const render = (index = selected) => {
    if (disposed) return;
    drawGeneratorPreview(canvas, sequence.artwork(beats()), { frame: index, frames: sequence.count });
    $('Rate').value = `${Number((tempo() / 60 / beats()).toFixed(2))} frames/s at ${tempo()} BPM`;
  };
  function stopAnimation() {
    animate = false; if (animation !== null) cancelAnimationFrame(animation); animation = null; lastTime = 0;
    $('Animate').setAttribute('aria-pressed', 'false'); $('Animate').textContent = 'Animate preview';
  }
  function tick(now) {
    animation = null;
    if (disposed || !animate || !sequence.count) return;
    if (lastTime) phase += Math.min(.1, (now - lastTime) / 1000) * tempo() / 60 / beats();
    lastTime = now; const index = Math.floor(phase) % sequence.count;
    if (index !== displayed) { displayed = index; render(index); }
    animation = requestAnimationFrame(tick);
  }
  function reflect() {
    if (disposed) return;
    if (!sequence.count) stopAnimation();
    const frames = sequence.frames;
    $('List').replaceChildren();
    for (const [index, frame] of frames.entries()) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'blech-frame-choice';
      button.setAttribute('aria-label', `Frame ${index + 1}: ${frame.name}, ${frame.notes.length} notes`);
      button.setAttribute('aria-pressed', String(index === selected));
      const thumbnail = document.createElement('canvas'); thumbnail.width = 160; thumbnail.height = 52; thumbnail.setAttribute('aria-hidden', 'true');
      const name = document.createElement('span'); name.textContent = `${index + 1} · ${frame.name}`;
      button.append(thumbnail, name); $('List').append(button);
      drawGeneratorPreview(thumbnail, frame);
      button.addEventListener('click', () => { selected = index; phase = index; displayed = -1; reflect(); });
    }
    const empty = selected < 0, noNotes = sequence.noteCount === 0;
    $('Capture').disabled = $('Blank').disabled = $('Duplicate').disabled = sequence.count >= 8;
    $('Duplicate').disabled ||= empty;
    $('Delete').disabled = empty; $('Edit').disabled = empty || !frames[selected]?.notes.length;
    $('Back').disabled = empty || selected === 0; $('Forward').disabled = empty || selected === sequence.count - 1;
    $('Drop').disabled = $('Score').disabled = noNotes; $('Animate').disabled = !sequence.count;
    $('BeatsOut').value = String(beats());
    $('Statistics').value = sequence.count ? `${sequence.count}/8 frames · ${sequence.noteCount.toLocaleString()} notes · ${sequence.count * beats()} beats` : 'No frames yet';
    displayed = -1; render();
  }
  function safely(fn) { try { fn(); $('Status').value = ''; reflect(); } catch (caught) { $('Status').value = caught.message; } }
  function capture(score = getDrawingScore?.(), name = `Drawing ${serial + 1}`) {
    selected = sequence.capture(score, name); serial++; phase = selected; reflect(); return selected;
  }
  on($('Capture'), 'click', () => safely(() => capture()));
  on($('Blank'), 'click', () => safely(() => { selected = sequence.blank(); }));
  on($('Duplicate'), 'click', () => safely(() => { selected = sequence.duplicate(selected); }));
  on($('Delete'), 'click', () => safely(() => { selected = sequence.remove(selected); phase = Math.max(0, selected); }));
  on($('Back'), 'click', () => safely(() => { selected = sequence.move(selected, -1); }));
  on($('Forward'), 'click', () => safely(() => { selected = sequence.move(selected, 1); }));
  on($('Beats'), 'input', () => { lastTime = 0; reflect(); });
  on($('Animate'), 'click', () => {
    if (animate) { stopAnimation(); render(); return; }
    if (!sequence.count) return;
    animate = true; phase = Math.max(0, selected); displayed = -1; lastTime = 0;
    $('Animate').setAttribute('aria-pressed', 'true'); $('Animate').textContent = 'Pause preview'; animation = requestAnimationFrame(tick);
  });
  const getScore = () => sequence.score(beats(), tempo());
  on($('Drop'), 'click', async () => {
    try { const score = getScore(); await onDrop?.(score, { name: `Frames ${sequence.count}`, program: 'original', loop: $('Loop').checked }); if (!disposed) $('Status').value = 'Sequence added to Layers. Pause or Stop it above.'; }
    catch (caught) { if (!disposed) $('Status').value = caught.message; }
  });
  on($('Score'), 'click', async () => { try { await onPreview?.(getScore()); } catch (caught) { if (!disposed) $('Status').value = caught.message; } });
  on($('Edit'), 'click', () => safely(() => { const frame = sequence.frames[selected]; onEditDrawing?.(encodeArtwork(frame.notes, { title: frame.name, durationBeats: frame.durationBeats, tempo: tempo() }), frame.name); }));
  const resize = new ResizeObserver(() => render(animate ? displayed : selected)); resize.observe(canvas);
  reflect(); const knobs = mountMixerKnobs(host);
  return { getScore, capture, dispose() { if (disposed) return; disposed = true; stopAnimation(); events.abort(); resize.disconnect(); knobs.destroy(); sequence.clear(); host.replaceChildren(); } };
}
