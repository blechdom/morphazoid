#include "morphazoid/ChaoticFmCore.h"

#include <algorithm>
#include <cmath>
#include <limits>

namespace morphazoid::chaotic_fm {
namespace {

constexpr double kPi = 3.141592653589793238462643383279502884;
constexpr double kTwoPi = 2.0 * kPi;
constexpr double kMaximumAudibleFrequency = 20'000.0;
constexpr double kMaximumShaperInput = 64.0;
constexpr double kMaximumRecursiveAmount = 1.0e12;
constexpr double kGoldenPhaseSeed = 0.618033988749895;
constexpr double kParameterSlewSeconds = 0.028;
constexpr double kDepthSlewSeconds = 0.018;
constexpr double kPerformanceSlewSeconds = 0.008;
constexpr double kHighpassFrequency = 18.0;
constexpr double kSoftCeilingDrive = 1.45;
constexpr double kSoftCeilingLevel = 0.91;

double finiteOr(double value, double fallback) noexcept {
  return std::isfinite(value) ? value : fallback;
}

double clampFinite(double value, double minimum, double maximum,
                   double fallback) noexcept {
  return std::clamp(finiteOr(value, fallback), minimum, maximum);
}

int clampMidiByte(int value) noexcept {
  return std::clamp(value, 0, 127);
}

double onePoleCoefficient(double seconds, double sampleRate) noexcept {
  return 1.0 - std::exp(-1.0 / (sampleRate * seconds));
}

double wrapPhase(double phase) noexcept {
  if (phase > kTwoPi || phase < -kTwoPi) {
    return std::fmod(phase, kTwoPi);
  }
  return phase;
}

double positiveLogMap(int midiValue, double minimum,
                      double maximum) noexcept {
  const double position = static_cast<double>(clampMidiByte(midiValue)) / 127.0;
  return minimum * std::pow(maximum / minimum, position);
}

double zeroLogMap(int midiValue, double minimumNonzero,
                  double maximum) noexcept {
  const int value = clampMidiByte(midiValue);
  if (value == 0) return 0.0;
  const double position = static_cast<double>(value - 1) / 126.0;
  return minimumNonzero * std::pow(maximum / minimumNonzero, position);
}

const std::array<Preset, kPresetCount> kPresets{{
    {"feedback-nest", "Feedback Nest",
     {1, 10.5, 0.0, 350.0, 0.4, 256.0, 0.42, false, 60, 2.0,
      8.0, 120.0, 0.72, 180.0, 0.0, GlideMode::off}},
    {"slow-furnace", "Slow Furnace",
     {4, 1.798, 100.0, 4'200.0, 4.0, 375.0, 0.42, false, 60, 2.0,
      8.0, 120.0, 0.72, 180.0, 0.0, GlideMode::off}},
    {"glass-hive", "Glass Hive",
     {5, 0.129, 637.0, 2'737.0, 5.8, 531.0, 0.42, false, 60, 2.0,
      8.0, 120.0, 0.72, 180.0, 0.0, GlideMode::off}},
    {"cut-current", "Cut Current",
     {2, 0.143, 637.0, 4'762.0, 7.611, 1'024.0, 0.42, false, 60, 2.0,
      8.0, 120.0, 0.72, 180.0, 0.0, GlideMode::off}},
    {"brass-moth", "Brass Moth",
     {1, 11.0, 787.0, 125.0, 4.3, 725.0, 0.42, false, 60, 2.0,
      8.0, 120.0, 0.72, 180.0, 0.0, GlideMode::off}},
}};

}  // namespace

const std::array<Preset, kPresetCount>& presets() noexcept {
  return kPresets;
}

Parameters sanitizeParameters(const Parameters& parameters,
                              double sampleRate) noexcept {
  Parameters safe = parameters;
  const double safeSampleRate = clampFinite(sampleRate, 8'000.0, 192'000.0,
                                            kDefaultSampleRate);
  const double frequencyCeiling =
      std::min(kMaximumAudibleFrequency, safeSampleRate * 0.45);

  safe.depth = std::clamp(parameters.depth, 0, static_cast<int>(kMaxDepth));
  safe.carrierHz = clampFinite(parameters.carrierHz, 0.01,
                               std::min(4'800.0, frequencyCeiling), 10.5);
  safe.offsetHz = clampFinite(parameters.offsetHz, 0.0,
                              std::min(4'800.0, frequencyCeiling), 0.0);
  safe.modulationAmount = clampFinite(parameters.modulationAmount, 0.0,
                                      4'800.0, 350.0);
  safe.amountDivisor = clampFinite(parameters.amountDivisor, 0.001, 8.0, 0.4);
  safe.nonlinearityHz = clampFinite(parameters.nonlinearityHz, 0.001,
                                    std::min(4'000.0, frequencyCeiling), 256.0);
  safe.output = clampFinite(parameters.output, 0.0, 0.82, 0.42);
  safe.rootMidiNote = std::clamp(parameters.rootMidiNote, 0, 127);
  safe.pitchBendRangeSemitones = clampFinite(
      parameters.pitchBendRangeSemitones, 0.0, 24.0, 2.0);
  safe.ampAttackMs = clampFinite(parameters.ampAttackMs, 0.0, 5'000.0, 8.0);
  safe.ampDecayMs = clampFinite(parameters.ampDecayMs, 0.0, 5'000.0, 120.0);
  safe.ampSustainLevel = clampFinite(parameters.ampSustainLevel, 0.0, 1.0, 0.72);
  safe.ampReleaseMs = clampFinite(parameters.ampReleaseMs, 2.0, 10'000.0, 180.0);
  safe.glideTimeMs = clampFinite(parameters.glideTimeMs, 0.0, 2'000.0, 0.0);
  if (safe.glideMode != GlideMode::off &&
      safe.glideMode != GlideMode::legato &&
      safe.glideMode != GlideMode::always) {
    safe.glideMode = GlideMode::off;
  }
  return safe;
}

PerformanceEvent PerformanceEvent::noteOnAt(std::uint32_t offset, int note,
                                             int velocity,
                                             int midiChannel) noexcept {
  return {offset, EventType::noteOn,
          static_cast<std::uint8_t>(std::clamp(midiChannel, 0, 15)),
          static_cast<std::uint8_t>(clampMidiByte(note)),
          static_cast<std::uint8_t>(clampMidiByte(velocity)), 0.0};
}

PerformanceEvent PerformanceEvent::noteOffAt(std::uint32_t offset, int note,
                                              int midiChannel) noexcept {
  return {offset, EventType::noteOff,
          static_cast<std::uint8_t>(std::clamp(midiChannel, 0, 15)),
          static_cast<std::uint8_t>(clampMidiByte(note)), 0, 0.0};
}

PerformanceEvent PerformanceEvent::pitchBendAt(std::uint32_t offset,
                                                double normalized,
                                                int midiChannel) noexcept {
  return {offset, EventType::pitchBend,
          static_cast<std::uint8_t>(std::clamp(midiChannel, 0, 15)), 0, 0,
          clampFinite(normalized, -1.0, 1.0, 0.0)};
}

PerformanceEvent PerformanceEvent::pitchWheelAt(std::uint32_t offset,
                                                 int value14Bit,
                                                 int midiChannel) noexcept {
  const int safeValue = std::clamp(value14Bit, 0, 16'383);
  return pitchBendAt(offset,
                     static_cast<double>(safeValue - 8'192) / 8'192.0,
                     midiChannel);
}

PerformanceEvent PerformanceEvent::controlChangeAt(std::uint32_t offset,
                                                    int controller, int value,
                                                    int midiChannel) noexcept {
  return {offset, EventType::controlChange,
          static_cast<std::uint8_t>(std::clamp(midiChannel, 0, 15)),
          static_cast<std::uint8_t>(clampMidiByte(controller)),
          static_cast<std::uint8_t>(clampMidiByte(value)), 0.0};
}

PerformanceEvent PerformanceEvent::allNotesOffAt(std::uint32_t offset) noexcept {
  return {offset, EventType::allNotesOff, 0, 0, 0, 0.0};
}

PerformanceEvent PerformanceEvent::allSoundOffAt(std::uint32_t offset) noexcept {
  return {offset, EventType::allSoundOff, 0, 0, 0, 0.0};
}

PerformanceEvent PerformanceEvent::resetControllersAt(
    std::uint32_t offset) noexcept {
  return {offset, EventType::resetControllers, 0, 0, 0, 0.0};
}

void ChaoticFmCore::AmpEnvelope::prepare(double sampleRate) noexcept {
  sampleRate_ = clampFinite(sampleRate, 8'000.0, 192'000.0,
                            kDefaultSampleRate);
}

void ChaoticFmCore::AmpEnvelope::reset() noexcept {
  level_ = 0.0;
  segmentStart_ = 0.0;
  segmentLength_ = 0;
  segmentPosition_ = 0;
  stage_ = EnvelopeStage::idle;
}

void ChaoticFmCore::AmpEnvelope::setSettings(double attackMs, double decayMs,
                                              double sustain,
                                              double releaseMs) noexcept {
  attackMs_ = std::max(0.0, finiteOr(attackMs, 8.0));
  decayMs_ = std::max(0.0, finiteOr(decayMs, 120.0));
  sustain_ = clampFinite(sustain, 0.0, 1.0, 0.72);
  releaseMs_ = std::max(0.0, finiteOr(releaseMs, 180.0));
  if (stage_ == EnvelopeStage::sustain) level_ = sustain_;
}

std::uint32_t ChaoticFmCore::AmpEnvelope::durationInSamples(
    double milliseconds) const noexcept {
  if (milliseconds <= 0.0) return 0;
  const double samples = milliseconds * 0.001 * sampleRate_;
  return static_cast<std::uint32_t>(
      std::max(1.0, std::min(samples + 0.5,
                             static_cast<double>(
                                 std::numeric_limits<std::uint32_t>::max()))));
}

void ChaoticFmCore::AmpEnvelope::beginAttack() noexcept {
  segmentStart_ = level_;
  segmentLength_ = durationInSamples(attackMs_);
  segmentPosition_ = 0;
  stage_ = EnvelopeStage::attack;
  if (segmentLength_ == 0) {
    level_ = 1.0;
    beginDecay();
  }
}

void ChaoticFmCore::AmpEnvelope::beginDecay() noexcept {
  segmentStart_ = 1.0;
  segmentLength_ = durationInSamples(decayMs_);
  segmentPosition_ = 0;
  stage_ = EnvelopeStage::decay;
  if (segmentLength_ == 0) {
    level_ = sustain_;
    stage_ = EnvelopeStage::sustain;
  }
}

void ChaoticFmCore::AmpEnvelope::beginRelease(double milliseconds) noexcept {
  segmentStart_ = level_;
  segmentLength_ = durationInSamples(milliseconds);
  segmentPosition_ = 0;
  stage_ = EnvelopeStage::release;
  if (segmentLength_ == 0) reset();
}

void ChaoticFmCore::AmpEnvelope::noteOn() noexcept {
  beginAttack();
}

void ChaoticFmCore::AmpEnvelope::noteOff() noexcept {
  if (stage_ != EnvelopeStage::idle) beginRelease(releaseMs_);
}

void ChaoticFmCore::AmpEnvelope::allSoundOff() noexcept {
  if (stage_ != EnvelopeStage::idle) beginRelease(2.0);
}

double ChaoticFmCore::AmpEnvelope::next() noexcept {
  if (stage_ == EnvelopeStage::idle) return 0.0;
  if (stage_ == EnvelopeStage::sustain) {
    level_ = sustain_;
    return level_;
  }

  ++segmentPosition_;
  const double progress = std::min(
      1.0, static_cast<double>(segmentPosition_) /
               static_cast<double>(std::max<std::uint32_t>(1, segmentLength_)));
  const double remaining = 1.0 - progress;

  switch (stage_) {
    case EnvelopeStage::attack:
      level_ = segmentStart_ +
               (1.0 - segmentStart_) * (1.0 - remaining * remaining);
      if (segmentPosition_ >= segmentLength_) {
        level_ = 1.0;
        beginDecay();
      }
      break;
    case EnvelopeStage::decay:
      level_ = sustain_ + (1.0 - sustain_) * remaining * remaining;
      if (segmentPosition_ >= segmentLength_) {
        level_ = sustain_;
        stage_ = EnvelopeStage::sustain;
      }
      break;
    case EnvelopeStage::release:
      level_ = segmentStart_ * remaining * remaining;
      if (segmentPosition_ >= segmentLength_) reset();
      break;
    case EnvelopeStage::idle:
    case EnvelopeStage::sustain:
      break;
  }
  return level_;
}

ChaoticFmCore::ChaoticFmCore() noexcept {
  prepare(kDefaultSampleRate);
}

void ChaoticFmCore::prepare(double sampleRate,
                            std::uint32_t /*maximumBlockSize*/) noexcept {
  sampleRate_ = clampFinite(sampleRate, 8'000.0, 192'000.0,
                            kDefaultSampleRate);
  target_ = sanitizeParameters(target_, sampleRate_);
  frequencyCeiling_ = std::min(kMaximumAudibleFrequency, sampleRate_ * 0.45);
  phaseScale_ = kTwoPi / sampleRate_;
  parameterSlew_ = onePoleCoefficient(kParameterSlewSeconds, sampleRate_);
  depthSlew_ = onePoleCoefficient(kDepthSlewSeconds, sampleRate_);
  performanceSlew_ = onePoleCoefficient(kPerformanceSlewSeconds, sampleRate_);
  highpassCoefficient_ =
      std::exp(-kTwoPi * kHighpassFrequency / sampleRate_);
  envelope_.prepare(sampleRate_);
  reset();
}

void ChaoticFmCore::reset() noexcept {
  target_ = sanitizeParameters(target_, sampleRate_);
  current_ = {target_.carrierHz, target_.offsetHz, target_.modulationAmount,
              target_.amountDivisor, target_.nonlinearityHz, target_.output};

  phases_.fill(0.0);
  depthSignals_.fill(0.0);
  depthGains_.fill(0.0);
  for (std::size_t index = 0; index < phases_.size(); ++index) {
    const double fraction = std::fmod(static_cast<double>(index) *
                                          kGoldenPhaseSeed,
                                      1.0);
    phases_[index] = fraction * kTwoPi;
  }
  depthGains_[static_cast<std::size_t>(target_.depth)] = 1.0;

  heldNotes_.fill({});
  noteOrderCounter_ = 0;
  currentNote_ = -1;
  hasEverPlayed_ = false;
  sustainDown_ = false;
  sustainedCurrent_ = false;
  glideCcEnabled_ = true;
  ccGlideTimeMs_ = -1.0;
  ccAttackMs_ = -1.0;
  ccDecayMs_ = -1.0;
  ccReleaseMs_ = -1.0;
  targetNoteSemitones_ = 0.0;
  currentNoteSemitones_ = 0.0;
  glideStartSemitones_ = 0.0;
  glideLength_ = 0;
  glidePosition_ = 0;
  targetBendNormalized_ = 0.0;
  currentBendNormalized_ = 0.0;
  currentPitchRatio_ = 1.0;
  targetVelocityGain_ = 0.0;
  currentVelocityGain_ = 0.0;
  targetExpressionGain_ = 1.0;
  currentExpressionGain_ = 1.0;
  droneGain_ = target_.playModeDrone ? 1.0 : 0.0;

  envelope_.reset();
  updateEffectivePerformanceSettings();
  highpassInput_ = 0.0;
  highpassOutput_ = 0.0;
}

void ChaoticFmCore::setParameters(const Parameters& parameters) noexcept {
  const int previousRoot = target_.rootMidiNote;
  target_ = sanitizeParameters(parameters, sampleRate_);
  updateEffectivePerformanceSettings();
  if (currentNote_ >= 0 && previousRoot != target_.rootMidiNote) {
    setPitchTarget(static_cast<double>(currentNote_ - target_.rootMidiNote),
                   true);
  }
}

void ChaoticFmCore::updateEffectivePerformanceSettings() noexcept {
  const double attack = ccAttackMs_ >= 0.0 ? ccAttackMs_ : target_.ampAttackMs;
  const double decay = ccDecayMs_ >= 0.0 ? ccDecayMs_ : target_.ampDecayMs;
  const double release =
      ccReleaseMs_ >= 0.0 ? ccReleaseMs_ : target_.ampReleaseMs;
  effectiveGlideTimeMs_ =
      ccGlideTimeMs_ >= 0.0 ? ccGlideTimeMs_ : target_.glideTimeMs;
  envelope_.setSettings(attack, decay, target_.ampSustainLevel, release);
}

void ChaoticFmCore::noteOn(int note, int velocity) noexcept {
  note = clampMidiByte(note);
  velocity = clampMidiByte(velocity);
  if (velocity == 0) {
    noteOff(note);
    return;
  }

  bool hadPhysicallyHeldNote = false;
  for (const HeldNote& candidate : heldNotes_) {
    if (candidate.keyDown) {
      hadPhysicallyHeldNote = true;
      break;
    }
  }
  const bool hadSoundingNote = currentNote_ >= 0;
  HeldNote& held = heldNotes_[static_cast<std::size_t>(note)];
  held.order = ++noteOrderCounter_;
  held.velocity = static_cast<std::uint8_t>(velocity);
  held.keyDown = true;
  sustainedCurrent_ = false;
  selectNote(note, velocity, hadSoundingNote, hadPhysicallyHeldNote);
}

void ChaoticFmCore::noteOff(int note) noexcept {
  note = clampMidiByte(note);
  HeldNote& held = heldNotes_[static_cast<std::size_t>(note)];
  held.keyDown = false;
  held.order = 0;
  held.velocity = 0;
  if (currentNote_ != note) return;

  if (selectMostRecentHeldNote()) return;
  if (sustainDown_) {
    sustainedCurrent_ = true;
    return;
  }
  currentNote_ = -1;
  sustainedCurrent_ = false;
  envelope_.noteOff();
}

void ChaoticFmCore::setSustain(bool down) noexcept {
  if (sustainDown_ == down) return;
  sustainDown_ = down;
  if (down) return;

  if (sustainedCurrent_) {
    sustainedCurrent_ = false;
    currentNote_ = -1;
    envelope_.noteOff();
  }
}

bool ChaoticFmCore::selectMostRecentHeldNote() noexcept {
  std::uint64_t bestOrder = 0;
  int bestNote = -1;
  int bestVelocity = 0;
  for (std::size_t index = 0; index < heldNotes_.size(); ++index) {
    const HeldNote& held = heldNotes_[index];
    if (held.order > bestOrder && held.keyDown) {
      bestOrder = held.order;
      bestNote = static_cast<int>(index);
      bestVelocity = held.velocity;
    }
  }

  if (bestNote >= 0) {
    selectNote(bestNote, bestVelocity, true, true);
    return true;
  }
  return false;
}

void ChaoticFmCore::selectNote(int note, int velocity,
                               bool envelopeLegato,
                               bool pitchLegato) noexcept {
  currentNote_ = note;
  sustainedCurrent_ = false;
  targetVelocityGain_ =
      static_cast<double>(clampMidiByte(velocity)) / 127.0;
  setPitchTarget(static_cast<double>(note - target_.rootMidiNote),
                 pitchLegato);
  if (!envelopeLegato) envelope_.noteOn();
  hasEverPlayed_ = true;
}

void ChaoticFmCore::setPitchTarget(double semitones,
                                   bool legatoTransition) noexcept {
  targetNoteSemitones_ = semitones;
  const GlideMode effectiveMode =
      glideCcEnabled_ ? target_.glideMode : GlideMode::off;
  const bool shouldGlide =
      hasEverPlayed_ && effectiveGlideTimeMs_ > 0.0 &&
      (effectiveMode == GlideMode::always ||
       (effectiveMode == GlideMode::legato && legatoTransition));

  if (!shouldGlide) {
    currentNoteSemitones_ = targetNoteSemitones_;
    glideStartSemitones_ = currentNoteSemitones_;
    glideLength_ = 0;
    glidePosition_ = 0;
    return;
  }

  glideStartSemitones_ = currentNoteSemitones_;
  const double exactLength = effectiveGlideTimeMs_ * 0.001 * sampleRate_;
  glideLength_ = static_cast<std::uint32_t>(std::max(1.0, exactLength + 0.5));
  glidePosition_ = 0;
}

void ChaoticFmCore::updatePitch() noexcept {
  if (glideLength_ > 0) {
    ++glidePosition_;
    const double progress = std::min(
        1.0, static_cast<double>(glidePosition_) /
                 static_cast<double>(glideLength_));
    currentNoteSemitones_ = glideStartSemitones_ +
                            (targetNoteSemitones_ - glideStartSemitones_) *
                                progress;
    if (glidePosition_ >= glideLength_) {
      currentNoteSemitones_ = targetNoteSemitones_;
      glideLength_ = 0;
      glidePosition_ = 0;
    }
  }

  currentBendNormalized_ +=
      (targetBendNormalized_ - currentBendNormalized_) * performanceSlew_;
  const double semitones = currentNoteSemitones_ +
                           currentBendNormalized_ *
                               target_.pitchBendRangeSemitones;
  currentPitchRatio_ = target_.playModeDrone
                           ? 1.0
                           : std::clamp(std::exp2(semitones / 12.0), 0.0001,
                                        8'192.0);
}

void ChaoticFmCore::clearNotes(bool fastFade) noexcept {
  heldNotes_.fill({});
  currentNote_ = -1;
  sustainDown_ = false;
  sustainedCurrent_ = false;
  if (fastFade) {
    envelope_.allSoundOff();
  } else {
    envelope_.noteOff();
  }
}

void ChaoticFmCore::resetControllers() noexcept {
  setSustain(false);
  targetExpressionGain_ = 1.0;
  targetBendNormalized_ = 0.0;
  glideCcEnabled_ = true;
  ccGlideTimeMs_ = -1.0;
  ccAttackMs_ = -1.0;
  ccDecayMs_ = -1.0;
  ccReleaseMs_ = -1.0;
  updateEffectivePerformanceSettings();
}

void ChaoticFmCore::handleEvent(const PerformanceEvent& event) noexcept {
  switch (event.type) {
    case EventType::noteOn:
      noteOn(event.data1, event.data2);
      break;
    case EventType::noteOff:
      noteOff(event.data1);
      break;
    case EventType::pitchBend:
      targetBendNormalized_ = clampFinite(event.value, -1.0, 1.0, 0.0);
      break;
    case EventType::controlChange:
      switch (event.data1) {
        case 5:
          ccGlideTimeMs_ = zeroLogMap(event.data2, 10.0, 2'000.0);
          updateEffectivePerformanceSettings();
          break;
        case 11:
          targetExpressionGain_ = static_cast<double>(event.data2) / 127.0;
          break;
        case 64:
          setSustain(event.data2 >= 64);
          break;
        case 65:
          glideCcEnabled_ = event.data2 >= 64;
          break;
        case 72:
          ccReleaseMs_ = positiveLogMap(event.data2, 2.0, 10'000.0);
          updateEffectivePerformanceSettings();
          break;
        case 73:
          ccAttackMs_ = zeroLogMap(event.data2, 0.5, 5'000.0);
          updateEffectivePerformanceSettings();
          break;
        case 75:
          ccDecayMs_ = zeroLogMap(event.data2, 1.0, 5'000.0);
          updateEffectivePerformanceSettings();
          break;
        case 120:
          clearNotes(true);
          break;
        case 121:
          resetControllers();
          break;
        case 123:
          clearNotes(false);
          break;
        default:
          break;
      }
      break;
    case EventType::allNotesOff:
      clearNotes(false);
      break;
    case EventType::allSoundOff:
      clearNotes(true);
      break;
    case EventType::resetControllers:
      resetControllers();
      break;
  }
}

void ChaoticFmCore::updateSmoothers() noexcept {
  current_.carrierHz +=
      (target_.carrierHz - current_.carrierHz) * parameterSlew_;
  current_.offsetHz +=
      (target_.offsetHz - current_.offsetHz) * parameterSlew_;
  current_.modulationAmount +=
      (target_.modulationAmount - current_.modulationAmount) * parameterSlew_;
  current_.amountDivisor +=
      (target_.amountDivisor - current_.amountDivisor) * parameterSlew_;
  current_.nonlinearityHz +=
      (target_.nonlinearityHz - current_.nonlinearityHz) * parameterSlew_;
  current_.output += (target_.output - current_.output) * parameterSlew_;
  currentVelocityGain_ +=
      (targetVelocityGain_ - currentVelocityGain_) * performanceSlew_;
  currentExpressionGain_ +=
      (targetExpressionGain_ - currentExpressionGain_) * performanceSlew_;
  const double droneTarget = target_.playModeDrone ? 1.0 : 0.0;
  droneGain_ += (droneTarget - droneGain_) * performanceSlew_;

  for (std::size_t index = 0; index < depthGains_.size(); ++index) {
    const double targetGain =
        index == static_cast<std::size_t>(target_.depth) ? 1.0 : 0.0;
    depthGains_[index] += (targetGain - depthGains_[index]) * depthSlew_;
  }
}

double ChaoticFmCore::renderOscillator() noexcept {
  const double carrierFrequency = std::clamp(
      current_.carrierHz * currentPitchRatio_, -frequencyCeiling_,
      frequencyCeiling_);
  phases_[0] = wrapPhase(phases_[0] + carrierFrequency * phaseScale_);
  const double carrierSignal = std::sin(phases_[0]);

  const double halfAmount = current_.modulationAmount * 0.5;
  const double entryBaseFrequency = current_.offsetHz + halfAmount +
                                    carrierSignal * halfAmount;
  const double entryFrequency = std::clamp(
      entryBaseFrequency * currentPitchRatio_, -frequencyCeiling_,
      frequencyCeiling_);
  phases_[1] = wrapPhase(phases_[1] + entryFrequency * phaseScale_);
  double previousSignal = std::sin(phases_[1]);
  depthSignals_[0] = previousSignal;
  double recursiveAmount = halfAmount;

  for (std::size_t depthIndex = 1; depthIndex <= kMaxDepth; ++depthIndex) {
    const double shapedInput = std::clamp(previousSignal * recursiveAmount,
                                          -kMaximumShaperInput,
                                          kMaximumShaperInput);
    const double recursiveBaseFrequency =
        current_.nonlinearityHz * std::tanh(shapedInput);
    const double recursiveFrequency = std::clamp(
        recursiveBaseFrequency * currentPitchRatio_, -frequencyCeiling_,
        frequencyCeiling_);
    phases_[depthIndex + 1] = wrapPhase(
        phases_[depthIndex + 1] + recursiveFrequency * phaseScale_);
    previousSignal = std::sin(phases_[depthIndex + 1]);
    depthSignals_[depthIndex] = previousSignal;
    recursiveAmount = std::clamp(
        recursiveAmount / std::max(0.001, current_.amountDivisor), 0.0,
        kMaximumRecursiveAmount);
  }

  double mixedSignal = 0.0;
  for (std::size_t index = 0; index < depthSignals_.size(); ++index) {
    mixedSignal += depthSignals_[index] * depthGains_[index];
  }
  return mixedSignal;
}

double ChaoticFmCore::protectOutput(double rawSample) noexcept {
  const double protectedSample = highpassCoefficient_ *
                                 (highpassOutput_ + rawSample - highpassInput_);
  highpassInput_ = rawSample;
  highpassOutput_ = protectedSample;
  return std::tanh(protectedSample * kSoftCeilingDrive) /
         std::tanh(kSoftCeilingDrive) * kSoftCeilingLevel;
}

void ChaoticFmCore::process(float* left, float* right,
                            std::uint32_t sampleCount,
                            const PerformanceEvent* events,
                            std::size_t eventCount) noexcept {
  std::size_t eventIndex = 0;
  for (std::uint32_t sampleIndex = 0; sampleIndex < sampleCount; ++sampleIndex) {
    while (events != nullptr && eventIndex < eventCount &&
           events[eventIndex].sampleOffset <= sampleIndex) {
      handleEvent(events[eventIndex]);
      ++eventIndex;
    }

    updateSmoothers();
    updatePitch();
    const double oscillator = renderOscillator();
    const double envelopeLevel = envelope_.next();
    const double midiLevel =
        envelopeLevel * currentVelocityGain_ * currentExpressionGain_;
    const double performanceLevel =
        droneGain_ + (1.0 - droneGain_) * midiLevel;
    const double rawSample = oscillator * performanceLevel * 0.5;
    const double outputSample = protectOutput(rawSample) * current_.output;
    const float safeSample =
        std::isfinite(outputSample) ? static_cast<float>(outputSample) : 0.0F;
    if (left != nullptr) left[sampleIndex] = safeSample;
    if (right != nullptr) right[sampleIndex] = safeSample;
  }
}

PerformanceSnapshot ChaoticFmCore::snapshot() const noexcept {
  return {currentNote_, currentNote_ >= 0, sustainDown_, currentPitchRatio_,
          envelope_.level(), currentVelocityGain_, currentExpressionGain_,
          envelope_.stage()};
}

}  // namespace morphazoid::chaotic_fm
