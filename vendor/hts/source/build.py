#!/usr/bin/env python3
from pathlib import Path
import subprocess,os,re,json,hashlib,tarfile,urllib.request
root=Path(__file__).resolve().parent
archives={'hts_engine_API-1.10.tar.gz':'e2132be5860d8fb4a460be766454cfd7c3e21cf67b509c48e1804feab14968f7','flite+hts_engine-1.07.tar.gz':'5a17c16683a8353077560e0e9b779c331ccc1a5f8da51740612043e65fc9e805','hts_voice_cmu_us_arctic_slt-1.06.tar.gz':'10d4e70d882335c22abe1004f929845d47894aa35f2df6fe28deac8a8a4af1b2'}
for name,sha in archives.items():
 p=root/name
 if not p.exists():p.write_bytes(urllib.request.urlopen('https://downloads.sourceforge.net/hts-engine/'+name.replace('+','%2B')).read())
 if hashlib.sha256(p.read_bytes()).hexdigest()!=sha:raise RuntimeError('Unexpected upstream archive '+name)
 if not (root/name.removesuffix('.tar.gz')).exists():
  with tarfile.open(p)as t:t.extractall(root,filter='data')
front=root/'flite+hts_engine-1.07';core=root/'hts_engine_API-1.10'
sources=[front/'lib/flite_hts_engine.c']
for p in re.findall(r'@top_srcdir@/([^\s\\]+\.c)',(front/'lib/Makefile.am').read_text()):sources.append(front/p)
# Portable FILE offset: old Unix branch assumes glibc's private fpos_t layout.
misc=(core/'lib/HTS_misc.c').read_text()
start=misc.index('      fpos_t pos;', misc.index('size_t HTS_ftell'))
end=misc.index('   } else if (fp->type == HTS_DATA)',start)
misc=misc[:start]+'      return (size_t) ftell((FILE *) fp->pointer);\n'+misc[end:]
(root/'HTS_misc-portable.c').write_text(misc)
sources += [p for p in (core/'lib').glob('*.c') if p.name!='HTS_misc.c']+[root/'HTS_misc-portable.c']
includes=[front/'include',front/'flite/include',front/'flite/lang/cmu_us_kal',front/'flite/lang/cmulex',front/'flite/lang/usenglish',core/'include',core/'lib']
emcc=os.environ.get('EMCC','emcc')
args=[emcc,*map(str,sources),str(root/'bridge.c'),*['-I'+str(p)for p in includes],'-DFLITE_PLUS_HTS_ENGINE','-DWORDS_LITTLEENDIAN','-DAUDIO_PLAY_NONE','-O3','-Wno-implicit-function-declaration','-sMODULARIZE=1','-sEXPORT_ES6=1','-sEXPORT_NAME=createHts','-sENVIRONMENT=web,worker,node','-sALLOW_MEMORY_GROWTH=1','-sINITIAL_MEMORY=33554432','-sMAXIMUM_MEMORY=268435456','-sSTACK_SIZE=1048576','-sEXPORTED_FUNCTIONS=["_hts_init","_hts_configure","_hts_sample_rate","_hts_render_text","_hts_data","_hts_event_count","_hts_event_phone","_hts_event_start","_hts_event_end","_hts_close","_malloc","_free"]','-sEXPORTED_RUNTIME_METHODS=["HEAPF32","HEAPU8","UTF8ToString"]','--preload-file',str(root/'hts_voice_cmu_us_arctic_slt-1.06/cmu_us_arctic_slt.htsvoice')+'@/slt.htsvoice','-o',str(root/'hts.js')]
subprocess.run(args,check=True)
files={name:{'bytes':(root/name).stat().st_size,'sha256':hashlib.sha256((root/name).read_bytes()).hexdigest()} for name in ['hts.js','hts.wasm','hts.data']}
(root/'build.json').write_text(json.dumps({'archives':archives,'source':'https://hts-engine.sourceforge.net/','emscripten':subprocess.check_output([emcc,'--version']).decode().splitlines()[0],'files':files},indent=2)+'\n')
