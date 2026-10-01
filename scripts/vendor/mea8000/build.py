#!/usr/bin/env python3
"""Extract unchanged integer DSP/formant tables from pinned MAME; add offline host."""
from pathlib import Path
import subprocess,os,json,hashlib,urllib.request
root=Path(__file__).resolve().parent
revision='c8588c15c78215a0ce36ac573aa5e8da03185e4c'
p=root/'upstream/mea8000.cpp'
if not p.exists():
 p.parent.mkdir(exist_ok=True);p.write_bytes(urllib.request.urlopen(f'https://raw.githubusercontent.com/mamedev/mame/{revision}/src/devices/sound/mea8000.cpp').read())
s=p.read_text()
def method(signature):
 start=s.index(signature);brace=s.index('{',start);depth=1;end=brace+1
 while depth:
  if s[end]=='{':depth+=1
  if s[end]=='}':depth-=1
  end+=1
 return s[start:end]
tables=s[s.index('static const int fm1_table'):s.index('DEFINE_DEVICE_TYPE')]
parts=[method('void mea8000_device::init_tables()').replace('machine().rand()','nextRandom()')]
for signature in ['int mea8000_device::interp( uint16_t','int mea8000_device::filter_step( int','int mea8000_device::noise_gen()','int mea8000_device::freq_gen()','int mea8000_device::compute_sample()','void mea8000_device::shift_frame()']:
 parts.append(method(signature))
decode=method('void mea8000_device::decode_frame()')
decode=decode[:decode.index('#ifdef MEA8000_FLOAT_MODE')]+'}'
parts.append(decode)
(root/'mea8000.cpp').write_text('// license:BSD-3-Clause\n// copyright-holders:Antoine Mine\n// Copyright (C) Antoine Mine 2006\n// Extracted DSP; Morphazoid substitutes deterministic random noise and an offline frame host.\n#include "core.hpp"\n'+tables+'\n\n'.join(parts)+'\n')
emcc=os.environ.get('EMXX','em++')
subprocess.run([emcc,str(root/'mea8000.cpp'),str(root/'bridge.cpp'),'-I'+str(root),'-std=c++20','-O3','-fwrapv','-sMODULARIZE=1','-sEXPORT_ES6=1','-sEXPORT_NAME=createMea8000','-sENVIRONMENT=web,worker,node','-sFILESYSTEM=0','-sALLOW_MEMORY_GROWTH=1','-sINITIAL_MEMORY=16777216','-sMAXIMUM_MEMORY=4294967296','-sSTACK_SIZE=131072','-sEXPORTED_FUNCTIONS=["_mea8000_render","_mea8000_data","_malloc","_free"]','-sEXPORTED_RUNTIME_METHODS=["HEAPF32","HEAPU8"]','-o',str(root/'mea8000.js')],check=True)
files={name:{'bytes':(root/name).stat().st_size,'sha256':hashlib.sha256((root/name).read_bytes()).hexdigest()} for name in ['mea8000.js','mea8000.wasm','upstream/mea8000.cpp']}
(root/'build.json').write_text(json.dumps({'source':'https://github.com/mamedev/mame','revision':revision,'emscripten':subprocess.check_output([emcc,'--version']).decode().splitlines()[0],'files':files},indent=2)+'\n')
