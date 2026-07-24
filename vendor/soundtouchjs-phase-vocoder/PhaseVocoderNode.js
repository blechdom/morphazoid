/*
 * SoundTouch JS audio processing library
 * Copyright (c) Steve 'Cutter' Blades
 *
 * Licensed under the Mozilla Public License, v. 2.0.
 * You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import { DEFAULT_SAMPLE_BUFFER_TYPE, PROCESSOR_NAME } from './constants.js';
/**
 * Main-thread AudioWorkletNode wrapper using a phase vocoder time-stretch algorithm.
 *
 * @remarks
 * Wraps `PhaseVocoderProcessor` in the render thread. Provides the same AudioParam
 * accessors and runtime control methods as `SoundTouchNode`, with additional
 * `fftSize` and `overlapFactor` constructor options for tuning the FFT stage.
 *
 * The phase vocoder produces smoother results than WSOLA at extreme ratios (> 2×)
 * at the cost of higher per-frame computation and inherent `fftSize`-sample latency.
 *
 * @example
 * ```ts
 * import { PhaseVocoderNode } from '@soundtouchjs/phase-vocoder-worklet';
 *
 * await PhaseVocoderNode.register(audioCtx, processorUrl);
 * const node = new PhaseVocoderNode({ context: audioCtx, fftSize: 1024 });
 * node.pitch.value = 1.5;
 * ```
 */
export class PhaseVocoderNode extends AudioWorkletNode {
    /**
     * The registered processor name for this node type.
     */
    static processorName = PROCESSOR_NAME;
    /**
     * Registers the phase vocoder processor module with the given AudioContext.
     *
     * @remarks
     * Must be called before creating `PhaseVocoderNode` instances. Loads the
     * processor script into the AudioWorklet global scope.
     *
     * @param context - The AudioContext or OfflineAudioContext
     * @param processorUrl - URL or path to the processor bundle
     */
    static async register(context, processorUrl) {
        await context.audioWorklet.addModule(processorUrl);
    }
    /**
     * Registers an interpolation strategy installer module in AudioWorkletGlobalScope.
     *
     * @remarks
     * The module should call core registration APIs during evaluation.
     * Loads a strategy plugin for use in the render-thread processor.
     */
    static async registerStrategyModule(context, strategyModuleUrl) {
        await context.audioWorklet.addModule(strategyModuleUrl);
    }
    _lastMetrics = null;
    /**
     * Creates a `PhaseVocoderNode` instance.
     * @param options - Node and processor configuration.
     */
    constructor({ context, sampleBufferType, interpolationStrategy, fftSize, overlapFactor, outputChannelCount, }) {
        super(context, PROCESSOR_NAME, {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [outputChannelCount ?? 2],
            processorOptions: {
                sampleBufferType: sampleBufferType ?? DEFAULT_SAMPLE_BUFFER_TYPE,
                interpolationStrategy,
                fftSize: fftSize ?? 2048,
                overlapFactor: overlapFactor ?? 4,
            },
        });
        this.port.onmessage = (event) => {
            const message = event.data;
            if (message?.type === 'metrics') {
                const metrics = {
                    framesBuffered: message.framesBuffered,
                    underrunCount: message.underrunCount,
                    blockCount: message.blockCount,
                    outputRms: message.outputRms,
                    outputPeak: message.outputPeak,
                    timestamp: performance.now(),
                };
                this._lastMetrics = metrics;
                this.dispatchEvent(new CustomEvent('metrics', { detail: metrics }));
            }
        };
    }
    /**
     * Returns the most recent processor metrics snapshot, or `null` if no metrics have been received yet.
     *
     * @remarks
     * Updated every 100 render blocks by the processor. Also dispatched as a `metrics` CustomEvent.
     *
     * @example
     * node.addEventListener('metrics', (e) => {
     *   console.log((e as CustomEvent<ProcessorMetrics>).detail.underrunCount);
     * });
     */
    get metrics() {
        return this._lastMetrics;
    }
    /**
     * Starts a fresh cumulative health window without resetting the DSP state.
     */
    resetMetrics() {
        this._lastMetrics = {
            framesBuffered: 0,
            underrunCount: 0,
            blockCount: 0,
            outputRms: 0,
            outputPeak: 0,
            timestamp: performance.now(),
        };
        this.port.postMessage({ type: 'reset-metrics' });
    }
    /**
     * Pitch multiplier AudioParam (1.0 = original pitch).
     * @returns The AudioParam controlling pitch.
     */
    get pitch() {
        return this.parameters.get('pitch');
    }
    /**
     * Pitch shift in semitones AudioParam (integer steps for musical key changes).
     * @returns The AudioParam controlling pitch in semitones.
     */
    get pitchSemitones() {
        return this.parameters.get('pitchSemitones');
    }
    /**
     * Playback rate AudioParam. Set this to the same value as the source node's
     * `playbackRate` so the processor can compensate pitch for tempo changes.
     * @returns The AudioParam controlling playback rate.
     */
    get playbackRate() {
        return this.parameters.get('playbackRate');
    }
    /**
     * Switches interpolation strategy at runtime in the render-thread processor.
     * @param strategy The new interpolation strategy to use.
     */
    setInterpolationStrategy(strategy) {
        this.port.postMessage({
            type: 'set-interpolation-strategy',
            strategy,
        });
    }
    /**
     * Applies a partial params update to the active interpolation strategy.
     * @param params Partial set of parameters to update.
     */
    setInterpolationStrategyParams(params) {
        this.port.postMessage({
            type: 'set-interpolation-strategy-params',
            params,
        });
    }
    /**
     * Applies WSOLA timing parameter updates to the render-thread processor.
     *
     * @remarks
     * The update is queued and applied at the next render-block boundary. For the
     * phase vocoder, these parameters are no-ops (timing is controlled by `fftSize`
     * and `overlapFactor`). This method exists for API parity with `SoundTouchNode`.
     *
     * @param params WSOLA timing parameters to apply.
     */
    setStretchParameters(params) {
        this.port.postMessage({
            type: 'set-stretch-parameters',
            params,
        });
    }
}
//# sourceMappingURL=PhaseVocoderNode.js.map
