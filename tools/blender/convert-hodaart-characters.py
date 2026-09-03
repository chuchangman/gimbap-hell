"""Convert Hodaart's Low Poly Character Collection 3 into game-ready GLBs.

Run with Blender in background mode:
  blender --background --python tools/blender/convert-hodaart-characters.py --
    "<models directory>" "<palette .png>" public/assets/char

Each character ships as two FBXs — a skinned T-pose body and four loose face
meshes — and the body material points at a texture path on the publisher's own
machine, so it imports empty.  This rejoins the halves: the face meshes become
children of the Head bone under the names world.js looks up, and the texture is
relinked before export.

What the source already gets right, and this script must not disturb:
origin between the feet (y=0), eyes at 1.807 m, and -Y forward in Blender —
which the exporter turns into the +Z forward that assets.js expects.

The rig is Mixamo's own — bone for bone — so animation can be retargeted from
mixamo.com.  The pack's own eight clips cannot: Unity stores them as humanoid
muscle curves, which no FBX or glTF export can carry.  Exports here therefore
stand in a T-pose until clips are added.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import bpy
import numpy as np

# Name of the colour attribute the palette is baked into.
COLOR_ATTR = "Col"

# The pack names face meshes for a human reader; world.js looks them up by the
# names in the assets.js CONTRACT.  The pack has no mouth mesh — see catalog.json.
FACE_PART_NAMES = {
    "L Eye": "eyeL",
    "R Eye": "eyeR",
    "L Eyebrow": "browL",
    "R Eyebrow": "browR",
}

# The rig arrives with mixamorig: on every bone.  three.js drops the colon when
# GLTFLoader sanitises node names, so leaving the prefix on would hand the game
# bones called mixamorigHead — a name nobody would think to type.  Strip it.
MIXAMO_PREFIX = "mixamorig:"
HEAD_BONE = "Head"

# world.js reads .torso to own a material for the hit flash and to widen the
# shoulders for one accessory.  On a skinned character that is the body mesh.
BODY_MESH_NAME = "torso"


USAGE = "Expected: -- <models-dir> <palette.png> <output-directory> [animations-dir]"


def cli_paths() -> tuple[Path, Path, Path, Path | None]:
    if "--" not in sys.argv:
        raise SystemExit(USAGE)
    args = sys.argv[sys.argv.index("--") + 1 :]
    if len(args) not in (3, 4):
        raise SystemExit(USAGE)
    anims = Path(args[3]).resolve() if len(args) == 4 else None
    return Path(args[0]).resolve(), Path(args[1]).resolve(), Path(args[2]).resolve(), anims


def slugify(name: str) -> str:
    clean = re.sub(r"[^A-Za-z0-9]+", "-", name.strip())
    return clean.strip("-").lower()


def relink_texture(image: bpy.types.Image) -> None:
    """Point every material at the palette that actually shipped.

    The FBX records an absolute path from the publisher's machine, so Blender
    imports the image node with no data behind it.  Left alone the GLB exports
    untextured, which reads as a plain white character rather than as an error.
    """
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        nodes = mat.node_tree.nodes
        tex = next((n for n in nodes if n.type == "TEX_IMAGE"), None)
        if tex is None:
            tex = nodes.new("ShaderNodeTexImage")
        tex.image = image

        bsdf = next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None)
        if bsdf is None:
            continue
        if not bsdf.inputs["Base Color"].links:
            mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        # Unity ships this material fully matte: _Metallic 0, _Smoothness 0.
        bsdf.inputs["Metallic"].default_value = 0.0
        bsdf.inputs["Roughness"].default_value = 1.0


def action_fcurves(action: bpy.types.Action) -> list:
    """Every F-Curve in an action, across both action layouts.

    Blender 4.4 moved actions onto slots and layers; older files still carry the
    flat list.  Reading only one of the two silently finds no curves to rename.
    """
    legacy = getattr(action, "fcurves", None)
    if legacy:
        return list(legacy)
    curves: list = []
    for layer in getattr(action, "layers", []):
        for strip in layer.strips:
            for bag in getattr(strip, "channelbags", []):
                curves.extend(bag.fcurves)
    return curves


def load_actions(anim_dir: Path) -> dict[str, bpy.types.Action]:
    """Import each Mixamo FBX for its animation and throw the rest away.

    Mixamo hands out one clip per file with the rig attached, so the armature and
    mesh that arrive with it are duplicates of what is already loaded.  Only the
    action is kept, under the file's name — that is the name the game will ask for.
    """
    actions: dict[str, bpy.types.Action] = {}
    for fbx in sorted(anim_dir.glob("*.fbx")):
        known_actions = set(bpy.data.actions)
        known_objects = set(bpy.data.objects)
        bpy.ops.import_scene.fbx(filepath=str(fbx), ignore_leaf_bones=True)
        fresh = [a for a in bpy.data.actions if a not in known_actions]
        for obj in [o for o in bpy.data.objects if o not in known_objects]:
            bpy.data.objects.remove(obj, do_unlink=True)
        if not fresh:
            print(f"  ! {fbx.name} carries no animation — skipped")
            continue
        action = fresh[0]
        # The armature that owned it was just deleted; without a fake user the
        # action is unowned and can vanish before export.
        action.use_fake_user = True
        action.name = slugify(fbx.stem)
        actions[action.name] = action
    return actions


def retarget_actions(actions: dict[str, bpy.types.Action]) -> None:
    """Point the curves at the bone names this pipeline exports.

    Mixamo animates pose.bones["mixamorig:Hips"]; the rig here has already had
    that prefix stripped, and a curve aimed at a missing bone simply does nothing.
    """
    for action in actions.values():
        for curve in action_fcurves(action):
            if MIXAMO_PREFIX in curve.data_path:
                curve.data_path = curve.data_path.replace(MIXAMO_PREFIX, "")


def stash_actions(armature: bpy.types.Object, actions: dict[str, bpy.types.Action]) -> None:
    """Park each action on its own muted NLA track.

    The exporter's ACTIONS mode walks the NLA, so this is what turns a pile of
    loose actions into one glTF animation each.  Muted keeps them off the pose.
    """
    if armature.animation_data is None:
        armature.animation_data_create()
    anim = armature.animation_data
    anim.action = None
    for name, action in actions.items():
        track = anim.nla_tracks.new()
        track.name = name
        strip = track.strips.new(name, int(action.frame_range[0]), action)
        strip.name = name
        track.mute = True


def srgb_to_linear(c: np.ndarray) -> np.ndarray:
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def read_uvs(mesh: bpy.types.Mesh) -> np.ndarray | None:
    """Per-corner UVs, across the two API shapes Blender has shipped."""
    layer = mesh.uv_layers.active
    if layer is None:
        return None
    out = np.empty(len(mesh.loops) * 2, dtype=np.float32)
    try:
        layer.uv.foreach_get("vector", out)
    except AttributeError:
        layer.data.foreach_get("uv", out)
    return out.reshape(-1, 2)


def bake_vertex_colors(image: bpy.types.Image) -> int:
    """Move the palette onto the mesh and drop the texture.

    All ten characters share one 2048x2048 atlas, so embedding it in every GLB
    spends 5 MB to express 103 colours.  The mesh already splits at colour
    boundaries — 89% of triangles sample a single flat colour, and the rest vary
    by at most 21/255 — so the atlas survives the move nearly exactly, while the
    files drop by about 60%.
    """
    w, h = image.size
    buf = np.empty(w * h * 4, dtype=np.float32)
    image.pixels.foreach_get(buf)
    # Blender hands back the stored sRGB bytes, but a FLOAT_COLOR attribute is
    # read as scene-linear.  Skip this and every colour comes out too dark.
    px = srgb_to_linear(buf.reshape(h, w, 4))

    baked = 0
    for obj in [o for o in bpy.data.objects if o.type == "MESH"]:
        mesh = obj.data
        uvs = read_uvs(mesh)
        if uvs is None:
            print(f"  ! {obj.name} has no UVs — left untextured")
            continue
        # Nearest, not bilinear: the atlas is flat cells, and averaging across a
        # cell border would invent a colour that appears nowhere on the sheet.
        xs = np.clip((uvs[:, 0] * w).astype(np.int32), 0, w - 1)
        ys = np.clip((uvs[:, 1] * h).astype(np.int32), 0, h - 1)
        cols = px[ys, xs].copy()
        cols[:, 3] = 1.0

        while mesh.color_attributes:
            mesh.color_attributes.remove(mesh.color_attributes[0])
        attr = mesh.color_attributes.new(
            name=COLOR_ATTR, type="FLOAT_COLOR", domain="CORNER"
        )
        attr.data.foreach_set("color", cols.ravel())
        # Removing the FBX's own layer leaves the mesh with no active colour, and
        # the exporter skips meshes that have none.  Name it explicitly.
        mesh.color_attributes.active_color = attr
        mesh.color_attributes.render_color_index = mesh.color_attributes.find(
            COLOR_ATTR
        )
        baked += 1

    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        nodes = mat.node_tree.nodes
        for node in [n for n in nodes if n.type == "TEX_IMAGE"]:
            nodes.remove(node)
        bsdf = next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None)
        if bsdf is None:
            continue
        src = nodes.new("ShaderNodeVertexColor")
        src.layer_name = COLOR_ATTR
        mat.node_tree.links.new(src.outputs["Color"], bsdf.inputs["Base Color"])

    return baked


def strip_bone_prefix(armature: bpy.types.Object) -> int:
    """Drop mixamorig: from every bone, keeping vertex groups in step.

    Blender usually renames a mesh's vertex groups along with the bone, but it
    only does so for meshes it can see the link to, so the rename is repeated
    here.  A vertex group left under the old name silently stops deforming.
    """
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    renamed = 0
    for bone in armature.data.bones:
        if not bone.name.startswith(MIXAMO_PREFIX):
            continue
        old = bone.name
        new = old[len(MIXAMO_PREFIX) :]
        bone.name = new
        for mesh in meshes:
            group = mesh.vertex_groups.get(old)
            if group is not None:
                group.name = new
        renamed += 1
    return renamed


def attach_to_head(obj: bpy.types.Object, armature: bpy.types.Object) -> None:
    """Bone-parent a face mesh so it rides the skull instead of standing still."""
    world = obj.matrix_world.copy()
    obj.parent = armature
    obj.parent_type = "BONE"
    obj.parent_bone = HEAD_BONE
    bpy.context.view_layer.update()
    obj.matrix_world = world


def build_character(
    tpose: Path, head_parts: Path, palette: Path, anim_dir: Path | None
) -> dict[str, object]:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=str(tpose))

    armature = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
    if armature is None:
        raise SystemExit(f"No armature in {tpose.name}")

    body = next(o for o in bpy.data.objects if o.type == "MESH")
    strip_bone_prefix(armature)
    if HEAD_BONE not in armature.data.bones:
        raise SystemExit(f"{tpose.name} has no {HEAD_BONE} bone")

    body.name = BODY_MESH_NAME
    body.data.name = BODY_MESH_NAME

    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=str(head_parts))
    imported = [o for o in bpy.data.objects if o not in before]

    # Attach every face mesh before dropping the FBX's own root, or removing the
    # parent would leave the meshes behind at the origin.
    renamed: list[str] = []
    for obj in [o for o in imported if o.type == "MESH"]:
        # Four of the ten characters add a Glasses mesh.  Anything unnamed by the
        # contract still has to ride the skull, so only the label differs.
        target = FACE_PART_NAMES.get(obj.name.strip(), slugify(obj.name))
        obj.name = target
        obj.data.name = target
        obj.parent = None
        attach_to_head(obj, armature)
        renamed.append(target)

    for obj in [o for o in imported if o.type != "MESH"]:
        bpy.data.objects.remove(obj, do_unlink=True)

    image = bpy.data.images.load(str(palette), check_existing=True)
    relink_texture(image)
    bake_vertex_colors(image)

    clips: dict[str, bpy.types.Action] = {}
    if anim_dir is not None:
        clips = load_actions(anim_dir)
        retarget_actions(clips)
        stash_actions(armature, clips)

    return {
        "armature": armature,
        "body": body,
        "faceParts": sorted(renamed),
        "clips": sorted(clips),
    }


def export(output_file: Path, with_animations: bool) -> None:
    output_file.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(output_file),
        export_format="GLB",
        use_selection=False,
        # Must stay False: the body's Armature modifier *is* the skinning, and
        # applying modifiers would freeze the character into its T-pose.
        export_apply=False,
        export_yup=True,
        export_materials="EXPORT",
        export_skins=True,
        export_animations=with_animations,
        # One glTF animation per stashed action, which is what an AnimationMixer
        # wants; the other modes merge everything into a single timeline.
        export_animation_mode="ACTIONS",
        # Sampling writes a curve for all 41 bones on all three channels whether
        # the clip touches them or not.  Dropping the constant ones cuts a clip
        # to the bones it actually animates; the rest hold their rest pose.
        export_optimize_animation_size=True,
        export_optimize_animation_keep_anim_armature=False,
        # The palette lives on the mesh now; ACTIVE exports it whether or not the
        # exporter agrees the material reads it.  Without the second flag the
        # exporter also emits the FBX's own colour layer as a dead COLOR_1.
        export_vertex_color="ACTIVE",
        export_all_vertex_colors=False,
    )


def measure() -> dict[str, object]:
    from mathutils import Vector

    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        for corner in obj.bound_box:
            w = obj.matrix_world @ Vector(corner)
            for i in range(3):
                lo[i] = min(lo[i], w[i])
                hi[i] = max(hi[i], w[i])
    eye = next((o for o in bpy.data.objects if o.name == "eyeL"), None)
    return {
        # Blender is Z-up; the exporter writes Y-up, so report the GLB's axes.
        "size": [round(hi.x - lo.x, 4), round(hi.z - lo.z, 4), round(hi.y - lo.y, 4)],
        "groundOffset": round(lo.z, 4),
        "eyeHeight": round(eye.matrix_world.translation.z, 4) if eye else None,
    }


def main() -> None:
    models_dir, palette, output_root, anim_dir = cli_paths()
    if not models_dir.is_dir():
        raise SystemExit(f"Models directory not found: {models_dir}")
    if not palette.is_file():
        raise SystemExit(f"Palette texture not found: {palette}")
    if anim_dir is not None and not anim_dir.is_dir():
        raise SystemExit(f"Animations directory not found: {anim_dir}")

    characters = sorted(d for d in models_dir.iterdir() if d.is_dir())
    if not characters:
        raise SystemExit(f"No character folders under {models_dir}")

    catalog: dict[str, object] = {
        "name": "Hodaart Low Poly Character Collection 3",
        "source": "Unity Asset Store",
        "coordinateSystem": "Y-up, +Z forward; origin between the feet",
        "rig": "Mixamo (mixamorig: prefix stripped — Hips, LeftUpLeg, Head, ...)",
        "colour": "baked into COLOR_0; no textures (the pack's palette held 103 colours)",
        "animations": (
            f"retargeted from {anim_dir.name}"
            if anim_dir is not None
            else "none — the pack's 8 clips are Unity humanoid muscle data that no "
                 "FBX or glTF export can carry; retarget from mixamo.com instead"
        ),
        "assets": {},
    }

    for index, folder in enumerate(characters, start=1):
        tpose = next(folder.glob("*T-Pose.fbx"), None)
        head_parts = next(folder.glob("*Head Parts.fbx"), None)
        if tpose is None:
            print(f"  ! {folder.name} has no T-Pose FBX — skipped")
            continue
        if head_parts is None:
            print(f"  ! {folder.name} has no Head Parts FBX — skipped")
            continue

        built = build_character(tpose, head_parts, palette, anim_dir)
        slug = slugify(folder.name)
        output_file = output_root / f"{slug}.glb"
        export(output_file, with_animations=bool(built["clips"]))

        catalog["assets"][folder.name] = {
            "file": f"char/{slug}.glb",
            "bones": len(built["armature"].data.bones),
            "faceParts": built["faceParts"],
            "clips": built["clips"],
            **measure(),
        }
        print(f"[{index:02d}/{len(characters)}] {folder.name} -> {output_file.name}")

    (output_root / "catalog.json").write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Exported {len(catalog['assets'])} characters to {output_root}")


if __name__ == "__main__":
    main()
