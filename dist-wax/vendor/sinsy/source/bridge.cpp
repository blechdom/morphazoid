/* Morphazoid's bounded adapter to Sinsy 0.92 and hts_engine API 1.10.
 * Synthesis and score/lyric interpretation remain the original native engine. */
#include <string>
#include <vector>
#include <cmath>
#include <cstdio>
#include <cstring>
#include "sinsy.h"

static sinsy::Sinsy* engine = NULL;
static std::vector<float> output;
static std::string lastError;

extern "C" {
int sinsy_init() {
  if (engine) return 1;
  try {
    engine = new sinsy::Sinsy();
    std::vector<std::string> voices(1, "/song.htsvoice");
    if (!engine->setLanguages("j", "/dic") || !engine->loadVoices(voices)) {
      delete engine; engine = NULL; lastError = "Sinsy Japanese dictionary/model failed to load."; return 0;
    }
    return 1;
  } catch (const std::exception& e) { lastError = e.what(); delete engine; engine = NULL; return 0; }
}
int sinsy_render_xml(const char* xml, double alpha, double volume, double tone,
                     double speed, double beta, double voicing, double gv) {
  output.clear(); lastError.clear();
  if (!engine || !xml || std::strlen(xml) > 65536 || !std::isfinite(alpha) ||
      !std::isfinite(volume) || !std::isfinite(tone) || !std::isfinite(speed) ||
      !std::isfinite(beta) || !std::isfinite(voicing) || !std::isfinite(gv)) {
    lastError = "Sinsy requires finite controls and a bounded score."; return -1;
  }
  try {
    FILE* file = std::fopen("/score.musicxml", "wb");
    if (!file) { lastError = "Could not create Sinsy score."; return -2; }
    std::fwrite(xml, 1, std::strlen(xml), file); std::fclose(file);
    engine->clearScore(); engine->resetStopFlag();
    engine->setAlpha(alpha); engine->setVolume(volume); engine->setTone(tone);
    // The original setSpeed converts default frame_period / speed to size_t.
    // Reject only an unrepresentable native integer conversion (including
    // division by zero), rather than imposing a musical operating range.
    const double framePeriod = 240.0 / speed;
    if (!std::isfinite(framePeriod) || framePeriod < 0 || framePeriod > 4294967295.0) {
      lastError = "Sinsy frame period cannot be represented by its native unsigned integer type."; return -1;
    }
    if (!engine->setSpeed(speed) || !engine->setVocoder(beta, voicing, gv)) {
      lastError = "The native Sinsy engine rejected these controls."; return -1;
    }
    if (!engine->loadScoreFromMusicXML("/score.musicxml")) { lastError = "Sinsy could not parse this MusicXML score."; return -3; }
    std::vector<double> waveform;
    sinsy::SynthCondition condition; condition.unsetPlayFlag(); condition.setWaveformBuffer(waveform);
    if (!engine->synthesize(condition) || waveform.empty() || waveform.size() > 48000 * 60) {
      lastError = "Sinsy did not produce a bounded singing phrase."; return -4;
    }
    output.resize(waveform.size());
    for (size_t n = 0; n < waveform.size(); ++n) {
      if (!std::isfinite(waveform[n])) { output.clear(); lastError = "Sinsy produced non-finite audio."; return -5; }
      output[n] = (float) (std::fmax(-32768., std::fmin(32767., waveform[n])) / 32768.);
    }
    return output.size();
  } catch (const std::exception& e) { lastError = e.what(); return -6; }
}
const float* sinsy_data() { return output.empty() ? NULL : &output[0]; }
const char* sinsy_error() { return lastError.c_str(); }
int sinsy_sample_rate() { return 48000; }
void sinsy_close() { delete engine; engine = NULL; output.clear(); }
}
