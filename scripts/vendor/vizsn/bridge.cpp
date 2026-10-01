// Original Morphazoid WASM bridge. Vizsn algorithm/tables retain upstream notices.
#include <vector>
#include <cmath>
#include <algorithm>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <limits>
#include "soloud_vizsn.h"
static std::vector<float> output;
static bool valid(int voice,float pitch,float rate) {
  // Native vcsrc consumes a signed 32-bit phase increment. Check the actual
  // representation; do not impose an audible pitch or host timing range.
  float phase=pitch*65536.0f/8000.0f;
  return voice>=0 && voice<=9 && std::isfinite(pitch) && std::isfinite(phase)
    && phase>=-2147483648.0f && phase<2147483648.0f
    && std::isfinite(rate) && rate>0;
}
static int render(SoLoud::Vizsn &source,int voice,float pitch,float rate,unsigned seed) {
  srand(seed);
  SoLoud::VizsnInstance instance(&source);
  instance.mCurrentVoiceType=voice;
  instance.mPitch=pitch*65536.0f/8000.0f;
  instance.mRate=rate;
  output.clear();
  float buffer[256],lastIn=0,lastOut=0;
  while(!instance.hasEnded()) {
    unsigned n=instance.getAudio(buffer,256,256);
    if(!n)break;
    for(unsigned i=0;i<n;i++) {
      // Original PCM is unsigned 8-bit scaled to [0,1]. Remove bias and DC.
      float x=buffer[i]-128.0f/255.0f;
      float y=x-lastIn+0.995f*lastOut;
      lastIn=x;lastOut=y;
      output.push_back(std::isfinite(y)?std::clamp(y,-1.0f,1.0f):0);
    }
  }
  // Source's upstream destructor stops playback but does not free mText.
  delete[] source.mText;source.mText=nullptr;
  return output.size()<=std::numeric_limits<int>::max()?static_cast<int>(output.size()):-2;
}
extern "C" {
int vizsn_render_text(const char* text,int voice,float pitch,float rate,unsigned seed) {
 if(!text || !valid(voice,pitch,rate))return -1;
 if(strlen(text)>static_cast<size_t>(std::numeric_limits<int>::max()-3))return -2;
 SoLoud::Vizsn source;source.setText(const_cast<char*>(text));return render(source,voice,pitch,rate,seed);
}
int vizsn_render_phones(const uint8_t* phones,int length,int voice,float pitch,float rate,unsigned seed) {
 if(!phones || length<0 || length>std::numeric_limits<int>::max()-3 || !valid(voice,pitch,rate))return -1;
 for(int i=0;i<length;i++)if(phones[i]>19)return -1;
 SoLoud::Vizsn source;source.mText=new char[length+3];source.mText[0]=-2;
 for(int i=0;i<length;i++)source.mText[i+1]=phones[i];
 source.mText[length+1]=-1;source.mText[length+2]=0;
 return render(source,voice,pitch,rate,seed);
}
const float* vizsn_data(){return output.data();}
}
