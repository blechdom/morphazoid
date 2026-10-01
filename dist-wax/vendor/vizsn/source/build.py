#!/usr/bin/env python3
"""Build pinned Vizsn with local Emscripten em++; no native audio or filesystem."""
from pathlib import Path
import subprocess, os, json, hashlib, urllib.request
root=Path(__file__).resolve().parent
revision='e82fd32c1f62183922f08c14c814a02b58db1873'
for name,rel in [('soloud_vizsn.cpp','src/audiosource/vizsn/soloud_vizsn.cpp'),('soloud_vizsn.h','include/soloud_vizsn.h')]:
 p=root/'upstream'/name
 if not p.exists():
  p.parent.mkdir(exist_ok=True);p.write_bytes(urllib.request.urlopen(f'https://raw.githubusercontent.com/jarikomppa/soloud/{revision}/{rel}').read())
source=(root/'upstream/soloud_vizsn.cpp').read_text()
# Stream the native phone hold/transition sequence so timing does not depend on
# an arbitrarily sized temporary phone buffer.
start=source.index('\tunsigned int VizsnInstance::getAudio(')
end=source.index('\n\tfloat VizsnInstance::vcsrc(',start)
source=source[:start]+(root/'stream-get-audio.inc').read_text()+source[end:]
# Saturate float-to-integer conversion before the intentionally 8-bit output stage.
source=source.replace('ob = (int)floor(o * 400 * 256 + (mEchobuf[mPtr] / 4));','double raw = floor((double)o * 400 * 256 + (mEchobuf[mPtr] / 4));\n\t\tob = !isfinite(raw) ? 0 : (int)fmax(-2147483647.0, fmin(2147483647.0, raw));')
(root/'vizsn.cpp').write_text(source)
header=(root/'upstream/soloud_vizsn.h').read_text().replace('float mPitch;','float mPitch;\n        float mRate = 1.0f;\n        bool mPhoneActive = false, mNextPlosive = false;\n        double mHoldRemaining = 0, mTickLength = 0, mTickRemaining = 0;\n        int mTicksRemaining = 0;')
(root/'soloud_vizsn.h').write_text(header)
emcc=os.environ.get('EMXX','em++')
args=[emcc,str(root/'vizsn.cpp'),str(root/'bridge.cpp'),'-I'+str(root),'-std=c++17','-O3','-fwrapv','-sMODULARIZE=1','-sEXPORT_ES6=1','-sEXPORT_NAME=createVizsn','-sENVIRONMENT=web,worker,node','-sFILESYSTEM=0','-sALLOW_MEMORY_GROWTH=1','-sINITIAL_MEMORY=16777216','-sMAXIMUM_MEMORY=4294967296','-sSTACK_SIZE=65536','-sEXPORTED_FUNCTIONS=["_vizsn_render_text","_vizsn_render_phones","_vizsn_data","_malloc","_free"]','-sEXPORTED_RUNTIME_METHODS=["HEAPF32","HEAPU8"]','-o',str(root/'vizsn.js')]
subprocess.run(args,check=True)
files={name:{'bytes':(root/name).stat().st_size,'sha256':hashlib.sha256((root/name).read_bytes()).hexdigest()} for name in ['vizsn.js','vizsn.wasm','upstream/soloud_vizsn.cpp','upstream/soloud_vizsn.h']}
(root/'build.json').write_text(json.dumps({'source':'https://github.com/jarikomppa/soloud','revision':revision,'emscripten':subprocess.check_output([emcc,'--version']).decode().splitlines()[0],'files':files},indent=2)+'\n')
