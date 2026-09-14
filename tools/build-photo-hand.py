"""Simple 3D relief hand with the supplied photo cutout as a direct front UV.

Blender 5.2 background script. No anatomical reconstruction or synthesized skin.
Alpha is read solely to construct the mesh outline; the PNG is not edited.
"""
import bpy
import bmesh
import json
import math
import argparse
import sys
import numpy as np
from pathlib import Path
from mathutils import Vector
from mathutils.geometry import delaunay_2d_cdt

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / 'apps/client/public/assets/hand'
WORK = ROOT / 'artifacts/hand-photo'
WORK.mkdir(parents=True, exist_ok=True)
parser = argparse.ArgumentParser()
parser.add_argument('--pose', choices=['open','grip'], default='open')
args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
closed = args.pose == 'grip'
texture_name = 'right-hand-grip-cutout.png' if closed else 'right-hand-photo-cutout.png'
asset_name = 'fps-right-photo-grip.glb' if closed else 'fps-right-photo.glb'
artifact_name = 'photo-hand-grip' if closed else 'photo-hand'
origin = (.60,.24) if closed else (.65,.16)
size = (.13,.15) if closed else (.18,.24)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
photo = bpy.data.images.load(str(PUBLIC / texture_name))
w, h = photo.size
pixels = np.empty(w*h*4, dtype=np.float32)
photo.pixels.foreach_get(pixels)
pixels = pixels.reshape(h, w, 4)
assert pixels[:,:,3].min() == 0, 'Cutout needs actual transparency, not a checkerboard'

# Trace a watertight polygon around the alpha silhouette (not its bounding box).
step = 3
xs = np.minimum(np.arange(0, w, step)+step//2, w-1)
ys = np.minimum(np.arange(0, h, step)+step//2, h-1)
sampled = pixels[np.ix_(ys,xs)]
# The extraction has partially transparent highlights inside the hand. Do not
# threshold these away: alpha > 0.1 preserves all five fingertips. Reject only
# the red edge spill (zero green/blue), not natural skin or nail highlights.
mask = (sampled[:,:,3] > .10) & (sampled[:,:,1] > .025) & (sampled[:,:,2] > .01)
ny, nx = mask.shape
edges = {}
def add_edge(a,b):
    edges.setdefault(a,[]).append(b)
for y,x in np.argwhere(mask):
    # CCW around each occupied cell. Shared internal edges are omitted.
    if y == 0 or not mask[y-1,x]: add_edge((int(x),int(y)),(int(x+1),int(y)))
    if x == nx-1 or not mask[y,x+1]: add_edge((int(x+1),int(y)),(int(x+1),int(y+1)))
    if y == ny-1 or not mask[y+1,x]: add_edge((int(x+1),int(y+1)),(int(x),int(y+1)))
    if x == 0 or not mask[y,x-1]: add_edge((int(x),int(y+1)),(int(x),int(y)))
loops = []
while edges:
    first = next(iter(edges))
    path, current, direction = [], first, (1,0)
    while current in edges:
        path.append(current)
        candidates = edges[current]
        def turn(p):
            dx,dy = p[0]-current[0],p[1]-current[1]
            return math.atan2(direction[0]*dy-direction[1]*dx,direction[0]*dx+direction[1]*dy)
        nxt = max(candidates,key=turn)
        candidates.remove(nxt)
        if not candidates: del edges[current]
        direction = (nxt[0]-current[0],nxt[1]-current[1])
        current = nxt
        if current == first: break
    if current == first and len(path)>20: loops.append(path)
outline = max(loops, key=len)
print('Contour extent',np.min(outline,axis=0),np.max(outline,axis=0),flush=True)

def simplify(points, tolerance):
    if len(points) < 3: return points
    start, end = np.array(points[0],float), np.array(points[-1],float)
    segment = end-start
    length = np.linalg.norm(segment)
    if length < 1e-9: return points[:1]
    delta = np.array(points)-start
    distances = abs(delta[:,0]*segment[1]-delta[:,1]*segment[0])/length
    k = int(np.argmax(distances))
    if distances[k] > tolerance:
        return simplify(points[:k+1],tolerance)[:-1]+simplify(points[k:],tolerance)
    return [points[0], points[-1]]

half = len(outline)//2
outline = simplify(outline[:half+1],.50)[:-1]+simplify(outline[half:]+outline[:1],.50)[:-1]
uv = [(min(x*step/w,1),min(y*step/h,1)) for x,y in outline]
area = sum(uv[i][0]*uv[(i+1)%len(uv)][1]-uv[(i+1)%len(uv)][0]*uv[i][1] for i in range(len(uv)))
if area < 0: uv.reverse()
boundary_count = len(uv)
print('UV extent',np.min(uv,axis=0),np.max(uv,axis=0),flush=True)
for y in range(6,h,24):
    for x in range(6,w,24):
        if pixels[y,x,3] > .10 and pixels[y,x,1] > .025: uv.append((x/w,y/h))
vertices2d, _, triangles, *_ = delaunay_2d_cdt([Vector(p) for p in uv], [],
    [list(range(boundary_count))], 1, 1e-7, False)

# A few millimetres of dorsal curvature; about 18 mm thickness at the palm.
# Front UV remains the direct photo coordinates, without reshaping the image.
border = np.array(uv[:boundary_count]) * [w,h]
def edge_distance(u,v):
    p = np.array([u*w,v*h])
    a,b = border, np.roll(border,-1,axis=0)
    d = b-a
    t = np.clip(np.sum((p-a)*d,axis=1)/np.maximum(np.sum(d*d,axis=1),1e-6),0,1)
    return float(np.min(np.linalg.norm(p-a-t[:,None]*d,axis=1)))

verts = []
for u,v in vertices2d:
    bulge = 1-math.exp(-edge_distance(u,v)/32)
    verts.append(((u-origin[0])*size[0], (v-origin[1])*size[1], .002+(.009 if closed else .005)*bulge))
count = len(verts)
verts += [(x,y,-z-0.003) for x,y,z in verts]
faces = [tuple(f) for f in triangles]
front_count = len(faces)
faces += [tuple(i+count for i in reversed(f)) for f in triangles]
edge_use = {}
for f in triangles:
    for i,a in enumerate(f):
        b = f[(i+1)%len(f)]
        key = tuple(sorted((a,b)))
        if key in edge_use: edge_use[key] = None
        else: edge_use[key] = (a,b)
for edge in edge_use.values():
    if edge is not None:
        a,b = edge
        faces.append((b,a,a+count,b+count))
data = bpy.data.meshes.new('PhotoSilhouette_Volume')
data.from_pydata(verts,[],faces)
data.update()
hand = bpy.data.objects.new('RightHand_Skin',data)
bpy.context.collection.objects.link(hand)
layer = data.uv_layers.new(name='PhotoUV')
for loop in data.loops:
    layer.data[loop.index].uv = vertices2d[loop.vertex_index % count]

front = bpy.data.materials.new('Photo_Direct_Unlit')
front.use_nodes = True
front.node_tree.nodes.clear()
n,l = front.node_tree.nodes,front.node_tree.links
t = n.new('ShaderNodeTexImage')
t.image = photo
output = n.new('ShaderNodeOutputMaterial')
# Color -> Surface is Blender's unlit material pattern supported by glTF.
l.new(t.outputs['Color'],output.inputs['Surface'])

side = bpy.data.materials.new('Skin_Sides_Plain')
side.use_nodes = True
side.node_tree.nodes.clear()
sn,sl = side.node_tree.nodes,side.node_tree.links
pr = sn.new('ShaderNodeBsdfPrincipled')
pr.inputs['Base Color'].default_value = (.30,.135,.080,1)
pr.inputs['Roughness'].default_value = .85
out = sn.new('ShaderNodeOutputMaterial')
sl.new(pr.outputs[0],out.inputs['Surface'])
data.materials.append(front)
data.materials.append(side)
for p in data.polygons:
    p.material_index = 0 if p.index < front_count else 1
    p.use_smooth = True

# One modest bend is enough for the requested simple photo-covered volume.
# A real finger rig is intentionally not implied by this shape key.
hand.shape_key_add(name='PhotoGrip' if closed else 'PhotoOpen')
grip = hand.shape_key_add(name='Grip', from_mix=False)
grip.value = 0
for i,v in enumerate(grip.data):
    x,y,z = verts[i]
    a = 0 if closed else max(0,min(1,(y-.085)/.095))
    v.co = (x, y-.023*a*a, z-.045*a*a)
open_key = hand.shape_key_add(name='Open', from_mix=False)
open_key.value = 0
hand['construction'] = 'Photo cutout on a shallow 3D relief, not a full hand scan'

bm = bmesh.new()
bm.from_mesh(data)
nonmanifold = sum(not e.is_manifold for e in bm.edges)
bm.free()
assert nonmanifold == 0, f'Open edges in photo volume: {nonmanifold}'
report = {'vertices':len(verts),'triangles':sum(len(f)-2 for f in faces),
    'pose':args.pose,
    'nonmanifold_edges':nonmanifold,'outline_vertices':boundary_count,
    'texture_pixels':[w,h],'front_material':'direct photograph, unlit',
    'description':'Shallow 3D relief with plain skin-colored sides/back; not anatomical reconstruction'}

root = bpy.data.objects.new('FPS_PhotoHand',None)
bpy.context.collection.objects.link(root)
hand.parent = root
root.rotation_euler.x = math.pi/2
bpy.ops.object.select_all(action='DESELECT')
hand.select_set(True)
root.select_set(True)
bpy.context.view_layer.objects.active = hand
bpy.ops.export_scene.gltf(filepath=str(PUBLIC/asset_name), export_format='GLB',
    use_selection=True, export_animations=False, export_morph=True, export_yup=True)
root.rotation_euler.x = 0
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 16
scene.cycles.use_denoising = True
scene.render.resolution_x = 1200
scene.render.resolution_y = 1000
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.view_settings.view_transform = 'Standard'
scene.world.color = (.16,.16,.16)
world = scene.world
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (.045,.055,.07,1)
bpy.ops.object.light_add(type='AREA', location=(-.2,.15,.3))
bpy.context.object.data.energy = 3
bpy.context.object.data.shape = 'DISK'
bpy.context.object.data.size = .3
bpy.ops.object.camera_add(location=(-.03,-.055,.48))
camera = bpy.context.object
camera.rotation_euler = (Vector((-.01,.04,0) if closed else (-.025,.07,0))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.rotation_euler.rotate_axis('Z',-.55)
camera.data.type = 'ORTHO'
camera.data.ortho_scale = .18 if closed else .275
scene.camera = camera
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(WORK/(artifact_name+'.blend')))
scene.render.filepath = str(WORK/(artifact_name+'-preview.png'))
bpy.ops.render.render(write_still=True)
(WORK/('verification-grip.json' if closed else 'verification.json')).write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2),flush=True)
