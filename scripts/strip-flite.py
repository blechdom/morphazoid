#!/usr/bin/env python3
"""Drop WebAssembly custom/debug sections; preserve all executable/data sections."""
import argparse
import hashlib
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('source', type=Path)
parser.add_argument('destination', type=Path)
args = parser.parse_args()
source = args.source.read_bytes()
if source[:8] != b'\0asm\x01\0\0\0':
    raise ValueError('Expected a version-one WebAssembly binary')
output = bytearray(source[:8])
offset = 8
while offset < len(source):
    start = offset
    section = source[offset]
    offset += 1
    size = 0
    shift = 0
    while True:
        byte = source[offset]
        offset += 1
        size |= (byte & 127) << shift
        shift += 7
        if byte < 128:
            break
        if shift > 35:
            raise ValueError('Invalid WebAssembly section size')
    offset += size
    if offset > len(source):
        raise ValueError('Truncated WebAssembly section')
    if section != 0:
        output.extend(source[start:offset])
args.destination.write_bytes(output)
print(f'{len(source)} -> {len(output)} bytes; sha256 {hashlib.sha256(output).hexdigest()}')
