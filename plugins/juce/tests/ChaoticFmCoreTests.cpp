#include "morphazoid/ChaoticFmCore.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <limits>
#include <string>
#include <vector>

namespace cf = morphazoid::chaotic_fm;

namespace {
int failures = 0;

void expect(bool condition, const std::string& message) {
  if (!condition) {
    ++failures;
    std::cerr << "FAIL: " << message << '\n';
  }
}

void expectNear(double actual, double expected, double tolerance,
                const std::string& message) {
  if (!std::isfinite(actual) || std::abs(actual - expected) > tolerance) {
    ++failures;
    std::cerr << "FAIL: " << message << " (actual " << actual
              << ", expected " << expected << ", tolerance " << tolerance
              << ")\n";
  }
}

void processSilently(cf::ChaoticFmCore& core, std::uint32_t samples,
                     const cf::PerformanceEvent* events = nullptr,
                     std::size_t eventCount = 0) {
  core.process(nullptr, nullptr, samples, events, eventCount);
}

cf::Parameters midiTestParameters() {
  cf::Parameters parameters;
  parameters.playModeDrone = false;
  parameters.ampAttackMs = 10.0;
  parameters.ampDecayMs = 20.0;
  parameters.ampSustainLevel = 0.5;
  parameters.ampReleaseMs = 10.0;
  return parameters;
}

void testPresetParity() {
  const auto& presets = cf::presets();
  expect(presets.size() == 5, "five browser presets are present");
  expect(std::string(presets[0].id) == "feedback-nest",
         "Feedback Nest keeps its stable ID");
  expectNear(presets[0].parameters.carrierHz, 10.5, 0.0,
             "Feedback Nest carrier matches browser");
  expectNear(presets[1].parameters.modulationAmount, 4'200.0, 0.0,
             "Slow Furnace amount matches browser");
  expectNear(presets[2].parameters.amountDivisor, 5.8, 0.0,
             "Glass Hive divisor matches browser");
  expectNear(presets[3].parameters.nonlinearityHz, 1'024.0, 0.0,
             "Cut Current nonlinearity matches browser");
  expectNear(presets[4].parameters.offsetHz, 787.0, 0.0,
             "Brass Moth offset matches browser");

  for (const auto& preset : presets) {
    const auto& p = preset.parameters;
    expect(p.rootMidiNote == 60, "preset root defaults to C4");
    expectNear(p.pitchBendRangeSemitones, 2.0, 0.0,
               "preset bend range defaults to two semitones");
    expectNear(p.ampAttackMs, 8.0, 0.0, "preset attack default");
    expectNear(p.ampDecayMs, 120.0, 0.0, "preset decay default");
    expectNear(p.ampSustainLevel, 0.72, 0.0, "preset sustain default");
    expectNear(p.ampReleaseMs, 180.0, 0.0, "preset release default");
    expect(p.glideMode == cf::GlideMode::off, "preset glide defaults off");
  }
}

std::vector<float> renderDrone(std::uint32_t sampleCount) {
  cf::ChaoticFmCore core;
  auto parameters = cf::presets()[0].parameters;
  parameters.playModeDrone = true;
  core.setParameters(parameters);
  core.prepare(48'000.0, sampleCount);
  std::vector<float> result(sampleCount);
  core.process(result.data(), nullptr, sampleCount);
  return result;
}

void testDeterministicShortWindow() {
  const auto first = renderDrone(512);
  const auto second = renderDrone(512);
  expect(first == second, "identically reset cores render bit-identically");

  constexpr std::array<std::size_t, 8> indices{
      0, 1, 2, 7, 31, 127, 255, 511};
  // Filled from the double-precision port of the Feedback Nest path. These
  // short-window values catch equation/order/seed changes without pretending
  // that chaotic feedback stays sample-identical across every libm forever.
  constexpr std::array<double, 8> expected{
      0.26271164417266846,
      0.26137766242027283,
      0.25982323288917542,
      0.248637855052948,
      0.10434376448392868,
      -0.17698900401592255,
      0.11617282032966614,
      -0.1545085608959198};
  for (std::size_t i = 0; i < indices.size(); ++i) {
    expectNear(first[indices[i]], expected[i], 2.0e-7,
               "Feedback Nest short-window golden sample " +
                   std::to_string(indices[i]));
  }

  double energy = 0.0;
  for (float sample : first) energy += static_cast<double>(sample) * sample;
  expect(energy > 0.001, "drone reference is audibly non-silent");
}

void testSampleOffsetAndStereo() {
  cf::ChaoticFmCore core;
  auto parameters = midiTestParameters();
  core.setParameters(parameters);
  core.prepare(48'000.0, 128);
  std::array<float, 128> left{};
  std::array<float, 128> right{};
  const auto event = cf::PerformanceEvent::noteOnAt(17, 60, 127);
  core.process(left.data(), right.data(), left.size(), &event, 1);

  for (std::size_t i = 0; i < 17; ++i) {
    expect(left[i] == 0.0F, "note event does not render before sample offset");
  }
  expect(left == right, "native voice writes identical stereo channels");
  double laterEnergy = 0.0;
  for (std::size_t i = 17; i < left.size(); ++i) {
    laterEnergy += static_cast<double>(left[i]) * left[i];
  }
  expect(laterEnergy > 1.0e-10, "note event renders after sample offset");
}

void testExactAdsrCurves() {
  cf::ChaoticFmCore core;
  core.setParameters(midiTestParameters());
  core.prepare(8'000.0);
  const auto noteOn = cf::PerformanceEvent::noteOnAt(0, 60, 127);

  processSilently(core, 40, &noteOn, 1);
  expectNear(core.snapshot().envelopeLevel, 0.75, 1.0e-12,
             "attack uses 1 - (1 - p)^2 at half duration");
  processSilently(core, 40);
  expectNear(core.snapshot().envelopeLevel, 1.0, 1.0e-12,
             "attack reaches one at its exact duration");
  expect(core.snapshot().envelopeStage == cf::EnvelopeStage::decay,
         "attack enters decay at its endpoint");
  processSilently(core, 80);
  expectNear(core.snapshot().envelopeLevel, 0.625, 1.0e-12,
             "decay uses sustain + (1-sustain)*(1-p)^2");
  processSilently(core, 80);
  expectNear(core.snapshot().envelopeLevel, 0.5, 1.0e-12,
             "decay reaches sustain at its exact duration");

  const auto noteOff = cf::PerformanceEvent::noteOffAt(0, 60);
  processSilently(core, 40, &noteOff, 1);
  expectNear(core.snapshot().envelopeLevel, 0.125, 1.0e-12,
             "release uses releaseStart*(1-p)^2");
  processSilently(core, 40);
  expectNear(core.snapshot().envelopeLevel, 0.0, 0.0,
             "release reaches zero at its exact duration");
  expect(core.snapshot().envelopeStage == cf::EnvelopeStage::idle,
         "completed release is idle");
}

void testLastNotePrioritySustainAndFreshRetrigger() {
  cf::ChaoticFmCore core;
  core.setParameters(midiTestParameters());
  core.prepare(8'000.0);
  auto event = cf::PerformanceEvent::noteOnAt(0, 60, 100);
  processSilently(core, 20, &event, 1);
  const double beforeLegato = core.snapshot().envelopeLevel;

  event = cf::PerformanceEvent::noteOnAt(0, 67, 110);
  processSilently(core, 1, &event, 1);
  expect(core.snapshot().currentMidiNote == 67,
         "newest held note wins in mono mode");
  expect(core.snapshot().envelopeLevel > beforeLegato,
         "overlapping note does not retrigger the envelope");

  event = cf::PerformanceEvent::controlChangeAt(0, 64, 127);
  processSilently(core, 1, &event, 1);
  event = cf::PerformanceEvent::noteOffAt(0, 67);
  processSilently(core, 1, &event, 1);
  expect(core.snapshot().currentMidiNote == 60,
         "sustain does not outrank a physically held fallback note");

  event = cf::PerformanceEvent::noteOffAt(0, 60);
  processSilently(core, 200, &event, 1);
  expect(core.snapshot().hasActiveNote,
         "sustain pedal defers the final note release");
  expect(core.snapshot().sustainPedalDown, "sustain state is visible");

  event = cf::PerformanceEvent::controlChangeAt(0, 64, 0);
  processSilently(core, 1, &event, 1);
  expect(!core.snapshot().hasActiveNote,
         "pedal-up releases notes no longer physically held");
  const double releaseStart = core.snapshot().envelopeLevel;

  processSilently(core, 20);
  const double releaseMidpoint = core.snapshot().envelopeLevel;
  event = cf::PerformanceEvent::noteOnAt(0, 62, 100);
  processSilently(core, 1, &event, 1);
  expect(core.snapshot().envelopeLevel > releaseMidpoint,
         "fresh note attacks upward from the current release level");
  expect(releaseStart > releaseMidpoint, "release was progressing before retrigger");
}

void testGlideModesAndPitchBend() {
  cf::ChaoticFmCore core;
  auto parameters = midiTestParameters();
  parameters.glideMode = cf::GlideMode::always;
  parameters.glideTimeMs = 100.0;
  core.setParameters(parameters);
  core.prepare(8'000.0);

  auto event = cf::PerformanceEvent::noteOnAt(0, 72, 127);
  processSilently(core, 1, &event, 1);
  expectNear(core.snapshot().pitchRatio, 2.0, 1.0e-12,
             "first-ever note snaps even in Always mode");

  event = cf::PerformanceEvent::noteOffAt(0, 72);
  processSilently(core, 1, &event, 1);
  event = cf::PerformanceEvent::noteOnAt(0, 60, 127);
  processSilently(core, 400, &event, 1);
  expectNear(core.snapshot().pitchRatio, std::sqrt(2.0), 1.0e-12,
             "Always glide linearly interpolates semitones when detached");
  processSilently(core, 400);
  expectNear(core.snapshot().pitchRatio, 1.0, 1.0e-12,
             "glide reaches target at its exact duration");

  event = cf::PerformanceEvent::pitchBendAt(0, 1.0);
  processSilently(core, 4'000, &event, 1);
  expectNear(core.snapshot().pitchRatio, std::exp2(2.0 / 12.0), 1.0e-6,
             "pitch bend applies configured semitone range after smoothing");
}

void testFactoryCcMappingsAndChannelModes() {
  cf::ChaoticFmCore core;
  auto parameters = midiTestParameters();
  parameters.glideMode = cf::GlideMode::always;
  parameters.glideTimeMs = 0.0;
  parameters.ampReleaseMs = 100.0;
  core.setParameters(parameters);
  core.prepare(8'000.0);

  // CC73 value one maps to the minimum nonzero 0.5 ms / 4-sample attack.
  std::array<cf::PerformanceEvent, 2> events{
      cf::PerformanceEvent::controlChangeAt(0, 73, 1),
      cf::PerformanceEvent::noteOnAt(0, 60, 127)};
  processSilently(core, 2, events.data(), events.size());
  expectNear(core.snapshot().envelopeLevel, 0.75, 1.0e-12,
             "CC73 value one is the 0.5 ms logarithmic minimum");

  cf::ChaoticFmCore zeroEnvelopeCore;
  zeroEnvelopeCore.setParameters(midiTestParameters());
  zeroEnvelopeCore.prepare(8'000.0);
  const std::array<cf::PerformanceEvent, 3> zeroEnvelopeEvents{
      cf::PerformanceEvent::controlChangeAt(0, 73, 0),
      cf::PerformanceEvent::controlChangeAt(0, 75, 0),
      cf::PerformanceEvent::noteOnAt(0, 60, 127)};
  processSilently(zeroEnvelopeCore, 1, zeroEnvelopeEvents.data(),
                  zeroEnvelopeEvents.size());
  expect(zeroEnvelopeCore.snapshot().envelopeStage ==
             cf::EnvelopeStage::sustain,
         "CC73 and CC75 value zero produce immediate attack and decay");
  expectNear(zeroEnvelopeCore.snapshot().envelopeLevel, 0.5, 0.0,
             "zero-duration factory envelope controls land on sustain");

  // CC5 value one is the 10 ms minimum nonzero glide time.
  auto event = cf::PerformanceEvent::controlChangeAt(0, 5, 1);
  processSilently(core, 1, &event, 1);
  event = cf::PerformanceEvent::noteOnAt(0, 72, 127);
  processSilently(core, 40, &event, 1);
  expectNear(core.snapshot().pitchRatio, std::sqrt(2.0), 1.0e-12,
             "CC5 value one maps to a 10 ms semitone-linear glide");

  event = cf::PerformanceEvent::controlChangeAt(0, 65, 0);
  processSilently(core, 1, &event, 1);
  event = cf::PerformanceEvent::noteOnAt(0, 48, 127);
  processSilently(core, 1, &event, 1);
  expectNear(core.snapshot().pitchRatio, 0.5, 1.0e-12,
             "CC65 below 64 disables the configured glide mode");

  event = cf::PerformanceEvent::controlChangeAt(0, 11, 0);
  processSilently(core, 4'000, &event, 1);
  expect(core.snapshot().expressionGain < 1.0e-4,
         "CC11 expression is smoothed toward zero");
  event = cf::PerformanceEvent::controlChangeAt(0, 121, 0);
  processSilently(core, 4'000, &event, 1);
  expect(core.snapshot().hasActiveNote,
         "CC121 does not kill physically held notes");
  expectNear(core.snapshot().expressionGain, 1.0, 1.0e-4,
             "CC121 restores expression controller state");

  event = cf::PerformanceEvent::controlChangeAt(0, 120, 0);
  processSilently(core, 8, &event, 1);
  expect(!core.snapshot().hasActiveNote, "CC120 clears held notes immediately");
  expect(core.snapshot().envelopeLevel > 0.0,
         "CC120 uses a click-safe two millisecond fade");
  processSilently(core, 8);
  expect(core.snapshot().envelopeStage == cf::EnvelopeStage::idle,
         "CC120 fade completes in exactly two milliseconds");

  event = cf::PerformanceEvent::noteOnAt(0, 60, 127);
  processSilently(core, 100, &event, 1);
  event = cf::PerformanceEvent::controlChangeAt(0, 123, 0);
  processSilently(core, 16, &event, 1);
  expect(!core.snapshot().hasActiveNote, "CC123 clears the note registry");
  expect(core.snapshot().envelopeStage == cf::EnvelopeStage::release,
         "CC123 uses the normal release rather than the two millisecond fade");
}

void testFiniteExtremeOutput() {
  cf::ChaoticFmCore core;
  cf::Parameters parameters;
  parameters.depth = 100;
  parameters.carrierHz = std::numeric_limits<double>::infinity();
  parameters.offsetHz = -1.0e9;
  parameters.modulationAmount = 1.0e99;
  parameters.amountDivisor = 0.0;
  parameters.nonlinearityHz = std::numeric_limits<double>::quiet_NaN();
  parameters.output = 999.0;
  parameters.ampAttackMs = 0.0;
  parameters.ampDecayMs = 0.0;
  parameters.ampSustainLevel = 1.0;
  parameters.ampReleaseMs = 0.0;
  core.setParameters(parameters);
  core.prepare(48'000.0, 4'096);

  const auto safe = core.parameters();
  expect(safe.depth == 10, "depth is safety-clamped");
  expect(std::isfinite(safe.carrierHz), "non-finite carrier is sanitized");
  expectNear(safe.offsetHz, 0.0, 0.0, "negative offset is clamped");
  expectNear(safe.amountDivisor, 0.001, 0.0, "divisor cannot reach zero");
  expectNear(safe.output, 0.82, 0.0, "output respects fixed ceiling");
  expectNear(safe.ampReleaseMs, 2.0, 0.0,
             "release parameter keeps its two millisecond minimum");

  std::vector<float> left(50'000);
  std::vector<float> right(50'000);
  const auto event = cf::PerformanceEvent::noteOnAt(0, 127, 127);
  core.process(left.data(), right.data(), static_cast<std::uint32_t>(left.size()),
               &event, 1);
  float peak = 0.0F;
  for (std::size_t i = 0; i < left.size(); ++i) {
    expect(std::isfinite(left[i]), "extreme recursive output remains finite");
    expect(left[i] == right[i], "extreme render remains coherent stereo");
    peak = std::max(peak, std::abs(left[i]));
  }
  expect(peak <= 0.83F, "protected output remains below unity");
  expect(peak > 0.001F, "extreme safety test still produces audio");
}

}  // namespace

int main(int argc, char** argv) {
  if (argc == 2 && std::string(argv[1]) == "--print-golden") {
    const auto samples = renderDrone(512);
    for (const std::size_t index :
         std::array<std::size_t, 8>{0, 1, 2, 7, 31, 127, 255, 511}) {
      std::cout.precision(17);
      std::cout << index << ": " << samples[index] << '\n';
    }
    return EXIT_SUCCESS;
  }

  testPresetParity();
  testDeterministicShortWindow();
  testSampleOffsetAndStereo();
  testExactAdsrCurves();
  testLastNotePrioritySustainAndFreshRetrigger();
  testGlideModesAndPitchBend();
  testFactoryCcMappingsAndChannelModes();
  testFiniteExtremeOutput();

  if (failures != 0) {
    std::cerr << failures << " test assertion(s) failed\n";
    return EXIT_FAILURE;
  }
  std::cout << "Chaotic FM core tests passed\n";
  return EXIT_SUCCESS;
}
