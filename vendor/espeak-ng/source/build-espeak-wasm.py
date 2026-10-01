#!/usr/bin/env python3
"""Build Morphazoid's English eSpeak NG WASM distribution from pinned source.

Usage: python3 scripts/build-espeak-wasm.py OUTPUT_DIR [BUILD_DIR]
Requires Python 3.12+, CMake, make, gcc/g++, network access and about 2 GB scratch.
No system installation; Emscripten and all sources live inside BUILD_DIR.
"""
from pathlib import Path
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import urllib.request

ESPEAK_REV = '9a550bef455f03b459f51796e3482833aab7fbc0'
EMSDK_REV = 'e566f7bdcc7735f44037911c24b87a58a3c93145'
SONIC_REV = 'fbf75c3d6d846bad3bb3d456cbc5d07d9fd8c104'
EMSCRIPTEN_VERSION = '4.0.22'


def source(build, repo, revision):
    directory = build / (repo.split('/')[-1] + '-' + revision)
    if not directory.exists():
        url = f'https://codeload.github.com/{repo}/tar.gz/{revision}'
        print(f'Downloading {repo}@{revision}', flush=True)
        with urllib.request.urlopen(url, timeout=120) as response:
            archive = response.read()
        with tarfile.open(fileobj=io.BytesIO(archive)) as bundle:
            bundle.extractall(build, filter='data')
    return directory


def run(*args, cwd, env=None):
    subprocess.run([str(arg) for arg in args], cwd=cwd, env=env, check=True)


def subset(source_dir, destination):
    # Keep English dictionaries, shared phoneme tables and all voice variants.
    text = (source_dir / 'espeak-ng.js').read_text()
    data = (source_dir / 'espeak-ng.data').read_bytes()
    match = re.search(r'loadPackage\((\{files:.*?remote_package_size:\d+\})\)', text)
    if not match:
        raise RuntimeError('Unexpected Emscripten preload metadata')
    manifest = json.loads(re.sub(r'(\w+):', r'"\1":', match[1]))
    output = bytearray()
    files = []
    for entry in manifest['files']:
        name = entry['filename']
        if name.split('/')[-1] in ['en_dict', 'phondata', 'phonindex', 'phontab', 'intonations'] or '/lang/gmw/en' in name or '/voices/!v/' in name:
            start = len(output)
            output.extend(data[entry['start']:entry['end']])
            files.append({'filename': name, 'start': start, 'end': len(output)})
    manifest = {'files': files, 'remote_package_size': len(output)}
    text = text[:match.start(1)] + json.dumps(manifest, separators=(',', ':')) + text[match.end(1):]
    destination.mkdir(parents=True, exist_ok=True)
    (destination / 'espeak-ng.js').write_text(text)
    (destination / 'espeak-ng.data').write_bytes(output)
    shutil.copyfile(source_dir / 'espeak-ng.wasm', destination / 'espeak-ng.wasm')


def main():
    if len(sys.argv) not in [2, 3]:
        raise SystemExit(__doc__)
    output = Path(sys.argv[1]).resolve()
    build = Path(sys.argv[2] if len(sys.argv) == 3 else '/tmp/morphazoid-espeak-wasm').resolve()
    build.mkdir(parents=True, exist_ok=True)
    engine = source(build, 'echogarden-project/espeak-ng', ESPEAK_REV)
    sdk = source(build, 'emscripten-core/emsdk', EMSDK_REV)
    sonic = source(build, 'waywardgeek/sonic', SONIC_REV)
    run(sdk / 'emsdk', 'install', EMSCRIPTEN_VERSION, cwd=sdk)
    run(sdk / 'emsdk', 'activate', EMSCRIPTEN_VERSION, cwd=sdk)
    result = subprocess.check_output(['/bin/bash', '-c', 'source "$1/emsdk_env.sh" >/dev/null 2>&1; env -0', '_', str(sdk)])
    env = dict(item.split('=', 1) for item in result.decode().split('\0') if '=' in item)
    shared = ['-D', 'CMAKE_BUILD_TYPE=Release', '-D', 'CMAKE_INSTALL_PREFIX=/usr',
              '-D', 'USE_ASYNC=OFF', '-D', 'USE_MBROLA=OFF', '-D', 'USE_LIBPCAUDIO=OFF',
              '-D', 'USE_LIBSONIC=OFF', '-D', 'ENABLE_TESTS=OFF',
              '-D', f'FETCHCONTENT_SOURCE_DIR_SONIC-GIT={sonic}']
    run('cmake', '-B', 'build-native', *shared, cwd=engine)
    run('cmake', '--build', 'build-native', '-j', '4', cwd=engine)
    run('cmake', '--build', 'build-native', '--target', 'data', cwd=engine)
    run('emcmake', 'cmake', '-B', 'build-emscripten', *shared,
        '-D', 'CMAKE_C_FLAGS_RELEASE=-O3 -DNDEBUG -flto=thin',
        '-D', 'CMAKE_CXX_FLAGS_RELEASE=-O3 -DNDEBUG -flto=thin',
        '-D', 'BUILD_SHARED_LIBS=OFF', '-D', 'USE_SPEECHPLAYER=ON',
        '-D', 'USE_KLATT=ON', '-D', 'COMPILE_INTONATIONS=OFF', cwd=engine, env=env)
    run('cmake', '--build', 'build-emscripten', '-j', '4', cwd=engine, env=env)
    wrapper = engine / 'emscripten'
    makefile = wrapper / 'Makefile'
    makefile.write_text(makefile.read_text().replace('-s SINGLE_FILE=1', '-s SINGLE_FILE=0').replace("['_malloc', '_free']", "['_malloc', '_free', '_espeak_SetParameter', '_espeak_GetParameter', '_espeak_SetPunctuationList']"))
    run('emmake', 'make', '-B', 'espeak-ng.js', cwd=wrapper, env=env)
    subset(wrapper, output)
    for name in ['COPYING', 'COPYING.APACHE', 'COPYING.BSD2', 'COPYING.UCD']:
        shutil.copyfile(engine / name, output / name)
    manifest = {'espeak_revision': ESPEAK_REV, 'emsdk_revision': EMSDK_REV,
                'sonic_revision': SONIC_REV, 'emscripten': EMSCRIPTEN_VERSION,
                'files': {name: {'bytes': (output / name).stat().st_size,
                                'sha256': hashlib.sha256((output / name).read_bytes()).hexdigest()}
                          for name in ['espeak-ng.js', 'espeak-ng.wasm', 'espeak-ng.data']}}
    (output / 'build.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps(manifest, indent=2))


if __name__ == '__main__':
    main()
