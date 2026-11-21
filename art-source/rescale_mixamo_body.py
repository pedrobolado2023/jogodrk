"""Mixamo returned the base bodies in metres (1.8 tall); the class skeletons in Unreal are in centimetres.
Applies the object scales (bones and skin keep matching) and re-exports the FBX in centimetres.

  blender -b --factory-startup -P art-source/rescale_mixamo_body.py -- <in.fbx> <out.fbx>
"""
import sys
import bpy

argv = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=argv[0], automatic_bone_orientation=False)
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)
objs = [o for o in bpy.data.objects if o.type in ("ARMATURE", "MESH")]
roots = [o for o in objs if o.parent is None]
# Blender reads 1.8 (the file's centimetre units become metres here); x100 then FBX_SCALE_ALL lands at 180 cm in Unreal
for o in roots:
    o.scale = (o.scale[0] * 100, o.scale[1] * 100, o.scale[2] * 100)
bpy.context.view_layer.update()
bpy.ops.object.select_all(action="DESELECT")
for o in objs:
    o.select_set(True)
bpy.context.view_layer.objects.active = next(o for o in objs if o.type == "ARMATURE")
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
mesh = next(o for o in objs if o.type == "MESH")
zs = [(mesh.matrix_world @ v.co).z for v in mesh.data.vertices]
print("HEIGHT", round(max(zs) - min(zs), 2))
bpy.ops.export_scene.fbx(filepath=argv[1], use_selection=True, object_types={"ARMATURE", "MESH"}, add_leaf_bones=False,
                         bake_anim=False, apply_scale_options="FBX_SCALE_ALL", path_mode="COPY",
                         embed_textures=True, primary_bone_axis="Y", secondary_bone_axis="X")
