// Morphazoid host-independent container for the BSD-3-Clause MAME generator.
#pragma once
#include <cstdint>
#include <cmath>
#include <numbers>
#include <algorithm>
#define F0 8000
#define QUANT 512
class mea8000_device {
public:
 static constexpr unsigned TABLE_LEN=3600,NOISE_LEN=8192;
 struct filter_t {uint16_t fm=0,last_fm=0,bw=0,last_bw=0;int32_t output=0,last_output=0;};
 uint8_t m_buf[4]={},m_bufpos=0,m_noise=0;
 uint16_t m_framelength=0,m_framepos=0,m_framelog=0;
 uint16_t m_last_ampl=0,m_ampl=0,m_last_pitch=0,m_pitch=0;
 uint32_t m_phi=0,seed=1;
 filter_t m_f[4];
 int m_cos_table[TABLE_LEN],m_exp_table[TABLE_LEN],m_exp2_table[TABLE_LEN],m_noise_table[NOISE_LEN];
 uint32_t nextRandom(){seed=seed*1664525u+1013904223u;return seed;}
 void init_tables();int interp(uint16_t,uint16_t);int filter_step(int,int);int noise_gen();int freq_gen();int compute_sample();void shift_frame();void decode_frame();
};
