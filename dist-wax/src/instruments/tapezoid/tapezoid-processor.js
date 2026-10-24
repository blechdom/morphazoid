// One bounded PCM loop serves up to three REC and four PLAY contacts. Guide
// posts reshape their timing; delay pools add stored travel without allocating
// another tape buffer. Source motors can phase up to eight virtual copies.
class TapezoidProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.material = new Float32Array(1);
    this.materialRate = sampleRate;
    this.trackLength = 1;
    this.trackCursor = 0;
    this.ghostCursor = 0;
    this.extraCursors = new Float64Array(6);
    // As pairs are doubled, each new virtual motor drifts at its own bounded
    // fraction of the main pair's slip. The first ghost remains at 1× slip.
    this.extraSlips = [.33, .67, .125, .375, .625, .875];
    this.voices = 1;
    this.previousMaterial = null;
    this.previousRate = sampleRate;
    this.previousTrackLength = 1;
    this.fadeDuration = Math.max(1, Math.floor(sampleRate * .015));
    this.fadeRemaining = 0;
    this.length = Math.floor(6 * sampleRate);
    this.phase = 0;
    // Allocate once. Shortening a route leaves its unused tail latent; no
    // resampling/large allocations happen in the real-time route message.
    this.tape = new Float32Array(Math.ceil(12 * sampleRate) + 2);
    this.feedback = .45;
    this.phaseSlip = 0;
    this.printing = true;
    this.echoReturn = 0;
    this.returnGain = 0;
    this.returnHead = "play-1";
    this.returnFilter = 0;
    this.monitorMix = .75;
    this.monitorPosition = .75;
    this.lossFilter = 0;
    this.echoGain = 1;
    this.echoTarget = 1;
    this.erasePending = false;
    this.eraseCursor = 0;
    this.speed = 0;
    this.targetSpeed = 0;
    this.routeReady = false;
    this.statusFrames = 0;
    this.disposed = false;
    this.heads = [
      { id: "play-1", position: .18, target: .18, pan: -.3, gain: 1, targetGain: 1, offsetA: 0, offsetB: 0, targetA: 0, targetB: 0 },
      { id: "play-2", position: .33, target: .33, pan: .3, gain: 1, targetGain: 1, offsetA: 0, offsetB: 0, targetA: 0, targetB: 0 },
      { id: "play-3", position: .33, target: .33, pan: -.68, gain: 0, targetGain: 0, offsetA: 0, offsetB: 0, targetA: 0, targetB: 0 },
      { id: "play-4", position: .33, target: .33, pan: .68, gain: 0, targetGain: 0, offsetA: 0, offsetB: 0, targetA: 0, targetB: 0 },
    ];
    this.records = [
      { id: "record", position: 0, target: 0, gain: 1, targetGain: 1 },
      { id: "record-2", position: 0, target: 0, gain: 0, targetGain: 0 },
      { id: "record-3", position: 0, target: 0, gain: 0, targetGain: 0 },
    ];
    for (const head of this.heads) {
      head.blend = 0;
      head.targetBlend = 0;
      head.mix = .5;
      head.targetMix = .5;
    }
    this.port.onmessage = ({ data }) => {
      if (data?.type === "material" && data.samples instanceof Float32Array && data.samples.length
        && Number.isFinite(data.rate) && data.rate >= 8000 && data.rate <= 192000) {
        this.previousMaterial = this.material;
        this.previousRate = this.materialRate;
        this.previousTrackLength = this.trackLength;
        this.fadeRemaining = this.fadeDuration;
        this.materialRate = data.rate;
        this.material = data.samples.subarray(0, Math.floor(data.rate * 60));
        this.trackLength = Math.max(1, this.material.length * sampleRate / this.materialRate);
        this.trackCursor %= this.trackLength;
        this.ghostCursor %= this.trackLength;
        for (let i = 0; i < this.extraCursors.length; i += 1) {
          this.extraCursors[i] %= this.trackLength;
        }
      } else if (data?.type === "route" && Number.isFinite(data.seconds)) {
        const previousLength = this.length;
        this.length = Math.max(sampleRate * 4.5, Math.min(sampleRate * 12, Math.floor(data.seconds * sampleRate)));
        this.phase = (this.phase / previousLength) * this.length;
        if (Array.isArray(data.heads)) {
          const complete = Array.isArray(data.records)
            && data.records.some(record => this.records.some(slot => slot.id === record?.id
              && Number.isFinite(record.position)))
            && data.heads.some(play => this.heads.some(slot => slot.id === play?.id
              && Number.isFinite(play.position)));
          for (const head of this.heads) {
            const match = data.heads.find(item => item.id === head.id);
            if (complete) head.targetGain = match && Number.isFinite(match.position) ? 1 : 0;
            else if (match && Number.isFinite(match.position)) head.targetGain = 1;
            if (Number.isFinite(match?.position)) {
              // Negative means a head lies upstream of REC: it reads on the
              // next physical lap, not from negative time.
              head.target = ((match.position % 1) + 1) % 1;
              if (!this.routeReady) head.position = head.target;
            }
            if (complete || match) {
              const delays = match?.branchDelays;
              head.targetA = Array.isArray(delays) && Number.isFinite(delays[0])
                ? Math.max(-3.5, Math.min(3.5, delays[0])) : 0;
              head.targetB = Array.isArray(delays) && Number.isFinite(delays[1])
                ? Math.max(-3.5, Math.min(3.5, delays[1])) : 0;
              // No Scotch junction preserves the original amber-left /
              // blue-right fork. A connected junction folds both arrivals
              // into a bounded, smoothly adjustable A/B audio mixer.
              head.targetBlend = Number.isFinite(match?.branchMix) ? 1 : 0;
              head.targetMix = head.targetBlend
                ? Math.max(0, Math.min(1, match.branchMix)) : .5;
            }
            if (!this.routeReady) {
              head.offsetA = head.targetA;
              head.offsetB = head.targetB;
              head.blend = head.targetBlend;
              head.mix = head.targetMix;
            }
          }
          if (complete) {
            for (const record of this.records) {
              const match = data.records.find(item => item.id === record.id);
              record.targetGain = match && Number.isFinite(match.position) ? 1 : 0;
              if (record.targetGain) {
                record.target = ((match.position % 1) + 1) % 1;
                if (!this.routeReady || record.gain < .001) record.position = record.target;
              }
            }
          }
          this.routeReady = true;
        }
      } else if (data?.type === "speed" && Number.isFinite(data.speed)) {
        const next = Math.max(-4, Math.min(4, data.speed));
        this.targetSpeed = next;
      } else if (data?.type === "tape-params") {
        if (Number.isFinite(data.feedback)) {
          this.feedback = Math.max(0, Math.min(.88, data.feedback));
        }
        if (Number.isFinite(data.phaseSlip)) {
          this.phaseSlip = Math.max(0, Math.min(.06, data.phaseSlip));
        }
        if (typeof data.printing === "boolean") this.printing = data.printing;
        if (Number.isFinite(data.echoReturn)) {
          this.echoReturn = Math.max(0, Math.min(.8, data.echoReturn));
        }
        if (this.heads.some(head => head.id === data.returnHead)) {
          this.returnHead = data.returnHead;
        }
        if (Number.isFinite(data.monitorMix)) {
          this.monitorMix = Math.max(0, Math.min(1, data.monitorMix));
        }
        if ([1, 2, 4, 8].includes(data.voices) && data.voices !== this.voices) {
          // Doubling makes a copy of the current pair(s), then lets the new
          // motors wander. Switching from solo starts the pair in unison.
          if (this.voices < 2 && data.voices >= 2) this.ghostCursor = this.trackCursor;
          if (this.voices < 4 && data.voices >= 4) {
            this.extraCursors[0] = this.trackCursor;
            this.extraCursors[1] = this.ghostCursor;
          }
          if (this.voices < 8 && data.voices >= 8) {
            this.extraCursors[2] = this.trackCursor;
            this.extraCursors[3] = this.ghostCursor;
            this.extraCursors[4] = this.extraCursors[0];
            this.extraCursors[5] = this.extraCursors[1];
          }
          this.voices = data.voices;
        }
      } else if (data?.type === "erase-tape") {
        // Fade wet taps before clearing a live loop; the dry track continues.
        this.erasePending = true;
        this.eraseCursor = 0;
        this.echoTarget = 0;
      } else if (data?.type === "export-tape") {
        const samples = this.erasePending ? new Float32Array(this.tape.length) : this.tape.slice();
        this.port.postMessage({ type: "tape-snapshot", samples, rate: sampleRate }, [samples.buffer]);
      } else if (data?.type === "import-tape" && data.samples instanceof Float32Array
        && Number.isFinite(data.rate) && data.rate >= 8000 && data.rate <= 192000
        && data.samples.length <= Math.ceil(data.rate * 12) + 2) {
        if (data.rate === sampleRate) {
          this.tape.set(data.samples.subarray(0, this.tape.length));
        } else {
          // A changed output device may reopen at another sample rate. Preserve
          // memory by physical seconds without changing the loaded track pitch.
          for (let i = 0; i < this.tape.length; i += 1) {
            const position = i * data.rate / sampleRate;
            const first = Math.floor(position), fraction = position - first;
            this.tape[i] = (data.samples[first] ?? 0) * (1 - fraction)
              + (data.samples[first + 1] ?? 0) * fraction;
          }
        }
      } else if (data?.type === "seek" && Number.isFinite(data.phase)) {
        this.phase = ((data.phase % 1 + 1) % 1) * this.length;
        if (Number.isFinite(data.trackTime)) {
          this.trackCursor = ((data.trackTime * sampleRate % this.trackLength) + this.trackLength) % this.trackLength;
        }
        const slip = Number.isFinite(data.phaseShiftTime) ? data.phaseShiftTime * sampleRate : 0;
        this.ghostCursor = ((this.trackCursor + slip) % this.trackLength + this.trackLength) % this.trackLength;
        if (Array.isArray(data.extraPhaseTimes) && data.extraPhaseTimes.length === this.extraCursors.length) {
          for (let i = 0; i < this.extraCursors.length; i += 1) {
            const offset = Number.isFinite(data.extraPhaseTimes[i]) ? data.extraPhaseTimes[i] * sampleRate : 0;
            this.extraCursors[i] = ((this.trackCursor + offset) % this.trackLength + this.trackLength) % this.trackLength;
          }
        }
      } else if (data?.type === "sync-motors") {
        this.ghostCursor = this.trackCursor;
        this.extraCursors.fill(this.trackCursor);
      } else if (data?.type === "dispose") {
        this.disposed = true;
      }
    };
  }

  readFrom(material, rate, length, position) {
    if (!material?.length) return 0;
    let index = position % length;
    if (index < 0) index += length;
    index *= rate / sampleRate;
    const first = Math.min(material.length - 1, Math.floor(index));
    const second = (first + 1) % material.length;
    const fraction = index - first;
    return material[first] * (1 - fraction) + material[second] * fraction;
  }

  read(position) {
    return this.readFrom(this.material, this.materialRate, this.trackLength, position);
  }

  readSource(position, fade) {
    const current = this.read(position);
    return fade < 1
      ? this.readFrom(this.previousMaterial, this.previousRate, this.previousTrackLength, position)
        * (1 - fade) + current * fade
      : current;
  }

  readTape(position) {
    let index = position % this.length;
    if (index < 0) index += this.length;
    const first = Math.floor(index), next = (first + 1) % this.length;
    const fraction = index - first;
    return this.tape[first] * (1 - fraction) + this.tape[next] * fraction;
  }

  process(_inputs, outputs) {
    if (this.disposed) return false;
    const left = outputs[0]?.[0];
    const right = outputs[0]?.[1] ?? left;
    if (!left) return true;
    if (this.erasePending && this.echoGain < .002) {
      // Clear a small fixed slice per render quantum, never a 12-second buffer
      // in the audio callback while the motor is running.
      const end = Math.min(this.eraseCursor + 16384, this.tape.length);
      this.tape.fill(0, this.eraseCursor, end);
      this.eraseCursor = end;
      if (end === this.tape.length) {
        this.lossFilter = 0;
        this.erasePending = false;
        this.echoTarget = 1;
      }
    }
    for (let i = 0; i < left.length; i += 1) {
      this.speed += (this.targetSpeed - this.speed) * .004;
      if (this.targetSpeed === 0 && Math.abs(this.speed) < .0001) this.speed = 0;
      this.echoGain += (this.echoTarget - this.echoGain) * .008;
      this.returnGain += (this.echoReturn - this.returnGain) * .004;
      this.monitorPosition += (this.monitorMix - this.monitorPosition) * .004;
      for (const head of this.heads) {
        head.position += (head.target - head.position) * .0015;
        head.offsetA += (head.targetA - head.offsetA) * .0015;
        head.offsetB += (head.targetB - head.offsetB) * .0015;
        head.blend += (head.targetBlend - head.blend) * .0015;
        head.mix += (head.targetMix - head.mix) * .0015;
        head.gain += (head.targetGain - head.gain) * .004;
        if (Math.abs(head.offsetA - head.targetA) < 1e-6) head.offsetA = head.targetA;
        if (Math.abs(head.offsetB - head.targetB) < 1e-6) head.offsetB = head.targetB;
      }
      let recordCount = 0;
      for (const record of this.records) {
        record.position += (record.target - record.position) * .0015;
        record.gain += (record.targetGain - record.gain) * .004;
        recordCount += record.gain;
      }
      const fade = this.fadeRemaining > 0 ? 1 - this.fadeRemaining / this.fadeDuration : 1;
      const sourceA = this.readSource(this.trackCursor, fade);
      let source = sourceA;
      if (this.voices > 1) {
        source += this.readSource(this.ghostCursor, fade);
        for (let voice = 2; voice < this.voices; voice += 1) {
          source += this.readSource(this.extraCursors[voice - 2], fade);
        }
        source /= this.voices;
      }
      if (this.fadeRemaining > 0) {
        if (--this.fadeRemaining === 0) this.previousMaterial = null;
      }
      let wetLeft = 0, wetRight = 0, activeHeads = 0, returned = 0;
      for (const head of this.heads) {
        if (head.gain < .0001 && head.targetGain === 0) continue;
        const leftDelay = Math.max(sampleRate * .012, Math.min(this.length - 1,
          head.position * this.length + head.offsetA * sampleRate));
        const rightDelay = Math.max(sampleRate * .012, Math.min(this.length - 1,
          head.position * this.length + head.offsetB * sampleRate));
        const playedLeft = this.readTape(this.phase - leftDelay);
        const playedRight = leftDelay === rightDelay ? playedLeft : this.readTape(this.phase - rightDelay);
        const joined = playedLeft * (1 - head.mix) + playedRight * head.mix;
        const mixedLeft = playedLeft + (joined - playedLeft) * head.blend;
        const mixedRight = playedRight + (joined - playedRight) * head.blend;
        if (head.id === this.returnHead) returned = (mixedLeft + mixedRight) * .5 * head.gain;
        wetLeft += mixedLeft * head.gain * Math.cos((head.pan + 1) * Math.PI / 4);
        wetRight += mixedRight * head.gain * Math.sin((head.pan + 1) * Math.PI / 4);
        activeHeads += head.gain;
      }
      this.returnFilter += (returned - this.returnFilter) * .24;
      if (this.printing && this.targetSpeed === 1 && this.speed > .7
        && !this.erasePending) {
        for (const record of this.records) {
          if (record.gain < .0001 && record.targetGain === 0) continue;
          // Each fixed contact writes where its tape is *now*, not by
          // allocating a separate loop. New contacts fade in/out during edits.
          const delay = Math.max(0, Math.min(this.length - 1, record.position * this.length));
          const index = (Math.floor(this.phase - delay + this.length)) % this.length;
          const old = this.tape[index];
          this.lossFilter += (old - this.lossFilter) * .3;
          // Divide source print by active REC contacts; keep each return
          // bounded and softly saturated even when contacts are close.
          const next = Math.tanh(source * .74 / Math.max(1, recordCount)
            + (old * .72 + this.lossFilter * .28) * this.feedback
            + this.returnFilter * this.returnGain * (1 - this.feedback));
          this.tape[index] = old * (1 - record.gain) + next * record.gain;
        }
      }
      let l = source * .74 * (1 - this.monitorPosition);
      let r = l;
      const wetLevel = this.echoGain * .76 * this.monitorPosition * 2 / Math.max(2, activeHeads);
      l += wetLeft * wetLevel;
      r += wetRight * wetLevel;
      const motion = Math.min(1, Math.abs(this.speed) * 5);
      const level = (Math.abs(this.speed) > 2 ? .42 : .86) * motion;
      left[i] = Math.tanh(l * level);
      if (right !== left) right[i] = Math.tanh(r * level);
      this.phase = (this.phase + this.speed + this.length) % this.length;
      this.trackCursor = (this.trackCursor + this.speed + this.trackLength) % this.trackLength;
      this.ghostCursor = this.voices > 1
        ? (this.ghostCursor + this.speed * (1 + this.phaseSlip) + this.trackLength) % this.trackLength
        : this.trackCursor;
      for (let voice = 2; voice < this.voices; voice += 1) {
        const index = voice - 2;
        this.extraCursors[index] = (this.extraCursors[index] + this.speed * (1 + this.phaseSlip * this.extraSlips[index])
          + this.trackLength) % this.trackLength;
      }
    }
    this.statusFrames += left.length;
    if (this.statusFrames >= 1024) {
      this.statusFrames %= 1024;
      const extraPhaseTimes = [];
      for (let i = 0; i < this.extraCursors.length; i += 1) {
        extraPhaseTimes.push(((this.extraCursors[i] - this.trackCursor + this.trackLength) % this.trackLength) / sampleRate);
      }
      this.port.postMessage({
        type: "transport", phase: this.phase / this.length,
        trackTime: this.trackCursor / sampleRate,
        phaseShiftTime: ((this.ghostCursor - this.trackCursor + this.trackLength) % this.trackLength) / sampleRate,
        extraPhaseTimes,
      });
    }
    return true;
  }
}

registerProcessor("morphazoid-tapezoid", TapezoidProcessor);
