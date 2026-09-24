#!/usr/bin/env python3
"""Extract Elena FF's Open/Close clip without removing authored key times.
Original model/animation: CC-BY-SA-4.0; exporter helper: MIT.
"""
import pathlib,json,struct,math,bisect,base64,hashlib,argparse
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--model-dir',required=True);parser.add_argument('--out-dir',required=True);args=parser.parse_args();P=pathlib.Path(args.out_dir);P.mkdir(parents=True,exist_ok=True);M=pathlib.Path(args.model_dir);g=json.loads((M/'scene.gltf').read_text());binary=(M/'scene.bin').read_bytes();report=json.loads((M/'rig-report.json').read_text());bones=report['deformBones'];an=g['animations'][0]
width={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16};types={5120:'b',5121:'B',5122:'h',5123:'H',5125:'I',5126:'f'}
def acc(ix):
 a=g['accessors'][ix];v=g['bufferViews'][a['bufferView']];n=width[a['type']];fmt='<'+types[a['componentType']]*n;sz=struct.calcsize(fmt);stride=v.get('byteStride',sz);off=v.get('byteOffset',0)+a.get('byteOffset',0);return [struct.unpack_from(fmt,binary,off+i*stride) for i in range(a['count'])]
def norm(q):
 m=math.sqrt(sum(x*x for x in q));return [x/m for x in q]
def slerp(a,b,t):
 a=norm(a);b=norm(b);dot=sum(x*y for x,y in zip(a,b))
 if dot<0:b=[-x for x in b];dot=-dot
 if dot>.9995:return norm([x+t*(y-x) for x,y in zip(a,b)])
 theta=math.acos(max(-1,min(1,dot)));sn=math.sin(theta);x=math.sin((1-t)*theta)/sn;y=math.sin(t*theta)/sn;return [x*u+y*v for u,v in zip(a,b)]
ancestors=[{'nodeIndex':i,'threeName':n['name'].replace('.','')} for i,n in enumerate(g['nodes']) if n.get('name')=='hand.R.001_011'];packedBones=bones+ancestors
tracks={};weighted={b['nodeIndex'] for b in packedBones};alltimes=set()
for c in an['channels']:
 if c['target']['node'] not in weighted or c['target']['path']!='rotation':continue
 s=an['samplers'][c['sampler']];assert s.get('interpolation','LINEAR')=='LINEAR';ts=[v[0] for v in acc(s['input'])];vs=acc(s['output']);tracks[c['target']['node']]=(ts,vs);alltimes.update(ts)
times=sorted(alltimes);duration=times[-1]
def sample(node,time):
 if node not in tracks:return norm(g['nodes'][node].get('rotation',[0,0,0,1]))
 ts,vs=tracks[node];i=bisect.bisect_right(ts,time)-1
 if i<0:return norm(vs[0])
 if i>=len(ts)-1:return norm(vs[-1])
 return slerp(vs[i],vs[i+1],(time-ts[i])/(ts[i+1]-ts[i]))
values=times+[v for t in times for b in packedBones for v in sample(b['nodeIndex'],t)]
packed=struct.pack('<'+str(len(values))+'f',*values);encoded=base64.b64encode(packed).decode();names=[b['threeName'] for b in bones]
layout={'duration':duration,'keyCount':len(times),'boneNames':names,'ancestorNames':[b['threeName'] for b in ancestors],'fingerBones':[[names.index(next(b['threeName'] for b in bones if b['name'].startswith(f'{f}_0{i}.R'))) for i in [1,2,3]] for f in ['thumb','index','middle','ring','pinky']],'axes':[b['openToClosed']['axis'] for b in bones],'closedTime':report['clip']['sampleTimes']['closed']}
header='''/**
 * SPDX-License-Identifier: CC-BY-SA-4.0
 * Source animation data derived from "Rigged hand" by Elena FF.
 * https://sketchfab.com/3d-models/rigged-hand-eae97cc2a742413cb5338ab942b12c1e
 * Author: https://sketchfab.com/elenaferfor
 * License: https://creativecommons.org/licenses/by-sa/4.0/
 * Changes: retained every weighted-bone rotation key time in one shared timeline;
 * interpolated other tracks onto that union; encoded normalized Float32 quaternions
 * and calibrated bend axes. No animation time was removed or rescaled.
 * Modified animation data must remain CC BY-SA 4.0; the separate sampling helper
 * hand-source-motion.js is original code licensed under MIT.
 */
'''
(P/'hand-source-motion-data.js').write_text(header+'export const SOURCE_GRASP_LAYOUT = '+json.dumps(layout,separators=(',',':'))+';\nexport const SOURCE_GRASP_DATA =\n'+ '\n'.join(('  ' if i==0 else '  + ')+json.dumps(encoded[i:i+120]) for i in range(0,len(encoded),120))+';\n')
fixtureTimes=[0,duration/2,duration,layout['closedTime']]+[duration*i/61 for i in range(1,61)]
fixture={'duration':duration,'closedTime':layout['closedTime'],'names':names,'expectedClosedAngles':[[bones[i]['openToClosed']['angleDegrees'] for i in inds] for inds in layout['fingerBones']],'samples':[{'time':t,'rotations':[sample(b['nodeIndex'],t) for b in bones],'ancestorRotations':[sample(b['nodeIndex'],t) for b in ancestors]} for t in fixtureTimes]}
(P/'source-motion-reference.json').write_text(json.dumps(fixture,separators=(',',':')))
print(json.dumps({'keys':len(times),'bones':len(bones),'ancestors':len(ancestors),'keyRange':[times[0],times[-1]],'binaryBytes':len(packed),'dataModuleBytes':(P/'hand-source-motion-data.js').stat().st_size,'sourceBinSHA256':hashlib.sha256(binary).hexdigest()}))
