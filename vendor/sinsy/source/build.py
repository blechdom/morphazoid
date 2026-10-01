#!/usr/bin/env python3
"""Pinned, reproducible Sinsy Japanese score-singing WASM port. Requires emcc/em++."""
from pathlib import Path
import concurrent.futures, hashlib, json, os, re, shutil, subprocess, tarfile, urllib.request

root = Path(__file__).resolve().parent
archives = {
    'sinsy-0.92.tar.gz': ('sinsy', '0496d06fbb96e30b22a2ddb29714a68938c53d0bfb70f8622a93a6e233dcfada'),
    'hts_voice_nitech_jp_song070_f001-0.90.tar.gz': ('sinsy', '461c94d2eadd4f81d31ae860527382002cb7bfc5a28b9648bfa96ca89b33b227'),
    'hts_engine_API-1.10.tar.gz': ('hts-engine', 'e2132be5860d8fb4a460be766454cfd7c3e21cf67b509c48e1804feab14968f7'),
}
for name, (project, sha) in archives.items():
    archive = root / name
    if not archive.exists():
        archive.write_bytes(urllib.request.urlopen(f'https://downloads.sourceforge.net/{project}/{name}').read())
    if hashlib.sha256(archive.read_bytes()).hexdigest() != sha:
        raise RuntimeError('Unexpected upstream archive: ' + name)
    if not (root / name.removesuffix('.tar.gz')).exists():
        with tarfile.open(archive) as source: source.extractall(root, filter='data')

original = root / 'sinsy-0.92'
front = root / 'sinsy-port-source'
if front.exists(): shutil.rmtree(front)
shutil.copytree(original, front)
core = root / 'hts_engine_API-1.10'

# Add forwarding access to original HtsEngine::setTone/setSpeed and existing
# HTS APIs. No changes to Japanese frontend, score labels, trained model or DSP.
header = front / 'include/sinsy.h'
code = header.read_text()
code = code.replace('   //! set volume for synthesis\n',
    '   bool setTone(double tone);\n   bool setSpeed(double speed);\n'
    '   bool setVocoder(double beta, double voicing, double gv);\n\n   //! set volume for synthesis\n')
header.write_text(code)
engine_header = front / 'lib/hts_engine_API/HtsEngine.h'
code = engine_header.read_text().replace('   //! set volume\n',
    '   bool setVocoder(double beta, double voicing, double gv) {\n'
    '      HTS_Engine_set_beta(&engine, beta);\n'
    '      HTS_Engine_set_msd_threshold(&engine, 1, voicing);\n'
    '      HTS_Engine_set_gv_weight(&engine, 0, gv);\n'
    '      return true;\n   }\n\n   //! set volume\n')
engine_header.write_text(code)
engine_source = front / 'lib/hts_engine_API/HtsEngine.cpp'
code = engine_source.read_text()
code = code.replace('if(HTS_Engine_synthesize_from_strings(&engine, (char**) label.getData(), label.size()) != TRUE) {',
    'bool generated = HTS_Engine_generate_state_sequence_from_strings(&engine, (char**) label.getData(), label.size());\n'
    '   if (generated) {\n'
    '      double frames = 0;\n'
    '      for (size_t i = 0; i < HTS_Engine_get_total_state(&engine); ++i) frames += HTS_Engine_get_state_duration(&engine, i);\n'
    '      double samples = frames * HTS_Engine_get_fperiod(&engine);\n'
    '      if (frames > 50000 || samples > 48000 * 60) generated = false;\n'
    '      if (generated) generated = HTS_Engine_generate_parameter_sequence(&engine);\n'
    '      if (generated) generated = HTS_Engine_generate_sample_sequence(&engine);\n'
    '   }\n'
    '   if (!generated) {')
engine_source.write_text(code)
implementation = front / 'lib/Sinsy.cpp'
code = implementation.read_text().replace('   //! set volume for synthesis\n',
    '   bool setTone(double x) { return engine.setTone(x); }\n'
    '   bool setSpeed(double x) { return engine.setSpeed(x); }\n'
    '   bool setVocoder(double beta, double voicing, double gv) { return engine.setVocoder(beta, voicing, gv); }\n\n'
    '   //! set volume for synthesis\n')
code = code.replace('bool Sinsy::setVolume(double volume)',
    'bool Sinsy::setTone(double x) { return impl->setTone(x); }\n'
    'bool Sinsy::setSpeed(double x) { return impl->setSpeed(x); }\n'
    'bool Sinsy::setVocoder(double beta, double voicing, double gv) { return impl->setVocoder(beta, voicing, gv); }\n\n'
    'bool Sinsy::setVolume(double volume)')
implementation.write_text(code)

# Modern libc++ requires make_pair to deduce its reference types; these three
# C++03-style explicit instantiations otherwise reject the original lvalues.
for name, before in [
    ('Configurations.cpp', 'std::make_pair<std::string, std::string>'),
    ('MacronTable.cpp', 'std::make_pair<std::vector<std::string>, Result*>'),
    ('PhonemeTable.cpp', 'std::make_pair<std::string, PhonemeList*>'),
]:
    path = front / 'lib/util' / name
    path.write_text(path.read_text().replace(before, 'std::make_pair'))

# Old source assumes the glibc-private fpos_t layout; standard ftell also works
# with Emscripten's in-memory files and preserves byte offsets.
misc = (core / 'lib/HTS_misc.c').read_text()
start = misc.index('      fpos_t pos;', misc.index('size_t HTS_ftell'))
end = misc.index('   } else if (fp->type == HTS_DATA)', start)
(root / 'HTS_misc-portable.c').write_text(misc[:start] + '      return (size_t) ftell((FILE *) fp->pointer);\n' + misc[end:])

emcc, empp = os.environ.get('EMCC', 'emcc'), os.environ.get('EMXX', 'em++')
include_dirs = [front / 'include', core / 'include', core / 'lib'] + [p for p in (front / 'lib').iterdir() if p.is_dir()]
common = ['-O3', '-fexceptions', '-DAUDIO_PLAY_NONE', '-DWORDS_LITTLEENDIAN', *['-I'+str(p) for p in include_dirs]]
sources = sorted((front / 'lib').rglob('*.cpp')) + [root / 'bridge.cpp']
sources += [p for p in (core / 'lib').glob('*.c') if p.name != 'HTS_misc.c'] + [root / 'HTS_misc-portable.c']
objects = root / 'obj'; objects.mkdir(exist_ok=True)
def compile_source(pair):
    index, source = pair; obj = objects / f'{index:03d}-{source.stem}.o'
    compiler = empp if source.suffix == '.cpp' else emcc
    flags = ['-std=c++11'] if source.suffix == '.cpp' else []
    subprocess.run([compiler, *common, *flags, '-c', str(source), '-o', str(obj)], check=True)
    return str(obj)
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    compiled = list(pool.map(compile_source, enumerate(sources)))
exports = ['sinsy_init', 'sinsy_render_xml', 'sinsy_data', 'sinsy_error', 'sinsy_sample_rate', 'sinsy_close', 'malloc', 'free']
subprocess.run([empp, *compiled, '-O3', '-fexceptions', '-sMODULARIZE=1', '-sEXPORT_ES6=1',
    '-sEXPORT_NAME=createSinsy', '-sENVIRONMENT=web,worker,node', '-sALLOW_MEMORY_GROWTH=1',
    '-sINITIAL_MEMORY=33554432', '-sMAXIMUM_MEMORY=268435456', '-sSTACK_SIZE=1048576',
    '-sEXPORTED_FUNCTIONS='+json.dumps(['_'+e for e in exports]),
    '-sEXPORTED_RUNTIME_METHODS=["HEAPF32","HEAPU8","UTF8ToString"]',
    '--preload-file', str(front / 'dic')+'@/dic',
    '--preload-file', str(root / 'hts_voice_nitech_jp_song070_f001-0.90/nitech_jp_song070_f001.htsvoice')+'@/song.htsvoice',
    '-o', str(root / 'sinsy.js')], check=True)
shutil.copyfile(original / 'COPYING', root / 'COPYING-SINSY')
shutil.copyfile(core / 'COPYING', root / 'COPYING-HTS-ENGINE')
shutil.copyfile(root / 'hts_voice_nitech_jp_song070_f001-0.90/COPYING', root / 'COPYING-MODEL')
files = {name: {'bytes': (root/name).stat().st_size, 'sha256': hashlib.sha256((root/name).read_bytes()).hexdigest()} for name in ['sinsy.js', 'sinsy.wasm', 'sinsy.data']}
(root / 'build.json').write_text(json.dumps({'archives': {k:v[1] for k,v in archives.items()}, 'source':'https://sinsy.sourceforge.net/', 'emscripten':subprocess.check_output([emcc,'--version']).decode().splitlines()[0], 'files': files}, indent=2)+'\n')
