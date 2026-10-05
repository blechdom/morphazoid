import { METHODS, SYNTHESIS_METHODS, PROCESSOR_METHODS } from './catalog.js';
import { SYNTHESIS_DATES } from './chronology.js';
import { SEQUENCE_STUDIES } from './sequence-catalog.js';
import { getSequenceParameterDefinitions } from './sequence-parameters.js';
import { TUNINGS } from './tunings.js';
import { getAmplitudeModel } from './amplitude-models.js';
import { PERCUSSION_METHODS } from './percussion-state.js';

// These are gaps in this instrument, not a claim that broad parent families
// are missing, nor that other Morphazoid instruments do not demonstrate them.
export const SYNTHESIS_COVERAGE_GAPS = Object.freeze([
  {
    id: 'articulatory-tract', label: 'Articulatory vocal-tract synthesis',
    description: 'Model a changing chain of acoustic tubes, with wave scattering at area changes, to connect vocal-tract shape with resonances.',
    gap: 'The existing formant voice prescribes resonances and the waveguide demonstrates a different exciter/resonator. Neither exposes a vocal-tract area function, constrictions, nasal coupling or phoneme gestures.',
    related: ['formant-voice', 'waveguide', 'lpc'],
    source: { label: 'Julius O. Smith, Kelly–Lochbaum scattering junctions', url: 'https://www.dsprelated.com/freebooks/pasp/Kelly_Lochbaum_Scattering_Junctions.html' },
  },
  {
    id: 'spectral-modeling', label: 'Spectral modeling synthesis (SMS)',
    description: 'Analyze a recording into tracked sinusoidal components and a separately modeled noisy residual, then transform and reconstruct those parts.',
    gap: 'Additive oscillators, a phase vocoder and the DDSP teaching controller are present. A source-derived sinusoidal-track plus residual decomposition is missing. Serra’s 1989 thesis and the 1990 Serra–Smith paper are documented milestones.',
    related: ['additive', 'phase-vocoder', 'ddsp'],
    source: { label: 'UPF Music Technology Group, SMS Tools and original publications', url: 'https://www.upf.edu/web/mtg/sms-tools' },
  },
  {
    id: 'psola', label: 'Pitch-synchronous overlap-add (PSOLA)',
    description: 'Cut and overlap sound around detected pitch epochs, changing pitch and duration through the placement of those source periods.',
    gap: 'The granular and sampling methods have no pitch-mark analysis or pitch-synchronous reconstruction. Arbitrary overlapping grains are not PSOLA. Charpentier and Moulines describe this family in their 1989 paper.',
    related: ['sampling', 'granular'],
    source: { label: 'Charpentier & Moulines, pitch-synchronous waveform processing (1989)', url: 'https://www.isca-archive.org/eurospeech_1989/charpentier89_eurospeech.html' },
  },
  {
    id: 'paf', label: 'Phase-aligned formant synthesis (PAF)',
    description: 'Combine a waveshaped pulse with phase-aligned carriers so formant center and bandwidth can move independently while multiple formants add predictably.',
    gap: 'FOF, VOSIM and windowed formants are related spectral-building methods. The specific PAF carrier construction and phase-coherent update rule are absent.',
    related: ['fof', 'vosim', 'window-formant'],
    source: { label: 'Miller Puckette, phase-aligned formant generator', url: 'https://msp.ucsd.edu/techniques/v0.07/book-html/node88.html' },
  },
  {
    id: 'wavesets', label: 'Waveset resynthesis',
    description: 'Extract pseudo-cycles at zero crossings in a source recording, then repeat, reverse, reorder or interpolate groups of those cycles.',
    gap: 'The waveform-segment method constructs a cycle from parameters. It does not extract irregular source wavesets or expose their group operations; those cycles need not match the perceived fundamental.',
    related: ['waveform-segment', 'sampling'],
    source: { label: 'Composers Desktop Project, waveset functions and definitions', url: 'https://www.composersdesktop.com/docs/html/cdistort.htm' },
  },
  {
    id: 'pca-envelope', label: 'Principal-component harmonic-envelope synthesis',
    description: 'Learn a small linear basis from measured harmonic-amplitude envelopes, then reconstruct and vary a sound using the basis weights.',
    gap: 'The additive bank has hand-set partials and the latent model uses a neural decoder. Neither learns or exposes the linear principal-component representation described by Laughlin, Truax and Funt in 1990.',
    related: ['additive', 'neural-latent'],
    source: { label: 'Laughlin, Truax & Funt, harmonic envelopes and principal components (1990)', url: 'https://www.cs.sfu.ca/~funt/LaughlinTruaxFunt1990.pdf' },
  },
  {
    id: 'cellular-audio', label: 'Cellular-automaton sound synthesis',
    description: 'Let neighboring cells update by local rules, using their changing states as audio samples or as the amplitudes of a sound-generating bank.',
    gap: 'There is no cellular rule, neighborhood or cell-state audio mapping in the current catalogue. A cellular automaton that only chooses notes would be a sequencing technique instead. Comajuncosas’s 1998 implementation provides a concrete additive example, not a claim to the family’s invention.',
    related: ['additive', 'scanned', 'stochastic'],
    source: { label: 'Josep M. Comajuncosas, Cellular Orchestras (1998)', url: 'https://csoundjournal.com/ezine/winter1999/synthesis/index.html' },
  },
  {
    id: 'iterated-maps', label: 'Discrete iterated-map synthesis',
    description: 'Read the state of a repeated nonlinear recurrence as sound, varying its feedback law, initial state and iteration clock.',
    gap: 'Rössler synthesis integrates a continuous differential system. Discrete logistic, Hénon or related map generators are a different missing mechanism; the mathematics of a map alone does not date its first musical use.',
    related: ['rossler', 'stochastic'],
    source: { label: 'SuperCollider, Logistic audio generator and recurrence', url: 'https://docs.supercollider.online/Classes/Logistic.html' },
  },
  {
    id: 'wave-digital', label: 'Wave-digital circuit modeling',
    description: 'Model a circuit through wave variables and scattering connections between elements, retaining their stored energy and interaction.',
    gap: 'A nonlinear ladder filter or memoryless waveshaper is not automatically a wave-digital circuit. This catalogue lacks an explicit wave-digital component network. This is an implementation/modeling approach within physical and circuit synthesis, not a new oscillator family.',
    related: ['physical', 'fx-ladder', 'antiderivative-waveshaping'],
    source: { label: 'Julius O. Smith, wave digital filters', url: 'https://www.dsprelated.com/freebooks/pasp/Wave_Digital_Filters.html' },
  },
].map(item => Object.freeze({ ...item, related: Object.freeze(item.related), source: Object.freeze(item.source) })));

const textElement = (tag, text, className = '') => {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
};

const heading = (body, title) => body.append(textElement('h4', title));
const paragraph = (body, text, className = '') => {
  if (text) body.append(textElement('p', text, className));
};

const link = (label, url) => {
  const element = textElement('a', label);
  element.href = url;
  return element;
};

function sourcesList(body, sources) {
  const unique = [...new Map(sources.filter(source => source?.url).map(source => [source.url, source])).values()];
  if (!unique.length) return;
  heading(body, 'Sources');
  const list = textElement('ul', '', 'reference-source-list');
  for (const source of unique) {
    const item = document.createElement('li');
    item.append(link(source.label, source.url));
    if (source.limitation) paragraph(item, source.limitation, 'reference-source-note');
    list.append(item);
  }
  body.append(list);
}

function entry(container, id, title, date = '') {
  const details = textElement('details', '', 'reference-entry');
  details.id = id;
  const summary = document.createElement('summary');
  summary.append(textElement('span', title, 'reference-entry-title'));
  if (date) summary.append(textElement('span', date, 'reference-entry-date'));
  details.append(summary);
  const body = textElement('div', '', 'reference-entry-body');
  details.append(body);
  container.append(details);
  return body;
}

function parameterText(control) {
  if (control.options) return `${control.label}: ${control.options.join(' / ')}`;
  if (control.choices) return `${control.label}: ${control.choices.map(choice => choice.label).join(' / ')}`;
  if (control.type === 'boolean') return `${control.label}: on / off`;
  return `${control.label}: ${control.min}–${control.max}${control.unit ? ` ${control.unit}` : ''}`;
}

function renderMethod(container, method) {
  const date = SYNTHESIS_DATES[method.id];
  const body = entry(container, `method-${method.id}`, method.label, date?.dateLabel);
  paragraph(body, method.group, 'reference-family');
  paragraph(body, method.principle || method.description);
  if (method.implementation || method.depth) {
    heading(body, 'What this instrument implements');
    paragraph(body, method.implementation || method.depth);
  }
  for (const limit of method.limitations || []) paragraph(body, limit, 'reference-limits');
  if (date) {
    heading(body, `Historical anchor · ${date.dateKind}`);
    paragraph(body, date.dateNote);
  }
  if (method.sourceNotes) paragraph(body, method.sourceNotes, 'reference-source-note');
  const amplitude = getAmplitudeModel(method);
  if (amplitude) {
    heading(body, amplitude.label);
    paragraph(body, amplitude.intrinsicExplanation);
    paragraph(body, amplitude.historicalContext);
    paragraph(body, amplitude.hostEnvelope.explanation, 'reference-limits');
  }
  heading(body, 'Parameters');
  paragraph(body, method.controls.map(parameterText).join(' · '), 'reference-limits');
  heading(body, 'Sound presets');
  const presets = textElement('dl', '', 'reference-preset-list');
  for (const preset of method.presets) {
    const row = document.createElement('div');
    const term = document.createElement('dt');
    term.append(link(preset.name, `synthesis.html?method=${encodeURIComponent(method.id)}&preset=${encodeURIComponent(preset.id)}`));
    row.append(term, textElement('dd', preset.cue || 'A reproducible starting point for this method.'));
    presets.append(row);
  }
  body.append(presets);
  if (method.touchstones?.length) {
    heading(body, 'Listening studies');
    for (const study of method.touchstones) {
      const piece = textElement('section', '', 'reference-study');
      piece.append(textElement('h5', study.title));
      paragraph(piece, study.gesture);
      paragraph(piece, study.listenFor || study.listen);
      body.append(piece);
    }
  }
  sourcesList(body, [date?.dateSource, method.citation, ...(amplitude?.sources || []), ...(method.touchstones || []).map(study => study.source)]);
}

function renderSequence(container, study) {
  const body = entry(container, `sequence-${study.id}`, study.label, study.shortDateLabel);
  paragraph(body, study.eraLabel, 'reference-family');
  paragraph(body, study.description);
  paragraph(body, study.cue);
  heading(body, 'Mechanism and controls');
  paragraph(body, getSequenceParameterDefinitions(study).map(parameterText).join(' · '), 'reference-limits');
  paragraph(body, `Useful comparisons: ${study.testFocus.join(', ')}.`);
  heading(body, 'History and scope');
  paragraph(body, study.lineage);
  paragraph(body, study.dateNote, 'reference-limits');
  paragraph(body, study.limitations, 'reference-limits');
  body.append(link('Explore this arpeggiator →', `synthesis.html?sequence=${encodeURIComponent(study.id)}`));
  sourcesList(body, study.provenance.sources);
}

function renderTuning(container, tuning) {
  const body = entry(container, `tuning-${tuning.id}`, tuning.label);
  paragraph(body, `${tuning.group} · ${tuning.evidence.replaceAll('-', ' ')}`, 'reference-family');
  paragraph(body, tuning.description);
  paragraph(body, tuning.caveat, 'reference-limits');
  paragraph(body, `Repeating period: ${tuning.periodRatio}:1. ${tuning.degreeCents.length} notes per period.`);
  paragraph(body, `Pitch steps above the root, in cents: ${tuning.degreeCents.map(value => Number(value.toFixed(3))).join(', ')}.`, 'reference-pitch-list');
  paragraph(body, `Default chord degrees (root = 0): ${tuning.chordDegrees.join(', ')}.`, 'reference-limits');
  body.append(link('Explore this tuning →', `synthesis.html?tuning=${encodeURIComponent(tuning.id)}`));
  sourcesList(body, [tuning.source]);
}

function renderCoverageGap(container, gap) {
  const body = entry(container, `missing-${gap.id}`, gap.label, 'Missing');
  paragraph(body, gap.description);
  paragraph(body, gap.gap, 'reference-limits');
  const related = textElement('p', 'Related implemented methods: ', 'reference-limits');
  gap.related.forEach((id, index) => {
    if (index) related.append(document.createTextNode(', '));
    const method = METHODS.find(item => item.id === id);
    related.append(link(method.label, `#method-${id}`));
  });
  body.append(related);
  sourcesList(body, [gap.source]);
}

export function mountSynthesisReference() {
  const containers = Object.fromEntries([...document.querySelectorAll('[data-reference-list]')]
    .map(element => [element.dataset.referenceList, element]));
  if (!containers.synthesis) return;
  SYNTHESIS_METHODS.forEach(method => renderMethod(containers.synthesis, method));
  PROCESSOR_METHODS.forEach(method => renderMethod(containers.processing, method));
  if (containers.percussion) PERCUSSION_METHODS.forEach(method => {
    const body = entry(containers.percussion, `percussion-${method.id}`, method.label, method.date);
    paragraph(body, method.description);
    heading(body, 'Original sound kits');
    paragraph(body, method.kits.map(kit => kit.label).join(' · '));
    heading(body, 'Independent rhythm presets');
    paragraph(body, method.rhythms.map(rhythm => rhythm.label).join(' · '));
    paragraph(body, 'Historical dates refer to the named reference instrument, not the invention of the synthesis principle. These are reduced technique studies, not circuit-accurate emulations. PCM and hybrid voices play cached original procedural one-shots, not factory ROM recordings. Pads and a modern editable velocity grid share one sample-clock scheduler; kit changes preserve the rhythm. Each voice has its own one-shot decay, pitch sweep or modal damping, without a global ADSR.', 'reference-limits');
    sourcesList(body, method.sources);
  });
  [...SEQUENCE_STUDIES].sort((a, b) => a.year - b.year || a.label.localeCompare(b.label))
    .forEach(study => renderSequence(containers.arpeggiators, study));
  TUNINGS.forEach(tuning => renderTuning(containers.tuning, tuning));
  SYNTHESIS_COVERAGE_GAPS.forEach(gap => renderCoverageGap(containers.missing, gap));
  document.getElementById('reference-counts').textContent = `${SYNTHESIS_METHODS.length} synthesis methods · ${PERCUSSION_METHODS.length} percussion studies · ${PROCESSOR_METHODS.length} processors · ${SEQUENCE_STUDIES.length} arpeggiators and sequencers · ${TUNINGS.length} tuning maps`;

  const search = document.getElementById('reference-search');
  const status = document.getElementById('reference-results');
  const entries = [...document.querySelectorAll('.reference-entry')]
    .map(element => ({ element, text: element.textContent.toLocaleLowerCase() }));
  const filter = () => {
    const words = search.value.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    let visible = 0;
    for (const item of entries) {
      item.element.hidden = !words.every(word => item.text.includes(word));
      if (!item.element.hidden) visible += 1;
    }
    status.textContent = words.length ? `${visible} matching ${visible === 1 ? 'entry' : 'entries'}` : `${entries.length} entries. Search also includes preset names and sources.`;
  };
  search.addEventListener('input', filter);
  filter();

  const revealAnchor = () => {
    let id;
    try { id = decodeURIComponent(location.hash.slice(1)); } catch { return; }
    const target = document.getElementById(id);
    if (!target) return;
    if (target.matches('.reference-entry')) {
      if (target.hidden) { search.value = ''; filter(); }
      target.open = true;
    }
    target.scrollIntoView({ block: 'start' });
  };
  window.addEventListener('hashchange', revealAnchor);
  if (location.hash) revealAnchor();
}

if (typeof document !== 'undefined') mountSynthesisReference();
