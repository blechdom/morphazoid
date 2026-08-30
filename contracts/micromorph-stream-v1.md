# Micromorph local model stream v1

Micromorph treats a generative audio model as a replaceable local process. The
browser owns microphone permission, controls, visualization, bounded buffering,
and final audio output. The model host owns inference and model state. They use
the **Morphazoid Generative Audio stream**, protocol `mga-stream/1`, version `1`,
over a loopback-only WebSocket.

This is a Morphazoid adapter contract, not the private protocol of any model
project. A backend may use a distilled diffusion model, consistency/flow model,
neural codec transformer, DDSP system, or another engine only if it can satisfy
the causal streaming capabilities below. An ordinary offline clip generator is
not made realtime by placing this adapter in front of it.

## Realtime boundary

- The browser requests mono input and stereo output at the actual Web Audio
  sample rate. This geometry is authoritative and immutable for one connection.
  A host accepts it exactly or rejects the handshake; it never silently changes
  rate, block size, channels, PCM format, or controls.
- AudioWorklet rendering never waits for inference, JSON, or a socket. It copies
  bounded mic blocks out and consumes bounded returned PCM from a ring buffer.
- A stable model stream bypasses the rehearsal DSP. At startup or underrun,
  Micromorph crossfades over 8 ms to its deterministic spectral rehearsal and
  labels that fallback as non-neural.
- Input transport has a default four-block queue budget. Once it is full, whole
  input blocks are dropped and reported as an explicit sample-clock gap. The
  client does not accumulate seconds of mic latency merely to remain lossless.
- The current browser requests 1,024-frame mic blocks and accepts model packets
  no larger than the acknowledged output hop or the renderer's 4,096-frame hard
  limit. A host may use a larger overlapping inference window internally.

## Connection and local safety

The browser accepts only `ws://` or `wss://` URLs whose host is `localhost`, a
`.localhost` name, IPv6 loopback, or `127.0.0.0/8`. Credentials and fragments
are rejected. A short-lived session token may be supplied as a query parameter;
the client removes the query from public status and Micromorph never persists it
to local storage.

A production host should bind to loopback, validate HTTP `Origin`, cap message
sizes and connection counts, and require an unguessable session token. Do not
expose a development model server that binds to all interfaces or accepts
wildcard origins. The page cancels or stops microphone capture when it becomes
hidden, when Escape is pressed, or when the page exits—even when permission is
still pending.

## Three-step readiness

Opening a socket is not evidence that compatible inference exists. Micromorph
becomes ready only after this ordered exchange completes within ten seconds:

1. Client `hello` and browser-owned `config`.
2. Compatible server `hello`, then `config-accepted` echoing that exact config.
3. Server `model-ready` at sample frame zero.

The client opens with:

```json
{
  "type": "hello",
  "protocol": "mga-stream/1",
  "version": 1,
  "role": "client",
  "sequence": 1,
  "streamGeneration": 1,
  "client": { "name": "Morphazoid Micromorph", "version": "1" },
  "capabilities": {
    "causalTransform": true,
    "textAnchors": true,
    "controlCurves": true,
    "framedPcm": true,
    "sampleClock": true,
    "pcmInput": true,
    "pcmOutput": true,
    "pcmFormat": "f32le"
  }
}
```

```json
{
  "type": "config",
  "sequence": 2,
  "streamGeneration": 1,
  "config": {
    "sampleRate": 48000,
    "blockSize": 1024,
    "inputChannels": 1,
    "outputChannels": 2,
    "pcmFormat": "f32le",
    "controls": [
      { "id": "derivation", "defaultValue": 0.56 },
      { "id": "material", "defaultValue": 0.5 },
      { "id": "structure_lock", "defaultValue": 0.74 },
      { "id": "memory", "defaultValue": 0.62 },
      { "id": "mutation", "defaultValue": 0.22 },
      { "id": "continuation", "defaultValue": 0.2 }
    ]
  }
}
```

The server hello echoes `protocol`, `version`, and `streamGeneration`, uses role
`server` or `model`, and explicitly declares all capabilities above. Capability
claims are conformance promises, not decorative metadata.

The server then accepts the exact config. `outputHopFrames` is an integer from
`1` through the requested `blockSize`; `algorithmicLatencyFrames` is an integer
from `0` through 60 seconds at the requested sample rate:

```json
{
  "type": "config-accepted",
  "streamGeneration": 1,
  "replyTo": 2,
  "modelId": "my-causal-audio-model",
  "algorithmicLatencyFrames": 4096,
  "outputHopFrames": 1024,
  "config": {
    "sampleRate": 48000,
    "blockSize": 1024,
    "inputChannels": 1,
    "outputChannels": 2,
    "pcmFormat": "f32le",
    "controls": [
      { "id": "derivation", "defaultValue": 0.56 },
      { "id": "material", "defaultValue": 0.5 },
      { "id": "structure_lock", "defaultValue": 0.74 },
      { "id": "memory", "defaultValue": 0.62 },
      { "id": "mutation", "defaultValue": 0.22 },
      { "id": "continuation", "defaultValue": 0.2 }
    ]
  }
}
```

`config` must exactly repeat the requested configuration. Finally:

```json
{ "type": "model-ready", "streamGeneration": 1, "startFrame": 0 }
```

Any handshake version, capability, order, generation, or config mismatch is
fatal. The client enters `error`, rejects the pending connection, and closes
with WebSocket code `1002`. `connect()` resolves only after `model-ready`.

## One sample clock

PCM, conditions, and automation all refer to integer sample frames starting at
zero for each `streamGeneration`. There is no independent wall-clock timestamp.

Text anchors describe two ends of one timbral lineage. Material is deliberately
not duplicated in this frame; the continuous `material` control owns that value:

```json
{
  "type": "condition",
  "sequence": 3,
  "streamGeneration": 1,
  "startFrame": 0,
  "condition": {
    "anchors": {
      "a": "wet ceramic throat and close breath",
      "b": "fractured glass lung singing in a small chamber"
    }
  }
}
```

Automation uses replacement curves:

```json
{
  "type": "control-curve",
  "sequence": 4,
  "streamGeneration": 1,
  "startFrame": 2048,
  "mode": "replace",
  "curves": [
    { "id": "derivation", "interpolation": "linear", "points": [{ "offsetFrames": 0, "value": 0.71 }] },
    { "id": "mutation", "interpolation": "linear", "points": [{ "offsetFrames": 0, "value": 0.18 }] }
  ]
}
```

Every curve begins at `offsetFrames: 0`, offsets are strictly increasing, and
values are normalized to `[0, 1]`. A new curve replaces that control's future
automation from `startFrame`; points interpolate linearly and the last point is
held until another replacement arrives. Frames and point offsets are monotonic.

Suggested adapter semantics:

- `derivation`: inference distance/noise or inverse source adherence.
- `material`: interpolation between anchor A and B embeddings or references.
- `structure_lock`: preservation of source timing, envelope, and articulation.
- `memory`: temporal context or recurrent/latent-state persistence.
- `mutation`: seed drift, temperature, or latent perturbation.
- `continuation`: permission to continue after input energy falls.

An adapter must publish its exact mapping because these are musical meanings,
not promises about one network architecture.

## Framed PCM

Every binary message is one `MGA1` packet followed by interleaved little-endian
Float32 PCM. The fixed 32-byte header is little-endian where a field spans more
than one byte:

| Offset | Size | Field |
| ---: | ---: | --- |
| 0 | 4 | ASCII-equivalent magic `MGA1` (`0x3141474d` as little-endian u32) |
| 4 | 1 | packet version, `1` |
| 5 | 1 | kind: `1` input, `2` output |
| 6 | 1 | channel count |
| 7 | 1 | flags, zero in v1 |
| 8 | 4 | unsigned `streamGeneration` |
| 12 | 4 | unsigned PCM packet sequence, beginning at `1` |
| 16 | 8 | unsigned safe-integer `startFrame` |
| 24 | 4 | unsigned frame count |
| 28 | 4 | unsigned sample rate |
| 32 | ... | interleaved f32le payload |

Packet sample counts must equal `frameCount * channels`; samples must be finite.
Input sequences advance even when a block is dropped. Output packets begin with
sequence `1` and start frame `0`, remain contiguous, use the acknowledged output
hop or less, and keep the accepted geometry.

When backpressure drops one or more contiguous input packets, the next send first
emits an aggregated JSON gap marker:

```json
{
  "type": "input-gap",
  "sequence": 8,
  "streamGeneration": 1,
  "reason": "backpressure",
  "startFrame": 4096,
  "frameCount": 2048,
  "firstPcmSequence": 5,
  "lastPcmSequence": 6
}
```

The host advances its input timeline across that range and chooses silence,
state reset, or model-specific concealment. It must not concatenate surrounding
PCM and thereby compress musical time.

## Status, errors, and model adapters

A server may send bounded `status` JSON containing `level`, `code`, `message`,
`progress`, `sampleFrame`, or `sequence`. At least one field beyond `level` is
required. The client exposes the latest status. A server `error` is fatal.
Malformed post-ready control/status frames and wrong-generation post-ready
control or PCM packets are reported and dropped; handshake, config, and
remote-error failures close the connection.

A conforming adapter must:

- perform a real causal/streaming transform rather than return pre-generated
  clips;
- apply controls and conditions on the shared sample timeline;
- report measured algorithmic latency and output hop honestly;
- preserve output order while applying TCP/WebSocket backpressure instead of
  hiding an unbounded inference queue;
- keep model-specific code, weights, licensing, and accelerator selection behind
  this boundary.

Some research systems remain valuable inputs without being direct adapters. A
predictive buffer-remix model can become a separate delayed duet instrument, and
an offline diffusion system can become a loop breeder, but neither should claim
`causalTransform: true` for this realtime mic effect.
