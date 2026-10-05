import { NATIVE_METHODS, methodsForVoiceMode } from '../voicesaurus/native-model.js';
import { mountParameters, noteVowelControls } from '../voicesaurus/native-parameters.js';
import { mountSingingTimeline } from '../voicesaurus/native-timeline.js';
import { auditionScene, editableNote, singingNoteCount, singingNoteDescriptors } from '../voicesaurus/native-singing-model.js';
import { materializeVoiceNote, noteVoiceOverrideKeys, setGlobalVoiceParameter, setNoteVoiceInheritance, setNoteVoiceParameter } from '../voicesaurus/voice-settings.js';
import { mountSampleBankSources, mountSampleBankNote } from '../voicesaurus/sample-bank-ui.js';
import { sampleBankRequest } from '../voicesaurus/sample-bank-model.js';
import { textPresetsForEngine, singingSceneFromTextPreset } from '../voicesaurus/text-presets.js';
import { enhanceChooseSelect } from '../../ui/patterns/choose-select.js';
import { createChoiceSwitch } from '../../ui/primitives/choice-switch.js';
import { createVoiceInputState, isVoiceInput, randomizeVoiceMethodState, sanitizeVoiceInputState, voiceModeForInput, voicePresetsForInput } from './voice-input-state.js';
import { VOICE_TECHNIQUE_TEXTS, voiceTextOptions } from './voice-texts.js';
import { VOICE_LOOP_MELODY_PRESETS, VOICE_LOOP_TEXT_CATEGORIES, applyVoiceLoopMelodyPreset, applyVoiceLoopTextPreset, randomizeVoiceLoopLengths, randomizeVoiceLoopPitches, randomizeVoiceLoopText, voiceLoopTextPresets } from './voice-loop-presets.js';

let panelSerial = 0;

/** Native voice editing only. The enclosing instrument owns Audio and transport. */
export function mountVoiceInputPanel(host, { change = () => {}, error = () => {}, audition = () => {}, seek = () => {} } = {}) {
  const doc = host.ownerDocument, prefix = `synthesis-voice-${++panelSerial}`;
  const sessions = new Map(['speech', 'singing'].map(id => [id, createVoiceInputState(id)]));
  const banks = new Map(['speech', 'singing'].map(id => [id, voicePresetsForInput(id)]));
  const lyricDrafts = new Map(), textKinds = new Map(), loopTextChoices = new Map(), loopMelodyChoices = new Map();
  const selections = new Map(), listeners = new AbortController(), persistent = [];
  let sceneListeners = new AbortController();
  let inputId = 'speech', state = sessions.get(inputId), selectedNote = 0, generation = 0, revision = 0;
  let timeline = null, parameters = () => {}, sceneWidgets = [], destroyed = false, idSerial = 0, renderer = null, rendererPromise = null, timings = [];
  let refreshLoopPreset = () => {};
  const melodySignature = voice => JSON.stringify(singingNoteDescriptors(voice.scene).map(({ pitchHz, beats, rest }) => [pitchHz, beats, rest]));
  const make = (tag, className, text) => { const node = doc.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
  const safe = action => { try { const result = action(); if (result?.catch) result.catch(error); } catch (reason) { error(reason); } };
  const listen = (node, type, fn) => node.addEventListener(type, event => safe(() => fn(event)), { signal: listeners.signal });
  const listenScene = (node, type, fn) => node.addEventListener(type, event => safe(() => fn(event)), { signal: sceneListeners.signal });
  const button = (label, text, action, transient = false) => { const node = make('button', '', text); node.type = 'button'; node.setAttribute('aria-label', label); node.title = label; (transient ? listenScene : listen)(node, 'click', action); return node; };
  const nextButton = (label, action) => {
    const node = button(label, '', action), icon = make('span', '', '▶');
    node.className = 'instrument-picker-next'; icon.setAttribute('aria-hidden', 'true'); node.append(icon); return node;
  };
  const option = (label, value) => { const node = make('option', '', label); node.value = value; return node; };
  const field = (label, node) => {
    const root = make('div', 'synthesis-voice-field'), caption = make('label', '', label);
    const control = node.matches('input,select,textarea') ? node : node.querySelector('input,select,textarea');
    if (control?.id) caption.htmlFor = control.id;
    root.append(caption, node); return root;
  };
  host.classList.add('synthesis-voice-input'); host.hidden = true;

  // The reused score/source editors predate multiple instances. Namespace all
  // their generated IDs and relationships, including controls rebuilt in popups.
  function scopeNodes(root) {
    const replacements = new Map();
    for (const node of root.querySelectorAll('[id]')) if (!node.id.startsWith(`${prefix}-`)) {
      const old = node.id; node.id = `${prefix}-${++idSerial}-${old}`; replacements.set(old, node.id);
    }
    for (const node of root.querySelectorAll('[for],[aria-controls],[aria-labelledby],[aria-describedby],[list],[popovertarget]')) {
      for (const attribute of ['for', 'aria-controls', 'aria-labelledby', 'aria-describedby', 'list', 'popovertarget']) {
        const value = node.getAttribute(attribute);
        if (value) node.setAttribute(attribute, value.split(/\s+/).map(id => replacements.get(id) ?? id).join(' '));
      }
    }
    for (const node of root.querySelectorAll('[data-select-id]')) if (replacements.has(node.dataset.selectId)) node.dataset.selectId = replacements.get(node.dataset.selectId);
  }
  const observedPopups = new WeakSet();
  const observer = new MutationObserver(records => {
    scopeNodes(host);
    for (const record of records) {
      const popup = record.target.closest?.('.synthesis-voice-popup');
      if (popup) scopeNodes(popup);
    }
  });
  observer.observe(host, { childList: true, subtree: true });
  function scopePopup(node) {
    const popup = node.closest('.native-note-editor'); if (!popup) return;
    popup.classList.add('synthesis-voice-popup');
    if (!observedPopups.has(popup)) { observedPopups.add(popup); observer.observe(popup, { childList: true, subtree: true }); }
    scopeNodes(popup);
  }

  const axes = make('div', 'synthesis-axis-pair'), method = make('select'), preset = make('select');
  method.id = `${prefix}-method`; method.setAttribute('aria-label', 'Voice method');
  preset.id = `${prefix}-preset`; preset.setAttribute('aria-label', 'Voice preset');
  const methodRow = make('div', 'synthesis-axis-control'), presetRow = make('div', 'synthesis-axis-control');
  methodRow.append(method, nextButton('Next voice method', () => {
    const ids = Object.keys(methodsForVoiceMode(voiceModeForInput(inputId)));
    chooseMethod(ids[(ids.indexOf(state.scene.engine) + 1) % ids.length]);
  }));
  const dice = button('Randomize current voice parameters', '', () => replace(randomizeVoiceMethodState(state, inputId), true, { keepLyricDraft: true }));
  dice.className = 'instrument-picker-next synthesis-parameter-random';
  // Match the shared toolbar's monochrome five-pip dice.
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', width: 18, height: 18, 'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(key, String(value));
  const outline = doc.createElementNS('http://www.w3.org/2000/svg', 'rect');
  for (const [key, value] of Object.entries({ x: 3, y: 3, width: 18, height: 18, rx: 2, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6 })) outline.setAttribute(key, String(value));
  svg.append(outline);
  for (const [cx, cy] of [[7.5, 7.5], [16.5, 7.5], [12, 12], [7.5, 16.5], [16.5, 16.5]]) {
    const pip = doc.createElementNS('http://www.w3.org/2000/svg', 'circle');
    for (const [key, value] of Object.entries({ cx, cy, r: 1.4, fill: 'currentColor' })) pip.setAttribute(key, String(value));
    svg.append(pip);
  }
  dice.append(svg);
  const loopDice = (label, action) => {
    const node = button(label, '', action, true);
    node.className = 'instrument-picker-next synthesis-parameter-random'; node.append(svg.cloneNode(true)); return node;
  };
  const presetActions = make('span', 'synthesis-axis-actions');
  presetActions.append(nextButton('Next voice preset', () => {
    const bank = currentPresets(), index = bank.findIndex(item => item.id === preset.value);
    applyPreset(bank[(index + 1) % bank.length]);
  }), dice);
  presetRow.append(preset, presetActions);
  const methodField = field('Voice', methodRow), methodHeading = make('div', 'synthesis-axis-heading');
  const info = button('About this voice method', 'i', () => {});
  info.className = 'synthesis-info'; info.setAttribute('popovertarget', `${prefix}-info`);
  methodHeading.append(methodField.firstChild, info); methodField.prepend(methodHeading);
  const about = make('section', 'synthesis-info-popup'); about.id = `${prefix}-info`;
  about.setAttribute('popover', 'auto'); about.setAttribute('aria-labelledby', `${prefix}-info-title`);
  axes.append(methodField, field('Voice preset', presetRow)); host.append(axes, about);
  const methodPicker = enhanceChooseSelect(method, { label: 'Voice method' });
  const presetPicker = enhanceChooseSelect(preset, { label: 'Voice preset' }); persistent.push(methodPicker, presetPicker);
  const inputHost = make('div', 'synthesis-voice-text'), bankHost = make('div', 'native-bank-controls');
  const loopHost = make('div', 'synthesis-voice-loop'), scoreHost = make('div', 'synthesis-voice-score'), globalHost = make('div', 'synthesis-voice-parameters');
  const globalLabel = make('p', 'native-selection-label', 'Global voice');
  host.append(inputHost, bankHost, loopHost, scoreHost, globalLabel, globalHost);
  const bankSources = mountSampleBankSources(bankHost, { getScene: () => state.scene, error,
    change: () => { timeline?.refresh(); edited(); } });
  persistent.push(bankSources);

  function currentPresets() { return banks.get(inputId).filter(item => item.state.scene.engine === state.scene.engine); }
  function refreshPresets() {
    const bank = currentPresets(), signature = JSON.stringify(state);
    const suffix = ` · ${NATIVE_METHODS[state.scene.engine].name}`;
    preset.replaceChildren(option('Custom settings', ''), ...bank.map(item => option(item.label.endsWith(suffix) ? item.label.slice(0, -suffix.length) : item.label, item.id)));
    preset.value = bank.find(item => JSON.stringify(item.state) === signature)?.id ?? ''; presetPicker.refresh();
  }
  function edited() {
    revision++; sessions.set(inputId, state); bankSources.refresh(); refreshPresets(); refreshLoopPreset(); parameters.refresh?.();
    change(structuredClone(state));
  }
  function clearEditor() {
    about.hidePopover?.();
    generation++; timeline?.destroy(); timeline = null; parameters(); parameters = () => {}; refreshLoopPreset = () => {};
    sceneListeners.abort(); sceneListeners = new AbortController();
    observer.disconnect(); if (!destroyed) observer.observe(host, { childList: true, subtree: true });
    sceneWidgets.splice(0).forEach(widget => widget.destroy()); inputHost.replaceChildren(); loopHost.replaceChildren(); scoreHost.replaceChildren();
  }
  function replace(next, notify = false, { keepLyricDraft = false, keepSelection = false } = {}) {
    if (inputId === 'singing' && !keepLyricDraft) lyricDrafts.delete(`${inputId}:${next.scene.engine}`);
    state = next; sessions.set(inputId, state);
    selectedNote = keepSelection && inputId === 'singing' ? Math.min(selectedNote, singingNoteCount(state.scene) - 1) : 0;
    selections.set(inputId, selectedNote); revision++; timings = []; render();
    if (notify) change(structuredClone(state));
  }
  function chooseMethod(engine) {
    const factory = banks.get(inputId).find(item => item.state.scene.engine === engine);
    replace(structuredClone(factory.state), true);
  }
  function applyPreset(item) { if (item) replace(structuredClone(item.state), true); }
  listen(method, 'change', () => chooseMethod(method.value));
  listen(preset, 'change', () => applyPreset(currentPresets().find(item => item.id === preset.value)));

  function parameterEditor(target, controls, values, commit, options = {}) {
    // Enumerated numeric chip registers are menus here, retaining native types.
    const presentation = Object.fromEntries(Object.entries(controls).map(([key, rule]) => [key,
      rule.choices?.every(value => typeof value === 'number') ? { ...rule, choices: rule.choices.map(String) } : rule]));
    return mountParameters(target, presentation, values, (key, value) => {
      const rule = controls[key];
      const native = rule.choices && !rule.freeText ? rule.choices.find(choice => String(choice) === String(value)) : value;
      safe(() => commit(key, native));
    }, { idPrefix: `${prefix}-global`, ...options });
  }

  function mountText(spec) {
    const singing = inputId === 'singing', letters = spec.mode === 'native-letters';
    const draftKey = `${inputId}:${state.scene.engine}`;
    const technique = VOICE_TECHNIQUE_TEXTS[state.scene.engine];
    const heading = make('h2', '', spec.name); heading.id = `${prefix}-info-title`;
    about.replaceChildren(heading, make('p', '', technique.text));
    const sources = make('p', 'synthesis-voice-sources');
    for (const source of technique.sources) {
      const link = make('a', '', source.label); link.href = source.url;
      link.target = '_blank'; link.rel = 'noopener noreferrer'; sources.append(link);
    }
    about.append(sources);
    if (!singing && !letters && spec.mode !== 'text') {
      inputHost.append(make('p', 'synthesis-voice-hint', 'This chip uses parameter frames, not a text frontend. Edit pitch, formants and note length below.')); return;
    }
    const words = make('textarea'); words.id = `${prefix}-text`; words.maxLength = 1000; words.rows = 2;
    if (singing) words.value = lyricDrafts.get(draftKey) ?? state.scene.input.singingText ?? '';
    else words.value = letters ? state.scene.input.phones ?? state.scene.input.text ?? '' : state.text;
    const label = singing ? state.scene.engine === 'sinsy' ? 'Japanese lyrics · kana or romaji' : 'Lyrics' : letters ? 'Native sounds' : 'Text';
    const textField = field(label, words);
    words.setAttribute('aria-label', label); inputHost.append(textField);
    const textControls = singing ? make('div', 'synthesis-axis-pair synthesis-voice-text-controls') : null;
    if (textControls) inputHost.insertBefore(textControls, textField);
    let encoding;
    if (letters) {
      words.removeAttribute('maxlength');
      encoding = createChoiceSwitch({ label: 'Input mode', compact: true, choices: [{ value: 'text', label: 'Letter mapping' }, { value: 'phones', label: 'Phonetic symbols' }],
        value: state.scene.input.mode ?? 'text', onChange: value => { state.scene.input = { mode: value, [value === 'phones' ? 'phones' : 'text']: words.value }; edited(); } });
      inputHost.append(encoding); sceneWidgets.push(encoding);
    }
    const status = make('output', 'synthesis-voice-status'); status.setAttribute('role', 'status');
    const apply = singing ? button('Apply lyrics to notes', 'Apply lyrics', () => convert(), true) : null;
    if (apply) {
      apply.title = 'Apply lyrics to notes (Ctrl/⌘ + Enter)';
      words.setAttribute('aria-keyshortcuts', 'Control+Enter Meta+Enter');
      inputHost.append(apply);
    }
    inputHost.append(status);
    let textSerial = 0, refreshTextPreset = () => {};
    const markText = () => { textSerial++; if (apply) apply.disabled = false; status.textContent = ''; refreshTextPreset(); };
    async function convert(textPreset) {
      const token = ++textSerial, pendingGeneration = generation, pendingRevision = revision, original = state;
      apply.disabled = true; status.textContent = 'Preparing notes…';
      try {
        const { singingSceneFromText } = await import('../voicesaurus/singing-text.js');
        const result = textPreset?.contour ? await singingSceneFromTextPreset(original.scene, textPreset) : await singingSceneFromText(original.scene, words.value);
        if (destroyed || token !== textSerial || pendingGeneration !== generation || state !== original) return;
        if (pendingRevision !== revision) { status.textContent = 'The score changed. Apply the lyrics again.'; return; }
        replace({ ...state, text: words.value, scene: result.scene }, true);
        inputHost.querySelector('output').textContent = result.warnings.join(' ');
      } catch (reason) { if (!destroyed && pendingGeneration === generation && token === textSerial) { status.textContent = reason.message; error(reason); } }
      finally { if (!destroyed && pendingGeneration === generation && token === textSerial) apply.disabled = false; }
    }
    listenScene(words, 'input', () => {
      markText();
      if (singing) { lyricDrafts.set(draftKey, words.value); return; }
      if (letters) { const mode = encoding.value; state.scene.input = { mode, [mode === 'phones' ? 'phones' : 'text']: words.value }; }
      else state.text = words.value;
      edited();
    });
    if (singing) listenScene(words, 'keydown', event => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing) { event.preventDefault(); return convert(); }
    });
    const loopTexts = singing ? voiceLoopTextPresets(state.scene.engine) : [];
    const texts = [...voiceTextOptions(state.scene.engine),
      ...textPresetsForEngine(state.scene.engine, { textCapable: singing || spec.mode === 'text' })];
    if (texts.length || loopTexts.length) {
      const select = make('select'); select.id = `${prefix}-text-preset`; select.setAttribute('aria-label', 'Text preset');
      select.append(option('Choose text', ''));
      for (const category of VOICE_LOOP_TEXT_CATEGORIES) {
        const entries = loopTexts.filter(item => item.category === category.id); if (!entries.length) continue;
        const group = make('optgroup'); group.label = category.label;
        group.append(...entries.map(item => option(item.label, item.id))); select.append(group);
      }
      if (singing) {
        const group = make('optgroup'); group.label = 'More text and phrases';
        group.append(...texts.map(item => option(item.label, item.id))); select.append(group);
      } else select.append(...texts.map(item => option(item.label, item.id)));
      const presetField = field('Text preset', select);
      if (textControls) textControls.append(presetField); else inputHost.insertBefore(presetField, textField);
      const picker = enhanceChooseSelect(select, { label: 'Text preset' }); sceneWidgets.push(picker);
      refreshTextPreset = () => {
        const loopChoice = loopTextChoices.get(draftKey);
        select.value = loopChoice?.text === words.value ? loopChoice.id : texts.find(item => item.text === words.value)?.id ?? '';
        picker.refresh();
      };
      refreshTextPreset();
      listenScene(select, 'change', () => {
        const loopText = loopTexts.find(item => item.id === select.value);
        if (loopText) {
          const next = applyVoiceLoopTextPreset(state, loopText.id);
          textKinds.set(draftKey, loopText.category);
          loopTextChoices.set(draftKey, { id: loopText.id, text: next.text });
          return replace(next, true);
        }
        const chosen = texts.find(item => item.id === select.value); if (!chosen) return;
        words.value = chosen.text; markText();
        if (singing) { lyricDrafts.set(draftKey, words.value); return convert(chosen); }
        state.text = chosen.text;
        if (letters) { state.scene.input = { ...state.scene.input, mode: 'text', text: chosen.text }; delete state.scene.input.phones; encoding.setValue('text'); }
        edited();
      });
    }
    if (singing) {
      const kind = make('select'); kind.id = `${prefix}-text-kind`; kind.setAttribute('aria-label', 'Random text style');
      const categories = VOICE_LOOP_TEXT_CATEGORIES.filter(category => loopTexts.some(item => item.category === category.id));
      kind.append(...categories.map(category => option(category.label, category.id)));
      kind.value = categories.some(category => category.id === textKinds.get(draftKey)) ? textKinds.get(draftKey) : 'words';
      const row = make('div', 'synthesis-axis-control');
      row.append(kind, loopDice('Randomize loop text', () => {
        const next = randomizeVoiceLoopText(state, kind.value); loopTextChoices.delete(draftKey); replace(next, true);
      }));
      textControls.append(field('Random text style', row));
      sceneWidgets.push(enhanceChooseSelect(kind, { label: 'Random text style' }));
      listenScene(kind, 'change', () => textKinds.set(draftKey, kind.value));
    }
  }

  function mountLoopControls() {
    const key = `${inputId}:${state.scene.engine}`;
    const select = make('select'); select.id = `${prefix}-melody-preset`; select.setAttribute('aria-label', 'Melody preset');
    select.append(option('Choose pitches + lengths', ''), ...VOICE_LOOP_MELODY_PRESETS.map(item => option(item.label, item.id)));
    loopHost.append(field('Melody preset', select));
    const picker = enhanceChooseSelect(select, { label: 'Melody preset' }); sceneWidgets.push(picker);
    refreshLoopPreset = () => {
      const chosen = loopMelodyChoices.get(key);
      select.value = chosen?.signature === melodySignature(state) ? chosen.id : ''; picker.refresh();
    };
    refreshLoopPreset();
    const apply = next => replace(next, true, { keepLyricDraft: true, keepSelection: true });
    listenScene(select, 'change', () => {
      if (!select.value) return;
      const next = applyVoiceLoopMelodyPreset(state, select.value);
      loopMelodyChoices.set(key, { id: select.value, signature: melodySignature(next) }); apply(next);
    });
    const actions = make('div', 'synthesis-voice-loop-actions');
    for (const [label, action] of [['Pitches', randomizeVoiceLoopPitches], ['Note lengths', randomizeVoiceLoopLengths]]) {
      const caption = make('span', '', label), control = loopDice(`Randomize ${label.toLowerCase()}`, () => {
        const next = action(state); loopMelodyChoices.delete(key); apply(next);
      });
      const group = make('div', 'synthesis-voice-loop-action'); group.append(caption, control); actions.append(group);
    }
    loopHost.append(actions);
  }

  function render() {
    clearEditor();
    const spec = NATIVE_METHODS[state.scene.engine], singing = inputId === 'singing';
    host.dataset.voiceInput = inputId;
    method.replaceChildren(...Object.entries(methodsForVoiceMode(voiceModeForInput(inputId))).map(([id, entry]) => {
      const item = option(`${entry.name} · ${entry.year}`, id);
      item.title = entry.date; return item;
    }));
    method.value = state.scene.engine; methodPicker.refresh(); refreshPresets(); mountText(spec); bankSources.refresh();
    globalLabel.hidden = !singing; globalLabel.textContent = state.scene.engine === 'sinsy' ? 'Global voice · whole score' : 'Global voice · notes can override';
    const controls = Object.fromEntries(Object.entries(spec.controls).filter(([key]) => !(singing && ['pitch', 'duration'].includes(key))));
    parameters = parameterEditor(globalHost, controls, state.scene.values, (key, value) => { setGlobalVoiceParameter(state.scene, key, value); timeline?.refresh(); edited(); });
    scoreHost.hidden = !singing;
    if (singing) mountLoopControls();
    if (singing) timeline = mountSingingTimeline(scoreHost, state.scene, { spec, initialSelection: selectedNote, error,
      change: edited, select: index => { selectedNote = index; selections.set(inputId, index); parameters.refresh?.(); },
      audition: index => safe(() => { const scene = auditionScene(state.scene, index); return audition({ ...scene, text: state.text }); }),
      seek: beat => safe(() => seek(beat)),
      mountNoteSound: (target, index) => {
        scopePopup(target);
        return state.scene.engine === 'sample-bank' ? mountSampleBankNote(target, editableNote(state.scene, index), {
          aliases: bankSources.aliases(), getNote: () => materializeVoiceNote(state.scene, index), change: () => { timeline?.refresh(); edited(); },
        }) : () => {};
      },
      mountNoteParameters: (target, index) => {
        const vowel = noteVowelControls(state.scene.engine, controls);
        const noteControls = Object.fromEntries(Object.entries(controls).map(([key, rule]) => [key, vowel[key] ?? rule]));
        const cleanup = parameterEditor(target, noteControls, editableNote(state.scene, index).values, (key, value) => {
          setNoteVoiceParameter(state.scene, index, key, value); timeline?.refresh(); edited();
        }, { idPrefix: `${prefix}-note-${index}`, getValues: () => editableNote(state.scene, index).values,
          inheritance: { overridden: key => noteVoiceOverrideKeys(state.scene, index).includes(key), set: (key, inherit) => {
            setNoteVoiceInheritance(state.scene, index, key, inherit); timeline?.refresh(); edited();
          } } });
        scopePopup(target); return cleanup;
      },
    });
    scopeNodes(host);
  }

  return {
    setInput(id) {
      if (destroyed) return;
      if (!isVoiceInput(id)) { host.hidden = true; clearEditor(); return; }
      if (id === inputId && !host.hidden) return;
      sessions.set(inputId, state); selections.set(inputId, selectedNote);
      inputId = id; state = sessions.get(id); selectedNote = selections.get(id) ?? 0;
      host.hidden = false; render();
    },
    getState: () => structuredClone(state),
    get revision() { return revision; },
    applyState(value) { if (!destroyed) replace(sanitizeVoiceInputState(value, inputId)); },
    progress(position, nextTimings, playing) { timings = nextTimings ?? []; timeline?.progress(position, timings, playing); },
    async renderSampleBank(request, { signal } = {}) {
      const bank = bankSources.getBank();
      if (!rendererPromise) rendererPromise = import('../../families/speech/sample-bank-renderer.js').then(({ createSampleBankRenderer }) => {
        if (destroyed) throw Object.assign(new Error('Voice panel closed.'), { name: 'AbortError' });
        renderer = createSampleBankRenderer(); return renderer;
      }).catch(reason => { rendererPromise = null; throw reason; });
      const engine = await rendererPromise;
      if (destroyed || signal?.aborted) throw Object.assign(new Error('Voice render cancelled.'), { name: 'AbortError' });
      const result = await engine.render(sampleBankRequest(request, bank), { signal });
      if (!destroyed && bank === bankSources.getBank()) bankSources.report(result);
      return result;
    },
    destroy() {
      if (destroyed) return; destroyed = true; clearEditor(); listeners.abort(); observer.disconnect();
      persistent.forEach(widget => widget.destroy()); renderer?.close(); host.replaceChildren(); host.classList.remove('synthesis-voice-input');
    },
  };
}
