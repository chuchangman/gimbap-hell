"""Blender 5.2: anatomically connected, UV-mapped right hand for the FPS camera.

Run with blender --background --python tools/build-realistic-hand.py.
The CC0 source assets remain in assets-src/hand-realistic/source.
"""
import bpy
import bmesh
import json
import math
import sys
import numpy as np
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / 'assets-src/hand-realistic'
SOURCE = WORK / 'source'
PUBLIC = ROOT / 'apps/client/public/assets/hand'
WORK.mkdir(parents=True, exist_ok=True)
PUBLIC.mkdir(parents=True, exist_ok=True)


def parse_obj(path):
    vertices, uvs, faces = [], [], []
    group = None
    for line in path.read_text().splitlines():
        s = line.split()
        if not s:
            continue
        if s[0] == 'v':
            vertices.append(Vector(tuple(map(float, s[1:4]))))
        elif s[0] == 'vt':
            uvs.append(tuple(map(float, s[1:3])))
        elif s[0] == 'g':
            group = s[1]
        elif s[0] == 'f' and group == 'body':
            faces.append([(int(p.split('/')[0])-1, int(p.split('/')[1])-1) for p in s[1:]])
    return vertices, uvs, faces


def aim(obj, point):
    obj.rotation_euler = (Vector(point) - obj.location).to_track_quat('-Z', 'Y').to_euler()


def simple_material(name, color, roughness=0.5):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.node_tree.nodes.clear()
    p = m.node_tree.nodes.new('ShaderNodeBsdfPrincipled')
    out = m.node_tree.nodes.new('ShaderNodeOutputMaterial')
    m.node_tree.links.new(p.outputs['BSDF'], out.inputs['Surface'])
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = roughness
    return m


bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
verts, uv, faces = parse_obj(SOURCE / 'base.obj')
rigdef = json.loads((SOURCE / 'default.mhskel').read_text())
weights = json.loads((SOURCE / 'default_weights.mhw').read_text())['weights']

targets = {
    'mindfront_hand_fingers_correction': 0.75,
    'mindfront_hand_thenar_eminence': 0.42,
    'mindfront_hand_hypothenar': 0.32,
    'jujube_knobby_knuckles': 0.20,
}
for name, amount in targets.items():
    for line in (SOURCE / 'hand-targets/targets/hands' / (name + '.target')).read_text().splitlines():
        s = line.split()
        if len(s) == 4 and not s[0].startswith('#'):
            verts[int(s[0])] += Vector(tuple(map(float, s[1:]))) * amount


def joint(name):
    indices = rigdef['joints'][name]
    return sum((verts[i] for i in indices), Vector()) / len(indices)


wrist = joint('wrist.R____head')
middle = joint('finger3-1.R____head')
index = joint('finger2-1.R____head')
pinky = joint('finger5-1.R____head')
axis_y = (middle - wrist).normalized()
axis_x = pinky - index
axis_x = (axis_x - axis_y * axis_x.dot(axis_y)).normalized()
axis_z = axis_x.cross(axis_y).normalized()
scale = 0.087 / (middle - wrist).length


def local(v):
    d = v - wrist
    return Vector((d.dot(axis_x) * 1.13, d.dot(axis_y), d.dot(axis_z) * 1.10)) * scale


names = [name for name in rigdef['bones'] if name.endswith('.R') and
         name.startswith(('finger', 'metacarpal', 'wrist', 'lowerarm'))]
relevant = set()
for name in names:
    relevant.update(i for i, w in weights.get(name, []) if w > 0.01)
valid = {i for i in relevant if local(verts[i]).y > -0.205}
faces = [f for f in faces if all(i in valid for i, _ in f)]
used = sorted({i for f in faces for i, _ in f})
lookup = {old: new for new, old in enumerate(used)}
mesh = bpy.data.meshes.new('RightHand_ContinuousQuadTopology')
mesh.from_pydata([local(verts[i]) for i in used], [], [[lookup[i] for i, _ in f] for f in faces])
mesh.update()
hand = bpy.data.objects.new('RightHand_Skin', mesh)
bpy.context.collection.objects.link(hand)
layer = mesh.uv_layers.new(name='SourceUV')
for face, original in zip(mesh.polygons, faces):
    for li, (_, ti) in zip(face.loop_indices, original):
        layer.data[li].uv = uv[ti]
for p in mesh.polygons:
    p.use_smooth = True

# Actual skeleton and inherited smooth weights; no detached finger segments.
armature = bpy.data.armatures.new('RightHand_Skeleton')
rig = bpy.data.objects.new('RightHand_Rig', armature)
bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
for name in names:
    data = rigdef['bones'][name]
    b = armature.edit_bones.new(name)
    b.head = local(joint(data['head']))
    b.tail = local(joint(data['tail']))
    b.align_roll(Vector((0, 0, 1)))
for name in names:
    parent = rigdef['bones'][name]['parent']
    if parent in armature.edit_bones:
        armature.edit_bones[name].parent = armature.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT')
totals = {}
for name in names:
    for i, w in weights.get(name, []):
        if i in lookup:
            totals[i] = totals.get(i, 0) + w
for name in names:
    group = hand.vertex_groups.new(name=name)
    for i, w in weights.get(name, []):
        if i in lookup and w > 0:
            group.add([lookup[i]], w / totals[i], 'REPLACE')
hand.parent = rig
deform = hand.modifiers.new('Anatomical finger deformation', 'ARMATURE')
deform.object = rig
deform.use_deform_preserve_volume = True
sub = hand.modifiers.new('Continuous smooth skin', 'SUBSURF')
sub.levels = 2
sub.render_levels = 2

skin = simple_material('Skin_NeutralWarmTan', (0.43, 0.235, 0.155), .48)
pr = skin.node_tree.nodes.get('Principled BSDF')
pr.inputs['Subsurface Weight'].default_value = .10
pr.inputs['Subsurface Radius'].default_value = (1, .42, .22)
pr.inputs['Subsurface Scale'].default_value = .009
hand.data.materials.append(skin)
nodes, links = skin.node_tree.nodes, skin.node_tree.links
source_uv = nodes.new('ShaderNodeUVMap')
source_uv.uv_map = 'SourceUV'
texdir = SOURCE / 'skins/skins/mindfront_aksel_skin'
def texture(name, filename, data=False):
    n = nodes.new('ShaderNodeTexImage')
    n.name = name
    n.image = bpy.data.images.load(str(texdir / filename))
    if data:
        n.image.colorspace_settings.name = 'Non-Color'
    links.new(source_uv.outputs['UV'], n.inputs['Vector'])
    return n
albedo = texture('Original CC0 skin', 'Aksel_Skin_diffuse.png')
tint = nodes.new('ShaderNodeMixRGB')
tint.blend_type = 'MULTIPLY'
tint.inputs[0].default_value = 1
tint.inputs[2].default_value = (.73, .61, .54, 1)
links.new(albedo.outputs['Color'], tint.inputs[1])
# Project the user's dorsal photograph onto the anatomical mesh. A thin-plate
# landmark warp follows each finger separately. The unphotographed palm uses
# the neutral CC0 skin; the blend mask fades before the photographed silhouette.
photo_points = {
    'wrist.R': [(1580, 565), (1450, 565)],
    'finger2-1.R': [(1150, 649), (935, 650)],
    'finger2-2.R': [(935, 650), (805, 650)],
    'finger2-3.R': [(805, 650), (705, 646)],
    'finger3-1.R': [(1190, 511), (953, 519)],
    'finger3-2.R': [(953, 519), (820, 516)],
    'finger3-3.R': [(820, 516), (735, 503)],
    'finger4-1.R': [(1228, 426), (1048, 439)],
    'finger4-2.R': [(1048, 439), (920, 439)],
    'finger4-3.R': [(920, 439), (837, 441)],
    'finger5-1.R': [(1280, 354), (1138, 333)],
    'finger5-2.R': [(1138, 333), (1036, 331)],
    'finger5-3.R': [(1036, 331), (970, 329)],
    'finger1-1.R': [(1370, 747), (1254, 865)],
    'finger1-2.R': [(1254, 865), (1147, 963)],
    'finger1-3.R': [(1147, 963), (1070, 1010)],
}
anchors = {}
for name, coords in photo_points.items():
    for pt, pixel in zip((armature.bones[name].head_local, armature.bones[name].tail_local), coords):
        anchors[tuple(round(float(c)*10, 6) for c in pt[:2])] = pixel
anchors[(0, -1)] = (1820, 545)
anchors[(-.45, .30)] = (1390, 760)
anchor_xy = np.array(list(anchors))
anchor_uv = np.array(list(anchors.values()), dtype=float) / [1824, 1368]
anchor_uv[:, 1] = 1-anchor_uv[:, 1]
def kernel(a, b):
    r2 = np.sum((a[:, None, :] - b[None, :, :])**2, axis=2)
    return r2 * np.log(np.maximum(r2, 1e-12))
n = len(anchor_xy)
affine = np.column_stack((np.ones(n), anchor_xy))
lhs = np.block([[kernel(anchor_xy, anchor_xy)+np.eye(n)*1e-6, affine], [affine.T, np.zeros((3,3))]])
coef = np.linalg.solve(lhs, np.vstack((anchor_uv, np.zeros((3,2)))))
flat = np.array([[v.co.x*10, v.co.y*10] for v in mesh.vertices])
warped = np.column_stack((kernel(flat, anchor_xy), np.ones(len(flat)), flat)) @ coef
photouv = mesh.uv_layers.new(name='PhotoUV')
mask = mesh.color_attributes.new(name='PhotographCoverage', type='FLOAT_COLOR', domain='POINT')
for v in mesh.vertices:
    nz = v.normal.z
    w = max(0, min(1, (nz-.10)/.52))
    w = w*w*(3-2*w)
    w *= max(0, min(1, (v.co.y+.075)/.055))
    u, vv = warped[v.index]
    if not (0.001 < u < .999 and .001 < vv < .999):
        w = 0
    mask.data[v.index].color = (w, w, w, 1)
for loop in mesh.loops:
    photouv.data[loop.index].uv = warped[loop.vertex_index]
photo_uv_node = nodes.new('ShaderNodeUVMap')
photo_uv_node.uv_map = 'PhotoUV'
phototex = nodes.new('ShaderNodeTexImage')
phototex.image = bpy.data.images.load(str(ROOT / 'assets-src/hand-reference/right-hand-open-reference.png'))
links.new(photo_uv_node.outputs['UV'], phototex.inputs['Vector'])
photo_grade = nodes.new('ShaderNodeMixRGB')
photo_grade.blend_type = 'MULTIPLY'
photo_grade.inputs[0].default_value = 1
photo_grade.inputs[2].default_value = (.82, .85, .90, 1)
links.new(phototex.outputs['Color'], photo_grade.inputs[1])
coverage = nodes.new('ShaderNodeVertexColor')
coverage.layer_name = 'PhotographCoverage'
separate = nodes.new('ShaderNodeSeparateColor')
links.new(phototex.outputs['Color'], separate.inputs['Color'])
chromatic = nodes.new('ShaderNodeMath')
chromatic.operation = 'SUBTRACT'
links.new(separate.outputs['Red'], chromatic.inputs[0])
links.new(separate.outputs['Green'], chromatic.inputs[1])
skin_only = nodes.new('ShaderNodeMapRange')
skin_only.inputs['From Min'].default_value = .10
skin_only.inputs['From Max'].default_value = .24
chroma_ratio = nodes.new('ShaderNodeMath')
chroma_ratio.operation = 'DIVIDE'
links.new(chromatic.outputs[0], chroma_ratio.inputs[0])
links.new(separate.outputs['Red'], chroma_ratio.inputs[1])
links.new(chroma_ratio.outputs[0], skin_only.inputs['Value'])
masked = nodes.new('ShaderNodeMath')
masked.operation = 'MULTIPLY'
links.new(coverage.outputs['Color'], masked.inputs[0])
links.new(skin_only.outputs['Result'], masked.inputs[1])
photo_mix = nodes.new('ShaderNodeMixRGB')
links.new(masked.outputs[0], photo_mix.inputs[0])
links.new(tint.outputs['Color'], photo_mix.inputs[1])
links.new(photo_grade.outputs['Color'], photo_mix.inputs[2])
links.new(photo_mix.outputs['Color'], pr.inputs['Base Color'])
pr.inputs['Roughness'].default_value = .57
pr.inputs['Specular IOR Level'].default_value = .28
pr.inputs['Subsurface Weight'].default_value = .065
normal_tex = texture('Original skin relief', 'Aksel_Skin_NRM.png', True)
normal = nodes.new('ShaderNodeNormalMap')
normal.uv_map = 'SourceUV'
normal.inputs['Strength'].default_value = .30
links.new(normal_tex.outputs['Color'], normal.inputs['Color'])
pores = nodes.new('ShaderNodeTexNoise')
pores.inputs['Scale'].default_value = 6500
pores.inputs['Detail'].default_value = 2
bump = nodes.new('ShaderNodeBump')
bump.inputs['Strength'].default_value = .22
bump.inputs['Distance'].default_value = .000065
links.new(pores.outputs['Fac'], bump.inputs['Height'])
links.new(normal.outputs['Normal'], bump.inputs['Normal'])
links.new(bump.outputs['Normal'], pr.inputs['Normal'])

def set_pose(kind):
    for p in rig.pose.bones:
        p.rotation_mode = 'XYZ'
        p.rotation_euler = (0, 0, 0)
    bends = {'open': (.04, .07, .035), 'relaxed': (.16, .42, .24), 'grip': (.65, 1.25, .75)}[kind]
    for f in range(2, 6):
        for seg in range(1, 4):
            bone = rig.pose.bones[f'finger{f}-{seg}.R']
            bone.rotation_euler.x = -bends[seg-1] * (1+(f-3)*.07)
        rig.pose.bones[f'finger{f}-1.R'].rotation_euler.z = (f-3)*.05
    rig.pose.bones['finger1-1.R'].rotation_euler = (-.18, -.12, -.16)
    rig.pose.bones['finger1-2.R'].rotation_euler.x = -.14 if kind == 'open' else -.34
    rig.pose.bones['finger1-3.R'].rotation_euler.x = -.15 if kind == 'open' else -.35
    bpy.context.view_layer.update()


scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 32
scene.cycles.use_denoising = True
scene.render.resolution_x = 1400
scene.render.resolution_y = 1100
scene.render.resolution_percentage = 100
scene.world.color = (.12, .12, .12)
scene.view_settings.view_transform = 'AgX'
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.film_transparent = False
world = scene.world
world.use_nodes = True
if not world.node_tree.nodes.get('Background'):
    bg = world.node_tree.nodes.new('ShaderNodeBackground')
    wo = world.node_tree.nodes.new('ShaderNodeOutputWorld')
    world.node_tree.links.new(bg.outputs[0], wo.inputs['Surface'])
world.node_tree.nodes['Background'].inputs['Color'].default_value = (.07, .085, .10, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = .6

def light(name, location, energy, size, color):
    data = bpy.data.lights.new(name, 'AREA')
    data.energy, data.shape, data.size, data.color = energy, 'DISK', size, color
    ob = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(ob)
    ob.location = location
    aim(ob, (0, .035, 0))
    return ob

light('Large neutral key', (-.20, .20, .38), 3, .24, (1, .95, .92))
light('Soft fill', (.24, -.05, .15), 1.2, .24, (.82, .9, 1))
light('Edge', (.05, .25, -.02), 1.6, .18, (1, .92, .85))
bpy.ops.object.camera_add(location=(0, -.15, .45))
camera = bpy.context.object
camera.name = 'HandReviewCamera'
scene.camera = camera
camera.data.type = 'ORTHO'
camera.data.ortho_scale = .34
aim(camera, (0, .012, -.02))
camera.rotation_euler.rotate_axis('Z', -.65)

set_pose('relaxed')
# Baking retains the user's detailed hand photograph only, not the source
# photograph/background or the unrelated parts of the CC0 full-body atlas.
bpy.ops.object.select_all(action='DESELECT')
hand.select_set(True)
bpy.context.view_layer.objects.active = hand
packed_uv = mesh.uv_layers.new(name='HandUV')
mesh.uv_layers.active_index = len(mesh.uv_layers)-1
packed_uv.active_render = True
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=1.05, island_margin=.025)
bpy.ops.object.mode_set(mode='OBJECT')
scene.cycles.samples = 8
scene.render.bake.margin = 12
out = next(n for n in nodes if n.type == 'OUTPUT_MATERIAL')
emission = nodes.new('ShaderNodeEmission')
links.new(photo_mix.outputs['Color'], emission.inputs['Color'])
links.new(emission.outputs[0], out.inputs['Surface'])
base_bake = bpy.data.images.new('RightHand_BaseColor_2K', 2048, 2048, alpha=False)
target = nodes.new('ShaderNodeTexImage')
target.image = base_bake
nodes.active = target
print('Baking photograph-derived base color', flush=True)
bpy.ops.object.bake(type='EMIT')
base_bake.filepath_raw = str(WORK / 'right-hand-basecolor.png')
base_bake.file_format = 'PNG'
base_bake.save()
links.new(pr.outputs[0], out.inputs['Surface'])
normal_bake = bpy.data.images.new('RightHand_Normal_2K', 2048, 2048, alpha=False)
normal_bake.colorspace_settings.name = 'Non-Color'
target.image = normal_bake
print('Baking tangent-space skin detail', flush=True)
bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT')
normal_bake.filepath_raw = str(WORK / 'right-hand-normal.png')
normal_bake.file_format = 'PNG'
normal_bake.save()

# Runtime material has exactly the same baked albedo and normals as the review.
game_skin = simple_material('Skin_PhotoMatched_PBR', (.5, .3, .2), .57)
gn, gl = game_skin.node_tree.nodes, game_skin.node_tree.links
gp = gn.get('Principled BSDF')
gp.inputs['Specular IOR Level'].default_value = .28
gp.inputs['Subsurface Weight'].default_value = .035
gp.inputs['Subsurface Radius'].default_value = (1, .42, .22)
gp.inputs['Subsurface Scale'].default_value = .006
for img, socket in [(base_bake, 'Base Color'), (normal_bake, 'Normal')]:
    t = gn.new('ShaderNodeTexImage')
    t.image = img
    if socket == 'Normal':
        nm = gn.new('ShaderNodeNormalMap')
        nm.uv_map = 'HandUV'
        gl.new(t.outputs['Color'], nm.inputs['Color'])
        gl.new(nm.outputs[0], gp.inputs[socket])
    else:
        gl.new(t.outputs['Color'], gp.inputs[socket])

depsgraph = bpy.context.evaluated_depsgraph_get()
poses = {}
for kind in ['relaxed', 'open', 'grip']:
    set_pose(kind)
    evaluated = hand.evaluated_get(depsgraph)
    data = bpy.data.meshes.new_from_object(evaluated, preserve_all_data_layers=True, depsgraph=depsgraph)
    poses[kind] = data
runtime = bpy.data.objects.new('RightHand_Skin', poses['relaxed'])
hand.name = 'Source_RightHand_Editable'
runtime.name = 'RightHand_Skin'
bpy.context.collection.objects.link(runtime)
runtime.data.materials.clear()
runtime.data.materials.append(game_skin)
for layer in list(runtime.data.uv_layers):
    if layer.name != 'HandUV':
        runtime.data.uv_layers.remove(layer)
for attr in list(runtime.data.color_attributes):
    runtime.data.color_attributes.remove(attr)
runtime.shape_key_add(name='Relaxed')
for kind in ['open', 'grip']:
    key = runtime.shape_key_add(name=kind.title())
    assert len(key.data) == len(poses[kind].vertices)
    for dst, src in zip(key.data, poses[kind].vertices):
        dst.co = src.co
    bpy.data.meshes.remove(poses[kind])
hand.hide_render = True
hand.hide_set(True)
rig.hide_set(True)

def cloth_tube(name, rings, color):
    vertices, polygons = [], []
    sides = 48
    for y, rx, rz in rings:
        cx, cz = .06*y, .275*y
        for i in range(sides):
            a = 2*math.pi*i/sides
            wrinkle = .0007*math.sin(a*7+y*65)+.0004*math.sin(a*13-y*90)
            vertices.append((cx+(rx+wrinkle)*math.cos(a), y, cz+(rz+wrinkle)*math.sin(a)))
    for j in range(len(rings)-1):
        for i in range(sides):
            a, b = j*sides+i, j*sides+(i+1)%sides
            polygons.append((a, b, b+sides, a+sides))
    data = bpy.data.meshes.new(name+'Surface')
    data.from_pydata(vertices, [], polygons)
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(simple_material(name+'Cotton', color, .86))
    for p in data.polygons:
        p.use_smooth = True
    return obj

cuff = cloth_tube('Cuff', [(-.060,.034,.028),(-.058,.036,.030),(-.061,.037,.031),
    (-.064,.037,.031),(-.078,.038,.032),(-.080,.037,.031)], (.61,.65,.69))
sleeve = cloth_tube('Sleeve', [(-.078,.036,.030),(-.082,.039,.033),(-.087,.040,.034),
    (-.10,.042,.036),(-.13,.050,.042),(-.17,.062,.052),(-.21,.072,.060),(-.255,.080,.067)], (.81,.83,.85))

# Authoring file keeps the editable low-resolution skeleton and material graph.
# The visible model is the identical mesh/material that is exported to the game.
set_pose('relaxed')
scene.cycles.samples = 48
bpy.ops.object.select_all(action='DESELECT')
runtime.select_set(True)
bpy.context.view_layer.objects.active = runtime
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(WORK / 'right-hand-realistic.blend'))
report = {
    'source_vertices': len(used), 'source_quads': len(faces),
    'basis': {'x':list(axis_x), 'y':list(axis_y), 'z':list(axis_z)},
    'scale':scale,
    'joints': {name:{'head':list(b.head_local),'tail':list(b.tail_local)} for name,b in armature.bones.items()},
    'bounds': [[min(v.co[a] for v in mesh.vertices), max(v.co[a] for v in mesh.vertices)] for a in range(3)],
}
(WORK / 'baseline.json').write_text(json.dumps(report, indent=2))
report['runtime_vertices'] = len(runtime.data.vertices)
report['runtime_triangles'] = sum(len(p.vertices)-2 for p in runtime.data.polygons)
report['morph_targets'] = ['Open', 'Grip']
# Connected skin is verified independently of the separate clothing surfaces.
adjacency = {v.index: set() for v in mesh.vertices}
for edge in mesh.edges:
    a, b = edge.vertices
    adjacency[a].add(b)
    adjacency[b].add(a)
unseen, components = set(adjacency), 0
while unseen:
    components += 1
    stack = [unseen.pop()]
    while stack:
        for neighbor in adjacency[stack.pop()]:
            if neighbor in unseen:
                unseen.remove(neighbor)
                stack.append(neighbor)
report['skin_connected_components'] = components
assert components == 1, 'Skin must not consist of disconnected primitives'
report['weight_max_error'] = max(abs(sum(g.weight for g in v.groups)-1) for v in mesh.vertices)
assert report['weight_max_error'] < .001
root = bpy.data.objects.new('FPS_RightHand', None)
bpy.context.collection.objects.link(root)
bpy.ops.object.select_all(action='DESELECT')
for obj in [runtime, cuff, sleeve]:
    obj.parent = root
    obj.select_set(True)
root.rotation_euler.x = math.pi/2  # glTF +Y fingers, +Z dorsal; not a mirrored hand.
root.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(PUBLIC / 'fps-right-realistic.glb'), export_format='GLB',
    use_selection=True, export_apply=False, export_morph=True, export_animations=False,
    export_yup=True, export_texcoords=True, export_normals=True, export_tangents=True)
root.rotation_euler.x = 0
(WORK / 'verification.json').write_text(json.dumps(report, indent=2))
print(json.dumps({k:v for k,v in report.items() if k not in ['joints','basis']}, indent=2), flush=True)
for pose in ['relaxed', 'open', 'grip']:
    runtime.data.shape_keys.key_blocks['Open'].value = int(pose == 'open')
    runtime.data.shape_keys.key_blocks['Grip'].value = int(pose == 'grip')
    scene.render.filepath = str(WORK / ('right-hand-'+pose+'.png'))
    bpy.ops.render.render(write_still=True)
runtime.data.shape_keys.key_blocks['Grip'].value = 0
bpy.ops.wm.save_as_mainfile(filepath=str(WORK / 'right-hand-realistic.blend'))
