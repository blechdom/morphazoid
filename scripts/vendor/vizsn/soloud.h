// Morphazoid's device-free base-class shim. No SoLoud mixer or device code.
#pragma once
#include <cassert>
#define SOLOUD_ASSERT assert
namespace SoLoud {
class AudioSourceInstance { public: virtual ~AudioSourceInstance() = default; virtual unsigned int getAudio(float*,unsigned int,unsigned int)=0; virtual bool hasEnded()=0; };
class AudioSource { public: float mBaseSamplerate=8000; virtual ~AudioSource()=default; virtual AudioSourceInstance* createInstance()=0; void stop() {} };
}
