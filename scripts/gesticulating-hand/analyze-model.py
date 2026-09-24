#!/usr/bin/env python3
import pathlib,json,struct,math,re,bisect,collections,argparse
parser=argparse.ArgumentParser(description='Calibrate Elena FF hand joint axes from the source Open/Close clip.');parser.add_argument('--model-dir',required=True);args=parser.parse_args();P=pathlib.Path(args.model_dir);g=json.loads((P/'scene.gltf').read_text());binary=(P/'scene.bin').read_bytes()
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
def qmul(a,b):
 x,y,z,w=a;X,Y,Z,W=b;return [w*X+x*W+y*Z-z*Y,w*Y-x*Z+y*W+z*X,w*Z+x*Y-y*X+z*W,w*W-x*X-y*Y-z*Z]
def delta(a,b):
 q=norm(qmul([-a[0],-a[1],-a[2],a[3]],b))
 if q[3]<0:q=[-x for x in q]
 angle=2*math.acos(max(-1,min(1,q[3])));sn=math.sqrt(max(0,1-q[3]*q[3]));axis=[x/sn for x in q[:3]] if sn>1e-7 else [0,0,0]
 return {'quaternion':q,'axis':axis,'angleRadians':angle,'angleDegrees':math.degrees(angle)}
an=g['animations'][0];tracks={};times=[]
for c in an['channels']:
 s=an['samplers'][c['sampler']];t=[x[0] for x in acc(s['input'])];v=acc(s['output']);tracks[(c['target']['node'],c['target']['path'])]=(t,v,s.get('interpolation','LINEAR'));times.extend(t)
duration=max(times)
def sample(ni,path,time):
 default={'rotation':[0,0,0,1],'translation':[0,0,0],'scale':[1,1,1]}[path]
 if (ni,path) not in tracks:return g['nodes'][ni].get(path,default)
 ts,vs,inter=tracks[(ni,path)];i=bisect.bisect_right(ts,time)-1
 if i<0:return list(vs[0])
 if i>=len(ts)-1:return list(vs[-1])
 t=(time-ts[i])/(ts[i+1]-ts[i]);a=vs[i];b=vs[i+1]
 if inter=='STEP':return list(a)
 assert inter=='LINEAR',inter
 return slerp(a,b,t) if path=='rotation' else [x+t*(y-x) for x,y in zip(a,b)]
parents={c:i for i,n in enumerate(g['nodes']) for c in n.get('children',[])}
used=collections.Counter()
for m in g['meshes']:
 for prim in m['primitives']:
  for js,ws in zip(acc(prim['attributes']['JOINTS_0']),acc(prim['attributes']['WEIGHTS_0'])):
   for j,w in zip(js,ws):
    if w>1e-5:used[g['skins'][0]['joints'][j]]+=1
finger_nodes=[i for i in used if re.search(r'^(thumb|index|middle|ring|pinky)_0[123]\.R',g['nodes'][i]['name'])]
assert len(finger_nodes)==15, 'Expected all 15 deforming finger joints'
def bend(t):return sum(delta(sample(i,'rotation',0),sample(i,'rotation',t))['angleRadians'] for i in finger_nodes)
curve=[{'time':time,'bendSumRadians':bend(time)} for time in sorted(set(times+[duration*i/200 for i in range(201)]))];closed=max(curve,key=lambda x:x['bendSumRadians'])['time']
marks={'open':0,'closed':closed,'midpoint':duration/2,'end':duration}
report={'source':g['asset'],'handedness':'Right; all bone names .R, thumb visible on left when looking at dorsal hand. Confirmed realistic nails/skin in loaded GLB browser render.','mesh':'16,330 split vertices, 28,994 triangles; three 2048x2048 textures','clip':{'name':an['name'],'duration':duration,'sampleTimes':marks,'maxCurlExplanation':'closed sampled at max sum of angular distances from time 0 over the 15 weighted finger phalanx bones, over all source keyframe times plus 201 uniform samples.','interpolation':sorted(set(x[2] for x in tracks.values()))},'warning':'Three GLTFLoader sanitizes periods out of node names (index_01.R_017 becomes index_01R_017). Ctrl bones are present but Blender constraints do not export; manipulate weighted deform bones directly.','deformBones':[],'boneBendCurve':curve}
for i in sorted(used):
 n=g['nodes'][i];entry={'nodeIndex':i,'skinJointIndex':g['skins'][0]['joints'].index(i),'name':n['name'],'threeName':n['name'].replace('.',''),'parentIndex':parents.get(i),'parentName':g['nodes'][parents[i]].get('name') if i in parents else None,'weightedVertexCount':used[i],'defaultLocal':{k:n.get(k,{'translation':[0,0,0],'rotation':[0,0,0,1],'scale':[1,1,1]}[k]) for k in ['translation','rotation','scale']},'sampledLocal':{name:{k:sample(i,k,t) for k in ['translation','rotation','scale']} for name,t in marks.items()},'openToClosed':delta(sample(i,'rotation',0),sample(i,'rotation',closed))};report['deformBones'].append(entry)
(P/'rig-report.json').write_text(json.dumps(report,indent=2));print('duration',duration,'max curl timestamp',closed)
for b in report['deformBones']:
 d=b['openToClosed'];print(b['nodeIndex'],b['name'],'parent',b['parentName'],'deg',round(d['angleDegrees'],2),'axis',[round(x,4) for x in d['axis']])
