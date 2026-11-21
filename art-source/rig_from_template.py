"""Gives a skeleton to a model that Mixamo's auto-rigger refuses (long capes, floating halos), by borrowing the skeleton
and skin weights of a Mixamo character with a similar pose. The result has the same bone names (mixamorig:*) as the
template, so every animation of the template's Mixamo pack plays on it.

blender -b -t 4 --python art-source/rig_from_template.py -- <template.fbx> <model.fbx> <out.fbx> <chin_height_m> [preview.png anim.fbx]

Steps: scale/move the template skeleton so its head sits at the model's chin; turn its arms towards the model's hands;
make that pose the rest pose; copy the skin weights from the template body (nearest surface) to the model; export.
The output is a licensed model: keep it in art-source/mixamo/ (ignored by git).
"""
import math
import sys
import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:]
template, model, out, chin = args[0], args[1], args[2], float(args[3])
preview = args[4] if len(args) > 4 else None
anim = args[5] if len(args) > 5 else None

bpy.ops.wm.read_factory_settings(use_empty=True)


def select_only(objs, active=None):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or objs[0]


# --- template: armature + body, transforms applied
bpy.ops.import_scene.fbx(filepath=template)
arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
ROOT = arm.matrix_world.copy()  # Mixamo's armature node (rotated 90 deg, scale 0.01): restored on export
tmeshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
select_only([arm] + tmeshes, arm)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for a in bpy.data.actions:
    bpy.data.actions.remove(a)
arm.animation_data_clear()

# --- model
before = set(bpy.context.scene.objects)
bpy.ops.import_scene.fbx(filepath=model)
body = next(o for o in bpy.context.scene.objects if o not in before and o.type == "MESH")
select_only([body])
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
verts = [body.matrix_world @ v.co for v in body.data.vertices]

# --- scale and place the skeleton: template head bone at the model's chin, centred on the model's torso
bones = arm.data.bones
head_z = (arm.matrix_world @ bones["mixamorig:Head"].head_local).z
s = chin / head_z
torso = [v for v in verts if chin * 0.55 < v.z < chin * 0.85]
cx = sum(v.x for v in torso) / len(torso)
cy = sum(v.y for v in torso) / len(torso)
hips = arm.matrix_world @ bones["mixamorig:Hips"].head_local
select_only([arm] + tmeshes, arm)
for o in [arm] + tmeshes:
    o.scale = (s, s, s)
bpy.ops.object.transform_apply(scale=True)
bpy.context.view_layer.update()
hips = arm.matrix_world @ arm.data.bones["mixamorig:Hips"].head_local
for o in [arm] + tmeshes:
    o.location += Vector((cx - hips.x, cy - hips.y, 0))
bpy.ops.object.transform_apply(location=True)
bpy.context.view_layer.update()

# --- turn the arms towards the model's hands (the outermost vertices at hand height on each side)
bpy.ops.object.mode_set(mode="POSE")
for side, sign in (("Left", 1), ("Right", -1)):
    upper = arm.pose.bones["mixamorig:%sArm" % side]
    hand = arm.data.bones["mixamorig:%sHand" % side]
    shoulder = arm.matrix_world @ upper.head
    # the template's "Left" is on +X in Blender when the character faces -Y
    side_sign = 1 if (arm.matrix_world @ hand.head_local).x > hips.x else -1
    band = [v for v in verts if shoulder.z - 0.9 * s < v.z < shoulder.z + 0.15 * s and (v.x - cx) * side_sign > 0]
    tip = max(band, key=lambda v: (v.x - cx) * side_sign)
    wrist_target = tip - (tip - shoulder).normalized() * 0.18 * s
    cur = (arm.matrix_world @ hand.head_local) - shoulder
    want = wrist_target - shoulder
    q = cur.rotation_difference(want)                       # world-space turn
    m = arm.matrix_world.to_3x3() @ upper.bone.matrix_local.to_3x3()
    local = m.inverted() @ q.to_matrix() @ m                 # same turn in the bone's own space
    upper.rotation_mode = "QUATERNION"
    upper.rotation_quaternion = local.to_quaternion() @ upper.rotation_quaternion
    print("DF_ARM", side, "turn", round(math.degrees(q.angle), 1), "deg")
bpy.context.view_layer.update()

# bake the pose into the template body, then make it the rest pose
bpy.ops.object.mode_set(mode="OBJECT")
for t in tmeshes:
    for mod in list(t.modifiers):
        if mod.type == "ARMATURE":
            select_only([t])
            bpy.ops.object.modifier_apply(modifier=mod.name)
select_only([arm])
bpy.ops.object.mode_set(mode="POSE")
bpy.ops.pose.select_all(action="SELECT")
bpy.ops.pose.armature_apply(selected=False)
bpy.ops.object.mode_set(mode="OBJECT")

# --- copy skin weights from the template body to the model
select_only(tmeshes)
if len(tmeshes) > 1:
    bpy.ops.object.join()
src = bpy.context.view_layer.objects.active
dt = body.modifiers.new("weights", "DATA_TRANSFER")
dt.object = src
dt.use_vert_data = True
dt.data_types_verts = {"VGROUP_WEIGHTS"}
dt.vert_mapping = "POLYINTERP_NEAREST"
dt.layers_vgroup_select_src = "ALL"
dt.layers_vgroup_select_dst = "NAME"
select_only([body])
bpy.ops.object.datalayout_transfer(modifier=dt.name)
bpy.ops.object.modifier_apply(modifier=dt.name)
# parts far from the template body (cape, halo, spikes) would follow whatever bone happens to be nearest and tear;
# make them ride the spine and head rigidly instead, by height
from mathutils.bvhtree import BVHTree
dg = bpy.context.evaluated_depsgraph_get()
tree = BVHTree.FromObject(src, dg)
chain = []
for name in ("mixamorig:Hips", "mixamorig:Spine", "mixamorig:Spine1", "mixamorig:Spine2", "mixamorig:Neck", "mixamorig:Head"):
    chain.append((name, (arm.matrix_world @ arm.data.bones[name].head_local).z))
groups = {g.name: g for g in body.vertex_groups}
for name, _ in chain:
    if name not in groups:
        groups[name] = body.vertex_groups.new(name=name)
limit = 0.10 * s
loose = 0
for v in body.data.vertices:
    p = body.matrix_world @ v.co
    hit = tree.find_nearest(p)
    if hit[0] is None or hit[3] <= limit:
        continue
    loose += 1
    for g in list(v.groups):
        body.vertex_groups[g.group].remove([v.index])
    z = p.z
    if z <= chain[0][1]:
        groups[chain[0][0]].add([v.index], 1.0, "REPLACE")
    elif z >= chain[-1][1]:
        groups[chain[-1][0]].add([v.index], 1.0, "REPLACE")
    else:
        for (a, za), (b, zb) in zip(chain, chain[1:]):
            if za <= z <= zb:
                t = (z - za) / max(1e-4, zb - za)
                groups[a].add([v.index], 1 - t, "REPLACE")
                groups[b].add([v.index], t, "REPLACE")
                break
print("DF_LOOSE", loose, "of", len(body.data.vertices), "vertices ride the spine/head")
if "--float" in sys.argv:
    # a floating caster: no leg motion at all, the robe and legs ride the hips (walk clips become a glide)
    legs = [g for g in body.vertex_groups if any(k in g.name for k in ("UpLeg", "Leg", "Foot", "Toe"))]
    hips_g = groups["mixamorig:Hips"]
    moved = 0
    for v in body.data.vertices:
        w = sum(g.weight for g in v.groups if body.vertex_groups[g.group] in legs)
        if w > 0:
            for g in legs:
                g.remove([v.index])
            hips_g.add([v.index], w, "ADD")
            moved += 1
    print("DF_FLOAT", moved, "vertices moved from the legs to the hips")
bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=4)
bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)
bpy.data.objects.remove(src, do_unlink=True)
body.parent = arm
mod = body.modifiers.new("Armature", "ARMATURE")
mod.object = arm
print("DF_RIGGED scale", round(s, 3), "groups", len(body.vertex_groups))

# Export with the template's own armature node transform (Mixamo files carry a 90-degree, 0.01-scale root node and
# their clips are baked against it). With applied transforms the clips stretched the body into a pole or crushed it.
from mathutils import Matrix
inv = ROOT.inverted()
arm.data.transform(inv)
body.data.transform(inv)
arm.matrix_world = ROOT
body.matrix_parent_inverse = Matrix.Identity(4)
body.matrix_basis = Matrix.Identity(4)
bpy.context.view_layer.update()
select_only([arm, body], arm)
bpy.ops.export_scene.fbx(filepath=out, use_selection=True, add_leaf_bones=False, bake_anim=False, path_mode="COPY",
                         embed_textures=True, object_types={"ARMATURE", "MESH"}, mesh_smooth_type="FACE")
arm.data.transform(ROOT)
body.data.transform(ROOT)
arm.matrix_world = Matrix.Identity(4)
bpy.context.view_layer.update()
print("DF_EXPORTED", out)

# --- optional preview: play one frame of a template-pack animation on the new rig
if preview and anim:
    before = set(bpy.data.actions)
    bpy.ops.import_scene.fbx(filepath=anim)
    act = next(a for a in bpy.data.actions if a not in before)
    for o in list(bpy.context.scene.objects):
        if o not in (arm, body) and o.type in ("ARMATURE", "MESH"):
            bpy.data.objects.remove(o, do_unlink=True)
    # Mixamo clips move the hips in centimetres; this rig is in metres, so the preview keeps the rotations only
    # (Unreal converts the units itself on import).
    fcurves = getattr(act, "fcurves", None)
    if fcurves is None:
        fcurves = [fc for layer in act.layers for strip in layer.strips for bag in strip.channelbags for fc in bag.fcurves]
    for fc in list(fcurves):
        if fc.data_path.endswith("location"):
            try:
                act.fcurves.remove(fc)
            except Exception:
                for layer in act.layers:
                    for strip in layer.strips:
                        for bag in strip.channelbags:
                            if fc in list(bag.fcurves):
                                bag.fcurves.remove(fc)
    arm.animation_data_create()
    arm.animation_data.action = act
    sl = getattr(arm.animation_data, "action_slot", None)
    if hasattr(act, "slots") and len(act.slots):
        arm.animation_data.action_slot = act.slots[0]
    frame = float(args[6]) if len(args) > 6 else 0.45
    bpy.context.scene.frame_set(int(act.frame_range[0] + (act.frame_range[1] - act.frame_range[0]) * frame))
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); bpy.context.scene.collection.objects.link(cam)
    zmax = max(v.z for v in verts)
    cam.data.type = "ORTHO"; cam.data.ortho_scale = zmax * 1.3
    cam.location = (zmax * 0.8, -zmax * 1.6, zmax * 0.55); cam.rotation_euler = (math.radians(80), 0, math.radians(27))
    bpy.context.scene.camera = cam
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sun.data.energy = 3
    sun.rotation_euler = (math.radians(45), 0, math.radians(30)); bpy.context.scene.collection.objects.link(sun)
    w = bpy.data.worlds.new("w"); w.color = (0.2, 0.2, 0.22); bpy.context.scene.world = w
    sc = bpy.context.scene; sc.render.resolution_x = 700; sc.render.resolution_y = 800; sc.render.filepath = preview
    bpy.ops.render.render(write_still=True)
    print("DF_PREVIEW", preview)
