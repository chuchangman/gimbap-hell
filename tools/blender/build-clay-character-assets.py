"""Original modular clay characters. Blender 5.x: --background --python this_file.

All exported modules use the same foot origin, +Y up and +Z forward in glTF.
Sleeve/trouser socket groups are reparented to the base pivots by world.js.
No downloaded character mesh or texture is used. Rebuilds only char assets.
"""
from pathlib import Path
import math
import bpy

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public/assets/char'
TAU = math.tau
HEAD_Y = 1.76
HEAD_SCALE = .875
SHOULDER_X, SHOULDER_Y = .282, 1.255


def xyz(p):
    return (p[0], -p[2], p[1])


def material(name, hex_color):
    c = [int(hex_color[i:i+2], 16) / 255 for i in (0, 2, 4)]
    c = [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in c]
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*c, 1)
    m.use_nodes = True
    bsdf = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if bsdf is None:
        bsdf = m.node_tree.nodes.new('ShaderNodeBsdfPrincipled')
        output = m.node_tree.nodes.new('ShaderNodeOutputMaterial')
        m.node_tree.links.new(bsdf.outputs['BSDF'], output.inputs['Surface'])
    bsdf.inputs['Base Color'].default_value = (*c, 1)
    bsdf.inputs['Roughness'].default_value = .86
    bsdf.inputs['Specular IOR Level'].default_value = .22
    return m


M = {k: material(k, c) for k, c in {
    'skin': 'deb18e', 'custom': '718b80', 'customShade': '61796f',
    'linen': 'e9dec6', 'seam': 'c5b89d', 'sole': 'c7bca6',
    'shoe': '755447', 'ink': '37332e', 'brass': 'bc9362',
    'hatRed': 'c57964', 'hatDark': '955747',
}.items()}

previous_scene = bpy.context.window.scene
work = bpy.data.scenes.new('ClayCharacterBuild')
bpy.context.window.scene = work


def clear():
    for obj in list(work.objects):
        bpy.data.objects.remove(obj, do_unlink=True)


def group(name, p=(0, 0, 0), parent=None):
    obj = bpy.data.objects.new(name, None)
    work.collection.objects.link(obj)
    obj.parent = parent
    obj.location = xyz(p)
    return obj


def finish(obj, name, mat, parent):
    obj.name = name
    obj.parent = parent
    obj.data.materials.append(M[mat])
    for poly in obj.data.polygons:
        poly.use_smooth = True
    return obj


def ellipsoid(name, p, scale, mat, parent=None, segments=24, rings=16):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=xyz(p))
    obj = bpy.context.object
    obj.scale = (scale[0], scale[2], scale[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(obj, name, mat, parent)


def box(name, p, dims, mat, parent=None, bevel=.025):
    bpy.ops.mesh.primitive_cube_add(size=1, location=xyz(p))
    obj = bpy.context.object
    obj.dimensions = (dims[0], dims[2], dims[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    mod = obj.modifiers.new('rounded clay edge', 'BEVEL')
    mod.width = bevel
    mod.segments = 3
    bpy.ops.object.modifier_apply(modifier=mod.name)
    finish(obj, name, mat, parent)
    mod = obj.modifiers.new('weighted corner normals', 'WEIGHTED_NORMAL')
    mod.keep_sharp = True
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return obj


def mesh(name, vertices, faces, mat, parent=None):
    data = bpy.data.meshes.new(name)
    data.from_pydata([xyz(v) for v in vertices], [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    work.collection.objects.link(obj)
    return finish(obj, name, mat, parent)


def profile(name, rows, mat, parent=None, n=24):
    """Closed elliptical garment, rows = (height, half-width, half-depth)."""
    verts = [(rx * math.sin(TAU*j/n), y, rz * math.cos(TAU*j/n))
             for y, rx, rz in rows for j in range(n)]
    faces = []
    for i in range(len(rows)-1):
        for j in range(n):
            a, b = i*n+j, i*n+(j+1)%n
            faces.append((a, b, b+n, a+n))
    faces.extend([tuple(reversed(range(n))), tuple((len(rows)-1)*n+j for j in range(n))])
    return mesh(name, verts, faces, mat, parent)


def cord(name, points, radius, mat, parent=None):
    curve = bpy.data.curves.new(name, 'CURVE')
    curve.dimensions = '3D'
    curve.bevel_depth = radius
    curve.bevel_resolution = 2
    curve.resolution_u = 12
    spline = curve.splines.new('BEZIER')
    spline.bezier_points.add(len(points)-1)
    for b, p in zip(spline.bezier_points, points):
        b.co = xyz(p)
        b.handle_left_type = b.handle_right_type = 'AUTO'
    obj = bpy.data.objects.new(name, curve)
    work.collection.objects.link(obj)
    obj.parent = parent
    obj.data.materials.append(M[mat])
    return obj


TORSO = [(.755,.25,.168),(.775,.282,.188),(.84,.293,.205),
         (1.03,.30,.216),(1.16,.295,.207),(1.235,.284,.189),
         (1.285,.261,.171),(1.325,.226,.15),(1.355,.183,.13),
         (1.377,.142,.111),(1.39,.12,.102)]


def torso(name, mat, parent):
    return profile(name, TORSO, mat, parent)


def sleeve(name, parent, long=False, mat='custom', side=1):
    # A set-in sleeve: slim hem, full upper arm, then a rounded cap buried in
    # the chest. More silhouette rows remove the old pointed shoulder pad.
    low = -.32 if long else -.185
    rows = [(low,.087 if long else .096,.09 if long else .101),
            (low+.012,.092 if long else .100,.096 if long else .105)]
    if long:
        rows.extend([(-.23,.098,.104),(-.16,.104,.109)])
    rows.extend([(-.11,.108,.114),(-.055,.109,.118),(-.01,.100,.114),
                 (.028,.084,.100),(.06,.06,.08),(.083,.032,.051),
                 (.092,.008,.018)])
    obj = profile(name, rows, mat, parent, 24)
    for vertex in obj.data.vertices:
        t = max(0, min(1, (vertex.co.z + .055) / .147))
        smooth = t*t*(3-2*t)
        vertex.co.x += side * (.028 - .116*smooth)
    # One light subdivision rounds the cap without erasing the clay silhouette.
    mod = obj.modifiers.new('soft shoulder transition', 'SUBSURF')
    mod.levels = 1
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return obj


def build_base():
    clear()
    rig = group('rig')
    # Actual skin under clothes; separate garment fallbacks can be hidden independently.
    ellipsoid('body', (0,1.08,0), (.264,.32,.183), 'skin', rig)
    ellipsoid('neck', (0,1.40,0), (.12,.105,.108), 'skin', rig)
    head = ellipsoid('head',(0,HEAD_Y,0),(.43,.425,.4),'skin',rig,32,20)
    # Widen the lower cheeks very slightly: an oval, not a perfect primitive ball.
    for v in head.data.vertices:
        y = v.co.z / .425
        v.co.x *= 1 + .035 * math.exp(-((y+.35)/.36)**2)
    ellipsoid('nose',(0,1.748,.394),(.040,.036,.040),'skin',rig,20,12)
    for s, side in [(-1,'L'),(1,'R')]:
        ellipsoid('ear'+side,(s*.422,1.735,-.002),(.067,.092,.052),'skin',rig,20,12)
        arm = group('arm'+side,(s*SHOULDER_X,SHOULDER_Y,0),rig)
        # Hands are compact mittens with a tucked-in thumb, not flat triangles.
        ellipsoid('skinArm'+side,(s*.025,-.26,.004),(.077,.226,.081),'skin',arm)
        ellipsoid('skinHand'+side,(s*.025,-.492,.016),(.092,.106,.086),'skin',arm)
        ellipsoid('thumb'+side,(-s*.045,-.468,.061),(.042,.059,.043),'skin',arm,16,10)
        sleeve('baseSleeve'+side,arm,side=s)
        leg = group('leg'+side,(s*.148,.73,0),rig)
        ellipsoid('skinLeg'+side,(0,-.31,0),(.092,.29,.093),'skin',leg)
        profile('basePants'+side,[(-.28,.12,.13),(-.26,.129,.136),(-.08,.131,.136),(.015,.117,.116)],'custom',leg)
        profile('sock'+side,[(-.565,.084,.082),(-.49,.087,.086),(-.43,.085,.082)],'linen',leg,20)
        box('sole'+side,(0,-.687,.047),(.232,.065,.34),'sole',leg,.028)
        ellipsoid('shoe'+side,(0,-.618,.05),(.12,.095,.177),'shoe',leg)
        for i in range(2):
            box('lace'+side+str(i),(0,-.544-i*.016,.10+i*.04),(.118,.018,.022),'linen',leg,.007)
    torso('baseTop','custom',rig)
    profile('baseBottom',[(.655,.263,.168),(.77,.275,.181),(.795,.264,.175)],'custom',rig)
    for obj in rig.children:
        if obj.name in ('head','nose','earL','earR'):
            obj.scale *= HEAD_SCALE
            obj.location.x *= HEAD_SCALE
            obj.location.y *= HEAD_SCALE
            obj.location.z = HEAD_Y + (obj.location.z-HEAD_Y)*HEAD_SCALE
    export('base.glb')


def hair_shell(parent, kind):
    n, rings = 32, 14
    verts = []
    for i in range(rings+1):
        for j in range(n):
            a = TAU*j/n
            front = max(0,math.cos(a)) ** .6
            end = (2.18 if kind in ('bob','long') else 1.82) * (1-front) + .94*front
            phi = .002 + (end-.002)*i/rings
            r = .446 + .004*math.sin(a*3)*math.sin(phi)**2
            x, z = r*math.sin(phi)*math.sin(a), r*.95*math.sin(phi)*math.cos(a)-.012
            y = HEAD_Y+r*math.cos(phi)
            if kind == 'long' and i>9:
                y -= .26*((i-9)/5)**2*(1-front)
                # Lowering a lock must also move it out around the cheek, not
                # through the head. This prevents jagged skin/hair intersections.
                radial = max(r*math.sin(phi), .454*math.sqrt(max(0,1-((y-HEAD_Y)/.435)**2)))
                x, z = radial*math.sin(a), radial*.95*math.cos(a)-.012
            verts.append((x,y,z))
    faces = [(i*n+j,(i+1)*n+j,(i+1)*n+(j+1)%n,i*n+(j+1)%n)
             for i in range(rings) for j in range(n)]
    obj = mesh('sculptedHair',verts,faces,'custom',parent)
    mod = obj.modifiers.new('thick rounded hairline','SOLIDIFY')
    mod.thickness = .018
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=mod.name)


def build_hair(kind):
    clear()
    root = group('hair-'+kind)
    if kind in ('short','bob','bun','spiky','long'):
        hair_shell(root,kind)
        # Broad swept locks add a sculpted silhouette without noodle-like individual hairs.
        count = 3 if kind=='spiky' else 1
        for i in range(count):
            x = -.14+i*.14 if kind=='spiky' else -.07
            lock = ellipsoid('sweptLock'+str(i),(x,2.135+(.032 if kind=='spiky' else 0),.123),
                             (.125 if kind=='spiky' else .20,.098 if kind=='spiky' else .065,.196),'custom',root)
            lock.rotation_euler[1] = -.24
            lock.rotation_euler[2] = -.24
        if kind in ('bob','long'):
            for s in (-1,1):
                ellipsoid('sideLock'+str(s),(s*.402,1.77 if kind=='bob' else 1.66,-.09),
                          (.083,.218 if kind=='bob' else .31,.204),'custom',root)
        if kind=='bun':
            ellipsoid('bun',(0,2.075,-.377),(.173,.165,.148),'custom',root)
            cord('bunTie',[(-.105,2.065,-.369),(0,1.99,-.411),(.105,2.065,-.369)],.018,'linen',root)
    elif kind=='chef':
        profile('hatBand',[(2.10,.24,.225),(2.12,.256,.24),(2.22,.253,.24),(2.24,.24,.226)],'linen',root)
        ellipsoid('chefCrown',(0,2.335,-.01),(.294,.173,.263),'linen',root)
        for i in range(5):
            a=TAU*i/5
            ellipsoid('softPleat'+str(i),(.135*math.sin(a),2.365,.125*math.cos(a)),(.166,.153,.151),'linen',root)
        cord('bandStitch',[(-.21,2.155,.123),(0,2.155,.242),(.21,2.155,.123)],.005,'seam',root)
    elif kind=='cap':
        hair_shell(root,'short')
        profile('capBand',[(2.075,.287,.276),(2.13,.281,.27)],'custom',root)
        ellipsoid('capCrown',(0,2.135,-.028),(.29,.187,.285),'custom',root)
        ellipsoid('capBrim',(0,2.075,.27),(.272,.025,.198),'custom',root)
        ellipsoid('capButton',(0,2.324,-.028),(.027,.016,.026),'linen',root,16,10)
    elif kind=='crab':
        # Original clay costume: compact hood with soft claws and small eyes.
        hair_shell(root,'bob')
        for s in (-1,1):
            ellipsoid('claw'+str(s),(s*.48,2.06,-.04),(.115,.13,.10),'hatRed',root)
            ellipsoid('clawTip'+str(s),(s*.49,2.165,-.055),(.048,.089,.055),'hatRed',root)
            ellipsoid('crabEye'+str(s),(s*.115,2.235,.02),(.065,.084,.062),'hatRed',root)
            ellipsoid('crabPupil'+str(s),(s*.115,2.245,.077),(.025,.028,.012),'ink',root,16,10)
    root.scale *= HEAD_SCALE
    root.location.z = HEAD_Y*(1-HEAD_SCALE)
    export('hair/'+kind+'.glb')


def chest_patch(name, points, mat, parent, depth=.014):
    # Curved garment panels follow the chest. Coordinates are deliberately sculpted,
    # not flat boards glued to the front of a sphere.
    obj = mesh(name,points,[tuple(range(len(points)))],mat,parent)
    mod=obj.modifiers.new('cloth thickness','SOLIDIFY'); mod.thickness=depth
    bpy.context.view_layer.objects.active=obj
    bpy.ops.object.modifier_apply(modifier=mod.name)
    mod=obj.modifiers.new('soft garment edge','BEVEL'); mod.width=.012; mod.segments=3
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return obj


def build_top(kind):
    clear()
    root=group('top-'+kind)
    torso('garmentBody','custom',root)
    profile('collar',[(1.362,.124,.107),(1.395,.131,.113),(1.407,.12,.103)],'linen' if kind in ('apron','scout') else 'customShade',root)
    for s,side in [(-1,'L'),(1,'R')]:
        arm=group('sleeve'+side,(s*SHOULDER_X,SHOULDER_Y,0),root)
        sleeve('sleeveCloth'+side,arm,long=kind in ('hoodie','scout'),side=s)
        low=-.313 if kind in ('hoodie','scout') else -.177
        cuff = profile('cuff'+side,[(low-.007,.091 if low<-.3 else .098,.094 if low<-.3 else .104),
                            (low+.01,.094 if low<-.3 else .103,.098 if low<-.3 else .108)],
                'linen' if kind in ('apron','stripe') else 'customShade',arm,20)
        cuff.location.x = s*.028
    if kind=='apron':
        # Soft bib, broad lower apron, pocket and straps wrapping over both shoulders.
        profile('apronSkirt',[(.71,.259,.188),(.74,.287,.21),(.84,.3,.224),(.98,.302,.226)],'linen',root)
        # Two curved strips so the bib follows the belly instead of cutting through it.
        mesh('apronBib',[(-.145,.97,.204),(0,.97,.235),(.145,.97,.204),
                         (-.14,1.13,.199),(0,1.13,.237),(.14,1.13,.199),
                         (-.126,1.29,.16),(0,1.29,.198),(.126,1.29,.16)],
             [(0,1,4,3),(1,2,5,4),(3,4,7,6),(4,5,8,7)],'linen',root)
        for s in (-1,1):
            cord('apronStrap'+str(s),[(s*.11,1.27,.178),(s*.14,1.353,.095),(s*.155,1.33,-.10),(s*.16,.99,-.205)],.019,'linen',root)
        box('apronPocket',(0,.91,.233),(.217,.122,.025),'seam',root,.022)
        cord('pocketLip',[(-.087,.96,.25),(0,.952,.255),(.087,.96,.25)],.007,'linen',root)
        box('apronLabel',(.068,.895,.251),(.032,.034,.012),'brass',root,.006)
    elif kind=='stripe':
        for i,(y,rx,rz) in enumerate([( .89,.299,.216),(1.025,.304,.22),(1.16,.297,.21)]):
            profile('stripe'+str(i),[(y-.025,rx,rz),(y+.025,rx,rz)],'linen',root)
    elif kind=='hoodie':
        ellipsoid('hood',(0,1.345,-.146),(.219,.12,.153),'custom',root)
        box('kangarooPocket',(0,.925,.214),(.278,.131,.045),'customShade',root,.04)
        for s in (-1,1):
            cord('drawstring'+str(s),[(s*.065,1.36,.123),(s*.08,1.25,.203),(s*.066,1.13,.221)],.009,'linen',root)
            ellipsoid('stringTip'+str(s),(s*.066,1.123,.221),(.013,.023,.012),'brass',root,12,8)
    elif kind in ('vest','scout'):
        for s in (-1,1):
            chest_patch('lapel'+str(s),[(s*.018,1.16,.218),(s*.17,1.29,.158),(s*.117,1.375,.097),(s*.03,1.29,.177)],'linen',root)
            box('pocket'+str(s),(s*.151,1.05,.193),(.118,.12,.037),'customShade',root,.025)
        cord('placket',[(0,.795,.192),(0,1.0,.221),(0,1.28,.18)],.014,'customShade',root)
        for i in range(3):
            ellipsoid('button'+str(i),(0,.87+i*.135,.226 if i else .212),(.013,.013,.009),'brass',root,12,8)
    else:
        box('chestPocket',(.14,1.145,.195),(.107,.102,.021),'customShade',root,.017)
    export('top/'+kind+'.glb')


def build_bottom(kind):
    clear()
    root=group('bottom-'+kind)
    profile('waist',[(.655,.259,.167),(.73,.276,.186),(.782,.267,.176)],'custom',root)
    profile('waistband',[(.753,.275,.184),(.79,.272,.182)],'customShade',root)
    for s,side in [(-1,'L'),(1,'R')]:
        leg=group('trouser'+side,(s*.148,.73,0),root)
        end=-.27 if kind=='shorts' else -.50
        profile('pantLeg'+side,[(end,.115 if kind=='shorts' else .09,.126 if kind=='shorts' else .10),
                              (end+.035,.13 if kind=='shorts' else .105,.138 if kind=='shorts' else .112),
                              (-.12,.131,.145),(-.055,.131,.152),(.015,.118,.149)],'custom',leg)
        profile('hem'+side,[(end-.012,.12 if kind=='shorts' else .103,.133 if kind=='shorts' else .115),
                          (end+.041,.133 if kind=='shorts' else .113,.143 if kind=='shorts' else .121)],
                'linen' if kind=='cuffed' else 'customShade',leg)
        cord('pocketSeam'+side,[(s*.075,-.055,.129),(s*.058,-.11,.15),(s*.032,-.15,.15)],.004,'customShade',leg)
    export('bottom/'+kind+'.glb')


def export(relative):
    path=OUT/relative
    path.parent.mkdir(parents=True,exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_active_scene=True,
                              export_yup=True,export_apply=True,export_cameras=False,export_lights=False)
    print('[clay-character]',relative)


try:
    build_base()
    for kind in ('short','bob','bun','spiky','long','chef','crab','cap'):
        build_hair(kind)
    for kind in ('tee','apron','stripe','hoodie','vest','scout'):
        build_top(kind)
    for kind in ('shorts','trousers','cuffed'):
        build_bottom(kind)
finally:
    clear()
    bpy.context.window.scene=previous_scene
    bpy.data.scenes.remove(work)
print('[clay-character] complete')
