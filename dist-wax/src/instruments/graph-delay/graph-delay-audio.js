import { unlockAudioContext } from "../../audio.js";
import { connectAudioOutput } from "../../audio-output-manager.js";
import { audioInputConstraints, configureAudioInputNode, loadAudioInputSettings } from "../../audio-input-settings.js";
import {
  MAX_GRAPH_TURN_ROUTES,
  edgeAudioParameters,
  graphEdgeSwitchMultipliers,
  graphNodePans,
  graphSinkNodeIds,
  graphTurnRoutings,
  nodeTurnRouting,
} from "./graph-delay.js";

const MAX_LIVE_NODES = 24;
const MAX_DELAY_SECONDS = 2.2;
const SWITCH_RAMP_SECONDS = 0.025;
const CROSSFADE_SECONDS = 0.3;
const PITCH_PREROLL_SECONDS = 0.12;

const finite = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const clamp = (value, minimum, maximum, fallback = minimum) => (
  Math.min(maximum, Math.max(minimum, finite(value, fallback)))
);

function safeConnect(source, destination, output, input) {
  if (!source || !destination) return destination;
  if (output === undefined) source.connect(destination);
  else source.connect(destination, output, input ?? 0);
  return destination;
}

function safeDisconnect(node) {
  try { node?.disconnect?.(); } catch { /* already disconnected */ }
  try { node?.port?.close?.(); } catch { /* not an AudioWorkletNode */ }
}

function setTarget(parameter, value, now, constant = 0.025) {
  if (!parameter) return;
  try {
    parameter.cancelScheduledValues?.(now);
    if (typeof parameter.setTargetAtTime === "function") {
      parameter.setTargetAtTime(value, now, constant);
    } else if (typeof parameter.setValueAtTime === "function") {
      parameter.setValueAtTime(value, now);
    } else {
      parameter.value = value;
    }
  } catch {
    // A graph being retired may already have detached parameters.
  }
}

function ramp(parameter, value, now, seconds = SWITCH_RAMP_SECONDS) {
  if (!parameter) return;
  try {
    if (typeof parameter.cancelAndHoldAtTime === "function") {
      parameter.cancelAndHoldAtTime(now);
    } else {
      parameter.cancelScheduledValues?.(now);
      parameter.setValueAtTime?.(finite(parameter.value, 0), now);
    }
    parameter.linearRampToValueAtTime?.(value, now + seconds);
  } catch {
    // Closing contexts need no further automation.
  }
}

function rampWindow(parameter, from, to, now, startsAt, endsAt) {
  if (!parameter) return;
  try {
    parameter.cancelScheduledValues?.(now);
    parameter.setValueAtTime?.(from, now);
    parameter.setValueAtTime?.(from, startsAt);
    parameter.linearRampToValueAtTime?.(to, endsAt);
  } catch {
    // A closing context needs no transition.
  }
}

function softClipCurve(size = 2048) {
  const curve = new Float32Array(size);
  const normalizer = Math.tanh(1.65);
  for (let index = 0; index < size; index += 1) {
    const value = index / Math.max(1, size - 1) * 2 - 1;
    curve[index] = Math.tanh(value * 1.65) / normalizer;
  }
  return curve;
}

function cancelledGraphDelayStart() {
  const error = new Error("Graph microphone start was cancelled.");
  error.name = "AbortError";
  return error;
}

export function graphAudibleTapGain(count) {
  return 0.9 / Math.max(1, finite(count, 1)) ** 0.25;
}

export function graphAudioTopologySignature(graph) {
  return [
    graph?.type ?? "graph",
    graph?.nodes?.length ?? 0,
    (graph?.entries ?? []).join(","),
    (graph?.edges ?? []).map((edge) => `${edge.from}>${edge.to}:${edge.feedbackEdge ? 1 : 0}`).join(","),
  ].join("|");
}

function enabledFlags(graph, source) {
  if (Array.isArray(source)) return graph.edges.map((_edge, index) => source[index] ?? true);
  if (source instanceof Map) {
    return graph.edges.map((edge) => source.get(`${edge.from}>${edge.to}`) ?? true);
  }
  return graph.edges.map(() => true);
}

export function graphTerminalDelaySeconds(from, to, sourceSettings = {}) {
  const settings = sanitizeGraphDelayAudioSettings(sourceSettings);
  const length = clamp(
    Math.hypot((to?.x ?? 0.5) - (from?.x ?? 0.08), (to?.y ?? 0.5) - (from?.y ?? 0.5))
      / Math.SQRT2,
    0,
    1,
    0,
  );
  const base = clamp(settings.baseDelay * 0.08, 4, 24, 5);
  const variation = length * Math.min(120, settings.baseDelay * (settings.distanceRatio - 1) * 0.2);
  return (base + variation) / 1_000;
}

function turnOptions(settings) {
  return {
    inputPosition: { x: settings.inputX, y: settings.inputY },
    pitchScale: settings.pitchScale,
    pitchAsymmetry: settings.pitchAsymmetry,
    pitchCurve: settings.pitchCurve,
  };
}

export function graphTurnSemitoneMatrix(routing) {
  const matrix = Array.from(
    { length: routing.sources.length },
    () => Array(routing.outputs.length).fill(0),
  );
  for (const turn of routing.turns) {
    matrix[turn.sourceIndex][turn.outputIndex] = turn.semitones;
  }
  return matrix;
}

export function graphFirstAudibleTapSeconds(
  graph,
  sourceSettings = {},
  sourceSwitches = null,
  { pitchReady = false } = {},
) {
  if (!graph?.nodes?.length) return 0;
  const settings = sanitizeGraphDelayAudioSettings(sourceSettings);
  const switches = enabledFlags(graph, sourceSwitches);
  const parameters = edgeAudioParameters(graph, settings);
  const arrivals = Array(graph.nodes.length).fill(Infinity);
  const entries = graph.entries?.length ? graph.entries : [0];
  const input = { x: settings.inputX, y: settings.inputY };
  for (const nodeId of entries) {
    arrivals[nodeId] = graphTerminalDelaySeconds(input, graph.nodes[nodeId], settings);
  }
  const visited = new Set();
  while (visited.size < graph.nodes.length) {
    let current = -1;
    for (const node of graph.nodes) {
      if (
        !visited.has(node.id)
        && Number.isFinite(arrivals[node.id])
        && (current < 0 || arrivals[node.id] < arrivals[current])
      ) current = node.id;
    }
    if (current < 0) break;
    visited.add(current);
    parameters.forEach((edge, index) => {
      if (edge.from !== current || !switches[index]) return;
      arrivals[edge.to] = Math.min(arrivals[edge.to], arrivals[current] + edge.delaySeconds);
    });
  }
  const first = Math.min(
    ...graphSinkNodeIds(graph).map((nodeId) => arrivals[nodeId]).filter(Number.isFinite),
  );
  return Number.isFinite(first) ? first + (pitchReady ? PITCH_PREROLL_SECONDS : 0) : 0;
}

export function sanitizeGraphDelayAudioSettings(source = {}) {
  const values = source && typeof source === "object" ? source : {};
  return Object.freeze({
    baseDelay: clamp(values.baseDelay, 20, 600, 62),
    distanceRatio: clamp(values.distanceRatio, 1, 12, 1.94),
    timeCurve: clamp(values.timeCurve, 0.25, 3, 0.9),
    nodePass: clamp(values.nodePass, 0, 1, 1),
    feedback: clamp(values.feedback, 0, 0.92, 0.72),
    damping: clamp(values.damping, 250, 14_000, 4_800),
    wet: clamp(values.wet, 0, 1.5, 1.08),
    dry: clamp(values.dry, 0, 1, 0.18),
    spread: clamp(values.spread, 0, 1, 0.82),
    inputTrim: clamp(values.inputTrim, 0, 1.5, 0.8),
    output: clamp(values.output ?? values.level, 0, 0.9, 0.58),
    pitchScale: clamp(values.pitchScale, 0, 2, 0.26),
    pitchAsymmetry: clamp(values.pitchAsymmetry, -0.8, 0.8, 0),
    pitchCurve: clamp(values.pitchCurve, 0.5, 2, 1.35),
    pitchSlew: clamp(values.pitchSlew, 10, 600, 165),
    inputX: clamp(values.inputX, 0.02, 0.98, 0.08),
    inputY: clamp(values.inputY, 0.02, 0.98, 0.5),
  });
}

/**
 * Live microphone realization of the shared directed graph.
 *
 * Structural edits are crossfaded; position, switch, time, pitch, and mix edits
 * update the running graph in place. Microphone permission is requested only
 * by start(), and close() always stops every captured MediaStream track.
 */
export class GraphDelayAudio {
  constructor(runtime = globalThis) {
    this.runtime = runtime;
    this.context = null;
    this.stream = null;
    this.source = null;
    this.analyser = null;
    this.graph = null;
    this.audioGraph = null;
    this.settings = sanitizeGraphDelayAudioSettings();
    this.switches = [];
    this.pitchProcessorReady = false;
    this.startPromise = null;
    this.generation = 0;
    this.retiring = new Set();
    this.retirementTimers = new Map();
    this.transition = null;
    this.queuedConfiguration = null;
    this.levelBuffer = new Float32Array(512);
  }

  get inputLevel() {
    if (!this.analyser?.getFloatTimeDomainData) return 0;
    if (this.levelBuffer.length !== this.analyser.fftSize) {
      this.levelBuffer = new Float32Array(this.analyser.fftSize);
    }
    this.analyser.getFloatTimeDomainData(this.levelBuffer);
    let peak = 0;
    for (const value of this.levelBuffer) peak = Math.max(peak, Math.abs(value));
    return clamp(peak, 0, 1, 0);
  }

  configure(graph, settings = {}, switches = null) {
    if (!graph?.nodes?.length) throw new TypeError("A non-empty graph is required.");
    const turnCount = graphTurnRoutings(graph, turnOptions(sanitizeGraphDelayAudioSettings(settings)))
      .reduce((count, routing) => count + routing.turns.length, 0);
    if (graph.nodes.length > MAX_LIVE_NODES || turnCount > MAX_GRAPH_TURN_ROUTES) {
      throw new RangeError(`Live mic graphs support up to ${MAX_LIVE_NODES} nodes and ${MAX_GRAPH_TURN_ROUTES} turn routes.`);
    }
    this.graph = graph;
    this.settings = sanitizeGraphDelayAudioSettings(settings);
    this.switches = enabledFlags(graph, switches);
  }

  async start({ graph = this.graph, settings = this.settings, switches = this.switches } = {}) {
    if (this.context?.state === "running" && this.stream && this.audioGraph) {
      this.update(graph, settings, switches);
      return this.context;
    }
    this.configure(graph, settings, switches);
    if (this.startPromise) return this.startPromise;
    const generation = ++this.generation;
    const promise = this.#startInternal(generation);
    this.startPromise = promise;
    try {
      return await promise;
    } finally {
      if (this.startPromise === promise) this.startPromise = null;
    }
  }

  async #startInternal(generation) {
    const AudioContextConstructor = this.runtime?.AudioContext ?? this.runtime?.webkitAudioContext;
    if (typeof AudioContextConstructor !== "function") {
      throw new Error("Web Audio is not available in this browser.");
    }
    const mediaDevices = this.runtime?.navigator?.mediaDevices;
    if (typeof mediaDevices?.getUserMedia !== "function") {
      throw new Error("Microphone input requires a secure browser context.");
    }
    const existingContext = this.context;
    if (
      existingContext
      && existingContext.state !== "closed"
      && this.stream
      && this.audioGraph
    ) {
      try { await existingContext.resume?.(); } catch { /* rebuild below */ }
      if (generation !== this.generation || existingContext !== this.context) {
        throw cancelledGraphDelayStart();
      }
      if (!existingContext.state || existingContext.state === "running") {
        this.update(this.graph, this.settings, this.switches);
        return existingContext;
      }
    }
    if (this.context || this.stream || this.audioGraph || this.retiring.size) {
      await this.#releaseCurrentResources();
      if (generation !== this.generation) throw cancelledGraphDelayStart();
    }
    const context = new AudioContextConstructor({ latencyHint: "interactive" });
    this.context = context;
    try {
      unlockAudioContext(context);
      await context.resume?.();
      if (
        generation !== this.generation
        || context !== this.context
        || context.state === "closed"
      ) throw cancelledGraphDelayStart();
      if (context.state && context.state !== "running") {
        throw new Error("Graph microphone audio could not resume.");
      }
      const pitchProcessorReady = await this.#preparePitchProcessor(context);
      if (
        generation !== this.generation
        || context !== this.context
        || context.state === "closed"
      ) throw cancelledGraphDelayStart();
      this.pitchProcessorReady = pitchProcessorReady;
      const audioGraph = this.#buildGraph(context, this.graph, this.settings, this.switches, 1);
      this.audioGraph = audioGraph;
      const stream = await mediaDevices.getUserMedia(audioInputConstraints(this.runtime));
      if (generation !== this.generation || context !== this.context || context.state === "closed") {
        for (const track of stream.getTracks?.() ?? []) track.stop();
        throw cancelledGraphDelayStart();
      }
      this.stream = stream;
      this.source = context.createMediaStreamSource(stream);
      this.analyser = context.createAnalyser();
      this.analyser.fftSize = 512;
      safeConnect(this.source, this.analyser);
      this.#connectInput(audioGraph);
      // Controls can move while the browser permission prompt is open. Apply
      // the latest shared graph once the stream arrives instead of reviving
      // the snapshot that happened to request permission.
      this.update(this.graph, this.settings, this.switches);
      return context;
    } catch (error) {
      if (generation === this.generation) await this.close();
      throw error;
    }
  }

  async #preparePitchProcessor(context) {
    const AudioWorkletNodeConstructor = this.runtime?.AudioWorkletNode
      ?? globalThis.AudioWorkletNode;
    if (!context.audioWorklet?.addModule || typeof AudioWorkletNodeConstructor !== "function") {
      return false;
    }
    try {
      await context.audioWorklet.addModule(new URL("./graph-turn-processor.js", import.meta.url));
      return true;
    } catch {
      return false;
    }
  }

  #connectInput(target) {
    if (!target || !this.analyser || !this.context) return;
    const trim = this.context.createGain();
    try {
      configureAudioInputNode(trim, this.runtime);
      trim.gain.value = this.settings.inputTrim;
      safeConnect(this.analyser, trim);
      safeConnect(trim, target.input);
      target.inputTrim = trim;
      target.owned.push(trim);
    } catch (error) {
      try { this.analyser.disconnect?.(trim); } catch { /* partial connection */ }
      safeDisconnect(trim);
      throw error;
    }
  }

  #buildGraph(context, graph, settings, switches, crossfadeGain) {
    const owned = [];
    const own = (node) => {
      owned.push(node);
      return node;
    };
    let releaseAudioOutput = null;
    try {
      const input = own(context.createGain());
      const dry = own(context.createGain());
      const wet = own(context.createGain());
      const output = own(context.createGain());
      const crossfade = own(context.createGain());
      const compressor = own(context.createDynamicsCompressor?.() ?? context.createGain());
      const clipper = own(context.createWaveShaper?.() ?? context.createGain());
      dry.gain.value = settings.dry;
      wet.gain.value = settings.wet;
      output.gain.value = settings.output;
      crossfade.gain.value = crossfadeGain;
      if (compressor.threshold) {
        compressor.threshold.value = -10;
        compressor.knee.value = 6;
        compressor.ratio.value = 6;
        compressor.attack.value = 0.008;
        compressor.release.value = 0.18;
      }
      if (clipper.curve !== undefined) {
        clipper.curve = softClipCurve();
        clipper.oversample = "2x";
      }

      const sinks = graphSinkNodeIds(graph);
      const sinkSet = new Set(sinks);
      const pans = graphNodePans(graph, sinks, settings.spread);
      const tapGain = graphAudibleTapGain(sinks.length);
      const nodes = graph.nodes.map((node) => {
        const sum = own(context.createGain());
        const tap = own(context.createGain());
        const pan = own(context.createStereoPanner?.() ?? context.createGain());
        tap.gain.value = sinkSet.has(node.id) ? tapGain : 0;
        if (pan.pan) pan.pan.value = pans[node.id];
        safeConnect(sum, tap);
        safeConnect(tap, pan);
        return { sum, tap, pan };
      });

      const parameters = edgeAudioParameters(graph, settings);
      const switchGains = graphEdgeSwitchMultipliers(graph, switches);
      const edges = parameters.map((edge, index) => {
        const inputBus = own(context.createGain());
        const switchGain = own(context.createGain());
        const delay = own(context.createDelay(MAX_DELAY_SECONDS));
        const gain = own(context.createGain());
        const filter = edge.feedbackEdge ? own(context.createBiquadFilter()) : null;
        switchGain.gain.value = switchGains[index];
        delay.delayTime.value = edge.delaySeconds;
        gain.gain.value = edge.gain;
        if (filter) {
          filter.type = "lowpass";
          filter.frequency.value = settings.damping;
          filter.Q.value = 0.45;
        }
        safeConnect(inputBus, switchGain);
        safeConnect(switchGain, delay);
        safeConnect(delay, gain);
        safeConnect(gain, filter ?? nodes[edge.to].sum);
        if (filter) safeConnect(filter, nodes[edge.to].sum);
        return { ...edge, inputBus, switchGain, delay, gain, filter, outputNode: filter ?? gain };
      });

      const entries = graph.entries?.length ? graph.entries : [0];
      const inputPosition = { x: settings.inputX, y: settings.inputY };
      const inputRoutes = entries.map((nodeId) => {
        const delay = own(context.createDelay(MAX_DELAY_SECONDS));
        const gain = own(context.createGain());
        delay.delayTime.value = graphTerminalDelaySeconds(inputPosition, graph.nodes[nodeId], settings);
        gain.gain.value = 1 / Math.sqrt(entries.length);
        safeConnect(input, delay);
        safeConnect(delay, gain);
        safeConnect(gain, nodes[nodeId].sum);
        return { nodeId, delay, gain };
      });
      const inputRouteByNode = new Map(inputRoutes.map((route) => [route.nodeId, route]));
      const AudioWorkletNodeConstructor = this.runtime?.AudioWorkletNode
        ?? globalThis.AudioWorkletNode;
      const routers = graph.nodes.map((node) => {
        const routing = nodeTurnRouting(graph, node.id, turnOptions(settings));
        if (!routing.outputs.length || !routing.sources.length) return { nodeId: node.id, routing };
        const sourceNode = (source) => source.kind === "input"
          ? inputRouteByNode.get(node.id)?.gain
          : edges[source.edgeId]?.outputNode;
        if (!this.pitchProcessorReady || typeof AudioWorkletNodeConstructor !== "function") {
          const gains = routing.turns.map((turn) => {
            const gain = own(context.createGain());
            gain.gain.value = 1;
            safeConnect(sourceNode(routing.sources[turn.sourceIndex]), gain);
            safeConnect(gain, edges[turn.nextEdgeId].inputBus);
            return gain;
          });
          return { nodeId: node.id, routing, gains };
        }
        const processor = own(new AudioWorkletNodeConstructor(context, "morphazoid-graph-turns", {
          numberOfInputs: routing.sources.length,
          numberOfOutputs: routing.outputs.length,
          outputChannelCount: Array(routing.outputs.length).fill(loadAudioInputSettings(this.runtime).inputChannels),
          channelCount: loadAudioInputSettings(this.runtime).inputChannels,
          channelCountMode: "explicit",
          processorOptions: {
            sourceCount: routing.sources.length,
            outputCount: routing.outputs.length,
            phaseSeed: node.id,
            channels: loadAudioInputSettings(this.runtime).inputChannels,
          },
        }));
        routing.sources.forEach((source, sourceIndex) => {
          safeConnect(sourceNode(source), processor, 0, sourceIndex);
        });
        routing.outputs.forEach((route, outputIndex) => {
          safeConnect(processor, edges[route.edgeId].inputBus, outputIndex, 0);
        });
        processor.port.postMessage({
          type: "turns",
          semitones: graphTurnSemitoneMatrix(routing),
          smoothingMs: settings.pitchSlew,
        });
        return { nodeId: node.id, routing, processor };
      });

      for (const nodeId of sinks) safeConnect(nodes[nodeId].pan, wet);
      safeConnect(input, dry);
      safeConnect(dry, output);
      safeConnect(wet, output);
      safeConnect(output, crossfade);
      safeConnect(crossfade, compressor);
      safeConnect(compressor, clipper);
      releaseAudioOutput = connectAudioOutput(context, clipper, { runtime: this.runtime });
      return {
        input,
        dry,
        wet,
        output,
        crossfade,
        compressor,
        clipper,
        nodes,
        edges,
        routers,
        inputRoutes,
        inputTrim: null,
        graph,
        settings,
        switches: [...switches],
        owned,
        releaseAudioOutput,
      };
    } catch (error) {
      releaseAudioOutput?.();
      for (const node of owned) safeDisconnect(node);
      throw error;
    }
  }

  #disposeGraph(target) {
    if (!target) return;
    if (this.retirementTimers.has(target)) {
      const retirementTimer = this.retirementTimers.get(target);
      const clearTimer = this.runtime?.clearTimeout ?? globalThis.clearTimeout;
      if (retirementTimer !== undefined) clearTimer?.(retirementTimer);
      this.retirementTimers.delete(target);
    }
    target.releaseAudioOutput?.();
    if (target.inputTrim) {
      try { this.analyser?.disconnect?.(target.inputTrim); } catch { /* already detached */ }
      try { this.source?.disconnect?.(target.inputTrim); } catch { /* direct-source fallback */ }
    }
    for (const node of target.owned ?? []) safeDisconnect(node);
    this.retiring.delete(target);
  }

  update(graph = this.graph, settings = this.settings, switches = this.switches) {
    const previousConfiguration = {
      graph: this.graph,
      settings: this.settings,
      switches: this.switches,
    };
    this.configure(graph, settings, switches);
    // While the permission prompt is open, configure() remains latest-state-
    // wins but no graph is replaced yet. The eventual stream is then connected
    // once to the still-current graph before the newest configuration is applied.
    if (
      !this.context
      || !this.audioGraph
      || !this.stream
      || !this.analyser
      || this.context.state === "closed"
    ) return;
    if (graphAudioTopologySignature(graph) !== graphAudioTopologySignature(this.audioGraph.graph)) {
      if (this.transition) {
        for (const target of [this.audioGraph, ...this.retiring]) {
          this.#applyParameters(
            target,
            target.graph,
            this.settings,
            this.#switchesForTarget(target, graph, this.switches),
          );
        }
        this.queuedConfiguration = {
          graph: this.graph,
          settings: this.settings,
          switches: [...this.switches],
        };
        return;
      }
      try {
        this.#replaceGraph();
      } catch (error) {
        this.graph = previousConfiguration.graph;
        this.settings = previousConfiguration.settings;
        this.switches = previousConfiguration.switches;
        throw error;
      }
      return;
    }
    // A return to the topology currently fading in supersedes any older queued
    // structural edit. This makes rapid shape scrubbing latest-state-wins.
    this.queuedConfiguration = null;
    this.#applyParameters(this.audioGraph, graph, this.settings, this.switches);
    for (const target of this.retiring) {
      this.#applyParameters(
        target,
        target.graph,
        this.settings,
        this.#switchesForTarget(target, graph, this.switches),
      );
    }
  }

  #switchesForTarget(target, requestedGraph, requestedSwitches) {
    const requested = new Map(
      requestedGraph.edges.map((edge, index) => [
        `${edge.from}>${edge.to}`,
        requestedSwitches[index] ?? true,
      ]),
    );
    return target.graph.edges.map((edge, index) => (
      requested.get(`${edge.from}>${edge.to}`) ?? target.switches[index] ?? true
    ));
  }

  #applyParameters(target, graph, settings, switches) {
    const now = this.context.currentTime;
    const parameters = edgeAudioParameters(graph, settings);
    const multipliers = graphEdgeSwitchMultipliers(graph, switches);
    const sinks = graphSinkNodeIds(graph);
    const sinkSet = new Set(sinks);
    const pans = graphNodePans(graph, sinks, settings.spread);
    const tapGain = graphAudibleTapGain(sinks.length);
    setTarget(target.dry.gain, settings.dry, now);
    setTarget(target.wet.gain, settings.wet, now);
    setTarget(target.output.gain, settings.output, now);
    // Never touch crossfade here: ordinary motion and knob updates must not
    // cancel a structural transition that is waiting for its first audible tap.
    setTarget(target.inputTrim?.gain, settings.inputTrim, now);
    target.edges.forEach((edge, index) => {
      setTarget(edge.delay.delayTime, parameters[index].delaySeconds, now, 0.03);
      setTarget(edge.gain.gain, parameters[index].gain, now, 0.03);
      ramp(edge.switchGain.gain, multipliers[index], now);
      setTarget(edge.filter?.frequency, settings.damping, now, 0.03);
    });
    target.nodes.forEach((node, index) => {
      setTarget(node.tap.gain, sinkSet.has(index) ? tapGain : 0, now, 0.03);
      setTarget(node.pan?.pan, pans[index], now, 0.03);
    });
    target.routers.forEach((router) => {
      if (!router.processor) return;
      const routing = nodeTurnRouting(graph, router.nodeId, turnOptions(settings));
      router.processor.port.postMessage({
        type: "turns",
        semitones: graphTurnSemitoneMatrix(routing),
        smoothingMs: settings.pitchSlew,
      });
    });
    const inputPosition = { x: settings.inputX, y: settings.inputY };
    target.inputRoutes.forEach((route) => {
      setTarget(
        route.delay.delayTime,
        graphTerminalDelaySeconds(inputPosition, graph.nodes[route.nodeId], settings),
        now,
        0.035,
      );
    });
    Object.assign(target, {
      graph,
      settings,
      switches: [...switches],
    });
  }

  #replaceGraph() {
    const context = this.context;
    const previous = this.audioGraph;
    let next = null;
    try {
      next = this.#buildGraph(context, this.graph, this.settings, this.switches, 0);
      this.#connectInput(next);
    } catch (error) {
      this.#disposeGraph(next);
      throw error;
    }
    this.audioGraph = next;
    const now = context.currentTime;
    const preRoll = graphFirstAudibleTapSeconds(
      this.graph,
      this.settings,
      this.switches,
      { pitchReady: this.pitchProcessorReady && this.settings.pitchScale > 0 },
    );
    const startsAt = now + preRoll;
    const endsAt = startsAt + CROSSFADE_SECONDS;
    rampWindow(previous.crossfade.gain, finite(previous.crossfade.gain.value, 1), 0, now, startsAt, endsAt);
    rampWindow(next.crossfade.gain, 0, 1, now, startsAt, endsAt);
    this.retiring.add(previous);
    const transition = { context, previous, next, endsAt, timerId: null };
    this.transition = transition;
    const finish = () => {
      if (this.transition !== transition) {
        this.#disposeGraph(previous);
        return;
      }
      const remainsCurrent = context === this.context
        && context.state !== "closed"
        && this.audioGraph === next;
      const remaining = endsAt - context.currentTime;
      if (remainsCurrent && remaining > 0.005) {
        this.#scheduleTransitionFinish(transition, Math.max(0.016, remaining + 0.008));
        return;
      }
      if (remainsCurrent) {
        const settledAt = context.currentTime;
        rampWindow(previous.crossfade.gain, 0, 0, settledAt, settledAt, settledAt);
        rampWindow(next.crossfade.gain, 1, 1, settledAt, settledAt, settledAt);
      }
      this.transition = null;
      this.#disposeGraph(previous);
      const queued = this.queuedConfiguration;
      this.queuedConfiguration = null;
      if (queued && remainsCurrent) {
        try {
          this.update(queued.graph, queued.settings, queued.switches);
        } catch (error) {
          this.runtime?.console?.error?.("Queued Graphs microphone update failed", error);
        }
      }
    };
    transition.finish = finish;
    this.#scheduleTransitionFinish(
      transition,
      preRoll + CROSSFADE_SECONDS + 0.03,
    );
  }

  #scheduleTransitionFinish(transition, delaySeconds) {
    const timer = this.runtime?.setTimeout ?? globalThis.setTimeout;
    const timerId = timer(transition.finish, Math.ceil(delaySeconds * 1_000));
    transition.timerId = timerId;
    this.retirementTimers.set(transition.previous, timerId);
  }

  setOutput(value) {
    this.settings = sanitizeGraphDelayAudioSettings({ ...this.settings, output: value });
    if (!this.context || !this.audioGraph) return;
    for (const target of [this.audioGraph, ...this.retiring]) {
      setTarget(target.output.gain, this.settings.output, this.context.currentTime);
      target.settings = this.settings;
    }
  }

  silence() {
    if (!this.context || !this.audioGraph) return;
    for (const target of [this.audioGraph, ...this.retiring]) {
      ramp(target.crossfade.gain, 0, this.context.currentTime, 0.035);
    }
  }

  async #releaseCurrentResources() {
    const context = this.context;
    this.context = null;
    this.transition = null;
    this.queuedConfiguration = null;
    for (const track of this.stream?.getTracks?.() ?? []) track.stop();
    this.stream = null;
    safeDisconnect(this.source);
    safeDisconnect(this.analyser);
    this.source = null;
    this.analyser = null;
    this.#disposeGraph(this.audioGraph);
    this.audioGraph = null;
    for (const target of [...this.retiring]) this.#disposeGraph(target);
    this.pitchProcessorReady = false;
    if (context && context.state !== "closed") {
      try { await context.close?.(); } catch { /* resources above are already detached */ }
    }
  }

  async close() {
    this.generation += 1;
    this.startPromise = null;
    await this.#releaseCurrentResources();
  }
}
