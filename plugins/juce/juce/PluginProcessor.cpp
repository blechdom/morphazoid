#include "PluginProcessor.h"

#include <algorithm>
#include <cmath>
#include <memory>
#include <vector>

namespace {
using morphazoid::chaotic_fm::GlideMode;
using morphazoid::chaotic_fm::Parameters;
using morphazoid::chaotic_fm::PerformanceEvent;

constexpr const char* kDepth = "synthesis.depth";
constexpr const char* kCarrier = "synthesis.carrierHz";
constexpr const char* kOffset = "synthesis.offsetHz";
constexpr const char* kAmount = "synthesis.modulationAmount";
constexpr const char* kDivisor = "synthesis.amountDivisor";
constexpr const char* kNonlinearity = "synthesis.nonlinearityHz";
constexpr const char* kOutput = "output.level";
constexpr const char* kPlayMode = "performance.playMode";
constexpr const char* kRootNote = "performance.rootMidiNote";
constexpr const char* kBendRange = "performance.pitchBendRangeSemitones";
constexpr const char* kAttack = "performance.ampAttackMs";
constexpr const char* kDecay = "performance.ampDecayMs";
constexpr const char* kSustain = "performance.ampSustainLevel";
constexpr const char* kRelease = "performance.ampReleaseMs";
constexpr const char* kGlideTime = "performance.glideTimeMs";
constexpr const char* kGlideMode = "performance.glideMode";

float raw(const juce::AudioProcessorValueTreeState& state,
          const char* id) noexcept {
  return state.getRawParameterValue(id)->load();
}
}  // namespace

MorphazoidChaoticFmProcessor::MorphazoidChaoticFmProcessor()
    : AudioProcessor(BusesProperties().withOutput(
          "Output", juce::AudioChannelSet::stereo(), true)),
      state_(*this, nullptr, "MorphazoidChaoticFm", createLayout()) {}

void MorphazoidChaoticFmProcessor::prepareToPlay(double sampleRate,
                                                 int maximumBlockSize) {
  core_.setParameters(readParameters());
  core_.prepare(sampleRate, static_cast<std::uint32_t>(maximumBlockSize));
}

bool MorphazoidChaoticFmProcessor::isBusesLayoutSupported(
    const BusesLayout& layouts) const {
  return layouts.getMainInputChannelSet().isDisabled() &&
         layouts.getMainOutputChannelSet() == juce::AudioChannelSet::stereo();
}

Parameters MorphazoidChaoticFmProcessor::readParameters() const noexcept {
  Parameters parameters;
  parameters.depth = static_cast<int>(std::lround(raw(state_, kDepth)));
  parameters.carrierHz = raw(state_, kCarrier);
  parameters.offsetHz = raw(state_, kOffset);
  parameters.modulationAmount = raw(state_, kAmount);
  parameters.amountDivisor = raw(state_, kDivisor);
  parameters.nonlinearityHz = raw(state_, kNonlinearity);
  parameters.output = raw(state_, kOutput);
  parameters.playModeDrone = raw(state_, kPlayMode) < 0.5F;
  parameters.rootMidiNote =
      static_cast<int>(std::lround(raw(state_, kRootNote)));
  parameters.pitchBendRangeSemitones = raw(state_, kBendRange);
  parameters.ampAttackMs = raw(state_, kAttack);
  parameters.ampDecayMs = raw(state_, kDecay);
  parameters.ampSustainLevel = raw(state_, kSustain);
  parameters.ampReleaseMs = raw(state_, kRelease);
  parameters.glideTimeMs = raw(state_, kGlideTime);
  parameters.glideMode = static_cast<GlideMode>(
      std::clamp(static_cast<int>(std::lround(raw(state_, kGlideMode))), 0, 2));
  return parameters;
}

void MorphazoidChaoticFmProcessor::processBlock(
    juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi) {
  juce::ScopedNoDenormals noDenormals;
  core_.setParameters(readParameters());

  std::size_t eventCount = 0;
  bool overflow = false;
  for (const auto metadata : midi) {
    if (eventCount >= eventScratch_.size()) {
      overflow = true;
      break;
    }

    const juce::MidiMessage message = metadata.getMessage();
    const auto offset = static_cast<std::uint32_t>(
        std::clamp(metadata.samplePosition, 0,
                   std::max(0, buffer.getNumSamples() - 1)));
    PerformanceEvent event;
    bool handled = true;
    if (message.isNoteOn()) {
      event = PerformanceEvent::noteOnAt(
          offset, message.getNoteNumber(), message.getVelocity(),
          message.getChannel() - 1);
    } else if (message.isNoteOff()) {
      event = PerformanceEvent::noteOffAt(
          offset, message.getNoteNumber(), message.getChannel() - 1);
    } else if (message.isPitchWheel()) {
      event = PerformanceEvent::pitchWheelAt(
          offset, message.getPitchWheelValue(), message.getChannel() - 1);
    } else if (message.isController()) {
      event = PerformanceEvent::controlChangeAt(
          offset, message.getControllerNumber(), message.getControllerValue(),
          message.getChannel() - 1);
    } else {
      handled = false;
    }
    if (handled) eventScratch_[eventCount++] = event;
  }

  if (overflow) {
    eventScratch_[0] = PerformanceEvent::allSoundOffAt();
    eventCount = 1;
  }

  float* left = buffer.getWritePointer(0);
  float* right = buffer.getWritePointer(1);
  core_.process(left, right, static_cast<std::uint32_t>(buffer.getNumSamples()),
                eventScratch_.data(), eventCount);
  midi.clear();
}

juce::AudioProcessorEditor* MorphazoidChaoticFmProcessor::createEditor() {
  // A usable host-native editor now. The planned WebBrowserComponent editor
  // will bind the same stable parameter IDs without changing this DSP core.
  return new juce::GenericAudioProcessorEditor(*this);
}

double MorphazoidChaoticFmProcessor::getTailLengthSeconds() const {
  return static_cast<double>(raw(state_, kRelease)) * 0.001;
}

void MorphazoidChaoticFmProcessor::getStateInformation(
    juce::MemoryBlock& destination) {
  const auto state = state_.copyState();
  if (const auto xml = state.createXml()) copyXmlToBinary(*xml, destination);
}

void MorphazoidChaoticFmProcessor::setStateInformation(const void* data,
                                                       int size) {
  if (const auto xml = getXmlFromBinary(data, size)) {
    if (xml->hasTagName(state_.state.getType())) {
      state_.replaceState(juce::ValueTree::fromXml(*xml));
    }
  }
}

juce::AudioProcessorValueTreeState::ParameterLayout
MorphazoidChaoticFmProcessor::createLayout() {
  std::vector<std::unique_ptr<juce::RangedAudioParameter>> parameters;
  parameters.push_back(std::make_unique<juce::AudioParameterInt>(
      kDepth, "Turns (depth)", 0, 10, 1));
  parameters.push_back(std::make_unique<juce::AudioParameterFloat>(
      kCarrier, "Carrier rate (Hz)",
      juce::NormalisableRange<float>(0.01F, 4'800.0F, 0.0F, 0.25F), 10.5F));
  parameters.push_back(std::make_unique<juce::AudioParameterFloat>(
      kOffset, "Entry offset (Hz)", 0.0F, 4'800.0F, 0.0F));
  parameters.push_back(std::make_unique<juce::AudioParameterFloat>(
      kAmount, "Modulation amount (Hz)", 0.0F, 4'800.0F, 350.0F));
  parameters.push_back(std::make_unique<juce::AudioParameterFloat>(
      kDivisor, "Amount divisor",
      juce::NormalisableRange<float>(0.001F, 8.0F, 0.0F, 0.25F), 0.4F));
  parameters.push_back(std::make_unique<juce::AudioParameterFloat>(
      kNonlinearity, "Nonlinearity rate (Hz)",
      juce::NormalisableRange<float>(0.001F, 4'000.0F, 0.0F, 0.25F), 256.0F));
  parameters.push_back(std::make_unique<juce::AudioParameterFloat>(
      kOutput, "Output", 0.0F, 0.82F, 0.42F));
  parameters.push_back(std::make_unique<juce::AudioParameterChoice>(
      kPlayMode, "Play mode", juce::StringArray{"Drone", "MIDI"}, 1));
  parameters.push_back(std::make_unique<juce::AudioParameterInt>(
      kRootNote, "Root MIDI note", 0, 127, 60));
  parameters.push_back(std::make_unique<juce::AudioParameterInt>(
      kBendRange, "Pitch-bend range", 0, 24, 2));
  parameters.push_back(std::make_unique<juce::AudioParameterFloat>(
      kAttack, "Amp attack (ms)", 0.0F, 5'000.0F, 8.0F));
  parameters.push_back(std::make_unique<juce::AudioParameterFloat>(
      kDecay, "Amp decay (ms)", 0.0F, 5'000.0F, 120.0F));
  parameters.push_back(std::make_unique<juce::AudioParameterFloat>(
      kSustain, "Amp sustain", 0.0F, 1.0F, 0.72F));
  parameters.push_back(std::make_unique<juce::AudioParameterFloat>(
      kRelease, "Amp release (ms)", 2.0F, 10'000.0F, 180.0F));
  parameters.push_back(std::make_unique<juce::AudioParameterFloat>(
      kGlideTime, "Glide time (ms)", 0.0F, 2'000.0F, 0.0F));
  parameters.push_back(std::make_unique<juce::AudioParameterChoice>(
      kGlideMode, "Glide mode",
      juce::StringArray{"Off", "Legato", "Always"}, 0));
  return {parameters.begin(), parameters.end()};
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() {
  return new MorphazoidChaoticFmProcessor();
}
