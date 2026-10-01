// license:BSD-3-Clause
// copyright-holders:Antoine Mine
// Copyright (C) Antoine Mine 2006
// Extracted DSP; Morphazoid substitutes deterministic random noise and an offline frame host.
#include "core.hpp"
static const int fm1_table[32] =
{
	150,  162,  174,  188,  202,  217,  233,  250,
	267,  286,  305,  325,  346,  368,  391,  415,
	440,  466,  494,  523,  554,  587,  622,  659,
	698,  740,  784,  830,  880,  932,  988, 1047
};

static const int fm2_table[32] =
{
	440,  466,  494,  523,  554,  587,  622,  659,
	698,  740,  784,  830,  880,  932,  988, 1047,
	1100, 1179, 1254, 1337, 1428, 1528, 1639, 1761,
	1897, 2047, 2214, 2400, 2609, 2842, 3105, 3400
};

static const int fm3_table[8] =
{
	1179, 1337, 1528, 1761, 2047, 2400, 2842, 3400
};

static const int fm4_table[1] = { 3500 };



/* bandwidth, in Hz */
static const int bw_table[4] = { 726, 309, 125, 50 };



/* amplitude * 1000 */
static const int ampl_table[16] =
{
	0,   8,  11,  16,  22,  31,  44,   62,
	88, 125, 177, 250, 354, 500, 707, 1000
};



/* pitch increment, in Hz / 8 ms */
static const int pi_table[32] =
{
	0, 1,  2,  3,  4,  5,  6,  7,
	8, 9, 10, 11, 12, 13, 14, 15,
	0 /* noise */, -15, -14, -13, -12, -11, -10, -9,
	-8, -7, -6, -5, -4, -3, -2, -1
};



void mea8000_device::init_tables()
{
	for (int i = 0; i < TABLE_LEN; i++)
	{
		double f = (double)i / F0;
		m_cos_table[i]  = 2. * cos(2. * std::numbers::pi * f) * QUANT;
		m_exp_table[i]  = exp(-std::numbers::pi * f) * QUANT;
		m_exp2_table[i] = exp(-2 * std::numbers::pi * f) * QUANT;
	}
	for (auto & elem : m_noise_table)
		elem = (nextRandom() % (2 * QUANT)) - QUANT;
}

int mea8000_device::interp( uint16_t org, uint16_t dst )
{
	return org + (((dst - org) * m_framepos) >> m_framelog);
}

int mea8000_device::filter_step( int i, int input )
{
	/* frequency */
	int fm = interp(m_f[i].last_fm, m_f[i].fm);
	/* bandwidth */
	int bw = interp(m_f[i].last_bw, m_f[i].bw);
	/* filter coefficients */
	int b = (m_cos_table[fm] * m_exp_table[bw]) / QUANT;
	int c = m_exp2_table[bw];
	/* transfer function */
	int next_output = input + (b * m_f[i].output - c * m_f[i].last_output) / QUANT;
	m_f[i].last_output = m_f[i].output;
	m_f[i].output = next_output;
	return next_output;
}

int mea8000_device::noise_gen()
{
	m_phi = (m_phi + 1) % NOISE_LEN;
	return m_noise_table[m_phi];
}

int mea8000_device::freq_gen()
{
	int pitch = interp(m_last_pitch, m_pitch);
	m_phi = (m_phi + pitch) % F0;
	return ((m_phi % F0) * QUANT * 2) / F0 - QUANT;
}

int mea8000_device::compute_sample()
{
	int out;
	int ampl = interp(m_last_ampl, m_ampl);

	if (m_noise)
		out = noise_gen();
	else
		out = freq_gen();

	out *= ampl / 32;

	for (int i = 0; i < 4; i++)
		out = filter_step(i, out);

	if (out > 32767)
		out = 32767;
	if (out < -32767)
		out = -32767;
	return out;
}

void mea8000_device::shift_frame()
{
	m_last_pitch = m_pitch;
	for (auto & elem : m_f)
	{
		elem.last_bw = elem.bw;
		elem.last_fm = elem.fm;
	}
	m_last_ampl = m_ampl;
}

void mea8000_device::decode_frame()
{
	int fd = (m_buf[3] >> 5) & 3; /* 0=8ms, 1=16ms, 2=32ms, 3=64ms */
	int pi = pi_table[m_buf[3] & 0x1f] << fd;
	m_noise = (m_buf[3] & 0x1f) == 16;
	m_pitch = m_last_pitch + pi;
	m_f[0].bw = bw_table[m_buf[0] >> 6];
	m_f[1].bw = bw_table[(m_buf[0] >> 4) & 3];
	m_f[2].bw = bw_table[(m_buf[0] >> 2) & 3];
	m_f[3].bw = bw_table[m_buf[0] & 3];
	m_f[3].fm = fm4_table[0];
	m_f[2].fm = fm3_table[m_buf[1] >> 5];
	m_f[1].fm = fm2_table[m_buf[1] & 0x1f];
	m_f[0].fm = fm1_table[m_buf[2] >> 3];
	m_ampl = ampl_table[((m_buf[2] & 7) << 1) | (m_buf[3] >> 7)];
	m_framelog = fd + 6 /* 64 samples / ms */ + 3;
	m_framelength = 1 << m_framelog;
	m_bufpos = 0;
}
