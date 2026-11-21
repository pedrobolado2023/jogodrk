"""Prepares the user's base bodies (Tripo, art-source/personagens/<zip name>/) for Mixamo auto-rigging.

  blender -b --factory-startup -P art-source/prepare_base_bodies.py -- <src.fbx> <out.fbx> [strip_back_props]

- Loose parts behind the body (the archers' bow, quiver and arrows: weapons become separate, swappable items) and
  tiny stray parts are removed when strip_back_props=1.
- Scaled to 1.8 m (standing T-pose), feet on the ground, centred, transforms applied, facing -Y (Blender front).
- Exported as FBX with the textures embedded, ready for the Mixamo upload.
The source and output files stay out of git (art-source/personagens/ is ignored).
"""
import sys
import bmesh
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
SRC, OUT = argv[0], argv[1]
STRIP = len(argv) > 2 and argv[2] == "1"
HEIGHT = 1.8

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=SRC)
obj = next(o for o in bpy.data.objects if o.type == "MESH")
bpy.context.view_layer.objects.active = obj
obj.select_set(True)

if STRIP:
    bm = bmesh.new(); bm.from_mesh(obj.data); bm.verts.ensure_lookup_table()
    seen, islands = set(), []
    for v in bm.verts:
        if v.index in seen:
            continue
        stack, idx = [v], []
        seen.add(v.index)
        while stack:
            a = stack.pop(); idx.append(a.index)
            for e in a.link_edges:
                b = e.other_vert(a)
                if b.index not in seen:
                    seen.add(b.index); stack.append(b)
        islands.append(idx)
    islands.sort(key=len, reverse=True)
    body = islands[0]
    drop = []
    for isl in islands[1:]:
        ys = [(obj.matrix_world @ bm.verts[i].co).y for i in isl]
        if len(isl) < 50 or min(ys) > 0.02:   # behind the body (+Y is the back here) or a stray speck
            drop += isl
    for i in sorted(set(drop), reverse=True):
        pass
    bmesh.ops.delete(bm, geom=[bm.verts[i] for i in set(drop)], context="VERTS")
    bm.to_mesh(obj.data); bm.free()
    print("STRIP removed", len(drop), "vertices from", len(islands) - 1, "loose parts")

bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
pts = [Vector(v.co) for v in obj.data.vertices]
lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
s = HEIGHT / (hi.z - lo.z)
centre = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
for v in obj.data.vertices:
    v.co = (v.co - centre) * s
obj.data.update()
obj.name = "Body"
bpy.ops.export_scene.fbx(filepath=OUT, use_selection=True, object_types={"MESH"}, apply_scale_options="FBX_SCALE_ALL",
                         path_mode="COPY", embed_textures=True, add_leaf_bones=False, bake_anim=False)
print("BODY", OUT, "verts", len(obj.data.vertices), "height", HEIGHT)
