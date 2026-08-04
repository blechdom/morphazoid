#pragma once

#include <array>

#include <juce_audio_processors/juce_audio_processors.h>

#include "morphazoid/ChaoticFmCore.h"

class MorphazoidChaoticFmProcessor final : public juce::AudioProcessor {
 public:
  MorphazoidChaoticFmProcessor();

  void prepareToPlay(double sampleRate, int maximumBlockSize) override;
  void releaseResources() override {}
  bool isBusesLayoutSupported(const BusesLayout& layouts) const override;
  void processBlock(juce::AudioBuffer<float>&,
                    juce::MidiBuffer&) override;

  juce::AudioProcessorEditor* createEditor() override;
  bool hasEditor() const override { return true; }
  const juce::String getName() const override { return JucePlugin_Name; }
  bool acceptsMidi() const override { return true; }
  bool producesMidi() const override { return false; }
  bool isMidiEffect() const override { return false; }
  double getTailLengthSeconds() const override;
  int getNumPrograms() override { return 1; }
  int getCurrentProgram() override { return 0; }
  void setCurrentProgram(int) override {}
  const juce::String getProgramName(int) override { return {}; }
  void changeProgramName(int, const juce::String&) override {}
  void getStateInformation(juce::MemoryBlock&) override;
  void setStateInformation(const void*, int) override;

  juce::AudioProcessorValueTreeState& state() noexcept { return state_; }

 private:
  static juce::AudioProcessorValueTreeState::ParameterLayout createLayout();
  morphazoid::chaotic_fm::Parameters readParameters() const noexcept;

  morphazoid::chaotic_fm::ChaoticFmCore core_;
  juce::AudioProcessorValueTreeState state_;
  std::array<morphazoid::chaotic_fm::PerformanceEvent, 2048> eventScratch_{};
};
