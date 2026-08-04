#pragma once

#include <array>
#include <cstddef>
#include <cstdint>

namespace morphazoid::chaotic_fm {

inline constexpr std::size_t kMaxDepth = 10;
inline constexpr std::size_t kPresetCount = 5;
inline constexpr double kDefaultSampleRate = 48'000.0;

enum class GlideMode : std::uint8_t {
  off = 0,
  legato = 1,
  always = 2,
};

enum class EnvelopeStage : std::uint8_t {
  idle,
  attack,
  decay,
  sustain,
  release,
};

struct Parameters {
  int depth = 1;
  double carrierHz = 10.5;
  double offsetHz = 0.0;
  double modulationAmount = 350.0;
  double amountDivisor = 0.4;
  double nonlinearityHz = 256.0;
  double output = 0.42;

  // Stable external keys are documented in README.md. These C++ names keep
  // native call sites concise while mapping one-to-one to that contract.
  bool playModeDrone = false;
  int rootMidiNote = 60;
  double pitchBendRangeSemitones = 2.0;
  double ampAttackMs = 8.0;
  double ampDecayMs = 120.0;
  double ampSustainLevel = 0.72;
  double ampReleaseMs = 180.0;
  double glideTimeMs = 0.0;
  GlideMode glideMode = GlideMode::off;
};

struct Preset {
  const char* id;
  const char* name;
  Parameters parameters;
};

const std::array<Preset, kPresetCount>& presets() noexcept;
Parameters sanitizeParameters(const Parameters& parameters,
                              double sampleRate = kDefaultSampleRate) noexcept;

enum class EventType : std::uint8_t {
  noteOn,
  noteOff,
  pitchBend,
  controlChange,
  allNotesOff,
  allSoundOff,
  resetControllers,
};

// A trivially-copyable event suitable for a fixed-capacity processBlock
// scratch array. Events passed to process() must be ordered by sampleOffset.
struct PerformanceEvent {
  std::uint32_t sampleOffset = 0;
  EventType type = EventType::noteOff;
  std::uint8_t channel = 0;
  std::uint8_t data1 = 0;
  std::uint8_t data2 = 0;
  double value = 0.0;

  static PerformanceEvent noteOnAt(std::uint32_t offset, int note,
                                   int velocity, int channel = 0) noexcept;
  static PerformanceEvent noteOffAt(std::uint32_t offset, int note,
                                    int channel = 0) noexcept;
  static PerformanceEvent pitchBendAt(std::uint32_t offset,
                                      double normalized,
                                      int channel = 0) noexcept;
  static PerformanceEvent pitchWheelAt(std::uint32_t offset,
                                       int value14Bit,
                                       int channel = 0) noexcept;
  static PerformanceEvent controlChangeAt(std::uint32_t offset,
                                          int controller, int value,
                                          int channel = 0) noexcept;
  static PerformanceEvent allNotesOffAt(std::uint32_t offset = 0) noexcept;
  static PerformanceEvent allSoundOffAt(std::uint32_t offset = 0) noexcept;
  static PerformanceEvent resetControllersAt(
      std::uint32_t offset = 0) noexcept;
};

struct PerformanceSnapshot {
  int currentMidiNote = -1;
  bool hasActiveNote = false;
  bool sustainPedalDown = false;
  double pitchRatio = 1.0;
  double envelopeLevel = 0.0;
  double velocityGain = 0.0;
  double expressionGain = 1.0;
  EnvelopeStage envelopeStage = EnvelopeStage::idle;
};

/**
 * Allocation-free monophonic Chaotic FM voice.
 *
 * All oscillator state is double precision. process() accepts host-style
 * sample-offset events and writes a mono signal to one or two output buffers.
 * Passing a null right pointer renders only the left channel.
 */
class ChaoticFmCore final {
 public:
  ChaoticFmCore() noexcept;

  void prepare(double sampleRate, std::uint32_t maximumBlockSize = 0) noexcept;
  void reset() noexcept;
  void setParameters(const Parameters& parameters) noexcept;

  const Parameters& parameters() const noexcept { return target_; }
  double sampleRate() const noexcept { return sampleRate_; }

  void process(float* left, float* right, std::uint32_t sampleCount,
               const PerformanceEvent* events = nullptr,
               std::size_t eventCount = 0) noexcept;

  void handleEvent(const PerformanceEvent& event) noexcept;
  PerformanceSnapshot snapshot() const noexcept;

 private:
  struct HeldNote {
    std::uint64_t order = 0;
    std::uint8_t velocity = 0;
    bool keyDown = false;
  };

  class AmpEnvelope {
   public:
    void prepare(double sampleRate) noexcept;
    void reset() noexcept;
    void setSettings(double attackMs, double decayMs, double sustain,
                     double releaseMs) noexcept;
    void noteOn() noexcept;
    void noteOff() noexcept;
    void allSoundOff() noexcept;
    double next() noexcept;

    double level() const noexcept { return level_; }
    EnvelopeStage stage() const noexcept { return stage_; }

   private:
    void beginAttack() noexcept;
    void beginDecay() noexcept;
    void beginRelease(double milliseconds) noexcept;
    std::uint32_t durationInSamples(double milliseconds) const noexcept;

    double sampleRate_ = kDefaultSampleRate;
    double attackMs_ = 8.0;
    double decayMs_ = 120.0;
    double sustain_ = 0.72;
    double releaseMs_ = 180.0;
    double level_ = 0.0;
    double segmentStart_ = 0.0;
    std::uint32_t segmentLength_ = 0;
    std::uint32_t segmentPosition_ = 0;
    EnvelopeStage stage_ = EnvelopeStage::idle;
  };

  struct SmoothedAlgorithm {
    double carrierHz = 10.5;
    double offsetHz = 0.0;
    double modulationAmount = 350.0;
    double amountDivisor = 0.4;
    double nonlinearityHz = 256.0;
    double output = 0.42;
  };

  void clearNotes(bool fastFade) noexcept;
  void noteOn(int note, int velocity) noexcept;
  void noteOff(int note) noexcept;
  void setSustain(bool down) noexcept;
  void resetControllers() noexcept;
  bool selectMostRecentHeldNote() noexcept;
  void selectNote(int note, int velocity, bool envelopeLegato,
                  bool pitchLegato) noexcept;
  void setPitchTarget(double semitones, bool legatoTransition) noexcept;
  void updateEffectivePerformanceSettings() noexcept;
  void updatePitch() noexcept;
  void updateSmoothers() noexcept;
  double renderOscillator() noexcept;
  double protectOutput(double rawSample) noexcept;

  Parameters target_{};
  SmoothedAlgorithm current_{};
  double sampleRate_ = kDefaultSampleRate;
  double frequencyCeiling_ = 20'000.0;
  double phaseScale_ = 0.0;
  double parameterSlew_ = 0.0;
  double depthSlew_ = 0.0;
  double performanceSlew_ = 0.0;
  double highpassCoefficient_ = 0.0;

  std::array<double, kMaxDepth + 2> phases_{};
  std::array<double, kMaxDepth + 1> depthSignals_{};
  std::array<double, kMaxDepth + 1> depthGains_{};
  std::array<HeldNote, 128> heldNotes_{};
  std::uint64_t noteOrderCounter_ = 0;
  int currentNote_ = -1;
  bool hasEverPlayed_ = false;
  bool sustainDown_ = false;
  bool sustainedCurrent_ = false;
  bool glideCcEnabled_ = true;
  double ccGlideTimeMs_ = -1.0;
  double ccAttackMs_ = -1.0;
  double ccDecayMs_ = -1.0;
  double ccReleaseMs_ = -1.0;
  double effectiveGlideTimeMs_ = 0.0;

  double targetNoteSemitones_ = 0.0;
  double currentNoteSemitones_ = 0.0;
  double glideStartSemitones_ = 0.0;
  std::uint32_t glideLength_ = 0;
  std::uint32_t glidePosition_ = 0;
  double targetBendNormalized_ = 0.0;
  double currentBendNormalized_ = 0.0;
  double currentPitchRatio_ = 1.0;

  double targetVelocityGain_ = 0.0;
  double currentVelocityGain_ = 0.0;
  double targetExpressionGain_ = 1.0;
  double currentExpressionGain_ = 1.0;
  double droneGain_ = 0.0;

  AmpEnvelope envelope_{};
  double highpassInput_ = 0.0;
  double highpassOutput_ = 0.0;
};

}  // namespace morphazoid::chaotic_fm
