"""Build the code-style character as modular GLB assets.

Run from Blender or through Blender MCP.  The script creates a temporary scene,
so the artist's currently open scene is left untouched.

Outputs:
  public/assets/char/base.glb
  public/assets/char/hair/{short,bob,bun,spiky,long}.glb
  public/assets/char/top/{tee,apron,stripe,hoodie,vest}.glb
"""

from pathlib import Path
import math
import bpy


PROJECT = Path(r"C:\Users\SSAFY\Desktop\gimbap")
OUT = PROJECT / "public" / "assets" / "char"
OUT.mkdir(parents=True, exist_ok=True)

# Same dimensions as public/js/world.js. Coordinates below are Three.js
# coordinates (x right, y up, z forward); T() maps them into Blender.
BODY = {
    "head_y": 1.76, "head_r": 0.43, "head_flat": 0.94,
    "face_z": 0.370, "brow_up": 0.125, "mouth_down": 0.175,
    "torso_y": 1.05, "torso_r": 0.295, "torso_h": 0.32,
    "shoulder_y": 1.32, "shoulder_x": 0.33,
    "arm_r": 0.088, "upper_arm_h": 0.14,
    "forearm_r": 0.066, "forearm_h": 0.17,
    "hip_y": 0.70, "hip_x": 0.145,
    "thigh_r": 0.098, "thigh_h": 0.10,
    "calf_r": 0.074, "calf_h": 0.13, "shoe_r": 0.115,
}
EYE = 1.82


def T(x, y, z):
    """Three.js x/y/z -> Blender x/y/z."""
    return (x, -z, y)


def material(name, color, roughness=0.82):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1.0)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (*color, 1.0)
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Metallic"].default_value = 0.0
    return m


MAT = {
    "skin": material("skin", (0.92, 0.72, 0.52)),
    "shirt": material("shirt", (0.29, 0.44, 0.65)),
    "sleeve": material("sleeve", (0.23, 0.35, 0.52)),
    "pants": material("pants", (0.25, 0.27, 0.31)),
    "shoe": material("shoe", (0.12, 0.13, 0.16)),
    "eye_white": material("eye-white", (0.95, 0.92, 0.86)),
    "eye_dark": material("eye-dark", (0.055, 0.043, 0.035)),
    "brow": material("brow", (0.15, 0.11, 0.08)),
    "mouth": material("mouth", (0.38, 0.16, 0.14)),
    "custom": material("custom", (0.29, 0.44, 0.65)),
    "linen": material("linen", (0.88, 0.85, 0.78)),
    "cord": material("cord", (0.72, 0.69, 0.62)),
}


original_scene = bpy.context.window.scene
work_scene = bpy.data.scenes.new("CharacterAssetBuild")
bpy.context.window.scene = work_scene


def clear_objects():
    for obj in list(work_scene.objects):
        bpy.data.objects.remove(obj, do_unlink=True)


def empty(name, loc=(0, 0, 0), parent=None):
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = "PLAIN_AXES"
    obj.location = loc
    work_scene.collection.objects.link(obj)
    if parent:
        obj.parent = parent
    return obj


def finish_mesh(obj, mat, parent=None):
    obj.data.materials.append(mat)
    if hasattr(obj.data, "polygons"):
        for poly in obj.data.polygons:
            poly.use_smooth = False
    if parent:
        obj.parent = parent
    return obj


def sphere(name, loc, scale, mat, parent=None, segments=12, rings=8):
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=segments, ring_count=rings, location=loc
    )
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish_mesh(obj, mat, parent)


def cylinder(name, loc, radius, depth, mat, parent=None, vertices=10):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices, radius=radius, depth=depth, location=loc
    )
    obj = bpy.context.object
    obj.name = name
    return finish_mesh(obj, mat, parent)


def cube(name, loc, dims, mat, parent=None, bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    obj = bpy.context.object
    obj.name = name
    # Three dimensions x/y/z map to Blender x/z/y.
    obj.dimensions = (dims[0], dims[2], dims[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = obj.modifiers.new("soft bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 1
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return finish_mesh(obj, mat, parent)


def capsule(name, loc, radius, straight, mat, parent=None, vertices=10):
    """Low-poly capsule built as a named empty with three mesh children."""
    root = empty(name, loc, parent)
    cylinder(name + "Body", (0, 0, 0), radius, straight, mat, root, vertices)
    sphere(name + "Top", (0, 0, straight / 2), (radius,) * 3, mat, root,
           segments=vertices, rings=6)
    sphere(name + "Bottom", (0, 0, -straight / 2), (radius,) * 3, mat, root,
           segments=vertices, rings=6)
    return root


def arc_tube(name, loc, radius, thickness, mat, parent=None):
    curve = bpy.data.curves.new(name + "Curve", "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 1
    curve.bevel_depth = thickness
    curve.bevel_resolution = 0
    curve.resolution_u = 1
    spline = curve.splines.new("POLY")
    steps = 10
    spline.points.add(steps)
    for i in range(steps + 1):
        a = math.pi * i / steps
        # Arc lies in Blender XZ plane; -Y points toward the character's front.
        spline.points[i].co = (radius * math.cos(a), 0, radius * math.sin(a), 1)
    obj = bpy.data.objects.new(name + "Stroke", curve)
    work_scene.collection.objects.link(obj)
    finish_mesh(obj, mat, parent)
    root = empty(name, loc, parent)
    obj.parent = root
    return root


def export_glb(relative):
    path = OUT / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(path), export_format="GLB", use_selection=False,
        use_active_scene=True,
        export_yup=True, export_apply=False,
        export_cameras=False, export_lights=False,
    )
    print("[character-assets]", path.relative_to(PROJECT))


def build_base():
    clear_objects()
    rig = empty("rig")

    capsule("torso", T(0, BODY["torso_y"], 0), BODY["torso_r"],
            BODY["torso_h"], MAT["shirt"], rig)
    capsule("neck", T(0, 1.40, -0.015), 0.105, 0.10, MAT["skin"], rig, 9)
    sphere("head", T(0, BODY["head_y"], 0),
           (BODY["head_r"], BODY["head_r"] * BODY["head_flat"],
            BODY["head_r"] * 0.98), MAT["skin"], rig, 16, 10)

    thigh_total = BODY["thigh_h"] + BODY["thigh_r"] * 2
    calf_total = BODY["calf_h"] + BODY["calf_r"] * 2
    for side, label in ((-1, "L"), (1, "R")):
        hip = empty("leg" + label, T(side * BODY["hip_x"], BODY["hip_y"], 0), rig)
        capsule("thigh" + label, T(0, -thigh_total / 2, 0),
                BODY["thigh_r"], BODY["thigh_h"], MAT["pants"], hip)
        calf_top = -thigh_total + 0.04
        capsule("calf" + label, T(0, calf_top - calf_total / 2, 0.005),
                BODY["calf_r"], BODY["calf_h"], MAT["skin"], hip)
        sphere("shoe" + label, T(0, calf_top - calf_total + 0.035, 0.055),
               (BODY["shoe_r"] * 1.05, BODY["shoe_r"] * 1.48,
                BODY["shoe_r"] * 0.68), MAT["shoe"], hip, 10, 6)

    upper_total = BODY["upper_arm_h"] + BODY["arm_r"] * 2
    fore_total = BODY["forearm_h"] + BODY["forearm_r"] * 2
    for side, label in ((-1, "L"), (1, "R")):
        shoulder = empty("arm" + label,
                         T(side * BODY["shoulder_x"], BODY["shoulder_y"], 0), rig)
        capsule("sleeve" + label, T(0, -upper_total / 2, 0),
                BODY["arm_r"], BODY["upper_arm_h"], MAT["sleeve"], shoulder)
        fore_top = -upper_total + 0.035
        capsule("forearm" + label, T(0, fore_top - fore_total / 2, 0),
                BODY["forearm_r"], BODY["forearm_h"], MAT["skin"], shoulder)
        sphere("hand" + label, T(0, fore_top - fore_total + 0.052, 0.012),
               (0.092 * 0.98, 0.092 * 0.92, 0.092 * 1.08),
               MAT["skin"], shoulder, 10, 6)

    eye_local = EYE - BODY["head_y"]
    for side, label in ((-1, "L"), (1, "R")):
        eye = empty("eye" + label, T(side * 0.15, EYE, BODY["face_z"]), rig)
        sphere("eyeWhite" + label, (0, 0, 0),
               (0.078 * 0.92, 0.078 * 0.55, 0.078 * 1.08),
               MAT["eye_white"], eye, 10, 8)
        sphere("pupil" + label, T(-side * 0.008, -0.003, 0.061),
               (0.037, 0.037 * 0.72, 0.037), MAT["eye_dark"], eye, 9, 7)
        cube("brow" + label,
             T(side * 0.15, EYE + BODY["brow_up"], BODY["face_z"] + 0.010),
             (0.13, 0.028, 0.03), MAT["brow"], rig, 0.006)

    arc_tube("mouth", T(0, EYE - BODY["mouth_down"], BODY["face_z"]),
             0.085, 0.017, MAT["mouth"], rig)
    export_glb(Path("base.glb"))


def dome(name, radius, cutoff, flat, parent):
    rings, segments = 5, 14
    phi_max = math.acos(max(-1, min(1, cutoff / (radius * 0.98))))
    verts, faces = [], []
    for ri in range(rings + 1):
        phi = phi_max * ri / rings
        for si in range(segments):
            a = math.tau * si / segments
            x = radius * math.sin(phi) * math.cos(a)
            z = radius * flat * math.sin(phi) * math.sin(a)
            y = radius * 0.98 * math.cos(phi)
            verts.append(T(x, y, z))
    for ri in range(rings):
        for si in range(segments):
            a = ri * segments + si
            b = ri * segments + (si + 1) % segments
            c = (ri + 1) * segments + (si + 1) % segments
            d = (ri + 1) * segments + si
            faces.append((a, b, c, d))
    mesh = bpy.data.meshes.new(name + "Mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    obj.location = T(0, BODY["head_y"], -0.012)
    work_scene.collection.objects.link(obj)
    finish_mesh(obj, MAT["custom"], parent)
    return obj


def build_hair(kind):
    clear_objects()
    root = empty("hair-" + kind)
    radius = BODY["head_r"] + 0.014
    cutoff = EYE - BODY["head_y"] + BODY["brow_up"] + 0.035
    if kind == "short":
        dome("hairCap", radius, cutoff, 0.95, root)
    elif kind == "bob":
        dome("hairCap", radius + 0.004, cutoff, 0.95, root)
        for side, label in ((-1, "L"), (1, "R")):
            cube("sideHair" + label, T(side * 0.415, 1.84, -0.04),
                 (0.11, 0.34, 0.32), MAT["custom"], root, 0.025)
    elif kind == "bun":
        dome("hairCap", radius, cutoff, 0.95, root)
        sphere("hairBun", T(0, 2.02, -0.36), (0.145,) * 3,
               MAT["custom"], root, 9, 6)
    elif kind == "spiky":
        dome("hairCap", radius, cutoff + 0.02, 0.95, root)
        for i in range(5):
            spike = cylinder("spike" + str(i), T((i - 2) * 0.115, 2.30, -0.05),
                             0.072, 0.24, MAT["custom"], root, 5)
            spike.rotation_euler[1] = -(i - 2) * 0.20
    elif kind == "long":
        dome("hairCap", radius + 0.004, cutoff, 0.95, root)
        cube("backHair", T(0, 1.52, -0.30), (0.58, 0.64, 0.27),
             MAT["custom"], root, 0.04)
        for side, label in ((-1, "L"), (1, "R")):
            cube("sideHair" + label, T(side * 0.412, 1.78, -0.03),
                 (0.12, 0.50, 0.30), MAT["custom"], root, 0.025)
    export_glb(Path("hair") / (kind + ".glb"))


def build_top(kind):
    clear_objects()
    root = empty("top-" + kind)
    r = BODY["torso_r"] + 0.006
    top = BODY["shoulder_y"] + 0.025
    if kind == "apron":
        cube("apronCloth", T(0, BODY["torso_y"] - 0.04, r),
             (0.34, 0.52, 0.03), MAT["linen"], root, 0.018)
        cube("apronStrap", T(0, top - 0.03, r),
             (0.38, 0.035, 0.03), MAT["cord"], root, 0.008)
    elif kind == "stripe":
        for i in range(3):
            cylinder("stripe" + str(i), T(0, BODY["torso_y"] - 0.20 + i * 0.20, 0),
                     r, 0.06, MAT["custom"], root, 12)
    elif kind == "hoodie":
        sphere("hood", T(0, top - 0.02, -0.13),
               (0.22, 0.22 * 0.75, 0.22 * 0.62), MAT["custom"], root, 9, 6)
        cube("hoodString", T(0, BODY["torso_y"], r),
             (0.05, 0.26, 0.03), MAT["linen"], root, 0.008)
    elif kind == "vest":
        for side, label in ((-1, "L"), (1, "R")):
            cube("vestPanel" + label, T(side * 0.10, BODY["torso_y"] - 0.02, r),
                 (0.11, 0.46, 0.03), MAT["custom"], root, 0.018)
        cylinder("vestShoulder", T(0, top - 0.04, 0), r + 0.006, 0.05,
                 MAT["custom"], root, 12)
    else:  # tee
        cylinder("teeCollar", T(0, top - 0.03, 0), r + 0.005, 0.055,
                 MAT["custom"], root, 12)
    export_glb(Path("top") / (kind + ".glb"))


try:
    build_base()
    for hair_name in ("short", "bob", "bun", "spiky", "long"):
        build_hair(hair_name)
    for top_name in ("tee", "apron", "stripe", "hoodie", "vest"):
        build_top(top_name)
finally:
    clear_objects()
    bpy.context.window.scene = original_scene
    bpy.data.scenes.remove(work_scene)

print("[character-assets] complete")
