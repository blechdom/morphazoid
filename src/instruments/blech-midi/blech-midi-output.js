import { getSharedMidiManager } from '../../midi-manager.js';
import { getSharedMidiOutputRoutes } from '../../midi-output-routes.js';
import { MidiOutputStream } from '../../midi-output-stream.js';

const ROUTE_ID = 'blech-midi';
const finite = value => typeof value === 'number' && Number.isFinite(value);

/** Own routing and host transport; the audio producers own every musical event. */
export function mountBlechMidiOutput({
  engine, filePlayer, transport, runtime = globalThis,
  manager = getSharedMidiManager(runtime), Stream = MidiOutputStream,
} = {}) {
  let disposed = false, choice = 'off', host = false, hydrated = false;
  let active = false, signature = '', error = '', fileError = '', generation = 0;
  let route = null, hostPlaying = null, lastPlayhead = null;
  let graphReady = false, hostStarted = false, hostHasStarted = false;
  let pendingPlayOrigin = null, stoppedPpq = null;
  let preparing = Promise.resolve();
  const stateListeners = new Set();
  const now = () => runtime.performance?.now?.() ?? Date.now();
  const producers = [engine, filePlayer];

  const refresh = () => { if (!disposed) route?.changed(); };
  const prepare = async (enabled, epoch) => {
    // The file player borrows the mixer's context: create its clock first, and
    // never let a slower obsolete enable re-arm the file after a route change.
    const engineReady = await engine.setMidiOutput(enabled, epoch);
    if (epoch !== stream.epoch || disposed && enabled) return;
    if (enabled && !engineReady) throw new Error(engine.state?.error || 'Could not start the MIDI clock. Select the output again to retry.');
    const fileReady = await filePlayer.setMidiOutput(enabled, epoch);
    if (epoch !== stream.epoch || disposed && enabled) return;
    if (enabled && !fileReady) throw new Error('Could not start the MIDI file and keyboard output. Select the output again to retry.');
  };
  const stream = new Stream({ manager, runtime, onStatus(status) {
    if (disposed || status.enabled || !active) return;
    active = false; graphReady = false; signature = ''; generation++;
    error = status.error || 'MIDI output stopped. Select Off, then the destination to restart.';
    void prepare(false, status.epoch).catch(() => {}); refresh();
  } });

  const stopAfterError = reason => {
    if (disposed) return;
    error = reason instanceof Error ? reason.message : String(reason);
    active = false; graphReady = false; signature = ''; generation++;
    const epoch = stream.setEnabled(false);
    void prepare(false, epoch).catch(() => {}); refresh();
  };
  const configure = async (force = false) => {
    if (disposed) return;
    const status = manager.status();
    const desired = choice !== 'off' && status.enabled && Boolean(status.selectedOutput) && !error;
    const nextSignature = `${desired}:${status.selectedOutputId ?? ''}`;
    if (!force && nextSignature === signature) { refresh(); await preparing.catch(() => {}); return; }
    signature = nextSignature; active = desired; graphReady = false;
    const current = ++generation;
    const epoch = stream.setEnabled(desired);
    try {
      preparing = prepare(desired, epoch);
      await preparing;
      if (disposed || current !== generation) return;
      graphReady = desired;
      fileError = filePlayer.getMidiOutputError?.() ?? '';
      startPendingHost(); refresh();
    } catch (reason) {
      if (!disposed && current === generation) stopAfterError(reason);
    }
  };

  const sync = () => {
    if (disposed) return;
    const status = manager.status();
    const wanted = choice.startsWith('port:') ? choice.slice(5) : null;
    if (choice === 'host' && status.outputSelectionId !== null) {
      manager.selectOutput(null); return;
    }
    if (wanted && status.outputSelectionId !== wanted && status.outputs.some(({ id }) => id === wanted)) {
      manager.selectOutput(wanted); return;
    }
    // An explicitly selected disconnected port must not fall through to another
    // device. The manager retains its chosen id until that device returns.
    return configure();
  };
  const select = async value => {
    if (disposed) return;
    const status = manager.status();
    if (value !== 'off' && value !== 'host' && !status.outputs.some(({ id }) => value === `port:${id}`)) {
      throw new RangeError('That MIDI output is not connected.');
    }
    if (value === 'host' && !host) throw new Error('Automatic host output requires WAX.');
    choice = value; error = ''; signature = '';
    if (value !== 'off') {
      // Permission remains with the existing shared MIDI connection button.
      if (!status.enabled) { refresh(); throw new Error('Turn the MIDI connection on first.'); }
      manager.selectOutput(value === 'host' ? null : value.slice(5));
    }
    await configure();
    for (const listener of stateListeners) listener({ output: choice === 'off' ? 'off' : 'host' }, 'user');
  };
  const getState = () => {
    const status = manager.status();
    const options = [{ value: 'off', label: 'Off' }];
    if (host) options.push({ value: 'host', label: 'Auto DAW / host' });
    for (const output of status.outputs) options.push({ value: `port:${output.id}`, label: output.name || output.id });
    if (!options.some(({ value }) => value === choice)) options.push({ value: choice, label: 'Disconnected output', disabled: true });
    const unavailable = choice !== 'off' && status.enabled && !status.selectedOutput;
    return {
      value: choice, options, disabled: !status.enabled,
      error: error || engine.state?.midiOutputWarning || filePlayer.getMidiOutputError?.() || fileError || (unavailable ? 'No MIDI output is connected.' : ''),
    };
  };

  route = getSharedMidiOutputRoutes(runtime).register({ id: ROUTE_ID, getState, select });
  const unregisterClient = manager.registerClient({ id: 'blech-midi:output', computerKeyboard: false });
  const unsubscribeSources = producers.map((producer, index) => producer.subscribeMidiOutput((batch, context) => {
    if (disposed) return;
    if (index === 1) {
      const nextError = filePlayer.getMidiOutputError?.() ?? batch?.error ?? '';
      if (nextError !== fileError) { fileError = nextError; refresh(); }
    }
    stream.push(batch, context, index === 0 ? 'blech-layers' : 'blech-file');
  }));
  const unsubscribeStatus = manager.subscribeStatus(sync);

  const panic = () => {
    if (disposed) return stream.epoch;
    const epoch = stream.panic();
    const current = ++generation;
    preparing = prepare(active, epoch);
    void preparing.then(() => {
      if (disposed || current !== generation) return;
      graphReady = active; startPendingHost();
    }).catch(reason => { if (!disposed && current === generation) stopAfterError(reason); });
    return epoch;
  };
  const setTempo = bpm => {
    if (!finite(bpm) || bpm <= 0 || Math.abs(bpm - transport.getTempo()) < .0001) return;
    // Queued timestamps describe already rendered audio, not predictions.
    // The native clock changes tempo continuously without releasing held notes.
    transport.setTempo(bpm);
  };
  const seek = (ppq, deltaBeats, reason, anchor) => {
    if (!finite(ppq)) return;
    if (Math.abs(deltaBeats) > .000001) panic();
    transport.seek?.(ppq, { deltaBeats, reason, anchor });
  };
  const updateHostPhase = (snapshot, playing, restarting = false) => {
    if (!finite(snapshot.ppqPosition)) return;
    const time = now(), bpm = finite(snapshot.bpm) && snapshot.bpm > 0 ? snapshot.bpm : transport.getTempo();
    const anchor = { ppq: snapshot.ppqPosition, time, bpm, playing };
    if (!lastPlayhead) seek(anchor.ppq, 0, 'host-origin', anchor);
    else {
      const elapsed = lastPlayhead.playing ? Math.max(0, time - lastPlayhead.time) / 60000 : 0;
      const expected = lastPlayhead.ppq + elapsed * lastPlayhead.bpm;
      const delta = anchor.ppq - expected;
      const jumpedBack = anchor.ppq < lastPlayhead.ppq - .001;
      const jumped = Math.abs(delta) > Math.max(.25, elapsed * bpm * .75);
      if (restarting || jumpedBack || jumped) seek(anchor.ppq, delta, restarting ? 'host-play' : 'host-seek', anchor);
    }
    lastPlayhead = anchor;
  };
  function startPendingHost() {
    if (disposed || !host || !active || !graphReady || hostPlaying !== true || hostStarted) return;
    // The bridge can deliver retained Play before calling enableMidi. Preserve
    // that intent while both worklets start, then join the latest host anchor.
    // A newly opened instrument keeps its opening notes; a resumed performance
    // uses the PPQ at which its sources were actually paused.
    hostStarted = true; hostHasStarted = true;
    if (lastPlayhead) {
      const time = now(), anchor = { ...lastPlayhead, time,
        ppq: lastPlayhead.ppq + (lastPlayhead.playing ? Math.max(0, time - lastPlayhead.time) * lastPlayhead.bpm / 60000 : 0), playing: true };
      const delta = pendingPlayOrigin === null ? 0 : anchor.ppq - pendingPlayOrigin;
      seek(anchor.ppq, delta, pendingPlayOrigin === null ? 'host-origin' : 'host-play', anchor);
      lastPlayhead = anchor;
    }
    pendingPlayOrigin = null; stoppedPpq = null;
    transport.play();
  }
  const play = (playhead = {}) => {
    const restarting = hostPlaying !== true;
    if (restarting) {
      pendingPlayOrigin = hostHasStarted ? stoppedPpq ?? lastPlayhead?.ppq ?? null : null;
      hostPlaying = true; hostStarted = false;
    }
    if (!hostStarted) {
      if (finite(playhead.ppqPosition)) lastPlayhead = { ppq: playhead.ppqPosition, time: now(),
        bpm: finite(playhead.bpm) && playhead.bpm > 0 ? playhead.bpm : transport.getTempo(), playing: true };
    } else updateHostPhase(playhead, true);
    if (finite(playhead.bpm)) setTempo(playhead.bpm);
    startPendingHost();
  };
  const pause = (snapshot = {}, explicit = false) => {
    // A performer can start a drop while the DAW is stopped. A fresh Stop
    // command still releases it; repeated stopped playhead reports stay inert.
    const stopping = hostPlaying !== false || explicit;
    if (stopping) {
      hostPlaying = false; hostStarted = false; pendingPlayOrigin = null;
      transport.pause(); panic();
    }
    const time = now(), previous = lastPlayhead;
    const ppq = finite(snapshot.ppqPosition) ? snapshot.ppqPosition : previous
      ? previous.ppq + (previous.playing ? Math.max(0, time - previous.time) * previous.bpm / 60000 : 0) : null;
    if (finite(ppq)) {
      if (stopping) stoppedPpq = ppq;
      lastPlayhead = { ppq, time, bpm: snapshot.bpm ?? previous?.bpm ?? transport.getTempo(), playing: false };
    }
  };
  const playhead = snapshot => {
    if (snapshot.isPlaying === false) { if (finite(snapshot.bpm)) setTempo(snapshot.bpm); pause(snapshot); return; }
    if (snapshot.isPlaying !== true) return;
    if (hostPlaying !== true || !hostStarted) { play(snapshot); return; }
    updateHostPhase(snapshot, true);
    if (finite(snapshot.bpm)) setTempo(snapshot.bpm);
  };
  const wax = runtime.MorphazoidWAX;
  const unregisterWax = wax?.register?.({
    id: ROUTE_ID, stateVersion: 1,
    getState: () => ({ output: choice === 'off' ? 'off' : 'host' }),
    applyState(snapshot) {
      if (snapshot?.output !== 'off' && snapshot?.output !== 'host') return;
      hydrated = true; choice = snapshot.output; error = ''; signature = ''; sync();
    },
    subscribeState(listener) { stateListeners.add(listener); return () => stateListeners.delete(listener); },
    async enableMidi() {
      if (disposed) return;
      host = true;
      if (!hydrated) choice = 'host';
      try { await manager.enable(); }
      catch (reason) {
        error = reason instanceof Error ? reason.message : String(reason); refresh(); throw reason;
      }
      if (!disposed) { await sync(); await preparing; }
    },
    transport: { play, stop: snapshot => pause(snapshot, true), bpm: setTempo, playhead, playheadIntervalMs: 16 },
  });

  const destroy = () => {
    if (disposed) return;
    disposed = true; active = false; graphReady = false; hostPlaying = false; generation++;
    unregisterWax?.(); unsubscribeStatus();
    for (const unsubscribe of unsubscribeSources) unsubscribe?.();
    stream.dispose();
    void prepare(false, stream.epoch).catch(() => {});
    unregisterClient(); route.destroy(); stateListeners.clear();
  };
  return Object.freeze({ destroy, panic, get state() { return { ...getState(), active, ready: graphReady, host }; }, get stats() { return stream.stats; } });
}
