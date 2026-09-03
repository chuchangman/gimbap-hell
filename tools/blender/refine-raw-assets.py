"""Blender 후처리: JS 생성기가 만든 원물 GLB에 실제 베벨과 법선 보정을 적용한다.

Blender MCP의 execute_blender_code에서 이 파일을 실행하거나 Blender GUI/CLI에서
직접 실행할 수 있다. 원점, 크기, 노드 이름과 재질 색은 유지한다.
"""

import math
import os
import sys
from pathlib import Path

import bpy


PROJECT = Path(__file__).resolve().parents[2]
RAW_DIR = PROJECT / "public" / "assets" / "raw"
ASSETS = (
    "danmuji",
    "ham",
    "egg",
    "cucumber",
    "spinach",
    "carrot",
    "fishcake",
)

if "--" in sys.argv:
    requested = tuple(sys.argv[sys.argv.index("--") + 1:])
    if requested:
        unknown = sorted(set(requested) - set(ASSETS))
        if unknown:
            raise SystemExit(f"Unknown raw assets: {', '.join(unknown)}")
        ASSETS = requested

BEVEL_TOKENS = (
    "ham", "fishcake", "surface", "edge", "marble", "layer", "leaf",
    "cut_", "ridge", "tie",
)


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials,
                       bpy.data.cameras, bpy.data.lights):
        for block in list(datablocks):
            if block.users == 0:
                datablocks.remove(block)


def material_finish(material, asset_name):
    """색은 그대로 두고 음식 종류에 맞는 반사 강도만 다듬는다."""
    material.use_nodes = True
    principled = material.node_tree.nodes.get("Principled BSDF")
    if principled is None:
        return

    roughness = {
        "egg": 0.78,
        "cucumber": 0.67,
        "danmuji": 0.72,
        "ham": 0.76,
        "spinach": 0.82,
        "carrot": 0.79,
        "fishcake": 0.74,
    }[asset_name]
    if "Roughness" in principled.inputs:
        principled.inputs["Roughness"].default_value = roughness
    if "Metallic" in principled.inputs:
        principled.inputs["Metallic"].default_value = 0.0
    if "IOR" in principled.inputs:
        principled.inputs["IOR"].default_value = 1.38


def refine_mesh(obj, asset_name):
    dims = [abs(v) for v in obj.dimensions if abs(v) > 1e-6]
    if not dims:
        return

    smallest = min(dims)
    lower_name = obj.name.lower()
    needs_bevel = any(token in lower_name for token in BEVEL_TOKENS)
    # 이미 둥근 계란·오이·당근 몸통에는 베벨을 다시 걸지 않는다. 회전체의
    # 삼각형 극점까지 깎으면 셰이딩이 움푹 파여 보이기 때문이다.
    if needs_bevel and smallest >= 0.004:
        bevel = obj.modifiers.new(name="Food edge bevel", type="BEVEL")
        bevel.width = min(0.006, max(0.00035, smallest * 0.105))
        bevel.segments = 2
        bevel.limit_method = "ANGLE"
        bevel.angle_limit = math.radians(38)
        bevel.affect = "EDGES"
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        try:
            bpy.ops.object.modifier_apply(modifier=bevel.name)
        except RuntimeError:
            obj.modifiers.remove(bevel)
        obj.select_set(False)

    for material in obj.data.materials:
        if material:
            material_finish(material, asset_name)


def export_asset(asset_name):
    source = RAW_DIR / f"{asset_name}.glb"
    temporary = RAW_DIR / f".{asset_name}.blender.glb"
    clear_scene()
    bpy.ops.import_scene.gltf(filepath=str(source))

    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    for obj in meshes:
        refine_mesh(obj, asset_name)

    bpy.ops.export_scene.gltf(
        filepath=str(temporary),
        export_format="GLB",
        use_selection=False,
        export_apply=True,
        export_normals=True,
        export_materials="EXPORT",
        export_yup=True,
    )
    os.replace(temporary, source)

    vertices = sum(len(obj.data.vertices) for obj in meshes)
    polygons = sum(len(obj.data.polygons) for obj in meshes)
    print(f"BLENDER_REFINED {asset_name}: {len(meshes)} meshes, {vertices} vertices, {polygons} polygons")


for name in ASSETS:
    export_asset(name)

clear_scene()
print(f"BLENDER_REFINED_DONE {len(ASSETS)}")
