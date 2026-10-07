// Text ingredients stay independent of voice character and full-scene presets.
// Sayings are fiction; factual lines are sourced in SPIDER_SYNTH_RESEARCH.md.
export const SPIDER_TEXT_PRESETS = Object.freeze([
  { id: 'my-name-is-spider', group: 'Sayings', label: 'My name is spider', text: 'i am a spider. My name is spider. I like to crawl on your face when you are sleeping.' },
  { id: 'before-the-light', group: 'Sayings', label: 'Before the light', text: 'I was here before you turned on the light.' },
  { id: 'every-thread', group: 'Sayings', label: 'Every thread', text: 'Every thread tells me where you are.' },
  { id: 'counting-eyelashes', group: 'Sayings', label: 'Counting eyelashes', text: 'Sleep gently. I am counting your eyelashes.' },
  { id: 'pillow-door', group: 'Sayings', label: 'Behind your pillow', text: 'There is a little door behind your pillow. It belongs to me.' },
  { id: 'eight-dirty-feet', group: 'Sayings', label: 'Eight dirty feet', text: 'I have eight feet, and I never wipe them.' },
  { id: 'ceiling-floor', group: 'Sayings', label: 'The ceiling is my floor', text: 'The ceiling is my floor. Your shadow is my hiding place.' },
  { id: 'do-not-dust', group: 'Sayings', label: 'Please do not dust', text: 'Please do not dust. You are destroying my architecture.' },
  { id: 'dinner-guest', group: 'Sayings', label: 'Dinner guest', text: 'The fly came for dinner. The fly was dinner.' },
  { id: 'arriving-on-silk', group: 'Sayings', label: 'I do not knock', text: 'I do not knock. I arrive on a thread.' },
  { id: 'eight-legs', group: 'Spider facts', label: 'Eight legs', text: 'Spiders have eight legs. Insects have six.' },
  { id: 'hunting-without-webs', group: 'Spider facts', label: 'Hunting without webs', text: 'Not all spiders catch their prey in webs.' },
  { id: 'silk-glands', group: 'Spider facts', label: 'Where silk comes from', text: 'Spiders make silk in glands inside their bodies and draw it out through spinnerets.' },
  { id: 'ballooning', group: 'Spider facts', label: 'Travelling on silk', text: 'Some spiders travel through the air on strands of silk.' },
  { id: 'recycled-webs', group: 'Spider facts', label: 'Recycling the web', text: 'Many orb weavers eat their old webs and recycle the silk.' },
  { id: 'web-vibrations', group: 'Spider facts', label: 'Listening through silk', text: 'Vibrations in a web tell a spider that something has touched its silk.' },
].map(Object.freeze));

// Fictional spider characters, rendered by Voicesaurus's real eSpeak NG WASM.
// Whole-sentence native prosody; no sampled-phone joins or browser TTS.
export const SPIDER_SPEECH_PRESETS = Object.freeze([
  { id: 'silk-buzz', label: 'Silk buzz', engine: 'espeak', variant: 'croak', rate: 215, pitch: 50, range: 20, volume: 80, gain: 3 },
  { id: 'silk-whisper', label: 'Silk whisper', engine: 'espeak', variant: 'whisperf', rate: 215, pitch: 42, range: 20, volume: 90, gain: 2.5 },
  { id: 'fang-chatter', label: 'Fang chatter', engine: 'espeak', variant: 'croak', rate: 245, pitch: 30, range: 18, volume: 80, gain: 3 },
  { id: 'cellar-rasp', label: 'Cellar rasp', engine: 'espeak-klatt', variant: 'robosoft3', rate: 190, pitch: 22, range: 12, volume: 35, gain: 8 },
].map(Object.freeze));
export const SPIDER_SPEECH_DEFAULTS = Object.freeze({ preset: 'silk-buzz', rate: 215, pitch: 50, range: 20 });
export const SPIDER_SPEECH_CONTROLS = Object.freeze([
  { key: 'rate', name: 'Rate', min: 80, max: 450, step: 1 },
  { key: 'pitch', name: 'Pitch', min: 0, max: 99, step: 1 },
  { key: 'range', name: 'Inflection', min: 0, max: 99, step: 1 },
]);
export function spiderSpeechRequest(text, settings = SPIDER_SPEECH_DEFAULTS) {
  const preset = SPIDER_SPEECH_PRESETS.find(item => item.id === settings.preset) ?? SPIDER_SPEECH_PRESETS[0];
  const values = { language: 'en-gb', variant: preset.variant, volume: preset.volume };
  for (const { key } of SPIDER_SPEECH_CONTROLS) values[key] = Number.isFinite(settings[key]) ? settings[key] : preset[key];
  return { engine: preset.engine, text: String(text ?? '').trim().slice(0, 96), input: {}, values };
}
export function createSpiderSpeechRender(text, settings, runtime = globalThis) {
  const request = spiderSpeechRequest(text, settings);
  const preset = SPIDER_SPEECH_PRESETS.find(item => item.id === settings?.preset) ?? SPIDER_SPEECH_PRESETS[0];
  const worker = new runtime.Worker(new URL('../voicesaurus/native-worker.js', import.meta.url), { type: 'module' });
  let settled = false, timer, finish;
  const promise = new Promise((resolve, reject) => {
    finish = (error, result) => {
      if (settled) return;
      settled = true; clearTimeout(timer); worker.onmessage = null; worker.onerror = null; worker.terminate();
      if (error) reject(error); else resolve(result);
    };
    worker.onerror = event => finish(new Error(event.message || 'The voice worker could not load.'));
    worker.onmessage = ({ data }) => {
      if (data?.type === 'error') { finish(new Error(data.message || 'Native speech failed.')); return; }
      if (data?.type !== 'ready') return;
      const { samples, sampleRate } = data;
      if (!(samples instanceof Float32Array) || !Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000
        || !samples.length || samples.length > sampleRate * 30) {
        finish(new Error('The voice exceeded its 30-second audio budget.')); return;
      }
      // Validate off the audio thread. The worklet adopts this buffer directly.
      for (const sample of samples) if (!Number.isFinite(sample) || Math.abs(sample) > 1) {
        finish(new Error('The voice returned invalid audio.')); return;
      }
      finish(null, { samples, sampleRate, gain: preset.gain });
    };
    timer = setTimeout(() => finish(new Error('The voice took too long to render.')), 20000);
    try { worker.postMessage(request); } catch (error) { finish(error); }
  });
  return { promise, cancel: () => finish(Object.assign(new Error('Speech cancelled.'), { name: 'AbortError' })) };
}
