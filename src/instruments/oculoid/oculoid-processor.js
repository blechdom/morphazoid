import { OculoidDsp } from "./oculoid-dsp.js";

class OculoidProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.voice = new OculoidDsp(sampleRate);
    this.blocks = 0;
    this.port.onmessage = ({ data }) => {
      if (data?.type === "config") this.voice.setConfig(data.config);
      if (data?.type === "transport") this.voice.setTransport(data);
      if (data?.type === "ensemble") this.voice.setEnsemble(data);
      if (data?.type === "wardrobe") this.voice.setWardrobe(data.wardrobe);
      if (data?.type === "lids-visible") this.voice.setLidsVisible(data.visible);
      if (data?.type === "enabled") this.voice.enabled = data.enabled === true;
      if (data?.type === "excite") this.voice.excite(data.amount);
      if (data?.type === "poke") this.voice.poke(data);
      if (data?.type === "surface") this.voice.surface(data);
      if (data?.type === "cry-tempo") this.voice.setCryTempo(data.tempo);
      if (data?.type === "cry") this.voice.setCry(data);
      if (data?.type === "tear") this.voice.tear(data);
      if (data?.type === "flashlight") this.voice.setFlashlight(data.exposure);
      if (data?.type === "retractor") this.voice.setRetractor(data.active);
      if (data?.type === "dispose") {
        this.voice.enabled = false;
        this.disposed = true;
      }
    };
  }

  process(_inputs, outputs) {
    if (this.disposed) return false;
    const channels = outputs[0];
    if (!channels?.length) return true;
    this.voice.render(channels[0], channels[1] ?? channels[0], currentTime);
    if (++this.blocks % 20 === 0) {
      this.port.postMessage({ type: "level", rms: this.voice.rms, peak: this.voice.peak });
    }
    return true;
  }
}

registerProcessor("oculoid-voice", OculoidProcessor);
