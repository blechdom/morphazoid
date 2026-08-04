cmake_minimum_required(VERSION 3.20)

project(MorphazoidChaoticFM VERSION 0.2.0 LANGUAGES C CXX)

option(MORPHAZOID_BUILD_TESTS "Build the dependency-free core tests" ON)
option(MORPHAZOID_BUILD_JUCE_PLUGIN
       "Build the VST3 when an external JUCE package is available" OFF)
set(MORPHAZOID_JUCE_SOURCE_DIR "" CACHE PATH
    "Path to an external JUCE source checkout (never vendored/downloaded)")

add_library(morphazoid_chaotic_fm_core STATIC
  src/ChaoticFmCore.cpp
)
add_library(Morphazoid::ChaoticFmCore ALIAS morphazoid_chaotic_fm_core)

target_include_directories(morphazoid_chaotic_fm_core
  PUBLIC
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
)
target_compile_features(morphazoid_chaotic_fm_core PUBLIC cxx_std_17)

if(CMAKE_CXX_COMPILER_ID MATCHES "Clang|GNU")
  target_compile_options(morphazoid_chaotic_fm_core PRIVATE
    -Wall -Wextra -Wpedantic -Wconversion -Wshadow
  )
elseif(MSVC)
  target_compile_options(morphazoid_chaotic_fm_core PRIVATE /W4 /permissive-)
endif()

if(MORPHAZOID_BUILD_TESTS)
  enable_testing()
  add_executable(morphazoid_chaotic_fm_core_tests
    tests/ChaoticFmCoreTests.cpp
  )
  target_link_libraries(morphazoid_chaotic_fm_core_tests
    PRIVATE Morphazoid::ChaoticFmCore
  )
  target_compile_features(morphazoid_chaotic_fm_core_tests PRIVATE cxx_std_17)
  add_test(NAME morphazoid_chaotic_fm_core_tests
           COMMAND morphazoid_chaotic_fm_core_tests)
endif()

if(MORPHAZOID_BUILD_JUCE_PLUGIN)
  # Supply an existing JUCE source checkout or installed CMake package. This
  # project deliberately does not FetchContent/download dependencies.
  if(MORPHAZOID_JUCE_SOURCE_DIR)
    if(NOT EXISTS "${MORPHAZOID_JUCE_SOURCE_DIR}/CMakeLists.txt")
      message(FATAL_ERROR
        "MORPHAZOID_JUCE_SOURCE_DIR does not contain a JUCE CMakeLists.txt")
    endif()
    add_subdirectory("${MORPHAZOID_JUCE_SOURCE_DIR}"
                     "${CMAKE_CURRENT_BINARY_DIR}/JUCE" EXCLUDE_FROM_ALL)
  else()
    find_package(JUCE CONFIG REQUIRED)
  endif()

  juce_add_plugin(MorphazoidChaoticFM
    COMPANY_NAME "Morphazoid"
    BUNDLE_ID "audio.morphazoid.chaoticfm"
    PLUGIN_MANUFACTURER_CODE Mzod
    PLUGIN_CODE Chfm
    PRODUCT_NAME "Morphazoid Chaotic FM"
    DESCRIPTION "Chaotic recursive FM instrument"
    IS_SYNTH TRUE
    NEEDS_MIDI_INPUT TRUE
    NEEDS_MIDI_OUTPUT FALSE
    IS_MIDI_EFFECT FALSE
    EDITOR_WANTS_KEYBOARD_FOCUS TRUE
    NEEDS_CURL FALSE
    NEEDS_WEB_BROWSER TRUE
    COPY_PLUGIN_AFTER_BUILD FALSE
    FORMATS VST3
  )

  target_sources(MorphazoidChaoticFM PRIVATE
    juce/PluginProcessor.cpp
    juce/PluginProcessor.h
  )
  target_link_libraries(MorphazoidChaoticFM PRIVATE
    Morphazoid::ChaoticFmCore
    juce::juce_audio_utils
  )
  target_compile_features(MorphazoidChaoticFM PRIVATE cxx_std_17)
  target_compile_definitions(MorphazoidChaoticFM PRIVATE
    JUCE_VST3_CAN_REPLACE_VST2=0
  )
endif()
