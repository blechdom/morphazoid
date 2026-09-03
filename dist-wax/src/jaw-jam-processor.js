import {
  JAW_HARP_LIMITS,
  sanitizeJawHarpState,
} from "./jaw-harp.js";
import { JawHarpPhysicalProcessor } from "./jaw-harp-processor.js";

const SEQUENCE_ACTIONS = new Set(["pluck", "sustain", "rest"]);
const MAX_FALLBACK_DELAY_SECONDS = 60;

const finiteOr = (value, fallback) => (
  Number.isFinite(Number(value)) ? Number(value) : fallback
);

const clamp = (value, minimum, maximum) => (
  Math.min(maximum, Math.max(minimum, finiteOr(value, minimum)))
);

function workletFrame(rate) {
  const explicitFrame = Number(globalThis.currentFrame);
  if (Number.isFinite(explicitFrame)) return Math.max(0, Math.round(explicitFrame));
  const explicitTime = Number(globalThis.currentTime);
  return Number.isFinite(explicitTime)
    ? Math.max(0, Math.round(explicitTime * rate))
    : 0;
}

function sequenceGeneration(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.max(0, Math.trunc(numeric))
    : Math.max(0, Math.trunc(finiteOr(fallback, 0)));
}

function sliceAudioBuses(buses, start, end) {
  return buses.map((bus) => bus.map((channel) => channel.subarray(start, end)));
}

/**
 * A sample-timed sequencer shell around the stable Jaw Harp physical model.
 *
 * The base worklet deliberately keeps its live performance messages immediate.
 * Jaw Jam adds a separate, versioned queue so a UI-thread lookahead scheduler
 * can send complete steps early without retargeting the sounding reed early.
 */
class JawJamPhysicalProcessor extends JawHarpPhysicalProcessor {
  constructor(options = {}) {
    super(options);
    this.sequenceQueue = [];
    this.sequenceOrder = 0;
    this.sequenceGeneration = sequenceGeneration(
      options.processorOptions?.generation,
      0,
    );
    this.sequenceRenderedFrames = workletFrame(this.rate);
    this.port.onmessage = (event) => this._handleJawJamMessage(event.data);
  }

  _handleJawJamMessage(message = {}) {
    if (!message || typeof message !== "object") return;
    if (message.type === "sequence-event") {
      this._queueSequenceEvent(message);
      return;
    }
    if (message.type === "drop-scheduled") {
      this._invalidateSequence(message.generation);
      return;
    }
    if (message.type === "panic") {
      this._invalidateSequence(message.generation);
      this._silence();
      return;
    }
    super._handleMessage(message);
  }

  _invalidateSequence(requestedGeneration) {
    const requested = Number.isFinite(Number(requestedGeneration))
      ? sequenceGeneration(requestedGeneration)
      : this.sequenceGeneration + 1;
    // A caller normally supplies its newly incremented generation. If it
    // repeats the current generation, advance once so late messages from that
    // generation cannot repopulate the cleared queue.
    this.sequenceGeneration = requested > this.sequenceGeneration
      ? requested
      : this.sequenceGeneration + 1;
    this.sequenceQueue.length = 0;
  }

  _queueSequenceEvent(message) {
    const action = String(message.action ?? "").toLowerCase();
    if (!SEQUENCE_ACTIONS.has(action)) return false;

    const generation = sequenceGeneration(message.generation, this.sequenceGeneration);
    if (generation < this.sequenceGeneration) return false;
    if (generation > this.sequenceGeneration) {
      this.sequenceGeneration = generation;
      this.sequenceQueue.length = 0;
    }

    const observedFrame = Math.max(this.sequenceRenderedFrames, workletFrame(this.rate));
    const requestedWhen = Number(message.when);
    const dueFrame = Number.isFinite(requestedWhen)
      ? Math.max(0, Math.round(requestedWhen * this.rate))
      : observedFrame + Math.round(
        clamp(
          message.delaySeconds,
          0,
          MAX_FALLBACK_DELAY_SECONDS,
        ) * this.rate,
      );
    const configuration = sanitizeJawHarpState(
      message.configuration ?? {},
      this.targetConfiguration,
    );
    const strikeSource = message.strike && typeof message.strike === "object"
      ? message.strike
      : message;
    const strike = Object.freeze({
      force: clamp(
        finiteOr(strikeSource.force, configuration.pluckForce),
        JAW_HARP_LIMITS.pluckForce[0],
        JAW_HARP_LIMITS.pluckForce[1],
      ),
      direction: finiteOr(strikeSource.direction, configuration.pluckDirection) < 0 ? -1 : 1,
      position: clamp(
        finiteOr(strikeSource.position, configuration.pluckPosition),
        JAW_HARP_LIMITS.pluckPosition[0],
        JAW_HARP_LIMITS.pluckPosition[1],
      ),
    });
    const event = Object.freeze({
      generation,
      stepIndex: Math.max(0, Math.trunc(finiteOr(message.stepIndex, 0))),
      action,
      dueFrame,
      when: dueFrame / this.rate,
      order: this.sequenceOrder,
      configuration: Object.freeze({ ...configuration }),
      strike,
    });
    this.sequenceOrder += 1;
    this.sequenceQueue.push(event);
    this.sequenceQueue.sort((left, right) => (
      left.dueFrame - right.dueFrame || left.order - right.order
    ));
    return true;
  }

  _applyConfigurationSnapshot(configuration) {
    const snapshot = sanitizeJawHarpState(configuration, this.targetConfiguration);
    // Assign both sides of the base processor's smoothing pair. This makes the
    // queued snapshot atomic at its requested frame while leaving the live
    // `configure` message's intentionally gentle 12 ms interpolation intact.
    this.configuration = { ...snapshot };
    this.targetConfiguration = { ...snapshot };
    this._updateCoefficients();
    return snapshot;
  }

  _applySequenceEvent(event, appliedFrame) {
    if (event.generation !== this.sequenceGeneration) return false;
    if (event.action === "rest") {
      this._silence();
    } else {
      this._applyConfigurationSnapshot(event.configuration);
      if (event.action === "pluck") {
        this._pluck(
          event.strike.force,
          event.strike.direction,
          event.strike.position,
          false,
          false,
          true,
        );
      }
      // A sustain is a virtual retarget of the same monophonic reed. Updating
      // coefficients above changes material, pitch, vowel, focus, and breath,
      // but deliberately leaves every modal amplitude and phase untouched.
    }
    this.port.postMessage({
      type: "sequence-step",
      generation: event.generation,
      stepIndex: event.stepIndex,
      action: event.action,
      when: event.when,
      scheduledFrame: event.dueFrame,
      appliedFrame,
      lateFrames: Math.max(0, appliedFrame - event.dueFrame),
    });
    return true;
  }

  _applyDueSequenceEvents(frame) {
    while (this.sequenceQueue[0]?.dueFrame <= frame) {
      const event = this.sequenceQueue.shift();
      this._applySequenceEvent(event, frame);
    }
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    if (!output?.[0]) return super.process(inputs, outputs, parameters);
    const frameCount = output[0].length;
    const observedFrame = workletFrame(this.rate);
    const blockStartFrame = Math.max(this.sequenceRenderedFrames, observedFrame);
    const blockEndFrame = blockStartFrame + frameCount;
    let cursor = 0;

    while (cursor < frameCount) {
      const absoluteFrame = blockStartFrame + cursor;
      this._applyDueSequenceEvents(absoluteFrame);
      const nextDueFrame = this.sequenceQueue[0]?.dueFrame ?? blockEndFrame;
      const segmentEnd = Math.min(
        frameCount,
        Math.max(cursor, nextDueFrame - blockStartFrame),
      );
      if (segmentEnd > cursor) {
        super.process(
          sliceAudioBuses(inputs, cursor, segmentEnd),
          sliceAudioBuses(outputs, cursor, segmentEnd),
          parameters,
        );
        cursor = segmentEnd;
      }
    }

    this.sequenceRenderedFrames = blockEndFrame;
    return true;
  }
}

registerProcessor("jaw-jam-physical-model", JawJamPhysicalProcessor);

export { JawJamPhysicalProcessor };
