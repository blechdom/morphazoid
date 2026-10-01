#!/usr/bin/env python3
"""Retrieve pinned, byte-verified Pico WASM and English resources.
Usage: python3 vendor-pico-wasm.py OUTPUT_DIR
This reproduces the published runtime bytes; it does not recompile the engine.
"""
from pathlib import Path
import hashlib,io,json,sys,tarfile,urllib.request
REV='21089d223e177ba3cb7e385db8613a093dff74b5'
PACKAGE_REV='4b1d64dc4c69cec088141d8653c526f09b76ea62'
ARCHIVE='https://registry.npmjs.org/@echogarden/svoxpico-wasm/-/svoxpico-wasm-0.2.0.tgz'
ARCHIVE_SHA256='c1874834673159ac068282d36bab7e3a21e399043388d4e56763b54f1d6885b1'
HASHES={
 'svoxpico.js':'2e2d565f390d1ef351553558813ef82d5da28ced69454ce8cf030e60f04447e5',
 'svoxpico.wasm':'276a4e171734647f5d5edcc2a635df9b367867dc00848a8dc58120dd7004b0c6',
 'LICENSE':'a8ad31b1c3f40dca5a84119351b8fa8ddc868edd77fad8a8ebf6d8f2d16fa4ae',
 'en-US_ta.bin':'3a2a4d23de2a44dbbff50f69dcb9486be53b6d0a871d77cdc35f45c3e25e82aa',
 'en-US_lh0_sg.bin':'d6946526696d9eb085f7b23b1fbdf7a9986caca658b645e9eb73c6514fd4789d',
 'en-GB_ta.bin':'57998f6423236dea25cd572a73b13f371e64155840e31b571eba7fca0b521b7e',
 'en-GB_kh0_sg.bin':'8f9f5d13a920a9f3371517178d42ce89b835f1e587760c2db280beb593c388fa',
 'DATA_NOTICE':'b5830d96fb5a7e7e7ebcc295f352846b4b998e78fdc8f9aa68e134d2e4b39986',
}
def get(url):
 with urllib.request.urlopen(url,timeout=60)as response:return response.read()
def check(data,digest):
 if hashlib.sha256(data).hexdigest()!=digest:raise RuntimeError('Upstream content hash changed')
 return data
def main():
 if len(sys.argv)!=2:raise SystemExit(__doc__)
 out=Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=True)
 archive=check(get(ARCHIVE),ARCHIVE_SHA256)
 with tarfile.open(fileobj=io.BytesIO(archive))as bundle:
  for name in ['svoxpico.js','svoxpico.wasm','LICENSE']:(out/name).write_bytes(check(bundle.extractfile('package/'+name).read(),HASHES[name]))
 for name in ['en-US_ta.bin','en-US_lh0_sg.bin','en-GB_ta.bin','en-GB_kh0_sg.bin']:
  (out/name).write_bytes(check(get(f'https://raw.githubusercontent.com/naggety/picotts/{REV}/pico/lang/{name}'),HASHES[name]))
 (out/'DATA_NOTICE').write_bytes(check(get(f'https://raw.githubusercontent.com/naggety/picotts/{REV}/pico_resources/NOTICE'),HASHES['DATA_NOTICE']))
 manifest={'package':'@echogarden/svoxpico-wasm@0.2.0','package_source_revision':PACKAGE_REV,'package_archive_sha256':ARCHIVE_SHA256,'resource_revision':REV,'files':{name:{'bytes':(out/name).stat().st_size,'sha256':digest}for name,digest in HASHES.items()}}
 (out/'build.json').write_text(json.dumps(manifest,indent=2)+'\n')
 print(json.dumps(manifest,indent=2))
if __name__=='__main__':main()
