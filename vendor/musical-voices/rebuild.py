#!/usr/bin/env python3
"""Rebuild genuine STK + the attributed Cook Singer translation as WebAssembly."""
import argparse,hashlib,io,json,os,pathlib,shutil,subprocess,tarfile,urllib.request
REV='f3ce5f4d04c83ec2d1661914a5dfc8437758fb4c'
URL='https://codeload.github.com/thestk/stk/tar.gz/'+REV
SHA='c1da6eb998347152605565dd5bbd8d7ad0a0fd2bb018aa248e0db6d895be10d0'
HERE=pathlib.Path(__file__).resolve().parent
p=argparse.ArgumentParser();p.add_argument('output',type=pathlib.Path);p.add_argument('--build',type=pathlib.Path,required=True);p.add_argument('--emsdk',type=pathlib.Path,required=True);args=p.parse_args()
build=args.build.resolve();output=args.output.resolve();build.mkdir(parents=True,exist_ok=True);output.mkdir(parents=True,exist_ok=True)
archive=build/'stk-source.tar.gz'
if not archive.exists():archive.write_bytes(urllib.request.urlopen(URL,timeout=60).read())
if hashlib.sha256(archive.read_bytes()).hexdigest()!=SHA:raise SystemExit('STK archive checksum mismatch')
stk=build/('stk-'+REV)
if not stk.exists():
 with tarfile.open(archive) as tar:tar.extractall(build,filter='data')
env_result=subprocess.check_output(['/bin/bash','-c','source "$1/emsdk_env.sh" >/dev/null 2>&1; env -0','_',str(args.emsdk.resolve())])
env=dict(pair.decode().split('=',1) for pair in env_result.split(b'\0') if b'=' in pair)
names=['Stk','VoicForm','SingWave','FileLoop','FileWvIn','FileRead','Modulate','Noise','Envelope','FormSwep','OnePole','OneZero','BiQuad','Phonemes','SineWave']
exports=['voice_create','voice_destroy','voice_phone','voice_control','voice_glot','voice_glot_parameters','voice_formant','voice_release','voice_render','malloc','free']
cmd=['em++','-O3','-std=c++17','-fexceptions','-I'+str(stk/'include'),str(HERE/'source/musical-voices.cpp')]+[str(stk/'src'/f'{name}.cpp') for name in names]
cmd+=['--embed-file',str(stk/'rawwaves/impuls20.raw')+'@/impuls20.raw','-sMODULARIZE=1','-sEXPORT_ES6=1','-sENVIRONMENT=web,worker,node','-sALLOW_MEMORY_GROWTH=1','-sINITIAL_MEMORY=16777216','-sDISABLE_EXCEPTION_CATCHING=0','-sEXPORTED_FUNCTIONS='+json.dumps(['_'+x for x in exports]),'-sEXPORTED_RUNTIME_METHODS=["HEAPF32"]','-o',str(output/'musical-voices.js')]
subprocess.run(cmd,env=env,check=True)
for name in ['voice-api.js','voice-data.js','native-data.js','musical-gestures.js','COPYING.STK','COPYING.SND','README.md']:
 if (output/name).resolve()!=(HERE/name).resolve():shutil.copyfile(HERE/name,output/name)
manifest={'stkRevision':REV,'stkArchiveSha256':SHA,'compiler':subprocess.check_output(['em++','--version'],env=env,text=True).splitlines()[0],'files':{path.name:{'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()} for path in sorted(output.iterdir()) if path.suffix in ['.js','.wasm']}}
(output/'build.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps(manifest,indent=2))
