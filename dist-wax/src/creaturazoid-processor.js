import { SyrinxPhysicalProcessor } from "./syrinx-processor.js?v=creaturazoid-body-20260902-3";

const integer = (value, minimum, maximum, fallback = minimum) => {
  const number = Number(value);
  return Math.min(maximum, Math.max(
    minimum,
    Number.isFinite(number) ? Math.round(number) : fallback,
  ));
};

const clamp = (value, minimum = 0, maximum = 1) => {
  const number = Number(value);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(number) ? number : minimum));
};

function curveValue(points, phase) {
  if (!Array.isArray(points) || points.length === 0) return 0;
  const x = clamp(phase);
  if (x <= points[0][0]) return Number(points[0][1]) || 0;
  for (let index = 1; index < points.length; index += 1) {
    const left = points[index - 1];
    const right = points[index];
    if (x <= right[0]) {
      const amount = clamp((x - left[0]) / Math.max(1e-9, right[0] - left[0]));
      const smooth = amount * amount * (3 - 2 * amount);
      return (Number(left[1]) || 0) + ((Number(right[1]) || 0) - (Number(left[1]) || 0)) * smooth;
    }
  }
  return Number(points.at(-1)?.[1]) || 0;
}

function bandpassState(frequencyHz, quality, rate) {
  const frequency = clamp(frequencyHz, 20, rate * 0.45);
  const q = clamp(quality, 0.45, 8);
  const omega = Math.PI * 2 * frequency / rate;
  const alpha = Math.sin(omega) / (2 * q);
  const normalization = 1 / (1 + alpha);
  return {
    b0: alpha * normalization,
    b2: -alpha * normalization,
    a1: -2 * Math.cos(omega) * normalization,
    a2: (1 - alpha) * normalization,
    inputOne: 0,
    inputTwo: 0,
    outputOne: 0,
    outputTwo: 0,
  };
}

function renderBandpass(input, filter) {
  const output = filter.b0 * input
    + filter.b2 * filter.inputTwo
    - filter.a1 * filter.outputOne
    - filter.a2 * filter.outputTwo;
  filter.inputTwo = filter.inputOne;
  filter.inputOne = input;
  filter.outputTwo = filter.outputOne;
  filter.outputOne = Number.isFinite(output) ? output : 0;
  return filter.outputOne;
}

/**
 * One scheduled wrapper around the Hybrinx/Syrinx physical voice.
 *
 * The wrapped processor still owns exactly one nonlinear source bank with its
 * voice count pinned to one and one travelling-wave tract. A sequence event is
 * a series of sample-addressed configurations for that same body. When a newer
 * event begins, any remaining contour points from the displaced call are
 * ignored instead of being layered over the new animal.
 */
class CreaturazoidPhysicalProcessor extends SyrinxPhysicalProcessor {
  constructor(options = {}) {
    super(options);
    this.creatureQueue = [];
    this.creatureOrder = 0;
    this.activeCreatureSerial = -1;
    this.creatureContact = null;
    this.creatureContactVoices = [];
    this.creatureContactNoiseState = 0xc7ea7e;
    this.creatureContactLowpass = 0;
    this.creatureContactLeft = 0;
    this.creatureContactRight = 0;
    this.creatureMakeupGain = 1;
    this.creatureMakeupTarget = 1;
    this.creatureMakeupRampFrames = Math.max(1, Math.round(this.workletRate * 0.0005));
    this.creatureMakeupDelayRemaining = 0;
    this.creatureMakeupRampRemaining = 0;
    this.creatureMakeupRampStep = 0;
    this.creatureAttackTransitionFrames = Math.max(1, Math.round(this.workletRate * 0.002));
    this.port.onmessage = (event) => this._handleCreatureMessage(event.data);
  }

  _handleCreatureMessage(message = {}) {
    if (!message || typeof message !== "object") return;
    if (message.type === "schedule") {
      const events = Array.isArray(message.events) ? message.events : [];
      for (const event of events) {
        if (!event?.configuration) continue;
        const queuedEvent = {
          frame: integer(event.frame, 0, Number.MAX_SAFE_INTEGER, 0),
          serial: integer(event.serial, 0, Number.MAX_SAFE_INTEGER, 0),
          begin: Boolean(event.begin),
          soundId: String(event.soundId || ""),
          label: String(event.label || ""),
          velocity: clamp(event.velocity ?? 1),
          sequenced: Boolean(event.sequenced ?? event.rhythmic),
          makeupGain: clamp(event.makeupGain ?? 1, 0.36, 7),
          bodyGainTrim: clamp(event.bodyGainTrim ?? 1, 1, 3.75),
          contact: event.contact && typeof event.contact === "object" ? event.contact : null,
          configuration: event.configuration,
          order: this.creatureOrder,
        };
        this.creatureOrder += 1;
        if (queuedEvent.begin) {
          // This remains one physical body even while the host schedules ahead:
          // a newer gesture owns every frame from its onset onward. Pruning the
          // displaced tail also keeps dense, high-resolution LFO contours from
          // accumulating as inaudible work in the render queue.
          this.creatureQueue = this.creatureQueue.filter((candidate) => (
            candidate.serial >= queuedEvent.serial
              || candidate.frame < queuedEvent.frame
          ));
        }
        this.creatureQueue.push(queuedEvent);
      }
      this.creatureQueue.sort((left, right) => (
        left.frame - right.frame || left.order - right.order
      ));
      return;
    }
    if (message.type === "silence") {
      this.creatureQueue.length = 0;
      this._clearCreatureContact();
      // Silence has no following attack that needs an immediate downward
      // correction, so de-click any boosted live tail. Never turn an already
      // attenuated tail upward merely to restore an idle bookkeeping value.
      this.creatureMakeupTarget = Math.min(1, this.creatureMakeupGain);
      if (this.creatureMakeupTarget < this.creatureMakeupGain) {
        this.creatureMakeupDelayRemaining = 0;
        this.creatureMakeupRampRemaining = this.creatureMakeupRampFrames;
        this.creatureMakeupRampStep = (
          this.creatureMakeupTarget - this.creatureMakeupGain
        ) / this.creatureMakeupRampFrames;
      } else {
        this.creatureMakeupDelayRemaining = 0;
        this.creatureMakeupRampRemaining = 0;
        this.creatureMakeupRampStep = 0;
      }
      this.activeCreatureSerial = Math.max(
        this.activeCreatureSerial + 1,
        integer(message.serial, 0, Number.MAX_SAFE_INTEGER, 0),
      );
      this._handleMessage({
        type: "configure",
        source: { ...(message.source ?? {}), pressure: 0, voiceCount: 1 },
        tract: message.tract ?? {},
        resetTract: false,
      });
      this.port.postMessage({ type: "creature-event", active: false, serial: this.activeCreatureSerial });
      return;
    }
    if (message.type === "retarget") {
      const serial = integer(message.serial, 0, Number.MAX_SAFE_INTEGER, 0);
      // A stale visual/control message must never pull the body back into the
      // call that a newer sample-addressed onset already displaced.
      if (serial !== this.activeCreatureSerial) return;
      const activeTail = this.creatureQueue
        .filter((event) => (
          event.serial === serial
            && Number(event.configuration?.source?.pressure) <= 0
        ))
        .reduce((latest, event) => (!latest || event.frame > latest.frame ? event : latest), null);
      // Live anatomy edits replace the remaining shape contour, but preserve
      // its final zero-pressure point so a retargeted pad cannot drone forever.
      this.creatureQueue = this.creatureQueue.filter((event) => (
        event.serial > serial || event === activeTail
      ));
      this._handleMessage({
        type: "configure",
        source: { ...(message.source ?? {}), voiceCount: 1 },
        tract: message.tract ?? {},
        resetTract: false,
      });
      return;
    }
    // Immediate configuration remains useful for editing the resting body.
    if (message.type === "configure") {
      this._handleMessage({
        ...message,
        source: message.source ? { ...message.source, voiceCount: 1 } : message.source,
      });
      return;
    }
    this._handleMessage(message);
  }

  _applyCreatureEvent(event) {
    let isolateMakeupRise = false;
    if (event.begin) {
      if (event.serial < this.activeCreatureSerial) return;
      this.activeCreatureSerial = event.serial;
      // The general sound calibration and the small allowlisted body-null
      // correction are bounded independently. Keeping the latter separate
      // lets a genuinely quiet resonance exceed the generic 7x ceiling
      // without broadening that ceiling for every scheduled message.
      const eventMakeupGain = event.makeupGain * (event.bodyGainTrim ?? 1);
      isolateMakeupRise = eventMakeupGain > this.creatureMakeupGain * 1.5;
      this.creatureMakeupTarget = eventMakeupGain;
      if (eventMakeupGain <= this.creatureMakeupGain) {
        // Downward changes are immediate so a loud event can never inherit a
        // boosted predecessor. Upward changes use only a sub-millisecond
        // de-click ramp, short enough to remain locked to the sequencer edge.
        this.creatureMakeupGain = eventMakeupGain;
        this.creatureMakeupDelayRemaining = 0;
        this.creatureMakeupRampRemaining = 0;
        this.creatureMakeupRampStep = 0;
      } else {
        // A large upward correction must never multiply the previous call's
        // stored waveguide energy. Reset that raw tail, keep its old gain
        // through the short transition, then raise only the new gesture.
        this.creatureMakeupDelayRemaining = isolateMakeupRise
          ? (event.sequenced ? this.creatureAttackTransitionFrames : this.transitionLength)
          : 0;
        this.creatureMakeupRampRemaining = this.creatureMakeupRampFrames;
        this.creatureMakeupRampStep = (
          eventMakeupGain - this.creatureMakeupGain
        ) / this.creatureMakeupRampFrames;
      }
      this._beginCreatureContact(event.contact, event.configuration, event.soundId, event.velocity);
      this.port.postMessage({
        type: "creature-event",
        active: true,
        serial: event.serial,
        soundId: event.soundId,
        label: event.label,
      });
    }
    if (event.serial !== this.activeCreatureSerial) return;
    const configuration = event.configuration;
    this._handleMessage({
      type: "configure",
      source: { ...(configuration.source ?? {}), voiceCount: 1 },
      tract: configuration.tract ?? {},
      resetTract: Boolean(
        event.begin && (configuration.resetTract || isolateMakeupRise),
      ),
    });
    if (event.begin && isolateMakeupRise) {
      // The source engine has its own resonant displacement/velocity state.
      // Clear that alongside the tract or a quiet high-trim gesture could
      // magnify the prior call even after its waveguide was emptied.
      for (const source of this.sources) source.reset();
    }
    if (event.begin && event.sequenced) {
      // Rhythmic crops intentionally begin inside an already-energized native
      // contour. Land breath pressure and closure on that sample instead of
      // reintroducing the source engine's 12 ms parameter glide.
      for (const source of this.sources) {
        source.current.pressure = source.target.pressure;
        source.current.adduction = source.target.adduction;
        source.current.outputGain = source.target.outputGain;
        if (source.target.model === "whistle") {
          // The authored mouse contour has already spent its cropped prefix
          // growing the wall-jet oscillation. Give it a modest deterministic
          // head start instead of either restarting at 0.001 or dropping a
          // fully developed resonant cycle onto the edge as a level spike.
          const threshold = 0.16 + source.target.adduction * 0.08;
          const growth = Math.max(0, (source.target.pressure - threshold) * 90);
          const primedAmplitude = clamp(Math.sqrt(growth / 64) * 0.5, 0.08, 1.1);
          // Retain at most a sliver of an existing jet so repeated mouse
          // gestures stay smooth without inheriting an arbitrary loud state.
          source.whistleAmplitude = clamp(
            source.whistleAmplitude,
            primedAmplitude,
            primedAmplitude * 1.25,
          );
        }
      }
      this.transitionRemaining = Math.min(
        this.transitionRemaining,
        this.creatureAttackTransitionFrames,
      );
    }
  }

  _clearCreatureContact() {
    this.creatureContact = null;
    this.creatureContactVoices.length = 0;
    this.creatureContactLowpass = 0;
    this.creatureContactLeft = 0;
    this.creatureContactRight = 0;
  }

  _beginCreatureContact(profile, configuration = {}, soundId = "", velocity = 1) {
    this._clearCreatureContact();
    if (!profile || typeof profile !== "object") return;
    const durationFrames = integer(
      Number(profile.durationMs) * this.workletRate / 1_000,
      1,
      this.workletRate * 4,
      Math.round(this.workletRate * 0.4),
    );
    const startPhase = clamp(profile.startPhase ?? 0);
    const startAge = Math.round(startPhase * durationFrames);
    const bodyScale = clamp(profile.bodyScale, 0.45, 1.6);
    const bodyRoundness = clamp(profile.bodyRoundness, -1, 1);
    const tractLengthM = clamp(
      profile.tractLengthM ?? configuration.tract?.tractLengthM,
      0.018,
      0.82,
    );
    const cavityFrequencyHz = clamp(
      profile.cavityFrequencyHz ?? configuration.tract?.cavityFrequencyHz,
      28,
      this.workletRate * 0.38,
    );
    const bodyModeHz = clamp(
      (343 / (4 * tractLengthM)) * 0.42 / Math.sqrt(bodyScale),
      35,
      900,
    );
    const eventVelocity = clamp(velocity);
    const strikes = Array.isArray(profile.strikes)
      ? profile.strikes.map((strike = {}) => ({
        triggerFrame: Math.round(clamp(strike.phase) * durationFrames),
        gain: clamp(strike.gain, 0, 1.5),
        modeRatio: clamp(strike.modeRatio, 0.25, 16),
        noiseMix: clamp(strike.noiseMix),
        decayMs: clamp(strike.decayMs, 15, 600),
        pan: clamp(strike.pan, -1, 1),
      })).sort((left, right) => left.triggerFrame - right.triggerFrame)
      : [];
    const firstRetainedStrike = strikes.findIndex(({ triggerFrame }) => triggerFrame >= startAge);
    let seed = 0x811c9dc5;
    for (const character of String(soundId || profile.kind || "contact")) {
      seed ^= character.charCodeAt(0);
      seed = Math.imul(seed, 0x01000193);
    }
    this.creatureContactNoiseState = seed >>> 0 || 0xc7ea7e;
    this.creatureContact = {
      age: startAge,
      durationFrames,
      bodyModeHz,
      cavityFrequencyHz,
      bodyScale,
      bodyRoundness,
      gain: clamp(profile.gain, 0, 1.5) * eventVelocity,
      velocity: eventVelocity,
      brightness: clamp(profile.brightness),
      scrapeRateHz: clamp(profile.scrapeRateHz, 0, 60),
      scrapeGain: Array.isArray(profile.scrapeGain) ? profile.scrapeGain : [[0, 0], [1, 0]],
      scrapeBodyFilter: bandpassState(
        bodyModeHz,
        1.1 + bodyScale * 0.7 + (bodyRoundness + 1) * 0.28,
        this.workletRate,
      ),
      scrapeCavityFilter: bandpassState(
        cavityFrequencyHz,
        0.9 + bodyScale * 0.32 + (bodyRoundness + 1) * 0.18,
        this.workletRate,
      ),
      strikes,
      nextStrike: firstRetainedStrike < 0 ? strikes.length : firstRetainedStrike,
    };
  }

  _creatureContactNoise() {
    let value = this.creatureContactNoiseState || 0xc7ea7e;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.creatureContactNoiseState = value >>> 0;
    return this.creatureContactNoiseState / 0x80000000 - 1;
  }

  _triggerCreatureContact(strike, contact) {
    const massDecay = contact.bodyScale * (1 + contact.bodyRoundness * 0.3);
    const decayFrames = Math.max(
      1,
      strike.decayMs * clamp(massDecay, 0.4, 1.8) * this.workletRate / 1_000,
    );
    const modeOneHz = clamp(contact.bodyModeHz * strike.modeRatio, 28, this.workletRate * 0.36);
    const modeTwoHz = clamp(
      contact.cavityFrequencyHz * Math.sqrt(strike.modeRatio),
      35,
      this.workletRate * 0.38,
    );
    this.creatureContactVoices.push({
      age: 0,
      decayFrames,
      gain: contact.gain * strike.gain,
      noiseMix: strike.noiseMix,
      pan: strike.pan,
      phaseOne: 0,
      phaseTwo: Math.PI * 0.37,
      incrementOne: Math.PI * 2 * modeOneHz / this.workletRate,
      incrementTwo: Math.PI * 2 * modeTwoHz / this.workletRate,
    });
  }

  _renderCreatureContactFrame() {
    const contact = this.creatureContact;
    this.creatureContactLeft = 0;
    this.creatureContactRight = 0;
    if (!contact) return;
    while (
      contact.nextStrike < contact.strikes.length
      && contact.strikes[contact.nextStrike].triggerFrame <= contact.age
    ) {
      this._triggerCreatureContact(contact.strikes[contact.nextStrike], contact);
      contact.nextStrike += 1;
    }

    const noise = this._creatureContactNoise();
    const cutoff = 0.018 + contact.brightness * 0.42;
    this.creatureContactLowpass += (noise - this.creatureContactLowpass) * cutoff;
    const brightNoise = noise - this.creatureContactLowpass;
    let left = 0;
    let right = 0;
    for (const voice of this.creatureContactVoices) {
      const envelope = Math.exp(-voice.age / voice.decayFrames * 6.8);
      const tone = Math.sin(voice.phaseOne) * 0.68 + Math.sin(voice.phaseTwo) * 0.32;
      const grit = this.creatureContactLowpass * (1 - contact.brightness)
        + brightNoise * contact.brightness;
      const sample = (tone * (1 - voice.noiseMix) + grit * voice.noiseMix) * envelope * voice.gain;
      left += sample * (1 - Math.max(0, voice.pan) * 0.58);
      right += sample * (1 - Math.max(0, -voice.pan) * 0.58);
      voice.phaseOne += voice.incrementOne;
      voice.phaseTwo += voice.incrementTwo;
      voice.age += 1;
    }
    this.creatureContactVoices = this.creatureContactVoices.filter((voice) => (
      voice.age < voice.decayFrames * 1.45
    ));

    const phase = contact.age / Math.max(1, contact.durationFrames);
    const scrapeEnvelope = curveValue(contact.scrapeGain, phase) * contact.gain;
    if (scrapeEnvelope > 0.00001) {
      const rasp = contact.scrapeRateHz > 0
        ? 0.28 + Math.abs(Math.sin(phase * contact.durationFrames / this.workletRate * contact.scrapeRateHz * Math.PI * 2)) * 0.72
        : 1;
      const scrapeNoise = (
        this.creatureContactLowpass * (1 - contact.brightness)
        + brightNoise * contact.brightness
      );
      const bodyResonance = renderBandpass(scrapeNoise, contact.scrapeBodyFilter);
      const cavityResonance = renderBandpass(scrapeNoise, contact.scrapeCavityFilter);
      const bodyWeight = 0.86 + contact.bodyScale * 0.3 + contact.bodyRoundness * 0.16;
      const cavityWeight = 0.58 + (1 - contact.bodyScale / 1.6) * 0.18;
      const scrape = (
        scrapeNoise * 0.38
        + bodyResonance * bodyWeight
        + cavityResonance * cavityWeight
      ) * scrapeEnvelope * rasp * 0.74;
      const motionPan = Math.sin(phase * Math.PI * 2 * Math.max(0.5, contact.scrapeRateHz * 0.17)) * 0.26;
      left += scrape * (1 - Math.max(0, motionPan));
      right += scrape * (1 - Math.max(0, -motionPan));
    }
    this.creatureContactLeft = Math.tanh(left * 0.72);
    this.creatureContactRight = Math.tanh(right * 0.72);
    contact.age += 1;
    if (contact.age > contact.durationFrames && this.creatureContactVoices.length === 0) {
      this._clearCreatureContact();
    }
  }

  _mixCreatureContact(output) {
    if (!this.creatureContact || !output?.[0]) return;
    const left = output[0];
    const right = output[1] ?? left;
    for (let frame = 0; frame < left.length; frame += 1) {
      this._renderCreatureContactFrame();
      left[frame] = Math.tanh(left[frame] * 1.04 + this.creatureContactLeft * 0.7) * 0.96;
      right[frame] = Math.tanh(right[frame] * 1.04 + this.creatureContactRight * 0.7) * 0.96;
    }
  }

  _applyCreatureMakeup(output) {
    if (!output?.[0]) return;
    const frameCount = output[0].length;
    for (let frame = 0; frame < frameCount; frame += 1) {
      if (this.creatureMakeupDelayRemaining > 0) {
        this.creatureMakeupDelayRemaining -= 1;
      } else if (this.creatureMakeupRampRemaining > 0) {
        this.creatureMakeupGain += this.creatureMakeupRampStep;
        this.creatureMakeupRampRemaining -= 1;
        if (this.creatureMakeupRampRemaining === 0) {
          this.creatureMakeupGain = this.creatureMakeupTarget;
          this.creatureMakeupRampStep = 0;
        }
      }
      for (let channelIndex = 0; channelIndex < output.length; channelIndex += 1) {
        const channel = output[channelIndex];
        if (!channel) continue;
        channel[frame] *= this.creatureMakeupGain;
      }
    }
  }

  _postProcessOutput(output) {
    this._mixCreatureContact(output);
    this._applyCreatureMakeup(output);
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    if (!output?.[0]) return true;
    const frameCount = output[0].length;
    const blockStart = typeof currentFrame === "number" ? currentFrame : 0;
    const blockEnd = blockStart + frameCount;
    let offset = 0;

    while (offset < frameCount) {
      while (this.creatureQueue.length && this.creatureQueue[0].frame <= blockStart + offset) {
        this._applyCreatureEvent(this.creatureQueue.shift());
      }

      const nextFrame = this.creatureQueue[0]?.frame ?? blockEnd;
      const segmentEnd = Math.min(frameCount, Math.max(offset + 1, nextFrame - blockStart));
      const segment = output.map((channel) => channel.subarray(offset, segmentEnd));
      super.process(inputs, [segment], parameters);
      offset = segmentEnd;
    }

    // Drop any stale points whose entire block has passed. Applying them here
    // is safer than carrying a late pressure contour into the next render turn.
    while (this.creatureQueue.length && this.creatureQueue[0].frame < blockEnd) {
      this._applyCreatureEvent(this.creatureQueue.shift());
    }
    return true;
  }
}

registerProcessor("creaturazoid-physical-model", CreaturazoidPhysicalProcessor);

export { CreaturazoidPhysicalProcessor };
