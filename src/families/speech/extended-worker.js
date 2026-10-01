import { SPELLING_DIPHONE_CLIPS as metadata } from '../../instruments/spelling-synthesizer/spelling-diphone-atlas.js';
import { nativeValues, EXTENDED_ENGINES } from './extended-engines.js';
import { sustainPoints } from './vowel-loop.js';

async function render(engine, parameters) {
  if (!EXTENDED_ENGINES[engine]) throw new Error('Unknown speech engine.');
  const p = nativeValues(engine, parameters);
  if (engine === 'hts') {
    const {createHts} = await import('./hts-runtime.js');
    const {renderHtsAtlas} = await import('./hts-atlas.js');
    const voice = await createHts();
    try { return renderHtsAtlas(voice,{metadata,speed:p.rate,semitones:p.pitch,beta:p.tilt,gvWeight:p.bandwidth,voicingThreshold:p.breath}); }
    finally { voice._hts_close(); }
  }
  if (engine === 'gnuspeech') {
    const {createGnuspeech} = await import('./gnuspeech-runtime.js');
    const {renderGnuspeechAtlas} = await import('./gnuspeech-atlas.js');
    return renderGnuspeechAtlas(await createGnuspeech(), {voice:p.character, pitchSemitones:p.pitch,
      tractLength:p.formant, breathiness:p.breath, nasalRadius:p.nasal, pulseRise:p.rise, pulseFall:p.fall, tempo:p.rate});
  }
  if (engine === 'pico') {
    const {createPico} = await import('./pico-runtime.js');
    const {renderPicoAtlas} = await import('./pico-atlas.js');
    const voice = await createPico({language:p.character});
    try { return renderPicoAtlas(voice, {pitch:p.pitch, speed:p.rate}); }
    finally { voice.dispose(); }
  }
  if (engine === 'vizsn') {
    const {createVizsn} = await import('./vizsn-runtime.js');
    const {renderVizsnAtlas} = await import('./vizsn-atlas.js');
    return renderVizsnAtlas(await createVizsn(), {metadata, pitchHz:p.pitch, voiceType:p.character});
  }
  if (engine === 'mea8000') {
    const {createMea8000} = await import('./mea8000-runtime.js');
    const {renderMea8000Atlas} = await import('./mea8000-atlas.js');
    return renderMea8000Atlas(await createMea8000(), {metadata, pitchHz:p.pitch, formantScale:p.formant, bandwidth:p.bandwidth, durationMs:p.rate});
  }
  if (engine.startsWith('csound-')) {
    const {renderCsoundAtlas} = await import('./csound-voices.js');
    const response = await fetch(new URL('../../../vendor/csound/csound.wasm', import.meta.url));
    if (!response.ok) throw new Error('Csound could not be loaded.');
    const module = await WebAssembly.compile(await response.arrayBuffer());
    return renderCsoundAtlas(module, {method:engine.slice(7), pitch:p.pitch, formantScale:p.formant,
      bandwidth:p.bandwidth, breath:p.breath, vibrato:p.vibrato, pulseCount:p.pulses, decay:p.decay});
  }
  const {createMusicalGestureRenderer} = await import('../../../vendor/musical-voices/musical-gestures.js');
  const generate = await createMusicalGestureRenderer();
  const clips = {}, pieces = []; let length = 0, sampleRate = 44100;
  for (const [key, meta] of Object.entries(metadata)) {
    const result = generate(key, {method:engine === 'singer' ? 'singer' : 'stk', pitch:p.pitch,
      noise:p.breath, vibrato:p.vibrato, vibratoRate:p.vibratoRate, jitter:p.jitter, transition:engine === 'singer' ? Math.exp(-1/(p.transition*22050)) : 1/(p.transition*22050),
      ...(engine === 'singer' ? {glottis:p.character, tractScale:p.formant, velum:p.nasal === 'original' ? -1 : p.nasal} : {formantScale:p.formant, tilt:p.tilt, glide:p.rate})});
    sampleRate = result.sampleRate;
    const {samples} = result;
    clips[key] = {...meta, offset:length / sampleRate, duration:samples.length / sampleRate, gain:1,
      ...(meta.kind === 'vowel' ? sustainPoints(samples,sampleRate) : {sustainStart:0,sustainEnd:0})};
    pieces.push({samples, offset:length}); length += samples.length + Math.round(sampleRate * .012);
  }
  const samples = new Float32Array(length);
  for (const piece of pieces) samples.set(piece.samples,piece.offset);
  return {samples,sampleRate,clips};
}

// One bounded render per worker; the owner terminates it on success or cancel.
let started = false;
self.onmessage = async ({data}) => {
  if (started || data?.type !== 'render') return;
  started = true;
  try {
    const result = await render(data.engine, data.parameters);
    self.postMessage({type:'ready', ...result}, [result.samples.buffer]);
  } catch (error) { self.postMessage({type:'error',message:error.message || String(error)}); }
};
