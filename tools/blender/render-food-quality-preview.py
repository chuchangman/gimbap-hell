"""햄·어묵·쌀·밥 GLB를 그림자 없이 한 장으로 확인하는 Blender 프리뷰."""

from pathlib import Path

import bpy
from mathutils import Vector


PROJECT = Path(__file__).resolve().parents[2]
OUT = PROJECT / "food-quality-preview.png"
ASSETS = (
    ("HAM", PROJECT / "public/assets/raw/ham.glb"),
    ("FISHCAKE", PROJECT / "public/assets/raw/fishcake.glb"),
    ("RICE", PROJECT / "public/assets/item/rice.glb"),
    ("COOKED RICE", PROJECT / "public/assets/item/bap.glb"),
)


bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)


def bounds(objects):
    points = [obj.matrix_world @ Vector(corner) for obj in objects if obj.type == "MESH" for corner in obj.bound_box]
    return Vector(map(min, zip(*points))), Vector(map(max, zip(*points)))


for index, (label, path) in enumerate(ASSETS):
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    imported = list(set(bpy.context.scene.objects) - before)
    meshes = [obj for obj in imported if obj.type == "MESH"]
    if label == "RICE":
        for obj in imported:
            if obj.name.lower() == "water":
                obj.hide_render = True
    lo, hi = bounds(meshes)
    size = hi - lo
    scale = 1.55 / max(size.x, size.y, size.z)

    root = bpy.data.objects.new(f"preview_{label}", None)
    bpy.context.collection.objects.link(root)
    for obj in imported:
        if obj.parent is None:
            obj.parent = root
    root.scale = (scale,) * 3
    target_x = (index - 1.5) * 2.05
    root.location = (target_x - (lo.x + hi.x) * .5 * scale,
                     -(lo.y + hi.y) * .5 * scale,
                     -lo.z * scale)

    bpy.ops.object.text_add(location=(target_x, .72, -.12))
    text = bpy.context.object
    text.data.body = label
    text.data.align_x = "CENTER"
    text.data.size = .23
    text.data.extrude = 0
    text.rotation_euler = (0, 0, 0)


bpy.ops.mesh.primitive_plane_add(size=20, location=(0, 0, -.03))
ground = bpy.context.object
material = bpy.data.materials.new("preview_ground")
material.diffuse_color = (.055, .065, .075, 1)
ground.data.materials.append(material)

bpy.ops.object.camera_add(location=(0, -12.2, 6.7))
camera = bpy.context.object
direction = Vector((0, 0, .6)) - camera.location
camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
camera.data.lens = 58
bpy.context.scene.camera = camera

scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "STUDIO"
scene.display.shading.studio_light = "paint.sl"
scene.display.shading.color_type = "MATERIAL"
scene.display.shading.show_shadows = False
scene.display.shading.show_cavity = True
scene.display.shading.cavity_type = "WORLD"
scene.display.shading.curvature_ridge_factor = 1.1
scene.display.shading.curvature_valley_factor = .6
scene.display.shading.background_type = "VIEWPORT"
scene.display.shading.background_color = (.055, .065, .075)
scene.render.resolution_x = 1600
scene.render.resolution_y = 520
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = str(OUT)
scene.render.film_transparent = False
bpy.ops.render.render(write_still=True)
print(f"PREVIEW_RENDERED {OUT}")
