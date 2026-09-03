"""Render shadowless catalog previews for every raw and processed food GLB."""

from pathlib import Path

import bpy
from mathutils import Vector


PROJECT = Path(__file__).resolve().parents[2]
ASSET_ROOT = PROJECT / "public" / "assets"
RAW = (
    "raw/danmuji", "raw/ham", "raw/egg", "raw/cucumber",
    "raw/spinach", "raw/carrot", "raw/fishcake", "item/gim",
)
FILL = (
    "fill/danmuji", "fill/ham", "fill/egg", "fill/crab",
    "fill/cucumber", "fill/spinach", "fill/carrot", "fill/fishcake",
)


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def bounds(objects):
    points = [obj.matrix_world @ Vector(corner) for obj in objects
              if obj.type == "MESH" for corner in obj.bound_box]
    return Vector(map(min, zip(*points))), Vector(map(max, zip(*points)))


def render_catalog(names, output_name, fill_mode=False):
    clear_scene()
    columns = 4
    for index, name in enumerate(names):
        before = set(bpy.context.scene.objects)
        bpy.ops.import_scene.gltf(filepath=str(ASSET_ROOT / f"{name}.glb"))
        imported = list(set(bpy.context.scene.objects) - before)
        meshes = [obj for obj in imported if obj.type == "MESH"]
        lo, hi = bounds(meshes)
        size = hi - lo
        target = 1.32 if not fill_mode else 1.12
        scale = target / max(size.x, size.y, size.z)

        root = bpy.data.objects.new(f"preview_{name.replace('/', '_')}", None)
        bpy.context.collection.objects.link(root)
        for obj in imported:
            if obj.parent is None:
                obj.parent = root
        root.scale = (scale,) * 3
        row, col = divmod(index, columns)
        x = (col - 1.5) * 2.15
        z = (0.5 - row) * 2.05
        root.location = (x - (lo.x + hi.x) * .5 * scale,
                         -(lo.y + hi.y) * .5 * scale,
                         z - (lo.z + hi.z) * .5 * scale)

    bpy.ops.object.camera_add(location=(0, -12.5, 1.8))
    camera = bpy.context.object
    camera.rotation_euler = (Vector((0,0,0)) - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 8.8
    bpy.context.scene.camera = camera

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.studio_light = "paint.sl"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.show_shadows = False
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = "WORLD"
    scene.display.shading.curvature_ridge_factor = 1.15
    scene.display.shading.curvature_valley_factor = .55
    scene.display.shading.background_type = "VIEWPORT"
    scene.display.shading.background_color = (.045,.055,.065)
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(PROJECT / output_name)
    scene.render.film_transparent = False
    bpy.ops.render.render(write_still=True)
    print(f"CATALOG_RENDERED {scene.render.filepath}")


render_catalog(RAW, "food-raw-preview.png")
render_catalog(FILL, "food-fill-preview.png", fill_mode=True)
