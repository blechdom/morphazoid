#!/usr/bin/env python3
"""Build a cropped, twice subdivided CC0 MakeHuman right foot; no Blender required."""
import argparse, collections, hashlib, io, json, math, struct
from pathlib import Path
from PIL import Image
P=argparse.ArgumentParser();P.add_argument('--source-dir',type=Path,default=Path(__file__).parent/'source');P.add_argument('--out-dir',type=Path,default=Path(__file__).parent/'output');P.add_argument('--download',action='store_true',help='Download and verify pinned CC0 source assets into source-dir');args=P.parse_args();src=args.source_dir;out=args.out_dir;out.mkdir(parents=True,exist_ok=True)
# Pinned CC0 asset inputs. Pillow is the only third-party build dependency.
EXPECTED = {'base.obj': '8e761e6624b8f54536409135d1636da63b32486a90d4897f84e121d144f6fb4c', 'default.mhskel': '99f179bce0aa850b45d4191a1d0d234c5851f881c057439470ded3bddf729a24', 'default_weights.mhw': '0f3641d651ae3d00ad6b4ccee43142edb109d3bd909d27d9e4139ef1beed8625', 'aksel/Aksel_Skin_diffuse.png': '268ee6d1ea9665f8050d040c7b47971884428628021418ae52f68912859f5e60', 'aksel/Aksel_Skin_NRM.png': '2bf3632a4bfb1631d9ae15568c7de5c7254c780e5168f1546827f32d50f5212d', 'aksel/Aksel_Skin_SPEC.png': 'd34638826d48d6fdb632f3a18296999630edf2879e7301356dfa60e6d61808f7'}
MODEL_PATHS = {'base.obj': 'makehuman/data/3dobjs/base.obj', 'default.mhskel': 'makehuman/data/rigs/default.mhskel', 'default_weights.mhw': 'makehuman/data/rigs/default_weights.mhw'}
UPSTREAM_COMMIT = 'a8bc2d54ff0ac92e78ff71431b1023eda42bf482'
SKIN_URL = 'https://files2.makehumancommunity.org/asset_packs/skins02/skins02_cc0.zip'
SKIN_SHA256 = '1613f1ef3afca53094511d26620ed7cf1d2dedc29ed3d384d60bdebe250698ae'
if args.download:
 import urllib.request, zipfile
 src.mkdir(parents=True,exist_ok=True)
 for name,path in MODEL_PATHS.items():
  target=src/name
  if not target.exists():
   target.write_bytes(urllib.request.urlopen(f'https://raw.githubusercontent.com/makehumancommunity/makehuman/{UPSTREAM_COMMIT}/{path}',timeout=60).read())
 if any(not (src/name).exists() for name in EXPECTED if name.startswith('aksel/')):
  archive=src/'skins02_cc0.zip'
  if not archive.exists():
   with urllib.request.urlopen(SKIN_URL,timeout=60) as response,archive.open('wb') as output:
    while True:
     chunk=response.read(1024*1024)
     if not chunk:break
     output.write(chunk)
  assert hashlib.sha256(archive.read_bytes()).hexdigest()==SKIN_SHA256, 'Upstream skin pack changed; inspect before updating provenance'
  with zipfile.ZipFile(archive) as pack:
   (src/'aksel').mkdir(exist_ok=True)
   for name in EXPECTED:
    if name.startswith('aksel/'):(src/name).write_bytes(pack.read('skins/mindfront_aksel_skin/'+Path(name).name))
for name,expected in EXPECTED.items():
 assert hashlib.sha256((src/name).read_bytes()).hexdigest()==expected, f'Source checksum mismatch: {name}'
CUT=-7.15
rig=json.loads((src/'default.mhskel').read_text());source_weights=json.loads((src/'default_weights.mhw').read_text())['weights'];raw=[];uv=[];faces=[];group=''
for line in (src/'base.obj').read_text().splitlines():
 a=line.split()
 if not a:continue
 if a[0]=='v':raw.append(list(map(float,a[1:])))
 elif a[0]=='vt':uv.append(list(map(float,a[1:])))
 elif a[0]=='g':group=a[1]
 elif a[0]=='f' and group=='body':
  corners=[tuple(int(x)-1 for x in token.split('/')[:2]) for token in a[1:]]
  if all(raw[n][0]<-1.25 and raw[n][1]<CUT for n,t in corners):faces.append({'v':[n for n,t in corners],'uv':[uv[t] for n,t in corners],'mat':0})
source_ids=sorted({n for f in faces for n in f['v']});indices={n:i for i,n in enumerate(source_ids)}
weights=collections.defaultdict(dict);corrections=[]
for bone,entries in source_weights.items():
 for vid,value in entries:
  if vid not in indices or value<=0:continue
  target=bone
  if bone.endswith('.L'):
   target=bone[:-2]+'.R';corrections.append({'vertex':vid,'from':bone,'to':target,'weight':value,'reason':'Tiny contralateral source-weight typo on the right second toe'})
  weights[vid][target]=weights[vid].get(target,0)+value
attrs=[{'p':raw[n][:],'w':weights[n]} for n in source_ids]
for f in faces:f['v']=[indices[n] for n in f['v']]
edge_faces=collections.defaultdict(list)
for fi,f in enumerate(faces):
 for a,b in zip(f['v'],f['v'][1:]+f['v'][:1]):edge_faces[tuple(sorted((a,b)))].append((fi,a,b))
borders=[e[0] for e in edge_faces.values() if len(e)==1];next_cap={b:a for fi,a,b in borders};rim=[];n=next(iter(next_cap))
while n not in rim:rim.append(n);n=next_cap[n]
assert n==rim[0] and len(rim)==len(borders), 'Expected only the ankle boundary'
for n in rim:attrs[n]['p'][1]=CUT
faces.append({'v':rim,'uv':[[0,0] for _ in rim],'mat':1})
base_vertices=len(attrs);base_faces=len(faces)
def blend(items):
 p=[0.,0.,0.];w=collections.defaultdict(float)
 for value,c in items:
  for k in range(3):p[k]+=value['p'][k]*c
  for k,v in value['w'].items():w[k]+=v*c
 return {'p':p,'w':dict(w)}
def avg(items):return blend([(a,1/len(items)) for a in items])
def subdivide(attrs,faces):
 fp=[avg([attrs[n] for n in f['v']]) for f in faces];edges={};vf=[[] for _ in attrs];ve=[set() for _ in attrs]
 for fi,f in enumerate(faces):
  for a,b in zip(f['v'],f['v'][1:]+f['v'][:1]):
   key=tuple(sorted((a,b)));edges.setdefault(key,[]).append(fi);vf[a].append(fi);ve[a].add(key);ve[b].add(key)
 updated=[]
 for n,value in enumerate(attrs):
  adjacent=vf[n];degree=len(adjacent);edge_midpoints=[avg([attrs[a],attrs[b]]) for a,b in ve[n]]
  updated.append(blend([(avg([fp[fi] for fi in adjacent]),1/degree),(avg(edge_midpoints),2/degree),(value,(degree-3)/degree)]))
 ep={}
 for (a,b),fs in edges.items():
  assert len(fs)==2,'Closed foot expected after capping'
  ep[(a,b)]=len(updated);updated.append(avg([attrs[a],attrs[b],fp[fs[0]],fp[fs[1]]]))
 face_base=len(updated);updated.extend(fp);result=[]
 for fi,f in enumerate(faces):
  count=len(f['v']);center=[sum(u[k] for u in f['uv'])/count for k in range(2)]
  for i,n in enumerate(f['v']):
   nxt=f['v'][(i+1)%count];prev=f['v'][(i-1)%count];a=f['uv'][i];b=f['uv'][(i+1)%count];c=f['uv'][(i-1)%count]
   result.append({'v':[n,ep[tuple(sorted((n,nxt)))],face_base+fi,ep[tuple(sorted((prev,n)))]],
    'uv':[a,[(a[k]+b[k])/2 for k in range(2)],center,[(c[k]+a[k])/2 for k in range(2)]],'mat':f['mat']})
 return updated,result
for _ in range(2):attrs,faces=subdivide(attrs,faces)
# Smooth area-weighted geometric normals, shared across texture seams.
normals=[[0.,0.,0.] for _ in attrs]
for f in faces:
 pts=[attrs[n]['p'] for n in f['v']];normal=[0.,0.,0.]
 for p,q in zip(pts,pts[1:]+pts[:1]):
  normal[0]+=(p[1]-q[1])*(p[2]+q[2]);normal[1]+=(p[2]-q[2])*(p[0]+q[0]);normal[2]+=(p[0]-q[0])*(p[1]+q[1])
 for n in f['v']:
  for k in range(3):normals[n][k]+=normal[k]
for normal in normals:
 length=math.sqrt(sum(x*x for x in normal))
 for k in range(3):normal[k]/=length
# Preserve source pixel resolution; affine UV remapping extracts only the foot.
skin=Image.open(src/'aksel/Aksel_Skin_diffuse.png').convert('RGB');W,H=skin.size
all_uv=[u for f in faces if f['mat']==0 for u in f['uv']]
x0=max(0,math.floor(min(u[0] for u in all_uv)*W)-4);x1=min(W,math.ceil(max(u[0] for u in all_uv)*W)+4)
y0=max(0,math.floor((1-max(u[1] for u in all_uv))*H)-4);y1=min(H,math.ceil((1-min(u[1] for u in all_uv))*H)+4)
box=(x0,y0,x1,y1);image_data=[]
for name,filename in [('skin','Aksel_Skin_diffuse.png'),('normal','Aksel_Skin_NRM.png'),('specular','Aksel_Skin_SPEC.png')]:
 im=Image.open(src/'aksel'/filename).convert('RGB').crop(box)
 if name=='specular':
  # Map source specular intensity to nonmetal roughness, preserving nail contrast.
  rough=im.convert('L').point(lambda v:round(255*(.84-.46*v/255)))
  im=Image.merge('RGB',(Image.new('L',im.size,255),rough,Image.new('L',im.size,0)))
  name='roughness'
 buff=io.BytesIO();im.save(buff,format='PNG',optimize=True);image_data.append(buff.getvalue());(out/(name+'.png')).write_bytes(buff.getvalue())
# Translate-only rest transforms: all three-dimensional axes are global at rest.
bone_names=['lowerleg01.R','lowerleg02.R','foot.R']+[f'toe{i}-{j}.R' for i in range(1,6) for j in range(1,3 if i==1 else 4)]
node_name=lambda n:n.replace('.','_').replace('-','_')
def landmark(name):
 ids=rig['joints'][name];return [sum(raw[n][k] for n in ids)/len(ids) for k in range(3)]
heads={b:landmark(rig['bones'][b]['head']) for b in bone_names};tails={b:landmark(rig['bones'][b]['tail']) for b in bone_names};bone_id={b:i for i,b in enumerate(bone_names)}
weight_attrs=[];max_drop=0;pruned=0
for a in attrs:
 ranked=sorted(a['w'].items(),key=lambda it:it[1],reverse=True);total=sum(v for b,v in ranked);keep=ranked[:4];kept=sum(v for b,v in keep);drop=1-kept/total
 if drop>1e-8:pruned+=1
 max_drop=max(max_drop,drop);j=[bone_id[b] for b,v in keep];w=[v/kept for b,v in keep]
 while len(j)<4:j.append(0);w.append(0)
 weight_attrs.append((j,w))
positions=[];norms=[];uvs=[];js=[];ws=[];primitive_indices=[[],[]];splits={}
for f in faces:
 ids=[]
 for n,u in zip(f['v'],f['uv']):
  key=(n,round(u[0],12),round(u[1],12),f['mat'])
  if key not in splits:
   splits[key]=len(positions);positions.append(attrs[n]['p']);norms.append(normals[n]);js.append(weight_attrs[n][0]);ws.append(weight_attrs[n][1]);
   # glTF v=0 is the upper image edge; OBJ v=0 is the bottom.
   uvs.append([(u[0]*W-x0)/(x1-x0),((1-u[1])*H-y0)/(y1-y0)] if f['mat']==0 else [0,0])
  ids.append(splits[key])
 for i in range(1,len(ids)-1):primitive_indices[f['mat']].extend([ids[0],ids[i],ids[i+1]])
blob=bytearray();views=[];accessors=[]
def view(data,target=None):
 while len(blob)%4:blob.append(0)
 v={'buffer':0,'byteOffset':len(blob),'byteLength':len(data)}
 if target:v['target']=target
 idx=len(views);views.append(v);blob.extend(data);return idx
def accessor(data,component,kind,format_,target=None,bounds=False):
 flat=[x for row in data for x in row] if isinstance(data[0],(list,tuple)) else data
 idx=len(accessors);a={'bufferView':view(struct.pack('<'+format_*len(flat),*flat),target),'componentType':component,'count':len(data),'type':kind}
 if bounds:a['min']=[min(row[k] for row in data) for k in range(len(data[0]))];a['max']=[max(row[k] for row in data) for k in range(len(data[0]))]
 accessors.append(a);return idx
position_acc=accessor(positions,5126,'VEC3','f',34962,True);normal_acc=accessor(norms,5126,'VEC3','f',34962);uv_acc=accessor(uvs,5126,'VEC2','f',34962);joint_acc=accessor(js,5123,'VEC4','H',34962);weight_acc=accessor(ws,5126,'VEC4','f',34962)
primitives=[]
for mat,idx in enumerate(primitive_indices):
 primitives.append({'attributes':{'POSITION':position_acc,'NORMAL':normal_acc,'TEXCOORD_0':uv_acc,'JOINTS_0':joint_acc,'WEIGHTS_0':weight_acc},'indices':accessor(idx,5125,'SCALAR','I',34963),'material':mat,'mode':4})
inverse=[]
for b in bone_names:
 x,y,z=heads[b];inverse.append([1,0,0,0,0,1,0,0,0,0,1,0,-x,-y,-z,1])
inverse_acc=accessor(inverse,5126,'MAT4','f')
images=[{'bufferView':view(data),'mimeType':'image/png','name':name} for data,name in zip(image_data,['CC0 Aksel foot skin','CC0 Aksel foot normal','Derived nonmetal roughness'])]
nodes=[{'name':'MakeHuman_RightFoot_Mesh','mesh':0,'skin':0}]
report_bones={}
for b in bone_names:
 parent=rig['bones'][b]['parent'];parent=parent if parent in bone_id else None
 pos=[heads[b][i]-(heads[parent][i] if parent else 0) for i in range(3)]
 d=[tails[b][k]-heads[b][k] for k in range(3)];bend=[d[2],0,-d[0]];length=math.sqrt(sum(x*x for x in bend));bend=[x/length for x in bend]
 nodes.append({'name':node_name(b),'translation':pos,'rotation':[0,0,0,1],'children':[bone_id[c]+1 for c in bone_names if rig['bones'][c]['parent']==b]})
 report_bones[node_name(b)]={'sourceBone':b,'parent':node_name(parent) if parent else None,'head':heads[b],'tail':tails[b],'restTranslation':pos,'restQuaternion':[0,0,0,1],'bendAxis':bend,'spreadAxis':[0,1,0]}
metadata={'version':1,'asset':'MakeHuman articulated right foot','license':'CC0-1.0','meshLicense':'CC0-1.0','textureLicense':'CC0-1.0','makehumanCommit':'a8bc2d54ff0ac92e78ff71431b1023eda42bf482',
 'meshSource':'https://github.com/makehumancommunity/makehuman/tree/a8bc2d54ff0ac92e78ff71431b1023eda42bf482/makehuman/data',
 'skinSource':'https://static.makehumancommunity.org/assets/assetpacks/skins02.html','skinAuthor':'Mindfront (Aksel skin), distributed in the official MakeHuman CC0 skins02 pack',
 'skinPack':'https://files2.makehumancommunity.org/asset_packs/skins02/skins02_cc0.zip','subdivision':'Two offline Catmull-Clark steps; face-varying bilinear UVs; interpolated source skin weights',
 'sourceUnits':'MakeHuman decimeters; Y up, +Z toward toe tips, right foot is -X in source body. Rest joint rotations identity, so listed axes are parent-local global-at-rest axes.',
 'crop':{'sourceCutoffY':CUT,'rightSideMaxX':-1.25,'cap':'One ankle-rim n-gon before subdivision; rim flattened at cutoff; cap has separate plain skin material','sourceVertices':base_vertices,'sourceFacesIncludingCap':base_faces},
 'mesh':{'vertices':len(positions),'geometricVertices':len(attrs),'triangles':sum(map(len,primitive_indices))//3,'bounds':{'min':accessors[position_acc]['min'],'max':accessors[position_acc]['max']}},
 'skin':{'joints':len(bone_names),'toeJoints':14,'stationaryCalfAnchors':['lowerleg01_R','lowerleg02_R'],'toeWeightTypoCorrections':corrections,'maxDroppedInfluenceWeight':max_drop,'verticesReducedToFourWeights':pruned,'textureCropPixels':list(box),'sourceTextureSize':[W,H]},
 'ankle':{'bone':'foot_R','head':heads['foot.R'],'tail':tails['foot.R'],'bendAxis':[1,0,0],'sideAxis':[0,0,1],'twistAxis':[0,1,0]},'bones':report_bones,'digits':[],
 'sha256':{str(f.relative_to(src)):hashlib.sha256(f.read_bytes()).hexdigest() for f in [src/'base.obj',src/'default.mhskel',src/'default_weights.mhw',src/'aksel/Aksel_Skin_diffuse.png',src/'aksel/Aksel_Skin_NRM.png',src/'aksel/Aksel_Skin_SPEC.png']}}
for i,label in enumerate(['Big toe','Second toe','Middle toe','Fourth toe','Little toe'],1):
 source=[f'toe{i}-{j}.R' for j in range(1,3 if i==1 else 4)];keys=['mcp','dip'] if i==1 else ['mcp','pip','dip'];mapping={key:node_name(b) for key,b in zip(keys,source)}
 metadata['digits'].append({'id':['big','second','middle','fourth','little'][i-1],'label':label,'bones':{'mcp':mapping['mcp'],'pip':mapping.get('pip'),'dip':mapping['dip']},'tip':tails[source[-1]],'joints':{key:report_bones[node_name(b)] for key,b in zip(keys,source)}})
gltf={'asset':{'version':'2.0','generator':'Reproducible MakeHuman CC0 foot crop and subdivision','copyright':'CC0 MakeHuman Team; CC0 Mindfront Aksel skin'},'scene':0,'scenes':[{'nodes':[0,1]}],
 'nodes':nodes,'meshes':[{'name':'Subdivided articulated right foot','primitives':primitives}],
 'skins':[{'name':'MakeHuman right foot toe rig','joints':list(range(1,len(bone_names)+1)),'skeleton':1,'inverseBindMatrices':inverse_acc}],
 'materials':[{'name':'CC0 Aksel skin and nails','pbrMetallicRoughness':{'baseColorTexture':{'index':0},'metallicRoughnessTexture':{'index':2},'metallicFactor':0,'roughnessFactor':1},'normalTexture':{'index':1,'scale':.38},'doubleSided':False},
 {'name':'Closed ankle cap','pbrMetallicRoughness':{'baseColorFactor':[.54,.33,.24,1],'metallicFactor':0,'roughnessFactor':.78}}],
 'images':images,'textures':[{'source':i,'sampler':0} for i in range(3)],'samplers':[{'magFilter':9729,'minFilter':9987,'wrapS':33071,'wrapT':33071}],
 'buffers':[{'byteLength':len(blob)}],'bufferViews':views,'accessors':accessors,'extras':{'license':'CC0-1.0','rigReport':'rig-report.json'}}
jsn=json.dumps(gltf,separators=(',',':')).encode();jsn+=b' '*((-len(jsn))%4);blob+=b'\0'*((-len(blob))%4);glb=struct.pack('<III',0x46546c67,2,12+8+len(jsn)+8+len(blob))+struct.pack('<II',len(jsn),0x4e4f534a)+jsn+struct.pack('<II',len(blob),0x004e4942)+blob
(out/'foot.glb').write_bytes(glb);metadata['glbSha256']=hashlib.sha256(glb).hexdigest();(out/'rig-report.json').write_text(json.dumps(metadata,indent=2)+'\n')
print(json.dumps({'glbBytes':len(glb),'mesh':metadata['mesh'],'skin':metadata['skin'],'sha256':metadata['glbSha256']},indent=2))

(out/'source-metadata.json').write_text('{\n  "version": 1,\n  "name": "Articulated right foot for Gesticules",\n  "license": "CC0-1.0",\n  "meshAuthor": "MakeHuman Team: Data Collection AB, Joel Palmius, Jonas Hauquier",\n  "textureAuthor": "Mindfront \\u2014 Aksel skin",\n  "upstreamCommit": "a8bc2d54ff0ac92e78ff71431b1023eda42bf482",\n  "assetLicenseUrl": "https://raw.githubusercontent.com/makehumancommunity/makehuman/a8bc2d54ff0ac92e78ff71431b1023eda42bf482/LICENSE.ASSETS.md",\n  "assetLicenseSha256": "f6089cba01cb570a24712b41ab8a586ccd3cc5ef53dc266ca50b95c288956d2c",\n  "assetLicenseExplanation": "Official MakeHuman LICENSE.md sections C and D explicitly place bundled graphical assets and output under CC0; no application source code is included.",\n  "files": [\n    {\n      "path": "base.obj",\n      "url": "https://raw.githubusercontent.com/makehumancommunity/makehuman/a8bc2d54ff0ac92e78ff71431b1023eda42bf482/makehuman/data/3dobjs/base.obj",\n      "sha256": "8e761e6624b8f54536409135d1636da63b32486a90d4897f84e121d144f6fb4c"\n    },\n    {\n      "path": "default.mhskel",\n      "url": "https://raw.githubusercontent.com/makehumancommunity/makehuman/a8bc2d54ff0ac92e78ff71431b1023eda42bf482/makehuman/data/rigs/default.mhskel",\n      "sha256": "99f179bce0aa850b45d4191a1d0d234c5851f881c057439470ded3bddf729a24"\n    },\n    {\n      "path": "default_weights.mhw",\n      "url": "https://raw.githubusercontent.com/makehumancommunity/makehuman/a8bc2d54ff0ac92e78ff71431b1023eda42bf482/makehuman/data/rigs/default_weights.mhw",\n      "sha256": "0f3641d651ae3d00ad6b4ccee43142edb109d3bd909d27d9e4139ef1beed8625"\n    }\n  ],\n  "skinPack": {\n    "url": "https://files2.makehumancommunity.org/asset_packs/skins02/skins02_cc0.zip",\n    "sha256": "1613f1ef3afca53094511d26620ed7cf1d2dedc29ed3d384d60bdebe250698ae",\n    "license": "CC0-1.0",\n    "licenseEvidence": "https://static.makehumancommunity.org/assets/assetpacks/skins02.html",\n    "assetName": "mindfront_aksel_skin",\n    "members": [\n      {\n        "path": "skins/mindfront_aksel_skin/Aksel_Skin_diffuse.png",\n        "sha256": "268ee6d1ea9665f8050d040c7b47971884428628021418ae52f68912859f5e60"\n      },\n      {\n        "path": "skins/mindfront_aksel_skin/Aksel_Skin_NRM.png",\n        "sha256": "2bf3632a4bfb1631d9ae15568c7de5c7254c780e5168f1546827f32d50f5212d"\n      },\n      {\n        "path": "skins/mindfront_aksel_skin/Aksel_Skin_SPEC.png",\n        "sha256": "d34638826d48d6fdb632f3a18296999630edf2879e7301356dfa60e6d61808f7"\n      }\n    ],\n    "manifestEntry": {\n      "author": "Mindfront",\n      "category": "",\n      "changed": "2018-11-04",\n      "created": "2017-06-11",\n      "description": "This skin is made by a friend from an original MakeHuman skin and then I did the normal and specular map from one I have done erlier. The specular map and normal map have body hair but the skin texture have non but it gives the skin suitable ruffness and you can maybe use the specular map to extract the hair and add on the skin. In MakeHuman viewport the normal map looks bad. Edit 2018-11-04 Removed obsolete links",\n      "license": "CC0",\n      "original_author": "",\n      "original_source": "",\n      "source": "http://www.makehumancommunity.org/node/850",\n      "thumbnail": "mindfront_aksel_skin.png",\n      "type": "skin"\n    }\n  },\n  "outputSha256": "26b982805339623a0fa7e7c64e15839278e8771dc0ed9a30eccb56663e794272"\n}\n')

(out/'SOURCE.LICENSE.txt').write_text('ARTICULATED RIGHT FOOT — SOURCE ASSETS\n\nMakeHuman mesh, default rig and weights: CC0-1.0, MakeHuman Team.\nAksel skin diffuse/normal/specular: CC0-1.0, Mindfront; official MakeHuman skins02 CC0 asset pack.\nSee source-metadata.json for pinned URLs, checksums and license evidence.\nThe crop, ankle cap, subdivision, UV remap and converted roughness remain CC0.\n\n# Creative Commons CC0 1.0 Universal\n\nCREATIVE COMMONS CORPORATION IS NOT A LAW FIRM AND DOES NOT PROVIDE LEGAL SERVICES. DISTRIBUTION OF THIS DOCUMENT DOES NOT CREATE AN ATTORNEY-CLIENT RELATIONSHIP. CREATIVE COMMONS PROVIDES THIS INFORMATION ON AN "AS-IS" BASIS. CREATIVE COMMONS MAKES NO WARRANTIES REGARDING THE USE OF THIS DOCUMENT OR THE INFORMATION OR WORKS PROVIDED HEREUNDER, AND DISCLAIMS LIABILITY FOR DAMAGES RESULTING FROM THE USE OF THIS DOCUMENT OR THE INFORMATION OR WORKS PROVIDED HEREUNDER.\n\n### Statement of Purpose\n\nThe laws of most jurisdictions throughout the world automatically confer exclusive Copyright and Related Rights (defined below) upon the creator and subsequent owner(s) (each and all, an "owner") of an original work of authorship and/or a database (each, a "Work").\n\nCertain owners wish to permanently relinquish those rights to a Work for the purpose of contributing to a commons of creative, cultural and scientific works ("Commons") that the public can reliably and without fear of later claims of infringement build upon, modify, incorporate in other works, reuse and redistribute as freely as possible in any form whatsoever and for any purposes, including without limitation commercial purposes. These owners may contribute to the Commons to promote the ideal of a free culture and the further production of creative, cultural and scientific works, or to gain reputation or greater distribution for their Work in part through the use and efforts of others.\n\nFor these and/or other purposes and motivations, and without any expectation of additional consideration or compensation, the person associating CC0 with a Work (the "Affirmer"), to the extent that he or she is an owner of Copyright and Related Rights in the Work, voluntarily elects to apply CC0 to the Work and publicly distribute the Work under its terms, with knowledge of his or her Copyright and Related Rights in the Work and the meaning and intended legal effect of CC0 on those rights.\n\n1. __Copyright and Related Rights.__ A Work made available under CC0 may be protected by copyright and related or neighboring rights ("Copyright and Related Rights"). Copyright and Related Rights include, but are not limited to, the following:\n\n    i. the right to reproduce, adapt, distribute, perform, display, communicate, and translate a Work;\n\n    ii. moral rights retained by the original author(s) and/or performer(s);\n\n    iii. publicity and privacy rights pertaining to a person\'s image or likeness depicted in a Work;\n\n    iv. rights protecting against unfair competition in regards to a Work, subject to the limitations in paragraph 4(a), below;\n\n    v. rights protecting the extraction, dissemination, use and reuse of data in a Work;\n\n    vi. database rights (such as those arising under Directive 96/9/EC of the European Parliament and of the Council of 11 March 1996 on the legal protection of databases, and under any national implementation thereof, including any amended or successor version of such directive); and\n\n    vii. other similar, equivalent or corresponding rights throughout the world based on applicable law or treaty, and any national implementations thereof.\n\n2. __Waiver.__ To the greatest extent permitted by, but not in contravention of, applicable law, Affirmer hereby overtly, fully, permanently, irrevocably and unconditionally waives, abandons, and surrenders all of Affirmer\'s Copyright and Related Rights and associated claims and causes of action, whether now known or unknown (including existing as well as future claims and causes of action), in the Work (i) in all territories worldwide, (ii) for the maximum duration provided by applicable law or treaty (including future time extensions), (iii) in any current or future medium and for any number of copies, and (iv) for any purpose whatsoever, including without limitation commercial, advertising or promotional purposes (the "Waiver"). Affirmer makes the Waiver for the benefit of each member of the public at large and to the detriment of Affirmer\'s heirs and successors, fully intending that such Waiver shall not be subject to revocation, rescission, cancellation, termination, or any other legal or equitable action to disrupt the quiet enjoyment of the Work by the public as contemplated by Affirmer\'s express Statement of Purpose.\n\n3. __Public License Fallback.__ Should any part of the Waiver for any reason be judged legally invalid or ineffective under applicable law, then the Waiver shall be preserved to the maximum extent permitted taking into account Affirmer\'s express Statement of Purpose. In addition, to the extent the Waiver is so judged Affirmer hereby grants to each affected person a royalty-free, non transferable, non sublicensable, non exclusive, irrevocable and unconditional license to exercise Affirmer\'s Copyright and Related Rights in the Work (i) in all territories worldwide, (ii) for the maximum duration provided by applicable law or treaty (including future time extensions), (iii) in any current or future medium and for any number of copies, and (iv) for any purpose whatsoever, including without limitation commercial, advertising or promotional purposes (the "License"). The License shall be deemed effective as of the date CC0 was applied by Affirmer to the Work. Should any part of the License for any reason be judged legally invalid or ineffective under applicable law, such partial invalidity or ineffectiveness shall not invalidate the remainder of the License, and in such case Affirmer hereby affirms that he or she will not (i) exercise any of his or her remaining Copyright and Related Rights in the Work or (ii) assert any associated claims and causes of action with respect to the Work, in either case contrary to Affirmer\'s express Statement of Purpose.\n\n4. __Limitations and Disclaimers.__\n\n    a. No trademark or patent rights held by Affirmer are waived, abandoned, surrendered, licensed or otherwise affected by this document.\n\n    b. Affirmer offers the Work as-is and makes no representations or warranties of any kind concerning the Work, express, implied, statutory or otherwise, including without limitation warranties of title, merchantability, fitness for a particular purpose, non infringement, or the absence of latent or other defects, accuracy, or the present or absence of errors, whether or not discoverable, all to the greatest extent permissible under applicable law.\n\n    c. Affirmer disclaims responsibility for clearing rights of other persons that may apply to the Work or any use thereof, including without limitation any person\'s Copyright and Related Rights in the Work. Further, Affirmer disclaims responsibility for obtaining any necessary consents, permissions or other rights required for any use of the Work.\n\n    d. Affirmer understands and acknowledges that Creative Commons is not a party to this document and has no duty or obligation with respect to this CC0 or use of the Work.\n')

(out/'README.md').write_text("# CC0 articulated right foot\n\nThis asset crops the official MakeHuman base mesh at the right ankle and retains the default skeleton's real five toe chains. The big toe has two joints (`mcp`, `dip`); the other toes each have three (`mcp`, `pip`, `dip`). `foot_R` is the ankle hinge. Two stationary calf anchors preserve the original ankle blend weights, making 17 skin joints in total: 14 toe joints, one foot and two calf anchors.\n\n- `foot.glb`: 1,678,952 bytes; 34,352 triangles; 17,830 exported vertices (17,178 before UV/material splits); three embedded texture maps.\n- `rig-report.json`: every bone's source name, parent, rest transform, bend/spread axes, heads/tails, toe endpoints, mesh bounds and conversion evidence.\n- `source-metadata.json`: pinned upstream model commit, URLs, SHA-256 checksums and the original asset-pack record confirming the skin's CC0 license.\n- `SOURCE.LICENSE.txt`: attribution and MakeHuman's full CC0 asset license text.\n- `build-foot.py`: portable reproducible conversion, requiring Python 3 and Pillow. No Blender, runtime subdivision or external model service is required.\n- `deformation-check.json` and four PNG previews: browser verification artifacts, separate from the runtime asset.\n\n## Sources and licensing\n\nMesh, rig and skin weights come directly from [MakeHuman at a8bc2d54ff0ac92e78ff71431b1023eda42bf482](https://github.com/makehumancommunity/makehuman/tree/a8bc2d54ff0ac92e78ff71431b1023eda42bf482/makehuman/data). MakeHuman's [license sections C and D](https://github.com/makehumancommunity/makehuman/blob/a8bc2d54ff0ac92e78ff71431b1023eda42bf482/LICENSE.md) explicitly release bundled graphical assets and output under CC0. No application code is included in the GLB.\n\nThe Aksel skin diffuse, normal and specular maps are by **Mindfront**, distributed in the [official MakeHuman skins02 CC0 pack](https://static.makehumancommunity.org/assets/assetpacks/skins02.html). The pack's own `mindfront_aksel_skin` record explicitly states `license: CC0`; that record is retained in source metadata. The diffuse texture derives from an original MakeHuman skin; the normal/specular maps were supplied by Mindfront. Attribution is retained for provenance even though CC0 does not require it.\n\n## Rebuild\n\nRun beside this script, choosing any source-cache and output directories:\n\n```sh\npython3 build-foot.py --download --source-dir ./foot-source-cache --out-dir ./rebuilt-foot\n```\n\nThe first run obtains three pinned MakeHuman source files and the official 76,112,708-byte skin pack, validates SHA-256 hashes, then extracts only the three relevant textures. Reusing the cached sources requires no network:\n\n```sh\npython3 build-foot.py --source-dir ./foot-source-cache --out-dir ./rebuilt-foot\n```\n\nA rebuild from the inspected source cache produced byte-identical GLB output:\n`26b982805339623a0fa7e7c64e15839278e8771dc0ed9a30eccb56663e794272`.\n\n## Conversion and rig convention\n\nThe source right-foot body faces whose vertices are below Y = -7.15 and on X < -1.25 yield 1,080 base vertices and 1,068 quads. The single ankle boundary is flattened to the crop plane and closed with an n-gon. Two offline Catmull–Clark steps interpolate both geometry and source skin weights; face-varying bilinear UVs preserve texture seams. Smooth area-weighted normals are shared across UV seams. The closed ankle has a separate plain skin material.\n\nCoordinates retain MakeHuman decimeters: Y up and +Z toward the toe tips. All exported bone rest rotations are identity. Joint heads define their translations; the report's rest-local bend axes account for each toe's slight lateral direction, and spread uses local +Y. The big toe's absent middle joint is explicitly `null`; do not invent or double-drive it. The ankle maps flex to +X, side to +Z, and twist to +Y. Bone names have already been sanitized for Three (`toe2_3_R`, etc.).\n\nOriginal source weights sum to approximately one because the upstream file rounds to three decimal places. They are interpolated and normalized for export. One 0.002 weight on source vertex 6535 incorrectly points to the left second toe; it is mirrored to the right counterpart. The source has 37 crop vertices with more than four influences. For Three's standard four-weight skinning shader, the largest four interpolated influences are kept and renormalized. 3,644 subdivided geometric vertices require some pruning; the largest discarded mass is 0.103679. This is recorded explicitly rather than claiming untouched source weights.\n\nThe original 2048×2048 skin maps are cropped without resampling to `[44,1697,396,2033]` (352×336 pixels). UVs are remapped affinely to this exact crop, including the OBJ-to-glTF vertical convention. The original normal pixels are preserved and used at strength 0.38. Specular intensity is converted to nonmetal roughness (`0.84 - 0.46 * intensity`) to retain nail/skin contrast.\n\n## Verification and limits\n\nChromium loaded the GLB with the repository's Three GLTFLoader with no page errors. Both skinned primitives share the expected 17-joint rig. All 14 toe joints individually displaced a strongly weighted vertex at 30 degrees, with finite results. Open toes, simultaneously curled toes and ankle flexion were rendered and inspected. The GLB rebuild was byte-identical.\n\nThe foot has distinct toes, recognizable toe joints, nail patches and skin/crease detail at normal instrument size. Its original foot texture region is only 352×336 pixels: close zooms are softer than the separately scanned hand's full-resolution texture. The mesh is an artist-authored human base, not a clinical biomechanical model or a tendon/contact simulation. Extreme toe combinations can intersect or pinch the interpolated skin. The ankle is deliberately capped where the limb is cropped. The retained calf anchors should normally stay at rest while `foot_R` controls ankle movement.\n")

(out/'skins02-license-evidence.md').write_text('---\ntitle: "skins02"\ndraft: false\n---\n\nNatural male skins, shared under CC0: [mirror1]({{% param "primaryFilesUrl" %}}/asset_packs/skins02/skins02_cc0.zip), [mirror2]({{% param "secondaryFilesUrl" %}}/asset_packs/skins02/skins02_cc0.zip) (72 mb)\n\n\n## Included assets\n\n| Asset type | Thumbnail | Asset name | Author | Source | License |\n| ---------- | --------- | ---------- | ------ | ------ | ------- |\n| skin | ![jartur69_middleage_slavic_male_with_genitals_and_beard.png](jartur69_middleage_slavic_male_with_genitals_and_beard.png) | jartur69_middleage_slavic_male_with_genitals_and_beard | jartur69 | [asset repo](http://www.makehumancommunity.org/node/1508) | CC0 |\n| skin | ![jartur69_old_slavic_male_with_genitals_and_beard.png](jartur69_old_slavic_male_with_genitals_and_beard.png) | jartur69_old_slavic_male_with_genitals_and_beard | jartur69 | [asset repo](http://www.makehumancommunity.org/node/1507) | CC0 |\n| skin | ![ken1138_caucasian_male_tattooed_skin.png](ken1138_caucasian_male_tattooed_skin.png) | ken1138_caucasian_male_tattooed_skin | ken1138 | [asset repo](http://www.makehumancommunity.org/node/1601) | CC0 |\n| skin | ![mindfront_aksel_skin.png](mindfront_aksel_skin.png) | mindfront_aksel_skin | Mindfront | [asset repo](http://www.makehumancommunity.org/node/850) | CC0 |\n| skin | ![mindfront_skin_male_african_middleage.png](mindfront_skin_male_african_middleage.png) | mindfront_skin_male_african_middleage | Mindfront | [asset repo](http://www.makehumancommunity.org/node/526) | CC0 |\n| skin | ![onlytheghosts_old_eurasian_male.png](onlytheghosts_old_eurasian_male.png) | onlytheghosts_old_eurasian_male | OnlyTheGhosts | [asset repo](http://www.makehumancommunity.org/node/1581) | CC0 |\n| skin | ![rehmanpolanski_skin_viking_tattoos.png](rehmanpolanski_skin_viking_tattoos.png) | rehmanpolanski_skin_viking_tattoos | RehmanPolanski | [asset repo](http://www.makehumancommunity.org/node/2623) | CC0 |\n| skin | ![toigo_light_skin_male_bronze.png](toigo_light_skin_male_bronze.png) | toigo_light_skin_male_bronze | MargaretToigo | [asset repo](http://www.makehumancommunity.org/node/1136) | CC0 |\n| skin | ![toigo_light_skin_male_freckles.png](toigo_light_skin_male_freckles.png) | toigo_light_skin_male_freckles | MargaretToigo | [asset repo](http://www.makehumancommunity.org/node/1137) | CC0 |\n| skin | ![toigo_light_skin_male_ginger.png](toigo_light_skin_male_ginger.png) | toigo_light_skin_male_ginger | MargaretToigo | [asset repo](http://www.makehumancommunity.org/node/1135) | CC0 |\n| skin | ![toigo_light_skin_male_with_emo_eyes.png](toigo_light_skin_male_with_emo_eyes.png) | toigo_light_skin_male_with_emo_eyes | MargaretToigo | [asset repo](http://www.makehumancommunity.org/node/1139) | CC0 |\n| skin | ![toigo_light_skin_male_with_eyeliner.png](toigo_light_skin_male_with_eyeliner.png) | toigo_light_skin_male_with_eyeliner | MargaretToigo | [asset repo](http://www.makehumancommunity.org/node/1138) | CC0 |\n| skin | ![toigo_light_skin_male_with_goth_makeup.png](toigo_light_skin_male_with_goth_makeup.png) | toigo_light_skin_male_with_goth_makeup | MargaretToigo | [asset repo](http://www.makehumancommunity.org/node/1140) | CC0 |\n')
