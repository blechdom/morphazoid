#!/usr/bin/env python3
"""Losslessly repack Elena FF's CC-BY-SA-4.0 Rigged hand as a GLB.
Original: https://sketchfab.com/3d-models/rigged-hand-eae97cc2a742413cb5338ab942b12c1e
Public attributed distribution: https://github.com/cadenroberts/TheraHand/tree/main/public/rigged_hand
Retains source asset.extras metadata and exact license.txt; no mesh/animation changes.
"""
import argparse, json, pathlib, struct, urllib.request
BASE = 'https://raw.githubusercontent.com/cadenroberts/TheraHand/36c051b036032740720164120c884ce16a65f162/public/rigged_hand/'
def build(out_dir, download=False):
    out_dir = pathlib.Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    def fetch(name):
        dest = out_dir / name
        if download or not dest.exists():
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(urllib.request.urlopen(BASE + name, timeout=30).read())
        return dest
    source = fetch('scene.gltf')
    fetch('license.txt')
    gltf = json.loads(source.read_text())
    assert len(gltf['buffers']) == 1
    binary = bytearray(fetch(gltf['buffers'][0]['uri']).read_bytes())
    while len(binary) % 4: binary.append(0)
    for img in gltf['images']:
        image = fetch(img.pop('uri'))
        data = image.read_bytes()
        img['bufferView'] = len(gltf['bufferViews'])
        img['mimeType'] = 'image/jpeg' if image.suffix.lower() in ('.jpg', '.jpeg') else 'image/png'
        gltf['bufferViews'].append({'buffer': 0, 'byteOffset': len(binary), 'byteLength': len(data)})
        binary.extend(data)
        while len(binary) % 4: binary.append(0)
    gltf['buffers'] = [{'byteLength': len(binary)}]
    encoded = json.dumps(gltf, separators=(',', ':')).encode()
    encoded += b' ' * ((-len(encoded)) % 4)
    glb = struct.pack('<III', 0x46546c67, 2, 28 + len(encoded) + len(binary))
    glb += struct.pack('<II', len(encoded), 0x4e4f534a) + encoded
    glb += struct.pack('<II', len(binary), 0x004e4942) + binary
    dest = out_dir / 'elena-rigged-hand.glb'
    dest.write_bytes(glb)
    print(f'{dest}: {len(glb):,} bytes')
    return dest
if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out-dir', default=str(pathlib.Path(__file__).parent / 'elena-hand'))
    parser.add_argument('--download', action='store_true', help='Refresh original files from pinned source commit')
    args = parser.parse_args()
    build(args.out_dir, download=args.download)
