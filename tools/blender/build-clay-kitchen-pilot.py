"""Build a non-destructive clay low-poly kitchen pilot and catalog render.

The five GLBs are approval candidates only.  They live outside the runtime
manifest until the art direction is accepted.
"""

from __future__ import annotations

from pathlib import Path
import math

import bpy
from mathutils import Vector


PROJECT = Path(__file__).resolve().parents[2]
OUT = PROJECT / "public" / "assets" / "concepts" / "clay-kitchen-pilot"
PREVIEW = PROJECT / "clay-kitchen-pilot-preview.png"
PREVIEW_NEXT = PROJECT / "clay-kitchen-secondary-preview.png"
PREVIEW_THIRD = PROJECT / "clay-kitchen-tools-preview.png"
OUT.mkdir(parents=True, exist_ok=True)

PALETTE = {
    "cream": (0.76, 0.68, 0.54, 1),
    "cream_light": (0.91, 0.85, 0.72, 1),
    "teal": (0.25, 0.40, 0.38, 1),
    "teal_dark": (0.15, 0.27, 0.27, 1),
    "wood": (0.56, 0.31, 0.15, 1),
    "wood_light": (0.72, 0.46, 0.24, 1),
    "charcoal": (0.10, 0.11, 0.11, 1),
    "steel": (0.35, 0.37, 0.36, 1),
    "water": (0.20, 0.52, 0.62, 0.82),
    "orange": (0.88, 0.30, 0.09, 1),
    "green": (0.24, 0.43, 0.29, 1),
    "green_dark": (0.12, 0.26, 0.17, 1),
    "screen": (0.18, 0.55, 0.48, 1),
}
M = {}


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.context.scene.unit_settings.scale_length = 1.0
    M.clear()
    M.update({name: material("clay_" + name, color,
                             0.82 if name == "water" else 0.90,
                             0.06 if name == "steel" else 0.0)
              for name, color in PALETTE.items()})


def material(name, color, roughness=0.90, metallic=0.0):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.diffuse_color = color
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = color
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Metallic"].default_value = metallic
        if color[3] < 1:
            bsdf.inputs["Alpha"].default_value = color[3]
            mat.surface_render_method = "DITHERED"
    return mat


def flat(obj):
    if obj.type == "MESH":
        for poly in obj.data.polygons:
            poly.use_smooth = False


def use_material(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    flat(obj)


def apply_modifier(obj, modifier):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj.select_set(False)


def clay_box(name, size, location, mat, bevel=0.035, rotation=None):
    bpy.ops.mesh.primitive_cube_add(location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = obj.modifiers.new("soft clay bevel", "BEVEL")
        mod.width = min(bevel, min(size) * 0.22)
        mod.segments = 2
        apply_modifier(obj, mod)
    if rotation:
        obj.rotation_euler = rotation
    use_material(obj, mat)
    return obj


def clay_cylinder(name, radius, depth, location, mat, vertices=10, rotation=None):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth,
                                       location=location,
                                       rotation=rotation or (0, 0, 0))
    obj = bpy.context.object
    obj.name = name
    bevel = obj.modifiers.new("soft clay rim", "BEVEL")
    bevel.width = min(0.018, depth * 0.16, radius * 0.10)
    bevel.segments = 2
    apply_modifier(obj, bevel)
    use_material(obj, mat)
    return obj


def clay_cone(name, radius_bottom, radius_top, depth, location, mat, vertices=10):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius_bottom,
                                   radius2=radius_top, depth=depth, location=location)
    obj = bpy.context.object
    obj.name = name
    bevel = obj.modifiers.new("soft clay lip", "BEVEL")
    bevel.width = min(0.015, depth * 0.14, radius_bottom * 0.08)
    bevel.segments = 2
    apply_modifier(obj, bevel)
    use_material(obj, mat)
    return obj


def clay_torus(name, major_radius, minor_radius, location, mat, rotation=None):
    bpy.ops.mesh.primitive_torus_add(major_radius=major_radius, minor_radius=minor_radius,
                                    major_segments=10, minor_segments=4,
                                    location=location,
                                    rotation=rotation or (0, 0, 0))
    obj = bpy.context.object
    obj.name = name
    use_material(obj, mat)
    return obj


def clay_prism(name, outline, height, location, mat):
    """Create a low-poly vertical prism from an x/y outline."""
    count = len(outline)
    verts = [(x, y, 0) for x, y in outline] + [(x, y, height) for x, y in outline]
    faces = [tuple(range(count - 1, -1, -1)), tuple(range(count, count * 2))]
    for index in range(count):
        nxt = (index + 1) % count
        faces.append((index, nxt, count + nxt, count + index))
    mesh = bpy.data.meshes.new(name + "Mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = location
    bevel = obj.modifiers.new("soft clay edge", "BEVEL")
    bevel.width = min(0.008, height * 0.20)
    bevel.segments = 2
    apply_modifier(obj, bevel)
    use_material(obj, mat)
    return obj


def make_root(name):
    root = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(root)
    return root


def parent(root, *objects):
    for obj in objects:
        obj.parent = root
    return root


def build_sink():
    root = make_root("sink")
    parts = [
        clay_box("sinkCabinet", (1.24, 1.58, 0.98), (0, 0, 0.49), M["teal"], 0.07),
        clay_box("sinkTop", (1.30, 1.70, 0.15), (0, 0, 1.03), M["wood_light"], 0.055),
        clay_box("basinBack", (0.92, 0.10, 0.10), (0, 0.38, 1.145), M["steel"], 0.035),
        clay_box("basinFront", (0.92, 0.10, 0.10), (0, -0.54, 1.145), M["steel"], 0.035),
        clay_box("basinLeft", (0.10, 0.82, 0.10), (-0.41, -0.08, 1.145), M["steel"], 0.035),
        clay_box("basinRight", (0.10, 0.82, 0.10), (0.41, -0.08, 1.145), M["steel"], 0.035),
        clay_box("basinInset", (0.72, 0.80, 0.025), (0, -0.08, 1.112), M["charcoal"], 0.045),
        clay_cylinder("drain", 0.055, 0.012, (0, -0.08, 1.130), M["steel"], 10),
        clay_box("doorL", (0.50, 0.055, 0.62), (-0.29, -0.815, 0.55), M["teal_dark"], 0.025),
        clay_box("doorR", (0.50, 0.055, 0.62), (0.29, -0.815, 0.55), M["teal_dark"], 0.025),
        clay_box("cabinetPlinth", (1.08, 0.08, 0.10), (0, -0.77, 0.08), M["teal_dark"], 0.03),
        clay_cylinder("handleL", 0.025, 0.23, (-0.10, -0.855, 0.60), M["cream_light"], 8,
                      (math.pi / 2, 0, 0)),
        clay_cylinder("handleR", 0.025, 0.23, (0.10, -0.855, 0.60), M["cream_light"], 8,
                      (math.pi / 2, 0, 0)),
        clay_cylinder("faucetPost", 0.038, 0.46, (-0.33, 0.31, 1.37), M["charcoal"], 8),
        clay_cylinder("faucetArm", 0.038, 0.45, (-0.12, 0.31, 1.58), M["charcoal"], 8,
                      (0, math.pi / 2, 0)),
        clay_cylinder("faucetMouth", 0.038, 0.22, (0.10, 0.31, 1.49), M["charcoal"], 8),
        clay_cylinder("tapL", 0.070, 0.055, (-0.20, 0.31, 1.19), M["cream_light"], 8),
        clay_cylinder("tapR", 0.070, 0.055, (0.20, 0.31, 1.19), M["cream_light"], 8),
        clay_box("tapLeverL", (0.16, 0.055, 0.045), (-0.20, 0.31, 1.23), M["wood"], 0.018),
        clay_box("tapLeverR", (0.16, 0.055, 0.045), (0.20, 0.31, 1.23), M["wood"], 0.018),
    ]
    return parent(root, *parts)


def build_stove(length=6.80, burner_count=5):
    root = make_root("stove")
    parts = [
        clay_box("stoveBody", (1.22, length, 0.94), (0, 0, 0.47), M["teal_dark"], 0.075),
        clay_box("stoveTop", (1.30, length, 0.15), (0, 0, 1.02), M["charcoal"], 0.045),
    ]
    spacing = length / burner_count
    for index in range(burner_count):
        y = -length / 2 + spacing * (index + 0.5)
        parts.extend([
            clay_box("burnerRailX%02d" % (index + 1), (0.66, 0.055, 0.035),
                     (0.08, y, 1.125), M["steel"], 0.012),
            clay_box("burnerRailY%02d" % (index + 1), (0.055, 0.66, 0.035),
                     (0.08, y, 1.125), M["steel"], 0.012),
            clay_torus("burnerRing%02d" % (index + 1), 0.29, 0.032,
                       (0.08, y, 1.105), M["steel"]),
            clay_cylinder("burnerCore%02d" % (index + 1), 0.19, 0.035,
                          (0.08, y, 1.105), M["charcoal"], 10),
            clay_cylinder("knob%02d" % (index + 1), 0.072, 0.09,
                          (-0.66, y, 0.78), M["cream"], 8,
                          (0, math.pi / 2, 0)),
            clay_box("heatMark%02d" % (index + 1), (0.035, 0.16, 0.055),
                     (-0.714, y, 0.78), M["orange"], 0.012),
            clay_box("frontPanel%02d" % (index + 1), (0.035, spacing * 0.76, 0.48),
                     (-0.635, y, 0.42), M["teal"], 0.018),
        ])
    return parent(root, *parts)


def build_table():
    root = make_root("table")
    # 도마대·조립대·서빙대에서 길게 늘여 쓰는 공용 테이블이다. 상판과
    # 아래 선반을 한 장으로 만들어 세 구역이 붙은 것처럼 보이지 않게 한다.
    parts = [
        clay_box("tableTop", (1.00, 1.50, 0.14), (0, 0, 0.60), M["wood_light"], 0.055),
        clay_box("apronFront", (0.84, 0.10, 0.18), (0, -0.60, 0.49), M["teal_dark"], 0.03),
        clay_box("apronBack", (0.84, 0.10, 0.18), (0, 0.60, 0.49), M["teal_dark"], 0.03),
        clay_box("apronLeft", (0.10, 1.10, 0.18), (-0.37, 0, 0.49), M["teal_dark"], 0.03),
        clay_box("apronRight", (0.10, 1.10, 0.18), (0.37, 0, 0.49), M["teal_dark"], 0.03),
        clay_box("tableShelf", (0.76, 1.10, 0.10), (0, 0, 0.19), M["teal_dark"], 0.03),
    ]
    for x in (-0.37, 0.37):
        for y in (-0.60, 0.60):
            parts.append(clay_box("tableLeg", (0.13, 0.13, 0.56),
                                  (x, y, 0.28), M["teal"], 0.035))
    return parent(root, *parts)


def build_pot():
    root = make_root("pot")
    parts = [
        clay_cone("potBody", 0.235, 0.270, 0.24, (0, 0, 0.12), M["steel"], 10),
        clay_cylinder("potBase", 0.205, 0.025, (0, 0, 0.018), M["charcoal"], 10),
        clay_torus("potRim", 0.255, 0.025, (0, 0, 0.245), M["cream_light"]),
        clay_cylinder("water", 0.225, 0.018, (0, 0, 0.235), M["water"], 10),
        clay_box("handleL", (0.15, 0.12, 0.075), (-0.32, 0, 0.17), M["charcoal"], 0.035),
        clay_box("handleR", (0.15, 0.12, 0.075), (0.32, 0, 0.17), M["charcoal"], 0.035),
        clay_cylinder("rivetL", 0.025, 0.018, (-0.265, 0, 0.17), M["cream_light"], 8,
                      (0, math.pi / 2, 0)),
        clay_cylinder("rivetR", 0.025, 0.018, (0.265, 0, 0.17), M["cream_light"], 8,
                      (0, math.pi / 2, 0)),
    ]
    return parent(root, *parts)


def build_pan():
    root = make_root("pan")
    parts = [
        # 팬 바닥의 원점을 화구 중심에 둔다. 손잡이 때문에 몸체를 뒤로 밀면
        # 루트가 화구 중앙에 있어도 팬 바닥이 옆으로 벗어나 보인다.
        clay_cone("panBody", 0.225, 0.290, 0.085, (0, 0, 0.050), M["charcoal"], 10),
        clay_cylinder("panFoot", 0.205, 0.020, (0, 0, 0.015), M["teal_dark"], 10),
        clay_torus("panRim", 0.275, 0.022, (0, 0, 0.086), M["steel"]),
        clay_cylinder("panInside", 0.235, 0.018, (0, 0, 0.085), M["charcoal"], 10),
        clay_box("panHandle", (0.075, 0.42, 0.055), (0, 0.42, 0.072), M["wood"], 0.025),
        clay_box("panGripEnd", (0.10, 0.14, 0.065), (0, 0.58, 0.072), M["wood_light"], 0.030),
        clay_box("panCollar", (0.11, 0.11, 0.065), (0, 0.245, 0.072), M["steel"], 0.025),
    ]
    return parent(root, *parts)


def build_counter():
    root = make_root("counter")
    parts = [
        clay_box("counterBody", (0.92, 0.92, 0.86), (0, 0, 0.51), M["teal"], 0.065),
        clay_box("counterTop", (1.00, 1.00, 0.13), (0, 0, 0.975), M["wood_light"], 0.050),
        clay_box("counterPlinth", (0.78, 0.80, 0.10), (0, 0.04, 0.05), M["teal_dark"], 0.030),
        clay_box("counterDoor", (0.72, 0.045, 0.58), (0, -0.475, 0.53), M["teal_dark"], 0.030),
        clay_box("counterDoorInset", (0.58, 0.025, 0.42), (0, -0.503, 0.53), M["teal"], 0.020),
        clay_cylinder("counterHandle", 0.025, 0.22, (0.25, -0.53, 0.63),
                      M["cream_light"], 8, (math.pi / 2, 0, 0)),
    ]
    return parent(root, *parts)


def build_cabinet():
    root = make_root("cabinet")
    parts = [
        clay_box("cabinetBody", (0.84, 0.92, 0.52), (0, 0, 0.34), M["teal_dark"], 0.055),
        clay_box("cabinetTop", (0.90, 1.00, 0.12), (0, 0, 0.61), M["wood_light"], 0.045),
        clay_box("cabinetPlinth", (0.72, 0.78, 0.08), (0, 0.04, 0.04), M["charcoal"], 0.025),
        clay_box("cabinetDoorL", (0.35, 0.045, 0.38), (-0.20, -0.475, 0.34), M["teal"], 0.025),
        clay_box("cabinetDoorR", (0.35, 0.045, 0.38), (0.20, -0.475, 0.34), M["teal"], 0.025),
        clay_cylinder("cabinetHandleL", 0.020, 0.15, (-0.07, -0.515, 0.39),
                      M["cream_light"], 8, (math.pi / 2, 0, 0)),
        clay_cylinder("cabinetHandleR", 0.020, 0.15, (0.07, -0.515, 0.39),
                      M["cream_light"], 8, (math.pi / 2, 0, 0)),
    ]
    return parent(root, *parts)


def build_cooker():
    root = make_root("cooker")
    base_parts = [
        clay_box("cookerCabinet", (1.22, 2.02, 0.90), (0, 0, 0.45), M["cream"], 0.070),
        clay_box("cookerCounterTop", (1.30, 2.10, 0.13), (0, 0, 0.965), M["wood_light"], 0.050),
        clay_box("cookerDoorL", (0.48, 0.045, 0.56), (-0.28, -1.035, 0.48), M["teal_dark"], 0.025),
        clay_box("cookerDoorR", (0.48, 0.045, 0.56), (0.28, -1.035, 0.48), M["teal_dark"], 0.025),
        clay_box("cookerPlinth", (1.06, 1.78, 0.09), (0, 0.06, 0.045), M["charcoal"], 0.025),
    ]
    parent(root, *base_parts)

    body = clay_cylinder("cookerBody", 0.36, 0.32, (0, -0.10, 1.16), M["cream_light"], 12)
    body.parent = root
    face = clay_box("cookerFace", (0.28, 0.045, 0.14), (0, -0.365, 0.00), M["charcoal"], 0.025)
    face.parent = body
    screen = clay_box("cookerScreen", (0.19, 0.020, 0.07), (0, -0.397, 0.01), M["screen"], 0.014)
    screen.parent = body
    for x in (-0.37, 0.37):
        handle = clay_box("cookerHandle", (0.11, 0.16, 0.07), (x, 0, 0.00), M["teal_dark"], 0.030)
        handle.parent = body

    # world.js drives lid.position.y between 0.27 and a tiny bobbing offset.
    # In Blender that local vertical axis is z; glTF exports it as Three.js y.
    lid = clay_cylinder("lid", 0.37, 0.10, (0, 0, 0.27), M["cream"], 12)
    lid.parent = body
    lid_band = clay_torus("lidBand", 0.33, 0.018, (0, 0, 0.00), M["steel"])
    lid_band.parent = lid
    vent = clay_cylinder("steamVent", 0.045, 0.055, (0, 0, 0.075), M["teal_dark"], 8)
    vent.parent = lid
    return root


def build_board():
    root = make_root("board")
    parts = [
        clay_box("boardSlab", (1.00, 0.80, 0.055), (0, 0, 0), M["wood_light"], 0.045),
        clay_box("grooveFront", (0.82, 0.018, 0.010), (0, -0.31, 0.032), M["wood"], 0.006),
        clay_box("grooveBack", (0.82, 0.018, 0.010), (0, 0.31, 0.032), M["wood"], 0.006),
        clay_box("grooveLeft", (0.018, 0.60, 0.010), (-0.41, 0, 0.032), M["wood"], 0.006),
        clay_box("grooveRight", (0.018, 0.60, 0.010), (0.41, 0, 0.032), M["wood"], 0.006),
        clay_cylinder("boardHole", 0.045, 0.012, (-0.40, 0.29, 0.034), M["charcoal"], 10),
    ]
    return parent(root, *parts)


def build_mat():
    root = make_root("mat")
    parts = []
    for index in range(11):
        y = -0.33 + index * 0.066
        parts.append(clay_cylinder("bambooRod%02d" % (index + 1), 0.026, 0.68,
                                   (0, y, 0), M["wood_light"], 8,
                                   (0, math.pi / 2, 0)))
    for x in (-0.24, 0.24):
        parts.append(clay_box("bindingCord", (0.025, 0.70, 0.035),
                              (x, 0, 0.018), M["wood"], 0.010))
    # The rods themselves are built on the rotated axis.  This preserves the
    # exact square bounds instead of combining a root rotation with anisotropic
    # export normalization.
    return parent(root, *parts)


def build_bin():
    root = make_root("bin")
    parts = [
        clay_cone("binBody", 0.34, 0.43, 0.86, (0, 0, 0.46), M["green"], 12),
        clay_torus("binRim", 0.43, 0.030, (0, 0, 0.89), M["green_dark"]),
        clay_cylinder("binLid", 0.45, 0.08, (0, 0, 0.96), M["green_dark"], 12),
        clay_box("binLidGrip", (0.25, 0.12, 0.07), (0, 0, 1.015), M["charcoal"], 0.030),
        clay_box("binPedal", (0.30, 0.20, 0.07), (0, -0.46, 0.06), M["charcoal"], 0.030),
        clay_box("pedalLink", (0.045, 0.055, 0.62), (0, -0.36, 0.36), M["steel"], 0.018),
    ]
    return parent(root, *parts)


def build_fridge():
    root = make_root("fridge")
    parts = [
        # The ingredient samples are spawned by world.js; this model supplies
        # the open refrigerated shell and ten readable cubbies.
        clay_box("fridgeBase", (1.15, 5.90, 1.00), (0, 0, 0.50), M["teal_dark"], 0.070),
        clay_box("fridgeBack", (0.16, 5.72, 1.76), (-0.495, 0, 1.88), M["charcoal"], 0.035),
        clay_box("fridgeTop", (1.15, 5.90, 0.18), (0, 0, 2.81), M["cream"], 0.055),
        clay_box("middleShelf", (1.05, 5.90, 0.12), (0.05, 0, 1.94), M["steel"], 0.035),
        clay_box("lowerShelfLip", (1.05, 5.90, 0.10), (0.05, 0, 1.02), M["steel"], 0.030),
        clay_box("fridgeEndL", (1.05, 0.12, 1.84), (0.05, -2.89, 1.91), M["teal"], 0.040),
        clay_box("fridgeEndR", (1.05, 0.12, 1.84), (0.05, 2.89, 1.91), M["teal"], 0.040),
    ]
    for index, y in enumerate((-1.77, -0.59, 0.59, 1.77)):
        parts.append(clay_box("cubbyDivider%02d" % (index + 1), (1.02, 0.085, 1.80),
                              (0.06, y, 1.91), M["teal"], 0.025))
    # A chunky cold-air rail across the top gives the long fixture a clear cap.
    parts.extend([
        clay_box("coldRail", (0.22, 5.50, 0.12), (0.45, 0, 2.69), M["cream_light"], 0.030),
        clay_cylinder("statusLamp", 0.055, 0.035, (0.585, 0, 2.69), M["screen"], 8,
                      (0, math.pi / 2, 0)),
    ])
    return parent(root, *parts)


def build_broom():
    root = make_root("broom")
    parts = [
        clay_cylinder("broomHandle", 0.033, 1.30, (0, 0, 0.13), M["wood_light"], 8),
        clay_box("broomCollar", (0.20, 0.12, 0.10), (0, 0, -0.55), M["teal_dark"], 0.030),
        clay_box("broomHead", (0.33, 0.14, 0.10), (0, 0, -0.62), M["wood"], 0.035),
    ]
    for index, x in enumerate((-0.135, -0.09, -0.045, 0, 0.045, 0.09, 0.135)):
        parts.append(clay_box("bristle%02d" % (index + 1), (0.032, 0.11, 0.19),
                              (x, 0, -0.75), M["cream"], 0.012,
                              (0, (-0.10 + index * 0.033), 0)))
    return parent(root, *parts)


def build_knife():
    root = make_root("knife")
    blade = clay_prism("knifeBlade",
                       [(-0.055, -0.29), (0.055, -0.25), (0.050, 0.105), (-0.040, 0.105)],
                       0.032, (0, 0, 0), M["cream_light"])
    parts = [
        blade,
        clay_box("knifeSpine", (0.022, 0.38, 0.038), (-0.043, -0.075, 0.010),
                 M["steel"], 0.008),
        clay_box("knifeBolster", (0.095, 0.055, 0.050), (0, 0.125, 0.025),
                 M["steel"], 0.015),
        clay_box("knifeHandle", (0.075, 0.18, 0.050), (0, 0.215, 0.025),
                 M["wood"], 0.025),
        clay_cylinder("knifeRivet1", 0.012, 0.055, (0, 0.185, 0.025), M["cream_light"], 8,
                      (0, math.pi / 2, 0)),
        clay_cylinder("knifeRivet2", 0.012, 0.055, (0, 0.245, 0.025), M["cream_light"], 8,
                      (0, math.pi / 2, 0)),
    ]
    return parent(root, *parts)


BUILDERS = {
    "sink": build_sink,
    "stove": build_stove,
    "table": build_table,
    "pot": build_pot,
    "pan": build_pan,
    "counter": build_counter,
    "cabinet": build_cabinet,
    "cooker": build_cooker,
    "board": build_board,
    "mat": build_mat,
    "bin": build_bin,
    "fridge": build_fridge,
    "broom": build_broom,
    "knife": build_knife,
}

# Three.js contract dimensions in metres: width (x), height (y), depth (z).
# Blender uses x, y(depth), z(height), so export_asset remaps these axes before
# scaling the root.  Keeping the contract here makes the approval GLBs usable in
# the game without a second, hidden scale correction.
TARGET_SIZE = {
    "sink": (1.30, 1.45, 1.70),
    "stove": (1.30, 1.10, 6.80),
    "table": (1.00, 0.67, 1.50),
    "pot": (0.60, 0.30, 0.54),
    "pan": (0.60, 0.10, 0.90),
    "counter": (1.00, 1.04, 1.00),
    "cabinet": (0.90, 0.67, 1.00),
    "cooker": (1.30, 1.45, 2.10),
    "board": (1.05, 0.07, 0.85),
    "mat": (0.72, 0.06, 0.72),
    "bin": (0.95, 1.02, 0.95),
    "fridge": (1.15, 2.90, 5.90),
    "broom": (0.34, 1.60, 0.14),
    "knife": (0.12, 0.05, 0.58),
}

CENTER_ORIGIN = {"board", "mat", "broom"}
REQUIRED_PARTS = {"pot": {"water"}, "cooker": {"lid"}}


def hierarchy(root):
    result = [root]
    stack = list(root.children)
    while stack:
        obj = stack.pop()
        result.append(obj)
        stack.extend(obj.children)
    return result


def bounds(root):
    points = []
    for obj in hierarchy(root):
        if obj.type == "MESH":
            points.extend(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)
    lo = Vector(tuple(min(point[i] for point in points) for i in range(3)))
    hi = Vector(tuple(max(point[i] for point in points) for i in range(3)))
    return lo, hi


def export_asset(name, builder):
    reset()
    root = builder()
    # Parenting nested parts (notably cookerBody > lid) dirties world matrices.
    # Update before measuring so normalization uses the exported hierarchy, not
    # the stale pre-parent locations.
    bpy.context.view_layer.update()
    lo, hi = bounds(root)
    current = hi - lo
    target_three = TARGET_SIZE[name]
    target_blender = Vector((target_three[0], target_three[2], target_three[1]))
    root.scale = tuple(target_blender[i] / current[i] for i in range(3))
    bpy.context.view_layer.update()
    lo, hi = bounds(root)
    # Snap the declared origin after scale normalization.  This avoids tiny
    # bevel/pedal offsets leaving floor assets visibly floating.
    if name in CENTER_ORIGIN:
        root.location.z -= (lo.z + hi.z) * 0.5
    else:
        root.location.z -= lo.z
    bpy.context.view_layer.update()
    lo, hi = bounds(root)
    names = {obj.name for obj in hierarchy(root)}
    if name in CENTER_ORIGIN:
        center_z = (lo.z + hi.z) * 0.5
        if abs(center_z) > 0.01:
            raise RuntimeError(f"{name}: centre origin mismatch, center z={center_z:.4f}")
    elif lo.z < -0.005 or lo.z > 0.03:
        raise RuntimeError(f"{name}: ground origin mismatch, min z={lo.z:.4f}")
    missing = REQUIRED_PARTS.get(name, set()) - names
    if missing:
        raise RuntimeError(f"{name}: required nodes missing: {', '.join(sorted(missing))}")

    bpy.ops.object.select_all(action="DESELECT")
    for obj in hierarchy(root):
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    path = OUT / f"{name}.glb"
    bpy.ops.export_scene.gltf(
        filepath=str(path), export_format="GLB", use_selection=True,
        export_apply=False, export_yup=True, export_materials="EXPORT",
        export_cameras=False, export_lights=False,
    )
    size = hi - lo
    print(f"[clay-pilot] {name}: bounds=({size.x:.3f}, {size.z:.3f}, {size.y:.3f}), "
          f"ground={lo.z:.3f}, nodes={len(names)} -> {path.relative_to(PROJECT)}")


def import_for_preview(name, position, rotation=0.0):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(OUT / f"{name}.glb"))
    imported = list(set(bpy.data.objects) - before)
    tops = [obj for obj in imported if obj.parent is None]
    holder = make_root("preview_" + name)
    for obj in tops:
        obj.parent = holder
    holder.location = position
    holder.scale = (1.0, 1.0, 1.0)
    holder.rotation_euler.z = rotation
    return holder


def look_at(camera, target):
    camera.rotation_euler = (Vector(target) - camera.location).to_track_quat("-Z", "Y").to_euler()


def render_preview():
    reset()
    # Every model is shown at its exported 1:1 metre scale.  The vessels sit at
    # the same height used by world.js so their relationship to the burners is
    # visible rather than being enlarged into catalogue icons.
    import_for_preview("stove", (0.0, 1.35, 0), math.pi / 2)
    import_for_preview("pot", (-1.36, 1.35, 1.14))
    import_for_preview("pan", (1.36, 1.35, 1.14), math.pi)
    import_for_preview("sink", (-3.75, -1.55, 0))
    import_for_preview("table", (3.55, -1.55, 0))

    clay_box("previewFloor", (12, 8, 0.08), (0, 0.2, -0.08),
             material("preview_floor", (0.72, 0.65, 0.53, 1), 0.96), 0.02)

    # One-metre reference post: five 20 cm bands make the absolute scale legible.
    for index in range(5):
        clay_box("scaleBand%02d" % (index + 1), (0.10, 0.10, 0.20),
                 (-5.20, -1.55, 0.10 + index * 0.20),
                 M["cream_light" if index % 2 == 0 else "charcoal"], 0.012)

    bpy.ops.object.light_add(type="AREA", location=(-4, -4, 8))
    key = bpy.context.object
    key.name = "softKey"
    key.data.energy = 1050
    key.data.shape = "DISK"
    key.data.size = 5.0
    key.data.color = (1.0, 0.82, 0.64)

    bpy.ops.object.light_add(type="AREA", location=(5, 1, 5))
    fill = bpy.context.object
    fill.name = "softFill"
    fill.data.energy = 700
    fill.data.size = 4.0
    fill.data.color = (0.63, 0.82, 1.0)

    bpy.ops.object.camera_add(location=(9.4, -12.8, 8.0))
    camera = bpy.context.object
    camera.data.lens = 54
    look_at(camera, (0, 0.15, 0.72))
    bpy.context.scene.camera = camera

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1400
    scene.render.resolution_y = 800
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(PREVIEW)
    scene.render.film_transparent = False
    scene.world = bpy.data.worlds.new("clayPilotWorld")
    scene.world.color = (0.055, 0.042, 0.030)
    scene.view_settings.look = "AgX - Medium High Contrast"
    bpy.ops.render.render(write_still=True)
    print("[clay-pilot] preview ->", PREVIEW.relative_to(PROJECT))


def render_secondary_preview():
    reset()
    import_for_preview("counter", (-3.25, 0.95, 0))
    import_for_preview("board", (-3.25, 0.95, 1.075))
    import_for_preview("cabinet", (-1.65, 0.95, 0))
    import_for_preview("mat", (-1.65, 0.95, 0.70))
    import_for_preview("cooker", (0.65, 0.95, 0))
    import_for_preview("bin", (3.05, 0.95, 0))

    clay_box("previewFloor", (9.5, 6.2, 0.08), (0, 0.35, -0.08),
             material("preview_floor", (0.72, 0.65, 0.53, 1), 0.96), 0.02)
    for index in range(5):
        clay_box("scaleBand%02d" % (index + 1), (0.10, 0.10, 0.20),
                 (-4.15, 0.95, 0.10 + index * 0.20),
                 M["cream_light" if index % 2 == 0 else "charcoal"], 0.012)

    bpy.ops.object.light_add(type="AREA", location=(-4, -4, 8))
    key = bpy.context.object
    key.name = "softKey"
    key.data.energy = 1050
    key.data.shape = "DISK"
    key.data.size = 5.0
    key.data.color = (1.0, 0.82, 0.64)

    bpy.ops.object.light_add(type="AREA", location=(5, 1, 5))
    fill = bpy.context.object
    fill.name = "softFill"
    fill.data.energy = 700
    fill.data.size = 4.0
    fill.data.color = (0.63, 0.82, 1.0)

    bpy.ops.object.camera_add(location=(8.2, -10.8, 6.7))
    camera = bpy.context.object
    camera.data.lens = 56
    look_at(camera, (-0.25, 0.40, 0.70))
    bpy.context.scene.camera = camera

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1400
    scene.render.resolution_y = 800
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(PREVIEW_NEXT)
    scene.render.film_transparent = False
    scene.world = bpy.data.worlds.new("claySecondaryWorld")
    scene.world.color = (0.055, 0.042, 0.030)
    scene.view_settings.look = "AgX - Medium High Contrast"
    bpy.ops.render.render(write_still=True)
    print("[clay-pilot] secondary preview ->", PREVIEW_NEXT.relative_to(PROJECT))


def render_tools_preview():
    reset()
    # Fridge faces +X in the game.  The camera is also on +X here so all ten
    # cubbies are reviewed from the same side players use.
    import_for_preview("fridge", (-0.65, 0.85, 0))
    import_for_preview("counter", (3.05, -1.90, 0))
    import_for_preview("knife", (3.05, -1.90, 1.04))
    import_for_preview("broom", (2.25, 0.95, 0.80))

    clay_box("previewFloor", (10.5, 8.0, 0.08), (0, 0.35, -0.08),
             material("preview_floor", (0.72, 0.65, 0.53, 1), 0.96), 0.02)
    for index in range(5):
        clay_box("scaleBand%02d" % (index + 1), (0.10, 0.10, 0.20),
                 (-3.65, -2.10, 0.10 + index * 0.20),
                 M["cream_light" if index % 2 == 0 else "charcoal"], 0.012)

    bpy.ops.object.light_add(type="AREA", location=(-4, -4, 8))
    key = bpy.context.object
    key.name = "softKey"
    key.data.energy = 1150
    key.data.shape = "DISK"
    key.data.size = 5.5
    key.data.color = (1.0, 0.82, 0.64)

    bpy.ops.object.light_add(type="AREA", location=(5, 1, 6))
    fill = bpy.context.object
    fill.name = "softFill"
    fill.data.energy = 760
    fill.data.size = 4.0
    fill.data.color = (0.63, 0.82, 1.0)

    bpy.ops.object.camera_add(location=(9.2, -12.5, 7.3))
    camera = bpy.context.object
    camera.data.lens = 57
    look_at(camera, (-0.15, 0.15, 1.25))
    bpy.context.scene.camera = camera

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1400
    scene.render.resolution_y = 800
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(PREVIEW_THIRD)
    scene.render.film_transparent = False
    scene.world = bpy.data.worlds.new("clayToolsWorld")
    scene.world.color = (0.055, 0.042, 0.030)
    scene.view_settings.look = "AgX - Medium High Contrast"
    bpy.ops.render.render(write_still=True)
    print("[clay-pilot] tools preview ->", PREVIEW_THIRD.relative_to(PROJECT))


for asset_name, asset_builder in BUILDERS.items():
    export_asset(asset_name, asset_builder)
render_preview()
render_secondary_preview()
render_tools_preview()
print("[clay-pilot] complete; runtime manifest unchanged")
