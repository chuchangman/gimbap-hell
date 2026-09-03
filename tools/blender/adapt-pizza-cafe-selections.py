"""Adapt selected Pizza Cafe pack models to Gimbap Hell's asset contracts."""

from __future__ import annotations

import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


# Source path, destination path, desired glTF dimensions (x, y-up height, z).
# None keeps the source pack's natural size for runtime modular tiling.
SELECTIONS = (
    ("furniture/sink.glb", "station/sink.glb", (1.30, 1.45, 1.70), "sink"),
    ("furniture/cabinet3.glb", "station/cabinet.glb", None, "cabinet"),
    ("kitchenware/knife.glb", "item/knife.glb", (0.117, 0.052, 0.58), "knife"),
    ("kitchenware/chopping-board.glb", "station/board.glb", (1.05, 0.07, 0.85), "board"),
    ("furniture/kitchen-table.glb", "station/table.glb", None, "table"),
)


def arguments() -> tuple[Path, Path]:
    if "--" not in sys.argv:
        raise SystemExit("Expected: -- <pizza-cafe-pack-directory> <public-assets-directory>")
    args = sys.argv[sys.argv.index("--") + 1 :]
    if len(args) != 2:
        raise SystemExit("Expected: -- <pizza-cafe-pack-directory> <public-assets-directory>")
    return Path(args[0]).resolve(), Path(args[1]).resolve()


def bounds(objects: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    corners = [obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
    low = Vector(tuple(min(v[i] for v in corners) for i in range(3)))
    high = Vector(tuple(max(v[i] for v in corners) for i in range(3)))
    return low, high


def adapt(source: Path, destination: Path, target: tuple[float, float, float] | None, node_name: str) -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(source))
    meshes = [obj for obj in bpy.data.objects if obj.type == "MESH"]
    if not meshes:
        raise RuntimeError(f"No mesh in {source}")

    low, high = bounds(meshes)
    current = high - low
    # Blender is Z-up after import; glTF's (x, y, z) maps to Blender (x, z, y).
    desired = current if target is None else Vector((target[0], target[2], target[1]))
    scale = Vector(tuple(desired[i] / current[i] for i in range(3)))

    center = Vector(((low.x + high.x) / 2, (low.y + high.y) / 2, low.z))
    transform = Matrix.Diagonal((*scale, 1.0)) @ Matrix.Translation(-center)

    # The selected pack files contain a single mesh, but this also keeps working
    # if a later version splits a model into multiple mesh nodes.
    for obj in meshes:
        obj.data.transform(transform @ obj.matrix_world)
        obj.matrix_world = Matrix.Identity(4)
        obj.name = node_name

    for obj in bpy.context.selected_objects:
        obj.select_set(False)
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]

    destination.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(destination),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_materials="EXPORT",
    )
    print(f"{source.name} -> {destination}")


def main() -> None:
    pack_root, assets_root = arguments()
    for source_rel, destination_rel, target, node_name in SELECTIONS:
        adapt(pack_root / source_rel, assets_root / destination_rel, target, node_name)


if __name__ == "__main__":
    main()
