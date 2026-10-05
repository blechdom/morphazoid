import {
  amplitudeEnvelopePreset,
  percussionEnvelopePreset,
  percussionEnvelopeTimeMs,
  updateAmplitudeEnvelopeNode,
  updatePercussionEnvelopeNode,
} from '../../audio.js';
import { mappingCurvePreset, updateMappingCurveNode } from '../../mapping.js';
import { canonicalHeadOffsets, sanitizeHeadOffsets, updateHeadOffset } from '../../playheads.js';

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const wrap = value => ((value % 1) + 1) % 1;
const pct = value => `${Math.round(value * 100)}%`;
const title = value => value ? value[0].toUpperCase() + value.slice(1) : '';
const speedFromSlider = value => 4 * Math.expm1(5.6 * value) / Math.expm1(5.6);
const sliderFromSpeed = value => Math.log1p(clamp(value, 0, 4) / 4 * Math.expm1(5.6)) / 5.6;
const ENGINE_LABELS = { sine: 'Sine Oscillators', percussion: 'Percussion', shepard: 'Shepard Glissandi', fm: 'FM Synthesis', pm: 'PM Synthesis' };
const READER_LABELS = { trace: 'Points', scan: 'Line', radial: 'Radar' };
const SOURCE_LABELS = { fixed: 'Direct', horizontal: 'Left → right', height: 'Up → down', vertical: 'Vertical', center: 'Center → edge', corner: 'Corner sharpness', incidence: 'Crossing angle', phase: 'Contour position', signed: 'Inner / outer polarity' };
const NODE_NAMES = ['Trigger', 'Attack', 'Decay', 'Sustain', 'Release'];
const HEAD_COLORS = ['#5fe8c4', '#7db4ff', '#c79bff', '#ffb86b'];
const NUMBERS = [
  'heads', 'corners', 'curvature', 'aspect', 'skew', 'rotationSpeed',
  'baseFrequency', 'pitchRange', 'percussionStrikeLevel', 'percussionAttackNoise',
  'shepardCycles', 'shepardTurnGlide', 'shepardWidth', 'fmIndex', 'fmRatio',
  'pmIndex', 'pmRatio', 'stereoWidth',
];
const SELECTS = ['soundMode', 'cornerMode', 'cornerAmplitudeSource', 'percussionLevelSource', 'percussionLevelCurve', 'shepardDirection'];

/** Shape's native control surface, with Blobs owning all sound and drawing state. */
export function mountBlobsControls({ getState, change, command, signal }) {
  const $ = id => document.getElementById(id);
  const lifecycle = new AbortController();
  const on = (node, event, callback) => node?.addEventListener(event, callback, { signal: lifecycle.signal });
  const text = (id, value) => { if ($(id)) $(id).textContent = value; };
  const pressed = (id, active) => $(id)?.setAttribute('aria-pressed', String(Boolean(active)));
  const value = (id, next) => { if ($(id) && document.activeElement !== $(id)) $(id).value = String(next); };
  const announce = message => text('liveStatus', message);
  let headDrag = null;
  const curveDrags = new Map();
  let destroyed = false;
  const apply = patch => { if (destroyed) return; change(patch); refresh(getState()); };
  const act = (name, payload) => { if (destroyed) return; command(name, payload); refresh(getState()); };
  const buttons = id => [...($(id)?.querySelectorAll('button[data-value]') ?? [])];
  const selectButtons = (id, selected) => buttons(id).forEach(button => button.setAttribute('aria-pressed', String(button.dataset.value === String(selected))));
  const choose = (id, key, transform = selected => selected) => buttons(id).forEach(button => on(button, 'click', () => apply({ [key]: transform(button.dataset.value) })));

  on($('playButton'), 'click', () => act('play', !getState().playing));
  on($('rotationPlayButton'), 'click', () => act('rotationPlay', !getState().autoRotate));
  on($('position'), 'input', event => act('position', Number(event.target.value)));
  on($('rotation'), 'input', event => act('rotation', Number(event.target.value)));
  on($('resetRotation'), 'click', () => act('rotation', 0));
  on($('resetDemo'), 'click', () => act('resetDemo'));
  on($('speed'), 'input', event => apply({ speed: speedFromSlider(Number(event.target.value)) }));
  for (const [id, key] of [['playheadTempo', 'speed'], ['rotationTempo', 'rotationSpeed']]) {
    on($(id), 'input', event => {
      if (event.target.value === '' || !Number.isFinite(event.target.valueAsNumber)) return;
      apply({ [key]: clamp(event.target.valueAsNumber, 0, 240) / 60 });
    });
    on($(id), 'change', () => { $(id).value = (getState()[key] * 60).toFixed(1); });
  }
  for (const id of NUMBERS) on($(id), 'input', event => {
    const input = event.target;
    let next = clamp(Number(input.value), Number(input.min), Number(input.max));
    if (id === 'heads' || id === 'corners') next = Math.round(next);
    if (id === 'heads') apply({ heads: next, headOffsets: sanitizeHeadOffsets(getState().headOffsets, next) });
    else apply({ [id]: next });
  });
  for (const id of SELECTS) on($(id), 'change', event => {
    const selected = id === 'shepardDirection' ? Number(event.target.value) : event.target.value;
    apply({ [id]: selected });
  });
  choose('playMethod', 'playMethod');
  choose('playheadMotion', 'motionMode');
  choose('rotationMotion', 'rotationMotionMode');
  choose('shepardMapping', 'shepardMapping');
  choose('pitchDimension', 'pitchSource');
  choose('stereoDimension', 'stereoSource');
  on($('traversalDirection'), 'click', () => apply({ traversalDirection: getState().traversalDirection < 0 ? 1 : -1 }));
  on($('rotationDirection'), 'click', () => apply({ rotationDirection: getState().rotationDirection < 0 ? 1 : -1 }));
  on($('stereoInvert'), 'click', () => apply({ stereoInverted: !getState().stereoInverted }));
  on($('timbreSource'), 'change', event => apply({ [getState().soundMode === 'pm' ? 'pmDepthSource' : 'fmIndexSource']: event.target.value }));
  on($('resetForm'), 'click', () => apply({ curvature: 0, aspect: 0, skew: 0 }));
  for (const [id, key] of [['resetCurvature', 'curvature'], ['resetAspect', 'aspect'], ['resetSkew', 'skew']]) on($(id), 'click', () => apply({ [key]: 0 }));

  function setHeads(count) {
    const heads = clamp(count, 1, 12);
    apply({ heads, headOffsets: sanitizeHeadOffsets(getState().headOffsets, heads) });
  }
  on($('removePlayhead'), 'click', () => setHeads(getState().heads - 1));
  on($('addPlayhead'), 'click', () => setHeads(getState().heads + 1));
  on($('resetHeadSpacing'), 'click', () => apply({ headOffsets: canonicalHeadOffsets(getState().heads) }));
  function changeHeadOffset(index, offset) {
    const state = getState();
    apply({ headOffsets: updateHeadOffset(sanitizeHeadOffsets(state.headOffsets, state.heads), index, offset) });
  }
  const track = $('headLayoutTrack');
  track?.classList.add('has-head-options');
  for (let index = 0; index < 12; index++) {
    const marker = $(`headMarker${index}`), option = $(`headOption${index}`);
    marker?.setAttribute('role', 'slider');
    marker?.style.setProperty('--head-color', HEAD_COLORS[index % HEAD_COLORS.length]);
    option?.style.setProperty('--head-color', HEAD_COLORS[index % HEAD_COLORS.length]);
    on(marker, 'pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault(); marker.focus({ preventScroll: true });
      headDrag = { pointerId: event.pointerId, index };
      track.setPointerCapture(event.pointerId);
    });
    on(marker, 'keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      const state = getState(), offset = sanitizeHeadOffsets(state.headOffsets, state.heads)[index];
      changeHeadOffset(index, event.key === 'Home' ? 0 : event.key === 'End' ? .999 : offset + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? .05 : .01));
    });
    on(option, 'click', () => {
      const state = getState();
      if (state.playMethod === 'scan') {
        const scanLineAxes = Array.from({ length: 12 }, (_, i) => state.scanLineAxes?.[i] ?? 'vertical');
        scanLineAxes[index] = scanLineAxes[index] === 'vertical' ? 'horizontal' : 'vertical';
        apply({ scanLineAxes });
      } else {
        const key = state.playMethod === 'radial' ? 'radialHeadDirections' : 'traceHeadDirections';
        const directions = Array.from({ length: 12 }, (_, i) => state[key]?.[i] < 0 ? -1 : 1);
        directions[index] *= -1;
        apply({ [key]: directions });
      }
    });
  }
  on(track, 'pointermove', event => {
    if (headDrag?.pointerId !== event.pointerId) return;
    const bounds = track.getBoundingClientRect();
    changeHeadOffset(headDrag.index, clamp((event.clientX - bounds.left) / Math.max(1, bounds.width), 0, .999));
  });
  function endHeadDrag(event) {
    if (headDrag?.pointerId !== event.pointerId) return;
    headDrag = null;
    if (track.hasPointerCapture(event.pointerId)) track.releasePointerCapture(event.pointerId);
  }
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) on(track, event, endHeadDrag);

  const curves = [
    { editor: 'amplitudeCurveEditor', path: 'amplitudeCurvePath', node: 'amplitudeNode', key: 'amplitudeEnvelopePoints', presetKey: 'amplitudePreset', presets: 'amplitudeEnvelopePresets', reset: 'resetAmplitudeCurve', initial: 'segment', preset: amplitudeEnvelopePreset, update: updateAmplitudeEnvelopeNode },
    { editor: 'percussionCurveEditor', path: 'percussionCurvePath', node: 'percussionNode', key: 'percussionEnvelopePoints', presetKey: 'percussionPreset', presets: 'percussionEnvelopePresets', reset: 'resetPercussionCurve', initial: 'pluck', preset: percussionEnvelopePreset, update: updatePercussionEnvelopeNode },
    { editor: 'pitchCurveEditor', path: 'pitchCurvePath', node: 'pitchCurveNode', key: 'pitchCurveNodes', presetKey: 'pitchCurvePreset', presets: 'pitchCurvePresets', reset: 'resetPitchCurve', initial: 'linear', preset: mappingCurvePreset, update: updateMappingCurveNode },
  ];
  function selectCurvePreset(curve, selected) {
    const patch = { [curve.presetKey]: selected, [curve.key]: curve.preset(selected) };
    if (curve.key === 'amplitudeEnvelopePoints' && selected === 'segment') patch.cornerSwell = false;
    apply(patch);
  }
  for (const curve of curves) {
    for (const button of buttons(curve.presets)) on(button, 'click', () => selectCurvePreset(curve, button.dataset.value));
    on($(curve.reset), 'click', () => selectCurvePreset(curve, curve.initial));
    const editor = $(curve.editor);
    function setNode(index, point) {
      const nodes = getState()[curve.key] ?? curve.preset(curve.initial);
      apply({ [curve.key]: curve.update(nodes, index, point), [curve.presetKey]: 'custom' });
    }
    for (let index = 0; index < 5; index++) {
      const handle = $(`${curve.node}${index}`);
      on(handle, 'pointerdown', event => {
        if (event.button !== 0) return;
        event.preventDefault(); handle.focus({ preventScroll: true });
        curveDrags.set(curve.editor, { pointerId: event.pointerId, index });
        editor.setPointerCapture(event.pointerId);
      });
      on(handle, 'keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
        event.preventDefault();
        const point = (getState()[curve.key] ?? curve.preset(curve.initial))[index], step = event.shiftKey ? .05 : .01;
        setNode(index, {
          x: point.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0),
          y: point.y + (event.key === 'ArrowDown' ? -step : event.key === 'ArrowUp' ? step : 0),
        });
        announce(handle.getAttribute('aria-label'));
      });
    }
    on(editor, 'pointermove', event => {
      const drag = curveDrags.get(curve.editor);
      if (drag?.pointerId !== event.pointerId) return;
      const bounds = editor.getBoundingClientRect();
      setNode(drag.index, {
        x: clamp((event.clientX - bounds.left) / Math.max(1, bounds.width), 0, 1),
        y: clamp(1 - (event.clientY - bounds.top) / Math.max(1, bounds.height), 0, 1),
      });
    });
    const endDrag = event => {
      if (curveDrags.get(curve.editor)?.pointerId !== event.pointerId) return;
      curveDrags.delete(curve.editor);
      if (editor.hasPointerCapture(event.pointerId)) editor.releasePointerCapture(event.pointerId);
    };
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) on(editor, event, endDrag);
  }
  on($('amplitudeEnvelopeToggle'), 'click', () => {
    const enabled = !getState().amplitudeEnvelopeEnabled;
    apply({ amplitudeEnvelopeEnabled: enabled, ...(!enabled ? { cornerSwell: false } : {}) });
  });
  on($('cornerSwellToggle'), 'click', () => apply({ cornerSwell: !getState().cornerSwell }));

  function refreshCurve(curve, state) {
    const nodes = state[curve.key] ?? curve.preset(curve.initial);
    $(curve.path)?.setAttribute('d', nodes.map((point, i) => `${i ? 'L' : 'M'}${(point.x * 240).toFixed(2)} ${(96 - point.y * 96).toFixed(2)}`).join(' '));
    selectButtons(curve.presets, state[curve.presetKey]);
    nodes.forEach((point, index) => {
      const handle = $(`${curve.node}${index}`);
      if (!handle) return;
      handle.style.left = `${point.x * 100}%`; handle.style.top = `${(1 - point.y) * 100}%`;
      handle.setAttribute('aria-valuenow', String(Math.round(point.y * 100)));
      const timing = curve.key === 'percussionEnvelopePoints' ? `${Math.round(percussionEnvelopeTimeMs(point.x))} milliseconds` : `${Math.round(point.x * 100)} percent ${curve.key === 'pitchCurveNodes' ? 'input' : 'corner interval'}`;
      const label = `${curve.key === 'pitchCurveNodes' ? `Pitch node ${index + 1}` : NODE_NAMES[index]}: ${timing}, ${Math.round(point.y * 100)} percent ${curve.key === 'pitchCurveNodes' ? 'output' : 'level'}`;
      handle.setAttribute('aria-label', label); handle.setAttribute('aria-valuetext', label); handle.title = label;
    });
  }

  function refresh(state = getState()) {
    if (destroyed) return;
    for (const id of NUMBERS) if (Number.isFinite(state[id])) value(id, state[id]);
    for (const id of SELECTS) if (state[id] !== undefined) value(id, state[id]);
    value('speed', sliderFromSpeed(state.speed));
    value('playheadTempo', (state.speed * 60).toFixed(1));
    value('rotationTempo', (state.rotationSpeed * 60).toFixed(1));
    text('speedOut', `${state.speed.toFixed(3)} cyc/s`);
    text('rotationSpeedOut', `${state.rotationSpeed.toFixed(2)} rev/s`);
    text('headsOut', `${state.heads} ${state.heads === 1 ? 'playhead' : 'playheads'}`);
    text('playheadCountOut', `${state.heads} ${state.playMethod === 'trace' ? state.heads === 1 ? 'point' : 'points' : state.playMethod === 'scan' ? state.heads === 1 ? 'line' : 'lines' : 'radar'}`);
    $('removePlayhead').disabled = state.heads <= 1; $('addPlayhead').disabled = state.heads >= 12;
    selectButtons('playMethod', state.playMethod); selectButtons('playheadMotion', state.motionMode);
    selectButtons('rotationMotion', state.rotationMotionMode);
    for (const prefix of ['traversal', 'rotation']) {
      const direction = state[`${prefix}Direction`] < 0 ? -1 : 1;
      text(`${prefix}DirectionGlyph`, direction < 0 ? '←' : '→'); text(`${prefix}DirectionText`, direction < 0 ? 'CCW' : 'CW');
      $(`${prefix}Direction`)?.setAttribute('aria-label', `${prefix === 'rotation' ? 'Rotation' : 'Playhead'} direction: ${direction < 0 ? 'counterclockwise' : 'clockwise'}`);
    }
    const offsets = sanitizeHeadOffsets(state.headOffsets, state.heads);
    for (let index = 0; index < 12; index++) {
      const marker = $(`headMarker${index}`), option = $(`headOption${index}`), active = index < state.heads;
      marker.hidden = option.hidden = !active;
      if (!active) continue;
      marker.style.left = option.style.left = `${offsets[index] * 100}%`;
      marker.setAttribute('aria-valuenow', String(offsets[index]));
      marker.setAttribute('aria-valuetext', `${(offsets[index] * 100).toFixed(1)} percent relative phase`);
      marker.title = `Playhead ${index + 1} · ${(offsets[index] * 100).toFixed(1)}%`;
      const horizontal = state.scanLineAxes?.[index] === 'horizontal';
      const directions = state.playMethod === 'radial' ? state.radialHeadDirections : state.traceHeadDirections;
      const reverse = directions?.[index] < 0;
      option.setAttribute('aria-pressed', String(state.playMethod === 'scan' ? horizontal : reverse));
      option.setAttribute('aria-label', state.playMethod === 'scan' ? `Playhead ${index + 1} ${horizontal ? 'horizontal' : 'vertical'} line; change axis` : `Playhead ${index + 1} ${reverse ? 'reverse' : 'forward'}; reverse direction`);
      option.firstElementChild.textContent = state.playMethod === 'scan' ? horizontal ? '↔' : '↕' : reverse ? '←' : '→';
      option.title = option.getAttribute('aria-label');
    }
    text('cornersOut', state.corners);
    $('cornersControl').hidden = state.cornerMode !== 'even';
    text('cornerModeHelp', state.cornerMode === 'even' ? 'Evenly spaced corners retrigger the envelope around each loop.' : 'Drawn anchor points retrigger the corner envelope.');
    text('formSummary', state.cornerMode === 'even' ? `${state.corners} corners` : 'Drawn corners');
    text('curvatureOut', Math.abs(state.curvature) < .001 ? 'straight' : `${pct(Math.abs(state.curvature))} ${state.curvature < 0 ? 'in' : 'out'}`);
    text('aspectOut', Math.abs(state.aspect) < .005 ? 'even' : `${Math.abs(state.aspect).toFixed(2)} ${state.aspect < 0 ? 'tall' : 'wide'}`);
    text('skewOut', Math.abs(state.skew) < .005 ? 'even' : state.skew.toFixed(2));
    text('soundSummary', ENGINE_LABELS[state.soundMode]);
    text('baseFrequencyOut', `${Math.round(state.baseFrequency)} Hz`); text('pitchRangeOut', `${state.pitchRange.toFixed(2)} oct`);
    text('fmIndexOut', state.fmIndex.toFixed(2)); text('fmRatioOut', `${state.fmRatio.toFixed(2)} : 1`);
    text('pmIndexOut', `${state.pmIndex.toFixed(2)} rad`); text('pmRatioOut', `${state.pmRatio.toFixed(2)} : 1`);
    text('percussionStrikeLevelOut', pct(state.percussionStrikeLevel)); text('percussionAttackNoiseOut', pct(state.percussionAttackNoise));
    text('shepardCyclesOut', `${state.shepardCycles.toFixed(2)} oct / circuit`); text('shepardTurnGlideOut', pct(state.shepardTurnGlide)); text('shepardWidthOut', `${state.shepardWidth.toFixed(1)} oct`);
    selectButtons('shepardMapping', state.shepardMapping);
    $('shepardMappingTurn').disabled = state.playMethod !== 'trace';
    text('shepardMappingHelp', state.playMethod === 'trace' ? 'Equal distance along the contour produces equal pitch change.' : 'Turn-angle mapping is available with Point playheads.');
    $('shepardTurnGlideControl').hidden = state.shepardMapping !== 'turn';
    for (const mode of ['percussion', 'shepard', 'fm', 'pm']) $(`${mode}Articulation`).hidden = state.soundMode !== mode;
    // Percussion uses its timed strike envelope; all continuous engines share the spatial ADSR.
    $('amplitudeArticulation').hidden = state.soundMode === 'percussion';
    $('cornerAmplitudeMapping').hidden = state.soundMode === 'percussion';
    $('percussionMapping').hidden = state.soundMode !== 'percussion';
    $('timbreMapping').hidden = !['fm', 'pm'].includes(state.soundMode);
    $('pitchDimensionControl').hidden = $('pitchCurveControl').hidden = state.soundMode === 'shepard';
    $('pitchRange').closest('.control').hidden = state.soundMode === 'shepard';
    const timbreKey = state.soundMode === 'pm' ? 'pmDepthSource' : 'fmIndexSource';
    const timbreName = state.soundMode === 'pm' ? 'Phase depth' : 'FM index';
    value('timbreSource', state[timbreKey]); text('timbreSourceFieldLabel', `${timbreName} source`);
    text('timbreMappingNote', `${SOURCE_LABELS[state[timbreKey]]} → ${timbreName}`);
    text('timbreSourceHelp', `Direct uses the ${timbreName.toLowerCase()} control; other sources scale its value along the loop.`);
    text('cornerAmplitudeMappingNote', `${SOURCE_LABELS[state.cornerAmplitudeSource]} → Corner ADSR level`);
    text('percussionSourceHelp', state.percussionLevelSource === 'corner' ? '0 is smooth · 1 is the sharpest turn' : `${SOURCE_LABELS[state.percussionLevelSource]} sets each strike’s level.`);
    pressed('amplitudeEnvelopeToggle', state.amplitudeEnvelopeEnabled); text('amplitudeEnvelopeToggleText', state.amplitudeEnvelopeEnabled ? 'On' : 'Off');
    $('amplitudeEnvelopeToggle').setAttribute('aria-label', `Corner Amplitude ADSR ${state.amplitudeEnvelopeEnabled ? 'on' : 'off'}`);
    pressed('cornerSwellToggle', state.cornerSwell); text('cornerSwellToggleText', state.cornerSwell ? 'Swell on' : 'Swell off');
    $('cornerSwellToggle').disabled = !state.amplitudeEnvelopeEnabled || state.amplitudePreset === 'segment';
    $('cornerSwellToggle').setAttribute('aria-label', `Corner swell ${state.cornerSwell ? 'on' : 'off'}`);
    text('amplitudeCurveState', title(state.amplitudePreset)); text('percussionEnvelopeState', title(state.percussionPreset));
    text('amplitudeIntervalHelp', state.cornerSwell ? 'Envelope swells around each corner' : 'Current corner → next corner');
    text('amplitudeTimingBasis', 'Timing follows each corner interval and the playhead speed.');
    text('amplitudeReleaseBehavior', state.amplitudeEnvelopePoints?.at(-1)?.y > 0 ? 'The final level holds until the next corner.' : 'Reaches silence at the release point.');
    const amplitude = state.amplitudeEnvelopePoints ?? amplitudeEnvelopePreset('segment');
    text('amplitudeNodeReadout', amplitude.slice(1).map((node, i) => `${NODE_NAMES[i + 1][0]} ${pct(node.x)}`).join(' · '));
    const percussion = state.percussionEnvelopePoints ?? percussionEnvelopePreset('pluck');
    text('percussionNodeReadout', percussion.slice(1).map((node, i) => `${NODE_NAMES[i + 1][0]} ${Math.round(percussionEnvelopeTimeMs(node.x))} ms`).join(' · '));
    for (const curve of curves) refreshCurve(curve, state);
    selectButtons('pitchDimension', state.pitchSource); selectButtons('stereoDimension', state.stereoSource);
    text('mappingSummary', state.soundMode === 'shepard' ? 'Cyclic pitch' : `${title(state.pitchSource)} → pitch`);
    text('pitchCurveState', title(state.pitchCurvePreset));
    pressed('stereoInvert', state.stereoInverted); text('stereoWidthOut', pct(state.stereoWidth));
    $('stereoInvert').setAttribute('aria-label', `Reverse ${state.stereoSource} stereo direction`);
    text('stereoMappingNote', `${state.stereoSource === 'horizontal' ? 'Stage left → right' : state.stereoSource === 'vertical' ? 'Stage top → bottom' : 'Center → edge'} · ${state.stereoInverted ? 'reversed' : 'normal'}`);
    frame(state);
  }

  function frame(state = getState(), summary = {}) {
    if (destroyed) return;
    const position = clamp(state.position ?? summary.phase ?? 0, 0, 1), rotation = state.rotation ?? 0;
    value('position', position); value('rotation', rotation);
    text('positionOut', `${(position * 100).toFixed(1)}%`); text('rotationOut', `${Math.round(rotation)}°`);
    pressed('playButton', state.playing); pressed('rotationPlayButton', state.autoRotate);
    $('playButton').setAttribute('aria-label', state.playing ? 'Pause playhead' : 'Play playhead');
    $('rotationPlayButton').setAttribute('aria-label', state.autoRotate ? 'Pause rotation' : 'Start rotation');
    text('playSummary', `${READER_LABELS[state.playMethod] ?? 'Points'} · ${state.playing ? 'playing' : 'paused'}`);
    if (summary.readout) text('stageReadout', summary.readout);
    else if (summary.blobs !== undefined) text('stageReadout', `${summary.blobs} ${summary.blobs === 1 ? 'BLOB' : 'BLOBS'} · ${state.heads} ${state.heads === 1 ? 'HEAD' : 'HEADS'}${typeof state.audio === 'boolean' ? ` · AUDIO ${state.audio ? 'ON' : 'OFF'}` : ''}`);
    text('outputVoiceLabel', ENGINE_LABELS[state.soundMode]);
    text('outputContactLabel', summary.contacts === 0 ? 'No contacts' : `Contact 1${summary.contacts !== undefined ? ` of ${summary.contacts}` : ''}`);
    text('markPhaseOut', position.toFixed(3)); text('markRotationOut', `${Math.round(rotation)}°`);
    const fields = { markFrequencyOut: ['frequency', v => `${Math.round(v)} Hz`], markGainOut: ['gain', v => v.toFixed(3)], markPanOut: ['pan', v => v.toFixed(3)], markCenterOut: ['center', v => v.toFixed(3)], markTurnOut: ['turn', v => `${Math.round(v)}°`], markDistanceOut: ['cornerDistance', v => v.toFixed(3)], markIncidenceOut: ['incidence', v => v.toFixed(3)], markTangentOut: ['tangent', v => `${Math.round(v)}°`], markPitchValueOut: ['pitch', v => v.toFixed(3)], markSynthDriveOut: ['timbre', v => v.toFixed(3)] };
    for (const [id, [key, format]] of Object.entries(fields)) text(id, Number.isFinite(summary[key]) ? format(summary[key]) : '—');
    text('markPositionOut', Number.isFinite(summary.x) && Number.isFinite(summary.y) ? `${summary.x.toFixed(3)}, ${summary.y.toFixed(3)}` : '—');
    text('markSynthValueOut', state.soundMode === 'fm' ? `FM ${state.fmIndex.toFixed(2)}` : state.soundMode === 'pm' ? `${state.pmIndex.toFixed(2)} rad` : state.soundMode === 'sine' ? 'Pure sine' : ENGINE_LABELS[state.soundMode]);
    text('markDecayOut', state.soundMode === 'percussion' ? title(state.percussionPreset) : state.amplitudeEnvelopeEnabled ? title(state.amplitudePreset) : 'Continuous');
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true; lifecycle.abort();
    if (headDrag && track.hasPointerCapture(headDrag.pointerId)) track.releasePointerCapture(headDrag.pointerId);
    for (const [editorId, drag] of curveDrags) {
      const editor = $(editorId);
      if (editor?.hasPointerCapture(drag.pointerId)) editor.releasePointerCapture(drag.pointerId);
    }
    headDrag = null; curveDrags.clear();
  }
  signal?.addEventListener('abort', destroy, { once: true, signal: lifecycle.signal });
  if (signal?.aborted) destroy();
  else refresh(getState());
  return { refresh, frame, destroy };
}
