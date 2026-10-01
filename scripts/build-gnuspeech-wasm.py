#!/usr/bin/env python3
"""Build the pinned GPL-3+ GnuspeechSA WASM engine and English resources.
Usage: build-gnuspeech-wasm.py OUTPUT_DIR [BUILD_DIR] [EMSDK_DIR]
Requires Python 3.12+, network for first source/SDK download, and native build tools.
Keep gnuspeech-wasm-adapter.cpp beside this script. No system installation occurs.
"""
from pathlib import Path
import hashlib,io,json,os,shutil,subprocess,sys,tarfile,urllib.request
REV='f62e8b88eeeb3fa7e51ac138d561c3061a4a415f'
SOURCE_SHA256='2f5b2f247867d48cb21398b610cd3dd57c3262bb6fabcbcc5af1b4b17b6d1f3f'
EMSDK_REV='e566f7bdcc7735f44037911c24b87a58a3c93145'
EMSCRIPTEN='4.0.22'
def source(build,repo,revision,expected=None):
    directory=build/(repo.split('/')[-1]+'-'+revision)
    if not directory.exists():
        with urllib.request.urlopen(f'https://codeload.github.com/{repo}/tar.gz/{revision}',timeout=120) as response:data=response.read()
        if expected and hashlib.sha256(data).hexdigest()!=expected:raise RuntimeError('Source archive hash mismatch')
        with tarfile.open(fileobj=io.BytesIO(data)) as bundle:bundle.extractall(build,filter='data')
    return directory
def main():
    if len(sys.argv) not in [2,3,4]:raise SystemExit(__doc__)
    out=Path(sys.argv[1]).resolve();out.mkdir(parents=True,exist_ok=True)
    build=Path(sys.argv[2] if len(sys.argv)>2 else '/tmp/morphazoid-gnuspeech-wasm').resolve();build.mkdir(parents=True,exist_ok=True)
    engine=source(build,'mym-br/gnuspeech_sa',REV,SOURCE_SHA256)
    sdk=Path(sys.argv[3]).resolve() if len(sys.argv)>3 else source(build,'emscripten-core/emsdk',EMSDK_REV)
    if len(sys.argv)<=3:
        subprocess.run([str(sdk/'emsdk'),'install',EMSCRIPTEN],cwd=sdk,check=True)
        subprocess.run([str(sdk/'emsdk'),'activate',EMSCRIPTEN],cwd=sdk,check=True)
    if (sdk/'upstream/emscripten/emscripten-version.txt').read_text().strip().strip('"')!=EMSCRIPTEN:raise RuntimeError('Expected Emscripten '+EMSCRIPTEN)
    raw=subprocess.check_output(['/bin/bash','-c','source "$1/emsdk_env.sh" >/dev/null 2>&1; env -0','_',str(sdk)])
    env=dict(value.split('=',1) for value in raw.decode().split('\0') if '=' in value)
    adapter=Path(__file__).resolve().with_name('gnuspeech-wasm-adapter.cpp')
    args=['em++','-std=c++17','-O3','-flto','-fexceptions','-ffile-prefix-map='+str(engine)+'=/gnuspeech','-ffile-prefix-map='+str(adapter.parent)+'=/morphazoid-gnuspeech']
    args += [str(p) for p in sorted((engine/'src').rglob('*.cpp')) if p.name not in ['main.cpp','gnuspeech_trm.cpp']]
    args += [str(adapter)]
    for include in ['src','src/rapidxml','src/trm','src/trm_control_model','src/xml']:args+=['-I'+str(engine/include)]
    args += ['-sMODULARIZE=1','-sEXPORT_ES6=1','-sENVIRONMENT=web,worker,node','-sFORCE_FILESYSTEM=1','-sALLOW_MEMORY_GROWTH=1','-sSTACK_SIZE=2097152','-sINITIAL_MEMORY=33554432','-sMAXIMUM_MEMORY=268435456','-sDISABLE_EXCEPTION_CATCHING=0','-sEXPORTED_FUNCTIONS=["_gs_synthesize","_gs_error","_malloc","_free"]','-sEXPORTED_RUNTIME_METHODS=["ccall","cwrap","FS","UTF8ToString"]','--preload-file',str(engine/'data/en')+'@/voice/en','-o',str(out/'gnuspeech.js')]
    subprocess.run(args,cwd=engine,env=env,check=True)
    glue=out/'gnuspeech.js'
    glue.write_text(glue.read_text().replace(str(out/'gnuspeech.data'),'gnuspeech.data'))
    for src,dst in [('COPYING.txt','COPYING.txt'),('data/en/README.txt','DATA_LICENSE.txt'),('src/rapidxml/license.txt','RAPIDXML_LICENSE.txt')]:shutil.copyfile(engine/src,out/dst)
    manifest={'source':'https://github.com/mym-br/gnuspeech_sa','revision':REV,'source_archive_sha256':SOURCE_SHA256,'emscripten':EMSCRIPTEN,'emsdk_revision':EMSDK_REV,'files':{n:{'bytes':(out/n).stat().st_size,'sha256':hashlib.sha256((out/n).read_bytes()).hexdigest()} for n in ['gnuspeech.js','gnuspeech.wasm','gnuspeech.data']}}
    (out/'build.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps(manifest,indent=2))
if __name__=='__main__':main()
