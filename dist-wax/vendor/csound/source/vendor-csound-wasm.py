#!/usr/bin/env python3
"""Reproduce the published Csound WASM binary without claiming a source rebuild.
Usage: python3 scripts/vendor-csound-wasm.py OUTPUT_DIR
Preserve the adjacent COPYING files and README when updating this runtime.
"""
from pathlib import Path
import base64,hashlib,io,json,sys,tarfile,urllib.request
PACKAGE_URL='https://registry.npmjs.org/@csound/wasm-bin/-/wasm-bin-6.18.7.tgz'
INTEGRITY='4VGtRgFjOhF8k7LhJrXgaX6fk/sMf42LX21SWmACasFJ7JJtzoOIM1cWbz38mlJO6lU5/YlpbFFWosDH/uihxA=='
SHA256='67311f471b48a96173b498a29d6b125cffe1c005410a49bcbd9b9987d27b7707'
REVISION='cbbdbcab7833e1b5e7f4cc267bb057b3b055ff40'
def main():
    if len(sys.argv)!=2:raise SystemExit(__doc__)
    out=Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=True)
    with urllib.request.urlopen(PACKAGE_URL,timeout=90)as response:archive=response.read()
    if hashlib.sha512(archive).digest()!=base64.b64decode(INTEGRITY):raise RuntimeError('Csound package integrity mismatch')
    with tarfile.open(fileobj=io.BytesIO(archive))as bundle:data=bundle.extractfile('package/lib/csound.dylib.wasm').read()
    if hashlib.sha256(data).hexdigest()!=SHA256:raise RuntimeError('Csound binary hash mismatch')
    (out/'csound.wasm').write_bytes(data)
    manifest={'package':'@csound/wasm-bin','version':'6.18.7','revision':REVISION,'integrity':'sha512-'+INTEGRITY,'tarball':PACKAGE_URL,'files':{'csound.wasm':{'bytes':len(data),'sha256':SHA256}},'runtimeVersion':6181}
    (out/'build.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(f'Verified csound.wasm: {len(data)} bytes, SHA-256 {SHA256}')
if __name__=='__main__':main()
