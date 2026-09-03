"""Convert the downloaded PEAK-style source into game-ready modular GLBs.

The downloaded scene contains three static T-pose characters and no armature.
This converter uses character 2 as the common body, builds a small four-limb
rig, keeps its clothes skinned to the same rig, and exports the three headwear
objects plus the scout scarf/belt as independent parts.

The current Blender scene is never cleared or saved.  Work happens in a
temporary scene and is removed after export.
"""

from pathlib import Path
import math
import bpy
import bmesh
from mathutils import Matrix, Vector


PROJECT = Path(r"C:\Users\SSAFY\Desktop\gimbap")
SOURCE = (PROJECT / "assets-src" / "peak-characters" / "extracted" /
          "PEAK Characters" / "1. Source" / "PEAK Characters fin.blend")
TEXTURE_ROOT = (PROJECT / "assets-src" / "peak-characters" / "extracted" /
                "PEAK Characters" / "2. textures")
OUT = PROJECT / "public" / "assets" / "char"
OUT.mkdir(parents=True, exist_ok=True)

TARGET_HEAD_Y = 1.76

CHARACTERS = {
    "ch1": {"body": "BODY.001", "head": "HEAD.001", "hat": "Crab HEAD"},
    "ch2": {"body": "BODY.002", "head": "HEAD.002", "hat": "ChefCAp"},
    "ch3": {"body": "BODY.003", "head": "HEAD.003", "hat": "Hat"},
}


original_scene = bpy.context.scene
if bpy.app.background:
    # CLI 변환에서는 빈 기본 씬을 그대로 쓴다. 창이 없는 background 모드에는
    # bpy.context.window가 없으므로 별도 씬으로 전환할 수 없다.
    work_scene = original_scene
    work_scene.name = "PeakCharacterConvert"
else:
    work_scene = bpy.data.scenes.new("PeakCharacterConvert")
    bpy.context.window.scene = work_scene


def clear_scene():
    for obj in list(work_scene.objects):
        bpy.data.objects.remove(obj, do_unlink=True)


def load_objects(names):
    with bpy.data.libraries.load(str(SOURCE), link=False) as (src, dst):
        present = [name for name in names if name in src.objects]
        missing = sorted(set(names) - set(present))
        if missing:
            raise RuntimeError("Missing source objects: " + ", ".join(missing))
        dst.objects = present
    loaded = [obj for obj in dst.objects if obj]
    for obj in loaded:
        work_scene.collection.objects.link(obj)
    bpy.context.view_layer.update()
    return {obj.name: obj for obj in loaded}


def texture_index():
    return {p.name.lower(): p for p in TEXTURE_ROOT.rglob("*") if p.is_file()}


TEXTURES = texture_index()


def relink_images():
    for image in bpy.data.images:
        if image.source != "FILE":
            continue
        name = Path(image.filepath or image.name).name.lower()
        path = TEXTURES.get(name)
        if not path:
            continue
        image.filepath = str(path)
        try:
            image.reload()
        except RuntimeError:
            pass


def bounds_world(obj):
    pts = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def normalizer(body, head):
    body_lo, _ = bounds_world(body)
    head_lo, head_hi = bounds_world(head)
    head_center = (head_lo.z + head_hi.z) / 2
    ground = body_lo.z
    scale = TARGET_HEAD_Y / (head_center - ground)
    center_x = (head_lo.x + head_hi.x) / 2
    center_y = (head_lo.y + head_hi.y) / 2
    return Matrix.Scale(scale, 4) @ Matrix.Translation(Vector((-center_x, -center_y, -ground)))


def apply_normalizer(objects, matrix):
    for obj in objects:
        obj.matrix_world = matrix @ obj.matrix_world
    bpy.context.view_layer.update()
    for obj in objects:
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        obj.select_set(False)


def solid_material(name, rgba):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.diffuse_color = rgba
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = rgba
        bsdf.inputs["Roughness"].default_value = 0.86
        bsdf.inputs["Metallic"].default_value = 0.0
    return mat


SKIN = solid_material("peak-skin", (0.92, 0.67, 0.39, 1.0))


def use_material(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    for poly in obj.data.polygons:
        poly.material_index = 0
        poly.use_smooth = False


def make_armature():
    data = bpy.data.armatures.new("PeakRig")
    rig = bpy.data.objects.new("rig", data)
    work_scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")

    torso = data.edit_bones.new("torso")
    torso.head = (0, 0, 0.66)
    torso.tail = (0, 0, 1.43)

    for side, label in ((-1, "L"), (1, "R")):
        leg = data.edit_bones.new("leg" + label)
        leg.head = (side * 0.16, 0, 0.72)
        leg.tail = (side * 0.16, 0, 0.08)
        leg.parent = torso

        arm = data.edit_bones.new("arm" + label)
        arm.head = (side * 0.33, 0, 1.29)
        arm.tail = (side * 0.33, 0, 0.70)
        arm.parent = torso

    bpy.ops.object.mode_set(mode="OBJECT")
    rig.select_set(False)
    return rig


def smoothstep(value):
    value = max(0.0, min(1.0, value))
    return value * value * (3.0 - 2.0 * value)


def skin_to_rig(obj, rig):
    groups = {name: obj.vertex_groups.new(name=name)
              for name in ("torso", "armL", "armR", "legL", "legR")}
    for v in obj.data.vertices:
        x, z = v.co.x, v.co.z
        arm_w = smoothstep((abs(x) - 0.27) / 0.24) * smoothstep((z - 0.92) / 0.22)
        leg_w = smoothstep((0.88 - z) / 0.24)

        # The source is a T-pose.  Fold each arm down around its shoulder before
        # defining the vertical rest bones used by the game.  Vertices in the
        # shoulder blend band rotate proportionally, keeping the seam rounded.
        if arm_w > 0:
            side = -1 if x < 0 else 1
            pivot_x, pivot_z = side * 0.33, 1.29
            angle = side * (math.pi / 2) * arm_w
            dx, dz = x - pivot_x, z - pivot_z
            v.co.x = pivot_x + math.cos(angle) * dx + math.sin(angle) * dz
            v.co.z = pivot_z - math.sin(angle) * dx + math.cos(angle) * dz
        # A vertex should belong to one moving limb at most.  The torso keeps
        # the blend band at shoulders and hips, preventing hard cracks.
        if arm_w >= leg_w and arm_w > 0:
            moving = "armL" if x < 0 else "armR"
            groups[moving].add([v.index], arm_w, "REPLACE")
            groups["torso"].add([v.index], 1.0 - arm_w, "REPLACE")
        elif leg_w > 0:
            moving = "legL" if x < 0 else "legR"
            groups[moving].add([v.index], leg_w, "REPLACE")
            groups["torso"].add([v.index], 1.0 - leg_w, "REPLACE")
        else:
            groups["torso"].add([v.index], 1.0, "REPLACE")

    mod = obj.modifiers.new("Peak game rig", "ARMATURE")
    mod.object = rig
    obj.parent = rig


def remove_source_arms(obj, threshold=0.35):
    """Remove the flattened T-pose arms while preserving the shoulder blend.

    The source hands are modeled palm-flat and become wedge shaped after the
    90 degree fold.  Puffy shirt sleeves cover the small open shoulder seam,
    so replacing only the weighted lower-arm region is both cleaner and safer
    than trying to reshape the connected torso mesh.
    """
    arm_ids = {obj.vertex_groups[name].index for name in ("armL", "armR")}
    remove = {
        v.index for v in obj.data.vertices
        if any(w.group in arm_ids and w.weight >= threshold for w in v.groups)
    }
    mesh = bmesh.new()
    mesh.from_mesh(obj.data)
    mesh.verts.ensure_lookup_table()
    bmesh.ops.delete(mesh, geom=[mesh.verts[i] for i in remove], context="VERTS")
    mesh.to_mesh(obj.data)
    mesh.free()
    obj.data.update()


def connected_vertex_islands(obj):
    """Return disconnected vertex islands without changing the source mesh."""
    adjacency = [set() for _ in obj.data.vertices]
    for edge in obj.data.edges:
        a, b = edge.vertices
        adjacency[a].add(b)
        adjacency[b].add(a)

    unseen = set(range(len(obj.data.vertices)))
    islands = []
    while unseen:
        seed = unseen.pop()
        stack = [seed]
        island = [seed]
        while stack:
            current = stack.pop()
            for neighbour in adjacency[current]:
                if neighbour in unseen:
                    unseen.remove(neighbour)
                    stack.append(neighbour)
                    island.append(neighbour)
        islands.append(island)
    return islands


def delete_vertices(obj, indices):
    mesh = bmesh.new()
    mesh.from_mesh(obj.data)
    mesh.verts.ensure_lookup_table()
    bmesh.ops.delete(mesh, geom=[mesh.verts[i] for i in indices], context="VERTS")
    mesh.to_mesh(obj.data)
    mesh.free()
    obj.data.update()


def split_base_clothes(clothes, waist_center_z=1.0):
    """Split the source outfit into independently skinned upper/lower nodes.

    The downloaded outfit is one object, but its shirt/sleeve and shorts shells
    are disconnected topology islands.  Classifying whole islands avoids a raw
    plane cut through cuffs or the waistband.  In normalized game coordinates,
    lower-island centres end below 0.93 m and upper centres start above 1.14 m.
    """
    islands = connected_vertex_islands(clothes)
    top_delete = []
    bottom_delete = []
    for island in islands:
        zs = [clothes.data.vertices[index].co.z for index in island]
        center_z = (min(zs) + max(zs)) * 0.5
        if center_z < waist_center_z:
            top_delete.extend(island)
        else:
            bottom_delete.extend(island)

    bottom = clothes.copy()
    bottom.data = clothes.data.copy()
    work_scene.collection.objects.link(bottom)
    delete_vertices(clothes, top_delete)
    delete_vertices(bottom, bottom_delete)
    clothes.name = "baseTop"
    bottom.name = "baseBottom"
    print("[peak-modular] split outfit:",
          len(clothes.data.vertices), "top vertices,",
          len(bottom.data.vertices), "bottom vertices")
    if not clothes.data.vertices or not bottom.data.vertices:
        raise RuntimeError("Outfit split produced an empty part")
    return clothes, bottom


def rounded_part(name, location, scale, material, rig, bone):
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=10, ring_count=6, location=location
    )
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    use_material(obj, material)
    bone_parent_keep_world(obj, rig, bone)
    return obj


def build_replacement_arms(rig):
    """Build round low-poly arms that keep their volume in every game pose."""
    for side, label in ((-1, "L"), (1, "R")):
        x = side * 0.33
        # One soft pill for the arm and a slightly wider hand.  Both overlap
        # under the retained shirt sleeve, so no shoulder gap is visible.
        rounded_part("skinArm" + label, (x, 0, 0.98),
                     (0.080, 0.074, 0.215), SKIN, rig, "arm" + label)
        rounded_part("skinHand" + label, (x, -0.006, 0.735),
                     (0.094, 0.078, 0.115), SKIN, rig, "arm" + label)


def bone_parent_keep_world(obj, rig, bone):
    world = obj.matrix_world.copy()
    obj.parent = rig
    obj.parent_type = "BONE"
    obj.parent_bone = bone
    obj.matrix_world = world


def export_glb(relative):
    path = OUT / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    relink_images()
    bpy.ops.export_scene.gltf(
        filepath=str(path), export_format="GLB", use_selection=False,
        use_active_scene=True, export_yup=True, export_apply=False,
        export_cameras=False, export_lights=False,
    )
    print("[peak-modular]", path.relative_to(PROJECT))


def decimate(obj, target_vertices):
    if obj.type != "MESH" or len(obj.data.vertices) <= target_vertices:
        return
    ratio = max(0.02, target_vertices / len(obj.data.vertices))
    mod = obj.modifiers.new("game decimate", "DECIMATE")
    mod.ratio = ratio
    mod.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    obj.select_set(False)


def build_base():
    clear_scene()
    objs = load_objects(["BODY.002", "HEAD.002", "CLOTHES.002"])
    body, head, clothes = objs["BODY.002"], objs["HEAD.002"], objs["CLOTHES.002"]
    matrix = normalizer(body, head)
    apply_normalizer([body, head, clothes], matrix)

    body.name = "body"
    head.name = "head"
    top, bottom = split_base_clothes(clothes)
    use_material(body, SKIN)
    use_material(head, SKIN)

    rig = make_armature()
    skin_to_rig(body, rig)
    skin_to_rig(top, rig)
    skin_to_rig(bottom, rig)
    remove_source_arms(body)
    build_replacement_arms(rig)
    bone_parent_keep_world(head, rig, "torso")
    export_glb(Path("base.glb"))


def build_hat(char_key, output_name, target_vertices):
    clear_scene()
    spec = CHARACTERS[char_key]
    objs = load_objects([spec["body"], spec["head"], spec["hat"]])
    body, head, hat = objs[spec["body"]], objs[spec["head"]], objs[spec["hat"]]
    matrix = normalizer(body, head)
    apply_normalizer([body, head, hat], matrix)
    bpy.data.objects.remove(body, do_unlink=True)
    bpy.data.objects.remove(head, do_unlink=True)
    hat.name = "headwear-" + output_name
    decimate(hat, target_vertices)
    export_glb(Path("hair") / (output_name + ".glb"))


def build_scout_accessory():
    clear_scene()
    names = ["BODY.002", "HEAD.002", "Belt.001", "ch3 Scarft 1", "ch3 Scarft 2"]
    objs = load_objects(names)
    body, head = objs["BODY.002"], objs["HEAD.002"]
    parts = [objs["Belt.001"], objs["ch3 Scarft 1"], objs["ch3 Scarft 2"]]
    matrix = normalizer(body, head)
    apply_normalizer([body, head, *parts], matrix)
    bpy.data.objects.remove(body, do_unlink=True)
    bpy.data.objects.remove(head, do_unlink=True)
    for i, part in enumerate(parts):
        part.name = ("scoutBelt" if i == 0 else "scoutScarf" + str(i))
    export_glb(Path("top") / "scout.glb")


try:
    build_base()
    build_hat("ch2", "chef", 5000)
    build_hat("ch1", "crab", 6500)
    build_hat("ch3", "cap", 3500)
    build_scout_accessory()
finally:
    clear_scene()
    if not bpy.app.background:
        bpy.context.window.scene = original_scene
        bpy.data.scenes.remove(work_scene)

print("[peak-modular] complete")
