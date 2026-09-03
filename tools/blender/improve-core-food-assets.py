"""Rebuild every raw and processed food as game-ready low-poly GLBs.

Run inside Blender (GUI, MCP, or CLI). The exported assets keep the project's
existing dimensions and origins, use only embedded materials, and contain no
lights, cameras, or baked shadows.
"""

from __future__ import annotations

import math
import random
from pathlib import Path

import bpy
from mathutils import Vector


PROJECT = Path(__file__).resolve().parents[2]
ASSET_ROOT = PROJECT / "public" / "assets"
RNG = random.Random(20260902)


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for blocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials,
                   bpy.data.cameras, bpy.data.lights):
        for block in list(blocks):
            if block.users == 0:
                blocks.remove(block)


def material(name, color, roughness=0.82, specular=0.25):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1.0)
    mat.use_nodes = True
    bsdf = next((node for node in mat.node_tree.nodes
                 if node.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        bsdf = mat.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = 0.0
    if "IOR" in bsdf.inputs:
        bsdf.inputs["IOR"].default_value = 1.38
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = specular
    return mat


def transparent_material(name, color, alpha, roughness=.30):
    mat = material(name, color, roughness, .32)
    mat.diffuse_color = (*color, alpha)
    bsdf = next((node for node in mat.node_tree.nodes
                 if node.type == "BSDF_PRINCIPLED"), None)
    if bsdf is not None:
        bsdf.inputs["Alpha"].default_value = alpha
    if hasattr(mat, "surface_render_method"):
        mat.surface_render_method = "DITHERED"
    return mat


def assign(obj, mat):
    obj.data.materials.append(mat)
    return obj


def rounded_box(name, dimensions, location, mat, bevel=0.012, segments=3):
    bpy.ops.mesh.primitive_cube_add(location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    mod = obj.modifiers.new("soft food edges", "BEVEL")
    mod.width = bevel
    mod.segments = segments
    mod.limit_method = "ANGLE"
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return assign(obj, mat)


def ellipsoid(name, location, scale, mat, subdivisions=1, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=1,
                                         location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return assign(obj, mat)


def torus(name, location, major_radius, minor_radius, mat, major_segments=24, minor_segments=6):
    bpy.ops.mesh.primitive_torus_add(major_radius=major_radius,
                                    minor_radius=minor_radius,
                                    major_segments=major_segments,
                                    minor_segments=minor_segments,
                                    location=location)
    obj = bpy.context.object
    obj.name = name
    return assign(obj, mat)


def cylinder_axis(name, radius, depth, location, mat, axis="Z", vertices=16, bevel=0.0):
    rotation = {"X": (0, math.pi / 2, 0), "Y": (math.pi / 2, 0, 0), "Z": (0, 0, 0)}[axis]
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth,
                                        location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    assign(obj, mat)
    if bevel:
        mod = obj.modifiers.new("soft cut edge", "BEVEL")
        mod.width = bevel
        mod.segments = 2
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return obj


def cone_x(name, radius_base, radius_tip, depth, location, mat, vertices=16):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius_base,
                                    radius2=radius_tip, depth=depth,
                                    location=location, rotation=(0, math.pi / 2, 0))
    obj = bpy.context.object
    obj.name = name
    assign(obj, mat)
    mod = obj.modifiers.new("root softness", "BEVEL")
    mod.width = .006
    mod.segments = 2
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return obj


def egg_shell_mesh(name, mat):
    segments, rings = 20, 16
    verts = []
    for ring in range(rings + 1):
        t = ring / rings
        z = -.162 + .324 * t
        # Fractional power keeps the lower end round while the taper term makes
        # only the upper end recognisably egg-shaped.
        radius = .130 * math.sin(math.pi * t) ** .58 * (1.08 - .16 * t)
        for side in range(segments):
            angle = math.tau * side / segments
            verts.append((radius * math.cos(angle), radius * math.sin(angle), z))
    faces = []
    for ring in range(rings):
        for side in range(segments):
            nxt = (side + 1) % segments
            a = ring * segments + side
            b = ring * segments + nxt
            c = (ring + 1) * segments + nxt
            d = (ring + 1) * segments + side
            faces.append((a, b, c, d))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    assign(obj, mat)
    return obj


def leaf_mesh(name, center, length, width, angle, mat, phase=0.0):
    """Create a slightly folded, thick low-poly leaf lying along local X."""
    rows = 7
    verts = []
    ca, sa = math.cos(angle), math.sin(angle)
    for zoff in (-.003, .003):
        for row in range(rows):
            t = row / (rows - 1)
            x = (t - .5) * length
            half = width * math.sin(math.pi * t) * (.78 + .22 * math.sin(t * math.pi * 3 + phase))
            fold = math.sin(math.pi * t) * .009
            for side in (-1, 1):
                lx, ly = x, side * half
                wx = center[0] + lx * ca - ly * sa
                wy = center[1] + lx * sa + ly * ca
                wz = center[2] + zoff + fold * (1 - abs(side) * .35) + math.sin(row * 1.7 + phase) * .002
                verts.append((wx, wy, wz))
    faces = []
    layer_size = rows * 2
    for layer in range(2):
        base = layer * layer_size
        for row in range(rows - 1):
            a = base + row * 2
            faces.append((a, a + 2, a + 3, a + 1) if layer else (a, a + 1, a + 3, a + 2))
    for row in range(rows - 1):
        for side in range(2):
            a = row * 2 + side
            b = (row + 1) * 2 + side
            faces.append((a, b, layer_size + b, layer_size + a))
    faces.extend(((0, layer_size, layer_size + 1, 1),
                  (layer_size - 2, layer_size - 1, layer_size * 2 - 1, layer_size * 2 - 2)))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    assign(obj, mat)
    return obj


def poly_curve(name, points, bevel_depth, mat):
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 1
    curve.bevel_depth = bevel_depth
    curve.bevel_resolution = 1
    curve.resolution_u = 1
    spline = curve.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for point, co in zip(spline.points, points):
        point.co = (*co, 1.0)
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    assign(obj, mat)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    obj.select_set(False)
    return obj


def combined_grains(name, grains, mats):
    """Build many tapered six-sided grains as one draw-call-friendly mesh.

    Each grain is (center, tangent, bitangent, normal, length, width, height,
    material_index). The local X axis follows tangent.
    """
    verts = []
    faces = []
    face_materials = []
    ring_x = (-0.32, 0.0, 0.32)
    ring_r = (0.76, 1.0, 0.76)

    for center, tangent, bitangent, normal, length, width, height, mat_index in grains:
        base = len(verts)
        center = Vector(center)
        tangent = Vector(tangent).normalized()
        bitangent = Vector(bitangent).normalized()
        normal = Vector(normal).normalized()

        verts.append(tuple(center - tangent * length * 0.5))
        for rx, rr in zip(ring_x, ring_r):
            for side in range(6):
                angle = math.tau * side / 6
                co = (center + tangent * length * rx
                      + bitangent * (math.cos(angle) * width * rr)
                      + normal * (math.sin(angle) * height * rr))
                verts.append(tuple(co))
        verts.append(tuple(center + tangent * length * 0.5))

        first = base
        last = base + 19
        for side in range(6):
            nxt = (side + 1) % 6
            faces.append((first, base + 1 + side, base + 1 + nxt))
            face_materials.append(mat_index)
        for ring in range(2):
            a = base + 1 + ring * 6
            b = a + 6
            for side in range(6):
                nxt = (side + 1) % 6
                faces.append((a + side, b + side, b + nxt, a + nxt))
                face_materials.append(mat_index)
        for side in range(6):
            nxt = (side + 1) % 6
            faces.append((base + 13 + side, last, base + 13 + nxt))
            face_materials.append(mat_index)

    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.materials.clear()
    for mat in mats:
        mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    for polygon, mat_index in zip(mesh.polygons, face_materials):
        polygon.material_index = mat_index
    return obj


def export_glb(relative_path):
    path = ASSET_ROOT / relative_path
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(path), export_format="GLB", use_selection=False,
        export_apply=True, export_normals=True, export_materials="EXPORT",
        export_yup=True,
    )
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    print(f"EXPORTED {relative_path}: {len(meshes)} meshes, "
          f"{sum(len(o.data.vertices) for o in meshes)} verts, "
          f"{sum(len(o.data.polygons) for o in meshes)} faces")


def build_ham():
    clear_scene()
    rind = material("ham rind", (0.54, 0.20, 0.22), 0.88, 0.18)
    meat = material("ham meat", (0.79, 0.40, 0.43), 0.78, 0.25)
    cut = material("fresh cut ham", (0.92, 0.58, 0.60), 0.72, 0.27)
    fat = material("ham fat", (0.93, 0.78, 0.72), 0.80, 0.20)
    pore = material("cured pores", (0.57, 0.25, 0.27), 0.90, 0.12)

    rounded_box("ham_rind", (.340, .240, .116), (0, 0, 0), rind, .026, 3)
    rounded_box("ham_meat", (.319, .219, .105), (0, 0, .006), meat, .022, 3)
    rounded_box("ham_cut_surface", (.306, .205, .012), (0, 0, .057), cut, .008, 3)

    marble_paths = (
        [(-.125, -.065, .064), (-.080, -.045, .065), (-.038, -.056, .065), (.012, -.030, .065)],
        [(.025, .066, .065), (.064, .046, .065), (.094, .056, .065), (.126, .035, .064)],
        [(-.105, .048, .065), (-.073, .067, .065), (-.036, .050, .065)],
        [(.055, -.076, .064), (.078, -.055, .065), (.118, -.064, .064)],
    )
    for i, path in enumerate(marble_paths):
        poly_curve(f"fat_marble_{i}", path, .0031 if i < 2 else .0024, fat)

    pore_data = ((-.115,-.012,.007,.004),(-.072,.018,.006,.003),(-.028,-.075,.005,.003),
                 (.010,.015,.006,.003),(.052,-.008,.005,.0028),(.094,.079,.006,.0032),
                 (.128,-.032,.004,.0026),(-.008,.078,.004,.0025))
    for i, (x, y, sx, sy) in enumerate(pore_data):
        ellipsoid(f"cure_pore_{i}", (x, y, .0645), (sx, sy, .0014), pore, 1,
                  (0, 0, RNG.uniform(-.8, .8)))
    export_glb("raw/ham.glb")


def fishcake_sheet(name, z, rotation, scale, mat, seed):
    rng = random.Random(seed)
    count = 32
    a, b = .196 * scale, .146 * scale
    outline = []
    for i in range(count):
        angle = math.tau * i / count
        c, s = math.cos(angle), math.sin(angle)
        # Superellipse produces a rounded rectangle without perfectly straight edges.
        x = a * math.copysign(abs(c) ** .34, c)
        y = b * math.copysign(abs(s) ** .34, s)
        ripple = 1 + .018 * math.sin(i * 2.13 + seed) + rng.uniform(-.008, .008)
        outline.append((x * ripple, y * ripple))
    ca, sa = math.cos(rotation), math.sin(rotation)
    outline = [(x * ca - y * sa, x * sa + y * ca) for x, y in outline]

    thickness = .018
    verts = [(0, 0, z - thickness * .5), (0, 0, z + thickness * .5 + .002)]
    for x, y in outline:
        verts.append((x, y, z - thickness * .5 + rng.uniform(-.0015, .0015)))
    for i, (x, y) in enumerate(outline):
        wave = .0025 * math.sin(i * 1.7 + seed)
        verts.append((x, y, z + thickness * .5 + wave))
    faces = []
    for i in range(count):
        nxt = (i + 1) % count
        faces.append((0, 2 + nxt, 2 + i))
        faces.append((1, 2 + count + i, 2 + count + nxt))
        faces.append((2 + i, 2 + nxt, 2 + count + nxt, 2 + count + i))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    # Smooth only the broad top/bottom fans. Keeping the narrow edge faces flat
    # preserves the stacked low-poly silhouette without a starburst on top.
    for i in range(count):
        mesh.polygons[i * 3].use_smooth = True
        mesh.polygons[i * 3 + 1].use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    assign(obj, mat)
    return obj


def build_fishcake():
    clear_scene()
    layers = [
        material("fishcake golden edge", (0.52, 0.25, 0.09), .90, .16),
        material("fishcake warm", (0.72, 0.41, 0.17), .86, .18),
        material("fishcake top", (0.80, 0.52, 0.25), .82, .20),
    ]
    toast = material("toasted spots", (0.49, 0.25, 0.10), .93, .12)
    blister = material("fried blisters", (0.94, 0.72, 0.45), .78, .20)
    crease = material("fried creases", (0.62, 0.36, 0.16), .94, .12)

    for i, (z, rot, scale) in enumerate(((-.038,-.025,1.0),(-.016,.018,.985),(.006,-.015,.97),(.028,.012,.955))):
        fishcake_sheet(f"fishcake_layer_{i}", z, rot, scale,
                       layers[min(i, 2)], 140 + i)

    spots = ((-.130,-.070,.018,.010),(-.092,.055,.012,.008),(-.040,-.025,.016,.009),
             (.008,.080,.012,.007),(.045,.018,.020,.011),(.095,-.068,.013,.008),
             (.132,.050,.017,.010),(-.005,-.100,.010,.007),(.105,.096,.009,.006))
    for i, (x, y, sx, sy) in enumerate(spots):
        ellipsoid(f"toast_{i}", (x, y, .0408), (sx, sy, .0016), toast, 1,
                  (0, 0, RNG.uniform(-1.2, 1.2)))
    for i, (x, y, s) in enumerate(((-.060,.015,.011),(.075,.057,.009),(.122,-.010,.007),(-.118,.092,.007))):
        ellipsoid(f"oil_blister_{i}", (x, y, .043), (s, s*.72, s*.32), blister, 1)
    for i, pts in enumerate((
        [(-.145,.010,.041),(-.105,.002,.041),(-.070,.012,.041)],
        [(.010,-.070,.041),(.045,-.060,.041),(.080,-.073,.041)],
        [(.030,.105,.041),(.065,.094,.041),(.095,.101,.041)],
    )):
        poly_curve(f"fried_crease_{i}", pts, .0015, crease)
    export_glb("raw/fishcake.glb")


def bowl_mesh(name, mats):
    # Closed radial profile: outer rim -> outer base -> inner base -> inner rim.
    profile = ((.207,.058),(.202,.027),(.180,-.024),(.130,-.071),(.100,-.078),
               (.090,-.071),(.116,-.050),(.151,-.004),(.181,.046),(.184,.054))
    segments = 24
    verts = []
    for radius, z in profile:
        for i in range(segments):
            angle = math.tau * i / segments
            verts.append((radius * math.cos(angle), radius * math.sin(angle), z))
    faces = []
    for row in range(len(profile)):
        nxt_row = (row + 1) % len(profile)
        for i in range(segments):
            nxt = (i + 1) % segments
            faces.append((row*segments+i, row*segments+nxt,
                          nxt_row*segments+nxt, nxt_row*segments+i))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    for mat in mats:
        mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def build_raw_rice():
    clear_scene()
    ceramic = material("warm ceramic", (.84, .86, .82), .72, .28)
    glaze = material("ceramic rim", (.95, .95, .90), .58, .34)
    blue = material("ceramic blue line", (.22, .38, .45), .70, .25)
    raw_mats = [
        material("raw rice ivory", (.86, .78, .59), .82, .18),
        material("raw rice cream", (.96, .89, .70), .78, .21),
        material("raw rice warm", (.72, .63, .45), .86, .15),
    ]
    water = transparent_material("rinse water", (.18,.52,.72), .32, .24)

    bowl_mesh("rice_bowl", [ceramic])
    torus("bowl_glazed_rim", (0,0,.056), .195, .006, glaze, 24, 6)
    torus("bowl_blue_line", (0,0,.020), .193, .003, blue, 24, 5)
    torus("bowl_foot", (0,0,-.078), .092, .006, ceramic, 20, 5)
    ellipsoid("rice_pile_base", (0,0,.035), (.170,.170,.044), raw_mats[0], 2)

    grains = []
    for _ in range(148):
        radius = math.sqrt(RNG.random()) * .158
        angle = RNG.random() * math.tau
        x, y = radius * math.cos(angle), radius * math.sin(angle)
        z = .045 + .040 * max(0, 1 - (radius/.166)**2) + RNG.uniform(-.003,.004)
        yaw = RNG.random() * math.tau
        tangent = Vector((math.cos(yaw), math.sin(yaw), RNG.uniform(-.16,.16)))
        normal = Vector((RNG.uniform(-.10,.10), RNG.uniform(-.10,.10), 1))
        bitangent = normal.cross(tangent).normalized()
        tangent = bitangent.cross(normal).normalized()
        grains.append(((x,y,z), tangent, bitangent, normal,
                       RNG.uniform(.016,.022), RNG.uniform(.0037,.0049),
                       RNG.uniform(.0028,.0038), RNG.choices((0,1,2),(6,3,1))[0]))
    combined_grains("uncooked_rice_grains", grains, raw_mats)
    # Runtime contract: world.js toggles this exact node for washed rice only.
    cylinder_axis("water", .176, .002, (0,0,.061), water, "Z", 24)
    export_glb("item/rice.glb")


def build_cooked_rice():
    clear_scene()
    cooked_mats = [
        material("cooked rice", (.91, .88, .78), .62, .34),
        material("cooked rice highlight", (.99, .97, .89), .56, .38),
        material("cooked rice warm", (.79, .74, .63), .70, .26),
    ]
    ellipsoid("sticky_rice_mound", (0,0,.004), (.193,.164,.108), cooked_mats[0], 3)
    # Overlapping lobes break the perfect dome silhouette and read as sticky clumps.
    for i, (x,y,z,sx,sy,sz) in enumerate((
        (-.105,-.025,.068,.050,.042,.026),(-.055,.067,.078,.052,.043,.025),
        (.050,-.065,.079,.056,.044,.027),(.108,.035,.065,.046,.040,.024),
        (0,.015,.101,.055,.047,.022),(-.025,-.090,.055,.043,.037,.022),
        (.072,.080,.057,.041,.036,.021))):
        ellipsoid(f"sticky_cluster_{i}", (x,y,z), (sx,sy,sz),
                  cooked_mats[1 if i % 3 == 0 else 0], 2)

    grains = []
    for _ in range(132):
        for _attempt in range(20):
            x = RNG.uniform(-.178,.178)
            y = RNG.uniform(-.145,.145)
            q = (x/.190)**2 + (y/.162)**2
            if q < .96:
                break
        z_rel = .106 * math.sqrt(max(.02, 1-q))
        z = .005 + z_rel
        normal = Vector((x/.190**2, y/.162**2, z_rel/.106**2)).normalized()
        guide = Vector((math.cos(RNG.random()*math.tau), math.sin(RNG.random()*math.tau), 0))
        tangent = (guide - normal * guide.dot(normal)).normalized()
        bitangent = normal.cross(tangent).normalized()
        grains.append(((x,y,z + .001), tangent, bitangent, normal,
                       RNG.uniform(.017,.023), RNG.uniform(.0042,.0054),
                       RNG.uniform(.0031,.0041), RNG.choices((0,1,2),(6,3,1))[0]))
    combined_grains("visible_cooked_grains", grains, cooked_mats)
    export_glb("item/bap.glb")


def build_raw_danmuji():
    clear_scene()
    pickle = material("pickled radish", (.88, .68, .035), .82, .24)
    cut = material("juicy radish cut", (1.0, .86, .16), .72, .28)
    ridge = material("pickle ridges", (.72, .49, .025), .90, .14)
    pore = material("pickle pores", (.63, .40, .02), .94, .10)
    cylinder_axis("danmuji_body", .071, .486, (0,0,0), pickle, "X", 16, .009)
    cylinder_axis("near_cut", .064, .009, (.247,0,0), cut, "X", 16, .002)
    cylinder_axis("far_cut", .061, .008, (-.247,0,0), cut, "X", 16, .002)
    for i, x in enumerate((-.14,-.035,.080,.170)):
        ring = torus(f"pickle_ring_{i}", (x,0,0), .069, .0022, ridge, 16, 5)
        ring.rotation_euler[1] = math.pi/2
    for i, (y,z,s) in enumerate(((-.028,-.018,.004),(.018,-.030,.0035),(.032,.014,.003),
                                  (-.008,.030,.0038),(0,0,.0028))):
        ellipsoid(f"radish_pore_{i}", (.253,y,z), (.0015,s,s*.72), pore, 1)
    export_glb("raw/danmuji.glb")


def build_raw_egg():
    clear_scene()
    shell = material("matte eggshell", (.68, .46, .27), .92, .16)
    speck = material("eggshell specks", (.38, .23, .12), .96, .08)
    egg_shell_mesh("egg_shell", shell)
    spots = ((.090,.042,.052,.005),(-.078,.055,.068,.004),(.045,-.100,.020,.0035),
             (-.105,-.035,-.020,.004),(.063,.088,-.054,.0035),(-.025,.115,.010,.003))
    for i, (x,y,z,s) in enumerate(spots):
        ellipsoid(f"shell_speck_{i}", (x,y,z), (s,s*.35,s*.85), speck, 1)
    export_glb("raw/egg.glb")


def build_raw_cucumber():
    clear_scene()
    skin = material("cucumber skin", (.055, .30, .075), .84, .20)
    ridge = material("cucumber ridges", (.11, .42, .10), .88, .16)
    flesh = material("fresh cucumber flesh", (.53, .72, .27), .74, .27)
    seed = material("cucumber seeds", (.88, .91, .58), .76, .24)
    bump = material("cucumber bumps", (.16, .48, .12), .91, .12)
    cylinder_axis("cucumber_body", .078, .486, (0,0,0), skin, "X", 16, .008)
    for i in range(8):
        angle = math.tau*i/8
        pts=[]
        for x in (-.215,-.105,.005,.115,.215):
            rr=.077 + .002*math.sin(x*38+i)
            pts.append((x, math.cos(angle)*rr, math.sin(angle)*rr))
        poly_curve(f"skin_ridge_{i}", pts, .0022, ridge)
    cylinder_axis("cucumber_cut", .069, .010, (.248,0,0), flesh, "X", 16, .002)
    for i, (y,z,rot) in enumerate(((0,.026,0),(.023,.010,.5),(.022,-.016,-.4),
                                    (0,-.028,0),(-.022,-.014,.4),(-.023,.012,-.5))):
        ellipsoid(f"seed_{i}", (.254,y,z), (.0016,.0048,.011), seed, 1, (rot,0,0))
    for i, (x,angle) in enumerate(((-.16,.4),(-.055,2.1),(.075,4.0),(.17,5.2))):
        ellipsoid(f"skin_bump_{i}", (x, math.cos(angle)*.076, math.sin(angle)*.076),
                  (.006,.004,.004), bump, 1)
    export_glb("raw/cucumber.glb")


def build_raw_spinach():
    clear_scene()
    stem_mats = [material("spinach stems", (.26,.53,.18), .90, .13),
                 material("spinach stem light", (.40,.66,.25), .88, .15)]
    leaf_mats = [material("spinach leaf dark", (.035,.28,.075), .88, .18),
                 material("spinach leaf", (.06,.39,.10), .84, .20),
                 material("spinach leaf light", (.10,.48,.13), .86, .17)]
    vein = material("spinach veins", (.32,.60,.21), .91, .12)
    tie = material("produce tie", (.68,.49,.20), .82, .18)
    for i in range(7):
        y=(i-3)*.018
        z=(i%3-1)*.022
        end_y=y*1.8 + (i%2-.5)*.025
        poly_curve(f"spinach_stem_{i}", [(-.235,y,z),(-.120,y*.75,z+.006),(-.020,end_y*.55,z+.012),(.080,end_y,z+.020)],
                   .0065 if i%2 else .0075, stem_mats[i%2])
        center=(.105,end_y,z+.024+(i%2)*.008)
        angle=(i-3)*.12
        leaf_mesh(f"spinach_leaf_{i}", center, .300, .058+(i%3)*.007,
                  angle, leaf_mats[i%3], i*.7)
        ca,sa=math.cos(angle),math.sin(angle)
        poly_curve(f"leaf_vein_{i}", [(.002,end_y,z+.031),(.110,end_y,z+.036),
                   (.220,end_y+.012*sa,z+.032)], .0020, vein)
    cylinder_axis("stem_bundle", .042, .065, (-.205,0,0), stem_mats[1], "X", 12, .003)
    cylinder_axis("bundle_tie", .046, .025, (-.184,0,0), tie, "X", 12, .002)
    export_glb("raw/spinach.glb")


def build_raw_carrot():
    clear_scene()
    root = material("carrot root", (.78,.25,.035), .88, .17)
    root_light = material("carrot ridges", (.93,.36,.055), .86, .19)
    groove = material("carrot grooves", (.54,.14,.025), .94, .10)
    green = material("carrot tops", (.10,.34,.065), .88, .16)
    green_light = material("carrot top light", (.18,.46,.09), .86, .17)
    cone_x("carrot_root", .078, .013, .385, (.038,0,0), root, 16)
    cylinder_axis("carrot_crown", .052, .024, (-.158,0,0), root_light, "X", 14, .003)
    for i, (x,r) in enumerate(((-.105,.067),(-.025,.052),(.055,.038),(.125,.026))):
        ring=torus(f"root_groove_{i}",(x,0,0),r,.0022,groove,16,5)
        ring.rotation_euler[1]=math.pi/2
    for i in range(5):
        y=(i-2)*.014
        z=(i%2-.5)*.022
        poly_curve(f"carrot_stem_{i}", [(-.165,y,z),(-.205,y*1.5,z+.018),(-.247,y*2.0,z+.025+(i%2)*.018)],
                   .006, green_light if i%2 else green)
        leaf_mesh(f"carrot_leaf_{i}", (-.247,y*2.0,z+.028+(i%2)*.018),
                  .105,.018,i*.55,green if i%2 else green_light,i)
    export_glb("raw/carrot.glb")


def build_gim():
    clear_scene()
    seaweed = material("roasted seaweed", (.010,.022,.012), .94, .08)
    fiber = material("seaweed fibers", (.025,.070,.040), .98, .05)
    edge = material("seaweed edge", (.018,.042,.025), .96, .06)
    rounded_box("gim_sheet", (.640,.520,.012), (0,0,0), seaweed, .006, 2)
    for i, y in enumerate((-.19,-.11,-.025,.065,.155)):
        pts=[(-.285,y,.007),(-.14,y+.004*math.sin(i),.0075),(.02,y-.003,.0075),(.18,y+.004,.0075),(.285,y,.007)]
        poly_curve(f"gim_fiber_{i}",pts,.0010,fiber)
    rounded_box("gim_edge", (.625,.505,.003), (0,0,-.0065), edge, .004, 1)
    export_glb("item/gim.glb")


def build_fill_danmuji():
    clear_scene()
    body=material("danmuji strip",(.94,.72,.025),.76,.23)
    light=material("danmuji moist edge",(1.0,.86,.12),.68,.29)
    pore=material("danmuji strip pores",(.66,.45,.018),.92,.10)
    rounded_box("danmuji_strip",(.056,.056,.998),(0,0,0),body,.007,2)
    rounded_box("moist_cut_side",(.051,.006,.982),(0,-.0285,0),light,.002,1)
    for i,z in enumerate((-.36,-.21,-.05,.13,.29,.41)):
        ellipsoid(f"strip_pore_{i}",(.020 if i%2 else -.017,-.032,z),(.003,.0015,.006),pore,1)
    export_glb("fill/danmuji.glb")


def build_fill_ham():
    clear_scene()
    meat=material("cooked ham strip",(.84,.40,.42),.70,.27)
    rind=material("ham strip rind",(.55,.19,.20),.86,.15)
    fat=material("ham strip fat",(.95,.74,.69),.76,.22)
    rounded_box("ham_strip",(.074,.040,.998),(0,0,0),meat,.006,2)
    rounded_box("ham_rind_edge",(.074,.009,.994),(0,-.016,0),rind,.003,1)
    for i,x in enumerate((-.020,.014)):
        pts=[(x,.021,-.44),(x+.008*(i*2-1),.021,-.20),(x-.004,.021,.02),(x+.006,.021,.25),(x,.021,.44)]
        poly_curve(f"ham_fat_line_{i}",pts,.0018,fat)
    export_glb("fill/ham.glb")


def build_fill_egg():
    clear_scene()
    omelet=material("rolled omelet",(.94,.61,.055),.72,.24)
    fold=material("omelet folds",(1.0,.78,.15),.68,.28)
    brown=material("omelet browned edge",(.67,.32,.035),.90,.13)
    rounded_box("egg_strip",(.088,.043,.998),(0,0,0),omelet,.007,2)
    rounded_box("browned_bottom",(.083,.007,.990),(0,-.020,0),brown,.002,1)
    for i,z in enumerate((-.31,-.08,.17,.36)):
        poly_curve(f"omelet_fold_{i}",[(-.038,.023,z-.018),(0,.024,z),(.038,.023,z+.014)],.0017,fold)
    export_glb("fill/egg.glb")


def build_fill_crab():
    clear_scene()
    white=material("crab stick core",(.94,.88,.77),.72,.25)
    red=material("crab stick red skin",(.78,.095,.045),.77,.22)
    fiber=material("crab stick fibers",(.78,.68,.54),.90,.12)
    rounded_box("crab_core",(.056,.052,.998),(0,0,0),white,.010,3)
    rounded_box("red_skin",(.060,.018,.996),(0,-.021,0),red,.006,2)
    for i,x in enumerate((-.017,0,.017)):
        poly_curve(f"crab_fiber_{i}",[(x,.027,-.46),(x+.003,.027,-.2),(x-.002,.027,.08),(x+.002,.027,.44)],.0011,fiber)
    export_glb("fill/crab.glb")


def build_fill_cucumber():
    clear_scene()
    flesh=material("cucumber baton flesh",(.48,.69,.24),.72,.25)
    skin=material("cucumber baton skin",(.035,.28,.055),.88,.15)
    seed=material("cucumber baton seeds",(.82,.86,.46),.77,.20)
    rounded_box("cucumber_baton",(.052,.055,.998),(0,0,0),flesh,.006,2)
    rounded_box("cucumber_skin",(.052,.012,.998),(0,-.026,0),skin,.004,2)
    for i,x in enumerate((-.014,.014)):
        poly_curve(f"cucumber_seed_line_{i}",[(x,.029,-.44),(x-.003,.029,-.15),(x+.002,.029,.13),(x,.029,.44)],.0015,seed)
    export_glb("fill/cucumber.glb")


def build_fill_spinach():
    clear_scene()
    mats=[material("wilted spinach",(.025,.25,.065),.82,.21),
          material("wilted spinach light",(.055,.38,.095),.78,.24),
          material("seasoned spinach stem",(.18,.48,.15),.80,.21)]
    for i in range(7):
        x=(i-3)*.011
        y=(i%3-1)*.010
        pts=[]
        for z in (-.47,-.25,0,.24,.47):
            pts.append((x+.006*math.sin(z*12+i),y+.005*math.cos(z*9+i),z))
        poly_curve(f"spinach_strand_{i}",pts,.0065 if i%2 else .0075,mats[i%3])
    for i,z in enumerate((-.29,-.03,.26)):
        ellipsoid(f"wilted_leaf_{i}",((i-1)*.018,.002,z),(.030,.018,.055),mats[i%2],1,(0,i*.35,0))
    export_glb("fill/spinach.glb")


def build_fill_carrot():
    clear_scene()
    mats=[material("carrot julienne",(.91,.28,.025),.79,.20),
          material("carrot julienne light",(1.0,.39,.045),.75,.22),
          material("carrot julienne dark",(.71,.18,.018),.86,.15)]
    positions=((-0.040,-.009),(-.020,.009),(0,-.009),(.020,.009),(.040,-.009))
    for i,(x,y) in enumerate(positions):
        rounded_box(f"julienne_{i}",(.018,.018,.996),(x,y,0),mats[i%3],.003,2)
    export_glb("fill/carrot.glb")


def build_fill_fishcake():
    clear_scene()
    body=material("cooked fishcake strip",(.73,.43,.19),.78,.21)
    light=material("fishcake cut side",(.88,.61,.31),.72,.24)
    toast=material("fishcake strip toast",(.43,.20,.065),.91,.10)
    rounded_box("fishcake_strip",(.096,.050,.998),(0,0,0),body,.008,2)
    rounded_box("fishcake_cut_side",(.088,.008,.988),(0,.025,0),light,.003,1)
    for i,(x,z) in enumerate(((-.025,-.32),(.022,-.12),(-.010,.10),(.028,.31))):
        ellipsoid(f"strip_toast_{i}",(x,.030,z),(.009,.0018,.025),toast,1,(0,RNG.uniform(-.5,.5),0))
    export_glb("fill/fishcake.glb")


if __name__ == "__main__":
    for builder in (
        build_raw_danmuji, build_ham, build_raw_egg, build_raw_cucumber,
        build_raw_spinach, build_raw_carrot, build_fishcake,
        build_fill_danmuji, build_fill_ham, build_fill_egg, build_fill_crab,
        build_fill_cucumber, build_fill_spinach, build_fill_carrot,
        build_fill_fishcake, build_gim, build_raw_rice, build_cooked_rice,
    ):
        builder()
    clear_scene()
    print("CORE_FOOD_ASSETS_DONE")
