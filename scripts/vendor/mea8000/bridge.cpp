// MAME's quantized MEA8000 DSP with a device-independent offline frame host.
#include "core.hpp"
#include <vector>
#include <cstring>
#include <limits>
static std::vector<float> output;
extern "C" {
int mea8000_render(const uint8_t* frames,int length,int pitch,unsigned seed) {
 if(!frames||length<4||length%4)return -1;
 // Original initial-pitch register is one unsigned byte multiplied by two.
 if(pitch<0||pitch>510||pitch%2)return -1;
 mea8000_device model;model.seed=seed;model.init_tables();model.m_pitch=model.m_last_pitch=pitch;
 output.clear();int sample=0,lastsample=0;
 auto renderFrame=[&](){
  for(model.m_framepos=0;model.m_framepos<model.m_framelength;model.m_framepos++) {
   int pos=model.m_framepos%8;
   if(!pos){lastsample=sample;sample=model.compute_sample();}
   int value=lastsample+(pos*(sample-lastsample))/8;
   output.push_back(value/32768.0f);
  }
 };
 for(int offset=0;offset<length;offset+=4) {
  model.shift_frame();memcpy(model.m_buf,frames+offset,4);model.decode_frame();
  // Preserve native uint16_t pitch accumulation, including its wrap behavior.
  if(offset==0){for(auto &f:model.m_f){f.last_fm=f.fm;f.last_bw=f.bw;}}
  renderFrame();
 }
 model.shift_frame();model.m_ampl=0;renderFrame();
 return output.size()<=std::numeric_limits<int>::max()?static_cast<int>(output.size()):-2;
}
const float* mea8000_data(){return output.data();}
}
