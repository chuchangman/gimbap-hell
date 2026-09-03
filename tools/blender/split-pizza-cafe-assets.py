"""Split Voloshka's Pizza Cafe FBX pack into game-ready individual GLBs.

Run with Blender in background mode:
  blender --background --python tools/blender/split-pizza-cafe-assets.py -- \
    assets-src/pizza-cafe/PizzaAssets.fbx public/assets/packs/pizza-cafe

The FBX lays every asset out on a catalogue grid.  Each exported GLB is moved to
the origin and grounded so it can be placed independently in Three.js.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def cli_paths() -> tuple[Path, Path]:
    if "--" not in sys.argv:
        raise SystemExit("Expected: -- <input.fbx> <output-directory>")
    args = sys.argv[sys.argv.index("--") + 1 :]
    if len(args) != 2:
        raise SystemExit("Expected: -- <input.fbx> <output-directory>")
    return Path(args[0]).resolve(), Path(args[1]).resolve()


def slugify(name: str) -> str:
    clean = name.strip().rstrip(".")
    clean = re.sub(r"([a-z0-9])([A-Z])", r"\1-\2", clean)
    clean = re.sub(r"[^A-Za-z0-9]+", "-", clean)
    return clean.strip("-").lower()


def category_for(name: str) -> str:
    architecture = (
        "Door",
        "Floor",
        "PanoramicWindow",
        "Tiles",
        "Wall",
        "Window",
    )
    furniture = (
        "CabinerCorner",  # Typo in the original FBX object name.
        "Cabinet",
        "Chair",
        "Computer",
        "CounterTable",
        "Fridge",
        "Hanger",
        "HighCabinet",
        "KitchenTable",
        "Oven",
        "Plant",
        "Sink",
        "Table",
    )
    kitchenware = (
        "ChoppingBoard",
        "CleanPlates",
        "DirtyPlates",
        "Knife",
        "Napkin",
        "PaperTowel",
        "Plate",
        "RollingPin",
        "Sauce",
    )
    packaging = ("Box", "Boxes", "PizzaBox", "PizzaBoxes")

    if name.startswith(architecture):
        return "architecture"
    if name.startswith(furniture):
        return "furniture"
    if name.startswith(kitchenware):
        return "kitchenware"
    if name.startswith(packaging):
        return "packaging"
    return "food"


def world_corners(obj: bpy.types.Object) -> list[Vector]:
    return [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]


def make_export_copy(source: bpy.types.Object) -> tuple[bpy.types.Object, tuple[float, float, float]]:
    corners = world_corners(source)
    min_x = min(v.x for v in corners)
    max_x = max(v.x for v in corners)
    min_y = min(v.y for v in corners)
    max_y = max(v.y for v in corners)
    min_z = min(v.z for v in corners)
    max_z = max(v.z for v in corners)

    # Bake the imported FBX's centimetre scale and axis conversion into the mesh.
    mesh = source.data.copy()
    mesh.transform(source.matrix_world)
    mesh.transform(
        __import__("mathutils").Matrix.Translation(
            Vector((-(min_x + max_x) / 2, -(min_y + max_y) / 2, -min_z))
        )
    )

    obj = bpy.data.objects.new(source.name.strip().rstrip("."), mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj, (max_x - min_x, max_z - min_z, max_y - min_y)


def export_one(source: bpy.types.Object, output_file: Path) -> tuple[float, float, float]:
    for obj in bpy.context.selected_objects:
        obj.select_set(False)

    export_obj, gltf_dimensions = make_export_copy(source)
    export_obj.select_set(True)
    bpy.context.view_layer.objects.active = export_obj

    bpy.ops.export_scene.gltf(
        filepath=str(output_file),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_materials="EXPORT",
    )

    bpy.data.objects.remove(export_obj, do_unlink=True)
    return gltf_dimensions


def main() -> None:
    input_fbx, output_root = cli_paths()
    if not input_fbx.is_file():
        raise SystemExit(f"FBX not found: {input_fbx}")

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=str(input_fbx))

    sources = sorted(
        (obj for obj in bpy.data.objects if obj.type == "MESH"),
        key=lambda obj: obj.name.lower(),
    )
    if not sources:
        raise SystemExit("No mesh objects found in FBX")

    output_root.mkdir(parents=True, exist_ok=True)
    catalog: dict[str, object] = {
        "name": "Voloshka Low Poly Cafe Asset - Pizza Cafe Pack",
        "source": "https://viravoloshyn.itch.io/low-poly-cafe-asset",
        "assetCount": len(sources),
        "coordinateSystem": "Y-up, +Z forward; origin at bottom-center",
        "assets": {},
    }

    used_slugs: set[str] = set()
    for index, source in enumerate(sources, start=1):
        base_slug = slugify(source.name)
        slug = base_slug
        suffix = 2
        while slug in used_slugs:
            slug = f"{base_slug}-{suffix}"
            suffix += 1
        used_slugs.add(slug)

        category = category_for(source.name)
        category_dir = output_root / category
        category_dir.mkdir(parents=True, exist_ok=True)
        relative_file = Path(category) / f"{slug}.glb"
        dimensions = export_one(source, output_root / relative_file)

        catalog["assets"][source.name.strip().rstrip(".")] = {
            "file": relative_file.as_posix(),
            "category": category,
            "size": [round(v, 4) for v in dimensions],
        }
        print(f"[{index:02d}/{len(sources)}] {source.name} -> {relative_file.as_posix()}")

    (output_root / "catalog.json").write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Exported {len(sources)} assets to {output_root}")


if __name__ == "__main__":
    main()
