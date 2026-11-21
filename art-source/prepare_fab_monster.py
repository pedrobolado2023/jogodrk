"""Prepares a Fab model (glb/gltf, no skeleton) for Mixamo auto-rigging: joins it into one mesh, reduces it to a
game-friendly triangle count, puts it on the ground at the origin facing -Y, shrinks its textures and exports an FBX
with the textures embedded.

blender -b -t 4 --python art-source/prepare_fab_monster.py -- <input.glb|.gltf> <output.fbx> <target_tris> [height_m]

The output must stay out of git (licensed source model); only the imported Unreal assets go to the repository.
"""
import sys
import bpy

args = sys.argv[sys.argv.index("--") + 1:]
src, out, target = args[0], args[1], int(args[2])
height = float(args[3]) if len(args) > 3 else 2.0

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
bpy.ops.object.select_all(action="DESELECT")
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.join()
body = bpy.context.view_layer.objects.active
bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# Fab glb exports from DarkPaperVerse carry several UV maps and the first one is empty (every point at 0,1);
# Unreal and Mixamo only use the first, so keep only the first map that really spreads over the texture.
def spread(layer):
    pts = {(round(d.uv.x, 3), round(d.uv.y, 3)) for d in list(layer.data)[::40]}
    return len(pts)
good = max(body.data.uv_layers, key=spread) if body.data.uv_layers else None
if good is not None:
    keep = good.name
    for layer in [l for l in body.data.uv_layers if l.name != keep]:
        body.data.uv_layers.remove(layer)
    body.data.uv_layers[0].name = "UVMap"
    print("DF_UV kept", keep)

tris = sum(len(p.vertices) - 2 for p in body.data.polygons)
if tris > target:
    mod = body.modifiers.new("reduce", "DECIMATE")
    mod.ratio = target / tris
    mod.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=mod.name)
after = sum(len(p.vertices) - 2 for p in body.data.polygons)

# feet on the ground, centred, scaled to the wanted height (Mixamo works in cm; Unreal profiles set the final size)
bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
body.location = (0, 0, 0)
bpy.context.view_layer.update()
zmin = min((body.matrix_world @ v.co).z for v in body.data.vertices)
zmax = max((body.matrix_world @ v.co).z for v in body.data.vertices)
k = height / max(0.01, zmax - zmin)
body.scale = (k, k, k)
bpy.ops.object.transform_apply(scale=True)
bpy.context.view_layer.update()
zmin = min((body.matrix_world @ v.co).z for v in body.data.vertices)
body.location.z -= zmin
bpy.ops.object.transform_apply(location=True)

# textures: at most 2048 px (keeps the upload small; the game camera never needs more)
for img in bpy.data.images:
    if img.size[0] > 2048 or img.size[1] > 2048:
        img.scale(min(2048, img.size[0]), min(2048, img.size[1]))
    img.pack()

bpy.ops.export_scene.fbx(filepath=out, use_selection=False, path_mode="COPY", embed_textures=True,
                         apply_scale_options="FBX_SCALE_ALL", object_types={"MESH"}, mesh_smooth_type="FACE")
print("DF_PREPARED", src, "tris", tris, "->", after, "height", height, "->", out)
